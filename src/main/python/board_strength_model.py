# -*- coding: utf-8 -*-
"""板块日K强势度评分 v1.1 —— 参考实现

与 v1.0（个股）的四处根本差异：

  1. 阈值按板块自身波动率缩放（固定百分比会系统性歧视低波动板块）
  2. 原 S1/S2/S3 在板块层语义失效 → 替换为「广度」类指标（由成份股聚合而来）
  3. 必须做市场中性化：市场系统性波动会让所有板块的广度同向移动，
     不中性化则全部板块挤在同一个分数区间，横截面失去区分度
  4. 双轨输出：score_alpha（超额强度，用于板块间排序）+ score_abs（绝对冷热，用于判断板块自身）

项目内落地说明（《板块日K强势度评分_调整说明 v1.1》配套的 score_run/sector_model.py）：
  - score_sectors() 保留为「按 stock_basic.industry 分组」的参考实现，用于回归对照；
  - score_boards() 是应用入口，按东财 90.BKxxxx 板块的 dc_member 成份股分组，
    指标公式 / 曲线 / 权重 / 市场中性化 / 修正项 / 双轨输出与参考实现逐行一致。
"""
import numpy as np
import pandas as pd

# ============ 参数 ============
CFG_SECTOR = dict(
    window=20,
    base_days=60,
    min_members=15,

    # 波动率自适应阈值系数
    k_big=1.5,      # 大阳：单日涨幅 >= k_big × 板块σ
    k_gap=0.6,      # 跳空：开盘涨幅 >= k_gap × 板块σ
    k_dump=1.8,

    # 子指标内部权重
    w_trend=(0.50, 0.25, 0.25),    # 超额趋势 / 加速度 / 路径效率
    w_breadth=(0.50, 0.30, 0.20),  # 超额广度均值 / 超额广度末5日 / 扩散
    w_burst=(0.45, 0.35, 0.20),    # 涨停占比 / 大阳占比 / 3连阳家数
    w_gap=(0.55, 0.45),            # 超额净高开 / 未补缺口占比
    w_struct=(0.45, 0.30, 0.25),   # 一致性 / 离散度适中 / 集中度低

    # 总分权重（板块版：S2/S3 降权，新增 S5）
    w1=0.28, w2=0.14, w3=0.10, w4=0.30, w5=0.18,

    # 修正项
    pen_cum_ret=0.15, pen_cum_cap=15.0,
    pen_last3=6.0, pen_last3_ratio=0.70,
    pen_last5=4.0, pen_last5_ratio=0.85,
    pen_path=8.0, pen_path_th=0.15,
    pen_divergence=8.0, pen_divergence_ex=0.03,   # 超额涨幅 >3% 但超额广度 <0
    pen_vol_spike=5.0, pen_vol_ratio=1.60,
    pen_dd=5.0, pen_dd_z=-1.20,   # 距窗口高点回撤按 σ√N 标准化后的 z 值
    bonus_cap=8.0,
)

# ============ 绝对曲线 ============
# 超额口径：横轴是「板块 - 全市场」的差值，零点固定在 50 分
EX_CURVES = {
    "up_share":   [(-0.12, 0), (-0.05, 25), (0.00, 50), (0.05, 75), (0.12, 100)],
    "up_share5":  [(-0.15, 0), (-0.06, 28), (0.00, 52), (0.06, 76), (0.15, 100)],
    "diffusion":  [(-0.20, 0), (-0.08, 30), (0.00, 50), (0.08, 70), (0.20, 100)],
    "trend":      [(-0.10, 0), (-0.04, 32), (0.00, 50), (0.04, 72), (0.10, 90), (0.16, 100)],
    "gap":        [(-0.20, 0), (-0.08, 30), (0.00, 50), (0.08, 70), (0.20, 100)],
    # 绝对口径
    "abs_trend":  [(-0.20, 0), (-0.10, 25), (0.00, 48), (0.05, 62), (0.10, 80), (0.20, 100)],
    "abs_up":     [(0.25, 0), (0.35, 25), (0.45, 52), (0.55, 80), (0.65, 100)],
}

