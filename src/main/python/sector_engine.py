# -*- coding: utf-8 -*-
"""板块效应启动判定引擎（成分池不粘 + 指标层 EMA）。

依据：《板块效应启动判定-最佳方案实现指令.md》
严格实现第 1 节八条决策、第 4 节流程伪代码、第 6 节参数表。

八条决策的落点：
  1. 成分池只用当日强势股快照，绝不累积历史成分、绝不做滞后移出；
  2. 降噪只放在指标层（对板块计数 N 做 alpha=0.5 的 EMA），成分完全不动；
  3. 广度 / 位置 / 强度阈值全部换成当日 110 行业横截面分位；
  4. 板块 K 线用当日快照成分在 daily_all 里的真实日收益，不用快照 zdf；
  5. N_new / N_stay / N_exit 只落库供复盘，不进主判定打分；
  6. 1 分钟分时特征不进质量分（只用于字段复核，本模块完全不读取）；
  7. 资金项用反向 (1 - q_mf3)；
  8. 严格 point-in-time，输出是滞后约 2 日的复盘标签，不输出买点或收益预测。

为什么不采用「新高入池跌破 MA20 才移出 / 涨停入池连续 5 日不涨停才移出」：
  - 实测退出事件中 MA20 破位触发率仅 0.59%，等于永不移出，方向虽对但窗口太慢；
  - 多次涨停类跌出快照后 5 日平均 -2.99%、99.5% 发生在刚断板 1 天，多留 4 天会
    系统性拖低板块 K 线；
  - 成分层粘性会让幽灵成分占 45.9%，且阶段切换次数由 1288 升到 2418（引入新振荡）。
  因此这里只用当日快照，把降噪放到指标层，并用当日横截面分位重新标定阈值。

数据口径红线：
  - 外部数据一律按 ts_code[:6] 映射到 stock_basic 的 110 行业，不按行业名连接；
  - 封板质量分位只在当日有涨停的行业之间算，非活跃行业一律填 0.5；
  - 位置与强度只用当日 110 行业横截面分位，不用自身历史分位或绝对广度阈值。

只读保证：数据库一律用 sqlite3 的 file:...?mode=ro 打开，本模块不写任何缓存、不建目录。
标准库实现，不依赖 pandas / numpy。
"""

from __future__ import annotations

import bisect
import json
import math
import os
import sqlite3
import sys
from array import array
from collections import defaultdict

VERSION = "1.0"
ENGINE = "sector_engine"
NAN = float("nan")

# 离线补拉数据目录（只读）。可由配置 data_dir 或环境变量 SECTOR_ENGINE_DATA_DIR 覆盖。
_OFFLINE_DATA_CANDIDATES = [
    "/Users/lihejun/WorkBuddy/2026-11-06-15-17-36",
]
_LIMIT_FILE = "limit_list_d_2024_2026.json"
_MONEYFLOW_FILE = "moneyflow_by_industry.json"
_CAP_FILE = "market_cap_snapshots.json"

# py_service 会在 --storage-path 变化时调用 set_cache_dir；这里只记录路径，不建目录。
_db_root_hint = None
_as_of_date = None


def set_cache_dir(storage_path):
    """供 py_service 常驻进程指定存储根目录（只记录，不创建任何目录）。"""
    global _db_root_hint
    _db_root_hint = os.path.join(storage_path, "stock_db") if storage_path else None
    return _db_root_hint


def set_as_of_date(value):
    """训练模式的数据截止日：晚于该日的请求会被截断，防止未来数据进入判定。"""
    global _as_of_date
    _as_of_date = str(value).replace("-", "")[:8] if value else None
    return _as_of_date


def _log(text):
    """中文日志统一走 stderr，保证 --stdin 模式下 stdout 只有协议 JSON。"""
    sys.stderr.write("[板块阶段] %s\n" % text)
    try:
        sys.stderr.flush()
    except Exception:
        pass


# ---------------------------------------------------------------- 基础数学工具
def mean(xs):
    vals = [x for x in xs if x is not None and not (isinstance(x, float) and math.isnan(x))]
    return sum(vals) / len(vals) if vals else 0.0


def std(xs):
    vals = [x for x in xs if x is not None and not (isinstance(x, float) and math.isnan(x))]
    if len(vals) < 2:
        return 0.0
    m = sum(vals) / len(vals)
    return math.sqrt(sum((v - m) ** 2 for v in vals) / (len(vals) - 1))


