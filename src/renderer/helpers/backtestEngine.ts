import { Stock } from '@/types/stock';
import { calculateMACD } from '@/helpers/tech';
import * as Indicators from '@/helpers/tech';
import dayjs from 'dayjs';

// ===== 均线回踩买入策略参数优化 =====
export interface MABacktestTrade {
  buyIndex: number;
  sellIndex: number;
  returnPct: number;
  maxDrawdownPct: number;
  // 止损相关
  stopLossPrice: number;
  exitReason: 'take_profit' | 'stop_loss_fixed' | 'stop_loss_trailing' | 'stop_loss_ma' | 'hold_end';
}

export interface MABacktestResult {
  maPeriod: number;
  holdDays: number;
  trendDays: number;
  threshold: number;
  totalReturn: number;
  winRate: number;
  tradeCount: number;
  avgReturn: number;
  maxDrawdown: number;
  profitFactor: number;
  score: number;
  trades: MABacktestTrade[];
  // 止损参数
  fixedStopLossPct: number;
  trailingStopLossPct: number;
  maStopLossPct: number;
}

// ===== MACD 策略参数优化回测 =====
export interface MACDTrade {
  buyIndex: number;
  sellIndex: number;
  returnPct: number;
  maxDrawdownPct: number;
  holdDays: number;
  // 止损相关
  stopLossPrice: number;
  exitReason: 'macd_exit' | 'stop_loss_fixed' | 'stop_loss_trailing' | 'hist_shrink';
}

export interface MACDStrategyResult {
  fast: number;
  slow: number;
  signal: number;
  requireAboveZero: boolean;
  requirePriorNegative: boolean;
  trades: MACDTrade[];
  totalReturn: number;
  winRate: number;
  tradeCount: number;
  avgReturn: number;
  avgHoldDays: number;
  maxDrawdown: number;
  profitFactor: number;
  score: number;
  // 止损参数
  fixedStopLossPct: number;
  trailingStopLossPct: number;
}

// ===== RSI 策略参数优化回测 =====
export interface RSIBacktestTrade {
  buyIndex: number;
  sellIndex: number;
  buyPrice: number;
  sellPrice: number;
  returnPct: number;
  maxDrawdownPct: number; // 持仓期最大回撤
  // 止损相关
  stopLossPrice: number;
  exitReason: 'rsi_overbought' | 'stop_loss_fixed' | 'stop_loss_trailing';
}

export interface RSIBacktestResult {
  rsiPeriod: number;      // 6 / 12 / 24
  buyThreshold: number;     // 超卖反弹买入阈值
  sellThreshold: number;    // 超买卖出阈值
  trades: RSIBacktestTrade[];
  totalReturn: number;      // 累加收益率（非复利）
  winRate: number;
  tradeCount: number;
  avgReturn: number;
  maxDrawdown: number;     // 单笔最大亏损
  profitFactor: number;     // 盈亏比
  score: number;            // 综合评分
  // 止损参数
  fixedStopLossPct: number;
  trailingStopLossPct: number;
}

// 通用止损引擎 —— 被 MA/MACD/RSI 三个策略复用
type ExitReason = MABacktestTrade['exitReason'] | MACDTrade['exitReason'] | RSIBacktestTrade['exitReason'];

/**
 * 检查是否需要止损
 */
function checkStopLoss(
  currentPrice: number,
  buyPrice: number,
  maxPrice: number,
  maValue: number | undefined,
  fixedStopPct: number,
  trailingStopPct: number,
  maStopPct?: number
): [boolean, ExitReason, number] {
  // 1. 固定止损：买入价下跌 fixedStopPct
  const fixedStopPrice = buyPrice * (1 - fixedStopPct);
  if (currentPrice <= fixedStopPrice) {
    return [true, 'stop_loss_fixed', fixedStopPrice];
  }

  // 2. 移动止损：从最高点回落 trailingStopPct
  if (maxPrice > buyPrice) {
    const trailingStopPrice = maxPrice * (1 - trailingStopPct);
    if (currentPrice <= trailingStopPrice) {
      return [true, 'stop_loss_trailing', trailingStopPrice];
    }
  }

  // 3. 均线止损：价格跌破均线 maStopPct（仅当提供均线值时）
  if (maValue !== undefined && maStopPct !== undefined && maValue > 0) {
    const maStopPrice = maValue * (1 - maStopPct);
    if (currentPrice <= maStopPrice) {
      return [true, 'stop_loss_ma', maStopPrice];
    }
  }

  return [false, 'hold_end', fixedStopPrice];
}

export function backtestMABounce(
  klines: Stock.KLineItem[],
  maPeriods: number[] = [5, 10, 20, 30, 60],
  holdDaysOptions: number[] = [5, 10, 20],
  // 止损参数（带默认值）
  fixedStopLossPct: number = 0.05,
  trailingStopLossPct: number = 0.05,
  maStopLossPct: number = 0.03
): MABacktestResult[] {
  const testKlines = klines.slice(-120); // 取最近120天数据进行回测
  const startIndex = klines.length - testKlines.length;
  const closes = testKlines.map((k) => k.sp);
  const allResults: MABacktestResult[] = [];

  // 参数网格
  const trendDaysOptions = [3, 5, 10]; // 趋势确认：连续N天收盘价在均线上方
  const bounceThresholds = [0.01, 0.02, 0.03, 0.05]; // 回踩阈值：收盘价在均线 ±X% 内

  for (const period of maPeriods) {
    const ma =  Indicators.calculateMA(closes, period);

    for (const holdDays of holdDaysOptions) {
      for (const trendDays of trendDaysOptions) {
        for (const threshold of bounceThresholds) {
          const trades: MABacktestTrade[] = [];

          // 从有足够数据的位置开始
          const startIdx = Math.max(period, period + trendDays);
          for (let i = startIdx; i < closes.length - holdDays; i++) {
            if (isNaN(ma[i]) || ma[i] === 0) continue;

            // 1. 趋势确认：前 trendDays 天收盘价在均线上方，且均线本身向上
            let trendValid = true;
            for (let j = i - trendDays; j < i; j++) {
              if (j < 1 || isNaN(ma[j]) || isNaN(ma[j - 1])) {
                trendValid = false;
                break;
              }
              if (closes[j] <= ma[j] || ma[j] <= ma[j - 1]) {
                trendValid = false;
                break;
              }
            }
            if (!trendValid) continue;

            // 2. 回踩信号：最低价触及/接近均线，收盘价收回且在均线 ±threshold 范围内
            const maVal = ma[i];
            const close = closes[i];
            const low = testKlines[i].zd;
            const open = testKlines[i].kp;

            const touchedMA = low <= maVal * 1.005; // 最低价触碰或轻微跌破均线
            const recovered = close >= maVal * 0.98; // 收盘收回在均线上方附近
            const nearMA = Math.abs(close - maVal) / maVal <= threshold; // 收盘在均线阈值范围内

            if (touchedMA && recovered && nearMA) {
              // 3. 反弹确认：当日收阳 或 次日收盘高于当日
              const todayUp = close > open;
              const nextDayUp = i + 1 < closes.length && closes[i + 1] > close;

              if (todayUp || nextDayUp) {
                // 计算持有期收益和最大回撤（含止损检查）
                let maxPrice = close;
                let maxDD = 0;
                let sellIdx = Math.min(i + holdDays, closes.length - 1);
                let exitReason: MABacktestTrade['exitReason'] = 'hold_end';
                let finalStopLossPrice = close * (1 - fixedStopLossPct);

                for (let d = i + 1; d <= sellIdx && d < closes.length; d++) {
                  if (closes[d] > maxPrice) maxPrice = closes[d];
                  const dd = (maxPrice - closes[d]) / maxPrice * 100;
                  if (dd > maxDD) maxDD = dd;

                  // 止损检查
                  const [shouldStop, reason, slPrice] = checkStopLoss(
                    closes[d], close, maxPrice, ma[d],
                    fixedStopLossPct, trailingStopLossPct, maStopLossPct
                  );
                  if (shouldStop) {
                    sellIdx = d;
                    exitReason = reason as MABacktestTrade['exitReason'];
                    finalStopLossPrice = slPrice;
                    break;
                  }
                }

                const sellPrice = closes[sellIdx];
                const ret = (sellPrice - close) / close * 100;

                trades.push({
                  buyIndex: i + startIndex,
                  sellIndex: sellIdx + startIndex,
                  returnPct: ret,
                  maxDrawdownPct: maxDD,
                  stopLossPrice: finalStopLossPrice,
                  exitReason,
                });
              }
            }
          }

          // 过滤：至少交易 3 次才有统计意义
          if (trades.length >= 3) {
            const returns = trades.map((t) => t.returnPct);
            const wins = returns.filter((r) => r > 0);
            const totalReturn = returns.reduce((a, b) => a + b, 0);
            const winRate = (wins.length / returns.length) * 100;
            const avgReturn = totalReturn / returns.length;
            const maxDrawdown = Math.min(...returns);

            const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
            const losses = returns.filter((r) => r <= 0);
            const avgLoss = losses.length ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 1;
            const profitFactor = avgLoss === 0 ? 999 : avgWin / avgLoss;

            // 综合评分：收益 × 胜率 × 交易次数系数 / (1 + |回撤|/10)
            const score = totalReturn * (winRate / 100) * Math.min(trades.length, 15) / (1 + Math.abs(maxDrawdown) / 10);

            allResults.push({
              maPeriod: period,
              holdDays,
              trendDays,
              threshold,
              totalReturn,
              winRate,
              tradeCount: trades.length,
              avgReturn,
              maxDrawdown,
              profitFactor,
              score,
              trades: [...trades],
              fixedStopLossPct,
              trailingStopLossPct,
              maStopLossPct,
            });
          }
        }
      }
    }
  }

  // 按综合评分降序
  allResults.sort((a, b) => b.score - a.score);
  return allResults;
}