# 非超额类（板块内部结构，天然横截面可比）
STRUCT_CURVES = {
    "consistency": [(-0.008, 0), (-0.003, 26), (0.000, 50), (0.003, 76), (0.008, 100)],
    "dispersion":  [(0.008, 35), (0.015, 58), (0.022, 72), (0.030, 70), (0.040, 55), (0.060, 20)],
    "concentration": [(0.0, 95), (0.15, 85), (0.30, 70), (0.50, 45), (0.75, 12)],
    "limit_share": [(0.000, 35), (0.010, 50), (0.030, 65), (0.060, 82), (0.120, 95), (0.200, 100)],
    "big_share":   [(0.000, 32), (0.040, 45), (0.090, 58), (0.180, 78), (0.320, 100)],
    "n_consec3":   [(0, 32), (2, 50), (5, 68), (10, 86), (20, 100)],
    "gap_unfilled": [(0.00, 40), (0.30, 62), (0.60, 82), (0.85, 100)],
}


def amap(v, pts, default=50.0):
    if v is None or not np.isfinite(v):
        return default
    return float(np.interp(v, [p[0] for p in pts], [p[1] for p in pts]))


def wavg(parts):
    """标量加权平均，无效分量剔除后按比例重新分配权重"""
    tot, acc = 0.0, 0.0
    for v, w in parts:
        if v is None or not np.isfinite(v):
            continue
        tot += w
        acc += v * w
    return float(acc / tot) if tot > 1e-12 else 50.0


def ols(y):
    n = len(y)
    if n < 3:
        return 0.0, 0.0
    t = np.arange(n, dtype=float)
    b, a = np.polyfit(t, y, 1)
    fit = a + b * t
    ss_res = float(((y - fit) ** 2).sum())
    ss_tot = float(((y - y.mean()) ** 2).sum())
    r2 = 1 - ss_res / ss_tot if ss_tot > 1e-12 else 0.0
    return float(b), float(max(min(r2, 1.0), 0.0))


def run_lengths(flags):
    out, run = [], 0
    for f in flags:
        if f:
            run += 1
        elif run:
            out.append(run); run = 0
    if run:
        out.append(run)
    return out


# ============ 数据准备 ============
def prepare_stocks(daily, universe):
    """成份股层派生字段"""
    d = daily.copy()
    d = d.sort_values(["ts_code", "trade_date"])
    g = d.groupby("ts_code", sort=False)
    d["prev_close"] = g["close"].shift(1)
    d["ret"] = d["close"] / d["prev_close"] - 1.0
    d["gap"] = d["open"] / d["prev_close"] - 1.0
    d["body_up"] = d["close"] > d["open"]
    d["is_limit_up"] = d["ret"] >= (d["limit_pct"].fillna(0.10) - 0.005)
    d["ma20"] = g["close"].transform(lambda s: s.rolling(20, min_periods=10).mean())
    d["above_ma20"] = d["close"] > d["ma20"]
    d["is_big"] = (d["ret"] >= 0.04) & d["body_up"]
    d = d.dropna(subset=["ret"])
    key = "industry" if "industry" in universe.columns else "sector_id"
    d = d.merge(universe[["ts_code", key]], on="ts_code", how="inner")
    return d, key


