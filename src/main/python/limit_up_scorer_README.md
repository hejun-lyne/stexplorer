# 涨停股票评分系统 (LimitUpScorer) - 使用文档

## 文件说明

| 文件 | 说明 |
|------|------|
| `limit_up_scorer.py` | 独立评分模块（推荐），与 `tushare_api.py` 同目录放置即可 |
| `tushare_api_with_scorer.py` | 整合版（将 scorer 追加到 tushare_api.py 末尾） |

## 快速开始

### 1. 单只涨停股评分

```python
from limit_up_scorer import LimitUpScorer, LimitUpScoreConfig

# 初始化（使用默认配置）
scorer = LimitUpScorer()

# 评分某只涨停股
result = scorer.score_limit_up_stock("0.000001", "2025-06-27")

print(f"股票: {result['name']} ({result['secid']})")
print(f"总分: {result['total_score']}")
print(f"等级: {result['grade']} - {result['recommendation']}")

# 查看各维度得分
for dim, data in result['dimension_scores'].items():
    print(f"  {dim}: {data['score']}分 (权重{data['weight']}, 加权{data['weighted']})")
```

### 2. 批量评分当日所有涨停股

```python
# 评分当日所有涨停股，返回前30名
batch = scorer.batch_score_limit_up("2025-06-27", top_n=30)

print(f"当日涨停总数: {batch['total_count']}")
print(f"成功评分: {batch['scored_count']}")

for stock in batch['top_stocks']:
    print(f"{stock['rank']}. {stock['name']} ({stock['secid']}): "
          f"{stock['total_score']}分 [{stock['grade']}] - {stock['recommendation']}")
```

### 3. 自定义评分权重

```python
config = LimitUpScoreConfig(
    weight_topic_heat=0.15,       # 降低题材权重
    weight_trend_stage=0.30,      # 提高趋势权重
    weight_ma60_break=0.25,       # 提高突破质量权重
    s_grade_threshold=88.0,       # 提高S级门槛
)

scorer = LimitUpScorer(config)
result = scorer.score_limit_up_stock("0.000001", "2025-06-27")
```

### 4. 注册到 TushareAPI（可选）

```python
from limit_up_scorer import register_limit_up_methods

# 注册后可直接通过 TushareAPI 调用
register_limit_up_methods()

result = TushareAPI.score_limit_up_stock("0.000001", "2025-06-27")
batch = TushareAPI.batch_score_limit_up("2025-06-27", top_n=30)
```

### 5. CLI 命令行使用

```bash
# 单只评分
python limit_up_scorer.py score --secid 0.000001 --date 2025-06-27 --token YOUR_TOKEN

# 批量评分
python limit_up_scorer.py batch --date 2025-06-27 --top-n 30 --token YOUR_TOKEN

# 指定缓存目录
python limit_up_scorer.py batch --date 2025-06-27 --storage-path /path/to/cache
```

---

## 评分维度详解

### 维度1: 题材热点热度 (权重 20%)

| 子指标 | 数据来源 | 说明 |
|--------|---------|------|
| 概念涨幅得分 | `dc_index` | 概念板块当日涨跌幅 |
| 涨跌比得分 | `dc_index` | 板块内上涨家数占比 |
| 涨停密度得分 | `dc_member` + `limit_list` | 板块内涨停家数占比 |
| 个股资金得分 | `moneyflow` | 个股主力净流入 |

**热度分 = 概念热度 × 0.7 + 个股资金 × 0.3**

### 维度2: 60日均线突破质量 (权重 20%)

| 突破类型 | 判定条件 | 基础分 | 质量 |
|---------|---------|--------|------|
| **上涨回踩突破** (pullback) | 前期已上涨，回踩MA60后再突破 | 90-100 | 最高 |
| **震荡筑底突破** (consolidation) | 横盘整理后突破，需放量确认 | 70-90 | 高 |
| **下跌反弹突破** (rebound) | 下跌后反弹突破，易假突破 | 30-60 | 低 |
| **未突破** (none) | 未站上MA60 | 0 | 淘汰 |

判定依据：突破前价格跌幅、MA60斜率、横盘波动率、成交量比

### 维度3: 趋势阶段 (权重 25%)

| 阶段 | 判定条件 | 得分 | 策略 |
|------|---------|------|------|
| **起势** | 均线刚多头排列，成交量温和放大 | 90-100 | 首选，盈亏比最优 |
| **聚势** | 多头排列形成中，震荡洗盘 | 75-90 | 次选，等待确认 |
| **冲势** | 强势上涨，偏离均线较远 | 50-70 | 谨慎，注意止盈 |
| **落势** | 空头排列或动量转负 | 0-20 | 回避 |
| **不明** | 震荡整理，方向不明 | 30-50 | 观望 |

### 维度4: 同题材相对强度 (权重 20%)

**核心原则：只做题材最强**

| 子指标 | 满分 | 说明 |
|--------|------|------|
| 首个涨停时间 | 25分 | 同题材内最早涨停 |
| 连板数 | 30分 | 连板越多分越高 |
| 封单/市值比 | 15分 | 封单金额占流通市值比例 |
| 近5日涨幅排名 | 10分 | 同题材内涨幅排名 |
| 涨停强度 | 20分 | `limit_list.strth` 字段 |

### 维度5: 股性评价 (权重 15%)

| 子指标 | 满分 | 说明 |
|--------|------|------|
| 连续阳线能力 | 20分 | 最大连续上涨天数 |
| 涨停次数 | 20分 | 历史涨停频率 |
| 阳阴线比 | 15分 | 阳线占比 |
| **涨停次日表现** | **25分** | **平均次日收益率+胜率，最关键** |
| 振幅活跃度 | 10分 | 日均振幅 |
| 历史连板能力 | 10分 | 最大连板数 |

---

## 评分等级

| 总分 | 等级 | 操作建议 |
|------|------|---------|
| ≥85 | **S** | 重点参与，仓位可重 |
| 70-84 | **A** | 积极参与 |
| 55-69 | **B** | 谨慎参与，控制仓位 |
| 40-54 | **C** | 观望或极小仓位试错 |
| <40 | **D** | 回避 |

---

## 一票否决项

- **落势阶段**：总分 × 0.3
- **未突破MA60**：总分 × 0.5

---

## 返回结果结构

```json
{
  "secid": "0.000001",
  "ts_code": "000001.SZ",
  "trade_date": "2025-06-27",
  "name": "平安银行",
  "total_score": 78.5,
  "grade": "A",
  "recommendation": "积极参与",
  "penalty": 1.0,
  "dimension_scores": {
    "topic_heat": {
      "score": 75.0,
      "weight": 0.20,
      "weighted": 15.0,
      "detail": { ... }
    },
    "ma60_break": { ... },
    "trend_stage": { ... },
    "relative_strength": { ... },
    "stock_character": { ... }
  },
  "weights": { ... }
}
```

---

## 缓存机制

所有中间数据均使用 `tushare_api` 的统一缓存系统：
- K线数据：24小时缓存
- 涨停列表：24小时缓存
- 资金流向：24小时缓存
- 股性历史数据：7天缓存

---

## 依赖接口清单

| 接口 | Tushare积分 | 用途 |
|------|------------|------|
| `limit_list` | 2000 | 涨停列表、封单数据 |
| `daily` | 免费 | K线数据 |
| `daily_basic` | 2000 | 流通市值、换手率 |
| `moneyflow` | 2000 | 资金流向 |
| `dc_index` | 6000 | 概念/行业板块行情 |
| `dc_member` | 6000 | 概念板块成分股 |
| `stock_basic` | 免费 | 股票名称、行业 |
