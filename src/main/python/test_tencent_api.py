#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试腾讯财经数据源
"""

import sys
import json

# 测试导入
try:
    import akshare as ak
    print(f"✓ Akshare 版本: {ak.__version__}")
except ImportError:
    print("✗ 未安装 akshare")
    sys.exit(1)

# 导入转换函数
from akshare_api import convert_secid_to_tx_symbol, AkshareAPI


def test_secid_conversion():
    """测试 secid 转换"""
    print("\n1. 测试 secid 转换为腾讯 symbol...")
    
    test_cases = [
        ("0.000001", "sz000001"),  # 深市
        ("1.600000", "sh600000"),  # 沪市
        ("0.300001", "sz300001"),  # 创业板
        ("1.688001", "sh688001"),  # 科创板
    ]
    
    all_passed = True
    for secid, expected in test_cases:
        result = convert_secid_to_tx_symbol(secid)
        status = "✓" if result == expected else "✗"
        print(f"  {status} {secid} -> {result} (期望: {expected})")
        if result != expected:
            all_passed = False
    
    return all_passed


def test_tencent_kline():
    """测试腾讯财经 K 线数据"""
    print("\n2. 测试腾讯财经 K 线数据...")
    
    try:
        # 测试获取平安银行的日K线
        symbol = "sz000001"
        df = ak.stock_zh_a_hist_tx(symbol=symbol, start_date="20240101", end_date="20240131", adjust="qfq")
        
        if not df.empty:
            print(f"  ✓ 获取 K 线数据成功，共 {len(df)} 条")
            print(f"     最新数据: {df.iloc[-1]['date']} 收盘: {df.iloc[-1]['close']}")
            print(f"     数据列: {list(df.columns)}")
            return True
        else:
            print("  ✗ 数据为空")
            return False
    except Exception as e:
        print(f"  ✗ 获取失败: {e}")
        return False


def test_tencent_trend():
    """测试腾讯财经分时数据"""
    print("\n3. 测试腾讯财经分时数据...")
    
    try:
        # 测试获取平安银行的分时数据
        symbol = "sz000001"
        df = ak.stock_zh_a_tick_tx_js(symbol=symbol)
        
        if not df.empty:
            print(f"  ✓ 获取分时数据成功，共 {len(df)} 条")
            print(f"     第一条: 时间={df.iloc[0]['成交时间']} 价格={df.iloc[0]['成交价格']}")
            print(f"     最后一条: 时间={df.iloc[-1]['成交时间']} 价格={df.iloc[-1]['成交价格']}")
            print(f"     数据列: {list(df.columns)}")
            return True
        else:
            print("  ✗ 数据为空")
            return False
    except Exception as e:
        print(f"  ✗ 获取失败: {e}")
        return False


def test_api_wrapper():
    """测试 API 封装函数"""
    print("\n4. 测试 API 封装函数...")
    
    api = AkshareAPI()
    
    # 测试 K 线
    print("  测试 get_kline_data...")
    result = api.get_kline_data("0.000001", period="daily")
    if isinstance(result, list) and len(result) > 0:
        print(f"    ✓ 成功，返回 {len(result)} 条数据")
        print(f"    示例: {result[0]}")
    else:
        print(f"    ✗ 失败: {result}")
        return False
    
    # 测试分时
    print("  测试 get_stock_trend...")
    result = api.get_stock_trend("0.000001")
    if isinstance(result, list) and len(result) > 0:
        print(f"    ✓ 成功，返回 {len(result)} 条数据")
        print(f"    示例: {result[0]}")
    elif isinstance(result, dict) and "error" in result:
        print(f"    ✗ 失败: {result['error']}")
        return False
    else:
        print(f"    ! 警告: 返回数据为空")
    
    return True


def main():
    print("=" * 60)
    print("腾讯财经数据源测试工具")
    print("=" * 60)
    
    results = []
    
    # 运行测试
    results.append(("secid 转换", test_secid_conversion()))
    results.append(("腾讯 K 线", test_tencent_kline()))
    results.append(("腾讯分时", test_tencent_trend()))
    results.append(("API 封装", test_api_wrapper()))
    
    # 汇总
    print("\n" + "=" * 60)
    print("测试结果汇总")
    print("=" * 60)
    
    for name, result in results:
        status = "✓ 通过" if result else "✗ 失败"
        print(f"{name}: {status}")
    
    all_passed = all(r[1] for r in results)
    
    print("\n" + "=" * 60)
    if all_passed:
        print("✓ 所有测试通过，腾讯财经数据源可用")
    else:
        print("✗ 部分测试失败，请检查错误信息")
    print("=" * 60)
    
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
