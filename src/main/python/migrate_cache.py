#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
migrate_cache —— 把旧的「一 key 一个 JSON 文件」缓存迁移进 stock_db。

迁移映射
--------
| 旧缓存 key                              | 新位置                                             |
|-----------------------------------------|----------------------------------------------------|
| ``stock_basic_all``                     | meta.db / stock_basic（结构化元数据表）             |
| ``trade_dates_year=YYYY``               | meta.db / trade_cal（交易日历表）                   |
| ``kline_{secid}_{period}_{adjust}``（个股）| daily.db / daily_kline + daily_parquet/{代码}.parquet |
| 其余全部（板块K线、板块列表、资金流、涨跌比、评分器缓存…） | meta.db / api_cache（原 key 原样保留） |

设计要点
--------
1. **保留原始时间戳**：迁移时把原文件 mtime 写入 ``updated_at``，
   使 ``max_age_hours`` 的 TTL 语义与迁移前完全一致（否则过期数据会被误判为新鲜）。
2. **跳过同步冲突文件**：``*_冲突文件_*`` 这类云盘冲突产物不是合法缓存 key，直接忽略。
3. **幂等可重跑**：写入全部为 upsert，重复执行结果一致。
4. **只迁个股 K 线到结构化表**：指数/板块 K 线在新代码里仍走 ``api_cache``，
   若强行转成结构化表反而读不到。

用法
----
    # 预览（不写库）
    python3 migrate_cache.py --dry-run

    # 按应用当前存储根目录迁移（<storage-path>/tushare_cache → <storage-path>/stock_db）
    python3 migrate_cache.py --storage-path "/Users/xxx/Downloads/同步空间/stexplorer"

    # 显式指定旧缓存目录
    python3 migrate_cache.py --legacy-dir ~/.stexplorer/tushare_cache --storage-path ~/.stexplorer

    # 迁移全部已知旧缓存目录
    python3 migrate_cache.py --storage-path "/path/to/storage" --all-legacy
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import stock_db as sdb  # noqa: E402

# 云盘同步冲突文件的命名特征（如 up_down_ratio_map_冲突文件_root_20260927212449.json）
_CONFLICT_MARKERS = ("_冲突文件_", "_conflict", "conflicted copy")

_KLINE_PREFIX = "kline_"
_STOCK_BASIC_KEY = "stock_basic_all"
_TRADE_DATES_PREFIX = "trade_dates_year="


# ============================================================
# secid 工具（与 tushare_api 中的规则保持一致，此处独立实现以避免重依赖导入）
# ============================================================

def _pure_code(secid: str) -> str:
    if not secid:
        return secid
    if "." in secid:
        parts = secid.split(".")
        if len(parts) >= 2 and parts[-1].upper() in ("DC", "THS"):
            return parts[-2]
        return parts[-1]
    return secid


def _is_board_secid(secid: str) -> bool:
    if secid.startswith("90."):
        return True
    code = _pure_code(secid)
    if code.startswith("BK") or code.startswith("88"):
        return True
    if "." in secid and secid.split(".")[0] == "2":
        return True
    return False


def _is_index_secid(secid: str) -> bool:
    if "." not in secid:
        return False
    mk, code = secid.split(".", 1)
    if code.startswith("399"):
        return True
    if code.startswith("000") and mk == "1":
        return True
    if mk == "2":
        return True
    if mk in ("0", "1") and code.startswith("9") and len(code) == 6 and code.isdigit():
        return True
    return False


def _secid_to_ts_code(secid: str) -> str:
    if "." in secid:
        mk, code = secid.split(".", 1)
        if mk == "2":
            return f"{code}.CSI"
        if mk == "1" or code.startswith("6"):
            return f"{code}.SH"
        return f"{code}.SZ"
    if secid.startswith("6"):
        return f"{secid}.SH"
    return f"{secid}.SZ"


