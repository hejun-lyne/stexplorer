# Akshare 集成指南

本文档介绍如何将 `stock.ts` 中的东方财富接口替换为 Akshare Python 库调用。

## 概述

Akshare 是一个基于 Python 的开源金融数据接口库，提供了丰富的中国股票、期货、基金等金融数据。通过将原有的 HTTP 直接调用替换为 Akshare，可以：

1. 获得更稳定的数据源
2. 减少网络请求失败的问题
3. 获取更多维度的金融数据

## 数据源说明

本集成使用以下数据源：

| 数据类型 | 数据源 | 接口函数 | 说明 |
|---------|-------|---------|------|
| K线数据 | **腾讯财经** | `stock_zh_a_hist_tx` | 日/周/月K线，支持复权 |
| 分时数据 | **腾讯财经** | `stock_zh_a_tick_tx_js` | 当日分笔成交数据 |
| 实时行情 | 东方财富 | `stock_zh_a_spot_em` | 全市场实时行情 |
| 涨停股票 | 东方财富 | `stock_zt_pool_em` | 涨停股票列表 |
| 板块数据 | 东方财富 | `stock_board_industry_name_em` | 行业/概念板块 |
| 公司信息 | 东方财富 | `stock_individual_info_em` | 公司概况 |
| 新闻研报 | 东方财富 | `stock_news_em` / `stock_research_report_em` | 个股新闻和研报 |

**注**：K 线和分时数据已切换为腾讯财经数据源，其他数据仍使用东方财富数据源。

## 安装步骤

### 1. 安装 Python 环境

确保系统已安装 Python 3.7+：

```bash
python3 --version
```

### 2. 安装 Akshare

```bash
pip install akshare -U
```

### 3. 配置 Python 路径

编辑 `src/main/main.ts` 中的 Python 路径，或在启动应用时设置环境变量：

**方式一：环境变量（推荐）**

```bash
# macOS/Linux
export PYTHON_PATH=/usr/bin/python3
export PYTHON_SCRIPT_PATH=/path/to/your/project/src/main/python

# Windows
set PYTHON_PATH=C:\Python39\python.exe
set PYTHON_SCRIPT_PATH=C:\path\to\your\project\src\main\python
```

**方式二：修改代码**

```typescript
// src/main/main.ts
const pythonPath = '/your/python/path';  // 修改这里
const scriptPath = '/your/script/path';  // 修改这里
```

## 文件结构

```
src/
├── main/
│   └── python/
│       ├── hello.py              # 示例脚本
│       ├── main.py               # PyTorch 示例
│       ├── quant.py              # 量化脚本
│       ├── akshare_api.py        # 【新增】Akshare API 封装
│       ├── test_akshare.py       # 【新增】Akshare 测试工具
│       └── test_tencent_api.py   # 【新增】腾讯财经数据源测试
├── renderer/
│   └── services/
│       ├── stock.ts              # 【修改】添加数据源切换支持
│       └── akshare.ts            # 【新增】Akshare 调用层
└── renderer/
    └── components/
        └── SettingContent/
            └── index.tsx         # 【修改】添加 Akshare 选项
```

## 使用方法

### 1. 切换数据源

在应用设置页面，找到 "K线数据源" 选项，选择 "Akshare"。

### 2. 在代码中使用

```typescript
import * as Enums from '@/utils/enums';
import { GetKFromDataSource, FromDataSource } from '@/renderer/services/stock';

// 获取 K 线数据
const klineData = await GetKFromDataSource(
  Enums.FundApiType.Akshare,  // 使用 Akshare
  '0.000001',                 // 股票代码
  Enums.KLineType.Day         // 日K线
);

// 获取股票综合数据
const stockData = await FromDataSource(
  Enums.FundApiType.Akshare,
  '0.000001'
);
```

### 3. 直接使用 Akshare 模块

```typescript
import * as AkshareAPI from '@/renderer/services/akshare';

// 搜索股票
const stocks = await AkshareAPI.SearchFromAkshare('茅台');

// 获取实时行情
const detail = await AkshareAPI.GetDetailFromAkshare('0.600519');

// 获取 K 线数据
const kline = await AkshareAPI.GetKFromAkshare('0.600519', 101);

// 获取涨停股票
const ztStocks = await AkshareAPI.GeZTStocksFromAkshare(20);
```

## 接口对照表

