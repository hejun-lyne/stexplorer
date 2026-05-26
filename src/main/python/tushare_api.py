#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Tushare Pro API 封装模块
支持 6000 积分会员的绝大部分接口

Token 通过 --token 参数传入，或在环境变量 TUSHARE_TOKEN 中设置
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


# ============ 全局 Pro API 实例 ============
_pro_api = None

def init_pro(token: Optional[str] = None):
    """初始化 tushare pro api"""
    global _pro_api
    if token:
        ts.set_token(token)
        _pro_api = ts.pro_api(token)
        return _pro_api
    env_token = os.environ.get('TUSHARE_TOKEN', '')
    if env_token:
        ts.set_token(env_token)
        _pro_api = ts.pro_api(env_token)
        return _pro_api
    return None


def get_pro():
    """获取 pro api 实例"""
    global _pro_api
    if _pro_api is None:
        raise RuntimeError("Tushare Pro 未初始化，请先设置 token")
    return _pro_api


# ============ 工具函数 ============

def convert_secid_to_ts_code(secid: str) -> str:
    """将 secid 转换为 tushare 的 ts_code 格式"""
    if "." in secid:
        mk, code = secid.split(".")
        if mk == "1" or code.startswith("6"):
            return f"{code}.SH"
        else:
            return f"{code}.SZ"
    else:
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
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return s


def _to_float(val) -> float:
    try:
        return float(val) if val is not None else 0
    except (ValueError, TypeError):
        return 0


def _to_int(val) -> int:
    try:
        return int(float(val)) if val is not None else 0
    except (ValueError, TypeError):
        return 0


def df_to_records(df) -> List[Dict[str, Any]]:
    """将 DataFrame 转换为字典列表"""
    if df is None or df.empty:
        return []
    df = df.fillna('')
    records = []
    for _, row in df.iterrows():
        record = {}
        for col in df.columns:
            v = row.get(col)
            if hasattr(v, 'item'):
                v = v.item()
            record[col] = v
        records.append(record)
    return records


# ============ 本地缓存机制 ============

_CACHE_DIR = os.path.join(os.path.expanduser("~"), ".stexplorer", "tushare_cache")

def _cache_key(func_name: str, **kwargs) -> str:
    """生成缓存 key"""
    param_str = "_".join(f"{k}={v}" for k, v in sorted(kwargs.items()) if v is not None)
    return f"{func_name}_{param_str}" if param_str else func_name


def _cache_path(cache_key: str) -> str:
    """获取缓存文件路径"""
    os.makedirs(_CACHE_DIR, exist_ok=True)
    return os.path.join(_CACHE_DIR, f"{cache_key}.json")


def read_cache(cache_key: str, max_age_hours: int = 168) -> Optional[Any]:
    """读取缓存，max_age_hours 默认 7 天"""
    path = _cache_path(cache_key)
    if not os.path.exists(path):
        return None
    try:
        mtime = os.path.getmtime(path)
        age_hours = (datetime.now().timestamp() - mtime) / 3600
        if age_hours > max_age_hours:
            return None
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def write_cache(cache_key: str, data: Any):
    """写入缓存"""
    try:
        path = _cache_path(cache_key)
        os.makedirs(_CACHE_DIR, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, cls=DateTimeEncoder)
    except Exception:
        pass


def cached_api_call(func_name: str, max_age_hours: int, api_func, **kwargs):
    """带缓存的 API 调用"""
    cache_key = _cache_key(func_name, **kwargs)
    cached = read_cache(cache_key, max_age_hours)
    if cached is not None:
        return cached
    result = api_func(**kwargs)
    if isinstance(result, dict) and result.get("error"):
        return result
    if result is not None and not (isinstance(result, pd.DataFrame) and result.empty):
        write_cache(cache_key, result)
    return result


def safe_api_call(func, *args, **kwargs):
    """安全调用 API，捕获异常"""
    try:
        return func(*args, **kwargs)
    except Exception as e:
        err_msg = str(e)
        if "权限" in err_msg or "积分" in err_msg or "permission" in err_msg.lower():
            return {"error": f"权限不足，请检查 Tushare 积分: {err_msg}"}
        return {"error": err_msg}


# ============ API 封装类 ============