export function optimizeMACDStrategy(
  klines: Stock.KLineItem[],
  // 止损参数
  fixedStopLossPct: number = 0.05,
  trailingStopLossPct: number = 0.06
): MACDStrategyResult[] {
  const closes = klines.map(k => k.sp);
  const allResults: MACDStrategyResult[] = [];

  // 参数网格
  const fastPeriods = [8, 12, 15];
  const slowPeriods = [21, 26, 30];
  const signalPeriods = [7, 9, 12];
  const aboveZeroOptions = [true, false];      // 是否要求零轴上方金叉
  const priorNegOptions = [true, false];      // 是否要求金叉前 MACD 曾为负

  for (const fast of fastPeriods) {
    for (const slow of slowPeriods) {
      if (fast >= slow) continue;
      for (const signal of signalPeriods) {
        for (const requireAboveZero of aboveZeroOptions) {
          for (const requirePriorNegative of priorNegOptions) {
            const macd = calculateMACD(closes, slow, fast, signal);
            const dif = macd.MACD;
            const dea = macd.signal;
            const hist = macd.histogram;

            const trades: MACDTrade[] = [];
            let holding = false;
            let buyPrice = 0;
            let buyIndex = -1;
            let maxPrice = 0;

            for (let i = 2; i < closes.length - 1; i++) {
              if (!holding) {
                // 金叉判断
                const goldenCross = dif[i] > dea[i] && dif[i - 1] <= dea[i - 1];
                if (!goldenCross) continue;

                // 零轴过滤
                if (requireAboveZero && (dif[i] <= 0 || dea[i] <= 0)) continue;

                // 金叉前必须有负 MACD（确保从空头区域恢复）
                let hadNegative = false;
                if (requirePriorNegative) {
                  for (let j = Math.max(0, i - 5); j < i; j++) {
                    if (hist[j] < 0) { hadNegative = true; break; }
                  }
                  if (!hadNegative) continue;
                }

                // 柱状线确认：当前柱 > 0 且比前一天大（动能增强）
                if (hist[i] <= 0 || hist[i] <= hist[i - 1]) continue;

                holding = true;
                buyPrice = closes[i];
                buyIndex = i;
                maxPrice = buyPrice;
              } else {
                if (closes[i] > maxPrice) maxPrice = closes[i];

                // 优先检查止损
                const [shouldStop, stopReason] = checkStopLoss(
                  closes[i], buyPrice, maxPrice, undefined,
                  fixedStopLossPct, trailingStopLossPct
                );

                // 卖出条件 1：死叉
                const deadCross = dif[i] < dea[i] && dif[i - 1] >= dea[i - 1];
                // 卖出条件 2：柱状线连续 2 天显著缩短（止盈）
                const histShrink = hist[i] > 0 && hist[i] < hist[i - 1] && hist[i - 1] < hist[i - 2];
                const sharpShrink = histShrink && hist[i] < hist[i - 1] * 0.7;

                let sellPrice: number;
                let exitReason: MACDTrade['exitReason'];

                if (shouldStop) {
                  sellPrice = closes[i];
                  exitReason = stopReason as MACDTrade['exitReason'];
                } else if (deadCross) {
                  sellPrice = closes[i];
                  exitReason = 'macd_exit';
                } else if (sharpShrink) {
                  sellPrice = closes[i];
                  exitReason = 'hist_shrink';
                } else {
                  continue;
                }

                const ret = (sellPrice - buyPrice) / buyPrice * 100;
                const dd = maxPrice > buyPrice 
                  ? (maxPrice - Math.min(...closes.slice(buyIndex, i + 1))) / maxPrice * 100 
                  : 0;

                trades.push({
                  buyIndex,
                  sellIndex: i,
                  returnPct: ret,
                  maxDrawdownPct: dd,
                  holdDays: i - buyIndex,
                  stopLossPrice: buyPrice * (1 - fixedStopLossPct),
                  exitReason,
                });

                holding = false;
                buyPrice = 0;
                buyIndex = -1;
                maxPrice = 0;
              }
            }

            if (trades.length >= 3) {
              const returns = trades.map(t => t.returnPct);
              const wins = returns.filter(r => r > 0);
              const totalReturn = returns.reduce((a, b) => a + b, 0);
              const avgReturn = totalReturn / returns.length;
              const winRate = (wins.length / returns.length) * 100;
              const maxDrawdown = Math.min(...returns);
              const avgHold = trades.reduce((s, t) => s + t.holdDays, 0) / trades.length;

              const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
              const losses = returns.filter(r => r <= 0);
              const avgLoss = losses.length ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 1;
              const profitFactor = avgLoss === 0 ? 999 : avgWin / avgLoss;

              // 评分：收益 × 胜率 × 交易次数系数 / (1 + |回撤|/10) / (1 + 持仓天数/20)
              // 偏好：高收益、高胜率、低回撤、适中持仓天数
              const score = totalReturn * (winRate / 100) * Math.min(trades.length, 15) 
                / (1 + Math.abs(maxDrawdown) / 10) 
                / (1 + Math.abs(avgHold - 5) / 10);

              allResults.push({
                fast, slow, signal,
                requireAboveZero,
                requirePriorNegative,
                trades,
                totalReturn,
                winRate,
                tradeCount: trades.length,
                avgReturn,
                avgHoldDays: avgHold,
                maxDrawdown,
                profitFactor,
                score,
                fixedStopLossPct,
                trailingStopLossPct,
              });
            }
          }
        }
      }
    }
  }

  allResults.sort((a, b) => b.score - a.score);
  return allResults;
}

