/**
 * 训练模式结算
 *
 * 依据训练窗口内的交易日、各标的每日收盘价与模拟买卖记录，按「成交价成交 + 按比例收佣金」的方式
 * 复盘整个训练过程，计算总收益率 / 年化收益率 / 最大回撤 / 夏普比率 / 胜率 / 盈亏比，
 * 并输出收益率曲线（dailyValues）与持仓变化明细（trades）。
 *
 * 成交价由买卖记录自带：买入与卖出均为 ScoreStockTrade 下单那一刻的盘中分时价（trendPrice，
 * 集合竞价 / 无分时退回训练日收盘价），**不是**当日收盘价；
 * 各标的每日收盘价同时用于逐日估值（dailyValues）。
 *
 * 训练账户是「所有标的共享」的一个组合账户（见 TrainBar 的 sharedAccount），
 * 因此结算按组合回放：现金共享、各标的独立持仓、逐日按各标的收盘价估值，
 * 与训练过程中界面上的可用资金/持仓/盈亏口径完全一致。
 */

const MIN_LOT = 100;
const DEFAULT_CAPITAL = 100000;
const TRADE_DAYS_OF_YEAR = 252;

export interface SettleTrade {
  date: string;
  price: number;
  isBuy: boolean;
  /** 买入金额上限（模拟训练指定金额/资金比例买入）；不传表示全部可用资金 */
  amount?: number;
  /** 标的代码（组合结算按标的分别持仓；单标的结算可省略） */
  secid?: string;
  /** 标的名称（仅用于展示） */
  name?: string;
}

export interface SettleParams {
  startDate: string;
  endDate: string;
  initialCapital: number;
  commissionRate: number;
  /** 训练窗口内的交易日（升序） */
  days: string[];
  /** 交易日 → 收盘价（单标的结算时使用） */
  dayCloses?: Record<string, number>;
  /** 标的 →（交易日 → 收盘价）：组合结算逐日估值用 */
  dayClosesBySecid?: Record<string, Record<string, number>>;
  trades: SettleTrade[];
}

