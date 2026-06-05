import { Stock } from '@/types/stock';
import { ReadCache, WriteCache } from '@/helpers/backtestCache';
import dayjs from 'dayjs';
import { calculateMA, calculateMACD, calculateRSI } from '@/helpers/tech';
import {
  backtestMABounce,
  optimizeMACDStrategy as computeMACDStrategy,
  optimizeRSIStrategy as computeRSIStrategy,
  batchBacktestAndScreen,
  type BatchBacktestAndScreenResult,
} from './backtestCompute';

// ===== 策略优化结果 localStorage 缓存 =====
const CACHE_PREFIX = 'bt_opt_';

function getCacheKey(type: 'macd' | 'rsi' | 'screen', secid: string, lastDate: string, extra: string): string {
  return `${CACHE_PREFIX}${type}_${secid}_${lastDate}_${extra}`;
}

// ===== 均线回踩买入策略参数优化 =====
export interface MABacktestTrade {
  buyIndex: number;
  sellIndex: number;
  returnPct: number;
  maxDrawdownPct: number;
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
  trades?: MABacktestTrade[]; // [优化] 改为可选，减少 IPC 传输
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
  stopLossPrice: number;
  exitReason: 'macd_exit' | 'stop_loss_fixed' | 'stop_loss_trailing' | 'hist_shrink';
}

export interface MACDStrategyResult {
  fast: number;
  slow: number;
  signal: number;
  requireAboveZero: boolean;
  requirePriorNegative: boolean;
  trades?: MACDTrade[]; // [优化] 改为可选
  totalReturn: number;
  winRate: number;
  tradeCount: number;
  avgReturn: number;
  avgHoldDays: number;
  maxDrawdown: number;
  profitFactor: number;
  score: number;
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
  maxDrawdownPct: number;
  stopLossPrice: number;
  exitReason: 'rsi_overbought' | 'stop_loss_fixed' | 'stop_loss_trailing';
}

export interface RSIBacktestResult {
  rsiPeriod: number;
  buyThreshold: number;
  sellThreshold: number;
  trades?: RSIBacktestTrade[]; // [优化] 改为可选
  totalReturn: number;
  winRate: number;
  tradeCount: number;
  avgReturn: number;
  maxDrawdown: number;
  profitFactor: number;
  score: number;
  fixedStopLossPct: number;
  trailingStopLossPct: number;
}

export { backtestMABounce } from './backtestCompute';

/** [优化] 默认让出 5ms，确保渲染线程至少完成一次 paint */
function yieldToMain(ms: number = 5) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export async function optimizeMACDStrategy(
  klines: Stock.KLineItem[],
  fixedStopLossPct: number = 0.05,
  trailingStopLossPct: number = 0.06,
  secid?: string
): Promise<MACDStrategyResult[]> {
  const lastDate = klines[klines.length - 1]?.date;
  const macdCacheKey = secid && lastDate
    ? getCacheKey('macd', secid, lastDate, `${fixedStopLossPct}_${trailingStopLossPct}`)
    : null;
  if (macdCacheKey) {
    const cached = await ReadCache<MACDStrategyResult[]>(macdCacheKey);
    if (cached) {
      console.log(`[Cache] MACD 命中缓存: ${secid} ${lastDate}`);
      return cached;
    }
  }

  const results = computeMACDStrategy(klines, fixedStopLossPct, trailingStopLossPct);

  if (macdCacheKey) {
    await WriteCache(macdCacheKey, results);
    console.log(`[Cache] MACD 写入缓存: ${secid} ${lastDate} (${results.length} 组)`);
  }

  return results;
}

export async function optimizeRSIStrategy(
  klines: Stock.KLineItem[],
  rsiPeriods: number[] = [6, 12, 24],
  fixedStopLossPct: number = 0.05,
  trailingStopLossPct: number = 0.06,
  secid?: string
): Promise<RSIBacktestResult[]> {
  const lastDate = klines[klines.length - 1]?.date;
  const rsiCacheKey = secid && lastDate
    ? getCacheKey('rsi', secid, lastDate, `${rsiPeriods.join('_')}_${fixedStopLossPct}_${trailingStopLossPct}`)
    : null;
  if (rsiCacheKey) {
    const cached = await ReadCache<RSIBacktestResult[]>(rsiCacheKey);
    if (cached) {
      console.log(`[Cache] RSI 命中缓存: ${secid} ${lastDate}`);
      return cached;
    }
  }

  const results = computeRSIStrategy(klines, rsiPeriods, fixedStopLossPct, trailingStopLossPct);

  if (rsiCacheKey) {
    await WriteCache(rsiCacheKey, results);
    console.log(`[Cache] RSI 写入缓存: ${secid} ${lastDate} (${results.length} 组)`);
  }

  return results;
}

