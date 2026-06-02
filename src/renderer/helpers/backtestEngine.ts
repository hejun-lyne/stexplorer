import { Stock } from '@/types/stock';
import { calculateMACD } from '@/helpers/tech';
import * as Indicators from '@/helpers/tech';

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

export interface Position {
    secid: string;
    boardCode: string;
    buyDate: string;
    buyPrice: number;
    quantity: number;
    buyAmount: number;
    highestPrice: number;
}

export interface WatchItem {
    secid: string;
    addedDate: string;
    score: number;
    boardCode: string;
    maxRSI: number;
    maxPrice: number;
}

export interface PendingOrder {
    secid: string;
    type: 'buy' | 'sell';
    reason: string;
    signalDate: string;
}

export interface TradeRecord {
    date: string;
    secid: string;
    type: 'buy' | 'sell';
    price: number;
    quantity: number;
    amount: number;
    reason: string;
    pnl?: number;
}

export interface DailyValue {
    date: string;
    totalValue: number;
}

export interface BacktestResult {
    totalReturn: number;
    annualizedReturn: number;
    maxDrawdown: number;
    winRate: number;
    profitFactor: number;
    sharpeRatio: number;
    totalTrades: number;
    avgHoldingDays: number;
    trades: TradeRecord[];
    dailyValues: DailyValue[];
}

export interface DataProvider {
    getStrongStocks(date: string): Promise<Stock.DetailItem[]>;
    getKLines(secid: string, endDate: string, days?: number): Promise<Stock.KLineItem[] | null>;
    getBoardData(name: string, endDate: string): Promise<Stock.BoardItem | null>;
}
export class OptimizeBacktest {
    private initialCapital: number;
    private capital: number;
    private availableCash: number;
    private positions: Map<string, Position> = new Map();
    private watchList: Map<string, WatchItem> = new Map();
    private pendingOrders: PendingOrder[] = [];
    private tradeRecords: TradeRecord[] = [];
    private dailyValues: DailyValue[] = [];
    private tradeDays: string[];
    private cancelOptions?: { onShouldCancel?: () => boolean; onShouldPause?: () => boolean };

    private readonly MAX_POSITIONS = 8;
    private readonly POSITION_RATIO = 0.125;
    private readonly MAX_SAME_BOARD = 2;
    private readonly MIN_POSITION_RATIO = 0.05;
    private readonly STOP_LOSS_PCT = 0.93;
    private readonly TRAILING_STOP_PCT = 0.90;
    private readonly MIN_SCORE = 60;
    private readonly MAX_WATCHLIST = 20;
    private readonly WATCHLIST_SCORE_DECAY = 2;
    private readonly WATCHLIST_MAX_AGE = 10;     // 从15天缩短到10天（板块驱动不需要等太久）
    private readonly SLIPPAGE = 0.001;
    private readonly COMMISSION = 0.0003;
    private readonly STAMP_TAX = 0.001;
    private readonly RSI_PERIOD = 6;
    private readonly RSI_LOOKBACK = 5;
    private readonly BATCH_SIZE = 10;

    constructor(tradeDays: string[], initialCapital: number = 1000000) {
        this.tradeDays = tradeDays.map(d => this.normalizeDate(d));
        this.initialCapital = initialCapital;
        this.capital = initialCapital;
        this.availableCash = initialCapital;
        console.log(`[Backtest] 初始化完成 | 初始资金: ${initialCapital.toLocaleString()} | 交易日数: ${tradeDays.length}`);
    }

