/**
 * 训练模式结算
 *
 * 依据训练窗口内的交易日、每日收盘价与模拟买卖记录，按「成交价成交 + 按比例收佣金」的方式
 * 复盘整个训练过程，计算总收益率 / 年化收益率 / 最大回撤 / 夏普比率 / 胜率 / 盈亏比，
 * 并输出收益率曲线（dailyValues）与持仓变化明细（trades）。
 *
 * 成交价由买卖记录自带：买入为「下一个交易日开盘价」（TrainBar 记录）、卖出为「卖出当日收盘价」；
 * 每日收盘价只用于逐日估值（dailyValues）。
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
}

export interface SettleParams {
  startDate: string;
  endDate: string;
  initialCapital: number;
  commissionRate: number;
  /** 训练窗口内的交易日（升序） */
  days: string[];
  /** 交易日 → 收盘价 */
  dayCloses: Record<string, number>;
  trades: SettleTrade[];
}

export function SettleTrain({ startDate, endDate, initialCapital, commissionRate, days, dayCloses, trades }: SettleParams): Train.Settlement {
  const capital = initialCapital > 0 ? initialCapital : DEFAULT_CAPITAL;
  const rate = commissionRate > 0 ? commissionRate : 0;
  const sessionDays = (days || []).filter((d) => d >= startDate && d <= endDate);
  const sortedTrades = (trades || []).slice().sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));

  let cash = capital;
  let shares = 0;
  let costAmount = 0; // 持仓总成本（含买入佣金）
  let lastClose = 0;
  let cursor = 0;
  const logs: Train.TradeLog[] = [];
  const dailyValues: Train.DailyValue[] = [];

  const pushDay = (date: string) => {
    const close = dayCloses[date] || lastClose || (shares > 0 ? costAmount / shares : 0);
    if (close > 0) {
      lastClose = close;
    }
    const totalValue = cash + shares * close;
    dailyValues.push({
      date,
      totalValue,
      cash,
      shares,
      close,
      returnRate: capital > 0 ? Number((((totalValue - capital) / capital) * 100).toFixed(4)) : 0,
    });
  };

  sessionDays.forEach((day) => {
    // 处理当日（含之前未处理）的委托：按收盘价成交
    while (cursor < sortedTrades.length && sortedTrades[cursor].date <= day) {
      const trade = sortedTrades[cursor];
      cursor += 1;
      const price = Number(trade.price);
      if (!price || price <= 0) {
        continue;
      }
      if (trade.isBuy) {
        // 指定金额买入：预算取「指定金额」与「可用资金」的较小值
        const budget = trade.amount && trade.amount > 0 ? Math.min(cash, trade.amount) : cash;
        const lots = Math.floor(budget / (price * MIN_LOT * (1 + rate)));
        if (lots < 1) {
          continue;
        }
        const count = lots * MIN_LOT;
        const amount = price * count;
        const commission = amount * rate;
        cash = cash - amount - commission;
        shares += count;
        costAmount += amount + commission;
        logs.push({
          date: day,
          type: 'buy',
          price,
          count,
          amount,
          commission,
          cash,
          shares,
          costPrice: costAmount / shares,
          profit: 0,
          profitRatio: 0,
        });
      } else if (shares > 0) {
        const count = shares;
        const amount = price * count;
        const commission = amount * rate;
        const proceeds = amount - commission;
        const cost = costAmount;
        const profit = proceeds - cost;
        cash += proceeds;
        shares = 0;
        costAmount = 0;
        logs.push({
          date: day,
          type: 'sell',
          price,
          count,
          amount,
          commission,
          cash,
          shares,
          costPrice: 0,
          profit,
          profitRatio: cost > 0 ? Number(((profit / cost) * 100).toFixed(4)) : 0,
        });
      }
    }
    pushDay(day);
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
  };
}
