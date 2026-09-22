# 短线评分（Short-Term Score）说明文档

短线评分用于 **寻找短线最佳买点**：从「个股 / 板块 / 大盘」三个维度打分，输出 0~100 综合分与 A/B/C/D 评级，并逐维度给出明细与形态描述。

- 入口一（单只股票）：`股票详情 → 交易数据 → 短线评分`
- 入口二（批量）：`Dashboard → 股票池 → 短线评分`（对股票池批量计算）
- 所有评分只使用「截至当前（训练模式下为训练日）」的行情数据，纯计算、无外部副作用

---

## 1. 代码结构

| 文件 | 作用 |
|---|---|
| `src/renderer/helpers/shortTermScore.ts` | **全部评分算法**（纯函数集合，不做任何 IO），含配置 `SHORT_TERM_SCORE_CONFIG` |
| `src/renderer/helpers/shortTermScoreList.ts` | 股票池批量评分：公共数据只拉一次、个股并发拉取、逐只回调、支持中途暂停 |
| `src/renderer/components/FullHome/StockTab/StockDetail/MustRead/CoreTrade/ShortTermScore/index.tsx` | 详情页 UI + 数据装配（K线/板块/涨跌比/市值档统计） |
| `src/renderer/components/FullHome/StockTab/Dashboard/StockPool/STList/index.tsx` | 股票池列表（批量入口与结果展示） |
| `src/renderer/services/tushare.ts` | `GetUpRatioFromTushare` / `GetMarketActivityStatsFromTushare` / `GetMoneyFlowFromTushare` |
| `src/renderer/services/stock.ts` | `GetKFromSetting`（多源兜底+缓存）、`GetStockBankuaisFromEastmoney`（所属板块）、`ResolveBoardCodeByName`（按名称解析板块代码） |
| `src/main/python/tushare_api.py` | 上述接口的 Python 实现（`get_up_down_ratio_batch` / `get_market_activity_stats` / `get_money_flow`） |

```
个股日K(250) ─┬─ 量能活跃度(20) ─┐
              ├─ RSI(6/24)(40) ──┤
              └─ 资金指标(60) ───┼─→ 个股(60%) ┐
板块日K(60) ─── 相对强度+环境 ────┼─→ 板块(20%) ┼─→ 综合分 → 评级/建议
指数或市值风格板块 + 涨跌比 ───────┴─→ 大盘(20%) ┘
```

> RSI 权重为 **0**：短线评分定位是「选股」而非「择时」，RSI 仍照常计算并展示（40 分制），但不参与个股综合分。

---

## 2. 总分合成与评级

```ts
整体评分 = 个股(60%) + 板块(20%) + 大盘(20%)
```

- 权重定义在 `SHORT_TERM_SCORE_CONFIG.weights`
- **缺失维度按剩余权重归一化**（例如资金流接口失败时，个股维度按量能/资金的剩余权重折算），并在结果 `degraded` 中提示
- **一票否决**：个股维度得分 < `vetoThreshold(40)` 且总分 > `vetoCap(55)` → 总分封顶 55（大盘/板块再好也不给高分）

| 等级 | 分数 | 建议文案 |
|---|---|---|
| A | ≥ 80 | 短线强势，可重点关注 |
| B | ≥ 65 | 表现尚可，可关注等待更好买点 |
| C | ≥ 50 | 表现平平，建议观望 |
| D | < 50 | 形态偏弱，短线回避 |

分数配色（`scoreColor`）：≥80 绿 / ≥65 蓝 / ≥50 橙 / 其余 红。

---

## 3. 个股维度（权重 60%）

`scoreStock(volume, rsi, money)`：子项**权重**见 `stockDims`，子项**满分**见 `stockSubMax`（两者解耦：权重可为 0 而满分不变，便于「只展示不参与」）：

```ts
stockDims   = { volume: 20, rsi: 0,  money: 60 }  // 权重（合计 100；资金为主，RSI 为 0）
stockSubMax = { volume: 30, rsi: 40, money: 30 }  // 子项满分（分值刻度/展示）
个股分 = Σ(可用且权重>0子项 (得分/满分) × 权重) / Σ(可用且权重>0子项 权重) × 100
```

### 3.1 量能活跃度（30 分，权重 20）

输入：个股日K（≥25 根）+ 同市值档活跃度统计（`GetMarketActivityStatsFromTushare`，按流通市值分档：小盘 <50亿 / 中盘 50~200亿 / 大盘 >200亿）。

**基础分 = 横向 60% + 纵向 40%**