    public async run(
        dataProvider: DataProvider,
        onProgress?: (message: string, percent?: number) => void,
        options?: { onShouldCancel?: () => boolean; onShouldPause?: () => boolean }
    ): Promise<BacktestResult> {
        this.cancelOptions = options;
        const totalDays = this.tradeDays.length;
        const dayPercentStep = totalDays > 0 ? 90 / totalDays : 0;

        console.log(`[Backtest] ====== 回测开始 ======`);
        console.log(`[Backtest] 参数配置:`, {
            MAX_POSITIONS: this.MAX_POSITIONS,
            POSITION_RATIO: this.POSITION_RATIO,
            MAX_SAME_BOARD: this.MAX_SAME_BOARD,
            MIN_POSITION_RATIO: this.MIN_POSITION_RATIO,
            STOP_LOSS_PCT: this.STOP_LOSS_PCT,
            TRAILING_STOP_PCT: this.TRAILING_STOP_PCT,
            MIN_SCORE: this.MIN_SCORE,
            MAX_WATCHLIST: this.MAX_WATCHLIST,
            WATCHLIST_SCORE_DECAY: this.WATCHLIST_SCORE_DECAY,
            WATCHLIST_MAX_AGE: this.WATCHLIST_MAX_AGE,
            SLIPPAGE: this.SLIPPAGE,
            COMMISSION: this.COMMISSION,
            STAMP_TAX: this.STAMP_TAX,
            RSI_PERIOD: this.RSI_PERIOD,
            RSI_LOOKBACK: this.RSI_LOOKBACK,
            BATCH_SIZE: this.BATCH_SIZE
        });

        for (let i = 0; i < totalDays; i++) {
            if (this.isCancelled()) {
                console.log(`[Backtest] 回测在第 ${i + 1}/${totalDays} 天被取消`);
                onProgress?.('回测已取消', 100);
                return this.calculateResult();
            }
            const cancelledDuringPause = await this.waitIfPaused();
            if (cancelledDuringPause) {
                console.log(`[Backtest] 回测在暂停期间被取消`);
                onProgress?.('回测已取消', 100);
                return this.calculateResult();
            }

            const today = this.tradeDays[i];
            const currentBase = Math.round(i * dayPercentStep);

            console.log(`\n[Backtest] ---------- 第 ${i + 1}/${totalDays} 天 [${today}] ----------`);
            console.log(`[Backtest] 当前持仓: ${this.positions.size} 只 | 观察列表: ${this.watchList.size} 只 | 可用资金: ${this.availableCash.toFixed(2)}`);

            onProgress?.(`[${i + 1}/${totalDays}] ${today} 执行待处理订单...`, currentBase);
            console.log(`[Backtest] [${today}] 阶段1: 执行待处理订单 ${this.pendingOrders.length} 笔`);
            if (await this.executePendingOrders(today, dataProvider)) {
                onProgress?.('回测已取消', 100);
                return this.calculateResult();
            }

            if (i < totalDays - 1) {
                const nextDay = this.tradeDays[i + 1];
                onProgress?.(`[${i + 1}/${totalDays}] ${today} 生成交易信号...`, Math.round(currentBase + dayPercentStep * 0.3));
                console.log(`[Backtest] [${today}] 阶段2: 生成交易信号 (次日执行: ${nextDay})`);
                if (await this.generateSignals(today, nextDay, dataProvider, (msg) => {
                    onProgress?.(msg, Math.round(currentBase + dayPercentStep * 0.6));
                })) {
                    onProgress?.('回测已取消', 100);
                    return this.calculateResult();
                }
            }

            onProgress?.(`[${i + 1}/${totalDays}] ${today} 记录净值...`, Math.round(currentBase + dayPercentStep * 0.8));
            console.log(`[Backtest] [${today}] 阶段3: 记录净值`);
            if (await this.recordDailyValue(today, dataProvider)) {
                onProgress?.('回测已取消', 100);
                return this.calculateResult();
            }

            console.log(`[Backtest] [${today}] 日终状态: 持仓 ${this.positions.size} 只 | 观察 ${this.watchList.size} 只 | 净值 ${this.dailyValues[this.dailyValues.length - 1]?.totalValue.toFixed(2)}`);
        }

        onProgress?.('正在计算回测结果...', 95);
        console.log(`\n[Backtest] ====== 计算最终结果 ======`);
        const result = this.calculateResult();
        onProgress?.('回测完成！', 100);
        console.log(`[Backtest] ====== 回测结束 ======\n`);
        return result;
    }

