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

--below-ma 在跳升信号之上再加一条「股价位置」条件：信号日收盘价必须低于指定均线
（可写多个：低于全部才算达标），用来做「低位低吸」而不是「追涨」。
--below-ma-compare 5,10,20 则是把每条均线单独回测一遍，与「无过滤」并排出对比表。

--ma-band 5:20 是「均线区间」条件：收盘价在短均线之上、长均线之下（>MA5 且 <MA20），
对应「中期趋势没坏、短期回调到中继位置」的形态。--ma-band-scan 会把 5/10/20/40/60
的全部两两组合（5:10 / 5:20 / 5:40 / 5:60 / 10:20 / 10:40 / 10:60 / 20:40 / 20:60 / 40:60）
逐个回测并出一张对比表；也可写 --ma-band-scan 5,10,20 只扫这些周期。

--max-hold 3 配合 --no-new-high 即「最多持 3 个交易日，持仓期某日没能刷新买入以来的
新高就次日开盘提前离场」；--newhigh-basis close 可把比较基准从日内最高价换成收盘价。

趋势跟踪卖出（短线信号赚的是「趋势延续」，只看K线、与评分无关；配合 --exit-mode hold
或 --sell 很小即可做成纯趋势跟踪）：
  --trend-exit 2     连续 2 日「收盘<MA5 且 MA5 下行」才卖（横盘 MA5 走平不触发）
  --atr-trail 2.5    吊灯止损：收盘跌破「持仓期最高价 - 2.5×ATR(14)」
  --swing-break 5    收盘跌破持仓期最近 5 日最低收盘（结构破坏）
  --ma-cross-exit    MA5 下穿 MA10（死叉）当日卖出

--cooldown / --max-gap 对应面板（个股详情回测、板块回测）的 cooldownDays / maxGapPct：
  --cooldown 3  卖出成交日起 3 个交易日内不开新仓（默认 0=关闭）
  --max-gap 2   信号日收盘→次日开盘跳空超过 ±2% 则放弃该信号（默认 0=关闭）
  --low-open-break 0.5  次日开盘跌破昨日最低价 0.5% 以上则放弃（强势没被承接，趋势不成立）
  想和面板默认口径完全对齐，再加上 --low-base-max 45（面板默认低位上限是 45，脚本默认 40）。

--census 不做交易，只按 STList「信号」列的判定口径（buyMode=rise 的并集）统计
「跳升买入 / 抬升买入」各自的触发次数、占全部交易日的比例、连续重复比例，
以及信号后 1/3/5/10 个交易日的收益——用来判断某类信号是不是「太容易触发、噪音太多」。

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
import re
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


def _stock_board_map(refresh: bool = False) -> Dict[str, List[str]]:
    """6 位代码 -> 所属东财板块代码列表（概念 + 行业），整表缓存 1 天

    板块效应验证用：把「信号股票」反查到它属于哪些板块。东财没有「股票 -> 板块」的
    反查接口，只能枚举全部板块取成分股再倒排。首次运行需联网逐个板块取数（几百个
    板块，视网速可能几分钟），之后 1 天内读整表缓存、秒出。
    """
    os.makedirs(BOARD_CACHE_DIR, exist_ok=True)
    cache_file = os.path.join(BOARD_CACHE_DIR, "stock_boards.json")
    if not refresh and os.path.exists(cache_file) and time.time() - os.path.getmtime(cache_file) < 86400:
        try:
            with open(cache_file, "r", encoding="utf-8") as fp:
                return json.load(fp)
        except Exception:
            pass
    boards = _board_index(refresh)
    stock_boards: Dict[str, List[str]] = {}
    failed = 0
    for i, code in enumerate(boards, 1):
        try:
            members = fetch_board_members(code, refresh)
        except Exception:
            failed += 1
            continue
        for mcode, _ in members:
            stock_boards.setdefault(mcode, []).append(code)
        progress(i, len(boards), f"构建板块反查 {boards[code]}")
    if failed:
        print(f"[警告] {failed} 个板块取成分股失败已跳过（对应股票的板块覆盖会偏低）")
    try:
        with open(cache_file, "w", encoding="utf-8") as fp:
            json.dump(stock_boards, fp, ensure_ascii=False)
    except Exception:
        pass
    return stock_boards


def _board_kline(board_code: str, refresh: bool = False) -> Dict[str, float]:
    """东财板块指数日K的涨跌幅 {date: zdf%}，缓存 1 天

    板块效应「强度」维度用：板块指数当日涨跌幅代表板块整体强弱（动量延续假设——
    板块当天越强，其内个股信号的后续表现越好）。
    """
    os.makedirs(BOARD_CACHE_DIR, exist_ok=True)
    cache_file = os.path.join(BOARD_CACHE_DIR, f"{board_code}_kline.json")
    if not refresh and os.path.exists(cache_file) and time.time() - os.path.getmtime(cache_file) < 86400:
        try:
            with open(cache_file, "r", encoding="utf-8") as fp:
                return json.load(fp)
        except Exception:
            pass
    url = (
        "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=90.%s"
        "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
        "&klt=101&fqt=1&beg=19900101&end=20500101&lmt=1000000" % board_code
    )
    out: Dict[str, float] = {}
    try:
        payload = _http_json(url).get("data") or {}
        for k in payload.get("klines") or []:
            parts = str(k).split(",")
            if len(parts) >= 9:
                try:
                    out[parts[0]] = float(parts[8])  # f59 = 涨跌幅(%)
                except ValueError:
                    continue
    except Exception:
        pass
    if out:
        try:
            with open(cache_file, "w", encoding="utf-8") as fp:
                json.dump(out, fp, ensure_ascii=False)
        except Exception:
            pass
    return out


# ---------------------------------------------------------------- 概念板块「题材 / 风格」过滤
# 与前端 helpers/boardFilter.ts 同口径：伪概念黑名单优先，再按行业/产业关键词白名单判定题材。

_NON_THEME_PATTERNS = [
    # 1. 规模/估值/风格类
    '盘股|价股',
    '股$',
    '价值股|成长股|周期股|题材股|绩优|微利|亏损|破净|破发|高送转|送转预期',
    '高股息|高分红|低估值|高估值|高成长|低市盈|高市盈|中特估',
    # 2. 交易特征/情绪榜单类
    '高换手|低换手|高振幅|活跃股|超跌|强势股|弱势股|龙头股|妖股|人气股|热门股|热搜',
    '赚钱效应|昨日|涨停|跌停|连板|首板|炸板|打板|触板',
    # 3. 指数成分/榜单类
    r'沪深300|上证50|上证180|上证380|深证100|深成500|中证\d+|国证\d+|央视50',
    '富时|标普|MSCI|罗素|道琼斯|漂亮100|茅指数|宁组合|超级品牌|成份股|权重股',
    r'创业板\d*|科创\d*|北证\d*|三板',
    # 4. 上市/股本/交易属性类
    '次新|B股|AH股|AB股|GDR|ST|摘帽|退市|两融|融资融券|转融券',
    '可转债|转债标的|解禁|大宗交易',
    # 5. 机构持仓/股东类
    '(机构|基金|社保|保险|券商|信托|QFII|公募|私募|北向|外资).{0,2}重仓',
    '重仓|险资|国家队|证金|汇金|参股|持股|股权',
    # 6. 事件/资本运作类
    '举牌|增持|减持|回购|员工持股|股权激励|定向增发|再融资|并购|资产重组|重组上市',
    '重组松绑|重组概念|借壳|壳资源|分拆|整体上市|IPO',
    # 7. 业绩/财务类
    '预盈|预增|预亏|预减|业绩预告|扭亏|高净利',
    # 8. 政策/口号抽象类
    '中字头|国企改革|央企改革|混改|国资|专精特新|独角兽|瞪羚|隐形冠军',
    '乡村振兴|共同富裕|统一大市场|内循环|双循环|新型城镇化|新质生产力',
    # 9. 地域类
    '北京|上海|天津|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东',
    '河南|湖北|湖南|广东|广西|海南|四川|贵州|云南|陕西|甘肃|青海|宁夏|新疆|西藏|内蒙',
    '深圳|广州|杭州|南京|成都|武汉|西安|苏州|厦门|青岛|大连|宁波|珠海|汕头',
    '雄安|粤港澳|长三角|长江三角|珠三角|珠江三角|京津冀|成渝|自贸|特区|一带一路',
    '西部开发|东北振兴|振兴|区域经济|县域经济|湾区经济|都市圈|城市群',
    # 10. 其他杂项
    '百元股',
]

_INDUSTRY_THEME_KEYWORDS = [
    # 医药医疗
    '医药|医疗|生物|疫苗|中药|中成药|化学制药|原料药|创新药|仿制药|特效药|减肥药|药',
    '医疗器械|医疗服务|医院|药店|医美|基因|细胞|免疫|血制品|体外诊断|IVD|CRO|CXO|CDMO',
    '脑机|抗生素|维生素|眼科|口腔|体检|诊断|检测|蛋白|肝素',
    # 机器人/智能制造
    '机器人|人形|减速器|谐波|伺服|丝杠|灵巧手|传感器|工业母机|机床|数控|刀具|注塑机',
    '激光|3D打印|增材|精密|自动化|工业软件|工业互联|智能制造|电机|轴承|液压|气动',
    '模具|铸造|锻压|焊接|工程机械|挖掘机|叉车|重卡',
    # 军工/航天/航空
    '军工|国防|导弹|航天|航空|大飞机|商业航天|卫星|北斗|无人机|低空|通用航空',
    '船舶|航母|雷达|兵装|军贸|eVTOL|飞行汽车|火箭|空间站',
    # 电池/新能源
    '电池|锂|钠离子|固态|液流|燃料电池|氢能|氢|储能|光伏|风电|核电|水电|充电桩|换电',
    '超级电容|电解液|隔膜|正极|负极|铜箔|铝箔|逆变器|硅料|硅片|组件|光伏设备|光热',
    '新能源|碳中和|碳交易|绿电|虚拟电厂|特高压|智能电网|电网|电力|变压器|生物质能',
    # 半导体/电子
    '半导体|芯片|集成电路|光刻|存储|封测|封装|晶圆|碳化硅|氮化镓|第三代半导体|EDA|MLCC',
    'PCB|消费电子|面板|LED|OLED|被动元件|连接器|光学|镜头|摄像头|声学|无线充电|折叠屏',
    # 计算机/通信/传媒
    '服务器|液冷|CPO|光模块|算力|IDC|数据中心|云计算|边缘计算|网络安全|信创|鸿蒙|操作系统',
    '数据库|数据要素|数字经济|区块链|数字货币|稳定币|支付|人工智能|AI|大模型|AIGC',
    '智能体|机器视觉|语音|无人驾驶|自动驾驶|智能驾驶|车联网|元宇宙|虚拟现实|VR|AR|MR',
    '智能穿戴|通信|5G|6G|光通信|光纤|光缆|卫星互联网|量子|专网',
    '游戏|传媒|影视|院线|短剧|网红|直播|电商|跨境电商|出版|版权|IP|教育|培训|体育|彩票',
    # 汽车
    '汽车|汽车零部件|一体化压铸|轮胎|座椅|商用车|乘用车|摩托车|两轮车|汽车拆解|二手车',
    # 产业链龙头/终端品牌
    '华为|苹果|特斯拉|小米|英伟达|台积电|字节|腾讯|阿里巴巴|百度|美团|拼多多|京东',
    '宁德时代|比亚迪|大疆|三星|高通|英特尔|微软|ChatGPT|DeepSeek',
    # 化工/材料/资源
    '化工|化肥|农药|磷|氟|钛白|MDI|聚氨酯|纯碱|氯碱|有机硅|塑料|橡胶|可降解|化纤',
    '涤纶|氨纶|染料|涂料|添加剂|石墨烯|碳纤维|新材料|稀土|永磁|磁材|石墨',
    '黄金|铜|铝|锌|镍|钴|钨|锑|锡|铅|有色|小金属|盐湖提锂|锂矿|矿',
    '石油|油气|页岩气|天然气|煤炭|焦炭|煤化工',
    # 建筑/地产/基建
    '建筑|建材|水泥|玻璃|玻纤|防水|管材|钢结构|装配式|地产|房地产|物业|城中村|保障房',
    '基建|水利|铁路|公路|高速|桥梁|隧道|装修|家装',
    # 金融
    '银行|券商|证券|保险|信托|期货|金融科技|互联网金融|跨境支付|REITs|创投',
    # 消费
    '白酒|啤酒|酒|食品|饮料|乳业|调味品|预制菜|餐饮|旅游|酒店|免税|零售|超市|百货',
    '家电|白电|黑电|小家电|厨电|家居|家具|造纸|包装|纺织|服装|鞋|化妆品|个护|珠宝',
    '宠物|潮玩|玩具|婴童|母婴|演艺|会展',
    # 农业
    '农业|种业|种植|养殖|饲料|农机|转基因|粮食|棉花|糖|猪|鸡|水产',
    # 公用/环保/交运
    '环保|水务|固废|污水|垃圾|再生|循环|燃气|供热|园林',
    '航运|港口|物流|快递|供应链|机场|航空运输|交通',
    # 钢铁/金属/其他制造
    '钢铁|钢|煤|石化|炼化|陶瓷|印刷|仪器|仪表|安防|金属',
    # 泛行业词
    '软件|物联网|消费|工业',
    # 新兴/细分题材
    '东数西算|电子烟|培育钻石|钻石|供销社|蓄能|地热|数字人|人脑|辅助生殖|三胎|生育',
    '养老|托育|代糖|人造肉|云|芯|屏|智驾|星闪|UWB|WiFi|IPv6|毫米波|智慧城市|智慧政务',
    '材料|超导|核聚变|磁悬浮|抗病毒|数字',
    # 通用兜底
    '经济|数据|概念',
]

_NON_THEME_RE = [re.compile(p) for p in _NON_THEME_PATTERNS]
_INDUSTRY_THEME_RE = re.compile("|".join(_INDUSTRY_THEME_KEYWORDS))


def is_style_board(name: str) -> bool:
    """名称以「风格」结尾的板块（与 STList「只看风格」同口径）"""
    return str(name or "").strip().endswith("风格")


def is_theme_board(name: str) -> bool:
    """true=产业/技术题材板块；false=风格/指数/持仓/地域等伪概念（与前端 boardFilter 同口径）"""
    text = str(name or "").strip()
    if not text:
        return False
    if any(rx.search(text) for rx in _NON_THEME_RE):
        return False
    return bool(_INDUSTRY_THEME_RE.search(text))


def _concept_boards(refresh: bool = False) -> Dict[str, str]:
    """东财概念板块（仅 t:3，含风格/题材等，与前端「概念」口径一致），缓存 7 天"""
    os.makedirs(BOARD_CACHE_DIR, exist_ok=True)
    cache_file = os.path.join(BOARD_CACHE_DIR, "concept_boards.json")
    if not refresh and os.path.exists(cache_file) and time.time() - os.path.getmtime(cache_file) < 7 * 86400:
        try:
            with open(cache_file, "r", encoding="utf-8") as fp:
                return json.load(fp)
        except Exception:
            pass
    items = _em_list("m:90 t:3 f:!50")
    boards = {str(x.get("f12")): str(x.get("f14")) for x in items if x.get("f12")}
    if boards:
        with open(cache_file, "w", encoding="utf-8") as fp:
            json.dump(boards, fp, ensure_ascii=False)
    return boards


def _industry_boards(refresh: bool = False) -> Dict[str, str]:
    """东财行业板块（仅 t:2），缓存 7 天

    板块效应验证的「行业」口径用：每只股票只属于一个行业板块，天然无多重归属，
    是检验「板块轮动/共振」最干净的定义。
    """
    os.makedirs(BOARD_CACHE_DIR, exist_ok=True)
    cache_file = os.path.join(BOARD_CACHE_DIR, "industry_boards.json")
    if not refresh and os.path.exists(cache_file) and time.time() - os.path.getmtime(cache_file) < 7 * 86400:
        try:
            with open(cache_file, "r", encoding="utf-8") as fp:
                return json.load(fp)
        except Exception:
            pass
    items = _em_list("m:90 t:2 f:!50")
    boards = {str(x.get("f12")): str(x.get("f14")) for x in items if x.get("f12")}
    if boards:
        with open(cache_file, "w", encoding="utf-8") as fp:
            json.dump(boards, fp, ensure_ascii=False)
    return boards


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
    __slots__ = ("code", "name", "dates", "scores", "volume", "rsi", "rsi_pattern")

    def __init__(
        self, code: str, name: str, dates: List[str], scores: List[float],
        volume: Optional[List[Optional[float]]] = None,
        rsi: Optional[List[Optional[float]]] = None,
        rsi_pattern: Optional[List[str]] = None,
    ):
        self.code = code
        self.name = name
        self.dates = dates  # YYYY-MM-DD 升序
        self.scores = scores
        # 评分里的「量能」维度（0~30），与 dates 对齐；None = 该行取不到（质量分按中性计）
        self.volume = volume if volume is not None else [None] * len(dates)
        # 评分里的「RSI」形态分（0~40，权重为 0 仅展示），与 dates 对齐；None = 取不到
        self.rsi = rsi if rsi is not None else [None] * len(dates)
        # RSI 命中情形文案（如「金叉｜RSI6=78 偏高，下调15分」），与 dates 对齐
        self.rsi_pattern = rsi_pattern if rsi_pattern is not None else [""] * len(dates)


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
        by_version: Dict[object, List[Tuple[str, float, Optional[float], Optional[float], str]]] = {}
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
            vol = row.get("volumeScore")
            vol = float(vol) if isinstance(vol, (int, float)) else None
            rsi = row.get("rsiScore")
            rsi = float(rsi) if isinstance(rsi, (int, float)) else None
            pat = str(row.get("rsiPattern") or "")
            by_version.setdefault(row.get("v"), []).append((fmt_date(d), float(total), vol, rsi, pat))
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
        out[code] = Series(
            code, name,
            [i[0] for i in items], [i[1] for i in items], [i[2] for i in items],
            [i[3] for i in items], [i[4] for i in items],
        )
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


