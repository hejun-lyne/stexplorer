#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Tushare API 封装模块
用于提供 tushare 数据源的接入

需要设置 TUSHARE_TOKEN 环境变量或在调用时传入 token
"""

import sys
import json
import argparse
import os
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta, date

# 尝试导入 tushare
try:
    import tushare as ts
except ImportError:
    print(json.dumps({"error": "请先安装 tushare: pip install tushare"}, ensure_ascii=False))
    sys.exit(1)

# 尝试导入 pandas
try:
    import pandas as pd
except ImportError:
    pd = None

# 尝试导入 requests
try:
    import requests
except ImportError:
    requests = None


def _get_pro_api(token: Optional[str] = None):
    """获取 tushare pro 接口实例"""
    if token:
        ts.set_token(token)
        return ts.pro_api(token)
    
    # 尝试从环境变量获取
    env_token = os.environ.get('TUSHARE_TOKEN', '')
    if env_token:
        ts.set_token(env_token)
        return ts.pro_api(env_token)
    
    # 尝试使用默认的 ts 接口（旧版，不需要 token）
    return None


def convert_secid_to_ts_code(secid: str) -> str:
    """
    将 secid 转换为 tushare 的 ts_code 格式
    
    secid 格式: "0.000001" (深市) 或 "1.600000" (沪市)
    tushare 格式: "000001.SZ" 或 "600000.SH"
    """
    if "." in secid:
        mk, code = secid.split(".")
        # mk: 0=深市, 1=沪市
        if mk == "1" or code.startswith("6"):
            return f"{code}.SH"
        else:
            return f"{code}.SZ"
    else:
        # 纯代码，根据首位判断
        if secid.startswith("6"):
            return f"{secid}.SH"
        else:
            return f"{secid}.SZ"


def convert_secid_to_pure_code(secid: str) -> str:
    """将 secid 转换为纯数字代码"""
    if "." in secid:
        return secid.split(".")[-1]
    return secid


def is_board_code(secid: str) -> bool:
    """判断是否为板块代码"""
    if secid.startswith("90."):
        return True
    code = convert_secid_to_pure_code(secid)
    return code.startswith("BK") or code.startswith("88") or code.startswith("3")


def _standardize_date(d: Any) -> str:
    """标准化日期格式为 YYYY-MM-DD"""
    if hasattr(d, 'strftime'):
        return d.strftime('%Y-%m-%d')
    if isinstance(d, date):
        return d.strftime('%Y-%m-%d')
    if isinstance(d, datetime):
        return d.strftime('%Y-%m-%d')
    s = str(d)
    # 处理 YYYYMMDD 格式
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return s


class TushareAPI:
    """tushare 接口封装类"""
    
    def __init__(self, token: Optional[str] = None):
        self.pro = _get_pro_api(token)
        self.token = token or os.environ.get('TUSHARE_TOKEN', '')
    
    @staticmethod
    def get_trade_dates(year: Optional[int] = None) -> List[str]:
        """
        获取全年交易日列表
        
        参数:
            year: 年份，如 2026；不传则默认当年
        
        返回:
            该年份所有交易日的日期字符串列表，格式 "YYYY-MM-DD"
        """
        try:
            api = _get_pro_api()
            if api is None:
                # 没有 token，使用旧版接口或手动计算
                return {"error": "需要设置 TUSHARE_TOKEN 才能获取交易日历"}
            
            target_year = year if year is not None else datetime.now().year
            start_date = f"{target_year}0101"
            end_date = f"{target_year}1231"
            
            df = api.trade_cal(exchange='SSE', start_date=start_date, end_date=end_date, is_open='1')
            if df is None or df.empty:
                return {"error": "No trade date data available"}
            
            df['cal_date'] = pd.to_datetime(df['cal_date'])
            dates = df['cal_date'].dt.strftime('%Y-%m-%d').tolist()
            return dates
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def search_stock(keyword: str) -> List[Dict[str, Any]]:
        """搜索股票"""
        try:
            api = _get_pro_api()
            if api is None:
                # 使用旧版接口
                df = ts.get_stock_basics()
                if df is None or df.empty:
                    return {"error": "No data"}
                
                stocks = []
                for code, row in df.iterrows():
                    name = row.get('name', '')
                    if keyword in str(code) or keyword in str(name):
                        stocks.append({
                            "Code": str(code),
                            "Name": str(name),
                            "Type": "A股",
                        })
                return stocks[:20]
            
            # 使用 pro 接口
            df = api.stock_basic(exchange='', list_status='L', fields='ts_code,symbol,name,area,industry,list_date')
            if df is None or df.empty:
                return {"error": "No data"}
            
            stocks = []
            for _, row in df.iterrows():
                name = row.get('name', '')
                symbol = row.get('symbol', '')
                if keyword in str(symbol) or keyword in str(name):
                    stocks.append({
                        "Code": str(symbol),
                        "Name": str(name),
                        "Type": row.get('area', ''),
                    })
            return stocks[:20]
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_stock_realtime(secid: str) -> Dict[str, Any]:
        """获取股票实时行情"""
        try:
            code = convert_secid_to_pure_code(secid)
            
            # 使用 tushare 实时行情接口（旧版，不需要 token）
            df = ts.get_realtime_quotes(code)
            if df is None or df.empty:
                return {"error": "Stock not found"}
            
            row = df.iloc[0]
            # 转换数值
            def to_float(val):
                try:
                    return float(val) if val else 0
                except (ValueError, TypeError):
                    return 0
            
            price = to_float(row.get('price', 0))
            pre_close = to_float(row.get('pre_close', 0))
            open_price = to_float(row.get('open', 0))
            high = to_float(row.get('high', 0))
            low = to_float(row.get('low', 0))
            volume = to_float(row.get('volume', 0))
            amount = to_float(row.get('amount', 0))
            
            zdd = price - pre_close if pre_close > 0 else 0
            zdf = (zdd / pre_close * 100) if pre_close > 0 else 0
            
            return {
                "code": code,
                "name": str(row.get('name', '')),
                "zx": price,
                "zs": pre_close,
                "zdf": round(zdf, 2),
                "zdd": round(zdd, 2),
                "cjl": int(volume),
                "cje": round(amount / 10000, 2),  # 转换为万元
                "zg": high,
                "zd": low,
                "jk": open_price,
                "lb": 0,
                "hsl": 0,
                "syl": 0,
                "sjl": 0,
                "lt": 0,
                "zsz": 0,
            }
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_kline_data(secid: str, period: str = "daily", adjust: str = "qfq") -> List[Dict[str, Any]]:
        """
        获取K线数据
        
        period: daily, weekly, monthly
        adjust: qfq-前复权, hfq-后复权, 空字符串-不复权
        """
        try:
            # 板块代码暂不支持
            if is_board_code(secid):
                return {"error": "tushare 暂不支持板块K线数据"}
            
            ts_code = convert_secid_to_ts_code(secid)
            code = convert_secid_to_pure_code(secid)
            
            # 计算日期范围（默认获取2年数据）
            end_date = datetime.now().strftime("%Y%m%d")
            start_date = (datetime.now() - timedelta(days=730)).strftime("%Y%m%d")
            
            api = _get_pro_api()
            if api is None:
                # 使用旧版接口
                freq = 'D' if period == 'daily' else ('W' if period == 'weekly' else 'M')
                df = ts.get_k_data(code, ktype=freq, autype='qfq' if adjust == 'qfq' else ('hfq' if adjust == 'hfq' else None), start=start_date, end=end_date)
            else:
                # 使用 pro 接口
                freq_map = {
                    'daily': 'D',
                    'weekly': 'W',
                    'monthly': 'M',
                }
                freq = freq_map.get(period, 'D')
                
                # pro 接口需要分别调用 daily/weekly/monthly
                if period == 'daily':
                    df = api.daily(ts_code=ts_code, start_date=start_date, end_date=end_date)
                elif period == 'weekly':
                    df = api.weekly(ts_code=ts_code, start_date=start_date, end_date=end_date)
                elif period == 'monthly':
                    df = api.monthly(ts_code=ts_code, start_date=start_date, end_date=end_date)
                else:
                    df = api.daily(ts_code=ts_code, start_date=start_date, end_date=end_date)
                
                # 处理复权（pro 接口需要单独调用复权因子）
                if adjust in ('qfq', 'hfq') and df is not None and not df.empty:
                    try:
                        adj_df = api.adj_factor(ts_code=ts_code, start_date=start_date, end_date=end_date)
                        if adj_df is not None and not adj_df.empty:
                            df = df.merge(adj_df[['trade_date', 'adj_factor']], on='trade_date', how='left')
                            base_factor = df['adj_factor'].iloc[-1] if adjust == 'qfq' else df['adj_factor'].iloc[0]
                            for col in ['open', 'high', 'low', 'close']:
                                df[col] = df[col] * df['adj_factor'] / base_factor
                    except Exception:
                        pass
            
            if df is None or df.empty:
                return {"error": "No data available"}
            
            # 列名标准化
            col_map = {
                'trade_date': 'date',
                'open': 'open',
                'high': 'high',
                'low': 'low',
                'close': 'close',
                'vol': 'volume',
                'amount': 'amount',
                'pct_chg': 'change_pct',
                'change': 'change',
            }
            
            # 旧版接口列名
            old_col_map = {
                'date': 'date',
                'open': 'open',
                'high': 'high',
                'low': 'low',
                'close': 'close',
                'volume': 'volume',
                'amount': 'amount',
            }
            
            klines = []
            for _, row in df.iterrows():
                # 判断列名体系
                if 'trade_date' in row:
                    date_val = row.get('trade_date', '')
                elif 'date' in row:
                    date_val = row.get('date', '')
                else:
                    date_val = ''
                
                date_str = _standardize_date(date_val)
                
                open_p = float(row.get('open', 0) or 0)
                close_p = float(row.get('close', 0) or 0)
                cjl = int(float(row.get('vol', row.get('volume', 0)) or 0))
                
                klines.append({
                    "date": date_str,
                    "kp": open_p,
                    "sp": close_p,
                    "zg": float(row.get('high', 0) or 0),
                    "zd": float(row.get('low', 0) or 0),
                    "cjl": cjl,
                    "cje": round(float(row.get('amount', 0) or 0), 2),
                    "zdf": float(row.get('pct_chg', row.get('change_pct', 0)) or 0),
                    "zde": float(row.get('change', 0) or 0),
                    "hsl": 0,
                })
            
            return klines
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_stock_trend(secid: str) -> List[Dict[str, Any]]:
        """
        获取分时走势数据
        
        tushare 没有免费的分时数据接口，使用新浪财经分时代用
        """
        try:
            code = convert_secid_to_pure_code(secid)
            symbol = convert_secid_to_ts_code(secid)
            
            # 使用 tushare 的 tick 数据（需要权限）或新浪财经
            # 这里使用新浪财经的分时数据
            if requests is None:
                return {"error": "requests 库未安装"}
            
            # 新浪财经分时数据接口
            if code.startswith('6'):
                sina_code = f"sh{code}"
            else:
                sina_code = f"sz{code}"
            
            url = f"https://quotes.sina.cn/cn/api/quotes.php?symbol={sina_code}&type=min"
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://finance.sina.com.cn",
            }
            
            response = requests.get(url, headers=headers, timeout=30)
            response.raise_for_status()
            
            # 解析返回的数据
            text = response.text.strip()
            # 新浪返回的是 JSONP 格式
            if text.startswith('var'):
                # 尝试提取 JSON 数据
                start = text.find('{')
                end = text.rfind('}')
                if start != -1 and end != -1:
                    data = json.loads(text[start:end+1])
                else:
                    return {"error": "无法解析新浪数据"}
            else:
                try:
                    data = json.loads(text)
                except json.JSONDecodeError:
                    return {"error": "无法解析新浪数据"}
            
            # 提取分钟数据
            today = datetime.now().strftime('%Y-%m-%d')
            trends = []
            
            # 新浪数据格式可能不同，这里做通用处理
            records = data.get('data', data.get('min_data', data.get('items', [])))
            if isinstance(records, dict):
                records = records.get(sina_code, [])
            
            prev_close = None
            for item in records:
                if isinstance(item, list) and len(item) >= 5:
                    time_str = str(item[0])
                    price = float(item[1]) if item[1] else 0
                    vol = int(float(item[4])) if len(item) > 4 else 0
                elif isinstance(item, dict):
                    time_str = str(item.get('time', item.get('datetime', '')))
                    price = float(item.get('price', item.get('close', 0)) or 0)
                    vol = int(float(item.get('volume', item.get('vol', 0)) or 0))
                else:
                    continue
                
                if price <= 0:
                    continue
                
                # 格式化时间
                if len(time_str) == 5:
                    datetime_str = f"{today} {time_str}"
                elif ' ' in time_str:
                    datetime_str = time_str
                else:
                    datetime_str = f"{today} {time_str[:2]}:{time_str[2:4]}"
                
                last = prev_close if prev_close is not None else price
                up = 1 if price >= last else -1
                
                trends.append({
                    "datetime": datetime_str,
                    "current": price,
                    "last": last,
                    "vol": vol,
                    "average": price,
                    "up": up,
                })
                prev_close = price
            
            if not trends:
                # 如果新浪接口失败，返回空数据
                return {"error": "分时数据暂不可用"}
            
            return trends
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_sector_boards(bk_type: str = "industry") -> List[Dict[str, Any]]:
        """
        获取板块列表
        
        bk_type: industry-行业板块, concept-概念板块
        """
        try:
            api = _get_pro_api()
            if api is None:
                return {"error": "需要设置 TUSHARE_TOKEN 才能获取板块数据"}
            
            if bk_type == "industry":
                # 使用 tushare 行业分类
                df = api.stock_basic(exchange='', list_status='L', fields='ts_code,symbol,name,industry')
                if df is None or df.empty:
                    return {"error": "No data"}
                
                # 按行业聚合
                industry_map = {}
                for _, row in df.iterrows():
                    ind = row.get('industry', '')
                    if not ind:
                        continue
                    if ind not in industry_map:
                        industry_map[ind] = {"name": ind, "count": 0}
                    industry_map[ind]["count"] += 1
                
                boards = []
                for name, info in industry_map.items():
                    boards.append({
                        "code": name,
                        "name": name,
                        "zdf": 0,
                        "zsz": 0,
                        "cje": 0,
                    })
                return boards
            else:
                # 概念板块需要 concept 接口（需要高权限）
                return {"error": "tushare 概念板块数据需要高权限"}
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_board_stocks(secid: str, count: int = 20) -> Dict[str, Any]:
        """
        获取板块成分股
        
        secid: 板块代码
        count: 返回数量限制
        """
        try:
            api = _get_pro_api()
            if api is None:
                return {"error": "需要设置 TUSHARE_TOKEN 才能获取板块成分股"}
            
            code = convert_secid_to_pure_code(secid)
            
            # 获取所有股票的基本信息，按行业筛选
            df = api.stock_basic(exchange='', list_status='L', fields='ts_code,symbol,name,industry,area')
            if df is None or df.empty:
                return {"total": 0, "stocks": []}
            
            # 按行业名称筛选（板块代码即行业名称）
            filtered = df[df['industry'] == code]
            if filtered is None or filtered.empty:
                return {"total": 0, "stocks": []}
            
            stocks = []
            for _, row in filtered.iterrows():
                stock_code = str(row.get("symbol", ""))
                if not stock_code:
                    continue
                market = 1 if stock_code.startswith("6") else 0
                
                stocks.append({
                    "code": stock_code,
                    "name": str(row.get("name", "")),
                    "secid": f"{market}.{stock_code}",
                    "zx": 0,
                    "zdf": 0,
                    "zdd": 0,
                    "cjl": 0,
                    "cje": 0,
                    "zf": 0,
                    "zg": 0,
                    "zd": 0,
                    "jk": 0,
                    "zs": 0,
                    "lb": 0,
                    "hsl": 0,
                    "syl": 0,
                    "sjl": 0,
                    "sz": 0,
                    "lt": 0,
                    "cm5": 0,
                    "cd60": 0,
                    "cy1": 0,
                    "cs": 0,
                })
            
            if count > 0 and len(stocks) > count:
                stocks = stocks[:count]
            
            return {"total": len(filtered), "stocks": stocks}
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_limit_up_stocks(date: Optional[str] = None) -> List[Dict[str, Any]]:
        """获取涨停股票列表"""
        try:
            if date is None:
                date = datetime.now().strftime("%Y%m%d")
            else:
                date = date.replace("-", "")
            
            api = _get_pro_api()
            if api is None:
                return {"error": "需要设置 TUSHARE_TOKEN 才能获取涨停数据"}
            
            df = api.limit_list(trade_date=date)
            if df is None or df.empty:
                return {"error": "No data available"}
            
            stocks = []
            for _, row in df.iterrows():
                if str(row.get('limit', '')) == 'U':  # U 表示涨停
                    stocks.append({
                        "code": str(row.get("ts_code", "")).split('.')[0],
                        "name": str(row.get("name", "")),
                        "zx": float(row.get("close", 0) or 0),
                        "zdf": float(row.get("pct_chg", 0) or 0),
                        "lbc": 0,
                        "fbt": "",
                        "lbt": "",
                        "zbc": 0,
                        "fbf": 0,
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
            else:
                date = date.replace("-", "")
            
            api = _get_pro_api()
            if api is None:
                return {"error": "需要设置 TUSHARE_TOKEN 才能获取跌停数据"}
            
            df = api.limit_list(trade_date=date)
            if df is None or df.empty:
                return {"error": "No data available"}
            
            stocks = []
            for _, row in df.iterrows():
                if str(row.get('limit', '')) == 'D':  # D 表示跌停
                    stocks.append({
                        "code": str(row.get("ts_code", "")).split('.')[0],
                        "name": str(row.get("name", "")),
                        "zx": float(row.get("close", 0) or 0),
                        "zdf": float(row.get("pct_chg", 0) or 0),
                        "dtdays": 0,
                    })
            return stocks
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_stock_company_info(code: str) -> Dict[str, Any]:
        """获取公司概况"""
        try:
            api = _get_pro_api()
            if api is None:
                # 使用旧版接口
                df = ts.get_stock_basics()
                if df is None or df.empty:
                    return {"error": "No data"}
                
                row = df.loc[code] if code in df.index else None
                if row is None:
                    return {"error": "Stock not found"}
                
                return {
                    "gsjs": "",
                    "sshy": str(row.get("industry", "")),
                    "dsz": "",
                    "zcdz": "",
                    "clrq": str(row.get("timeToMarket", "")),
                    "ssrq": str(row.get("timeToMarket", "")),
                }
            
            # 使用 pro 接口
            ts_code = f"{code}.SH" if code.startswith('6') else f"{code}.SZ"
            df = api.stock_company(ts_code=ts_code, fields='ts_code,exchange,chairman,manager,secretary,reg_capital,setup_date,province,city,introduction,website,email,office,employees,main_business,business_scope')
            if df is None or df.empty:
                return {"error": "No data"}
            
            row = df.iloc[0]
            return {
                "gsjs": str(row.get("introduction", "")),
                "sshy": "",
                "dsz": str(row.get("chairman", "")),
                "zcdz": str(row.get("office", "")),
                "clrq": str(row.get("setup_date", "")),
                "ssrq": "",
            }
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_stock_news(code: str, page: int = 1, page_size: int = 20) -> List[Dict[str, Any]]:
        """获取个股新闻"""
        try:
            # tushare 没有新闻接口，返回空列表
            return []
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_research_reports(code: str) -> List[Dict[str, Any]]:
        """获取个股研报"""
        try:
            api = _get_pro_api()
            if api is None:
                return {"error": "需要设置 TUSHARE_TOKEN 才能获取研报数据"}
            
            ts_code = f"{code}.SH" if code.startswith('6') else f"{code}.SZ"
            df = api.report_rc(ts_code=ts_code)
            if df is None or df.empty:
                return []
            
            reports = []
            for _, row in df.iterrows():
                reports.append({
                    "title": str(row.get("report_title", "")),
                    "author": str(row.get("author_name", "")),
                    "source": str(row.get("org_name", "")),
                    "time": str(row.get("report_date", "")),
                    "rating": str(row.get("em_rating_name", "")),
                })
            return reports
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_money_flow(code: str) -> Dict[str, Any]:
        """获取资金流向"""
        try:
            api = _get_pro_api()
            if api is None:
                return {"error": "需要设置 TUSHARE_TOKEN 才能获取资金流向数据"}
            
            ts_code = f"{code}.SH" if code.startswith('6') else f"{code}.SZ"
            # 获取最近一个交易日的资金流向
            today = datetime.now().strftime('%Y%m%d')
            df = api.moneyflow(ts_code=ts_code, start_date=today, end_date=today)
            if df is None or df.empty:
                return {"error": "No data"}
            
            row = df.iloc[0]
            return {
                "main_in": float(row.get("net_mf", 0) or 0),
                "small_in": float(row.get("net_mf_sm", 0) or 0),
                "medium_in": float(row.get("net_mf_md", 0) or 0),
                "big_in": float(row.get("net_mf_lg", 0) or 0),
                "super_big_in": float(row.get("net_mf_huge", 0) or 0),
            }
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_stock_fundamental(code: str) -> Dict[str, Any]:
        """获取股票基本面数据（财务指标）"""
        try:
            api = _get_pro_api()
            if api is None:
                return {"error": "需要设置 TUSHARE_TOKEN 才能获取基本面数据"}
            
            ts_code = f"{code}.SH" if code.startswith('6') else f"{code}.SZ"
            df = api.fina_indicator(ts_code=ts_code, limit=1)
            if df is None or df.empty:
                return {"error": "No data available"}
            
            row = df.iloc[0]
            return {
                "code": code,
                "report_date": str(row.get("ann_date", "")),
                "roe": float(row.get("roe", 0) or 0),
                "roe_diluted": float(row.get("roe_diluted", 0) or 0),
                "net_profit": float(row.get("profit_dedt", 0) or 0),
                "net_profit_growth": float(row.get("profit_dedt_yoy", 0) or 0),
                "revenue": float(row.get("revenue", 0) or 0),
                "revenue_growth": float(row.get("revenue_yoy", 0) or 0),
                "gross_margin": float(row.get("grossprofit_margin", 0) or 0),
                "net_margin": float(row.get("netprofit_margin", 0) or 0),
                "eps": float(row.get("eps", 0) or 0),
                "bps": float(row.get("bps", 0) or 0),
                "debt_ratio": float(row.get("debt_to_assets", 0) or 0),
                "current_ratio": float(row.get("current_ratio", 0) or 0),
                "quick_ratio": float(row.get("quick_ratio", 0) or 0),
                "inventory_turnover": float(row.get("inv_turn", 0) or 0),
                "receivable_turnover": float(row.get("ar_turn", 0) or 0),
                "operating_cash_flow": float(row.get("ocfps", 0) or 0),
                "investing_cash_flow": 0,
                "financing_cash_flow": 0,
            }
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def get_stock_finance_data(code: str) -> Dict[str, Any]:
        """获取股票财务数据（三大报表摘要）"""
        try:
            api = _get_pro_api()
            if api is None:
                return {"error": "需要设置 TUSHARE_TOKEN 才能获取财务数据"}
            
            ts_code = f"{code}.SH" if code.startswith('6') else f"{code}.SZ"
            
            # 资产负债表
            balance = {}
            try:
                balance_df = api.balancesheet(ts_code=ts_code, limit=1)
                if balance_df is not None and not balance_df.empty:
                    row = balance_df.iloc[0]
                    balance = {
                        "report_date": str(row.get("ann_date", "")),
                        "total_assets": float(row.get("total_assets", 0) or 0),
                        "total_liabilities": float(row.get("total_liab", 0) or 0),
                        "total_equity": float(row.get("total_hldr_eqy_exc_min_int", 0) or 0),
                        "monetary_funds": float(row.get("money_cap", 0) or 0),
                        "accounts_receivable": float(row.get("accounts_receiv", 0) or 0),
                        "inventory": float(row.get("inventories", 0) or 0),
                        "goodwill": float(row.get("goodwill", 0) or 0),
                    }
            except Exception:
                pass
            
            # 利润表
            profit = {}
            try:
                profit_df = api.income(ts_code=ts_code, limit=1)
                if profit_df is not None and not profit_df.empty:
                    row = profit_df.iloc[0]
                    profit = {
                        "report_date": str(row.get("ann_date", "")),
                        "total_revenue": float(row.get("total_revenue", 0) or 0),
                        "operating_revenue": float(row.get("revenue", 0) or 0),
                        "operating_cost": float(row.get("oper_cost", 0) or 0),
                        "operating_profit": float(row.get("operate_profit", 0) or 0),
                        "total_profit": float(row.get("total_profit", 0) or 0),
                        "net_profit": float(row.get("n_income", 0) or 0),
                        "rd_expense": 0,
                        "sales_expense": float(row.get("sell_exp", 0) or 0),
                        "management_expense": float(row.get("admin_exp", 0) or 0),
                        "financial_expense": float(row.get("fin_exp", 0) or 0),
                    }
            except Exception:
                pass
            
            # 现金流量表
            cash = {}
            try:
                cash_df = api.cashflow(ts_code=ts_code, limit=1)
                if cash_df is not None and not cash_df.empty:
                    row = cash_df.iloc[0]
                    cash = {
                        "report_date": str(row.get("ann_date", "")),
                        "net_operating_cash_flow": float(row.get("n_cashflow_act", 0) or 0),
                        "net_investing_cash_flow": float(row.get("n_cashflow_inv_act", 0) or 0),
                        "net_financing_cash_flow": float(row.get("n_cash_flows_fnc_act", 0) or 0),
                        "cash_equivalent_increase": float(row.get("n_incr_cash_cash_equ", 0) or 0),
                        "ending_cash": float(row.get("c_cash_equ_end_period", 0) or 0),
                    }
            except Exception:
                pass
            
            return {
                "code": code,
                "balance_sheet": balance,
                "profit_statement": profit,
                "cash_flow_statement": cash,
            }
        except Exception as e:
            return {"error": str(e)}


class DateTimeEncoder(json.JSONEncoder):
    """自定义 JSON 编码器，处理日期和时间类型"""
    def default(self, obj):
        if hasattr(obj, 'strftime'):
            return obj.strftime('%Y-%m-%d')
        if isinstance(obj, date):
            return obj.strftime('%Y-%m-%d')
        if isinstance(obj, datetime):
            return obj.strftime('%Y-%m-%d %H:%M:%S')
        if hasattr(obj, 'item'):
            return obj.item()
        return super().default(obj)


def main():
    parser = argparse.ArgumentParser(description="Tushare API CLI")
    parser.add_argument("method", help="方法名")
    parser.add_argument("--params", "-p", help="JSON格式的参数", default="{}")
    parser.add_argument("--token", "-t", help="Tushare Pro Token", default=None)
    
    args = parser.parse_args()
    
    # 解析参数
    try:
        params = json.loads(args.params)
    except json.JSONDecodeError:
        print(json.dumps({"error": "Invalid JSON params"}, ensure_ascii=False))
        sys.exit(1)
    
    # 设置 token
    if args.token:
        os.environ['TUSHARE_TOKEN'] = args.token
    
    # 调用对应方法
    api = TushareAPI()
    method = getattr(api, args.method, None)
    
    if method is None:
        print(json.dumps({"error": f"Method {args.method} not found"}, ensure_ascii=False))
        sys.exit(1)
    
    try:
        result = method(**params)
        print(json.dumps(result, ensure_ascii=False, cls=DateTimeEncoder))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
