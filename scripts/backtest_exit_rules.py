#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""卖出规则对比：评分类 vs 价格类

背景：短线评分下跌与股价下跌并不同步——评分常在股价仍在拉升时先转头，
「评分绿柱卖出 / 评分回撤止盈」容易把仓位卖在半山腰。这里用同一批买入信号，
只替换卖出条件，横向比较各类卖出规则。

买入口径固定（跳升 Δ≥20 + 评分≥60 + 低位≤40 持续 3 日，默认参数），
所以各变体的差异全部来自卖出。

用法：
  python3 scripts/backtest_exit_rules.py --board 小盘成长 --start 2024-10-01
  python3 scripts/backtest_exit_rules.py --board 小盘成长 --low-base-max 45 --start 2024-10-01
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import backtest_short_score_jump as bt  # noqa: E402

FEE = 0.0012


def parse_band(text: str) -> Optional[Tuple[int, int]]:
    try:
        lo, hi = str(text).split(":")
        lo_i, hi_i = int(lo), int(hi)
    except Exception:
        return None
    return (lo_i, hi_i) if 0 < lo_i < hi_i else None


def build_variants(trail_drop: float) -> List[Tuple[str, dict]]:
    """每个变体 = 一组卖出参数（未写的沿用基准）"""
    base: Dict[str, object] = {"trail_drop": trail_drop}
    no_trail: Dict[str, object] = {"trail_drop": 0.0}
    return [
        # ---- 现状（评分口径）----
        (f"① 现状：绿柱 + 评分回撤{trail_drop:g}", dict(base)),
        ("② 只关回撤止盈（仅绿柱）", dict(no_trail)),
        ("③ 绿柱需同时价跌", {**no_trail, "score_price_both": True}),
        ("④ 绿柱需价跌 + 评分回撤", {**base, "score_price_both": True}),
        # ---- 纯持有时间 ----
        ("⑤ 只持 3 日", {**no_trail, "score_exit": False, "max_hold": 3}),
        ("⑥ 只持 5 日", {**no_trail, "score_exit": False, "max_hold": 5}),
        ("⑦ 持 5 日 + 止损 5%",
         {**no_trail, "score_exit": False, "max_hold": 5, "stop_loss": 0.05}),
        # ---- 价格移动止盈 ----
        ("⑧ 价格回撤 3%", {**no_trail, "price_trail": 0.03}),
        ("⑨ 价格回撤 5%", {**no_trail, "price_trail": 0.05}),
        ("⑩ 价格回撤 5% + 绿柱价跌", {**no_trail, "price_trail": 0.05, "score_price_both": True}),
        # ---- 固定目标 ----
        ("⑪ 目标 +8%", {**no_trail, "take_profit": 0.08}),
        ("⑫ 目标 +12%", {**no_trail, "take_profit": 0.12}),
        # ---- 均线 / 量能 ----
        ("⑬ 跌破 MA5 即卖", {**no_trail, "ma_exit": 5}),
        ("⑭ 跌破 MA10 即卖", {**no_trail, "ma_exit": 10}),
        ("⑮ 放量滞涨（2 倍量）", {**no_trail, "vol_stall": 2.0}),
        # ---- 组合 ----
        ("⑯ 绿柱价跌 + 跌破 MA5", {**no_trail, "ma_exit": 5, "score_price_both": True}),
        ("⑰ 持 5 日 + 价格回撤 5% + 止损 5%",
         {**no_trail, "score_exit": False, "max_hold": 5,
          "price_trail": 0.05, "stop_loss": 0.05}),
    ]