export function optimizeRSIStrategy(
  klines: Stock.KLineItem[],
  rsiPeriods: number[] = [6, 12, 24],
  // 止损参数
  fixedStopLossPct: number = 0.05,
  trailingStopLossPct: number = 0.06
): RSIBacktestResult[] {
  const testKlines = klines.slice(-120);
  const startIndex = klines.length - testKlines.length;
  const closes = testKlines.map(k => k.sp);
  const allResults: RSIBacktestResult[] = [];

  // 参数网格：超卖买点 15-35，超买卖点 65-85
  const buyThresholds = [15, 20, 25, 28, 30, 35];
  const sellThresholds = [65, 70, 72, 75, 80, 85];

  for (const period of rsiPeriods) {
    const rsi = Indicators.calculateRSI(closes, period);

    for (const buyTh of buyThresholds) {
      for (const sellTh of sellThresholds) {
        if (buyTh >= sellTh) continue; // 买入阈值必须低于卖出阈值

        const trades: RSIBacktestTrade[] = [];
        let inOversold = false;   // 是否曾进入超卖区（确保是"反弹"而非高位回落）
        let holding = false;
        let buyPrice = 0;
        let buyIndex = -1;
        let maxPriceSinceBuy = 0;

        for (let i = 1; i < closes.length; i++) {
          // 跟踪是否进入超卖区
          if (rsi[i] <= buyTh) inOversold = true;

          if (!holding) {
            // 买入信号：曾进入超卖区，且 RSI 从下方上穿 buyTh（确认反弹）
            if (inOversold && rsi[i - 1] <= buyTh && rsi[i] > buyTh) {
              holding = true;
              buyPrice = closes[i];
              buyIndex = i;
              maxPriceSinceBuy = buyPrice;
              inOversold = false;
            }
          } else {
            // 更新持仓期最高价（计算回撤）
            if (closes[i] > maxPriceSinceBuy) maxPriceSinceBuy = closes[i];

            // 优先检查止损
            const [shouldStop, stopReason] = checkStopLoss(
              closes[i], buyPrice, maxPriceSinceBuy, undefined,
              fixedStopLossPct, trailingStopLossPct
            );

            // 卖出信号：RSI 进入超买区（≥ sellTh）
            // 用"进入即卖"比"下穿卖"更及时，避免利润回吐
            let sellPrice: number;
            let exitReason: RSIBacktestTrade['exitReason'];

            if (shouldStop) {
              sellPrice = closes[i];
              exitReason = stopReason as RSIBacktestTrade['exitReason'];
            } else if (rsi[i] >= sellTh) {
              sellPrice = closes[i];
              exitReason = 'rsi_overbought';
            } else {
              continue;
            }

            const ret = (sellPrice - buyPrice) / buyPrice * 100;
            const dd = (maxPriceSinceBuy - sellPrice) / maxPriceSinceBuy * 100; // 从高点回撤

            trades.push({
              buyIndex: buyIndex + startIndex,
              sellIndex: i + startIndex,
              buyPrice,
              sellPrice,
              returnPct: ret,
              maxDrawdownPct: dd,
              stopLossPrice: buyPrice * (1 - fixedStopLossPct),
              exitReason,
            });

            holding = false;
            buyPrice = 0;
            buyIndex = -1;
            maxPriceSinceBuy = 0;
          }
        }

        // 过滤：至少交易 3 次才有统计意义
        if (trades.length >= 3) {
          const returns = trades.map(t => t.returnPct);
          const wins = returns.filter(r => r > 0);
          const losses = returns.filter(r => r <= 0);

          const totalReturn = returns.reduce((a, b) => a + b, 0);
          const winRate = (wins.length / returns.length) * 100;
          const avgReturn = totalReturn / returns.length;
          const maxDrawdown = Math.min(...returns);
          const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
          const avgLoss = losses.length ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 1;
          const profitFactor = avgLoss === 0 ? 999 : avgWin / avgLoss;

          // 综合评分：收益 × 胜率 × 交易次数系数 / (1 + |回撤|/10)
          // 避免"押中一次大行情"的极端策略胜出
          const score = totalReturn * (winRate / 100) * Math.min(trades.length, 15) / (1 + Math.abs(maxDrawdown) / 10);

          allResults.push({
            rsiPeriod: period,
            buyThreshold: buyTh,
            sellThreshold: sellTh,
            trades,
            totalReturn,
            winRate,
            tradeCount: trades.length,
            avgReturn,
            maxDrawdown,
            profitFactor,
            score,
            fixedStopLossPct,
            trailingStopLossPct,
          });
        }
      }
    }
  }

  // 按综合评分降序
  allResults.sort((a, b) => b.score - a.score);
  return allResults;
}

// ===== 策略优化驱动回测类 =====
// 1. 获取5-10个交易日前的强势股票集合（去重）
// 2. 对每只强势股票，调用接口optimizeMACDStrategy\optimizeRSIStrategy取得最佳macd\RSI参数和得分，取得分高的作为最佳策略保存
// 3. 筛选符合以下条件的股票进入候选列表：
//    a. 得分超过100分，并且最佳策略测试最近3天出现满足买入条件（MACD金叉或RSI超卖反弹），记录下满足的交易日，标记为M-Day；
//    b. 如果M-Day是今天，则认为该股票满足技术面条件，继续往下判断；
//    c. 如果M-Day不是今天，判断M-Day+1到今天是否出现冲高回来k线有长上影线的情况，有则放弃，再判断M-Day+1到今天是否出现收盘价是否跌破M-Day实体最低价，有则放弃；
//    c. 如果入选条件是涨停，则往前找最多10个交易日内，找到最早出现涨停的交易日，记录下来，标记为T-Day；
//    d. 如果入选条件是60日新高，则往前找最多10个交易日内，找到最早出现60日新高的交易日，记录下来，标记为T-Day；
//    e. 获取T-Day所在交易日的板块数据；
//    f. 如果T-Day板块涨幅在所有板块排名前10%，则认为该股票满足板块驱动条件；
//    4. 如果T-Day股票在板块涨幅排名前10%，则认为该股票满足板块驱动条件，涨停默认满足；
// 4. 候选列表根据最佳策略得分排序，再进行筛选：
//    a. 同一板块的股票最多选2只；
//    b. 买入金额不超过总资金的12.5%，且不低于5%，优先选满12.5%，如果资金不足则选接近12.5%的金额；
//    c. 最多选8只股票；
// 5. 生成买入订单，次日开盘执行；
// 6. 卖出信号：持仓期间如果出现以下任一情况，次日开盘卖出：
//    a. 根据买入时使用的最佳策略测试最新k线，如果有卖出信号；
//    c. 触及止损价（初始止损价为买入价的95%，如果股价创新高，则止损价跟随上涨，保持在最高价的90%）；
export interface StrategyPosition {
  secid: string;
  boardCode: string;
  buyDate: string;
  buyPrice: number;
  quantity: number;
  buyAmount: number;
  highestPrice: number;
  stopLossPrice: number;
  strategyType: 'macd' | 'rsi';
  strategyParams: MACDStrategyResult | RSIBacktestResult;
}

