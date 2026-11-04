#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""盘中执行口径对比：开盘成交 vs 分时条件触发（回踩均价线 / 涨幅转正）

问题：短线评分突变的信号，当前一律「次日开盘买入、卖出信号次日开盘卖出」。
如果改用分时条件在盘中择价，能不能改善？

做法：
  1. 复用 backtest_short_score_jump.py 的评分缓存读取与 run_stock 规则，
     先跑出基准交易（入场日 = 信号次日，出场日 = 卖出信号次日）；
  2. 对每笔交易的「入场日 / 出场日」取 tushare stk_mins 的 1 分钟数据，
     在同一个交易日里换一个成交时刻：
       买入口径  open（基准）/ vwap（回踩均价线）/ turn_positive（涨幅转正）
       卖出口径  open（基准）/ vwap_up（冲高均价线）/ turn_negative（涨幅转负）
  3. 关键对照是「同子集匹配口径」：变体只在触发时才成交，若直接比总体期望，
     等于把「没触发」的信号算成损失。因此同时给出
         变体期望  vs  同一批已成交信号在基准口径下的期望
     两者的差值才是「择价」本身的效果。

口径细节：
  - 分钟价按「当日开盘价」换算成与日K一致的前复权口径（cross-day 复权基准不同不影响日内比较）；
  - 回踩均价：先出现「价格在均价线上方」，之后首次回到 均价×(1+tol) 以内，按该分钟收盘价成交；
  - 涨幅转正：首次从「昨收下方」上穿昨收，按该分钟收盘价成交；
    开盘即在昨收上方的，turn_positive 视为开盘成交，turn_positive_strict 视为不成交（两种都报）；
  - 冲高/转负卖出若全天未触发，按当日收盘价卖出（不强留隔夜），并在统计里单独计数。

用法：
  python3 scripts/backtest_intraday_execution.py --board 小盘成长 --start 2025-12-29
  python3 scripts/backtest_intraday_execution.py --board 小盘成长 --max-trades 30   # 先小样本试跑
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import statistics
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import backtest_short_score_jump as bt  # noqa: E402

TRADING_DAYS_PER_YEAR = 252
FEE = 0.0012

BUY_VARIANTS = ["open", "vwap", "turn_positive", "turn_positive_strict"]
SELL_VARIANTS = [
    "open", "close", "t1000", "weak_or_close", "decay_or_close", "vwap_up", "turn_negative",
]
# 交叉表只展开「开盘买 / 回踩均价买」× 全部卖出口径，避免 4×7 行太吵
CROSS_BUY = ["open", "vwap"]

VAR_NAMES = {
    "open": "开盘",
    "vwap": "回踩均价线",
    "turn_positive": "涨幅转正",
    "turn_positive_strict": "涨幅转正(不追高开)",
    "vwap_up": "冲高均价线",
    "turn_negative": "涨幅转负",
    "close": "收盘卖",
    "t1000": "10:00 无条件卖",
    "weak_or_close": "弱形态(冲高回落/高开低走)→10:00卖，否则收盘",
    "decay_or_close": "涨速衰竭→10:00卖，否则收盘",
}


# ---------------------------------------------------------------- 分钟数据

def load_token(explicit: Optional[str], data_dir: str) -> str:
    if explicit:
        return explicit
    env = os.environ.get("TUSHARE_TOKEN", "")
    if env:
        return env
    # 应用设置写在 <storage-root>/settings.json（stock_db 的上一级）
    cfg = os.path.join(os.path.dirname(os.path.abspath(data_dir)), "settings.json")
    try:
        with open(cfg, "r", encoding="utf-8") as fp:
            raw = json.load(fp)
        node = raw.get("data") if isinstance(raw.get("data"), dict) else raw
        token = ((node or {}).get("systemSetting") or {}).get("tushareTokenSetting") or ""
        if token:
            return token
    except Exception:
        pass
    return ""


