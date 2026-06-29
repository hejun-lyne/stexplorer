#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
涨停股票评分系统 (LimitUpScorer) - 独立模块
============================================
基于 tushare_api.py 已有接口实现，无需修改原文件

评分维度：
1. 题材热点热度（板块资金流入 + 涨跌比 + 涨停密度）
2. 60日均线突破质量（区分反弹/筑底/回踩三种类型）
3. 趋势阶段识别（起势/聚势/冲势/落势）
4. 同题材相对强度（首个涨停、连板数、封单比、涨幅排名）
5. 股性评价（连续阳线、涨停次数、阳阴线比、涨停次日表现）

使用方式：
    from limit_up_scorer import LimitUpScorer, LimitUpScoreConfig

    # 方式1: 单只评分
    scorer = LimitUpScorer()
    result = scorer.score_limit_up_stock("0.000001", "20250627")
    print(f"总分: {result['total_score']}, 等级: {result['grade']}")

    # 方式2: 批量评分（当日所有涨停股）
    batch = scorer.batch_score_limit_up("20250627", top_n=30)
    for stock in batch['top_stocks']:
        print(f"{stock['rank']}. {stock['name']} ({stock['secid']}): {stock['total_score']}分 [{stock['grade']}]")

    # 方式3: 通过 TushareAPI 调用（需先 register）
    from limit_up_scorer import register_limit_up_methods
    register_limit_up_methods()
    result = TushareAPI.score_limit_up_stock("0.000001", "20250627")

