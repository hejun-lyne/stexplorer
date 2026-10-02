#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
常驻 Python 服务进程

背景：旧模式下渲染进程每次取数都会让主进程 spawn 一个新的 python 进程，
      一个「下一天」会触发多路取数（日/周/月K、训练日分时、日内收盘价…），
      每次都要重新启动解释器并 import pandas / tushare / 初始化 stock_db，
      进程启动开销（每次 1~3 秒）才是卡的根源。

本脚本把「一个脚本一个常驻进程」起来，之后所有调用通过 stdin/stdout 传 JSON，
避免反复启动与重复 import。

启动：
    python -u py_service.py <target_script>     # 如 tushare_api.py / akshare_api.py

协议（均为「一行一个 JSON」）：
    请求  (stdin) ：{"id": 1, "args": ["get_kline_data", "--params", "{...}", "--token", "...", ...]}
                     args 与旧 CLI 参数完全一致（method / --params / --token / --storage-path / --as-of-date）
    响应 (stdout) ：{"id": 1, "ok": true,  "data": <方法返回值>, "logs": ["...", ...]}
                    {"id": 1, "ok": false, "error": "错误信息",     "logs": ["...", ...]}

    方法执行期间的 print 会被捕获进 logs（同时写到 stderr），
    保证 stdout 只承载协议 JSON，不会污染解析。
"""

import sys
import os
import io
import json
import argparse
import contextlib
import importlib
import traceback
from datetime import date, datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)


class _Encoder(json.JSONEncoder):
    """兼容 pandas / numpy / datetime 的 JSON 编码器"""

    def default(self, obj):
        if hasattr(obj, 'item'):  # numpy 标量 / pandas 标量
            try:
                return obj.item()
            except Exception:
                pass
        if isinstance(obj, (datetime, date)):
            return obj.strftime('%Y-%m-%d %H:%M:%S' if isinstance(obj, datetime) else '%Y-%m-%d')
        if hasattr(obj, 'strftime'):
            return obj.strftime('%Y-%m-%d')
        if isinstance(obj, set):
            return list(obj)
        try:
            return super().default(obj)
        except Exception:
            return str(obj)


def _parse_args(args):
    """按旧 CLI 的语义解析参数（未知参数直接忽略，保持向后兼容）"""
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('method', nargs='?')
    parser.add_argument('--params', '-p', default='{}')
    parser.add_argument('--token', '-t', default=None)
    parser.add_argument('--storage-path', '-s', default=None)
    parser.add_argument('--as-of-date', '-d', dest='as_of_date', default=None)
    ns, _unknown = parser.parse_known_args(args)
    return ns


def _build_api(mod, mod_name):
    # 约定：脚本通过 <Xxx>API 类暴露可调用方法
    #   tushare_api.py → TushareAPI、akshare_api.py → AkshareAPI、stock_db.py → CacheAPI
    api_cls = None
    for name in ('TushareAPI', 'AkshareAPI', 'CacheAPI'):
        api_cls = getattr(mod, name, None)
        if api_cls is not None:
            break
    if api_cls is None:
        # 兜底：按模块名推导（tushare → TushareAPI …）
        guess = mod_name.split('_')[0].capitalize() + 'API'
        api_cls = getattr(mod, guess, None)
    if api_cls is None:
        raise RuntimeError('%s 中未找到 API 类' % mod_name)
    return api_cls()


def _tail_lines(text, max_lines=200, max_chars=8000):
    """截取日志尾部，避免把超大输出塞进协议"""
    if not text:
        return []
    lines = [l for l in text.splitlines() if l.strip()]
    lines = lines[-max_lines:]
    joined = '\n'.join(lines)
    if len(joined) > max_chars:
        joined = joined[-max_chars:]
    return joined.splitlines() if joined else []


def _emit(real_stdout, payload):
    try:
        text = json.dumps(payload, ensure_ascii=False, cls=_Encoder)
    except Exception as e:
        text = json.dumps(
            {'id': payload.get('id'), 'ok': False, 'error': 'encode error: %s' % e, 'logs': []},
            ensure_ascii=False,
        )
    real_stdout.write(text + '\n')
    real_stdout.flush()


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else 'tushare_api.py'
    mod_name = target[:-3] if target.endswith('.py') else target

    # import 期间的输出统一转 stderr，保证 stdout 只承载协议 JSON
    import_buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(import_buf):
            mod = importlib.import_module(mod_name)
    except Exception as e:
        sys.stderr.write('[py_service] 导入 %s 失败: %s\n' % (mod_name, e))
        sys.stderr.write(traceback.format_exc())
        sys.exit(1)
    import_logs = import_buf.getvalue()
    if import_logs:
        sys.stderr.write(import_logs)

    api = _build_api(mod, mod_name)
    is_tushare = hasattr(mod, 'init_pro')
    real_stdout = sys.stdout

    # 只在参数变化时重新下发配置，避免每次都做无谓的初始化
    last_token = object()
    last_as_of = object()
    last_storage = object()

    while True:
        line = sys.stdin.readline()
        if line == '':  # stdin 关闭 → 父进程退出
            break
        line = line.strip()
        if not line:
            continue

        try:
            req = json.loads(line)
        except Exception:
            continue

        rid = req.get('id')
        buf = None
        try:
            ns = _parse_args(req.get('args') or [])
            params = json.loads(ns.params) if ns.params else {}

            if ns.storage_path != last_storage:
                if hasattr(mod, 'set_cache_dir'):
                    mod.set_cache_dir(ns.storage_path)
                last_storage = ns.storage_path

            if ns.as_of_date != last_as_of:
                if hasattr(mod, 'set_as_of_date'):
                    mod.set_as_of_date(ns.as_of_date)
                last_as_of = ns.as_of_date

            if is_tushare and ns.token != last_token:
                mod.init_pro(ns.token)
                last_token = ns.token

            fn = getattr(api, ns.method, None) if ns.method else None
            if fn is None:
                raise RuntimeError('Method %s not found' % (ns.method,))

            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                data = fn(**params)
            _emit(real_stdout, {'id': rid, 'ok': True, 'data': data, 'logs': _tail_lines(buf.getvalue())})
        except Exception as e:
            err_text = str(e)
            logs = _tail_lines(buf.getvalue()) if buf is not None else []
            sys.stderr.write(err_text + '\n')
            sys.stderr.write(traceback.format_exc())
            _emit(real_stdout, {'id': rid, 'ok': False, 'error': err_text, 'logs': logs})


if __name__ == '__main__':
    main()