def build_index(d, key):
    """成份股 → 板块指数（等权）"""
    out = []
    for ind, sub in d.groupby(key, sort=True):
        if sub["ts_code"].nunique() < CFG_SECTOR["min_members"]:
            continue
        a = sub.groupby("trade_date", sort=True).apply(
            lambda x: pd.Series(dict(
                r=x["ret"].mean(), gap=x["gap"].mean(),
                up_intra=((x["high"] - x["close"]) / x["close"]).mean(),
                dn_intra=((x["close"] - x["low"]) / x["close"]).mean(),
                vol=x["vol"].sum(), amount=x["amount"].sum(),
            )), include_groups=False).reset_index()
        close = (1 + a["r"]).cumprod() * 100
        prev = close.shift(1).fillna(100.0)
        o = prev * (1 + a["gap"])
        out.append(pd.DataFrame(dict(
            sector=ind, trade_date=a["trade_date"],
            open=o.values, close=close.values,
            high=np.maximum(o, close).values * (1 + a["up_intra"].values),
            low=np.minimum(o, close).values * (1 - a["dn_intra"].values),
            ret=a["r"].values, gap=a["gap"].values,
            vol=a["vol"].values, amount=a["amount"].values,
        )))
    return pd.concat(out, ignore_index=True)


# ============ 指数层（S4 趋势） ============
def index_metrics(idx, cfg):
    idx = idx.sort_values("trade_date").reset_index(drop=True)
    win = idx.tail(cfg["window"])
    base = idx.iloc[-(cfg["window"] + cfg["base_days"]):-cfg["window"]]
    m = {}
    sigma = float(base["ret"].std(ddof=0)) if len(base) >= 20 else float(win["ret"].std(ddof=0))
    m["sigma"] = max(sigma, 1e-4)
    m["vol_ratio"] = float(win["ret"].std(ddof=0) / m["sigma"]) if sigma > 1e-9 else 1.0

    y = np.log(win["close"].values)
    b, r2 = ols(y)
    n = len(y)
    m["slope_b"], m["r2"] = b, r2
    m["trend_ret"] = float(np.exp(b * n) - 1)
    h = n // 2
    m["accel"] = (ols(y[-h:])[0] - b) if h >= 5 else 0.0

    c = win["close"]
    m["cum_ret"] = float(c.iloc[-1] / c.iloc[0] - 1)
    tot = float(win["ret"].abs().sum())
    m["path_er"] = float(abs(m["cum_ret"]) / tot) if tot > 1e-9 else 0.0
    m["last3_ratio"] = float((c.iloc[-1] / c.iloc[-4] - 1) / m["cum_ret"]) if len(c) >= 4 and m["cum_ret"] > 1e-6 else 0.0
    m["last5_ratio"] = float((c.iloc[-1] / c.iloc[-6] - 1) / m["cum_ret"]) if len(c) >= 6 and m["cum_ret"] > 1e-6 else 0.0
    m["dd_from_high"] = float(c.iloc[-1] / c.max() - 1)
    return m


# ============ 成份股聚合（S1/S2/S3/S5） ============
def breadth_metrics(sub, cfg, sector_idx, sigma):
    sub = sub.sort_values(["ts_code", "trade_date"])
    win_dates = sorted(sub["trade_date"].unique())[-cfg["window"]:]
    w = sub[sub["trade_date"].isin(win_dates)]
    dates = sorted(w["trade_date"].unique())
    n_dates = len(dates)

    daily = w.groupby("trade_date").agg(
        up_share=("ret", lambda s: float((s > 0).mean())),
        up_med=("ret", "median"),
        high_share=("gap", lambda s: float((s > 0).mean())),
        low_share=("gap", lambda s: float((s < 0).mean())),
        ret_std=("ret", "std"),
        limit_share=("is_limit_up", "mean"),
        big_share=("is_big", "mean"),
        ma20_share=("above_ma20", "mean"),
    ).reindex(dates)

    m = {}
    # ---- S1 广度 ----
    m["up_share"] = float(daily["up_share"].mean())
    m["up_share5"] = float(daily["up_share"].tail(5).mean())
    early = daily["up_share"].iloc[:-5]
    m["diffusion"] = float(daily["up_share"].tail(5).mean() - early.mean()) if len(early) >= 5 else 0.0
    m["ma20_share"] = float(daily["ma20_share"].iloc[-1]) if n_dates else 0.0

    # ---- S2 爆发 ----
    m["limit_share"] = float(daily["limit_share"].mean())
    m["big_share"] = float(daily["big_share"].mean())
    consec = []
    for _, g in w.groupby("ts_code"):
        runs = run_lengths(g["ret"].gt(0).values)
        consec.append(max(runs) if runs else 0)
    m["n_consec3"] = int(sum(1 for x in consec if x >= 3))
    m["max_consec"] = int(max(consec) if consec else 0)

    # ---- S3 跳空广度 ----
    # 净高开广度：高开个股占比 − 低开个股占比（板块层唯一稳定的跳空表达）
    m["gap_net"] = float((daily["high_share"] - daily["low_share"]).mean())
    m["gap_unfilled"] = _unfilled_ratio(w, sigma, cfg)

    # ---- S5 结构 ----
    m["dispersion"] = float(daily["ret_std"].mean())
    sc = sector_idx.set_index("trade_date")["ret"].reindex(dates)
    pull = (sc - daily["up_med"]).dropna()
    # pull > 0：指数涨幅高于成份股中位 → 靠少数大票拉动 → 一致性差
    m["consistency"] = float(-pull.mean()) if len(pull) else 0.0
    m["concentration"] = _concentration(w)
    return m