| 部分 | 口径 | 映射 |
|---|---|---|
| 横向（60%） | `ratio = 个股5日均换手率 ÷ 同档平均换手率`<br>（换手率缺失时回退成交额） | 0.5 倍 → 0 分，2 倍 → 满分（线性）<br>文案分档：≥2 显著活跃 / ≥1.2 较为活跃 / ≥0.7 中等 / 否则清淡 |
| 纵向（40%） | `volTrend = 5日均量 ÷ 20日均量` | 0.7 → 0 分，1.5 → 满分<br>放量上涨 **+5**、缩量下跌 **−5**（上限 `max*0.4+5`） |

> 为什么用换手率：成交额会被股价高低与流通盘大小干扰，同市值档内换手率才具有可比性。

**择时位置修正**（与板块同一套"找买点、别追高"逻辑）

- 放量启动日 = 近 `volStartLookback(20)` 日内首个「5日均量 / 20日均量 ≥ `volStartRatio(1.3)`」的交易日
- ① 过热：`ratio > volRatioAllow(2)` → 每超 1 倍扣 6 分
- ② 追高：自放量启动日以来涨幅 > `volRiseAllow(8%)` → 每超 1% 扣 1.5 分（无启动日时退化为近 5 日涨幅）
- ③ 走远：距放量启动日 > `volFreshDays(5)` 日**且放量仍在持续**（`volTrend ≥ 1.3`）→ 每多 1 日扣 1 分
- 衰减下限 `volScoreFloor(5)`；无同档统计时降级为「仅按自身量能趋势评分」

### 3.2 RSI 择时（40 分，权重 0：仅计算与展示）

数据：250 日收盘 → Wilder RSI6 / RSI24（`calculateRSI`，与行情软件同口径）。

**第一步：定"格局"**（回看 `rsiStateLookback(60)` 日）

- **真实超买**：`RSI6 ≥ 80`（或 `≥ 72` 且处 95% 以上历史分位）**且** `RSI6 − RSI24 ≥ 10`
- **真实超卖**：`RSI6 ≤ 30` **且** `RSI6 − RSI24 ≤ −10`
- 谁更靠后决定格局：
  - 最近是**超买** → 才可能判定「超买后回踩」
  - 最近是**超卖** → 其后走势一律归「超卖后反抽」（即使中途冲高再回落），不会被误判成超买回踩

**第二步：判交叉时效**

- 金叉/死叉只在 `rsiCrossFreshDays(3)` 个交易日内有效，过期改按当前均线排列判定
- 「超卖后金叉」额外要求：**从上穿日往回倒推 `rsiOversoldCrossDays(5)` 日内出现过真实超卖状态**，否则只是普通上穿（不加分）

**形态分档**（原 30 分制 × 4/3 = 40 分制）

| 分 | 形态 |
|---|---|
| 40 | 真实超买后回踩 24 日线**企稳**（最佳买点） |
| 35 | 超买后回落、临近 24 日线（回踩中）；超卖后 3 日内金叉并站上 24 日线 |
| 29 | 超卖后上穿、现回落至 24 日线附近整理（金叉待确认） |
| 27 | 6 日线回抽 24 日线（接近金叉，尚未穿越）/ RSI 多头排列强势区 / 近 3 日上穿但非超卖反转 |
| 24 | 超卖后反弹修复中（尚未金叉） |
| 21 | 上穿后跌回 24 日线下方（金叉失效）/ 反弹结构中死叉贴线震荡 |
| 16 | 反弹结构中 6 日线再度跌回 24 日线下方（结构转弱）/ 非超卖上穿后失效 |
| 13 | RSI 空头排列，处于弱势区 |
| 11 | 持续超买钝化（连续 5 日 RSI6 > 80 且差值 > 15） |
| 8 | 3 日内 6 日线下穿 24 日线（死叉） |

「超买后回踩」额外条件：距最近一次真实超买 ≤ `rsiPullbackMaxDays(25)` 日、当前贴近 24 日线（差值 ∈ [−3, 5]）、已从峰值回落 ≥5、且回落过程中从未跌破超过 8（`rsiPullbackBreakSpread`，超过视为破位）。

**第三步：超买追高衰减**（避免买在高点）

偏多形态（金叉 / 上穿 / 接近金叉 / 回踩 / 修复中 / 多头排列）即便成立，只要 **RSI6 偏高或已进入超买区**，就按超出点数下调（两段式）：

