#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试 Akshare 安装和基本功能
"""

import sys

def test_import():
    """测试 akshare 是否能正常导入"""
    try:
        import akshare as ak
        print(f"✓ Akshare 版本: {ak.__version__}")
        return True
    except ImportError:
        print("✗ 未安装 akshare，请运行: pip install akshare -U")
        return False

def test_stock_spot():
    """测试获取股票实时行情"""
    try:
        import akshare as ak
        df = ak.stock_zh_a_spot_em()
        if not df.empty:
            print(f"✓ 获取实时行情成功，共 {len(df)} 条数据")
            print(f"  示例数据: {df.iloc[0]['名称']} - {df.iloc[0]['最新价']}")
            return True
        else:
            print("✗ 获取实时行情失败，数据为空")
            return False
    except Exception as e:
        print(f"✗ 获取实时行情失败: {e}")
        return False

def test_kline():
    """测试获取 K 线数据"""
    try:
        import akshare as ak
        df = ak.stock_zh_a_hist(symbol="000001", period="daily", adjust="qfq")
        if not df.empty:
            print(f"✓ 获取 K 线数据成功，共 {len(df)} 条数据")
            print(f"  最新数据: {df.iloc[-1]['日期']} 收盘: {df.iloc[-1]['收盘']}")
            return True
        else:
            print("✗ 获取 K 线数据失败，数据为空")
            return False
    except Exception as e:
        print(f"✗ 获取 K 线数据失败: {e}")
        return False

def main():
    print("=" * 50)
    print("Akshare 测试工具")
    print("=" * 50)
    print()
    
    results = []
    
    # 测试导入
    print("1. 测试 Akshare 导入...")
    results.append(("导入", test_import()))
    print()
    
    # 测试实时行情
    print("2. 测试实时行情获取...")
    results.append(("实时行情", test_stock_spot()))
    print()
    
    # 测试 K 线数据
    print("3. 测试 K 线数据获取...")
    results.append(("K线数据", test_kline()))
    print()
    
    # 汇总
    print("=" * 50)
    print("测试结果汇总")
    print("=" * 50)
    for name, result in results:
        status = "✓ 通过" if result else "✗ 失败"
        print(f"{name}: {status}")
    
    all_passed = all(r[1] for r in results)
    if all_passed:
        print("\n✓ 所有测试通过，可以正常使用 Akshare 数据源")
        return 0
    else:
        print("\n✗ 部分测试失败，请检查错误信息")
        return 1

if __name__ == "__main__":
    sys.exit(main())
