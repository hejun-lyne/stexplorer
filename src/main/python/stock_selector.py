import tushare as ts
import pandas as pd
import numpy as np
from typing import Optional, List, Dict, Tuple
from dataclasses import dataclass
from datetime import datetime, timedelta
import json
import os
import argparse

@dataclass
class IndustryFilterConfig:
    """行业筛选配置"""
    fund_flow_days: int = 5              # 资金流入计算天数
    fund_flow_rank_pct: float = 0.3      # 资金流入排名百分比(前30%)
    min_return_5d: float = 2.0           # 最小5日涨幅(%)
    min_rs: float = 1.1                  # 最小相对强弱
    require_ma_bull: bool = True         # 是否要求均线多头

@dataclass
class StockFilterConfig:
    """个股筛选配置"""
    leader_top_n: int = 5                # 行业内选取龙头数量
    min_circ_mv: float = 20              # 最小流通市值(亿)
    max_circ_mv: float = 800             # 最大流通市值(亿)
    min_avg_amount: float = 5000         # 最小日均成交额(万)
    min_profit_growth: float = -30       # 最小扣非净利润增速(%)
    max_decline_from_high: float = 15    # 距近期高点最大回撤(%)
    require_above_ma250: bool = False    # 是否要求股价在年线上方

@dataclass
class BuySignalConfig:
    """买入信号配置"""
    strategy: str = "breakout"           # breakout(突破)/callback(回调)/both
    breakout_volume_ratio: float = 1.5   # 突破时量比要求
    callback_to_ma: str = "ma10"         # 回调至哪条均线
    max_callback_depth: float = 8        # 最大回调深度(%)