def _parse_stock_kline_key(key: str) -> Optional[Tuple[str, str, str, str]]:
    """解析 ``kline_{secid}_{period}_{adjust}``，仅当标的是个股时返回
    ``(kind, ts_code, period, adjust)``，否则返回 None（保持走 api_cache）。"""
    if not key.startswith(_KLINE_PREFIX):
        return None
    rest = key[len(_KLINE_PREFIX):]
    parts = rest.rsplit("_", 2)
    if len(parts) != 3:
        return None
    secid, period, adjust = parts
    if not secid or period not in ("daily", "weekly", "monthly"):
        return None
    if _is_board_secid(secid) or _is_index_secid(secid):
        return None
    return "stock", _secid_to_ts_code(secid), period, adjust


def _is_conflict_file(name: str) -> bool:
    return any(marker in name for marker in _CONFLICT_MARKERS)


# ============================================================
# 迁移主体
# ============================================================

def _load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _migrate_stock_basic(data: Any, mtime: float, report: Dict[str, Any]) -> None:
    name_map = data.get("name_map") or {}
    industry_map = data.get("industry_map") or {}
    records = []
    for ts_code, name in name_map.items():
        if not ts_code:
            continue
        records.append({
            "ts_code": ts_code,
            "symbol": ts_code.split(".")[0],
            "name": name,
            "industry": industry_map.get(ts_code, ""),
        })
    report["rows_written"] += sdb.upsert_stock_basic(records, updated_at=mtime)


def _migrate_trade_cal(data: Any, mtime: float, report: Dict[str, Any]) -> None:
    dates = data.get("dates") if isinstance(data, dict) else data
    if not isinstance(dates, list) or not dates:
        return
    report["rows_written"] += sdb.upsert_trade_cal(dates, "SSE", 1, updated_at=mtime)


def _migrate_kline(records: Any, parsed: Tuple[str, str, str, str],
                   mtime: float, report: Dict[str, Any]) -> None:
    if not isinstance(records, list) or not records:
        return
    kind, ts_code, period, adjust = parsed
    report["rows_written"] += sdb.write_kline(kind, ts_code, period, adjust, records)
    # 让 kline_meta 的 updated_at 反映原始时间，便于排查
    try:
        sdb._execute(
            sdb._META_DB,
            "UPDATE kline_meta SET updated_at=? WHERE kind=? AND ts_code=? AND period=? AND adjust=?",
            (mtime, kind, ts_code, period, adjust or ""),
        )
    except Exception:
        pass


def migrate_dir(legacy_dir: str, dry_run: bool = False, verbose: bool = False,
                limit: int = 0) -> Dict[str, Any]:
    """迁移单个旧缓存目录，返回统计报告。"""
    started = time.time()
    report: Dict[str, Any] = {
        "legacy_dir": legacy_dir,
        "db_root": sdb.get_db_root(),
        "total_files": 0,
        "migrated": 0,
        "breakdown": {"stock_basic": 0, "trade_cal": 0, "daily_kline": 0, "api_cache": 0},
        "rows_written": 0,
        "skipped_conflict": 0,
        "errors": [],
        "dry_run": dry_run,
    }

    if not os.path.isdir(legacy_dir):
        report["errors"].append(f"目录不存在: {legacy_dir}")
        return report

    names = sorted(fn for fn in os.listdir(legacy_dir) if fn.endswith(".json"))
    report["total_files"] = len(names)

    processed = 0
    for fn in names:
        if limit and processed >= limit:
            break
        path = os.path.join(legacy_dir, fn)
        if not os.path.isfile(path):
            continue
        if _is_conflict_file(fn):
            report["skipped_conflict"] += 1
            continue

        key = fn[:-5]
        processed += 1

        try:
            mtime = os.path.getmtime(path)
            data = _load_json(path)
        except Exception as e:
            report["errors"].append(f"{fn}: {e}")
            continue

        # ---------------- 路由 ----------------
        try:
            if key == _STOCK_BASIC_KEY:
                bucket = "stock_basic"
                if not dry_run:
                    _migrate_stock_basic(data if isinstance(data, dict) else {}, mtime, report)
            elif key.startswith(_TRADE_DATES_PREFIX):
                bucket = "trade_cal"
                if not dry_run:
                    _migrate_trade_cal(data, mtime, report)
            elif key.startswith(_KLINE_PREFIX):
                parsed = _parse_stock_kline_key(key)
                if parsed is not None:
                    bucket = "daily_kline"
                    if not dry_run:
                        _migrate_kline(data, parsed, mtime, report)
                else:
                    bucket = "api_cache"
                    if not dry_run:
                        sdb.write_cache(key, data, updated_at=mtime)
            else:
                bucket = "api_cache"
                if not dry_run:
                    sdb.write_cache(key, data, updated_at=mtime)
        except Exception as e:
            report["errors"].append(f"{fn}: 写入失败 {e}")
            continue

        report["breakdown"][bucket] = report["breakdown"].get(bucket, 0) + 1
        report["migrated"] += 1
        if verbose and report["migrated"] % 200 == 0:
            print(f"  ... 已迁移 {report['migrated']}/{len(names)}", file=sys.stderr)

    report["elapsed_sec"] = round(time.time() - started, 2)
    return report