def api_call(api_name: str, params: dict, token: str, retries: int = 3) -> dict:
    body = json.dumps(
        {"api_name": api_name, "token": token, "params": params, "fields": ""}
    ).encode()
    last = ""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                "http://api.tushare.pro",
                data=body,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                res = json.loads(resp.read().decode())
            if res.get("code") == 0:
                return res.get("data") or {}
            last = str(res.get("msg") or "unknown")
            if "每分钟" in last or "频率" in last or "限制" in last or "limit" in last.lower():
                time.sleep(6 * (attempt + 1))
                continue
            break
        except Exception as e:  # 网络抖动
            last = str(e)
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"{api_name} 失败: {last}")


def parse_minutes(data: dict) -> List[dict]:
    fields = data.get("fields") or []
    idx = {f: i for i, f in enumerate(fields)}
    if not all(k in idx for k in ("trade_time", "close", "vol", "amount")):
        return []
    rows: List[dict] = []
    for it in data.get("items") or []:
        tm = str(it[idx["trade_time"]])
        hhmm = tm[11:16] if len(tm) >= 16 else tm[:5]
        if not (("09:30" <= hhmm <= "11:30") or ("13:00" <= hhmm <= "15:00")):
            continue
        close = float(it[idx["close"]] or 0)
        if close <= 0:
            continue
        open_ = float(it[idx["open"]] or close) if "open" in idx else close
        rows.append(
            {
                "t": hhmm,
                "open": open_,
                "close": close,
                "vol": float(it[idx["vol"]] or 0),
                "amount": float(it[idx["amount"]] or 0),
            }
        )
    rows.sort(key=lambda r: r["t"])
    cum_v = cum_a = 0.0
    for r in rows:
        cum_v += max(0.0, r["vol"])
        cum_a += max(0.0, r["amount"])
        r["avg"] = (cum_a / cum_v) if cum_v > 0 else r["close"]
    return rows


class MinuteStore:
    """1 分钟数据本地缓存（脚本自用，不写应用库）"""

    def __init__(self, root: Optional[str] = None):
        self.root = root or os.path.expanduser("~/.stexplorer_bt/minute_cache.db")
        os.makedirs(os.path.dirname(self.root), exist_ok=True)
        # 取数走线程池，连接必须允许跨线程 + 用锁串行化读写
        self.con = sqlite3.connect(self.root, check_same_thread=False)
        self.lock = threading.Lock()
        self.con.execute(
            "CREATE TABLE IF NOT EXISTS minute (code TEXT, day TEXT, payload TEXT, "
            "PRIMARY KEY (code, day))"
        )
        self.con.commit()

    def get(self, code: str, day: str) -> Optional[List[dict]]:
        with self.lock:
            row = self.con.execute(
                "SELECT payload FROM minute WHERE code=? AND day=?", (code, day)
            ).fetchone()
        if not row:
            return None
        try:
            return json.loads(row[0])
        except Exception:
            return None

    def put(self, code: str, day: str, rows: List[dict]) -> None:
        with self.lock:
            self.con.execute(
                "INSERT OR REPLACE INTO minute(code, day, payload) VALUES (?,?,?)",
                (code, day, json.dumps(rows, ensure_ascii=False)),
            )
            self.con.commit()


def fetch_one(store: MinuteStore, token: str, code: str, day: str) -> Optional[List[dict]]:
    cached = store.get(code, day)
    if cached is not None:
        return cached
    ts_code = bt.to_ts_code(code)
    data = api_call(
        "stk_mins",
        {
            "ts_code": ts_code,
            "freq": "1min",
            "start_date": f"{day} 09:00:00",
            "end_date": f"{day} 15:30:00",
        },
        token,
    )
    rows = parse_minutes(data)
    store.put(code, day, rows)
    return rows or None


# ---------------------------------------------------------------- 盘中规则

def day_open(rows: List[dict]) -> float:
    return rows[0]["open"] if rows[0].get("open", 0) > 0 else rows[0]["close"]


def scaled(rows: List[dict], scale: float) -> List[dict]:
    if abs(scale - 1.0) < 1e-9:
        return rows
    return [
        {**r, "open": r["open"] * scale, "close": r["close"] * scale, "avg": r["avg"] * scale}
        for r in rows
    ]