class StockSelector:
    """
    A股行业-个股选股模块
    流程: 行业趋势确认 -> 龙头识别 -> 排雷过滤 -> 择时信号
    """

    def __init__(self, token: str, cache_dir: str = "./selector_cache"):
        self.pro = ts.pro_api(token)
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)

        # 缓存
        self._industry_list_cache = None
        self._industry_kline_cache = {}
        self._stock_kline_cache = {}
        self._fund_flow_cache = {}

    # ==================== 1. 行业筛选 ====================

    def get_l2_industries(self, src: str = 'SW2021', use_cache: bool = True) -> pd.DataFrame:
        """获取所有二级行业列表"""
        if use_cache and self._industry_list_cache is not None:
            return self._industry_list_cache

        df = self.pro.index_classify(level='L2', src=src)
        if df is not None:
            self._industry_list_cache = df
        return df

    def get_industry_kline(self, index_code: str, start_date: str, end_date: str) -> Optional[pd.DataFrame]:
        """获取行业指数K线"""
        cache_key = f"{index_code}_{start_date}_{end_date}"
        if cache_key in self._industry_kline_cache:
            return self._industry_kline_cache[cache_key]

        try:
            df = self.pro.sw_industry_daily(ts_code=index_code, start_date=start_date, end_date=end_date)
            if df is not None and not df.empty:
                df = df.sort_values('trade_date').reset_index(drop=True)
                self._industry_kline_cache[cache_key] = df
                return df
        except Exception as e:
            print(f"[WARN] 获取行业K线失败 {index_code}: {e}")
        return None

    def calc_industry_fund_flow(self, industry_code: str, trade_date: str, days: int = 5) -> float:
        """计算行业N日资金净流入(通过成分股汇总)"""
        cache_key = f"{industry_code}_{trade_date}_{days}"
        if cache_key in self._fund_flow_cache:
            return self._fund_flow_cache[cache_key]

        # 获取成分股
        members = self.pro.index_member(index_code=industry_code)
        if members is None or members.empty:
            return 0.0

        # 计算日期范围
        end_dt = datetime.strptime(trade_date, "%Y%m%d")
        start_dt = end_dt - timedelta(days=days * 2)  # 多取一些，过滤非交易日
        start_date = start_dt.strftime("%Y%m%d")

        total_inflow = 0.0
        stock_codes = members['con_code'].tolist()

        for code in stock_codes[:50]:  # 限制数量，避免请求过多
            try:
                df = self.pro.moneyflow(ts_code=code, start_date=start_date, end_date=trade_date)
                if df is not None and not df.empty:
                    # 取最近N个交易日
                    df = df.sort_values('trade_date', ascending=False).head(days)
                    total_inflow += df['net_mf_amount'].sum()
            except Exception:
                continue

        self._fund_flow_cache[cache_key] = total_inflow
        return total_inflow

    def calc_industry_trend_score(self, kline: pd.DataFrame) -> Dict:
        """计算行业趋势强度得分"""
        if kline is None or len(kline) < 60:
            return {"total": 0, "ret_5d": 0, "ret_20d": 0, "ma_bull": False, "rs": 0}

        df = kline.copy()
        df['ma5'] = df['close'].rolling(5).mean()
        df['ma10'] = df['close'].rolling(10).mean()
        df['ma20'] = df['close'].rolling(20).mean()
        df['ma60'] = df['close'].rolling(60).mean()

        latest = df.iloc[-1]
        prev_5 = df.iloc[-5] if len(df) >= 5 else df.iloc[0]
        prev_20 = df.iloc[-20] if len(df) >= 20 else df.iloc[0]

        # 5日涨幅
        ret_5d = (latest['close'] / prev_5['close'] - 1) * 100 if prev_5['close'] > 0 else 0
        # 20日涨幅
        ret_20d = (latest['close'] / prev_20['close'] - 1) * 100 if prev_20['close'] > 0 else 0

        # 均线多头排列
        ma_bull = (latest['ma5'] > latest['ma10'] > latest['ma20'] > latest['ma60'])

        # 相对强弱(与沪深300比较，简化版)
        rs = 1.0  # 实际使用需获取沪深300数据

        # 综合得分 (0-100)
        score = 0
        score += min(max(ret_5d * 3, 0), 30)      # 5日涨幅最多30分
        score += min(max(ret_20d * 1.5, 0), 20)   # 20日涨幅最多20分
        score += 25 if ma_bull else 0              # 均线多头25分
        score += 25 if ret_5d > 0 and ret_20d > 0 else 0  # 双正25分

        return {
            "total": score,
            "ret_5d": round(ret_5d, 2),
            "ret_20d": round(ret_20d, 2),
            "ma_bull": ma_bull,
            "rs": round(rs, 2)
        }

    def filter_industries(self, trade_date: str, config: IndustryFilterConfig = None) -> pd.DataFrame:
        """
        筛选值得投资的二级行业
        """
        if config is None:
            config = IndustryFilterConfig()

        industries = self.get_l2_industries()
        if industries is None or industries.empty:
            print("[ERROR] 无法获取行业列表")
            return pd.DataFrame()

        # 计算K线起始日期
        end_dt = datetime.strptime(trade_date, "%Y%m%d")
        start_dt = end_dt - timedelta(days=120)
        start_date = start_dt.strftime("%Y%m%d")

        results = []
        total = len(industries)

        for idx, (_, row) in enumerate(industries.iterrows()):
            code = row['index_code']
            name = row['industry_name']

            if idx % 10 == 0:
                print(f"[PROGRESS] 行业筛选 {idx}/{total}: {name}")

            # 获取行业K线
            kline = self.get_industry_kline(code, start_date, trade_date)
            if kline is None or len(kline) < 20:
                continue

            # 计算趋势得分
            trend = self.calc_industry_trend_score(kline)

            # 计算资金流入
            fund_flow = self.calc_industry_fund_flow(code, trade_date, config.fund_flow_days)

            results.append({
                'industry_code': code,
                'industry_name': name,
                'trend_score': trend['total'],
                'ret_5d': trend['ret_5d'],
                'ret_20d': trend['ret_20d'],
                'ma_bull': trend['ma_bull'],
                'fund_flow': round(fund_flow / 1e8, 2),  # 转为亿元
                'kline': kline  # 保留K线供后续使用
            })

        df = pd.DataFrame(results)
        if df.empty:
            return df

        # 资金流入排名
        df['fund_flow_rank'] = df['fund_flow'].rank(ascending=False, pct=True)

        # 综合过滤条件
        filtered = df[
            (df['trend_score'] >= 40) &                    # 趋势得分>=40
            (df['ret_5d'] >= config.min_return_5d) &       # 5日涨幅达标
            (df['fund_flow_rank'] <= config.fund_flow_rank_pct) &  # 资金流入前30%
            (df['ma_bull'] if config.require_ma_bull else True)    # 均线多头(可选)
        ].copy()

        # 综合排序: 趋势得分*0.6 + 资金排名*0.4
        filtered['composite_score'] = (
            filtered['trend_score'] * 0.6 + 
            (1 - filtered['fund_flow_rank']) * 40  # 转为0-40分
        )

        return filtered.sort_values('composite_score', ascending=False).reset_index(drop=True)

    # ==================== 2. 个股龙头识别 ====================

    def get_stock_kline(self, ts_code: str, start_date: str, end_date: str) -> Optional[pd.DataFrame]:
        """获取个股K线"""
        cache_key = f"{ts_code}_{start_date}_{end_date}"
        if cache_key in self._stock_kline_cache:
            return self._stock_kline_cache[cache_key]

        try:
            df = self.pro.daily(ts_code=ts_code, start_date=start_date, end_date=end_date)
            if df is not None and not df.empty:
                df = df.sort_values('trade_date').reset_index(drop=True)
                self._stock_kline_cache[cache_key] = df
                return df
        except Exception as e:
            print(f"[WARN] 获取个股K线失败 {ts_code}: {e}")
        return None

    def get_stock_basic(self, ts_code: str, trade_date: str) -> Optional[pd.DataFrame]:
        """获取个股基本面数据"""
        try:
            return self.pro.daily_basic(ts_code=ts_code, trade_date=trade_date)
        except Exception:
            return None

    def get_stock_fina(self, ts_code: str, period: str = None) -> Optional[pd.DataFrame]:
        """获取个股财务指标"""
        try:
            if period:
                return self.pro.fina_indicator(ts_code=ts_code, period=period)
            else:
                return self.pro.fina_indicator(ts_code=ts_code)
        except Exception:
            return None

    def get_limit_list(self, ts_code: str, start_date: str, end_date: str) -> Optional[pd.DataFrame]:
        """获取个股涨停记录"""
        try:
            return self.pro.limit_list(ts_code=ts_code, start_date=start_date, end_date=end_date)
        except Exception:
            return None

    def calc_stock_leader_score(self, ts_code: str, trade_date: str, 
                                 industry_kline: pd.DataFrame = None) -> Optional[Dict]:
        """
        计算个股龙头得分
        """
        end_dt = datetime.strptime(trade_date, "%Y%m%d")
        start_dt = end_dt - timedelta(days=60)
        start_date = start_dt.strftime("%Y%m%d")

        # 获取个股K线
        kline = self.get_stock_kline(ts_code, start_date, trade_date)
        if kline is None or len(kline) < 20:
            return None

        latest = kline.iloc[-1]
        prev_5 = kline.iloc[-5] if len(kline) >= 5 else kline.iloc[0]
        prev_20 = kline.iloc[-20] if len(kline) >= 20 else kline.iloc[0]

        # 涨幅
        ret_5d = (latest['close'] / prev_5['close'] - 1) * 100 if prev_5['close'] > 0 else 0
        ret_20d = (latest['close'] / prev_20['close'] - 1) * 100 if prev_20['close'] > 0 else 0

        # 资金流入
        try:
            fund = self.pro.moneyflow(ts_code=ts_code, start_date=start_date, end_date=trade_date)
            net_inflow = fund['net_mf_amount'].sum() if fund is not None else 0
        except:
            net_inflow = 0

        # 涨停次数
        limit = self.get_limit_list(ts_code, start_date, trade_date)
        limit_count = len(limit) if limit is not None else 0

        # 基本面
        basic = self.get_stock_basic(ts_code, trade_date)
        circ_mv = basic['circ_mv'].iloc[0] if basic is not None else 0
        turnover = basic['turnover_rate'].iloc[0] if basic is not None else 0

        # 与行业相关性(简化)
        industry_corr = 0.5
        if industry_kline is not None and len(industry_kline) >= 20:
            stock_ret = kline['close'].pct_change().dropna().tail(20)
            ind_ret = industry_kline['close'].pct_change().dropna().tail(20)
            if len(stock_ret) == len(ind_ret) and len(stock_ret) > 5:
                industry_corr = stock_ret.corr(ind_ret)

        # 龙头得分 (0-100)
        score = 0
        score += min(max(ret_5d * 3, 0), 25)           # 5日涨幅 25分
        score += min(max(ret_20d * 1.5, 0), 15)        # 20日涨幅 15分
        score += min(max(np.log1p(abs(net_inflow/1e6)) * 5, 0), 20)  # 资金 20分
        score += limit_count * 5                         # 涨停 每次5分，最多20分
        score += min(max(turnover * 2, 0), 10)          # 换手率 10分
        score += max(industry_corr * 10, 0)              # 行业相关性 10分

        return {
            'ts_code': ts_code,
            'ret_5d': round(ret_5d, 2),
            'ret_20d': round(ret_20d, 2),
            'net_inflow': round(net_inflow / 1e6, 2),  # 百万元
            'limit_count': limit_count,
            'circ_mv': round(circ_mv, 2),
            'turnover': round(turnover, 2),
            'industry_corr': round(industry_corr, 2),
            'leader_score': round(score, 2),
            'kline': kline
        }

    # ==================== 3. 排雷过滤 ====================

    def risk_filter(self, ts_code: str, trade_date: str, 
                    config: StockFilterConfig = None) -> Tuple[bool, str]:
        """
        个股排雷检查
        返回: (是否通过, 原因)
        """
        if config is None:
            config = StockFilterConfig()

        end_dt = datetime.strptime(trade_date, "%Y%m%d")
        start_dt = end_dt - timedelta(days=60)
        start_date = start_dt.strftime("%Y%m%d")

        # 1. 获取K线
        kline = self.get_stock_kline(ts_code, start_date, trade_date)
        if kline is None or len(kline) < 20:
            return False, "K线数据不足"

        latest = kline.iloc[-1]

        # 2. 流通市值检查
        basic = self.get_stock_basic(ts_code, trade_date)
        if basic is not None:
            circ_mv = basic['circ_mv'].iloc[0]  # 亿元
            if circ_mv < config.min_circ_mv:
                return False, f"流通市值太小({circ_mv:.1f}亿)"
            if circ_mv > config.max_circ_mv:
                return False, f"流通市值太大({circ_mv:.1f}亿)"

        # 3. 流动性检查
        avg_amount = kline['amount'].mean()  # 万元
        if avg_amount < config.min_avg_amount:
            return False, f"流动性不足(日均成交{avg_amount:.0f}万)"

        # 4. 业绩检查
        fina = self.get_stock_fina(ts_code)
        if fina is not None and not fina.empty:
            profit_growth = fina['profit_dedt_yoy'].iloc[0]
            if pd.notna(profit_growth) and profit_growth < config.min_profit_growth:
                return False, f"业绩大幅下滑({profit_growth:.1f}%)"

        # 5. 距高点回撤检查
        recent_high = kline['high'].tail(20).max()
        decline_from_high = (recent_high - latest['close']) / recent_high * 100
        if decline_from_high > config.max_decline_from_high:
            return False, f"距高点回撤过大({decline_from_high:.1f}%)"

        # 6. 年线检查
        if config.require_above_ma250 and len(kline) >= 250:
            ma250 = kline['close'].rolling(250).mean().iloc[-1]
            if latest['close'] < ma250:
                return False, "股价低于年线"

        return True, "通过"

    # ==================== 4. 择时信号 ====================

    def check_buy_signal(self, ts_code: str, trade_date: str, 
                         config: BuySignalConfig = None) -> Tuple[bool, str, Dict]:
        """
        检查买入信号
        返回: (是否有信号, 信号类型, 信号详情)
        """
        if config is None:
            config = BuySignalConfig()

        end_dt = datetime.strptime(trade_date, "%Y%m%d")
        start_dt = end_dt - timedelta(days=30)
        start_date = start_dt.strftime("%Y%m%d")

        kline = self.get_stock_kline(ts_code, start_date, trade_date)
        if kline is None or len(kline) < 10:
            return False, "无数据", {}

        df = kline.copy()
        df['ma5'] = df['close'].rolling(5).mean()
        df['ma10'] = df['close'].rolling(10).mean()
        df['ma20'] = df['close'].rolling(20).mean()
        df['vol_ma5'] = df['vol'].rolling(5).mean()

        latest = df.iloc[-1]
        prev = df.iloc[-2] if len(df) >= 2 else latest

        signals = []

        # 突破信号
        if config.strategy in ["breakout", "both"]:
            # 近10日高点突破
            recent_high = df['high'].tail(10).max()
            if latest['close'] > prev['close'] and latest['close'] >= recent_high * 0.99:
                volume_ratio = latest['vol'] / latest['vol_ma5'] if latest['vol_ma5'] > 0 else 0
                if volume_ratio >= config.breakout_volume_ratio:
                    signals.append({
                        'type': 'breakout',
                        'price': latest['close'],
                        'volume_ratio': round(volume_ratio, 2),
                        'strength': '强' if volume_ratio > 2 else '中'
                    })

        # 回调信号
        if config.strategy in ["callback", "both"]:
            callback_ma = config.callback_to_ma
            ma_value = latest[callback_ma] if callback_ma in latest else latest['ma10']

            # 近期有上涨，然后回调到均线附近
            if len(df) >= 10:
                recent_peak = df['high'].tail(10).max()
                peak_idx = df['high'].tail(10).idxmax()
                peak_price = df.loc[peak_idx, 'high']

                callback_depth = (peak_price - latest['close']) / peak_price * 100

                if (0 < callback_depth <= config.max_callback_depth and 
                    latest['close'] >= ma_value * 0.98 and
                    latest['close'] <= ma_value * 1.02):
                    signals.append({
                        'type': 'callback',
                        'price': latest['close'],
                        'callback_depth': round(callback_depth, 2),
                        'ma': callback_ma,
                        'strength': '强' if callback_depth < 5 else '中'
                    })

        if signals:
            best = max(signals, key=lambda x: 3 if x['strength'] == '强' else 2 if x['strength'] == '中' else 1)
            return True, best['type'], best

        return False, "无信号", {}

    # ==================== 5. 主流程 ====================

    def select_stocks(self, trade_date: str, 
                      industry_config: IndustryFilterConfig = None,
                      stock_config: StockFilterConfig = None,
                      buy_config: BuySignalConfig = None,
                      top_industries: int = 5,
                      top_stocks_per_industry: int = 3) -> pd.DataFrame:
        """
        完整选股流程
        """
        if industry_config is None:
            industry_config = IndustryFilterConfig()
        if stock_config is None:
            stock_config = StockFilterConfig()
        if buy_config is None:
            buy_config = BuySignalConfig()

        print(f"\n{'='*60}")
        print(f"选股日期: {trade_date}")
        print(f"{'='*60}")

        # Step 1: 筛选行业
        print(f"\n[Step 1] 筛选二级行业...")
        industries = self.filter_industries(trade_date, industry_config)
        if industries.empty:
            print("[WARN] 没有符合条件的行业")
            return pd.DataFrame()

        industries = industries.head(top_industries)
        print(f"[OK] 筛选出 {len(industries)} 个行业:")
        for _, row in industries.iterrows():
            print(f"  - {row['industry_name']}: 趋势分={row['trend_score']}, 5日涨={row['ret_5d']}%, 资金={row['fund_flow']}亿")

        # Step 2-4: 行业内选龙头 -> 排雷 -> 择时
        all_results = []

        for _, ind in industries.iterrows():
            ind_code = ind['industry_code']
            ind_name = ind['industry_name']
            ind_kline = ind.get('kline')

            print(f"\n[Step 2] 行业 {ind_name} - 识别龙头...")

            # 获取成分股
            members = self.pro.index_member(index_code=ind_code)
            if members is None or members.empty:
                continue

            stock_scores = []
            for code in members['con_code']:
                score_info = self.calc_stock_leader_score(code, trade_date, ind_kline)
                if score_info:
                    stock_scores.append(score_info)

            if not stock_scores:
                continue

            stock_df = pd.DataFrame(stock_scores).sort_values('leader_score', ascending=False)
            stock_df = stock_df.head(stock_config.leader_top_n * 2)  # 多取一些用于排雷

            print(f"[OK] 龙头候选: {len(stock_df)} 只")

            # Step 3: 排雷过滤
            print(f"[Step 3] 排雷过滤...")
            passed_stocks = []
            for _, stock in stock_df.iterrows():
                passed, reason = self.risk_filter(stock['ts_code'], trade_date, stock_config)
                if passed:
                    passed_stocks.append(stock)
                else:
                    print(f"  ✗ {stock['ts_code']}: {reason}")

            if not passed_stocks:
                print(f"[WARN] 行业 {ind_name} 无股票通过排雷")
                continue

            passed_df = pd.DataFrame(passed_stocks).head(top_stocks_per_industry)
            print(f"[OK] 通过排雷: {len(passed_df)} 只")

            # Step 4: 择时信号
            print(f"[Step 4] 检查买入信号...")
            for _, stock in passed_df.iterrows():
                has_signal, signal_type, signal_detail = self.check_buy_signal(
                    stock['ts_code'], trade_date, buy_config
                )

                all_results.append({
                    'industry_code': ind_code,
                    'industry_name': ind_name,
                    'ts_code': stock['ts_code'],
                    'industry_trend_score': ind['trend_score'],
                    'industry_ret_5d': ind['ret_5d'],
                    'leader_score': stock['leader_score'],
                    'stock_ret_5d': stock['ret_5d'],
                    'stock_ret_20d': stock['ret_20d'],
                    'circ_mv': stock['circ_mv'],
                    'limit_count': stock['limit_count'],
                    'has_buy_signal': has_signal,
                    'signal_type': signal_type,
                    'signal_detail': json.dumps(signal_detail, ensure_ascii=False),
                    'trade_date': trade_date
                })

                status = "✓" if has_signal else "○"
                print(f"  {status} {stock['ts_code']}: 龙头分={stock['leader_score']}, 信号={signal_type}")

        result_df = pd.DataFrame(all_results)
        if result_df.empty:
            print("\n[WARN] 未选出任何标的")
            return result_df

        # 综合排序：行业趋势分*0.3 + 龙头分*0.4 + 信号 bonus*0.3
        result_df['signal_bonus'] = result_df['has_buy_signal'].apply(lambda x: 20 if x else 0)
        result_df['final_score'] = (
            result_df['industry_trend_score'] * 0.3 +
            result_df['leader_score'] * 0.4 +
            result_df['signal_bonus'] * 0.3
        )

        result_df = result_df.sort_values('final_score', ascending=False).reset_index(drop=True)

        print(f"\n{'='*60}")
        print(f"选股完成，共 {len(result_df)} 只标的")
        print(f"{'='*60}")

        return result_df

    def save_results(self, df: pd.DataFrame, filename: str = None):
        """保存选股结果"""
        if filename is None:
            filename = f"stock_select_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

        filepath = os.path.join(self.cache_dir, filename)
        df.to_csv(filepath, index=False, encoding='utf-8-sig')
        print(f"[OK] 结果已保存: {filepath}")
        return filepath