def faster_rsi(closes: Sequence[float], interval: int = 6) -> List[Optional[float]]:
    """Wilder 平滑 RSI，与前端 trading-signals 的 FasterRSI(interval) 同口径

    前 interval 个涨跌用简单平均起算，之后按 avg = avg + (cur - avg) / interval 平滑；
    平均跌幅为 0 时 RSI=100。返回与 closes 等长的序列，前 interval 个位置为 None。
    """
    n = len(closes)
    out: List[Optional[float]] = [None] * n
    if n < interval + 1:
        return out
    gain_sum = 0.0
    loss_sum = 0.0
    avg_gain = 0.0
    avg_loss = 0.0
    for i in range(1, n):
        ch = closes[i] - closes[i - 1]
        g = ch if ch > 0 else 0.0
        l = -ch if ch < 0 else 0.0
        if i <= interval:
            gain_sum += g
            loss_sum += l
            if i == interval:
                avg_gain = gain_sum / interval
                avg_loss = loss_sum / interval
        else:
            avg_gain += (g - avg_gain) / interval
            avg_loss += (l - avg_loss) / interval
        if i < interval:
            continue
        out[i] = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (avg_gain / avg_loss + 1.0)
    return out


class Bars:
    __slots__ = (
        "dates", "opens", "closes", "highs", "lows", "zdf", "circ_mv",
        "ma5", "ma10", "ma20", "ma40", "ma60", "vols", "atr14", "rsi6",
    )

    def __init__(self, dates, opens, closes, highs, lows, zdf, circ_mv, vols=None):
        self.dates = dates
        self.opens = opens
        self.closes = closes
        self.highs = highs
        self.lows = lows
        self.zdf = zdf            # 当日涨跌幅（%）
        self.circ_mv = circ_mv    # 推算流通市值（元）：成交额 /(换手率/100)
        self.vols = vols or [0.0] * len(dates)  # 成交量（手），用于「启动日放量」确认
        # RSI6（Wilder 平滑），用于「RSI 冲高提前止盈」这类超买卖出
        self.rsi6 = faster_rsi(closes, 6)

        # ATR(14)：真实波幅的 14 日简单均值，用于「最高价 - K×ATR」这类趋势跟踪止损
        trs: List[float] = []
        atr14: List[Optional[float]] = []
        for i in range(len(dates)):
            if i == 0:
                tr = max(0.0, highs[0] - lows[0])
            else:
                pc = closes[i - 1]
                tr = max(highs[i] - lows[i], abs(highs[i] - pc), abs(lows[i] - pc))
            trs.append(max(0.0, tr))
            atr14.append(sum(trs[i - 13:i + 1]) / 14 if i >= 13 else None)
        self.atr14 = atr14

        def sma(n: int) -> List[Optional[float]]:
            """前复权收盘的 n 日均线（不足 n 日为 None）"""
            out: List[Optional[float]] = []
            run = 0.0
            for i, c in enumerate(closes):
                run += c
                if i >= n:
                    run -= closes[i - n]
                out.append(run / n if i >= n - 1 else None)
            return out

        # MA5/MA10/MA20/MA40：既可做「站上均线才买」的趋势过滤，也可做「跌破/夹在均线之间才买」的低吸过滤
        self.ma5 = sma(5)
        self.ma10 = sma(10)
        self.ma20 = sma(20)
        self.ma40 = sma(40)
        # MA60（前复权收盘）：判断个股是「长期下行（主要运行在 60 日线下方）」还是
        # 「震荡/上行（主要在 60 日线上方）」，用于分组验证策略在两种环境下的表现
        self.ma60 = sma(60)

    def ma(self, period: int, idx: int) -> Optional[float]:
        """取第 idx 根K线的 n 日均线；只支持 5/10/20/40/60，其余周期返 None"""
        series = {
            5: self.ma5, 10: self.ma10, 20: self.ma20, 40: self.ma40, 60: self.ma60,
        }.get(int(period))
        if series is None or idx < 0 or idx >= len(series):
            return None
        return series[idx]

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
        "SELECT trade_date, kp, sp, zg, zd, zdf, cje, hsl, cjl FROM daily_kline "
        "WHERE kind='stock' AND ts_code=? AND period='daily' AND COALESCE(adjust,'')=? "
        "AND trade_date BETWEEN ? AND ? ORDER BY trade_date",
        (to_ts_code(code), ADJUST, start, end),
    ).fetchall()
    dates, opens, closes, highs, lows, zdfs, mvs, vols = [], [], [], [], [], [], [], []
    for d, kp, sp, zg, zd, zdf, cje, hsl, cjl in rows:
        if kp is None or sp is None:
            continue
        dates.append(str(d))
        opens.append(float(kp))
        closes.append(float(sp))
        highs.append(float(zg) if zg is not None else float(sp))
        lows.append(float(zd) if zd is not None else float(sp))
        zdfs.append(float(zdf) if zdf is not None else None)
        # 流通市值反推：换手率 = 成交量 / 流通股本，成交额 ≈ 成交量 × 均价
        mvs.append((float(cje) / (float(hsl) / 100.0)) if cje and hsl else None)
        vols.append(float(cjl) if cjl is not None else 0.0)
    if len(dates) < 30:
        return None
    return Bars(dates, opens, closes, highs, lows, zdfs, mvs, vols)


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
    below_ma: Sequence[int] = (),
    no_new_high: bool = False,
    newhigh_basis: str = "high",
    score_exit: bool = True,
    ma_bands: Sequence[Tuple[int, int]] = (),
    cooldown: int = 0,
    max_gap: float = 0.0,
    low_open_break: float = 0.0,
    price_trail: float = 0.0,
    take_profit: float = 0.0,
    ma_exit: int = 0,
    vol_stall: float = 0.0,
    score_price_both: bool = False,
    trend_exit: int = 0,
    atr_trail: float = 0.0,
    swing_break: int = 0,
    ma_cross_exit: bool = False,
    rsi_exit: float = 0.0,
) -> Tuple[List[Trade], Dict[str, float], int]:
    """单只股票回测。

    exec_lag=1：信号日次日开盘成交（默认，贴近真实可执行性）
    exec_lag=0：信号日收盘成交（乐观口径，用于对照）

    jump_window：跳升按「几个评分日累计」算（1=只看单日）。低位启动常常分两天完成
    （+8 然后 +17，单日都不到 20），窗口 >1 才能识别这类信号。
    min_rise：评分下限的「相对口径」——score >= 窗口内最低分 + min_rise 也算达标，
    与绝对下限 --min-score 是「或」的关系。低位启动当天很难直接到 60 分，绝对下限
    会把这类信号全部挡掉。

    below_ma：低吸过滤——收盘价必须同时低于列表里所有均线（如 (5,) / (5,10) / (20,)）。
    与 trend_filter（收盘站上 MA20）互斥，同时开启时会互相抵消。
    ma_bands=[(5,20)]：均线区间过滤——收盘价必须落在两条均线之间（> MA5 且 < MA20），
    对应「短均线在上、股价还没跌到长均线」的中继回调形态。传多个区间时要求同时满足。
    no_new_high：持仓期只要某日没能创出「买入以来的新高」就次日开盘卖出（提前离场），
    配合 max_hold=3 即「最多持 3 天，途中不再创新高就提前走」。
    newhigh_basis：创新高的比较基准，high=日内最高价（更灵敏）/ close=收盘价（更稳）。
    cooldown：卖出成交日起 N 个交易日内不再开新仓（0=关闭）。与面板 cooldownDays 同口径，
    避免「绿柱卖出后反抽又追回」在同一波下跌里来回挨打。
    max_gap：信号日收盘 → 次日开盘跳空超过 ±该比例（0.02=2%）时放弃本次信号（0=关闭）。
    与面板 maxGapPct 同口径，防止追高开或破位低开时按次日开盘价接盘；只在
    exec_lag=1（次日开盘成交）口径下有意义，exec_lag=0 时自动忽略。
    low_open_break：次日开盘价跌破「昨日最低价」超过该比例（0.005=0.5%）时放弃本次信号
    （0=关闭）。max_gap 是相对昨收的跳空幅度，这里是相对昨日低点的支撑破位——低开破
    前一日低点说明强势没被承接，趋势延续的前提不成立。同样只在 exec_lag=1 时生效。

    价格类卖出（短线评分下跌 ≠ 股价下跌，评分止盈常卖在拉升途中，需要价格口径的替代）：
    price_trail：自持仓期最高收盘回撤 >= 该比例（0.05=5%）卖出（0=关闭）。
    take_profit：收盘收益 >= 该比例（0.10=10%）卖出（0=关闭）。
    ma_exit：收盘跌破 MA(n) 卖出，n 只支持 5/10/20/40/60（0=关闭）。
    vol_stall：成交量 >= 该倍数 × 前 5 日均量 且当日涨幅 < 1% → 放量滞涨卖出（0=关闭）。
    score_price_both：评分绿柱卖出要求「当日价格同时下跌」才执行，避免评分先转头、
    股价仍在拉升时被提前卖掉。

    趋势跟踪卖出（短线信号的逻辑是「趋势延续」，只有趋势转跌才该走，震荡/继续上涨都应持有）：
    trend_exit：连续 N 个交易日「收盘 < MA5 且 MA5 下行」才卖（N=2 较稳）；横盘震荡时
    MA5 走平、收盘在均线附近来回，不会触发。
    atr_trail：吊灯止损——收盘跌破「持仓期最高价 - K×ATR(14)」卖出（常用 K=2~3）；
    波动大时自动放宽，避免正常回抽被洗出。
    swing_break：收盘跌破「持仓期最近 N 日最低收盘」卖出（结构破坏）。
    ma_cross_exit：MA5 下穿 MA10（死叉）当日卖出。
    这四个都只看K线，和评分无关；关闭评分卖出（score_exit=False）即可纯趋势跟踪。

    trace 不为 None 时，把每个「跳变显著或发生交易」的决策点写入该列表，
    用于单只股票的人工核对（--code）。

    返回 (已平仓交易列表, {交易日: 当日槽位收益率}, 持有交易日数)
    """
    trades: List[Trade] = []
    daily: Dict[str, float] = {}
    pos = None
    # 上一笔卖出成交的K线下标（-1=从未卖出）；冷却期以此为基准判断「卖出后第几天」
    last_exit_idx = -1

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

    def scan_hold_rule(p: dict, upto_idx: int) -> Optional[Tuple[int, str]]:
        """在K线层面找最早的持仓离场点（(bar 下标, 原因)），不受评分缺口影响

        评分序列可能缺日（缓存补算不连续），按评分日数「持有天数」会严重失真——
        曾出现过「3 天持有上限」实际持了 23 天。所以持仓规则一律按日K交易日推进：

          止损   ：收盘价较买入价 <= -stop_loss
          RSI止盈：RSI6 冲到 rsi_exit 以上（超买）提前止盈，rsi_exit=0 关闭
          不再新高：当日最高价(或收盘)没有超过买入以来的高点 → 动能中断
          趋势转跌：连续 trend_exit 日「收盘 < MA5 且 MA5 下行」
          吊灯止损：收盘跌破「持仓期最高价 - atr_trail × ATR(14)」
          跌破低点：收盘跌破「持仓期最近 swing_break 日最低收盘」
          均线死叉：MA5 下穿 MA10
          到期   ：持有到第 max_hold 个交易日（买入日算第 1 天）

        同一根K线多个条件同时成立时按上面的顺序取标签（成交价一致，只影响原因分布）。
        """
        j0 = p["last_scan"] + 1
        if upto_idx < j0:
            return None
        peak = p["peak_px"]
        for j in range(j0, upto_idx + 1):
            p["last_scan"] = j
            close = bars.closes[j]
            if stop_loss > 0 and close / p["price"] - 1 <= -stop_loss:
                return j, "止损"
            # RSI6 冲高到超买区提前止盈（rsi_exit>0 开启）：与评分绿柱/回撤止盈互不冲突，
            # 谁先触发按触发日先后取早的那个（同一天则评分卖出优先，见下方 candidates 排序）
            if rsi_exit > 0:
                r = bars.rsi6[j]
                if r is not None and r >= rsi_exit:
                    return j, f"RSI6超买{rsi_exit:g}"
            if no_new_high:
                cur = bars.highs[j] if newhigh_basis == "high" else close
                if cur > peak:
                    peak = cur
                    p["peak_px"] = peak
                else:
                    return j, "不再新高"
            # 趋势转跌：连续 N 日收盘跌破 MA5 且 MA5 本身在下行，横盘（MA5 走平）不触发
            if trend_exit > 0:
                ma5 = bars.ma5[j]
                ma5_prev = bars.ma5[j - 1] if j >= 1 else None
                if ma5 is not None and ma5_prev is not None and close < ma5 and ma5 < ma5_prev:
                    p["trend_weak"] = p.get("trend_weak", 0) + 1
                else:
                    p["trend_weak"] = 0
                if p["trend_weak"] >= trend_exit:
                    return j, f"趋势转跌{trend_exit}日"
            # 吊灯止损：最高价随行情上移，止损线 = 最高价 - K×ATR，波动大时自动放宽
            if atr_trail > 0:
                if bars.highs[j] > p["peak_high"]:
                    p["peak_high"] = bars.highs[j]
                atr = bars.atr14[j]
                if atr is not None and atr > 0 and close < p["peak_high"] - atr_trail * atr:
                    return j, f"吊灯止损{atr_trail:g}ATR"
            # 结构破坏：跌破持仓期最近 N 日最低收盘（不含当日，当日算进就永远不成立）
            if swing_break > 0 and j - p["idx"] >= swing_break:
                if close < min(bars.closes[j - swing_break:j]):
                    return j, f"跌破{swing_break}日低点"
            if ma_cross_exit and j >= 1:
                ma5, ma10 = bars.ma5[j], bars.ma10[j]
                ma5_prev, ma10_prev = bars.ma5[j - 1], bars.ma10[j - 1]
                if (
                    ma5 is not None and ma10 is not None
                    and ma5_prev is not None and ma10_prev is not None
                    and ma5_prev >= ma10_prev and ma5 < ma10
                ):
                    return j, "MA5死叉MA10"
            if max_hold > 0 and j - p["idx"] + 1 >= max_hold:
                return j, "到期"
        p["peak_px"] = peak
        return None

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
            # 持仓期最高评分（含买入信号日）：评分从高位阴跌时，单日 Δ 往往很小，
            # 光靠「单日跳降 -15」会一路坐电梯，所以按「自最高点回撤」止盈。
            if score > pos["peak"]:
                pos["peak"] = score
            drop = pos["peak"] - score
            # 持仓规则按K线推进（不受评分缺口影响）；评分卖出仍按评分日判定
            hit = scan_hold_rule(pos, bi) if bi >= 0 else None
            score_reason = None
            if score_exit and delta is not None and delta <= sell_delta:
                # 评分下跌 ≠ 股价下跌：score_price_both 打开时，只有「评分绿柱 + 当日价跌」才卖
                price_down = bi >= 1 and bars.closes[bi] < bars.closes[bi - 1]
                if (not score_price_both) or price_down:
                    score_reason = "评分下跌+价跌" if score_price_both else "绿柱卖出"
            elif score_exit and trail_drop > 0 and drop >= trail_drop:
                score_reason = "回撤止盈"  # 具体回撤值写进明细，避免卖出原因表被数值打散

            # ---- 价格类卖出（不看评分，只看K线）----
            px_reason = None
            if bi >= 1:
                close = bars.closes[bi]
                prev_close_px = bars.closes[bi - 1]
                if price_trail > 0:
                    pos["peak_close"] = max(pos.get("peak_close", pos["price"]), close)
                    peak_px = pos["peak_close"]
                    if peak_px > 0 and (peak_px - close) / peak_px >= price_trail:
                        px_reason = f"价格回撤{price_trail*100:g}%"
                if px_reason is None and take_profit > 0:
                    if close / pos["price"] - 1 >= take_profit:
                        px_reason = f"目标+{take_profit*100:g}%"
                if px_reason is None and ma_exit > 0:
                    ma_v = bars.ma(ma_exit, bi)
                    if ma_v is not None and close < ma_v:
                        px_reason = f"跌破MA{ma_exit}"
                if px_reason is None and vol_stall > 0:
                    base_vol = sum(bars.vols[bi - 5:bi]) / 5 if bi >= 5 else 0.0
                    if (
                        base_vol > 0
                        and bars.vols[bi] >= base_vol * vol_stall
                        and bars.zdf[bi] < 1.0
                    ):
                        px_reason = "放量滞涨"
            # 多个规则触发时：先看触发日（越早越优先），同一天按「评分 > 价格 > 持仓规则」取标签
            # （成交价一致，标签只影响卖出原因分布）
            candidates: List[Tuple[int, int, str]] = []
            if score_reason is not None:
                candidates.append((bi, 0, score_reason))
            if px_reason is not None:
                candidates.append((bi, 1, px_reason))
            if hit is not None:
                candidates.append((hit[0], 2, hit[1]))
            reason = None
            exit_bar = None
            if candidates:
                candidates.sort(key=lambda x: (x[0], x[1]))
                exit_bar, _, reason = candidates[0]
            if reason is None:
                if rec is not None and delta is not None and delta >= buy_delta:
                    mark("持有中", f"已有持仓（{pos['date']} 买入），忽略新的跳升")
                elif rec is not None:
                    mark("持有中", "")
                continue
            fill = exec_price_and_date(bars.dates[exit_bar] if exit_bar is not None else d)
            if fill is None:
                mark("持有中", "卖出信号但次日无K线可成交")
                continue
            exit_date, exit_price, exit_idx = fill
            last_exit_idx = exit_idx
            ret = exit_price / pos["price"] - 1 - fee
            trades.append(
                Trade(
                    code=s.code, name=s.name, signal_in=pos["signal_date"],
                    entry_date=pos["date"], entry_price=pos["price"],
                    signal_out=bars.dates[exit_bar] if exit_bar is not None else d,
                    exit_date=exit_date, exit_price=exit_price,
                    exit_reason=reason, bars=exit_idx - pos["idx"], ret=ret,
                    ma60_below=ma60_below_ratio(bars, bars.index_of(pos["signal_date"])),
                )
            )
            if reason == "回撤止盈":
                reason_txt = f"{reason}（峰值 {pos['peak']:.1f}，回撤 {drop:.1f}）"
            elif reason == "不再新高":
                reason_txt = f"{reason}（买入以来高点 {pos['peak_px']:.2f}，未能刷新）"
            else:
                reason_txt = reason
            mark("卖出", f"{reason_txt}，{exit_date} 开盘 {exit_price:.2f} 卖出，收益 {ret*100:+.2f}%")
            # 槽位逐日收益：买入日(收盘/买入价)、持有日(收盘/前收)、卖出日(卖价/前收)
            _accumulate_daily(daily, bars, pos["idx"], exit_idx, pos["price"], exit_price, fee)
            pos = None
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
        if ok and below_ma:
            # 跌破均线才买（低吸口径）：收盘必须低于列表里所有均线，任一不满足即放弃
            if bi < 0:
                ok, fail = False, "信号日无K线，无法判断均线位置"
            else:
                above = []
                missing = []
                for p in below_ma:
                    ma_v = bars.ma(p, bi)
                    if ma_v is None:
                        missing.append(f"MA{p}")
                    elif bars.closes[bi] >= ma_v:
                        above.append(f"收盘 {bars.closes[bi]:.2f} ≥ MA{p} {ma_v:.2f}")
                if above:
                    ok, fail = False, "；".join(above)
                elif missing:
                    ok, fail = False, f"{'/'.join(missing)} 数据不足"
        if ok and ma_bands:
            # 均线区间：收盘价夹在两条均线之间（短均线上方、长均线下方 = 上升中继回调）
            if bi < 0:
                ok, fail = False, "信号日无K线，无法判断均线区间"
            else:
                for low_p, high_p in ma_bands:
                    lo_v, hi_v = bars.ma(low_p, bi), bars.ma(high_p, bi)
                    if lo_v is None or hi_v is None:
                        ok, fail = False, f"MA{low_p if lo_v is None else high_p} 数据不足"
                        break
                    if bars.closes[bi] <= lo_v:
                        ok, fail = False, (
                            f"收盘 {bars.closes[bi]:.2f} ≤ MA{low_p} {lo_v:.2f}（未站上短均线）"
                        )
                        break
                    if bars.closes[bi] >= hi_v:
                        ok, fail = False, (
                            f"收盘 {bars.closes[bi]:.2f} ≥ MA{high_p} {hi_v:.2f}（未跌破长均线）"
                        )
                        break
        if ok and require_limit_up and not is_limit_up(bars, bi, s.code):
            ok, fail = False, f"未涨停（涨幅 {bars.zdf[bi] if bi >= 0 else 0:.2f}%）"
        if ok and min_mv > 0:
            mv = bars.mv_at(bi) if bi >= 0 else None
            if mv is None or mv < min_mv:
                ok = False
                fail = f"流通市值 {('--' if mv is None else f'{mv/1e8:.1f}亿')} < {min_mv/1e8:.0f}亿"
        if ok and cooldown > 0 and last_exit_idx >= 0 and bi >= 0:
            # 冷却期按K线交易日推进：卖出成交日记为第 0 天，第 1~N 天不开新仓
            since = bi - last_exit_idx
            if 0 <= since <= cooldown:
                ok = False
                fail = f"卖出后冷却中（第 {since} 个交易日，需 > {cooldown}）"
        if ok and max_gap > 0 and exec_lag == 1:
            # 跳空过滤：信号日收盘 → 次日开盘，高开追涨 / 低开破位都放弃
            if bi < 0:
                ok, fail = False, "信号日无K线，无法判断跳空"
            else:
                nxt = bars.next_index(d)
                close = bars.closes[bi]
                if nxt < 0 or nxt >= len(bars.dates):
                    ok, fail = False, "次日无K线，无法判断跳空"
                elif close > 0:
                    gap = bars.opens[nxt] / close - 1
                    if abs(gap) > max_gap:
                        ok, fail = False, f"次日跳空 {gap*100:+.2f}%（限 ±{max_gap*100:g}%）"
        if ok:
            fill = exec_price_and_date(d)
            if fill is None:
                mark("跳过", "次日无K线，无法成交")
                continue
            entry_date, entry_price, entry_idx = fill
            if entry_price <= 0:
                mark("跳过", "次日开盘价无效")
                continue
            # 低开破位过滤：次日开盘明显低于「昨日最低价」，说明前一天的强势没被承接，
            # 「趋势延续」的前提不成立（低开后再反抽只是回抽，不是延续），放弃本次信号。
            if low_open_break > 0 and entry_idx > 0:
                prev_low = bars.lows[entry_idx - 1]
                if prev_low > 0 and entry_price < prev_low * (1 - low_open_break):
                    mark(
                        "跳过",
                        f"次日低开 {entry_price:.2f} 破昨日最低 {prev_low:.2f}"
                        f"（{(entry_price / prev_low - 1) * 100:+.2f}%），趋势不成立",
                    )
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
                # 「不再创新高」的比较基准：买入日(含)以来的最高价/最高收盘，起点取买入价
                "peak_px": max(
                    entry_price,
                    bars.highs[entry_idx] if newhigh_basis == "high" else bars.closes[entry_idx],
                ),
                # 价格移动止盈的比较基准（收盘价口径，含买入价）
                "peak_close": max(entry_price, bars.closes[entry_idx]),
                # 吊灯止损的最高价基准（日内最高价口径，含买入日）
                "peak_high": max(entry_price, bars.highs[entry_idx]),
                # 「连续 N 日收盘 < MA5 且 MA5 下行」的连续计数
                "trend_weak": 0,
                "last_scan": entry_idx,  # 持仓规则已扫描到的K线下标（买入日已计入）
            }
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
        # 按笔顺序复利（与股票排名口径一致）：低频策略单笔期望更能说明问题
        "compound": _compound(rets),
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
    below_ma: Sequence[int] = (), no_new_high: bool = False, newhigh_basis: str = "high",
    score_exit: bool = True, ma_bands: Sequence[Tuple[int, int]] = (),
    cooldown: int = 0, max_gap: float = 0.0, low_open_break: float = 0.0,
    price_trail: float = 0.0, take_profit: float = 0.0, ma_exit: int = 0,
    vol_stall: float = 0.0, score_price_both: bool = False,
    trend_exit: int = 0, atr_trail: float = 0.0, swing_break: int = 0,
    ma_cross_exit: bool = False, rsi_exit: float = 0.0,
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
            below_ma=below_ma, no_new_high=no_new_high, newhigh_basis=newhigh_basis,
            score_exit=score_exit, ma_bands=ma_bands,
            cooldown=cooldown, max_gap=max_gap, low_open_break=low_open_break,
            price_trail=price_trail, take_profit=take_profit, ma_exit=ma_exit,
            vol_stall=vol_stall, score_price_both=score_price_both,
            trend_exit=trend_exit, atr_trail=atr_trail, swing_break=swing_break,
            ma_cross_exit=ma_cross_exit, rsi_exit=rsi_exit,
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
    # 收益贡献 = 频率 × 单笔期望 = Σ单笔收益 / 股票年：判断「信号变少但每笔更赚」是否更划算，
    # 比逐笔复利更实在（复利要求收益按顺序全额滚动，和真实多股票并行持仓对不上）
    contrib = st["trades_per_stock_year"] * st["avg_ret"]
    print(
        f"按笔夏普（年化） {st['sharpe_trade']:.2f}  收益贡献 {contrib*100:+.1f}%/股票年"
        f"（= 频率 × 期望，用来比较「总获利」）"
    )
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


