/**
 * 训练账户（模拟持仓）计算
 *
 * 训练账户是「所有标的共享」的一个组合账户：资金共享、各标的独立持仓。
 * 买卖记录就存在 `stockConfigsMapping[secid].buyPoints / sellPoints` 里（t='train'），
 * 这里按日期回放这些记录，得到截至某个训练日的可用资金、已实现盈亏与持仓。
 *
 * 口径与个股详情页训练工具栏（TrainBar 的 sharedAccount）完全一致：
 * - 买入按记录里的成交价成交：成交价是 ScoreStockTrade 下单那一刻的盘中分时价（trendPrice，
 *   集合竞价 / 无分时退回训练日收盘价），**不是**当日收盘价；预算取「指定金额」与「共享可用资金」的较小值；
 * - 卖出：带 shares 的点是按仓位部分减仓（按比例结转成本、只回款对应股数），
 *   不带 shares 的旧口径点是一次清仓；两种都扣佣金后回款，按卖出部分计入已实现盈亏；
 * - 同日多笔按「先卖后买」排序（A股卖出回款当日即可用于买入），这一排序同时隐式实现了 T+1：
 *   当日买入的股数排在同日卖出之后，卖出时点只有前一日及更早的可卖持仓，「当日买、当日卖」天然不成立，
 *   与 ScoreStockTrade 界面上的 boughtToday（当日买入不可卖）约束同构。
 */

import { Stock } from '@/types/stock';
import { BuildAttribution } from './trainSettle';

/** 训练模式买卖点标记（与 actions/train 的 TRAIN_TYPE 一致；这里独立定义，避免 helpers 反向依赖 actions） */
const TRAIN_MARK = 'train';

/** 一手股数 */
export const TRAIN_MIN_LOT = 100;
/** 初始资金缺省值（与训练工具栏一致） */
export const TRAIN_DEFAULT_CAPITAL = 100000;
/** 佣金缺省值（与训练工具栏一致） */
export const TRAIN_DEFAULT_COMMISSION = 0.0003;

/** 是否训练模式的买卖点 */
export const IsTrainMark = (t: any): boolean => t === TRAIN_MARK || t === true;

/** 训练账户中的一笔成交 */
export interface TrainAccountTrade {
  secid: string;
  name?: string;
  /** 交易日（YYYY-MM-DD） */
  date: string;
  /** 成交价（当日收盘价） */
  price: number;
  isBuy: boolean;
  /** 买入金额上限（不传=全部可用资金） */
  amount?: number;
  /** 卖出股数（仅部分减仓点有；不传=一次清仓） */
  shares?: number;
}

/** 训练账户中的一只持仓 */
export interface TrainAccountPosition {
  secid: string;
  name: string;
  shares: number;
  /** 持仓成本（含买入佣金） */
  costAmount: number;
  /** 持仓成本价 */
  costPrice: number;
  /** 最近一次买入日 */
  lastBuyDate: string;
}

/** 训练账户回放结果 */
export interface TrainAccountResult {
  /** 可用资金 */
  cash: number;
  /** 已实现盈亏 */
  realized: number;
  /** 当前仍持有的标的（股数 > 0，按市值排序由调用方决定） */
  positions: TrainAccountPosition[];
}

/**
 * 从个股配置里收集训练买卖点
 * @param configs 全部个股配置（`Object.values(stockConfigsMapping)`）
 * @param startDate 训练开始日（含）；为空表示不限
 * @param currentDay 训练当前日（含）；为空表示不限
 */
export function CollectTrainTrades(
  configs: Stock.SettingItem[],
  startDate = '',
  currentDay = ''
): TrainAccountTrade[] {
  const trades: TrainAccountTrade[] = [];
  (configs || []).forEach((c) => {
    if (!c || !c.secid) {
      return;
    }
    const name = c.name || c.secid;
    ((c.buyPoints || []) as any[])
      .filter((t) => IsTrainMark(t.t))
      .forEach((t) =>
        trades.push({
          secid: c.secid,
          name,
          date: String(t.x).substring(0, 10),
          price: Number(t.y) || 0,
          isBuy: true,
          amount: t.a,
        })
      );
    ((c.sellPoints || []) as any[])
      .filter((t) => IsTrainMark(t.t))
      .forEach((t) =>
        trades.push({
          secid: c.secid,
          name,
          date: String(t.x).substring(0, 10),
          price: Number(t.y) || 0,
          isBuy: false,
          shares: Number(t.shares) > 0 ? Number(t.shares) : undefined,
        })
      );
  });
  return trades
    .filter((t) => (!startDate || t.date >= startDate) && (!currentDay || t.date <= currentDay))
    .sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : a.isBuy === b.isBuy ? 0 : a.isBuy ? 1 : -1));
}

