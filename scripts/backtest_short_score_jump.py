#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""短线评分「突变」策略离线回测

思路（与图表上的红绿柱完全同口径）：
  评分序列按交易日算单日变化 delta = score(D) - score(D-1)；
  delta >= 买入阈值 且 score >= 评分下限  → 次日开盘买入；
  delta <= 卖出阈值                      → 次日开盘卖出；
  score <= 持仓期最高分 - --trail-drop     → 次日开盘卖出（回撤止盈）。

买入必须是「低位运行之后的突变」，而不是任意一次跳升：
  突变前 --low-base-days 个评分日（默认 3）必须全部 <= --low-base-max（默认 40），
  否则不算低位启动。理由：评分从高位两天跌下来再反抽，同样能凑出 +20 的跳升，
  但那是下跌趋势里的伪信号（图上箭头处）。--low-base-days 0 可关闭该前置条件做对照。

跳升可以按多日累计：--jump-window 2~3 用 score(D)-score(D-k) 判断（且当日不能回落），
因为低位启动常分两天完成（+8 再 +17，单日都不到 20）。--min-rise 提供相对下限：
评分自窗口低点抬升 >= 该值即算达标（与 --min-score 是「或」），低位启动当天往往到不了 60 分。

--buy-mode rise 是另一套买入口径：完全不看单日跳升，只看「评分自近 --rise-ref-days 日
最低点抬升了多少」（--min-rise），再加绝对地板 --rise-min-score、可选的当日跳升
--rise-min-delta 与放量确认 --rise-volume。适合 22.9→31.2→47.8→52.3 这种分几天完成、
单日都不够 20 分的缓慢启动，但信号量远大于 jump 模式。

数据：**只读本地缓存**（不联网、不取数）
  - 评分序列：<data-dir>/meta.db 的 api_cache 表，key = short_term_score_series_{code}_{source}
  - 日K（前复权）：<data-dir>/daily.db 的 daily_kline 表

输出：胜率、交易频率、盈亏比、夏普比率、期望收益、持仓天数、最大回撤等，
      并支持参数扫描（买入阈值 × 评分下限 × 卖出阈值 × 止损 × 最长持有）。

不需要启动应用：只读本地 stock_db（SQLite），命令行即可跑全量回测。

评分口径默认与详情页对齐（无需额外参数）：
  - 版本：只取当前行结构版本 v13（详情页 pickScoreRow 只认 v13，旧版本行视为未命中重算）
  - 维度：只取六个维度齐全的行（缺维度时总分按剩余权重归一化，会虚高并造出假信号）
  想放宽样本量做对照，可显式加 --version dominant / --allow-incomplete。

数据目录自动探测（按优先级）：
  --data-dir 参数 > 环境变量 STEXPLORER_STOCK_DB > 应用「自定义存储目录」配置
  > 应用默认位置（~/Library/Application Support/<app>/storage/stock_db）
  > 工作区 ./data/stock_db 等常见位置
  多个候选时选数据量最大的；一个都找不到会打印全部探测路径。
  用 --list-data-dirs 可直接查看探测结果。

示例：
  python3 scripts/backtest_short_score_jump.py --list-data-dirs     # 先确认数据目录
  python3 scripts/backtest_short_score_jump.py --sample 300         # 300 只抽样基准参数
  python3 scripts/backtest_short_score_jump.py --code 600721        # 单股逐决策明细
  python3 scripts/backtest_short_score_jump.py --sample 300 --sweep # 参数扫描（较慢）
