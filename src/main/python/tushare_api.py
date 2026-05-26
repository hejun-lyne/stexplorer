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
import math
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

# 尝试导入 akshare（分时走势依赖）
try:
    import akshare as ak
except ImportError:
    ak = None


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


def is_board_code(secid: str) -> bool:
    """判断是否为板块代码"""
    if secid.startswith("90."):
        return True
    code = convert_secid_to_pure_code(secid)
    return code.startswith("BK") or code.startswith("88")


def is_index_code(secid: str) -> bool:
    """判断是否为指数代码（上证指数、深证指数、创业板指等）"""
    if "." in secid:
        mk, code = secid.split(".")
        # 深市指数：399xxx（如创业板指 399006，深证成指 399001）
        if code.startswith("399"):
            return True
        # 沪市指数：000xxx 系列且 market == 1（如上证指数 1.000001，中证500 1.000905）
        # 注意：000xxx 深市个股 market == 0（如平安银行 0.000001）
        if code.startswith("000") and mk == "1":
            return True
    return False


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
        if val is None:
            return 0
        f = float(val)
        return 0 if math.isnan(f) else f
    except (ValueError, TypeError):
        return 0


def _to_int(val) -> int:
    try:
        if val is None:
            return 0
        f = float(val)
        return 0 if math.isnan(f) else int(f)
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
        """获取实时行情（腾讯财经接口，免费稳定，字段丰富）

        腾讯 qt.gtimg.cn 接口返回字段（~分隔）：
          1-名称, 2-代码, 3-最新价, 4-昨收, 5-今开, 6-成交量(手),
          31-涨跌额, 32-涨跌幅%, 33-最高, 34-最低,
          37-成交额(万), 38-换手率, 39-市盈率, 43-振幅,
          44-流通市值(亿), 45-总市值(亿), 46-市净率, 47-涨停价, 48-跌停价,
          49-量比, 50-委比

        返回字段补全：zx, zs, zdf, zdd, cjl, cje, zg, zd, jk, lb, hsl, syl, sjl, lt, zsz, zt, dt
        """
        try:
            # 板块代码仍走 Tushare dc_index（腾讯无 BKxxxx 体系）
            if is_board_code(secid):
                return TushareAPI._get_board_realtime(secid)

            if requests is None:
                return {"error": "requests 未安装，无法获取实时行情"}

            symbol = convert_secid_to_tx_symbol(secid)
            url = f"http://qt.gtimg.cn/q={symbol}"
            resp = requests.get(url, timeout=10)
            resp.encoding = "gbk"
            text = resp.text

            # 解析 v_sz000001="..."; 格式
            if "v_" not in text or '"' not in text:
                return {"error": "Invalid response from tencent"}

            start = text.find('"') + 1
            end = text.rfind('"')
            data_str = text[start:end]
            parts = data_str.split("~")

            def _get(idx, default=""):
                return parts[idx] if idx < len(parts) else default

            name = _get(1, "")
            code = _get(2, "")
            price = _to_float(_get(3, 0))
            pre_close = _to_float(_get(4, 0))
            open_price = _to_float(_get(5, 0))
            # 成交量：手 → 股（与旧版 Tushare get_realtime_quotes 单位保持一致）
            volume = int(_to_float(_get(6, 0)) * 100)
            high = _to_float(_get(33, 0))
            low = _to_float(_get(34, 0))
            zdd = _to_float(_get(31, 0))
            zdf = _to_float(_get(32, 0))
            # 成交额：腾讯返回"万"，与旧版实时接口单位保持一致（万）
            amount_wan = _to_float(_get(37, 0))
            hsl = _to_float(_get(38, 0))
            syl = _to_float(_get(39, 0))
            zf = _to_float(_get(43, 0))
            # 市值：返回单位是"亿"
            lt = _to_float(_get(44, 0))
            zsz = _to_float(_get(45, 0))
            sjl = _to_float(_get(46, 0))
            zt_price = _to_float(_get(47, 0))
            dt_price = _to_float(_get(48, 0))
            # 量比在 49 位（部分个股可能缺失，容错处理）
            lb = _to_float(_get(49, 0)) if len(parts) > 49 else 0
            time_str = _get(30, "")

            return {
                "code": code,
                "name": name,
                "zx": price,
                "zs": pre_close,
                "zdf": round(zdf, 2),
                "zdd": round(zdd, 2),
                "cjl": volume,
                "cje": round(amount_wan, 2),   # 单位：万，与旧版保持一致
                "zg": high,
                "zd": low,
                "jk": open_price,
                "lb": lb,
                "hsl": hsl,
                "syl": syl,
                "sjl": sjl,
                "lt": lt,                       # 单位：亿
                "zsz": zsz,                     # 单位：亿
                "zf": zf,
                "zt": zt_price,
                "dt": dt_price,
                "time": time_str,
                "source": "tencent",
            }
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def _get_board_realtime(secid: str) -> Dict[str, Any]:
        """获取板块实时行情（dc_index，带缓存避免重复全量查询）"""
        try:
            code = convert_secid_to_pure_code(secid)
            ts_code = f"{code}.DC" if not code.endswith(".DC") else code
            pro = get_pro()

            # 缓存 key：按板块代码隔离，缓存 1 小时
            cache_key = f"dc_index_board_{ts_code}"
            cached = read_cache(cache_key, max_age_hours=1)
            if cached is not None:
                return cached

            # 先查行业板块，失败再查概念板块
            df = safe_api_call(pro.dc_index, idx_type="行业板块")
            if isinstance(df, dict) and df.get("error"):
                df = safe_api_call(pro.dc_index, idx_type="概念板块")
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"error": "Board not found"}

            board_row = df[df['ts_code'] == ts_code]
            if board_row.empty:
                return {"error": f"Board {ts_code} not found"}

            row = board_row.iloc[0]
            close_p = _to_float(row.get('close', 0))
            pre_close = _to_float(row.get('pre_close', 0))
            zdd = close_p - pre_close if pre_close > 0 else 0
            zdf = (zdd / pre_close * 100) if pre_close > 0 else 0

            result = {
                "code": code,
                "name": str(row.get('name', '')),
                "zx": close_p,
                "zs": pre_close,
                "zdf": round(zdf, 2),
                "zdd": round(zdd, 2),
                "cjl": _to_int(row.get('volume', 0)),
                "cje": round(_to_float(row.get('amount', 0)), 2),
                "zg": _to_float(row.get('high', 0)),
                "zd": _to_float(row.get('low', 0)),
                "jk": _to_float(row.get('open', 0)),
                "lb": 0,
                "hsl": _to_float(row.get('turnover_rate', 0)),
                "syl": 0,
                "sjl": 0,
                "lt": _to_float(row.get('float_mv', 0)),
                "zsz": _to_float(row.get('total_mv', 0)),
            }

            write_cache(cache_key, result)
            return result
        except Exception as e:
            return {"error": str(e)}
    # ------------------ K 线数据（Pro 接口，支持复权）------------------

    @staticmethod
    def get_kline_data(secid: str, period: str = "daily", adjust: str = "qfq", limit: int = 0) -> List[Dict[str, Any]]:
        """获取个股K线数据（Tushare pro_bar / daily / weekly / monthly）

        参数:
            secid: 标的ID，如 "1.600000"
            period: daily/weekly/monthly
            adjust: qfq-前复权, hfq-后复权, 空字符串-不复权
            limit: 限制返回条数，0 表示不限制，>0 表示返回最近 limit 条

        注意：
        - Tushare daily/weekly/monthly 接口的 amount 单位是"千元"，需×1000 转为元
        - 返回数据按日期升序排列（最早日期在前），与东财接口保持一致
        - pro_bar 优先调用，失败则 fallback 到 daily + adj_factor 手动复权
        """
        try:
            if is_board_code(secid):
                return TushareAPI._get_board_kline(secid, period)

            if is_index_code(secid):
                return TushareAPI._get_index_kline(secid, period, limit)

            code = convert_secid_to_pure_code(secid)
            ts_code = convert_secid_to_ts_code(secid)
            end_date = datetime.now().strftime("%Y%m%d")

            # 根据 limit 和周期动态计算 start_date
            # 注意：自然日 ≠ 交易日，需要足够大的缓冲确保返回 limit 条数据
            # A股一年约250个交易日，日K需要 limit*2 天自然日才能确保覆盖
            if limit > 0:
                if period == 'daily':
                    days_needed = limit * 2 + 60  # 2倍+60天缓冲，应对长假
                    start_date = (datetime.now() - timedelta(days=days_needed)).strftime("%Y%m%d")
                elif period == 'weekly':
                    weeks_needed = limit * 2 + 10  # 2倍+10周缓冲
                    start_date = (datetime.now() - timedelta(days=weeks_needed * 7)).strftime("%Y%m%d")
                elif period == 'monthly':
                    months_needed = limit * 2 + 6  # 2倍+6月缓冲
                    start_date = (datetime.now() - timedelta(days=months_needed * 30)).strftime("%Y%m%d")
                else:
                    start_date = (datetime.now() - timedelta(days=limit * 2 + 60)).strftime("%Y%m%d")
            else:
                start_date = (datetime.now() - timedelta(days=365 * 3)).strftime("%Y%m%d")  # 默认3年

            pro = get_pro()
            freq_map = {'daily': 'D', 'weekly': 'W', 'monthly': 'M'}
            freq = freq_map.get(period, 'D')

            # 1. 优先使用 pro_bar 获取复权数据（一站式接口）
            df = None
            try:
                df = ts.pro_bar(ts_code=ts_code, freq=freq, adj=adjust, start_date=start_date, end_date=end_date)
            except Exception as e:
                print(f"[pro_bar 失败] {ts_code}: {e}")

            # 2. pro_bar 失败，fallback 到基础接口 + 手动复权
            if df is None or df.empty:
                if period == 'daily':
                    df = pro.daily(ts_code=ts_code, start_date=start_date, end_date=end_date)
                elif period == 'weekly':
                    df = pro.weekly(ts_code=ts_code, start_date=start_date, end_date=end_date)
                elif period == 'monthly':
                    df = pro.monthly(ts_code=ts_code, start_date=start_date, end_date=end_date)
                else:
                    df = pro.daily(ts_code=ts_code, start_date=start_date, end_date=end_date)

                # 手动复权
                if adjust in ('qfq', 'hfq') and df is not None and not df.empty:
                    try:
                        adj_df = pro.adj_factor(ts_code=ts_code, start_date=start_date, end_date=end_date)
                        if adj_df is not None and not adj_df.empty:
                            df = df.merge(adj_df[['trade_date', 'adj_factor']], on='trade_date', how='left')
                            base_factor = df['adj_factor'].iloc[-1] if adjust == 'qfq' else df['adj_factor'].iloc[0]
                            for col in ['open', 'high', 'low', 'close']:
                                df[col] = df[col] * df['adj_factor'] / base_factor
                    except Exception as e:
                        print(f"[手动复权失败] {ts_code}: {e}")

            if df is None or df.empty:
                return {"error": "No data available"}

            # Tushare 默认返回降序（最新日期在前），需转为升序（最早日期在前）
            df = df.sort_values('trade_date', ascending=True).reset_index(drop=True)

            # 补充换手率：merge daily_basic
            try:
                basic_df = pro.daily_basic(ts_code=ts_code, start_date=start_date, end_date=end_date)
                if basic_df is not None and not basic_df.empty:
                    basic_df = basic_df.sort_values('trade_date', ascending=True)
                    df = df.merge(basic_df[['trade_date', 'turnover_rate']], on='trade_date', how='left')
            except Exception as e:
                print(f"[daily_basic 失败] {ts_code}: {e}")

            klines = []
            for _, row in df.iterrows():
                date_val = row.get('trade_date', row.get('date', ''))
                date_str = _standardize_date(date_val)
                # Tushare amount 单位：千元 → 转为元（×1000）
                amount_yuan = _to_float(row.get('amount', 0)) * 1000
                klines.append({
                    "date": date_str,
                    "kp": _to_float(row.get('open', 0)),
                    "sp": _to_float(row.get('close', 0)),
                    "zg": _to_float(row.get('high', 0)),
                    "zd": _to_float(row.get('low', 0)),
                    "cjl": _to_int(row.get('vol', 0)),
                    "cje": round(amount_yuan, 2),
                    "zdf": _to_float(row.get('pct_chg', 0)),
                    "zde": _to_float(row.get('change', 0)),
                    "hsl": _to_float(row.get("turnover_rate", 0)),
                })

            # 根据 limit 裁剪，返回最近的数据
            if limit > 0 and len(klines) > limit:
                klines = klines[-limit:]

            return klines
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def _get_index_kline(secid: str, period: str = "daily", limit: int = 0) -> List[Dict[str, Any]]:
        """获取指数K线数据（index_daily/weekly/monthly）"""
        try:
            ts_code = convert_secid_to_ts_code(secid)
            end_date = datetime.now().strftime("%Y%m%d")

            if limit > 0:
                if period == 'daily':
                    days_needed = limit * 2 + 60
                    start_date = (datetime.now() - timedelta(days=days_needed)).strftime("%Y%m%d")
                elif period == 'weekly':
                    weeks_needed = limit * 2 + 10
                    start_date = (datetime.now() - timedelta(days=weeks_needed * 7)).strftime("%Y%m%d")
                elif period == 'monthly':
                    months_needed = limit * 2 + 6
                    start_date = (datetime.now() - timedelta(days=months_needed * 30)).strftime("%Y%m%d")
                else:
                    start_date = (datetime.now() - timedelta(days=limit * 2 + 60)).strftime("%Y%m%d")
            else:
                start_date = (datetime.now() - timedelta(days=365 * 3)).strftime("%Y%m%d")

            pro = get_pro()
            if period == 'daily':
                df = pro.index_daily(ts_code=ts_code, start_date=start_date, end_date=end_date)
            elif period == 'weekly':
                df = pro.index_weekly(ts_code=ts_code, start_date=start_date, end_date=end_date)
            elif period == 'monthly':
                df = pro.index_monthly(ts_code=ts_code, start_date=start_date, end_date=end_date)
            else:
                df = pro.index_daily(ts_code=ts_code, start_date=start_date, end_date=end_date)

            if df is None or df.empty:
                return {"error": "No data available"}

            df = df.sort_values('trade_date', ascending=True).reset_index(drop=True)

            klines = []
            for _, row in df.iterrows():
                date_val = row.get('trade_date', '')
                date_str = _standardize_date(date_val)
                # index_daily amount 单位也是千元 → 转为元
                amount_yuan = _to_float(row.get('amount', 0)) * 1000
                klines.append({
                    "date": date_str,
                    "kp": _to_float(row.get('open', 0)),
                    "sp": _to_float(row.get('close', 0)),
                    "zg": _to_float(row.get('high', 0)),
                    "zd": _to_float(row.get('low', 0)),
                    "cjl": _to_int(row.get('vol', 0)),
                    "cje": round(amount_yuan, 2),
                    "zdf": _to_float(row.get('pct_chg', 0)),
                    "zde": _to_float(row.get('change', 0)),
                    "hsl": 0,  # 指数没有换手率
                })

            if limit > 0 and len(klines) > limit:
                klines = klines[-limit:]

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

            # 补充换手率：merge daily_basic
            try:
                basic_df = pro.daily_basic(ts_code=ts_code, start_date=start_date, end_date=end_date)
                if basic_df is not None and not basic_df.empty:
                    df = df.merge(basic_df[['trade_date', 'turnover_rate']], on='trade_date', how='left')
            except Exception as e:
                print(f"[daily_basic 失败] {ts_code}: {e}")

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
    def _get_trend_from_163(secid: str) -> List[Dict[str, Any]]:
        """备用：从 163 获取分时数据，按分钟聚合"""
        if ak is None:
            return {"error": "akshare 未安装"}
        code = convert_secid_to_pure_code(secid)
        df = ak.stock_zh_a_tick_163(symbol=code)
        
        today = datetime.now().strftime('%Y-%m-%d')
        
        # 按分钟聚合
        minute_map = {}
        
        for _, row in df.iterrows():
            price = float(row.get("价格", 0) or 0)
            vol = int(row.get("成交量", 0) or 0)
            time_str = row.get("时间", "")
            
            if price <= 0 or vol <= 0:
                continue
            
            minute_key = time_str[:5] if len(time_str) >= 5 else time_str
            
            if minute_key not in minute_map:
                minute_map[minute_key] = {"prices": [], "vols": [], "last_price": price}
            minute_map[minute_key]["prices"].append(price)
            minute_map[minute_key]["vols"].append(vol)
            minute_map[minute_key]["last_price"] = price
        
        trends = []
        prev_minute_close = None
        total_money = 0
        total_vol = 0
        
        for minute_key in sorted(minute_map.keys()):
            data = minute_map[minute_key]
            prices = data["prices"]
            vols = data["vols"]
            current = data["last_price"]
            minute_vol = sum(vols)
            
            for p, v in zip(prices, vols):
                total_money += p * v * 100
            total_vol += minute_vol
            average = total_money / (total_vol * 100) if total_vol > 0 else current
            
            last = prev_minute_close if prev_minute_close is not None else current
            up = 1 if current >= last else -1
            
            trends.append({
                "datetime": f"{today} {minute_key}",
                "current": current,
                "last": last,
                "vol": minute_vol,
                "average": round(average, 2),
                "up": up,
            })
            prev_minute_close = current
        
        return trends

    @staticmethod
    def get_stock_trend(secid: str) -> List[Dict[str, Any]]:
        """
        获取分时走势数据 - 使用腾讯财经数据源
        
        腾讯接口返回分笔成交数据，需按分钟聚合成与东财一致的分钟数据
        """
        if ak is None:
            return {"error": "akshare 未安装，无法获取分时数据"}
        try:
            symbol = convert_secid_to_tx_symbol(secid)
            df = ak.stock_zh_a_tick_tx_js(symbol=symbol)
            
            if df.empty:
                return {"error": "No trend data available"}
            
            today = datetime.now().strftime('%Y-%m-%d')
            
            # 按分钟聚合分笔数据
            minute_map = {}  # key: "HH:MM", value: {"prices": [], "vols": [], "last_price": 0}
            
            for _, row in df.iterrows():
                price = float(row.get("成交价格", 0) or 0)
                vol = int(row.get("成交量", 0) or 0)
                time_str = row.get("成交时间", "")
                
                if price <= 0 or vol <= 0:
                    continue
                
                # 提取分钟级时间 "HH:MM"
                minute_key = time_str[:5] if len(time_str) >= 5 else time_str
                
                if minute_key not in minute_map:
                    minute_map[minute_key] = {
                        "prices": [],
                        "vols": [],
                        "last_price": price,
                    }
                minute_map[minute_key]["prices"].append(price)
                minute_map[minute_key]["vols"].append(vol)
                minute_map[minute_key]["last_price"] = price
            
            # 按时间排序并生成分钟级趋势数据
            trends = []
            prev_minute_close = None
            total_money = 0
            total_vol = 0
            
            for minute_key in sorted(minute_map.keys()):
                data = minute_map[minute_key]
                prices = data["prices"]
                vols = data["vols"]
                current = data["last_price"]  # 该分钟最后一笔价格作为收盘价
                minute_vol = sum(vols)
                
                # 累计成交额和成交量，计算均价
                for p, v in zip(prices, vols):
                    total_money += p * v * 100
                total_vol += minute_vol
                average = total_money / (total_vol * 100) if total_vol > 0 else current
                
                # last: 上一分钟的收盘价
                last = prev_minute_close if prev_minute_close is not None else current
                up = 1 if current >= last else -1
                
                # datetime 格式与东财一致: "YYYY-MM-DD HH:MM"
                trends.append({
                    "datetime": f"{today} {minute_key}",
                    "current": current,
                    "last": last,
                    "vol": minute_vol,
                    "average": round(average, 2),
                    "up": up,
                })
                prev_minute_close = current
            
            return trends
        except Exception as e:
            try:
                return TushareAPI._get_trend_from_163(secid)
            except:
                return {"error": str(e)}


    @staticmethod
    def get_sector_boards(bk_type: str = "industry", data_source: str = "dc") -> List[Dict[str, Any]]:
        """获取板块列表

        data_source: dc-东财数据, ths-同花顺数据

        东财(dc_index) 返回字段：ts_code, name, idx_type, trade_date, open, close, high, low,
        pre_close, avg_price, change, pct_change, volume, amount, total_mv, float_mv,
        turnover_rate, up_num, down_num, flat_num

        同花顺(moneyflow_ind_ths/moneyflow_cnt_ths) 返回字段：
        trade_date, ts_code, name/industry, lead_stock, close_price, pct_change,
        company_num, net_buy_amount, net_sell_amount, net_amount(亿元)

        补充资金流向：
        - 东财：moneyflow_ind_dc（行业）/ moneyflow_con_dc（概念）
        - 同花顺：moneyflow_ind_ths（行业）/ moneyflow_cnt_ths（概念）
        返回今日主力净流入(main_in) 和 最近5日主力净流入(main_in_5d)
        """
        try:
            pro = get_pro()
            today = datetime.now().strftime('%Y%m%d')

            if data_source == "ths":
                # ========== 同花顺数据源 ==========
                # 行业板块用 moneyflow_ind_ths，概念板块用 moneyflow_cnt_ths
                if bk_type == "industry":
                    df = safe_api_call(pro.moneyflow_ind_ths, trade_date=today)
                else:
                    df = safe_api_call(pro.moneyflow_cnt_ths, trade_date=today)

                if isinstance(df, dict) and df.get("error"):
                    return df
                if df is None or (isinstance(df, pd.DataFrame) and df.empty):
                    return {"error": "No data"}

                boards = []
                for _, row in df.iterrows():
                    ts_code = str(row.get("ts_code", ""))
                    # 同花顺板块代码格式如 885748.TI，去掉 .TI 后缀
                    code = ts_code.replace(".TI", "").replace(".ti", "") if ".TI" in ts_code or ".ti" in ts_code else ts_code
                    name = str(row.get("name", row.get("industry", "")))
                    # net_amount 单位为亿元，转换为元
                    net_amount = _to_float(row.get("net_amount", 0))
                    # 安全处理：如果数值绝对值小于 1e6 且不为 0，视为亿元需要转换
                    # 否则保持原值（元）
                    if abs(net_amount) > 0 and abs(net_amount) < 1e6:
                        net_amount = net_amount * 1e8

                    boards.append({
                        "code": code,
                        "name": name,
                        "zx": _to_float(row.get("close", row.get("close_price", 0))),
                        "zdd": 0,
                        "zdf": _to_float(row.get("pct_change", 0)),
                        "hsl": 0,
                        "zsz": 0,
                        "lt": 0,
                        "cje": 0,
                        "cjl": 0,
                        "szs": 0,
                        "xds": 0,
                        "main_in": net_amount,
                        "main_in_5d": 0,
                        "source": "ths",
                    })
                return {
                    "boards": boards,
                    "count": len(boards),
                }

            # ========== 东财数据源（默认） ==========
            idx_type = "行业板块" if bk_type == "industry" else "概念板块"
            df = cached_api_call("dc_index", 24, pro.dc_index, idx_type=idx_type)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or (isinstance(df, pd.DataFrame) and df.empty):
                return {"error": "No data"}

            # 去重：同一板块可能在接口返回中重复出现
            df = df.drop_duplicates(subset=['ts_code'], keep='first')

            # 获取资金流向数据
            start_date = (datetime.now() - timedelta(days=10)).strftime('%Y%m%d')

            # 行业板块用 moneyflow_ind_dc，概念板块用 moneyflow_con_dc
            if bk_type == "industry":
                flow_df = safe_api_call(pro.moneyflow_ind_dc, start_date=start_date, end_date=today)
            else:
                flow_df = safe_api_call(pro.moneyflow_con_dc, start_date=start_date, end_date=today)

            today_flow_map: Dict[str, float] = {}
            flow_5d_map: Dict[str, float] = {}

            if flow_df is not None and not (isinstance(flow_df, dict) and flow_df.get("error")) and not flow_df.empty:
                # 获取最近5个交易日的日期（降序）
                dates = sorted(flow_df['trade_date'].astype(str).unique(), reverse=True)[:5]
                for _, row in flow_df.iterrows():
                    ts_code = str(row.get("ts_code", ""))
                    date = str(row.get("trade_date", ""))
                    net_amount = _to_float(row.get("net_amount", 0))
                    if date == dates[0]:  # 最新日期（今日）
                        today_flow_map[ts_code] = net_amount
                    if date in dates:  # 最近5日累加
                        flow_5d_map[ts_code] = flow_5d_map.get(ts_code, 0) + net_amount

            boards = []
            for _, row in df.iterrows():
                ts_code = str(row.get("ts_code", ""))
                code = ts_code.replace(".DC", "") if ".DC" in ts_code else ts_code
                boards.append({
                    "code": code,
                    "name": str(row.get("name", "")),
                    "zx": _to_float(row.get("close", 0)),        # 收盘价作为最新价
                    "zdd": _to_float(row.get("change", 0)),       # 涨跌额
                    "zdf": _to_float(row.get("pct_change", 0)),     # 涨跌幅
                    "hsl": _to_float(row.get("turnover_rate", 0)), # 换手率
                    "zsz": _to_float(row.get("total_mv", 0)),     # 总市值
                    "lt": _to_float(row.get("float_mv", 0)),      # 流通市值
                    "cje": _to_float(row.get("amount", 0)),       # 成交额
                    "cjl": _to_int(row.get("volume", 0)),         # 成交量
                    "szs": _to_int(row.get("up_num", 0)),         # 上涨家数
                    "xds": _to_int(row.get("down_num", 0)),        # 下跌家数
                    "main_in": today_flow_map.get(ts_code, 0),     # 今日主力净流入（元）
                    "main_in_5d": flow_5d_map.get(ts_code, 0),     # 5日主力净流入（元）
                    "source": "dc",
                })
            return {
                "boards": boards,
                "count": len(boards),
            }
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_board_stocks(secid: str) -> Dict[str, Any]:
        """获取东财板块成分股（dc_member，6000积分）
        
        返回字段补全：通过 daily + daily_basic 获取最新行情
        """
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

            # 提取成分股代码列表，并构造 ts_code
            stock_ts_codes = []
            member_map = {}  # ts_code -> {code, name, market, secid}
            for _, row in df.iterrows():
                con_code = str(row.get("con_code", ""))
                stock_code = con_code.split(".")[0] if "." in con_code else con_code
                if not stock_code:
                    continue
                market = 1 if stock_code.startswith("6") else 0
                member_ts = f"{stock_code}.{'SH' if stock_code.startswith('6') else 'SZ'}"
                stock_ts_codes.append(member_ts)
                member_map[member_ts] = {
                    "code": stock_code,
                    "name": str(row.get("name", "")),
                    "market": market,
                    "secid": f"{market}.{stock_code}",
                }

            # 批量获取全市场当日行情（只传 trade_date，不传 ts_code）
            market_data = {}
            try:
                daily_df = pro.daily(trade_date=trade_date)
                if daily_df is not None and not daily_df.empty:
                    for _, row in daily_df.iterrows():
                        tc = str(row.get("ts_code", ""))
                        if tc in member_map:
                            market_data[tc] = {
                                "zx": _to_float(row.get("close", 0)),
                                "zdf": _to_float(row.get("pct_chg", 0)),
                                "zdd": _to_float(row.get("change", 0)),
                                "zg": _to_float(row.get("high", 0)),
                                "zd": _to_float(row.get("low", 0)),
                                "jk": _to_float(row.get("open", 0)),
                                "zs": _to_float(row.get("pre_close", 0)),
                                "cjl": _to_int(row.get("vol", 0)),
                                "cje": round(_to_float(row.get("amount", 0)) * 1000, 2),
                            }
            except Exception as e:
                print(f"[daily 批量查询失败] {e}")

            # 批量获取全市场当日基础指标（换手率、市盈率、市净率、市值）
            try:
                basic_df = pro.daily_basic(trade_date=trade_date)
                if basic_df is not None and not basic_df.empty:
                    for _, row in basic_df.iterrows():
                        tc = str(row.get("ts_code", ""))
                        if tc in member_map and tc in market_data:
                            market_data[tc].update({
                                "hsl": _to_float(row.get("turnover_rate", 0)),
                                "syl": _to_float(row.get("pe_ttm", row.get("pe", 0))),
                                "sjl": _to_float(row.get("pb", 0)),
                                "sz": round(_to_float(row.get("total_mv", 0)) / 10000, 2),   # 万元 → 亿元
                                "lt": round(_to_float(row.get("circ_mv", 0)) / 10000, 2),   # 万元 → 亿元
                            })
            except Exception as e:
                print(f"[daily_basic 批量查询失败] {e}")

            stocks = []
            for member_ts, info in member_map.items():
                md = market_data.get(member_ts, {})
                zx = md.get("zx", 0)
                zs = md.get("zs", 0)
                # 振幅 = (high - low) / pre_close * 100
                zf = round((md.get("zg", 0) - md.get("zd", 0)) / zs * 100, 2) if zs > 0 else 0
                # 量比：daily_basic 才有，这里暂不计算，保持为 0
                stocks.append({
                    "code": info["code"],
                    "name": info["name"],
                    "secid": info["secid"],
                    "zx": zx,
                    "zdf": md.get("zdf", 0),
                    "zdd": md.get("zdd", 0),
                    "cjl": md.get("cjl", 0),
                    "cje": md.get("cje", 0),
                    "zf": zf,
                    "zg": md.get("zg", 0),
                    "zd": md.get("zd", 0),
                    "jk": md.get("jk", 0),
                    "zs": zs,
                    "lb": 0,
                    "hsl": md.get("hsl", 0),
                    "syl": md.get("syl", 0),
                    "sjl": md.get("sjl", 0),
                    "sz": md.get("sz", 0),
                    "lt": md.get("lt", 0),
                    "cm5": 0,
                    "cd60": 0,
                    "cy1": 0,
                    "cs": 0,
                })

            # if count > 0 and len(stocks) > count:
            #     stocks = stocks[:count]
            return {"total": len(df), "stocks": stocks}
        except Exception as e:
            return {"error": str(e)}

    # ------------------ 涨跌停数据 ------------------

    @staticmethod
    def get_limit_up_stocks(date: Optional[str] = None) -> List[Dict[str, Any]]:
        """获取涨停股票列表（limit_list，2000积分）

        limit_list 返回字段：ts_code, name, close, pct_chg, amp, fc_ratio, fl_ratio, 
        fd_amount, first_time, last_time, open_times, strth, limit
        """
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
                if str(row.get('limit', '')) == 'U':
                    # first_time/last_time 格式为 HHMMSS，转换为 HH:MM:SS
                    ft = str(row.get("first_time", ""))
                    lt = str(row.get("last_time", ""))
                    fbt = f"{ft[:2]}:{ft[2:4]}:{ft[4:]}" if len(ft) == 6 else ft
                    lbt = f"{lt[:2]}:{lt[2:4]}:{lt[4:]}" if len(lt) == 6 else lt
                    stocks.append({
                        "code": str(row.get("ts_code", "")).split('.')[0],
                        "name": str(row.get("name", "")),
                        "zx": _to_float(row.get("close", 0)),
                        "zdf": _to_float(row.get("pct_chg", 0)),
                        "lbc": 0,  # limit_list 无连板数字段
                        "fbt": fbt,
                        "lbt": lbt,
                        "zbc": _to_int(row.get("open_times", 0)),
                        "fbf": _to_float(row.get("fd_amount", 0)),
                    })
            return stocks
        except Exception as e:
            return {"error": str(e)}


    @staticmethod
    def get_limit_down_stocks(date: Optional[str] = None) -> List[Dict[str, Any]]:
        """获取跌停股票列表（limit_list，2000积分）"""
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
                        "dtdays": 0,  # limit_list 无连续跌停字段
                    })
            return stocks
        except Exception as e:
            return {"error": str(e)}


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
        """获取资金流向：个股用 moneyflow，板块用 moneyflow_ind_dc（东财，6000积分）

        moneyflow_ind_dc 返回字段：
        buy_sm_amount/sell_sm_amount(小单买/卖), buy_md_amount/sell_md_amount(中单买/卖),
        buy_lg_amount/sell_lg_amount(大单买/卖), buy_elg_amount/sell_elg_amount(特大单买/卖),
        net_amount(净流入), net_amount_rate(净流入占比)
        净流入 = 买入金额 - 卖出金额
        """
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
                # 计算各档位净流入 = 买入 - 卖出
                small_in = _to_float(row.get("buy_sm_amount", 0)) - _to_float(row.get("sell_sm_amount", 0))
                medium_in = _to_float(row.get("buy_md_amount", 0)) - _to_float(row.get("sell_md_amount", 0))
                big_in = _to_float(row.get("buy_lg_amount", 0)) - _to_float(row.get("sell_lg_amount", 0))
                super_big_in = _to_float(row.get("buy_elg_amount", 0)) - _to_float(row.get("sell_elg_amount", 0))
                return {
                    "main_in": _to_float(row.get("net_amount", 0)),
                    "small_in": round(small_in, 2),
                    "medium_in": round(medium_in, 2),
                    "big_in": round(big_in, 2),
                    "super_big_in": round(super_big_in, 2),
                    "main_rate": _to_float(row.get("net_amount_rate", 0)),
                    "source": "dc",
                }
            else:
                # 个股资金流向：Tushare 标准 moneyflow（直接返回净流入）
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