// ===== 策略优化驱动回测类 =====
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
  private workerExecutor?: (method: string, args?: any[]) => Promise<any>;
  private filterTradeDaysCache: Map<string, string[]> = new Map();

  // [优化] 新增：板块数据内存缓存，避免同一天重复 IO
  private boardCache = new Map<string, Array<{ code: string; name: string; zf: number }>>();
  private boardStocksCache = new Map<string, Array<{ secid: string; zf: number }>>();

  // [优化] Worker 并发数，动态计算
  private readonly WORKER_CONCURRENCY: number;

  /** 限制并发数量并定期让出主线程，避免微任务堆积阻塞 UI */
  private async runWithConcurrency<T, R>(
    items: T[],
    fn: (item: T, index: number) => Promise<R>,
    concurrency: number
  ): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = [];
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(batch.map((item, idx) => fn(item, i + idx)));
      results.push(...batchResults);
      await yieldToMain();
    }
    return results;
  }

  /** 限制并发数量，返回按原顺序排列的结果数组 */
  private async runWithLimit<T, R>(
    items: T[],
    fn: (item: T, index: number) => Promise<R>,
    limit: number
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let index = 0;

    const worker = async () => {
      while (index < items.length) {
        const i = index++;
        results[i] = await fn(items[i], i);
        await yieldToMain();
      }
    };

    const workers = Array(Math.min(limit, items.length)).fill(null).map(worker);
    await Promise.all(workers);
    return results;
  }

  private MAX_POSITIONS = 8;
  private POSITION_RATIO = 0.125;
  private readonly MAX_SAME_BOARD = 2;
  private readonly MIN_POSITION_RATIO = 0.05;
  private readonly SLIPPAGE = 0.001;
  private readonly COMMISSION = 0.0003;
  private readonly STAMP_TAX = 0.001;
  private readonly BATCH_SIZE = 20; // [优化] 从 5 改为 20，减少 Worker 调度开销
  private readonly KLINE_DAYS = 150;

  private STOP_LOSS_INIT_PCT = 0.95;
  private TRAILING_STOP_PCT = 0.90;
  private MIN_STRATEGY_SCORE = 100;
  private STRONG_LOOKBACK_START = 10;
  private STRONG_LOOKBACK_END = 5;

  constructor(
    tradeDays: string[],
    initialCapital: number = 1000000,
    workerExecutor?: (method: string, args?: any[]) => Promise<any>,
    options?: {
      stopLossInitPct?: number;
      trailingStopPct?: number;
      minStrategyScore?: number;
      strongLookbackStart?: number;
      strongLookbackEnd?: number;
      maxPositions?: number;
      positionRatio?: number;
      workerCount?: number; // [优化] 新增
    }
  ) {
    this.tradeDays = tradeDays;
    this.initialCapital = initialCapital;
    this.capital = initialCapital;
    this.availableCash = initialCapital;
    this.workerExecutor = workerExecutor;

    // [优化] 根据 Worker 数量动态设置并发，上限 8
    this.WORKER_CONCURRENCY = workerExecutor
      ? Math.min(options?.workerCount || 6, 8)
      : 1;

    if (options?.stopLossInitPct !== undefined) this.STOP_LOSS_INIT_PCT = options.stopLossInitPct;
    if (options?.trailingStopPct !== undefined) this.TRAILING_STOP_PCT = options.trailingStopPct;
    if (options?.minStrategyScore !== undefined) this.MIN_STRATEGY_SCORE = options.minStrategyScore;
    if (options?.strongLookbackStart !== undefined) this.STRONG_LOOKBACK_START = options.strongLookbackStart;
    if (options?.strongLookbackEnd !== undefined) this.STRONG_LOOKBACK_END = options.strongLookbackEnd;
    if (options?.maxPositions !== undefined) this.MAX_POSITIONS = options.maxPositions;
    if (options?.positionRatio !== undefined) this.POSITION_RATIO = options.positionRatio;
    console.log(`[OptBacktest] 初始化完成 | 初始资金: ${initialCapital.toLocaleString()} | 交易日数: ${tradeDays.length} | Worker: ${workerExecutor ? '启用' : '禁用'} | 并发: ${this.WORKER_CONCURRENCY}`);
    console.log(`[OptBacktest] 动态参数:`, {
      STOP_LOSS_INIT_PCT: this.STOP_LOSS_INIT_PCT,
      TRAILING_STOP_PCT: this.TRAILING_STOP_PCT,
      MIN_STRATEGY_SCORE: this.MIN_STRATEGY_SCORE,
      STRONG_LOOKBACK: `${this.STRONG_LOOKBACK_START}-${this.STRONG_LOOKBACK_END}天前`,
      SLIPPAGE: this.SLIPPAGE,
      COMMISSION: this.COMMISSION,
      STAMP_TAX: this.STAMP_TAX,
      BATCH_SIZE: this.BATCH_SIZE
    });
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
        if (await this.generateSignals(today, nextDay, dataProvider, currentBase, dayPercentStep, (msg, pct) => {
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

      await yieldToMain();
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

    // [优化] 记录因停牌而跳过的订单，用于统计
    const skippedOrders: Array<{ secid: string; type: string; reason: string }> = [];

    for (const order of this.pendingOrders) {
      if (this.isCancelled()) return true;
      await this.waitIfPaused();
      if (this.isCancelled()) return true;

      const klines = await dataProvider.getKLines(order.secid, today, 5);
      if (!klines || klines.length === 0) {
        console.log(`[OptBacktest] [${today}] 订单执行失败: ${order.secid} 未获取到K线数据`);
        skippedOrders.push({ secid: order.secid, type: order.type, reason: '无K线数据' });
        continue;
      }

      const todayKLine = klines.find(k => k.date === today);
      
      // [优化] 明确检测停牌：最近K线不是今天，说明今日停牌
      if (!todayKLine) {
        const lastKline = klines[klines.length - 1];
        console.log(`[OptBacktest] [${today}] 订单执行跳过: ${order.secid} 停牌 (最近交易日: ${lastKline?.date || '无'})`);
        skippedOrders.push({ secid: order.secid, type: order.type, reason: `停牌(最近:${lastKline?.date || '无'})` });
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
      
      // [优化] 每执行/跳过一个订单让出一次，避免订单多的时候卡
      await yieldToMain(1);
    }

    if (skippedOrders.length > 0) {
      console.log(`[OptBacktest] [${today}] 跳过订单统计:`, skippedOrders);
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
    currentBase: number,
    dayPercentStep: number,
    onProgress?: (message: string, percent?: number) => void
  ): Promise<boolean> {
    this.boardCache.clear();
    this.boardStocksCache.clear();

    // ===== 2-1: 处理持仓卖出信号（数据量小，保留在主线程） =====
    console.log(`[OptBacktest] [${today}] 阶段2-1: 处理持仓卖出信号 ${this.positions.size} 只`);
    onProgress?.(`[${today}] 处理持仓卖出信号...`);

    let sellCheckCount = 0;
    for (const [secid, position] of this.positions) {
      if (this.isCancelled()) return true;
      await this.waitIfPaused();
      if (this.isCancelled()) return true;

      if (position.buyDate === today) {
        console.log(`[OptBacktest] [${today}] ${secid} 卖出检查跳过: 今日买入的股票`);
        continue;
      }
      const klines = await dataProvider.getKLines(secid, today, 60);
      if (!klines || klines.length === 0) {
        console.log(`[OptBacktest] [${today}] ${secid} 卖出检查跳过: K线不足`);
        continue;
      }
      // [优化] 停牌股票跳过卖出信号检测（无法交易）
      if (klines[klines.length - 1].date !== today) {
        console.log(`[OptBacktest] [${today}] ${secid} 卖出检查跳过: 停牌`);
        continue;
      }

      const currentPrice = klines[klines.length - 1].sp;

      if (currentPrice > position.highestPrice) {
        const oldHigh = position.highestPrice;
        position.highestPrice = currentPrice;
        position.stopLossPrice = currentPrice * this.TRAILING_STOP_PCT;
        console.log(`[OptBacktest] [${today}] ${secid} 创新高: ${oldHigh.toFixed(2)} → ${currentPrice.toFixed(2)}, 移动止损更新为 ${position.stopLossPrice.toFixed(2)}`);
      }

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

      if (++sellCheckCount % 1 === 0) {
        await yieldToMain(1);
      }
    }

    // ===== 2-2: 获取强势股票（限制并发，避免微任务堆积） =====
    const rawDates: string[] = [];
    const base = dayjs(today, 'YYYY-MM-DD');
    for (let d = 1; d <= 40; d++) {
      rawDates.push(base.subtract(d, 'day').format('YYYY-MM-DD'));
    }

    const rawDatesKey = rawDates.join(',');
    let tradeDays = this.filterTradeDaysCache.get(rawDatesKey);
    if (!tradeDays) {
      tradeDays = await dataProvider.filterTradeDays(rawDates);
      this.filterTradeDaysCache.set(rawDatesKey, tradeDays);
    }
    const strongStockDays = tradeDays.slice(this.STRONG_LOOKBACK_END - 1, this.STRONG_LOOKBACK_START);

    console.log(`[OptBacktest] [${today}] 阶段2-2: 获取强势股票 ${strongStockDays.join(', ')}`);
    onProgress?.(`[${today}] 获取强势股票...`);

    if (this.isCancelled()) return true;
    await this.waitIfPaused();
    if (this.isCancelled()) return true;

    const strongStocksMap = new Map<string, Stock.DetailItem>();
        const strongResults = await this.runWithConcurrency(
      strongStockDays,
      async (day) => {
        try {
          const stocks = await dataProvider.getStrongStocks(day);
          return { ok: true as const, stocks, day };
        } catch (reason: any) {
          return { ok: false as const, reason, day };
        }
      },
      3
    );

    let mapSetCount = 0;
    for (const result of strongResults) {
      // 外层 Promise.allSettled 结果
      if (result.status === 'fulfilled') {
        const inner = result.value; // { ok: true, stocks, day } | { ok: false, reason, day }
        if (inner.ok) {
          console.log(`[OptBacktest] [${today}] ${inner.day} 强势股票: ${inner.stocks.length} 只`);
          for (const stock of inner.stocks) {
            if (!strongStocksMap.has(stock.secid)) {
              strongStocksMap.set(stock.secid, stock);
            }
            if (++mapSetCount % 50 === 0) {
              await yieldToMain(1);
            }
          }
        } else {
          console.log(`[OptBacktest] [${today}] 获取 ${inner.day} 强势股票失败:`, inner.reason);
        }
      } else {
        // 理论上不会进这里，因为 fn 内部 catch 了，但保险起见
        console.log(`[OptBacktest] [${today}] 获取强势股票异常:`, result.reason);
      }
    }

    const strongStocks = Array.from(strongStocksMap.values());
    console.log(`[OptBacktest] [${today}] 去重后强势股票共 ${strongStocks.length} 只`);

    const filteredStocks = strongStocks.filter(s => !this.positions.has(s.secid));
    console.log(`[OptBacktest] [${today}] 排除已持仓后剩余 ${filteredStocks.length} 只`);

    // ===== 2-3: 批量获取K线（限制并发，避免IPC反序列化阻塞） =====
    const batchTasks: Array<{
      batchStart: number;
      batch: Stock.DetailItem[];
      validItems: Array<{ stock: Stock.DetailItem; klines: Stock.KLineItem[]; batchIndex: number }>;
      klinesList: Stock.KLineItem[][];
    }> = [];

    for (let batchStart = 0; batchStart < filteredStocks.length; batchStart += this.BATCH_SIZE) {
      if (this.isCancelled()) return true;
      await this.waitIfPaused();
      if (this.isCancelled()) return true;

      const batch = filteredStocks.slice(batchStart, batchStart + this.BATCH_SIZE);
      onProgress?.(`[${today}] 准备数据 ${Math.min(batchStart + this.BATCH_SIZE, filteredStocks.length)}/${filteredStocks.length}...`);

      const klinesBatch = await this.runWithLimit(
        batch,
        async (stock) => dataProvider.getKLines(stock.secid, today, this.KLINE_DAYS),
        5
      );

      const validItems: Array<{ stock: Stock.DetailItem; klines: Stock.KLineItem[]; batchIndex: number }> = [];
      const invalidResults: Array<{ pass: false; reason: string; secid: string }> = [];

      for (let i = 0; i < batch.length; i++) {
        const stock = batch[i];
        const klines = klinesBatch[i];
        if (!klines || klines.length < 60) {
          invalidResults.push({ pass: false, reason: 'K线不足', secid: stock.secid });
        } else if (klines[klines.length - 1].date !== today) {
          // [优化] 跳过停牌股票：最后一条K线不是当天，说明今日无交易
          invalidResults.push({ pass: false, reason: '停牌', secid: stock.secid });
        } else {
          validItems.push({ stock, klines, batchIndex: i });
        }
        if (i % 10 === 0) {
          await yieldToMain(1);
        }
      }

      for (const res of invalidResults) {
        console.log(`[OptBacktest] [${today}] ${res.secid} ❌ 筛选失败: ${res.reason}`);
      }

      if (validItems.length > 0) {
        batchTasks.push({
          batchStart,
          batch,
          validItems,
          klinesList: validItems.map(v => v.klines)
        });
      }

      await yieldToMain();
    }

    console.log(`[OptBacktest] [${today}] 共 ${batchTasks.length} 个batch进入优化+筛选，总计 ${batchTasks.reduce((s, b) => s + b.validItems.length, 0)} 只`);

    // ===== [核心优化] 步骤B+C：Worker 执行策略优化 + 候选筛选（纯计算全部迁移） =====
    const totalBatches = batchTasks.length;
    let completedBatches = 0;

    const batchPhaseStartPercent = Math.round(currentBase + dayPercentStep * 0.3);
    const batchPhaseEndPercent = Math.round(currentBase + dayPercentStep * 0.6);
    const batchPercentRange = batchPhaseEndPercent - batchPhaseStartPercent;

    onProgress?.(`[${today}] 并行策略优化+筛选 ${totalBatches} 个batch...`, batchPhaseStartPercent);
    console.log(`[OptBacktest] [${today}] 启动并行优化+筛选: ${totalBatches} 个batch`);

    const allBatchResults = await this.runWithLimit(
      batchTasks,
      async (b, batchIndex) => {
        const backtestParams = {
          fixedStopLossPct: 0.05,
          trailingStopLossPct: 0.06,
        };
        const screenParams = {
          minStrategyScore: this.MIN_STRATEGY_SCORE,
          strongLookbackStart: this.STRONG_LOOKBACK_START,
          strongLookbackEnd: this.STRONG_LOOKBACK_END,
        };

        const items = b.validItems.map(v => ({
          stock: { secid: v.stock.secid, bk: v.stock.bk },
          klines: v.klines,
        }));

        // 检查缓存（缓存整个优化+筛选结果）
        const cachedResults: BatchBacktestAndScreenResult[] = [];
        const uncachedIndices: number[] = [];
        const uncachedItems: typeof items = [];

        for (let i = 0; i < items.length; i++) {
          const { stock, klines } = items[i];
          const lastDate = klines[klines.length - 1]?.date;
          if (lastDate) {
            const key = getCacheKey('screen', stock.secid, lastDate, `${backtestParams.fixedStopLossPct}_${backtestParams.trailingStopLossPct}_${screenParams.minStrategyScore}`);
            const cached = await ReadCache<BatchBacktestAndScreenResult>(key);
            if (cached) {
              cachedResults[i] = cached;
              continue;
            }
          }
          uncachedIndices.push(i);
          uncachedItems.push(items[i]);
        }

        let workerResults: BatchBacktestAndScreenResult[] = [];
        if (uncachedItems.length > 0) {
          if (this.workerExecutor) {
            workerResults = await this.workerExecutor('batchBacktestAndScreen', [
              uncachedItems,
              backtestParams,
              screenParams,
            ]);
          } else {
            // 主线程 fallback（开发环境无Worker时）
            workerResults = batchBacktestAndScreen(uncachedItems, backtestParams, screenParams);
          }
        }

        // 合并缓存和Worker结果
        const mergedResults: BatchBacktestAndScreenResult[] = [];
        let workerIdx = 0;
        for (let i = 0; i < items.length; i++) {
          if (cachedResults[i]) {
            mergedResults.push(cachedResults[i]);
          } else {
            mergedResults.push(workerResults[workerIdx++]);
            const { stock, klines } = items[i];
            const lastDate = klines[klines.length - 1]?.date;
            if (lastDate) {
              const key = getCacheKey('screen', stock.secid, lastDate, `${backtestParams.fixedStopLossPct}_${backtestParams.trailingStopLossPct}_${screenParams.minStrategyScore}`);
              WriteCache(key, mergedResults[mergedResults.length - 1]);
            }
          }
        }

        completedBatches++;
        console.log(`[OptBacktest] [${today}] batch ${batchIndex} 优化+筛选完成 (${completedBatches}/${totalBatches})`);
        const pct = batchPhaseStartPercent + Math.round((completedBatches / totalBatches) * batchPercentRange);
        onProgress?.(
          `[${today}] 优化+筛选进度 ${completedBatches}/${totalBatches} batch (${Math.round(completedBatches / totalBatches * 100)}%)`,
          pct
        );
        return mergedResults;
      },
      this.WORKER_CONCURRENCY
    );

    console.log(`[OptBacktest] [${today}] 所有batch优化+筛选完成`);

    // ===== 2-4: 板块驱动条件 + 排序和仓位筛选（主线程只做IO和状态管理） =====
    const buyCandidates: Array<{
      secid: string;
      score: number;
      boardCode: string;
      price: number;
      reason: string;
      strategyType: 'macd' | 'rsi';
      strategyParams: MACDStrategyResult | RSIBacktestResult;
    }> = [];

    for (let i = 0; i < batchTasks.length; i++) {
      const b = batchTasks[i];
      const batchResults = allBatchResults[i];

      for (let j = 0; j < batchResults.length; j++) {
        const { screenResult } = batchResults[j];
        const { stock, klines } = b.validItems[j];

        if (!screenResult.pass) {
          if (screenResult.reason !== 'K线不足') {
            console.log(`[OptBacktest] [${today}] ${stock.secid} ❌ 筛选失败: ${screenResult.reason}`);
          }
          continue;
        }

        // 板块驱动条件（IO，只对通过筛选的少量股票执行）
        let boardPass = false;
        let boardRankPass = false;
        let boardCode = null;

        const boards = await dataProvider.getAllBoards(stock.bk, screenResult.tDayDate!);
        if (boards && boards.length > 0) {
          const sortedBoards = boards.sort((a, b) => b.zf - a.zf);
          const boardRank = sortedBoards.findIndex(b => b.name === stock.bk);
          if (boardRank >= 0) {
            boardPass = (boardRank + 1) <= boards.length * 0.1;
            boardCode = boards[boardRank].code;
          }
        }

        if (!boardPass) {
          console.log(`[OptBacktest] [${today}] ${stock.secid} ❌ 筛选失败: 板块未进全市场前10%`);
          continue;
        }

        if (screenResult.strongType === 'limit_up') {
          boardRankPass = true;
        } else {
          const boardStocks = await dataProvider.getBoardStocks(screenResult.tDayDate!, boardCode, stock.bk);
          if (boardStocks && boardStocks.length > 0) {
            const sortedStocks = boardStocks.sort((a, b) => b.zf - a.zf);
            const stockRank = sortedStocks.findIndex(s => s.secid === stock.secid);
            if (stockRank >= 0 && (stockRank + 1) <= boardStocks.length * 0.1) {
              boardRankPass = true;
            }
          } else {
            boardRankPass = true;
          }
        }

        if (!boardRankPass) {
          console.log(`[OptBacktest] [${today}] ${stock.secid} ❌ 筛选失败: 股票未进板块内前10%`);
          continue;
        }

        const currentPrice = klines[klines.length - 1].sp;
        buyCandidates.push({
          secid: stock.secid,
          score: screenResult.score!,
          boardCode: stock.bk,
          price: currentPrice,
          reason: screenResult.reason!,
          strategyType: screenResult.bestType!,
          strategyParams: screenResult.bestResult!,
        });
        console.log(`[OptBacktest] [${today}] ${stock.secid} ✅ 通过筛选 | ${screenResult.reason}`);

        if (buyCandidates.length % 5 === 0) {
          await yieldToMain(1);
        }
      }

      await yieldToMain();
    }

    // 排序和仓位筛选（数据量极小，同步执行无压力）
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

    let posCount = 0;
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

      // [优化] 从 5 改为 2
      if (++posCount % 2 === 0) {
        await yieldToMain();
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
    const rsi = calculateRSI(closes, params.rsiPeriod);
    const i = closes.length - 1;

    if (i < 0 || isNaN(rsi[i])) return false;
    if (rsi[i] >= params.sellThreshold) return true;

    return false;
  }

  // ===== K线形态判断 =====


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