```
偏高区（RSI6 > 68）：每高 1 点扣 rsiOverboughtPenaltyPerPoint(1.5) 分，最多扣 (80−68)×1.5 = 18 分
超买区（RSI6 ≥ 80）：每高 1 点再扣 rsiOverboughtSteepPerPoint(2.5) 分
得分 = clamp(形态分 − 下调分, rsiOverboughtFloor(10), 形态分)
```

以金叉（形态分 35）为例：

| RSI6 | 72 | 75 | 78 | 80 | 82 | ≥85 |
|---|---|---|---|---|---|---|
| 得分 | 29 | 24.5 | 20 | 17 | 12 | 10（下限） |

因此 **25 分以上的评分不会再出现在超买区**。形态文案会附上原因，如「…（金叉）｜RSI6=78 偏高，下调15分」、「…｜RSI6=85 已进入超买区，追高下调30分」。
死叉 / 空头排列 / 持续超买钝化本就是低分形态，不再叠加这项衰减。

### 3.3 资金指标（30 分，权重 60 —— 个股维度里权重最高）

数据：`GetMoneyFlowFromTushare(code, 60)` 的 60 日主力/散户逐日净流入 → 20 日滚动累计曲线（`moneyWindow`）。

目标是 **筛出趋势转折点**（完美微笑曲线金叉），并**不给"已经处于趋势高位"的股票高分**：

- **形态识别**（近 `moneyShapeDays(30)` 日）：U 型 `smile` / 倒 U `sad` / 平缓 `flat` / 不明 `unknown`，阈值 = 窗口内最大绝对值的 8%
- **交叉检测**（近 `moneyCrossRecentDays(5)` 日）：主力线上穿/下穿散户线
- **交叉时效衰减**：`moneyCrossDecay(0.8) ^ 距今天数`（3 日前约 0.5，越新鲜影响越大）
- **位置分**：`主力线在近 30 日区间中的相对位置`（0~1）。位置高 = 资金已持续流入很久（趋势中后段），≥ `moneyHighPosThreshold(0.72)` 视为"已在区间高位"

| 分（30 分制） | 形态 |
|---|---|
| **20~30（最高）** | **完美微笑曲线金叉**：U 型 + 上穿散户线 + 站上 0 轴（当日金叉 30，随天数衰减到 20）｜趋势转折买点 |
| 15~22 | 微笑曲线金叉但尚未站上 0 轴（15~22）；近期上穿散户线但形态未识别为 U 型（12~22，站上 0 轴更高） |
| 15 | U 型但尚未上穿 → 转折前夜，等待确认 |
| 13 / 7 | 主力净流入为正且强于散户、但**近期没有金叉**：位置不高 → 13；**已在区间高位 → 7**（已过转折点，谨防追高） |
| 9 / 11 | 净流入为正但弱于散户（资金分歧）9；方向不明 11 |
| 6 | 倒 U 型（资金撤离迹象） |
| 最低 | 倒 U 型**下穿散户线且在 0 轴下方**（越新鲜扣得越狠，最低 1~3）；0 轴下方下穿 4~8 |

---

## 4. 板块维度（权重 20%）

`scoreSector(stockKlines, boardKlines, boardName)`，目标是 **既看板块环境、更看个股相对板块的相对强度**，避免"板块当红 → 成分股集体高分"。

```
板块维度分 = 相对强度(60%) + 板块环境(40%)

① 相对强度（个股专属，60%）
   = clamp(50 + 10日超额 × 3 + (个股站上自身20日线 ? +8 : −8), 0, 100)
   10日超额 = 个股10日涨幅 − 板块10日涨幅

② 板块环境（板块整体，40%）
   板块趋势分（见下）压缩到窄区间：env = 45 + (趋势分 − 30) / (72 − 30) × 30  → 45~75
```

**趋势类型判定（以 MA20 为多空分界）**

| # | 条件 | 类型 |
|---|---|---|
| 1 | 站上 MA20 + MA5≥MA10 + 20日涨幅>0 +（MA20 上行 或 MA5>MA20） | `up` 上升趋势 |
| 2 | 站上 MA20 且（5日涨幅>0 或 MA20 上行 或 MA5 回升） | `bounce` 站上20日线回升 |
| 3 | 回撤 < −8% + 5日涨幅 > 2% + MA5 回升 | `bounce` 超跌反弹 |
| 4 | 前期明显下跌 + 底分型 / 连续 3 日未创新低 | `bounce` 下跌后企稳 |
| 5 | **跌破 MA20 且 20日涨幅<0 且 MA5<MA10（三者同时）** | `down` 持续下跌 |
| 6 | 其他 | `flat` 横盘震荡 |