    private async executePendingOrders(today: string, dataProvider: DataProvider): Promise<boolean> {
        if (this.pendingOrders.length === 0) {
            console.log(`[Backtest] [${today}] 无待执行订单`);
            return false;
        }

        for (const order of this.pendingOrders) {
            if (this.isCancelled()) return true;
            await this.waitIfPaused();
            if (this.isCancelled()) return true;

            const klines = await dataProvider.getKLines(order.secid, today, 1);
            if (!klines || klines.length === 0) {
                console.log(`[Backtest] [${today}] 订单执行失败: ${order.secid} 未获取到K线数据`);
                continue;
            }

            const todayKLine = klines.find(k => k.date === today);
            if (!todayKLine) {
                console.log(`[Backtest] [${today}] 订单执行失败: ${order.secid} 未找到当日K线 (可用日期: ${klines.map(k => k.date).join(',')})`);
                continue;
            }

            const openPrice = todayKLine.kp;

            if (order.type === 'buy') {
                console.log(`[Backtest] [${today}] 执行买入: ${order.secid} | 开盘价: ${openPrice.toFixed(2)} | 原因: ${order.reason}`);
                this.executeBuy(order.secid, today, openPrice, order.reason);
            } else if (order.type === 'sell') {
                const position = this.positions.get(order.secid);
                if (position) {
                    console.log(`[Backtest] [${today}] 执行卖出: ${order.secid} | 开盘价: ${openPrice.toFixed(2)} | 持仓成本: ${position.buyPrice.toFixed(2)} | 原因: ${order.reason}`);
                    this.executeSell(order.secid, today, openPrice, position.quantity, order.reason);
                } else {
                    console.log(`[Backtest] [${today}] 卖出订单忽略: ${order.secid} 无持仓`);
                }
            }
        }
        this.pendingOrders = [];
        return false;
    }

    /**
     * 板块驱动的买入信号判断
     * 核心逻辑：板块趋势 + 个股健康，不再执着于RSI深回调形态
     */
    private async generateSignals(
        today: string,
        nextDay: string,
        dataProvider: DataProvider,
        onProgress?: (message: string) => void
    ): Promise<boolean> {
        console.log(`[Backtest] [${today}] 阶段2-1: 处理观察列表 ${this.watchList.size} 只`);
        onProgress?.(`[${today}] 处理观察列表 ${this.watchList.size} 只...`);

        const buyCandidates: Array<{
            secid: string;
            score: number;
            boardCode: string;
            price: number;
            reason: string;
        }> = [];

        // 不用观察列表，直接取强势股票，增加板块数据，直接评分排序选出买入候选（核心改动）
        // 1. 获取5-10个交易日前的强势股票集合（去重）
        // 2. 对每只强势股票，调用接口optimizeMACDStrategy\optimizeRSIStrategy取得最佳macd\RSI参数和得分，取得分高的作为最佳策略保存
        // 3. 只保留得分超过100的股票进入候选列表，使用每个股票的最佳策略测试是否满足买入条件（MACD金叉或RSI超卖反弹），满足则加入最终候选列表
        // 4. 最后根据得分排序，加入待买入列表
        
        // 先处理持仓中的股票，更新最高价并判断卖出信号（保留原有RSI卖出逻辑）
        for (const [secid, watchInfo] of this.positions) {
            if (this.isCancelled()) return true;
            await this.waitIfPaused();
            if (this.isCancelled()) return true;

            const klines = await dataProvider.getKLines(secid, today, 60);
            if (!klines || klines.length < 20) {
                console.log(`[Backtest] [${today}] ${secid} 观察处理跳过: K线不足(${klines?.length || 0})`);
                continue;
            }

            const position = this.positions.get(secid);
            const currentPrice = klines[klines.length - 1].sp;

            // 更新持仓最高价
            if (position && currentPrice > position.highestPrice) {
                const oldHigh = position.highestPrice;
                position.highestPrice = currentPrice;
                console.log(`[Backtest] [${today}] ${secid} 更新最高价: ${oldHigh.toFixed(2)} → ${currentPrice.toFixed(2)}`);
            }

            
            // 使用保存的最佳策略参数进行卖出信号判断（核心修改）
          }


            // ========== 板块驱动买入判断（核心修改）==========
            if (!position) {
                let hasBuySignal = false;
                let buyReason = '';

                // 

                if (hasBuySignal) {
                    console.log(`[Backtest] [${today}] ${secid} ✅ 买入信号触发: ${buyReason}`);
                    buyCandidates.push({
                        secid,
                        score: 0,
                        boardCode: watchInfo.boardCode,
                        price: currentPrice,
                        reason: buyReason
                    });
                }
            }

            // 原有RSI卖出信号（顶背离/跌破60）保留
            if (position) {
                const signal = getTrendRSISignal(klines, rsiValues, this.RSI_LOOKBACK, watchInfo.maxRSI);
                if (signal.type === 'sell') {
                    console.log(`[Backtest] [${today}] ${secid} ✅ 生成RSI卖出订单: ${signal.reason}`);
                    this.pendingOrders.push({
                        secid: secid,
                        type: 'sell',
                        reason: signal.reason,
                        signalDate: today
                    });
                }
            }
        }