def signal_census(data, args, horizons=(1, 3, 5, 10)) -> None:
    """按 STList「信号」列的判定口径统计两类买入信号的触发量与信号后收益

    口径与应用完全一致（shortTermScoreBacktest.ts 的 evaluateShortScoreSignal，buyMode=rise）：
      - 跳升买入：Δ ≥ buyDelta 且 评分 ≥ riseMinScore，且（突变前 N 日最高 ≤ lowBaseMax 或 近 N 日最低 ≤ lowBaseMax）；
      - 抬升买入：当日 Δ ≥ 0 且 自近 riseRefDays 日最低抬升 ≥ minRise 且 评分 ≥ riseMinScore
                  且 抬升起点（近 N 日最低）≤ lowBaseMax；两者同时成立时归「跳升买入」。
    因此「抬升买入」= 不满足跳升分支、但满足抬升分支的那些日子，正是用户觉得「太容易触发」的那类。

    额外统计「连续触发」：同一只股票相邻交易日连续出抬升买入的次数占比——
    占比高说明同一个形态会连着几天反复出信号（实际持仓时这些天根本不该再开仓）。
    信号后收益：次日开盘买入、持有 h 个交易日收盘卖出（未扣成本），与「无条件全样本」对照。
    """
    buy_delta = float(args.buy)
    ref_days = max(1, int(args.rise_ref_days))
    rise_floor = float(args.rise_min_score)
    min_rise = float(args.min_rise) if args.min_rise > 0 else 20.0
    low_days = max(0, int(args.low_base_days))
    low_max = float(args.low_base_max)
    # 跳升分支的评分下限：rise 口径与抬升共用绝对地板（应用里 jumpMinScore = riseMinScore）
    jump_floor = rise_floor

    def fwd(bars: Bars, date: str, h: int) -> Optional[float]:
        i0 = bars.next_index(date)
        if i0 < 0 or i0 + h - 1 >= len(bars.dates):
            return None
        return bars.closes[i0 + h - 1] / bars.opens[i0] - 1

    kinds = ("跳升买入", "抬升买入", "抬升·首次", "全部买入")
    stats = {k: {h: [] for h in horizons} for k in kinds}
    stats["无条件基准"] = {h: [] for h in horizons}
    counts = {k: 0 for k in kinds}
    counts["无条件基准"] = 0
    # 连续触发的重复次数（同一只股票相邻交易日再次出抬升买入）
    repeat = 0
    rise_total = 0
    scored_days = 0
    years = 0.0

    for s, bars in data:
        years += len(s.dates) / TRADING_DAYS_PER_YEAR
        prev_rise = False
        for i in range(1, len(s.dates)):
            d = s.dates[i]
            bi, pb = bars.index_of(d), bars.index_of(s.dates[i - 1])
            if bi < 0 or pb < 0 or bi - pb != 1:
                prev_rise = False
                continue
            delta = s.scores[i] - s.scores[i - 1]
            cur = s.scores[i]
            ref = s.scores[max(i - ref_days, 0):i]
            if not ref:
                prev_rise = False
                continue
            low_ref = min(ref)
            rise_amt = cur - low_ref
            low_base_high = max(s.scores[i - low_days:i]) if low_days and i >= low_days else None
            in_low = lambda v: low_days <= 0 or v is None or v <= low_max
            jump_low_ok = in_low(low_base_high) or in_low(low_ref)
            jump_ok = delta >= buy_delta and cur >= jump_floor and jump_low_ok
            rise_ok = (
                (low_days <= 0 or low_ref <= low_max)
                and delta >= 0
                and rise_amt >= min_rise
                and cur >= rise_floor
            )
            # 无条件基准：每个相邻交易日都算一次，作为「这批行情本身」的参照
            base_row = {h: fwd(bars, d, h) for h in horizons}
            for h in horizons:
                if base_row[h] is not None:
                    stats["无条件基准"][h].append(base_row[h])
            counts["无条件基准"] += 1
            scored_days += 1

            if jump_ok:
                kind = "跳升买入"
            elif rise_ok:
                kind = "抬升买入"
            else:
                kind = ""
            if not kind:
                prev_rise = False
                continue
            for h in horizons:
                if base_row[h] is not None:
                    stats[kind][h].append(base_row[h])
                    stats["全部买入"][h].append(base_row[h])
            counts[kind] += 1
            counts["全部买入"] += 1
            if kind == "抬升买入":
                rise_total += 1
                if prev_rise:
                    repeat += 1
                else:
                    for h in horizons:
                        if base_row[h] is not None:
                            stats["抬升·首次"][h].append(base_row[h])
                    counts["抬升·首次"] += 1
            prev_rise = kind == "抬升买入"

    if not scored_days:
        print("没有可统计的评分日")
        return

    def line(name: str, n: int, groups: Dict[int, List[float]]) -> List[str]:
        row = [name, n, f"{n / scored_days * 100:.1f}", f"{n / years:.1f}" if years else "--"]
        for h in horizons:
            v = groups[h]
            if not v:
                row.append("--")
                continue
            win = sum(1 for x in v if x > 0) / len(v) * 100
            row.append(f"{statistics.fmean(v) * 100:+.2f}/{win:.0f}%")
        return row

    headers = ["信号类型", "触发", "占比%", "次/股票年"] + [f"{h}日(均/胜)" for h in horizons]
    rows = [line(k, counts[k], stats[k]) for k in kinds]
    rows.append(line("无条件基准", counts["无条件基准"], stats["无条件基准"]))
    print("\n=== 两类买入信号的触发量与信号后收益（次日开盘买，持 h 日收盘卖，未扣成本）===")
    print(
        f"判定口径：Δ≥{buy_delta:g} 且评分≥{jump_floor:g}（跳升）/ 自近{ref_days}日低点抬升≥{min_rise:g}"
        f"+当日不回落（抬升）/ 低位≤{low_max:g} 持续{low_days}日"
    )
    print(render_table(headers, rows, "lrrr" + "r" * len(horizons)))
    if rise_total:
        print(
            f"抬升买入共 {rise_total} 次，其中 {repeat} 次（{repeat / rise_total * 100:.0f}%）"
            f"是同一只股票前一日已触发后的「连续重复」——实际持仓时这些天并不构成新的开仓信号。"
        )
    print(
        f"跳升买入 {counts['跳升买入']} 次 / 抬升买入 {counts['抬升买入']} 次"
        f"（抬升是跳升的 {counts['抬升买入'] / max(1, counts['跳升买入']):.1f} 倍）"
    )