**择时位置修正**：基准分 `up 72 / bounce 70 / flat 45 / down 30` 只作上限，正向趋势按"离反转点（20 日阶段低点）多远"衰减：

| 追高维度 | 容忍值 | 超出扣分 |
|---|---|---|
| MA20 乖离 | `sectorBiasAllow = 3%` | 每 1% 扣 3 分 |
| 距阶段低点涨幅 | `sectorRiseAllow = 6%` | 每 1% 扣 2.5 分 |
| 距阶段低点天数 | `sectorFreshDays = 6 日` | 每多 1 日扣 1.5 分 |

下限 `sectorTrendFloor(30)`（与"持续下跌"同档：都不适合当下买入）。

**板块选取规则**

- 优先「核心交易-板块」页手动设置的活跃板块，按**名称**在当前数据源解析 BK 代码（各数据源 BK 命名空间不一致，必须按名称解析）
- 未设置则取所属板块第一个；训练模式下按候选顺序探测「训练日附近仍有真实行情（±15 天）」的板块，且不使用成分股合成数据

---

## 5. 大盘维度（权重 20%）

`scoreMarket(stockKlines, baselineKlines, upRatioMap)`：按每日**上涨家数占比**判断市场温度，再结合个股与对比基准的相对表现打分，最后做时间衰减加权。

- 统计窗口：最近 `marketDays(10)` 个交易日
- 时间权重：`marketDecay(0.85) ^ 距今天数`，越近越高（半衰期约 4.3 个交易日）
- 对比基准：优先**同类市值风格板块**（微盘股/小盘股/中盘股/大盘股），缺失时回退**所属指数**（沪市→上证指数、创业板→创业板指、深市→深证成指）
- 有效天数 < `marketMinValidDays(3)` → 该维度不可用

当日得分（`d = 个股当日涨幅 − 基准当日涨幅`）：

| 市场（上涨占比） | 个股当日 | 公式 | 区间 | 文案 |
|---|---|---|---|---|
| 偏强 ≥50%（普涨） | 收跌 | `30 − min(|涨幅|,5) × 3` | 15~30 | 市场偏强但个股收跌 |
| 偏强 ≥50% | 上涨 | `50 + 10·tanh(d/2)` | 40~60 | 普涨日跑赢/弱于基准 |
| 偏弱 <50%（普跌） | **上涨** | `80 + 8·tanh(涨幅/3)` | 80~88 | 弱市上涨，超预期 |
| 偏弱 <50% | 下跌 | `35 + 12·tanh(d/2)` | 23~47 | 弱市抗跌 / 弱市补跌 |

设计意图：弱市逆势收红是短线最强的"主动做多"信号，给最高分；普涨日个股收跌说明错失机会，给最低分；其余情形看相对基准的超额收益。

---

## 6. 前置数据与接口

| 数据 | 获取方式 | 用途 |
|---|---|---|
| 个股日K（250 根） | `Services.Stock.GetKFromSetting(secid, Day, 250)` | 三个维度通用（RSI 需长历史） |
| 板块日K（60 根） | `GetKFromSetting('90.<BK代码>', Day, 60)` | 板块维度 |
| 指数日K（60 根） | `GetKFromSetting('1.000001' / '0.399006' / '0.399001', Day, 60)` | 大盘维度兜底基准 |
| 市值档活跃度 | `GetMarketActivityStatsFromTushare(最近交易日)` | 量能横向对比（换手率/成交额/中位数） |
| 涨跌比 | `GetUpRatioFromTushare(近10个交易日)` → `get_up_down_ratio_batch` | 大盘维度 |
| 个股资金流（60 日） | `GetMoneyFlowFromTushare(code, 60)` → `get_money_flow` | 资金指标 |
| 所属板块列表 | `GetStockBankuaisFromEastmoney(secid)` | 板块选取 |

数据源统一走「设置 → 数据源」的多源兜底（tushare / akshare / 东财）+ sqlite 缓存，评分侧不直接请求网页接口。

---

## 7. 训练模式（回测）

开启训练模式后（`TrainFilter.GetTrainToDate()` 非空）：

- K 线请求以训练日为终点（东财 `end=训练日`），Python 侧通过 `--as-of-date` 收敛所有"默认取最新"的接口
- 短线评分的请求缓存 key 带上训练日（`ShortTermK/<secid>/<source>/<trainDate>`），切换训练日自动重新取数
- 板块会探测「训练日附近（±15 天）仍有真实行情」的板块，避免用到训练日之后才成立/已停更的板块，且禁止用成分股合成近似值
- 结论：**评分在同一训练日下可复现**，可直接用于回测/复盘