/** 按训练日回放买卖点，得到共享账户的可用资金、已实现盈亏与持仓 */
export function ComputeTrainAccount(params: {
  configs: Stock.SettingItem[];
  startDate?: string;
  currentDay?: string;
  initialCapital?: number;
  commissionRate?: number;
}): TrainAccountResult {
  const { configs, startDate = '', currentDay = '' } = params;
  const rawCapital = Number(params.initialCapital);
  const capital = rawCapital > 0 ? rawCapital : TRAIN_DEFAULT_CAPITAL;
  const rawCommission = Number(params.commissionRate);
  const commission = Number.isFinite(rawCommission) && rawCommission >= 0 ? rawCommission : TRAIN_DEFAULT_COMMISSION;

  const trades = CollectTrainTrades(configs, startDate, currentDay);
  const holdings: Record<string, TrainAccountPosition> = {};
  let cash = capital;
  let realized = 0;

  trades.forEach((t) => {
    const price = Number(t.price);
    if (!price || price <= 0) {
      return;
    }
    const h = holdings[t.secid] || {
      secid: t.secid,
      name: t.name || t.secid,
      shares: 0,
      costAmount: 0,
      costPrice: 0,
      lastBuyDate: '',
    };
    if (t.isBuy) {
      // 指定金额买入：预算取「指定金额」与「共享可用资金」的较小值，未指定则用全部可用资金
      const budget = t.amount && t.amount > 0 ? Math.min(cash, t.amount) : cash;
      const lots = Math.floor(budget / (price * TRAIN_MIN_LOT * (1 + commission)));
      if (lots < 1) {
        // 资金不足一手：该笔买入不成立（与训练工具栏的展示口径一致）
        return;
      }
      const count = lots * TRAIN_MIN_LOT;
      const amount = price * count;
      const fee = amount * commission;
      cash -= amount + fee;
      holdings[t.secid] = {
        ...h,
        shares: h.shares + count,
        costAmount: h.costAmount + amount + fee,
        lastBuyDate: t.date,
      };
    } else if (h.shares > 0) {
      // 带 shares 的点按仓位减仓：只回款对应股数、按比例结转成本；
      // 不带的旧口径点仍是一次清仓，保持历史记录与详情页训练工具栏的行为不变。
      const sold = t.shares && t.shares > 0 ? Math.min(h.shares, t.shares) : h.shares;
      const amount = price * sold;
      const fee = amount * commission;
      const costPart = h.costAmount * (sold / h.shares);
      const left = h.shares - sold;
      cash += amount - fee;
      realized += amount - fee - costPart;
      holdings[t.secid] = {
        ...h,
        shares: left,
        costAmount: left > 0 ? h.costAmount - costPart : 0,
      };
    }
  });

  const positions = Object.values(holdings)
    .filter((h) => h.shares > 0)
    .map((h) => ({ ...h, costPrice: h.costAmount / h.shares }));
  return { cash, realized, positions };
}

/**
 * 构建「一轮交易」的归档记录（清仓时调用）
 *
 * 与整体结算不同：这里只归档单只股票本轮（上次清仓之后 → 本次清仓）的完整交易，
 * 包含本轮全部买入明细。本轮途中的按仓位减仓（sellPoints 带 shares）也会并入本轮：
 * 股数、卖出回款与结转成本一起计入，避免清仓记录少算已落袋的收益。
 *
 * @param params.shares 本次清仓股数（训练账户回放的剩余持仓）
 * @param params.costAmount 剩余持仓成本（含买入佣金）
 * @param params.buyPoints / sellPoints 该股全部训练买卖点，用于还原本轮起点、减仓明细与买入明细
 * @param params.tradingDays 可选：训练窗口交易日列表，用于把持有天数换算成交易日数
 */