export interface StrategyPendingOrder {
  secid: string;
  type: 'buy' | 'sell';
  reason: string;
  signalDate: string;
  boardCode?: string;
  strategyType?: 'macd' | 'rsi';
  strategyParams?: MACDStrategyResult | RSIBacktestResult;
}

export interface StrategyTradeRecord {
  date: string;
  secid: string;
  type: 'buy' | 'sell';
  price: number;
  quantity: number;
  amount: number;
  reason: string;
  pnl?: number;
}

export interface StrategyDailyValue {
  date: string;
  totalValue: number;
}

export interface StrategyBacktestResult {
  totalReturn: number;
  annualizedReturn: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  totalTrades: number;
  avgHoldingDays: number;
  trades: StrategyTradeRecord[];
  dailyValues: StrategyDailyValue[];
}

export interface StrategyDataProvider {
  getStrongStocks(date: string): Promise<Stock.DetailItem[]>;
  getKLines(secid: string, endDate: string, days?: number): Promise<Stock.KLineItem[] | null>;
  getAllBoards(associateBoardName: string, date: string): Promise<Array<{ code: string; name: string; zf: number }>>;
  getBoardStocks(date: string, boardCode: string | null, boardName: string): Promise<Array<{ secid: string; zf: number }>>;
  filterTradeDays(dates: string[]): Promise<string[]>;
}

export class OptimizedStrategyBacktest {
  private initialCapital: number;
  private capital: number;
  private availableCash: number;
  private positions: Map<string, StrategyPosition> = new Map();
  private pendingOrders: StrategyPendingOrder[] = [];
  private tradeRecords: StrategyTradeRecord[] = [];
  private dailyValues: StrategyDailyValue[] = [];
  private tradeDays: string[];
  private cancelOptions?: { onShouldCancel?: () => boolean; onShouldPause?: () => boolean };

  private readonly MAX_POSITIONS = 8;
  private readonly POSITION_RATIO = 0.125;
  private readonly MAX_SAME_BOARD = 2;
  private readonly MIN_POSITION_RATIO = 0.05;
  private readonly STOP_LOSS_INIT_PCT = 0.95;
  private readonly TRAILING_STOP_PCT = 0.90;
  private readonly MIN_STRATEGY_SCORE = 100;
  private readonly STRONG_LOOKBACK_START = 10;
  private readonly STRONG_LOOKBACK_END = 5;
  private readonly SLIPPAGE = 0.001;
  private readonly COMMISSION = 0.0003;
  private readonly STAMP_TAX = 0.001;
  private readonly BATCH_SIZE = 10;
  private readonly KLINE_DAYS = 120;

  constructor(tradeDays: string[], initialCapital: number = 1000000) {
    this.tradeDays = tradeDays;
    this.initialCapital = initialCapital;
    this.capital = initialCapital;
    this.availableCash = initialCapital;
    console.log(`[OptBacktest] 初始化完成 | 初始资金: ${initialCapital.toLocaleString()} | 交易日数: ${tradeDays.length}`);
  }

  public async run(
    dataProvider: StrategyDataProvider,
    onProgress?: (message: string, percent?: number) => void,
    options?: { onShouldCancel?: () => boolean; onShouldPause?: () => boolean }
  ): Promise<StrategyBacktestResult> {
    this.cancelOptions = options;
    const totalDays = this.tradeDays.length;
    const dayPercentStep = totalDays > 0 ? 90 / totalDays : 0;

    console.log(`[OptBacktest] ====== 回测开始 ======`);
    console.log(`[OptBacktest] 参数配置:`, {
      MAX_POSITIONS: this.MAX_POSITIONS,
      POSITION_RATIO: this.POSITION_RATIO,
      MAX_SAME_BOARD: this.MAX_SAME_BOARD,
      MIN_POSITION_RATIO: this.MIN_POSITION_RATIO,
      STOP_LOSS_INIT_PCT: this.STOP_LOSS_INIT_PCT,
      TRAILING_STOP_PCT: this.TRAILING_STOP_PCT,
      MIN_STRATEGY_SCORE: this.MIN_STRATEGY_SCORE,
      STRONG_LOOKBACK: `${this.STRONG_LOOKBACK_START}-${this.STRONG_LOOKBACK_END}天前`,
      SLIPPAGE: this.SLIPPAGE,
      COMMISSION: this.COMMISSION,
      STAMP_TAX: this.STAMP_TAX,
      BATCH_SIZE: this.BATCH_SIZE
    });

    for (let i = 0; i < totalDays; i++) {
      if (this.isCancelled()) {
        console.log(`[OptBacktest] 回测在第 ${i + 1}/${totalDays} 天被取消`);
        onProgress?.('回测已取消', 100);
        return this.calculateResult();
      }
      const cancelledDuringPause = await this.waitIfPaused();
      if (cancelledDuringPause) {
        console.log(`[OptBacktest] 回测在暂停期间被取消`);
        onProgress?.('回测已取消', 100);
        return this.calculateResult();
      }

      const today = this.tradeDays[i];
      const currentBase = Math.round(i * dayPercentStep);

      console.log(`\n[OptBacktest] ---------- 第 ${i + 1}/${totalDays} 天 [${today}] ----------`);
      console.log(`[OptBacktest] 当前持仓: ${this.positions.size} 只 | 可用资金: ${this.availableCash.toFixed(2)}`);

      onProgress?.(`[${i + 1}/${totalDays}] ${today} 执行待处理订单...`, currentBase);
      console.log(`[OptBacktest] [${today}] 阶段1: 执行待处理订单 ${this.pendingOrders.length} 笔`);
      if (await this.executePendingOrders(today, dataProvider)) {
        onProgress?.('回测已取消', 100);
        return this.calculateResult();
      }

      if (i < totalDays - 1) {
        const nextDay = this.tradeDays[i + 1];
        onProgress?.(`[${i + 1}/${totalDays}] ${today} 生成交易信号...`, Math.round(currentBase + dayPercentStep * 0.3));
        console.log(`[OptBacktest] [${today}] 阶段2: 生成交易信号 (次日执行: ${nextDay})`);
        if (await this.generateSignals(today, nextDay, dataProvider, (msg, pct) => {
          onProgress?.(msg, pct ?? Math.round(currentBase + dayPercentStep * 0.6));
        })) {
          onProgress?.('回测已取消', 100);
          return this.calculateResult();
        }
      }

      onProgress?.(`[${i + 1}/${totalDays}] ${today} 记录净值...`, Math.round(currentBase + dayPercentStep * 0.8));
      console.log(`[OptBacktest] [${today}] 阶段3: 记录净值`);
      if (await this.recordDailyValue(today, dataProvider)) {
        onProgress?.('回测已取消', 100);
        return this.calculateResult();
      }

      console.log(`[OptBacktest] [${today}] 日终状态: 持仓 ${this.positions.size} 只 | 净值 ${this.dailyValues[this.dailyValues.length - 1]?.totalValue.toFixed(2)}`);
    }

    onProgress?.('正在计算回测结果...', 95);
    console.log(`\n[OptBacktest] ====== 计算最终结果 ======`);
    const result = this.calculateResult();
    onProgress?.('回测完成！', 100);
    console.log(`[OptBacktest] ====== 回测结束 ======\n`);
    return result;
  }