# 走 sqlite-read/sqlite-write 的「缓存类」表目录（与 cacheStore.ts 的白名单保持一致）。
# 对应的数据库 key 规则：``local:<相对 storage 根目录的路径，不含 .json>``
LOCAL_DATA_DIRS = ("stock_trend",)


def _verify_and_delete(path: str, key: str, errors: List[str]) -> bool:
    """确认数据库已存在该 key 后再删除源文件，避免误删未迁移成功的数据。"""
    try:
        if sdb.read_cache(key, max_age_hours=-1) is None:
            errors.append(f"{os.path.basename(path)}: 删除前校验失败（库中无 {key}），已保留")
            return False
        os.remove(path)
        return True
    except Exception as e:
        errors.append(f"{os.path.basename(path)}: 删除失败 {e}")
        return False


def migrate_local_data_dirs(storage_path: Optional[str], dry_run: bool = False,
                            delete_source: bool = False, verbose: bool = False,
                            dirs: Iterable[str] = LOCAL_DATA_DIRS) -> Dict[str, Any]:
    """迁移 ``<storage>/<dir>/*.json`` 形式的「本地数据」缓存到 api_cache。

    这些文件对应主进程 sqlite-read/sqlite-write 的缓存类表（如 stock_trend），
    内容原样入库，DB key 为 ``local:<dir>/<文件名主干>``。
    """
    report: Dict[str, Any] = {
        "dirs": {},
        "migrated": 0,
        "deleted": 0,
        "skipped_conflict": 0,
        "errors": [],
        "dry_run": dry_run,
        "delete_source": delete_source,
    }
    if not storage_path:
        return report

    root = os.path.expanduser(storage_path)
    for d in dirs:
        target = os.path.join(root, d)
        if not os.path.isdir(target):
            continue
        names = sorted(fn for fn in os.listdir(target) if fn.endswith(".json"))
        dir_stat = {"migrated": 0, "deleted": 0, "total": len(names)}
        for fn in names:
            path = os.path.join(target, fn)
            if not os.path.isfile(path):
                continue
            if _is_conflict_file(fn):
                report["skipped_conflict"] += 1
                continue
            key = f"local:{d}/{fn[:-5]}"
            try:
                payload = _load_json(path)
                if not dry_run:
                    sdb.write_cache(key, payload, updated_at=os.path.getmtime(path))
                    if delete_source and _verify_and_delete(path, key, report["errors"]):
                        report["deleted"] += 1
                        dir_stat["deleted"] += 1
                report["migrated"] += 1
                dir_stat["migrated"] += 1
            except Exception as e:
                report["errors"].append(f"{fn}: {e}")
        report["dirs"][d] = dir_stat
        if verbose:
            print(f"  ... {d}: 迁移 {dir_stat['migrated']}/{dir_stat['total']}，"
                  f"删除源文件 {dir_stat['deleted']}", file=sys.stderr)
    return report