def median(xs):
    vals = sorted(x for x in xs if x is not None)
    if not vals:
        return 0.0
    n = len(vals)
    return vals[n // 2] if n % 2 else (vals[n // 2 - 1] + vals[n // 2]) / 2.0


def cumret(rs):
    """复利累计收益，输入小数收益，返回百分点。"""
    v = 1.0
    for r in rs:
        if r is not None and not (isinstance(r, float) and math.isnan(r)):
            v *= 1.0 + r
    return (v - 1.0) * 100.0


def pct_of(sorted_vals, v):
    """含并列的分位：bisect_right(已排序序列, v) / 长度。"""
    if not sorted_vals:
        return 0.5
    return bisect.bisect_right(sorted_vals, v) / float(len(sorted_vals))


def percentile(sorted_vals, q):
    """线性插值分位，q 取 0~1；空序列返回 None。"""
    if not sorted_vals:
        return None
    vals = sorted(sorted_vals)
    pos = q * (len(vals) - 1)
    lo, hi = int(math.floor(pos)), int(math.ceil(pos))
    return vals[lo] + (vals[hi] - vals[lo]) * (pos - lo)


def hhmmss_to_min(value):
    """首封时刻 -> 距 09:30 的分钟数；无法解析填 120。"""
    s = str(value or "").strip()
    if not s or not s.isdigit():
        return 120.0
    s = s.zfill(6)
    try:
        h, m = int(s[:2]), int(s[2:4])
    except (TypeError, ValueError):
        return 120.0
    if h > 23 or m > 59:
        return 120.0
    return float(max(0, h * 60 + m - 570))


def _to_float(v, default=0.0):
    try:
        f = float(v)
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default


def _to_int(v, default=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------- 只读数据加载
class SectorEngine:
    """110 行业 × 交易日面板 + 两层判定 + 四态阶段机。

    构造时一次性把面板装进内存（约 5~8 秒），之后 evaluate() 是 O(110) 查询。
    """

    DEFAULT_CONFIG = {
        "ema_alpha": 0.5,
        "ema_effect_min": 3.0,
        "qN_min": 0.80,
        "run_len_min": 3,
        "qr20_max": 0.60,
        "zt_n_min": 2,
        "zbl_max": 0.35,
        "quality_pct": 0.60,
        "cross_section_scope": "all",
        "warmup": 20,
        "filter_st": True,
        "roles_for_all": False,
        "experimental_divergence": True,
        "data_dir": None,
        "db_root": None,
    }

    def __init__(self, config=None):
        self.config = dict(self.DEFAULT_CONFIG)
        if config:
            self.config.update({k: v for k, v in config.items() if k in self.DEFAULT_CONFIG})
        cfg = self.config

        self.db_root = self._resolve_db_root(cfg)
        self.data_dir = self._resolve_data_dir(cfg)
        self.meta_db = os.path.join(self.db_root, "meta.db")
        self.warnings = []

        _log("开始加载只读面板：%s" % self.meta_db)
        self._load_stock_basic()
        self._load_daily()
        self._load_strong_pool()
        self._load_limit_list()
        self._load_moneyflow()
        self._load_market_cap()
        _log("面板加载完成：%d 个行业 / %d 个交易日" % (len(self.industries), len(self.dates)))

        self.panel = {}
        self.results = {}
        self._build_panel()
        _log("判定完成：可输出 %d 个交易日" % len(self.results))

    # ------------------------------------------------------------ 路径解析
    def _resolve_db_root(self, cfg):
        """只读挑选一个有完整面板的 meta.db；应用常驻进程由 set_cache_dir 指定。"""
        candidates = [cfg.get("db_root"), _db_root_hint]
        try:
            import stock_db

            candidates.append(stock_db.get_db_root())
        except Exception as e:
            self.warnings.append("无法从 stock_db 取得存储根目录：%s" % e)
        candidates += [
            "/Users/lihejun/Documents/GitHub/stexplorer/data/stock_db",
            os.path.expanduser("~/Documents/GitHub/stexplorer/data/stock_db"),
        ]
        for d in candidates:
            if not d or not os.path.isfile(os.path.join(d, "meta.db")):
                continue
            try:
                con = sqlite3.connect("file:%s?mode=ro" % os.path.join(d, "meta.db"), uri=True)
                n = con.execute("SELECT COUNT(*) FROM api_cache WHERE cache_key LIKE 'daily_all_%'").fetchone()[0]
                con.close()
                if n > 0:
                    return d
            except Exception:
                continue
        raise RuntimeError("找不到含 daily_all 面板的只读 stock_db，请用 db_root / --db-root 指定")

    def _resolve_data_dir(self, cfg):
        env = os.environ.get("SECTOR_ENGINE_DATA_DIR")
        candidates = [cfg.get("data_dir"), env] + _OFFLINE_DATA_CANDIDATES
        for d in candidates:
            if d and os.path.isfile(os.path.join(d, _LIMIT_FILE)):
                return d
        return cfg.get("data_dir") or (_OFFLINE_DATA_CANDIDATES[0] if _OFFLINE_DATA_CANDIDATES else "")

    def _ro_conn(self):
        if not os.path.isfile(self.meta_db):
            raise RuntimeError("找不到只读数据库：%s" % self.meta_db)
        return sqlite3.connect("file:%s?mode=ro" % self.meta_db, uri=True)

    def _read_json(self, name):
        path = os.path.join(self.data_dir, name)
        if not os.path.isfile(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    # ------------------------------------------------------------ 4.1 行业成分
    def _load_stock_basic(self):
        con = self._ro_conn()
        self.code2ind = {}
        self.names = {}
        self.ind_codes = defaultdict(list)
        for ts, nm, ind in con.execute("SELECT ts_code,name,industry FROM stock_basic"):
            c = str(ts)[:6]
            self.names[c] = str(nm or "")
            if ind:
                self.code2ind[c] = str(ind)
                self.ind_codes[str(ind)].append(c)
        con.close()
        self.industries = sorted(self.ind_codes)
        if len(self.industries) != 110:
            raise RuntimeError("行业数应为 110，实际为 %d" % len(self.industries))
        self.ind_codes = dict(self.ind_codes)

    # ------------------------------------------------------------ 4.1 全市场日线
    def _load_daily(self):
        con = self._ro_conn()
        keys = [r[0] for r in con.execute(
            "SELECT cache_key FROM api_cache WHERE cache_key LIKE 'daily_all_%'")]
        self.dates = sorted({k.rsplit("_", 1)[-1] for k in keys if k.rsplit("_", 1)[-1].isdigit()})
        n = len(self.dates)
        self.ti_of = {d: i for i, d in enumerate(self.dates)}
        self.n_dates = n
        # 只保留需要的字段：日收益（小数）+ 复权净值（角色补涨 gain20 用）
        self.px = {}
        self.nav = {}
        for key in keys:
            d = key.rsplit("_", 1)[-1]
            ti = self.ti_of.get(d)
            if ti is None:
                continue
            row = con.execute("SELECT payload FROM api_cache WHERE cache_key=?", (key,)).fetchone()
            if not row:
                continue
            for r in json.loads(row[0]):
                c = str(r.get("ts_code") or "")[:6]
                if not c:
                    continue
                a = self.px.get(c)
                if a is None:
                    a = array("f", [NAN]) * n
                    self.px[c] = a
                pct = r.get("pct_chg")
                a[ti] = _to_float(pct, NAN) / 100.0 if pct is not None else NAN
        for c, a in self.px.items():
            nav = array("f", [1.0]) * n
            v = 1.0
            for ti in range(n):
                if not math.isnan(a[ti]):
                    v *= 1.0 + a[ti]
                nav[ti] = v
            self.nav[c] = nav
        con.close()
        if not self.dates:
            raise RuntimeError("daily_all 缓存为空，无法构建交易日历")

        # 行业全体日收益 / 广度 / 市场收益（位置 r20 用行业全体，不用强势股篮子）
        self.ind_ret = {}
        self.ind_breadth = {}
        for ind, codes in self.ind_codes.items():
            rets, bre = [], []
            for ti in range(n):
                vals = [self.px[c][ti] for c in codes if c in self.px and not math.isnan(self.px[c][ti])]
                rets.append(mean(vals))
                bre.append((sum(1 for v in vals if v > 0) / len(vals)) if vals else 0.0)
            self.ind_ret[ind] = rets
            self.ind_breadth[ind] = bre
        self.mkt = []
        for ti in range(n):
            vals = [a[ti] for a in self.px.values() if not math.isnan(a[ti])]
            self.mkt.append(mean(vals))

    # ------------------------------------------------------------ 决策 1：当日快照
    def _load_strong_pool(self):
        """只用当日强势股快照，不累积历史成分、不做滞后移出。"""
        con = self._ro_conn()
        self.snap = {}
        self.snap_hybk = set()
        for key, payload in con.execute(
                "SELECT cache_key,payload FROM api_cache WHERE cache_key LIKE 'strong_pool_%'"):
            parts = key.split("_")
            if len(parts) < 4 or not parts[2].isdigit():
                continue
            d = parts[2]
            if d not in self.ti_of:
                continue
            obj = json.loads(payload)
            items = {}
            for s in obj.get("stocks") or []:
                code = str(s.get("code") or "")[:6]
                if not code:
                    continue
                name = str(s.get("name") or self.names.get(code, "") or "")
                if self.config["filter_st"] and "ST" in name.upper():
                    continue
                ind = self.code2ind.get(code) or ""
                if ind:
                    self.snap_hybk.add(str(s.get("hybk") or ind))
                items[code] = {
                    "name": name,
                    "zdf": _to_float(s.get("zdf")),
                    "cje": _to_float(s.get("cje")),
                    "limitTimes": _to_int(s.get("limitTimes")),
                    "strongType": str(s.get("strongType") or ""),
                    "ind": ind,
                }
            self.snap[d] = items
        con.close()

    # ------------------------------------------------------------ 4.2⑤ 涨停明细
    def _load_limit_list(self):
        """外部涨停明细按 ts_code[:6] 映射本地行业，绝不按行业名连接。"""
        raw = self._read_json(_LIMIT_FILE)
        self.limit_by_date = {}
        self.limit_dates = set()
        self.limit_coverage = {"total": 0, "mapped": 0}
        if raw is None:
            self.warnings.append("缺少涨停明细 %s，封板质量项按中性处理" % _LIMIT_FILE)
            return
        for d, rows in raw.items():
            if d not in self.ti_of:
                continue
            self.limit_dates.add(d)
            self.limit_coverage["total"] += len(rows)
            agg = {}
            zt_codes = set()
            for r in rows:
                c = str(r.get("ts_code") or "")[:6]
                ind = self.code2ind.get(c)
                if not ind:
                    continue
                self.limit_coverage["mapped"] += 1
                tp = str(r.get("limit") or "")
                a = agg.setdefault(ind, {"U": [], "Z": 0})
                if tp == "U":
                    zt_codes.add(c)
                    a["U"].append({
                        "code": c,
                        "fd": _to_float(r.get("fd_amount")),
                        "first": hhmmss_to_min(r.get("first_time")),
                        "lb": _to_int(r.get("limit_times")),
                        "multi": self._is_multi(r.get("up_stat")),
                    })
                elif tp == "Z":
                    a["Z"] += 1
            self.limit_by_date[d] = {"agg": agg, "zt_codes": zt_codes}

    @staticmethod
    def _is_multi(up_stat):
        s = str(up_stat or "")
        if "/" not in s:
            return False
        try:
            return int(float(s.split("/")[0])) >= 2
        except (TypeError, ValueError):
            return False

    # ------------------------------------------------------------ 4.2⑥ 主力资金
    def _load_moneyflow(self):
        """资金 JSON 已按逐股聚合到本地 110 行业，net 单位为万元。"""
        raw = self._read_json(_MONEYFLOW_FILE)
        self.mf1 = {}
        self.mf_dates = set()
        self.mf_industry_counts = set()
        if raw is None:
            self.warnings.append("缺少主力资金 %s，资金项按中性处理" % _MONEYFLOW_FILE)
            return
        for d, byind in raw.items():
            if d not in self.ti_of:
                continue
            self.mf_dates.add(d)
            self.mf_industry_counts.add(len(byind))
            self.mf1[d] = {ind: _to_float(v.get("net")) / 10000.0
                           for ind, v in byind.items() if isinstance(v, dict)}

    # ------------------------------------------------------------ 角色：总市值快照
    def _load_market_cap(self):
        raw = self._read_json(_CAP_FILE)
        self.cap_snapshots = raw or {}
        if not self.cap_snapshots:
            self.warnings.append("缺少总市值快照 %s，中军角色无法选出" % _CAP_FILE)
        self.cap_dates = sorted(self.cap_snapshots)

    def _cap_at(self, date):
        """取不晚于 T 的最近市值快照（严格 point-in-time）。"""
        key = None
        for d in self.cap_dates:
            if d <= date:
                key = d
            else:
                break
        return self.cap_snapshots.get(key, {}) if key else {}

    # ------------------------------------------------------------ 4.2 面板构建
    def _build_panel(self):
        cfg = self.config
        alpha = float(cfg["ema_alpha"])
        ema_min = float(cfg["ema_effect_min"])
        warmup = int(cfg["warmup"])

        # 记录上一日状态：EMA / run_len / 快照代码集合（只用于事件分解，不用于成员累积）
        prev_n = {ind: 0.0 for ind in self.industries}
        prev_run = {ind: 0 for ind in self.industries}
        prev_codes = {ind: set() for ind in self.industries}
        prev_zt_in_pool = {ind: 0 for ind in self.industries}

        for ti, date in enumerate(self.dates):
            day = {}
            snap = self.snap.get(date, {})
            lim = self.limit_by_date.get(date, {"agg": {}, "zt_codes": set()})
            limits, zt_codes = lim["agg"], lim["zt_codes"]
            mf1_today = self.mf1.get(date, {})
            mf3_days = [self.mf1.get(self.dates[t], {}) for t in range(max(0, ti - 2), ti + 1)]
            # 首次分歧要和「上日池内涨停数」比较，先留出上一日的快照
            prev_zt_snapshot = dict(prev_zt_in_pool)

            for ind in self.industries:
                # ① 成分：只用当日快照（决策 1）
                pool = {c: s for c, s in snap.items() if s["ind"] == ind}
                cur = set(pool)
                n_raw = len(cur)
                # ② 指标层降噪：只对计数做 EMA，成分不动（决策 2）
                n_ema = n_raw if ti == 0 else alpha * n_raw + (1.0 - alpha) * prev_n[ind]
                dn = n_ema - prev_n[ind]
                run_len = prev_run[ind] + 1 if n_ema >= ema_min else 0
                # ③ 事件分解：只落库供复盘，不进判定打分（决策 5）
                pv = prev_codes[ind]
                n_new, n_stay, n_exit = len(cur - pv), len(cur & pv), len(pv - cur)

                # ④ 板块 K 线：当日快照成分的真实日收益（决策 4，不用快照 zdf）
                basket = [self.px[c][ti] * 100.0 for c in cur
                          if c in self.px and not math.isnan(self.px[c][ti])]
                basket_ret = mean(basket)
                basket_breadth = (sum(1 for v in basket if v > 0) / len(basket)) if basket else 0.0
                basket_disp = std(basket)
                zt_in_pool = sum(1 for c in cur if c in zt_codes)
                # 行业全体近 20 日累计收益（百分点）
                r20 = cumret(self.ind_ret[ind][max(0, ti - 19):ti + 1])

                # ⑤ 涨停承接质量
                a = limits.get(ind, {"U": [], "Z": 0})
                u_list, zb_n = a["U"], a["Z"]
                zt_n = len(u_list)
                zbl = zb_n / float(max(1, zt_n + zb_n))
                fd_med = median([u["fd"] for u in u_list if u["fd"]])
                first_min = mean([u["first"] for u in u_list]) if u_list else 120.0
                max_lb = max([u["lb"] for u in u_list], default=0)
                multi_zt = sum(1 for u in u_list if u["multi"])

                # ⑥ 资金：万元 -> 亿元，近 3 日累计
                mf1 = mf1_today.get(ind, 0.0)
                mf3 = sum(m.get(ind, 0.0) for m in mf3_days)

                # 数据可用性
                miss = []
                if date not in self.snap:
                    miss.append("当日强势股快照缺失")
                if date not in self.limit_dates:
                    miss.append("当日涨停明细缺失")
                if date not in self.mf_dates:
                    miss.append("当日主力资金缺失")
                if ti < warmup:
                    miss.append("20 日位置预热不足")

                day[ind] = {
                    "N_raw": n_raw, "N": n_ema, "dN": dn, "run_len": run_len,
                    "N_new": n_new, "N_stay": n_stay, "N_exit": n_exit,
                    "basket_ret": basket_ret, "basket_breadth": basket_breadth,
                    "basket_disp": basket_disp, "zt_in_pool": zt_in_pool,
                    "r20": r20, "ind_breadth": self.ind_breadth[ind][ti],
                    "mkt": self.mkt[ti],
                    "zt_n": zt_n, "zb_n": zb_n, "zbl": zbl,
                    "fd_med": fd_med, "first_min": first_min,
                    "max_lb": max_lb, "multi_zt": multi_zt,
                    "mf1": mf1, "mf3": mf3,
                    "missing": miss,
                }
                prev_n[ind] = n_ema
                prev_run[ind] = run_len
                prev_codes[ind] = cur
                prev_zt_in_pool[ind] = zt_in_pool

            self._cross_section_and_judge(date, ti, day)
            self._stage_machine(date, ti, day, prev_zt_snapshot)
            self.panel[date] = day

        # 阶段机与首次分歧需要按时间顺序回放，判定完成后统一生成输出
        self._finalize_stages()

    # ------------------------------------------------------------ 4.3~4.6 判定
    def _cross_section_and_judge(self, date, ti, day):
        """当日横截面分位（严格同日，绝不跨日）+ 两层判定。"""
        cfg = self.config
        inds = self.industries
        scope = inds if cfg["cross_section_scope"] == "all" else [
            i for i in inds if day[i]["N_raw"] > 0] or inds

        def ranks(key):
            return sorted(day[i][key] for i in scope)

        ns, rs, zs, ms = ranks("N"), ranks("r20"), ranks("zt_n"), ranks("mf3")
        for ind in inds:
            f = day[ind]
            f["qN"] = pct_of(ns, f["N"])
            f["q_r20"] = pct_of(rs, f["r20"])
            f["q_zt"] = pct_of(zs, f["zt_n"])
            f["q_mf3"] = pct_of(ms, f["mf3"])

        # 红线 2：封板质量分位只在当日有涨停的行业之间算
        active = [i for i in inds if day[i]["zt_n"] >= 1]
        for ind in inds:
            day[ind]["q_zbl_in"] = 0.5
            day[ind]["q_fd_in"] = 0.5
            day[ind]["q_fmin_in"] = 0.5
        if len(active) >= 5:
            zbl_s = sorted(day[i]["zbl"] for i in active)
            fd_s = sorted(day[i]["fd_med"] for i in active)
            fm_s = sorted(day[i]["first_min"] for i in active)
            for ind in active:
                f = day[ind]
                f["q_zbl_in"] = pct_of(zbl_s, f["zbl"])
                f["q_fd_in"] = pct_of(fd_s, f["fd_med"])
                f["q_fmin_in"] = pct_of(fm_s, f["first_min"])

        # 4.4 封板质量分：资金项反向；分时特征不进（决策 6 / 7）
        for ind in inds:
            f = day[ind]
            base4 = ((1.0 - f["q_zbl_in"]) + f["q_fd_in"] + (1.0 - f["q_fmin_in"])
                     + min(1.0, f["max_lb"] / 3.0))
            f["base4"] = base4
            f["quality"] = (base4 + (1.0 - f["q_mf3"])) / 5.0

        # 4.5 第一层：板块效应（数量分位 × 延续天数 × 低位分位），没有绝对广度阈值
        for ind in inds:
            f = day[ind]
            f["effect"] = bool(
                f["qN"] >= cfg["qN_min"]
                and f["run_len"] >= cfg["run_len_min"]
                and f["q_r20"] <= cfg["qr20_max"]
                and not f["missing"]
            )

        # 4.6 第二层：只在 EFFECT 候选池内比较，软阈值取当日 60 分位
        s2 = [day[i]["quality"] for i in inds if day[i]["effect"]]
        threshold = percentile(s2, float(cfg["quality_pct"])) if s2 else None
        for ind in inds:
            f = day[ind]
            f["quality_threshold"] = threshold
            f["quality_ok"] = bool(
                threshold is not None
                and f["zt_n"] >= cfg["zt_n_min"]
                and f["zbl"] <= cfg["zbl_max"]
                and f["quality"] >= threshold
            )
            f["start"] = bool(f["effect"] and f["quality_ok"] and not f["missing"])
            f["valid"] = not f["missing"]
            f["s2_candidate"] = f["effect"]

    # ------------------------------------------------------------ 4.7 四态阶段机
    def _stage_machine(self, date, ti, day, prev_zt_in_pool):
        """四态规则是三轮对照实验的固定规则；输入换成 EMA 后的 N / dN / run_len。"""
        if not hasattr(self, "_stage_state"):
            self._stage_state = {i: "冷" for i in self.industries}
            self._stage_neg = {i: 0 for i in self.industries}
            self._stage_since = {i: 999 for i in self.industries}
            self._stage_history = []
        for ind in self.industries:
            f = day[ind]
            state = self._stage_state[ind]
            neg = self._stage_neg[ind] + 1 if f["basket_ret"] < 0 else 0
            self._stage_neg[ind] = neg
            before = state
            if state in ("冷", "退潮"):
                if (f["N"] >= 3 and f["run_len"] >= 2 and f["dN"] > 0
                        and f["basket_ret"] > 0 and f["zt_in_pool"] >= 1):
                    state = "启动"
                elif state == "退潮" and f["N"] < 2:
                    state = "冷"
            elif state in ("启动", "延续"):
                if neg >= 2 and f["dN"] <= -2:
                    state = "退潮"
                elif f["N"] >= 3 and f["zt_in_pool"] >= 1:
                    state = "延续"
                elif f["N"] < 2:
                    state = "冷"
            if state in ("启动", "延续"):
                self._stage_since[ind] = 0 if before not in ("启动", "延续") else self._stage_since[ind] + 1
            else:
                self._stage_since[ind] = 999
            f["stage"] = state
            # 4.8 首次分歧：实验观察标记，未单独验证，不进主判定
            f["first_divergence"] = bool(
                self.config["experimental_divergence"]
                and state in ("启动", "延续")
                and self._stage_since[ind] <= 5
                and f["basket_ret"] < 0
                and f["dN"] < 0
                and f["zt_in_pool"] < prev_zt_in_pool.get(ind, 0)
            )
            self._stage_state[ind] = state

    def _finalize_stages(self):
        """把每个交易日的结果整理成第 5 节输出 schema。"""
        cfg = self.config
        for ti, date in enumerate(self.dates):
            day = self.panel[date]
            records = []
            stage_counts = {"冷": 0, "启动": 0, "延续": 0, "退潮": 0}
            for ind in self.industries:
                f = day[ind]
                stage_counts[f["stage"]] += 1
                effects = {
                    "N_raw": f["N_raw"], "N": round(f["N"], 4), "dN": round(f["dN"], 4),
                    "qN": round(f["qN"], 4), "run_len": f["run_len"],
                    "N_new": f["N_new"], "N_stay": f["N_stay"], "N_exit": f["N_exit"],
                    "r20": round(f["r20"], 4), "q_r20": round(f["q_r20"], 4),
                    "basket_ret": round(f["basket_ret"], 4),
                    "basket_breadth": round(f["basket_breadth"], 4),
                    "basket_disp": round(f["basket_disp"], 4),
                    "zt_n": f["zt_n"], "zb_n": f["zb_n"], "zbl": round(f["zbl"], 4),
                    "q_zt": round(f["q_zt"], 4), "max_lb": f["max_lb"], "multi_zt": f["multi_zt"],
                    "fd_med": round(f["fd_med"], 2), "first_min": round(f["first_min"], 2),
                    "q_zbl_in": round(f["q_zbl_in"], 4), "q_fd_in": round(f["q_fd_in"], 4),
                    "q_fmin_in": round(f["q_fmin_in"], 4),
                    "mf1": round(f["mf1"], 4), "mf3": round(f["mf3"], 4),
                    "q_mf3": round(f["q_mf3"], 4),
                }
                rec = {
                    "trade_date": self._dashed(date),
                    "industry": ind,
                    "valid": f["valid"],
                    "start": f["start"],
                    "stage": f["stage"],
                    "is_review_label": True,
                    "effect": effects,
                    # 扩展字段：供前端直接展示候选池，不在渲染层重算判定
                    "s2_candidate": f["s2_candidate"],
                    "quality": round(f["quality"], 4),
                    "quality_threshold": (round(f["quality_threshold"], 4)
                                          if f["quality_threshold"] is not None else None),
                    "reason": self._reason(f),
                    "warnings": list(f["missing"]),
                    "first_divergence": f["first_divergence"],
                    "first_divergence_experimental": bool(cfg["experimental_divergence"]),
                    "roles": None,
                }
                if cfg["roles_for_all"] or rec["start"] or rec["stage"] != "冷":
                    rec["roles"] = self._roles(date, ti, ind)
                records.append(rec)

            starts = [r["industry"] for r in records if r["start"]]
            self.results[date] = {
                "engine": ENGINE,
                "version": VERSION,
                "trade_date": self._dashed(date),
                "config": {
                    "ema_alpha": cfg["ema_alpha"], "qN_min": cfg["qN_min"],
                    "qr20_max": cfg["qr20_max"], "run_len_min": cfg["run_len_min"],
                    "quality_pct": cfg["quality_pct"],
                    "cross_section_scope": cfg["cross_section_scope"],
                },
                "coverage": self._coverage(date),
                "summary": {
                    "n_records": len(records),
                    "n_start": len(starts),
                    "n_effect": sum(1 for r in records if r["s2_candidate"]),
                    "start_industries": starts,
                    "stage_counts": stage_counts,
                },
                "records": records,
                # 扩展字段：前端「所属板块」列按同一张行业表聚合，避免前 3 个板块漏掉启动行业
                "industry_by_code": {c: i for c, i in self.code2ind.items()},
            }

    @staticmethod
    def _dashed(date):
        d = str(date).replace("-", "")
        return "%s-%s-%s" % (d[:4], d[4:6], d[6:8]) if len(d) == 8 else str(date)

    def _coverage(self, date):
        warn = list(self.warnings)
        if date not in self.snap:
            warn.append("当日强势股快照缺失")
        if date not in self.limit_dates:
            warn.append("当日涨停明细缺失")
        if date not in self.mf_dates:
            warn.append("当日主力资金缺失")
        last_ext = max(self.limit_dates & self.mf_dates) if (self.limit_dates & self.mf_dates) else ""
        first = self.dates[min(int(self.config["warmup"]), len(self.dates) - 1)]
        return {
            "industries": len(self.industries),
            "strong_pool_snapshot": date in self.snap,
            "limit_list": date in self.limit_dates,
            "moneyflow": date in self.mf_dates,
            "recommended_range": [first, last_ext],
            "warnings": warn,
        }

    def _reason(self, f):
        cfg = self.config
        if f["missing"]:
            return "数据缺失，本行不参与判定：" + "、".join(f["missing"])
        if not f["effect"]:
            return "未满足板块效应（数量分位≥%s、连续≥%s日、20日位置≤%s分位）" % (
                cfg["qN_min"], cfg["run_len_min"], cfg["qr20_max"])
        if f["quality_threshold"] is None:
            return "当日无有效候选池"
        if f["zt_n"] < cfg["zt_n_min"]:
            return "涨停承接不足（涨停家数 < %s）" % cfg["zt_n_min"]
        if f["zbl"] > cfg["zbl_max"]:
            return "炸板率偏高（> %s）" % cfg["zbl_max"]
        if f["quality"] < f["quality_threshold"]:
            return "封板质量分未达当日候选池 %s 分位" % int(cfg["quality_pct"] * 100)
        return "板块效应(数量分位+延续)+低位+封板质量达标"

    # ------------------------------------------------------------ 第 7 节 角色绑定
    def _roles(self, date, ti, ind):
        """龙头 / 中军 / 补涨强制互斥；中军按行业全体总市值，补涨按近 20 日涨幅最低。"""
        snap = self.snap.get(date, {})
        pool = [c for c, s in snap.items() if s["ind"] == ind]
        leader = None
        if pool:
            leader = max(pool, key=lambda c: (
                snap[c]["limitTimes"] or 0, snap[c]["zdf"], snap[c]["cje"]))

        caps = self._cap_at(str(date).replace("-", ""))
        all_codes = self.ind_codes.get(ind, [])
        middle = None
        cap_codes = [c for c in all_codes if c in caps and c != leader]
        if cap_codes:
            middle = max(cap_codes, key=lambda c: _to_float(caps[c].get("total_mv")))

        laggard = None
        gain20 = None
        if ti >= 20:
            candidates = []
            for c in all_codes:
                if c in (leader, middle) or c not in self.px:
                    continue
                pct = self.px[c][ti]
                if math.isnan(pct) or pct <= 0:
                    continue
                g = (self.nav[c][ti] / self.nav[c][ti - 20] - 1.0) * 100.0
                candidates.append((g, c))
            if candidates:
                gain20, laggard = min(candidates)

        def pack(code, extra):
            if not code:
                return None
            d = {"code": code, "name": self.names.get(code, "")}
            d.update(extra)
            return d

        return {
            "leader": pack(leader, {
                "limit_times": snap[leader]["limitTimes"] if leader else 0,
                "zdf": snap[leader]["zdf"] if leader else 0.0,
                "cje": snap[leader]["cje"] if leader else 0.0,
                "reason": "当日强势股成员中连板数→涨幅→成交额最高",
            }),
            "middle": pack(middle, {
                "total_mv": _to_float(caps.get(middle, {}).get("total_mv")) if middle else None,
                "reason": "行业全体成分中总市值最大（取不晚于 T 的最近快照）",
            }),
            "laggard": pack(laggard, {
                "gain20": round(gain20, 4) if gain20 is not None else None,
                "zdf": round(self.px[laggard][ti] * 100.0, 4) if laggard else None,
                "reason": "行业全体中当日上涨且近 20 日涨幅最低",
            }),
        }

    # ------------------------------------------------------------ 对外接口
    def evaluate(self, trade_date=None):
        """单日判定，返回全部 110 行业的可序列化 dict。"""
        d = str(trade_date or (_as_of_date or self.dates[-1])).replace("-", "")[:8]
        if _as_of_date and d > _as_of_date:
            d = _as_of_date
        if d not in self.ti_of:
            d = max((x for x in self.dates if x <= d), default=self.dates[0])
        return self.results.get(d, {"engine": ENGINE, "version": VERSION,
                                   "trade_date": self._dashed(d), "records": [],
                                   "coverage": {"warnings": ["该交易日不在面板内"]}})

    def evaluate_range(self, start, end):
        """区间回放：只输出该区间内的交易日结果，并受训练日截止约束。"""
        s = str(start).replace("-", "")[:8]
        e = str(end).replace("-", "")[:8]
        if _as_of_date:
            e = min(e, _as_of_date)
        return [self.results[d] for d in self.dates if s <= d <= e]

    # ------------------------------------------------------------ 离线自检用只读视图
    def facts_input(self):
        """仅供离线验收：返回独立于判定输入的原始数据视图（含未来数据）。"""
        return {
            "dates": self.dates,
            "ti_of": self.ti_of,
            "ind_ret": self.ind_ret,
            "ind_breadth": self.ind_breadth,
            "mkt": self.mkt,
            "zt_ind": {d: {i: len(v["agg"][i]["U"]) for i in v["agg"]}
                       for d, v in self.limit_by_date.items()},
            "lb_ind": {d: {i: max([u["lb"] for u in v["agg"][i]["U"]], default=0)
                           for i in self.industries if i in v["agg"]}
                       for d, v in self.limit_by_date.items()},
        }


# ---------------------------------------------------------------- py_service 注册
class SectorAPI:
    """py_service 常驻进程入口：evaluate / evaluate_range。"""

    _engine = None
    _key = None

    @staticmethod
    def _get_engine(db_root=None, data_dir=None, config=None):
        cfg = dict(config or {})
        if db_root:
            cfg["db_root"] = db_root
        if data_dir:
            cfg["data_dir"] = data_dir
        try:
            import stock_db

            runtime_root = stock_db.get_db_root()
        except Exception:
            runtime_root = None
        # 判定结果不随数据截止日变化（截止日只在 evaluate 里截断请求日期），
        # 因此不把 _as_of_date 放进缓存键，避免训练日推进时反复重载整个面板
        key = (cfg.get("db_root"), cfg.get("data_dir"), runtime_root, _db_root_hint,
               json.dumps(config or {}, sort_keys=True, ensure_ascii=False))
        if SectorAPI._engine is None or SectorAPI._key != key:
            SectorAPI._engine = SectorEngine(cfg)
            SectorAPI._key = key
        return SectorAPI._engine

    @staticmethod
    def evaluate(trade_date=None, db_root=None, data_dir=None, config=None):
        return SectorAPI._get_engine(db_root, data_dir, config).evaluate(trade_date)

    @staticmethod
    def evaluate_range(start=None, end=None, db_root=None, data_dir=None, config=None):
        eng = SectorAPI._get_engine(db_root, data_dir, config)
        return eng.evaluate_range(start or eng.dates[0], end or eng.dates[-1])


# py_service 按模块名推导类名时用的是首字母大写 + API
SectorEngineAPI = SectorAPI


def _stdin_loop():
    """--stdin 长连接：一行 JSON 进、一行 JSON 出，便于 Electron 主进程调用。"""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            method = req.get("method") or "evaluate"
            params = req.get("params") or {}
            if _as_of_date is None and req.get("as_of_date"):
                set_as_of_date(req["as_of_date"])
            if req.get("storage_path"):
                set_cache_dir(req["storage_path"])
            fn = getattr(SectorAPI, method, None)
            if fn is None:
                raise RuntimeError("未知方法：%s" % method)
            data = fn(**params)
            out = {"id": req.get("id"), "ok": True, "data": data}
        except Exception as e:
            out = {"id": (req.get("id") if isinstance(req, dict) else None),
                   "ok": False, "error": str(e)}
            req = req if isinstance(req, dict) else {}
        sys.stdout.write(json.dumps(out, ensure_ascii=False, default=str) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="板块效应启动判定引擎")
    ap.add_argument("--stdin", action="store_true", help="长连接模式：一行 JSON 进、一行 JSON 出")
    ap.add_argument("--date", help="输出单个交易日结果")
    ap.add_argument("--start", help="区间回放起始日")
    ap.add_argument("--end", help="区间回放结束日")
    ap.add_argument("--db-root", help="stock_db 根目录（只读）")
    ap.add_argument("--data-dir", help="离线补拉 JSON 目录（只读）")
    ap.add_argument("--out", help="把结果写入该 JSON 文件（不写数据库）")
    ns = ap.parse_args()
    if ns.stdin:
        _stdin_loop()
    else:
        eng = SectorEngine({"db_root": ns.db_root, "data_dir": ns.data_dir})
        data = (eng.evaluate_range(ns.start, ns.end) if ns.start and ns.end
                else eng.evaluate(ns.date))
        text = json.dumps(data, ensure_ascii=False, default=str)
        if ns.out:
            with open(ns.out, "w", encoding="utf-8") as f:
                f.write(text)
            _log("结果已写入 %s" % ns.out)
        else:
            print(text)