def pick_entry(
    rows: List[dict], variant: str, prev_close: float, tol: float
) -> Tuple[Optional[float], str]:
    """返回 (成交价, 说明)；None 表示本次信号不成交"""
    if not rows:
        return None, "无分钟数据"
    if variant == "open":
        return day_open(rows), "开盘"
    if variant == "vwap":
        above = False
        for r in rows:
            if r["close"] > r["avg"]:
                above = True
            elif above and r["close"] <= r["avg"] * (1 + tol):
                return r["close"], f"回踩均价 {r['t']}"
        return None, "全天未回踩均价线"
    if variant in ("turn_positive", "turn_positive_strict"):
        prev = None
        for i, r in enumerate(rows):
            if r["close"] > prev_close and (prev is None or prev <= prev_close):
                if prev is None:
                    if variant == "turn_positive_strict":
                        return None, "开盘即在昨收上方（不追）"
                    return day_open(rows), "开盘即转正"
                return r["close"], f"上穿昨收 {r['t']}"
            prev = r["close"]
        return None, "全天未转正"
    raise ValueError(variant)


def truncate(rows: List[dict], cutoff: str = "10:00") -> List[dict]:
    """只保留 cutoff（含）之前的分时点——盘中决策必须有截断，否则就是未来函数"""
    return [r for r in rows if r["t"] <= cutoff]


def intraday_features(sub: List[dict], prev_close: float) -> Optional[dict]:
    """分时特征（与 intradayPattern.ts 的 C5a 同口径，只取截断窗口内）"""
    if len(sub) < 10 or prev_close <= 0:
        return None
    prices = [r["close"] for r in sub]
    n = len(prices)
    open_ = sub[0]["open"] or prices[0]
    high, low = max(prices), min(prices)
    above = [
        1 if (r["avg"] > 0 and r["close"] > r["avg"]) else (1 if r["avg"] <= 0 else 0) for r in sub
    ]
    f1 = sum(above) / n
    f2 = (prices[-1] - low) / (high - low) if high > low else 0.5
    segs = 8
    f4: List[float] = []
    for i in range(segs):
        a = int(n * i / segs)
        b = min(n - 1, int(n * (i + 1) / segs) - 1)
        sp = prices[a]
        f4.append((prices[max(a, b)] / sp - 1) * 100 if sp > 0 else 0.0)
    up_vol = down_vol = 0.0
    for i in range(1, n):
        v = max(0.0, sub[i]["vol"])
        if prices[i] > prices[i - 1]:
            up_vol += v
        elif prices[i] < prices[i - 1]:
            down_vol += v
    f5 = (up_vol / down_vol) if down_vol > 0 else (9.99 if up_vol > 0 else 1.0)
    peak = prices[0]
    f7 = 0.0
    for p in prices:
        peak = max(peak, p)
        if peak > 0:
            f7 = max(f7, (peak - p) / peak)
    return {
        "f1": f1,
        "f2": f2,
        "f4": f4,
        "f5": f5,
        "f6": (high - low) / prev_close,
        "f7": f7,
        "max_pos": prices.index(high) / (n - 1) if n > 1 else 0.0,
        "min_pos": prices.index(low) / (n - 1) if n > 1 else 0.0,
        "gap": (open_ / prev_close - 1) if prev_close > 0 else 0.0,
        "ret": prices[-1] / prev_close - 1,
        "high": high,
        "last": prices[-1],
        "n": n,
    }


def weak_pattern(sub: List[dict], prev_close: float) -> Tuple[bool, str]:
    """10:00 截断判定「冲高回落 / 高开低走」，命中则视为当日走弱"""
    fe = intraday_features(sub, prev_close)
    if fe is None:
        return False, ""
    if fe["max_pos"] < 1 / 3 and fe["f2"] < 0.5:
        return True, "冲高回落"
    if fe["gap"] > 0.01 and fe["f2"] < 0.3 and fe["f5"] < 1.0:
        return True, "高开低走"
    return False, ""