        // 按优先级选择买入候选
        if (buyCandidates.length > 0) {
            buyCandidates.sort((a, b) => b.score - a.score);
            console.log(`[Backtest] [${today}] 买入候选共 ${buyCandidates.length} 只，排序前5:`, buyCandidates.slice(0, 5).map(c => `${c.secid}(${c.score.toFixed(1)})`));

            const boardHoldings = new Map<string, number>();
            for (const pos of this.positions.values()) {
                boardHoldings.set(pos.boardCode, (boardHoldings.get(pos.boardCode) || 0) + 1);
            }

            for (const candidate of buyCandidates) {
                if (this.positions.size >= this.MAX_POSITIONS) {
                    console.log(`[Backtest] [${today}] 买入停止: 已达最大持仓数 ${this.MAX_POSITIONS}`);
                    break;
                }

                const boardCount = boardHoldings.get(candidate.boardCode) || 0;
                if (boardCount >= this.MAX_SAME_BOARD) {
                    console.log(`[Backtest] [${today}] ${candidate.secid} 买入跳过: 板块${candidate.boardCode}已有${boardCount}只持仓`);
                    continue;
                }

                const standardAmount = this.capital * this.POSITION_RATIO;
                const maxBuyAmount = Math.min(standardAmount, this.availableCash);
                const adjustedPrice = candidate.price * (1 + this.SLIPPAGE);
                const quantity = Math.floor(maxBuyAmount / adjustedPrice / 100) * 100;
                const actualAmount = adjustedPrice * quantity;

                if (actualAmount < this.capital * this.MIN_POSITION_RATIO || quantity < 100) {
                    console.log(`[Backtest] [${today}] ${candidate.secid} 买入跳过: 资金不足或低于最小仓位`);
                    break;
                }

                this.pendingOrders.push({
                    secid: candidate.secid,
                    type: 'buy',
                    reason: candidate.reason,
                    signalDate: today
                });
                boardHoldings.set(candidate.boardCode, boardCount + 1);
                console.log(`[Backtest] [${today}] ${candidate.secid} ✅ 生成买入订单 (次日${nextDay}执行) | 评分${candidate.score.toFixed(1)} | 板块${candidate.boardCode}`);
            }
        } else {
            console.log(`[Backtest] [${today}] 无买入候选触发`);
        }

        // ---- 阶段2: 补充观察列表（动态排行榜）----
        console.log(`[Backtest] [${today}] 阶段2-2: 获取强势股票并动态更新观察列表`);
        onProgress?.(`[${today}] 获取强势股票...`);
        const strongStocks = await dataProvider.getStrongStocks(today);
        console.log(`[Backtest] [${today}] 东财强势股票共 ${strongStocks.length} 只`);