export function BuildStockTradeRecord(params: {
  secid: string;
  name?: string;
  sellDate: string;
  /** 清仓时间 HH:mm[:ss]（训练模式为训练时钟） */
  sellTime?: string;
  sellPrice: number;
  shares: number;
  costAmount: number;
  commissionRate?: number;
  reason?: string;
  trainStartDate?: string;
  buyPoints?: any[];
  sellPoints?: any[];
  tradingDays?: string[];
}): Train.StockTradeRecord | null {
  const secid = params.secid;
  const sellPrice = Number(params.sellPrice) || 0;
  const shares = Number(params.shares) || 0;
  const costAmount = Number(params.costAmount) || 0;
  if (!secid || sellPrice <= 0 || shares <= 0 || costAmount <= 0) {
    return null;
  }
  const sellDate = String(params.sellDate || '').substring(0, 10);
  if (!sellDate) {
    return null;
  }
  const trainStartDate = String(params.trainStartDate || '').substring(0, 10);
  const dayOf = (p: any) => String(p?.x ?? p?.date ?? '').substring(0, 10);

  // 本轮起点：上一次「清仓」日之后；带 shares 的卖点是部分减仓，不构成一轮结束
  const prevSellDate = (params.sellPoints || [])
    .filter((p) => IsTrainMark(p?.t) && !(Number(p?.shares) > 0))
    .map(dayOf)
    .filter((d) => d && d < sellDate)
    .sort()
    .pop();

  const buys = (params.buyPoints || [])
    .filter((p) => IsTrainMark(p?.t) && Number(p?.y) > 0)
    .map((p) => ({
      date: dayOf(p),
      time: p?.time ? String(p.time) : undefined,
      price: Number(p.y),
      amount: p.a != null ? Number(p.a) : undefined,
      reason: p?.reason ? String(p.reason) : undefined,
    }))
    .filter((b) => !!b.date && b.date <= sellDate)
    .filter((b) => (!trainStartDate || b.date >= trainStartDate) && (!prevSellDate || b.date > prevSellDate))
    .sort((a, b) => {
      if (a.date !== b.date) {
        return a.date > b.date ? 1 : -1;
      }
      return String(a.time || '').localeCompare(String(b.time || ''));
    });

  const buyDate = buys[0]?.date || sellDate;
  const buyTime = buys[0]?.time || '';
  const sellTime = params.sellTime ? String(params.sellTime) : '';
  const rawRate = Number(params.commissionRate);
  const rate = Number.isFinite(rawRate) && rawRate >= 0 ? rawRate : TRAIN_DEFAULT_COMMISSION;
  // 本轮此前的部分减仓并入这一轮往返：否则清仓记录会丢掉已落袋的那部分股数与收益
  const partials = (params.sellPoints || []).filter(
    (p) =>
      IsTrainMark(p?.t) &&
      Number(p?.shares) > 0 &&
      dayOf(p) <= sellDate &&
      (!prevSellDate || dayOf(p) > prevSellDate)
  );
  const partialShares = partials.reduce((s, p) => s + (Number(p.shares) || 0), 0);
  const partialCost = partials.reduce((s, p) => s + (Number(p.cost) || 0), 0);
  const partialGross = partials.reduce(
    (s, p) => s + (Number(p.y) || 0) * (Number(p.shares) || 0),
    0
  );
  const totalShares = shares + partialShares;
  const totalCost = costAmount + partialCost;
  const amount = sellPrice * shares + partialGross;
  const fee = amount * rate;
  const profit = amount - fee - totalCost;
  const profitRatio = totalCost > 0 ? (profit / totalCost) * 100 : 0;

  let holdDays = 0;
  const tradingDays = params.tradingDays || [];
  if (tradingDays.length) {
    holdDays = tradingDays.filter((d) => d > buyDate && d <= sellDate).length;
  } else {
    const from = Date.parse(buyDate);
    const to = Date.parse(sellDate);
    holdDays = Number.isFinite(from) && Number.isFinite(to) ? Math.max(0, Math.round((to - from) / 86400000)) : 0;
  }

  return {
    id: `${secid}_${sellDate}_${Date.now()}`,
    secid,
    name: params.name || secid,
    buyDate,
    buyTime,
    buyPrice: totalCost / totalShares,
    sellDate,
    sellTime,
    sellPrice,
    count: totalShares,
    amount,
    commission: fee,
    profit,
    profitRatio,
    holdDays,
    reason: (params.reason || '').trim(),
    buys,
    trainStartDate,
    createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
  };
}

/**
 * 由训练记录（逐股清仓归档）汇总出归因分析（个股 / 持仓周期 / 月度）
 *
 * 每条 StockTradeRecord 本身就是一轮「建仓 → 清仓」的往返，字段与归因所需的
 * RoundTrip 一一对应，这里逐条映射后复用 BuildAttribution 的聚合逻辑。
 *
 * 与整体结算的归因不同：这里是「按单股票逐次清仓」的记录集合，
 * 个股维度 = 各标的累计盈亏贡献，持仓周期 / 月度维度 = 所有记录的分布。
 */
export function BuildStockAttribution(records: Train.StockTradeRecord[]): Train.Attribution {
  return BuildAttribution(
    (records || []).map((r) => ({
      secid: r.secid,
      name: r.name,
      buyDate: r.buyDate,
      sellDate: r.sellDate,
      buyPrice: Number(r.buyPrice) || 0,
      sellPrice: Number(r.sellPrice) || 0,
      count: Number(r.count) || 0,
      profit: Number(r.profit) || 0,
      profitRatio: Number(r.profitRatio) || 0,
      holdDays: Number(r.holdDays) || 0,
    }))
  );
}

/**
 * 某训练日的收盘价：当天有行情就用当天，否则退回最近一个不晚于该日的收盘价
 * @param closes 交易日 -> 收盘价
 * @param day 训练日（YYYY-MM-DD）
 */
export function LastCloseOnOrBefore(
  closes: Record<string, number> | undefined,
  day = ''
): { day: string; close: number } {
  const map = closes || {};
  if (day && Number(map[day]) > 0) {
    return { day, close: Number(map[day]) };
  }
  const dates = Object.keys(map)
    .filter((d) => (!day || d <= day) && Number(map[d]) > 0)
    .sort();
  const last = dates[dates.length - 1] || '';
  return { day: last, close: last ? Number(map[last]) : 0 };
}