  // ===== 阶段1: 执行待处理订单 =====
  private async executePendingOrders(today: string, dataProvider: StrategyDataProvider): Promise<boolean> {
    if (this.pendingOrders.length === 0) {
      console.log(`[OptBacktest] [${today}] 无待执行订单`);
      return false;
    }

    for (const order of this.pendingOrders) {
      if (this.isCancelled()) return true;
      await this.waitIfPaused();
      if (this.isCancelled()) return true;

      const klines = await dataProvider.getKLines(order.secid, today, 1);
      if (!klines || klines.length === 0) {
        console.log(`[OptBacktest] [${today}] 订单执行失败: ${order.secid} 未获取到K线数据`);
        continue;
      }

      const todayKLine = klines.find(k => k.date === today);
      if (!todayKLine) {
        console.log(`[OptBacktest] [${today}] 订单执行失败: ${order.secid} 未找到当日K线`);
        continue;
      }

      const openPrice = todayKLine.kp;

      if (order.type === 'buy') {
        console.log(`[OptBacktest] [${today}] 执行买入: ${order.secid} | 开盘价: ${openPrice.toFixed(2)} | 原因: ${order.reason}`);
        this.executeBuy(order, today, openPrice);
      } else if (order.type === 'sell') {
        const position = this.positions.get(order.secid);
        if (position) {
          console.log(`[OptBacktest] [${today}] 执行卖出: ${order.secid} | 开盘价: ${openPrice.toFixed(2)} | 持仓成本: ${position.buyPrice.toFixed(2)} | 原因: ${order.reason}`);
          this.executeSell(order.secid, today, openPrice, position.quantity, order.reason);
        } else {
          console.log(`[OptBacktest] [${today}] 卖出订单忽略: ${order.secid} 无持仓`);
        }
      }
    }
    this.pendingOrders = [];
    return false;
  }

  private executeBuy(order: StrategyPendingOrder, date: string, price: number) {
    const adjustedPrice = price * (1 + this.SLIPPAGE);
    const standardAmount = this.capital * this.POSITION_RATIO;
    const maxBuyAmount = Math.min(standardAmount, this.availableCash);
    const quantity = Math.floor(maxBuyAmount / adjustedPrice / 100) * 100;
    const actualAmount = adjustedPrice * quantity;

    if (actualAmount < this.capital * this.MIN_POSITION_RATIO || quantity < 100) {
      console.log(`[OptBacktest] [${date}] ${order.secid} 买入失败: 低于最小仓位或数量不足`);
      return;
    }

    const commission = actualAmount * this.COMMISSION;
    const totalCost = actualAmount + commission;

    if (this.availableCash < totalCost) {
      console.log(`[OptBacktest] [${date}] ${order.secid} 买入失败: 资金不足`);
      return;
    }

    this.availableCash -= totalCost;
    const stopLossPrice = adjustedPrice * this.STOP_LOSS_INIT_PCT;

    this.positions.set(order.secid, {
      secid: order.secid,
      boardCode: order.boardCode || '',
      buyDate: date,
      buyPrice: adjustedPrice,
      quantity,
      buyAmount: totalCost,
      highestPrice: adjustedPrice,
      stopLossPrice,
      strategyType: order.strategyType || 'macd',
      strategyParams: order.strategyParams || ({} as any)
    });

    console.log(`[OptBacktest] [${date}] ${order.secid} 买入成功: 价${adjustedPrice.toFixed(2)} | 量${quantity} | 总成本${totalCost.toFixed(2)} | 策略${order.strategyType} | 止损价${stopLossPrice.toFixed(2)} | 剩余资金${this.availableCash.toFixed(2)}`);

    this.tradeRecords.push({
      date,
      secid: order.secid,
      type: 'buy',
      price: adjustedPrice,
      quantity,
      amount: totalCost,
      reason: order.reason
    });
  }

  private executeSell(secid: string, date: string, price: number, quantity: number, reason: string) {
    const position = this.positions.get(secid);
    if (!position) {
      console.log(`[OptBacktest] [${date}] ${secid} 卖出失败: 无持仓`);
      return;
    }

    const adjustedPrice = price * (1 - this.SLIPPAGE);
    const totalAmount = adjustedPrice * quantity;
    const commission = totalAmount * this.COMMISSION;
    const stampTax = totalAmount * this.STAMP_TAX;
    const netAmount = totalAmount - commission - stampTax;

    this.availableCash += netAmount;
    const pnl = netAmount - position.buyAmount;

    console.log(`[OptBacktest] [${date}] ${secid} 卖出成功: 价${adjustedPrice.toFixed(2)} | 量${quantity} | 净额${netAmount.toFixed(2)} | 盈亏${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} | 剩余资金${this.availableCash.toFixed(2)}`);

    this.tradeRecords.push({
      date,
      secid,
      type: 'sell',
      price: adjustedPrice,
      quantity,
      amount: netAmount,
      reason,
      pnl
    });

    this.positions.delete(secid);
    console.log(`[OptBacktest] [${date}] ${secid} 已从持仓移除`);
  }