        onProgress?.(`[${today}] 硬过滤+评分中...`);
        const newCandidates: Array<{
            secid: string;
            score: number;
            rawScore: number;
            matchScore: number;
            expansionRatio: number;
            boardCode: string;
            initialRSI: number;
            initialPrice: number;
        }> = [];

        let hardFilterPass = 0;
        let hardFilterFail = 0;
        let scoreDistribution: number[] = [];

        const filteredStocks = strongStocks.filter(s => !this.watchList.has(s.secid) && !this.positions.has(s.secid));
        console.log(`[Backtest] [${today}] 排除已监控/已持仓后剩余 ${filteredStocks.length} 只`);

        for (let batchStart = 0; batchStart < filteredStocks.length; batchStart += this.BATCH_SIZE) {
            if (this.isCancelled()) return true;
            await this.waitIfPaused();
            if (this.isCancelled()) return true;

            const batch = filteredStocks.slice(batchStart, batchStart + this.BATCH_SIZE);
            onProgress?.(`[${today}] 评分中 ${Math.min(batchStart + this.BATCH_SIZE, filteredStocks.length)}/${filteredStocks.length}...`);

            const batchResults = await Promise.allSettled(
                batch.map(async (stock) => {
                    const klines = await dataProvider.getKLines(stock.secid, today, 120);
                    const boardData = await dataProvider.getBoardData(stock.bk, today);

                    if (!klines || klines.length < 60) {
                        return { pass: false, reason: 'K线不足', stage: 'klines' };
                    }

                    const filterResult = hardFilter(stock, klines);
                    if (!filterResult.pass) {
                        return { pass: false, reason: filterResult.reason, stage: 'hardFilter' };
                    }

                    const metrics = calculateBreakoutMetrics(klines, today);
                    if (!metrics || metrics.expansionRatio < 1.2) {
                        return { pass: false, reason: `波动率不达标(${metrics?.expansionRatio.toFixed(2) || 'N/A'})`, stage: 'expansion' };
                    }

                    const marketCap = (stock as Stock.DetailItem).lt;
                    const score = calculateScore(klines, boardData, metrics, marketCap);

                    const recentKlines = klines.slice(-60);
                    const rsiValues = Tech.calculateRSI(recentKlines.map(k => k.sp), this.RSI_PERIOD);
                    const matchScore = this.backtestRSIOnHistory(recentKlines, rsiValues);
                    const finalScore = score * 0.7 + matchScore * 0.3;

                    const initialRSI = (rsiValues[rsiValues.length - 1] && rsiValues[rsiValues.length - 1] > 0) ? rsiValues[rsiValues.length - 1] : 50;
                    const initialPrice = klines[klines.length - 1].sp;

                    return {
                        pass: true,
                        secid: stock.secid,
                        score: finalScore,
                        rawScore: score,
                        matchScore,
                        expansionRatio: metrics.expansionRatio,
                        boardCode: stock.bk,
                        initialRSI,
                        initialPrice
                    };
                })
            );

            for (const result of batchResults) {
                if (result.status === 'fulfilled') {
                    const value = result.value as any;
                    if (value.pass) {
                        hardFilterPass++;
                        scoreDistribution.push(value.rawScore);
                        if (value.score >= this.MIN_SCORE) {
                            newCandidates.push({
                                secid: value.secid,
                                score: value.score,
                                rawScore: value.rawScore,
                                matchScore: value.matchScore,
                                expansionRatio: value.expansionRatio,
                                boardCode: value.boardCode,
                                initialRSI: value.initialRSI,
                                initialPrice: value.initialPrice
                            });
                        }
                    } else {
                        if (value.stage === 'hardFilter' || value.stage === 'expansion') hardFilterFail++;
                    }
                }
            }
        }

