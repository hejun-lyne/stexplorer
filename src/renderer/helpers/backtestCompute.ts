import { Stock } from '@/types/stock';
import { calculateMACD, calculateRSI } from '@/helpers/tech';
import * as Indicators from '@/helpers/tech';

import type {
  MABacktestTrade,
  MABacktestResult,
  MACDTrade,
  MACDStrategyResult,
  RSIBacktestTrade,
  RSIBacktestResult,
} from './backtestEngine';

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

// ===== 均线回踩买入策略参数优化 =====
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

// ===== MACD 策略参数优化回测 =====
export function optimizeMACDStrategy(
  klines: Stock.KLineItem[],
  // 止损参数
  fixedStopLossPct: number = 0.05,
  trailingStopLossPct: number = 0.06
): MACDStrategyResult[] {
  const closes = klines.map(k => k.sp);
  const allResults: MACDStrategyResult[] = [];

  // 参数网格
  const fastPeriods = [8, 12];        // 2 个：灵敏 + 标准
  const slowPeriods = [21, 26];       // 2 个：短趋势 + 标准趋势
  const signalPeriods = [9];            // 1 个：固定
  const aboveZeroOptions =  [true, false];      // 是否要求零轴上方金叉
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

// ===== RSI 策略参数优化回测 =====
export function optimizeRSIStrategy(
  klines: Stock.KLineItem[],
  rsiPeriods: number[] = [12, 24],
  // 止损参数
  fixedStopLossPct: number = 0.05,
  trailingStopLossPct: number = 0.06,
  // RSI 参数网格
  buyThresholds: number[] = [35, 40, 45],
  sellThresholds: number[] = [65, 70, 75, 80, 85]
): RSIBacktestResult[] {
  const testKlines = klines.slice(-120);
  const startIndex = klines.length - testKlines.length;
  const closes = testKlines.map(k => k.sp);
  const allResults: RSIBacktestResult[] = [];

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
            // [优化] 卖出信号：RSI冲高回落（前一天超买，今天回落）
            let sellPrice: number;
            let exitReason: RSIBacktestTrade['exitReason'];

            if (shouldStop) {
              sellPrice = closes[i];
              exitReason = stopReason as RSIBacktestTrade['exitReason'];
            } else if (rsi[i - 1] >= sellTh && rsi[i] < rsi[i - 1]) {
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

// ===== 纯计算：信号检测与K线形态（可在Worker中运行） =====

export interface ScreenResult {
  pass: boolean;
  reason?: string;
  secid: string;
  score?: number;
  bestType?: 'macd' | 'rsi';
  bestResult?: MACDStrategyResult | RSIBacktestResult;
  mDayIndex?: number;
  tDayIndex?: number;
  mDayDate?: string;
  tDayDate?: string;
  strongType?: 'limit_up' | 'new_high_60';
}

export interface BatchBacktestAndScreenItem {
  stock: { secid: string; bk: string };
  klines: Stock.KLineItem[];
}

export interface BatchBacktestAndScreenResult {
  macdResults: MACDStrategyResult[];
  rsiResults: RSIBacktestResult[];
  screenResult: ScreenResult;
}

export function checkMACDBuySignal(
  klines: Stock.KLineItem[],
  params: MACDStrategyResult,
  checkDays: number = 3
): number {
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

// backtestCompute.ts 中 checkRSIBuySignal 或 backtestEngine.ts 买入检测
export function checkRSIBuySignal(
  klines: Stock.KLineItem[],
  params: RSIBacktestResult,
  checkDays: number = 3
): number {
  const closes = klines.map(k => k.sp);
  const rsi = calculateRSI(closes, params.rsiPeriod);
  const endIdx = closes.length;
  const startIdx = Math.max(1, endIdx - checkDays);

  for (let i = startIdx; i < endIdx; i++) {
    if (isNaN(rsi[i]) || isNaN(rsi[i - 1])) continue;

    // 条件1：RSI 从超卖区上穿
    let inOversold = false;
    for (let j = Math.max(0, i - 10); j <= i; j++) {
      if (rsi[j] <= params.buyThreshold) { inOversold = true; break; }
    }
    if (!inOversold || !(rsi[i - 1] <= params.buyThreshold && rsi[i] > params.buyThreshold)) {
      continue;
    }

    // [新增] 条件2：当日必须收阳（收盘价 > 开盘价）
    if (klines[i].sp <= klines[i].kp) continue;

    // [新增] 条件3：当日最低价不能创近期新低（停止创新低）
    const recentLow = Math.min(...klines.slice(Math.max(0, i - 5), i).map(k => k.zd));
    if (klines[i].zd < recentLow * 0.995) continue; // 允许微小误差

    return i;
  }
  return -1;
}

export function hasLongUpperShadow(kline: Stock.KLineItem): boolean {
  const bodyTop = Math.max(kline.kp, kline.sp);
  const upperShadow = kline.zg - bodyTop;
  const range = kline.zg - kline.zd;
  if (range <= 0) return false;
  return (upperShadow / range > 0.5) && (upperShadow / kline.kp > 0.02);
}

export function isLimitUp(kline: Stock.KLineItem, prevClose: number): boolean {
  const risePct = (kline.sp - prevClose) / prevClose;
  const isSealed = Math.abs(kline.zg - kline.sp) / prevClose < 0.005;
  return risePct >= 0.099 && isSealed;
}

export function isNewHigh60(klines: Stock.KLineItem[], index: number): boolean {
  if (index < 1) return false;
  const currentPrice = klines[index].zg;
  const startIdx = Math.max(0, index - 60);
  const maxPrice = Math.max(...klines.slice(startIdx, index).map(k => k.zg));
  return currentPrice >= maxPrice;
}

export function detectStrongType(klines: Stock.KLineItem[], strongDate: string): 'limit_up' | 'new_high_60' {
  const index = klines.findIndex(k => k.date === strongDate);
  if (index < 0) return 'new_high_60';

  const prevClose = klines[index - 1].sp;
  if (isLimitUp(klines[index], prevClose)) {
    return 'limit_up';
  }
  return 'new_high_60';
}

export function findTDay(
  klines: Stock.KLineItem[],
  strongType: 'limit_up' | 'new_high_60',
  strongDate: string,
  maxLookback: number = 10
): number {
  const strongDayIndex = klines.findIndex(k => k.date === strongDate);
  if (strongDayIndex < 0) return -1;
  const startIdx = Math.max(1, strongDayIndex - maxLookback);
  if (strongType === 'limit_up') {
    for (let i = startIdx; i <= strongDayIndex; i++) {
      const prevClose = klines[i - 1].sp;
      if (isLimitUp(klines[i], prevClose)) {
        return i;
      }
    }
  } else {
    for (let i = startIdx; i <= strongDayIndex; i++) {
      if (isNewHigh60(klines, i)) {
        return i;
      }
    }
  }
  return -1;
}

export function batchBacktestAndScreen(
  items: BatchBacktestAndScreenItem[],
  backtestParams: {
    fixedStopLossPct: number;
    trailingStopLossPct: number;
    strategyMode?: 'macd' | 'rsi' | 'both';
    buyThresholds?: number[];
    sellThresholds?: number[];
  },
  screenParams: { strongStockDay:string, minStrategyScore: number; strongLookback: number }
): BatchBacktestAndScreenResult[] {
  const results: BatchBacktestAndScreenResult[] = [];

  for (const item of items) {
    const { stock, klines } = item;

    const strategyMode = backtestParams.strategyMode || 'both';
    const macdResults = strategyMode !== 'rsi'
      ? optimizeMACDStrategy(klines, backtestParams.fixedStopLossPct, backtestParams.trailingStopLossPct)
      : [];
    const rsiResults = strategyMode !== 'macd'
      ? optimizeRSIStrategy(
          klines,
          [12, 24],
          backtestParams.fixedStopLossPct,
          backtestParams.trailingStopLossPct,
          backtestParams.buyThresholds,
          backtestParams.sellThresholds
        )
      : [];

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

    let screenResult: ScreenResult;
    if (!bestResult) {
      screenResult = { pass: false, reason: `未找到最佳策略`, secid: stock.secid };
    } else if (bestScore < screenParams.minStrategyScore) {
      screenResult = { pass: false, reason: `策略得分不足(${bestScore.toFixed(1)})`, secid: stock.secid };
    } else {
      
      let mDayIndex = -1;
      if (bestType === 'macd') {
        mDayIndex = checkMACDBuySignal(klines, bestResult as MACDStrategyResult, 3);
      } else {
        mDayIndex = checkRSIBuySignal(klines, bestResult as RSIBacktestResult, 3);
      }

      // 先计算 strongType 和 tDay，无论是否有买入信号（观察列表需要）
      const strongType = detectStrongType(klines, screenParams.strongStockDay);
      const tDayIndex = findTDay(klines, strongType, screenParams.strongStockDay, screenParams.strongLookback);
      // 用strongStockDay兜底
      const tDayDate = tDayIndex >= 0 ? klines[tDayIndex].date : screenParams.strongStockDay;

      if (mDayIndex < 0) {
        screenResult = {
          pass: false,
          reason: '最近3天无买入信号',
          secid: stock.secid,
          score: bestScore,
          bestType: bestType!,
          bestResult: bestResult!,
          tDayDate,
          strongType,
        };
      } else {
        const lastIndex = klines.length - 1;
        const mDayKline = klines[mDayIndex];

        let failReason = '';
        if (mDayIndex < lastIndex) {
          for (let j = mDayIndex + 1; j <= lastIndex; j++) {
            if (hasLongUpperShadow(klines[j])) {
              failReason = `M-Day后出现长上影线(${klines[j].date})`;
              break;
            }
          }
          if (!failReason) {
            const mDayEntityLow = Math.min(mDayKline.kp, mDayKline.sp);
            for (let j = mDayIndex + 1; j <= lastIndex; j++) {
              if (klines[j].sp < mDayEntityLow) {
                failReason = `M-Day后跌破实体最低价(${klines[j].date})`;
                break;
              }
            }
          }
        }

        if (failReason) {
          screenResult = { 
            pass: false, 
            reason: failReason, 
            secid: stock.secid,
            score: bestScore,
            bestType: bestType!,
            bestResult: bestResult!,
            mDayIndex,
            mDayDate: mDayKline.date,
            strongType,
          };
        } else {
          if (tDayIndex < 0) {
            screenResult = { 
              pass: false, 
              reason: '未找到T-Day', 
              secid: stock.secid,
              score: bestScore,
              bestType: bestType!,
              bestResult: bestResult!,
              mDayIndex,
              mDayDate: mDayKline.date,
              strongType,
            };
          } else {
            screenResult = {
              pass: true,
              secid: stock.secid,
              score: bestScore,
              bestType: bestType!,
              bestResult: bestResult!,
              mDayIndex,
              tDayIndex,
              mDayDate: mDayKline.date,
              tDayDate: klines[tDayIndex].date,
              strongType,
              reason: `${bestType?.toUpperCase()}策略得分${bestScore.toFixed(1)}, M-Day=${mDayKline.date}, T-Day=${klines[tDayIndex].date}`,
            };
          }
        }
      }
    }

    results.push({ macdResults, rsiResults, screenResult });
  }

  return results;
}