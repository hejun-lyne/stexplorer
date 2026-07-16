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
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass
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
        try:
            ts.set_token(token)
            _pro_api = ts.pro_api(token)
            return _pro_api
        except Exception as e:
            sys.stderr.write(f"[DEBUG] init_pro failed: {e}\n")
            import traceback
            sys.stderr.write(traceback.format_exc())
            return None
    env_token = os.environ.get('TUSHARE_TOKEN', '')
    if env_token:
        try:
            ts.set_token(env_token)
            _pro_api = ts.pro_api(env_token)
            return _pro_api
        except Exception as e:
            sys.stderr.write(f"[DEBUG] init_pro(env) failed: {e}\n")
            import traceback
            sys.stderr.write(traceback.format_exc())
            return None
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
        # 东财概念指数/板块：market == 2，优先用 .CSI（中证指数），
        # 因为 index_daily 接口更通用；东财概念板块(.DC) 在 _get_board_kline 中单独处理
        if mk == "2":
            return f"{code}.CSI"
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
    """判断是否为板块代码（东财板块/概念指数，需走 dc_daily 接口）"""
    if secid.startswith("90."):
        return True
    code = convert_secid_to_pure_code(secid)
    # BKxxxx 和 88xxxx 板块代码
    if code.startswith("BK") or code.startswith("88"):
        return True
    # 东财概念指数：market == 2 且非传统指数代码（如 2.931068 消费龙头）
    if "." in secid:
        mk = secid.split(".")[0]
        if mk == "2":
            return True
    return False


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
            data = json.load(f)
        # 自动还原 DataFrame
        if isinstance(data, dict) and data.get("__type__") == "dataframe":
            records = data.get("records", [])
            if records:
                return pd.DataFrame(records)
            return pd.DataFrame()
        return data
    except Exception:
        return None