        console.log(`[Backtest] [${today}] ====== 每日统计 ======`);
        console.log(`[Backtest] [${today}] 硬过滤: 通过=${hardFilterPass}, 失败=${hardFilterFail}`);
        if (scoreDistribution.length > 0) {
            const avgScore = scoreDistribution.reduce((a, b) => a + b, 0) / scoreDistribution.length;
            const maxScore = Math.max(...scoreDistribution);
            const minScore = Math.min(...scoreDistribution);
            console.log(`[Backtest] [${today}] 评分分布: 平均=${avgScore.toFixed(1)}, 最高=${maxScore.toFixed(1)}, 最低=${minScore.toFixed(1)}`);
        }
        console.log(`[Backtest] [${today}] 评分门槛(${this.MIN_SCORE}): 通过=${newCandidates.length}`);
        console.log(`[Backtest] [${today}] ====== 统计结束 ======`);

        // 动态排行榜
        const combined: Array<{
            secid: string;
            score: number;
            boardCode: string;
            source: 'existing' | 'new';
            initialRSI?: number;
            initialPrice?: number;
        }> = [];

        for (const [secid, item] of this.watchList) {
            if (!this.positions.has(secid)) {
                const daysInWatch = this.getTradeDaysDiff(item.addedDate, today);
                const decayedScore = item.score - daysInWatch * this.WATCHLIST_SCORE_DECAY;
                combined.push({
                    secid,
                    score: decayedScore,
                    boardCode: item.boardCode,
                    source: 'existing'
                });
            }
        }

        for (const c of newCandidates) {
            combined.push({
                secid: c.secid,
                score: c.score,
                boardCode: c.boardCode,
                source: 'new',
                initialRSI: c.initialRSI,
                initialPrice: c.initialPrice
            });
        }

        combined.sort((a, b) => b.score - a.score);
        const topN = combined.slice(0, this.MAX_WATCHLIST);

        const newWatchList = new Map<string, WatchItem>();

        for (const [secid, item] of this.watchList) {
            if (this.positions.has(secid)) {
                newWatchList.set(secid, item);
            }
        }

        let addCount = 0;
        for (const c of topN) {
            if (c.source === 'new') {
                newWatchList.set(c.secid, {
                    secid: c.secid,
                    addedDate: today,
                    score: c.score,
                    boardCode: c.boardCode,
                    maxRSI: (c.initialRSI && c.initialRSI > 0) ? c.initialRSI : 50,
                    maxPrice: c.initialPrice || 0
                });
                addCount++;
                if (addCount <= 5 || c.score > 80) {
                    console.log(`[Backtest] [${today}] ${c.secid} 新加入观察列表 | 评分: ${c.score.toFixed(1)} | 板块: ${c.boardCode}`);
                }
            } else {
                const oldItem = this.watchList.get(c.secid)!;
                newWatchList.set(c.secid, oldItem);
            }
        }

        let removedCount = 0;
        for (const [secid, item] of this.watchList) {
            if (!this.positions.has(secid) && !newWatchList.has(secid)) {
                removedCount++;
            }
        }

