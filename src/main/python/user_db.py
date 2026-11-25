#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
独立「用户数据库」——只存用户数据，不碰行情/板块/技术指标。

与 stock_db 的职责划分：
- stock_db（meta.db / daily.db / *_parquet）：分时、日K、板块成分、列表、技术指标等股票数据；
- user_db（user_data.db）：收藏、标签、配置、复盘、盘前分析、训练进度、买卖记录等用户数据。

落盘位置：``<storage>/user_db/user_data.db``（storage 由 py_service 的 --storage-path 指定）。
接口通过 py_service 常驻进程暴露，与 stock_db 的 CacheAPI 同构：
    get(key) / put(key, value) / delete(key) / keys(prefix) / all() / info()
其中 value 是任意 JSON 值，内部原样保存（不额外包装信封），由调用方决定结构。

设计要点：
1. 与 stock_db 完全独立的 sqlite 文件和连接，互不影响；
2. WAL 模式 + 线程本地连接与 stock_db 一致；
3. 幂等 upsert，重复迁移/写入结果一致；
4. 提供 migrate_from_stock_db() 把旧版写在 stock_db/api_cache 的 ``local:`` 前缀
   用户数据一次性搬到本库；主进程调用后旧 key 保留（可回滚），由运维脚本决定是否清理。
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import threading
from typing import Any, Dict, List, Optional

_DB_NAME = "user_data.db"
_DEFAULT_ROOT = os.path.join(os.path.expanduser("~"), ".stexplorer", "user_db")
_db_root: str = _DEFAULT_ROOT
_root_lock = threading.RLock()
_local = threading.local()
_schema_ready = False
_schema_lock = threading.RLock()


def _now_iso() -> str:
    from datetime import datetime

    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def set_db_root(storage_path: str) -> str:
    """设置用户库根目录；传入应用存储根路径时实际落在 ``<storage>/user_db``。"""
    global _db_root, _schema_ready
    with _root_lock:
        _db_root = os.path.join(storage_path, "user_db") if storage_path else _DEFAULT_ROOT
        os.makedirs(_db_root, exist_ok=True)
        _close_all_connections()
        with _schema_lock:
            _schema_ready = False
    return _db_root


def set_cache_dir(storage_path: str) -> str:
    """与 stock_db 对齐的别名，供 py_service 在 --storage-path 变化时调用。"""
    return set_db_root(storage_path)


def get_db_root() -> str:
    return _db_root


def _db_path() -> str:
    return os.path.join(_db_root, _DB_NAME)


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path(), timeout=30, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


def _conn() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = _connect()
        _local.conn = conn
    return conn


def _close_all_connections() -> None:
    conn = getattr(_local, "conn", None)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass
        _local.conn = None


