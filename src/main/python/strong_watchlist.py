# -*- coding: utf-8 -*-
"""强势股观察名单：独立派生表，只用于界面展示，不参与板块效应启动判定。

规则：按交易日计算 Δt，权重 w = 0.5 ^ (Δt / 1.5)，w < 0.05 的成员移出。
展示时把「仍未移出的历史成员」与「当日强势股」按股票代码合并去重。
本模块只读 stock_db/meta.db，派生表写在 <storage>/derived/strong_watchlist.db，
不修改 stock_db 的任何原有数据，也不向板块判定引擎注入成分池。
"""
import bisect
import copy
import datetime as _datetime
import json
import os
import re
import sqlite3
from typing import Any, Dict, List, Optional

ENGINE = "strong_watchlist"
VERSION = "1.0"
HALF_LIFE = 1.5
REMOVE_THRESHOLD = 0.05
TABLE_NAME = "derived_strong_watchlist"

_db_root_hint: Optional[str] = None
_storage_root_hint: Optional[str] = None
_as_of_date: Optional[str] = None
_source_cache: Optional[Dict[str, Any]] = None
_source_key: Optional[tuple] = None


def set_cache_dir(storage_path):
    """记录应用存储根目录，只更新路径提示，不创建目录、不初始化数据库。"""
    global _db_root_hint, _storage_root_hint
    _storage_root_hint = storage_path or None
    _db_root_hint = os.path.join(storage_path, "stock_db") if storage_path else None
    return _db_root_hint


def set_as_of_date(value):
    """训练模式的数据截止日，晚于该日的请求一律截断。"""
    global _as_of_date
    _as_of_date = str(value).replace("-", "")[:8] if value else None
    return _as_of_date


def _log(msg):
    print("[强势股观察名单] %s" % msg, flush=True)


def _ro_uri(path):
    """把本地路径转成只读 SQLite URI。"""
    import pathlib
    return pathlib.Path(path).absolute().as_uri() + "?mode=ro"


def _resolve_meta_db():
    """只读挑选一个含强势股快照的 meta.db。"""
    candidates = [_db_root_hint]
    try:
        import stock_db
        candidates.append(stock_db.get_db_root())
    except Exception as e:
        _log("无法从 stock_db 取得存储根目录：%s" % e)
    candidates += [
        os.path.expanduser("~/Documents/GitHub/stexplorer/data/stock_db"),
        os.path.expanduser("~/.stexplorer/stock_db"),
    ]
    seen = set()
    for root in candidates:
        if not root or root in seen:
            continue
        seen.add(root)
        path = os.path.join(root, "meta.db")
        if not os.path.isfile(path):
            continue
        con = None
        try:
            con = sqlite3.connect(_ro_uri(path), uri=True)
            n = con.execute(
                "SELECT COUNT(*) FROM api_cache "
                "WHERE cache_key LIKE 'strong_pool_%' OR cache_key LIKE 'local:backups/qslist/%'"
            ).fetchone()[0]
            if n:
                return path, root
        except Exception:
            continue
        finally:
            if con is not None:
                con.close()
    return "", ""


def _derived_db_path(meta_root):
    """派生表放在应用存储根目录下的 derived 子目录，避开 stock_db。"""
    if _storage_root_hint:
        root = _storage_root_hint
    elif meta_root:
        root = os.path.dirname(meta_root)
    else:
        root = os.path.expanduser("~/.stexplorer")
    return os.path.join(root, "derived", "strong_watchlist.db")


def _date_of_key(key):
    m = re.search(r"(20\d{6})", str(key or ""))
    return m.group(1) if m else ""


