#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
stock_db —— 统一本地数据存储层（SQLite 热数据/元数据 + Parquet 归档）

目录结构（强制约定）::

    stock_db/
    ├── meta.db              # SQLite：股票列表、交易日历、通用缓存、更新日志、K线元数据
    ├── daily.db             # SQLite：日线行情热数据（近期窗口，另含分钟热数据）
    ├── daily_parquet/       # 日线 Parquet 归档（按标的代码）
    │   ├── SH600519.parquet
    │   └── SZ000001.parquet
    └── minute_parquet/      # 分钟线 Parquet 归档（按日期分区）
        └── date=2026-09-25/
            ├── 600519.parquet
            └── 000001.parquet

设计原则
--------
1. **缓存未命中则请求并落库**：所有读接口先查本地库，未命中/不满足区间时由调用方
   请求上游接口，再通过本模块的写接口落库（热数据进 SQLite，历史进 Parquet）。
2. **热冷分层**：
   - SQLite 承载「热数据 + 元数据」，用于高频、小范围的读取（近期行情、股票列表、交易日历）。
   - Parquet 承载「归档 / 回测」冷数据，按标的一文件或按日期分区，列式压缩、便于批量回测。
3. **读写一致性**：K 线写入时同时更新 SQLite 热表与 Parquet 归档，SQLite 侧做
   保有期裁剪（仅当 Parquet 归档写入成功后才裁剪），读取时自动合并两者。
4. **降级可用**：未安装 pyarrow/fastparquet 时，Parquet 归档自动禁用，
   全部数据仍可正常读写（仅落在 SQLite），不影响业务。