def speed_decay(sub: List[dict], prev_close: float) -> Tuple[bool, str]:
    """涨速衰竭：前段冲高（≥+0.5%）后，后段转跌且自高点回落 ≥0.3%"""
    if len(sub) < 20:
        return False, ""
    prices = [r["close"] for r in sub]
    half = len(prices) // 2
    seg1 = prices[half] / prices[0] - 1
    seg2 = prices[-1] / prices[half] - 1
    high = max(prices)
    drop = (high - prices[-1]) / high if high > 0 else 0.0
    if seg1 >= 0.005 and seg2 <= 0 and drop >= 0.003:
        return True, "涨速衰竭"
    return False, ""


WEAK_SET = ("冲高回落", "高开低走")


def pick_exit(
    rows: List[dict], variant: str, prev_close: float, up_th: float, cutoff: str = "10:00"
) -> Tuple[Optional[float], str]:
    if not rows:
        return None, "无分钟数据"
    if variant == "open":
        return day_open(rows), "开盘"
    if variant == "close":
        return rows[-1]["close"], "收盘卖"
    if variant == "vwap_up":
        for r in rows:
            if r["close"] >= r["avg"] * (1 + up_th):
                return r["close"], f"冲高均价 {r['t']}"
        return rows[-1]["close"], "未冲高→收盘卖"
    if variant == "turn_negative":
        prev = None
        for r in rows:
            if prev is not None and prev > prev_close and r["close"] <= prev_close:
                return r["close"], f"下穿昨收 {r['t']}"
            prev = r["close"]
        return rows[-1]["close"], "未转负→收盘卖"
    if variant == "t1000":
        sub = truncate(rows, cutoff)
        return (sub[-1]["close"] if sub else day_open(rows)), f"{cutoff} 无条件卖"
    if variant in ("weak_or_close", "decay_or_close"):
        sub = truncate(rows, cutoff)
        if len(sub) < 10:
            return day_open(rows), "分时不足→开盘卖"
        if variant == "weak_or_close":
            hit, label = weak_pattern(sub, prev_close)
        else:
            hit, label = speed_decay(sub, prev_close)
        if hit:
            return sub[-1]["close"], f"{label} {sub[-1]['t']}"
        return rows[-1]["close"], "未触发→收盘卖"
    raise ValueError(variant)


# ---------------------------------------------------------------- 统计

def stat_block(rets: List[float]) -> dict:
    n = len(rets)
    if not n:
        return {"n": 0, "avg": 0.0, "win": 0.0, "pf": 0.0, "median": 0.0}
    wins = [r for r in rets if r > 0]
    losses = [r for r in rets if r <= 0]
    gross_w = sum(wins)
    gross_l = abs(sum(losses))
    return {
        "n": n,
        "avg": statistics.fmean(rets),
        "win": len(wins) / n,
        "pf": (gross_w / gross_l) if gross_l > 0 else (float("inf") if gross_w > 0 else 0.0),
        "median": statistics.median(rets),
    }


def paired_t(diffs: List[float]) -> float:
    """配对差值 t 值（|t|>2 才勉强算有信号，样本 300 笔时差值 0.3% 往往就在边缘）"""
    if len(diffs) < 3:
        return 0.0
    sd = statistics.pstdev(diffs)
    if sd <= 0:
        return 0.0
    return statistics.fmean(diffs) / sd * (len(diffs) ** 0.5)


def trigger_time(why: str) -> Optional[int]:
    """从说明里取触发时刻（分钟数）；无时刻（开盘成交）按 09:30 计"""
    m = re.search(r"(\d{2}):(\d{2})", why or "")
    if not m:
        return 9 * 60 + 30 if "开盘" in (why or "") else None
    return int(m.group(1)) * 60 + int(m.group(2))


def fmt_minute(v: Optional[float]) -> str:
    if v is None:
        return "—"
    total = int(round(v))
    return f"{total // 60:02d}:{total % 60:02d}"


def rec_rows_close(rec: dict, sub: List[dict]) -> float:
    """截断时刻价格 → 当日收盘价 的收益（用于验证形态是否真的识别了走弱）"""
    rows = rec.get("x_rows") or []
    if not sub or not rows or sub[-1]["close"] <= 0:
        return 0.0
    return rows[-1]["close"] / sub[-1]["close"] - 1