def _ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        os.makedirs(_db_root, exist_ok=True)
        _conn().execute(
            """
            CREATE TABLE IF NOT EXISTS user_data (
                data_key TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        _schema_ready = True


def _decode(raw: Optional[str]) -> Any:
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return raw


class UserDataAPI:
    """供 py_service 常驻进程调用的用户数据读写接口。"""

    def get(self, key: str) -> Optional[Any]:
        _ensure_schema()
        if not key:
            return None
        row = _conn().execute("SELECT payload FROM user_data WHERE data_key=?", (key,)).fetchone()
        return _decode(row["payload"]) if row else None

    def put(self, key: str, value: Any = None) -> bool:
        _ensure_schema()
        if not key:
            return False
        payload = json.dumps(value, ensure_ascii=False, default=str)
        _conn().execute(
            "INSERT INTO user_data(data_key,payload,updated_at) VALUES(?,?,?) "
            "ON CONFLICT(data_key) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
            (key, payload, _now_iso()),
        )
        return True

    def put_many(self, items: Optional[List[Dict[str, Any]]] = None) -> int:
        count = 0
        for item in items or []:
            if isinstance(item, dict) and item.get("key") and self.put(item["key"], item.get("value")):
                count += 1
        return count

    def delete(self, key: str) -> bool:
        _ensure_schema()
        if not key:
            return False
        _conn().execute("DELETE FROM user_data WHERE data_key=?", (key,))
        return True

    def keys(self, prefix: str = "") -> List[str]:
        _ensure_schema()
        if prefix:
            rows = _conn().execute(
                "SELECT data_key FROM user_data WHERE data_key LIKE ? ORDER BY data_key", (f"{prefix}%",)
            ).fetchall()
        else:
            rows = _conn().execute("SELECT data_key FROM user_data ORDER BY data_key").fetchall()
        return [r["data_key"] for r in rows]

    def all(self) -> Dict[str, Any]:
        _ensure_schema()
        return {key: self.get(key) for key in self.keys()}

    def migrate_from_stock_db(self) -> Dict[str, Any]:
        """
        把旧版用户数据一次性搬进用户库，幂等可重跑：

        1. stock_db/meta.db 的 ``local:`` 前缀 key（cacheStore 曾把部分用户数据写在这）；
        2. ``<storage>/*.json`` 旧文件（settings/stock_settings/tradings/train_* 等）。

        文件名与 userStore.localDataKey 的规则一致（``local:<相对路径>``），
        内容统一包成 ``{"lastModified":..., "data":...}``，与前端读取结构完全兼容。
        旧数据保留不删除，便于回滚。

        返回 {"migrated": n, "keys": [...], "errors": [...]}。
        """
        import stock_db as sdb

        moved: List[str] = []
        errors: List[str] = []

        # 1) stock_db 里的 local: 前缀用户 key
        legacy_keys: List[str] = []
        try:
            legacy_keys = sdb.CacheAPI().keys("local:")
        except Exception as e:
            errors.append(f"读取 stock_db 用户数据 key 失败: {e}")
        for key in legacy_keys:
            try:
                value = sdb.CacheAPI().get_raw(key)
                if value is None:
                    continue
                self.put(key, value)
                moved.append(key)
            except Exception as e:
                errors.append(f"{key}: {e}")

        # 2) 旧 JSON 文件（storage 根目录）
        storage_root = os.path.dirname(_db_root) if os.path.basename(_db_root) == "user_db" else _db_root
        file_map = {
            "settings": "settings.json",  # 实际老文件名（本地 FileStorage 版本）
            "star_sites": "star_sites.json",
            "stock_settings": "stock_settings.json",
            "tradings": "tradings.json",
            "trainings": "trainings.json",
            "ktrainings": "ktrainings.json",
            "train_trade_records": "train_trade_records.json",
            "books": "books.json",
            "strategy_groups": "strategy_groups.json",
            # 训练进度 / 归档：旧版本放在 storage/store 子目录（下方候选路径自动覆盖）
            "train_progress": "train_progress.json",
            "train_archives": "train_archives.json",
        }
        # 旧 pathToTable 未命中 TABLE_MAP 时按路径拼出 store_train_progress_undefined 这类文件名
        legacy_default_names = {
            "train_progress": "store_train_progress_undefined.json",
            "train_archives": "store_train_archives_undefined.json",
        }
        for table, filename in file_map.items():
            # ThingsStorage 老版本写在 storage/store/ 下；FileStorage 版本写在 storage/ 根目录；
            # 还有旧 pathToTable 生成的 store_xxx_undefined 文件名
            candidates = [
                os.path.join(storage_root, filename),
                os.path.join(storage_root, 'store', filename),
            ]
            if table in legacy_default_names:
                candidates.append(os.path.join(storage_root, legacy_default_names[table]))
            path = next((p for p in candidates if p and os.path.isfile(p)), None)
            if not path:
                continue
            key = f"local:{table}"
            # 用户库已有「有效数据」时不覆盖（用户库是权威源，避免旧文件回滚）；
            # 前端启动时会先把默认空值写进库，那不算有效数据，要用旧文件补齐
            existing = self.get(key)
            if existing is not None and not (
                isinstance(existing, dict)
                and existing.get("data") in (None, {}, [])
                and str(existing.get("lastModified", "")) == "1970-01-01 00:00:00"
            ):
                continue
            try:
                with open(path, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                # 旧文件内容统一转成 {lastModified, data} 信封；避免把已有信封再套一层
                if isinstance(raw, dict) and "data" in raw and "lastModified" in raw:
                    value = raw
                elif isinstance(raw, dict) and "data" in raw:
                    value = {"lastModified": _now_iso(), "data": raw["data"]}
                else:
                    value = {"lastModified": _now_iso(), "data": raw}
                self.put(key, value)
                moved.append(key)
            except Exception as e:
                errors.append(f"{path}: {e}")

        return {"migrated": len(moved), "keys": moved, "errors": errors}

    def info(self) -> Dict[str, Any]:
        _ensure_schema()
        row = _conn().execute("SELECT COUNT(*) AS c FROM user_data").fetchone()
        return {"root": _db_root, "path": _db_path(), "entries": int(row["c"]) if row else 0}


def main() -> None:
    parser = argparse.ArgumentParser(description="用户数据库自检 / 迁移工具")
    parser.add_argument("action", nargs="?", default="stats", choices=["stats", "migrate"])
    parser.add_argument("--storage-path", "-s", default=None, help="应用本地存储根目录")
    args = parser.parse_args()
    if args.storage_path:
        set_db_root(args.storage_path)
    api = UserDataAPI()
    if args.action == "migrate":
        print(json.dumps(api.migrate_from_stock_db(), ensure_ascii=False))
    else:
        print(json.dumps(api.info(), ensure_ascii=False))


if __name__ == "__main__":
    main()