def board_effect_study(data, args, horizons=(1, 3, 5, 10)) -> None:
    """验证「板块效应」猜想：把每日买入信号按所属板块统计，考察信号更集中的板块
    其后续胜率与收益是否更高。

    信号口径与 signal_census 的「跳升买入」完全一致（evaluateShortScoreSignal 的
    jump 分支）：Δ≥buy 且评分≥riseMinScore 且低位运行。每个信号按「当日所属板块里
    最多触发几只」分成 独苗(1)/双信号(2)/共振(≥3) 三档，并做「当日最热板块 vs 其余
    信号」的同日对照（消除大盘整体涨跌的干扰），最后给一个「逐日差额」汇总。
    """
    buy_delta = float(args.buy)
    rise_floor = float(args.rise_min_score)
    ref_days = max(1, int(args.rise_ref_days))
    low_days = max(0, int(args.low_base_days))
    low_max = float(args.low_base_max)

    stock_map = _stock_board_map(args.refresh_board)
    # 板块范围过滤：all=全部概念+行业 / industry=仅东财行业（单归属，最干净）/ theme=仅产业题材
    scope = args.board_effect_scope
    board_names = _board_index(args.refresh_board)
    scope_codes: set = set()
    if scope == "concept":
        scope_codes = set(_concept_boards(args.refresh_board))
        scope_txt = "概念板块（东财 t:3 全量）"
    elif scope == "industry":
        scope_codes = set(_industry_boards(args.refresh_board))
        scope_txt = "行业板块"
    elif scope == "theme":
        scope_txt = "产业/技术题材板块"
    else:
        scope_txt = "全部概念+行业板块"

    def keep(b: str) -> bool:
        if scope in ("concept", "industry"):
            return b in scope_codes
        if scope == "theme":
            return is_theme_board(board_names.get(b, ""))
        return True

    covered = sum(1 for s, _ in data if any(keep(b) for b in stock_map.get(s.code, [])))
    print(
        f"\n板块反查（口径：{scope_txt}）：样本 {covered}/{len(data)} 只有板块归属"
        f"（全市场共 {len(stock_map)} 只股票被板块索引覆盖）"
    )

    def fwd(bars: Bars, date: str, h: int) -> Optional[float]:
        i0 = bars.next_index(date)
        if i0 < 0 or i0 + h - 1 >= len(bars.dates):
            return None
        return bars.closes[i0 + h - 1] / bars.opens[i0] - 1

    # 第一遍：收集所有「跳升买入」信号，并统计每个 (板块, 交易日) 的信号数
    signals: List[dict] = []
    board_day_count: Dict[Tuple[str, str], int] = {}
    total_jump = 0
    for s, bars in data:
        boards = [b for b in stock_map.get(s.code, []) if keep(b)]
        for i in range(1, len(s.dates)):
            d = s.dates[i]
            bi, pb = bars.index_of(d), bars.index_of(s.dates[i - 1])
            if bi < 0 or pb < 0 or bi - pb != 1:
                continue
            delta = s.scores[i] - s.scores[i - 1]
            cur = s.scores[i]
            ref = s.scores[max(0, i - ref_days):i]
            if not ref:
                continue
            low_ref = min(ref)
            low_base_high = max(s.scores[i - low_days:i]) if low_days and i >= low_days else None
            in_low = lambda v: low_days <= 0 or v is None or v <= low_max
            if not (delta >= buy_delta and cur >= rise_floor and (in_low(low_base_high) or in_low(low_ref))):
                continue
            total_jump += 1
            if not boards:
                continue
            sig = {
                "date": d, "boards": boards,
                "rets": {h: fwd(bars, d, h) for h in horizons},
                "mv": bars.mv_at(bi),  # 信号日流通市值（元），用于判断是否小盘效应
            }
            signals.append(sig)
            for b in boards:
                board_day_count[(b, d)] = board_day_count.get((b, d), 0) + 1

    if not signals:
        print("没有跳升买入信号，无法验证板块效应。可放宽 --buy / --rise-min-score 或加大 --sample。")
        return

    # 当日每个板块的信号数 -> 当日最热板块
    day_board_counts: Dict[str, Dict[str, int]] = {}
    for (b, d), c in board_day_count.items():
        day_board_counts.setdefault(d, {})[b] = c
    day_top: Dict[str, str] = {}
    for d, bcs in day_board_counts.items():
        day_top[d] = max(bcs, key=lambda b: (bcs[b], b))

    # 共振度分档：一个信号若属于多个板块，取「当日所属板块中信号最多的那个」定档
    bucket_keys = ("独苗(1)", "双信号(2)", "共振(≥3)")
    bucket_counts = {k: 0 for k in bucket_keys}
    buckets = {k: {h: [] for h in horizons} for k in bucket_keys}

    top_rets = {h: [] for h in horizons}
    other_rets = {h: [] for h in horizons}
    all_rets = {h: [] for h in horizons}
    top_count = other_count = 0
    # 逐日差额：当日最热板块信号均值 - 其余信号均值（只取最热板块 ≥2 信号、且两组都有值的天）
    day_ret: Dict[str, Dict[str, Dict[int, List[float]]]] = {}
    for sig in signals:
        d = sig["date"]
        heat = max((board_day_count[(b, d)] for b in sig["boards"]), default=0)
        bkey = "共振(≥3)" if heat >= 3 else "双信号(2)" if heat == 2 else "独苗(1)"
        sig["bkey"] = bkey
        bucket_counts[bkey] += 1
        in_top = day_top[d] in sig["boards"]
        top_count += in_top
        other_count += (not in_top)
        day_ret.setdefault(d, {}).setdefault("top" if in_top else "other", {h: [] for h in horizons})
        for h in horizons:
            v = sig["rets"][h]
            if v is None:
                continue
            buckets[bkey][h].append(v)
            (top_rets if in_top else other_rets)[h].append(v)
            all_rets[h].append(v)
            day_ret[d]["top" if in_top else "other"][h].append(v)
    spread_by_day = {h: [] for h in horizons}
    spread_days = 0
    for d, grp in day_ret.items():
        if "top" not in grp or "other" not in grp:
            continue
        if day_board_counts[d][day_top[d]] < 2:
            continue
        spread_days += 1
        for h in horizons:
            if grp["top"][h] and grp["other"][h]:
                spread_by_day[h].append(statistics.fmean(grp["top"][h]) - statistics.fmean(grp["other"][h]))

    def cell(v: List[float]) -> str:
        if not v:
            return "--"
        win = sum(1 for x in v if x > 0) / len(v) * 100
        return f"{statistics.fmean(v) * 100:+.2f}/{win:.0f}%"

    def row_of(name: str, n: int, groups: Dict[int, List[float]]) -> List[str]:
        return [name, n] + [cell(groups[h]) for h in horizons]

    print("\n=== 板块效应验证：信号更集中的板块，后续胜率/收益是否更高 ===")
    print(
        f"信号口径：跳升买入（Δ≥{buy_delta:g} 且评分≥{rise_floor:g} 且低位≤{low_max:g}持续{low_days}日）"
        f"；未来收益=次日开盘买入持 h 日收盘卖出（未扣成本）"
    )
    print(
        f"跳升买入共 {total_jump} 个，其中 {total_jump - len(signals)} 个无板块归属"
        f"（未计入下方板块统计）"
    )

    headers = ["板块共振度（当日所属板块信号数）", "信号数"] + [f"{h}日(均/胜)" for h in horizons]
    rows = [row_of(k, bucket_counts[k], buckets[k]) for k in bucket_keys]
    print(render_table(headers, rows, "lr" + "r" * len(horizons)))

    headers2 = ["同日对照", "信号数"] + [f"{h}日(均/胜)" for h in horizons]
    rows2 = [
        row_of("当日最热板块", top_count, top_rets),
        row_of("当日其余信号", other_count, other_rets),
        row_of("全部跳升", len(signals), all_rets),
    ]
    print(render_table(headers2, rows2, "lr" + "r" * len(horizons)))

    if spread_days:
        print(f"\n逐日差额（最热板块均值 - 其余信号均值，仅统计最热板块≥2信号且有对照的 {spread_days} 天）：")
        spread_parts = []
        for h in horizons:
            v = spread_by_day[h]
            if not v:
                spread_parts.append(f"{h}日: --")
                continue
            pos = sum(1 for x in v if x > 0) / len(v) * 100
            spread_parts.append(f"{h}日: {statistics.fmean(v)*100:+.2f}%（{pos:.0f}%的交易日为正）")
        print("  " + "  ".join(spread_parts))
    else:
        print("\n（逐日差额样本不足：没有同时存在「最热板块≥2信号」与「其余信号」的交易日）")

    # ---- 反向检验：信号「更少」的板块（独苗）是否反而更强，以及是否只是小盘效应 ----
    def median_mv(group: List[dict]) -> Optional[float]:
        vs = [s["mv"] for s in group if s["mv"]]
        return statistics.median(vs) / 1e8 if vs else None  # 亿元

    solo = [s for s in signals if s["bkey"] == "独苗(1)"]
    pair = [s for s in signals if s["bkey"] == "双信号(2)"]
    reso = [s for s in signals if s["bkey"] == "共振(≥3)"]
    mv_solo, mv_pair, mv_reso = median_mv(solo), median_mv(pair), median_mv(reso)
    def fmt_mv(v: Optional[float]) -> str:
        return f"{v:.0f}亿" if v is not None else "--"
    print("\n=== 反向检验：信号少的「独苗」板块是否反而更强（及是否小盘效应）===")
    print(
        f"信号日流通市值中位数：独苗 {fmt_mv(mv_solo)}  /  双信号 {fmt_mv(mv_pair)}  /  "
        f"共振 {fmt_mv(mv_reso)}"
    )
    if solo and reso:
        # 逐日配对：同一天的「独苗均值 - 共振均值」，天然消除大盘涨跌
        solo_by_day: Dict[str, Dict[int, List[float]]] = {}
        reso_by_day: Dict[str, Dict[int, List[float]]] = {}
        for s in solo:
            solo_by_day.setdefault(s["date"], {h: [] for h in horizons})
        for s in reso:
            reso_by_day.setdefault(s["date"], {h: [] for h in horizons})
        for s in solo:
            for h in horizons:
                if s["rets"][h] is not None:
                    solo_by_day[s["date"]][h].append(s["rets"][h])
        for s in reso:
            for h in horizons:
                if s["rets"][h] is not None:
                    reso_by_day[s["date"]][h].append(s["rets"][h])
        print(f"\n逐日配对差额（独苗均值 - 共振均值，同一天两组都有信号的交易日）：")
        parts = []
        for h in horizons:
            diffs = []
            for d in solo_by_day:
                if d in reso_by_day and solo_by_day[d][h] and reso_by_day[d][h]:
                    diffs.append(statistics.fmean(solo_by_day[d][h]) - statistics.fmean(reso_by_day[d][h]))
            if len(diffs) < 2:
                parts.append(f"{h}日: 样本不足({len(diffs)}天)")
                continue
            m = statistics.fmean(diffs)
            sd = statistics.stdev(diffs)
            t = m / (sd / math.sqrt(len(diffs)))
            p = 2 * (1 - 0.5 * (1 + math.erf(abs(t) / math.sqrt(2))))  # 双侧正态近似
            pos = sum(1 for x in diffs if x > 0) / len(diffs) * 100
            parts.append(f"{h}日: {m*100:+.2f}%（正{pos:.0f}%,t={t:+.2f},p={p:.2f},n={len(diffs)}）")
        print("  " + "  ".join(parts))
        print(
            "  （p<0.05 才算稳健；若独苗优势来自小盘股，则市值中位数会明显更低，"
            "说明是「小盘效应」而非「板块信号少」本身）"
        )


def board_momentum_study(data, args, horizons=(1, 3, 5, 10)) -> None:
    """验证「板块强度」维度：信号所属板块当日整体涨幅越高，信号后续胜率/收益是否越高。

    与 board_effect_study 同信号口径（跳升买入），但把「板块信号数」换成「板块指数
    当日涨跌幅」作为板块强度——动量延续假设：板块当天越强，其内个股信号后续表现越好。
    同一信号若属多个板块，强度取这些板块当日涨幅的均值。
    """
    buy_delta = float(args.buy)
    rise_floor = float(args.rise_min_score)
    ref_days = max(1, int(args.rise_ref_days))
    low_days = max(0, int(args.low_base_days))
    low_max = float(args.low_base_max)

    stock_map = _stock_board_map(args.refresh_board)
    scope = args.board_effect_scope
    board_names = _board_index(args.refresh_board)
    scope_codes: set = set()
    if scope == "concept":
        scope_codes = set(_concept_boards(args.refresh_board))
        scope_txt = "概念板块"
    elif scope == "industry":
        scope_codes = set(_industry_boards(args.refresh_board))
        scope_txt = "行业板块"
    elif scope == "theme":
        scope_txt = "产业/技术题材板块"
    else:
        scope_txt = "全部概念+行业板块"

    def keep(b: str) -> bool:
        if scope in ("concept", "industry"):
            return b in scope_codes
        if scope == "theme":
            return is_theme_board(board_names.get(b, ""))
        return True

    def fwd(bars: Bars, date: str, h: int) -> Optional[float]:
        i0 = bars.next_index(date)
        if i0 < 0 or i0 + h - 1 >= len(bars.dates):
            return None
        return bars.closes[i0 + h - 1] / bars.opens[i0] - 1

    # 第一遍：收集跳升买入信号 + 涉及的板块 + 无条件基准（控制大盘涨跌）
    signals: List[dict] = []
    used_boards: set = set()
    total_jump = 0
    base: Dict[int, List[float]] = {h: [] for h in horizons}
    for s, bars in data:
        boards = [b for b in stock_map.get(s.code, []) if keep(b)]
        for i in range(1, len(s.dates)):
            d = s.dates[i]
            bi, pb = bars.index_of(d), bars.index_of(s.dates[i - 1])
            if bi < 0 or pb < 0 or bi - pb != 1:
                continue
            delta = s.scores[i] - s.scores[i - 1]
            cur = s.scores[i]
            ref = s.scores[max(0, i - ref_days):i]
            if not ref:
                continue
            # 无条件基准：每个相邻交易日都算一次未来收益，作为「这批行情本身」的参照
            base_row = {h: fwd(bars, d, h) for h in horizons}
            for h in horizons:
                if base_row[h] is not None:
                    base[h].append(base_row[h])
            low_ref = min(ref)
            low_base_high = max(s.scores[i - low_days:i]) if low_days and i >= low_days else None
            in_low = lambda v: low_days <= 0 or v is None or v <= low_max
            if not (delta >= buy_delta and cur >= rise_floor and (in_low(low_base_high) or in_low(low_ref))):
                continue
            total_jump += 1
            if not boards:
                continue
            sig = {
                "date": d, "boards": boards,
                "rets": {h: fwd(bars, d, h) for h in horizons},
                "mv": bars.mv_at(bi),
            }
            signals.append(sig)
            used_boards.update(boards)

    if not signals:
        print("没有跳升买入信号，无法验证板块强度。可放宽 --buy / --rise-min-score 或加大 --sample。")
        return

    # 拉取涉及的板块指数日K（涨跌幅），只取信号涉及到的板块
    board_zdf: Dict[str, Dict[str, float]] = {}
    print(f"\n板块强度口径：{scope_txt}；拉取 {len(used_boards)} 个板块指数日K（缓存 1 天）…")
    for j, b in enumerate(sorted(used_boards), 1):
        board_zdf[b] = _board_kline(b, args.refresh_board)
        progress(j, len(used_boards), f"板块指数 {board_names.get(b, b)}")

    # 每个信号的板块强度 = 所属板块当日涨幅均值（%）
    for sig in signals:
        zs = [board_zdf[b].get(sig["date"]) for b in sig["boards"]]
        zs = [z for z in zs if z is not None]
        sig["strength"] = statistics.fmean(zs) if zs else None

    has_strength = [s for s in signals if s["strength"] is not None]

    def bucket(key_of) -> Dict[str, Dict[int, List[float]]]:
        keys = ("弱(<0%)", "中(0~2%)", "强(≥2%)")
        b = {k: {h: [] for h in horizons} for k in keys}
        c = {k: 0 for k in keys}
        for s in has_strength:
            c[key_of(s)] += 1
            for h in horizons:
                v = s["rets"][h]
                if v is not None:
                    b[key_of(s)][h].append(v)
        return b, c

    def key_of(s: dict) -> str:
        v = s["strength"]
        return "强(≥2%)" if v >= 2 else "中(0~2%)" if v >= 0 else "弱(<0%)"

    buckets, counts = bucket(key_of)

    def cell(v: List[float]) -> str:
        if not v:
            return "--"
        win = sum(1 for x in v if x > 0) / len(v) * 100
        return f"{statistics.fmean(v) * 100:+.2f}/{win:.0f}%"

    print("\n=== 板块强度验证：板块当日涨幅越高，信号后续胜率/收益是否越高 ===")
    print(
        f"信号口径：跳升买入（Δ≥{buy_delta:g} 且评分≥{rise_floor:g} 且低位≤{low_max:g}持续{low_days}日）"
        f"；板块强度=所属板块指数当日涨幅均值；未来收益=次日开盘买持 h 日收盘卖（未扣成本）"
    )
    print(f"跳升买入共 {total_jump} 个，其中有板块强度数据的 {len(has_strength)} 个")

    headers = ["板块当日涨幅", "信号数"] + [f"{h}日(均/胜)" for h in horizons]
    rows = [[k, counts[k]] + [cell(buckets[k][h]) for h in horizons] for k in ("弱(<0%)", "中(0~2%)", "强(≥2%)")]
    # 全部跳升信号 + 无条件基准作为对照（后者用于剥离「大盘当天涨了」的延续效应）
    rows.append(["全部跳升", len(has_strength)] + [cell([s["rets"][h] for s in has_strength if s["rets"][h] is not None]) for h in horizons])
    rows.append(["无条件基准", "--"] + [cell(base[h]) for h in horizons])
    print(render_table(headers, rows, "lr" + "r" * len(horizons)))

    # 逐日配对：强(≥2%) vs 弱(<0%)，控制日期（消除大盘涨跌）
    strong = [s for s in has_strength if s["strength"] >= 2]
    weak = [s for s in has_strength if s["strength"] < 0]
    if strong and weak:
        strong_by_day: Dict[str, Dict[int, List[float]]] = {}
        weak_by_day: Dict[str, Dict[int, List[float]]] = {}
        for s in strong:
            strong_by_day.setdefault(s["date"], {h: [] for h in horizons})
        for s in weak:
            weak_by_day.setdefault(s["date"], {h: [] for h in horizons})
        for s in strong:
            for h in horizons:
                if s["rets"][h] is not None:
                    strong_by_day[s["date"]][h].append(s["rets"][h])
        for s in weak:
            for h in horizons:
                if s["rets"][h] is not None:
                    weak_by_day[s["date"]][h].append(s["rets"][h])
        print(f"\n逐日配对差额（强板块均值 - 弱板块均值，同一天两组都有信号的交易日）：")
        parts = []
        for h in horizons:
            diffs = []
            for d in strong_by_day:
                if d in weak_by_day and strong_by_day[d][h] and weak_by_day[d][h]:
                    diffs.append(statistics.fmean(strong_by_day[d][h]) - statistics.fmean(weak_by_day[d][h]))
            if len(diffs) < 2:
                parts.append(f"{h}日: 样本不足({len(diffs)}天)")
                continue
            m = statistics.fmean(diffs)
            sd = statistics.stdev(diffs)
            t = m / (sd / math.sqrt(len(diffs)))
            p = 2 * (1 - 0.5 * (1 + math.erf(abs(t) / math.sqrt(2))))
            pos = sum(1 for x in diffs if x > 0) / len(diffs) * 100
            parts.append(f"{h}日: {m*100:+.2f}%（正{pos:.0f}%,t={t:+.2f},p={p:.2f},n={len(diffs)}）")
        print("  " + "  ".join(parts))
        # 市值对照：强/弱两组是否只是小盘差异
        def mv_med(grp: List[dict]) -> Optional[float]:
            vs = [s["mv"] for s in grp if s["mv"]]
            return statistics.median(vs) / 1e8 if vs else None
        ms, mw = mv_med(strong), mv_med(weak)
        print(
            f"信号日流通市值中位数：强板块 {(f'{ms:.0f}亿' if ms else '--')}  /  "
            f"弱板块 {(f'{mw:.0f}亿' if mw else '--')}"
        )
        print("  （p<0.05 才算稳健；正差额说明「板块当天强→后续强」的动量延续成立）")
    else:
        print("\n（强弱两组样本不足，无法做逐日配对）")