依赖: tushare_api.py（同目录）
"""

import sys
import json
import math
from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime, timedelta
from dataclasses import dataclass

# 复用 tushare_api 中的工具函数和缓存机制
from tushare_api import (
    init_pro, get_pro, _pro_api,
    _standardize_date, _parse_date_str, _to_float, _to_int,
    df_to_records, read_cache, write_cache,
    convert_secid_to_ts_code, convert_secid_to_pure_code,
    safe_api_call, cached_api_call,
    TushareAPI, _get_stock_basic_maps,
)

import pandas as pd
import numpy as np


# ============ 配置类 ============

@dataclass
class LimitUpScoreConfig:
    """涨停评分配置 - 可自定义权重和阈值"""
    # 权重配置（总和应为1.0）
    weight_topic_heat: float = 0.20      # 题材热度
    weight_ma60_break: float = 0.20      # 60日突破质量
    weight_trend_stage: float = 0.25     # 趋势阶段（最重要）
    weight_relative_strength: float = 0.20  # 同题材强度
    weight_stock_character: float = 0.15    # 股性

    # 数据回溯天数
    lookback_days: int = 120             # 历史K线回溯天数
    character_lookback: int = 120        # 股性评价回溯天数

    # 等级阈值
    s_grade_threshold: float = 85.0      # S级
    a_grade_threshold: float = 70.0      # A级
    b_grade_threshold: float = 55.0      # B级
    c_grade_threshold: float = 40.0      # C级


# ============ 涨停评分核心类 ============

class LimitUpScorer:
    """
    涨停股票综合评分系统

    初始化:
        scorer = LimitUpScorer()                    # 使用默认配置
        scorer = LimitUpScorer(LimitUpScoreConfig(   # 自定义配置
            weight_trend_stage=0.30,
            weight_topic_heat=0.15
        ))

    核心方法:
        score_limit_up_stock(secid, trade_date) -> Dict   # 单只评分
        batch_score_limit_up(trade_date, top_n) -> Dict     # 批量评分
    """

    def __init__(self, config: LimitUpScoreConfig = None):
        self.config = config or LimitUpScoreConfig()
        self.pro = get_pro()
        self.name_map, self.industry_map = _get_stock_basic_maps()

    # ==================== 数据获取（带缓存） ====================

    def _get_kline_cached(self, secid: str, days: int = 120, end_date: Optional[str] = None) -> pd.DataFrame:
        """获取个股K线（复用 tushare_api.get_kline_data，带缓存）"""
        end_date_std = _standardize_date(end_date) if end_date else datetime.now().strftime('%Y-%m-%d')
        cache_key = f"scorer_kline_{secid}_{days}_{end_date_std}"
        cached = read_cache(cache_key, max_age_hours=24)
        if cached is not None and isinstance(cached, pd.DataFrame):
            return cached

        klines = TushareAPI.get_kline_data(secid, period="daily", adjust="qfq", limit=days, end_date=end_date_std)
        if isinstance(klines, dict) and klines.get("error"):
            return pd.DataFrame()
        if not klines:
            return pd.DataFrame()

        df = pd.DataFrame(klines)
        if df.empty:
            return df

        df = df.rename(columns={
            'date': 'trade_date', 'kp': 'open', 'sp': 'close',
            'zg': 'high', 'zd': 'low', 'cjl': 'vol', 'cje': 'amount',
            'zdf': 'pct_chg', 'zde': 'change',
        })
        df['trade_date'] = pd.to_datetime(df['trade_date'])
        df = df.sort_values('trade_date').reset_index(drop=True)
        write_cache(cache_key, df)
        return df

    def _get_limit_up_list(self, trade_date: str) -> pd.DataFrame:
        """获取当日涨停列表（limit_list接口，带缓存）"""
        date_str = trade_date.replace("-", "")
        cache_key = f"limit_up_list_{date_str}"
        cached = read_cache(cache_key, max_age_hours=24)
        if cached is not None and isinstance(cached, pd.DataFrame):
            return cached

        df = safe_api_call(self.pro.limit_list, trade_date=date_str)
        if isinstance(df, dict) and df.get("error"):
            return pd.DataFrame()
        if df is None or df.empty:
            return pd.DataFrame()

        df = df[df['limit'] == 'U'].copy()
        write_cache(cache_key, df)
        return df

    def _get_daily_basic_all(self, trade_date: str) -> pd.DataFrame:
        """获取当日全市场基础指标（带缓存）"""
        date_str = trade_date.replace("-", "")
        cache_key = f"daily_basic_all_{date_str}"
        cached = read_cache(cache_key, max_age_hours=24)
        if cached is not None and isinstance(cached, pd.DataFrame):
            return cached

        df = safe_api_call(self.pro.daily_basic, trade_date=date_str)
        if isinstance(df, dict) and df.get("error"):
            return pd.DataFrame()
        if df is None or df.empty:
            return pd.DataFrame()

        write_cache(cache_key, df)
        return df

    def _get_moneyflow(self, ts_code: str, start_date: str, end_date: str) -> pd.DataFrame:
        """获取个股资金流向（带缓存）"""
        cache_key = f"moneyflow_{ts_code}_{start_date}_{end_date}"
        cached = read_cache(cache_key, max_age_hours=24)
        if cached is not None and isinstance(cached, pd.DataFrame):
            return cached

        df = safe_api_call(self.pro.moneyflow, ts_code=ts_code, start_date=start_date, end_date=end_date)
        if isinstance(df, dict) and df.get("error"):
            return pd.DataFrame()
        if df is None or df.empty:
            return pd.DataFrame()

        write_cache(cache_key, df)
        return df

    # ==================== 1. 题材热点热度评分 ====================

    def _get_stock_concepts(self, ts_code: str) -> List[Dict[str, str]]:
        """
        获取股票所属概念板块列表
        返回: [{"code": "BKxxxx", "name": "概念名", "source": "dc/ths"}, ...]
        """
        cache_key = f"stock_concepts_{ts_code}"
        cached = read_cache(cache_key, max_age_hours=168)
        if cached is not None:
            return cached

        concepts = []
        stock_code_pure = ts_code.split('.')[0]

        try:
            # 方法1: 遍历概念板块，通过 dc_member 反向查找（效率较低，限制前50个）
            concept_list = safe_api_call(self.pro.dc_index, idx_type="概念板块")
            if isinstance(concept_list, pd.DataFrame) and not concept_list.empty:
                concept_list = concept_list.drop_duplicates(subset=['ts_code'], keep='first')

                for _, row in concept_list.head(50).iterrows():
                    concept_ts = str(row.get('ts_code', ''))
                    concept_name = str(row.get('name', ''))
                    if not concept_ts:
                        continue

                    try:
                        member_df = safe_api_call(self.pro.dc_member, ts_code=concept_ts)
                        if isinstance(member_df, pd.DataFrame) and not member_df.empty:
                            member_codes = member_df['con_code'].astype(str).str.split('.').str[0].tolist()
                            if stock_code_pure in member_codes:
                                concepts.append({
                                    "code": concept_ts.replace('.DC', ''),
                                    "name": concept_name,
                                    "source": "dc",
                                })
                    except Exception:
                        continue
        except Exception as e:
            print(f"[_get_stock_concepts] 获取概念失败 {ts_code}: {e}")

        # Fallback: 使用 industry 字段
        if not concepts:
            industry = self.industry_map.get(ts_code, "")
            if industry:
                concepts.append({"code": "", "name": industry, "source": "industry"})

        write_cache(cache_key, concepts)
        return concepts

    def _get_concept_heat_score(self, concept_code: str, concept_name: str, trade_date: str) -> Tuple[float, Dict]:
        """计算单个概念板块的热度分 (0-100)"""
        date_str = trade_date.replace("-", "")

        try:
            concept_df = safe_api_call(self.pro.dc_index, idx_type="概念板块")
            if isinstance(concept_df, pd.DataFrame) and not concept_df.empty:
                concept_row = concept_df[concept_df['ts_code'] == f"{concept_code}.DC"]
                if not concept_row.empty:
                    row = concept_row.iloc[0]
                    pct_chg = _to_float(row.get('pct_change', 0))
                    up_num = _to_int(row.get('up_num', 0))
                    down_num = _to_int(row.get('down_num', 0))
                    total_mv = _to_float(row.get('total_mv', 0))

                    total_num = up_num + down_num
                    up_ratio = up_num / total_num if total_num > 0 else 0.5

                    # 1. 概念涨幅得分 (0-35)
                    pct_score = min(max(pct_chg * 3.5, 0), 35)
                    # 2. 涨跌比得分 (0-25)
                    ratio_score = min(up_ratio * 25, 25)
                    # 3. 涨停密度估算 (0-25)
                    limit_density_score = self._calc_concept_limit_density(concept_code, trade_date)
                    # 4. 市值活跃度 (0-15)
                    mv_score = min(total_mv / 1000, 15)

                    total = pct_score + ratio_score + limit_density_score + mv_score
                    return min(total, 100), {
                        "concept_code": concept_code, "concept_name": concept_name,
                        "pct_chg": pct_chg, "up_num": up_num, "down_num": down_num,
                        "up_ratio": round(up_ratio, 4),
                        "pct_score": round(pct_score, 2), "ratio_score": round(ratio_score, 2),
                        "limit_density_score": round(limit_density_score, 2),
                        "mv_score": round(mv_score, 2),
                    }
        except Exception as e:
            print(f"[_get_concept_heat_score] 失败 {concept_code}: {e}")

        return 30.0, {"concept_code": concept_code, "reason": "概念数据获取失败"}

    def _calc_concept_limit_density(self, concept_code: str, trade_date: str) -> float:
        """计算概念板块涨停密度得分 (0-25)"""
        try:
            date_str = trade_date.replace("-", "")
            member_df = safe_api_call(self.pro.dc_member, ts_code=f"{concept_code}.DC", trade_date=date_str)
            if isinstance(member_df, dict) and member_df.get("error"):
                return 0
            if member_df is None or (isinstance(member_df, pd.DataFrame) and member_df.empty):
                return 0

            member_codes = member_df['con_code'].astype(str).tolist()
            total_members = len(member_codes)
            if total_members == 0:
                return 0

            limit_df = self._get_limit_up_list(trade_date)
            if limit_df is None or limit_df.empty:
                return 0

            limit_codes = limit_df['ts_code'].tolist()
            limit_in_concept = sum(1 for code in member_codes if code in limit_codes)
            density = limit_in_concept / total_members
            return min(density * 100, 25)
        except Exception:
            return 0

    def score_topic_heat(self, secid: str, trade_date: str) -> Tuple[float, Dict]:
        """
        维度1: 题材热点热度评分 (0-100)

        综合股票所属所有概念的热度，取最强概念加权
        """
        ts_code = convert_secid_to_ts_code(secid)
        concepts = self._get_stock_concepts(ts_code)
        if not concepts:
            return 30.0, {"reason": "无概念数据", "heat_score": 30, "fund_score": 50}

        concept_scores = []
        for concept in concepts[:5]:
            code = concept.get("code", "")
            name = concept.get("name", "")
            if not code and name:  # fallback industry
                try:
                    ind_df = safe_api_call(self.pro.dc_index, idx_type="行业板块")
                    if isinstance(ind_df, pd.DataFrame) and not ind_df.empty:
                        match = ind_df[ind_df['name'] == name]
                        if not match.empty:
                            code = str(match.iloc[0].get('ts_code', '')).replace('.DC', '')
                except Exception:
                    pass

            if code:
                score, detail = self._get_concept_heat_score(code, name, trade_date)
                concept_scores.append({"score": score, "detail": detail})

        if not concept_scores:
            return 30.0, {"reason": "概念热度计算失败", "concepts": concepts}

        best = max(concept_scores, key=lambda x: x['score'])
        avg_score = sum(c['score'] for c in concept_scores) / len(concept_scores)
        final_heat = best['score'] * 0.6 + avg_score * 0.4

        # 补充个股资金流入得分
        fund_score = self._calc_individual_fund_flow_score(ts_code, trade_date)
        total = final_heat * 0.7 + fund_score * 0.3

        return round(min(total, 100), 2), {
            "heat_score": round(final_heat, 2),
            "fund_score": round(fund_score, 2),
            "best_concept": best['detail'],
            "concept_count": len(concept_scores),
            "concepts": [c['detail'] for c in concept_scores],
        }

    def _calc_individual_fund_flow_score(self, ts_code: str, trade_date: str) -> float:
        """个股资金流入得分 (0-100)"""
        try:
            end_dt = datetime.strptime(trade_date.replace("-", ""), "%Y%m%d")
            start_dt = end_dt - timedelta(days=10)
            start_date = start_dt.strftime("%Y%m%d")
            end_date = trade_date.replace("-", "")

            mf_df = self._get_moneyflow(ts_code, start_date, end_date)
            if mf_df is None or mf_df.empty:
                return 50.0

            net_inflow = mf_df['net_mf_amount'].sum() if 'net_mf_amount' in mf_df.columns else 0

            thresholds = [
                (2e8, 90), (1e8, 80), (5e7, 70), (0, 55),
                (-5e7, 40), (-1e8, 25), (float('-inf'), 15)
            ]
            for threshold, score in thresholds:
                if net_inflow >= threshold:
                    return score
            return 50.0
        except Exception:
            return 50.0

    # ==================== 2. 60日均线突破质量评分 ====================

    def score_ma60_break(self, secid: str, trade_date: str) -> Tuple[float, Dict]:
        """
        维度2: 60日均线突破质量评分 (0-100)

        突破类型:
        - pullback (上涨回踩突破): 85-100分，趋势延续，成功率最高
        - consolidation (震荡筑底突破): 70-90分，需放量确认
        - rebound (下跌反弹突破): 30-60分，容易假突破
        - none (未突破/假突破): 0分
        """
        df = self._get_kline_cached(secid, days=self.config.lookback_days, end_date=trade_date)
        if df is None or len(df) < 60:
            return 0.0, {"type": "none", "reason": "K线数据不足60天"}

        df['ma60'] = df['close'].rolling(60).mean()
        latest = df.iloc[-1]
        prev_5 = df.iloc[-6] if len(df) >= 6 else df.iloc[0]

        is_above = latest['close'] > latest['ma60']
        was_below = prev_5['close'] < prev_5['ma60'] if not pd.isna(prev_5['ma60']) else False

        pre_break = df.iloc[-65:-5] if len(df) >= 65 else df.iloc[:max(0, len(df)-5)]
        if len(pre_break) < 20:
            return 40.0, {"type": "rebound", "reason": "突破前数据不足，保守评分"}

        price_decline = (pre_break['close'].max() - pre_break['close'].min()) / pre_break['close'].max() if pre_break['close'].max() > 0 else 0
        ma60_slope = (latest['ma60'] - pre_break['ma60'].iloc[0]) / pre_break['ma60'].iloc[0] if pre_break['ma60'].iloc[0] > 0 else 0
        range_ratio = (pre_break['close'].max() - pre_break['close'].min()) / pre_break['close'].mean() if pre_break['close'].mean() > 0 else 0

        recent_vol = df.iloc[-5:]['vol'].mean()
        pre_vol = df.iloc[-20:-5]['vol'].mean()
        volume_ratio = recent_vol / pre_vol if pre_vol > 0 else 1.0

        detail = {
            "price_decline": round(price_decline, 4), "ma60_slope": round(ma60_slope, 4),
            "range_ratio": round(range_ratio, 4), "volume_ratio": round(volume_ratio, 2),
            "is_above": is_above, "was_below": was_below,
            "latest_close": round(latest['close'], 2),
            "latest_ma60": round(latest['ma60'], 2) if not pd.isna(latest['ma60']) else None,
        }

        # 1. 下跌反弹突破
        if price_decline > 0.25 and ma60_slope < -0.05:
            bottom = self._check_bottom_structure(pre_break)
            if bottom:
                score = 55.0 + min(volume_ratio * 5, 5)
                detail["bottom_structure"] = True
                return score, {"type": "rebound", "reason": "下跌反弹突破，有底部结构", "quality": "medium-low", **detail}
            score = 35.0 + min(volume_ratio * 5, 5)
            return score, {"type": "rebound", "reason": "下跌反弹突破，无底部结构", "quality": "low", **detail}

        # 2. 震荡筑底突破
        if range_ratio < 0.15 and abs(ma60_slope) < 0.02:
            if volume_ratio >= 1.5:
                score = 85.0 + min((volume_ratio - 1.5) * 10, 5)
                return score, {"type": "consolidation", "reason": "横盘放量突破，质量很高", "quality": "high", **detail}
            score = 65.0 + min(volume_ratio * 5, 5)
            return score, {"type": "consolidation", "reason": "横盘突破，量能一般", "quality": "medium", **detail}

        # 3. 上涨回踩突破
        pre_high = pre_break['close'].max()
        current = latest['close']
        if pre_high > current * 1.05 and ma60_slope > 0.02:
            score = 90.0 + min(volume_ratio * 5, 5)
            return score, {"type": "pullback", "reason": "趋势中回踩MA60突破，质量最高", "quality": "highest", **detail}

        # 已在MA60上方运行
        if is_above and not was_below:
            recent_20 = df.iloc[-20:]
            touched = any(row['low'] <= row['ma60'] * 1.02 for _, row in recent_20.iterrows() if not pd.isna(row['ma60']))
            if touched:
                return 85.0, {"type": "pullback", "reason": "趋势中回踩MA60后再上涨", "quality": "high", **detail}
            return 70.0, {"type": "consolidation", "reason": "MA60上方运行，未明显回踩", "quality": "medium", **detail}

        # 默认
        score = 60.0 + min(volume_ratio * 5, 10)
        return score, {"type": "consolidation", "reason": "温和突破MA60", "quality": "medium", **detail}

    def _check_bottom_structure(self, df: pd.DataFrame) -> bool:
        """简化双底/头肩底检测"""
        if len(df) < 40:
            return False
        lows = df['low'].values
        local_lows = []
        for i in range(2, len(lows) - 2):
            if lows[i] < lows[i-1] and lows[i] < lows[i-2] and lows[i] < lows[i+1] and lows[i] < lows[i+2]:
                local_lows.append((i, lows[i]))
        if len(local_lows) < 2:
            return False
        for i in range(len(local_lows) - 1):
            for j in range(i + 1, min(i + 4, len(local_lows))):
                low1, low2 = local_lows[i][1], local_lows[j][1]
                if abs(low1 - low2) / low1 < 0.05:
                    mid_high = max(df['high'].iloc[local_lows[i][0]:local_lows[j][0]])
                    if mid_high > low1 * 1.08:
                        return True
        return False

    # ==================== 3. 趋势阶段识别评分 ====================

    def score_trend_stage(self, secid: str, trade_date: str) -> Tuple[float, Dict]:
        """
        维度3: 趋势阶段评分 (0-100)

        四阶段:
        - 起势: 90-100分，早期介入，盈亏比最优
        - 聚势: 75-90分，次选，等待突破确认
        - 冲势: 50-70分，追高风险增加
        - 落势: 0-20分，回避
        """
        df = self._get_kline_cached(secid, days=90, end_date=trade_date)
        if df is None or len(df) < 60:
            return 30.0, {"stage": "不明", "reason": "K线数据不足", "confidence": 0.3}

        df['ma5'] = df['close'].rolling(5).mean()
        df['ma10'] = df['close'].rolling(10).mean()
        df['ma20'] = df['close'].rolling(20).mean()
        df['ma60'] = df['close'].rolling(60).mean()

        latest = df.iloc[-1]
        m5, m10, m20, m60 = latest['ma5'], latest['ma10'], latest['ma20'], latest['ma60']
        c = latest['close']

        bull_aligned = m5 > m10 > m20 > m60
        bear_aligned = m5 < m10 < m20 < m60
        mixed = not bull_aligned and not bear_aligned

        prev_20 = df.iloc[-20] if len(df) >= 20 else df.iloc[0]
        prev_60 = df.iloc[-60] if len(df) >= 60 else df.iloc[0]
        momentum_20 = (c - prev_20['close']) / prev_20['close'] if prev_20['close'] > 0 else 0
        momentum_60 = (c - prev_60['close']) / prev_60['close'] if prev_60['close'] > 0 else 0

        vol_trend = df['vol'].iloc[-10:].mean() / df['vol'].iloc[-30:-10].mean() if df['vol'].iloc[-30:-10].mean() > 0 else 1.0
        deviation = (c - m5) / m5 if m5 > 0 else 0

        detail = {
            "bull_aligned": bull_aligned, "bear_aligned": bear_aligned,
            "momentum_20": round(momentum_20, 4), "momentum_60": round(momentum_60, 4),
            "vol_trend": round(vol_trend, 2), "deviation": round(deviation, 4),
        }

        # 落势
        if bear_aligned or (not bull_aligned and momentum_20 < -0.03):
            return 10.0, {"stage": "落势", "reason": "空头排列或动量转负，回避", "confidence": 0.9, "score": 10, **detail}

        # 起势
        if mixed and m60 < m20 and momentum_20 > 0.05 and momentum_60 < 0.15 and vol_trend > 1.2:
            ma_cross = m5 > m10 > m20
            if ma_cross and momentum_20 < 0.15:
                score = 95.0 + min(vol_trend * 2, 5)
                return score, {"stage": "起势", "reason": "早期起势，均线刚多头排列，最佳介入点", "confidence": 0.85, "score": score, **detail}
            score = 85.0 + min(vol_trend * 2, 5)
            return score, {"stage": "起势", "reason": "起势阶段，已经开始上涨", "confidence": 0.75, "score": score, **detail}

        # 聚势
        if bull_aligned and 0.03 < momentum_20 < 0.15 and 1.0 < vol_trend < 1.5:
            recent_pullback = df['close'].iloc[-10:].max() > c * 1.03
            if recent_pullback:
                return 85.0, {"stage": "聚势", "reason": "多头排列，洗盘后重新放量", "confidence": 0.75, "score": 85, **detail}
            return 78.0, {"stage": "聚势", "reason": "多头排列形成中，稳健上涨", "confidence": 0.7, "score": 78, **detail}

        # 冲势
        if bull_aligned and momentum_20 > 0.15:
            if deviation > 0.08:
                score = max(50.0, 70.0 - (deviation - 0.08) * 200)
                return score, {"stage": "冲势", "reason": f"冲势阶段，偏离均线{deviation*100:.1f}%", "confidence": 0.6, "score": score, **detail}
            return 65.0, {"stage": "冲势", "reason": "冲势阶段，偏离度可控", "confidence": 0.65, "score": 65, **detail}

        # 震荡
        if mixed and abs(momentum_20) < 0.03:
            return 40.0, {"stage": "不明", "reason": "震荡整理，方向不明", "confidence": 0.5, "score": 40, **detail}

        return 50.0, {"stage": "不明", "reason": "趋势特征不明显", "confidence": 0.5, "score": 50, **detail}

    # ==================== 4. 同题材相对强度评分 ====================

    def score_relative_strength(self, secid: str, trade_date: str) -> Tuple[float, Dict]:
        """
        维度4: 同题材相对强度评分 (0-100)

        核心: 只做题材最强
        - 首个涨停时间排名 (25分)
        - 连板数排名 (30分)
        - 封单金额/流通市值比 (15分)
        - 近5日涨幅排名 (10分)
        - 涨停强度 (20分)
        """
        ts_code = convert_secid_to_ts_code(secid)
        date_str = trade_date.replace("-", "")

        limit_df = self._get_limit_up_list(trade_date)
        if limit_df is None or limit_df.empty:
            return 50.0, {"reason": "无涨停数据"}

        concepts = self._get_stock_concepts(ts_code)
        topic_stocks = self._get_topic_limit_up_stocks(concepts, limit_df, trade_date)
        if ts_code not in topic_stocks:
            topic_stocks.append(ts_code)

        detail = {"topic_stock_count": len(topic_stocks), "concepts_checked": len(concepts)}
        limit_df_topic = limit_df[limit_df['ts_code'].isin(topic_stocks)].copy()
        if limit_df_topic.empty:
            return 50.0, {"reason": "同题材无涨停数据", **detail}

        # 1. 首个涨停时间排名 (25分)
        limit_df_topic['first_time_int'] = limit_df_topic['first_time'].astype(str).str.replace(":", "").astype(int, errors='ignore').fillna(999999)
        my_row = limit_df_topic[limit_df_topic['ts_code'] == ts_code]
        my_first_time = my_row['first_time_int'].iloc[0] if not my_row.empty else 999999
        all_first_times = sorted(limit_df_topic['first_time_int'].tolist())
        first_score = 25.0 if my_first_time == min(all_first_times) else max(0, 25 - all_first_times.index(my_first_time) * 5) if my_first_time in all_first_times else 5.0

        # 2. 连板数排名 (30分)
        end_dt = datetime.strptime(date_str, "%Y%m%d")
        start_dt = end_dt - timedelta(days=15)
        start_date = start_dt.strftime("%Y%m%d")

        my_boards = self._calc_consecutive_limit_up(ts_code, start_date, date_str)
        max_boards = 0
        for stock in topic_stocks:
            boards = self._calc_consecutive_limit_up(stock, start_date, date_str)
            max_boards = max(max_boards, boards)
        board_score = min((my_boards / max_boards) * 30 if max_boards > 0 else 0, 30)

        # 3. 封单金额/流通市值比 (15分)
        seal_ratio = 0
        if not my_row.empty:
            fd_amount = _to_float(my_row.iloc[0].get('fd_amount', 0))
            basic_df = self._get_daily_basic_all(trade_date)
            if basic_df is not None and not basic_df.empty:
                basic_row = basic_df[basic_df['ts_code'] == ts_code]
                if not basic_row.empty:
                    circ_mv = _to_float(basic_row.iloc[0].get('circ_mv', 0)) * 10000
                    if circ_mv > 0:
                        seal_ratio = fd_amount / circ_mv
        seal_score = min(seal_ratio * 1000, 15)

        # 4. 近5日涨幅排名 (10分)
        ret_5d = self._calc_return_n_days(ts_code, trade_date, 5)
        all_returns = [self._calc_return_n_days(s, trade_date, 5) for s in topic_stocks]
        if all_returns:
            sorted_returns = sorted(all_returns, reverse=True)
            return_score = max(0, 10 - sorted_returns.index(ret_5d)) if ret_5d in sorted_returns else 5
        else:
            return_score = 5

        # 5. 涨停强度 (20分)
        strength_score = min(_to_float(my_row.iloc[0].get('strth', 0)) * 2, 20) if not my_row.empty else 10

        total = first_score + board_score + seal_score + return_score + strength_score

        detail.update({
            "first_score": round(first_score, 2), "board_score": round(board_score, 2),
            "my_boards": my_boards, "max_boards": max_boards,
            "seal_score": round(seal_score, 2), "seal_ratio": round(seal_ratio, 6),
            "return_score": round(return_score, 2), "ret_5d": round(ret_5d, 2),
            "strength_score": round(strength_score, 2),
        })

        return round(total, 2), detail

    def _get_topic_limit_up_stocks(self, concepts: List[Dict], limit_df: pd.DataFrame, trade_date: str) -> List[str]:
        """获取同题材下的涨停股票"""
        topic_stocks = []
        date_str = trade_date.replace("-", "")
        for concept in concepts[:3]:
            code = concept.get("code", "")
            if not code:
                continue
            try:
                member_df = safe_api_call(self.pro.dc_member, ts_code=f"{code}.DC", trade_date=date_str)
                if isinstance(member_df, pd.DataFrame) and not member_df.empty:
                    member_codes = member_df['con_code'].astype(str).tolist()
                    limit_codes = limit_df['ts_code'].tolist()
                    for m in member_codes:
                        if m in limit_codes and m not in topic_stocks:
                            topic_stocks.append(m)
            except Exception:
                continue
        return topic_stocks

    def _calc_consecutive_limit_up(self, ts_code: str, start_date: str, end_date: str) -> int:
        """计算连板数"""
        cache_key = f"consecutive_limit_up_{ts_code}_{start_date}_{end_date}"
        cached = read_cache(cache_key, max_age_hours=24)
        if cached is not None:
            return cached

        try:
            df = safe_api_call(self.pro.limit_list, ts_code=ts_code, start_date=start_date, end_date=end_date)
            if isinstance(df, dict) and df.get("error"):
                return 0
            if df is None or df.empty:
                return 0
            df = df[df['limit'] == 'U'].sort_values('trade_date', ascending=False)
            if df.empty:
                return 0
            dates = pd.to_datetime(df['trade_date']).tolist()
            if not dates:
                return 0
            consecutive = 1
            for i in range(1, len(dates)):
                consecutive = consecutive + 1 if (dates[i-1] - dates[i]).days == 1 else 1
            write_cache(cache_key, consecutive)
            return consecutive
        except Exception:
            return 0

    def _calc_return_n_days(self, ts_code: str, trade_date: str, n: int) -> float:
        """计算N日涨幅"""
        df = self._get_kline_cached(convert_secid_to_ts_code(ts_code), days=n+5, end_date=trade_date)
        if df is None or len(df) < n:
            return 0.0
        recent = df.tail(n)
        if len(recent) < 2:
            return 0.0
        return (recent.iloc[-1]['close'] / recent.iloc[0]['close'] - 1) * 100

    # ==================== 5. 股性评价评分 ====================

    def score_stock_character(self, secid: str, trade_date: str) -> Tuple[float, Dict]:
        """
        维度5: 股性评价评分 (0-100)

        子维度:
        - 连续阳线能力 (20分)
        - 涨停次数 (20分)
        - 阳阴线比 (15分)
        - 涨停次日表现 (25分) —— 最关键
        - 振幅与活跃度 (10分)
        - 历史连板能力 (10分)
        """
        ts_code = convert_secid_to_ts_code(secid)
        df = self._get_kline_cached(secid, days=self.config.character_lookback, end_date=trade_date)
        if df is None or len(df) < 20:
            return 40.0, {"reason": "K线数据不足", "sub_scores": {}}

        scores = {}

        # 1. 连续阳线能力 (20分)
        df['is_up'] = df['close'] > df['close'].shift(1)
        consecutive_ups = []
        current = 0
        for is_up in df['is_up']:
            if is_up:
                current += 1
            else:
                if current > 0:
                    consecutive_ups.append(current)
                current = 0
        if current > 0:
            consecutive_ups.append(current)
        max_consecutive = max(consecutive_ups) if consecutive_ups else 0
        avg_consecutive = np.mean(consecutive_ups) if consecutive_ups else 0
        scores['continuity'] = min(max_consecutive * 3 + avg_consecutive * 2, 20)

        # 2. 涨停次数 (20分)
        limit_up_times = self._count_limit_up_in_period(ts_code, trade_date, self.config.character_lookback)
        scores['limit_up_freq'] = min(limit_up_times * 2, 20)

        # 3. 阳阴线比 (15分)
        up_days = len(df[df['close'] > df['open']])
        down_days = len(df[df['close'] < df['open']])
        total_days = up_days + down_days
        if total_days > 0:
            ratio = up_days / total_days
            scores['ratio'] = max(0, min((ratio - 0.5) * 30 + 7.5, 15))
        else:
            scores['ratio'] = 7.5

        # 4. 涨停次日表现 (25分) —— 最关键
        next_day_returns = self._get_limit_up_next_day_returns(ts_code, trade_date, self.config.character_lookback)
        if next_day_returns:
            avg_next = np.mean(next_day_returns)
            win_rate = len([r for r in next_day_returns if r > 0]) / len(next_day_returns)
            scores['next_day'] = min(max(avg_next * 100 + win_rate * 10, 0), 25)
        else:
            scores['next_day'] = 10

        # 5. 振幅与活跃度 (10分)
        df['amplitude'] = (df['high'] - df['low']) / df['low']
        avg_amplitude = df['amplitude'].mean()
        scores['activity'] = min(avg_amplitude * 100 * 2, 10)

        # 6. 历史连板能力 (10分)
        max_boards_history = self._get_max_consecutive_boards(ts_code, trade_date, self.config.character_lookback)
        scores['board_history'] = min(max_boards_history * 2.5, 10)

        total = sum(scores.values())

        detail = {
            "sub_scores": {k: round(v, 2) for k, v in scores.items()},
            "max_consecutive_up": max_consecutive,
            "avg_consecutive_up": round(avg_consecutive, 2),
            "limit_up_times": limit_up_times,
            "up_days": up_days, "down_days": down_days,
            "next_day_sample_count": len(next_day_returns),
            "avg_next_day_return": round(np.mean(next_day_returns) * 100, 2) if next_day_returns else None,
            "next_day_win_rate": round(len([r for r in next_day_returns if r > 0]) / len(next_day_returns) * 100, 2) if next_day_returns else None,
            "avg_amplitude": round(avg_amplitude * 100, 2),
            "max_boards_history": max_boards_history,
        }

        return round(total, 2), detail

    def _count_limit_up_in_period(self, ts_code: str, trade_date: str, days: int) -> int:
        """统计历史涨停次数"""
        end_dt = datetime.strptime(trade_date.replace("-", ""), "%Y%m%d")
        start_dt = end_dt - timedelta(days=days + 30)
        start_date = start_dt.strftime("%Y%m%d")
        end_date = trade_date.replace("-", "")

        cache_key = f"limit_up_count_{ts_code}_{start_date}_{end_date}"
        cached = read_cache(cache_key, max_age_hours=168)
        if cached is not None:
            return cached

        try:
            df = safe_api_call(self.pro.limit_list, ts_code=ts_code, start_date=start_date, end_date=end_date)
            if isinstance(df, dict) and df.get("error"):
                return 0
            if df is None or df.empty:
                return 0
            count = len(df[df['limit'] == 'U'])
            write_cache(cache_key, count)
            return count
        except Exception:
            return 0

    def _get_limit_up_next_day_returns(self, ts_code: str, trade_date: str, days: int) -> List[float]:
        """获取历史涨停次日收益率列表"""
        end_dt = datetime.strptime(trade_date.replace("-", ""), "%Y%m%d")
        start_dt = end_dt - timedelta(days=days + 30)
        start_date = start_dt.strftime("%Y%m%d")
        end_date = trade_date.replace("-", "")

        cache_key = f"next_day_returns_{ts_code}_{start_date}_{end_date}"
        cached = read_cache(cache_key, max_age_hours=168)
        if cached is not None:
            return cached

        returns = []
        try:
            limit_df = safe_api_call(self.pro.limit_list, ts_code=ts_code, start_date=start_date, end_date=end_date)
            if isinstance(limit_df, dict) and limit_df.get("error"):
                return []
            if limit_df is None or limit_df.empty:
                return []

            limit_df = limit_df[limit_df['limit'] == 'U'].sort_values('trade_date')
            kline = self._get_kline_cached(convert_secid_to_ts_code(ts_code), days=days+30, end_date=trade_date)
            if kline is None or kline.empty:
                return []

            kline['date_str'] = kline['trade_date'].dt.strftime('%Y%m%d')
            kline_dict = {row['date_str']: row for _, row in kline.iterrows()}

            for _, row in limit_df.iterrows():
                limit_date = str(row['trade_date'])
                next_date = self._get_next_trade_date(limit_date)
                if next_date and next_date in kline_dict and limit_date in kline_dict:
                    limit_close = kline_dict[limit_date]['close']
                    next_close = kline_dict[next_date]['close']
                    if limit_close > 0:
                        returns.append((next_close - limit_close) / limit_close)

            write_cache(cache_key, returns)
            return returns
        except Exception:
            return []

    def _get_next_trade_date(self, date_str: str) -> Optional[str]:
        """获取下一个交易日（简化：跳过周末）"""
        try:
            dt = datetime.strptime(date_str, "%Y%m%d")
            for i in range(1, 5):
                next_dt = dt + timedelta(days=i)
                if next_dt.weekday() < 5:
                    return next_dt.strftime("%Y%m%d")
            return None
        except Exception:
            return None

    def _get_max_consecutive_boards(self, ts_code: str, trade_date: str, days: int) -> int:
        """获取历史最大连板数"""
        end_dt = datetime.strptime(trade_date.replace("-", ""), "%Y%m%d")
        start_dt = end_dt - timedelta(days=days + 30)
        start_date = start_dt.strftime("%Y%m%d")
        end_date = trade_date.replace("-", "")

        cache_key = f"max_boards_{ts_code}_{start_date}_{end_date}"
        cached = read_cache(cache_key, max_age_hours=168)
        if cached is not None:
            return cached

        try:
            df = safe_api_call(self.pro.limit_list, ts_code=ts_code, start_date=start_date, end_date=end_date)
            if isinstance(df, dict) and df.get("error"):
                return 0
            if df is None or df.empty:
                return 0
            df = df[df['limit'] == 'U'].sort_values('trade_date')
            if df.empty:
                return 0
            dates = pd.to_datetime(df['trade_date']).tolist()
            max_consecutive = current = 1
            for i in range(1, len(dates)):
                if (dates[i] - dates[i-1]).days == 1:
                    current += 1
                    max_consecutive = max(max_consecutive, current)
                else:
                    current = 1
            write_cache(cache_key, max_consecutive)
            return max_consecutive
        except Exception:
            return 0

    # ==================== 综合评分 ====================

    def score_limit_up_stock(self, secid: str, trade_date: str) -> Dict[str, Any]:
        """
        对单只涨停股票进行综合评分

        Args:
            secid: 股票ID，如 "0.000001" 或 "1.600000"
            trade_date: 交易日期，如 "2025-06-27"

        Returns:
            完整的评分结果字典，包含5个维度得分、总分、等级、建议
        """
        ts_code = convert_secid_to_ts_code(secid)
        name = self.name_map.get(ts_code, "")

        # 五个维度评分
        topic_score, topic_detail = self.score_topic_heat(secid, trade_date)
        ma60_score, ma60_detail = self.score_ma60_break(secid, trade_date)
        trend_score, trend_detail = self.score_trend_stage(secid, trade_date)
        rel_score, rel_detail = self.score_relative_strength(secid, trade_date)
        char_score, char_detail = self.score_stock_character(secid, trade_date)

        cfg = self.config

        # 一票否决项
        penalty = 1.0
        if trend_detail.get("stage") == "落势":
            penalty *= 0.3
        if ma60_detail.get("type") == "none":
            penalty *= 0.5

        # 加权总分
        total = (
            topic_score * cfg.weight_topic_heat +
            ma60_score * cfg.weight_ma60_break +
            trend_score * cfg.weight_trend_stage +
            rel_score * cfg.weight_relative_strength +
            char_score * cfg.weight_stock_character
        ) * penalty

        # 等级划分
        if total >= cfg.s_grade_threshold:
            grade, recommendation = "S", "重点参与，仓位可重"
        elif total >= cfg.a_grade_threshold:
            grade, recommendation = "A", "积极参与"
        elif total >= cfg.b_grade_threshold:
            grade, recommendation = "B", "谨慎参与，控制仓位"
        elif total >= cfg.c_grade_threshold:
            grade, recommendation = "C", "观望或极小仓位试错"
        else:
            grade, recommendation = "D", "回避"

        return {
            "secid": secid, "ts_code": ts_code, "trade_date": trade_date, "name": name,
            "total_score": round(total, 2), "grade": grade, "recommendation": recommendation,
            "penalty": round(penalty, 2),
            "dimension_scores": {
                "topic_heat": {"score": topic_score, "weight": cfg.weight_topic_heat, "weighted": round(topic_score * cfg.weight_topic_heat, 2), "detail": topic_detail},
                "ma60_break": {"score": ma60_score, "weight": cfg.weight_ma60_break, "weighted": round(ma60_score * cfg.weight_ma60_break, 2), "detail": ma60_detail},
                "trend_stage": {"score": trend_score, "weight": cfg.weight_trend_stage, "weighted": round(trend_score * cfg.weight_trend_stage, 2), "detail": trend_detail},
                "relative_strength": {"score": rel_score, "weight": cfg.weight_relative_strength, "weighted": round(rel_score * cfg.weight_relative_strength, 2), "detail": rel_detail},
                "stock_character": {"score": char_score, "weight": cfg.weight_stock_character, "weighted": round(char_score * cfg.weight_stock_character, 2), "detail": char_detail},
            },
            "weights": {
                "topic_heat": cfg.weight_topic_heat, "ma60_break": cfg.weight_ma60_break,
                "trend_stage": cfg.weight_trend_stage, "relative_strength": cfg.weight_relative_strength,
                "stock_character": cfg.weight_stock_character,
            },
        }

    def batch_score_limit_up(self, trade_date: str, top_n: int = 50) -> Dict[str, Any]:
        """
        批量评分当日所有涨停股票

        Args:
            trade_date: 交易日期，如 "2025-06-27"
            top_n: 只返回前N名

        Returns:
            {"trade_date": "...", "total_count": N, "scored_count": N, "top_stocks": [...]}
        """
        date_str = trade_date.replace("-", "")
        limit_df = self._get_limit_up_list(trade_date)

        if limit_df is None or limit_df.empty:
            return {"trade_date": trade_date, "total_count": 0, "scored_count": 0, "top_stocks": []}

        results = []
        total = len(limit_df)

        for idx, (_, row) in enumerate(limit_df.iterrows()):
            ts_code = str(row.get('ts_code', ''))
            if not ts_code or '.' not in ts_code:
                continue
            code = ts_code.split('.')[0]
            market = '1' if code.startswith('6') else '0'
            secid = f"{market}.{code}"

            if idx % 10 == 0:
                print(f"[PROGRESS] 涨停评分 {idx}/{total}: {ts_code}")

            try:
                result = self.score_limit_up_stock(secid, trade_date)
                results.append(result)
            except Exception as e:
                print(f"[ERROR] 评分失败 {ts_code}: {e}")
                continue

        results.sort(key=lambda x: x['total_score'], reverse=True)
        for i, r in enumerate(results):
            r['rank'] = i + 1

        return {
            "trade_date": trade_date, "total_count": total,
            "scored_count": len(results), "top_stocks": results[:top_n],
        }


# ============ 与 TushareAPI 集成 ============

def register_limit_up_methods():
    """
    将涨停评分方法注册到 TushareAPI 类中

    使用方式:
        from limit_up_scorer import register_limit_up_methods
        register_limit_up_methods()

        # 现在可以通过 TushareAPI 调用
        result = TushareAPI.score_limit_up_stock("0.000001", "20250627")
        batch = TushareAPI.batch_score_limit_up("20250627", top_n=30)
    """
    @staticmethod
    def score_limit_up_stock(secid: str, trade_date: str) -> Dict[str, Any]:
        scorer = LimitUpScorer()
        return scorer.score_limit_up_stock(secid, trade_date)

    @staticmethod
    def batch_score_limit_up(trade_date: str, top_n: int = 50) -> Dict[str, Any]:
        scorer = LimitUpScorer()
        return scorer.batch_score_limit_up(trade_date, top_n)

    TushareAPI.score_limit_up_stock = score_limit_up_stock
    TushareAPI.batch_score_limit_up = batch_score_limit_up


# ============ CLI 入口 ============

def main():
    import argparse
    parser = argparse.ArgumentParser(description="涨停股票评分系统")
    parser.add_argument("action", choices=["score", "batch"], help="评分模式")
    parser.add_argument("--secid", "-s", help="股票ID，如 0.000001")
    parser.add_argument("--date", "-d", help="交易日期，如 2025-06-27")
    parser.add_argument("--token", "-t", help="Tushare Token", default=None)
    parser.add_argument("--top-n", "-n", type=int, default=50, help="批量模式返回前N名")
    parser.add_argument("--storage-path", help="缓存目录", default=None)

    args = parser.parse_args()

    if args.token:
        init_pro(args.token)
    else:
        init_pro()

    if _pro_api is None:
        print(json.dumps({"error": "Tushare Pro Token 未设置"}, ensure_ascii=False))
        sys.exit(1)

    if args.storage_path:
        from tushare_api import set_cache_dir
        set_cache_dir(args.storage_path)

    scorer = LimitUpScorer()
    date = args.date or datetime.now().strftime('%Y-%m-%d')

    if args.action == "score":
        if not args.secid:
            print(json.dumps({"error": "请提供 --secid 参数"}, ensure_ascii=False))
            sys.exit(1)
        result = scorer.score_limit_up_stock(args.secid, date)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        result = scorer.batch_score_limit_up(date, top_n=args.top_n)
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