def _unfilled_ratio(w, sigma, cfg):
    th = max(cfg["k_gap"] * sigma, 0.003)
    tot = unf = 0
    for _, g in w.groupby("ts_code"):
        g = g.sort_values("trade_date").reset_index(drop=True)
        pc = g["close"].shift(1)
        gap = (g["open"] / pc - 1).values
        idx = np.where((gap >= th))[0]
        lows = g["low"].values
        for i in idx:
            if i == 0 or not np.isfinite(pc.iloc[i]):
                continue
            tot += 1
            if not np.any(lows[i + 1:] <= pc.iloc[i] + 1e-9):
                unf += 1
    return float(unf / tot) if tot else 0.0


def _concentration(w, topn=3):
    r = w.groupby("ts_code").apply(
        lambda g: float(g.sort_values("trade_date")["close"].iloc[-1] /
                        g.sort_values("trade_date")["close"].iloc[0] - 1),
        include_groups=False)
    if r.empty or r.abs().sum() < 1e-9:
        return 0.0
    pos = r.abs().sort_values(ascending=False)
    return float(pos.head(topn).sum() / pos.sum())


# ============ 主流程 ============
def score_sectors(daily, universe, as_of, cfg=CFG_SECTOR):
    d, key = prepare_stocks(daily, universe)
    idx = build_index(d, key)

    # 市场基准：全 A 等权，窗口内
    mkt = d[d["trade_date"] <= as_of].groupby("trade_date").agg(
        ret=("ret", "mean"), up=("ret", lambda s: float((s > 0).mean())),
        hs=("gap", lambda s: float((s > 0).mean())),
        ls=("gap", lambda s: float((s < 0).mean())),
    )
    mkt_win = mkt.iloc[-cfg["window"]:]
    mkt_trend = float((1 + mkt_win["ret"]).prod() - 1)
    mkt_up = float(mkt_win["up"].mean())
    mkt_up5 = float(mkt_win["up"].tail(5).mean())
    mkt_gap = float((mkt_win["hs"] - mkt_win["ls"]).mean())
    _mc = (1 + mkt_win["ret"]).cumprod()
    mkt_dd = float(_mc.iloc[-1] / _mc.max() - 1)

    raw = []
    for sec in sorted(idx["sector"].unique()):
        si = idx[(idx["sector"] == sec) & (idx["trade_date"] <= as_of)]
        if len(si) < cfg["window"] + 5:
            continue
        im = index_metrics(si, cfg)
        sub = d[(d[key] == sec) & (d["trade_date"] <= as_of)]
        if sub.empty:
            continue
        sub = sub.copy()
        sub["is_big"] = (sub["ret"] >= max(cfg["k_big"] * im["sigma"], 0.008)) & sub["body_up"]
        bm = breadth_metrics(sub, cfg, si, im["sigma"])
        raw.append(dict(sector=sec, members=int(sub["ts_code"].nunique()),
                        im=im, bm=bm, sigma=im["sigma"]))
    if not raw:
        return pd.DataFrame(), idx

    out = []
    for r in raw:
        im, bm = r["im"], r["bm"]
        # ---- 超额化 ----
        ex_trend = im["trend_ret"] - mkt_trend
        im = dict(im)
        im["trend_quality"] = ex_trend * (0.5 + 0.5 * im["r2"])
        ex_up = bm["up_share"] - mkt_up
        ex_up5 = bm["up_share5"] - mkt_up5
        ex_gap = bm["gap_net"] - mkt_gap

        s1 = wavg([
            (amap(ex_up, EX_CURVES["up_share"]), cfg["w_breadth"][0]),
            (amap(ex_up5, EX_CURVES["up_share5"]), cfg["w_breadth"][1]),
            (amap(bm["diffusion"], EX_CURVES["diffusion"]), cfg["w_breadth"][2]),
        ])
        s2 = wavg([
            (amap(bm["limit_share"], STRUCT_CURVES["limit_share"]), cfg["w_burst"][0]),
            (amap(bm["big_share"], STRUCT_CURVES["big_share"]), cfg["w_burst"][1]),
            (amap(bm["n_consec3"], STRUCT_CURVES["n_consec3"]), cfg["w_burst"][2]),
        ])
        s3 = wavg([
            (amap(ex_gap, EX_CURVES["gap"]), cfg["w_gap"][0]),
            (amap(bm["gap_unfilled"], STRUCT_CURVES["gap_unfilled"]), cfg["w_gap"][1]),
        ])
        s4 = wavg([
            # 超额趋势必须乘 R² 置信调节（与 v1.0 一致）：
            # 板块指数也可能出现"几天脉冲、R² 很低"的假趋势
            (amap(im["trend_quality"], EX_CURVES["trend"]), cfg["w_trend"][0]),
            (float(np.clip(50 + im["accel"] * 900, 0, 100)), cfg["w_trend"][1]),
            (float(np.clip(100 * im["path_er"] * 1.2, 0, 100)), cfg["w_trend"][2]),
        ])
        s5 = wavg([
            (amap(bm["consistency"], STRUCT_CURVES["consistency"]), cfg["w_struct"][0]),
            (amap(bm["dispersion"], STRUCT_CURVES["dispersion"]), cfg["w_struct"][1]),
            (amap(bm["concentration"], STRUCT_CURVES["concentration"]), cfg["w_struct"][2]),
        ])

        # ---- 修正项 ----
        pen, flags = 0.0, []
        over = max(im["cum_ret"] - cfg["pen_cum_ret"], 0.0)
        p_cum = min(cfg["pen_cum_cap"], over / cfg["pen_cum_ret"] * cfg["pen_cum_cap"])
        if p_cum > 0:
            pen += p_cum; flags.append("位置透支")
        if im["last3_ratio"] >= cfg["pen_last3_ratio"]:
            pen += cfg["pen_last3"]; flags.append("末端拉升3日")
        elif im["last5_ratio"] >= cfg["pen_last5_ratio"]:
            pen += cfg["pen_last5"]; flags.append("末端拉升5日")
        if im["path_er"] < cfg["pen_path_th"] and im["cum_ret"] > 0:
            pen += cfg["pen_path"]; flags.append("路径低效")
        # 广度背离：超额涨幅靠前但广度没跟上 = 少数大票拉动（相对口径）
        if ex_trend > cfg["pen_divergence_ex"] and ex_up < 0:
            pen += cfg["pen_divergence"]; flags.append("广度背离")
        if im["vol_ratio"] > cfg["pen_vol_ratio"]:
            pen += cfg["pen_vol_spike"]; flags.append("波动放大")
        # 高位回落必须用「相对市场的超额回撤」：
        # 下跌市里所有板块都远离高点，用自身回撤（哪怕按 σ 标准化）
        # 仍有 1/4 的板块同时触发，修正项会退化成准常数偏移。
        dd_excess = im["dd_from_high"] - mkt_dd
        dd_z = dd_excess / max(im["sigma"] * np.sqrt(cfg["window"]), 1e-6)
        if dd_z < cfg["pen_dd_z"]:
            pen += cfg["pen_dd"]; flags.append("高位回落")

        alpha = cfg["w1"] * s1 + cfg["w2"] * s2 + cfg["w3"] * s3 + cfg["w4"] * s4 + cfg["w5"] * s5
        alpha = float(np.clip(alpha - pen, 0, 100))
        # 绝对冷热：不看相对市场，只看板块自身
        abs_s = 0.55 * amap(im["cum_ret"], EX_CURVES["abs_trend"]) \
            + 0.25 * amap(bm["up_share"], EX_CURVES["abs_up"]) \
            + 0.20 * amap(bm["limit_share"], STRUCT_CURVES["limit_share"])

        out.append(dict(
            sector=r["sector"], members=r["members"], score_alpha=alpha,
            score_abs=float(np.clip(abs_s - pen * 0.5, 0, 100)),
            s1=s1, s2=s2, s3=s3, s4=s4, s5=s5, penalty=pen, flags=";".join(flags),
            sigma=r["sigma"], cum_ret=im["cum_ret"], ex_trend=ex_trend,
            trend_ret=im["trend_ret"], r2=im["r2"], path_er=im["path_er"],
            vol_ratio=im["vol_ratio"], dd_from_high=im["dd_from_high"],
            up_share=bm["up_share"], ex_up=ex_up, up_share5=bm["up_share5"],
            diffusion=bm["diffusion"], ma20_share=bm["ma20_share"],
            limit_share=bm["limit_share"], big_share=bm["big_share"],
            gap_net=bm["gap_net"], ex_gap=ex_gap, gap_unfilled=bm["gap_unfilled"],
            consistency=bm["consistency"], dispersion=bm["dispersion"],
            concentration=bm["concentration"],
        ))

    res = pd.DataFrame(out).sort_values("score_alpha", ascending=False).reset_index(drop=True)
    res.insert(0, "rank", np.arange(1, len(res) + 1))
    res.insert(1, "rank_abs", res["score_abs"].rank(ascending=False).astype(int))
    return res, idx