  // ===== 阶段2: 生成交易信号 =====
  private async generateSignals(
    today: string,
    nextDay: string,
    dataProvider: StrategyDataProvider,
    onProgress?: (message: string, percent?: number) => void
  ): Promise<boolean> {
    // 2-1: 处理持仓卖出信号
    console.log(`[OptBacktest] [${today}] 阶段2-1: 处理持仓卖出信号 ${this.positions.size} 只`);
    onProgress?.(`[${today}] 处理持仓卖出信号...`);

    for (const [secid, position] of this.positions) {
      if (this.isCancelled()) return true;
      await this.waitIfPaused();
      if (this.isCancelled()) return true;

      const klines = await dataProvider.getKLines(secid, today, 60);
      if (!klines || klines.length === 0) {
        console.log(`[OptBacktest] [${today}] ${secid} 卖出检查跳过: K线不足`);
        continue;
      }

      const currentPrice = klines[klines.length - 1].sp;

      // 更新最高价和移动止损
      if (currentPrice > position.highestPrice) {
        const oldHigh = position.highestPrice;
        position.highestPrice = currentPrice;
        position.stopLossPrice = currentPrice * this.TRAILING_STOP_PCT;
        console.log(`[OptBacktest] [${today}] ${secid} 创新高: ${oldHigh.toFixed(2)} → ${currentPrice.toFixed(2)}, 移动止损更新为 ${position.stopLossPrice.toFixed(2)}`);
      }

      // 检查止损
      if (currentPrice < position.stopLossPrice) {
        console.log(`[OptBacktest] [${today}] ${secid} 🔴 止损触发: 当前${currentPrice.toFixed(2)} < 止损价${position.stopLossPrice.toFixed(2)}`);
        this.pendingOrders.push({
          secid,
          type: 'sell',
          reason: `止损触发(${currentPrice.toFixed(2)} < ${position.stopLossPrice.toFixed(2)})`,
          signalDate: today
        });
        continue;
      }

      // 检查策略卖出信号
      let hasSellSignal = false;
      let sellReason = '';
      if (position.strategyType === 'macd') {
        hasSellSignal = this.checkMACDSellSignal(klines, position.strategyParams as MACDStrategyResult);
        sellReason = 'MACD卖出信号';
      } else if (position.strategyType === 'rsi') {
        hasSellSignal = this.checkRSISellSignal(klines, position.strategyParams as RSIBacktestResult);
        sellReason = 'RSI卖出信号';
      }

      if (hasSellSignal) {
        console.log(`[OptBacktest] [${today}] ${secid} ✅ 策略卖出信号: ${sellReason}`);
        this.pendingOrders.push({
          secid,
          type: 'sell',
          reason: sellReason,
          signalDate: today
        });
      }
    }

    // 2-2: 获取today往前5-10个交易日的强势股票
    const rawDates: string[] = [];
    const base = dayjs(today, 'YYYY-MM-DD');
    // 生成足够多的自然日（留40天余量应对长假），再过滤出交易日
    for (let d = 1; d <= 40; d++) {
      rawDates.push(base.subtract(d, 'day').format('YYYY-MM-DD'));
    }
    const tradeDays = await dataProvider.filterTradeDays(rawDates);
    // 取往前第5-10个交易日（rawDates从近到远，tradeDays也保持此顺序）
    const strongStockDays = tradeDays.slice(4, 10);

    console.log(`[OptBacktest] [${today}] 阶段2-2: 获取强势股票 ${strongStockDays.join(', ')}`);
    onProgress?.(`[${today}] 获取强势股票...`);

    const strongStocksMap = new Map<string, Stock.DetailItem>();
    for (const day of strongStockDays) {
      if (this.isCancelled()) return true;
      await this.waitIfPaused();
      if (this.isCancelled()) return true;

      try {
        const stocks = await dataProvider.getStrongStocks(day);
        console.log(`[OptBacktest] [${today}] ${day} 强势股票: ${stocks.length} 只`);
        for (const stock of stocks) {
          if (!strongStocksMap.has(stock.secid)) {
            strongStocksMap.set(stock.secid, stock);
          }
        }
      } catch (err) {
        console.log(`[OptBacktest] [${today}] 获取 ${day} 强势股票失败:`, err);
      }
    }

    const strongStocks = Array.from(strongStocksMap.values());
    console.log(`[OptBacktest] [${today}] 去重后强势股票共 ${strongStocks.length} 只`);

    // 排除已持仓
    const filteredStocks = strongStocks.filter(s => !this.positions.has(s.secid));
    console.log(`[OptBacktest] [${today}] 排除已持仓后剩余 ${filteredStocks.length} 只`);

    // 2-3: 批量策略优化和筛选
    const buyCandidates: Array<{
      secid: string;
      score: number;
      boardCode: string;
      price: number;
      reason: string;
      strategyType: 'macd' | 'rsi';
      strategyParams: MACDStrategyResult | RSIBacktestResult;
    }> = [];

    for (let batchStart = 0; batchStart < filteredStocks.length; batchStart += this.BATCH_SIZE) {
      if (this.isCancelled()) return true;
      await this.waitIfPaused();
      if (this.isCancelled()) return true;

      const batch = filteredStocks.slice(batchStart, batchStart + this.BATCH_SIZE);
      onProgress?.(`[${today}] 策略优化中 ${Math.min(batchStart + this.BATCH_SIZE, filteredStocks.length)}/${filteredStocks.length}...`);

      const batchResults = await Promise.allSettled(
        batch.map(async (stock) => {
          const klines = await dataProvider.getKLines(stock.secid, today, this.KLINE_DAYS);
          if (!klines || klines.length < 60) {
            return { pass: false, reason: 'K线不足', secid: stock.secid };
          }

          // 策略优化
          const macdResults = optimizeMACDStrategy(klines);
          const rsiResults = optimizeRSIStrategy(klines);

          let bestResult: MACDStrategyResult | RSIBacktestResult | null = null;
          let bestType: 'macd' | 'rsi' | null = null;
          let bestScore = 0;

          if (macdResults.length > 0 && macdResults[0].score > bestScore) {
            bestScore = macdResults[0].score;
            bestResult = macdResults[0];
            bestType = 'macd';
          }

          if (rsiResults.length > 0 && rsiResults[0].score > bestScore) {
            bestScore = rsiResults[0].score;
            bestResult = rsiResults[0];
            bestType = 'rsi';
          }

          if (!bestResult || bestScore < this.MIN_STRATEGY_SCORE) {
            return { pass: false, reason: `策略得分不足(${bestScore.toFixed(1)})`, secid: stock.secid };
          }

          // 检查最近3天买入信号
          let mDayIndex = -1;
          if (bestType === 'macd') {
            mDayIndex = this.checkMACDBuySignal(klines, bestResult as MACDStrategyResult, 3);
          } else {
            mDayIndex = this.checkRSIBuySignal(klines, bestResult as RSIBacktestResult, 3);
          }

          if (mDayIndex < 0) {
            return { pass: false, reason: '最近3天无买入信号', secid: stock.secid };
          }

          // M-Day判断
          const lastIndex = klines.length - 1;
          const mDayKline = klines[mDayIndex];

          // 如果M-Day不是今天，检查后续K线健康度
          if (mDayIndex < lastIndex) {
            // 检查M-Day+1到今天是否有长上影线
            for (let j = mDayIndex + 1; j <= lastIndex; j++) {
              if (this.hasLongUpperShadow(klines[j])) {
                return { pass: false, reason: `M-Day后出现长上影线(${klines[j].date})`, secid: stock.secid };
              }
            }

            // 检查是否跌破M-Day实体最低价
            const mDayEntityLow = Math.min(mDayKline.kp, mDayKline.sp);
            for (let j = mDayIndex + 1; j <= lastIndex; j++) {
              if (klines[j].sp < mDayEntityLow) {
                return { pass: false, reason: `M-Day后跌破实体最低价(${klines[j].date})`, secid: stock.secid };
              }
            }
          }
                    // 板块驱动条件
          let boardPass = false;      // 板块在所有板块中排名前10%
          let boardRankPass = false;  // 股票在板块内排名前10%
          
          // 确定T-Day
          const strongType = (stock as any).strongType || this.detectStrongType(klines, klines.length - 1);
          const tDayIndex = this.findTDay(klines, strongType, klines.length - 1, 10);
          if (tDayIndex < 0) {
            return { pass: false, reason: '未找到T-Day', secid: stock.secid };
          }
          const tDayDate = klines[tDayIndex].date;

          let boardCode = null;
          const boards = await dataProvider.getAllBoards(stock.bk, tDayDate);
          if (boards && boards.length > 0) {
            const sortedBoards = boards.sort((a, b) => b.zf - a.zf);
            const boardRank = sortedBoards.findIndex(b => b.name === stock.bk);
            if (boardRank >= 0) {
              boardPass = (boardRank + 1) <= boards.length * 0.1;
              boardCode = boards[boardRank].code;
            } else {
              console.log(`[OptBacktest] [${today}] ${stock.secid} 板块排名: ${boardRank >= 0 ? boardRank + 1 : '未找到'}/${boards.length}，未进前10%`);
            }
          }
          
          if (!boardPass) {
            return { pass: false, reason: '板块未进全市场前10%', secid: stock.secid };
          }
          if (strongType === 'limit_up') {
              boardRankPass = true;
          } else {
              // 条件2：T-Day 股票在所属板块内涨幅排名前10%
              const boardStocks = await dataProvider.getBoardStocks(tDayDate, boardCode, stock.bk);
              if (boardStocks && boardStocks.length > 0) {
                  const sortedStocks = boardStocks.sort((a, b) => b.zf - a.zf);
                  const stockRank = sortedStocks.findIndex(s => s.secid === stock.secid);
                  if (stockRank >= 0 && (stockRank + 1) <= boardStocks.length * 0.1) {
                      boardRankPass = true;
                      console.log(`[OptBacktest] [${today}] ${stock.secid} 板块内排名: ${stockRank + 1}/${boardStocks.length} (前10%)`);
                  } else {
                      console.log(`[OptBacktest] [${today}] ${stock.secid} 板块内排名: ${stockRank >= 0 ? stockRank + 1 : '未找到'}/${boardStocks.length}，未进前10%`);
                  }
              } else {
                  // 如果无法获取板块成分股，默认通过（避免数据缺失导致全部失败）
                  console.log(`[OptBacktest] [${today}] ${stock.secid} 无法获取板块成分股，默认通过板块内排名检查`);
                  boardRankPass = true;
              }
          }

          if (!boardRankPass) {
            const reason = '股票未进板块内前10%';
            return { pass: false, reason, secid: stock.secid };
          }

          const currentPrice = klines[lastIndex].sp;
          return {
            pass: true,
            secid: stock.secid,
            score: bestScore,
            boardCode: stock.bk,
            price: currentPrice,
            reason: `${bestType?.toUpperCase()}策略得分${bestScore.toFixed(1)}, M-Day=${mDayKline.date}, T-Day=${tDayDate}`,
            strategyType: bestType,
            strategyParams: bestResult
          };
        })
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const value = result.value as any;
          if (value.pass) {
            buyCandidates.push({
              secid: value.secid,
              score: value.score,
              boardCode: value.boardCode,
              price: value.price,
              reason: value.reason,
              strategyType: value.strategyType,
              strategyParams: value.strategyParams
            });
            console.log(`[OptBacktest] [${today}] ${value.secid} ✅ 通过筛选 | ${value.reason}`);
          } else {
            if (value.reason !== 'K线不足') {
              console.log(`[OptBacktest] [${today}] ${value.secid} ❌ 筛选失败: ${value.reason}`);
            }
          }
        } else {
          console.log(`[OptBacktest] [${today}] 批量处理异常:`, result.reason);
        }
      }
    }