# ==================== 使用示例 ====================

if __name__ == "__main__":
    # 初始化
    TOKEN = "your_tushare_token_here"
    selector = StockSelector(token=TOKEN)

    # 配置参数
    ind_config = IndustryFilterConfig(
        fund_flow_days=5,
        fund_flow_rank_pct=0.3,
        min_return_5d=1.0,
        require_ma_bull=True
    )

    stock_config = StockFilterConfig(
        leader_top_n=5,
        min_circ_mv=30,
        max_circ_mv=600,
        min_avg_amount=8000,
        max_decline_from_high=12
    )

    buy_config = BuySignalConfig(
        strategy="both",
        breakout_volume_ratio=1.5,
        callback_to_ma="ma10",
        max_callback_depth=6
    )

    # 执行选股
    trade_date = "20241231"
    results = selector.select_stocks(
        trade_date=trade_date,
        industry_config=ind_config,
        stock_config=stock_config,
        buy_config=buy_config,
        top_industries=5,
        top_stocks_per_industry=3
    )

    # 查看结果
    print("\n选股结果:")
    print(results[['industry_name', 'ts_code', 'industry_trend_score', 
                   'leader_score', 'has_buy_signal', 'signal_type', 'final_score']].to_string())

    # 保存
    selector.save_results(results)