class TushareAPI:
    """Tushare Pro 接口封装类（6000 积分版）"""

    # ------------------ 交易日历 ------------------

    @staticmethod
    def get_trade_dates(year: Optional[int] = None) -> List[str]:
        try:
            pro = get_pro()
            target_year = year if year is not None else datetime.now().year
            start_date = f"{target_year}0101"
            end_date = f"{target_year}1231"
            df = pro.trade_cal(exchange='SSE', start_date=start_date, end_date=end_date, is_open='1')
            if df is None or df.empty:
                return []
            df['cal_date'] = pd.to_datetime(df['cal_date'])
            return df['cal_date'].dt.strftime('%Y-%m-%d').tolist()
        except Exception as e:
            return {"error": str(e)}

    # ------------------ 搜索 ------------------

    @staticmethod
    def search_stock(keyword: str) -> List[Dict[str, Any]]:
        try:
            pro = get_pro()
            df = pro.stock_basic(exchange='', list_status='L', fields='ts_code,symbol,name,area,industry,list_date')
            if df is None or df.empty:
                return []
            stocks = []
            for _, row in df.iterrows():
                name = row.get('name', '')
                symbol = row.get('symbol', '')
                if keyword in str(symbol) or keyword in str(name):
                    stocks.append({
                        "Code": str(symbol),
                        "Name": str(name),
                        "Type": str(row.get('area', '')),
                    })
            return stocks[:20]
        except Exception as e:
            return {"error": str(e)}

    # ------------------ 实时行情（旧版免费接口）------------------

    @staticmethod
    def get_stock_realtime(secid: str) -> Dict[str, Any]:
        """获取东财实时行情（realtime_quote src=dc，0积分）"""
        try:
            code = convert_secid_to_pure_code(secid)
            ts_code = f"{code}.SH" if code.startswith('6') else f"{code}.SZ"
            pro = get_pro()
            df = safe_api_call(pro.realtime_quote, ts_code=ts_code, src='dc')
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "Stock not found"}
            row = df.iloc[0]
            price = _to_float(row.get('price', 0))
            pre_close = _to_float(row.get('pre_close', 0))
            open_price = _to_float(row.get('open', 0))
            high = _to_float(row.get('high', 0))
            low = _to_float(row.get('low', 0))
            volume = _to_float(row.get('vol', 0))
            amount = _to_float(row.get('amount', 0))
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
                "cje": round(amount / 10000, 2),
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

    # ------------------ K 线数据（Pro 接口，支持复权）------------------

    @staticmethod
    def get_kline_data(secid: str, period: str = "daily", adjust: str = "qfq") -> List[Dict[str, Any]]:
        try:
            if is_board_code(secid):
                return TushareAPI._get_board_kline(secid, period)
            ts_code = convert_secid_to_ts_code(secid)
            end_date = datetime.now().strftime("%Y%m%d")
            start_date = (datetime.now() - timedelta(days=1095)).strftime("%Y%m%d")  # 3年
            pro = get_pro()

            freq_map = {'daily': 'D', 'weekly': 'W', 'monthly': 'M'}
            freq = freq_map.get(period, 'D')

            # 使用 pro_bar 获取复权数据（6000 积分可用）
            try:
                df = ts.pro_bar(ts_code=ts_code, freq=freq, adj=adjust, start_date=start_date, end_date=end_date)
            except Exception:
                df = None

            if df is None or df.empty:
                # fallback 到 daily/weekly/monthly + adj_factor
                if period == 'daily':
                    df = pro.daily(ts_code=ts_code, start_date=start_date, end_date=end_date)
                elif period == 'weekly':
                    df = pro.weekly(ts_code=ts_code, start_date=start_date, end_date=end_date)
                elif period == 'monthly':
                    df = pro.monthly(ts_code=ts_code, start_date=start_date, end_date=end_date)
                else:
                    df = pro.daily(ts_code=ts_code, start_date=start_date, end_date=end_date)

                if adjust in ('qfq', 'hfq') and df is not None and not df.empty:
                    try:
                        adj_df = pro.adj_factor(ts_code=ts_code, start_date=start_date, end_date=end_date)
                        if adj_df is not None and not adj_df.empty:
                            df = df.merge(adj_df[['trade_date', 'adj_factor']], on='trade_date', how='left')
                            base_factor = df['adj_factor'].iloc[-1] if adjust == 'qfq' else df['adj_factor'].iloc[0]
                            for col in ['open', 'high', 'low', 'close']:
                                df[col] = df[col] * df['adj_factor'] / base_factor
                    except Exception:
                        pass

            if df is None or df.empty:
                return {"error": "No data available"}

            klines = []
            for _, row in df.iterrows():
                date_val = row.get('trade_date', row.get('date', ''))
                date_str = _standardize_date(date_val)
                open_p = _to_float(row.get('open', 0))
                close_p = _to_float(row.get('close', 0))
                cjl = _to_int(row.get('vol', row.get('volume', 0)))
                klines.append({
                    "date": date_str,
                    "kp": open_p,
                    "sp": close_p,
                    "zg": _to_float(row.get('high', 0)),
                    "zd": _to_float(row.get('low', 0)),
                    "cjl": cjl,
                    "cje": round(_to_float(row.get('amount', 0)), 2),
                    "zdf": _to_float(row.get('pct_chg', row.get('change_pct', 0))),
                    "zde": _to_float(row.get('change', 0)),
                    "hsl": _to_float(row.get('turnover_rate', row.get('hsl', 0))),
                })
            return klines
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def _get_board_kline(secid: str, period: str = "daily") -> List[Dict[str, Any]]:
        """获取东财板块K线（dc_daily，6000积分）"""
        try:
            code = convert_secid_to_pure_code(secid)
            pro = get_pro()
            end_date = datetime.now().strftime("%Y%m%d")
            start_date = (datetime.now() - timedelta(days=730)).strftime("%Y%m%d")

            # dc_daily 需要 BKxxxx.DC 格式
            ts_code = f"{code}.DC" if not code.endswith(".DC") else code

            df = cached_api_call(f"dc_daily_{ts_code}", 24, pro.dc_daily,
                                  ts_code=ts_code, start_date=start_date, end_date=end_date)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or (isinstance(df, pd.DataFrame) and df.empty):
                return {"error": "No data available"}

            klines = []
            for _, row in df.iterrows():
                date_str = _standardize_date(row.get('trade_date', ''))
                klines.append({
                    "date": date_str,
                    "kp": _to_float(row.get('open', 0)),
                    "sp": _to_float(row.get('close', 0)),
                    "zg": _to_float(row.get('high', 0)),
                    "zd": _to_float(row.get('low', 0)),
                    "cjl": _to_int(row.get('vol', 0)),
                    "cje": round(_to_float(row.get('amount', 0)), 2),
                    "zdf": _to_float(row.get('pct_change', 0)),
                    "zde": _to_float(row.get('change', 0)),
                    "hsl": _to_float(row.get('turnover_rate', 0)),
                })
            return klines
        except Exception as e:
            return {"error": str(e)}

    # ------------------ 分时走势（新浪财经）------------------

    @staticmethod
    def get_stock_trend(secid: str) -> List[Dict[str, Any]]:
        """获取东财实时分时走势（realtime_quote src=dc，0积分）"""
        try:
            code = convert_secid_to_pure_code(secid)
            ts_code = f"{code}.SH" if code.startswith('6') else f"{code}.SZ"
            pro = get_pro()
            df = safe_api_call(pro.realtime_quote, ts_code=ts_code, src='dc')
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "分时数据暂不可用"}

            today = datetime.now().strftime('%Y-%m-%d')
            row = df.iloc[0]
            price = _to_float(row.get('price', 0))
            pre_close = _to_float(row.get('pre_close', 0))
            open_price = _to_float(row.get('open', 0))
            high = _to_float(row.get('high', 0))
            low = _to_float(row.get('low', 0))
            volume = _to_int(row.get('vol', 0))

            # realtime_quote 返回的是快照，非逐笔分时
            # 构造单条趋势数据（当前快照）
            trends = []
            now_time = datetime.now().strftime('%H:%M')
            trends.append({
                "datetime": f"{today} {now_time}",
                "current": price,
                "last": pre_close,
                "vol": volume,
                "average": price,
                "up": 1 if price >= pre_close else -1,
            })
            return trends
        except Exception as e:
            return {"error": str(e)}

    # ------------------ 板块数据 ------------------

    @staticmethod
    def get_sector_boards(bk_type: str = "industry") -> List[Dict[str, Any]]:
        """获取东财板块列表（dc_index，6000积分）"""
        try:
            pro = get_pro()
            # dc_index 返回东财概念/行业/地域板块信息
            # idx_type: 概念板块、行业板块、地域板块
            idx_type = "行业板块" if bk_type == "industry" else "概念板块"
            df = cached_api_call("dc_index", 24, pro.dc_index, idx_type=idx_type)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or (isinstance(df, pd.DataFrame) and df.empty):
                return {"error": "No data"}
            boards = []
            for _, row in df.iterrows():
                ts_code = str(row.get("ts_code", ""))
                # ts_code 格式为 BKxxxx.DC，去掉 .DC 后缀
                code = ts_code.replace(".DC", "") if ".DC" in ts_code else ts_code
                boards.append({
                    "code": code,
                    "name": str(row.get("name", "")),
                    "zdf": _to_float(row.get("pct_change", 0)),
                    "zsz": _to_float(row.get("total_mv", 0)),
                    "cje": _to_float(row.get("amount", 0)),
                    "source": "dc",
                })
            return boards
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_board_stocks(secid: str, count: int = 20) -> Dict[str, Any]:
        """获取东财板块成分股（dc_member，6000积分）"""
        try:
            pro = get_pro()
            code = convert_secid_to_pure_code(secid)
            # dc_member 需要 BKxxxx.DC 格式
            ts_code = f"{code}.DC" if not code.endswith(".DC") else code
            trade_date = datetime.now().strftime('%Y%m%d')

            df = cached_api_call(f"dc_member_{ts_code}", 24, pro.dc_member, ts_code=ts_code, trade_date=trade_date)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or (isinstance(df, pd.DataFrame) and df.empty):
                return {"total": 0, "stocks": []}

            stocks = []
            for _, row in df.iterrows():
                con_code = str(row.get("con_code", ""))
                stock_code = con_code.split(".")[0] if "." in con_code else con_code
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
            return {"total": len(df), "stocks": stocks}
        except Exception as e:
            return {"error": str(e)}

    # ------------------ 涨跌停数据 ------------------

    @staticmethod
    def get_limit_up_stocks(date: Optional[str] = None) -> List[Dict[str, Any]]:
        try:
            pro = get_pro()
            if date is None:
                date = datetime.now().strftime("%Y%m%d")
            else:
                date = date.replace("-", "")

            # 使用 limit_list 获取涨停数据
            df = safe_api_call(pro.limit_list, trade_date=date)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}

            stocks = []
            for _, row in df.iterrows():
                if str(row.get('limit', '')) == 'U':
                    stocks.append({
                        "code": str(row.get("ts_code", "")).split('.')[0],
                        "name": str(row.get("name", "")),
                        "zx": _to_float(row.get("close", 0)),
                        "zdf": _to_float(row.get("pct_chg", 0)),
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
        try:
            pro = get_pro()
            if date is None:
                date = datetime.now().strftime("%Y%m%d")
            else:
                date = date.replace("-", "")

            df = safe_api_call(pro.limit_list, trade_date=date)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}

            stocks = []
            for _, row in df.iterrows():
                if str(row.get('limit', '')) == 'D':
                    stocks.append({
                        "code": str(row.get("ts_code", "")).split('.')[0],
                        "name": str(row.get("name", "")),
                        "zx": _to_float(row.get("close", 0)),
                        "zdf": _to_float(row.get("pct_chg", 0)),
                        "dtdays": 0,
                    })
            return stocks
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_stk_limit(date: Optional[str] = None) -> List[Dict[str, Any]]:
        """获取每日涨跌停价格（stk_limit，2000积分）"""
        try:
            pro = get_pro()
            if date is None:
                date = datetime.now().strftime("%Y%m%d")
            else:
                date = date.replace("-", "")
            df = safe_api_call(pro.stk_limit, trade_date=date)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            return df_to_records(df)
        except Exception as e:
            return {"error": str(e)}

    # ------------------ 公司信息 ------------------

    @staticmethod
    def get_stock_company_info(code: str) -> Dict[str, Any]:
        try:
            pro = get_pro()
            ts_code = f"{code}.SH" if code.startswith('6') else f"{code}.SZ"
            df = safe_api_call(pro.stock_company, ts_code=ts_code, fields='ts_code,exchange,chairman,manager,secretary,reg_capital,setup_date,province,city,introduction,website,email,office,employees,main_business,business_scope')
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                # fallback 到旧版 stock_basics
                try:
                    basics = ts.get_stock_basics()
                    if basics is not None and code in basics.index:
                        row = basics.loc[code]
                        return {
                            "gsjs": "",
                            "sshy": str(row.get("industry", "")),
                            "dsz": "",
                            "zcdz": "",
                            "clrq": str(row.get("timeToMarket", "")),
                            "ssrq": str(row.get("timeToMarket", "")),
                        }
                except Exception:
                    pass
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

    # ------------------ 新闻 ------------------

    @staticmethod
    def get_stock_news(code: str, page: int = 1, page_size: int = 20) -> List[Dict[str, Any]]:
        try:
            pro = get_pro()
            ts_code = f"{code}.SH" if code.startswith('6') else f"{code}.SZ"
            # 使用 major_news 接口（需要单独权限，fallback 到空列表）
            try:
                df = safe_api_call(pro.major_news, ts_code=ts_code, start_date=(datetime.now() - timedelta(days=30)).strftime('%Y%m%d'), end_date=datetime.now().strftime('%Y%m%d'))
                if isinstance(df, pd.DataFrame) and not df.empty:
                    records = df_to_records(df)
                    start = (page - 1) * page_size
                    end = start + page_size
                    return records[start:end]
            except Exception:
                pass
            return []
        except Exception as e:
            return {"error": str(e)}

    # ------------------ 研报 ------------------

    @staticmethod
    def get_research_reports(code: str) -> List[Dict[str, Any]]:
        try:
            pro = get_pro()
            ts_code = f"{code}.SH" if code.startswith('6') else f"{code}.SZ"
            df = safe_api_call(pro.report_rc, ts_code=ts_code)
            if isinstance(df, dict) and df.get("error"):
                return df
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

    # ------------------ 资金流向 ------------------

    @staticmethod
    def get_money_flow(code: str) -> Dict[str, Any]:
        """获取资金流向：个股用 moneyflow，板块用 moneyflow_ind_dc（东财，6000积分）"""
        try:
            pro = get_pro()
            today = datetime.now().strftime('%Y%m%d')

            # 判断是否为板块代码
            if code.startswith("BK") or code.startswith("90."):
                # 板块资金流向：东财 moneyflow_ind_dc
                ts_code = f"{code}.DC" if not code.endswith(".DC") else code
                df = safe_api_call(pro.moneyflow_ind_dc, ts_code=ts_code, trade_date=today)
                if isinstance(df, dict) and df.get("error"):
                    return df
                if df is None or df.empty:
                    return {"error": "No data"}
                row = df.iloc[0]
                return {
                    "main_in": _to_float(row.get("net_amount", 0)),
                    "small_in": _to_float(row.get("buy_sm_amount", 0)),
                    "medium_in": _to_float(row.get("buy_md_amount", 0)),
                    "big_in": _to_float(row.get("buy_lg_amount", 0)),
                    "super_big_in": _to_float(row.get("buy_elg_amount", 0)),
                    "main_rate": _to_float(row.get("net_amount_rate", 0)),
                    "source": "dc",
                }
            else:
                # 个股资金流向：Tushare 标准 moneyflow
                ts_code = f"{code}.SH" if code.startswith('6') else f"{code}.SZ"
                df = safe_api_call(pro.moneyflow, ts_code=ts_code, start_date=today, end_date=today)
                if isinstance(df, dict) and df.get("error"):
                    return df
                if df is None or df.empty:
                    return {"error": "No data"}
                row = df.iloc[0]
                return {
                    "main_in": _to_float(row.get("net_mf", 0)),
                    "small_in": _to_float(row.get("net_mf_sm", 0)),
                    "medium_in": _to_float(row.get("net_mf_md", 0)),
                    "big_in": _to_float(row.get("net_mf_lg", 0)),
                    "super_big_in": _to_float(row.get("net_mf_huge", 0)),
                    "source": "tushare",
                }
        except Exception as e:
            return {"error": str(e)}

    # ------------------ 龙虎榜 ------------------

    @staticmethod
    def get_top_list(date: Optional[str] = None) -> List[Dict[str, Any]]:
        """龙虎榜每日明细（2000积分）"""
        try:
            pro = get_pro()
            if date is None:
                date = datetime.now().strftime("%Y%m%d")
            else:
                date = date.replace("-", "")
            df = safe_api_call(pro.top_list, trade_date=date)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            return df_to_records(df)
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_top_inst(date: Optional[str] = None) -> List[Dict[str, Any]]:
        """龙虎榜机构交易明细（2000积分）"""
        try:
            pro = get_pro()
            if date is None:
                date = datetime.now().strftime("%Y%m%d")
            else:
                date = date.replace("-", "")
            df = safe_api_call(pro.top_inst, trade_date=date)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            return df_to_records(df)
        except Exception as e:
            return {"error": str(e)}

    # ------------------ 融资融券 ------------------

    @staticmethod
    def get_margin(date: Optional[str] = None) -> List[Dict[str, Any]]:
        """融资融券交易汇总（2000积分）"""
        try:
            pro = get_pro()
            if date is None:
                date = datetime.now().strftime("%Y%m%d")
            else:
                date = date.replace("-", "")
            df = safe_api_call(pro.margin, trade_date=date)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            return df_to_records(df)
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_margin_detail(ts_code: str, date: Optional[str] = None) -> List[Dict[str, Any]]:
        """融资融券交易明细（2000积分）"""
        try:
            pro = get_pro()
            if date is None:
                date = datetime.now().strftime("%Y%m%d")
            else:
                date = date.replace("-", "")
            df = safe_api_call(pro.margin_detail, ts_code=ts_code, trade_date=date)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            return df_to_records(df)
        except Exception as e:
            return {"error": str(e)}

    # ------------------ 股东相关 ------------------

    @staticmethod
    def get_stk_holdernumber(ts_code: str) -> List[Dict[str, Any]]:
        """股东人数（2000积分）"""
        try:
            pro = get_pro()
            df = safe_api_call(pro.stk_holdernumber, ts_code=ts_code)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            return df_to_records(df)
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_stk_holdertrade(ts_code: str) -> List[Dict[str, Any]]:
        """股东增减持（2000积分）"""
        try:
            pro = get_pro()
            df = safe_api_call(pro.stk_holdertrade, ts_code=ts_code)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            return df_to_records(df)
        except Exception as e:
            return {"error": str(e)}

    # ------------------ 大宗交易 / 限售解禁 / 回购 / 质押 ------------------

    @staticmethod
    def get_block_trade(date: Optional[str] = None) -> List[Dict[str, Any]]:
        """大宗交易（2000积分）"""
        try:
            pro = get_pro()
            if date is None:
                date = datetime.now().strftime("%Y%m%d")
            else:
                date = date.replace("-", "")
            df = safe_api_call(pro.block_trade, trade_date=date)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            return df_to_records(df)
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_share_float(ts_code: str) -> List[Dict[str, Any]]:
        """限售股解禁（3000积分）"""
        try:
            pro = get_pro()
            df = safe_api_call(pro.share_float, ts_code=ts_code)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            return df_to_records(df)
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_repurchase(date: Optional[str] = None) -> List[Dict[str, Any]]:
        """股票回购（2000积分）"""
        try:
            pro = get_pro()
            if date is None:
                date = datetime.now().strftime("%Y%m%d")
            else:
                date = date.replace("-", "")
            df = safe_api_call(pro.repurchase, ann_date=date)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            return df_to_records(df)
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_pledge_stat(ts_code: str) -> List[Dict[str, Any]]:
        """股权质押统计（2000积分）"""
        try:
            pro = get_pro()
            df = safe_api_call(pro.pledge_stat, ts_code=ts_code)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            return df_to_records(df)
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_pledge_detail(ts_code: str) -> List[Dict[str, Any]]:
        """股权质押明细（2000积分）"""
        try:
            pro = get_pro()
            df = safe_api_call(pro.pledge_detail, ts_code=ts_code)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            return df_to_records(df)
        except Exception as e:
            return {"error": str(e)}

    # ------------------ 个股异常波动（6000积分）------------------

    @staticmethod
    def get_stk_shock(date: Optional[str] = None, ts_code: Optional[str] = None) -> List[Dict[str, Any]]:
        """个股异常波动（6000积分）"""
        try:
            pro = get_pro()
            kwargs = {}
            if date:
                kwargs['trade_date'] = date.replace("-", "")
            if ts_code:
                kwargs['ts_code'] = ts_code
            df = safe_api_call(pro.stk_shock, **kwargs)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            return df_to_records(df)
        except Exception as e:
            return {"error": str(e)}

    # ------------------ 每日指标 ------------------

    @staticmethod
    def get_daily_basic(date: Optional[str] = None, ts_code: Optional[str] = None) -> List[Dict[str, Any]]:
        """每日指标数据（2000积分起）"""
        try:
            pro = get_pro()
            kwargs = {}
            if date:
                kwargs['trade_date'] = date.replace("-", "")
            if ts_code:
                kwargs['ts_code'] = ts_code
            df = safe_api_call(pro.daily_basic, **kwargs)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            return df_to_records(df)
        except Exception as e:
            return {"error": str(e)}

    # ------------------ 基本面数据（财务指标）------------------

    @staticmethod
    def get_stock_fundamental(code: str) -> Dict[str, Any]:
        try:
            pro = get_pro()
            ts_code = f"{code}.SH" if code.startswith('6') else f"{code}.SZ"
            df = safe_api_call(pro.fina_indicator, ts_code=ts_code, limit=1)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            row = df.iloc[0]
            return {
                "code": code,
                "report_date": str(row.get("ann_date", "")),
                "roe": _to_float(row.get("roe", 0)),
                "roe_diluted": _to_float(row.get("roe_diluted", 0)),
                "net_profit": _to_float(row.get("profit_dedt", 0)),
                "net_profit_growth": _to_float(row.get("profit_dedt_yoy", 0)),
                "revenue": _to_float(row.get("revenue", 0)),
                "revenue_growth": _to_float(row.get("revenue_yoy", 0)),
                "gross_margin": _to_float(row.get("grossprofit_margin", 0)),
                "net_margin": _to_float(row.get("netprofit_margin", 0)),
                "eps": _to_float(row.get("eps", 0)),
                "bps": _to_float(row.get("bps", 0)),
                "debt_ratio": _to_float(row.get("debt_to_assets", 0)),
                "current_ratio": _to_float(row.get("current_ratio", 0)),
                "quick_ratio": _to_float(row.get("quick_ratio", 0)),
                "inventory_turnover": _to_float(row.get("inv_turn", 0)),
                "receivable_turnover": _to_float(row.get("ar_turn", 0)),
                "operating_cash_flow": _to_float(row.get("ocfps", 0)),
                "investing_cash_flow": 0,
                "financing_cash_flow": 0,
            }
        except Exception as e:
            return {"error": str(e)}

    # ------------------ 财务数据（三大报表）------------------

    @staticmethod
    def get_stock_finance_data(code: str) -> Dict[str, Any]:
        try:
            pro = get_pro()
            ts_code = f"{code}.SH" if code.startswith('6') else f"{code}.SZ"

            # 资产负债表
            balance = {}
            try:
                balance_df = safe_api_call(pro.balancesheet, ts_code=ts_code, limit=1)
                if isinstance(balance_df, pd.DataFrame) and not balance_df.empty:
                    row = balance_df.iloc[0]
                    balance = {
                        "report_date": str(row.get("ann_date", "")),
                        "total_assets": _to_float(row.get("total_assets", 0)),
                        "total_liabilities": _to_float(row.get("total_liab", 0)),
                        "total_equity": _to_float(row.get("total_hldr_eqy_exc_min_int", 0)),
                        "monetary_funds": _to_float(row.get("money_cap", 0)),
                        "accounts_receivable": _to_float(row.get("accounts_receiv", 0)),
                        "inventory": _to_float(row.get("inventories", 0)),
                        "goodwill": _to_float(row.get("goodwill", 0)),
                    }
            except Exception:
                pass

            # 利润表
            profit = {}
            try:
                profit_df = safe_api_call(pro.income, ts_code=ts_code, limit=1)
                if isinstance(profit_df, pd.DataFrame) and not profit_df.empty:
                    row = profit_df.iloc[0]
                    profit = {
                        "report_date": str(row.get("ann_date", "")),
                        "total_revenue": _to_float(row.get("total_revenue", 0)),
                        "operating_revenue": _to_float(row.get("revenue", 0)),
                        "operating_cost": _to_float(row.get("oper_cost", 0)),
                        "operating_profit": _to_float(row.get("operate_profit", 0)),
                        "total_profit": _to_float(row.get("total_profit", 0)),
                        "net_profit": _to_float(row.get("n_income", 0)),
                        "rd_expense": 0,
                        "sales_expense": _to_float(row.get("sell_exp", 0)),
                        "management_expense": _to_float(row.get("admin_exp", 0)),
                        "financial_expense": _to_float(row.get("fin_exp", 0)),
                    }
            except Exception:
                pass

            # 现金流量表
            cash = {}
            try:
                cash_df = safe_api_call(pro.cashflow, ts_code=ts_code, limit=1)
                if isinstance(cash_df, pd.DataFrame) and not cash_df.empty:
                    row = cash_df.iloc[0]
                    cash = {
                        "report_date": str(row.get("ann_date", "")),
                        "net_operating_cash_flow": _to_float(row.get("n_cashflow_act", 0)),
                        "net_investing_cash_flow": _to_float(row.get("n_cashflow_inv_act", 0)),
                        "net_financing_cash_flow": _to_float(row.get("n_cash_flows_fnc_act", 0)),
                        "cash_equivalent_increase": _to_float(row.get("n_incr_cash_cash_equ", 0)),
                        "ending_cash": _to_float(row.get("c_cash_equ_end_period", 0)),
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

    # ------------------ 业绩预告 / 快报 / 分红 ------------------

    @staticmethod
    def get_forecast(ts_code: str) -> List[Dict[str, Any]]:
        """业绩预告（2000积分）"""
        try:
            pro = get_pro()
            df = safe_api_call(pro.forecast, ts_code=ts_code)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            return df_to_records(df)
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_express(ts_code: str) -> List[Dict[str, Any]]:
        """业绩快报（2000积分）"""
        try:
            pro = get_pro()
            df = safe_api_call(pro.express, ts_code=ts_code)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            return df_to_records(df)
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_dividend(ts_code: str) -> List[Dict[str, Any]]:
        """分红送股（2000积分）"""
        try:
            pro = get_pro()
            df = safe_api_call(pro.dividend, ts_code=ts_code)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            return df_to_records(df)
        except Exception as e:
            return {"error": str(e)}

    # ------------------ IPO 新股 ------------------

    @staticmethod
    def get_new_share(start_date: Optional[str] = None, end_date: Optional[str] = None) -> List[Dict[str, Any]]:
        """IPO新股列表（120积分）"""
        try:
            pro = get_pro()
            kwargs = {}
            if start_date:
                kwargs['start_date'] = start_date.replace("-", "")
            if end_date:
                kwargs['end_date'] = end_date.replace("-", "")
            df = safe_api_call(pro.new_share, **kwargs)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            return df_to_records(df)
        except Exception as e:
            return {"error": str(e)}

    # ------------------ 沪深股通 ------------------

    @staticmethod
    def get_hk_hold(date: Optional[str] = None, ts_code: Optional[str] = None) -> List[Dict[str, Any]]:
        """沪深股通持股明细（2000积分起）"""
        try:
            pro = get_pro()
            kwargs = {}
            if date:
                kwargs['trade_date'] = date.replace("-", "")
            if ts_code:
                kwargs['ts_code'] = ts_code
            df = safe_api_call(pro.hk_hold, **kwargs)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "No data available"}
            return df_to_records(df)
        except Exception as e:
            return {"error": str(e)}


# ============ JSON 编码器 ============

class DateTimeEncoder(json.JSONEncoder):
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


# ============ CLI 入口 ============

def main():
    parser = argparse.ArgumentParser(description="Tushare Pro API CLI")
    parser.add_argument("method", help="方法名")
    parser.add_argument("--params", "-p", help="JSON格式的参数", default="{}")
    parser.add_argument("--token", "-t", help="Tushare Pro Token", default=None)

    args = parser.parse_args()

    try:
        params = json.loads(args.params)
    except json.JSONDecodeError:
        print(json.dumps({"error": "Invalid JSON params"}, ensure_ascii=False))
        sys.exit(1)

    # 初始化
    if args.token:
        init_pro(args.token)
    else:
        init_pro()

    if _pro_api is None:
        print(json.dumps({"error": "Tushare Pro Token 未设置，请在设置中配置 token"}, ensure_ascii=False))
        sys.exit(1)

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