def migrate_backtest_dir(legacy_dir: str, dry_run: bool = False,
                         verbose: bool = False, delete_source: bool = False) -> Dict[str, Any]:
    """迁移主进程通用 KV 缓存（旧 ``backups/backtest_cache/*.json``）到 meta.db/api_cache。

    文件内容形如 ``{"data": ..., "cachedAt": "..."}``，原样存入缓存表，
    使渲染进程 readCache 的返回结构与迁移前完全一致。
    """
    report: Dict[str, Any] = {
        "legacy_dir": legacy_dir,
        "total_files": 0,
        "migrated": 0,
        "deleted": 0,
        "skipped_conflict": 0,
        "errors": [],
        "dry_run": dry_run,
        "delete_source": delete_source,
    }
    if not os.path.isdir(legacy_dir):
        return report

    names = sorted(fn for fn in os.listdir(legacy_dir) if fn.endswith(".json"))
    report["total_files"] = len(names)

    for fn in names:
        path = os.path.join(legacy_dir, fn)
        if not os.path.isfile(path):
            continue
        if _is_conflict_file(fn):
            report["skipped_conflict"] += 1
            continue
        try:
            payload = _load_json(path)
            if not dry_run:
                sdb.write_cache(fn[:-5], payload, updated_at=os.path.getmtime(path))
                if delete_source and _verify_and_delete(path, fn[:-5], report["errors"]):
                    report["deleted"] += 1
            report["migrated"] += 1
        except Exception as e:
            report["errors"].append(f"{fn}: {e}")

    if verbose:
        print(f"  ... 通用缓存迁移完成: {report['migrated']}，删除源文件 {report['deleted']}",
              file=sys.stderr)
    return report


def resolve_legacy_dirs(storage_path: Optional[str], explicit: Optional[str],
                        all_legacy: bool) -> List[str]:
    """确定要迁移的旧缓存目录列表。"""
    if explicit:
        return [os.path.expanduser(explicit)]

    candidates: List[str] = []
    if storage_path:
        candidates.append(os.path.join(os.path.expanduser(storage_path), "tushare_cache"))
    candidates.append(os.path.join(os.path.expanduser("~"), ".stexplorer", "tushare_cache"))

    exists = [c for c in candidates if os.path.isdir(c)]
    if all_legacy:
        return exists
    return exists[:1]  # 默认只迁移应用当前使用的那一个