---

## 8. 界面说明

详情页「短线评分」由 3 张卡片组成：

1. **短线综合评分**：总分 + 等级/建议 + 三维度（个股/板块/大盘）权重、分数、进度条 + 汇总（如 `个股72，板块65，大盘58`）+ 降级提示 + 数据日期
2. **大盘表现明细**：`涨跌比 + 相对<基准>表现，时间衰减加权`；折叠展开「近 10 日逐日评分明细」（日期 / 上涨占比 / 基准涨幅 / 个股涨幅 / 当日得分+文案）
3. **板块/相对强度评分**：板块短期趋势（含「位置接近反转点 / 已偏离反转点」标注）、个股相对强度（10 日超额）、板块环境分（含择时位置与下调分数）、个股与板块关系、近 10 日涨幅对比
4. **个股表现评分（量能20 + 资金60；RSI 仅计算与展示，不计入加权）**：逐项分数/满分 + 进度条 + 说明行
   - 量能：`同类市值显著活跃（5日换手率为同类2.08倍），量能放大（1.88倍）；距放量启动3日｜自启动+2.2%`
   - RSI：`RSI6: 44.4（历史分位46%），RSI24: 45.6；超卖反弹后6日线回抽24日线（接近金叉）`（该分值仅展示，不计入个股综合分）
   - 资金：`主力20日: xx｜散户20日: xx｜形态说明`

每张卡片标题旁都有「评分规则」Tooltip，规则与本文一致。

---

## 9. 批量评分（股票池）

`shortTermScoreList.computeShortTermScoreRows(items, options)`：

- 公共数据（指数K线 / 涨跌比 / 市值档统计）**只拉一次**；个股数据按 `concurrency(默认3)` 并发拉取
- 每完成一只通过 `onRow` 回调，UI 增量渲染，支持中途暂停/继续（剩余队列保留）
- 与详情页**同源逻辑**（同一批 `scoreXxx` 函数），结果列：`评分 / 评级 / 个股 / 板块 / 大盘 / RSI(x/40) / 板块趋势 / 资金 / 建议`，均支持排序

---

## 10. 配置参数总表

> 全部位于 `src/renderer/helpers/shortTermScore.ts` 的 `SHORT_TERM_SCORE_CONFIG`