        this.watchList = newWatchList;
        console.log(`[Backtest] [${today}] 观察列表动态更新: 新增 ${addCount} 只, 淘汰 ${removedCount} 只, 当前共 ${this.watchList.size} 只 (含持仓)`);
        return false;
    }

    private executeBuy(secid: string, date: string, price: number, reason: string) {
        const adjustedPrice = price * (1 + this.SLIPPAGE);
        const standardAmount = this.capital * this.POSITION_RATIO;
        const maxBuyAmount = Math.min(standardAmount, this.availableCash);
        const quantity = Math.floor(maxBuyAmount / adjustedPrice / 100) * 100;
        const actualAmount = adjustedPrice * quantity;

        if (actualAmount < this.capital * this.MIN_POSITION_RATIO || quantity < 100) {
            console.log(`[Backtest] [${date}] ${secid} 买入失败: 低于最小仓位或数量不足`);
            return;
        }

        const commission = actualAmount * this.COMMISSION;
        const totalCost = actualAmount + commission;

        if (this.availableCash < totalCost) {
            console.log(`[Backtest] [${date}] ${secid} 买入失败: 资金不足`);
            return;
        }

        this.availableCash -= totalCost;

        const watchItem = this.watchList.get(secid);
        const boardCode = watchItem?.boardCode || '';

        this.positions.set(secid, {
            secid: secid,
            boardCode: boardCode,
            buyDate: date,
            buyPrice: adjustedPrice,
            quantity,
            buyAmount: totalCost,
            highestPrice: adjustedPrice
        });

        console.log(`[Backtest] [${date}] ${secid} 买入成功: 价${adjustedPrice.toFixed(2)} | 量${quantity} | 总成本${totalCost.toFixed(2)} | 剩余资金${this.availableCash.toFixed(2)}`);

        this.tradeRecords.push({
            date,
            secid: secid,
            type: 'buy',
            price: adjustedPrice,
            quantity,
            amount: totalCost,
            reason
        });
    }

    private executeSell(secid: string, date: string, price: number, quantity: number, reason: string) {
        const position = this.positions.get(secid);
        if (!position) {
            console.log(`[Backtest] [${date}] ${secid} 卖出失败: 无持仓`);
            return;
        }

        const adjustedPrice = price * (1 - this.SLIPPAGE);
        const totalAmount = adjustedPrice * quantity;
        const commission = totalAmount * this.COMMISSION;
        const stampTax = totalAmount * this.STAMP_TAX;
        const netAmount = totalAmount - commission - stampTax;

        this.availableCash += netAmount;
        const pnl = netAmount - position.buyAmount;

        console.log(`[Backtest] [${date}] ${secid} 卖出成功: 价${adjustedPrice.toFixed(2)} | 量${quantity} | 净额${netAmount.toFixed(2)} | 盈亏${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} | 剩余资金${this.availableCash.toFixed(2)}`);

        this.tradeRecords.push({
            date,
            secid: secid,
            type: 'sell',
            price: adjustedPrice,
            quantity,
            amount: netAmount,
            reason,
            pnl
        });

        this.positions.delete(secid);
        this.watchList.delete(secid);
        console.log(`[Backtest] [${date}] ${secid} 已从持仓和观察列表移除`);
    }

    private async recordDailyValue(date: string, dataProvider: DataProvider): Promise<boolean> {
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
        this.dailyValues.push({
            date,
            totalValue
        });

        if (positionDetails.length > 0) {
            console.log(`[Backtest] [${date}] 净值明细: 现金${this.availableCash.toFixed(2)} + 股票市值${stockValue.toFixed(2)} = 总净值${totalValue.toFixed(2)}`);
            console.table(positionDetails);
        } else {
            console.log(`[Backtest] [${date}] 净值: ${totalValue.toFixed(2)} (空仓)`);
        }
        return false;
    }

    private calculateResult(): BacktestResult {
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

        const result: BacktestResult = {
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

        console.log(`[Backtest] 结果指标:`, {
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

        console.log(`[Backtest] 买卖记录汇总:`);
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

    private backtestRSIOnHistory(klines: Stock.KLineItem[], rsiValues: number[]): number {
        if (klines.length < 25) return 50;

        let signals = 0;
        let wins = 0;

        for (let i = 20; i < klines.length - 5; i++) {
            const subKlines = klines.slice(0, i + 1);
            const subRSI = rsiValues.slice(0, i + 1);
            const signal = getTrendRSISignal(subKlines, subRSI, this.RSI_LOOKBACK);

            if (signal.type === 'buy') {
                signals++;
                const entryPrice = klines[i].sp;
                const futurePrices = klines.slice(i + 1, Math.min(i + 6, klines.length));
                if (futurePrices.length === 0) continue;

                const maxPrice = Math.max(...futurePrices.map(k => k.zg));
                if (maxPrice > entryPrice * 1.03) wins++;
            }
        }

        return signals > 0 ? (wins / signals) * 100 : 50;
    }

    private getTradeDaysDiff(date1: string, date2: string): number {
        const idx1 = this.tradeDays.indexOf(date1);
        const idx2 = this.tradeDays.indexOf(date2);
        if (idx1 < 0 || idx2 < 0) return 0;
        return Math.abs(idx2 - idx1);
    }

    private normalizeDate(date: string): string {
        if (date.length === 8 && date.includes('-') === false) {
            return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
        }
        return date;
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