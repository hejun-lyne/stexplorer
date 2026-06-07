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
        # 东财指数/板块：market == 2，使用 .DC 后缀（如 931068.DC）
        if mk == "2":
            return f"{code}.DC"
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
    """判断是否为指数代码（上证指数、深证指数、创业板指、东财指数等）"""
    if "." in secid:
        mk, code = secid.split(".")
        # 深市指数：399xxx（如创业板指 399006，深证成指 399001）
        if code.startswith("399"):
            return True
        # 沪市指数：000xxx 系列且 market == 1（如上证指数 1.000001，中证500 1.000905）
        # 注意：000xxx 深市个股 market == 0（如平安银行 0.000001）
        if code.startswith("000") and mk == "1":
            return True
        # 东财指数：market == 2（如消费龙头 2.931068）
        if mk == "2":
            return True
        # 其他指数（国证、中证等）：market == 0/1 且以 9 开头的 6 位数字代码
        # 如 0.980017（国证芯片）、1.930606（中证创新药）等
        # A 股个股代码不以 9 开头，因此不会误判
        if mk in ("0", "1") and code.startswith("9") and len(code) == 6 and code.isdigit():
            return True
    return False


def _standardize_date(d: Any) -> str:
    """标准化日期格式为 YYYY-MM-DD"""
    if d is None or d == '':
        return ''
    if hasattr(d, 'strftime'):
        return d.strftime('%Y-%m-%d')
    if isinstance(d, date):
        return d.strftime('%Y-%m-%d')
    if isinstance(d, datetime):
        return d.strftime('%Y-%m-%d')
    s = str(d).strip()
    # YYYYMMDD
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    # YYYY-MM-DD, YYYY-M-D, YYYY/MM/DD 等变体
    import re
    m = re.match(r'(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})', s)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return s


def _parse_date_str(date_str: str) -> Optional[date]:
    """将日期字符串解析为 datetime.date 对象，解析失败返回 None"""
    if not date_str:
        return None
    standardized = _standardize_date(date_str)
    try:
        return datetime.strptime(standardized, '%Y-%m-%d').date()
    except ValueError:
        return None


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

def set_cache_dir(storage_path: str):
    """设置缓存根目录，使用应用本地存储路径下的 tushare_cache 子目录"""
    global _CACHE_DIR
    if storage_path:
        _CACHE_DIR = os.path.join(storage_path, "tushare_cache")
    os.makedirs(_CACHE_DIR, exist_ok=True)

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


def _get_expected_last_trade_date(period: str = "daily") -> str:
    """获取各周期K线数据期望包含的最新日期（用于缓存有效性判断）

    日线：最近一个交易日
    周线：最近一个交易周的起始（最近5个交易日中的第一个）
    月线：最近一个交易月的起始（最近22个交易日中的第一个）
    """
    try:
        today = datetime.now()
        cal_start = (today - timedelta(days=90)).strftime('%Y%m%d')
        cal_end = today.strftime('%Y%m%d')
        pro = get_pro()
        cal_df = pro.trade_cal(exchange='SSE', start_date=cal_start, end_date=cal_end, is_open='1')
        if cal_df is None or cal_df.empty:
            return today.strftime('%Y-%m-%d')

        trade_dates = sorted([_standardize_date(d) for d in cal_df['cal_date']])

        if period == 'daily':
            return _standardize_date(trade_dates[-1])
        elif period == 'weekly':
            if len(trade_dates) >= 5:
                return _standardize_date(trade_dates[-5])
            else:
                return _standardize_date(trade_dates[0])
        elif period == 'monthly':
            if len(trade_dates) >= 22:
                return _standardize_date(trade_dates[-22])
            else:
                return _standardize_date(trade_dates[0])
        else:
            return _standardize_date(trade_dates[-1])
    except Exception as e:
        print(f"[_get_expected_last_trade_date 失败] {period}: {e}")
        return datetime.now().strftime('%Y-%m-%d')


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


def _get_stock_basic_maps() -> tuple[Dict[str, str], Dict[str, str]]:
    """获取股票基本信息映射（名称 + 行业），带本地缓存（7天）"""
    cache_key = "stock_basic_all"
    cached = read_cache(cache_key, max_age_hours=168)
    if cached and isinstance(cached, dict):
        return cached.get("name_map", {}), cached.get("industry_map", {})

    name_map: Dict[str, str] = {}
    industry_map: Dict[str, str] = {}
    try:
        pro = get_pro()
        basic_df = pro.stock_basic(exchange='', list_status='L', fields='ts_code,name,industry')
        if basic_df is not None and not basic_df.empty:
            for _, row in basic_df.iterrows():
                tc = str(row['ts_code'])
                name_map[tc] = str(row['name'])
                industry_map[tc] = str(row.get('industry', ''))
            write_cache(cache_key, {"name_map": name_map, "industry_map": industry_map})
    except Exception:
        pass
    return name_map, industry_map


# ============ 同花顺板块成分股辅助函数 ============

def _get_ths_cookie() -> str:
    """获取同花顺 cookie v_code（从 akshare 的 ths.js）"""
    try:
        from py_mini_racer import MiniRacer
        import os
        ths_js_paths = [
            os.path.expanduser("~/Library/Python/3.9/lib/python/site-packages/akshare/data/ths.js"),
            "/usr/local/lib/python3.9/site-packages/akshare/data/ths.js",
            "/usr/lib/python3.9/site-packages/akshare/data/ths.js",
        ]
        js_content = None
        for path in ths_js_paths:
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    js_content = f.read()
                break
        if not js_content:
            return ""
        js_code = MiniRacer()
        js_code.eval(js_content)
        return js_code.call("v")
    except Exception:
        return ""


