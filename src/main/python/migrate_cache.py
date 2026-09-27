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
from typing import Any, Dict, List, Optional, Tuple

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
    args = parser.parse_args()

    if args.storage_path:
        sdb.set_db_root(args.storage_path)
    sdb.init_db()

    legacy_dirs = resolve_legacy_dirs(args.storage_path, args.legacy_dir, args.all_legacy)
    if not legacy_dirs:
        print(json.dumps({
            "error": "未找到旧缓存目录",
            "hint": "用 --legacy-dir 显式指定，例如 ~/.stexplorer/tushare_cache",
        }, ensure_ascii=False, indent=2))
        sys.exit(1)

    print("旧缓存目录：", file=sys.stderr)
    for d in legacy_dirs:
        print(f"  - {d}  （{_dir_summary(d)}）", file=sys.stderr)
    print(f"新数据库根目录：{sdb.get_db_root()}  (parquet={'启用' if sdb.parquet_enabled() else '禁用'})",
          file=sys.stderr)

    reports = []
    for d in legacy_dirs:
        print(f"\n开始迁移：{d}", file=sys.stderr)
        reports.append(migrate_dir(d, dry_run=args.dry_run, verbose=args.verbose, limit=args.limit))

    output: Dict[str, Any] = {
        "reports": reports,
        "totals": {
            "migrated": sum(r["migrated"] for r in reports),
            "rows_written": sum(r["rows_written"] for r in reports),
            "skipped_conflict": sum(r["skipped_conflict"] for r in reports),
            "errors": sum(len(r["errors"]) for r in reports),
        },
    }
    if args.stats:
        output["db_stats"] = sdb.db_stats()

    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