"""

from __future__ import annotations

import argparse
import bisect
import glob
import json
import math
import os
import random
import sqlite3
import ssl
import statistics
import sys
import time
import unicodedata
import urllib.request
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Sequence, Tuple

TRADING_DAYS_PER_YEAR = 252

# 与应用保持一致：shortTermScoreList.ts 的 SCORE_ROW_VERSION（旧版本缓存行会被应用视为失效并重算）
SCORE_ROW_VERSION = 13

# 参与总分归一化的六个维度（对应 composeShortTermScore 的 dims）。
# 应用里维度 available=false 时 row 上存 null，且**不参与**归一化——剩余维度按剩余权重放大，
# 总分因此虚高（资金项通常偏低分，缺它反而加分）。详情页「现算」这些维度大多能取到，
# 所以回测要拿到与详情页一致的口径，就必须丢掉缺维度的行。
SCORE_DIMS = ("marketScore", "sectorScore", "stockScore", "volumeScore", "rsiScore", "moneyScore")

# ---------------------------------------------------------------- 数据目录


def _is_stock_db(path: str) -> bool:
    return bool(path) and os.path.exists(os.path.join(path, "meta.db"))


def _custom_storage_dirs(config_file: str) -> List[str]:
    """读取应用的「自定义存储目录」配置（local_storage_path.json），返回其中的 stock_db 路径"""
    out: List[str] = []
    try:
        with open(config_file, "r", encoding="utf-8") as fp:
            cfg = json.load(fp)
        custom = str(cfg.get("path") or "")
        if custom:
            out.append(os.path.join(custom, "stock_db"))
    except Exception:
        pass
    return out


def candidate_data_dirs() -> List[str]:
    """收集所有可能的 stock_db 目录（配置 > 应用默认位置 > 仓库 data 目录）"""
    home = os.path.expanduser("~")
    cands: List[str] = []

    supports = [
        os.path.join(home, "Library", "Application Support"),  # macOS
        os.path.join(home, "AppData", "Roaming"),              # Windows
        os.path.join(home, ".config"),                         # Linux
    ]
    for sup in supports:
        for name in ("STExplorer", "stexplorer", "STexplorer"):
            base = os.path.join(sup, name)
            cands.extend(_custom_storage_dirs(os.path.join(base, "local_storage_path.json")))
            cands.append(os.path.join(base, "storage", "stock_db"))
        # 兜底：该目录下任意应用的配置（app 名可能被改过）
        for cfg in glob.glob(os.path.join(sup, "*", "local_storage_path.json")):
            cands.extend(_custom_storage_dirs(cfg))

    cands.append(os.path.join(home, ".stexplorer", "stock_db"))

    # 开发环境：仓库/工作区里的 data 目录
    here = os.path.dirname(os.path.abspath(__file__))
    roots = [os.getcwd(), os.path.dirname(here), os.path.dirname(os.path.dirname(here))]
    for root in roots:
        root = os.path.abspath(os.path.normpath(root))
        for pattern in ("data/stock_db", "data/*/stock_db", "data/*/*/stock_db"):
            cands.extend(glob.glob(os.path.join(root, pattern)))

    seen, out = set(), []
    for c in cands:
        c = os.path.abspath(os.path.expanduser(c))
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def _db_size(path: str) -> Tuple[int, int]:
    def size(name: str) -> int:
        p = os.path.join(path, name)
        return os.path.getsize(p) if os.path.exists(p) else -1

    return size("meta.db"), size("daily.db")


def find_data_dir(explicit: Optional[str] = None) -> str:
    """定位 stock_db 目录（含 meta.db / daily.db）

    优先级：--data-dir > STEXPLORER_STOCK_DB > 应用自定义存储目录 > 应用默认位置 > 仓库 data 目录。
    多个候选时选数据量最大的那个；一个都找不到时打印全部探测路径，避免只报一句「找不到」。
    """
    def check(raw: str) -> Optional[str]:
        p = os.path.abspath(os.path.expanduser(raw))
        for cand in (p, os.path.join(p, "stock_db"), os.path.join(p, "data", "stock_db")):
            if _is_stock_db(cand):
                return cand
        return None

    for src, raw in (("--data-dir", explicit), ("STEXPLORER_STOCK_DB", os.environ.get("STEXPLORER_STOCK_DB"))):
        if raw:
            hit = check(raw)
            if hit:
                return hit
            raise SystemExit(f"{src} 指向的目录里没有 meta.db: {os.path.abspath(os.path.expanduser(raw))}")

    cands = candidate_data_dirs()
    valid = [(c, _db_size(c)) for c in cands if _is_stock_db(c)]
    if valid:
        valid.sort(key=lambda x: (x[1][0], x[1][1]), reverse=True)
        if len(valid) > 1:
            print("检测到多个 stock_db（默认用数据量最大的，可用 --data-dir 指定）：")
            for c, _ in valid:
                print(f"  {'*' if c == valid[0][0] else ' '} {c}")
        return valid[0][0]

    print("找不到 stock_db 目录（需要包含 meta.db / daily.db）。已探测：")
    for c in cands:
        print(f"  - {c}")
    raise SystemExit(
        "请用 --data-dir 指定应用数据目录（如 --data-dir ~/Documents/GitHub/stexplorer/data/stock_db），"
        "或设置环境变量 STEXPLORER_STOCK_DB"
    )


# ---------------------------------------------------------------- 东财板块

# 板块成分股缓存目录（成分股每天变，缓存 1 天；--refresh-board 可强制更新）
BOARD_CACHE_DIR = os.path.expanduser(os.path.join("~", ".stexplorer", "board_cache"))


def _ssl_context():
    """优先用 certifi 的证书；系统缺 CA（如自编译 python）时退化为不校验

    本机 Python 3.14 未安装证书链时 urlopen 会直接 CERTIFICATE_VERIFY_FAILED，
    表现为「联网取板块就失败」，这里兜底，避免因为取个板块列表就跑不下去。
    """
    try:
        import certifi  # type: ignore

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl._create_unverified_context()


def _http_json(url: str) -> dict:
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/"}
    )
    with urllib.request.urlopen(req, timeout=20, context=_ssl_context()) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _em_list(fs: str, fields: str = "f12,f14") -> List[dict]:
    """拉东财 clist 全量列表（fs 里的空格要换成 +，否则服务端会当成无条件全量）"""
    out: List[dict] = []
    pn = 1
    while pn <= 20:
        url = (
            "https://push2.eastmoney.com/api/qt/clist/get?pn=%d&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3"
            "&fs=%s&fields=%s" % (pn, fs.replace(" ", "+"), fields)
        )
        data = _http_json(url).get("data") or {}
        diff = data.get("diff") or []
        out.extend(diff)
        total = int(data.get("total") or 0)
        if not diff or len(out) >= total:
            break
        pn += 1
    return out


def _board_index(refresh: bool = False) -> Dict[str, str]:
    """东财板块索引（名称 <-> 代码），概念 + 行业"""
    os.makedirs(BOARD_CACHE_DIR, exist_ok=True)
    cache_file = os.path.join(BOARD_CACHE_DIR, "boards.json")
    if not refresh and os.path.exists(cache_file) and time.time() - os.path.getmtime(cache_file) < 7 * 86400:
        try:
            with open(cache_file, "r", encoding="utf-8") as fp:
                return json.load(fp)
        except Exception:
            pass
    items = _em_list("m:90 t:3 f:!50") + _em_list("m:90 t:2 f:!50")
    boards = {str(x.get("f12")): str(x.get("f14")) for x in items if x.get("f12")}
    if boards:
        with open(cache_file, "w", encoding="utf-8") as fp:
            json.dump(boards, fp, ensure_ascii=False)
    return boards


def resolve_board(name_or_code: str, refresh: bool = False) -> Tuple[str, str]:
    """板块名/代码 -> (code, name)；支持精确名与唯一子串匹配"""
    key = str(name_or_code or "").strip()
    boards = _board_index(refresh)
    if key.upper().startswith("BK"):
        code = key.upper()
        return code, boards.get(code, key)
    for code, name in boards.items():
        if name == key:
            return code, name
    cands = [(c, n) for c, n in boards.items() if key and key in n]
    if len(cands) == 1:
        return cands[0]
    hint = "相近的板块：" + "、".join(n for _, n in cands[:8]) if cands else "可用 --list-boards 查看全部板块"
    raise SystemExit(f"找不到板块「{key}」。{hint}")


def fetch_board_members(board_code: str, refresh: bool = False) -> List[Tuple[str, str]]:
    """板块成分股 [(code, name)]，缓存 1 天"""
    os.makedirs(BOARD_CACHE_DIR, exist_ok=True)
    cache_file = os.path.join(BOARD_CACHE_DIR, f"{board_code}.json")
    if not refresh and os.path.exists(cache_file) and time.time() - os.path.getmtime(cache_file) < 86400:
        try:
            with open(cache_file, "r", encoding="utf-8") as fp:
                rows = json.load(fp)
            return [(r["code"], r["name"]) for r in rows]
        except Exception:
            pass
    items = _em_list(f"b:{board_code} f:!50")
    members = [
        {"code": str(x.get("f12")), "name": str(x.get("f14"))}
        for x in items
        if str(x.get("f12", "")).isdigit()
    ]
    if members:
        with open(cache_file, "w", encoding="utf-8") as fp:
            json.dump(members, fp, ensure_ascii=False)
    return [(m["code"], m["name"]) for m in members]


_WIDE_CHARS = ("F", "W")


def _disp_width(text: str) -> int:
    """终端显示宽度：中日韩全角字符占 2 格"""
    return sum(2 if unicodedata.east_asian_width(ch) in _WIDE_CHARS else 1 for ch in str(text))


def render_table(headers: Sequence[str], rows: Sequence[Sequence], aligns: str = "") -> str:
    """按终端显示宽度对齐的纯文本表格

    f-string 的宽度按「字符数」计算，中文占两格会导致表头/数据整体错位、
    数字和日期粘连（如 `12.902026-10-13`），所以统一用显示宽度补齐。
    aligns：每列一个字符，l/r/c（默认全部左对齐）
    """
    cols = len(headers)
    aligns = (aligns + "l" * cols)[:cols]
    cells = [[str(x) for x in row] for row in rows]
    widths = []
    for i in range(cols):
        widths.append(max([_disp_width(headers[i])] + [_disp_width(row[i]) for row in cells]))

    def fmt(text: str, i: int) -> str:
        pad = widths[i] - _disp_width(text)
        if aligns[i] == "r":
            return " " * pad + text
        if aligns[i] == "c":
            return " " * (pad // 2) + text + " " * (pad - pad // 2)
        return text + " " * pad

    lines = ["  ".join(fmt(headers[i], i) for i in range(cols))]
    lines.append("  ".join("-" * widths[i] for i in range(cols)))
    for row in cells:
        lines.append("  ".join(fmt(row[i], i) for i in range(cols)))
    return "\n".join(lines)


def progress(done: int, total: int, label: str = "") -> None:
    """参数扫描进度（只在终端下输出，避免污染管道/重定向结果）"""
    if not sys.stderr.isatty():
        return
    pct = int(done / total * 100) if total else 100
    sys.stderr.write(f"\r  计算中 {done}/{total} ({pct}%) {label:<28}")
    sys.stderr.flush()
    if done >= total:
        sys.stderr.write("\n")


def connect(path: str) -> sqlite3.Connection:
    if not os.path.exists(path):
        raise SystemExit(f"数据库不存在: {path}")
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


# 日K复权方式：优先前复权（与应用图表同口径），缓存里没有 qfq 时自动回退
ADJUST = "qfq"


def detect_adjust(daily: sqlite3.Connection) -> Tuple[str, List[Tuple[str, int]]]:
    """探测 daily_kline 里实际存在的复权方式

    不同版本/不同数据源写库时 adjust 可能是 qfq / hfq / 空串，
    写死 qfq 会在某些库上「一只股票都取不到日K」，表现为「样本无可用日K数据」。
    """
    try:
        rows = daily.execute(
            "SELECT COALESCE(adjust,'') AS a, COUNT(*) AS c FROM daily_kline "
            "WHERE kind='stock' AND period='daily' GROUP BY a ORDER BY c DESC"
        ).fetchall()
    except sqlite3.Error:
        return "qfq", []
    values = [(str(r[0]), int(r[1])) for r in rows]
    for prefer in ("qfq", "hfq", ""):
        if any(v == prefer for v, _ in values):
            return prefer, values
    return (values[0][0] if values else "qfq"), values


def to_ts_code(code: str) -> str:
    """6 位代码 -> 带交易所后缀的 ts_code"""
    if code.startswith("6"):
        return f"{code}.SH"
    if code.startswith(("0", "3")):
        return f"{code}.SZ"
    if code.startswith(("4", "8")):
        return f"{code}.BJ"
    return f"{code}.SH"


def fmt_date(key: str) -> str:
    """YYYYMMDD -> YYYY-MM-DD"""
    return f"{key[:4]}-{key[4:6]}-{key[6:8]}"


# ---------------------------------------------------------------- 载入评分序列


class Series:
    __slots__ = ("code", "name", "dates", "scores")

    def __init__(self, code: str, name: str, dates: List[str], scores: List[float]):
        self.code = code
        self.name = name
        self.dates = dates  # YYYY-MM-DD 升序
        self.scores = scores


def load_scores(
    meta: sqlite3.Connection, min_days: int, version_policy: str = "current",
    complete_only: bool = True,
) -> Tuple[Dict[str, Series], Dict[str, Dict[str, int]]]:
    """读取全部评分序列，只保留「有效天数足够」的股票

    version_policy：缓存里同一条序列混着多个**评分行结构版本**（v9/v10/v11/v13）。
    应用自身只认当前版本（SCORE_ROW_VERSION=13），旧版本行会被当作未命中而重算
    （见 shortTermScoreList.ts「只认当前结构版本的缓存行」），所以：
      - current ：只留**当前版本** v13 的行（默认，与详情页曲线/现算口径一致）
      - dominant：留行数最多的版本（样本量最大，但很可能不是当前公式，仅作参考）
      - latest  ：留该股最新版本的行
      - any     ：不区分版本（仅用于对照，结论不可信）

    complete_only：只留六个维度都齐全的行（默认开启，--allow-incomplete 关闭）。总分按
    「剩余权重归一化」计算，缺维度（尤其 moneyScore/sectorScore）会把总分抬高，与详情页
    现算口径不一致，还会凭空造出买入信号。

    返回 (序列, 版本体检统计)；统计不受 version_policy 影响，用来判断这批缓存到底是哪个版本算的。
    """
    out: Dict[str, Series] = {}
    stats: Dict[str, Dict[str, int]] = {"rows": {}, "stocks": {}, "maxdays": {}}
    rows = meta.execute(
        "SELECT cache_key, payload FROM api_cache WHERE cache_key LIKE 'short_term_score_series_%'"
    )
    for key, payload in rows:
        try:
            data = json.loads(payload)
        except Exception:
            continue
        code = str(data.get("code") or key.rsplit("_", 2)[-2])
        name = ""
        day_rows = data.get("rows") or {}
        by_version: Dict[object, List[Tuple[str, float]]] = {}
        for d in sorted(day_rows):
            row = day_rows[d]
            if not isinstance(row, dict):
                continue
            total = row.get("total")
            if not isinstance(total, (int, float)):
                continue
            if total <= 0:  # 未上市 / 数据不足的占位行不参与
                continue
            # 维度缺失行不计入：总分按「剩余权重归一化」计算，缺维度会抬高总分
            # （资金项通常偏低分），与详情页现算口径不一致，还会凭空造出买入信号
            if complete_only and any(row.get(f) is None for f in SCORE_DIMS):
                continue
            name = name or str(row.get("name") or "")
            by_version.setdefault(row.get("v"), []).append((fmt_date(d), float(total)))
        if not by_version:
            continue
        # 版本体检（所有版本都统计，与 version_policy 无关）
        for v, v_items in by_version.items():
            vk = str(v)
            stats["rows"][vk] = stats["rows"].get(vk, 0) + len(v_items)
            stats["stocks"][vk] = stats["stocks"].get(vk, 0) + 1
            stats["maxdays"][vk] = max(stats["maxdays"].get(vk, 0), len(v_items))
        if version_policy == "any":
            items = sorted([it for v_items in by_version.values() for it in v_items])
        else:
            if version_policy == "current":
                ver = SCORE_ROW_VERSION
            elif version_policy == "latest":
                ver = max(by_version, key=lambda v: (v is not None, v if v is not None else -1))
            else:  # dominant
                ver = max(by_version, key=lambda v: (len(by_version[v]), v is not None, v or -1))
            if ver not in by_version:  # current：该股没有当前版本的行
                continue
            items = sorted(by_version[ver])
        if len(items) < min_days:
            continue
        out[code] = Series(code, name, [i[0] for i in items], [i[1] for i in items])
    return out, stats


def load_export_series(path: str) -> Series:
    """读取详情页「回测面板 → 导出JSON」，用其中的逐日现算评分构造单只股票序列

    导出文件由 renderer/helpers/shortTermScoreBacktest.ts 生成，`scores` 来自
    computeShortTermScoreCurve（现取数逐日重算，**不读评分缓存**），因此这份序列
    与个股详情页走势完全同口径——缓存行的旧口径差异不会再影响回测。
    """
    try:
        with open(path, "r", encoding="utf-8") as fp:
            data = json.load(fp)
    except Exception as exc:
        raise SystemExit(f"读取导出 JSON 失败: {path}（{exc}）")
    code = str(data.get("code") or "").strip()
    name = str(data.get("name") or "")
    raw = data.get("scores") or {}
    items: List[Tuple[str, float]] = []
    for key, val in raw.items():
        if not isinstance(val, (int, float)):
            continue
        k = str(key).replace("-", "")
        if len(k) != 8 or not k.isdigit():
            continue
        items.append((f"{k[:4]}-{k[4:6]}-{k[6:]}", float(val)))
    items.sort()
    if not code or not items:
        raise SystemExit(f"导出 JSON 里没有可用的评分序列: {path}")
    return Series(code, name, [i[0] for i in items], [i[1] for i in items])


def pick_sample(series: Dict[str, Series], n: int, seed: int) -> List[str]:
    """按板块（沪主板/深主板/创业板/科创板/北交所）分层抽样，保证样本结构均衡"""
    buckets: Dict[str, List[str]] = {"SH": [], "SZ": [], "CY": [], "KC": [], "BJ": []}
    for code in series:
        if code.startswith("68"):
            buckets["KC"].append(code)
        elif code.startswith("30"):
            buckets["CY"].append(code)
        elif code.startswith("6"):
            buckets["SH"].append(code)
        elif code.startswith(("4", "8")):
            buckets["BJ"].append(code)
        else:
            buckets["SZ"].append(code)
    total = sum(len(v) for v in buckets.values())
    if total <= n:
        return sorted(series)
    rnd = random.Random(seed)
    picked: List[str] = []
    for codes in buckets.values():
        rnd.shuffle(codes)
        quota = max(1, round(n * len(codes) / total)) if codes else 0
        picked.extend(codes[:quota])
    # 配额取整可能多/少几只，用剩余池补齐或截断
    rest = [c for c in series if c not in set(picked)]
    rnd.shuffle(rest)
    while len(picked) < n and rest:
        picked.append(rest.pop())
    return sorted(picked[:n])


# ---------------------------------------------------------------- 载入日K


class Bars:
    __slots__ = ("dates", "opens", "closes", "highs", "zdf", "circ_mv", "ma20", "ma60", "vols")

    def __init__(self, dates, opens, closes, highs, zdf, circ_mv, vols=None):
        self.dates = dates
        self.opens = opens
        self.closes = closes
        self.highs = highs
        self.zdf = zdf            # 当日涨跌幅（%）
        self.circ_mv = circ_mv    # 推算流通市值（元）：成交额 /(换手率/100)
        self.vols = vols or [0.0] * len(dates)  # 成交量（手），用于「启动日放量」确认
        # MA20（前复权收盘），用于「只在均线上方做多」的趋势过滤
        ma: List[Optional[float]] = []
        run = 0.0
        for i, c in enumerate(closes):
            run += c
            if i >= 20:
                run -= closes[i - 20]
            ma.append(run / 20 if i >= 19 else None)
        self.ma20 = ma
        # MA60（前复权收盘）：判断个股是「长期下行（主要运行在 60 日线下方）」还是
        # 「震荡/上行（主要在 60 日线上方）」，用于分组验证策略在两种环境下的表现
        ma60: List[Optional[float]] = []
        run60 = 0.0
        for i, c in enumerate(closes):
            run60 += c
            if i >= 60:
                run60 -= closes[i - 60]
            ma60.append(run60 / 60 if i >= 59 else None)
        self.ma60 = ma60

    def index_of(self, date: str) -> int:
        i = bisect.bisect_left(self.dates, date)
        return i if i < len(self.dates) and self.dates[i] == date else -1

    def next_index(self, date: str) -> int:
        """严格晚于 date 的第一个交易日下标（不存在返回 -1）"""
        i = bisect.bisect_right(self.dates, date)
        return i if i < len(self.dates) else -1

    def mv_at(self, idx: int) -> Optional[float]:
        """流通市值：当天缺失（换手率为 0，多为停牌）时回退到最近一个有效值"""
        for j in range(idx, max(-1, idx - 10), -1):
            v = self.circ_mv[j]
            if v:
                return v
        return None


def ma60_below_ratio(bars: Bars, idx: int, window: int = 20) -> Optional[float]:
    """信号日起前 window 个交易日里，收盘价低于 MA60 的占比（0~1）

    >=0.7 → 主要运行在 60 日线下方（长期下行）；<=0.3 → 主要在上方（震荡/上行）。
    用于验证「下行环境里这套策略是否更差」。
    """
    if idx < 0:
        return None
    start = max(0, idx - window + 1)
    below = 0
    total = 0
    for j in range(start, idx + 1):
        ma = bars.ma60[j]
        if ma is None:
            continue
        total += 1
        if bars.closes[j] < ma:
            below += 1
    if total < 10:
        return None
    return below / total


def limit_pct(code: str) -> float:
    """涨跌停幅度：创业板 20%，主板 10%（ST 已在选股阶段排除）"""
    return 0.20 if code.startswith("30") else 0.10


def is_limit_up(bars: Bars, idx: int, code: str, tol: float = 0.3) -> bool:
    """收盘涨停：涨幅接近涨停幅度，且收盘价 == 最高价（封住）"""
    if idx < 0 or not bars.zdf[idx]:
        return False
    pct = limit_pct(code) * 100
    return bars.zdf[idx] >= pct - tol and bars.closes[idx] >= bars.highs[idx] - 0.011


def load_bars(daily: sqlite3.Connection, code: str, start: str, end: str) -> Optional[Bars]:
    rows = daily.execute(
        "SELECT trade_date, kp, sp, zg, zdf, cje, hsl, cjl FROM daily_kline "
        "WHERE kind='stock' AND ts_code=? AND period='daily' AND COALESCE(adjust,'')=? "
        "AND trade_date BETWEEN ? AND ? ORDER BY trade_date",
        (to_ts_code(code), ADJUST, start, end),
    ).fetchall()
    dates, opens, closes, highs, zdfs, mvs, vols = [], [], [], [], [], [], []
    for d, kp, sp, zg, zdf, cje, hsl, cjl in rows:
        if kp is None or sp is None:
            continue
        dates.append(str(d))
        opens.append(float(kp))
        closes.append(float(sp))
        highs.append(float(zg) if zg is not None else float(sp))
        zdfs.append(float(zdf) if zdf is not None else None)
        # 流通市值反推：换手率 = 成交量 / 流通股本，成交额 ≈ 成交量 × 均价
        mvs.append((float(cje) / (float(hsl) / 100.0)) if cje and hsl else None)
        vols.append(float(cjl) if cjl is not None else 0.0)
    if len(dates) < 30:
        return None
    return Bars(dates, opens, closes, highs, zdfs, mvs, vols)


# ---------------------------------------------------------------- 回测引擎


class LowBase:
    """「低位运行后的突变」前置条件

    只看单日突变会把「高位跌下来之后的第一次反抽」也算成买点（评分从 60 两天跌到 25，
    第三天反弹 +20 触发阈值，但整段其实是下降趋势）。所以要求突变之前评分已经在低位
    横了一段时间：前 days 个评分日（不含突变日）全部 <= max_score。

    days=0 关闭该过滤（回到「只看单日突变」的老口径，便于对照）。
    """

    __slots__ = ("days", "max_score")

    def __init__(self, days: int = 0, max_score: float = 40.0):
        self.days = max(0, int(days))
        self.max_score = float(max_score)

    def blocked_reason(self, scores: Sequence[float], i: int) -> str:
        """突变日 i 之前不满足「低位运行」时返回原因，满足返回空串"""
        if self.days <= 0:
            return ""
        start = i - self.days
        if start < 0:
            return f"评分历史不足 {self.days} 日，无法确认低位运行"
        high = max(scores[start:i])
        if high > self.max_score:
            return (
                f"近{self.days}日最高 {high:.1f} > 低位上限 {self.max_score:g}"
                "（高位跌落后的反抽，不算低位启动）"
            )
        return ""


class Trade:
    __slots__ = (
        "code", "name", "signal_in", "entry_date", "entry_price",
        "signal_out", "exit_date", "exit_price", "exit_reason", "bars", "ret",
        # 信号日前 20 个交易日里，收盘价在 MA60 下方的占比（0~1，None=数据不足）
        # 用来验证「长期下行（主要运行在 60 日线下方）表现更差」的假设
        "ma60_below",
    )

    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


def run_stock(
    s: Series,
    bars: Bars,
    buy_delta: float,
    sell_delta: float,
    min_score: float,
    fee: float,
    stop_loss: float = 0.0,
    max_hold: int = 0,
    exec_lag: int = 1,
    buy_mode: str = "jump",
    trend_filter: bool = False,
    require_limit_up: bool = False,
    min_mv: float = 0.0,
    trace: Optional[List[dict]] = None,
    trace_min_delta: float = 5.0,
    *,
    low_base: Optional[LowBase] = None,
    jump_window: int = 1,
    min_rise: float = 0.0,
    trail_drop: float = 0.0,
    rise_ref_days: int = 10,
    rise_min_score: float = 45.0,
    rise_min_delta: float = 0.0,
    rise_vol_ratio: float = 0.0,
) -> Tuple[List[Trade], Dict[str, float], int]:
    """单只股票回测。

    exec_lag=1：信号日次日开盘成交（默认，贴近真实可执行性）
    exec_lag=0：信号日收盘成交（乐观口径，用于对照）

    jump_window：跳升按「几个评分日累计」算（1=只看单日）。低位启动常常分两天完成
    （+8 然后 +17，单日都不到 20），窗口 >1 才能识别这类信号。
    min_rise：评分下限的「相对口径」——score >= 窗口内最低分 + min_rise 也算达标，
    与绝对下限 --min-score 是「或」的关系。低位启动当天很难直接到 60 分，绝对下限
    会把这类信号全部挡掉。

    trace 不为 None 时，把每个「跳变显著或发生交易」的决策点写入该列表，
    用于单只股票的人工核对（--code）。

    返回 (已平仓交易列表, {交易日: 当日槽位收益率}, 持有交易日数)
    """
    trades: List[Trade] = []
    daily: Dict[str, float] = {}
    pos = None
    held_bars = 0

    def exec_price_and_date(signal_date: str) -> Optional[Tuple[str, float, int]]:
        if exec_lag == 0:
            i = bars.index_of(signal_date)
            if i < 0:
                return None
            return bars.dates[i], bars.closes[i], i
        i = bars.next_index(signal_date) if exec_lag == 1 else bars.index_of(signal_date) + exec_lag
        if i < 0 or i >= len(bars.dates):
            return None
        return bars.dates[i], bars.opens[i], i

    # ---- 逐评分日扫描信号 ----
    for i in range(1, len(s.dates)):
        d = s.dates[i]
        score = s.scores[i]
        bi = bars.index_of(d)
        prev_bi = bars.index_of(s.dates[i - 1])
        # 「单日突变」必须是相邻交易日：缓存里因换主版本/停牌留下的缺口不算一次跳变，
        # 否则会凭空造出几十点的"突变"信号。
        delta = score - s.scores[i - 1] if (bi >= 0 and prev_bi >= 0 and bi - prev_bi == 1) else None
        # 多日累计跳升：低位启动常分两天完成（+8 再 +17，单日都不到 20）。
        # 窗口内每一步同样必须是相邻交易日，否则跨缺口的「累计涨幅」是假信号。
        jump = None
        if jump_window > 1 and delta is not None:
            start = i - jump_window
            if start >= 0:
                contiguous = True
                for j in range(start, i):
                    bj = bars.index_of(s.dates[j])
                    bn = bars.index_of(s.dates[j + 1])
                    if bj < 0 or bn < 0 or bn - bj != 1:
                        contiguous = False
                        break
                if contiguous:
                    jump = score - s.scores[start]

        rec = None
        notable = abs(delta) >= trace_min_delta if delta is not None else False
        # 累计跳升达标的日子也要列出（单日 Δ 可能很小，比如 +8 再 +17）
        if jump is not None and abs(jump) >= trace_min_delta:
            notable = True
        if trace is not None and delta is not None and notable:
            rec = {
                "date": d,
                "score": score,
                "delta": delta,
                "jump": jump,
                "limit_up": is_limit_up(bars, bi, s.code),
                "zdf": bars.zdf[bi] if bi >= 0 else None,
                "mv": bars.mv_at(bi) if bi >= 0 else None,
                "action": "",
                "note": "",
            }

        def mark(action: str, note: str = "") -> None:
            if rec is not None:
                rec["action"] = action
                rec["note"] = note
                trace.append(dict(rec))

        if pos is not None:
            held_bars += 1
            reason = None
            # 持仓期最高评分（含买入信号日）：评分从高位阴跌时，单日 Δ 往往很小，
            # 光靠「单日跳降 -15」会一路坐电梯，所以按「自最高点回撤」止盈。
            if score > pos["peak"]:
                pos["peak"] = score
            drop = pos["peak"] - score
            if delta is not None and delta <= sell_delta:
                reason = "绿柱卖出"
            elif trail_drop > 0 and drop >= trail_drop:
                reason = "回撤止盈"  # 具体回撤值写进明细，避免卖出原因表被数值打散
            else:
                close = bars.closes[bi] if bi >= 0 else None
                if stop_loss > 0 and close is not None and close / pos["price"] - 1 <= -stop_loss:
                    reason = "止损"
                elif max_hold > 0 and held_bars >= max_hold:
                    reason = "到期"
            if reason is None:
                if rec is not None and delta is not None and delta >= buy_delta:
                    mark("持有中", f"已有持仓（{pos['date']} 买入），忽略新的跳升")
                elif rec is not None:
                    mark("持有中", "")
                continue
            fill = exec_price_and_date(d)
            if fill is None:
                mark("持有中", "卖出信号但次日无K线可成交")
                continue
            exit_date, exit_price, exit_idx = fill
            ret = exit_price / pos["price"] - 1 - fee
            trades.append(
                Trade(
                    code=s.code, name=s.name, signal_in=pos["signal_date"],
                    entry_date=pos["date"], entry_price=pos["price"],
                    signal_out=d, exit_date=exit_date, exit_price=exit_price,
                    exit_reason=reason, bars=exit_idx - pos["idx"], ret=ret,
                    ma60_below=ma60_below_ratio(bars, bars.index_of(pos["signal_date"])),
                )
            )
            reason_txt = (
                f"{reason}（峰值 {pos['peak']:.1f}，回撤 {drop:.1f}）" if reason == "回撤止盈" else reason
            )
            mark("卖出", f"{reason_txt}，{exit_date} 开盘 {exit_price:.2f} 卖出，收益 {ret*100:+.2f}%")
            # 槽位逐日收益：买入日(收盘/买入价)、持有日(收盘/前收)、卖出日(卖价/前收)
            _accumulate_daily(daily, bars, pos["idx"], exit_idx, pos["price"], exit_price, fee)
            pos, held_bars = None, 0
            continue

        # 空仓：判断买入
        if delta is None:
            continue
        if buy_mode == "cross":
            ok = score >= min_score and s.scores[i - 1] < min_score
            fail = "未上穿评分下限"
        elif buy_mode == "rise":
            # 「低位抬升」模式：不看单日跳升幅度，只看「评分从近期低位抬到了多高」。
            # 低位启动往往分几天完成（22.9 → 31.2 → 47.8 → 52.3），单日都不到 20，
            # 但自低点已经抬升 29 分，这才是「启动」的本质。
            ref_start = max(i - rise_ref_days, 0)
            low_ref = min(s.scores[ref_start:i])
            rise_amt = score - low_ref
            fail = ""
            ok = True
            if delta is None:
                ok, fail = False, "评分序列有缺口，无法确认当日方向"
            elif delta < 0:
                ok, fail = False, f"当日回落 {delta:+.1f}（只认仍在抬升的日子）"
            elif rise_amt < min_rise:
                ok = False
                fail = f"自近{rise_ref_days}日低点 {low_ref:.1f} 抬升 {rise_amt:+.1f}（需 ≥{min_rise:g}）"
            elif score < rise_min_score:
                ok, fail = False, f"评分 {score:.1f} < 启动地板 {rise_min_score:g}"
            elif low_base is not None and low_ref > low_base.max_score:
                ok = False
                fail = f"近{rise_ref_days}日最低 {low_ref:.1f} > 低位上限 {low_base.max_score:g}（不算低位启动）"
            elif rise_min_delta > 0 and delta < rise_min_delta:
                ok, fail = False, f"当日仅 {delta:+.1f}（启动日需 ≥{rise_min_delta:g}）"
            # 放量确认：只看评分抬升会被下跌趋势里的日常波动打满信号，价格必须配合
            if ok and rise_vol_ratio > 0 and bi >= 5:
                base_vol = sum(bars.vols[bi - 5:bi]) / 5
                if base_vol > 0 and bars.vols[bi] < base_vol * rise_vol_ratio:
                    ok = False
                    fail = f"未放量（{bars.vols[bi] / base_vol:.2f} 倍 5 日均量，需 ≥{rise_vol_ratio:g}）"
        else:
            rise = jump if jump_window > 1 else delta
            # 相对下限的参照用独立的 --rise-ref-days 窗口（不是 jump_window）：
            # 参照只取前一日时，「自低点抬升 >= X」会退化成「单日 Δ >= X」，失去意义
            score_ref = min(s.scores[max(i - max(rise_ref_days, 1), 0):i])
            rel_ok = min_rise > 0 and score >= score_ref + min_rise
            ok = rise is not None and rise >= buy_delta and (score >= min_score or rel_ok)
            # 累计跳升还要求当日不回落：前两天暴涨、今天转跌的形态不能算「仍在启动」
            if jump_window > 1 and delta is not None and delta < 0:
                ok = False
            if rise is None:
                fail = f"近{jump_window}日有数据缺口，无法确认跳升"
            elif jump_window > 1 and delta is not None and delta < 0:
                fail = f"当日回落 {delta:+.1f}（近{jump_window}日累计 {rise:+.1f} 不作数）"
            elif rise < buy_delta:
                if rise <= sell_delta:
                    fail = f"跳降 {rise:+.1f}（空仓，无可卖出）"
                elif rise > 0:
                    fail = f"跳升不足（近{jump_window}日 {rise:+.1f} < +{buy_delta:g}）"
                else:
                    fail = f"小幅回落（{rise:+.1f}）"
            elif score < min_score and not rel_ok:
                if min_rise > 0:
                    fail = (
                        f"评分 {score:.1f} < 下限 {min_score:g}，自低点 {score_ref:.1f} "
                        f"仅抬升 {score - score_ref:+.1f}（需 ≥{min_rise:g}）"
                    )
                else:
                    fail = f"评分 {score:.1f} < 下限 {min_score:g}"
            else:
                fail = ""
        # rise 模式的低位判定已用「近 N 日最低分」表达，不再要求前 days 日连续低位
        if ok and low_base is not None and buy_mode == "jump":
            why = low_base.blocked_reason(s.scores, i)
            if why:
                ok, fail = False, why
        if ok and trend_filter and bi >= 0 and bars.ma20[bi] is not None:
            if bars.closes[bi] < bars.ma20[bi]:  # type: ignore[operator]
                ok, fail = False, f"收盘 {bars.closes[bi]:.2f} < MA20 {bars.ma20[bi]:.2f}"
        if ok and require_limit_up and not is_limit_up(bars, bi, s.code):
            ok, fail = False, f"未涨停（涨幅 {bars.zdf[bi] if bi >= 0 else 0:.2f}%）"
        if ok and min_mv > 0:
            mv = bars.mv_at(bi) if bi >= 0 else None
            if mv is None or mv < min_mv:
                ok = False
                fail = f"流通市值 {('--' if mv is None else f'{mv/1e8:.1f}亿')} < {min_mv/1e8:.0f}亿"
        if ok:
            fill = exec_price_and_date(d)
            if fill is None:
                mark("跳过", "次日无K线，无法成交")
                continue
            entry_date, entry_price, entry_idx = fill
            if entry_price <= 0:
                mark("跳过", "次日开盘价无效")
                continue
            # 次日开盘就一字涨停时买不进，跳过这笔（避免高估可执行性）
            if entry_idx > 0:
                prev_close = bars.closes[entry_idx - 1]
                limit = limit_pct(s.code)
                if prev_close > 0 and entry_price / prev_close - 1 >= limit - 0.003:
                    mark("跳过", f"次日 {entry_date} 一字涨停开盘 {entry_price:.2f}，买不进")
                    continue
            pos = {
                "signal_date": d, "date": entry_date, "price": entry_price, "idx": entry_idx,
                "peak": score,  # 持仓期最高评分从买入信号日的评分起算
            }
            held_bars = 0
            cum_txt = f"（近{jump_window}日 {jump:+.1f}）" if jump_window > 1 and jump is not None else ""
            mark("买入", f"{entry_date} 开盘 {entry_price:.2f} 买入{cum_txt}")
            continue
        if rec is not None:
            mark("观察", fail)

    # ---- 样本末端强制平仓（数据到头的持仓） ----
    if pos is not None:
        exit_idx = len(bars.dates) - 1
        exit_price = bars.closes[exit_idx]
        ret = exit_price / pos["price"] - 1 - fee
        trades.append(
            Trade(
                code=s.code, name=s.name, signal_in=pos["signal_date"],
                entry_date=pos["date"], entry_price=pos["price"],
                signal_out="", exit_date=bars.dates[exit_idx], exit_price=exit_price,
                exit_reason="未平仓", bars=exit_idx - pos["idx"], ret=ret,
                ma60_below=ma60_below_ratio(bars, bars.index_of(pos["signal_date"])),
            )
        )
        _accumulate_daily(daily, bars, pos["idx"], exit_idx, pos["price"], exit_price, fee)

    return trades, daily, len(s.dates)


def _accumulate_daily(
    daily: Dict[str, float], bars: Bars, entry_idx: int, exit_idx: int,
    entry_price: float, exit_price: float, fee: float,
) -> None:
    """把一次交易的逐日收益写入槽位序列（含买卖各半的手续费扣减）"""
    if exit_idx < entry_idx:
        return
    prev_close = entry_price
    for j in range(entry_idx, exit_idx + 1):
        if j == entry_idx:
            r = bars.closes[j] / entry_price - 1
        else:
            r = bars.closes[j] / prev_close - 1
        if j == exit_idx:
            r = exit_price / prev_close - 1
        prev_close = bars.closes[j]
        daily[bars.dates[j]] = daily.get(bars.dates[j], 0.0) + r
    # 手续费：买入/卖出各摊一半
    daily[bars.dates[entry_idx]] = daily.get(bars.dates[entry_idx], 0.0) - fee / 2
    daily[bars.dates[exit_idx]] = daily.get(bars.dates[exit_idx], 0.0) - fee / 2


# ---------------------------------------------------------------- 绩效统计


def summarize(trades: List[Trade], active_years: float) -> dict:
    closed = [t for t in trades if t.exit_reason != "未平仓"]
    rets = [t.ret for t in trades]
    wins = [r for r in rets if r > 0]
    losses = [r for r in rets if r <= 0]
    n = len(trades)
    win_rate = len(wins) / n if n else 0.0
    avg_win = statistics.fmean(wins) if wins else 0.0
    avg_loss = statistics.fmean(losses) if losses else 0.0
    payoff = (avg_win / abs(avg_loss)) if losses and avg_loss != 0 else float("inf") if wins else 0.0
    gross_win = sum(wins)
    gross_loss = abs(sum(losses))
    profit_factor = (gross_win / gross_loss) if gross_loss > 0 else float("inf") if gross_win > 0 else 0.0
    freq = (n / active_years) if active_years > 0 else 0.0
    # 按笔夏普：单笔收益的均值/标准差，按年交易频率折算成年化
    std_ret = statistics.pstdev(rets) if len(rets) > 1 else 0.0
    sharpe_trade = (statistics.fmean(rets) / std_ret * math.sqrt(freq)) if std_ret > 0 and freq > 0 else 0.0
    return {
        "trades": n,
        "closed": len(closed),
        "win_rate": win_rate,
        "avg_ret": statistics.fmean(rets) if rets else 0.0,
        "median_ret": statistics.median(rets) if rets else 0.0,
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "payoff": payoff,
        "profit_factor": profit_factor,
        "avg_bars": statistics.fmean([t.bars for t in trades]) if trades else 0.0,
        "median_bars": statistics.median([t.bars for t in trades]) if trades else 0.0,
        "trades_per_stock_year": freq,
        "sharpe_trade": sharpe_trade,
        "best": max(rets) if rets else 0.0,
        "worst": min(rets) if rets else 0.0,
    }


def ma60_groups(trades: List[Trade], years: float) -> List[Tuple[str, Optional[dict]]]:
    """按「信号日前 20 个交易日相对 MA60 的位置」分组

    验证假设：长期下行（主要运行在 60 日线下方）里这套策略是否明显更差。
    """
    defs = [
        ("长期下行（≥70% 日在 MA60 下方）", lambda r: r >= 0.7),
        ("震荡/混合（30%~70% 在下方）", lambda r: 0.3 < r < 0.7),
        ("上行/强势（≤30% 日在下方）", lambda r: r <= 0.3),
        ("数据不足（MA60 覆盖不够）", None),
    ]
    out: List[Tuple[str, Optional[dict]]] = []
    for label, pred in defs:
        if pred is None:
            sub = [t for t in trades if t.ma60_below is None]
        else:
            sub = [t for t in trades if t.ma60_below is not None and pred(t.ma60_below)]
        out.append((label, summarize(sub, years) if sub else None))
    return out


def _compound(rets: List[float]) -> float:
    eq = 1.0
    for r in rets:
        eq *= 1 + r
    return eq - 1


def portfolio_stats(daily_by_stock: List[Dict[str, float]], active_days: List[List[str]]) -> dict:
    """等权组合：每只股票各占 1/N 资金，空仓期收益按 0 计（现金）"""
    per_date: Dict[str, List[float]] = {}
    for daily, days in zip(daily_by_stock, active_days):
        for d in days:
            per_date.setdefault(d, []).append(daily.get(d, 0.0))
    if not per_date:
        return {"ann_ret": 0.0, "ann_vol": 0.0, "sharpe": 0.0, "max_dd": 0.0, "total": 0.0, "days": 0}
    dates = sorted(per_date)
    rets = [sum(per_date[d]) / len(per_date[d]) for d in dates]
    equity, peak, max_dd = 1.0, 1.0, 0.0
    for r in rets:
        equity *= 1 + r
        peak = max(peak, equity)
        max_dd = max(max_dd, 1 - equity / peak)
    mean_r = statistics.fmean(rets)
    std_r = statistics.pstdev(rets) if len(rets) > 1 else 0.0
    ann_ret = mean_r * TRADING_DAYS_PER_YEAR
    ann_vol = std_r * math.sqrt(TRADING_DAYS_PER_YEAR)
    return {
        "ann_ret": ann_ret,
        "ann_vol": ann_vol,
        "sharpe": (ann_ret / ann_vol) if ann_vol > 0 else 0.0,
        "max_dd": max_dd,
        "total": equity - 1,
        "days": len(dates),
    }




# ---------------------------------------------------------------- 主流程


def prepare(
    sample: List[str], series: Dict[str, Series], daily: sqlite3.Connection,
    # warmup 至少 60：MA60 趋势分组要求评分首日开始就算得出 60 日均线，
    # 否则样本早期会被归到「MA60 数据不足」，污染分组结论
    warmup: int = 70, exclude_boards: bool = False, exclude_st: bool = False,
    start_date: str = "", end_date: str = "",
):
    """载入样本日K；exclude_boards 排除北交所/科创板，exclude_st 排除 ST/*ST

    start_date / end_date 用于把回测窗口夹到指定区间（含端点）。
    注意评分序列本身会带着补全时多算的前置交易日，不夹的话回测会从更早的日子开始。
    """
    data = []
    skipped = 0
    dropped_board = 0
    dropped_st = 0
    for code in sample:
        s = series[code]
        if exclude_boards and code.startswith(("68", "8", "4", "9")):
            dropped_board += 1
            continue
        if exclude_st and "ST" in (s.name or "").upper():
            dropped_st += 1
            continue
        dates, scores = s.dates, s.scores
        if start_date or end_date:
            i0 = bisect.bisect_left(dates, start_date) if start_date else 0
            i1 = bisect.bisect_right(dates, end_date) if end_date else len(dates)
            if i1 - i0 < 2:
                skipped += 1
                continue
            dates, scores = dates[i0:i1], scores[i0:i1]
            s = Series(s.code, s.name, dates, scores)
        start = s.dates[0]
        i = daily.execute(
            "SELECT trade_date FROM daily_kline WHERE kind='stock' AND ts_code=? AND period='daily' "
            "AND COALESCE(adjust,'')=? AND trade_date < ? ORDER BY trade_date DESC LIMIT ?",
            (to_ts_code(code), ADJUST, start, warmup),
        ).fetchall()
        start_fetch = i[-1][0] if i else start
        bars = load_bars(daily, code, start_fetch, s.dates[-1])
        if bars is None:
            skipped += 1
            continue
        data.append((s, bars))
    if dropped_board or dropped_st:
        print(f"选股过滤：剔除北交所/科创板 {dropped_board} 只，剔除 ST/*ST {dropped_st} 只")
    return data, skipped


def evaluate(
    data, buy_delta: float, sell_delta: float, min_score: float,
    fee: float, stop_loss: float = 0.0, max_hold: int = 0, exec_lag: int = 1,
    buy_mode: str = "jump", trend_filter: bool = False,
    require_limit_up: bool = False, min_mv: float = 0.0,
    low_base: Optional[LowBase] = None,
    jump_window: int = 1, min_rise: float = 0.0, trail_drop: float = 0.0,
    rise_ref_days: int = 10, rise_min_score: float = 45.0,
    rise_min_delta: float = 0.0, rise_vol_ratio: float = 0.0,
) -> dict:
    all_trades: List[Trade] = []
    daily_by_stock, active_days = [], []
    years = 0.0
    for s, bars in data:
        trades, daily, ndays = run_stock(
            s, bars, buy_delta, sell_delta, min_score, fee, stop_loss, max_hold, exec_lag,
            buy_mode, trend_filter, require_limit_up, min_mv, low_base=low_base,
            jump_window=jump_window, min_rise=min_rise, trail_drop=trail_drop,
            rise_ref_days=rise_ref_days, rise_min_score=rise_min_score,
            rise_min_delta=rise_min_delta, rise_vol_ratio=rise_vol_ratio,
        )
        all_trades.extend(trades)
        daily_by_stock.append(daily)
        active_days.append(s.dates)
        years += ndays / TRADING_DAYS_PER_YEAR
    stats = summarize(all_trades, years)
    stats.update(portfolio_stats(daily_by_stock, active_days))
    stats["stocks"] = len(data)
    stats["years"] = years
    active_all = sum(len(d) for d in active_days)
    stats["exposure"] = (sum(t.bars for t in all_trades) / active_all) if active_all else 0.0
    stats["ma60_groups"] = ma60_groups(all_trades, years)
    return stats


def print_stats(title: str, st: dict) -> None:
    pf = st["profit_factor"]
    pf_txt = "∞" if pf == float("inf") else f"{pf:.2f}"
    payoff = st["payoff"]
    payoff_txt = "∞" if payoff == float("inf") else f"{payoff:.2f}"
    print(f"\n=== {title} ===")
    print(f"样本股票 {st['stocks']} 只 / 覆盖 {st['years']:.1f} 股票年 / 组合交易日 {st['days']}")
    print(
        f"交易次数 {st['trades']}（已平仓 {st['closed']}）  频率 {st['trades_per_stock_year']:.2f} 次/股票年"
        f"  持仓时间占比 {st['exposure']*100:.0f}%"
    )
    print(f"胜率 {st['win_rate']*100:.1f}%  期望收益 {st['avg_ret']*100:+.2f}%/笔  中位 {st['median_ret']*100:+.2f}%")
    print(f"平均盈利 {st['avg_win']*100:+.2f}%  平均亏损 {st['avg_loss']*100:+.2f}%  盈亏比 {payoff_txt}  盈利因子 {pf_txt}")
    print(
        f"平均持仓 {st['avg_bars']:.1f} 交易日（中位 {st['median_bars']:.0f}）  "
        f"单笔最好 {st['best']*100:+.1f}% / 最差 {st['worst']*100:+.1f}%"
    )
    print(f"按笔夏普（年化） {st['sharpe_trade']:.2f}")
    print(
        f"组合: 年化收益 {st['ann_ret']*100:+.1f}%  年化波动 {st['ann_vol']*100:.1f}%  "
        f"夏普 {st['sharpe']:.2f}  最大回撤 {st['max_dd']*100:.1f}%  累计 {st['total']*100:+.1f}%"
    )
    groups = st.get("ma60_groups") or []
    if groups:
        print("  趋势环境分组（信号日前 20 个交易日相对 MA60）：")
        for label, g in groups:
            if not g:
                print(f"    {label}: 0 笔")
                continue
            g_pf = g["profit_factor"]
            g_pf_txt = "∞" if g_pf == float("inf") else f"{g_pf:.2f}"
            g_po = g["payoff"]
            g_po_txt = "∞" if g_po == float("inf") else f"{g_po:.2f}"
            print(
                f"    {label}: {g['trades']:>4} 笔  胜率 {g['win_rate']*100:5.1f}%  "
                f"期望 {g['avg_ret']*100:+.2f}%/笔  盈亏比 {g_po_txt}  盈利因子 {g_pf_txt}"
            )


def benchmark_hold(data) -> dict:
    """等权买入持有基准：每只股票从评分首日收盘拿到末日收盘"""
    rets = []
    for s, bars in data:
        i0, i1 = bars.index_of(s.dates[0]), bars.index_of(s.dates[-1])
        if i0 < 0 or i1 <= i0:
            continue
        rets.append(bars.closes[i1] / bars.closes[i0] - 1)
    if not rets:
        return {"n": 0, "avg": 0.0, "median": 0.0, "win": 0.0}
    return {
        "n": len(rets),
        "avg": statistics.fmean(rets),
        "median": statistics.median(rets),
        "win": sum(1 for r in rets if r > 0) / len(rets),
    }


def monthly_table(trades: List[Trade]) -> None:
    """按买入月份拆分的表现（看策略在不同市场阶段的稳定性）"""
    groups: Dict[str, List[Trade]] = {}
    for t in trades:
        groups.setdefault(t.entry_date[:7], []).append(t)
    rows = []
    for m in sorted(groups):
        ts = groups[m]
        rets = [t.ret for t in ts]
        wr = sum(1 for r in rets if r > 0) / len(rets)
        rows.append([
            m,
            len(ts),
            f"{wr * 100:.1f}",
            f"{statistics.fmean(rets) * 100:+.2f}",
            f"{max(rets) * 100:+.1f}",
            f"{min(rets) * 100:+.1f}",
        ])
    print("\n" + render_table(["月份", "交易", "胜率%", "期望%", "最好%", "最差%"], rows, "lrrrrr"))


def stock_ranking(trades: List[Trade], min_trades: int = 1) -> List[dict]:
    """按股票聚合表现（累计用逐笔复利，与组合口径一致），按累计收益降序"""
    by: Dict[str, List[Trade]] = {}
    for t in trades:
        by.setdefault(t.code, []).append(t)
    rows = []
    for code, ts in by.items():
        if len(ts) < min_trades:
            continue
        rets = [t.ret for t in ts]
        cum = 1.0
        for r in rets:
            cum *= 1 + r
        rows.append({
            "code": code,
            "name": ts[0].name,
            "trades": len(ts),
            "win": sum(1 for r in rets if r > 0) / len(rets),
            "avg": statistics.fmean(rets),
            "cum": cum - 1,
            "best": max(rets),
            "worst": min(rets),
            "list": sorted(ts, key=lambda t: t.entry_date),
        })
    rows.sort(key=lambda r: r["cum"], reverse=True)
    return rows


def print_stock_detail(
    trades: List[Trade], top_n: int = 3, max_trades: int = 5, min_trades: int = 2
) -> None:
    """表现最好 / 最差的个股+逐笔明细（便于拿行情K线逐笔复核）"""
    rows = stock_ranking(trades, min_trades)
    if not rows:
        return
    side = min(top_n, len(rows))
    print(f"\n=== 个股表现（按区间累计收益排序：{len(rows)} 只有交易，每侧 {side} 只）===")
    for label, group in (("最好", rows[:top_n]), ("最差", list(reversed(rows[-top_n:])))):
        head = [
            [
                r["code"], r["name"], r["trades"], f"{r['win'] * 100:.0f}%",
                f"{r['avg'] * 100:+.2f}", f"{r['cum'] * 100:+.1f}",
                f"{r['best'] * 100:+.1f}", f"{r['worst'] * 100:+.1f}",
            ]
            for r in group
        ]
        print(f"\n--- {label} ---")
        print(
            render_table(
                ["代码", "名称", "笔数", "胜率", "期望/笔", "累计", "最好", "最差"],
                head, "llrrrrrr",
            )
        )
        for r in group:
            print(f"\n  {r['code']} {r['name']} 逐笔明细（显示前 {max_trades} 笔，共 {r['trades']} 笔）:")
            detail = [
                [
                    t.signal_in, t.entry_date, f"{t.entry_price:.2f}",
                    t.signal_out, t.exit_date, f"{t.exit_price:.2f}",
                    t.bars, f"{t.ret * 100:+.2f}", t.exit_reason,
                ]
                for t in r["list"][:max_trades]
            ]
            print(
                render_table(
                    ["入信号", "买入日", "买入价", "出信号", "卖出日", "卖出价", "持仓", "收益%", "原因"],
                    detail, "llrllrrrr",
                )
            )


def stock_year_ranking(trades: List[Trade], min_trades: int = 1) -> List[dict]:
    """按「股票 + 买入年份」聚合，按累计收益降序

    同一只股票跨年拆开看：样本区间跨年时，把各年混在一起会让「某一年赚得多」
    掩盖「其余年份都在亏」，也就看不出策略是否只在特定年份有效。
    """
    by: Dict[Tuple[str, str], List[Trade]] = {}
    for t in trades:
        by.setdefault((t.code, t.entry_date[:4]), []).append(t)
    rows = []
    for (code, year), ts in by.items():
        if len(ts) < min_trades:
            continue
        ts = sorted(ts, key=lambda t: t.entry_date)
        rets = [t.ret for t in ts]
        cum = 1.0
        for r in rets:
            cum *= 1 + r
        rows.append({
            "code": code,
            "name": ts[0].name,
            "year": year,
            "trades": len(ts),
            "win": sum(1 for r in rets if r > 0) / len(rets),
            "avg": statistics.fmean(rets),
            "cum": cum - 1,
            "best": max(rets),
            "worst": min(rets),
            "first": ts[0].entry_date,
            "last": ts[-1].entry_date,
        })
    rows.sort(key=lambda r: r["cum"], reverse=True)
    return rows


def print_stock_year_detail(
    trades: List[Trade], top_n: int = 5, min_trades: int = 2
) -> None:
    """表现最好 / 最差的「股票 × 年份」明细（每行=一只股票的一整年交易结果）"""
    rows = stock_year_ranking(trades, min_trades)
    if not rows:
        return
    side = min(top_n, len(rows))

    def fmt(items: List[dict]) -> List[List]:
        return [
            [
                r["code"], r["name"], r["year"], r["trades"], f"{r['win'] * 100:.0f}%",
                f"{r['avg'] * 100:+.2f}", f"{r['cum'] * 100:+.1f}",
                f"{r['best'] * 100:+.1f}", f"{r['worst'] * 100:+.1f}",
                f"{r['first'][5:]}~{r['last'][5:]}",
            ]
            for r in items
        ]

    headers = ["代码", "名称", "年份", "笔数", "胜率", "期望/笔", "累计", "最好", "最差", "首末笔"]
    aligns = "lllrrrrrrl"
    print(
        f"\n=== 股票×年份表现（{len(rows)} 个股票年有 ≥{min_trades} 笔交易，"
        f"按年内累计收益排序，每侧 {side} 个）==="
    )
    print(f"\n--- 最好 ---\n{render_table(headers, fmt(rows[:side]), aligns)}")
    print(f"\n--- 最差 ---\n{render_table(headers, fmt(list(reversed(rows[-side:]))), aligns)}")


def exit_reason_table(trades: List[Trade]) -> None:
    groups: Dict[str, List[Trade]] = {}
    for t in trades:
        groups.setdefault(t.exit_reason, []).append(t)
    print("\n卖出原因分布：", "  ".join(
        f"{k} {len(v)}笔/{statistics.fmean([x.ret for x in v])*100:+.2f}%"
        for k, v in sorted(groups.items(), key=lambda kv: -len(kv[1]))
    ))


def event_study(data, horizons=(1, 3, 5, 10, 20)) -> None:
    """事件研究：信号日之后的未来收益（次日开盘买入，持有 h 个交易日）

    同时给出「无条件（每个交易日都买）」的同一口径收益作为对照，
    以此判断红柱/绿柱本身是否含有预测力，而不是被行情整体涨跌带偏。
    """
    sig_buy: Dict[int, List[float]] = {h: [] for h in horizons}
    sig_buy_lu: Dict[int, List[float]] = {h: [] for h in horizons}
    sig_buy_nonlu: Dict[int, List[float]] = {h: [] for h in horizons}
    any_lu: Dict[int, List[float]] = {h: [] for h in horizons}
    sig_sell: Dict[int, List[float]] = {h: [] for h in horizons}
    base: Dict[int, List[float]] = {h: [] for h in horizons}
    buckets: Dict[str, Dict[int, List[float]]] = {}
    bk_edges = [(10, 15), (15, 20), (20, 25), (25, 30), (30, 999)]
    for lo, hi in bk_edges:
        buckets[f"{lo}~{hi if hi < 999 else '+'}"] = {h: [] for h in horizons}

    def fwd(bars: Bars, date: str, h: int) -> Optional[float]:
        i0 = bars.next_index(date)
        if i0 < 0 or i0 + h - 1 >= len(bars.dates):
            return None
        return bars.closes[i0 + h - 1] / bars.opens[i0] - 1

    for s, bars in data:
        for i in range(1, len(s.dates)):
            d = s.dates[i]
            bi, pb = bars.index_of(d), bars.index_of(s.dates[i - 1])
            if bi < 0 or pb < 0 or bi - pb != 1:
                continue
            delta = s.scores[i] - s.scores[i - 1]
            row = {h: fwd(bars, d, h) for h in horizons}
            for h in horizons:
                if row[h] is not None:
                    base[h].append(row[h])
            if delta >= 10:
                for lo, hi in bk_edges:
                    if lo <= delta < hi:
                        key = f"{lo}~{hi if hi < 999 else '+'}"
                        for h in horizons:
                            if row[h] is not None:
                                buckets[key][h].append(row[h])
                        break
            lu = is_limit_up(bars, bi, s.code)
            if lu:
                for h in horizons:
                    if row[h] is not None:
                        any_lu[h].append(row[h])
            if delta >= 20 and s.scores[i] >= 60:
                for h in horizons:
                    if row[h] is not None:
                        sig_buy[h].append(row[h])
                        (sig_buy_lu if lu else sig_buy_nonlu)[h].append(row[h])
            if delta <= -15:
                for h in horizons:
                    if row[h] is not None:
                        sig_sell[h].append(row[h])

    def line(name: str, groups: Dict[int, List[float]]) -> str:
        parts = []
        for h in horizons:
            v = groups[h]
            if not v:
                parts.append(f"{h}日: --")
                continue
            parts.append(f"{h}日: {statistics.fmean(v)*100:+5.2f}%(胜{sum(1 for x in v if x>0)/len(v)*100:.0f}%,n={len(v)})")
        return f"{name:<12} " + "  ".join(parts)

    print("\n=== 事件研究：信号后未来收益（次日开盘买入，持有 h 日收盘卖出，未扣成本）===")
    print(line("红柱≥20且≥60", sig_buy))
    print(line("  其中涨停日", sig_buy_lu))
    print(line("  其中非涨停", sig_buy_nonlu))
    print(line("任意涨停日", any_lu))
    print(line("绿柱≤-15", sig_sell))
    print(line("无条件(全样本)", base))
    print("\n按跳升幅度分组（未来收益）：")
    for key in buckets:
        print(line(f"  Δ {key}", buckets[key]))


def print_detail(data, args, mv_limit: float, lag: int) -> None:
    """单只股票：逐决策点明细（每个跳变日为什么买/为什么跳过）"""
    s, bars = data[0]
    trace: List[dict] = []
    trades, _, ndays = run_stock(
        s, bars, args.buy, args.sell, args.min_score, args.fee,
        args.stop_loss, args.max_hold, lag, args.buy_mode, args.trend_filter,
        args.require_limit_up, mv_limit, trace, args.trace_min,
        low_base=args.low_base, jump_window=args.jump_window, min_rise=args.min_rise,
        trail_drop=args.trail_drop, rise_ref_days=args.rise_ref_days,
        rise_min_score=args.rise_min_score, rise_min_delta=args.rise_min_delta,
        rise_vol_ratio=args.rise_vol_ratio,
    )
    print(
        f"\n=== {s.code} {s.name} 决策明细（评分区间 {s.dates[0]} ~ {s.dates[-1]}，"
        f"{len(s.dates)} 个评分日，|Δ|≥{args.trace_min:g} 的日子全部列出）==="
    )
    rows = []
    for r in trace:
        rows.append([
            r["date"],
            f"{r['score']:.1f}",
            f"{r['delta']:+.1f}",
            f"{r['zdf']:+.2f}" if r["zdf"] is not None else "--",
            "是" if r["limit_up"] else "否",
            f"{r['mv'] / 1e8:.0f}亿" if r["mv"] else "--",
            r["action"],
            r["note"],
        ])
    print(render_table(["日期", "评分", "Δ", "涨幅%", "涨停", "流通市值", "动作", "依据"], rows, "lrrrrlrl"))

    print(f"\n成交明细（{len(trades)} 笔）：")
    if trades:
        rows = [
            [
                t.entry_date,
                f"{t.entry_price:.2f}",
                t.exit_date,
                f"{t.exit_price:.2f}",
                t.bars,
                f"{t.ret * 100:+.2f}",
                t.exit_reason,
            ]
            for t in trades
        ]
        print(render_table(["买入日", "买入价", "卖出日", "卖出价", "持仓", "收益%", "卖出原因"], rows, "lrlrrrr"))
    else:
        print("  （没有满足条件的成交）")
    st = summarize(trades, ndays / TRADING_DAYS_PER_YEAR)
    payoff_txt = "∞" if st["payoff"] == float("inf") else f"{st['payoff']:.2f}"
    print(
        f"\n单股统计：交易 {st['trades']} 笔  胜率 {st['win_rate']*100:.1f}%  "
        f"期望 {st['avg_ret']*100:+.2f}%/笔  盈亏比 {payoff_txt}  "
        f"平均持仓 {st['avg_bars']:.1f} 日  累计（按笔顺序复利） {_compound([t.ret for t in trades])*100:+.1f}%"
    )


def main() -> None:
    global ADJUST
    try:
        # 管道/tee 下默认是块缓冲，参数扫描会「半天不出字」，强制按行刷新
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass

    ap = argparse.ArgumentParser(description="短线评分突变策略离线回测")
    ap.add_argument("--data-dir", help="stock_db 目录（含 meta.db / daily.db），可省略自动探测")
    ap.add_argument(
        "--series-json",
        help="详情页回测面板「导出JSON」的文件：用它的逐日现算评分回测（与详情页曲线同口径，不读缓存）",
    )
    ap.add_argument("--list-data-dirs", action="store_true", help="只打印检测到的 stock_db 目录后退出")
    ap.add_argument(
        "--sample", type=int, default=None,
        help="抽样股票数（默认 300；0=全部；指定 --board 时默认回测该板块全部成分股）",
    )
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument(
        "--stock-top", type=int, default=3,
        help="输出表现最好/最差的个股各 N 只（0=关闭；按区间累计收益排序）",
    )
    ap.add_argument("--stock-trades", type=int, default=5, help="每只股票最多列几笔交易明细")
    ap.add_argument("--stock-min-trades", type=int, default=2, help="只统计交易笔数 >= 该值的股票")
    ap.add_argument(
        "--stock-year-top", type=int, default=5,
        help="输出表现最好/最差的「股票×年份」各 N 个（0=关闭；按年内累计收益排序）",
    )
    ap.add_argument(
        "--stock-year-min-trades", type=int, default=2,
        help="股票年只统计年内交易笔数 >= 该值的（默认 2）",
    )
    ap.add_argument(
        "--board", action="append", default=[], metavar="名称|BK代码",
        help="只回测该板块成分股（可重复传，如 --board 小盘成长；支持 BK1667）",
    )
    ap.add_argument("--list-boards", action="store_true", help="列出可用的东财板块（联网，缓存 7 天）")
    ap.add_argument("--refresh-board", action="store_true", help="强制刷新板块列表与成分股缓存")
    ap.add_argument("--min-days", type=int, default=120, help="只取评分天数 >= 该值的股票（数据少时可调小）")
    ap.add_argument(
        "--min-last-date", default="auto",
        help="评分序列最后一天不早于该日期；auto=以数据里最新评分日往前推 170 天（默认）",
    )
    ap.add_argument("--start", default="", help="回测起始日 YYYY-MM-DD（含），默认不限（评分序列首日）")
    ap.add_argument("--end", default="", help="回测截止日 YYYY-MM-DD（含），默认不限（评分序列最后一天）")
    ap.add_argument(
        "--version", choices=["current", "dominant", "latest", "any"], default="current",
        help="评分行版本口径：current=只用当前版本 v%d（默认，与详情页一致）/ dominant（旧公式，仅参考）/ latest / any"
        % SCORE_ROW_VERSION,
    )
    ap.add_argument(
        "--complete-only", dest="complete_only", action="store_true", default=True,
        help="【默认】只取六个维度齐全的评分行（缺维度会按剩余权重归一化抬高总分，与详情页现算不一致）",
    )
    ap.add_argument(
        "--allow-incomplete", dest="complete_only", action="store_false",
        help="保留缺维度的评分行（仅用于对照；这些行总分虚高，会造出详情页没有的买入信号）",
    )
    ap.add_argument(
        "--buy", type=float, default=20.0,
        help="买入：评分跳升阈值（按 --jump-window 决定单日还是多日累计）",
    )
    ap.add_argument("--sell", type=float, default=-15.0, help="卖出：单日评分跳降阈值")
    ap.add_argument(
        "--trail-drop", type=float, default=10.0,
        help="持仓止盈：评分自持仓最高点回撤 >= 该值即卖出（默认 10；0=关闭）",
    )
    ap.add_argument("--min-score", type=float, default=60.0, help="买入时评分下限")
    ap.add_argument(
        "--low-base-days", type=int, default=3,
        help="突变前需连续处于低位的评分日数（默认 3；0=关闭，只看单日突变）",
    )
    ap.add_argument(
        "--low-base-max", type=float, default=40.0,
        help="低位上限分：突变前 --low-base-days 个评分日都要 <= 该值（默认 40）",
    )
    ap.add_argument(
        "--jump-window", type=int, default=1,
        help="跳升按几个评分日累计算（默认 1=单日；2~3 可识别分两天完成的低位启动）",
    )
    ap.add_argument(
        "--min-rise", type=float, default=0.0,
        help="相对下限：评分自窗口内低点抬升 >= 该值也算达标（与 --min-score 是「或」；0=关闭）",
    )
    ap.add_argument("--fee", type=float, default=0.0012, help="单次交易综合成本（买+卖，默认 0.12%%）")
    ap.add_argument("--stop-loss", type=float, default=0.0, help="止损比例（如 0.08，0=不启用）")
    ap.add_argument("--max-hold", type=int, default=0, help="最长持有交易日（0=不限制）")
    ap.add_argument("--exec", choices=["open", "close"], default="open", help="成交价：次日开盘 / 当日收盘")
    ap.add_argument(
        "--buy-mode", choices=["jump", "cross", "rise"], default="jump",
        help="买入触发：jump=跳升达阈值（默认）/ cross=评分上穿下限 / "
             "rise=评分自近 N 日低位抬升达 --min-rise（不要求单日跳升，适合分几天完成的低位启动）",
    )
    ap.add_argument(
        "--rise-ref-days", type=int, default=10,
        help="rise 模式：低位参照窗口（近 N 个评分日的最低分，默认 10）",
    )
    ap.add_argument(
        "--rise-min-score", type=float, default=45.0,
        help="rise 模式：评分的绝对地板（默认 45，低于该值不算启动）",
    )
    ap.add_argument(
        "--rise-min-delta", type=float, default=0.0,
        help="rise 模式：启动日当日最小跳升（默认 0=不要求；设 10 可滤掉日常小波动）",
    )
    ap.add_argument(
        "--rise-volume", dest="rise_vol_ratio", type=float, default=0.0,
        help="rise 模式：启动日放量倍数下限（当日量 / 前 5 日均量，默认 0=不要求）",
    )
    ap.add_argument("--trend-filter", action="store_true", help="只在收盘价站上 MA20 时买入")
    ap.add_argument("--require-limit-up", action="store_true", help="买入信号日必须收盘涨停")
    ap.add_argument(
        "--min-mv", type=float, default=0.0,
        help="流通市值下限（亿元，按 成交额/换手率 推算；0=不限制）",
    )
    ap.add_argument("--exclude-boards", action="store_true", help="排除北交所与科创板")
    ap.add_argument("--code", help="只回测这一只股票并输出逐决策依据明细（如 600721）")
    ap.add_argument("--trace-min", type=float, default=5.0, help="单股明细里列出的最小 |Δ|（默认 5）")
    ap.add_argument("--exclude-st", action="store_true", help="排除 ST/*ST")
    ap.add_argument("--sweep", action="store_true", help="参数扫描")
    ap.add_argument("--event", action="store_true", help="事件研究（信号后未来收益）")
    ap.add_argument("--trades", type=int, default=5, help="打印前 N 笔交易明细")
    args = ap.parse_args()
    # 「低位运行后的突变」前置条件：只在低位横过一段之后才认买点（0 日=关闭）
    args.low_base = LowBase(args.low_base_days, args.low_base_max)
    # rise 模式必须有「自低点抬升」阈值，否则退化成「评分 >= 地板就买」，信号会爆量
    if args.buy_mode == "rise" and args.min_rise <= 0:
        args.min_rise = 20.0
    # 买入侧统一参数（各 run_stock / evaluate 调用点解包传入）
    rule_kw = {
        "low_base": args.low_base,
        "jump_window": args.jump_window,
        "min_rise": args.min_rise,
        "trail_drop": args.trail_drop,
        "rise_ref_days": args.rise_ref_days,
        "rise_min_score": args.rise_min_score,
        "rise_min_delta": args.rise_min_delta,
        "rise_vol_ratio": args.rise_vol_ratio,
    }

    if args.list_data_dirs:
        print("候选 stock_db 目录（* = 自动探测会选中的那个）：")
        valid = [(c, _db_size(c)) for c in candidate_data_dirs() if _is_stock_db(c)]
        valid.sort(key=lambda x: (x[1][0], x[1][1]), reverse=True)
        best = valid[0][0] if valid else ""
        for c in candidate_data_dirs():
            if _is_stock_db(c):
                meta_sz, daily_sz = _db_size(c)
                print(
                    f"  {'*' if c == best else ' '} {c}  "
                    f"meta={meta_sz / 1048576:.1f}MB daily={daily_sz / 1048576:.1f}MB"
                )
            else:
                print(f"    {c}  （无 meta.db）")
        return

    if args.list_boards:
        boards = _board_index(args.refresh_board)
        names = sorted(v for v in boards.values() if v)
        print(f"东财板块 {len(names)} 个（概念 + 行业，用 --board 名称 回测）：\n")
        for i in range(0, len(names), 6):
            print("  ".join(n + " " * max(0, 16 - _disp_width(n)) for n in names[i : i + 6]))
        return

    data_dir = find_data_dir(args.data_dir)
    meta_path = os.path.join(data_dir, "meta.db")
    daily_path = os.path.join(data_dir, "daily.db")
    print(f"数据目录: {data_dir}")

    meta = connect(meta_path)
    daily = connect(daily_path)

    # 复权口径自适应：写死 qfq 在部分库上会「一只股票都取不到日K」
    ADJUST, adjust_values = detect_adjust(daily)
    print(f"日K复权口径: {ADJUST or '(不复权)'}" + (
        "  可选: " + " / ".join(f"{v or '(空)'} {c}行" for v, c in adjust_values) if len(adjust_values) > 1 else ""
    ))

    if args.series_json:
        # 详情页导出的现算序列：与详情页曲线同口径，直接用它替换缓存序列
        one = load_export_series(args.series_json)
        if args.code and args.code.split(".")[0].strip() != one.code:
            sys.exit(f"导出文件是 {one.code}，与 --code {args.code} 不一致")
        series_all = {one.code: one}
        args.code = one.code
        ver_stats = {"rows": {}, "stocks": {}, "maxdays": {}}
        print(f"评分序列来源: 导出 JSON（详情页逐日现算，不读缓存） {args.series_json}")
        print(f"{one.code} {one.name} 评分区间 {one.dates[0]} ~ {one.dates[-1]}（{len(one.dates)} 个评分日）")
    else:
        series_all, ver_stats = load_scores(
            meta, args.min_days, args.version, complete_only=args.complete_only
        )

    # ---- 评分缓存版本体检：防止拿旧公式的结果当当前口径 ----
    cur_v = str(SCORE_ROW_VERSION)
    rows_v = ver_stats["rows"]
    ver_stocks = ver_stats["stocks"]
    ver_max = ver_stats["maxdays"]
    dominant_v = max(rows_v, key=lambda k: rows_v[k]) if rows_v else ""
    if not args.series_json:
        print(
            f"评分缓存版本（只统计参与回测的行）: 代码当前 v{cur_v}；缓存主导 v{dominant_v}"
            f"（{rows_v.get(dominant_v, 0)} 行 / {ver_stocks.get(dominant_v, 0)} 只）；"
            f"v{cur_v} {rows_v.get(cur_v, 0)} 行 / {ver_stocks.get(cur_v, 0)} 只 / 单股最多 {ver_max.get(cur_v, 0)} 天"
        )
    if not args.series_json and args.version != "current" and dominant_v and dominant_v != cur_v:
        print(
            render_table(
                ["版本", "行数", "股票数", "单股最多天数", ""],
                [
                    [
                        f"v{k}", rows_v[k], ver_stocks.get(k, 0), ver_max.get(k, 0),
                        "  <- 代码当前版本" if k == cur_v else "",
                    ]
                    for k in sorted(rows_v, key=lambda k: -rows_v[k])
                ],
                "lrrrl",
            )
        )
        print(
            f"[警告] 本次 --version {args.version} 取的版本不是当前 v{cur_v}："
            "结果不能与详情页曲线/现算口径对齐！"
        )
        print(
            "       写当前版本的办法：应用「板块股票」页选板块 → 短线评分（勾上历史补算 N 日），"
            "或用训练周期预计算；完成后用 --version current 重跑。"
        )
    if not args.series_json and args.version == "current" and ver_max.get(cur_v, 0) < args.min_days:
        print(
            f"[提示] 当前版本单股最多只有 {ver_max.get(cur_v, 0)} 天评分，小于 --min-days {args.min_days}，"
            "样本会为空；可先降 --min-days，或按上面的办法补算历史评分。"
        )
    latest = max((s.dates[-1] for s in series_all.values()), default="")
    if args.min_last_date == "auto":
        threshold = (
            (datetime.strptime(latest, "%Y-%m-%d") - timedelta(days=170)).strftime("%Y-%m-%d") if latest else ""
        )
    else:
        threshold = args.min_last_date
    series = {k: v for k, v in series_all.items() if not threshold or v.dates[-1] >= threshold}
    if args.series_json:
        print(f"评分序列: 导出 JSON 共 {len(series)} 只（现算口径）")
    else:
        print(
            f"评分序列: 缓存里 >= {args.min_days} 天的共 {len(series_all)} 只，"
            f"最后一天 >= {threshold or '不限'} 的 {len(series)} 只"
            f"（版本口径 {args.version}，维度"
            f"{'齐全' if args.complete_only else '不完整【总分虚高，仅供对照】'}）"
        )
    if latest:
        print(f"数据里最新评分日: {latest}")
    if not series:
        sys.exit(
            "没有满足条件的评分序列。可尝试放宽：--min-days 20 / --min-last-date 2026-01-01 / "
            "--version dominant（或先打开应用让评分缓存写入数据）"
        )

    sample_n = args.sample if args.sample is not None else (0 if args.board else 300)

    if args.board:
        members: Dict[str, str] = {}
        parts: List[str] = []
        for b in args.board:
            board_code, board_name = resolve_board(b, args.refresh_board)
            rows = fetch_board_members(board_code, args.refresh_board)
            for c, n in rows:
                members.setdefault(c, n)
            parts.append(f"{board_name}({board_code}) {len(rows)}只")
        print("板块成分: " + "；".join(parts))
        covered = {c: n for c, n in members.items() if c in series}
        print(f"成分股合计 {len(members)} 只，可回测（评分序列达标）{len(covered)} 只")
        if not covered:
            sys.exit(
                "成分股在评分缓存里没有可用序列（这类板块多为小盘/次新股，评分天数可能不足，"
                "可用 --min-days 60 放宽）"
            )
        for c, n in covered.items():
            series[c].name = series[c].name or n
        series = {c: series[c] for c in covered}

    if args.code:
        one = args.code.split(".")[0].strip()
        if one not in series:
            if one in series_all:
                sys.exit(
                    f"{one} 的评分序列最后一天是 {series_all[one].dates[-1]}，早于阈值 {threshold}；"
                    "可用 --min-last-date 放宽"
                )
            sys.exit(f"评分缓存里没有 {one} 的序列（先在应用里对该股算一次评分，或用更小的 --min-days）")
        codes = [one]
    else:
        codes = pick_sample(series, sample_n, args.seed) if sample_n else sorted(series)
    data, skipped = prepare(
        codes, series, daily,
        exclude_boards=args.exclude_boards, exclude_st=args.exclude_st,
        start_date=args.start, end_date=args.end,
    )
    win_start = min((s.dates[0] for s, _ in data), default="")
    win_end = max((s.dates[-1] for s, _ in data), default="")
    print(f"抽样 {len(codes)} 只，可用 {len(data)} 只（无日K {skipped} 只）")
    if win_start:
        print(f"回测窗口: {win_start} ~ {win_end}")
    if not data:
        sys.exit("样本无可用日K数据")

    lag = 1 if args.exec == "open" else 0
    if args.event:
        event_study(data)
    mv_limit = args.min_mv * 1e8
    base = evaluate(data, args.buy, args.sell, args.min_score, args.fee,
                    args.stop_loss, args.max_hold, lag, args.buy_mode, args.trend_filter,
                    args.require_limit_up, mv_limit, **rule_kw)
    if args.buy_mode == "rise":
        buy_txt = f"低位抬升（近{args.rise_ref_days}日低点）"
        low_txt = (
            f" / 近{args.rise_ref_days}日低位≤{args.low_base_max:g}"
            f" / 抬升≥{args.min_rise:g} / 地板{args.rise_min_score:g}"
        )
        if args.rise_min_delta > 0:
            low_txt += f" / 当日Δ≥{args.rise_min_delta:g}"
        if args.rise_vol_ratio > 0:
            low_txt += f" / 放量≥{args.rise_vol_ratio:g}倍"
    else:
        buy_txt = f"买入+{args.buy:g}（{args.buy_mode}{'，MA20过滤' if args.trend_filter else ''}）"
        low_txt = (
            f" / 低位≤{args.low_base_max:g}持续{args.low_base_days}日"
            if args.low_base_days else " / 低位过滤关"
        )
        if args.jump_window > 1:
            low_txt += f" / {args.jump_window}日累计跳升"
        if args.min_rise > 0:
            low_txt += f" / 自低点+{args.min_rise:g}亦可"
    low_txt += f" / 回撤{args.trail_drop:g}分止盈" if args.trail_drop > 0 else " / 回撤止盈关"
    print_stats(
        f"基准参数 {buy_txt}"
        f" / 卖出{args.sell:g} / 评分≥{args.min_score:g}{low_txt}"
        f" / 成本{args.fee*100:.2f}% / 止损{args.stop_loss*100:.0f}% / 持有上限{args.max_hold or '无'}"
        f"{' / 信号日涨停' if args.require_limit_up else ''}"
        f"{f' / 流通市值≥{args.min_mv:g}亿' if args.min_mv else ''}"
        f"{' / 排除北交所科创板' if args.exclude_boards else ''}"
        f"{' / 排除ST' if args.exclude_st else ''}",
        base,
    )

    all_trades: List[Trade] = []
    for s, bars in data:
        t, _, _ = run_stock(s, bars, args.buy, args.sell, args.min_score,
                            args.fee, args.stop_loss, args.max_hold, lag,
                            args.buy_mode, args.trend_filter,
                            args.require_limit_up, mv_limit,
                            **rule_kw)
        all_trades.extend(t)

    if args.stock_top > 0:
        print_stock_detail(all_trades, args.stock_top, args.stock_trades, args.stock_min_trades)

    if args.stock_year_top > 0:
        print_stock_year_detail(all_trades, args.stock_year_top, args.stock_year_min_trades)

    if args.code:
        print_detail(data, args, mv_limit, lag)

    bench = benchmark_hold(data)
    print(
        f"\n等权买入持有基准（同期 {bench['n']} 只）：平均 {bench['avg']*100:+.1f}%  "
        f"中位 {bench['median']*100:+.1f}%  上涨占比 {bench['win']*100:.0f}%"
    )
    exit_reason_table(all_trades)
    monthly_table(all_trades)

    if args.trades:
        all_trades.sort(key=lambda x: x.ret, reverse=True)
        print(f"\n收益最高的 {args.trades} 笔：")
        for t in all_trades[: args.trades]:
            print(
                f"  {t.code} {t.name} 买 {t.entry_date}@{t.entry_price:.2f} "
                f"卖 {t.exit_date}@{t.exit_price:.2f} 持{t.bars}日 {t.ret*100:+.2f}% {t.exit_reason}"
            )
        print(f"亏损最大的 {args.trades} 笔：")
        for t in all_trades[-args.trades:]:
            print(
                f"  {t.code} {t.name} 买 {t.entry_date}@{t.entry_price:.2f} "
                f"卖 {t.exit_date}@{t.exit_price:.2f} 持{t.bars}日 {t.ret*100:+.2f}% {t.exit_reason}"
            )

    if not args.sweep:
        return

    # ---- 参数扫描：买入阈值 × 评分下限（卖出固定）----
    print("\n=== 参数扫描：买入阈值 × 评分下限（卖出 %.0f，次日开盘成交）===" % args.sell)
    rows = []
    best = None
    # 买入阈值加密到 2 分一档：+20 对「低位缓慢启动」偏严格，需要在 6~20 之间找平衡
    cell, cells = 0, 8 * 4
    for buy in (6, 8, 10, 12, 14, 16, 18, 20):
        for mins in (45, 50, 55, 60):
            cell += 1
            progress(cell, cells, f"买入+{buy} 评分≥{mins}")
            st = evaluate(data, buy, args.sell, mins, args.fee, args.stop_loss, args.max_hold, lag,
                          args.buy_mode, args.trend_filter, args.require_limit_up, mv_limit,
                          **rule_kw)
            pf = st["payoff"]
            rows.append([
                buy, mins, st["trades"], f"{st['win_rate']*100:.1f}", f"{st['avg_ret']*100:+.2f}",
                "∞" if pf == float("inf") else f"{pf:.2f}", f"{st['sharpe']:.2f}",
                f"{st['ann_ret']*100:+.1f}", f"{st['max_dd']*100:.1f}", f"{st['trades_per_stock_year']:.2f}",
            ])
            # 按「年化收益」选优（低频策略的组合夏普波动太大，容易选到只做 1 笔的格子）
            if st["trades"] >= 30 and (best is None or st["ann_ret"] > best[0]):
                best = (st["ann_ret"], buy, mins, st)
    print(render_table(
        ["买入", "评分≥", "交易数", "胜率%", "期望%", "盈亏比", "夏普", "年化%", "回撤%", "频率"],
        rows, "llrrrrrrrr",
    ))
    if best:
        _, buy, mins, st = best
        print(f"\n该网格内年化最优: 买入+{buy} 评分≥{mins}（年化 {st['ann_ret']*100:+.1f}%）")

    # ---- 卖出阈值扫描（买入用基准） ----
    print(f"\n=== 参数扫描：卖出阈值（买入 +{args.buy:g}，评分≥{args.min_score:g}）===")
    rows = []
    cell, cells = 0, 7
    for sell in (-5, -8, -10, -12, -15, -20, -25):
        cell += 1
        progress(cell, cells, f"卖出{sell}")
        st = evaluate(data, args.buy, sell, args.min_score, args.fee, args.stop_loss, args.max_hold, lag,
                      args.buy_mode, args.trend_filter, args.require_limit_up, mv_limit,
                      **rule_kw)
        pf = st["payoff"]
        rows.append([
            sell, st["trades"], f"{st['win_rate']*100:.1f}", f"{st['avg_ret']*100:+.2f}",
            "∞" if pf == float("inf") else f"{pf:.2f}", f"{st['sharpe']:.2f}",
            f"{st['ann_ret']*100:+.1f}", f"{st['max_dd']*100:.1f}", f"{st['avg_bars']:.1f}",
        ])
    print(render_table(
        ["卖出", "交易数", "胜率%", "期望%", "盈亏比", "夏普", "年化%", "回撤%", "持仓日"],
        rows, "lrrrrrrrr",
    ))

    # ---- 风控变体 ----
    print(f"\n=== 风控变体（买入 +{args.buy:g} / 卖出 {args.sell:g} / 评分≥{args.min_score:g}）===")
    rows = []
    variants = ((0, 0), (0.08, 0), (0.12, 0), (0, 10), (0, 20), (0.08, 20))
    for cell, (sl, mh) in enumerate(variants, start=1):
        progress(cell, len(variants), f"止损{sl * 100:.0f}% 持有{mh or '无'}")
        st = evaluate(data, args.buy, args.sell, args.min_score, args.fee, sl, mh, lag,
                      args.buy_mode, args.trend_filter, args.require_limit_up, mv_limit,
                      **rule_kw)
        pf = st["payoff"]
        rows.append([
            f"{sl * 100:.0f}%", mh or "无", st["trades"], f"{st['win_rate']*100:.1f}",
            f"{st['avg_ret']*100:+.2f}", "∞" if pf == float("inf") else f"{pf:.2f}",
            f"{st['sharpe']:.2f}", f"{st['ann_ret']*100:+.1f}", f"{st['max_dd']*100:.1f}",
        ])
    print(render_table(
        ["止损", "持有上限", "交易数", "胜率%", "期望%", "盈亏比", "夏普", "年化%", "回撤%"],
        rows, "llrrrrrrr",
    ))

    # ---- 组合扫描：买入 × 卖出 × 持有上限 ----
    print(f"\n=== 组合扫描：买入 × 卖出 × 持有上限（评分≥{args.min_score:g}，交易数≥100，按期望收益排序）===")
    results = []
    cell, cells = 0, 3 * 3 * 3
    for buy in (15, 20, 25):
        for sell in (-5, -10, -15):
            for mh in (0, 5, 10):
                cell += 1
                progress(cell, cells, f"买入+{buy} 卖出{sell} 持有{mh or '无'}")
                st = evaluate(data, buy, sell, args.min_score, args.fee, args.stop_loss, mh, lag,
                              args.buy_mode, args.trend_filter, args.require_limit_up, mv_limit,
                              **rule_kw)
                if st["trades"] >= 100:
                    results.append((st["avg_ret"], buy, sell, mh, st))
    results.sort(key=lambda x: -x[0])
    rows = []
    for _, buy, sell, mh, st in results[:10]:
        pf = st["payoff"]
        rows.append([
            buy, sell, mh or "无", st["trades"], f"{st['win_rate']*100:.1f}",
            f"{st['avg_ret']*100:+.2f}", "∞" if pf == float("inf") else f"{pf:.2f}",
            f"{st['sharpe']:.2f}", f"{st['ann_ret']*100:+.1f}",
        ])
    if rows:
        print(render_table(
            ["买入", "卖出", "持有上限", "交易", "胜率%", "期望%", "盈亏比", "夏普", "年化%"],
            rows, "lllrrrrrr",
        ))
    else:
        print("  （没有交易数 >= 100 的参数组合，可放宽 --sample 或降低样本门槛）")


if __name__ == "__main__":
    main()