def _get_board_stocks_from_ths(code: str) -> List[Dict[str, Any]]:
    """从同花顺网页获取板块成分股"""
    if requests is None:
        return []
    try:
        v_code = _get_ths_cookie()
        if not v_code:
            return []
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Cookie": f"v={v_code}",
        }
        if code.startswith("88"):
            url = f"https://q.10jqka.com.cn/thshy/detail/code/{code}/"
            headers["Referer"] = "https://q.10jqka.com.cn/thshy/"
        elif code.startswith("3"):
            url = f"https://q.10jqka.com.cn/gn/detail/code/{code}/"
            headers["Referer"] = "https://q.10jqka.com.cn/gn/"
        else:
            return []
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(response.text, "lxml")
        table = soup.find("table")
        if not table:
            return []
        stocks = []
        rows = table.find_all("tr")
        for row in rows[1:]:
            cols = row.find_all("td")
            if len(cols) < 5:
                continue
            stock_code = cols[1].text.strip()
            name = cols[2].text.strip()
            if not stock_code or not stock_code.isdigit():
                continue
            market = 1 if stock_code.startswith("6") else 0
            try:
                zx = float(cols[3].text.strip() or 0)
            except ValueError:
                zx = 0
            try:
                zdf = float(cols[4].text.strip().replace("%", "") or 0)
            except ValueError:
                zdf = 0
            stocks.append({
                "code": stock_code,
                "name": name,
                "secid": f"{market}.{stock_code}",
                "zx": zx,
                "zdf": zdf,
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
        return stocks
    except Exception as e:
        print(f"同花顺板块成分股获取失败: {code}, {e}")
        return []


# ============ API 封装类 ============

class TushareAPI:
    """Tushare Pro 接口封装类（6000 积分版）"""

    # ------------------ 交易日历 ------------------

    @staticmethod
    def get_trade_dates(year: Optional[int] = None) -> List[str]:
        try:
            target_year = year if year is not None else datetime.now().year
            cache_key = _cache_key("trade_dates", year=target_year)
            # 历史年份缓存 1 年，当前年份缓存 7 天
            max_age = 8760 if target_year < datetime.now().year else 168
            cached = read_cache(cache_key, max_age_hours=max_age)
            if cached is not None:
                return cached

            pro = get_pro()
            start_date = f"{target_year}0101"
            end_date = f"{target_year}1231"
            df = pro.trade_cal(exchange='SSE', start_date=start_date, end_date=end_date, is_open='1')
            if df is None or df.empty:
                return []
            df['cal_date'] = pd.to_datetime(df['cal_date'])
            result = {"dates": df['cal_date'].dt.strftime('%Y-%m-%d').tolist()}
            write_cache(cache_key, result)
            return result
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
    def get_kline_data(secid: str, period: str = "daily", adjust: str = "qfq", limit: int = 0, end_date: Optional[str] = None) -> List[Dict[str, Any]]:
        """获取个股K线数据（Tushare pro_bar / daily / weekly / monthly）

        参数:
            secid: 标的ID，如 "1.600000"
            period: daily/weekly/monthly
            adjust: qfq-前复权, hfq-后复权, 空字符串-不复权
            limit: 限制返回条数，0 表示不限制，>0 表示返回最近 limit 条
            end_date: 截止日期(YYYY-MM-DD 或 YYYYMMDD)，不传则默认为今天

        注意：
        - Tushare daily/weekly/monthly 接口的 amount 单位是"千元"，需×1000 转为元
        - 返回数据按日期升序排列（最早日期在前），与东财接口保持一致
        - pro_bar 优先调用，失败则 fallback 到 daily + adj_factor 手动复权
        - 支持磁盘缓存：缓存 key 为 kline_{secid}_{period}_{adjust}，与 limit/end_date 无关
              缓存检查逻辑：看最后一条 K 线日期是否满足需求，命中后按 limit/end_date 裁剪
        """
        end_date_std = _standardize_date(end_date) if end_date else ''
        end_date_fmt = end_date_std.replace('-', '') if end_date_std else datetime.now().strftime("%Y%m%d")

        # 统一缓存 key，与 limit/end_date 无关
        cache_key = f"kline_{secid}_{period}_{adjust}"
        cached = read_cache(cache_key, max_age_hours=168 * 4)  # 缓存最长4周

        def _is_cache_sufficient(cached_data: List[Dict]) -> bool:
            """检查缓存数据是否满足当前查询需求"""
            if not isinstance(cached_data, list) or not cached_data:
                return False
            last_date_str = cached_data[-1].get('date', '')
            last_date = _parse_date_str(last_date_str)
            if not last_date:
                return False
            if not end_date_std:
                # 未指定 end_date：检查是否包含最新交易日
                expected_last_str = _get_expected_last_trade_date(period)
                expected_last = _parse_date_str(expected_last_str)
                return expected_last is not None and last_date >= expected_last
            else:
                # 指定了 end_date：检查缓存是否覆盖到 end_date
                end_date_dt = _parse_date_str(end_date_std)
                return end_date_dt is not None and last_date >= end_date_dt

        def _slice_from_cache(cached_data: List[Dict]) -> List[Dict]:
            """从缓存数据中按 end_date 和 limit 裁剪"""
            data = cached_data[:]
            if end_date_std:
                end_date_dt = _parse_date_str(end_date_std)
                if end_date_dt:
                    # 保留 <= end_date 的数据
                    data = [k for k in data if _parse_date_str(k.get('date', '')) <= end_date_dt]
            if limit > 0 and len(data) > limit:
                data = data[-limit:]
            return data

        # 尝试命中缓存
        if _is_cache_sufficient(cached):
            need_str = end_date_std or _get_expected_last_trade_date(period)
            print(f"[K线缓存命中] {secid} {period} 缓存覆盖到 {cached[-1].get('date')} >= 需求={need_str}")
            return _slice_from_cache(cached)
        elif isinstance(cached, list) and cached:
            print(f"[K线缓存过期/不足] {secid} {period} 缓存最后={cached[-1].get('date')} < 需求={end_date_std or _get_expected_last_trade_date(period)}")

        try:
            if is_board_code(secid):
                result = TushareAPI._get_board_kline(secid, period)
                # 板块 K 线不走统一缓存
                return result

            if is_index_code(secid):
                result = TushareAPI._get_index_kline(secid, period, limit, end_date_fmt)
                # 指数 K 线不走统一缓存
                return result

            code = convert_secid_to_pure_code(secid)
            ts_code = convert_secid_to_ts_code(secid)

            # 计算 start_date：基于 end_date_fmt 往前推足够大的范围
            # 缓存策略：尽可能多存数据，让后续不同 limit 的查询都能命中
            end_dt = datetime.strptime(end_date_fmt, "%Y%m%d")
            if limit > 0:
                if period == 'daily':
                    days_needed = limit * 2 + 60  # 2倍+60天缓冲，应对长假
                    start_date = (end_dt - timedelta(days=days_needed)).strftime("%Y%m%d")
                elif period == 'weekly':
                    weeks_needed = limit * 2 + 10  # 2倍+10周缓冲
                    start_date = (end_dt - timedelta(days=weeks_needed * 7)).strftime("%Y%m%d")
                elif period == 'monthly':
                    months_needed = limit * 2 + 6  # 2倍+6月缓冲
                    start_date = (end_dt - timedelta(days=months_needed * 30)).strftime("%Y%m%d")
                else:
                    start_date = (end_dt - timedelta(days=limit * 2 + 60)).strftime("%Y%m%d")
            else:
                start_date = (end_dt - timedelta(days=365 * 3)).strftime("%Y%m%d")  # 默认3年

            pro = get_pro()
            freq_map = {'daily': 'D', 'weekly': 'W', 'monthly': 'M'}
            freq = freq_map.get(period, 'D')

            # 1. 优先使用 pro_bar 获取复权数据（一站式接口）
            df = None
            try:
                df = ts.pro_bar(ts_code=ts_code, freq=freq, adj=adjust, start_date=start_date, end_date=end_date_fmt)
            except Exception as e:
                print(f"[pro_bar 失败] {ts_code}: {e}")

            # 2. pro_bar 失败，fallback 到基础接口 + 手动复权
            if df is None or df.empty:
                if period == 'daily':
                    df = pro.daily(ts_code=ts_code, start_date=start_date, end_date=end_date_fmt)
                elif period == 'weekly':
                    df = pro.weekly(ts_code=ts_code, start_date=start_date, end_date=end_date_fmt)
                elif period == 'monthly':
                    df = pro.monthly(ts_code=ts_code, start_date=start_date, end_date=end_date_fmt)
                else:
                    df = pro.daily(ts_code=ts_code, start_date=start_date, end_date=end_date_fmt)

                # 手动复权
                if adjust in ('qfq', 'hfq') and df is not None and not df.empty:
                    try:
                        adj_df = pro.adj_factor(ts_code=ts_code, start_date=start_date, end_date=end_date_fmt)
                        if adj_df is not None and not adj_df.empty:
                            df = df.merge(adj_df[['trade_date', 'adj_factor']], on='trade_date', how='left')
                            base_factor = df['adj_factor'].iloc[-1] if adjust == 'qfq' else df['adj_factor'].iloc[0]
                            for col in ['open', 'high', 'low', 'close']:
                                df[col] = df[col] * df['adj_factor'] / base_factor
                    except Exception as e:
                        print(f"[手动复权失败] {ts_code}: {e}")

            if df is None or df.empty:
                # 请求无数据时，如果有缓存则返回过期缓存（降级）
                if isinstance(cached, list) and cached:
                    print(f"[K线请求无数据，返回过期缓存] {secid} {period}")
                    return _slice_from_cache(cached)
                return {"error": "No data available"}

            # Tushare 默认返回降序（最新日期在前），需转为升序（最早日期在前）
            df = df.sort_values('trade_date', ascending=True).reset_index(drop=True)

            # 补充换手率：merge daily_basic
            try:
                basic_df = pro.daily_basic(ts_code=ts_code, start_date=start_date, end_date=end_date_fmt)
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

            # 合并新旧缓存（扩大缓存范围）
            merged = TushareAPI._merge_klines(cached if isinstance(cached, list) else [], klines)
            if merged:
                write_cache(cache_key, merged)
                print(f"[K线缓存更新] {secid} {period} 合并后 {len(merged)} 条 ({merged[0].get('date')} ~ {merged[-1].get('date')})")

            # 从合并后的数据中按 limit/end_date 裁剪返回
            return _slice_from_cache(merged if merged else klines)
        except Exception as e:
            # 请求失败时，如果有缓存则返回过期缓存（降级）
            if isinstance(cached, list) and cached:
                print(f"[K线请求失败，返回过期缓存] {secid} {period}: {e}")
                return _slice_from_cache(cached)
            return {"error": str(e)}

    @staticmethod
    def _merge_klines(old: List[Dict[str, Any]], new: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """合并新旧 K 线数据，按日期去重，升序排列"""
        if not old:
            return new
        if not new:
            return old
        date_map: Dict[str, Dict[str, Any]] = {}
        for k in old:
            d = k.get('date', '')
            if d:
                date_map[d] = k
        for k in new:
            d = k.get('date', '')
            if d:
                date_map[d] = k
        sorted_dates = sorted(date_map.keys())
        return [date_map[d] for d in sorted_dates]

    @staticmethod
    def get_kline_data_batch(secids: List[str], period: str = "daily", adjust: str = "qfq", limit: int = 0, end_date: Optional[str] = None) -> Dict[str, Any]:
        """批量获取K线，使用线程池并发，减少单只串行等待"""
        from concurrent.futures import ThreadPoolExecutor, as_completed
        import time
        
        results = {}
        t0 = time.time()
        
        def fetch_one(secid: str) -> tuple:
            return secid, TushareAPI.get_kline_data(secid, period, adjust, limit, end_date)
        
        # 并发数设为8，避免Tushare限流
        with ThreadPoolExecutor(max_workers=8) as executor:
            future_map = {executor.submit(fetch_one, sid): sid for sid in secids}
            for future in as_completed(future_map):
                sid, data = future.result()
                results[sid] = data
        
        print(f"[PerfPython] batch {len(secids)}只: {(time.time()-t0)*1000:.1f}ms")
        return results
    
    @staticmethod
    def _get_index_kline(secid: str, period: str = "daily", limit: int = 0, end_date: Optional[str] = None) -> List[Dict[str, Any]]:
        """获取指数K线数据（index_daily/weekly/monthly）"""
        try:
            ts_code = convert_secid_to_ts_code(secid)
            end_date_std = _standardize_date(end_date) if end_date else ''
            end_date_fmt = end_date_std.replace('-', '') if end_date_std else datetime.now().strftime("%Y%m%d")

            end_dt = datetime.strptime(end_date_fmt, "%Y%m%d")
            if limit > 0:
                if period == 'daily':
                    days_needed = limit * 2 + 60
                    start_date = (end_dt - timedelta(days=days_needed)).strftime("%Y%m%d")
                elif period == 'weekly':
                    weeks_needed = limit * 2 + 10
                    start_date = (end_dt - timedelta(days=weeks_needed * 7)).strftime("%Y%m%d")
                elif period == 'monthly':
                    months_needed = limit * 2 + 6
                    start_date = (end_dt - timedelta(days=months_needed * 30)).strftime("%Y%m%d")
                else:
                    start_date = (end_dt - timedelta(days=limit * 2 + 60)).strftime("%Y%m%d")
            else:
                start_date = (end_dt - timedelta(days=365 * 3)).strftime("%Y%m%d")

            pro = get_pro()
            if period == 'daily':
                df = pro.index_daily(ts_code=ts_code, start_date=start_date, end_date=end_date_fmt)
            elif period == 'weekly':
                df = pro.index_weekly(ts_code=ts_code, start_date=start_date, end_date=end_date_fmt)
            elif period == 'monthly':
                df = pro.index_monthly(ts_code=ts_code, start_date=start_date, end_date=end_date_fmt)
            else:
                df = pro.index_daily(ts_code=ts_code, start_date=start_date, end_date=end_date_fmt)

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
            today = datetime.now().strftime("%Y%m%d")
            # 用 trade_cal 获取最近交易日，避免非交易日导致 dc_daily 返回空
            trade_date = today
            try:
                cal_df = pro.trade_cal(exchange='SSE', start_date=(datetime.now() - timedelta(days=30)).strftime('%Y%m%d'), end_date=today, is_open='1')
                if cal_df is not None and not cal_df.empty:
                    trade_date = str(cal_df['cal_date'].iloc[-1])
            except Exception:
                pass
            start_date = (datetime.now() - timedelta(days=730)).strftime("%Y%m%d")

            # dc_daily 需要 BKxxxx.DC 格式
            ts_code = f"{code}.DC" if not code.endswith(".DC") else code

            # 先尝试带 start_date/end_date 查询
            df = cached_api_call(f"dc_daily_{ts_code}_{start_date}_{trade_date}", 24, pro.dc_daily,
                                  ts_code=ts_code, start_date=start_date, end_date=trade_date)
            debug_info = {
                "ts_code": ts_code,
                "start_date": start_date,
                "end_date": trade_date,
                "query_type": "range",
                "df_type": type(df).__name__,
            }
            if isinstance(df, pd.DataFrame):
                debug_info["df_shape"] = df.shape
                if not df.empty:
                    debug_info["date_range"] = [str(df['trade_date'].min()), str(df['trade_date'].max())]

            # 如果 range 查询返回空，尝试逐日查询最近5天
            if df is None or (isinstance(df, pd.DataFrame) and df.empty):
                debug_info["range_empty"] = True
                range_dfs = []
                try:
                    cal_df = pro.trade_cal(exchange='SSE', start_date=(datetime.now() - timedelta(days=10)).strftime('%Y%m%d'), end_date=today, is_open='1')
                    if cal_df is not None and not cal_df.empty:
                        recent_dates = cal_df['cal_date'].astype(str).tolist()[-5:]
                        for td in recent_dates:
                            day_df = safe_api_call(pro.dc_daily, ts_code=ts_code, trade_date=td)
                            if isinstance(day_df, pd.DataFrame) and not day_df.empty:
                                range_dfs.append(day_df)
                        if range_dfs:
                            df = pd.concat(range_dfs, ignore_index=True)
                            debug_info["query_type"] = "daily_concat"
                            debug_info["concat_dates"] = recent_dates
                            debug_info["df_shape"] = df.shape
                except Exception as e:
                    debug_info["daily_query_error"] = str(e)

            if isinstance(df, dict) and df.get("error"):
                return {"error": df.get("error"), "debug": debug_info}
            if df is None or (isinstance(df, pd.DataFrame) and df.empty):
                return {"error": "No data available", "debug": debug_info}

            # 按日期升序排列
            df = df.sort_values('trade_date', ascending=True).reset_index(drop=True)

            # 补充换手率：merge daily_basic（板块代码可能不支持，忽略错误）
            try:
                basic_df = pro.daily_basic(ts_code=ts_code, start_date=start_date, end_date=trade_date)
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
            print(f"[_get_board_kline debug] {debug_info}")
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
    def get_boards_by_date(bk_type: str = "industry", date: Optional[str] = None) -> Dict[str, Any]:
        """获取特定交易日全板块数据

        Args:
            bk_type: 板块类型，"industry"(行业板块) 或 "concept"(概念板块)
            date: 交易日期(YYYYMMDD)，不传则默认最近交易日

        Returns:
            {
                "boards": [
                    {
                        "code": "BK0428",
                        "name": "电力行业",
                        "zx": 1234.56,      # 最新价（收盘价）
                        "zdf": 1.23,        # 涨跌幅%
                        "zdd": 15.0,        # 涨跌额
                        "hsl": 0.85,        # 换手率%
                        "szs": 45,          # 上涨家数
                        "xds": 12,          # 下跌家数
                        "cje": 1234567.8,   # 成交额
                        "cjl": 9876543,     # 成交量
                        "lt": 8900.5,       # 流通市值
                        "zsz": 12000.3,     # 总市值
                    }
                ],
                "count": 100,
                "date": "20240101"
            }
        """
        target_date = (date or datetime.now().strftime('%Y%m%d')).replace("-", "")
        cache_key = f"boards_by_date_{bk_type}_{target_date}"
        cached = read_cache(cache_key, max_age_hours=8760 * 10)  # 历史数据几乎不变，缓存10年

        # 检查缓存有效性
        if isinstance(cached, dict) and cached.get("boards"):
            cached_date = cached.get("date", "")
            if date:
                # 指定了历史日期，数据不变，直接返回缓存
                print(f"[板块缓存命中] {bk_type} date={target_date} (指定日期)")
                return cached
            else:
                # 未指定日期，检查缓存是否为最近交易日
                expected_last = _get_expected_last_trade_date("daily")
                if cached_date == expected_last.replace("-", ""):
                    print(f"[板块缓存命中] {bk_type} date={cached_date} (最新交易日)")
                    return cached
                print(f"[板块缓存过期] {bk_type} 缓存日期={cached_date} != 期望={expected_last.replace('-', '')}")

        try:
            pro = get_pro()
            idx_type = "行业板块" if bk_type == "industry" else "概念板块"

            # 1. 获取板块行情（dc_index 支持 trade_date 参数）
            df = safe_api_call(pro.dc_index, idx_type=idx_type, trade_date=target_date)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or (isinstance(df, pd.DataFrame) and df.empty):
                return {"error": f"No data available for date {target_date}"}

            # 去重
            df = df.drop_duplicates(subset=['ts_code'], keep='first')

            # 2. 获取资金流向数据作为补充
            start_date = (datetime.strptime(target_date, '%Y%m%d') - timedelta(days=10)).strftime('%Y%m%d')
            if bk_type == "industry":
                flow_df = safe_api_call(pro.moneyflow_ind_dc, start_date=start_date, end_date=target_date)
            else:
                flow_df = safe_api_call(pro.moneyflow_con_dc, start_date=start_date, end_date=target_date)

            today_flow_map: Dict[str, float] = {}
            flow_5d_map: Dict[str, float] = {}

            if flow_df is not None and not (isinstance(flow_df, dict) and flow_df.get("error")) and not flow_df.empty:
                dates = sorted(flow_df['trade_date'].astype(str).unique(), reverse=True)[:5]
                for _, row in flow_df.iterrows():
                    ts_code = str(row.get("ts_code", ""))
                    d = str(row.get("trade_date", ""))
                    net_amount = _to_float(row.get("net_amount", 0))
                    if d == dates[0]:
                        today_flow_map[ts_code] = net_amount
                    if d in dates:
                        flow_5d_map[ts_code] = flow_5d_map.get(ts_code, 0) + net_amount

            boards = []
            for _, row in df.iterrows():
                ts_code = str(row.get("ts_code", ""))
                code = ts_code.replace(".DC", "") if ".DC" in ts_code else ts_code
                boards.append({
                    "code": code,
                    "name": str(row.get("name", "")),
                    "zx": _to_float(row.get("close", 0)),
                    "zdd": _to_float(row.get("change", 0)),
                    "zdf": _to_float(row.get("pct_change", 0)),
                    "hsl": _to_float(row.get("turnover_rate", 0)),
                    "szs": _to_int(row.get("up_num", 0)),
                    "xds": _to_int(row.get("down_num", 0)),
                    "cje": _to_float(row.get("amount", 0)),
                    "cjl": _to_int(row.get("volume", 0)),
                    "lt": _to_float(row.get("float_mv", 0)),
                    "zsz": _to_float(row.get("total_mv", 0)),
                    "main_in": today_flow_map.get(ts_code, 0),
                    "main_in_5d": flow_5d_map.get(ts_code, 0),
                    "source": "dc",
                })

            result = {
                "boards": boards,
                "count": len(boards),
                "date": target_date,
            }
            if isinstance(result, dict) and result.get("boards"):
                write_cache(cache_key, result)
            return result
        except Exception as e:
            # 请求失败时，如果有缓存则返回过期缓存（降级）
            if isinstance(cached, dict) and cached.get("boards"):
                print(f"[板块请求失败，返回过期缓存] {bk_type} date={target_date}: {e}")
                return cached
            return {"error": str(e)}

    @staticmethod
    def get_board_detail(secid: str, date: Optional[str] = None) -> Dict[str, Any]:
        """获取单个板块详情（含指定交易日资金流入在全板块的排名 + 最近5日累计资金流入）

        Args:
            secid: 板块ID，如 "90.BK0428" 或 "90.885748"
            date: 指定交易日(YYYYMMDD)，默认今天

        Returns:
            兼容 GetBanKuaisFromTushare 的单条格式，增加 mainInRank / mainInTotal / mainIn / mainIn5d
        """
        try:
            code = convert_secid_to_pure_code(secid)
            is_dc = code.startswith("BK")
            data_source = "dc" if is_dc else "ths"
            target_date = (date or datetime.now().strftime('%Y%m%d')).replace("-", "")

            pro = get_pro()

            # ---------- 0. 获取最近10个交易日（含 target_date）----------
            trade_dates: List[str] = []
            try:
                cal_start = (datetime.strptime(target_date, '%Y%m%d') - timedelta(days=30)).strftime('%Y%m%d')
                cal_df = pro.trade_cal(exchange='SSE', start_date=cal_start, end_date=target_date, is_open='1')
                if cal_df is not None and not cal_df.empty:
                    trade_dates = sorted(cal_df['cal_date'].astype(str).tolist())[-10:]
            except Exception as e:
                print(f"[trade_cal 失败] {e}")

            # ---------- 1. 获取目标日期所有板块的资金流向（用于当日排名）----------
            all_boards: List[Dict[str, Any]] = []

            if data_source == "dc":
                # 东财：行业 + 概念
                flow_ind = safe_api_call(pro.moneyflow_ind_dc, trade_date=target_date)
                flow_con = safe_api_call(pro.moneyflow_con_dc, trade_date=target_date)

                if isinstance(flow_ind, pd.DataFrame) and not flow_ind.empty:
                    for _, row in flow_ind.iterrows():
                        ts_code = str(row.get("ts_code", ""))
                        net_amount = _to_float(row.get("net_amount", 0))
                        if abs(net_amount) > 0 and abs(net_amount) < 1e6:
                            net_amount = net_amount * 1e8
                        all_boards.append({
                            "code": ts_code.replace(".DC", ""),
                            "name": str(row.get("name", "")),
                            "main_in": net_amount,
                            "type": "industry",
                        })

                if isinstance(flow_con, pd.DataFrame) and not flow_con.empty:
                    for _, row in flow_con.iterrows():
                        ts_code = str(row.get("ts_code", ""))
                        net_amount = _to_float(row.get("net_amount", 0))
                        if abs(net_amount) > 0 and abs(net_amount) < 1e6:
                            net_amount = net_amount * 1e8
                        all_boards.append({
                            "code": ts_code.replace(".DC", ""),
                            "name": str(row.get("name", "")),
                            "main_in": net_amount,
                            "type": "concept",
                        })
            else:
                # 同花顺：行业 + 概念
                flow_ind = safe_api_call(pro.moneyflow_ind_ths, trade_date=target_date)
                flow_con = safe_api_call(pro.moneyflow_cnt_ths, trade_date=target_date)

                if isinstance(flow_ind, pd.DataFrame) and not flow_ind.empty:
                    for _, row in flow_ind.iterrows():
                        ts_code = str(row.get("ts_code", ""))
                        code_clean = ts_code.replace(".TI", "").replace(".ti", "")
                        net_amount = _to_float(row.get("net_amount", 0))
                        if abs(net_amount) > 0 and abs(net_amount) < 1e6:
                            net_amount = net_amount * 1e8
                        all_boards.append({
                            "code": code_clean,
                            "name": str(row.get("name", row.get("industry", ""))),
                            "main_in": net_amount,
                            "type": "industry",
                        })

                if isinstance(flow_con, pd.DataFrame) and not flow_con.empty:
                    for _, row in flow_con.iterrows():
                        ts_code = str(row.get("ts_code", ""))
                        code_clean = ts_code.replace(".TI", "").replace(".ti", "")
                        net_amount = _to_float(row.get("net_amount", 0))
                        if abs(net_amount) > 0 and abs(net_amount) < 1e6:
                            net_amount = net_amount * 1e8
                        all_boards.append({
                            "code": code_clean,
                            "name": str(row.get("name", row.get("industry", ""))),
                            "main_in": net_amount,
                            "type": "concept",
                        })

            if not all_boards:
                return {"error": f"No flow data available for date {target_date}"}

            # ---------- 2. 计算当日排名（按板块类型分别排序）----------
            # 先找到目标板块及其类型
            target = None
            for b in all_boards:
                if b["code"] == code:
                    target = b
                    break

            if target is None:
                return {"error": f"Board {secid} not found in flow data for date {target_date}"}

            # 只在同一类型的板块中计算排名（行业板块只在行业板块中排名，概念板块只在概念板块中排名）
            board_type = target.get("type", "")
            same_type_boards = [b for b in all_boards if b.get("type") == board_type]
            same_type_boards.sort(key=lambda x: x["main_in"], reverse=True)

            rank = 0
            total = len(same_type_boards)
            for i, b in enumerate(same_type_boards):
                if b["code"] == code:
                    rank = i + 1
                    break

            # ---------- 3. 计算最近5日/10日资金流入累计 ----------
            main_in_5d = 0.0
            main_in_10d = 0.0
            trade_dates_5d = trade_dates[-5:] if len(trade_dates) >= 5 else trade_dates

            if trade_dates and data_source == "dc":
                # 东财：范围查询，一次获取10天数据
                start_10d = trade_dates[0]
                end_10d = trade_dates[-1]
                flow_10d_ind = safe_api_call(pro.moneyflow_ind_dc, start_date=start_10d, end_date=end_10d)
                flow_10d_con = safe_api_call(pro.moneyflow_con_dc, start_date=start_10d, end_date=end_10d)

                for flow_df in [flow_10d_ind, flow_10d_con]:
                    if isinstance(flow_df, pd.DataFrame) and not flow_df.empty:
                        mask = flow_df['ts_code'].astype(str).str.replace(".DC", "", regex=False) == code
                        for _, row in flow_df[mask].iterrows():
                            net_amount = _to_float(row.get("net_amount", 0))
                            if abs(net_amount) > 0 and abs(net_amount) < 1e6:
                                net_amount = net_amount * 1e8
                            trade_date = str(row.get("trade_date", ""))
                            main_in_10d += net_amount
                            if trade_date in trade_dates_5d:
                                main_in_5d += net_amount

            elif trade_dates and data_source == "ths":
                # 同花顺：逐日查询（单日接口）
                for td in trade_dates:
                    for flow_func, is_industry in [(pro.moneyflow_ind_ths, True), (pro.moneyflow_cnt_ths, False)]:
                        flow_df = safe_api_call(flow_func, trade_date=td)
                        if isinstance(flow_df, pd.DataFrame) and not flow_df.empty:
                            mask = flow_df['ts_code'].astype(str).str.replace(".TI", "", regex=False).str.replace(".ti", "", regex=False) == code
                            for _, row in flow_df[mask].iterrows():
                                net_amount = _to_float(row.get("net_amount", 0))
                                if abs(net_amount) > 0 and abs(net_amount) < 1e6:
                                    net_amount = net_amount * 1e8
                                main_in_10d += net_amount
                                if td in trade_dates_5d:
                                    main_in_5d += net_amount

            # ---------- 4. 获取板块最新行情（复用 _get_board_realtime）----------
            realtime = TushareAPI._get_board_realtime(secid)
            if isinstance(realtime, dict) and realtime.get("error"):
                realtime = {}

            # ---------- 5. 组装返回（兼容 GetBanKuaisFromTushare 单条格式）----------
            return {
                "code": code,
                "name": realtime.get("name", target.get("name", "")),
                "market": 90,
                "secid": secid,
                "zx": realtime.get("zx", 0),
                "zdf": realtime.get("zdf", 0),
                "zdd": realtime.get("zdd", 0),
                "hsl": realtime.get("hsl", 0),
                "szs": realtime.get("szs", 0),
                "xds": realtime.get("xds", 0),
                "lt": realtime.get("lt", 0),
                "cje": realtime.get("cje", 0),
                "cjl": realtime.get("cjl", 0),
                "mainIn": target["main_in"],
                "mainIn5d": round(main_in_5d, 2),
                "mainIn10d": round(main_in_10d, 2),
                "mainInRank": rank,
                "mainInTotal": total,
                "date": target_date,
                "source": data_source,
            }

        except Exception as e:
            return {"error": str(e)}
        
    @staticmethod
    def get_board_stocks(secid: str, date: Optional[str] = None) -> Dict[str, Any]:
        """获取板块成分股，支持东财和同花顺板块

        Args:
            secid: 板块ID，如 "90.BK0428"
            date: 指定查询日期(YYYYMMDD)，不传则默认最近交易日

        自动判断板块类型：
        - BK 开头 → 东财板块（dc_member + moneyflow_dc）
        - 88/3 开头 → 同花顺板块（网页抓取 + moneyflow_ths）

        返回字段补全：通过 daily + daily_basic 获取指定日期行情
        新增主力资金：main_in（当日）, main_in_5d（5日）

        缓存策略：
        - 缓存 key 统一为 board_stocks_{secid}，与 date 无关
        - 缓存中按日期存储多份数据 {date: {total, stocks}}
        - 查询时检查目标日期是否已有缓存，有则命中；无则请求后合并
        """
        code = convert_secid_to_pure_code(secid)
        target_date = (date or datetime.now().strftime('%Y%m%d')).replace("-", "")

        # 统一缓存 key，与 date 无关
        cache_key = f"board_stocks_{secid}"
        cached_all = read_cache(cache_key, max_age_hours=8760 * 10)  # 历史数据几乎不变，缓存10年
        if not isinstance(cached_all, dict):
            cached_all = {}

        # 检查目标日期是否已在缓存中
        cached_day = cached_all.get(target_date)
        if isinstance(cached_day, dict) and cached_day.get("stocks"):
            if date:
                # 指定了历史日期，直接返回
                print(f"[板块成分股缓存命中] {secid} date={target_date} (指定日期)")
                return cached_day
            else:
                # 未指定日期，检查是否为最近交易日
                expected_last = _get_expected_last_trade_date("daily")
                if target_date == expected_last.replace("-", ""):
                    print(f"[板块成分股缓存命中] {secid} date={target_date} (最新交易日)")
                    return cached_day
                print(f"[板块成分股缓存过期] {secid} 缓存日期={target_date} != 期望={expected_last.replace('-', '')}")

        try:
            pro = get_pro()
            start_date_5d = (datetime.strptime(target_date, '%Y%m%d') - timedelta(days=10)).strftime('%Y%m%d')

            # 判断板块类型
            is_dc = code.startswith("BK")
            is_ths = code.startswith("88") or code.startswith("3")

            member_map: Dict[str, Dict[str, Any]] = {}  # member_ts -> info
            debug_info: Dict[str, Any] = {
                "secid": secid,
                "code": code,
                "is_dc": is_dc,
                "is_ths": is_ths,
                "query_date": target_date,
            }

            # 获取最近交易日（dc_member/daily 等接口要求 trade_date 必须是交易日）
            trade_date = target_date
            try:
                cal_df = pro.trade_cal(exchange='SSE', start_date=start_date_5d, end_date=target_date, is_open='1')
                if cal_df is not None and not cal_df.empty:
                    # trade_cal 默认返回降序，iloc[0] 才是最近交易日
                    trade_date = str(cal_df['cal_date'].iloc[0])
            except Exception as e:
                print(f"[trade_cal 失败] {e}")
            debug_info["trade_date"] = trade_date

            # ========== 获取成分股 ==========
            if is_ths:
                # 同花顺板块：从网页抓取
                ths_stocks = _get_board_stocks_from_ths(code)
                for s in ths_stocks:
                    stock_code = s["code"]
                    market = 1 if stock_code.startswith("6") else 0
                    member_ts = f"{stock_code}.{'SH' if stock_code.startswith('6') else 'SZ'}"
                    member_map[member_ts] = {
                        "code": stock_code,
                        "name": s["name"],
                        "market": market,
                        "secid": s["secid"],
                    }
                debug_info["source"] = "ths_web"
                debug_info["ths_count"] = len(ths_stocks)
            else:
                # 东财板块：使用 dc_member
                ts_code = f"{code}.DC" if not code.endswith(".DC") else code
                debug_info["ts_code"] = ts_code

                # 先尝试带 trade_date 查询
                df = cached_api_call(f"dc_member_{ts_code}_{trade_date}", 24, pro.dc_member, ts_code=ts_code, trade_date=trade_date)
                debug_info["dc_member_type"] = type(df).__name__
                if isinstance(df, pd.DataFrame):
                    debug_info["dc_member_shape"] = df.shape
                    debug_info["dc_member_columns"] = df.columns.tolist() if not df.empty else []
                
                if isinstance(df, dict) and df.get("error"):
                    debug_info["dc_member_error"] = df.get("error")
                    return {"error": df.get("error"), "debug": debug_info}
                
                if df is None or (isinstance(df, pd.DataFrame) and df.empty):
                    # dc_member 只支持最近约7天的历史成分股，更早日期返回空
                    # 这里不做 fallback 到最新数据，避免历史日期混入最新成分股
                    debug_info["dc_member_empty"] = True
                    debug_info["dc_member_limit_note"] = "dc_member only supports ~7 days history"
                    # 尝试同花顺 fallback（如果代码看起来像同花顺）
                    if is_ths or code.startswith("88") or code.startswith("3"):
                        ths_stocks = _get_board_stocks_from_ths(code)
                        for s in ths_stocks:
                            stock_code = s["code"]
                            market = 1 if stock_code.startswith("6") else 0
                            member_ts = f"{stock_code}.{'SH' if stock_code.startswith('6') else 'SZ'}"
                            member_map[member_ts] = {
                                "code": stock_code,
                                "name": s["name"],
                                "market": market,
                                "secid": s["secid"],
                            }
                        debug_info["fallback"] = "ths_web"
                    if not member_map:
                        return {"total": 0, "stocks": [], "debug": debug_info}
                elif df is not None and isinstance(df, pd.DataFrame) and not df.empty:
                    debug_info["dc_member_rows"] = len(df)
                    for _, row in df.iterrows():
                        con_code = str(row.get("con_code", ""))
                        stock_code = con_code.split(".")[0] if "." in con_code else con_code
                        if not stock_code:
                            continue
                        market = 1 if stock_code.startswith("6") else 0
                        member_ts = f"{stock_code}.{'SH' if stock_code.startswith('6') else 'SZ'}"
                        member_map[member_ts] = {
                            "code": stock_code,
                            "name": str(row.get("name", "")),
                            "market": market,
                            "secid": f"{market}.{stock_code}",
                        }
                    debug_info["member_count"] = len(member_map)

            if not member_map:
                return {"total": 0, "stocks": [], "debug": debug_info}

            # ========== 批量获取全市场当日行情 ==========
            market_data: Dict[str, Dict[str, Any]] = {}
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

            # ========== 批量获取全市场当日基础指标 ==========
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
                                "sz": round(_to_float(row.get("total_mv", 0)) / 10000, 2),
                                "lt": round(_to_float(row.get("circ_mv", 0)) / 10000, 2),
                            })
            except Exception as e:
                print(f"[daily_basic 批量查询失败] {e}")

            # ========== 获取主力资金数据 ==========
            main_in_map: Dict[str, float] = {}
            main_in_5d_map: Dict[str, float] = {}

            if is_ths:
                # 同花顺：使用 moneyflow_ths（含当日和5日）
                try:
                    ths_mf = safe_api_call(pro.moneyflow_ths, trade_date=trade_date)
                    if ths_mf is not None and not (isinstance(ths_mf, dict) and ths_mf.get("error")) and not ths_mf.empty:
                        for _, row in ths_mf.iterrows():
                            tc = str(row.get("ts_code", ""))
                            if tc in member_map:
                                main_in_map[tc] = _to_float(row.get("net_amount", 0)) * 10000
                                main_in_5d_map[tc] = _to_float(row.get("net_d5_amount", 0)) * 10000
                except Exception as e:
                    print(f"[moneyflow_ths 查询失败] {e}")
            else:
                # 东财板块个股：用 moneyflow_dc（6000积分，每日盘后更新）
                # 先获取最近5个交易日
                trade_dates: List[str] = []
                try:
                    cal_df = pro.trade_cal(exchange='SSE', start_date=start_date_5d, end_date=trade_date, is_open='1')
                    if cal_df is not None and not cal_df.empty:
                        trade_dates = sorted(cal_df['cal_date'].astype(str).tolist())[-5:]
                except Exception as e:
                    print(f"[trade_cal 查询失败] {e}")

                # 逐日查询 moneyflow_dc 全市场数据，累加成分股
                for td in trade_dates:
                    try:
                        dc_mf = safe_api_call(pro.moneyflow_dc, trade_date=td)
                        if dc_mf is not None and not (isinstance(dc_mf, dict) and dc_mf.get("error")) and not dc_mf.empty:
                            for _, row in dc_mf.iterrows():
                                tc = str(row.get("ts_code", ""))
                                if tc in member_map:
                                    # net_amount 单位：万元 → 元
                                    net_amount = _to_float(row.get("net_amount", 0)) * 10000
                                    # 最新日期记为当日
                                    if td == trade_dates[-1]:
                                        main_in_map[tc] = net_amount
                                    # 全部累加为5日
                                    main_in_5d_map[tc] = main_in_5d_map.get(tc, 0) + net_amount
                    except Exception as e:
                        print(f"[moneyflow_dc {td} 查询失败] {e}")

                # ========== 组装结果 ==========
                stocks = []
                for member_ts, info in member_map.items():
                    md = market_data.get(member_ts, {})
                    zx = md.get("zx", 0)
                    zs = md.get("zs", 0)
                    zf = round((md.get("zg", 0) - md.get("zd", 0)) / zs * 100, 2) if zs > 0 else 0
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
                        "main_in": main_in_map.get(member_ts, 0),
                        "main_in_5d": main_in_5d_map.get(member_ts, 0),
                        "cm5": 0,
                        "cd60": 0,
                        "cy1": 0,
                        "cs": 0,
                    })

                result = {"total": len(stocks), "stocks": stocks, "date": target_date}
                if isinstance(result, dict) and result.get("stocks"):
                    # 合并到统一缓存（按日期更新）
                    cached_all[target_date] = result
                    write_cache(cache_key, cached_all)
                    print(f"[板块成分股缓存更新] {secid} 已缓存 {len(cached_all)} 个日期")
                return result
        except Exception as e:
            # 请求失败时，如果有缓存则返回过期缓存（降级）
            if isinstance(cached_day, dict) and cached_day.get("stocks"):
                print(f"[板块成分股请求失败，返回过期缓存] {secid} date={target_date}: {e}")
                return cached_day
            return {"error": str(e)}

    @staticmethod
    def get_boards_by_date_batch(dates: List[str]) -> Dict[str, Any]:
        """批量获取多个交易日的全市场板块数据（industry + concept 合并）"""
        result = {}
        for date in dates:
            industry = TushareAPI.get_boards_by_date(bk_type="industry", date=date)
            concept = TushareAPI.get_boards_by_date(bk_type="concept", date=date)
            all_boards = []
            if isinstance(industry, dict) and industry.get("boards"):
                all_boards.extend(industry["boards"])
            if isinstance(concept, dict) and concept.get("boards"):
                all_boards.extend(concept["boards"])
            result[date] = {"boards": all_boards, "count": len(all_boards), "date": date}
        return result

    @staticmethod
    def get_board_stocks_batch(requests: List[Dict[str, Any]]) -> Dict[str, Any]:
        """批量获取板块成分股，按 date+boardCode 去重内部查询"""
        seen = set()
        result = {}
        for req in requests:
            date = req.get("date")
            board_code = req.get("boardCode")
            board_name = req.get("boardName")
            key = f"{date}_{board_code}"
            if key in seen:
                continue
            seen.add(key)
            result[key] = TushareAPI.get_board_stocks(
                secid=f"90.{board_code}" if board_code else "",
                date=date
            )
        return result
    
    # ------------------ 行业-概念关联分析（Tushare Pro 原生接口）------------------

    @staticmethod
    def _get_concept_stocks_simple(concept_code: str, concept_source: str = "dc") -> List[str]:
        """轻量获取概念板块成分股代码列表（无行情，仅用于交集计算）"""
        try:
            pro = get_pro()
            if concept_source == "dc":
                # 东财概念：使用 dc_member（已有缓存机制）
                ts_code = f"{concept_code}.DC" if not concept_code.endswith(".DC") else concept_code
                trade_date = datetime.now().strftime('%Y%m%d')
                df = cached_api_call(f"dc_member_{ts_code}", 24, pro.dc_member,
                                      ts_code=ts_code, trade_date=trade_date)
                if isinstance(df, dict) and df.get("error"):
                    return []
                if df is None or (isinstance(df, pd.DataFrame) and df.empty):
                    return []
                stocks = []
                for _, row in df.iterrows():
                    con_code = str(row.get("con_code", ""))
                    stock_code = con_code.split(".")[0] if "." in con_code else con_code
                    if stock_code and stock_code.isdigit():
                        stocks.append(stock_code)
                return stocks
            else:
                # 同花顺概念：使用 ths_member（6000积分）
                # 统一编码格式为 885xxx.TI
                if not concept_code.endswith(".TI"):
                    ts_code = f"{concept_code}.TI"
                else:
                    ts_code = concept_code

                df = cached_api_call(f"ths_member_{ts_code}", 24, pro.ths_member,
                                      ts_code=ts_code)
                if isinstance(df, dict) and df.get("error"):
                    return []
                if df is None or (isinstance(df, pd.DataFrame) and df.empty):
                    return []
                stocks = []
                for _, row in df.iterrows():
                    con_code = str(row.get("con_code", ""))
                    stock_code = con_code.split(".")[0] if "." in con_code else con_code
                    if stock_code and stock_code.isdigit():
                        stocks.append(stock_code)
                return stocks
        except Exception as e:
            print(f"[_get_concept_stocks_simple] {concept_source} {concept_code} failed: {e}")
            return []


    @staticmethod
    def _get_all_concept_stocks_map(concept_source: str = "dc", max_concepts: int = 0) -> Dict[str, Dict[str, Any]]:
        """获取全量概念板块及其成分股代码映射（带 24h 缓存）"""
        cache_key = f"all_concept_stocks_map_{concept_source}_{max_concepts}"
        cached = read_cache(cache_key, max_age_hours=24)
        if cached is not None:
            return cached

        result = {}
        try:
            pro = get_pro()
            if concept_source == "dc":
                # 东财概念板块列表：dc_index
                df = safe_api_call(pro.dc_index, idx_type="概念板块")
                if isinstance(df, dict) and df.get("error"):
                    return result
                if df is None or df.empty:
                    return result

                df = df.drop_duplicates(subset=['ts_code'], keep='first')
                boards = []
                for _, row in df.iterrows():
                    ts_code = str(row.get("ts_code", ""))
                    name = str(row.get("name", ""))
                    code = ts_code.replace(".DC", "") if ".DC" in ts_code else ts_code
                    if code.startswith("BK"):
                        boards.append({"code": code, "name": name, "ts_code": ts_code})

                if max_concepts > 0:
                    boards = boards[:max_concepts]

                for board in boards:
                    stocks = TushareAPI._get_concept_stocks_simple(board["code"], "dc")
                    if stocks:
                        result[board["code"]] = {"name": board["name"], "stocks": stocks, "count": len(stocks)}

            else:
                # 同花顺概念板块列表：ths_index(type='N')
                df = safe_api_call(pro.ths_index, type='N')
                if isinstance(df, dict) and df.get("error"):
                    return result
                if df is None or df.empty:
                    return result

                boards = []
                for _, row in df.iterrows():
                    ts_code = str(row.get("ts_code", ""))
                    name = str(row.get("name", ""))
                    exchange = str(row.get("exchange", ""))
                    # 只取 A 股概念指数，且确保是 .TI 后缀
                    if exchange == "A" and ts_code.endswith(".TI"):
                        boards.append({"code": ts_code, "name": name, "ts_code": ts_code})

                if max_concepts > 0:
                    boards = boards[:max_concepts]

                for board in boards:
                    stocks = TushareAPI._get_concept_stocks_simple(board["code"], "ths")
                    if stocks:
                        result[board["code"]] = {"name": board["name"], "stocks": stocks, "count": len(stocks)}

        except Exception as e:
            print(f"[_get_all_concept_stocks_map] failed: {e}")

        write_cache(cache_key, result)
        return result


    @staticmethod
    def get_industry_related_concepts(industry_code: str, concept_source: str = "dc",
                                       top_n: int = 15, threshold: float = 0.15,
                                       max_concepts: int = 0) -> Dict[str, Any]:
        """
        根据行业板块代码，查找关联度最高的概念板块

        关联度计算：
        - ratio_in_concept: 概念成分股中属于该行业的比例（概念的行业纯度）
        - ratio_in_industry: 行业成分股中属于该概念的比例（行业的概念覆盖率）
        - score: 综合得分 = ratio_in_concept * 0.6 + ratio_in_industry * 0.4

        Args:
            industry_code: 行业板块代码
                - 东财行业: BKxxxx（如 BK0428 电力行业）
                - 同花顺行业: 88xxxx 网页端编码 或 885xxx.TI
            concept_source: 概念板块数据源，"dc"(东财) 或 "ths"(同花顺)
            top_n: 返回关联度最高的前 N 个概念
            threshold: 综合得分阈值，低于此值过滤
            max_concepts: 最多检查的概念板块数量，0 表示全部。
                         首次查询或盘中调用建议设置上限（如 100）避免超时。

        Returns:
            {
                "industry_code": "BK0428",
                "industry_name": "",
                "concept_source": "dc",
                "industry_stock_count": 89,
                "concept_checked": 342,
                "concepts": [
                    {
                        "concept_code": "BK1013",
                        "concept_name": "绿色电力",
                        "overlap_count": 45,
                        "concept_stock_count": 67,
                        "industry_stock_count": 89,
                        "ratio_in_concept": 0.6716,
                        "ratio_in_industry": 0.5056,
                        "score": 0.6052
                    }
                ]
            }
        """
        try:
            # 1. 获取行业板块成分股（复用已有接口）
            industry_data = TushareAPI.get_board_stocks(industry_code)
            if isinstance(industry_data, dict) and industry_data.get("error"):
                return industry_data

            industry_stocks = industry_data.get("stocks", [])
            if not industry_stocks:
                return {
                    "industry_code": industry_code,
                    "industry_name": "",
                    "concept_source": concept_source,
                    "industry_stock_count": 0,
                    "concepts": [],
                    "error": "行业板块无成分股或获取失败"
                }

            # 提取行业成分股纯代码集合
            industry_codes = set()
            for s in industry_stocks:
                c = s.get("code", "")
                if c and c.isdigit():
                    industry_codes.add(c)

            industry_count = len(industry_codes)
            if industry_count == 0:
                return {
                    "industry_code": industry_code,
                    "industry_name": "",
                    "concept_source": concept_source,
                    "industry_stock_count": 0,
                    "concepts": [],
                    "error": "行业板块成分股代码解析失败"
                }

            # 2. 获取全量概念板块成分股映射（带缓存）
            all_concepts = TushareAPI._get_all_concept_stocks_map(
                concept_source=concept_source,
                max_concepts=max_concepts
            )

            if not all_concepts:
                return {
                    "industry_code": industry_code,
                    "industry_name": "",
                    "concept_source": concept_source,
                    "industry_stock_count": industry_count,
                    "concepts": [],
                    "error": "概念板块数据获取失败"
                }

            # 3. 逐一遍历计算交集关联度
            results = []
            for concept_code, concept_info in all_concepts.items():
                concept_stocks = set(concept_info.get("stocks", []))
                concept_name = concept_info.get("name", "")
                concept_count = concept_info.get("count", 0)

                if concept_count < 3:  # 成分股太少，噪音大，跳过
                    continue

                overlap = industry_codes & concept_stocks
                overlap_count = len(overlap)

                if overlap_count == 0:
                    continue

                ratio_in_concept = overlap_count / concept_count if concept_count > 0 else 0
                ratio_in_industry = overlap_count / industry_count if industry_count > 0 else 0

                # 综合得分：偏向"概念的行业纯度"
                score = ratio_in_concept * 0.6 + ratio_in_industry * 0.4

                if score < threshold:
                    continue

                results.append({
                    "concept_code": concept_code,
                    "concept_name": concept_name,
                    "overlap_count": overlap_count,
                    "concept_stock_count": concept_count,
                    "industry_stock_count": industry_count,
                    "ratio_in_concept": round(ratio_in_concept, 4),
                    "ratio_in_industry": round(ratio_in_industry, 4),
                    "score": round(score, 4),
                })

            # 4. 按综合得分降序，取 top_n
            results.sort(key=lambda x: x["score"], reverse=True)
            if top_n > 0:
                results = results[:top_n]

            return {
                "industry_code": industry_code,
                "industry_name": "",
                "concept_source": concept_source,
                "industry_stock_count": industry_count,
                "concept_checked": len(all_concepts),
                "concepts": results,
            }

        except Exception as e:
            return {"error": str(e)}


    @staticmethod
    def build_concept_stock_cache(concept_source: str = "dc", max_concepts: int = 0) -> Dict[str, Any]:
        """
        预构建概念板块成分股缓存，用于加速后续 get_industry_related_concepts 查询。
        建议在每日收盘后或启动时调用一次。

        Args:
            concept_source: "dc" 或 "ths"
            max_concepts: 最多缓存的概念数量，0 表示全部。ths 建议先设 100 测试稳定性。

        Returns:
            {"status": "ok", "cached_count": 123, "concept_source": "dc"}
        """
        try:
            result = TushareAPI._get_all_concept_stocks_map(
                concept_source=concept_source,
                max_concepts=max_concepts
            )
            return {
                "status": "ok",
                "cached_count": len(result),
                "concept_source": concept_source,
                "max_concepts": max_concepts,
            }
        except Exception as e:
            return {"status": "error", "error": str(e)}
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
                # 个股资金流向：Tushare 标准 moneyflow
                ts_code = f"{code}.SH" if code.startswith('6') else f"{code}.SZ"
                df = safe_api_call(pro.moneyflow, ts_code=ts_code, start_date=today, end_date=today)
                if isinstance(df, dict) and df.get("error"):
                    return df
                if df is None or df.empty:
                    return {"error": "No data"}
                row = df.iloc[0]
                # moneyflow 返回 buy/sell 金额，需手动计算各档位净流入
                small_in = _to_float(row.get("buy_sm_amount", 0)) - _to_float(row.get("sell_sm_amount", 0))
                medium_in = _to_float(row.get("buy_md_amount", 0)) - _to_float(row.get("sell_md_amount", 0))
                big_in = _to_float(row.get("buy_lg_amount", 0)) - _to_float(row.get("sell_lg_amount", 0))
                super_big_in = _to_float(row.get("buy_elg_amount", 0)) - _to_float(row.get("sell_elg_amount", 0))
                return {
                    "main_in": _to_float(row.get("net_mf_amount", 0)),
                    "small_in": round(small_in, 2),
                    "medium_in": round(medium_in, 2),
                    "big_in": round(big_in, 2),
                    "super_big_in": round(super_big_in, 2),
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
        
    # ------------------ 强势股票（60日新高 + 涨停）------------------
    @staticmethod
    def get_strong_stocks(date: str) -> Dict[str, Any]:
        """获取指定日期的强势股票（60日新高 或 涨停）"""
        try:
            pro = get_pro()
            date_str = date.replace('-', '')

            # 1. 检查缓存
            cache_key = f"strong_stocks_{date_str}"
            cached = read_cache(cache_key, max_age_hours=24)
            if cached is not None:
                return cached

            # 2. 获取当日全市场日线
            today_df = safe_api_call(pro.daily, trade_date=date_str)
            if isinstance(today_df, dict) and today_df.get("error"):
                return today_df
            if today_df is None or today_df.empty:
                return {"error": "No daily data"}

            # 3. 获取涨停数据
            limit_df = safe_api_call(pro.limit_list, trade_date=date_str)
            limit_codes = set()
            if isinstance(limit_df, pd.DataFrame) and not limit_df.empty:
                limit_codes = set(limit_df[limit_df['limit'] == 'U']['ts_code'].tolist())

            # 4. 获取最近60个交易日
            start_60 = (datetime.strptime(date_str, '%Y%m%d') - timedelta(days=90)).strftime('%Y%m%d')
            cal_df = safe_api_call(pro.trade_cal, exchange='SSE', start_date=start_60, end_date=date_str, is_open='1')
            if isinstance(cal_df, dict) and cal_df.get("error"):
                trade_dates = []
            else:
                trade_dates = sorted(cal_df['cal_date'].astype(str).tolist())

            if len(trade_dates) < 2:
                return {"error": "Not enough trade dates"}

            today_idx = trade_dates.index(date_str) if date_str in trade_dates else len(trade_dates) - 1
            hist_dates = trade_dates[max(0, today_idx - 60):today_idx]

            # 5. 获取历史数据计算60日最高价（带缓存）
            hist_frames = []
            for hd in hist_dates:
                cache_key_daily = f"daily_all_{hd}"
                cached_daily = read_cache(cache_key_daily, max_age_hours=8760)
                if cached_daily and isinstance(cached_daily, list):
                    hist_frames.append(pd.DataFrame(cached_daily))
                else:
                    df = safe_api_call(pro.daily, trade_date=hd)
                    if isinstance(df, pd.DataFrame) and not df.empty:
                        write_cache(cache_key_daily, df_to_records(df))
                        hist_frames.append(df)

            high_60 = {}
            if hist_frames:
                hist_df = pd.concat(hist_frames, ignore_index=True)
                high_60 = hist_df.groupby('ts_code')['high'].max().to_dict()

            # 6. 获取股票名称和行业（带缓存复用）
            name_map, industry_map = _get_stock_basic_maps()

            # 7. 筛选：涨停 或 60日新高
            stocks = []
            for _, row in today_df.iterrows():
                tc = str(row['ts_code'])
                code = tc.split('.')[0]
                market = '1' if code.startswith('6') else '0'
                secid = f"{market}.{code}"
                close = _to_float(row['close'])
                high = _to_float(row['high'])
                low = _to_float(row['low'])
                pre_close = _to_float(row['pre_close'])
                vol = _to_int(row['vol'])
                amount = _to_float(row['amount']) * 1000
                zdf = _to_float(row['pct_chg'])

                # 涨停判断
                is_limit = tc in limit_codes
                if not is_limit:
                    if code.startswith('30') or code.startswith('68') or code.startswith('8') or code.startswith('9'):
                        is_limit = zdf >= 19.9
                    else:
                        is_limit = zdf >= 9.9

                # 60日新高判断
                is_new_high = close >= high_60.get(tc, 0) * 0.999

                if is_limit or is_new_high:
                    stocks.append({
                        "secid": secid,
                        "code": code,
                        "name": name_map.get(tc, ''),
                        "zx": close,
                        "zdf": zdf,
                        "zg": high,
                        "zd": low,
                        "cjl": vol,
                        "cje": round(amount, 2),
                        "strongType": "limit_up" if is_limit else "new_high_60",
                        "hybk": industry_map.get(tc, ''),
                        "ltsz": 0,
                    })

            result = {
                "stocks": stocks,
                "date": date_str,
                "count": len(stocks),
                "limit_up_count": len([s for s in stocks if s['strongType'] == 'limit_up']),
                "new_high_count": len([s for s in stocks if s['strongType'] == 'new_high_60']),
            }

            write_cache(cache_key, result)
            return result
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_strong_stocks_batch(start_date: str, end_date: str) -> Dict[str, Any]:
        """批量生成指定时间段的每日强势股票（回测预生成用）"""
        try:
            pro = get_pro()
            start = start_date.replace('-', '')
            end = end_date.replace('-', '')

            # 检查批量缓存
            cache_key = f"strong_stocks_batch_{start}_{end}"
            cached = read_cache(cache_key, max_age_hours=24)
            if cached is not None:
                return cached

            # 获取交易日历
            cal_start = (datetime.strptime(start, '%Y%m%d') - timedelta(days=90)).strftime('%Y%m%d')
            cal_df = safe_api_call(pro.trade_cal, exchange='SSE', start_date=cal_start, end_date=end, is_open='1')
            if isinstance(cal_df, dict) and cal_df.get("error"):
                return cal_df
            all_trade_dates = sorted(cal_df['cal_date'].astype(str).tolist())

            target_dates = [d for d in all_trade_dates if start <= d <= end]
            if not target_dates:
                return {"error": "No trade dates in range"}

            # 需要的历史数据日期（含前60日）
            hist_start_idx = max(0, len(all_trade_dates) - len(target_dates) - 60)
            hist_dates = all_trade_dates[hist_start_idx:]

            print(f"[get_strong_stocks_batch] 获取 {len(hist_dates)} 个交易日全市场数据...")

            # 批量获取所有日期的 daily 数据（带缓存）
            daily_data = {}
            for td in hist_dates:
                cache_key_daily = f"daily_all_{td}"
                cached_daily = read_cache(cache_key_daily, max_age_hours=8760)
                if cached_daily and isinstance(cached_daily, list):
                    daily_data[td] = pd.DataFrame(cached_daily)
                else:
                    df = safe_api_call(pro.daily, trade_date=td)
                    if isinstance(df, pd.DataFrame) and not df.empty:
                        write_cache(cache_key_daily, df_to_records(df))
                        daily_data[td] = df

            # 获取涨停数据
            limit_data = {}
            for td in target_dates:
                cache_key_limit = f"limit_up_{td}"
                cached_limit = read_cache(cache_key_limit, max_age_hours=24)
                if cached_limit and isinstance(cached_limit, list):
                    limit_data[td] = set(pd.DataFrame(cached_limit)['ts_code'].tolist())
                else:
                    df = safe_api_call(pro.limit_list, trade_date=td)
                    if isinstance(df, pd.DataFrame) and not df.empty:
                        codes = set(df[df['limit'] == 'U']['ts_code'].tolist())
                        limit_data[td] = codes
                        write_cache(cache_key_limit, [{'ts_code': c} for c in codes])

            # 获取股票名称和行业（带缓存复用）
            name_map, industry_map = _get_stock_basic_maps()

            # 逐日计算60日新高并筛选
            result = {}
            for td in target_dates:
                idx = hist_dates.index(td)
                start_idx = max(0, idx - 60)
                past_dates = hist_dates[start_idx:idx]

                past_frames = [daily_data[d] for d in past_dates if d in daily_data]
                if not past_frames:
                    continue

                past_df = pd.concat(past_frames, ignore_index=True)
                high_60 = past_df.groupby('ts_code')['high'].max().to_dict()

                if td not in daily_data:
                    continue
                today_df = daily_data[td]

                stocks = []
                for _, row in today_df.iterrows():
                    tc = str(row['ts_code'])
                    code = tc.split('.')[0]
                    market = '1' if code.startswith('6') else '0'
                    secid = f"{market}.{code}"
                    close = _to_float(row['close'])
                    high = _to_float(row['high'])
                    low = _to_float(row['low'])
                    pre_close = _to_float(row['pre_close'])
                    vol = _to_int(row['vol'])
                    amount = _to_float(row['amount']) * 1000
                    zdf = _to_float(row['pct_chg'])

                    is_limit = tc in limit_data.get(td, set())
                    if not is_limit:
                        if code.startswith('30') or code.startswith('68') or code.startswith('8') or code.startswith('9'):
                            is_limit = zdf >= 19.9
                        else:
                            is_limit = zdf >= 9.9

                    is_new_high = close >= high_60.get(tc, 0) * 0.999

                    if is_limit or is_new_high:
                        stocks.append({
                            "secid": secid,
                            "code": code,
                            "name": name_map.get(tc, ''),
                            "zx": close,
                            "zdf": zdf,
                            "zg": high,
                            "zd": low,
                            "cjl": vol,
                            "cje": round(amount, 2),
                            "strongType": "limit_up" if is_limit else "new_high_60",
                            "hybk": industry_map.get(tc, ''),
                            "ltsz": 0,
                        })

                result[td] = {
                    "stocks": stocks,
                    "count": len(stocks),
                }

            final_result = {
                "dates": result,
                "start_date": start,
                "end_date": end,
            }

            write_cache(cache_key, final_result)
            print(f"[get_strong_stocks_batch] 完成: {len(target_dates)} 天, 共 {sum(len(v['stocks']) for v in result.values())} 只强势股票")
            return final_result
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
    parser.add_argument("--storage-path", "-s", help="本地存储根目录路径（用于缓存）", default=None)

    args = parser.parse_args()

    try:
        params = json.loads(args.params)
    except json.JSONDecodeError:
        print(json.dumps({"error": "Invalid JSON params"}, ensure_ascii=False))
        sys.exit(1)

    # 设置缓存目录
    if args.storage_path:
        set_cache_dir(args.storage_path)

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