def write_cache(cache_key: str, data: Any):
    """写入缓存"""
    try:
        path = _cache_path(cache_key)
        os.makedirs(_CACHE_DIR, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            # 自动序列化 DataFrame
            if isinstance(data, pd.DataFrame):
                json.dump(
                    {"__type__": "dataframe", "records": df_to_records(data)},
                    f, ensure_ascii=False, cls=DateTimeEncoder
                )
            else:
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


def _cached_dc_member(pro, ts_code: str, trade_date: str) -> Any:
    """获取 dc_member，按板块一个文件缓存，trade_date 为 key

    缓存结构: {trade_date: [records], ...}
    """
    cache_key = f"dc_member_{ts_code}"
    cached = read_cache(cache_key, max_age_hours=24 * 7)

    if isinstance(cached, dict) and trade_date in cached:
        records = cached[trade_date]
        if records:
            return pd.DataFrame(records)
        return pd.DataFrame()

    df = safe_api_call(pro.dc_member, ts_code=ts_code, trade_date=trade_date)
    if isinstance(df, dict) and df.get("error"):
        return df
    if df is not None and isinstance(df, pd.DataFrame) and not df.empty:
        if not isinstance(cached, dict):
            cached = {}
        cached[trade_date] = df_to_records(df)
        write_cache(cache_key, cached)
    return df


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
        """获取实时行情（交易时段走腾讯财经，非交易时段回退 tushare daily+daily_basic）

        腾讯 qt.gtimg.cn 接口返回字段（~分隔）：
          1-名称, 2-代码, 3-最新价, 4-昨收, 5-今开, 6-成交量(手),
          31-涨跌额, 32-涨跌幅%, 33-最高, 34-最低,
          37-成交额(万), 38-换手率, 39-市盈率, 43-振幅,
          44-流通市值(亿), 45-总市值(亿), 46-市净率, 47-涨停价, 48-跌停价,
          49-量比, 50-委比

        返回字段补全：zx, zs, zdf, zdd, cjl, cje, zg, zd, jk, lb, hsl, syl, sjl, lt, zsz, zt, dt
        """
        # 板块代码仍走 Tushare dc_index（腾讯无 BKxxxx 体系）
        if is_board_code(secid):
            return TushareAPI._get_board_realtime(secid)

        # 1. 优先尝试腾讯财经接口（交易时段数据实时）
        tx_result = TushareAPI._get_realtime_from_tencent(secid)
        if tx_result and "error" not in tx_result:
            return tx_result

        # 2. 腾讯接口失败（非交易时段常见），回退到 tushare daily + daily_basic
        return TushareAPI._get_realtime_from_tushare_daily(secid)

    @staticmethod
    def _get_realtime_from_tencent(secid: str) -> Optional[Dict[str, Any]]:
        """从腾讯财经获取实时行情（仅交易时段有效）"""
        try:
            if requests is None:
                return None

            symbol = convert_secid_to_tx_symbol(secid)
            url = f"http://qt.gtimg.cn/q={symbol}"
            resp = requests.get(url, timeout=10)
            resp.encoding = "gbk"
            text = resp.text

            # 解析 v_sz000001="..."; 格式
            if "v_" not in text or '"' not in text:
                return None

            start = text.find('"') + 1
            end = text.rfind('"')
            data_str = text[start:end]
            parts = data_str.split("~")

            def _get(idx, default=""):
                return parts[idx] if idx < len(parts) else default

            name = _get(1, "")
            code = _get(2, "")
            price = _to_float(_get(3, 0))
            # 非交易时段，腾讯返回的 price 通常为 0 或等于昨收（不可靠）
            if price == 0:
                return None

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
            print(f"[腾讯实时行情失败] {secid}: {e}")
            return None

    @staticmethod
    def _get_realtime_from_tushare_daily(secid: str) -> Dict[str, Any]:
        """从 tushare daily + daily_basic 获取最近交易日盘后数据（非交易时段回退方案）"""
        try:
            code = convert_secid_to_pure_code(secid)
            mk = "1" if (("." in secid and secid.split(".")[0] == "1") or code.startswith("6")) else "0"
            ts_code = f"{code}.{'SH' if mk == '1' else 'SZ'}"

            # 获取最近一个交易日
            latest_date = _get_expected_last_trade_date("daily")
            trade_date = latest_date.replace("-", "")

            pro = get_pro()

            # 获取日线行情（daily 接口）
            daily_df = safe_api_call(pro.daily, ts_code=ts_code, trade_date=trade_date)
            if isinstance(daily_df, dict) and daily_df.get("error"):
                return daily_df
            if daily_df is None or daily_df.empty:
                return {"error": f"No daily data for {ts_code} on {latest_date}"}

            row = daily_df.iloc[0]
            close = _to_float(row.get("close", 0))
            pre_close = _to_float(row.get("pre_close", 0))
            zdd = close - pre_close if pre_close > 0 else 0
            zdf = (zdd / pre_close * 100) if pre_close > 0 else 0

            result = {
                "code": code,
                "name": "",
                "zx": close,
                "zs": pre_close,
                "zdf": round(zdf, 2),
                "zdd": round(zdd, 2),
                "cjl": _to_int(row.get("vol", 0)),
                "cje": round(_to_float(row.get("amount", 0)) * 1000, 2),  # daily amount 单位千元→万
                "zg": _to_float(row.get("high", 0)),
                "zd": _to_float(row.get("low", 0)),
                "jk": _to_float(row.get("open", 0)),
                "lb": 0,           # 量比非交易时段无意义
                "hsl": 0,
                "syl": 0,
                "sjl": 0,
                "lt": 0,           # 流通市值（亿）
                "zsz": 0,          # 总市值（亿）
                "zf": _to_float(row.get("high", 0)) - _to_float(row.get("low", 0)) if pre_close > 0 else 0,
                "zt": 0,
                "dt": 0,
                "time": latest_date,
                "source": "tushare_daily",
            }

            # 补充 daily_basic 数据（换手率、市盈率、市净率、市值）
            try:
                basic_df = safe_api_call(pro.daily_basic, ts_code=ts_code, trade_date=trade_date)
                if basic_df is not None and not (isinstance(basic_df, dict) and basic_df.get("error")) and not basic_df.empty:
                    basic_row = basic_df.iloc[0]
                    result["hsl"] = _to_float(basic_row.get("turnover_rate", 0))
                    result["syl"] = _to_float(basic_row.get("pe_ttm", basic_row.get("pe", 0)))
                    result["sjl"] = _to_float(basic_row.get("pb", 0))
                    # daily_basic 的 total_mv/circ_mv 单位是"万元"，转为"亿"
                    result["zsz"] = round(_to_float(basic_row.get("total_mv", 0)) / 10000, 2)
                    result["lt"] = round(_to_float(basic_row.get("circ_mv", 0)) / 10000, 2)
            except Exception as e:
                print(f"[daily_basic 补充失败] {secid}: {e}")

            # 补充股票名称（从 stock_basic 映射）
            try:
                name_map, _ = _get_stock_basic_maps()
                result["name"] = name_map.get(ts_code, "")
            except Exception:
                pass

            return result
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_stocks_realtime_batch(secids: List[str]) -> Dict[str, Any]:
        """批量获取实时行情（交易时段走腾讯财经，非交易时段用 daily+daily_basic 全量一次获取）

        返回格式: {"data": {"secid": {...}, ...}, "errors": [...]}
        """
        result_data: Dict[str, Any] = {}
        failed_secids: List[str] = []
        errors: List[str] = []

        # 1. 先逐个尝试腾讯财经接口（交易时段有效）
        for secid in secids:
            if is_board_code(secid):
                board_result = TushareAPI._get_board_realtime(secid)
                if board_result and "error" not in board_result:
                    result_data[secid] = board_result
                else:
                    failed_secids.append(secid)
            else:
                tx_result = TushareAPI._get_realtime_from_tencent(secid)
                if tx_result and "error" not in tx_result:
                    result_data[secid] = tx_result
                else:
                    failed_secids.append(secid)

        # 2. 对腾讯失败的 secid，用 tushare daily+daily_basic 一次性批量获取
        if failed_secids:
            try:
                batch_results = TushareAPI._get_realtime_from_tushare_daily_batch(failed_secids)
                if isinstance(batch_results, dict) and batch_results.get("error"):
                    errors.append(f"daily batch failed: {batch_results['error']}")
                    for secid in failed_secids:
                        result_data[secid] = {"error": "no data"}
                else:
                    for secid in failed_secids:
                        if secid in batch_results:
                            result_data[secid] = batch_results[secid]
                        else:
                            result_data[secid] = {"error": "no data"}
            except Exception as e:
                errors.append(f"daily batch exception: {str(e)}")
                for secid in failed_secids:
                    result_data[secid] = {"error": str(e)}

        return {"data": result_data, "errors": errors}

    @staticmethod
    def _get_realtime_from_tushare_daily_batch(secids: List[str]) -> Dict[str, Any]:
        """一次请求 daily + daily_basic 全量数据，从中匹配需要的 secid"""
        try:
            pro = get_pro()
            latest_date = _get_expected_last_trade_date("daily")
            trade_date = latest_date.replace("-", "")

            # 1. 一次性获取全市场 daily 数据
            daily_df = safe_api_call(pro.daily, trade_date=trade_date)
            if isinstance(daily_df, dict) and daily_df.get("error"):
                return daily_df
            if daily_df is None or daily_df.empty:
                return {"error": f"No daily data on {latest_date}"}

            # 构建 ts_code -> row 的索引
            daily_map = {}
            for _, row in daily_df.iterrows():
                ts_code = str(row.get("ts_code", ""))
                daily_map[ts_code] = row

            # 2. 一次性获取全市场 daily_basic 数据（补充换手率/PE/PB/市值）
            basic_map = {}
            try:
                basic_df = safe_api_call(pro.daily_basic, trade_date=trade_date)
                if basic_df is not None and not (isinstance(basic_df, dict) and basic_df.get("error")) and not basic_df.empty:
                    for _, row in basic_df.iterrows():
                        ts_code = str(row.get("ts_code", ""))
                        basic_map[ts_code] = row
            except Exception as e:
                print(f"[daily_basic batch] 获取失败: {e}")

            # 3. 获取股票名称映射
            try:
                name_map, _ = _get_stock_basic_maps()
            except Exception:
                name_map = {}

            # 4. 为每个 secid 组装结果
            results: Dict[str, Any] = {}
            for secid in secids:
                code = convert_secid_to_pure_code(secid)
                ts_code = convert_secid_to_ts_code(secid)

                row = daily_map.get(ts_code)
                if row is None:
                    results[secid] = {"error": f"no daily data for {ts_code}"}
                    continue

                close = _to_float(row.get("close", 0))
                pre_close = _to_float(row.get("pre_close", 0))
                zdd = close - pre_close if pre_close > 0 else 0
                zdf = (zdd / pre_close * 100) if pre_close > 0 else 0

                result = {
                    "code": code,
                    "name": name_map.get(ts_code, ""),
                    "zx": close,
                    "zs": pre_close,
                    "zdf": round(zdf, 2),
                    "zdd": round(zdd, 2),
                    "cjl": _to_int(row.get("vol", 0)),
                    "cje": round(_to_float(row.get("amount", 0)) * 1000, 2),  # 千元→万
                    "zg": _to_float(row.get("high", 0)),
                    "zd": _to_float(row.get("low", 0)),
                    "jk": _to_float(row.get("open", 0)),
                    "lb": 0,
                    "hsl": 0,
                    "syl": 0,
                    "sjl": 0,
                    "lt": 0,
                    "zsz": 0,
                    "zf": _to_float(row.get("high", 0)) - _to_float(row.get("low", 0)) if pre_close > 0 else 0,
                    "zt": 0,
                    "dt": 0,
                    "time": latest_date,
                    "source": "tushare_daily_batch",
                }

                # 补充 daily_basic 数据
                basic_row = basic_map.get(ts_code)
                if basic_row is not None:
                    result["hsl"] = _to_float(basic_row.get("turnover_rate", 0))
                    result["syl"] = _to_float(basic_row.get("pe_ttm", basic_row.get("pe", 0)))
                    result["sjl"] = _to_float(basic_row.get("pb", 0))
                    result["zsz"] = round(_to_float(basic_row.get("total_mv", 0)) / 10000, 2)
                    result["lt"] = round(_to_float(basic_row.get("circ_mv", 0)) / 10000, 2)

                results[secid] = result

            return results
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
            # 检查缓存数据总长度是否满足 limit 要求（避免缓存数据量太少的情况）
            if limit > 0 and len(cached_data) < limit:
                return False
            # 检查截止日期是否满足
            if not end_date_std:
                # 未指定 end_date：检查是否包含最新交易日
                expected_last_str = _get_expected_last_trade_date(period)
                expected_last = _parse_date_str(expected_last_str)
                if expected_last is None or last_date < expected_last:
                    return False
            else:
                # 指定了 end_date：检查缓存是否覆盖到 end_date
                end_date_dt = _parse_date_str(end_date_std)
                if end_date_dt is None or last_date < end_date_dt:
                    return False
            # 检查 limit 是否满足：按 end_date 裁剪后数据量需 >= limit
            if limit > 0:
                data = cached_data[:]
                if end_date_std:
                    end_date_dt = _parse_date_str(end_date_std)
                    if end_date_dt:
                        data = [k for k in data if _parse_date_str(k.get('date', '')) <= end_date_dt]
                if len(data) < limit:
                    return False
            return True

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
            # 对于 market==2 的代码（东财概念板块/中证指数），优先尝试 _get_index_kline（index_daily + .CSI），
            # 因为中证指数如 931068.CSI 更常见；如果返回空则 fallback 到 _get_board_kline（dc_daily + .DC）
            is_market2 = "." in secid and secid.split(".")[0] == "2"
            code_pure = convert_secid_to_pure_code(secid)
            is_concept_board = code_pure.startswith("BK") or code_pure.startswith("88") or secid.startswith("90.")

            if is_market2 and not is_concept_board:
                # 先尝试中证指数（index_daily）
                result = TushareAPI._get_index_kline(secid, period, limit, end_date_fmt)
                if isinstance(result, list) and len(result) > 0:
                    return result
                if isinstance(result, dict) and result.get("error"):
                    # index_daily 失败，fallback 到 dc_daily
                    print(f"[market2 fallback] index_daily 失败 ({result.get('error')})，尝试 dc_daily")
                elif isinstance(result, list) and len(result) == 0:
                    print(f"[market2 fallback] index_daily 返回空，尝试 dc_daily")
                result = TushareAPI._get_board_kline(secid, period)
                return result

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
    def _try_fetch_index_kline(pro, ts_code: str, period: str, start_date: str, end_date_fmt: str):
        """尝试用指定 ts_code 获取指数K线，返回 (df, None) 或 (None, error_dict)"""
        try:
            if period == 'daily':
                df = pro.index_daily(ts_code=ts_code, start_date=start_date, end_date=end_date_fmt)
            elif period == 'weekly':
                df = pro.index_weekly(ts_code=ts_code, start_date=start_date, end_date=end_date_fmt)
            elif period == 'monthly':
                df = pro.index_monthly(ts_code=ts_code, start_date=start_date, end_date=end_date_fmt)
            else:
                df = pro.index_daily(ts_code=ts_code, start_date=start_date, end_date=end_date_fmt)
            if df is not None and not df.empty:
                return df, None
            return None, None
        except Exception as e:
            return None, {"error": str(e)}

    @staticmethod
    def _get_index_kline(secid: str, period: str = "daily", limit: int = 0, end_date: Optional[str] = None) -> List[Dict[str, Any]]:
        """获取指数K线数据（index_daily/weekly/monthly）

        对于 market==1 且 code 以 000 或 9 开头的指数代码，
        无法从代码本身区分是上证指数(.SH)还是中证指数(.CSI)，
        因此先尝试 .CSI（中证指数），失败则 fallback 到 .SH（上证指数）。
        """
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

            # 对于 market==1 的 000xxx/9xxxxx 指数，无法区分上证(.SH)还是中证(.CSI)
            # 先尝试 .CSI（中证指数），失败再 fallback 到 .SH
            df = None
            last_error = None
            if "." in secid:
                mk, code = secid.split(".")
                if mk == "1" and len(code) == 6 and code.isdigit() and (code.startswith("000") or code.startswith("9")):
                    csi_code = f"{code}.CSI"
                    df, err = TushareAPI._try_fetch_index_kline(pro, csi_code, period, start_date, end_date_fmt)
                    if df is not None:
                        print(f"[_get_index_kline] 使用 .CSI 成功: {csi_code}")
                    elif err:
                        print(f"[_get_index_kline] .CSI 失败 ({err.get('error')}), 尝试 .SH: {csi_code}")
                        last_error = err
                    else:
                        print(f"[_get_index_kline] .CSI 返回空, 尝试 .SH: {csi_code}")
                    if df is None:
                        # fallback 到 .SH
                        df, err2 = TushareAPI._try_fetch_index_kline(pro, ts_code, period, start_date, end_date_fmt)
                        if err2:
                            last_error = err2

            # 非 fallback 场景：直接使用 ts_code
            if df is None and last_error is None:
                df, last_error = TushareAPI._try_fetch_index_kline(pro, ts_code, period, start_date, end_date_fmt)

            if df is None or df.empty:
                return last_error or {"error": "No data available"}

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
        """获取东财板块K线（dc_daily，6000积分）

        缓存策略：参照 get_kline_data，缓存 key 与 trade_date 无关，
        通过比较缓存最新日期与预期最新交易日来判断缓存是否过期。
        """
        try:
            code = convert_secid_to_pure_code(secid)
            pro = get_pro()
            today = datetime.now().strftime("%Y%m%d")
            # 用 trade_cal 获取最近交易日，避免非交易日导致 dc_daily 返回空
            trade_date = today
            try:
                cal_df = pro.trade_cal(exchange='SSE', start_date=(datetime.now() - timedelta(days=30)).strftime('%Y%m%d'), end_date=today, is_open='1')
                if cal_df is not None and not cal_df.empty:
                    # trade_cal 默认返回降序，iloc[0] 才是最近交易日
                    trade_date = str(cal_df['cal_date'].iloc[0])
            except Exception:
                pass
            start_date = (datetime.now() - timedelta(days=730)).strftime("%Y%m%d")

            # dc_daily 需要 BKxxxx.DC 格式
            ts_code = f"{code}.DC" if not code.endswith(".DC") else code

            # 缓存 key 与 trade_date 无关，参照 get_kline_data 的缓存策略
            cache_key = f"board_kline_{ts_code}_{period}"
            # 获取预期最新交易日
            expected_last_str = _get_expected_last_trade_date(period)
            expected_last = _parse_date_str(expected_last_str)

            # 检查缓存是否有效
            cached_df = read_cache(cache_key, max_age_hours=168 * 4)  # 最长缓存 4 周
            cache_valid = False
            if cached_df is not None and isinstance(cached_df, pd.DataFrame) and not cached_df.empty:
                cache_max_date_str = str(cached_df['trade_date'].max())
                cache_max_date = _parse_date_str(cache_max_date_str)
                if cache_max_date is not None and expected_last is not None:
                    if cache_max_date >= expected_last:
                        cache_valid = True
                        print(f"[板块K线缓存命中] {ts_code} 缓存最新={cache_max_date_str} >= 需求={expected_last_str}")
                    else:
                        print(f"[板块K线缓存过期] {ts_code} 缓存最新={cache_max_date_str} < 需求={expected_last_str}，重新拉取")

            if cache_valid:
                df = cached_df
            else:
                # 缓存无效，重新拉取。直接用 today 作为 end_date（不用 trade_date），
                # 因为 dc_daily 接口本身支持未来日期查询，会返回截至最新数据
                df = safe_api_call(pro.dc_daily, ts_code=ts_code, start_date=start_date, end_date=today)
                if isinstance(df, pd.DataFrame) and not df.empty:
                    write_cache(cache_key, df)

            debug_info = {
                "ts_code": ts_code,
                "start_date": start_date,
                "end_date": today,
                "query_type": "range",
                "df_type": type(df).__name__,
                "expected_last": expected_last_str,
                "cache_hit": cache_valid,
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
                        # trade_cal 默认返回降序，sorted 升序后取 [-5:] 才是最近5天
                        recent_dates = sorted(cal_df['cal_date'].astype(str).tolist())[-5:]
                        for td in recent_dates:
                            day_df = safe_api_call(pro.dc_daily, ts_code=ts_code, trade_date=td)
                            if isinstance(day_df, pd.DataFrame) and not day_df.empty:
                                range_dfs.append(day_df)
                        if range_dfs:
                            df = pd.concat(range_dfs, ignore_index=True)
                            debug_info["query_type"] = "daily_concat"
                            debug_info["concat_dates"] = recent_dates
                            debug_info["df_shape"] = df.shape
                            write_cache(cache_key, df)
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
    def _get_trend_from_eastmoney(secid: str) -> List[Dict[str, Any]]:
        """从东方财富获取指数/板块分时数据（腾讯个股接口不支持 market==2 的指数代码）"""
        if requests is None:
            return {"error": "requests 未安装"}
        try:
            url = "http://push2his.eastmoney.com/api/qt/stock/trends2/get"
            params = {
                "secid": secid,
                "fields1": "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13",
                "fields2": "f51,f52,f53,f54,f55,f56,f57,f58",
                "ndays": 1,
                "iscr": 0,
                "iscca": 0,
                "_": int(datetime.now().timestamp() * 1000),
            }
            resp = requests.get(url, params=params, timeout=10)
            resp.encoding = "utf-8"
            data = resp.json()
            if not data.get("data") or not data["data"].get("trends"):
                return {"error": "No trend data available"}
            
            trends = []
            for item in data["data"]["trends"]:
                parts = item.split(",")
                if len(parts) < 8:
                    continue
                datetime_str = parts[0]
                last = _to_float(parts[1])
                current = _to_float(parts[2])
                vol = int(parts[5] or 0)
                average = _to_float(parts[7])
                if current <= 0:
                    continue
                up = 1 if current >= last else -1
                trends.append({
                    "datetime": datetime_str,
                    "current": current,
                    "last": last,
                    "vol": vol,
                    "average": average,
                    "up": up,
                })
            return trends
        except Exception as e:
            return {"error": str(e)}

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
        对于指数/板块代码（market==2 或 is_index_code 为 True），使用东方财富分时接口（腾讯个股接口不支持）
        """
        if ak is None:
            return {"error": "akshare 未安装，无法获取分时数据"}
        try:
            # 指数/板块代码，腾讯个股分时接口不支持，直接用东方财富
            # market==2：东财概念指数/板块
            # market==1 + 指数代码：沪市/中证指数（如 1.000001 上证指数、1.000949 中证农业等）
            if "." in secid:
                mk = secid.split(".")[0]
                if mk == "2" or is_index_code(secid):
                    return TushareAPI._get_trend_from_eastmoney(secid)

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
                # 指数代码走东方财富分时接口
                if "." in secid:
                    mk = secid.split(".")[0]
                    if mk == "2" or is_index_code(secid):
                        return TushareAPI._get_trend_from_eastmoney(secid)
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

                # 先尝试带 trade_date 查询（按板块缓存，trade_date 为 key）
                df = _cached_dc_member(pro, ts_code, trade_date)
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
    def get_boards_by_date_batch(dates: List[str], bk_type: Optional[str] = None) -> Dict[str, Any]:
        """批量获取多个交易日的全市场板块数据
        
        Args:
            dates: 交易日期数组 (YYYYMMDD)
            bk_type: 板块类型，"industry"(行业板块) 或 "concept"(概念板块)。
                    不传则默认合并 industry + concept
        """
        result = {}
        for date in dates:
            if bk_type:
                data = TushareAPI.get_boards_by_date(bk_type=bk_type, date=date)
                all_boards = []
                if isinstance(data, dict) and data.get("boards"):
                    all_boards.extend(data["boards"])
            else:
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
    def get_industry_stocks(secid: str, date: Optional[str] = None) -> Dict[str, Any]:
        """获取申万二级行业成分股（支持 801010.SI 或 90.801010 格式）

        通过 index_member 接口获取申万行业指数成分股，并通过 daily + daily_basic 补全行情数据。
        返回格式与 get_board_stocks 兼容：{ total, stocks: [{ code, name, secid, zx, zdf, ... }] }
        """
        try:
            # 统一提取申万行业代码
            code = convert_secid_to_pure_code(secid)
            if '.' in code:
                code = code.split('.')[0]
            # 确保是 801 开头的申万二级行业代码
            if not code.startswith('801') or len(code) != 6:
                return {"error": f"Invalid SW industry code: {secid}"}

            ts_code = f"{code}.SI"
            target_date = (date or datetime.now().strftime('%Y%m%d')).replace("-", "")

            pro = get_pro()

            # 1. 获取成分股
            df = safe_api_call(pro.index_member, index_code=ts_code)
            if isinstance(df, dict) and df.get("error"):
                return df
            if df is None or df.empty:
                return {"total": 0, "stocks": [], "source": "sw_index_member"}

            # 过滤仍在成分股中的（out_date 为空表示当前仍在）
            df = df[df['out_date'].isna() | (df['out_date'] == '')]
            if df.empty:
                return {"total": 0, "stocks": [], "source": "sw_index_member"}

            # 2. 获取最近交易日
            trade_date = target_date
            try:
                cal_df = pro.trade_cal(exchange='SSE', start_date=(datetime.now() - timedelta(days=10)).strftime('%Y%m%d'), end_date=target_date, is_open='1')
                if cal_df is not None and not cal_df.empty:
                    trade_date = str(cal_df['cal_date'].iloc[0])
            except Exception:
                pass

            # 3. 批量获取全市场当日行情
            market_data: Dict[str, Dict[str, Any]] = {}
            try:
                daily_df = pro.daily(trade_date=trade_date)
                if daily_df is not None and not daily_df.empty:
                    for _, row in daily_df.iterrows():
                        tc = str(row.get("ts_code", ""))
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

            # 4. 批量获取全市场当日基础指标
            try:
                basic_df = pro.daily_basic(trade_date=trade_date)
                if basic_df is not None and not basic_df.empty:
                    for _, row in basic_df.iterrows():
                        tc = str(row.get("ts_code", ""))
                        if tc in market_data:
                            market_data[tc].update({
                                "hsl": _to_float(row.get("turnover_rate", 0)),
                                "syl": _to_float(row.get("pe_ttm", row.get("pe", 0))),
                                "sjl": _to_float(row.get("pb", 0)),
                                "sz": round(_to_float(row.get("total_mv", 0)) / 10000, 2),
                                "lt": round(_to_float(row.get("circ_mv", 0)) / 10000, 2),
                            })
            except Exception as e:
                print(f"[daily_basic 批量查询失败] {e}")

            # 5. 组装结果
            stocks = []
            for _, row in df.iterrows():
                con_code = str(row.get("con_code", ""))
                stock_code = con_code.split(".")[0] if "." in con_code else con_code
                if not stock_code or not stock_code.isdigit():
                    continue
                market = 1 if stock_code.startswith("6") else 0
                secid_out = f"{market}.{stock_code}"
                member_ts = f"{stock_code}.{'SH' if stock_code.startswith('6') else 'SZ'}"
                md = market_data.get(member_ts, {})
                zx = md.get("zx", 0)
                zs = md.get("zs", 0)
                zf = round((md.get("zg", 0) - md.get("zd", 0)) / zs * 100, 2) if zs > 0 else 0
                stocks.append({
                    "code": stock_code,
                    "name": str(row.get("con_name", "")),
                    "secid": secid_out,
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
                    "main_in": 0,
                    "main_in_5d": 0,
                    "cm5": 0,
                    "cd60": 0,
                    "cy1": 0,
                    "cs": 0,
                })

            return {
                "total": len(stocks),
                "stocks": stocks,
                "date": target_date,
                "source": "sw_index_member",
                "industry_code": code,
            }
        except Exception as e:
            return {"error": str(e)}

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
                # 东财概念：使用 dc_member（按板块缓存，trade_date 为 key）
                ts_code = f"{concept_code}.DC" if not concept_code.endswith(".DC") else concept_code
                trade_date = datetime.now().strftime('%Y%m%d')
                df = _cached_dc_member(pro, ts_code, trade_date)
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

    # ------------------ 市场情绪指标（涨跌比）------------------

    @staticmethod
    def get_up_down_ratio(date: Optional[str] = None) -> Dict[str, Any]:
        """获取特定日期的市场涨跌比（市场情绪/风险偏好指标）

        通过全市场日线数据统计上涨/下跌/平盘家数，并计算涨跌停家数、成交额等。
        可用于判断当日市场整体风险偏好：涨跌比 > 2 为高风险偏好，< 0.5 为低风险偏好。

        支持磁盘缓存：所有日期的涨跌比数据合并缓存到一个文件（up_down_ratio_map.json），
        历史日期长期有效，当天数据缓存 1 小时。查询时优先命中缓存，未命中则请求后补充写入。

        Args:
            date: 交易日期(YYYYMMDD)，不传则默认最近交易日

        Returns:
            {
                "date": "20240101",
                "up_count": 3200,        # 上涨家数
                "down_count": 1500,      # 下跌家数
                "flat_count": 100,       # 平盘家数
                "total_count": 4800,     # 总交易家数
                "up_down_ratio": 2.13,   # 涨跌比 = up_count / down_count
                "up_in_total": 0.5,     # 上涨比例 = up_count / (up_count + down_count)
                "limit_up_count": 80,    # 涨停家数
                "limit_down_count": 5,   # 跌停家数
                "up_limit_ratio": 1.67,  # 涨跌停比 = limit_up_count / limit_down_count
                "total_amount": 123456789000.0,  # 全市场成交额（元）
                "avg_zdf": 0.85,         # 平均涨跌幅%
                "median_zdf": 0.62,      # 涨跌幅中位数%
                "up_5pct_count": 450,    # 涨幅>5%家数
                "down_5pct_count": 120,  # 跌幅>5%家数
                "strong_type": "high"    # 情绪判定: high(强)/neutral(中性)/low(弱)
            }
        """
        try:
            pro = get_pro()
            target_date = (date or datetime.now().strftime('%Y%m%d')).replace("-", "")
            today_str = datetime.now().strftime('%Y%m%d')
            cache_key = "up_down_ratio_map"

            # 读取统一缓存文件（历史日期长期有效，用大 max_age）
            cached = read_cache(cache_key, max_age_hours=8760)
            if not isinstance(cached, dict):
                cached = {}

            # 命中缓存检查
            if target_date in cached:
                # 历史日期直接命中；当天数据检查 1 小时时效
                if target_date != today_str:
                    print(f"[涨跌比缓存命中] {target_date}")
                    return cached[target_date]
                # 当天数据：检查文件修改时间是否超过 1 小时
                path = _cache_path(cache_key)
                if os.path.exists(path):
                    mtime = os.path.getmtime(path)
                    age_hours = (datetime.now().timestamp() - mtime) / 3600
                    if age_hours <= 1:
                        print(f"[涨跌比缓存命中] {target_date}")
                        return cached[target_date]
                # 当天缓存过期，移除后重新请求
                cached.pop(target_date, None)

            # 1. 获取全市场日线
            daily_df = safe_api_call(pro.daily, trade_date=target_date)
            if isinstance(daily_df, dict) and daily_df.get("error"):
                return daily_df
            if daily_df is None or daily_df.empty:
                return {"error": f"No daily data available for date {target_date}"}

            # 2. 统计涨跌分布
            pct_chg = daily_df['pct_chg'].astype(float)
            up_count = int((pct_chg > 0).sum())
            down_count = int((pct_chg < 0).sum())
            flat_count = int((pct_chg == 0).sum())
            total_count = len(pct_chg)

            up_5pct = int((pct_chg >= 5).sum())
            down_5pct = int((pct_chg <= -5).sum())
            up_7pct = int((pct_chg >= 7).sum())
            down_7pct = int((pct_chg <= -7).sum())

            avg_zdf = round(pct_chg.mean(), 2)
            median_zdf = round(pct_chg.median(), 2)

            # 3. 全市场成交额（daily 接口 amount 单位：千元 → 元）
            total_amount = round(daily_df['amount'].astype(float).sum() * 1000, 2)

            # 4. 获取涨跌停数据
            limit_up_count = 0
            limit_down_count = 0
            try:
                limit_df = safe_api_call(pro.limit_list, trade_date=target_date)
                if isinstance(limit_df, pd.DataFrame) and not limit_df.empty:
                    limit_up_count = int((limit_df['limit'] == 'U').sum())
                    limit_down_count = int((limit_df['limit'] == 'D').sum())
            except Exception:
                pass

            # 5. 计算情绪判定
            up_down_ratio = round(up_count / down_count, 2) if down_count > 0 else 999.0
            limit_ratio = round(limit_up_count / limit_down_count, 2) if limit_down_count > 0 else 999.0

            if up_down_ratio >= 2 and limit_up_count >= 50:
                strong_type = "high"
            elif up_down_ratio <= 0.5 or limit_down_count >= 30:
                strong_type = "low"
            else:
                strong_type = "neutral"
            
            # 6. 计算上涨占比
            up_ratio = round(up_count / total_count, 2) if total_count > 0 else 999.0
            result = {
                "date": target_date,
                "up_count": up_count,
                "down_count": down_count,
                "flat_count": flat_count,
                "total_count": total_count,
                "up_down_ratio": up_down_ratio,
                "up_in_total": up_ratio,
                "limit_up_count": limit_up_count,
                "limit_down_count": limit_down_count,
                "up_limit_ratio": limit_ratio,
                "total_amount": total_amount,
                "avg_zdf": avg_zdf,
                "median_zdf": median_zdf,
                "up_5pct_count": up_5pct,
                "down_5pct_count": down_5pct,
                "up_7pct_count": up_7pct,
                "down_7pct_count": down_7pct,
                "strong_type": strong_type,
            }

            # 补充到统一缓存文件并写入
            cached[target_date] = result
            write_cache(cache_key, cached)
            print(f"[涨跌比缓存更新] {target_date}，当前共 {len(cached)} 个日期")
            return result
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_up_down_ratio_batch(dates: List[str]) -> Dict[str, Any]:
        """批量获取多个交易日的市场涨跌比数据

        Args:
            dates: 交易日期数组 (YYYYMMDD 或 YYYY-MM-DD)

        Returns:
            {
                "20240101": { up_count, down_count, ... },
                "20240102": { up_count, down_count, ... },
                ...
            }
        """
        result = {}
        for date in dates:
            try:
                data = TushareAPI.get_up_down_ratio(date=date)
                # 统一键为 YYYYMMDD
                key = date.replace("-", "")
                if isinstance(data, dict) and data.get("error"):
                    result[key] = {"error": data["error"]}
                else:
                    result[key] = data
            except Exception as e:
                key = date.replace("-", "")
                result[key] = {"error": str(e)}
        return result

    # ------------------ 选股模块 - 步骤拆分接口 ------------------

    @staticmethod
    def filter_industries(trade_date: str, fund_flow_days: int = 5,
                          fund_flow_rank_pct: float = 0.3, min_return_5d: float = 2.0,
                          min_rs: float = 1.1, require_ma_bull: bool = True,
                          return_all: bool = False) -> Dict[str, Any]:
        """步骤1: 筛选值得投资的二级行业

        当 return_all=True 时返回所有行业（不过滤），并标记 passed 字段
        返回可 JSON 序列化的行业列表（不含内部 DataFrame 对象）
        """
        try:
            selector = StockSelector()
            config = IndustryFilterConfig(
                fund_flow_days=fund_flow_days,
                fund_flow_rank_pct=fund_flow_rank_pct,
                min_return_5d=min_return_5d,
                min_rs=min_rs,
                require_ma_bull=require_ma_bull,
            )
            df = selector.filter_industries(trade_date, config, return_all=return_all)
            if df.empty:
                return {"industries": [], "count": 0, "trade_date": trade_date}

            # 去掉不可序列化的 kline DataFrame 列
            result_df = df.drop(columns=['kline'], errors='ignore')
            records = df_to_records(result_df)
            return {"industries": records, "count": len(records), "trade_date": trade_date, "return_all": return_all}
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_industry_leaders(industry_code: str, trade_date: str, top_n: int = 10) -> Dict[str, Any]:
        """步骤2: 识别某行业的龙头股票

        对指定行业的所有成分股计算龙头得分，按得分降序返回前N只
        """
        try:
            selector = StockSelector()

            # 获取行业K线（供相关性计算使用）
            end_dt = datetime.strptime(trade_date, "%Y%m%d")
            start_dt = end_dt - timedelta(days=120)
            start_date = start_dt.strftime("%Y%m%d")
            kline = selector.get_industry_kline(industry_code, start_date, trade_date)

            # 获取成分股
            members = selector.pro.index_member(index_code=industry_code)
            if members is None or members.empty:
                return {"leaders": [], "count": 0, "industry_code": industry_code}

            stock_scores = []
            for code in members['con_code']:
                score_info = selector.calc_stock_leader_score(code, trade_date, kline)
                if score_info:
                    # 去掉不可序列化的 kline DataFrame
                    score_info.pop('kline', None)
                    stock_scores.append(score_info)

            if not stock_scores:
                return {"leaders": [], "count": 0, "industry_code": industry_code}

            stock_df = pd.DataFrame(stock_scores).sort_values('leader_score', ascending=False)
            stock_df = stock_df.head(top_n)
            records = df_to_records(stock_df)
            return {
                "leaders": records,
                "count": len(records),
                "industry_code": industry_code,
                "trade_date": trade_date,
            }
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def risk_filter_stocks(trade_date: str, stocks: List[str],
                           min_circ_mv: float = 20, max_circ_mv: float = 800,
                           min_avg_amount: float = 5000, min_profit_growth: float = -30,
                           max_decline_from_high: float = 15,
                           require_above_ma250: bool = False) -> Dict[str, Any]:
        """步骤3: 对股票列表进行排雷过滤

        Args:
            stocks: ts_code 列表，如 ["000001.SZ", "600000.SH"]
        Returns:
            {"results": [{ts_code, passed, reason}], passed_count, count}
        """
        try:
            selector = StockSelector()
            config = StockFilterConfig(
                min_circ_mv=min_circ_mv,
                max_circ_mv=max_circ_mv,
                min_avg_amount=min_avg_amount,
                min_profit_growth=min_profit_growth,
                max_decline_from_high=max_decline_from_high,
                require_above_ma250=require_above_ma250,
            )
            results = []
            for ts_code in stocks:
                passed, reason = selector.risk_filter(ts_code, trade_date, config)
                results.append({
                    "ts_code": ts_code,
                    "passed": passed,
                    "reason": reason,
                })
            return {
                "results": results,
                "count": len(results),
                "passed_count": sum(1 for r in results if r['passed']),
                "trade_date": trade_date,
            }
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def check_buy_signals(trade_date: str, stocks: List[str],
                          strategy: str = "breakout", breakout_volume_ratio: float = 1.5,
                          callback_to_ma: str = "ma10", max_callback_depth: float = 8) -> Dict[str, Any]:
        """步骤4: 对股票列表检查买入信号

        Args:
            stocks: ts_code 列表
        Returns:
            {"results": [{ts_code, has_signal, signal_type, signal_detail}], signal_count, count}
        """
        try:
            selector = StockSelector()
            config = BuySignalConfig(
                strategy=strategy,
                breakout_volume_ratio=breakout_volume_ratio,
                callback_to_ma=callback_to_ma,
                max_callback_depth=max_callback_depth,
            )
            results = []
            for ts_code in stocks:
                has_signal, signal_type, signal_detail = selector.check_buy_signal(
                    ts_code, trade_date, config
                )
                results.append({
                    "ts_code": ts_code,
                    "has_signal": has_signal,
                    "signal_type": signal_type,
                    "signal_detail": signal_detail,
                })
            return {
                "results": results,
                "count": len(results),
                "signal_count": sum(1 for r in results if r['has_signal']),
                "trade_date": trade_date,
            }
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
    def _calc_money_flow_from_row_dc_ind(row) -> Dict[str, Any]:
        """从 moneyflow_ind_dc（东财板块）数据行计算资金流向，所有金额统一返回为元

        moneyflow_ind_dc 返回的字段已经是净额（元），与 moneyflow_dc 类似：
        - buy_sm_amount: 小单净额（散户）
        - buy_md_amount: 中单净额（中户）
        - buy_lg_amount: 大单净额
        - buy_elg_amount: 超大单净额
        - net_amount: 主力净额 = buy_lg_amount + buy_elg_amount
        - net_amount_rate: 主力净流入占比
        """
        small_in = _to_float(row.get("buy_sm_amount", 0))
        medium_in = _to_float(row.get("buy_md_amount", 0))
        big_in = _to_float(row.get("buy_lg_amount", 0))
        super_big_in = _to_float(row.get("buy_elg_amount", 0))
        # 主力净流入 = 大单净额 + 超大单净额
        main_in = big_in + super_big_in
        # 主力净流入占比：优先使用接口返回的 net_amount_rate
        main_rate = _to_float(row.get("net_amount_rate", 0))
        # 如果 net_amount_rate 为 0 但主力不为 0，用反推计算
        if main_rate == 0 and main_in != 0:
            net_amount = _to_float(row.get("net_amount", 0))
            if net_amount != 0:
                net_amount_rate = _to_float(row.get("net_amount_rate", 0))
                if net_amount_rate != 0:
                    total_trade = abs(net_amount / net_amount_rate * 100)
                    main_rate = round(main_in / total_trade * 100, 2) if total_trade > 0 else 0
        # 总成交额（所有分档金额绝对值之和，用于计算净流入率）
        total_amount = abs(small_in) + abs(medium_in) + abs(big_in) + abs(super_big_in)
        return {
            "main_in": round(main_in, 2),
            "small_in": round(small_in, 2),
            "medium_in": round(medium_in, 2),
            "big_in": round(big_in, 2),
            "super_big_in": round(super_big_in, 2),
            "main_rate": main_rate,
            "total_amount": round(total_amount, 2),
        }

    @staticmethod
    def _calc_money_flow_from_row_dc(row) -> Dict[str, Any]:
        """从 moneyflow_dc（东财个股）数据行计算资金流向，所有金额统一返回为元

        moneyflow_dc 返回的字段已经是净额（万元），不需要买入-卖出计算：
        - buy_sm_amount: 小单净额（散户）
        - buy_md_amount: 中单净额（中户）
        - buy_lg_amount: 大单净额
        - buy_elg_amount: 超大单净额
        - net_amount: 主力净额 = buy_lg_amount + buy_elg_amount
        - net_amount_rate: 主力净流入占比
        """
        multiplier = 10000  # moneyflow_dc 金额单位为万元
        small_in = _to_float(row.get("buy_sm_amount", 0)) * multiplier
        medium_in = _to_float(row.get("buy_md_amount", 0)) * multiplier
        big_in = _to_float(row.get("buy_lg_amount", 0)) * multiplier
        super_big_in = _to_float(row.get("buy_elg_amount", 0)) * multiplier
        # 主力净流入 = 大单净额 + 超大单净额
        main_in = big_in + super_big_in
        # 主力净流入占比：优先使用接口返回的 net_amount_rate
        main_rate = _to_float(row.get("net_amount_rate", 0))
        # 如果 net_amount_rate 为 0 但主力不为 0，用反推计算
        if main_rate == 0 and main_in != 0:
            net_amount = _to_float(row.get("net_amount", 0)) * multiplier
            if net_amount != 0:
                net_amount_rate = _to_float(row.get("net_amount_rate", 0))
                if net_amount_rate != 0:
                    total_trade = abs(net_amount / net_amount_rate * 100)
                    main_rate = round(main_in / total_trade * 100, 2) if total_trade > 0 else 0
        # 总成交额（所有分档金额绝对值之和，用于计算净流入率）
        total_amount = abs(small_in) + abs(medium_in) + abs(big_in) + abs(super_big_in)
        return {
            "main_in": round(main_in, 2),
            "small_in": round(small_in, 2),
            "medium_in": round(medium_in, 2),
            "big_in": round(big_in, 2),
            "super_big_in": round(super_big_in, 2),
            "main_rate": main_rate,
            "total_amount": round(total_amount, 2),
        }

    @staticmethod
    def _get_money_flow_single_day(pro, code: str, trade_date: str) -> Dict[str, Any]:
        """获取单日资金流向数据，所有金额统一返回为元"""
        if code.startswith("BK") or code.startswith("90."):
            # 板块资金流向：东财 moneyflow_ind_dc，金额单位已经是元
            ts_code = f"{code}.DC" if not code.endswith(".DC") else code
            df = safe_api_call(pro.moneyflow_ind_dc, ts_code=ts_code, trade_date=trade_date)
            if isinstance(df, dict) and df.get("error"):
                return None
            if df is None or df.empty:
                return None
            row = df.iloc[0]
            return TushareAPI._calc_money_flow_from_row_dc_ind(row)
        else:
            # 个股资金流向：东财 moneyflow_dc，字段为净额（万元），数据与东方财富APP一致
            ts_code = f"{code}.SH" if code.startswith('6') else f"{code}.SZ"
            df = safe_api_call(pro.moneyflow_dc, ts_code=ts_code, start_date=trade_date, end_date=trade_date)
            if isinstance(df, dict) and df.get("error"):
                return None
            if df is None or df.empty:
                return None
            row = df.iloc[0]
            return TushareAPI._calc_money_flow_from_row_dc(row)

    @staticmethod
    def get_money_flow(code: str, days: Optional[int] = None) -> Dict[str, Any]:
        """获取资金流向：
        - 个股用 moneyflow_dc（东财个股），字段为净额（万元），数据与东方财富APP一致
        - 板块用 moneyflow_ind_dc（东财板块），字段为买入/卖出金额（元）

        moneyflow_dc 返回字段（净额）：
        buy_sm_amount(小单净额), buy_md_amount(中单净额),
        buy_lg_amount(大单净额), buy_elg_amount(超大单净额),
        net_amount(主力净额), net_amount_rate(主力净流入占比)

        当 days 参数指定时，返回最近 N 个交易日的资金流向数据，按主力/散户分类汇总：
        - 主力 = 大单 + 超大单
        - 散户 = 小单
        返回字段包含：
        - main_1d / main_3d / main_5d / main_10d / main_20d: 各周期的主力净流入
        - retail_1d / retail_3d / retail_5d / retail_10d / retail_20d: 各周期的散户净流入
        - detail_dates: 每日明细的日期列表
        - detail_main: 每日主力净流入列表
        - detail_retail: 每日散户净流入列表
        """
        try:
            pro = get_pro()
            today = datetime.now().strftime('%Y%m%d')

            # 判断板块/个股
            is_board = code.startswith("BK") or code.startswith("90.")
            # 个股也用东财数据源（moneyflow_dc），与东方财富APP一致
            source = "dc"

            if days:
                start_date = (datetime.now() - timedelta(days=days + 45)).strftime('%Y%m%d')

                if is_board:
                    ts_code = f"{code}.DC" if not code.endswith(".DC") else code
                    df = safe_api_call(pro.moneyflow_ind_dc, ts_code=ts_code, start_date=start_date, end_date=today)
                else:
                    ts_code = f"{code}.SH" if code.startswith('6') else f"{code}.SZ"
                    df = safe_api_call(pro.moneyflow_dc, ts_code=ts_code, start_date=start_date, end_date=today)

                if isinstance(df, dict) and df.get("error"):
                    return df
                if df is None or df.empty:
                    return {"error": "No data"}

                # 按日期排序，取最近 days 条
                df = df.sort_values('trade_date', ascending=True).reset_index(drop=True)
                if len(df) > days:
                    df = df.iloc[-days:]

                # 计算每日数据：个股用 _calc_money_flow_from_row_dc，板块用 _calc_money_flow_from_row_dc_ind
                daily_data = []
                for _, row in df.iterrows():
                    date_val = row.get('trade_date', '')
                    date_str = _standardize_date(date_val)
                    if is_board:
                        day_data = TushareAPI._calc_money_flow_from_row_dc_ind(row)
                    else:
                        day_data = TushareAPI._calc_money_flow_from_row_dc(row)
                    day_data["trade_date"] = date_str
                    daily_data.append(day_data)

                if not daily_data:
                    return {"error": "No data for any trading day"}

                # 获取每日收盘价（用于计算平均成本）
                close_prices = []
                if not is_board:
                    try:
                        first_date = daily_data[0]["trade_date"].replace('-', '')
                        last_date = daily_data[-1]["trade_date"].replace('-', '')
                        daily_df = safe_api_call(pro.daily, ts_code=ts_code, start_date=first_date, end_date=last_date)
                        if daily_df is not None and not daily_df.empty:
                            daily_df = daily_df.sort_values('trade_date', ascending=True).reset_index(drop=True)
                            price_map = {}
                            for _, row in daily_df.iterrows():
                                date_str_p = _standardize_date(row.get('trade_date', ''))
                                price_map[date_str_p] = _to_float(row.get('close', 0))
                            close_prices = [price_map.get(d.get("trade_date", ""), 0) for d in daily_data]
                    except Exception:
                        close_prices = [0] * len(daily_data)

                # 计算各周期的累计值（1日/3日/5日/10日/20日）
                def sum_period(data_list, n):
                    """取最近 n 天的累计，返回 (主力, 散户, 中户)"""
                    subset = data_list[-n:] if len(data_list) >= n else data_list
                    main_sum = sum(d.get("main_in", 0) for d in subset)
                    retail_sum = sum(d.get("small_in", 0) for d in subset)
                    medium_sum = sum(d.get("medium_in", 0) for d in subset)
                    return main_sum, retail_sum, medium_sum

                def avg_cost_period(n):
                    """取最近 n 天的平均收盘价"""
                    if not close_prices or n > len(close_prices):
                        return 0
                    subset = close_prices[-n:]
                    valid = [p for p in subset if p > 0]
                    return round(sum(valid) / len(valid), 2) if valid else 0

                main_1d, retail_1d, medium_1d = sum_period(daily_data, 1)
                main_3d, retail_3d, medium_3d = sum_period(daily_data, 3)
                main_5d, retail_5d, medium_5d = sum_period(daily_data, 5)
                main_10d, retail_10d, medium_10d = sum_period(daily_data, 10)
                main_20d, retail_20d, medium_20d = sum_period(daily_data, 20)

                # 最新一日的详细分档数据
                latest = daily_data[-1]

                return {
                    "source": source,
                    # 各周期主力净流入
                    "main_1d": round(main_1d, 2),
                    "main_3d": round(main_3d, 2),
                    "main_5d": round(main_5d, 2),
                    "main_10d": round(main_10d, 2),
                    "main_20d": round(main_20d, 2),
                    # 各周期散户净流入
                    "retail_1d": round(retail_1d, 2),
                    "retail_3d": round(retail_3d, 2),
                    "retail_5d": round(retail_5d, 2),
                    "retail_10d": round(retail_10d, 2),
                    "retail_20d": round(retail_20d, 2),
                    # 各周期中户净流入
                    "medium_1d": round(medium_1d, 2),
                    "medium_3d": round(medium_3d, 2),
                    "medium_5d": round(medium_5d, 2),
                    "medium_10d": round(medium_10d, 2),
                    "medium_20d": round(medium_20d, 2),
                    # 各周期平均成本（收盘价均值）
                    "avg_cost_1d": avg_cost_period(1),
                    "avg_cost_3d": avg_cost_period(3),
                    "avg_cost_5d": avg_cost_period(5),
                    "avg_cost_10d": avg_cost_period(10),
                    "avg_cost_20d": avg_cost_period(20),
                    # 最新一日的分档数据
                    "main_in": latest.get("main_in", 0),
                    "small_in": latest.get("small_in", 0),
                    "medium_in": latest.get("medium_in", 0),
                    "big_in": latest.get("big_in", 0),
                    "super_big_in": latest.get("super_big_in", 0),
                    "main_rate": latest.get("main_rate", 0),
                    # 每日明细
                    "detail_dates": [d.get("trade_date", "") for d in daily_data],
                    "detail_main": [round(d.get("main_in", 0), 2) for d in daily_data],
                    "detail_retail": [round(d.get("small_in", 0), 2) for d in daily_data],
                    "detail_medium": [round(d.get("medium_in", 0), 2) for d in daily_data],
                    "detail_amount": [round(d.get("total_amount", 0), 2) for d in daily_data],
                    "total_amount_20d": round(sum(d.get("total_amount", 0) for d in daily_data), 2),
                }

            # 无 days 参数：保持向后兼容，只返回当日数据
            day_data = TushareAPI._get_money_flow_single_day(pro, code, today)
            if day_data is None:
                return {"error": "No data"}
            day_data["source"] = source
            return day_data

        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def main_in_filter(trade_date: str, stocks: List[str],
                       min_circ_mv: float = 20,
                       min_avg_amount: float = 5000,
                       max_decline: float = 30) -> Dict[str, Any]:
        """主力建仓信号识别（批量分析）
        
        对传入的股票列表逐一检查：识别资金流向与价格走势的背离，
        找出主力在偷偷收集筹码、散户在恐慌割肉的标的。
        
        Args:
            trade_date: 交易日期（YYYYMMDD）
            stocks: ts_code 数组，如 ["000001.SZ", "600000.SH"]
            min_circ_mv: 流通市值下限（亿），默认20
            min_avg_amount: 日均成交额下限（万），默认5000
            max_decline: 最大回撤（%），默认30
        
        Returns:
            {"results": [...], "count": N, "passed_count": N}
        """
        min_circ_mv_yuan = min_circ_mv * 1e8   # 亿 -> 元
        min_avg_amount_yuan = min_avg_amount * 1e4  # 万 -> 元
        max_decline_ratio = max_decline / 100.0

        results = []

        for ts_code in stocks:
            code = ts_code.split('.')[0]
            market = '1' if code.startswith('6') else '0'
            secid = f"{market}.{code}"

            try:
                # 并行获取资金流向(60日)、K线(10日)、实时详情
                try:
                    money_flow = TushareAPI.get_money_flow(code, days=30)
                except Exception:
                    money_flow = {"error": "获取资金流向异常"}

                try:
                    klines = TushareAPI.get_kline_data(secid, period="daily", limit=10)
                except Exception:
                    klines = []

                try:
                    detail = TushareAPI.get_stock_realtime(secid)
                except Exception:
                    detail = {"error": "获取详情异常"}

                name = detail.get("name", ts_code) if isinstance(detail, dict) else ts_code

                # 数据不足则跳过
                if isinstance(money_flow, dict) and money_flow.get("error"):
                    results.append(TushareAPI._make_main_in_empty(ts_code, name, f"资金流向数据缺失"))
                    continue
                if not isinstance(klines, list) or len(klines) < 10:
                    results.append(TushareAPI._make_main_in_empty(ts_code, name, f"K线数据不足({len(klines) if isinstance(klines, list) else 0}条)"))
                    continue

                # ============ 提取指标数据 ============
                # 流通市值(元)：detail 中 lt 单位为"亿"
                lt_yi = _to_float(detail.get("lt", 0)) if isinstance(detail, dict) else 0
                circ_mv = lt_yi * 1e8
                # 当前价
                current_price = _to_float(detail.get("zx", 0)) if isinstance(detail, dict) else 0
                if current_price == 0 and klines:
                    current_price = _to_float(klines[-1].get("sp", 0))

                # 资金流向
                main_10d = _to_float(money_flow.get("main_10d", 0)) if isinstance(money_flow, dict) else 0
                retail_10d = _to_float(money_flow.get("retail_10d", 0)) if isinstance(money_flow, dict) else 0
                main_5d = _to_float(money_flow.get("main_5d", 0)) if isinstance(money_flow, dict) else 0
                retail_5d = _to_float(money_flow.get("retail_5d", 0)) if isinstance(money_flow, dict) else 0
                main_20d = _to_float(money_flow.get("main_20d", 0)) if isinstance(money_flow, dict) else 0
                retail_20d = _to_float(money_flow.get("retail_20d", 0)) if isinstance(money_flow, dict) else 0
                medium_10d = _to_float(money_flow.get("medium_10d", 0)) if isinstance(money_flow, dict) else 0
                total_amount_20d = _to_float(money_flow.get("total_amount_20d", 0)) if isinstance(money_flow, dict) else 0
                detail_main = money_flow.get("detail_main", []) if isinstance(money_flow, dict) else []
                detail_retail = money_flow.get("detail_retail", []) if isinstance(money_flow, dict) else []

                # K线价格数据
                prices = [_to_float(k.get("sp", 0)) for k in klines]
                high_10d = max(_to_float(k.get("zg", 0)) for k in klines)
                low_10d = min(_to_float(k.get("zd", 0)) for k in klines)
                cje_10d = [_to_float(k.get("cje", 0)) for k in klines]
                avg_amount_10d = sum(cje_10d) / max(len(cje_10d), 1)
                max_decline_10d = TushareAPI._compute_max_decline(prices)
                avg_price_10d = TushareAPI._compute_weighted_avg_price(klines)

                # 近5日、近10日数据
                recent5 = klines[-5:] if len(klines) >= 5 else klines
                recent10 = klines[-10:] if len(klines) >= 10 else klines

                # 近5日最大涨幅
                max_5d_return = max(_to_float(k.get("zdf", 0)) for k in recent5)

                # 近10日下跌且主力流入日数
                decline_main_in_days = 0
                for i, k in enumerate(recent10):
                    zdf = _to_float(k.get("zdf", 0))
                    detail_idx = len(detail_main) - len(recent10) + i
                    main_in_val = detail_main[detail_idx] if 0 <= detail_idx < len(detail_main) else 0
                    if zdf < 0 and main_in_val > 0:
                        decline_main_in_days += 1

                # 成本偏离
                cost_deviation = (current_price - avg_price_10d) / avg_price_10d if avg_price_10d > 0 else 0

                # ============ 基础过滤 ============
                basic_fail_reasons = []
                if circ_mv > 0 and circ_mv < min_circ_mv_yuan:
                    basic_fail_reasons.append(f"流通市值{circ_mv / 1e8:.1f}亿 < {min_circ_mv:.0f}亿")
                if avg_amount_10d > 0 and avg_amount_10d < min_avg_amount_yuan:
                    basic_fail_reasons.append(f"日均成交额{avg_amount_10d / 1e4:.0f}万 < {min_avg_amount:.0f}万")
                if max_decline_10d > max_decline_ratio:
                    basic_fail_reasons.append(f"近10日最大回撤{max_decline_10d * 100:.1f}% > {max_decline:.0f}%")
                basic_passed = len(basic_fail_reasons) == 0

                # ============ 条件组检查 ============
                # A: 主力持续流入
                cond_a = main_5d > 0 and main_10d > 1e8
                # B: 散户持续流出
                cond_b = retail_5d < 0 and retail_10d < -5e7
                # C: 筹码向主力集中
                cond_c = (main_10d + medium_10d) > 0 and retail_10d < 0
                # D: 价格位置合理
                cond_d = current_price < high_10d * 0.95 and current_price > low_10d * 1.05
                # E: 启动信号
                cond_e = False
                for i, k in enumerate(recent5):
                    zdf = _to_float(k.get("zdf", 0))
                    detail_idx = len(detail_main) - len(recent5) + i
                    main_in_val = detail_main[detail_idx] if 0 <= detail_idx < len(detail_main) else 0
                    if zdf > 5 and main_in_val > 3e7:
                        cond_e = True
                        break
                # F: 洗盘特征
                cond_f = False
                for i, k in enumerate(recent5):
                    zdf = _to_float(k.get("zdf", 0))
                    detail_idx = len(detail_main) - len(recent5) + i
                    main_in_val = detail_main[detail_idx] if 0 <= detail_idx < len(detail_main) else 0
                    if zdf < -3 and main_in_val > 0:
                        cond_f = True
                        break
                # G: 量价配合
                up_hsls, down_hsls = [], []
                for k in recent5:
                    if _to_float(k.get("zdf", 0)) > 0:
                        up_hsls.append(_to_float(k.get("hsl", 0)))
                    elif _to_float(k.get("zdf", 0)) < 0:
                        down_hsls.append(_to_float(k.get("hsl", 0)))
                avg_up_hsl = sum(up_hsls) / len(up_hsls) if up_hsls else 0
                avg_down_hsl = sum(down_hsls) / len(down_hsls) if down_hsls else 0
                cond_g = avg_up_hsl > 0 and avg_down_hsl > 0 and avg_up_hsl > avg_down_hsl * 1.2
                # H: 散户行为验证
                retail_outflow_days = 0
                for i in range(len(recent5)):
                    detail_idx = len(detail_retail) - len(recent5) + i
                    retail_in_val = detail_retail[detail_idx] if 0 <= detail_idx < len(detail_retail) else 0
                    if retail_in_val < 0:
                        retail_outflow_days += 1
                cond_h = retail_outflow_days >= 3

                # ============ 评分模型（双轨制：绝对金额 + 净流入率） ============
                score = 0

                # 1. 主力建仓深度（20日，40分）——双轨制
                # 1A. 绝对金额（20分，按市值分档）
                dim_main_depth_abs = 0
                if circ_mv > 200e8:  # 大盘股
                    if main_20d > 10e8: score += 20; dim_main_depth_abs = 20
                    elif main_20d > 5e8: score += 15; dim_main_depth_abs = 15
                    elif main_20d > 1e8: score += 10; dim_main_depth_abs = 10
                    elif main_20d > 0: score += 5; dim_main_depth_abs = 5
                elif circ_mv > 50e8:  # 中盘股
                    if main_20d > 5e8: score += 20; dim_main_depth_abs = 20
                    elif main_20d > 2e8: score += 15; dim_main_depth_abs = 15
                    elif main_20d > 0.5e8: score += 10; dim_main_depth_abs = 10
                    elif main_20d > 0: score += 5; dim_main_depth_abs = 5
                else:  # 小盘股
                    if main_20d > 2e8: score += 20; dim_main_depth_abs = 20
                    elif main_20d > 1e8: score += 15; dim_main_depth_abs = 15
                    elif main_20d > 0.2e8: score += 10; dim_main_depth_abs = 10
                    elif main_20d > 0: score += 5; dim_main_depth_abs = 5

                # 1B. 主力净流入率（20分）
                main_in_rate = main_20d / total_amount_20d if total_amount_20d > 0 else 0
                dim_main_depth_rate = 0
                if main_in_rate > 0.05: score += 20; dim_main_depth_rate = 20
                elif main_in_rate > 0.03: score += 12; dim_main_depth_rate = 12
                elif main_in_rate > 0.01: score += 6; dim_main_depth_rate = 6
                elif main_in_rate > 0: score += 2; dim_main_depth_rate = 2

                dim_main_depth = dim_main_depth_abs + dim_main_depth_rate

                # 2. 散户割肉力度（20日，20分）——双轨制（只有散户净流出才给分）
                dim_retail_panic = 0
                if retail_20d < 0:
                    # 2A. 绝对金额（10分，按市值分档）
                    abs_retail = abs(retail_20d)
                    dim_retail_abs = 0
                    if circ_mv > 200e8:
                        if abs_retail > 5e8: score += 10; dim_retail_abs = 10
                        elif abs_retail > 3e8: score += 7; dim_retail_abs = 7
                        elif abs_retail > 1e8: score += 4; dim_retail_abs = 4
                    elif circ_mv > 50e8:
                        if abs_retail > 3e8: score += 10; dim_retail_abs = 10
                        elif abs_retail > 1e8: score += 7; dim_retail_abs = 7
                        elif abs_retail > 0.5e8: score += 4; dim_retail_abs = 4
                    else:
                        if abs_retail > 1e8: score += 10; dim_retail_abs = 10
                        elif abs_retail > 0.5e8: score += 7; dim_retail_abs = 7
                        elif abs_retail > 0.2e8: score += 4; dim_retail_abs = 4

                    # 2B. 散户净流出率（10分）
                    retail_out_rate = abs_retail / total_amount_20d if total_amount_20d > 0 else 0
                    dim_retail_rate = 0
                    if retail_out_rate > 0.05: score += 10; dim_retail_rate = 10
                    elif retail_out_rate > 0.03: score += 6; dim_retail_rate = 6
                    elif retail_out_rate > 0.01: score += 3; dim_retail_rate = 3

                    dim_retail_panic = dim_retail_abs + dim_retail_rate

                # 3. 近期趋势验证（10日，20分）
                dim_trend = 0
                if main_10d > main_20d * 0.5 and main_10d > 0:  # 近10日贡献了20日的一半以上
                    score += 20
                    dim_trend = 20
                elif main_10d > 0:
                    score += 10
                    dim_trend = 10

                # 4. 短期风险预警（5日，20分）
                dim_risk = 0
                # 危险信号：近5日突然大额流出（超过20日累计的30%）
                if main_5d < -abs(main_20d) * 0.3:
                    score -= 20
                    dim_risk = -20
                # 次危险：近5日流出
                elif main_5d < 0:
                    score -= 10
                    dim_risk = -10

                score = max(0, score)

                # 评级
                if score >= 80: grade = 'A'
                elif score >= 60: grade = 'B'
                elif score >= 40: grade = 'C'
                else: grade = 'D'

                # ============ 操作建议（场景判断） ============
                main_inflow = main_20d > 0                          # 20日主力持续流入
                main_outflow = main_20d <= 0                        # 20日主力整体流出
                recent_big_outflow = main_5d < -abs(main_20d) * 0.3  # 近5日突然大额流出
                recent_big_inflow = main_5d > abs(main_20d) * 0.3   # 近5日突然大额流入
                recent_inflow_slow = main_5d > 0 and main_5d <= main_20d * 0.2  # 近5日流入放缓
                # 计算近5日股价涨跌幅
                zdf_5d = sum(_to_float(k.get("zdf", 0)) for k in recent5) if recent5 else 0
                price_down = zdf_5d < -2                           # 近5日股价下跌超2%
                recent_continue_outflow = main_5d < 0               # 近5日继续流出

                advice_scene = ""
                advice_meaning = ""
                advice_action = ""

                if main_inflow and recent_big_outflow:
                    advice_scene = "场景A"
                    advice_meaning = "主力在兑现利润，可能是阶段顶部"
                    advice_action = "减仓"
                elif main_inflow and recent_inflow_slow and price_down:
                    advice_scene = "场景B"
                    advice_meaning = "主力在洗盘，未出货"
                    advice_action = "关注低吸机会"
                elif main_outflow and recent_big_inflow:
                    advice_scene = "场景C"
                    advice_meaning = "可能是对倒拉高（诱多）"
                    advice_action = "警惕，不追"
                elif main_outflow and recent_continue_outflow:
                    advice_scene = "场景D"
                    advice_meaning = "下跌趋势确认"
                    advice_action = "回避"

                # ============ 买卖信号判断 ============
                buy_signal = None
                sell_signal = None
                sell_reason = ''

                # 买入组合A（最强）：洗盘最后3日 + 价格合理
                wash_last3 = TushareAPI._check_wash_last3_days(recent5, detail_main)
                price_ok_a = avg_price_10d > 0 and current_price <= avg_price_10d * 1.02
                if score >= 80 and wash_last3 and price_ok_a:
                    buy_signal = 'A'
                # 买入组合B（稳健）
                if buy_signal is None:
                    has_7pct_up = any(_to_float(k.get("zdf", 0)) > 7 for k in recent5)
                    if score >= 60 and main_5d > 0 and retail_5d < 0 and has_7pct_up:
                        buy_signal = 'B'

                # 卖出/回避信号
                if score < 40:
                    sell_signal = 'SELL'
                    sell_reason = f"评分{score}分 < 40分，主力出货/散户接盘"
                if sell_signal is None and len(detail_main) >= 3:
                    last3_main = detail_main[-3:]
                    all_outflow = all(v < 0 for v in last3_main)
                    total_outflow = abs(sum(last3_main))
                    if all_outflow and total_outflow > 5e7:
                        sell_signal = 'SELL'
                        sell_reason = f"连续3日主力净流出，累计{total_outflow / 1e4:.0f}万"
                if sell_signal is None and retail_10d > 0:
                    sell_signal = 'SELL'
                    sell_reason = '散户10日累计转正（从割肉变追涨）'
                if sell_signal is None and current_price >= high_10d and len(detail_main) > 0 and detail_main[-1] < 0:
                    sell_signal = 'SELL'
                    sell_reason = '股价突破近10日最高价但主力当日净流出（拉高出货）'

                results.append({
                    "ts_code": ts_code,
                    "name": name,
                    "score": score,
                    "grade": grade,
                    "basic_passed": basic_passed,
                    "basic_reason": "通过" if basic_passed else "; ".join(basic_fail_reasons),
                    "condition_a": cond_a, "condition_b": cond_b,
                    "condition_c": cond_c, "condition_d": cond_d,
                    "condition_e": cond_e, "condition_f": cond_f,
                    "condition_g": cond_g, "condition_h": cond_h,
                    "dim_main_depth": dim_main_depth,
                    "dim_retail_panic": dim_retail_panic,
                    "dim_trend_verify": dim_trend,
                    "dim_risk_warning": dim_risk,
                    "main_20d": main_20d,
                    "retail_20d": retail_20d,
                    "main_10d": main_10d,
                    "retail_10d": retail_10d,
                    "main_5d": main_5d,
                    "retail_5d": retail_5d,
                    "circ_mv": circ_mv,
                    "total_amount_20d": total_amount_20d,
                    "main_in_rate": main_in_rate,
                    "current_price": current_price,
                    "max_5d_return": max_5d_return,
                    "decline_main_in_days": decline_main_in_days,
                    "cost_deviation": cost_deviation,
                    "avg_price_10d": avg_price_10d,
                    "high_10d": high_10d,
                    "low_10d": low_10d,
                    "avg_amount_10d": avg_amount_10d,
                    "max_decline_10d": max_decline_10d,
                    "buy_signal": buy_signal,
                    "sell_signal": sell_signal,
                    "sell_reason": sell_reason,
                    "advice_scene": advice_scene,
                    "advice_meaning": advice_meaning,
                    "advice_action": advice_action,
                })
            except Exception as e:
                import traceback
                sys.stderr.write(f"[主力建仓] 处理 {ts_code} 失败: {e}\n{traceback.format_exc()}\n")
                results.append(TushareAPI._make_main_in_empty(ts_code, ts_code, f"处理异常: {e}"))

        # 按评分降序排列
        results.sort(key=lambda x: x["score"], reverse=True)
        passed_count = sum(1 for r in results if r["basic_passed"] and r["buy_signal"] is not None)

        return {"results": results, "count": len(results), "passed_count": passed_count}

    @staticmethod
    def _make_main_in_empty(ts_code: str, name: str, reason: str) -> Dict[str, Any]:
        return {
            "ts_code": ts_code, "name": name,
            "score": 0, "grade": "D",
            "basic_passed": False, "basic_reason": reason,
            "condition_a": False, "condition_b": False,
            "condition_c": False, "condition_d": False,
            "condition_e": False, "condition_f": False,
            "condition_g": False, "condition_h": False,
            "dim_main_depth": 0, "dim_retail_panic": 0,
            "dim_trend_verify": 0, "dim_risk_warning": 0,
            "main_20d": 0, "retail_20d": 0,
            "main_10d": 0, "retail_10d": 0, "main_5d": 0, "retail_5d": 0,
            "circ_mv": 0, "total_amount_20d": 0, "main_in_rate": 0,
            "current_price": 0,
            "max_5d_return": 0, "decline_main_in_days": 0,
            "cost_deviation": 0,
            "avg_price_10d": 0, "high_10d": 0, "low_10d": 0,
            "avg_amount_10d": 0, "max_decline_10d": 0,
            "buy_signal": None, "sell_signal": None, "sell_reason": "",
            "advice_scene": "", "advice_meaning": "", "advice_action": "",
        }

    @staticmethod
    def _compute_max_decline(prices: List[float]) -> float:
        if len(prices) < 2:
            return 0.0
        max_drawdown = 0.0
        peak = prices[0]
        for p in prices:
            if p > peak:
                peak = p
            dd = (peak - p) / peak if peak > 0 else 0
            if dd > max_drawdown:
                max_drawdown = dd
        return max_drawdown

    @staticmethod
    def _compute_weighted_avg_price(klines: List[Dict]) -> float:
        if not klines:
            return 0.0
        total_value = 0.0
        total_vol = 0.0
        for k in klines:
            vol = _to_float(k.get("cjl", 0))
            price = _to_float(k.get("sp", 0))
            total_value += price * vol
            total_vol += vol
        return total_value / total_vol if total_vol > 0 else 0.0

    @staticmethod
    def _check_wash_last3_days(recent5: List[Dict], detail_main: List[float]) -> bool:
        """检查最近3日是否有洗盘特征（下跌但主力在买）"""
        if len(recent5) < 3 or len(detail_main) < 3:
            return False
        last3 = recent5[-3:]
        for i, k in enumerate(last3):
            zdf = _to_float(k.get("zdf", 0))
            detail_idx = len(detail_main) - len(last3) + i
            main_in_val = detail_main[detail_idx] if 0 <= detail_idx < len(detail_main) else 0
            if zdf < -1 and main_in_val > 0:
                return True
        return False

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

            # 1. 获取当日全市场日线
            today_df = safe_api_call(pro.daily, trade_date=date_str)
            if isinstance(today_df, dict) and today_df.get("error"):
                return today_df
            if today_df is None or today_df.empty:
                return {"error": "No daily data"}

            # 2. 获取涨停数据
            limit_df = safe_api_call(pro.limit_list, trade_date=date_str)
            limit_codes = set()
            if isinstance(limit_df, pd.DataFrame) and not limit_df.empty:
                limit_codes = set(limit_df[limit_df['limit'] == 'U']['ts_code'].tolist())

            # 2.5 获取当日市值数据（daily_basic：total_mv/circ_mv 单位万元）
            basic_df = safe_api_call(pro.daily_basic, trade_date=date_str)
            mv_map = {}
            if isinstance(basic_df, pd.DataFrame) and not basic_df.empty:
                for _, r in basic_df.iterrows():
                    mv_map[str(r['ts_code'])] = {
                        'total_mv': _to_float(r.get('total_mv', 0)) / 10000,   # 万元 → 亿
                        'circ_mv': _to_float(r.get('circ_mv', 0)) / 10000,     # 万元 → 亿
                    }

            # 3. 获取最近60个交易日
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

            # 4. 获取历史数据计算60日最高价
            hist_frames = []
            for hd in hist_dates:
                df = safe_api_call(pro.daily, trade_date=hd)
                if isinstance(df, pd.DataFrame) and not df.empty:
                    hist_frames.append(df)

            high_60 = {}
            if hist_frames:
                hist_df = pd.concat(hist_frames, ignore_index=True)
                high_60 = hist_df.groupby('ts_code')['high'].max().to_dict()

            # 5. 获取股票名称和行业（带缓存复用）
            name_map, industry_map = _get_stock_basic_maps()

            # 6. 筛选：涨停 或 60日新高
            stocks = []
            for _, row in today_df.iterrows():
                tc = str(row['ts_code'])
                code = tc.split('.')[0]
                market = '1' if code.startswith('6') else '0'
                secid = f"{market}.{code}"
                close = _to_float(row['close'])
                open = _to_float(row['open'])
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
                        "jk": open,
                        "zdf": zdf,
                        "zg": high,
                        "zd": low,
                        "cjl": vol,
                        "cje": round(amount, 2),
                        "strongType": "limit_up" if is_limit else "new_high_60",
                        "hybk": industry_map.get(tc, ''),
                        "ltsz": mv_map.get(tc, {}).get('circ_mv', 0),
                        "zsz": mv_map.get(tc, {}).get('total_mv', 0),
                    })

            return {
                "stocks": stocks,
                "date": date_str,
                "count": len(stocks),
                "limit_up_count": len([s for s in stocks if s['strongType'] == 'limit_up']),
                "new_high_count": len([s for s in stocks if s['strongType'] == 'new_high_60']),
            }
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
                    open = _to_float(row['open'])
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
                            "jk": open,
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

    # ------------------ 选股模块（整合 stock_selector.py）------------------

    @staticmethod
    def select_stocks(trade_date: str, industry_config: Optional[Dict[str, Any]] = None,
                      stock_config: Optional[Dict[str, Any]] = None,
                      buy_config: Optional[Dict[str, Any]] = None,
                      top_industries: int = 5, top_stocks_per_industry: int = 3) -> Dict[str, Any]:
        """A股行业-个股选股入口（整合 stock_selector 逻辑）

        流程: 行业趋势确认 -> 龙头识别 -> 排雷过滤 -> 择时信号

        Args:
            trade_date: 交易日期(YYYYMMDD)
            industry_config: 行业筛选配置 dict，可选字段见 IndustryFilterConfig
            stock_config: 个股筛选配置 dict，可选字段见 StockFilterConfig
            buy_config: 买入信号配置 dict，可选字段见 BuySignalConfig
            top_industries: 选取前N个行业
            top_stocks_per_industry: 每个行业选取前N只个股

        Returns:
            {"results": [...], "count": N, "trade_date": "..."}
        """
        try:
            selector = StockSelector()
            ind_cfg = IndustryFilterConfig(**(industry_config or {}))
            stock_cfg = StockFilterConfig(**(stock_config or {}))
            buy_cfg = BuySignalConfig(**(buy_config or {}))

            df = selector.select_stocks(
                trade_date=trade_date,
                industry_config=ind_cfg,
                stock_config=stock_cfg,
                buy_config=buy_cfg,
                top_industries=top_industries,
                top_stocks_per_industry=top_stocks_per_industry
            )

            if df.empty:
                return {"results": [], "count": 0, "trade_date": trade_date}

            # 转换为可 JSON 序列化的记录
            records = df_to_records(df)
            return {
                "results": records,
                "count": len(records),
                "trade_date": trade_date,
            }
        except Exception as e:
            return {"error": str(e)}




# ============ 选股模块配置类 ============

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

    def __init__(self):
        self.pro = get_pro()

    # ==================== 1. 行业筛选 ====================

    def get_l2_industries(self, src: str = 'SW2021', use_cache: bool = True) -> pd.DataFrame:
        """获取所有二级行业列表"""
        cache_key = f"l2_industries_{src}"
        if use_cache:
            cached = read_cache(cache_key, max_age_hours=168)
            if cached is not None and isinstance(cached, pd.DataFrame):
                return cached

        df = self.pro.index_classify(level='L2', src=src)
        if df is not None and not df.empty:
            write_cache(cache_key, df)
        return df

    def get_industry_kline(self, index_code: str, start_date: str, end_date: str) -> Optional[pd.DataFrame]:
        """获取申万行业指数K线 (sw_daily 接口，ID 327)

        sw_daily 返回字段: ts_code, trade_date, open, close, high, low, change, pct_change, vol, amount
        与 index_daily 字段基本一致，但 pct_chg 字段名为 pct_change
        """
        cache_key = f"industry_kline_{index_code}_{start_date}_{end_date}"
        cached = read_cache(cache_key, max_age_hours=168)
        if cached is not None and isinstance(cached, pd.DataFrame):
            return cached

        try:
            # 使用正确的接口名 sw_daily（申万行业指数日行情）
            df = safe_api_call(self.pro.sw_daily, ts_code=index_code, start_date=start_date, end_date=end_date)
            if isinstance(df, dict) and df.get("error"):
                print(f"[WARN] sw_daily 接口错误 {index_code}: {df.get('error')}")
                return None
            if df is not None and not df.empty:
                # 统一字段名：sw_daily 用 pct_change，统一为 pct_chg 以兼容后续计算
                if 'pct_change' in df.columns and 'pct_chg' not in df.columns:
                    df = df.rename(columns={'pct_change': 'pct_chg'})
                df = df.sort_values('trade_date').reset_index(drop=True)
                write_cache(cache_key, df)
                return df
        except Exception as e:
            print(f"[WARN] 获取行业K线失败 {index_code}: {e}")
        return None

    def calc_industry_fund_flow(self, industry_code: str, trade_date: str, days: int = 5) -> float:
        """计算行业N日资金净流入(通过成分股汇总)

        修复点：
        1. 使用 trade_cal 获取真实交易日，避免传入非交易日导致返回空
        2. 对 con_code 格式做容错（纯代码自动补 .SH/.SZ）
        3. 对 moneyflow 返回字段做容错（net_mf_amount 不存在时手动计算）
        4. 增加调试日志，方便排查
        """
        cache_key = f"industry_fund_flow_{industry_code}_{trade_date}_{days}"
        cached = read_cache(cache_key, max_age_hours=24)
        if cached is not None and isinstance(cached, (int, float)):
            return float(cached)

        # 获取成分股
        members = self.pro.index_member(index_code=industry_code)
        if members is None or members.empty:
            print(f"[DEBUG fund_flow] {industry_code}: 无成分股")
            return 0.0

        # 使用 trade_cal 获取真实交易日范围
        pro = get_pro()
        try:
            end_dt = datetime.strptime(trade_date, "%Y%m%d")
            cal_start = (end_dt - timedelta(days=30)).strftime("%Y%m%d")
            cal_df = pro.trade_cal(exchange='SSE', start_date=cal_start, end_date=trade_date, is_open='1')
            if cal_df is not None and not cal_df.empty:
                trade_dates = sorted(cal_df['cal_date'].astype(str).tolist())
                if len(trade_dates) >= days:
                    start_date = trade_dates[-min(days*2, len(trade_dates))]
                    end_date = trade_dates[-1]
                else:
                    start_date = trade_dates[0] if trade_dates else (end_dt - timedelta(days=days*2)).strftime("%Y%m%d")
                    end_date = trade_dates[-1] if trade_dates else trade_date
            else:
                start_date = (end_dt - timedelta(days=days*2)).strftime("%Y%m%d")
                end_date = trade_date
        except Exception as e:
            print(f"[WARN fund_flow] trade_cal 失败: {e}")
            start_date = (datetime.strptime(trade_date, "%Y%m%d") - timedelta(days=days*2)).strftime("%Y%m%d")
            end_date = trade_date

        total_inflow = 0.0
        stock_codes = members['con_code'].tolist()
        success_count = 0
        fail_count = 0

        for code in stock_codes[:50]:
            # 确保 code 是 ts_code 格式（含 .SH/.SZ 后缀）
            ts_code = code
            if '.' not in code:
                ts_code = f"{code}.{'SH' if code.startswith('6') else 'SZ'}"

            try:
                df = self.pro.moneyflow(ts_code=ts_code, start_date=start_date, end_date=end_date)
                if df is None or df.empty:
                    fail_count += 1
                    continue

                # 取最近N个交易日
                df = df.sort_values('trade_date', ascending=False).head(days)

                # 字段名容错：优先 net_mf_amount，其次 net_amount，最后手动计算
                net_inflow = 0.0
                if 'net_mf_amount' in df.columns:
                    net_inflow = df['net_mf_amount'].sum()
                elif 'net_amount' in df.columns:
                    net_inflow = df['net_amount'].sum()
                else:
                    # 手动计算：大单+特大单净流入 = (buy_elg - sell_elg) + (buy_lg - sell_lg)
                    buy_elg = df['buy_elg_amount'].sum() if 'buy_elg_amount' in df.columns else 0
                    sell_elg = df['sell_elg_amount'].sum() if 'sell_elg_amount' in df.columns else 0
                    buy_lg = df['buy_lg_amount'].sum() if 'buy_lg_amount' in df.columns else 0
                    sell_lg = df['sell_lg_amount'].sum() if 'sell_lg_amount' in df.columns else 0
                    net_inflow = (buy_elg - sell_elg) + (buy_lg - sell_lg)

                total_inflow += float(net_inflow)
                success_count += 1

            except Exception as e:
                fail_count += 1
                if fail_count <= 3:  # 只打印前3个错误，避免日志刷屏
                    print(f"[WARN fund_flow] moneyflow 失败 {ts_code}: {e}")
                continue

        result = float(total_inflow)
        print(f"[DEBUG fund_flow] {industry_code}: {result/1e8:.4f}亿, 成功:{success_count}, 失败:{fail_count}, 日期:{start_date}~{end_date}")
        write_cache(cache_key, result)
        return result

    def calc_industry_trend_score(self, kline: pd.DataFrame) -> Dict:
        """计算行业趋势强度得分"""
        if kline is None or len(kline) < 60:
            print(f"[DEBUG calc_industry_trend_score] K线不足: {len(kline) if kline else 0} 条（需>=60）")
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

        print(f"[DEBUG calc_industry_trend_score] close={latest['close']:.2f}, ma5={latest['ma5']:.2f}, ma10={latest['ma10']:.2f}, ma20={latest['ma20']:.2f}, ma60={latest['ma60']:.2f}, ma_bull={ma_bull}, ret_5d={ret_5d:.2f}, ret_20d={ret_20d:.2f}, score={score}")

        return {
            "total": score,
            "ret_5d": round(ret_5d, 2),
            "ret_20d": round(ret_20d, 2),
            "ma_bull": ma_bull,
            "rs": round(rs, 2)
        }

    def filter_industries(self, trade_date: str, config: IndustryFilterConfig = None, return_all: bool = False) -> pd.DataFrame:
        """
        筛选值得投资的二级行业
        当 return_all=True 时返回所有行业（不过滤），并增加 passed 字段标记是否通过条件
        """
        if config is None:
            config = IndustryFilterConfig()

        print(f"[DEBUG filter_industries] 开始筛选，trade_date={trade_date}, return_all={return_all}, config={config}")

        industries = self.get_l2_industries()
        if industries is None or industries.empty:
            print("[ERROR] 无法获取行业列表")
            return pd.DataFrame()

        print(f"[DEBUG filter_industries] 获取到 {len(industries)} 个二级行业")

        # 计算K线起始日期
        end_dt = datetime.strptime(trade_date, "%Y%m%d")
        start_dt = end_dt - timedelta(days=120)
        start_date = start_dt.strftime("%Y%m%d")
        print(f"[DEBUG filter_industries] K线查询范围: {start_date} ~ {trade_date}")

        results = []
        total = len(industries)
        kline_fail_count = 0

        for idx, (_, row) in enumerate(industries.iterrows()):
            code = row['index_code']
            name = row['industry_name']

            if idx % 10 == 0:
                print(f"[PROGRESS] 行业筛选 {idx}/{total}: {name}")

            # 获取行业K线
            kline = self.get_industry_kline(code, start_date, trade_date)
            if kline is None or len(kline) < 20:
                kline_fail_count += 1
                # 返回占位数据，确保列表完整
                results.append({
                    'industry_code': code,
                    'industry_name': name,
                    'trend_score': 0,
                    'ret_5d': 0,
                    'ret_20d': 0,
                    'ma_bull': False,
                    'fund_flow': 0,
                    'kline': None,
                    'calculated': False,
                })
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
                'kline': kline if not return_all else None,  # return_all 时不保留 kline 减少序列化开销
                'calculated': True,
            })

        print(f"[DEBUG filter_industries] K线获取成功: {len([r for r in results if r['calculated']])}/{total}, 失败: {kline_fail_count}")

        df = pd.DataFrame(results)

        # 资金流入排名（只对计算成功的排名）
        df['fund_flow_rank'] = df[df['calculated']]['fund_flow'].rank(ascending=False, pct=True)
        df['fund_flow_rank'] = df['fund_flow_rank'].fillna(1.0)  # 未计算的排到最后

        # 计算是否通过过滤条件
        cond1 = df['trend_score'] >= 40
        cond2 = df['ret_5d'] >= config.min_return_5d
        cond3 = df['fund_flow_rank'] <= config.fund_flow_rank_pct
        cond4 = df['ma_bull'] if config.require_ma_bull else pd.Series([True] * len(df))
        df['passed'] = cond1 & cond2 & cond3 & cond4

        # 综合得分（对所有行业计算，未计算的为0）
        df['composite_score'] = (
            df['trend_score'] * 0.6 +
            (1 - df['fund_flow_rank']) * 40
        ).fillna(0)

        if return_all:
            # 不过滤，返回所有，按 composite_score 降序
            return df.sort_values('composite_score', ascending=False).reset_index(drop=True)

        # 过滤模式：只返回通过的
        filtered = df[df['passed']].copy()
        return filtered.sort_values('composite_score', ascending=False).reset_index(drop=True)

    # ==================== 2. 个股龙头识别 ====================

    def get_stock_kline(self, ts_code: str, start_date: str, end_date: str) -> Optional[pd.DataFrame]:
        """获取个股K线"""
        cache_key = f"stock_kline_{ts_code}_{start_date}_{end_date}"
        cached = read_cache(cache_key, max_age_hours=168)
        if cached is not None and isinstance(cached, pd.DataFrame):
            return cached

        try:
            df = self.pro.daily(ts_code=ts_code, start_date=start_date, end_date=end_date)
            if df is not None and not df.empty:
                df = df.sort_values('trade_date').reset_index(drop=True)
                write_cache(cache_key, df)
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
        score += min(max(math.log1p(abs(net_inflow/1e6)) * 5, 0), 20)  # 资金 20分
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
    # 当脚本作为 __main__ 运行时，直接通过 tushare_api 模块引用所有全局状态，
    # 避免 __main__ 和 tushare_api 两个命名空间不一致的问题。
    import tushare_api as _mod

    parser = argparse.ArgumentParser(description="Tushare Pro API CLI")
    parser.add_argument("method", help="方法名")
    parser.add_argument("--params", "-p", help="JSON格式的参数", default="{}")
    parser.add_argument("--token", "-t", help="Tushare Pro Token", default=None)
    parser.add_argument("--storage-path", "-s", help="本地存储根目录路径（用于缓存）", default=None)

    args = parser.parse_args()

    try:
        params = json.loads(args.params)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": "Invalid JSON params"}, ensure_ascii=False))
        sys.exit(1)

    # 设置缓存目录
    if args.storage_path:
        set_cache_dir(args.storage_path)

    # 初始化
    if args.token:
        _mod.init_pro(args.token)
    else:
        _mod.init_pro()

    if _mod._pro_api is None:
        print(json.dumps({"error": "Tushare Pro Token 未设置，请在设置中配置 token"}, ensure_ascii=False))
        sys.exit(1)
        print(json.dumps({"error": "Tushare Pro Token 未设置，请在设置中配置 token"}, ensure_ascii=False))
        sys.exit(1)

    api = TushareAPI()
    method = getattr(api, args.method, None)

    if method is None:
        print(json.dumps({"error": f"Method {args.method} not found"}, ensure_ascii=False))
        sys.exit(1)

    # 将所有调试 print 重定向到 stderr，避免污染 stdout 的 JSON 输出
    _real_stdout = sys.stdout
    sys.stdout = sys.stderr

    try:
        result = method(**params)
    except Exception as e:
        result = {"error": str(e)}
    finally:
        sys.stdout = _real_stdout

    # 只在恢复后的真实 stdout 输出最终 JSON
    print(json.dumps(result, ensure_ascii=False, cls=DateTimeEncoder))



# ============ 涨停股票评分系统 (LimitUpScorer) ============
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
涨停股票评分系统 (LimitUpScorer)
基于 tushare_api.py 已有接口实现

评分维度：
1. 题材热点热度（板块资金流入 + 涨跌比 + 涨停密度）
2. 60日均线突破质量（区分反弹/筑底/回踩三种类型）
3. 趋势阶段识别（起势/聚势/冲势/落势）
4. 同题材相对强度（首个涨停、连板数、封单比、涨幅排名）
5. 股性评价（连续阳线、涨停次数、阳阴线比、涨停次日表现）

使用方式：
    scorer = LimitUpScorer()
    result = scorer.score_limit_up_stock("0.000001", "20250627")
    print(f"总分: {result['total_score']}, 等级: {result['grade']}")
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
    df_to_records, read_cache, write_cache, _cache_key,
    convert_secid_to_ts_code, convert_secid_to_pure_code,
    safe_api_call, cached_api_call,
    is_board_code, is_index_code,
    TushareAPI, _get_stock_basic_maps,
)

import pandas as pd
import numpy as np


# ============ 配置类 ============

@dataclass
class LimitUpScoreConfig:
    """涨停评分配置"""
    # 权重配置
    weight_topic_heat: float = 0.20      # 题材热度
    weight_ma60_break: float = 0.20      # 60日突破质量
    weight_trend_stage: float = 0.25     # 趋势阶段
    weight_relative_strength: float = 0.20  # 同题材强度
    weight_stock_character: float = 0.15    # 股性

    # 数据回溯天数
    lookback_days: int = 120             # 历史K线回溯天数
    character_lookback: int = 120        # 股性评价回溯天数

    # 阈值
    min_total_score: float = 55.0        # 最低参与分数
    s_grade_threshold: float = 85.0      # S级阈值
    a_grade_threshold: float = 70.0      # A级阈值
    b_grade_threshold: float = 55.0      # B级阈值
    c_grade_threshold: float = 40.0      # C级阈值


# ============ 涨停评分核心类 ============

class LimitUpScorer:
    """
    涨停股票综合评分系统

    使用方法:
        scorer = LimitUpScorer(config)
        result = scorer.score_limit_up_stock(secid, trade_date)
        # result 包含各维度得分、总分、等级、详细分析
    """

    def __init__(self, config: LimitUpScoreConfig = None):
        self.config = config or LimitUpScoreConfig()
        self.pro = get_pro()
        self.name_map, self.industry_map = _get_stock_basic_maps()

    # ==================== 缓存辅助 ====================

    def _get_kline_cached(self, secid: str, days: int = 120, end_date: Optional[str] = None) -> pd.DataFrame:
        """获取个股K线（带缓存，复用 tushare_api 的 get_kline_data）"""
        end_date_std = _standardize_date(end_date) if end_date else datetime.now().strftime('%Y-%m-%d')
        cache_key = f"scorer_kline_{secid}_{days}_{end_date_std}"
        cached = read_cache(cache_key, max_age_hours=24)
        if cached is not None and isinstance(cached, pd.DataFrame):
            return cached

        # 调用已有接口
        klines = TushareAPI.get_kline_data(secid, period="daily", adjust="qfq", limit=days, end_date=end_date_std)
        if isinstance(klines, dict) and klines.get("error"):
            return pd.DataFrame()
        if not klines:
            return pd.DataFrame()

        df = pd.DataFrame(klines)
        if df.empty:
            return df

        # 统一字段名
        df = df.rename(columns={
            'date': 'trade_date',
            'kp': 'open',
            'sp': 'close',
            'zg': 'high',
            'zd': 'low',
            'cjl': 'vol',
            'cje': 'amount',
            'zdf': 'pct_chg',
            'zde': 'change',
        })
        df['trade_date'] = pd.to_datetime(df['trade_date'])
        df = df.sort_values('trade_date').reset_index(drop=True)

        write_cache(cache_key, df)
        return df

    def _get_limit_up_list(self, trade_date: str) -> pd.DataFrame:
        """获取当日涨停列表（带缓存）"""
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

        # 只保留涨停
        df = df[df['limit'] == 'U'].copy()
        write_cache(cache_key, df)
        return df

    def _get_daily_all(self, trade_date: str) -> pd.DataFrame:
        """获取当日全市场日线（带缓存）"""
        date_str = trade_date.replace("-", "")
        cache_key = f"daily_all_{date_str}"
        cached = read_cache(cache_key, max_age_hours=24)
        if cached is not None and isinstance(cached, pd.DataFrame):
            return cached

        df = safe_api_call(self.pro.daily, trade_date=date_str)
        if isinstance(df, dict) and df.get("error"):
            return pd.DataFrame()
        if df is None or df.empty:
            return pd.DataFrame()

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
        返回: [{"code": "BKxxxx", "name": "概念名"}, ...]
        """
        cache_key = f"stock_concepts_{ts_code}"
        cached = read_cache(cache_key, max_age_hours=168)
        if cached is not None:
            return cached

        concepts = []
        try:
            # 方法1: 通过 ths_member 获取同花顺概念（需要 6000 积分）
            # ths_member 参数是概念代码，返回成分股。反向查找需要遍历所有概念，效率低。
            # 简化：使用 stock_basic 中的 industry 字段作为 fallback

            # 方法2: 使用已有的 dc_member 反向查找
            # 先获取所有概念板块列表，然后逐个检查
            concept_list = safe_api_call(self.pro.dc_index, idx_type="概念板块")
            if isinstance(concept_list, pd.DataFrame) and not concept_list.empty:
                # 去重
                concept_list = concept_list.drop_duplicates(subset=['ts_code'], keep='first')
                stock_code_pure = ts_code.split('.')[0]

                # 遍历前 50 个概念（避免超时）
                for _, row in concept_list.head(50).iterrows():
                    concept_ts = str(row.get('ts_code', ''))
                    concept_name = str(row.get('name', ''))
                    if not concept_ts:
                        continue

                    try:
                        # dc_member 查询该概念的成分股
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
        """
        计算单个概念板块的热度分
        返回: (热度分0-100, 详细数据)
        """
        date_str = trade_date.replace("-", "")

        try:
            # 获取概念板块当日行情（dc_index）
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
                    # 通过 limit_list 统计该概念下涨停家数
                    limit_density_score = self._calc_concept_limit_density(concept_code, trade_date)

                    # 4. 市值活跃度 (0-15)
                    mv_score = min(total_mv / 1000, 15)  # 千亿市值概念得满分

                    total = pct_score + ratio_score + limit_density_score + mv_score

                    return min(total, 100), {
                        "concept_code": concept_code,
                        "concept_name": concept_name,
                        "pct_chg": pct_chg,
                        "up_num": up_num,
                        "down_num": down_num,
                        "up_ratio": round(up_ratio, 4),
                        "pct_score": round(pct_score, 2),
                        "ratio_score": round(ratio_score, 2),
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
            # 获取概念成分股
            member_df = safe_api_call(self.pro.dc_member, ts_code=f"{concept_code}.DC", trade_date=date_str)
            if isinstance(member_df, dict) and member_df.get("error"):
                return 0
            if member_df is None or (isinstance(member_df, pd.DataFrame) and member_df.empty):
                return 0

            member_codes = member_df['con_code'].astype(str).tolist()
            total_members = len(member_codes)
            if total_members == 0:
                return 0

            # 获取当日涨停列表
            limit_df = self._get_limit_up_list(trade_date)
            if limit_df is None or limit_df.empty:
                return 0

            limit_codes = limit_df['ts_code'].tolist()
            limit_in_concept = sum(1 for code in member_codes if code in limit_codes)

            density = limit_in_concept / total_members
            return min(density * 100, 25)  # 25%涨停率得满分

        except Exception:
            return 0

    def score_topic_heat(self, secid: str, trade_date: str) -> Tuple[float, Dict]:
        """
        维度1: 题材热点热度评分 (0-100)

        综合股票所属所有概念的热度，取最强概念的加权分
        """
        ts_code = convert_secid_to_ts_code(secid)

        # 获取股票所属概念
        concepts = self._get_stock_concepts(ts_code)
        if not concepts:
            return 30.0, {"reason": "无概念数据", "concepts": [], "heat_score": 30}

        concept_scores = []
        for concept in concepts[:5]:  # 最多取前5个概念
            code = concept.get("code", "")
            name = concept.get("name", "")
            if not code and name:  # fallback industry
                # 用 industry 名称匹配 dc_index
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

        # 取最强概念
        best = max(concept_scores, key=lambda x: x['score'])
        avg_score = sum(c['score'] for c in concept_scores) / len(concept_scores)

        # 最终热度分 = 最强概念 * 0.6 + 平均分 * 0.4
        final_score = best['score'] * 0.6 + avg_score * 0.4

        # 补充：个股资金流入得分
        fund_score = self._calc_individual_fund_flow_score(ts_code, trade_date)

        # 综合：概念热度 * 0.7 + 个股资金 * 0.3
        total = final_score * 0.7 + fund_score * 0.3

        return round(min(total, 100), 2), {
            "heat_score": round(final_score, 2),
            "fund_score": round(fund_score, 2),
            "best_concept": best['detail'],
            "concept_count": len(concept_scores),
            "concepts": [c['detail'] for c in concept_scores],
        }

    def _calc_individual_fund_flow_score(self, ts_code: str, trade_date: str) -> float:
        """计算个股资金流入得分 (0-100)"""
        try:
            end_dt = datetime.strptime(trade_date.replace("-", ""), "%Y%m%d")
            start_dt = end_dt - timedelta(days=10)
            start_date = start_dt.strftime("%Y%m%d")
            end_date = trade_date.replace("-", "")

            mf_df = self._get_moneyflow(ts_code, start_date, end_date)
            if mf_df is None or mf_df.empty:
                return 50.0

            net_inflow = mf_df['net_mf_amount'].sum() if 'net_mf_amount' in mf_df.columns else 0

            # 根据净流入绝对值评分
            if net_inflow > 2e8:
                return 90.0
            elif net_inflow > 1e8:
                return 80.0
            elif net_inflow > 5e7:
                return 70.0
            elif net_inflow > 0:
                return 55.0
            elif net_inflow > -5e7:
                return 40.0
            elif net_inflow > -1e8:
                return 25.0
            else:
                return 15.0

        except Exception:
            return 50.0

    # ==================== 2. 60日均线突破质量评分 ====================

    def score_ma60_break(self, secid: str, trade_date: str) -> Tuple[float, Dict]:
        """
        维度2: 60日均线突破质量评分 (0-100)

        突破类型:
        - pullback (上涨回踩突破): 85-100分，质量最高
        - consolidation (震荡筑底突破): 70-90分，需放量确认
        - rebound (下跌反弹突破): 30-60分，需底部结构验证
        - none (未突破/假突破): 0分
        """
        df = self._get_kline_cached(secid, days=self.config.lookback_days, end_date=trade_date)
        if df is None or len(df) < 60:
            return 0.0, {"type": "none", "reason": "K线数据不足"}

        # 计算MA60
        df['ma60'] = df['close'].rolling(60).mean()

        latest = df.iloc[-1]
        prev_5 = df.iloc[-6] if len(df) >= 6 else df.iloc[0]

        # 检查是否突破MA60（当前在上方，5天前在下方）
        is_above = latest['close'] > latest['ma60']
        was_below = prev_5['close'] < prev_5['ma60'] if not pd.isna(prev_5['ma60']) else False

        # 突破前走势特征
        pre_break = df.iloc[-65:-5] if len(df) >= 65 else df.iloc[:max(0, len(df)-5)]
        if len(pre_break) < 20:
            return 40.0, {"type": "rebound", "reason": "突破前数据不足，保守评分"}

        price_decline = (pre_break['close'].max() - pre_break['close'].min()) / pre_break['close'].max() if pre_break['close'].max() > 0 else 0
        ma60_slope = (latest['ma60'] - pre_break['ma60'].iloc[0]) / pre_break['ma60'].iloc[0] if pre_break['ma60'].iloc[0] > 0 else 0
        range_ratio = (pre_break['close'].max() - pre_break['close'].min()) / pre_break['close'].mean() if pre_break['close'].mean() > 0 else 0

        # 成交量确认
        recent_vol = df.iloc[-5:]['vol'].mean()
        pre_vol = df.iloc[-20:-5]['vol'].mean()
        volume_ratio = recent_vol / pre_vol if pre_vol > 0 else 1.0

        detail = {
            "price_decline": round(price_decline, 4),
            "ma60_slope": round(ma60_slope, 4),
            "range_ratio": round(range_ratio, 4),
            "volume_ratio": round(volume_ratio, 2),
            "is_above": is_above,
            "was_below": was_below,
            "latest_close": round(latest['close'], 2),
            "latest_ma60": round(latest['ma60'], 2) if not pd.isna(latest['ma60']) else None,
        }

        # === 类型判定 ===

        # 1. 下跌反弹突破
        if price_decline > 0.25 and ma60_slope < -0.05:
            bottom_structure = self._check_bottom_structure(pre_break)
            if bottom_structure:
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

        # 已经在MA60上方运行的情况
        if is_above and not was_below:
            # 检查是否近期回踩过MA60
            recent_20 = df.iloc[-20:]
            touched_ma60 = any(row['low'] <= row['ma60'] * 1.02 for _, row in recent_20.iterrows() if not pd.isna(row['ma60']))
            if touched_ma60:
                return 85.0, {"type": "pullback", "reason": "趋势中回踩MA60后再上涨", "quality": "high", **detail}
            return 70.0, {"type": "consolidation", "reason": "MA60上方运行，未明显回踩", "quality": "medium", **detail}

        # 默认：温和突破
        score = 60.0 + min(volume_ratio * 5, 10)
        return score, {"type": "consolidation", "reason": "温和突破MA60", "quality": "medium", **detail}

    def _check_bottom_structure(self, df: pd.DataFrame) -> bool:
        """简化底部结构检测（双底/头肩底）"""
        if len(df) < 40:
            return False

        lows = df['low'].values

        # 找局部低点
        local_lows = []
        for i in range(2, len(lows) - 2):
            if lows[i] < lows[i-1] and lows[i] < lows[i-2] and lows[i] < lows[i+1] and lows[i] < lows[i+2]:
                local_lows.append((i, lows[i]))

        if len(local_lows) < 2:
            return False

        # 双底检测
        for i in range(len(local_lows) - 1):
            for j in range(i + 1, min(i + 4, len(local_lows))):
                low1 = local_lows[i][1]
                low2 = local_lows[j][1]
                if abs(low1 - low2) / low1 < 0.05:
                    mid_idx = (local_lows[i][0] + local_lows[j][0]) // 2
                    mid_high = max(df['high'].iloc[local_lows[i][0]:local_lows[j][0]])
                    if mid_high > low1 * 1.08:
                        return True

        return False

    # ==================== 3. 趋势阶段识别评分 ====================

    def score_trend_stage(self, secid: str, trade_date: str) -> Tuple[float, Dict]:
        """
        维度3: 趋势阶段评分 (0-100)

        四阶段:
        - 起势: 90-100分（早期介入，盈亏比最优）
        - 聚势: 75-90分（次选，等待突破确认）
        - 冲势: 50-70分（追高风险增加）
        - 落势: 0-20分（回避）
        """
        df = self._get_kline_cached(secid, days=90, end_date=trade_date)
        if df is None or len(df) < 60:
            return 30.0, {"stage": "不明", "reason": "K线数据不足", "confidence": 0.3}

        # 计算多周期均线
        df['ma5'] = df['close'].rolling(5).mean()
        df['ma10'] = df['close'].rolling(10).mean()
        df['ma20'] = df['close'].rolling(20).mean()
        df['ma60'] = df['close'].rolling(60).mean()

        latest = df.iloc[-1]
        m5, m10, m20, m60 = latest['ma5'], latest['ma10'], latest['ma20'], latest['ma60']
        c = latest['close']

        # 均线排列
        bull_aligned = m5 > m10 > m20 > m60
        bear_aligned = m5 < m10 < m20 < m60
        mixed = not bull_aligned and not bear_aligned

        # 动量
        prev_20 = df.iloc[-20] if len(df) >= 20 else df.iloc[0]
        prev_60 = df.iloc[-60] if len(df) >= 60 else df.iloc[0]
        momentum_20 = (c - prev_20['close']) / prev_20['close'] if prev_20['close'] > 0 else 0
        momentum_60 = (c - prev_60['close']) / prev_60['close'] if prev_60['close'] > 0 else 0

        # 波动率
        volatility = df['close'].iloc[-20:].std() / df['close'].iloc[-20:].mean() if df['close'].iloc[-20:].mean() > 0 else 0

        # 成交量趋势
        vol_trend = df['vol'].iloc[-10:].mean() / df['vol'].iloc[-30:-10].mean() if df['vol'].iloc[-30:-10].mean() > 0 else 1.0

        # 偏离度
        deviation = (c - m5) / m5 if m5 > 0 else 0

        detail = {
            "bull_aligned": bull_aligned,
            "bear_aligned": bear_aligned,
            "momentum_20": round(momentum_20, 4),
            "momentum_60": round(momentum_60, 4),
            "volatility": round(volatility, 4),
            "vol_trend": round(vol_trend, 2),
            "deviation": round(deviation, 4),
        }

        # === 阶段判定 ===

        # 落势
        if bear_aligned or (not bull_aligned and momentum_20 < -0.03):
            return 10.0, {"stage": "落势", "reason": "空头排列或动量转负，回避", "confidence": 0.9, "score": 10, **detail}

        # 起势
        if mixed and m60 < m20 and momentum_20 > 0.05 and momentum_60 < 0.15 and vol_trend > 1.2:
            ma_cross_recent = m5 > m10 > m20
            if ma_cross_recent and momentum_20 < 0.15:
                score = 95.0 + min(vol_trend * 2, 5)
                return score, {"stage": "起势", "reason": "早期起势，均线刚多头排列，最佳介入点", "confidence": 0.85, "score": score, **detail}
            score = 85.0 + min(vol_trend * 2, 5)
            return score, {"stage": "起势", "reason": "起势阶段，已经开始上涨", "confidence": 0.75, "score": score, **detail}

        # 聚势
        if bull_aligned and 0.03 < momentum_20 < 0.15 and 1.0 < vol_trend < 1.5:
            recent_pullback = df['close'].iloc[-10:].max() > c * 1.03
            if recent_pullback:
                score = 85.0
                return score, {"stage": "聚势", "reason": "多头排列，洗盘后重新放量", "confidence": 0.75, "score": score, **detail}
            score = 78.0
            return score, {"stage": "聚势", "reason": "多头排列形成中，稳健上涨", "confidence": 0.7, "score": score, **detail}

        # 冲势
        if bull_aligned and momentum_20 > 0.15:
            if deviation > 0.08:
                score = max(50.0, 70.0 - (deviation - 0.08) * 200)
                return score, {"stage": "冲势", "reason": f"冲势阶段，偏离均线{deviation*100:.1f}%，追高风险", "confidence": 0.6, "score": score, **detail}
            score = 65.0
            return score, {"stage": "冲势", "reason": "冲势阶段，偏离度可控", "confidence": 0.65, "score": score, **detail}

        # 震荡不明
        if mixed and abs(momentum_20) < 0.03:
            return 40.0, {"stage": "不明", "reason": "震荡整理，方向不明", "confidence": 0.5, "score": 40, **detail}

        return 50.0, {"stage": "不明", "reason": "趋势特征不明显", "confidence": 0.5, "score": 50, **detail}

    # ==================== 4. 同题材相对强度评分 ====================

    def score_relative_strength(self, secid: str, trade_date: str) -> Tuple[float, Dict]:
        """
        维度4: 同题材相对强度评分 (0-100)

        核心逻辑: 只做题材最强
        - 首个涨停时间排名 (25分)
        - 连板数排名 (30分)
        - 封单金额/流通市值比 (15分)
        - 近5日涨幅排名 (10分)
        - 涨停强度 (20分)
        """
        ts_code = convert_secid_to_ts_code(secid)
        code_pure = convert_secid_to_pure_code(secid)
        date_str = trade_date.replace("-", "")

        # 获取当日涨停列表
        limit_df = self._get_limit_up_list(trade_date)
        if limit_df is None or limit_df.empty:
            return 50.0, {"reason": "无涨停数据"}

        # 获取股票所属概念，找到同题材涨停股
        concepts = self._get_stock_concepts(ts_code)
        topic_stocks = self._get_topic_limit_up_stocks(concepts, limit_df, trade_date)

        # 确保自己也在列表中
        if ts_code not in topic_stocks:
            topic_stocks.append(ts_code)

        detail = {"topic_stock_count": len(topic_stocks), "concepts_checked": len(concepts)}

        # 过滤出同题材涨停股数据
        limit_df_topic = limit_df[limit_df['ts_code'].isin(topic_stocks)].copy()
        if limit_df_topic.empty:
            return 50.0, {"reason": "同题材无涨停数据", **detail}

        # 1. 首个涨停时间排名 (25分)
        limit_df_topic['first_time_int'] = limit_df_topic['first_time'].astype(str).str.replace(":", "").astype(int, errors='ignore').fillna(999999)

        my_row = limit_df_topic[limit_df_topic['ts_code'] == ts_code]
        my_first_time = my_row['first_time_int'].iloc[0] if not my_row.empty else 999999
        all_first_times = sorted(limit_df_topic['first_time_int'].tolist())

        if my_first_time == min(all_first_times):
            first_score = 25.0
        else:
            try:
                rank = all_first_times.index(my_first_time)
                first_score = max(0, 25 - rank * 5)
            except ValueError:
                first_score = 5.0

        # 2. 连板数排名 (30分)
        end_dt = datetime.strptime(date_str, "%Y%m%d")
        start_dt = end_dt - timedelta(days=15)
        start_date = start_dt.strftime("%Y%m%d")

        my_boards = self._calc_consecutive_limit_up(ts_code, start_date, date_str)
        max_boards = 0
        all_boards = {}
        for stock in topic_stocks:
            boards = self._calc_consecutive_limit_up(stock, start_date, date_str)
            all_boards[stock] = boards
            max_boards = max(max_boards, boards)

        board_score = (my_boards / max_boards) * 30 if max_boards > 0 else 0
        board_score = min(board_score, 30)

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
        all_returns = []
        for stock in topic_stocks:
            r = self._calc_return_n_days(stock, trade_date, 5)
            all_returns.append(r)

        if all_returns:
            sorted_returns = sorted(all_returns, reverse=True)
            try:
                rank = sorted_returns.index(ret_5d)
                return_score = max(0, 10 - rank)
            except ValueError:
                return_score = 5
        else:
            return_score = 5

        # 5. 涨停强度 (20分)
        if not my_row.empty:
            strth = _to_float(my_row.iloc[0].get('strth', 0))
            strength_score = min(strth * 2, 20)
        else:
            strength_score = 10

        total_score = first_score + board_score + seal_score + return_score + strength_score

        detail.update({
            "first_score": round(first_score, 2),
            "board_score": round(board_score, 2),
            "my_boards": my_boards,
            "max_boards": max_boards,
            "seal_score": round(seal_score, 2),
            "seal_ratio": round(seal_ratio, 6),
            "return_score": round(return_score, 2),
            "ret_5d": round(ret_5d, 2),
            "strength_score": round(strength_score, 2),
        })

        return round(total_score, 2), detail

    def _get_topic_limit_up_stocks(self, concepts: List[Dict], limit_df: pd.DataFrame, trade_date: str) -> List[str]:
        """获取同题材下的其他涨停股票"""
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
                    for member in member_codes:
                        if member in limit_codes and member not in topic_stocks:
                            topic_stocks.append(member)
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
                if (dates[i-1] - dates[i]).days == 1:
                    consecutive += 1
                else:
                    break

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
            scores['ratio'] = (ratio - 0.5) * 30 + 7.5
            scores['ratio'] = max(0, min(scores['ratio'], 15))
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
            "up_days": up_days,
            "down_days": down_days,
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
                        ret = (next_close - limit_close) / limit_close
                        returns.append(ret)

            write_cache(cache_key, returns)
            return returns
        except Exception:
            return []

    def _get_next_trade_date(self, date_str: str) -> Optional[str]:
        """获取下一个交易日（简化版：跳过周末）"""
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
            max_consecutive = 1
            current = 1
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
            secid: 股票ID，如 "0.000001"
            trade_date: 交易日期，如 "2025-06-27"

        Returns:
            完整的评分结果字典
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
            grade = "S"
            recommendation = "重点参与，仓位可重"
        elif total >= cfg.a_grade_threshold:
            grade = "A"
            recommendation = "积极参与"
        elif total >= cfg.b_grade_threshold:
            grade = "B"
            recommendation = "谨慎参与，控制仓位"
        elif total >= cfg.c_grade_threshold:
            grade = "C"
            recommendation = "观望或极小仓位试错"
        else:
            grade = "D"
            recommendation = "回避"

        return {
            "secid": secid,
            "ts_code": ts_code,
            "trade_date": trade_date,
            "name": name,
            "total_score": round(total, 2),
            "grade": grade,
            "recommendation": recommendation,
            "penalty": round(penalty, 2),
            "dimension_scores": {
                "topic_heat": {
                    "score": topic_score,
                    "weight": cfg.weight_topic_heat,
                    "weighted": round(topic_score * cfg.weight_topic_heat, 2),
                    "detail": topic_detail,
                },
                "ma60_break": {
                    "score": ma60_score,
                    "weight": cfg.weight_ma60_break,
                    "weighted": round(ma60_score * cfg.weight_ma60_break, 2),
                    "detail": ma60_detail,
                },
                "trend_stage": {
                    "score": trend_score,
                    "weight": cfg.weight_trend_stage,
                    "weighted": round(trend_score * cfg.weight_trend_stage, 2),
                    "detail": trend_detail,
                },
                "relative_strength": {
                    "score": rel_score,
                    "weight": cfg.weight_relative_strength,
                    "weighted": round(rel_score * cfg.weight_relative_strength, 2),
                    "detail": rel_detail,
                },
                "stock_character": {
                    "score": char_score,
                    "weight": cfg.weight_stock_character,
                    "weighted": round(char_score * cfg.weight_stock_character, 2),
                    "detail": char_detail,
                },
            },
            "weights": {
                "topic_heat": cfg.weight_topic_heat,
                "ma60_break": cfg.weight_ma60_break,
                "trend_stage": cfg.weight_trend_stage,
                "relative_strength": cfg.weight_relative_strength,
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

        # 按总分降序
        results.sort(key=lambda x: x['total_score'], reverse=True)

        # 添加排名
        for i, r in enumerate(results):
            r['rank'] = i + 1

        return {
            "trade_date": trade_date,
            "total_count": total,
            "scored_count": len(results),
            "top_stocks": results[:top_n],
        }


# ============ 与 TushareAPI 的集成方法 ============

def register_limit_up_methods():
    """
    将涨停评分方法注册到 TushareAPI 类中
    在 tushare_api.py 末尾调用此方法即可
    """

    @staticmethod
    def score_limit_up_stock(secid: str, trade_date: str) -> Dict[str, Any]:
        """单只涨停股票评分"""
        scorer = LimitUpScorer()
        return scorer.score_limit_up_stock(secid, trade_date)

    @staticmethod
    def batch_score_limit_up(trade_date: str, top_n: int = 50) -> Dict[str, Any]:
        """批量评分当日涨停股票"""
        scorer = LimitUpScorer()
        return scorer.batch_score_limit_up(trade_date, top_n)

    TushareAPI.score_limit_up_stock = score_limit_up_stock
    TushareAPI.batch_score_limit_up = batch_score_limit_up


# 注册涨停评分方法到 TushareAPI
# 必须在 if __name__ == "__main__" 之前调用，否则 CLI 模式下 main() 找不到方法
register_limit_up_methods()

# ============ CLI 入口 ============
# 注意：register_limit_up_methods() 必须在 main() 之前执行，因此 CLI 入口放在文件末尾

if __name__ == "__main__":
    main()