    console.log(`[OptBacktest] [${today}] 候选股票: ${buyCandidates.length} 只`);

    // 2-4: 排序和仓位筛选
    if (buyCandidates.length > 0) {
      buyCandidates.sort((a, b) => b.score - a.score);
      console.log(`[OptBacktest] [${today}] 候选排序前5:`, buyCandidates.slice(0, 5).map(c => `${c.secid}(${c.score.toFixed(1)})`));

      const boardHoldings = new Map<string, number>();
      for (const pos of this.positions.values()) {
        boardHoldings.set(pos.boardCode, (boardHoldings.get(pos.boardCode) || 0) + 1);
      }

      for (const candidate of buyCandidates) {
        if (this.positions.size >= this.MAX_POSITIONS) {
          console.log(`[OptBacktest] [${today}] 买入停止: 已达最大持仓数 ${this.MAX_POSITIONS}`);
          break;
        }

        const boardCount = boardHoldings.get(candidate.boardCode) || 0;
        if (boardCount >= this.MAX_SAME_BOARD) {
          console.log(`[OptBacktest] [${today}] ${candidate.secid} 买入跳过: 板块${candidate.boardCode}已有${boardCount}只持仓`);
          continue;
        }

        const standardAmount = this.capital * this.POSITION_RATIO;
        const maxBuyAmount = Math.min(standardAmount, this.availableCash);
        const adjustedPrice = candidate.price * (1 + this.SLIPPAGE);
        const quantity = Math.floor(maxBuyAmount / adjustedPrice / 100) * 100;
        const actualAmount = adjustedPrice * quantity;

        if (actualAmount < this.capital * this.MIN_POSITION_RATIO || quantity < 100) {
          console.log(`[OptBacktest] [${today}] ${candidate.secid} 买入跳过: 资金不足或低于最小仓位`);
          break;
        }

        this.pendingOrders.push({
          secid: candidate.secid,
          type: 'buy',
          reason: candidate.reason,
          signalDate: today,
          boardCode: candidate.boardCode,
          strategyType: candidate.strategyType,
          strategyParams: candidate.strategyParams
        });
        boardHoldings.set(candidate.boardCode, boardCount + 1);
        console.log(`[OptBacktest] [${today}] ${candidate.secid} ✅ 生成买入订单 (次日${nextDay}执行) | 评分${candidate.score.toFixed(1)} | 板块${candidate.boardCode}`);
      }
    } else {
      console.log(`[OptBacktest] [${today}] 无买入候选触发`);
    }