| 分组 | 参数 | 默认 | 说明 |
|---|---|---|---|
| 综合 | `weights` | `{stock:0.6, sector:0.2, market:0.2}` | 三维度权重 |
| 综合 | `vetoThreshold` / `vetoCap` | 40 / 55 | 个股分低于 40 → 总分封顶 55 |
| 个股 | `stockDims` | `{volume:20, rsi:0, money:60}` | 子项权重（资金为主；RSI 为 0：只计算与展示，不计入） |
| 个股 | `stockSubMax` | `{volume:30, rsi:40, money:30}` | 子项满分（分值刻度，与权重解耦） |
| 量能 | `mvSmallBound` / `mvMidBound` | 50亿 / 200亿 | 市值分档边界 |
| 量能 | `volRatioAllow` | 2 | 横向活跃度倍数容忍（换手率口径） |
| 量能 | `volRiseAllow` | 8 | 自启动日涨幅容忍(%) |
| 量能 | `volStartRatio` / `volStartLookback` | 1.3 / 20 | 放量启动判定与回看窗口 |
| 量能 | `volFreshDays` / `volScoreFloor` | 5 / 5 | 距启动天数容忍 / 衰减下限 |
| RSI | `rsiShort` / `rsiLong` | 6 / 24 | RSI 周期 |
| RSI | `rsiOverbought` / `rsiOversold` | 80 / 30 | 绝对超买/超卖阈值 |
| RSI | `rsiOverboughtRelaxed` / `rsiOverboughtPercentile` | 72 / 0.95 | 弱势行情补充超买口径 |
| RSI | `rsiExtremeSpread` | 10 | 真实极值要求的 RSI6−RSI24 差值 |
| RSI | `rsiStateLookback` | 60 | 格局识别窗口 |
| RSI | `rsiPullbackMaxDays` | 25 | 超买后回踩的有效天数 |
| RSI | `rsiCrossFreshDays` | 3 | 金叉/死叉时效 |
| RSI | `rsiOversoldCrossDays` | 5 | 上穿前回看超卖的窗口 |
| RSI | `rsiBreakSpread` / `rsiPullbackBreakSpread` | 3 / 8 | 贴近 24 线容差 / 回踩破位阈值 |
| RSI | `rsiOverboughtPenaltyStart` | 68 | 偏多形态下 RSI6 高于该值开始按超买追高下调（偏高区） |
| RSI | `rsiOverboughtPenaltyPerPoint` | 1.5 | 偏高区每高 1 点扣分（最多扣 18 分） |
| RSI | `rsiOverboughtSteepPerPoint` | 2.5 | 进入超买区（≥80）后每高 1 点再扣的分数 |
| RSI | `rsiOverboughtFloor` | 10 | 超买追高下调后的最低分 |
| 资金 | `moneyWindow` | 20 | 主力/散户累计窗口 |
| 资金 | `moneyShapeDays` | 30 | 形态识别窗口 |
| 资金 | `moneyCrossRecentDays` / `moneyCrossDecay` | 5 / 0.8 | 交叉检测窗口 / 时效衰减 |
| 资金 | `moneyHighPosThreshold` | 0.72 | 主力线在近 30 日区间的位置 ≥ 该值 → 视为"已在趋势中后段"，不给高分 |
| 板块 | `sectorDays` / `sectorCompareDays` | 20 / 10 | 趋势窗口 / 超额对比窗口 |
| 板块 | `sectorNoNewLowDays` | 3 | 企稳判定天数 |
| 板块 | `sectorBiasAllow` / `sectorRiseAllow` / `sectorFreshDays` | 3 / 6 / 6 | 三个追高维度容忍值 |
| 板块 | `sectorTrendFloor` | 30 | 衰减下限 |
| 板块 | `sectorRelWeight` / `sectorRelBase` / `sectorRelPerPct` / `sectorStockAboveBonus` | 0.6 / 50 / 3 / 8 | 相对强度构成 |
| 板块 | `sectorEnvBase` / `sectorEnvSpan` | 45 / 30 | 环境分区间（45~75） |
| 大盘 | `marketDays` / `marketUpRatioThreshold` | 10 / 0.5 | 统计窗口 / 强弱分界 |
| 大盘 | `marketDecay` / `marketMinValidDays` | 0.85 / 3 | 时间衰减 / 最少有效天数 |

---

## 11. 常见调参场景

| 诉求 | 调整 |
|---|---|
| 想让 RSI 影响更大 | 提高 `stockDims.rsi`（如 45），其余子项按权重自动归一化 |
| 资金更主导 / 更弱 | 调整 `stockDims.money` 与 `stockDims.volume`（如 80/0、40/40），子项满分（`stockSubMax`）不用动 |
| 想更严格地只抓「转折点」 | 下调 `moneyHighPosThreshold`（如 0.6，更早判定"已在高位"），或减小 `moneyCrossRecentDays`（金叉更短时效） |
| 超买追高惩罚太轻/太重 | 调 `rsiOverboughtPenaltyStart`（起始点，越小越早扣）、`rsiOverboughtPenaltyPerPoint`（偏高区斜率）、`rsiOverboughtSteepPerPoint`（超买区斜率）、`rsiOverboughtFloor`（下限） |
| 想让板块影响更小 | 降低 `weights.sector`，或提高 `sectorRelWeight`（更看重个股相对强度） |
| 板块"追高"惩罚太狠 | 放宽 `sectorRiseAllow` / `sectorBiasAllow` / `sectorFreshDays`，或下调对应扣分系数 |
| 金叉信号太稀有/太频繁 | 调 `rsiCrossFreshDays`（交叉时效）与 `rsiOversoldCrossDays`（超卖回看窗口） |
| 量能对"刚放量"不够敏感 | 下调 `volStartRatio`，或放宽 `volFreshDays` |
| 大盘维度太敏感 | 提高 `marketMinValidDays`、调小 `marketDecay`（更平滑） |

---

## 12. 注意事项

- 所有评分函数均为**纯计算**：输入 K 线与统计数据结构，输出评分结果，便于单测与回测复用
- 维度数据不足时不会"给 0 分"拉低总分，而是**剔除该维度并按剩余权重归一化**，同时输出 `degraded` 原因
- 换手率（`KLineItem.hsl`）缺失时会自动回退成交额口径，并在文案中标注，避免因数据源差异导致评分异常
- 评分是**规则化的相对强度/择时排序工具**，用于缩小关注范围与比较候选，不构成投资建议