def _dir_summary(path: str) -> str:
    try:
        files = [fn for fn in os.listdir(path) if fn.endswith(".json")]
        conflicts = sum(1 for fn in files if _is_conflict_file(fn))
        return f"{len(files)} 个 json（其中冲突文件 {conflicts}）"
    except OSError:
        return "不可读"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="把旧的 tushare_cache JSON 文件缓存迁移到 stock_db（SQLite + Parquet）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--storage-path", "-s", default=None,
                        help="应用本地存储根目录；旧缓存在其 tushare_cache/，新库落在其 stock_db/")
    parser.add_argument("--legacy-dir", "-l", default=None, help="显式指定旧缓存目录")
    parser.add_argument("--all-legacy", action="store_true",
                        help="迁移所有已发现的旧缓存目录（默认只迁移第一个）")
    parser.add_argument("--dry-run", "-n", action="store_true", help="只预览，不写库")
    parser.add_argument("--verbose", "-v", action="store_true", help="输出进度")
    parser.add_argument("--limit", type=int, default=0, help="最多处理多少个文件（调试用）")
    parser.add_argument("--stats", action="store_true", help="迁移后打印 db_stats")
    parser.add_argument("--backtest-cache-dir", default=None,
                        help="主进程通用 KV 缓存目录（旧 backups/backtest_cache），默认取 <storage-path>/backups/backtest_cache")
    parser.add_argument("--skip-backtest-cache", action="store_true",
                        help="跳过主进程通用 KV 缓存（stock_bankuais 等）的迁移")
    parser.add_argument("--skip-legacy", action="store_true",
                        help="跳过旧 tushare_cache 目录的迁移，只迁通用 KV 缓存")
    parser.add_argument("--skip-local-data", action="store_true",
                        help="跳过 stock_trend 等「本地数据」缓存目录的迁移")
    parser.add_argument("--delete-migrated", action="store_true",
                        help="迁移校验成功后删除源 JSON 文件（stock_trend / backtest_cache）")
    args = parser.parse_args()

    if args.storage_path:
        sdb.set_db_root(args.storage_path)
    sdb.init_db()

    legacy_dirs = [] if args.skip_legacy else resolve_legacy_dirs(
        args.storage_path, args.legacy_dir, args.all_legacy
    )

    # 主进程通用 KV 缓存目录（stock_bankuais_* 等）
    backtest_dir = args.backtest_cache_dir
    if not backtest_dir and args.storage_path:
        backtest_dir = os.path.join(os.path.expanduser(args.storage_path), "backups", "backtest_cache")
    if args.skip_backtest_cache:
        backtest_dir = None

    if not legacy_dirs and not (backtest_dir and os.path.isdir(backtest_dir)):
        print(json.dumps({
            "error": "未找到旧缓存目录",
            "hint": "用 --legacy-dir 显式指定，例如 ~/.stexplorer/tushare_cache",
        }, ensure_ascii=False, indent=2))
        sys.exit(1)

    if legacy_dirs:
        print("旧缓存目录：", file=sys.stderr)
        for d in legacy_dirs:
            print(f"  - {d}  （{_dir_summary(d)}）", file=sys.stderr)
    print(f"新数据库根目录：{sdb.get_db_root()}  (parquet={'启用' if sdb.parquet_enabled() else '禁用'})",
          file=sys.stderr)

    reports = []
    for d in legacy_dirs:
        print(f"\n开始迁移：{d}", file=sys.stderr)
        reports.append(migrate_dir(d, dry_run=args.dry_run, verbose=args.verbose, limit=args.limit))

    backtest_report = None
    if backtest_dir and os.path.isdir(backtest_dir):
        print(f"\n开始迁移通用 KV 缓存：{backtest_dir}", file=sys.stderr)
        backtest_report = migrate_backtest_dir(
            backtest_dir, dry_run=args.dry_run, verbose=args.verbose,
            delete_source=args.delete_migrated,
        )

    # stock_trend 等「本地数据」缓存目录（sqlite-read/sqlite-write 缓存类表）
    local_report = None
    if not args.skip_local_data:
        print("\n开始迁移本地数据缓存目录：", file=sys.stderr)
        for d in LOCAL_DATA_DIRS:
            print(f"  - {os.path.join(os.path.expanduser(args.storage_path or ''), d)}", file=sys.stderr)
        local_report = migrate_local_data_dirs(
            args.storage_path, dry_run=args.dry_run, delete_source=args.delete_migrated,
            verbose=args.verbose,
        )

    output: Dict[str, Any] = {
        "reports": reports,
        "totals": {
            "migrated": sum(r["migrated"] for r in reports),
            "rows_written": sum(r["rows_written"] for r in reports),
            "skipped_conflict": sum(r["skipped_conflict"] for r in reports),
            "errors": sum(len(r["errors"]) for r in reports),
        },
    }
    if backtest_report is not None:
        output["backtest_cache"] = backtest_report
    if local_report is not None:
        output["local_data"] = local_report
    if args.stats:
        output["db_stats"] = sdb.db_stats()

    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