# ============================================================
# 项目内入口：按「板块 secid -> 成份股代码列表」评分
#
# 与 score_sectors 的区别只在 universe：参考实现按 stock_basic.industry 分组，
# 应用里的板块是东财 90.BKxxxx / BKxxxx.DC，成份股来自 dc_member 快照。
# 指标公式、曲线、权重、市场中性化、修正项、双轨输出全部与 score_sectors 一致。
# ============================================================
def _score_one(sector, members, im, bm, mkt_trend, mkt_up, mkt_up5, mkt_gap, mkt_dd, cfg):
    """单个板块的打分（逐行对应 score_sectors 的主循环）"""
    ex_trend = im["trend_ret"] - mkt_trend
    im = dict(im)
    im["trend_quality"] = ex_trend * (0.5 + 0.5 * im["r2"])
    ex_up = bm["up_share"] - mkt_up
    ex_up5 = bm["up_share5"] - mkt_up5
    ex_gap = bm["gap_net"] - mkt_gap

    s1 = wavg([
        (amap(ex_up, EX_CURVES["up_share"]), cfg["w_breadth"][0]),
        (amap(ex_up5, EX_CURVES["up_share5"]), cfg["w_breadth"][1]),
        (amap(bm["diffusion"], EX_CURVES["diffusion"]), cfg["w_breadth"][2]),
    ])
    s2 = wavg([
        (amap(bm["limit_share"], STRUCT_CURVES["limit_share"]), cfg["w_burst"][0]),
        (amap(bm["big_share"], STRUCT_CURVES["big_share"]), cfg["w_burst"][1]),
        (amap(bm["n_consec3"], STRUCT_CURVES["n_consec3"]), cfg["w_burst"][2]),
    ])
    s3 = wavg([
        (amap(ex_gap, EX_CURVES["gap"]), cfg["w_gap"][0]),
        (amap(bm["gap_unfilled"], STRUCT_CURVES["gap_unfilled"]), cfg["w_gap"][1]),
    ])
    s4 = wavg([
        (amap(im["trend_quality"], EX_CURVES["trend"]), cfg["w_trend"][0]),
        (float(np.clip(50 + im["accel"] * 900, 0, 100)), cfg["w_trend"][1]),
        (float(np.clip(100 * im["path_er"] * 1.2, 0, 100)), cfg["w_trend"][2]),
    ])
    s5 = wavg([
        (amap(bm["consistency"], STRUCT_CURVES["consistency"]), cfg["w_struct"][0]),
        (amap(bm["dispersion"], STRUCT_CURVES["dispersion"]), cfg["w_struct"][1]),
        (amap(bm["concentration"], STRUCT_CURVES["concentration"]), cfg["w_struct"][2]),
    ])

    pen, flags = 0.0, []
    over = max(im["cum_ret"] - cfg["pen_cum_ret"], 0.0)
    p_cum = min(cfg["pen_cum_cap"], over / cfg["pen_cum_ret"] * cfg["pen_cum_cap"])
    if p_cum > 0:
        pen += p_cum; flags.append("位置透支")
    if im["last3_ratio"] >= cfg["pen_last3_ratio"]:
        pen += cfg["pen_last3"]; flags.append("末端拉升3日")
    elif im["last5_ratio"] >= cfg["pen_last5_ratio"]:
        pen += cfg["pen_last5"]; flags.append("末端拉升5日")
    if im["path_er"] < cfg["pen_path_th"] and im["cum_ret"] > 0:
        pen += cfg["pen_path"]; flags.append("路径低效")
    if ex_trend > cfg["pen_divergence_ex"] and ex_up < 0:
        pen += cfg["pen_divergence"]; flags.append("广度背离")
    if im["vol_ratio"] > cfg["pen_vol_ratio"]:
        pen += cfg["pen_vol_spike"]; flags.append("波动放大")
    dd_excess = im["dd_from_high"] - mkt_dd
    dd_z = dd_excess / max(im["sigma"] * np.sqrt(cfg["window"]), 1e-6)
    if dd_z < cfg["pen_dd_z"]:
        pen += cfg["pen_dd"]; flags.append("高位回落")

    alpha = cfg["w1"] * s1 + cfg["w2"] * s2 + cfg["w3"] * s3 + cfg["w4"] * s4 + cfg["w5"] * s5
    alpha = float(np.clip(alpha - pen, 0, 100))
    abs_s = 0.55 * amap(im["cum_ret"], EX_CURVES["abs_trend"]) \
        + 0.25 * amap(bm["up_share"], EX_CURVES["abs_up"]) \
        + 0.20 * amap(bm["limit_share"], STRUCT_CURVES["limit_share"])

    return dict(
        sector=sector, members=members, score_alpha=alpha,
        score_abs=float(np.clip(abs_s - pen * 0.5, 0, 100)),
        s1=s1, s2=s2, s3=s3, s4=s4, s5=s5, penalty=float(pen), flags=";".join(flags),
        sigma=im["sigma"], cum_ret=im["cum_ret"], ex_trend=ex_trend,
        trend_ret=im["trend_ret"], r2=im["r2"], path_er=im["path_er"],
        vol_ratio=im["vol_ratio"], dd_from_high=im["dd_from_high"],
        up_share=bm["up_share"], ex_up=ex_up, up_share5=bm["up_share5"],
        diffusion=bm["diffusion"], ma20_share=bm["ma20_share"],
        limit_share=bm["limit_share"], big_share=bm["big_share"],
        gap_net=bm["gap_net"], ex_gap=ex_gap, gap_unfilled=bm["gap_unfilled"],
        consistency=bm["consistency"], dispersion=bm["dispersion"],
        concentration=bm["concentration"],
    )


