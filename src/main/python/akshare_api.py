#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Akshare API 封装模块
用于替换原有的 eastmoney.com 直接 HTTP 调用

数据源：腾讯财经（分时数据、K线数据）
"""

import sys
import json
import argparse
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta, date

# 尝试导入 akshare
try:
    import akshare as ak
except ImportError:
    print(json.dumps({"error": "请先安装 akshare: pip install akshare"}, ensure_ascii=False))
    sys.exit(1)


def convert_secid_to_tx_symbol(secid: str) -> str:
    """
    将 secid 转换为腾讯财经的 symbol 格式
    
    secid 格式: "0.000001" (深市) 或 "1.600000" (沪市)
    腾讯格式: "sz000001" 或 "sh600000"
    """
    if "." in secid:
        mk, code = secid.split(".")
        # mk: 0=深市, 1=沪市
        if mk == "1" or code.startswith("6"):
            return f"sh{code}"
        else:
            return f"sz{code}"
    else:
        # 纯代码，根据首位判断
        if secid.startswith("6"):
            return f"sh{secid}"
        else:
            return f"sz{secid}"


def convert_secid_to_pure_code(secid: str) -> str:
    """将 secid 转换为纯数字代码"""
    if "." in secid:
        return secid.split(".")[-1]
    return secid


class AkshareAPI:
    """akshare 接口封装类"""
    
    @staticmethod
    def search_stock(keyword: str) -> List[Dict[str, Any]]:
        """搜索股票"""
        try:
            # 使用 akshare 的股票搜索功能
            result = ak.stock_search_profile_em(keyword=keyword)
            stocks = []
            for _, row in result.iterrows():
                stocks.append({
                    "Code": row.get("股票代码", ""),
                    "Name": row.get("股票名称", ""),
                    "Type": row.get("市场类型", ""),
                })
            return stocks
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_stock_realtime(secid: str) -> Dict[str, Any]:
        """获取股票实时行情"""
        try:
            code = convert_secid_to_pure_code(secid)
            df = ak.stock_zh_a_spot_em()
            stock_row = df[df["代码"] == code]
            if stock_row.empty:
                return {"error": "Stock not found"}
            
            row = stock_row.iloc[0]
            return {
                "code": code,
                "name": row.get("名称", ""),
                "zx": float(row.get("最新价", 0) or 0),
                "zs": float(row.get("昨收", 0) or 0),
                "zdf": float(row.get("涨跌幅", 0) or 0),
                "zdd": float(row.get("涨跌额", 0) or 0),
                "cjl": int(row.get("成交量", 0) or 0),
                "cje": float(row.get("成交额", 0) or 0),
                "zg": float(row.get("最高", 0) or 0),
                "zd": float(row.get("最低", 0) or 0),
                "jk": float(row.get("今开", 0) or 0),
                "lb": float(row.get("量比", 0) or 0),
                "hsl": float(row.get("换手率", 0) or 0),
                "syl": float(row.get("市盈率-动态", 0) or 0),
                "sjl": float(row.get("市净率", 0) or 0),
                "lt": float(row.get("流通市值", 0) or 0),
                "zsz": float(row.get("总市值", 0) or 0),
            }
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_kline_data(secid: str, period: str = "daily", adjust: str = "qfq") -> List[Dict[str, Any]]:
        """
        获取K线数据 - 使用腾讯财经数据源
        
        period: daily, weekly, monthly
        adjust: qfq-前复权, hfq-后复权, 空字符串-不复权
        """
        try:
            # 转换为腾讯 symbol 格式
            symbol = convert_secid_to_tx_symbol(secid)
            
            # 计算日期范围（默认获取1年数据）
            end_date = datetime.now().strftime("%Y%m%d")
            start_date = (datetime.now() - timedelta(days=365)).strftime("%Y%m%d")
            
            # 腾讯财经数据接口
            # 注意：腾讯接口日K线数据较完整，周/月线需要通过日K线聚合
            df = ak.stock_zh_a_hist_tx(symbol=symbol, start_date=start_date, end_date=end_date, adjust=adjust)
            
            if df.empty:
                return {"error": "No data available"}
            
            # 如果是周线或月线，需要对日K线进行聚合
            if period == "weekly":
                df = AkshareAPI._resample_to_weekly(df)
            elif period == "monthly":
                df = AkshareAPI._resample_to_monthly(df)
            
            klines = []
            for _, row in df.iterrows():
                # 确保日期是字符串格式
                date_val = row.get("date", "")
                if hasattr(date_val, 'strftime'):
                    date_str = date_val.strftime('%Y-%m-%d')
                else:
                    date_str = str(date_val)
                
                klines.append({
                    "date": date_str,
                    "kp": float(row.get("open", 0) or 0),
                    "sp": float(row.get("close", 0) or 0),
                    "zg": float(row.get("high", 0) or 0),
                    "zd": float(row.get("low", 0) or 0),
                    "cjl": int(row.get("volume", 0) or 0),
                    "cje": float(row.get("amount", 0) or 0) if "amount" in row else 0,
                    "zdf": float(row.get("change_pct", 0) or 0) if "change_pct" in row else 0,
                    "zde": float(row.get("change", 0) or 0) if "change" in row else 0,
                    "hsl": 0,  # 腾讯接口不返回换手率
                })
            return klines
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def _resample_to_weekly(df):
        """将日K线聚合为周K线"""
        df = df.copy()
        df['date'] = pd.to_datetime(df['date'])
        df.set_index('date', inplace=True)
        
        weekly = df.resample('W').agg({
            'open': 'first',
            'high': 'max',
            'low': 'min',
            'close': 'last',
            'volume': 'sum',
            'amount': 'sum' if 'amount' in df.columns else 'sum'
        })
        weekly.reset_index(inplace=True)
        weekly['date'] = weekly['date'].dt.strftime('%Y-%m-%d')
        return weekly
    
    @staticmethod
    def _resample_to_monthly(df):
        """将日K线聚合为月K线"""
        df = df.copy()
        df['date'] = pd.to_datetime(df['date'])
        df.set_index('date', inplace=True)
        
        monthly = df.resample('ME').agg({
            'open': 'first',
            'high': 'max',
            'low': 'min',
            'close': 'last',
            'volume': 'sum',
            'amount': 'sum' if 'amount' in df.columns else 'sum'
        })
        monthly.reset_index(inplace=True)
        monthly['date'] = monthly['date'].dt.strftime('%Y-%m-%d')
        return monthly
    
    @staticmethod
    def get_stock_trend(secid: str) -> List[Dict[str, Any]]:
        """
        获取分时走势数据 - 使用腾讯财经数据源
        
        使用腾讯财经的分笔数据接口
        """
        try:
            # 转换为腾讯 symbol 格式
            symbol = convert_secid_to_tx_symbol(secid)
            
            # 获取腾讯分笔数据（当日分时）
            df = ak.stock_zh_a_tick_tx_js(symbol=symbol)
            
            if df.empty:
                return {"error": "No trend data available"}
            
            trends = []
            prev_price = None
            
            for _, row in df.iterrows():
                price = float(row.get("成交价格", 0) or 0)
                vol = int(row.get("成交量", 0) or 0)
                time_str = row.get("成交时间", "")
                
                # 判断涨跌：与上一笔价格比较
                up = 0
                if prev_price is not None:
                    up = 1 if price >= prev_price else -1
                
                trends.append({
                    "datetime": time_str,
                    "current": price,
                    "last": prev_price if prev_price is not None else price,
                    "vol": vol,
                    "up": up,
                })
                prev_price = price
            
            return trends
        except Exception as e:
            # 如果腾讯接口失败，尝试使用 163 接口作为备用
            try:
                return AkshareAPI._get_trend_from_163(secid)
            except:
                return {"error": str(e)}
    
    @staticmethod
    def _get_trend_from_163(secid: str) -> List[Dict[str, Any]]:
        """备用：从 163 获取分时数据"""
        code = convert_secid_to_pure_code(secid)
        df = ak.stock_zh_a_tick_163(symbol=code)
        
        trends = []
        prev_price = None
        
        for _, row in df.iterrows():
            price = float(row.get("价格", 0) or 0)
            vol = int(row.get("成交量", 0) or 0)
            time_str = row.get("时间", "")
            
            up = 0
            if prev_price is not None:
                up = 1 if price >= prev_price else -1
            
            trends.append({
                "datetime": time_str,
                "current": price,
                "last": prev_price if prev_price is not None else price,
                "vol": vol,
                "up": up,
            })
            prev_price = price
        
        return trends
    
    @staticmethod
    def get_sector_boards(bk_type: str = "industry") -> List[Dict[str, Any]]:
        """
        获取板块列表
        bk_type: industry-行业板块, concept-概念板块
        """
        try:
            if bk_type == "industry":
                df = ak.stock_board_industry_name_em()
            else:
                df = ak.stock_board_concept_name_em()
            
            boards = []
            for _, row in df.iterrows():
                boards.append({
                    "code": row.get("板块代码", ""),
                    "name": row.get("板块名称", ""),
                    "zdf": float(row.get("涨跌幅", 0) or 0),
                    "zsz": float(row.get("总市值", 0) or 0),
                    "cje": float(row.get("成交额", 0) or 0),
                })
            return boards
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_limit_up_stocks(date: Optional[str] = None) -> List[Dict[str, Any]]:
        """获取涨停股票列表"""
        try:
            if date is None:
                date = datetime.now().strftime("%Y%m%d")
            df = ak.stock_zt_pool_em(date=date)
            
            stocks = []
            for _, row in df.iterrows():
                stocks.append({
                    "code": row.get("代码", ""),
                    "name": row.get("名称", ""),
                    "zx": float(row.get("最新价", 0) or 0),
                    "zdf": float(row.get("涨跌幅", 0) or 0),
                    "lbc": int(row.get("连板数", 0) or 0),
                    "fbt": row.get("首次封板时间", ""),
                    "lbt": row.get("最后封板时间", ""),
                    "zbc": int(row.get("炸板次数", 0) or 0),
                    "fbf": float(row.get("封板资金", 0) or 0),
                })
            return stocks
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_limit_down_stocks(date: Optional[str] = None) -> List[Dict[str, Any]]:
        """获取跌停股票列表"""
        try:
            if date is None:
                date = datetime.now().strftime("%Y%m%d")
            df = ak.stock_zt_pool_dtgc_em(date=date)
            
            stocks = []
            for _, row in df.iterrows():
                stocks.append({
                    "code": row.get("代码", ""),
                    "name": row.get("名称", ""),
                    "zx": float(row.get("最新价", 0) or 0),
                    "zdf": float(row.get("涨跌幅", 0) or 0),
                    "dtdays": int(row.get("连续跌停", 0) or 0),
                })
            return stocks
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_stock_company_info(code: str) -> Dict[str, Any]:
        """获取公司概况"""
        try:
            df = ak.stock_individual_info_em(symbol=code)
            
            info = {}
            for _, row in df.iterrows():
                key = row.get("item", "")
                value = row.get("value", "")
                info[key] = value
            
            return {
                "gsjs": info.get("公司简介", ""),
                "sshy": info.get("所属行业", ""),
                "dsz": info.get("董事长", ""),
                "zcdz": info.get("注册地址", ""),
                "clrq": info.get("成立日期", ""),
                "ssrq": info.get("上市日期", ""),
            }
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_stock_news(code: str, page: int = 1, page_size: int = 20) -> List[Dict[str, Any]]:
        """获取个股新闻"""
        try:
            df = ak.stock_news_em(symbol=code)
            
            news_list = []
            start_idx = (page - 1) * page_size
            end_idx = start_idx + page_size
            
            for idx in range(start_idx, min(end_idx, len(df))):
                row = df.iloc[idx]
                news_list.append({
                    "title": row.get("新闻标题", ""),
                    "content": row.get("新闻内容", ""),
                    "time": row.get("发布时间", ""),
                    "source": row.get("新闻来源", ""),
                })
            return news_list
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_research_reports(code: str) -> List[Dict[str, Any]]:
        """获取个股研报"""
        try:
            df = ak.stock_research_report_em(symbol=code)
            
            reports = []
            for _, row in df.iterrows():
                reports.append({
                    "title": row.get("报告标题", ""),
                    "author": row.get("作者", ""),
                    "source": row.get("机构", ""),
                    "time": row.get("日期", ""),
                    "rating": row.get("评级", ""),
                })
            return reports
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_money_flow(code: str) -> Dict[str, Any]:
        """获取资金流向"""
        try:
            df = ak.stock_individual_fund_flow(stock=code)
            
            if df.empty:
                return {"error": "No data"}
            
            row = df.iloc[0]
            return {
                "main_in": float(row.get("主力净流入", 0) or 0),
                "small_in": float(row.get("小单净流入", 0) or 0),
                "medium_in": float(row.get("中单净流入", 0) or 0),
                "big_in": float(row.get("大单净流入", 0) or 0),
                "super_big_in": float(row.get("超大单净流入", 0) or 0),
            }
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_billboard_data(date: Optional[str] = None) -> List[Dict[str, Any]]:
        """获取龙虎榜数据"""
        try:
            if date is None:
                date = datetime.now().strftime("%Y%m%d")
            df = ak.stock_lhb_detail_daily_sina(start_date=date, end_date=date)
            
            stocks = []
            for _, row in df.iterrows():
                stocks.append({
                    "code": row.get("代码", ""),
                    "name": row.get("名称", ""),
                    "reason": row.get("上榜原因", ""),
                    "net_buy": float(row.get("净买额", 0) or 0),
                })
            return stocks
        except Exception as e:
            return {"error": str(e)}


# 导入 pandas 用于数据聚合
try:
    import pandas as pd
except ImportError:
    pd = None


class DateTimeEncoder(json.JSONEncoder):
    """自定义 JSON 编码器，处理日期和时间类型"""
    def default(self, obj):
        # 处理 pandas Timestamp
        if hasattr(obj, 'strftime'):
            return obj.strftime('%Y-%m-%d')
        # 处理 datetime.date
        if isinstance(obj, date):
            return obj.strftime('%Y-%m-%d')
        # 处理 datetime.datetime
        if isinstance(obj, datetime):
            return obj.strftime('%Y-%m-%d %H:%M:%S')
        # 处理 numpy 类型
        if hasattr(obj, 'item'):
            return obj.item()
        # 默认处理
        return super().default(obj)


def main():
    parser = argparse.ArgumentParser(description="Akshare API CLI")
    parser.add_argument("method", help="方法名")
    parser.add_argument("--params", "-p", help="JSON格式的参数", default="{}")
    
    args = parser.parse_args()
    
    # 解析参数
    try:
        params = json.loads(args.params)
    except json.JSONDecodeError:
        print(json.dumps({"error": "Invalid JSON params"}, ensure_ascii=False))
        sys.exit(1)
    
    # 调用对应方法
    api = AkshareAPI()
    method = getattr(api, args.method, None)
    
    if method is None:
        print(json.dumps({"error": f"Method {args.method} not found"}, ensure_ascii=False))
        sys.exit(1)
    
    try:
        result = method(**params)
        # 使用自定义编码器处理日期类型
        print(json.dumps(result, ensure_ascii=False, cls=DateTimeEncoder))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