def _to_float(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _code6(s):
    """统一取 6 位股票代码，兼容東财 secid 与 Tushare code。"""
    digits = re.sub(r"\D", "", str(s.get("code") or ""))
    if len(digits) >= 6:
        return digits[-6:]
    digits = re.sub(r"\D", "", str(s.get("secid") or ""))
    return digits[-6:] if len(digits) >= 6 else ""


def _normalize_row(s, date, source_key):
    """把東财池 / Tushare 重建行统一成列表可直接渲染的字段。"""
    code = _code6(s)
    if not code:
        return None
    original_type = str(s.get("strongType") or s.get("strong_type") or "").strip()
    strong_type = original_type or "watchlist"
    secid = str(s.get("secid") or ("1." if code.startswith("6") else "0.") + code)
    raw_zx = _to_float(s.get("zx"))
    raw_ltsz = _to_float(s.get("ltsz"))
    raw_zsz = _to_float(s.get("zsz"))
    # 東财池的价格是 ×1000、市值单位是元；Tushare 重建行已经是元与亿元。
    zx = raw_zx if original_type else raw_zx / 1000.0
    ltsz = raw_ltsz if original_type else raw_ltsz / 1e8
    zsz = raw_zsz if original_type else raw_zsz / 1e8
    reason = s.get("reason")
    if reason in (None, ""):
        reason = 1 if original_type == "new_high_60" else 2
    try:
        reason = int(float(reason))
    except (TypeError, ValueError):
        reason = 0
    row = dict(s)
    row.update({
        "code": code,
        "name": str(s.get("name") or ""),
        "secid": secid,
        "market": int(secid.split(".")[0]) if secid.split(".")[0].isdigit() else 0,
        "zx": round(zx, 4),
        "zdf": round(_to_float(s.get("zdf")), 4),
        "hsl": round(_to_float(s.get("hsl")), 4),
        "ltsz": round(ltsz, 4),
        "zsz": round(zsz, 4),
        "hybk": str(s.get("hybk") or s.get("hybkName") or ""),
        "strongType": strong_type,
        "reason": reason,
        "limitTimes": int(_to_float(s.get("limitTimes"))),
        "snapshot_date": date,
        "source_key": source_key,
    })
    return row


def _parse_snapshot_payload(payload):
    """兼容 CacheAPI.put_raw 的 {lastModified,data} 与普通 {stocks} 结构。"""
    try:
        obj = json.loads(payload)
    except Exception:
        return []
    if not isinstance(obj, dict):
        return []
    raw = obj.get("data") if "lastModified" in obj else obj
    if not isinstance(raw, dict):
        return []
    stocks = raw.get("stocks") or []
    return stocks if isinstance(stocks, list) else []


def _is_stale_backup(stocks):
    """旧口径 Tushare 备份只有 strongType 没有 limitTimes，交给精确重建覆盖。"""
    for s in stocks:
        if isinstance(s, dict) and s.get("strongType") and "limitTimes" not in s:
            return True
    return False


def _load_source(meta_db, min_times, force=False):
    """一次性读取全部强势股快照与交易日历，按缓存更新时间自动失效。"""
    global _source_cache, _source_key
    con = sqlite3.connect(_ro_uri(meta_db), uri=True)
    try:
        max_updated = con.execute(
            "SELECT MAX(updated_at) FROM api_cache "
            "WHERE cache_key LIKE 'strong_pool_%' OR cache_key LIKE 'local:backups/qslist/%'"
        ).fetchone()[0] or ""
        key = (meta_db, int(min_times), str(max_updated))
        if not force and _source_cache is not None and _source_key == key:
            return _source_cache
        rows = con.execute(
            "SELECT cache_key,payload FROM api_cache "
            "WHERE cache_key LIKE 'strong_pool_%' OR cache_key LIKE 'local:backups/qslist/%' "
            "ORDER BY cache_key"
        ).fetchall()
        daily_keys = con.execute(
            "SELECT cache_key FROM api_cache WHERE cache_key LIKE 'daily_all_%'"
        ).fetchall()
    finally:
        con.close()

    snapshots: Dict[str, Dict[str, Dict[str, Any]]] = {}
    source_by_date: Dict[str, str] = {}
    priority: Dict[str, int] = {}
    for cache_key, payload in rows:
        date = _date_of_key(cache_key)
        if not date:
            continue
        stocks = _parse_snapshot_payload(payload)
        if not stocks or _is_stale_backup(stocks):
            continue
        if cache_key.startswith("strong_pool_"):
            m = re.search(r"_(\d+)$", cache_key)
            key_times = int(m.group(1)) if m else 2
            if key_times != int(min_times):
                continue
            p = 2
        else:
            p = 1
        if p < priority.get(date, 0):
            continue
        day_rows: Dict[str, Dict[str, Any]] = {}
        for s in stocks:
            if not isinstance(s, dict):
                continue
            row = _normalize_row(s, date, cache_key)
            if row:
                day_rows[row["code"]] = row
        if not day_rows:
            continue
        priority[date] = p
        snapshots[date] = day_rows
        source_by_date[date] = cache_key

    daily_dates = {_date_of_key(k[0]) for k in daily_keys}
    daily_dates.discard("")
    trading_dates = sorted(daily_dates | set(snapshots.keys()))
    data = {
        "snapshots": snapshots,
        "source_by_date": source_by_date,
        "trading_dates": trading_dates,
        "max_updated": str(max_updated),
    }
    _source_cache = data
    _source_key = key
    _log("读取强势股快照 %d 天、交易日 %d 天" % (len(snapshots), len(trading_dates)))
    return data


def _gap_days(dates, last_seen, target):
    """按交易日序号计算 Δt；交易日缺失时退化为自然日。"""
    if last_seen >= target:
        return 0
    if dates:
        i = bisect.bisect_right(dates, last_seen) - 1
        j = bisect.bisect_right(dates, target) - 1
        if i >= 0 and j >= i:
            return j - i
    try:
        a = _datetime.datetime.strptime(last_seen, "%Y%m%d")
        b = _datetime.datetime.strptime(target, "%Y%m%d")
        return max(0, (b - a).days)
    except Exception:
        return 0


def _weight(gap):
    return 0.5 ** (float(gap) / HALF_LIFE)


def _split_state(state, target, dates):
    """按目标交易日拆出活跃记录与已移出数量。"""
    records: List[Dict[str, Any]] = []
    removed = 0
    for code in sorted(state):
        item = state[code]
        gap = _gap_days(dates, item["last_seen_date"], target)
        w = _weight(gap)
        if w < REMOVE_THRESHOLD:
            removed += 1
            continue
        row = dict(item["row"])
        # 当天入池按最近入池日精确判断，避免交易日缺失让不同日期落到同一序号。
        is_today = item["last_seen_date"] == target
        row["watchlist"] = {
            "is_today": is_today,
            "weight": round(w, 6),
            "days_since_seen": int(gap),
            "last_seen_date": item["last_seen_date"],
            "first_seen_date": item["first_seen_date"],
            "snapshot_date": target,
            "status": "当日强势" if is_today else "观察中",
            "source_table": TABLE_NAME,
        }
        records.append(row)
    records.sort(
        key=lambda r: (
            not r["watchlist"]["is_today"],
            -r["watchlist"]["weight"],
            -_to_float(r.get("zdf")),
            str(r.get("code") or ""),
        )
    )
    return records, removed


def _run_states(snapshots, trading_dates, effective_dates):
    """逐交易日递推：只保留未移出成员，不把历史成分池喂给板块判定。"""
    state: Dict[str, Dict[str, Any]] = {}
    results: Dict[str, Dict[str, Any]] = {}
    targets = set(effective_dates)
    max_target = max(targets) if targets else ""
    for date in trading_dates:
        if max_target and date > max_target:
            break
        if date in snapshots:
            for code, row in snapshots[date].items():
                if code in state:
                    state[code]["last_seen_date"] = date
                    state[code]["row"] = row
                else:
                    state[code] = {
                        "first_seen_date": date,
                        "last_seen_date": date,
                        "row": row,
                    }
        records, removed = _split_state(state, date, trading_dates)
        for code in list(state):
            item = state[code]
            if _weight(_gap_days(trading_dates, item["last_seen_date"], date)) < REMOVE_THRESHOLD:
                del state[code]
        if date in targets:
            results[date] = {"records": records, "removed": removed}
    return results


def _effective_date(requested, snapshot_dates):
    """请求日没有快照时回退到最近一个入池交易日，保证周末/节假日仍可观察。"""
    candidates = [d for d in snapshot_dates if d <= requested]
    return candidates[-1] if candidates else requested


def _empty_day(requested, effective, warnings):
    return {
        "trade_date": requested,
        "snapshot_date": effective,
        "source_key": "",
        "summary": {"n_records": 0, "n_today": 0, "n_watch": 0, "n_removed": 0},
        "records": [],
        "warnings": list(warnings),
    }


def _persist(db_path, pool_key, records, effective):
    """把最新目标日的未移出成员写入独立派生表。"""
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    con = sqlite3.connect(db_path)
    try:
        con.execute(
            "CREATE TABLE IF NOT EXISTS %s ("
            "pool_key TEXT NOT NULL, code TEXT NOT NULL, name TEXT, secid TEXT, "
            "first_seen_date TEXT, last_seen_date TEXT, snapshot_date TEXT, "
            "weight REAL, days_since_seen INTEGER, is_today INTEGER, "
            "snapshot_json TEXT, updated_at TEXT, PRIMARY KEY (pool_key, code))" % TABLE_NAME
        )
        con.execute("DELETE FROM %s WHERE pool_key = ?" % TABLE_NAME, (pool_key,))
        now = _datetime.datetime.now().isoformat(timespec="seconds")
        for r in records:
            w = r["watchlist"]
            snapshot = dict(r)
            snapshot.pop("watchlist", None)
            con.execute(
                "INSERT OR REPLACE INTO %s VALUES (?,?,?,?,?,?,?,?,?,?,?,?)" % TABLE_NAME,
                (
                    pool_key,
                    r.get("code"),
                    r.get("name"),
                    r.get("secid"),
                    w.get("first_seen_date"),
                    w.get("last_seen_date"),
                    effective,
                    w.get("weight"),
                    w.get("days_since_seen"),
                    1 if w.get("is_today") else 0,
                    json.dumps(snapshot, ensure_ascii=False),
                    now,
                ),
            )
        con.commit()
    finally:
        con.close()


def _normalize_dates(dates):
    out = []
    for d in dates or []:
        day = str(d or "").replace("-", "")[:8]
        if not re.fullmatch(r"\d{8}", day):
            continue
        if _as_of_date and day > _as_of_date:
            day = _as_of_date
        if day not in out:
            out.append(day)
    return sorted(out)


def _evaluate(dates=None, min_limit_times=2, force=False):
    """返回每个请求交易日的合并观察名单，并同步独立派生表。"""
    min_times = int(min_limit_times or 2)
    meta_db, meta_root = _resolve_meta_db()
    warnings: List[str] = []
    if not meta_db:
        warnings.append("未找到含强势股快照的只读 meta.db")
        data = {"snapshots": {}, "source_by_date": {}, "trading_dates": [], "max_updated": ""}
    else:
        data = _load_source(meta_db, min_times, force=bool(force))
    snapshots = data["snapshots"]
    trading_dates = data["trading_dates"]
    snapshot_dates = sorted(snapshots.keys())
    if not snapshots:
        warnings.append("没有可用的强势股池快照或 QSList 备份")

    req_dates = _normalize_dates(dates)
    if not req_dates:
        fallback = _as_of_date or (snapshot_dates[-1] if snapshot_dates else "")
        req_dates = [fallback] if fallback else []
    effective_map = {d: _effective_date(d, snapshot_dates) for d in req_dates}
    effective_dates = sorted(set(effective_map.values()))
    if effective_dates:
        trading_dates = sorted(set(trading_dates) | set(effective_dates))
    state_results = _run_states(snapshots, trading_dates, effective_dates)

    derived_db = _derived_db_path(meta_root)
    pool_key = "strong_pool_%d" % min_times
    results: Dict[str, Dict[str, Any]] = {}
    for req in req_dates:
        eff = effective_map[req]
        raw = state_results.get(eff)
        if not raw:
            results[req] = _empty_day(req, eff, warnings)
            continue
        records = copy.deepcopy(raw["records"])
        for r in records:
            w = r["watchlist"]
            if req != eff and w["is_today"]:
                w["status"] = "最近入池"
                w["snapshot_date"] = eff
        n_today = sum(1 for r in records if r["watchlist"]["is_today"])
        results[req] = {
            "trade_date": req,
            "snapshot_date": eff,
            "source_key": data["source_by_date"].get(eff, ""),
            "summary": {
                "n_records": len(records),
                "n_today": n_today,
                "n_watch": len(records) - n_today,
                "n_removed": raw["removed"],
            },
            "records": records,
            "warnings": list(warnings),
        }
    if req_dates:
        latest = max(req_dates)
        _persist(derived_db, pool_key, results[latest]["records"], effective_map[latest])
    return {
        "engine": ENGINE,
        "version": VERSION,
        "half_life": HALF_LIFE,
        "remove_threshold": REMOVE_THRESHOLD,
        "source_table": TABLE_NAME,
        "derived_db": derived_db,
        "min_limit_times": min_times,
        "as_of_date": _as_of_date,
        "dates": req_dates,
        "results": results,
        "warnings": warnings,
    }


class StrongWatchlistAPI:
    """常驻 Python 服务调用入口。"""

    @staticmethod
    def evaluate(dates=None, date=None, min_limit_times=2, force=False):
        if dates is None and date is not None:
            dates = [date]
        if isinstance(dates, str):
            dates = [dates]
        return _evaluate(dates=dates, min_limit_times=min_limit_times, force=force)

    @staticmethod
    def evaluate_range(start, end, min_limit_times=2, force=False):
        s = str(start).replace("-", "")[:8]
        e = str(end).replace("-", "")[:8]
        return _evaluate(dates=[s, e], min_limit_times=min_limit_times, force=force)