def rsi_study(data, args, horizons=(1, 3, 5, 10)) -> None:
    """验证「RSI 评分机制」能否提高信号胜率：把跳升买入信号按信号日的 RSI 形态 / 形态分分组，
    看偏多形态、高 RSI 分的信号后续胜率/收益是否更高，并对比「只买偏多形态」与「全部信号」。

    RSI 口径与 STList 的 RSI 列一致（renderer/helpers/shortTermScore.ts 的 scoreStockRsi）：
    rsiScore 0~40 为形态分（权重 0、仅展示），rsiPattern 为命中情形文案（如「金叉」，
    可能带「｜RSI6=78 偏高，下调15分」的追高衰减后缀，这里按「｜」切掉后缀归一化）。
    """
    buy_delta = float(args.buy)
    rise_floor = float(args.rise_min_score)
    ref_days = max(1, int(args.rise_ref_days))
    low_days = max(0, int(args.low_base_days))
    low_max = float(args.low_base_max)

    # 与 rsiShape.ts 的 RSI_SHAPE_LABELS 顺序一致：前 7 个偏多、后 3 个偏空
    shapes = ("超买回踩企稳", "超买回踩中", "超卖反转", "金叉", "多头排列", "金叉在即", "修复中",
              "死叉", "空头排列", "超买钝化")
    bullish = set(shapes[:7])

    def norm_shape(pat: str) -> str:
        name = (pat or "").split("｜")[0].strip()
        return name if name in shapes else ""

    def fwd(bars: Bars, date: str, h: int) -> Optional[float]:
        i0 = bars.next_index(date)
        if i0 < 0 or i0 + h - 1 >= len(bars.dates):
            return None
        return bars.closes[i0 + h - 1] / bars.opens[i0] - 1

    # 收集跳升买入信号 + 无条件基准
    signals: List[dict] = []
    base: Dict[int, List[float]] = {h: [] for h in horizons}
    total_jump = 0
    for s, bars in data:
        for i in range(1, len(s.dates)):
            d = s.dates[i]
            bi, pb = bars.index_of(d), bars.index_of(s.dates[i - 1])
            if bi < 0 or pb < 0 or bi - pb != 1:
                continue
            delta = s.scores[i] - s.scores[i - 1]
            cur = s.scores[i]
            ref = s.scores[max(0, i - ref_days):i]
            if not ref:
                continue
            base_row = {h: fwd(bars, d, h) for h in horizons}
            for h in horizons:
                if base_row[h] is not None:
                    base[h].append(base_row[h])
            low_ref = min(ref)
            low_base_high = max(s.scores[i - low_days:i]) if low_days and i >= low_days else None
            in_low = lambda v: low_days <= 0 or v is None or v <= low_max
            if not (delta >= buy_delta and cur >= rise_floor and (in_low(low_base_high) or in_low(low_ref))):
                continue
            total_jump += 1
            signals.append({
                "date": d,
                "rets": {h: fwd(bars, d, h) for h in horizons},
                "shape": norm_shape(s.rsi_pattern[i]),
                "rsi": s.rsi[i],
            })

    if not signals:
        print("没有跳升买入信号，无法验证 RSI。可放宽 --buy / --rise-min-score 或加大 --sample。")
        return

    def cell(v: List[float]) -> str:
        if not v:
            return "--"
        win = sum(1 for x in v if x > 0) / len(v) * 100
        return f"{statistics.fmean(v) * 100:+.2f}/{win:.0f}%"

    def header() -> List[str]:
        return ["分组", "信号数"] + [f"{h}日(均/胜)" for h in horizons]

    print("\n=== RSI 验证：结合 RSI 形态/评分能否提高信号胜率 ===")
    print(
        f"信号口径：跳升买入（Δ≥{buy_delta:g} 且评分≥{rise_floor:g} 且低位≤{low_max:g}持续{low_days}日）"
        f"；RSI 口径=STList RSI 列（scoreStockRsi）；未来收益=次日开盘买持 h 日收盘卖（未扣成本）"
    )
    print(f"跳升买入共 {total_jump} 个")

    # 表1：按 RSI 形态分组
    shape_groups: Dict[str, Dict[int, List[float]]] = {}
    shape_count: Dict[str, int] = {}
    for sig in signals:
        key = sig["shape"] or "未识别"
        shape_count[key] = shape_count.get(key, 0) + 1
        g = shape_groups.setdefault(key, {h: [] for h in horizons})
        for h in horizons:
            if sig["rets"][h] is not None:
                g[h].append(sig["rets"][h])
    rows = []
    for sh in shapes:
        if shape_count.get(sh):
            rows.append([sh, shape_count[sh]] + [cell(shape_groups[sh][h]) for h in horizons])
    if shape_count.get("未识别"):
        rows.append(["未识别", shape_count["未识别"]] + [cell(shape_groups["未识别"][h]) for h in horizons])
    print(render_table(header(), rows, "lr" + "r" * len(horizons)))

    # 表2：偏多 / 偏空 / 未识别 / 全部 / 无条件基准
    groups = {"RSI偏多": {h: [] for h in horizons}, "RSI偏空": {h: [] for h in horizons},
              "未识别": {h: [] for h in horizons}}
    cnt = {"RSI偏多": 0, "RSI偏空": 0, "未识别": 0}
    for sig in signals:
        key = "RSI偏多" if sig["shape"] in bullish else ("RSI偏空" if sig["shape"] else "未识别")
        cnt[key] += 1
        for h in horizons:
            if sig["rets"][h] is not None:
                groups[key][h].append(sig["rets"][h])
    rows2 = []
    for key in ("RSI偏多", "RSI偏空", "未识别"):
        rows2.append([key, cnt[key]] + [cell(groups[key][h]) for h in horizons])
    rows2.append(["全部跳升", len(signals)] + [cell([s["rets"][h] for s in signals if s["rets"][h] is not None]) for h in horizons])
    rows2.append(["无条件基准", "--"] + [cell(base[h]) for h in horizons])
    print(render_table(header(), rows2, "lr" + "r" * len(horizons)))

    # 表3：按 RSI 形态分（0~40）分档
    bins = (("0~10", 0, 10), ("10~20", 10, 20), ("20~30", 20, 30), ("30~40", 30, 40))
    bin_groups = {k: {h: [] for h in horizons} for k, _, _ in bins}
    bin_cnt = {k: 0 for k, _, _ in bins}
    no_rsi = {h: [] for h in horizons}
    no_rsi_cnt = 0
    for sig in signals:
        v = sig["rsi"]
        if v is None:
            no_rsi_cnt += 1
            for h in horizons:
                if sig["rets"][h] is not None:
                    no_rsi[h].append(sig["rets"][h])
            continue
        # 按形态分落档（0~40）
        k = "0~10" if v < 10 else "10~20" if v < 20 else "20~30" if v < 30 else "30~40"
        bin_cnt[k] += 1
        for h in horizons:
            if sig["rets"][h] is not None:
                bin_groups[k][h].append(sig["rets"][h])
    rows3 = []
    for k, _, _ in bins:
        rows3.append([f"RSI分{k}", bin_cnt[k]] + [cell(bin_groups[k][h]) for h in horizons])
    rows3.append(["无RSI数据", no_rsi_cnt] + [cell(no_rsi[h]) for h in horizons])
    print(render_table(header(), rows3, "lr" + "r" * len(horizons)))

    # 结论性对比：只买偏多形态 vs 全部信号（按逐日配对控制日期，避免大盘涨跌混淆）
    bull_by_day: Dict[str, Dict[int, List[float]]] = {}
    all_by_day: Dict[str, Dict[int, List[float]]] = {}
    for sig in signals:
        d = sig["date"]
        bull = sig["shape"] in bullish
        if bull:
            bull_by_day.setdefault(d, {h: [] for h in horizons})
        all_by_day.setdefault(d, {h: [] for h in horizons})
        for h in horizons:
            if sig["rets"][h] is None:
                continue
            all_by_day[d][h].append(sig["rets"][h])
            if bull:
                bull_by_day[d][h].append(sig["rets"][h])
    print(f"\n逐日配对差额（RSI偏多信号均值 - 全部信号均值，同一天两组都有信号的交易日）：")
    parts = []
    for h in horizons:
        diffs = []
        for d in bull_by_day:
            if all_by_day.get(d) and bull_by_day[d][h] and all_by_day[d][h]:
                diffs.append(statistics.fmean(bull_by_day[d][h]) - statistics.fmean(all_by_day[d][h]))
        if len(diffs) < 2:
            parts.append(f"{h}日: 样本不足({len(diffs)}天)")
            continue
        m = statistics.fmean(diffs)
        sd = statistics.stdev(diffs)
        t = m / (sd / math.sqrt(len(diffs)))
        p = 2 * (1 - 0.5 * (1 + math.erf(abs(t) / math.sqrt(2))))
        pos = sum(1 for x in diffs if x > 0) / len(diffs) * 100
        parts.append(f"{h}日: {m*100:+.2f}%（正{pos:.0f}%,t={t:+.2f},p={p:.2f},n={len(diffs)}）")
    print("  " + "  ".join(parts))
    print("  （正差额且 p<0.05 才算「偏多形态能提高胜率」的稳健证据）")


QUALITY_DIM_MAX = 75  # 抬升强度15 + 评分水平10 + 低位起点15 + 量能确认15 + 位置20


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v)) if v == v else 0.0


def quality_score(s: Series, i: int, args) -> Optional[Tuple[float, str, Dict[str, float]]]:
    """按 STList「信号 / 质量」列的口径算信号质量分（jump 口径，0~100 + A/B/C/D）

    与 renderer/helpers/shortTermScoreBacktest.ts 的 scoreShortScoreSignalQuality 一一对应：
      抬升强度 15：单日 Δ 超出门槛多少（≥20→15 / ≥12→12 / ≥6→9 / ≥0→6 / 否则 2）
      评分水平 10：≥85→10 / ≥75→8 / ≥65→6 / 否则 4
      低位起点 15：突变前 N 日最高分越低越好（≤15→15 … >lowBaseMax→0）
      量能确认 15：量能维度 0~30 等比折算（拿不到按中性 0.5）
      位置   20：距近 N 日最高分回撤 10 分最佳（贴高点=追高、深跌=走坏都扣分）
    合计按 75 分满分归一到 100，A≥80 / B≥65 / C≥50 / D<50。
    """
    if i < 1 or i >= len(s.scores):
        return None
    cur = s.scores[i]
    delta = cur - s.scores[i - 1]
    ref_days = max(1, int(args.rise_ref_days))
    ref = s.scores[max(0, i - ref_days):i]
    if not ref:
        return None
    high_ref = max([cur] + ref)  # 与应用一致：含基准日本身
    drop = high_ref - cur
    low_days = max(0, int(args.low_base_days))
    low_max = float(args.low_base_max)
    base_high = max(s.scores[i - low_days:i]) if low_days and i >= low_days else float("nan")

    over = delta - float(args.buy)
    d_strength = 15 if over >= 20 else 12 if over >= 12 else 9 if over >= 6 else 6 if over >= 0 else 2
    d_level = 10 if cur >= 85 else 8 if cur >= 75 else 6 if cur >= 65 else 4
    v = base_high
    if v <= 15:
        d_low = 15
    elif v <= 25:
        d_low = 12
    elif v <= 30:
        d_low = 9
    elif v <= 35:
        d_low = 6
    elif v <= low_max:
        d_low = 3
    else:
        d_low = 0
    vol = s.volume[i] if i < len(s.volume) else None
    d_vol = 15 * (0.5 if vol is None else _clamp01(float(vol) / 30.0))
    d_pos = 20 * _clamp01(1 - abs(drop - 10) / 20.0)
    dims = {"strength": d_strength, "level": d_level, "lowBase": d_low, "volume": d_vol, "position": d_pos}
    total = round(sum(dims.values()) / QUALITY_DIM_MAX * 100, 1)
    grade = "A" if total >= 80 else "B" if total >= 65 else "C" if total >= 50 else "D"
    return total, grade, dims