export function SettleTrain({
  startDate,
  endDate,
  initialCapital,
  commissionRate,
  days,
  dayCloses,
  dayClosesBySecid,
  trades,
}: SettleParams): Train.Settlement {
  const capital = initialCapital > 0 ? initialCapital : DEFAULT_CAPITAL;
  const rate = commissionRate > 0 ? commissionRate : 0;
  // 结算交易日固定按升序回放（收益率曲线/回撤依赖时间顺序）
  const sessionDays = (days || []).filter((d) => d >= startDate && d <= endDate).sort();
  // 按日期排序；同日先卖后买（A股卖出回款当日即可用于买入），同时隐式实现 T+1：
  // 当日买入排在同日卖出之后，卖出时点只有前一日及更早的可卖持仓，「当日买、当日卖」天然不成立，
  // 与 ScoreStockTrade 界面上的 boughtToday 约束同构。
  const sortedTrades = (trades || [])
    .slice()
    .sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : a.isBuy === b.isBuy ? 0 : a.isBuy ? 1 : -1));

  let cash = capital;
  /** 各标的持仓：标的 -> 股数 / 成本（含买入佣金）/ 首次买入日 */
  const positions: Record<string, { shares: number; costAmount: number; firstBuyDate: string }> = {};
  /** 各标的最近一次有效收盘价：当日无行情（停牌 / 数据缺失）时按它估值 */
  const lastCloses: Record<string, number> = {};
  let cursor = 0;
  const logs: Train.TradeLog[] = [];
  const dailyValues: Train.DailyValue[] = [];
  /** 完整往返（建仓 → 清仓）明细，用于归因分析 */
  const roundTrips: Train.RoundTrip[] = [];
  /** 交易日 -> 索引（用于计算持仓交易日数） */
  const dayIndex = new Map<string, number>();
  sessionDays.forEach((d, i) => dayIndex.set(d, i));

  /** 某标的在某交易日的收盘价：取不到时退回该标的最近一次有效收盘价，再退回持仓成本价 */
  const closeOf = (sid: string, day: string, costPrice: number): number => {
    const close = Number(dayClosesBySecid?.[sid]?.[day] ?? dayCloses?.[day]) || 0;
    if (close > 0) {
      lastCloses[sid] = close;
      return close;
    }
    return lastCloses[sid] || costPrice || 0;
  };

  sessionDays.forEach((day) => {
    // 处理当日（含之前未处理）的委托：按记录里的成交价（当日收盘价）成交
    while (cursor < sortedTrades.length && sortedTrades[cursor].date <= day) {
      const trade = sortedTrades[cursor];
      cursor += 1;
      const price = Number(trade.price);
      if (!price || price <= 0) {
        continue;
      }
      const sid = trade.secid || '';
      const pos = positions[sid] || { shares: 0, costAmount: 0, firstBuyDate: '' };
      if (trade.isBuy) {
        // 指定金额买入：预算取「指定金额」与「共享可用资金」的较小值
        const budget = trade.amount && trade.amount > 0 ? Math.min(cash, trade.amount) : cash;
        const lots = Math.floor(budget / (price * MIN_LOT * (1 + rate)));
        if (lots < 1) {
          continue;
        }
        const count = lots * MIN_LOT;
        const amount = price * count;
        const commission = amount * rate;
        cash = cash - amount - commission;
        const next = {
          shares: pos.shares + count,
          costAmount: pos.costAmount + amount + commission,
          firstBuyDate: pos.shares > 0 ? pos.firstBuyDate : day,
        };
        positions[sid] = next;
        logs.push({
          date: day,
          type: 'buy',
          price,
          count,
          amount,
          commission,
          cash,
          shares: next.shares,
          costPrice: next.costAmount / next.shares,
          profit: 0,
          profitRatio: 0,
          secid: trade.secid,
          name: trade.name,
        });
      } else if (pos.shares > 0) {
        const count = pos.shares;
        const amount = price * count;
        const commission = amount * rate;
        const proceeds = amount - commission;
        const cost = pos.costAmount;
        const profit = proceeds - cost;
        const profitRatio = cost > 0 ? Number(((profit / cost) * 100).toFixed(4)) : 0;
        cash += proceeds;
        // 记录一笔完整往返（建仓 → 清仓），归因分析用
        const buyIdx = dayIndex.get(pos.firstBuyDate);
        const sellIdx = dayIndex.get(day);
        roundTrips.push({
          secid: trade.secid || '',
          name: trade.name,
          buyDate: pos.firstBuyDate || day,
          sellDate: day,
          buyPrice: count > 0 ? pos.costAmount / count : price,
          sellPrice: price,
          count,
          profit,
          profitRatio,
          holdDays: buyIdx !== undefined && sellIdx !== undefined ? Math.max(0, sellIdx - buyIdx) : 0,
        });
        positions[sid] = { shares: 0, costAmount: 0, firstBuyDate: '' };
        logs.push({
          date: day,
          type: 'sell',
          price,
          count,
          amount,
          commission,
          cash,
          shares: 0,
          costPrice: 0,
          profit,
          profitRatio,
          secid: trade.secid,
          name: trade.name,
        });
      }
    }

    // 逐日估值：现金 + 各标的持仓市值（不同标的按各自当日收盘价计价）
    let marketValue = 0;
    let totalShares = 0;
    Object.keys(positions).forEach((sid) => {
      const pos = positions[sid];
      if (pos.shares <= 0) {
        return;
      }
      const costPrice = pos.costAmount / pos.shares;
      marketValue += pos.shares * closeOf(sid, day, costPrice);
      totalShares += pos.shares;
    });
    const totalValue = cash + marketValue;
    dailyValues.push({
      date: day,
      totalValue,
      cash,
      shares: totalShares,
      close: 0,
      returnRate: capital > 0 ? Number((((totalValue - capital) / capital) * 100).toFixed(4)) : 0,
    });
  });

  const finalValue = dailyValues.length ? dailyValues[dailyValues.length - 1].totalValue : capital;
  const totalReturn = capital > 0 ? (finalValue - capital) / capital : 0;
  const dayCount = dailyValues.length;
  const annualizedReturn = dayCount > 0 ? Math.pow(1 + totalReturn, TRADE_DAYS_OF_YEAR / dayCount) - 1 : 0;

  // 最大回撤
  let maxDrawdown = 0;
  let peak = capital;
  dailyValues.forEach((dv) => {
    if (dv.totalValue > peak) {
      peak = dv.totalValue;
    }
    const dd = peak > 0 ? (peak - dv.totalValue) / peak : 0;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
    }
  });

  // 夏普比率（无风险利率按 0 计算，日收益年化）
  let sharpeRatio = 0;
  if (dailyValues.length > 1) {
    const returns: number[] = [];
    for (let i = 1; i < dailyValues.length; i++) {
      const prev = dailyValues[i - 1].totalValue;
      returns.push(prev > 0 ? (dailyValues[i].totalValue - prev) / prev : 0);
    }
    const avg = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - avg) ** 2, 0) / returns.length;
    const std = Math.sqrt(variance);
    sharpeRatio = std > 0 ? (avg / std) * Math.sqrt(TRADE_DAYS_OF_YEAR) : 0;
  }

  const closedTrades = logs.filter((l) => l.type === 'sell');
  const winCount = closedTrades.filter((l) => l.profit > 0).length;
  const loseCount = closedTrades.filter((l) => l.profit <= 0).length;
  const winRate = closedTrades.length ? winCount / closedTrades.length : 0;
  const totalProfit = closedTrades.filter((l) => l.profit > 0).reduce((s, l) => s + l.profit, 0);
  const totalLoss = Math.abs(closedTrades.filter((l) => l.profit <= 0).reduce((s, l) => s + l.profit, 0));
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Number.POSITIVE_INFINITY : 0;

  return {
    startDate,
    endDate: dailyValues.length ? dailyValues[dailyValues.length - 1].date : endDate,
    initialCapital: capital,
    commissionRate: rate,
    finalValue,
    totalReturn,
    annualizedReturn,
    maxDrawdown,
    sharpeRatio,
    winRate,
    profitFactor,
    tradeCount: logs.length,
    winCount,
    loseCount,
    dailyValues,
    trades: logs,
    attribution: BuildAttribution(roundTrips),
  };
}