对外主要接口
------------
- 生命周期：``set_db_root`` / ``get_db_root`` / ``init_db`` / ``db_stats``
- 通用缓存（承接旧的 JSON 文件缓存语义）：``read_cache`` / ``write_cache`` / ``delete_cache``
- 元数据：``upsert_stock_basic`` / ``load_stock_basic`` / ``get_stock_basic_maps``
- 交易日历：``upsert_trade_cal`` / ``load_trade_cal`` / ``load_trade_cal_range``
- 日线（热+归档）：``write_kline`` / ``read_kline`` / ``kline_coverage`` / ``prune_hot``
- 分钟线（热+归档）：``write_minute`` / ``read_minute`` / ``minute_has``
- 更新日志：``log_update`` / ``tail_update_log``
"""

from __future__ import annotations

import atexit
import argparse
import json
import os
import sqlite3
import sys
import threading
import time
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Tuple

try:
    import pandas as pd
except ImportError:  # pragma: no cover - pandas 为可选依赖
    pd = None


# ============================================================
# 常量与全局状态
# ============================================================

_META_DB = "meta.db"
_DAILY_DB = "daily.db"
_DAILY_PARQUET = "daily_parquet"
_MINUTE_PARQUET = "minute_parquet"

# 默认根目录：与旧缓存目录同级（~/.stexplorer/stock_db）
_DEFAULT_ROOT = os.path.join(os.path.expanduser("~"), ".stexplorer", "stock_db")
_db_root: str = _DEFAULT_ROOT
_root_lock = threading.RLock()

# 线程本地连接（每个线程独立连接，避免 sqlite3 跨线程复用问题）
_local = threading.local()

# 进程内只需建表一次
_schema_ready: Dict[str, bool] = {_META_DB: False, _DAILY_DB: False}
_schema_lock = threading.RLock()

# 命中计数（内存累计，进程退出/批量阈值时回写，避免读操作产生写放大）
_hit_buffer: Dict[str, int] = {}
_hit_lock = threading.Lock()
_HIT_FLUSH_THRESHOLD = 64

# parquet 引擎探测结果
_parquet_engine: Optional[str] = None
_parquet_checked = False
_warned: set = set()


def _warn_once(message: str) -> None:
    """同一进程内同一条告警只输出一次，避免刷屏污染 stderr。"""
    if message in _warned:
        return
    _warned.add(message)
    try:
        sys.stderr.write(f"[stock_db] {message}\n")
    except Exception:
        pass


# ============================================================
# 根目录 / 连接管理
# ============================================================

def set_db_root(storage_path: str) -> str:
    """设置存储根目录，实际数据库位于 ``<storage_path>/stock_db``。

    与旧 ``set_cache_dir`` 语义保持一致：传入的是应用本地存储根目录。
    传入空值时回退到默认目录。
    """
    global _db_root
    with _root_lock:
        if storage_path:
            _db_root = os.path.join(storage_path, "stock_db")
        else:
            _db_root = _DEFAULT_ROOT
        _ensure_dirs()
        _close_all_connections()
    return _db_root


def set_cache_dir(storage_path: str) -> str:
    """``set_db_root`` 的别名。

    ``py_service.py`` 的常驻进程会在 ``--storage-path`` 变化时自动调用 ``mod.set_cache_dir``，
    这里提供同名入口，使 stock_db 也能被同一套常驻机制正确指定存储目录。
    """
    return set_db_root(storage_path)


def get_db_root() -> str:
    """当前 stock_db 根目录。"""
    return _db_root


def _ensure_dirs() -> None:
    try:
        os.makedirs(_db_root, exist_ok=True)
        os.makedirs(os.path.join(_db_root, _DAILY_PARQUET), exist_ok=True)
        os.makedirs(os.path.join(_db_root, _MINUTE_PARQUET), exist_ok=True)
    except Exception as e:  # pragma: no cover
        _warn_once(f"创建目录失败 {_db_root}: {e}")


def _conn(db_name: str) -> sqlite3.Connection:
    """获取当前线程的数据库连接（按 db 文件维度缓存）。"""
    conns = getattr(_local, "conns", None)
    if conns is None:
        conns = {}
        _local.conns = conns
    conn = conns.get(db_name)
    if conn is not None:
        return conn
    _ensure_dirs()
    path = os.path.join(_db_root, db_name)
    conn = sqlite3.connect(path, timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    # 存储目录若位于云同步盘，WAL 产生的 -wal/-shm 易与同步工具冲突，
    # 可通过环境变量 STOCK_DB_JOURNAL=DELETE 切换为回滚日志模式（并发写入性能略降）。
    journal = (os.environ.get("STOCK_DB_JOURNAL") or "WAL").strip().upper()
    if journal not in ("WAL", "DELETE", "TRUNCATE", "PERSIST"):
        journal = "WAL"
    try:
        conn.execute(f"PRAGMA journal_mode={journal}")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=30000")
        conn.execute("PRAGMA temp_store=MEMORY")
    except Exception:
        pass
    conns[db_name] = conn
    _ensure_schema(db_name, conn)
    return conn


def _close_all_connections() -> None:
    conns = getattr(_local, "conns", None)
    if not conns:
        return
    for conn in list(conns.values()):
        try:
            conn.close()
        except Exception:
            pass
    conns.clear()


@atexit.register
def _on_exit() -> None:
    flush_hit_stats()
    try:
        _close_all_connections()
    except Exception:
        pass
    finally:
        # 逐线程无法在此统一关闭，主线程连接已释放即可
        pass


def _is_locked_error(err: Exception) -> bool:
    text = str(err).lower()
    return "locked" in text or "busy" in text


def _with_retry(fn, attempts: int = 5):
    """在数据库被占用（多进程/多线程并发）时做指数退避重试。"""
    last_err: Optional[Exception] = None
    for i in range(attempts):
        try:
            return fn()
        except sqlite3.OperationalError as e:
            if _is_locked_error(e):
                last_err = e
                time.sleep(0.1 * (2 ** i))
                continue
            raise
    if last_err is not None:
        raise last_err
    raise RuntimeError("unreachable")


def _execute(db_name: str, sql: str, params: Iterable = ()) -> None:
    def _run():
        conn = _conn(db_name)
        with conn:
            conn.execute(sql, tuple(params))
    _with_retry(_run)


def _executemany(db_name: str, sql: str, rows: List[tuple]) -> int:
    if not rows:
        return 0

    def _run():
        conn = _conn(db_name)
        with conn:
            cur = conn.executemany(sql, rows)
            return cur.rowcount if cur.rowcount is not None else 0
    return _with_retry(_run)


def _query(db_name: str, sql: str, params: Iterable = ()) -> List[sqlite3.Row]:
    def _run():
        conn = _conn(db_name)
        return conn.execute(sql, tuple(params)).fetchall()
    return _with_retry(_run)


def _query_one(db_name: str, sql: str, params: Iterable = ()) -> Optional[sqlite3.Row]:
    rows = _query(db_name, sql, params)
    return rows[0] if rows else None


# ============================================================
# 建表
# ============================================================

_SCHEMA_META = [
    # 股票基础信息（元数据，长期有效）
    """
    CREATE TABLE IF NOT EXISTS stock_basic (
        ts_code     TEXT PRIMARY KEY,
        symbol      TEXT,
        name        TEXT,
        area        TEXT,
        industry    TEXT,
        market      TEXT,
        list_date   TEXT,
        list_status TEXT DEFAULT 'L',
        updated_at  REAL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_stock_basic_symbol   ON stock_basic(symbol)",
    "CREATE INDEX IF NOT EXISTS idx_stock_basic_name     ON stock_basic(name)",
    "CREATE INDEX IF NOT EXISTS idx_stock_basic_industry ON stock_basic(industry)",

    # 交易日历
    """
    CREATE TABLE IF NOT EXISTS trade_cal (
        exchange   TEXT    NOT NULL,
        cal_date   TEXT    NOT NULL,   -- YYYY-MM-DD
        is_open    INTEGER NOT NULL DEFAULT 1,
        updated_at REAL,
        PRIMARY KEY (exchange, cal_date)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_trade_cal_date ON trade_cal(cal_date)",

    # 通用 KV 缓存：承接板块、资金流、涨跌比、市场活跃度等结构化程度低/低频的数据域
    """
    CREATE TABLE IF NOT EXISTS api_cache (
        cache_key  TEXT PRIMARY KEY,
        data_type  TEXT NOT NULL DEFAULT 'json',  -- json | dataframe
        payload    TEXT,
        expire_at  REAL,                          -- NULL 表示按调用方 max_age_hours 判定
        updated_at REAL,
        hits       INTEGER NOT NULL DEFAULT 0
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_api_cache_expire ON api_cache(expire_at)",

    # K 线元数据：记录每个标的已覆盖的日期区间，驱动增量更新与缓存有效性判定
    """
    CREATE TABLE IF NOT EXISTS kline_meta (
        kind       TEXT NOT NULL,   -- stock | index | board
        ts_code    TEXT NOT NULL,
        period     TEXT NOT NULL,   -- daily | weekly | monthly
        adjust     TEXT NOT NULL DEFAULT '',
        first_date TEXT,
        last_date  TEXT,
        row_count  INTEGER DEFAULT 0,
        archived   INTEGER DEFAULT 0,  -- Parquet 归档是否已写入
        updated_at REAL,
        PRIMARY KEY (kind, ts_code, period, adjust)
    )
    """,

    # 数据更新日志：便于排查「缓存未命中 → 请求 → 落库」的链路
    """
    CREATE TABLE IF NOT EXISTS update_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        task       TEXT NOT NULL,   -- 数据域：kline / stock_basic / trade_cal / api_cache ...
        target     TEXT,            -- 具体标的或日期
        status     TEXT NOT NULL,   -- hit | miss | fetch_ok | fetch_empty | error | archive
        rows       INTEGER DEFAULT 0,
        detail     TEXT,
        created_at REAL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_update_log_task ON update_log(task, created_at DESC)",
]

_SCHEMA_DAILY = [
    # 日线/周线/月线热数据（统一存放，以 kind+period+adjust 区分；近期窗口，支撑高频读取）
    """
    CREATE TABLE IF NOT EXISTS daily_kline (
        kind       TEXT NOT NULL,              -- stock | index | board
        ts_code    TEXT NOT NULL,
        period     TEXT NOT NULL,              -- daily | weekly | monthly
        adjust     TEXT NOT NULL DEFAULT '',   -- '' 不复权 | qfq 前复权 | hfq 后复权
        trade_date TEXT NOT NULL,              -- YYYY-MM-DD
        kp         REAL,                       -- 开盘
        sp         REAL,                       -- 收盘
        zg         REAL,                       -- 最高
        zd         REAL,                       -- 最低
        cjl        REAL,                       -- 成交量
        cje        REAL,                       -- 成交额
        zdf        REAL,                       -- 涨跌幅
        zde        REAL,                       -- 涨跌额
        hsl        REAL,                       -- 换手率
        updated_at REAL,
        PRIMARY KEY (kind, ts_code, period, adjust, trade_date)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_daily_kline_date ON daily_kline(trade_date)",
    "CREATE INDEX IF NOT EXISTS idx_daily_kline_code ON daily_kline(ts_code, period, adjust)",

    # 分钟线热数据（当日/近期分时）
    """
    CREATE TABLE IF NOT EXISTS minute_kline (
        code       TEXT NOT NULL,              -- 纯代码，如 600519
        trade_date TEXT NOT NULL,              -- YYYY-MM-DD
        trade_time TEXT NOT NULL,              -- HH:MM
        current    REAL,
        last       REAL,
        vol        REAL,
        average    REAL,
        up         INTEGER,
        updated_at REAL,
        PRIMARY KEY (code, trade_date, trade_time)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_minute_kline_date ON minute_kline(trade_date)",
]


def _ensure_schema(db_name: str, conn: sqlite3.Connection) -> None:
    with _schema_lock:
        if _schema_ready.get(db_name):
            return
        statements = _SCHEMA_META if db_name == _META_DB else _SCHEMA_DAILY
        for sql in statements:
            conn.execute(sql)
        conn.commit()
        _schema_ready[db_name] = True


def init_db() -> None:
    """显式初始化：创建目录与所有数据表。幂等。"""
    _ensure_dirs()
    _conn(_META_DB)
    _conn(_DAILY_DB)


# ============================================================
# 序列化工具
# ============================================================

class _JSONEncoder(json.JSONEncoder):
    """兼容 datetime / date / numpy / pandas 标量的 JSON 编码器。"""

    def default(self, o):  # noqa: D102
        if isinstance(o, (datetime, date)):
            return o.strftime("%Y-%m-%d %H:%M:%S") if isinstance(o, datetime) else o.strftime("%Y-%m-%d")
        if isinstance(o, timedelta):
            return o.total_seconds()
        if hasattr(o, "item"):  # numpy 标量
            try:
                return o.item()
            except Exception:
                pass
        if hasattr(o, "isoformat"):
            try:
                return o.isoformat()
            except Exception:
                pass
        return str(o)


def _df_to_records(df) -> List[Dict[str, Any]]:
    """DataFrame → list[dict]，numpy 标量转 Python 原生类型。"""
    if df is None or df.empty:
        return []
    df = df.fillna("")
    records: List[Dict[str, Any]] = []
    for _, row in df.iterrows():
        record = {}
        for col in df.columns:
            v = row.get(col)
            if hasattr(v, "item"):
                try:
                    v = v.item()
                except Exception:
                    pass
            record[col] = v
        records.append(record)
    return records


def _dumps(data: Any) -> Tuple[str, str]:
    """序列化：DataFrame 打标记，便于读取时还原。"""
    if pd is not None and isinstance(data, pd.DataFrame):
        return (
            json.dumps({"__type__": "dataframe", "records": _df_to_records(data)},
                       ensure_ascii=False, cls=_JSONEncoder),
            "dataframe",
        )
    return json.dumps(data, ensure_ascii=False, cls=_JSONEncoder), "json"


def _loads(payload: Optional[str]) -> Any:
    if payload is None:
        return None
    data = json.loads(payload)
    if isinstance(data, dict) and data.get("__type__") == "dataframe":
        records = data.get("records", [])
        if pd is None:
            return records
        return pd.DataFrame(records) if records else pd.DataFrame()
    return data


def _norm_date(value: Any) -> str:
    """标准化日期为 YYYY-MM-DD，无法解析时返回空串。"""
    if value is None or value == "":
        return ""
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    if len(text) >= 8 and text[:8].isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    text = text.replace("/", "-")
    parts = text.split("-")
    if len(parts) == 3 and all(p.isdigit() for p in parts):
        return f"{int(parts[0]):04d}-{int(parts[1]):02d}-{int(parts[2]):02d}"
    return ""


def _num(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        f = float(value)
        if f != f:  # NaN
            return None
        return f
    except (TypeError, ValueError):
        return None


# ============================================================
# Parquet 引擎与读写
# ============================================================

def _engine() -> Optional[str]:
    global _parquet_engine, _parquet_checked
    if _parquet_checked:
        return _parquet_engine
    _parquet_checked = True
    if pd is None:
        _warn_once("未安装 pandas，Parquet 归档已禁用")
        return None
    for name in ("pyarrow", "fastparquet"):
        try:
            __import__(name)
            _parquet_engine = name
            return name
        except ImportError:
            continue
    _warn_once("未安装 pyarrow/fastparquet，Parquet 归档已禁用（数据仍完整保存在 SQLite）。"
               "如需启用：pip install pyarrow")
    _parquet_engine = None
    return None


def parquet_enabled() -> bool:
    """Parquet 归档是否可用。"""
    return _engine() is not None


def _write_parquet(path: str, records: List[Dict[str, Any]], columns: Optional[List[str]] = None) -> bool:
    eng = _engine()
    if eng is None or not records:
        return False
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        df = pd.DataFrame(records)
        if columns:
            for col in columns:
                if col not in df.columns:
                    df[col] = None
            df = df[list(columns)]
        tmp = f"{path}.tmp{os.getpid()}"
        df.to_parquet(tmp, engine=eng, index=False)
        os.replace(tmp, path)
        return True
    except Exception as e:  # pragma: no cover
        _warn_once(f"写入 Parquet 失败 {path}: {e}")
        return False


def _read_parquet(path: str) -> List[Dict[str, Any]]:
    eng = _engine()
    if eng is None or not os.path.exists(path):
        return []
    try:
        df = pd.read_parquet(path, engine=eng)
        return _df_to_records(df)
    except Exception as e:  # pragma: no cover
        _warn_once(f"读取 Parquet 失败 {path}: {e}")
        return []


def _code_to_stem(ts_code: str) -> str:
    """ts_code → 文件名主干。

    ``600519.SH`` → ``SH600519``、``000001.SZ`` → ``SZ000001``、
    ``931068.CSI`` → ``CSI931068``、``BK0475.DC`` → ``DCBK0475``。
    """
    if not ts_code:
        return "UNKNOWN"
    text = str(ts_code).strip().upper()
    if "." in text:
        code, suffix = text.split(".", 1)
        if suffix in ("SH", "SZ", "BJ", "CSI", "DC", "THS"):
            return f"{suffix}{code}"
        return f"{suffix}{code}"
    return text


_KLINE_ARCHIVE_COLUMNS = ["date", "kp", "sp", "zg", "zd", "cjl", "cje", "zdf", "zde", "hsl"]


def _kline_archive_path(kind: str, ts_code: str, period: str, adjust: str) -> str:
    """日线归档文件路径：<root>/daily_parquet/[前缀]{EXCHANGE}{CODE}[.period][.adjust].parquet"""
    stem = _code_to_stem(ts_code)
    prefix = {"stock": "", "index": "IDX_", "board": "BK_"}.get(kind or "stock", "")
    suffix = ""
    if period and period != "daily":
        suffix += f".{period}"
    # qfq 为业务默认复权方式，省略后缀，使个股日线文件名保持 SH600519.parquet 形式
    if adjust and adjust != "qfq":
        suffix += f".{adjust}"
    return os.path.join(_db_root, _DAILY_PARQUET, f"{prefix}{stem}{suffix}.parquet")


def _minute_archive_path(code: str, trade_date: str) -> str:
    """分钟线归档路径：<root>/minute_parquet/date=YYYY-MM-DD/{code}.parquet"""
    return os.path.join(_db_root, _MINUTE_PARQUET, f"date={trade_date}", f"{code}.parquet")


# ============================================================
# 通用 KV 缓存（承接旧的 read_cache / write_cache）
# ============================================================

def write_cache(cache_key: str, data: Any, updated_at: Optional[float] = None) -> None:
    """写入通用缓存。DataFrame 会自动打标记，读取时还原为 DataFrame。

    ``updated_at`` 可显式指定写入时间（epoch 秒），用于历史数据迁移时保留原始时间戳，
    使 max_age_hours 的 TTL 语义与迁移前一致。为 None 时取当前时间。
    """
    try:
        payload, data_type = _dumps(data)
    except Exception as e:
        _warn_once(f"缓存序列化失败 {cache_key}: {e}")
        return
    now = time.time() if updated_at is None else float(updated_at)

    def _run():
        conn = _conn(_META_DB)
        with conn:
            conn.execute(
                "INSERT INTO api_cache(cache_key, data_type, payload, expire_at, updated_at, hits) "
                "VALUES(?,?,?,NULL,?,0) "
                "ON CONFLICT(cache_key) DO UPDATE SET "
                "  data_type=excluded.data_type, payload=excluded.payload, updated_at=excluded.updated_at",
                (cache_key, data_type, payload, now),
            )
    try:
        _with_retry(_run)
    except Exception as e:  # pragma: no cover
        _warn_once(f"写入缓存失败 {cache_key}: {e}")


def read_cache(cache_key: str, max_age_hours: int = 168) -> Optional[Any]:
    """读取通用缓存，``max_age_hours`` 内视为新鲜；未命中/过期返回 None。"""
    try:
        row = _query_one(
            _META_DB,
            "SELECT data_type, payload, updated_at FROM api_cache WHERE cache_key=?",
            (cache_key,),
        )
    except Exception as e:  # pragma: no cover
        _warn_once(f"读取缓存失败 {cache_key}: {e}")
        return None
    if row is None:
        return None
    if max_age_hours is not None and max_age_hours >= 0:
        age_hours = (time.time() - (row["updated_at"] or 0)) / 3600.0
        if age_hours > max_age_hours:
            return None
    _bump_hit(cache_key)
    try:
        return _loads(row["payload"])
    except Exception:
        return None


def cache_updated_at(cache_key: str) -> float:
    """返回缓存条目的写入时间（epoch 秒），不存在返回 0。

    替代旧文件缓存的 ``os.path.getmtime(path)``，用于「当天数据 1 小时时效」这类细粒度判断。
    """
    try:
        row = _query_one(_META_DB, "SELECT updated_at FROM api_cache WHERE cache_key=?", (cache_key,))
    except Exception:
        return 0.0
    return float(row["updated_at"]) if row and row["updated_at"] else 0.0


def delete_cache(cache_key: str) -> None:
    _execute(_META_DB, "DELETE FROM api_cache WHERE cache_key=?", (cache_key,))


def purge_expired() -> int:
    """清理超过 90 天未更新的通用缓存条目，返回删除行数。"""
    cutoff = time.time() - 90 * 86400
    row = _query_one(_META_DB, "SELECT COUNT(*) AS c FROM api_cache WHERE updated_at < ?", (cutoff,))
    count = int(row["c"]) if row else 0
    if count:
        _execute(_META_DB, "DELETE FROM api_cache WHERE updated_at < ?", (cutoff,))
    return count


def _bump_hit(cache_key: str) -> None:
    with _hit_lock:
        _hit_buffer[cache_key] = _hit_buffer.get(cache_key, 0) + 1
        total = sum(_hit_buffer.values())
        pending = dict(_hit_buffer) if total >= _HIT_FLUSH_THRESHOLD else None
        if pending is not None:
            _hit_buffer.clear()
    if pending is not None:
        _flush_pending(pending)


def _flush_pending(pending: Dict[str, int]) -> None:
    try:
        conn = _conn(_META_DB)
        with conn:
            conn.executemany(
                "UPDATE api_cache SET hits = hits + ? WHERE cache_key = ?",
                [(inc, key) for key, inc in pending.items()],
            )
    except Exception:
        pass


def flush_hit_stats() -> None:
    """把内存中的命中计数回写到数据库。"""
    with _hit_lock:
        pending = dict(_hit_buffer)
        _hit_buffer.clear()
    if pending:
        _flush_pending(pending)


# ============================================================
# 股票基础信息
# ============================================================

def upsert_stock_basic(records: List[Dict[str, Any]], updated_at: Optional[float] = None) -> int:
    """写入/更新股票列表。records 需含 ts_code，可选 symbol/name/area/industry/market/list_date。

    ``updated_at`` 可显式指定更新时间（epoch 秒），用于数据迁移。
    """
    if not records:
        return 0
    now = time.time() if updated_at is None else float(updated_at)
    rows = []
    for rec in records:
        ts_code = str(rec.get("ts_code", "")).strip()
        if not ts_code:
            continue
        rows.append((
            ts_code,
            str(rec.get("symbol", "") or ""),
            str(rec.get("name", "") or ""),
            str(rec.get("area", "") or ""),
            str(rec.get("industry", "") or ""),
            str(rec.get("market", "") or ""),
            _norm_date(rec.get("list_date")) or str(rec.get("list_date", "") or ""),
            str(rec.get("list_status", "L") or "L"),
            now,
        ))
    if not rows:
        return 0
    return _executemany(
        _META_DB,
        "INSERT INTO stock_basic(ts_code, symbol, name, area, industry, market, list_date, list_status, updated_at) "
        "VALUES(?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(ts_code) DO UPDATE SET "
        "  symbol=excluded.symbol, name=excluded.name, area=excluded.area, industry=excluded.industry, "
        "  market=excluded.market, list_date=excluded.list_date, list_status=excluded.list_status, "
        "  updated_at=excluded.updated_at",
        rows,
    )


def load_stock_basic() -> List[Dict[str, Any]]:
    """读取全部股票列表。"""
    rows = _query(_META_DB, "SELECT * FROM stock_basic ORDER BY ts_code")
    return [dict(r) for r in rows]


def stock_basic_count() -> int:
    row = _query_one(_META_DB, "SELECT COUNT(*) AS c FROM stock_basic")
    return int(row["c"]) if row else 0


def stock_basic_updated_at() -> float:
    row = _query_one(_META_DB, "SELECT MAX(updated_at) AS t FROM stock_basic")
    return float(row["t"]) if row and row["t"] else 0.0


def get_stock_basic_maps() -> Tuple[Dict[str, str], Dict[str, str]]:
    """返回 (name_map, industry_map)，均为 ts_code → 值。"""
    rows = _query(_META_DB, "SELECT ts_code, name, industry FROM stock_basic")
    name_map = {r["ts_code"]: r["name"] or "" for r in rows}
    industry_map = {r["ts_code"]: r["industry"] or "" for r in rows}
    return name_map, industry_map


# ============================================================
# 交易日历
# ============================================================

def upsert_trade_cal(dates: Iterable[Any], exchange: str = "SSE", is_open: int = 1,
                     updated_at: Optional[float] = None) -> int:
    """写入交易日历。dates 元素可为 YYYYMMDD / YYYY-MM-DD / date / datetime。"""
    now = time.time() if updated_at is None else float(updated_at)
    rows = []
    for d in dates:
        norm = _norm_date(d)
        if norm:
            rows.append((exchange, norm, int(is_open), now))
    rows = list(dict.fromkeys(rows))
    if not rows:
        return 0
    return _executemany(
        _META_DB,
        "INSERT INTO trade_cal(exchange, cal_date, is_open, updated_at) VALUES(?,?,?,?) "
        "ON CONFLICT(exchange, cal_date) DO UPDATE SET "
        "  is_open=excluded.is_open, updated_at=excluded.updated_at",
        rows,
    )


def load_trade_cal(year: Optional[int] = None, exchange: str = "SSE") -> List[str]:
    """读取交易日（升序）。year 为空表示全部。"""
    if year is not None:
        rows = _query(
            _META_DB,
            "SELECT cal_date FROM trade_cal WHERE exchange=? AND is_open=1 AND cal_date LIKE ? ORDER BY cal_date",
            (exchange, f"{year}-%"),
        )
    else:
        rows = _query(
            _META_DB,
            "SELECT cal_date FROM trade_cal WHERE exchange=? AND is_open=1 ORDER BY cal_date",
            (exchange,),
        )
    return [r["cal_date"] for r in rows]


def load_trade_cal_range(start: Any, end: Any, exchange: str = "SSE") -> List[str]:
    """按区间读取交易日（升序）。"""
    start_norm, end_norm = _norm_date(start), _norm_date(end)
    rows = _query(
        _META_DB,
        "SELECT cal_date FROM trade_cal WHERE exchange=? AND is_open=1 AND cal_date>=? AND cal_date<=? "
        "ORDER BY cal_date",
        (exchange, start_norm, end_norm),
    )
    return [r["cal_date"] for r in rows]


def trade_cal_bounds(exchange: str = "SSE") -> Tuple[str, str]:
    """交易日历已覆盖的区间 (min, max)，无数据返回 ('','')。"""
    row = _query_one(
        _META_DB,
        "SELECT MIN(cal_date) AS lo, MAX(cal_date) AS hi FROM trade_cal WHERE exchange=? AND is_open=1",
        (exchange,),
    )
    if not row or not row["lo"]:
        return "", ""
    return row["lo"], row["hi"]


def trade_cal_updated_at(year: Optional[int] = None, exchange: str = "SSE") -> float:
    """交易日历最近更新时间（用于判断当年数据是否需要刷新）。"""
    if year is not None:
        row = _query_one(
            _META_DB,
            "SELECT MAX(updated_at) AS t FROM trade_cal WHERE exchange=? AND cal_date LIKE ?",
            (exchange, f"{year}-%"),
        )
    else:
        row = _query_one(
            _META_DB,
            "SELECT MAX(updated_at) AS t FROM trade_cal WHERE exchange=?",
            (exchange,),
        )
    return float(row["t"]) if row and row["t"] else 0.0


# ============================================================
# K 线：热数据（SQLite）+ 归档（Parquet）
# ============================================================

def _kline_row(record: Dict[str, Any], kind: str, ts_code: str, period: str, adjust: str, now: float) -> Optional[tuple]:
    day = _norm_date(record.get("date") or record.get("trade_date"))
    if not day:
        return None
    return (
        kind, ts_code, period, adjust or "", day,
        _num(record.get("kp", record.get("open"))),
        _num(record.get("sp", record.get("close"))),
        _num(record.get("zg", record.get("high"))),
        _num(record.get("zd", record.get("low"))),
        _num(record.get("cjl", record.get("vol"))),
        _num(record.get("cje", record.get("amount"))),
        _num(record.get("zdf", record.get("pct_chg"))),
        _num(record.get("zde", record.get("change"))),
        _num(record.get("hsl", record.get("turnover_rate"))),
        now,
    )


def write_kline(kind: str, ts_code: str, period: str, adjust: str, records: List[Dict[str, Any]],
                prune: bool = True) -> int:
    """写入 K 线：同时更新 SQLite 热表与 Parquet 归档。

    返回本次写入热表的行数。归档写入成功后可对热表做保有期裁剪，控制 daily.db 体积。
    """
    if not records or not ts_code:
        return 0
    now = time.time()
    rows = [r for r in (_kline_row(rec, kind, ts_code, period, adjust, now) for rec in records) if r is not None]
    if not rows:
        return 0
    written = _executemany(
        _DAILY_DB,
        "INSERT INTO daily_kline(kind, ts_code, period, adjust, trade_date, kp, sp, zg, zd, cjl, cje, zdf, zde, hsl, updated_at) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(kind, ts_code, period, adjust, trade_date) DO UPDATE SET "
        "  kp=excluded.kp, sp=excluded.sp, zg=excluded.zg, zd=excluded.zd, cjl=excluded.cjl, "
        "  cje=excluded.cje, zdf=excluded.zdf, zde=excluded.zde, hsl=excluded.hsl, updated_at=excluded.updated_at",
        rows,
    )

    # 归档：读取已有 Parquet，合并去重后整体覆写（保证归档为全量历史）
    archived = 0
    if period == "daily":
        path = _kline_archive_path(kind, ts_code, period, adjust)
        incoming = [{"date": r[4], "kp": r[5], "sp": r[6], "zg": r[7], "zd": r[8],
                     "cjl": r[9], "cje": r[10], "zdf": r[11], "zde": r[12], "hsl": r[13]} for r in rows]
        existing = {rec["date"]: rec for rec in _read_parquet(path) if rec.get("date")}
        for rec in incoming:
            existing[rec["date"]] = rec
        merged = [existing[d] for d in sorted(existing)]
        if _write_parquet(path, merged, _KLINE_ARCHIVE_COLUMNS):
            archived = 1
    elif not _read_parquet(_kline_archive_path(kind, ts_code, period, adjust)):
        # 周线/月线（以及指数、板块）同样归档，保持回测可用
        path = _kline_archive_path(kind, ts_code, period, adjust)
        incoming = [{"date": r[4], "kp": r[5], "sp": r[6], "zg": r[7], "zd": r[8],
                     "cjl": r[9], "cje": r[10], "zdf": r[11], "zde": r[12], "hsl": r[13]} for r in rows]
        existing = {rec["date"]: rec for rec in _read_parquet(path) if rec.get("date")}
        for rec in incoming:
            existing[rec["date"]] = rec
        merged = [existing[d] for d in sorted(existing)]
        if _write_parquet(path, merged, _KLINE_ARCHIVE_COLUMNS):
            archived = 1

    _update_kline_meta(kind, ts_code, period, adjust, archived)
    if prune and archived and period == "daily":
        prune_hot(kind, ts_code, period, adjust)
    return written


def _update_kline_meta(kind: str, ts_code: str, period: str, adjust: str, archived: int) -> None:
    row = _query_one(
        _DAILY_DB,
        "SELECT MIN(trade_date) AS lo, MAX(trade_date) AS hi, COUNT(*) AS c FROM daily_kline "
        "WHERE kind=? AND ts_code=? AND period=? AND adjust=?",
        (kind, ts_code, period, adjust or ""),
    )
    lo = row["lo"] if row else None
    hi = row["hi"] if row else None
    count = int(row["c"]) if row and row["c"] else 0
    _execute(
        _META_DB,
        "INSERT INTO kline_meta(kind, ts_code, period, adjust, first_date, last_date, row_count, archived, updated_at) "
        "VALUES(?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(kind, ts_code, period, adjust) DO UPDATE SET "
        "  first_date=excluded.first_date, last_date=excluded.last_date, row_count=excluded.row_count, "
        "  archived=MAX(kline_meta.archived, excluded.archived), updated_at=excluded.updated_at",
        (kind, ts_code, period, adjust or "", lo, hi, count, int(archived), time.time()),
    )


def read_kline(kind: str, ts_code: str, period: str = "daily", adjust: str = "",
               start: Any = None, end: Any = None) -> List[Dict[str, Any]]:
    """读取 K 线（升序）：SQLite 热数据为主，必要时合并 Parquet 归档。

    返回结构与旧缓存完全一致：``[{date,kp,sp,zg,zd,cjl,cje,zdf,zde,hsl}, ...]``。
    """
    if not ts_code:
        return []
    start_norm, end_norm = _norm_date(start), _norm_date(end)
    where = "kind=? AND ts_code=? AND period=? AND adjust=?"
    params: List[Any] = [kind, ts_code, period, adjust or ""]
    if start_norm:
        where += " AND trade_date>=?"
        params.append(start_norm)
    if end_norm:
        where += " AND trade_date<=?"
        params.append(end_norm)
    rows = _query(
        _DAILY_DB,
        f"SELECT trade_date, kp, sp, zg, zd, cjl, cje, zdf, zde, hsl FROM daily_kline "
        f"WHERE {where} ORDER BY trade_date ASC",
        params,
    )
    hot = [{
        "date": r["trade_date"], "kp": r["kp"], "sp": r["sp"], "zg": r["zg"], "zd": r["zd"],
        "cjl": r["cjl"], "cje": r["cje"], "zdf": r["zdf"], "zde": r["zde"], "hsl": r["hsl"],
    } for r in rows]

    # 请求区间早于热数据起点（或热数据为空）时，补读归档
    need_archive = True
    if hot and start_norm and hot[0]["date"] <= start_norm:
        need_archive = False
    if not need_archive:
        return hot

    archive = _read_parquet(_kline_archive_path(kind, ts_code, period, adjust))
    if not archive:
        return hot
    merged: Dict[str, Dict[str, Any]] = {}
    for rec in archive:
        day = _norm_date(rec.get("date"))
        if not day:
            continue
        if start_norm and day < start_norm:
            continue
        if end_norm and day > end_norm:
            continue
        merged[day] = {
            "date": day, "kp": _num(rec.get("kp")), "sp": _num(rec.get("sp")),
            "zg": _num(rec.get("zg")), "zd": _num(rec.get("zd")), "cjl": _num(rec.get("cjl")),
            "cje": _num(rec.get("cje")), "zdf": _num(rec.get("zdf")),
            "zde": _num(rec.get("zde")), "hsl": _num(rec.get("hsl")),
        }
    for rec in hot:
        merged[rec["date"]] = rec  # 热数据覆盖同日期
    return [merged[d] for d in sorted(merged)]


def kline_coverage(kind: str, ts_code: str, period: str = "daily", adjust: str = "") -> Optional[Dict[str, Any]]:
    """返回该标的热数据覆盖区间；无记录返回 None。"""
    row = _query_one(
        _META_DB,
        "SELECT first_date, last_date, row_count, archived, updated_at FROM kline_meta "
        "WHERE kind=? AND ts_code=? AND period=? AND adjust=?",
        (kind, ts_code, period, adjust or ""),
    )
    if row is None:
        return None
    return {
        "first_date": row["first_date"], "last_date": row["last_date"],
        "row_count": row["row_count"] or 0, "archived": int(row["archived"] or 0),
        "updated_at": row["updated_at"] or 0,
    }


_HOT_RETENTION_DAYS = {"stock": 400, "index": 1200, "board": 800}


def prune_hot(kind: str, ts_code: str, period: str = "daily", adjust: str = "") -> int:
    """裁剪热表保有期之外的旧数据（归档已保存全量），控制 daily.db 体积。"""
    days = _HOT_RETENTION_DAYS.get(kind, 400)
    cutoff = (date.today() - timedelta(days=days)).strftime("%Y-%m-%d")
    row = _query_one(
        _DAILY_DB,
        "SELECT COUNT(*) AS c FROM daily_kline WHERE kind=? AND ts_code=? AND period=? AND adjust=? AND trade_date<?",
        (kind, ts_code, period, adjust or "", cutoff),
    )
    count = int(row["c"]) if row and row["c"] else 0
    if count:
        _execute(
            _DAILY_DB,
            "DELETE FROM daily_kline WHERE kind=? AND ts_code=? AND period=? AND adjust=? AND trade_date<?",
            (kind, ts_code, period, adjust or "", cutoff),
        )
    return count


def prune_hot_all() -> int:
    """按保有期裁剪全部热数据，返回删除行数。"""
    total = 0
    for kind, days in _HOT_RETENTION_DAYS.items():
        cutoff = (date.today() - timedelta(days=days)).strftime("%Y-%m-%d")
        row = _query_one(
            _DAILY_DB,
            "SELECT COUNT(*) AS c FROM daily_kline WHERE kind=? AND trade_date<?",
            (kind, cutoff),
        )
        count = int(row["c"]) if row and row["c"] else 0
        if count:
            _execute(_DAILY_DB, "DELETE FROM daily_kline WHERE kind=? AND trade_date<?", (kind, cutoff))
            total += count
    return total


def kline_count(kind: str, ts_code: str, period: str = "daily", adjust: str = "") -> int:
    row = _query_one(
        _DAILY_DB,
        "SELECT COUNT(*) AS c FROM daily_kline WHERE kind=? AND ts_code=? AND period=? AND adjust=?",
        (kind, ts_code, period, adjust or ""),
    )
    return int(row["c"]) if row else 0


# ============================================================
# 分钟线：热数据（SQLite）+ 归档（Parquet，按日期分区）
# ============================================================

def write_minute(code: str, trade_date: str, records: List[Dict[str, Any]]) -> int:
    """写入分钟线：SQLite 热表 + ``minute_parquet/date=YYYY-MM-DD/{code}.parquet``。

    records 元素需含 ``datetime``（"YYYY-MM-DD HH:MM" 或 "HH:MM"）与 current/last/vol/average/up。
    """
    if not code or not records:
        return 0
    day = _norm_date(trade_date)
    if not day:
        return 0
    now = time.time()
    rows = []
    for rec in records:
        raw = str(rec.get("datetime") or rec.get("trade_time") or "")
        hhmm = raw[-5:] if len(raw) >= 5 else raw
        if ":" not in hhmm:
            continue
        rows.append((
            str(code), day, hhmm,
            _num(rec.get("current")), _num(rec.get("last")), _num(rec.get("vol")),
            _num(rec.get("average")), int(rec.get("up") or 0), now,
        ))
    if not rows:
        return 0
    written = _executemany(
        _DAILY_DB,
        "INSERT INTO minute_kline(code, trade_date, trade_time, current, last, vol, average, up, updated_at) "
        "VALUES(?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(code, trade_date, trade_time) DO UPDATE SET "
        "  current=excluded.current, last=excluded.last, vol=excluded.vol, "
        "  average=excluded.average, up=excluded.up, updated_at=excluded.updated_at",
        rows,
    )
    archived = [{
        "datetime": f"{day} {r[2]}", "current": r[3], "last": r[4],
        "vol": r[5], "average": r[6], "up": r[7],
    } for r in rows]
    _write_parquet(
        _minute_archive_path(str(code), day),
        archived,
        ["datetime", "current", "last", "vol", "average", "up"],
    )
    return written


def read_minute(code: str, trade_date: str) -> List[Dict[str, Any]]:
    """读取某日分钟线（升序）：优先热表，缺失时回退 Parquet 归档。"""
    day = _norm_date(trade_date)
    if not code or not day:
        return []
    rows = _query(
        _DAILY_DB,
        "SELECT trade_time, current, last, vol, average, up FROM minute_kline "
        "WHERE code=? AND trade_date=? ORDER BY trade_time ASC",
        (str(code), day),
    )
    if rows:
        return [{
            "datetime": f"{day} {r['trade_time']}", "current": r["current"], "last": r["last"],
            "vol": r["vol"], "average": r["average"], "up": r["up"],
        } for r in rows]
    archive = _read_parquet(_minute_archive_path(str(code), day))
    return sorted(archive, key=lambda x: str(x.get("datetime", "")))


def minute_has(code: str, trade_date: str) -> bool:
    day = _norm_date(trade_date)
    if not code or not day:
        return False
    row = _query_one(
        _DAILY_DB,
        "SELECT COUNT(*) AS c FROM minute_kline WHERE code=? AND trade_date=?",
        (str(code), day),
    )
    if row and row["c"]:
        return True
    return os.path.exists(_minute_archive_path(str(code), day))


# ============================================================
# 更新日志
# ============================================================

def log_update(task: str, target: str = "", status: str = "", rows: int = 0, detail: str = "") -> None:
    """记录一次数据更新（hit/miss/fetch_ok/fetch_empty/error/archive）。"""
    try:
        _execute(
            _META_DB,
            "INSERT INTO update_log(task, target, status, rows, detail, created_at) VALUES(?,?,?,?,?,?)",
            (task, target, status, int(rows), detail[:500] if detail else "", time.time()),
        )
    except Exception:
        pass


def tail_update_log(limit: int = 50) -> List[Dict[str, Any]]:
    rows = _query(
        _META_DB,
        "SELECT task, target, status, rows, detail, created_at FROM update_log ORDER BY id DESC LIMIT ?",
        (int(limit),),
    )
    return [dict(r) for r in rows]


def clear_update_log(keep_days: int = 7) -> int:
    cutoff = time.time() - keep_days * 86400
    row = _query_one(_META_DB, "SELECT COUNT(*) AS c FROM update_log WHERE created_at < ?", (cutoff,))
    count = int(row["c"]) if row else 0
    if count:
        _execute(_META_DB, "DELETE FROM update_log WHERE created_at < ?", (cutoff,))
    return count


# ============================================================
# 统计与运维
# ============================================================

def db_stats() -> Dict[str, Any]:
    """输出各库/各表规模与归档文件数量，用于自检。"""
    flush_hit_stats()
    stats: Dict[str, Any] = {
        "root": _db_root,
        "parquet_enabled": parquet_enabled(),
        "parquet_engine": _parquet_engine,
        "tables": {},
        "archives": {},
    }
    for db_name, table in (
        (_META_DB, "stock_basic"), (_META_DB, "trade_cal"), (_META_DB, "api_cache"),
        (_META_DB, "kline_meta"), (_META_DB, "update_log"),
        (_DAILY_DB, "daily_kline"), (_DAILY_DB, "minute_kline"),
    ):
        try:
            row = _query_one(db_name, f"SELECT COUNT(*) AS c FROM {table}")
            stats["tables"][table] = int(row["c"]) if row else 0
        except Exception as e:
            stats["tables"][table] = f"error: {e}"
    for key, folder in (("daily_parquet", _DAILY_PARQUET), ("minute_parquet", _MINUTE_PARQUET)):
        path = os.path.join(_db_root, folder)
        files = 0
        size = 0
        if os.path.isdir(path):
            for dirpath, _dirs, filenames in os.walk(path):
                for fn in filenames:
                    if fn.endswith(".parquet"):
                        files += 1
                        try:
                            size += os.path.getsize(os.path.join(dirpath, fn))
                        except OSError:
                            pass
        stats["archives"][key] = {"files": files, "size_mb": round(size / 1048576.0, 2)}
    for db_name in (_META_DB, _DAILY_DB):
        path = os.path.join(_db_root, db_name)
        stats[f"{db_name}_size_mb"] = round(os.path.getsize(path) / 1048576.0, 2) if os.path.exists(path) else 0.0
    return stats


def vacuum() -> None:
    """整理碎片，回收 SQLite 空间。"""
    for db_name in (_META_DB, _DAILY_DB):
        try:
            conn = _conn(db_name)
            conn.execute("VACUUM")
        except Exception as e:  # pragma: no cover
            _warn_once(f"VACUUM {db_name} 失败: {e}")


# ============================================================
# 主进程通用 KV 缓存接口（渲染进程 readCache / writeCache 的落库实现）
# ============================================================

def _now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S.") + f"{datetime.now().microsecond // 1000:03d}Z"


class CacheAPI:
    """供 ``py_service.py`` 常驻进程调用的通用 KV 缓存接口。

    存储位置与 tushare 数据一致：``stock_db/meta.db`` 的 ``api_cache`` 表。
    返回结构与旧文件缓存完全一致，渲染进程无需改动：

        {"data": <业务数据>, "cachedAt": <ISO 时间字符串>}

    对应旧的 ``backups/backtest_cache/{key}.json`` 内容格式。
    """

    def get(self, key: str) -> Optional[Any]:
        """读取缓存；不存在返回 None。不做 TTL 判定（时效由调用方自行判断）。"""
        return read_cache(key, max_age_hours=-1)

    def put(self, key: str, data: Any = None, cachedAt: Optional[str] = None) -> bool:
        """写入缓存，自动包一层 ``{data, cachedAt}`` 信封。"""
        if not key:
            return False
        payload = {"data": data, "cachedAt": cachedAt or _now_iso()}
        write_cache(key, payload)
        return True

    def put_many(self, items: Optional[List[Dict[str, Any]]] = None) -> int:
        """批量写入。items 为 ``[{"key":..., "data":..., "cachedAt":...}]``。"""
        count = 0
        for item in items or []:
            if isinstance(item, dict) and item.get("key") and self.put(
                item["key"], item.get("data"), item.get("cachedAt")
            ):
                count += 1
        return count

    def get_raw(self, key: str) -> Optional[Any]:
        """读取原始值（不做 ``{data, cachedAt}`` 信封包装）。

        用于主进程「本地数据」层（旧 ``<table>_<id>.json`` 文件），
        其内容形如 ``{"lastModified": ..., "data": ...}``，需原样存取。
        """
        return read_cache(key, max_age_hours=-1)

    def put_raw(self, key: str, value: Any = None) -> bool:
        """原样写入任意 JSON 值（不包装信封）。"""
        if not key:
            return False
        write_cache(key, value)
        return True

    def delete(self, key: str) -> bool:
        delete_cache(key)
        return True

    def keys(self, prefix: str = "") -> List[str]:
        """列出（可按前缀过滤）已缓存的 key。"""
        try:
            if prefix:
                rows = _query(
                    _META_DB,
                    "SELECT cache_key FROM api_cache WHERE cache_key LIKE ? ORDER BY cache_key",
                    (f"{prefix}%",),
                )
            else:
                rows = _query(_META_DB, "SELECT cache_key FROM api_cache ORDER BY cache_key")
        except Exception:
            return []
        return [r["cache_key"] for r in rows]

    def info(self) -> Dict[str, Any]:
        """缓存规模信息，便于主进程诊断。"""
        row = _query_one(_META_DB, "SELECT COUNT(*) AS c FROM api_cache")
        return {"root": _db_root, "entries": int(row["c"]) if row else 0}


# ============================================================
# CLI：自检 / 运维
# ============================================================

def main() -> None:
    parser = argparse.ArgumentParser(description="stock_db 本地数据存储层自检工具")
    parser.add_argument("action", nargs="?", default="stats",
                        choices=["init", "stats", "purge", "prune", "vacuum", "log"],
                        help="init 建库 | stats 统计 | purge 清理过期缓存 | prune 裁剪热数据 | vacuum 整理 | log 更新日志")
    parser.add_argument("--storage-path", "-s", default=None, help="本地存储根目录（数据落在其下 stock_db/）")
    parser.add_argument("--limit", "-n", type=int, default=30, help="log 动作显示的条数")
    args = parser.parse_args()

    if args.storage_path:
        set_db_root(args.storage_path)
    init_db()

    if args.action == "init":
        result: Any = {"ok": True, "root": _db_root}
    elif args.action == "purge":
        result = {"removed_cache_rows": purge_expired(), "removed_log_rows": clear_update_log()}
    elif args.action == "prune":
        result = {"removed_kline_rows": prune_hot_all()}
    elif args.action == "vacuum":
        vacuum()
        result = {"ok": True}
    elif args.action == "log":
        result = tail_update_log(args.limit)
    else:
        result = db_stats()

    print(json.dumps(result, ensure_ascii=False, indent=2, cls=_JSONEncoder))


if __name__ == "__main__":
    main()
