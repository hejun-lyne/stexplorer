/**
 * 训练账户（模拟持仓）计算
 *
 * 训练账户是「所有标的共享」的一个组合账户：资金共享、各标的独立持仓。
 * 买卖记录就存在 `stockConfigsMapping[secid].buyPoints / sellPoints` 里（t='train'），
 * 这里按日期回放这些记录，得到截至某个训练日的可用资金、已实现盈亏与持仓。
 *
 * 口径与个股详情页训练工具栏（TrainBar 的 sharedAccount）完全一致：
 * - 买入按记录里的成交价（当日收盘价）成交，预算取「指定金额」与「共享可用资金」的较小值；
 * - 卖出为一次清仓，扣除佣金后回款，计入已实现盈亏；
 * - 同日多笔按「先卖后买」排序（A股卖出回款当日即可用于买入）。
 */

import { Stock } from '@/types/stock';

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
      const amount = price * h.shares;
      const fee = amount * commission;
      cash += amount - fee;
      realized += amount - fee - h.costAmount;
      holdings[t.secid] = { ...h, shares: 0, costAmount: 0 };
    }
  });

  const positions = Object.values(holdings)
    .filter((h) => h.shares > 0)
    .map((h) => ({ ...h, costPrice: h.costAmount / h.shares }));
  return { cash, realized, positions };
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