def score_boards(daily, sector_map, as_of=None, cfg=CFG_SECTOR):
    """按东财板块成份股评分。

    daily: DataFrame，列 ts_code / trade_date / open / high / low / close / vol / amount / limit_pct
           （本地 daily.db/daily_kline 的 qfq 日线，列名已由调用方映射）
    sector_map: {板块 secid: [成份股 ts_code, ...]}
    as_of: 数据截止交易日（YYYYMMDD 或 YYYY-MM-DD），严防训练模式读到未来数据

    返回 {板块 secid: 评分明细}，含 rank / rank_abs。
    """
    if daily is None or getattr(daily, "empty", True) or not sector_map:
        return {}
    all_codes = sorted({c for codes in sector_map.values() for c in codes if c})
    if not all_codes:
        return {}
    universe = pd.DataFrame({"ts_code": all_codes, "industry": "__all__"})
    d_all, key = prepare_stocks(daily, universe)
    if d_all.empty:
        return {}

    as_of = str(as_of or d_all["trade_date"].max()).replace("-", "")[:8]
    d_all = d_all[d_all["trade_date"].astype(str).str.replace("-", "", regex=False) <= as_of]
    if d_all.empty:
        return {}

    # 全 A 等权基准（只取落在板块成份股并集里的股票，与参考实现 universe 口径一致）
    mkt = d_all.groupby("trade_date").agg(
        ret=("ret", "mean"),
        up=("ret", lambda s: float((s > 0).mean())),
        hs=("gap", lambda s: float((s > 0).mean())),
        ls=("gap", lambda s: float((s < 0).mean())),
    ).sort_index()
    mkt_win = mkt.iloc[-cfg["window"]:]
    if mkt_win.empty:
        return {}
    mkt_trend = float((1 + mkt_win["ret"]).prod() - 1)
    mkt_up = float(mkt_win["up"].mean())
    mkt_up5 = float(mkt_win["up"].tail(5).mean())
    mkt_gap = float((mkt_win["hs"] - mkt_win["ls"]).mean())
    _mc = (1 + mkt_win["ret"]).cumprod()
    mkt_dd = float(_mc.iloc[-1] / _mc.max() - 1) if len(_mc) else 0.0

    out = {}
    for sector, codes in sector_map.items():
        try:
            d = d_all[d_all["ts_code"].isin(codes)].copy()
            members = int(d["ts_code"].nunique())
            if members < cfg["min_members"]:
                continue
            d[key] = sector
            idx = build_index(d, key)
            si = idx[idx["trade_date"].astype(str).str.replace("-", "", regex=False) <= as_of]
            if len(si) < cfg["window"] + 5:
                continue
            im = index_metrics(si, cfg)
            d["is_big"] = (d["ret"] >= max(cfg["k_big"] * im["sigma"], 0.008)) & d["body_up"]
            bm = breadth_metrics(d, cfg, si, im["sigma"])
            out[sector] = _score_one(
                sector, members, im, bm, mkt_trend, mkt_up, mkt_up5, mkt_gap, mkt_dd, cfg
            )
        except Exception as e:
            print(f"[板块强势度] {sector} 计算失败: {e}")
            continue

    # 双轨排名：score_alpha 用于板块间排序，score_abs 只作参考
    order = sorted(out, key=lambda k: -out[k]["score_alpha"])
    abs_order = sorted(out, key=lambda k: -out[k]["score_abs"])
    for i, k in enumerate(order):
        out[k]["rank"] = i + 1
    for i, k in enumerate(abs_order):
        out[k]["rank_abs"] = i + 1
    return out