def main() -> None:
    ap = argparse.ArgumentParser(description="卖出规则对比（评分口径 vs 价格口径）")
    ap.add_argument("--data-dir", help="stock_db 目录（默认自动探测）")
    ap.add_argument("--board", action="append", default=[], metavar="名称|BK代码")
    ap.add_argument("--start", default="2024-10-01")
    ap.add_argument("--end", default="")
    ap.add_argument("--min-days", type=int, default=120)
    ap.add_argument("--buy", type=float, default=20.0)
    ap.add_argument("--sell", type=float, default=-15.0)
    ap.add_argument("--min-score", type=float, default=60.0)
    ap.add_argument("--low-base-days", type=int, default=3)
    ap.add_argument("--low-base-max", type=float, default=40.0)
    ap.add_argument("--trail-drop", type=float, default=10.0, help="基准的评分回撤止盈（默认 10）")
    ap.add_argument("--ma-band", action="append", default=[], metavar="LO:HI")
    args = ap.parse_args()

    data_dir = bt.find_data_dir(args.data_dir)
    print(f"数据目录: {data_dir}")
    meta = bt.connect(os.path.join(data_dir, "meta.db"))
    daily = bt.connect(os.path.join(data_dir, "daily.db"))
    bt.detect_adjust(daily)

    series, _ = bt.load_scores(meta, args.min_days)
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

    bands = tuple(b for b in (parse_band(x) for x in args.ma_band) if b)
    low_base = bt.LowBase(args.low_base_days, args.low_base_max)

    results: List[Tuple[str, dict]] = []
    for label, cfg in build_variants(args.trail_drop):
        st = bt.evaluate(
            data, args.buy, args.sell, args.min_score, FEE,
            float(cfg.get("stop_loss", 0.0) or 0.0),
            int(cfg.get("max_hold", 0) or 0),
            1, "jump", False, False, 0.0,
            low_base=low_base,
            trail_drop=float(cfg.get("trail_drop", args.trail_drop)),
            score_exit=bool(cfg.get("score_exit", True)),
            score_price_both=bool(cfg.get("score_price_both", False)),
            price_trail=float(cfg.get("price_trail", 0.0) or 0.0),
            take_profit=float(cfg.get("take_profit", 0.0) or 0.0),
            ma_exit=int(cfg.get("ma_exit", 0) or 0),
            vol_stall=float(cfg.get("vol_stall", 0.0) or 0.0),
            ma_bands=bands,
        )
        results.append((label, st))
        print(f"  完成 {label}")

    print("\n=== 卖出规则对比（同一批买入信号，只改卖出）===")
    print("说明：只统计已平仓；「贡献」= 频率 × 每笔期望，用来看总获利能力。")
    rows = []
    for label, st in results:
        pf, payoff = st["profit_factor"], st["payoff"]
        rows.append([
            label,
            st["trades"],
            f"{st['win_rate']*100:.1f}%",
            f"{st['avg_ret']*100:+.2f}%",
            f"{st['median_ret']*100:+.2f}%",
            "∞" if payoff == float("inf") else f"{payoff:.2f}",
            "∞" if pf == float("inf") else f"{pf:.2f}",
            f"{st['avg_bars']:.1f}",
            f"{st['trades_per_stock_year'] * st['avg_ret'] * 100:+.2f}%",
        ])
    print(bt.render_table(
        ["卖出规则", "交易", "胜率", "期望/笔", "中位", "盈亏比", "盈利因子", "持仓日", "贡献/股票年"],
        rows, "lrrrrrrrr",
    ))

    print("\n=== 风险与组合层面 ===")
    rows2 = []
    for label, st in results:
        sharpe = st.get("sharpe", 0.0)
        rows2.append([
            label,
            f"{st['best']*100:+.1f}%",
            f"{st['worst']*100:+.1f}%",
            f"{st.get('ann_ret', 0.0)*100:+.2f}%",
            "∞" if sharpe == float("inf") else f"{sharpe:.2f}",
            f"{st.get('max_dd', 0.0)*100:.2f}%",
        ])
    print(bt.render_table(
        ["卖出规则", "最好", "最差", "组合年化", "组合夏普", "最大回撤"], rows2, "lrrrrr"
    ))


if __name__ == "__main__":
    main()