/** 持仓周期分桶（交易日数；T+1 下最短为 1 日） */
const HOLDING_BUCKETS: { label: string; minDays: number; maxDays: number }[] = [
  { label: '1日（T+1）', minDays: 1, maxDays: 1 },
  { label: '2~3日', minDays: 2, maxDays: 3 },
  { label: '4~5日', minDays: 4, maxDays: 5 },
  { label: '6~10日', minDays: 6, maxDays: 10 },
  { label: '11~20日', minDays: 11, maxDays: 20 },
  { label: '20日以上', minDays: 21, maxDays: Number.POSITIVE_INFINITY },
];

/**
 * 由往返明细汇总出归因分析（个股 / 持仓周期 / 月度）
 *
 * - 个股归因：按标的聚合往返，盈亏占比 = 个股已实现盈亏 / 全部已实现盈亏（带符号）；
 * - 持仓周期归因：按持仓交易日数分桶，胜率与平均收益率用于识别「拿太短 / 拿太久」；
 * - 月度归因：按卖出月份聚合，看盈亏在时间上的分布。
 */
export function BuildAttribution(roundTrips: Train.RoundTrip[]): Train.Attribution {
  const byStockMap: Record<string, Train.StockAttribution> = {};
  const byMonthMap: Record<string, Train.MonthAttribution> = {};
  const byHolding: Train.HoldingAttribution[] = HOLDING_BUCKETS.map((b) => ({
    label: b.label,
    minDays: b.minDays,
    maxDays: b.maxDays,
    count: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    profit: 0,
    avgReturn: 0,
  }));

  (roundTrips || []).forEach((rt) => {
    const secid = rt.secid || '';
    const stock = byStockMap[secid] || {
      secid,
      name: rt.name,
      roundTrips: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      profit: 0,
      contribution: 0,
    };
    stock.roundTrips += 1;
    stock.profit += rt.profit;
    if (rt.profit > 0) {
      stock.wins += 1;
    } else {
      stock.losses += 1;
    }
    byStockMap[secid] = stock;

    const month = (rt.sellDate || '').substring(0, 7);
    const m = byMonthMap[month] || { month, count: 0, wins: 0, losses: 0, winRate: 0, profit: 0 };
    m.count += 1;
    m.profit += rt.profit;
    if (rt.profit > 0) {
      m.wins += 1;
    } else {
      m.losses += 1;
    }
    byMonthMap[month] = m;

    const bucket = byHolding.find((b) => rt.holdDays >= b.minDays && rt.holdDays <= b.maxDays);
    if (bucket) {
      bucket.count += 1;
      bucket.profit += rt.profit;
      bucket.avgReturn += rt.profitRatio;
      if (rt.profit > 0) {
        bucket.wins += 1;
      } else {
        bucket.losses += 1;
      }
    }
  });

  const byStock = Object.values(byStockMap);
  const totalRealized = byStock.reduce((s, x) => s + x.profit, 0);
  byStock.forEach((s) => {
    s.winRate = s.roundTrips ? s.wins / s.roundTrips : 0;
    s.contribution = totalRealized !== 0 ? s.profit / totalRealized : 0;
  });
  byStock.sort((a, b) => b.profit - a.profit);

  byHolding.forEach((b) => {
    b.winRate = b.count ? b.wins / b.count : 0;
    b.avgReturn = b.count ? b.avgReturn / b.count : 0;
  });

  const byMonth = Object.values(byMonthMap).sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

  return { roundTrips: roundTrips || [], byStock, byHolding, byMonth };
}