def main() -> None:
    ap = argparse.ArgumentParser(description="盘中执行口径对比（开盘 vs 分时触发）")
    ap.add_argument("--data-dir", help="stock_db 目录（默认自动探测）")
    ap.add_argument("--token", help="Tushare token（默认读环境变量或应用 settings.json）")
    ap.add_argument("--board", action="append", default=[], metavar="名称|BK代码",
                    help="只回测该板块成分股（可重复）")
    ap.add_argument("--start", default="", help="回测起始日 YYYY-MM-DD")
    ap.add_argument("--end", default="", help="回测截止日 YYYY-MM-DD")
    ap.add_argument("--min-days", type=int, default=120, help="只取评分天数 >= 该值的股票")
    ap.add_argument("--buy", type=float, default=20.0)
    ap.add_argument("--sell", type=float, default=-15.0)
    ap.add_argument("--min-score", type=float, default=60.0)
    ap.add_argument("--low-base-days", type=int, default=3)
    ap.add_argument("--low-base-max", type=float, default=40.0)
    ap.add_argument("--trail-drop", type=float, default=10.0)
    ap.add_argument("--tol", type=float, default=0.002,
                    help="回踩均价线的容差（0.002=0.2%%，默认）")
    ap.add_argument("--up-th", type=float, default=0.005,
                    help="卖出冲高阈值：收盘 >= 均价×(1+x)，0.005=0.5%%（默认）")
    ap.add_argument("--cutoff", default="10:00",
                    help="盘中形态判定的截断时刻（默认 10:00，不得晚于 11:30）")
    ap.add_argument("--max-trades", type=int, default=0, help="只分析前 N 笔（0=全部）")
    ap.add_argument("--workers", type=int, default=6, help="取数并发数（默认 6）")
    args = ap.parse_args()

    data_dir = bt.find_data_dir(args.data_dir)
    token = load_token(args.token, data_dir)
    if not token:
        sys.exit("未找到 Tushare token：用 --token 传，或确认应用设置里有配置")
    print(f"数据目录: {data_dir}")

    meta = bt.connect(os.path.join(data_dir, "meta.db"))
    daily = bt.connect(os.path.join(data_dir, "daily.db"))
    bt.detect_adjust(daily)

    series, _stats = bt.load_scores(meta, args.min_days)
    print(f"评分序列 >= {args.min_days} 天: {len(series)} 只")

    if args.board:
        wanted = set()
        for name in args.board:
            code, disp = bt.resolve_board(name)
            members = bt.fetch_board_members(code)
            wanted.update(m[0] for m in members)
            print(f"板块 {disp}({code}) {len(members)} 只")
        codes = [c for c in series if c in wanted]
    else:
        codes = list(series)
    print(f"成分股可回测 {len(codes)} 只")

    data, skipped = bt.prepare(codes, series, daily, start_date=args.start, end_date=args.end)
    print(f"可用 {len(data)} 只（无日K {skipped} 只）")
    if not data:
        sys.exit("样本无可用日K数据")

    # ---- 1. 基准交易 ----
    trades: List[bt.Trade] = []
    for s, bars in data:
        ts, _daily, _n = bt.run_stock(
            s, bars, args.buy, args.sell, args.min_score, FEE,
            0.0, 0, 1, "jump", False, False, 0.0,
            low_base=bt.LowBase(args.low_base_days, args.low_base_max),
            trail_drop=args.trail_drop,
        )
        trades.extend(ts)
    print(f"基准交易 {len(trades)} 笔")
    if args.max_trades:
        trades = trades[: args.max_trades]
        print(f"按 --max-trades 只分析前 {len(trades)} 笔")

    # ---- 2. 取分钟数据（入场日 + 出场日）----
    store = MinuteStore()
    wanted_days = sorted(
        {(t.code, t.entry_date) for t in trades} | {(t.code, t.exit_date) for t in trades}
    )
    print(f"需要分钟数据 {len(wanted_days)} 个「股票×交易日」，开始取数...")
    minute_map: Dict[Tuple[str, str], Optional[List[dict]]] = {}

    def work(item):
        code, day = item
        try:
            return item, fetch_one(store, token, code, day)
        except Exception as e:
            return item, ("error", str(e))

    done = 0
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        for item, rows in pool.map(work, wanted_days):
            if isinstance(rows, tuple):
                print(f"  [warn] {item[0]} {item[1]} 取数失败: {rows[1]}")
                minute_map[item] = None
            else:
                minute_map[item] = rows
            done += 1
            if done % 50 == 0 or done == len(wanted_days):
                print(f"  取数 {done}/{len(wanted_days)}")
    ok_days = sum(1 for v in minute_map.values() if v)
    print(f"取数完成：有效 {ok_days}/{len(wanted_days)}")

    # ---- 3. 逐笔计算各口径成交价 ----
    bars_by_code = {s.code: bars for s, bars in data}
    records = []
    for t in trades:
        bars = bars_by_code.get(t.code)
        if bars is None:
            continue
        e_rows = minute_map.get((t.code, t.entry_date))
        x_rows = minute_map.get((t.code, t.exit_date))
        if not e_rows or not x_rows:
            continue
        e_idx = bars.index_of(t.entry_date)
        x_idx = bars.index_of(t.exit_date)
        if e_idx < 1 or x_idx < 1:
            continue
        # 分钟价换算到日K的前复权口径（同一天内单一系数）
        e_scale = bars.opens[e_idx] / day_open(e_rows) if day_open(e_rows) > 0 else 1.0
        x_scale = bars.opens[x_idx] / day_open(x_rows) if day_open(x_rows) > 0 else 1.0
        e_rows_q = scaled(e_rows, e_scale)
        x_rows_q = scaled(x_rows, x_scale)
        rec = {
            "code": t.code,
            "name": t.name,
            "entry_day": t.entry_date,
            "exit_day": t.exit_date,
            "entry_prev_close": bars.closes[e_idx - 1],
            "exit_prev_close": bars.closes[x_idx - 1],
            "base_entry": t.entry_price,
            "base_exit": t.exit_price,
            "e_rows": e_rows_q,
            "x_rows": x_rows_q,
        }
        records.append(rec)

    print(f"可对比交易 {len(records)} 笔（分钟数据齐全）")
    if not records:
        sys.exit("没有可用于对比的交易")

    # ---- 4. 组合口径 ----
    rows_out = []
    for bv in CROSS_BUY:
        for sv in SELL_VARIANTS:
            var_rets, base_rets, skipped = [], [], 0
            times: List[int] = []
            for rec in records:
                ep, why_e = pick_entry(rec["e_rows"], bv, rec["entry_prev_close"], args.tol)
                if ep is None:
                    skipped += 1
                    continue
                xp, why_x = pick_exit(
                    rec["x_rows"], sv, rec["exit_prev_close"], args.up_th, args.cutoff
                )
                if xp is None:
                    skipped += 1
                    continue
                var_rets.append(xp / ep - 1 - FEE)
                base_rets.append(rec["base_exit"] / rec["base_entry"] - 1 - FEE)
                tt = trigger_time(why_e)
                if tt is not None:
                    times.append(tt)
            st = stat_block(var_rets)
            bs = stat_block(base_rets)
            diffs = [v - b for v, b in zip(var_rets, base_rets)]
            rows_out.append(
                [
                    f"{VAR_NAMES[bv]} → {VAR_NAMES[sv]}",
                    st["n"],
                    skipped,
                    f"{st['avg']*100:+.2f}%" if st["n"] else "—",
                    f"{st['win']*100:.1f}%" if st["n"] else "—",
                    f"{st['pf']:.2f}" if st["n"] else "—",
                    f"{bs['avg']*100:+.2f}%" if bs["n"] else "—",
                    f"{(st['avg']-bs['avg'])*100:+.2f}%" if st["n"] else "—",
                    f"{paired_t(diffs):+.2f}" if st["n"] else "—",
                    fmt_minute(statistics.median(times)) if times else "—",
                ]
            )

    print("\n=== 盘中执行口径对比（同一批信号；匹配口径 = 该子集在「开盘买/开盘卖」下的结果）===")
    print("说明：变体只在盘中触发时成交，未触发的信号不计入；因此看「差值」/「t值」而不是变体自身期望。")
    print(
        bt.render_table(
            ["买入口径 → 卖出口径", "笔数", "未成交", "变体期望", "胜率", "盈利因子",
             "匹配基准", "差值", "差值t", "中位买点"],
            rows_out,
            "lrrrrrrrrrr",
        )
    )

    # ---- 5. 未成交原因分布（买入口径单独看）----
    print("\n=== 买入口径未成交原因（卖出口径固定=开盘）===")
    for bv in BUY_VARIANTS:
        if bv == "open":
            continue
        reasons: Dict[str, int] = {}
        for rec in records:
            p, why = pick_entry(rec["e_rows"], bv, rec["entry_prev_close"], args.tol)
            if p is None:
                reasons[why.split(" ")[0]] = reasons.get(why.split(" ")[0], 0) + 1
        total = sum(reasons.values())
        detail = " / ".join(f"{k} {v}" for k, v in sorted(reasons.items(), key=lambda kv: -kv[1]))
        print(f"  {VAR_NAMES[bv]}: 未成交 {total} 笔（{detail or '无'}）")

    # ---- 5b. 截断形态诊断：命中组从截断时刻到收盘是不是真的更弱 ----
    print(f"\n=== {args.cutoff} 形态诊断（卖出日：{args.cutoff} 价格 → 收盘价 的收益）===")
    for name, fn in (("弱形态(冲高回落/高开低走)", weak_pattern), ("涨速衰竭", speed_decay)):
        hit_rets, miss_rets = [], []
        labels: Dict[str, int] = {}
        for rec in records:
            sub = truncate(rec["x_rows"], args.cutoff)
            if len(sub) < 10:
                continue
            hit, label = fn(sub, rec["exit_prev_close"])
            r = rec_rows_close(rec, sub)
            if hit:
                hit_rets.append(r)
                labels[label] = labels.get(label, 0) + 1
            else:
                miss_rets.append(r)
        hs = stat_block(hit_rets)
        ms = stat_block(miss_rets)
        share = hs["n"] / max(1, hs["n"] + ms["n"]) * 100
        detail = " / ".join(f"{k} {v}" for k, v in sorted(labels.items(), key=lambda kv: -kv[1]))
        print(
            f"  {name}: 命中 {hs['n']} 笔（{share:.1f}%；{detail or '—'}）"
            f" 命中后期望 {hs['avg']*100:+.2f}%（胜率 {hs['win']*100:.0f}%）"
            f" | 未命中 {ms['n']} 笔 期望 {ms['avg']*100:+.2f}%"
        )

    # ---- 6. 卖出口径单独看（买入口径固定=开盘）----
    print("\n=== 卖出口径对比（买入口径固定=开盘）===")
    srows = []
    for sv in SELL_VARIANTS:
        var_rets, base_rets, fallback = [], [], 0
        times: List[int] = []
        for rec in records:
            ep = rec["base_entry"]
            xp, why = pick_exit(
                rec["x_rows"], sv, rec["exit_prev_close"], args.up_th, args.cutoff
            )
            if xp is None:
                continue
            if "收盘卖" in why:
                fallback += 1
            var_rets.append(xp / ep - 1 - FEE)
            base_rets.append(rec["base_exit"] / rec["base_entry"] - 1 - FEE)
            tt = trigger_time(why)
            if tt is not None:
                times.append(tt)
        st = stat_block(var_rets)
        bs = stat_block(base_rets)
        diffs = [v - b for v, b in zip(var_rets, base_rets)]
        srows.append(
            [
                VAR_NAMES[sv],
                st["n"],
                fallback,
                f"{st['avg']*100:+.2f}%",
                f"{st['win']*100:.1f}%",
                f"{bs['avg']*100:+.2f}%",
                f"{(st['avg']-bs['avg'])*100:+.2f}%",
                f"{paired_t(diffs):+.2f}",
                fmt_minute(statistics.median(times)) if times else "—",
            ]
        )
    print(
        bt.render_table(
            ["卖出口径", "笔数", "回退收盘", "变体期望", "胜率", "匹配基准", "差值", "差值t", "中位卖点"],
            srows,
            "lrrrrrrrr",
        )
    )


if __name__ == "__main__":
    main()