def _spearman(xs: Sequence[float], ys: Sequence[float]) -> Optional[float]:
    """秩相关（不依赖 numpy）；样本 <10 返回 None"""
    n = len(xs)
    if n < 10:
        return None

    def ranks(vals: Sequence[float]) -> List[float]:
        order = sorted(range(n), key=lambda i: vals[i])
        out = [0.0] * n
        i = 0
        while i < n:
            j = i
            while j + 1 < n and vals[order[j + 1]] == vals[order[i]]:
                j += 1
            r = (i + j) / 2.0 + 1
            for k in range(i, j + 1):
                out[order[k]] = r
            i = j + 1
        return out

    rx, ry = ranks(xs), ranks(ys)
    mx, my = statistics.fmean(rx), statistics.fmean(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    return num / den if den else None


def quality_study(data, args, lag: int, mv_limit: float) -> None:
    """验证「信号质量分」对胜率有没有用：按质量分组看信号后收益与实际成交收益

    做两套口径，避免只看到其中一面的假象：
      A. 信号级：所有跳升买入信号（不限持仓/冷却/跳空），按 A/B/C/D 与五档分数分组，
         看信号后 5 个交易日的平均收益与胜率——样本最大，最能看出质量分有没有区分度；
      B. 交易级：真实跑一遍回测（含卖点/冷却/成本），按质量分组看每笔的胜率与期望——
         这才是「照质量分筛选后账户会怎样」。
    如果质量分有用，两套口径都应该单调：A > B > C > D。
    """
    horizons = (1, 3, 5, 10)
    sig_rows: List[Tuple[float, str, Dict[int, float], Dict[str, float]]] = []
    trade_rows: List[Tuple[float, str, float]] = []
    missing_vol = 0
    total_sig = 0
    # 跳升买点的评分地板：rise 口径用 riseMinScore（与 STList 信号列一致）
    jump_floor = args.rise_min_score if args.buy_mode == "rise" else args.min_score

    def fwd(bars: Bars, date: str, h: int) -> Optional[float]:
        i0 = bars.next_index(date)
        if i0 < 0 or i0 + h - 1 >= len(bars.dates):
            return None
        return bars.closes[i0 + h - 1] / bars.opens[i0] - 1

    for s, bars in data:
        # --- A. 信号级 ---
        for i in range(1, len(s.dates)):
            d = s.dates[i]
            bi, pb = bars.index_of(d), bars.index_of(s.dates[i - 1])
            if bi < 0 or pb < 0 or bi - pb != 1:
                continue
            delta = s.scores[i] - s.scores[i - 1]
            cur = s.scores[i]
            floor = args.rise_min_score if args.buy_mode == "rise" else args.min_score
            # 与 run_stock 的 jump 分支一致：评分不够时，「自低点抬升达标」也算
            score_ref = min(s.scores[max(0, i - max(args.rise_ref_days, 1)):i])
            rel_ok = args.min_rise > 0 and cur >= score_ref + args.min_rise
            if delta < args.buy or (cur < floor and not rel_ok):
                continue
            if args.low_base_days > 0:
                if i < args.low_base_days:
                    continue
                if max(s.scores[i - args.low_base_days:i]) > args.low_base_max and not (
                    args.buy_mode == "rise"
                    and min(s.scores[max(0, i - args.rise_ref_days):i]) <= args.low_base_max
                ):
                    continue
            q = quality_score(s, i, args)
            if q is None:
                continue
            row = {}
            for h in horizons:
                v = fwd(bars, d, h)
                if v is not None:
                    row[h] = v
            total_sig += 1
            if s.volume[i] is None:
                missing_vol += 1
            sig_rows.append((q[0], q[1], row, q[2]))

        # --- B. 交易级（统一按「跳升买入」跑，因为质量分就是跳升口径）---
        trades, _, _ = run_stock(
            s, bars, args.buy, args.sell, jump_floor, args.fee,
            args.stop_loss, args.max_hold, lag, "jump", args.trend_filter,
            args.require_limit_up, mv_limit,
            low_base=args.low_base, jump_window=args.jump_window, min_rise=args.min_rise,
            trail_drop=args.trail_drop, rise_ref_days=args.rise_ref_days,
            rise_min_score=args.rise_min_score, rise_min_delta=0.0,
            rise_vol_ratio=0.0, below_ma=args.below_ma,
            no_new_high=args.no_new_high, newhigh_basis=args.newhigh_basis,
            score_exit=args.exit_mode != "hold", ma_bands=tuple(args.ma_band),
            cooldown=args.cooldown, max_gap=args.max_gap_pct / 100.0,
            low_open_break=args.low_open_break / 100.0,
            price_trail=args.price_trail / 100.0, take_profit=args.take_profit / 100.0,
            ma_exit=args.ma_exit, vol_stall=args.vol_stall,
            score_price_both=args.score_price_both,
            trend_exit=args.trend_exit, atr_trail=args.atr_trail,
            swing_break=args.swing_break, ma_cross_exit=args.ma_cross_exit,
        )
        idx_by_date = {dd: k for k, dd in enumerate(s.dates)}
        for t in trades:
            k = idx_by_date.get(t.signal_in)
            if k is None:
                continue
            q = quality_score(s, k, args)
            if q is None:
                continue
            trade_rows.append((q[0], q[1], t.ret))

    if not sig_rows:
        print("没有可统计的跳升信号")
        return

    print("\n=== 信号质量分是否有效（A 信号级 / B 交易级，质量分与 STList 同口径）===")
    if missing_vol:
        print(
            f"注意：{missing_vol}/{total_sig} 个信号的量能维度缺失，按中性 7.5/15 计，"
            "质量分对这批信号区分度会被削弱"
        )

    # A. 按等级
    rows_a = []
    for g in ("A", "B", "C", "D"):
        grp = [r for r in sig_rows if r[1] == g]
        if not grp:
            continue
        row = [g, len(grp), f"{len(grp) / len(sig_rows) * 100:.0f}"]
        for h in horizons:
            vals = [r[2][h] for r in grp if h in r[2]]
            if not vals:
                row.append("--")
                continue
            win = sum(1 for x in vals if x > 0) / len(vals) * 100
            row.append(f"{statistics.fmean(vals) * 100:+.2f}/{win:.0f}%")
        rows_a.append(row)
    print("\n[A] 信号级：全部跳升信号按质量等级分组（次日开盘买，持 h 日，未扣成本）")
    print(render_table(
        ["等级", "信号", "占比%"] + [f"{h}日(均/胜)" for h in horizons], rows_a,
        "lrr" + "r" * len(horizons),
    ))

    # A2. 按分数五档（数据驱动分位）
    scores_sorted = sorted(r[0] for r in sig_rows)
    cuts = [scores_sorted[int(len(scores_sorted) * f)] for f in (0.2, 0.4, 0.6, 0.8)]
    labels = ["最低20%", "20-40%", "40-60%", "60-80%", "最高20%"]
    rows_q = []
    for qi, label in enumerate(labels):
        lo = 0.0 if qi == 0 else cuts[qi - 1]
        hi = 101.0 if qi == len(labels) - 1 else cuts[qi]
        grp = [r for r in sig_rows if lo <= r[0] < hi or (qi == len(labels) - 1 and r[0] >= lo)]
        if not grp:
            continue
        row = [f"{label} ({grp[0][0]:.0f}-{grp[-1][0]:.0f})", len(grp)]
        for h in horizons:
            vals = [r[2][h] for r in grp if h in r[2]]
            if not vals:
                row.append("--")
                continue
            win = sum(1 for x in vals if x > 0) / len(vals) * 100
            row.append(f"{statistics.fmean(vals) * 100:+.2f}/{win:.0f}%")
        rows_q.append(row)
    print("\n[A2] 信号级：按质量分位分五档（每档约 20% 信号）")
    print(render_table(
        ["质量分档", "信号"] + [f"{h}日(均/胜)" for h in horizons], rows_q,
        "lrr" + "r" * len(horizons),
    ))

    all_scores = sorted(r[0] for r in sig_rows)
    dist = {g: sum(1 for r in sig_rows if r[1] == g) for g in "ABCD"}
    print(
        f"\n质量分分布：中位 {all_scores[len(all_scores) // 2]:.0f}  最低 {all_scores[0]:.0f}  "
        f"最高 {all_scores[-1]:.0f}  |  A {dist['A']} / B {dist['B']} / C {dist['C']} / D {dist['D']} 份"
    )

    # A3. 逐维度：哪个维度真正有区分度（高 1/3 vs 低 1/3 的信号后 5 日收益）
    dim_labels = [
        ("strength", "抬升强度"), ("level", "评分水平"), ("lowBase", "低位起点"),
        ("volume", "量能确认"), ("position", "位置"),
    ]
    rows_d = []
    for key, label in dim_labels:
        vals = [(r[3].get(key, 0.0), r[2][5]) for r in sig_rows if 5 in r[2]]
        if len(vals) < 30:
            continue
        sp = _spearman([v[0] for v in vals], [v[1] for v in vals])
        vals.sort(key=lambda x: x[0])
        k = max(1, len(vals) // 3)
        top, bot = vals[-k:], vals[:k]
        rows_d.append([
            label,
            "n/a" if sp is None else f"{sp:+.3f}",
            f"{statistics.fmean([v[1] for v in top]) * 100:+.2f}/"
            f"{sum(1 for v in top if v[1] > 0) / len(top) * 100:.0f}%",
            f"{statistics.fmean([v[1] for v in bot]) * 100:+.2f}/"
            f"{sum(1 for v in bot if v[1] > 0) / len(bot) * 100:.0f}%",
        ])
    if rows_d:
        print("\n[A3] 逐维度：与信号后 5 日收益的关系（按该维度高低分 1/3 组）")
        print(render_table(["维度", "秩相关", "高1/3(均/胜)", "低1/3(均/胜)"], rows_d, "lrrr"))

    for h in horizons:
        pairs = [(r[0], r[2][h]) for r in sig_rows if h in r[2]]
        sp = _spearman([p[0] for p in pairs], [p[1] for p in pairs])
        if sp is not None:
            print(f"  质量分 vs 信号后 {h} 日收益 的秩相关: {sp:+.3f}（样本 {len(pairs)}）")

    # B. 交易级
    if trade_rows:
        rows_b = []
        for g in ("A", "B", "C", "D"):
            grp = [r for r in trade_rows if r[1] == g]
            if not grp:
                continue
            rets = [r[2] for r in grp]
            wins = [x for x in rets if x > 0]
            losses = [x for x in rets if x <= 0]
            pf = (sum(wins) / abs(sum(losses))) if losses and sum(losses) != 0 else float("inf")
            rows_b.append([
                g, len(grp), f"{len(wins) / len(rets) * 100:.1f}",
                f"{statistics.fmean(rets) * 100:+.2f}",
                "∞" if pf == float("inf") else f"{pf:.2f}",
            ])
        print("\n[B] 交易级：真实成交（含卖点/冷却/成本）按质量等级分组")
        print(render_table(["等级", "交易", "胜率%", "期望%/笔", "盈利因子"], rows_b, "lrrrr"))
        pairs = [(r[0], r[2]) for r in trade_rows]
        sp = _spearman([p[0] for p in pairs], [p[1] for p in pairs])
        if sp is not None:
            print(f"  质量分 vs 单笔收益 的秩相关: {sp:+.3f}（样本 {len(pairs)}）")

        # 高分半 vs 低分半：胜率差做双比例 z 检验（|z|<1.96 即统计上区分不出）
        med = statistics.median([r[0] for r in trade_rows])
        hi = [r[2] for r in trade_rows if r[0] >= med]
        lo = [r[2] for r in trade_rows if r[0] < med]
        if len(hi) >= 10 and len(lo) >= 10:
            wh = sum(1 for x in hi if x > 0) / len(hi)
            wl = sum(1 for x in lo if x > 0) / len(lo)
            pooled = (sum(1 for x in hi + lo if x > 0)) / (len(hi) + len(lo))
            se = math.sqrt(pooled * (1 - pooled) * (1 / len(hi) + 1 / len(lo)))
            z = (wh - wl) / se if se else 0.0
            print(
                f"  高分半（≥{med:.0f}）{len(hi)} 笔 胜率 {wh*100:.1f}% 期望 {statistics.fmean(hi)*100:+.2f}% "
                f"中位 {statistics.median(hi)*100:+.2f}%  |  "
                f"低分半 {len(lo)} 笔 胜率 {wl*100:.1f}% 期望 {statistics.fmean(lo)*100:+.2f}% "
                f"中位 {statistics.median(lo)*100:+.2f}%  |  "
                f"胜率差 {z:+.2f}σ（|z|<1.96 视为分不出）"
            )
    print(
        "\n判读：若质量分有用，A/B 的胜率与期望应显著高于 C/D，且分位分组单调、秩相关明显为正；"
        "若各档差异在噪声内（样本小时很容易），说明它只是在描述「信号长得像不像」，没有预测力。"
    )


def positions_study(data, args, lag: int, mv_limit: float) -> None:
    """同一时间持仓数量（并发持仓）随时间的变化——决定资金占用与能否真的执行

    统计口径：每笔从「买入日开盘」持到「卖出日开盘」，所以计入 [entry, exit) 的交易日。
    输出：
      1. 全窗口的并发持仓分布（均值/中位/分位/最大、空仓天数占比）
      2. 按月的平均/最大并发持仓
      3. 持仓数分档天数（0 / 1 / 2 / 3-4 / 5-9 / 10+）
    并发数直接决定要预留多少现金、单票仓位该给多少：平均只有 1-2 只说明大部分时间资金闲置，
    峰值为 10+ 则需要设定最大持仓上限（否则某个信号密集的日子会把仓位打散）。
    """
    # --- 取每笔交易的持仓区间（按交易日下标） ---
    calendar = sorted({d for _, bars in data for d in bars.dates})
    if not calendar:
        print("没有可用交易日")
        return
    date_idx = {d: i for i, d in enumerate(calendar)}
    spans: List[Tuple[int, int]] = []
    for s, bars in data:
        trades, _, _ = run_stock(
            s, bars, args.buy, args.sell,
            args.rise_min_score if args.buy_mode == "rise" else args.min_score, args.fee,
            args.stop_loss, args.max_hold, lag, "jump", args.trend_filter,
            args.require_limit_up, mv_limit,
            low_base=args.low_base, jump_window=args.jump_window, min_rise=args.min_rise,
            trail_drop=args.trail_drop, rise_ref_days=args.rise_ref_days,
            rise_min_score=args.rise_min_score, rise_min_delta=0.0, rise_vol_ratio=0.0,
            below_ma=args.below_ma, no_new_high=args.no_new_high,
            newhigh_basis=args.newhigh_basis, score_exit=args.exit_mode != "hold",
            ma_bands=tuple(args.ma_band),
            cooldown=args.cooldown, max_gap=args.max_gap_pct / 100.0,
            low_open_break=args.low_open_break / 100.0,
            price_trail=args.price_trail / 100.0, take_profit=args.take_profit / 100.0,
            ma_exit=args.ma_exit, vol_stall=args.vol_stall,
            score_price_both=args.score_price_both,
            trend_exit=args.trend_exit, atr_trail=args.atr_trail,
            swing_break=args.swing_break, ma_cross_exit=args.ma_cross_exit,
        )
        for t in trades:
            i0 = date_idx.get(t.entry_date)
            i1 = date_idx.get(t.exit_date)
            if i0 is None or i1 is None or i1 <= i0:
                continue
            spans.append((i0, i1))

    if not spans:
        print("按当前参数没有成交，无法统计并发持仓")
        return

    counts = [0] * len(calendar)
    for i0, i1 in spans:
        for j in range(i0, min(i1, len(calendar))):
            counts[j] += 1

    # 只统计「有行情覆盖」的交易日区间，避免首尾没有股票的空白段拉低均值
    lo = min(i0 for i0, _ in spans)
    hi = max(min(i1, len(calendar)) for _, i1 in spans)
    daily = counts[lo:hi]
    n = len(daily)
    if not daily:
        print("持仓区间为空")
        return

    def pct(p: float) -> float:
        return sorted(daily)[min(n - 1, int(n * p))]

    mean_v = statistics.fmean(daily)
    zero_days = sum(1 for c in daily if c == 0)
    print("\n=== 同一时间持仓数量（并发持仓，按交易日统计）===")
    print(
        f"区间 {calendar[lo]} ~ {calendar[hi - 1]}  交易日 {n} 天  交易 {len(spans)} 笔  "
        f"平均并发 {mean_v:.2f} 只  中位 {statistics.median(daily):.0f}  最大 {max(daily)}"
    )
    print(
        f"分位: 50% {pct(0.5):.0f} / 75% {pct(0.75):.0f} / 90% {pct(0.9):.0f} / 99% {pct(0.99):.0f}"
        f"    空仓(0 只) {zero_days} 天（{zero_days / n * 100:.0f}%）"
    )

    buckets = [
        ("0 只", lambda c: c == 0), ("1 只", lambda c: c == 1), ("2 只", lambda c: c == 2),
        ("3-4 只", lambda c: 3 <= c <= 4), ("5-9 只", lambda c: 5 <= c <= 9),
        ("10+ 只", lambda c: c >= 10),
    ]
    trows = []
    for label, fn in buckets:
        k = sum(1 for c in daily if fn(c))
        trows.append([label, k, f"{k / n * 100:.0f}"])
    print(render_table(["同时持仓", "交易日", "占比%"], trows, "lrr"))
    # 如果账户只能同时放 M 只，会损失多少信号机会（超额天数 = 必须挑着做的日子）
    cap_rows = []
    for m in (3, 5, 8, 10):
        over = sum(1 for c in daily if c > m)
        cap_rows.append([f"≤{m} 只", over, f"{over / n * 100:.0f}"])
    print("若设定最大同时持仓上限（超出天数=需要放弃部分信号的日子）")
    print(render_table(["上限", "超出天数", "占比%"], cap_rows, "lrr"))
    print(f"日均新开仓: {len(spans) / n:.2f} 笔/交易日（{len(spans)} 笔 / {n} 天）")

    # 按月：平均 / 最大并发（看信号是否有明显的月份聚集）
    by_month: Dict[str, List[int]] = {}
    for j, c in enumerate(daily):
        by_month.setdefault(calendar[lo + j][:7], []).append(c)
    mrows = []
    for m in sorted(by_month):
        v = by_month[m]
        mrows.append([
            m, len(v), f"{statistics.fmean(v):.1f}", max(v),
            f"{sum(1 for x in v if x == 0) / len(v) * 100:.0f}",
        ])
    print("\n按月并发持仓（判断信号是否扎堆在某几个月）")
    print(render_table(["月份", "交易日", "平均", "最大", "空仓%"], mrows, "lrrrr"))

    # 峰值那几天到底持了哪些票，方便判断「同时 10 只」是真实机会还是一堆弱信号
    peak = max(daily)
    if peak > 0:
        peak_days = [calendar[lo + j] for j, c in enumerate(daily) if c == peak][:3]
        print(f"\n峰值 {peak} 只出现在: " + "、".join(peak_days))


def _signal_trades(data, args, lag: int, mv_limit: float) -> List[Trade]:
    """按「跳升买入」口径跑一遍，取全部成交（用于排序类实验）"""
    out: List[Trade] = []
    for s, bars in data:
        trades, _, _ = run_stock(
            s, bars, args.buy, args.sell,
            args.rise_min_score if args.buy_mode == "rise" else args.min_score, args.fee,
            args.stop_loss, args.max_hold, lag, "jump", args.trend_filter,
            args.require_limit_up, mv_limit,
            low_base=args.low_base, jump_window=args.jump_window, min_rise=args.min_rise,
            trail_drop=args.trail_drop, rise_ref_days=args.rise_ref_days,
            rise_min_score=args.rise_min_score, rise_min_delta=0.0, rise_vol_ratio=0.0,
            below_ma=args.below_ma, no_new_high=args.no_new_high,
            newhigh_basis=args.newhigh_basis, score_exit=args.exit_mode != "hold",
            ma_bands=tuple(args.ma_band),
            cooldown=args.cooldown, max_gap=args.max_gap_pct / 100.0,
            low_open_break=args.low_open_break / 100.0,
            price_trail=args.price_trail / 100.0, take_profit=args.take_profit / 100.0,
            ma_exit=args.ma_exit, vol_stall=args.vol_stall,
            score_price_both=args.score_price_both,
            trend_exit=args.trend_exit, atr_trail=args.atr_trail,
            swing_break=args.swing_break, ma_cross_exit=args.ma_cross_exit,
        )
        out.extend(trades)
    return out


def _summarize_taken(taken: List[Trade]) -> Dict[str, float]:
    if not taken:
        return {"n": 0, "win": 0.0, "avg": 0.0, "cum": 0.0, "pf": 0.0}
    rets = [t.ret for t in taken]
    wins = [r for r in rets if r > 0]
    losses = [r for r in rets if r <= 0]
    cum = 1.0
    for r in sorted(rets):
        cum *= 1 + r
    return {
        "n": len(rets),
        "win": len(wins) / len(rets),
        "avg": statistics.fmean(rets),
        "cum": cum - 1,
        "pf": (sum(wins) / abs(sum(losses))) if losses and sum(losses) else float("inf"),
    }


def rank_study(data, args, lag: int, mv_limit: float) -> None:
    """验证「用个股历史回测胜率给信号排序」能不能在限仓时提高整体胜率

    两个问题分开回答：
      A. 个股历史胜率对未来信号有没有预测力？（只用「信号日之前已平仓」的该股交易算历史）
         很多票在样本里只有 0~1 笔历史，所以先看样本量——没有历史就无法排序。
      B. 限仓模拟：把当天所有候选信号按不同规则排序，只取前 N 个，比较整体结果。
         规则：先到先得(fifo) / 历史胜率排序 / 历史期望排序 / 随机。
         若「历史胜率排序」不能稳定优于 fifo 与随机，说明这个排序没有用。
    """
    trades = _signal_trades(data, args, lag, mv_limit)
    if not trades:
        print("没有成交，无法做排序实验")
        return
    by_code: Dict[str, List[Trade]] = {}
    for t in trades:
        by_code.setdefault(t.code, []).append(t)

    # ---- A. 每笔信号在「信号时点」能看到的个股历史 ----
    rows = []  # (trade, prior_n, prior_wr, prior_exp)
    for code, ts in by_code.items():
        ts.sort(key=lambda x: x.signal_in)
        for t in ts:
            closed = [x for x in ts if x is not t and x.exit_date and x.exit_date < t.signal_in]
            n = len(closed)
            wr = (sum(1 for x in closed if x.ret > 0) / n) if n else float("nan")
            ex = statistics.fmean([x.ret for x in closed]) if n else float("nan")
            rows.append((t, n, wr, ex))

    print("\n=== A. 个股历史胜率的「可得性」（信号时点之前已平仓的该股交易）===")
    hist_rows = []
    for label, fn in (
        ("无历史", lambda n, wr: n == 0),
        ("1 笔", lambda n, wr: n == 1),
        ("2 笔", lambda n, wr: n == 2),
        ("3 笔及以上", lambda n, wr: n >= 3),
    ):
        grp = [r for r in rows if fn(r[1], r[2])]
        if not grp:
            continue
        rets = [r[0].ret for r in grp]
        hist_rows.append([
            label, len(grp), f"{len(grp) / len(rows) * 100:.0f}",
            f"{sum(1 for x in rets if x > 0) / len(rets) * 100:.1f}",
            f"{statistics.fmean(rets) * 100:+.2f}",
        ])
    print(render_table(["该股历史笔数", "本笔信号", "占比%", "本笔胜率%", "本笔期望%"], hist_rows, "lrrrr"))
    known = [r for r in rows if r[1] > 0]
    print(
        f"只有 {len(known)}/{len(rows)}（{len(known) / len(rows) * 100:.0f}%）笔信号在发生时"
        f"「该股已有历史交易」可用于排序，其余 {len(rows) - len(known)} 笔只能排在后面或按默认顺序"
    )

    # 有历史的那部分：历史胜率 0 / 部分赢 / 全胜 对未来这笔的影响
    if known:
        brow = []
        for label, fn in (
            ("历史全亏 (0%)", lambda wr: wr == 0),
            ("历史有赢有亏", lambda wr: 0 < wr < 1),
            ("历史全胜 (100%)", lambda wr: wr == 1),
        ):
            grp = [r for r in known if fn(r[2])]
            if not grp:
                continue
            rets = [r[0].ret for r in grp]
            brow.append([
                label, len(grp),
                f"{sum(1 for x in rets if x > 0) / len(rets) * 100:.1f}",
                f"{statistics.fmean(rets) * 100:+.2f}",
                f"{statistics.median(rets) * 100:+.2f}",
            ])
        print("\n只看「有历史」的信号：历史胜率对未来这一笔的区分度")
        print(render_table(["历史表现", "信号", "本笔胜率%", "本笔期望%", "本笔中位%"], brow, "lrrrr"))
        sp = _spearman([r[2] for r in known], [r[0].ret for r in known])
        if sp is not None:
            print(f"  历史胜率 vs 本笔收益 的秩相关: {sp:+.3f}（样本 {len(known)}）")

    # ---- B. 限仓模拟：不同排序规则在同一上限下的结果 ----
    calendar = sorted({d for _, bars in data for d in bars.dates})
    by_day: Dict[str, List[Trade]] = {}
    for t in trades:
        by_day.setdefault(t.entry_date, []).append(t)

    # 排序用的历史指标一次性算好（没有历史的票排在最后）
    hist_win = {r[0]: (r[2] if r[1] > 0 else -1.0, r[3] if r[1] > 0 else -1.0) for r in rows}
    hist_exp = {r[0]: (r[3] if r[1] > 0 else -1.0) for r in rows}
    # 另外两种「信号时点就能算出来」的排序依据：当日 Δ、是否落在 MA5~MA20 区间内
    delta_map: Dict[Tuple[str, str], float] = {}
    band_map: Dict[Tuple[str, str], int] = {}
    for s, bars in data:
        for k in range(1, len(s.dates)):
            d = s.dates[k]
            delta_map[(s.code, d)] = s.scores[k] - s.scores[k - 1]
            bi = bars.index_of(d)
            if bi >= 0:
                c = bars.closes[bi]
                m5, m20 = bars.ma5[bi], bars.ma20[bi]
                band_map[(s.code, d)] = int(
                    m5 is not None and m20 is not None and c > m5 and c < m20
                )

    def rank_fifo(c: List[Trade]) -> List[Trade]:
        return c

    def rank_hist_win(c: List[Trade]) -> List[Trade]:
        return sorted(c, key=lambda t: hist_win[t], reverse=True)

    def rank_hist_exp(c: List[Trade]) -> List[Trade]:
        return sorted(c, key=lambda t: hist_exp[t], reverse=True)

    def rank_random(c: List[Trade]) -> List[Trade]:
        out = list(c)
        random.Random(20260101).shuffle(out)
        return out

    def rank_delta(c: List[Trade]) -> List[Trade]:
        """当日 Δ 越大越优先（信号强度）"""
        return sorted(
            c, key=lambda t: delta_map.get((t.code, t.signal_in), 0.0), reverse=True
        )

    def rank_band(c: List[Trade]) -> List[Trade]:
        """落在 MA5<价<MA20 的优先（中继回调），再按 Δ 排"""
        return sorted(
            c,
            key=lambda t: (
                band_map.get((t.code, t.signal_in), 0),
                delta_map.get((t.code, t.signal_in), 0.0),
            ),
            reverse=True,
        )

    def simulate(rank_fn, cap: int) -> List[Trade]:
        open_exits: List[str] = []
        taken: List[Trade] = []
        for day in calendar:
            open_exits = [e for e in open_exits if e > day]  # 当天开盘已卖出，槽位释放
            cands = by_day.get(day)
            if not cands:
                continue
            slots = cap - len(open_exits)
            if slots <= 0:
                continue
            for t in rank_fn(list(cands))[:slots]:
                taken.append(t)
                open_exits.append(t.exit_date)
        return taken

    rules = [
        ("先到先得 fifo", rank_fifo),
        ("历史胜率排序", rank_hist_win),
        ("历史期望排序", rank_hist_exp),
        ("当日Δ排序", rank_delta),
        ("MA5<价<MA20 优先", rank_band),
        ("随机排序", rank_random),
    ]
    print("\n=== B. 限仓模拟：同一天候选过多时按规则取前 N 个 ===")
    for cap in (3, 5, 10):
        body = []
        for name, fn in rules:
            s = _summarize_taken(simulate(fn, cap))
            body.append([
                name, s["n"], f"{s['win'] * 100:.1f}", f"{s['avg'] * 100:+.2f}",
                f"{s['cum'] * 100:+.1f}",
            ])
        print(
            f"\n--- 上限 {cap} 只（候选 {len(trades)} 笔，"
            f"日均 {len(trades) / max(1, len(calendar)):.2f} 笔新开）---"
        )
        print(render_table(["排序规则", "交易", "胜率%", "期望%/笔", "累计%"], body, "lrrrr"))
    all_s = _summarize_taken(trades)
    print(
        f"\n参照·完全不限仓：{all_s['n']} 笔  胜率 {all_s['win'] * 100:.1f}%  "
        f"期望 {all_s['avg'] * 100:+.2f}%/笔"
    )
    print(
        "判读：限仓后若「历史胜率排序」的胜率/累计明显高于 fifo 与随机，说明这个排序有效；"
        "若三者接近，说明按个股历史胜率排序只是把「没历史的新票」随机排到后面，提高不了胜率。"
    )


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
        below_ma=args.below_ma, no_new_high=args.no_new_high,
        newhigh_basis=args.newhigh_basis, score_exit=args.exit_mode != "hold",
        ma_bands=tuple(args.ma_band),
        cooldown=args.cooldown, max_gap=args.max_gap_pct / 100.0,
        low_open_break=args.low_open_break / 100.0,
        price_trail=args.price_trail / 100.0, take_profit=args.take_profit / 100.0,
        ma_exit=args.ma_exit, vol_stall=args.vol_stall,
        score_price_both=args.score_price_both,
        trend_exit=args.trend_exit, atr_trail=args.atr_trail,
        swing_break=args.swing_break, ma_cross_exit=args.ma_cross_exit,
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


def _filter_stats_row(label: str, st: dict) -> List:
    """把一组统计压成对比表的一行"""
    pf = st["profit_factor"]
    po = st["payoff"]
    return [
        label,
        st["trades"],
        f"{st['win_rate']*100:.1f}",
        f"{st['avg_ret']*100:+.2f}",
        f"{st['median_ret']*100:+.2f}",
        "∞" if po == float("inf") else f"{po:.2f}",
        "∞" if pf == float("inf") else f"{pf:.2f}",
        f"{st['avg_bars']:.1f}",
        f"{st['sharpe']:.2f}",
        f"{st['compound']*100:+.1f}",
        f"{st['trades_per_stock_year']:.2f}",
    ]


def ma_filter_compare(
    data, args, lag: int, mv_limit: float, rule_kw: dict, base: dict,
    variants: Sequence[Tuple[str, dict]], title: str, base_label: str = "无过滤",
) -> None:
    """把若干「均线过滤变体」各自单独回测，与基准并排列出

    每个变体只改一个过滤条件（below_ma / ma_band），其余参数完全一致，
    这样差异才能归因到过滤本身。样本很小时（<30 笔）结论不稳健，看表时注意笔数列。
    """
    items: List[Tuple[str, Optional[dict]]] = [(base_label, None)]
    items.extend(variants)
    rows = []
    for cell, (label, override) in enumerate(items, start=1):
        if override is None:
            st = base
        else:
            progress(cell, len(items), label)
            kw = dict(rule_kw)
            kw.update(override)
            st = evaluate(
                data, args.buy, args.sell, args.min_score, args.fee,
                args.stop_loss, args.max_hold, lag, args.buy_mode, args.trend_filter,
                args.require_limit_up, mv_limit, **kw,
            )
        rows.append(_filter_stats_row(label, st))
    print(f"\n=== {title} ===")
    print("（连乘 = 该组交易按先后顺序复利，仅用于组间比较，不是组合净值；笔数少时结论不稳）")
    print(render_table(
        ["过滤", "交易", "胜率%", "期望%", "中位%", "盈亏比", "盈利因子", "持仓日", "夏普", "连乘%", "频率"],
        rows, "lrrrrrrrrrr",
    ))


def hold_desc(args) -> str:
    txt = f"持有上限 {args.max_hold or '无'}"
    if args.no_new_high:
        txt += "，不再新高提前走"
    if args.trend_exit > 0:
        txt += f"，连续{args.trend_exit}日跌破MA5离场"
    if args.atr_trail > 0:
        txt += f"，吊灯止损{args.atr_trail:g}ATR"
    if args.swing_break > 0:
        txt += f"，跌破{args.swing_break}日低点离场"
    if args.ma_cross_exit:
        txt += "，MA5死叉离场"
    if args.exit_mode == "hold":
        txt += "，评分卖出关"
    return txt


def below_ma_compare(
    data, args, lag: int, mv_limit: float, rule_kw: dict, base: dict,
) -> None:
    """「收盘价低于 MA5/MA10/MA20」逐个单独回测，与无过滤基准并排比较

    每次只用一个均线（不是同时低于全部），这样才能看出哪条均线的低吸过滤更有效。
    """
    variants = [(f"收盘<MA{p}", {"below_ma": (p,)}) for p in args.below_ma_compare]
    ma_filter_compare(
        data, args, lag, mv_limit, rule_kw, base, variants,
        f"均线低吸过滤对比（跳升买入信号 + 收盘价低于指定均线；{hold_desc(args)}）",
        base_label="无过滤" if not args.below_ma and not args.ma_band else "基准(已有过滤)",
    )


def ma_band_compare(
    data, args, lag: int, mv_limit: float, rule_kw: dict, base: dict,
) -> None:
    """「股价夹在两条均线之间」的区间组合逐个单独回测

    形态含义：收盘价在短均线上方、长均线下方 —— 中期趋势还在，短期回调没走坏，
    对应「上升中继缩量回调」的低吸位置。区间按 (短, 长) 展开，全部来自 5/10/20/40/60。
    """
    bands = args.ma_band or ma_band_pairs(args.ma_band_scan)
    variants = [(f"MA{lo}<价<MA{hi}", {"ma_bands": ((lo, hi),)}) for lo, hi in bands]
    ma_filter_compare(
        data, args, lag, mv_limit, rule_kw, base, variants,
        f"均线区间对比（跳升买入信号 + 短均线之上、长均线之下；{hold_desc(args)}）",
        base_label="无过滤" if not args.below_ma and not args.ma_band else "基准(已有过滤)",
    )


MA_PERIOD_CHOICES = (5, 10, 20, 40, 60)


def ma_band_pairs(periods: Sequence[int]) -> List[Tuple[int, int]]:
    """把周期列表展开成所有 (短, 长) 组合（短 < 长）"""
    ps = sorted({int(p) for p in periods})
    return [(a, b) for i, a in enumerate(ps) for b in ps[i + 1:]]


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
    ap.add_argument(
        "--board-scope", choices=["theme", "style"], default=None,
        help="按概念板块范围回测：theme=只看题材（产业/技术题材，与面板「只看题材」同口径）；"
        "style=只看风格（名称以「风格」结尾）",
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
    ap.add_argument(
        "--cooldown", type=int, default=0,
        help="卖出成交后 N 个交易日内不开新仓（默认 0=关闭；与面板默认 3 对齐用 --cooldown 3）",
    )
    ap.add_argument(
        "--max-gap", dest="max_gap_pct", type=float, default=0.0, metavar="PCT",
        help="信号日收盘→次日开盘跳空超过 ±PCT%% 则放弃该信号（默认 0=关闭；与面板默认 2 对齐用 --max-gap 2）",
    )
    ap.add_argument(
        "--low-open-break", dest="low_open_break", type=float, default=0.0, metavar="PCT",
        help="次日开盘跌破昨日最低价超过 PCT%% 则放弃该信号（默认 0=关闭；"
             "相对昨日低点的支撑破位，0.5 表示低开破低点 0.5%% 以上就不买）",
    )
    ap.add_argument(
        "--price-trail", type=float, default=0.0, metavar="PCT",
        help="价格移动止盈：自持仓期最高收盘回撤 >= PCT%% 卖出（默认 0=关闭；如 5 表示 5%%）",
    )
    ap.add_argument(
        "--take-profit", type=float, default=0.0, metavar="PCT",
        help="目标止盈：收盘收益 >= PCT%% 卖出（默认 0=关闭）",
    )
    ap.add_argument(
        "--ma-exit", type=int, default=0, choices=[0, 5, 10, 20, 40, 60],
        help="收盘跌破 MA(n) 卖出（默认 0=关闭）",
    )
    ap.add_argument(
        "--vol-stall", type=float, default=0.0, metavar="X",
        help="放量滞涨：量 >= X 倍前5日均量 且当日涨幅<1%% 卖出（默认 0=关闭；常用 2）",
    )
    ap.add_argument(
        "--score-price-both", action="store_true",
        help="评分绿柱卖出要求「当日价格同时下跌」才执行（针对评分先转头、股价仍在拉升的情况）",
    )
    ap.add_argument(
        "--trend-exit", type=int, default=0, metavar="N",
        help="趋势转跌卖出：连续 N 日「收盘<MA5 且 MA5 下行」才卖（默认 0=关闭；常用 2）",
    )
    ap.add_argument(
        "--atr-trail", type=float, default=0.0, metavar="K",
        help="吊灯止损：收盘跌破「持仓期最高价 - K×ATR(14)」卖出（默认 0=关闭；常用 2~3）",
    )
    ap.add_argument(
        "--swing-break", type=int, default=0, metavar="N",
        help="结构破坏：收盘跌破持仓期最近 N 日最低收盘卖出（默认 0=关闭；常用 5~10）",
    )
    ap.add_argument(
        "--ma-cross-exit", action="store_true",
        help="MA5 下穿 MA10（死叉）当日卖出",
    )
    ap.add_argument(
        "--rsi-exit", type=float, default=0.0, metavar="RSI",
        help="持仓期 RSI6 冲到该值以上提前止盈（默认 0=关闭；常用 80，与评分绿柱/回撤止盈并行、谁先触发谁生效）",
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
    ap.add_argument(
        "--max-hold", type=int, default=0,
        help="最长持有交易日（按日K计，买入日算第 1 天，次日开盘卖出；0=不限制）",
    )
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
    ap.add_argument(
        "--below-ma", type=int, nargs="+", default=[], metavar="N",
        help="低吸过滤：信号日收盘价必须低于这些均线（可写多个，如 --below-ma 5 或 --below-ma 5 10 20，"
             "多个时要求全部低于）",
    )
    ap.add_argument(
        "--below-ma-compare", default="",
        help="逐个均线单独回测并出对比表，如 5,10,20（每行含「无过滤」基准）",
    )
    ap.add_argument(
        "--ma-band", action="append", default=[], metavar="短:长",
        help="均线区间：收盘价须在短均线之上、长均线之下，如 --ma-band 5:20（可重复传多个）",
    )
    ap.add_argument(
        "--ma-band-scan", nargs="?", const="5,10,20,40,60", default="", metavar="周期列表",
        help="自动枚举所有均线区间组合并出对比表（默认 5,10,20,40,60 的全部两两组合）",
    )
    ap.add_argument(
        "--no-new-high", action="store_true",
        help="持仓期某日没能刷新「买入以来新高」→ 次日开盘卖出（配合 --max-hold 3 即「3 天或不再新高」）",
    )
    ap.add_argument(
        "--newhigh-basis", choices=["high", "close"], default="high",
        help="创新高比较基准：high=日内最高价（默认，更灵敏）/ close=收盘价（更稳）",
    )
    ap.add_argument(
        "--exit-mode", choices=["both", "hold", "score"], default="both",
        help="卖出规则：both=评分卖出(绿柱/回撤)+持有规则（默认）/ hold=只用到期·不再新高·止损"
             "（干净验证「持 3 天」）/ score=只用评分卖出",
    )
    ap.add_argument("--exclude-boards", action="store_true", help="排除北交所与科创板")
    ap.add_argument("--code", help="只回测这一只股票并输出逐决策依据明细（如 600721）")
    ap.add_argument("--trace-min", type=float, default=5.0, help="单股明细里列出的最小 |Δ|（默认 5）")
    ap.add_argument("--exclude-st", action="store_true", help="排除 ST/*ST")
    ap.add_argument("--sweep", action="store_true", help="参数扫描")
    ap.add_argument("--event", action="store_true", help="事件研究（信号后未来收益）")
    ap.add_argument(
        "--census", action="store_true",
        help="按 STList「信号」列口径统计「跳升买入 / 抬升买入」的触发量、连续重复比例与信号后收益",
    )
    ap.add_argument(
        "--board-effect", action="store_true",
        help="验证「板块效应」：把每日跳升买入信号按所属板块统计，比较信号更集中的板块其后续胜率/收益是否更高",
    )
    ap.add_argument(
        "--board-effect-scope", choices=["concept", "all", "industry", "theme"], default="concept",
        help="板块口径（配合 --board-effect / --board-momentum）：concept=仅东财概念板块 t:3 全量（默认）/ "
        "theme=仅产业/技术题材（滤掉风格/指数/持仓等伪概念）/ "
        "industry=仅东财行业 t:2（单归属）/ all=全部概念+行业",
    )
    ap.add_argument(
        "--board-momentum", action="store_true",
        help="验证「板块强度」维度：信号所属板块指数当日涨幅越高，信号后续胜率/收益是否越高（动量延续）",
    )
    ap.add_argument(
        "--rsi", action="store_true",
        help="验证「RSI 评分机制」：把跳升买入信号按信号日 RSI 形态/形态分分组，看偏多形态/高 RSI 分能否提高胜率",
    )
    ap.add_argument(
        "--quality", action="store_true",
        help="验证「信号质量分」（STList 那套 0~100 / A-B-C-D）对胜率有无区分度",
    )
    ap.add_argument(
        "--positions", action="store_true",
        help="统计同一时间持仓数量（并发持仓）随时间的变化、分布与峰值",
    )
    ap.add_argument(
        "--rank", action="store_true",
        help="验证「按个股历史回测胜率排序」在限仓时能否提高整体胜率",
    )
    ap.add_argument("--trades", type=int, default=5, help="打印前 N 笔交易明细")
    args = ap.parse_args()
    # 「低位运行后的突变」前置条件：只在低位横过一段之后才认买点（0 日=关闭）
    args.low_base = LowBase(args.low_base_days, args.low_base_max)
    # rise 模式必须有「自低点抬升」阈值，否则退化成「评分 >= 地板就买」，信号会爆量
    if args.buy_mode == "rise" and args.min_rise <= 0:
        args.min_rise = 20.0
    # 均线低吸过滤：去重并校验周期（Bars 只算了 5/10/20/40/60）
    args.below_ma = sorted({int(x) for x in (args.below_ma or [])})
    bad_ma = [p for p in args.below_ma if p not in MA_PERIOD_CHOICES]
    if bad_ma:
        sys.exit(f"--below-ma 只支持 {'/'.join(map(str, MA_PERIOD_CHOICES))}，收到: {bad_ma}")
    # 冷却期 / 跳空过滤：与面板 cooldownDays(0~20) / maxGapPct(0~20%) 的取值范围保持一致
    args.cooldown = max(0, min(20, int(args.cooldown or 0)))
    args.max_gap_pct = max(0.0, min(20.0, float(args.max_gap_pct or 0.0)))
    args.low_open_break = max(0.0, min(20.0, float(args.low_open_break or 0.0)))
    args.price_trail = max(0.0, min(50.0, float(args.price_trail or 0.0)))
    args.take_profit = max(0.0, min(100.0, float(args.take_profit or 0.0)))
    args.vol_stall = max(0.0, min(10.0, float(args.vol_stall or 0.0)))
    # 趋势跟踪卖出：N 日确认最多 10 日，ATR 倍数 0~10，摆动低点窗口 0~60
    args.trend_exit = max(0, min(10, int(args.trend_exit or 0)))
    args.atr_trail = max(0.0, min(10.0, float(args.atr_trail or 0.0)))
    args.swing_break = max(0, min(60, int(args.swing_break or 0)))
    if args.below_ma_compare:
        args.below_ma_compare = [
            int(x) for x in str(args.below_ma_compare).replace("，", ",").split(",") if x.strip()
        ]
    # 均线区间（短:长）：解析成 (5, 20) 这样的元组，短周期必须小于长周期
    bands: List[Tuple[int, int]] = []
    for raw in args.ma_band or []:
        txt = str(raw).replace("：", ":").replace("-", ":").strip()
        parts = [p for p in txt.split(":") if p.strip()]
        if len(parts) != 2:
            sys.exit(f"--ma-band 格式应为 短:长（如 5:20），收到: {raw}")
        lo, hi = int(parts[0]), int(parts[1])
        if lo >= hi:
            sys.exit(f"--ma-band 的短周期必须小于长周期，收到: {raw}")
        if lo not in MA_PERIOD_CHOICES or hi not in MA_PERIOD_CHOICES:
            sys.exit(
                f"--ma-band 只支持 {'/'.join(map(str, MA_PERIOD_CHOICES))} 的组合，收到: {raw}"
            )
        bands.append((lo, hi))
    args.ma_band = bands
    # 区间扫描：不给参数时用 5/10/20/40/60 的全部两两组合
    raw_scan = str(args.ma_band_scan or "").strip()
    args.ma_band_scan = []
    if raw_scan:
        periods = [int(x) for x in raw_scan.replace("，", ",").split(",") if x.strip()]
        bad = [p for p in periods if p not in MA_PERIOD_CHOICES]
        if bad:
            sys.exit(f"--ma-band-scan 只支持 {'/'.join(map(str, MA_PERIOD_CHOICES))}，收到: {bad}")
        args.ma_band_scan = periods
    if args.exit_mode == "score":
        # 只用评分卖出：关掉「持有上限」与「不再新高」
        args.max_hold = 0
        args.no_new_high = False
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
        "below_ma": args.below_ma,
        "no_new_high": args.no_new_high,
        "newhigh_basis": args.newhigh_basis,
        "score_exit": args.exit_mode != "hold",
        "ma_bands": tuple(args.ma_band),
        "cooldown": args.cooldown,
        "max_gap": args.max_gap_pct / 100.0,
        "low_open_break": args.low_open_break / 100.0,
        "price_trail": args.price_trail / 100.0,
        "take_profit": args.take_profit / 100.0,
        "ma_exit": args.ma_exit,
        "vol_stall": args.vol_stall,
        "score_price_both": args.score_price_both,
        "trend_exit": args.trend_exit,
        "atr_trail": args.atr_trail,
        "swing_break": args.swing_break,
        "ma_cross_exit": args.ma_cross_exit,
        "rsi_exit": args.rsi_exit,
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

    sample_n = args.sample if args.sample is not None else (0 if (args.board or args.board_scope) else 300)

    board_pool: List[str] = list(args.board or [])
    if args.board_scope:
        scope = args.board_scope
        for code, name in _concept_boards(args.refresh_board).items():
            if (scope == "style" and is_style_board(name)) or (scope == "theme" and is_theme_board(name)):
                board_pool.append(name)

    if board_pool:
        members: Dict[str, str] = {}
        parts: List[str] = []
        for b in board_pool:
            board_code, board_name = resolve_board(b, args.refresh_board)
            rows = fetch_board_members(board_code, args.refresh_board)
            for c, n in rows:
                members.setdefault(c, n)
            parts.append(f"{board_name}({board_code}) {len(rows)}只")
        if args.board_scope:
            head = "、".join(parts[:6])
            print(f"板块范围「{args.board_scope}」展开 {len(board_pool)} 个板块：{head}" + (" …" if len(parts) > 6 else ""))
        else:
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
    if args.census:
        signal_census(data, args)
    if args.board_effect:
        board_effect_study(data, args)
    if args.board_momentum:
        board_momentum_study(data, args)
    if args.rsi:
        rsi_study(data, args)
    if args.quality:
        quality_study(data, args, lag, args.min_mv * 1e8)
    if args.positions:
        positions_study(data, args, lag, args.min_mv * 1e8)
    if args.rank:
        rank_study(data, args, lag, args.min_mv * 1e8)
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
    if args.below_ma:
        low_txt += " / 收盘<" + "/".join(f"MA{p}" for p in args.below_ma)
    if args.ma_band:
        low_txt += " / 区间 " + "+".join(f"MA{lo}<价<MA{hi}" for lo, hi in args.ma_band)
    if args.cooldown > 0:
        low_txt += f" / 冷却{args.cooldown}日"
    if args.max_gap_pct > 0:
        low_txt += f" / 跳空±{args.max_gap_pct:g}%过滤"
    if args.low_open_break > 0:
        low_txt += f" / 低开破昨日低点{args.low_open_break:g}%过滤"
    px_sell = []
    if args.price_trail > 0:
        px_sell.append(f"价格回撤{args.price_trail:g}%")
    if args.take_profit > 0:
        px_sell.append(f"目标+{args.take_profit:g}%")
    if args.ma_exit > 0:
        px_sell.append(f"跌破MA{args.ma_exit}")
    if args.vol_stall > 0:
        px_sell.append(f"放量滞涨{args.vol_stall:g}倍")
    if args.score_price_both:
        px_sell.append("评分+价跌双条件")
    if px_sell:
        low_txt += " / 卖出 " + "+".join(px_sell)
    hold_txt = f"/ 持有上限{args.max_hold or '无'}"
    if args.no_new_high:
        hold_txt += f"或不再新高（{'最高价' if args.newhigh_basis == 'high' else '收盘价'}口径）"
    if args.trend_exit > 0:
        hold_txt += f" / 连续{args.trend_exit}日跌破MA5离场"
    if args.atr_trail > 0:
        hold_txt += f" / 吊灯止损{args.atr_trail:g}ATR"
    if args.swing_break > 0:
        hold_txt += f" / 跌破{args.swing_break}日低点离场"
    if args.ma_cross_exit:
        hold_txt += " / MA5死叉离场"
    if args.exit_mode == "hold":
        hold_txt += "（评分卖出关，只看持仓规则）"
    print_stats(
        f"基准参数 {buy_txt}"
        f" / 卖出{args.sell:g} / 评分≥{args.min_score:g}{low_txt}"
        f" / 成本{args.fee*100:.2f}% / 止损{args.stop_loss*100:.0f}% "
        f"{hold_txt}"
        f"{' / 信号日涨停' if args.require_limit_up else ''}"
        f"{f' / 流通市值≥{args.min_mv:g}亿' if args.min_mv else ''}"
        f"{' / 排除北交所科创板' if args.exclude_boards else ''}"
        f"{' / 排除ST' if args.exclude_st else ''}",
        base,
    )

    if args.below_ma_compare:
        below_ma_compare(data, args, lag, mv_limit, rule_kw, base)

    if args.ma_band or args.ma_band_scan:
        ma_band_compare(data, args, lag, mv_limit, rule_kw, base)

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