    return false;
  }

  // ===== 阶段3: 记录净值 =====
  private async recordDailyValue(date: string, dataProvider: StrategyDataProvider): Promise<boolean> {
    let stockValue = 0;
    let positionDetails: Array<{ secid: string; close: number; quantity: number; value: number }> = [];

    for (const [secid, pos] of this.positions) {
      if (this.isCancelled()) return true;
      await this.waitIfPaused();
      if (this.isCancelled()) return true;

      const klines = await dataProvider.getKLines(secid, date, 1);
      if (klines && klines.length > 0) {
        const close = klines[klines.length - 1].sp;
        const value = close * pos.quantity;
        stockValue += value;
        positionDetails.push({ secid, close, quantity: pos.quantity, value });
      } else {
        stockValue += pos.buyAmount;
        positionDetails.push({ secid, close: pos.buyPrice, quantity: pos.quantity, value: pos.buyAmount });
      }
    }

    const totalValue = this.availableCash + stockValue;
    this.dailyValues.push({ date, totalValue });

    if (positionDetails.length > 0) {
      console.log(`[OptBacktest] [${date}] 净值明细: 现金${this.availableCash.toFixed(2)} + 股票市值${stockValue.toFixed(2)} = 总净值${totalValue.toFixed(2)}`);
      console.table(positionDetails);
    } else {
      console.log(`[OptBacktest] [${date}] 净值: ${totalValue.toFixed(2)} (空仓)`);
    }
    return false;
  }

  // ===== 结果计算 =====
  private calculateResult(): StrategyBacktestResult {
    const finalValue = this.dailyValues[this.dailyValues.length - 1]?.totalValue || this.initialCapital;
    const totalReturn = (finalValue - this.initialCapital) / this.initialCapital;
    const days = this.dailyValues.length;
    const annualizedReturn = days > 0 ? Math.pow(1 + totalReturn, 252 / days) - 1 : 0;

    let maxDrawdown = 0;
    let peak = this.initialCapital;
    let peakDate = this.dailyValues[0]?.date || '';
    let troughDate = this.dailyValues[0]?.date || '';

    for (const dv of this.dailyValues) {
      if (dv.totalValue > peak) {
        peak = dv.totalValue;
        peakDate = dv.date;
      }
      const dd = (peak - dv.totalValue) / peak;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        troughDate = dv.date;
      }
    }

    const sellTrades = this.tradeRecords.filter(t => t.type === 'sell');
    const winTrades = sellTrades.filter(t => (t.pnl || 0) > 0);
    const winRate = sellTrades.length > 0 ? winTrades.length / sellTrades.length : 0;

    const totalProfit = winTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const lossTrades = sellTrades.filter(t => (t.pnl || 0) <= 0);
    const totalLoss = lossTrades.reduce((sum, t) => sum + Math.abs(t.pnl || 0), 0);
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : (totalProfit > 0 ? Infinity : 0);

    const returns: number[] = [];
    for (let i = 1; i < this.dailyValues.length; i++) {
      returns.push((this.dailyValues[i].totalValue - this.dailyValues[i - 1].totalValue) / this.dailyValues[i - 1].totalValue);
    }
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdReturn = returns.length > 0
      ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length)
      : 0;
    const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

    const holdingDays: number[] = [];
    for (const sell of sellTrades) {
      const buy = this.tradeRecords.find(
        t => t.secid === sell.secid && t.type === 'buy' && t.date <= sell.date
      );
      if (buy) {
        holdingDays.push(this.getTradeDaysDiff(buy.date, sell.date));
      }
    }
    const avgHoldingDays = holdingDays.length > 0
      ? holdingDays.reduce((a, b) => a + b, 0) / holdingDays.length
      : 0;

    const result: StrategyBacktestResult = {
      totalReturn,
      annualizedReturn,
      maxDrawdown,
      winRate,
      profitFactor,
      sharpeRatio,
      totalTrades: sellTrades.length,
      avgHoldingDays,
      trades: this.tradeRecords,
      dailyValues: this.dailyValues
    };

    console.log(`[OptBacktest] 结果指标:`, {
      初始资金: this.initialCapital,
      最终资金: finalValue.toFixed(2),
      总收益率: (totalReturn * 100).toFixed(2) + '%',
      年化收益率: (annualizedReturn * 100).toFixed(2) + '%',
      最大回撤: (maxDrawdown * 100).toFixed(2) + '%',
      回撤区间: `${peakDate} → ${troughDate}`,
      胜率: (winRate * 100).toFixed(2) + '%',
      盈亏比: profitFactor.toFixed(2),
      夏普比率: sharpeRatio.toFixed(2),
      总交易次数: sellTrades.length,
      平均持仓天数: avgHoldingDays.toFixed(1)
    });

    console.log(`[OptBacktest] 买卖记录汇总:`);
    console.table(this.tradeRecords.map(t => ({
      日期: t.date,
      股票: t.secid,
      方向: t.type,
      价格: t.price.toFixed(2),
      数量: t.quantity,
      金额: t.amount.toFixed(2),
      盈亏: t.pnl !== undefined ? (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(2) : '-',
      原因: t.reason
    })));

    return result;
  }

  // ===== 策略信号检测 =====
  private checkMACDBuySignal(klines: Stock.KLineItem[], params: MACDStrategyResult, checkDays: number = 3): number {
    const closes = klines.map(k => k.sp);
    const macd = calculateMACD(closes, params.slow, params.fast, params.signal);
    const dif = macd.MACD;
    const dea = macd.signal;
    const hist = macd.histogram;

    const endIdx = closes.length;
    const startIdx = Math.max(2, endIdx - checkDays);

    for (let i = startIdx; i < endIdx; i++) {
      if (isNaN(dif[i]) || isNaN(dea[i])) continue;

      const goldenCross = dif[i] > dea[i] && dif[i - 1] <= dea[i - 1];
      if (!goldenCross) continue;

      if (params.requireAboveZero && (dif[i] <= 0 || dea[i] <= 0)) continue;

      if (params.requirePriorNegative) {
        let hadNegative = false;
        for (let j = Math.max(0, i - 5); j < i; j++) {
          if (hist[j] < 0) { hadNegative = true; break; }
        }
        if (!hadNegative) continue;
      }

      if (hist[i] <= 0 || hist[i] <= hist[i - 1]) continue;

      return i;
    }
    return -1;
  }

  private checkRSIBuySignal(klines: Stock.KLineItem[], params: RSIBacktestResult, checkDays: number = 3): number {
    const closes = klines.map(k => k.sp);
    const rsi = Indicators.calculateRSI(closes, params.rsiPeriod);

    const endIdx = closes.length;
    const startIdx = Math.max(1, endIdx - checkDays);

    for (let i = startIdx; i < endIdx; i++) {
      if (isNaN(rsi[i]) || isNaN(rsi[i - 1])) continue;

      let inOversold = false;
      for (let j = Math.max(0, i - 10); j <= i; j++) {
        if (rsi[j] <= params.buyThreshold) {
          inOversold = true;
          break;
        }
      }

      if (inOversold && rsi[i - 1] <= params.buyThreshold && rsi[i] > params.buyThreshold) {
        return i;
      }
    }
    return -1;
  }

  private checkMACDSellSignal(klines: Stock.KLineItem[], params: MACDStrategyResult): boolean {
    const closes = klines.map(k => k.sp);
    const macd = calculateMACD(closes, params.slow, params.fast, params.signal);
    const dif = macd.MACD;
    const dea = macd.signal;
    const hist = macd.histogram;
    const i = closes.length - 1;

    if (i < 2 || isNaN(dif[i]) || isNaN(dea[i])) return false;

    const deadCross = dif[i] < dea[i] && dif[i - 1] >= dea[i - 1];
    if (deadCross) return true;

    if (hist[i] > 0 && hist[i] < hist[i - 1] && hist[i - 1] < hist[i - 2]) {
      const sharpShrink = hist[i] < hist[i - 1] * 0.7;
      if (sharpShrink) return true;
    }

    return false;
  }

  private checkRSISellSignal(klines: Stock.KLineItem[], params: RSIBacktestResult): boolean {
    const closes = klines.map(k => k.sp);
    const rsi = Indicators.calculateRSI(closes, params.rsiPeriod);
    const i = closes.length - 1;

    if (i < 0 || isNaN(rsi[i])) return false;
    if (rsi[i] >= params.sellThreshold) return true;

    return false;
  }

  // ===== K线形态判断 =====
  private isLimitUp(kline: Stock.KLineItem, prevClose: number): boolean {
    const risePct = (kline.sp - prevClose) / prevClose;
    const isSealed = Math.abs(kline.zg - kline.sp) / prevClose < 0.005;
    return risePct >= 0.099 && isSealed;
  }

  private isNewHigh60(klines: Stock.KLineItem[], index: number): boolean {
    if (index < 1) return false;
    const currentPrice = klines[index].sp;
    const startIdx = Math.max(0, index - 60);
    const maxPrice = Math.max(...klines.slice(startIdx, index).map(k => k.zg));
    return currentPrice >= maxPrice;
  }

  private hasLongUpperShadow(kline: Stock.KLineItem): boolean {
    const bodyTop = Math.max(kline.kp, kline.sp);
    const upperShadow = kline.zg - bodyTop;
    const range = kline.zg - kline.zd;
    if (range <= 0) return false;
    return (upperShadow / range > 0.5) && (upperShadow / kline.kp > 0.02);
  }

  private detectStrongType(klines: Stock.KLineItem[], index: number): 'limit_up' | 'new_high_60' {
    const prevClose = klines[index - 1].sp;
    if (this.isLimitUp(klines[index], prevClose)) {
      return 'limit_up';
    }
    return 'new_high_60';
  }

  private findTDay(
    klines: Stock.KLineItem[],
    strongType: 'limit_up' | 'new_high_60',
    mDayIndex: number,
    maxLookback: number = 10
  ): number {
    const startIdx = Math.max(1, mDayIndex - maxLookback);

    if (strongType === 'limit_up') {
      for (let i = startIdx; i <= mDayIndex; i++) {
        const prevClose = klines[i - 1].sp;
        if (this.isLimitUp(klines[i], prevClose)) {
          return i;
        }
      }
    } else {
      for (let i = startIdx; i <= mDayIndex; i++) {
        if (this.isNewHigh60(klines, i)) {
          return i;
        }
      }
    }
    return -1;
  }

  // ===== 通用工具 =====
  private getTradeDaysDiff(date1: string, date2: string): number {
    const idx1 = this.tradeDays.indexOf(date1);
    const idx2 = this.tradeDays.indexOf(date2);
    if (idx1 < 0 || idx2 < 0) return 0;
    return Math.abs(idx2 - idx1);
  }

  private isCancelled(): boolean {
    return this.cancelOptions?.onShouldCancel?.() ?? false;
  }

  private async waitIfPaused(): Promise<boolean> {
    while (this.cancelOptions?.onShouldPause?.()) {
      await new Promise(resolve => setTimeout(resolve, 500));
      if (this.isCancelled()) {
        return true;
      }
    }
    return false;
  }
}