| 原 Eastmoney 函数 | Akshare 替代函数 | 说明 |
|------------------|-----------------|------|
| `SearchFromEastmoney` | `SearchFromAkshare` | 搜索股票 |
| `GetDetailFromEastmoney` | `GetDetailFromAkshare` | 股票实时详情 |
| `GetTrendFromEastmoney` | `GetTrendFromAkshare` | 分时走势 |
| `GetKFromEastmoney` | `GetKFromAkshare` | K 线数据 |
| `GetBanKuais` | `GetBanKuaisFromAkshare` | 板块列表 |
| `GeZTStocks` | `GeZTStocksFromAkshare` | 涨停股票 |
| `GeDTStocks` | `GeDTStocksFromAkshare` | 跌停股票 |
| `GetABCompany` | `GetCompanyFromAkshare` | 公司信息 |
| `GetNews` | `GetNewsFromAkshare` | 个股新闻 |
| `GetStockResearches` | `GetResearchesFromAkshare` | 研究报告 |
| `FromEastmoney` | `FromAkshare` | 综合数据 |

## 数据源切换封装

为了方便切换数据源，提供了统一的封装函数：

```typescript
import { 
  GetKFromDataSource,
  SearchFromDataSource,
  GetDetailFromDataSource,
  GetTrendFromDataSource,
  FromDataSource,
  GetBanKuaisFromDataSource,
  GetCompanyFromDataSource,
  GetNewsFromDataSource,
  GetResearchesFromDataSource,
  GeZTStocksFromDataSource,
  GeDTStocksFromDataSource,
} from '@/renderer/services/stock';

// 统一使用 DataSource 函数，通过参数切换数据源
const kline = await GetKFromDataSource(Enums.FundApiType.Akshare, secid, code);
const detail = await GetDetailFromDataSource(Enums.FundApiType.Akshare, secid);
```

## 扩展 Akshare 功能

### 1. 添加新的 Python 接口

编辑 `src/main/python/akshare_api.py`，在 `AkshareAPI` 类中添加新方法：

```python
@staticmethod
def get_new_data(param: str) -> Dict[str, Any]:
    """获取新数据"""
    try:
        df = ak.your_function(param=param)
        # 处理数据...
        return {"data": result}
    except Exception as e:
        return {"error": str(e)}
```

### 2. 添加 TypeScript 调用函数

编辑 `src/renderer/services/akshare.ts`：

```typescript
export async function GetNewDataFromAkshare(param: string): Promise<any> {
  try {
    const result = await callAkshare('get_new_data', { param });
    if (result.error) {
      console.error('获取数据失败:', result.error);
      return null;
    }
    return result;
  } catch (error) {
    logError(error, 'GetNewDataFromAkshare');
    return null;
  }
}
```

## 测试工具

### 1. 测试基础 Akshare 功能

```bash
python src/main/python/test_akshare.py
```

### 2. 测试腾讯财经数据源

```bash
python src/main/python/test_tencent_api.py
```

此测试会验证：
- secid 转换为腾讯 symbol 格式
- 腾讯财经 K 线数据获取
- 腾讯财经分时数据获取
- API 封装函数

## 注意事项

1. **Python 环境**：确保系统已正确安装 Python，并且 `akshare` 库已安装
2. **路径配置**：确保 `PYTHON_PATH` 和 `PYTHON_SCRIPT_PATH` 配置正确
3. **性能考虑**：Python 调用比直接 HTTP 请求稍慢，但数据质量更稳定
4. **错误处理**：Akshare 接口可能会因为数据源维护而暂时不可用，建议做好错误处理和降级方案
5. **腾讯财经数据**：
   - K 线数据支持复权（前复权/后复权）
   - 周/月K线通过日K线聚合生成
   - 分时数据为当日分笔成交数据
   - 如腾讯接口失败，会自动尝试备用数据源

## 常见问题

### Q: 提示 "请先安装 akshare"

A: 在终端运行 `pip install akshare -U` 安装 akshare 库

### Q: Python 路径错误

A: 检查 `src/main/main.ts` 中的 `pythonPath` 配置，或设置 `PYTHON_PATH` 环境变量

### Q: 数据返回为空

A: Akshare 数据源可能在维护，建议切换回 Eastmoney 数据源，或检查网络连接

### Q: 腾讯财经 K 线数据缺少某些字段（如换手率）

A: 腾讯财经接口本身不返回换手率字段，该字段会被设置为 0。如需完整字段，请使用 Eastmoney 数据源。

## 参考文档

- [Akshare 官方文档](https://www.akshare.xyz/)
- [Akshare GitHub](https://github.com/akfamily/akshare)
