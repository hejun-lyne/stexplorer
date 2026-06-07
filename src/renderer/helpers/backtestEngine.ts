import { Stock } from '@/types/stock';
import { ReadCache, WriteCache } from '@/helpers/backtestCache';
import dayjs from 'dayjs';
import { calculateMA, calculateMACD, calculateRSI } from '@/helpers/tech';
import {
  backtestMABounce,
  optimizeMACDStrategy as computeMACDStrategy,
  optimizeRSIStrategy as computeRSIStrategy,
  batchBacktestAndScreen,
  checkMACDBuySignal,
  checkRSIBuySignal,
  hasLongUpperShadow,
  type BatchBacktestAndScreenResult,
} from './backtestCompute';

// ===== 策略优化结果 localStorage 缓存 =====
const CACHE_PREFIX = 'bt_opt_';

function getCacheKey(type: 'macd' | 'rsi', secid: string, lastDate: string, extra: string): string {
  return `${CACHE_PREFIX}${type}_${secid}_${lastDate}_${extra}`;
}

/** 根据 secid 和涨幅判断是否为涨停股（排除ST简化处理） */
function isLimitUpStock(secid: string, zf: number): boolean {
  const code = secid.split('.')[1] || '';
  if (code.startsWith('30')) {
    return zf >= 19.9;
  }
  if (code.startsWith('68') || code.startsWith('8') || code.startsWith('9')) {
    return zf >= 29.9;
  }
  // 主板默认 10%
  return zf >= 9.9;
}

// [优化] 聚合缓存：同一只股票只存一个文件，内部按 date 区分
interface StockScreenCacheEntry {
  params: {
    fixedStopLossPct: number;
    trailingStopLossPct: number;
    minStrategyScore: number;
    strategyMode: 'macd' | 'rsi' | 'both';
  };
  result: BatchBacktestAndScreenResult;
}

// 文件内容：{ [date]: entry }
type StockScreenCacheFile = Record<string, StockScreenCacheEntry>;

function getScreenCacheKey(secid: string): string {
  return `${CACHE_PREFIX}screen_${secid}`;
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
  score?: number;
  boardRank?: number;
  stockRank?: number;
}

export interface StrategyPendingOrder {
  secid: string;
  type: 'buy' | 'sell';
  reason: string;
  signalDate: string;
  boardCode?: string;
  strategyType?: 'macd' | 'rsi';
  strategyParams?: MACDStrategyResult | RSIBacktestResult;
  score?: number;
  boardRank?: number;
  stockRank?: number;
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
  score?: number;
  boardRank?: number;
  stockRank?: number;
  returnPct?: number;
  strategyType?: 'macd' | 'rsi';
  strategyParams?: MACDStrategyResult | RSIBacktestResult;
}

export interface StrategyDailyValue {
  date: string;
  totalValue: number;
}

export interface StockTradeDetail {
  buyDate: string;
  buyPrice: number;
  sellDate?: string;
  sellPrice?: number;
  quantity: number;
  pnl?: number;
  returnPct?: number;
  sellReason?: string;
  holdDays?: number;
}

export interface StockTradeStats {
  secid: string;
  boardCode: string;
  strategyType: 'macd' | 'rsi';
  strategyParams: MACDStrategyResult | RSIBacktestResult;
  score: number;
  trades: StockTradeDetail[];
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  totalPnl: number;
  winRate: number;
  avgReturnPct: number;
  boardRank?: number;
  stockRank?: number;
  strategyParamsStr?: string;
}

export interface ScoreWinRateDistribution {
  scoreRange: string;
  minScore: number;
  maxScore: number;
  count: number;
  winTrades: number;
  lossTrades: number;
  winRate: number;
  avgReturnPct: number;
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
  stockStats: StockTradeStats[];
  scoreDistribution: ScoreWinRateDistribution[];
}

export interface StrategyDataProvider {
  getStrongStocks(date: string): Promise<Stock.DetailItem[]>;
  getKLines(secids: string[], endDate: string, days?: number): Promise<Record<string, Stock.KLineItem[]>>;
  getAllBoards(associateBoardName: string, date: string): Promise<Array<{ code: string; name: string; zf: number }>>;
  getBoardStocks(date: string, boardCode: string | null, boardName: string): Promise<Array<{ secid: string; zf: number }>>;
  // [新增] 批量接口
  getAllBoardsBatch(dates: string[]): Promise<Record<string, Array<{ code: string; name: string; zf: number }>>>;
  getBoardStocksBatch(requests: Array<{ date: string; boardCode: string | null; boardName: string }>): Promise<Record<string, Array<{ secid: string; zf: number }>>>;
  
  filterTradeDays(dates: string[]): Promise<string[]>;
}

export interface WatchListItem {
  secid: string;
  boardCode: string;
  strategyType: 'macd' | 'rsi';
  strategyParams: MACDStrategyResult | RSIBacktestResult;
  score: number;
  addedDate: string;
  tDayDate: string;
  strongType: 'limit_up' | 'new_high_60';
  maxWatchDays: number;
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

    // [优化] 板块数据内存缓存
  private boardCache = new Map<string, Array<{ code: string; name: string; zf: number }>>();
  private boardStocksCache = new Map<string, Array<{ secid: string; zf: number }>>();
  
  // [新增] 请求锁：同一 key 的并发查询复用同一个 Promise，避免重复 IPC
  private boardRequestLock = new Map<string, Promise<Array<{ code: string; name: string; zf: number }> | null>>();
  private boardStocksRequestLock = new Map<string, Promise<Array<{ secid: string; zf: number }> | null>>();

    /** [优化] 带请求锁的全市场板块查询 */
  private async getAllBoardsCached(
    dataProvider: StrategyDataProvider,
    bk: string,
    date: string
  ): Promise<Array<{ code: string; name: string; zf: number }> | null> {
    const key = date; // getAllBoards 返回全市场所有板块，与 bk 无关
    const cached = this.boardCache.get(key);
    if (cached) return cached;

    const locked = this.boardRequestLock.get(key);
    if (locked) return locked;

    const promise = dataProvider.getAllBoards(bk, date).then(boards => {
      if (boards && boards.length > 0) {
        this.boardCache.set(key, boards);
      }
      this.boardRequestLock.delete(key);
      return boards;
    }).catch(err => {
      this.boardRequestLock.delete(key);
      throw err;
    });

    this.boardRequestLock.set(key, promise);
    return promise;
  }

  /** [优化] 带请求锁的板块成分股查询 */
  private async getBoardStocksCached(
    dataProvider: StrategyDataProvider,
    date: string,
    boardCode: string | null,
    boardName: string
  ): Promise<Array<{ secid: string; zf: number }> | null> {
    const key = `${date}_${boardCode || boardName}`;
    const cached = this.boardStocksCache.get(key);
    if (cached) return cached;

    const locked = this.boardStocksRequestLock.get(key);
    if (locked) return locked;

    const promise = dataProvider.getBoardStocks(date, boardCode, boardName).then(stocks => {
      if (stocks && stocks.length > 0) {
        this.boardStocksCache.set(key, stocks);
      }
      this.boardStocksRequestLock.delete(key);
      return stocks;
    }).catch(err => {
      this.boardStocksRequestLock.delete(key);
      throw err;
    });

    this.boardStocksRequestLock.set(key, promise);
    return promise;
  }
  // [优化] Worker 并发数，动态计算
  private readonly WORKER_CONCURRENCY: number;

  private watchList = new Map<string, WatchListItem>();
  private MAX_WATCH_DAYS = 3;

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
  private readonly BATCH_SIZE = 50; // [优化] 从 5 改为 20，减少 Worker 调度开销
  private readonly KLINE_DAYS = 150;

  private STOP_LOSS_INIT_PCT = 0.95;
  private TRAILING_STOP_PCT = 0.90;
  private MIN_STRATEGY_SCORE = 100;
  private STRONG_LOOKBACK = 10;
  private BOARD_RANK_PCT = 0.3;
  private STOCK_RANK_PCT = 0.3;
  private strategyMode: 'macd' | 'rsi' | 'both' = 'both';

  constructor(
    tradeDays: string[],
    initialCapital: number = 1000000,
    workerExecutor?: (method: string, args?: any[]) => Promise<any>,
    options?: {
      stopLossInitPct?: number;
      trailingStopPct?: number;
      minStrategyScore?: number;
      strongLookback?: number;
      maxPositions?: number;
      positionRatio?: number;
      workerCount?: number; // [优化] 新增
      maxWatchDays?: number;
      boardRankPct?: number;
      stockRankPct?: number;
      strategyMode?: 'macd' | 'rsi' | 'both';
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
    if (options?.strongLookback !== undefined) this.STRONG_LOOKBACK = options.strongLookback;
    if (options?.maxPositions !== undefined) this.MAX_POSITIONS = options.maxPositions;
    if (options?.positionRatio !== undefined) this.POSITION_RATIO = options.positionRatio;
    if (options?.maxWatchDays !== undefined) this.MAX_WATCH_DAYS = options.maxWatchDays;
    if (options?.boardRankPct !== undefined) this.BOARD_RANK_PCT = options.boardRankPct;
    if (options?.stockRankPct !== undefined) this.STOCK_RANK_PCT = options.stockRankPct;
    if (options?.strategyMode !== undefined) this.strategyMode = options.strategyMode;
    console.log(`[OptBacktest] 初始化完成 | 初始资金: ${initialCapital.toLocaleString()} | 交易日数: ${tradeDays.length} | Worker: ${workerExecutor ? '启用' : '禁用'} | 并发: ${this.WORKER_CONCURRENCY}`);
    console.log(`[OptBacktest] 动态参数:`, {
      STOP_LOSS_INIT_PCT: this.STOP_LOSS_INIT_PCT,
      TRAILING_STOP_PCT: this.TRAILING_STOP_PCT,
      MIN_STRATEGY_SCORE: this.MIN_STRATEGY_SCORE,
      STRONG_LOOKBACK: `${this.STRONG_LOOKBACK}天前`,
      SLIPPAGE: this.SLIPPAGE,
      COMMISSION: this.COMMISSION,
      STAMP_TAX: this.STAMP_TAX,
      BATCH_SIZE: this.BATCH_SIZE,
      BOARD_RANK_PCT: this.BOARD_RANK_PCT,
      STOCK_RANK_PCT: this.STOCK_RANK_PCT,
      STRATEGY_MODE: this.strategyMode,
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
      STRONG_LOOKBACK: `${this.STRONG_LOOKBACK}天前`,
      MAX_WATCH_DAYS: this.MAX_WATCH_DAYS,
      SLIPPAGE: this.SLIPPAGE,
      COMMISSION: this.COMMISSION,
      STAMP_TAX: this.STAMP_TAX,
      BATCH_SIZE: this.BATCH_SIZE,
      BOARD_RANK_PCT: this.BOARD_RANK_PCT,
      STOCK_RANK_PCT: this.STOCK_RANK_PCT,
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
      // [优化] 非交易日直接跳过（数据源异常保护）
      const validDays = await dataProvider.filterTradeDays([today]);
      if (validDays.length === 0) {
        console.log(`[OptBacktest] [${today}] 非交易日，跳过`);
        onProgress?.(`[${i + 1}/${totalDays}] ${today} 非交易日，跳过...`, Math.round(i * dayPercentStep));
        continue;
      }
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

    const secidsToFetch = this.pendingOrders.map(o => o.secid);
    const klinesMap = await dataProvider.getKLines(secidsToFetch, today, 5);
    for (const order of this.pendingOrders) {
      if (this.isCancelled()) return true;
      await this.waitIfPaused();
      if (this.isCancelled()) return true;

      const klines = klinesMap[order.secid];
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
      // [调试] 打印K线原始数据，用于核对价格是否匹配
      console.log(`[Debug][ executePendingOrders][${today}] ${order.secid} ${order.type} K线确认: date=${todayKLine.date} kp=${todayKLine.kp.toFixed(2)} sp=${todayKLine.sp.toFixed(2)} zg=${todayKLine.zg.toFixed(2)} zd=${todayKLine.zd.toFixed(2)}`);

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

  private formatStrategyParams(type?: 'macd' | 'rsi', params?: MACDStrategyResult | RSIBacktestResult): string {
    if (!type || !params) return '';
    if (type === 'macd') {
      const p = params as MACDStrategyResult;
      return `MACD(fast=${p.fast},slow=${p.slow},signal=${p.signal},aboveZero=${p.requireAboveZero},priorNeg=${p.requirePriorNegative})`;
    } else {
      const p = params as RSIBacktestResult;
      return `RSI(period=${p.rsiPeriod},buy=${p.buyThreshold},sell=${p.sellThreshold})`;
    }
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
      strategyParams: order.strategyParams || ({} as any),
      score: order.score,
      boardRank: order.boardRank,
      stockRank: order.stockRank,
    });

    const paramsStr = this.formatStrategyParams(order.strategyType, order.strategyParams);
    const finalReason = paramsStr ? `${order.reason} | ${paramsStr}` : order.reason;

    console.log(`[Debug][ executeBuy][${date}] ${order.secid} 原始价=${price.toFixed(2)} 滑点调整后=${adjustedPrice.toFixed(2)} (SLIPPAGE=${this.SLIPPAGE})`);
    console.log(`[OptBacktest] [${date}] ${order.secid} 买入成功: 价${adjustedPrice.toFixed(2)} | 量${quantity} | 总成本${totalCost.toFixed(2)} | 策略${order.strategyType} | 止损价${stopLossPrice.toFixed(2)} | 剩余资金${this.availableCash.toFixed(2)}`);

    this.tradeRecords.push({
      date,
      secid: order.secid,
      type: 'buy',
      price: adjustedPrice,
      quantity,
      amount: totalCost,
      reason: finalReason,
      score: order.score,
      boardRank: order.boardRank,
      stockRank: order.stockRank,
      strategyType: order.strategyType,
      strategyParams: order.strategyParams,
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

    const paramsStr = this.formatStrategyParams(position.strategyType, position.strategyParams);
    const finalReason = paramsStr ? `${reason} | ${paramsStr}` : reason;

      console.log(`[Debug][ executeSell][${date}] ${secid} 原始价=${price.toFixed(2)} 滑点调整后=${adjustedPrice.toFixed(2)} (SLIPPAGE=${this.SLIPPAGE}) 买入成本=${position.buyAmount.toFixed(2)}`);
      console.log(`[OptBacktest] [${date}] ${secid} 卖出成功: 价${adjustedPrice.toFixed(2)} | 量${quantity} | 净额${netAmount.toFixed(2)} | 盈亏${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} | 剩余资金${this.availableCash.toFixed(2)}`);

    const returnPct = position.buyAmount > 0 ? (pnl / position.buyAmount) * 100 : 0;

    this.tradeRecords.push({
      date,
      secid,
      type: 'sell',
      price: adjustedPrice,
      quantity,
      amount: netAmount,
      reason: finalReason,
      pnl,
      score: position.score,
      boardRank: position.boardRank,
      stockRank: position.stockRank,
      returnPct,
      strategyType: position.strategyType,
      strategyParams: position.strategyParams,
    });

    this.positions.delete(secid);
    console.log(`[OptBacktest] [${date}] ${secid} 已从持仓移除`);
  }

  private async checkWatchList(
    today: string,
    dataProvider: StrategyDataProvider
  ): Promise<Array<{
    secid: string;
    score: number;
    boardCode: string;
    price: number;
    reason: string;
    strategyType: 'macd' | 'rsi';
    strategyParams: MACDStrategyResult | RSIBacktestResult;
  }>> {
    const candidates: Array<{
      secid: string;
      score: number;
      boardCode: string;
      price: number;
      reason: string;
      strategyType: 'macd' | 'rsi';
      strategyParams: MACDStrategyResult | RSIBacktestResult;
    }> = [];

    // 预处理：移除已持仓、观察期满的股票
    for (const [secid, item] of this.watchList) {
      if (this.positions.has(secid)) {
        console.log(`[OptBacktest] [${today}] ${secid} 观察移除: 已持仓`);
        this.watchList.delete(secid);
        continue;
      }

      const daysInWatch = this.getTradeDaysDiff(item.addedDate, today);
      if (daysInWatch >= item.maxWatchDays) {
        console.log(`[OptBacktest] [${today}] ${secid} 观察期满 ${daysInWatch} 天，踢出`);
        this.watchList.delete(secid);
        continue;
      }
    }

    // 批量获取观察列表K线
    const watchSecids = Array.from(this.watchList.keys());
    const klinesMap = watchSecids.length > 0
      ? await dataProvider.getKLines(watchSecids, today, this.KLINE_DAYS)
      : {};

    for (const [secid, item] of this.watchList) {
      const klines = klinesMap[secid];
      if (!klines || klines.length < 60) {
        console.log(`[OptBacktest] [${today}] ${secid} 观察跳过: K线不足`);
        continue;
      }

      if (klines[klines.length - 1].date !== today) {
        console.log(`[OptBacktest] [${today}] ${secid} 观察跳过: 停牌`);
        continue;
      }

      const daysInWatch = this.getTradeDaysDiff(item.addedDate, today);

      let mDayIndex = -1;
      if (item.strategyType === 'macd') {
        mDayIndex = checkMACDBuySignal(klines, item.strategyParams as MACDStrategyResult, 3);
      } else {
        mDayIndex = checkRSIBuySignal(klines, item.strategyParams as RSIBacktestResult, 3);
      }

      if (mDayIndex < 0) {
        console.log(`[OptBacktest] [${today}] ${secid} 观察中 ${daysInWatch}/${item.maxWatchDays}，暂无买入信号`);
        continue;
      }

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
        console.log(`[OptBacktest] [${today}] ${secid} 观察期出现信号但${failReason}，踢出`);
        this.watchList.delete(secid);
        continue;
      }

      const currentPrice = klines[lastIndex].sp;
      candidates.push({
        secid,
        score: item.score,
        boardCode: item.boardCode,
        price: currentPrice,
        reason: `${item.strategyType.toUpperCase()}观察期买入 M-Day=${mDayKline.date} T-Day=${item.tDayDate}`,
        strategyType: item.strategyType,
        strategyParams: item.strategyParams,
      });

      const paramsStr = item.strategyType === 'macd'
        ? `fast=${(item.strategyParams as MACDStrategyResult).fast} slow=${(item.strategyParams as MACDStrategyResult).slow} signal=${(item.strategyParams as MACDStrategyResult).signal}`
        : `period=${(item.strategyParams as RSIBacktestResult).rsiPeriod} buy=${(item.strategyParams as RSIBacktestResult).buyThreshold} sell=${(item.strategyParams as RSIBacktestResult).sellThreshold}`;
      console.log(`[OptBacktest] [${today}] ${item.secid} ✅ 观察期出现买入信号，参数: ${paramsStr}`);
      this.watchList.delete(secid);
    }

    return candidates;
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
    const tStart = performance.now();
    this.boardCache.clear();
    this.boardStocksCache.clear();

    // ===== 阶段 2-0: 检查观察列表 =====
    const tWatch0 = performance.now();
    console.log(`[OptBacktest] [${today}] 阶段2-0: 检查观察列表 ${this.watchList.size} 只`);
    const watchBuyCandidates = await this.checkWatchList(today, dataProvider);
    if (watchBuyCandidates.length > 0) {
      console.log(`[OptBacktest] [${today}] 观察列表产生 ${watchBuyCandidates.length} 个买入候选`);
    }
    const tWatch1 = performance.now();
    console.log(`[Perf] [${today}] 观察列表: ${(tWatch1 - tWatch0).toFixed(1)}ms (${this.watchList.size}只)`);

    // 2-1: 处理持仓卖出信号（改为当天收盘价执行）
    const tSell0 = performance.now();
    console.log(`[OptBacktest] [${today}] 阶段2-1: 处理持仓卖出信号 ${this.positions.size} 只`);
    onProgress?.(`[${today}] 处理持仓卖出信号...`);

    let sellCheckCount = 0;
    const sellSecidsToFetch: string[] = [];
    for (const [secid, position] of this.positions) {
      if (position.buyDate !== today) {
        sellSecidsToFetch.push(secid);
      }
    }

    const sellKlinesMap = sellSecidsToFetch.length > 0
      ? await dataProvider.getKLines(sellSecidsToFetch, today, 60)
      : {};

    for (const [secid, position] of this.positions) {
      if (this.isCancelled()) return true;
      await this.waitIfPaused();
      if (this.isCancelled()) return true;

      // A股T+1，今天买入的不能今天卖出
      if (position.buyDate === today) {
        console.log(`[OptBacktest] [${today}] ${secid} 卖出检查跳过: 今日买入的股票`);
        continue;
      }

      const klines = sellKlinesMap[secid];
      if (!klines || klines.length === 0) {
        console.log(`[OptBacktest] [${today}] ${secid} 卖出检查跳过: K线不足`);
        continue;
      }

      // [优化] 停牌股票跳过卖出检测（无法交易）
      if (klines[klines.length - 1].date !== today) {
        console.log(`[OptBacktest] [${today}] ${secid} 卖出检查跳过: 停牌`);
        continue;
      }

      const currentPrice = klines[klines.length - 1].sp;
      const kLast = klines[klines.length - 1];
      // [调试] 打印持仓卖出使用的K线收盘价，用于核对价格是否匹配
      console.log(`[Debug][ sellCheck][${today}] ${secid} K线确认: date=${kLast.date} kp=${kLast.kp.toFixed(2)} sp=${kLast.sp.toFixed(2)} zg=${kLast.zg.toFixed(2)} zd=${kLast.zd.toFixed(2)} → 使用收盘价=${currentPrice.toFixed(2)}`);

      // 更新最高价和移动止损
      if (currentPrice > position.highestPrice) {
        const oldHigh = position.highestPrice;
        position.highestPrice = currentPrice;
        position.stopLossPrice = currentPrice * this.TRAILING_STOP_PCT;
        console.log(`[OptBacktest] [${today}] ${secid} 创新高: ${oldHigh.toFixed(2)} → ${currentPrice.toFixed(2)}, 移动止损更新为 ${position.stopLossPrice.toFixed(2)}`);
      }

      // 检查止损 —— 当天收盘价卖出
      if (currentPrice < position.stopLossPrice) {
        console.log(`[OptBacktest] [${today}] ${secid} 🔴 止损触发: 当前${currentPrice.toFixed(2)} < 止损价${position.stopLossPrice.toFixed(2)}`);
        this.executeSell(secid, today, currentPrice, position.quantity, `止损触发(${currentPrice.toFixed(2)} < ${position.stopLossPrice.toFixed(2)})`);
        continue;
      }

      // 检查策略卖出信号 —— 当天收盘价卖出
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
        this.executeSell(secid, today, currentPrice, position.quantity, sellReason);
      }

      if (++sellCheckCount % 1 === 0) {
        await yieldToMain(1);
      }
    }
    const tSell1 = performance.now();
    console.log(`[Perf] [${today}] 持仓卖出: ${(tSell1 - tSell0).toFixed(1)}ms (${this.positions.size}只)`);

    // ===== 2-2: 获取强势股票（限制并发，避免微任务堆积） =====
    const tStrong0 = performance.now();
    const rawDates: string[] = [];
    const base = dayjs(today, 'YYYY-MM-DD');
    for (let d = 1; d <= 20; d++) {
      rawDates.push(base.subtract(d, 'day').format('YYYY-MM-DD'));
    }

    const tradeDays = await dataProvider.filterTradeDays(rawDates);
    if (tradeDays.length < this.STRONG_LOOKBACK) {
      console.log(`[OptBacktest] [${today}] 可用交易日不足以获取强势股票，跳过强势股票筛选`);
      return false;
    }
    const strongStockDay = tradeDays[this.STRONG_LOOKBACK - 1];

    console.log(`[OptBacktest] [${today}] 阶段2-2: 获取强势股票 ${strongStockDay} 作为参考日`);
    onProgress?.(`[${today}] 获取强势股票...`);

    if (this.isCancelled()) return true;
    await this.waitIfPaused();
    if (this.isCancelled()) return true;

    const strongStocks = await dataProvider.getStrongStocks(strongStockDay);
    console.log(`[OptBacktest] [${today}] ${strongStockDay} 强势股票数量: ${strongStocks.length}`); 

    const tStrong1 = performance.now();
    console.log(`[Perf] [${today}] 强势股票IO: ${(tStrong1 - tStrong0).toFixed(1)}ms (${strongStocks.length}只)`);

    // [新增] 强势股票中的观察列表股票踢出，由当天重新计算决定是否重新加入
    // [新增] 踢出观察列表计时
    const tKick0 = performance.now();
    let watchKicked = 0;
    for (const stock of strongStocks) {
      if (this.watchList.has(stock.secid)) {
        this.watchList.delete(stock.secid);
        watchKicked++;
        console.log(`[OptBacktest] [${today}] ${stock.secid} 出现在强势列表，从观察列表踢出`);
      }
    }
    if (watchKicked > 0) {
      console.log(`[OptBacktest] [${today}] 强势列表踢出观察列表: ${watchKicked} 只，剩余观察 ${this.watchList.size} 只`);
    }
    const tKick1 = performance.now();
    console.log(`[Perf] [${today}] 踢出观察: ${(tKick1 - tKick0).toFixed(1)}ms`);

    const filteredStocks = strongStocks.filter(s => !this.positions.has(s.secid));
    console.log(`[OptBacktest] [${today}] 排除已持仓后剩余 ${filteredStocks.length} 只`);

    // ===== 2-3: 批量获取K线（限制并发，避免IPC反序列化阻塞） =====
    const tK0 = performance.now();
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

      const batchSecids = batch.map(s => s.secid);
      const tKFetch0 = performance.now();
      const klinesMap = await dataProvider.getKLines(batchSecids, today, this.KLINE_DAYS);
      const tKFetch1 = performance.now();
      console.log(`[PerfKLine] 批量IPC ${batchSecids.length}只: ${(tKFetch1-tKFetch0).toFixed(1)}ms`);
      const validItems: Array<{ stock: Stock.DetailItem; klines: Stock.KLineItem[]; batchIndex: number }> = [];
      const invalidResults: Array<{ pass: false; reason: string; secid: string }> = [];

      // [优化] 大数据量反序列化后，分批处理避免阻塞UI
      const tKProcess0 = performance.now();
      for (let i = 0; i < batch.length; i++) {
        const stock = batch[i];
        const klines = klinesMap[stock.secid];
        if (!klines || klines.length < 60) {
          invalidResults.push({ pass: false, reason: 'K线不足', secid: stock.secid });
        } else if (klines[klines.length - 1].date !== today) {
          invalidResults.push({ pass: false, reason: '停牌', secid: stock.secid });
        } else {
          // [优化] 只保留策略计算需要的字段，减少内存占用和后续传输
          const liteKlines = klines.map(k => ({
            date: k.date,
            kp: k.kp,
            sp: k.sp,
            zg: k.zg,
            zd: k.zd,
          }));
          validItems.push({ stock, klines: liteKlines, batchIndex: i });
        }
        // [优化] 每处理5只让出一次，避免106只同步循环阻塞UI
        if (i % 5 === 0) {
          await yieldToMain(1);
        }
      }
      const tKProcess1 = performance.now();
      console.log(`[PerfKLine] 处理${batch.length}只: ${(tKProcess1-tKProcess0).toFixed(1)}ms`);

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
    
    const tK1 = performance.now();
    console.log(`[Perf] [${today}] K线IO: ${(tK1 - tK0).toFixed(1)}ms (${filteredStocks.length}只→${batchTasks.reduce((s,b)=>s+b.validItems.length,0)}只)`);
    // ===== [核心优化] 步骤B+C：Worker 执行策略优化 + 候选筛选（纯计算全部迁移） =====
    const totalBatches = batchTasks.length;
    let completedBatches = 0;

    const batchPhaseStartPercent = Math.round(currentBase + dayPercentStep * 0.3);
    const batchPhaseEndPercent = Math.round(currentBase + dayPercentStep * 0.6);
    const batchPercentRange = batchPhaseEndPercent - batchPhaseStartPercent;

    onProgress?.(`[${today}] 并行策略优化+筛选 ${totalBatches} 个batch...`, batchPhaseStartPercent);
    console.log(`[OptBacktest] [${today}] 启动并行优化+筛选: ${totalBatches} 个batch`);

    const tWorker0 = performance.now();
    const allBatchResults = await this.runWithLimit(
      batchTasks,
      async (b, batchIndex) => {
        const backtestParams = {
          fixedStopLossPct: 1 - this.STOP_LOSS_INIT_PCT,
          trailingStopLossPct: 1 - this.TRAILING_STOP_PCT,
          strategyMode: this.strategyMode,
        };
        const screenParams = {
          strongStockDay: strongStockDay,
          minStrategyScore: this.MIN_STRATEGY_SCORE,
          strongLookback: this.STRONG_LOOKBACK,
        };

        const items = b.validItems.map(v => ({
          stock: { secid: v.stock.secid, bk: v.stock.bk },
          klines: v.klines.map(k => ({
            date: k.date,
            kp: k.kp,
            sp: k.sp,
            zg: k.zg,
            zd: k.zd,
          })),
        }));

        // [优化] 按股票聚合缓存：一个股票一个文件，内部按 date 区分
        const cachedResults: (BatchBacktestAndScreenResult | undefined)[] = [];
        const uncachedIndices: number[] = [];
        const uncachedItems: typeof items = [];

        // 预加载本 batch 涉及的所有股票缓存文件（减少 IO 次数）
        const fileCache = new Map<string, StockScreenCacheFile>();
        for (const { stock, klines } of items) {
          const lastDate = klines[klines.length - 1]?.date;
          if (lastDate) {
            const key = getScreenCacheKey(stock.secid);
            if (!fileCache.has(key)) {
              const file = await ReadCache<StockScreenCacheFile>(key);
              fileCache.set(key, file || {});
            }
            const entry = fileCache.get(key)![lastDate];
            if (entry &&
                entry.params.fixedStopLossPct === backtestParams.fixedStopLossPct &&
                entry.params.trailingStopLossPct === backtestParams.trailingStopLossPct &&
                entry.params.minStrategyScore === screenParams.minStrategyScore &&
                entry.params.strategyMode === backtestParams.strategyMode) {
              cachedResults.push(entry.result);
              continue;
            }
          }
          uncachedIndices.push(cachedResults.length);
          uncachedItems.push({ stock, klines });
          cachedResults.push(undefined); // 占位
        }

        const cachedCount = items.length - uncachedItems.length;
        console.log(`[OptBacktest] [${today}] batch ${batchIndex} 共 ${items.length} 只，聚合缓存命中 ${cachedCount} 只，实际计算 ${uncachedItems.length} 只`);

        let workerResults: BatchBacktestAndScreenResult[] = [];
        if (uncachedItems.length > 0) {
          if (this.workerExecutor) {
            workerResults = await this.workerExecutor('batchBacktestAndScreen', [
              uncachedItems,
              backtestParams,
              screenParams,
            ]);
          } else {
            workerResults = batchBacktestAndScreen(uncachedItems, backtestParams, screenParams);
          }
        }

        // 合并缓存和Worker结果，并写入聚合缓存
        const mergedResults: BatchBacktestAndScreenResult[] = [];
        let workerIdx = 0;
        for (let i = 0; i < items.length; i++) {
          if (cachedResults[i]) {
            mergedResults.push(cachedResults[i]!);
          } else {
            const result = workerResults[workerIdx++];
            mergedResults.push(result);

            const { stock, klines } = items[i];
            const lastDate = klines[klines.length - 1]?.date;
            if (lastDate) {
              const key = getScreenCacheKey(stock.secid);
              const file = fileCache.get(key) || {};
              file[lastDate] = {
                params: {
                  fixedStopLossPct: backtestParams.fixedStopLossPct,
                  trailingStopLossPct: backtestParams.trailingStopLossPct,
                  minStrategyScore: screenParams.minStrategyScore,
                  strategyMode: backtestParams.strategyMode,
                },
                result,
              };
              fileCache.set(key, file);
              await WriteCache(key, file);
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
    const tWorker1 = performance.now();
    console.log(`[Perf] [${today}] Worker总耗时: ${(tWorker1 - tWorker0).toFixed(1)}ms (${totalBatches}batch)`);
    
    
    // ===== 2-4: 板块驱动条件（观察列表+候选合并并行）+ 排序和仓位筛选 =====
    const tScreen0 = performance.now();
    const buyCandidates: Array<{
      secid: string;
      score: number;
      boardCode: string;
      price: number;
      reason: string;
      strategyType: 'macd' | 'rsi';
      strategyParams: MACDStrategyResult | RSIBacktestResult;
    }> = [];

    // ===== 2-4 前置：批量预查询所有板块条件 =====
    const tPreBoard0 = performance.now();

    // 1. 收集所有需要检查的日期和股票
    const itemsToCheck: Array<{
      type: 'watch' | 'candidate';
      stock: Stock.DetailItem;
      klines: Stock.KLineItem[];
      screenResult: BatchBacktestAndScreenResult['screenResult'];
    }> = [];

    for (let i = 0; i < batchTasks.length; i++) {
      const b = batchTasks[i];
      const batchResults = allBatchResults[i];
      for (let j = 0; j < batchResults.length; j++) {
        const { screenResult } = batchResults[j];
        const { stock, klines } = b.validItems[j];
        if (!screenResult.pass) {
          if (screenResult.reason === '最近3天无买入信号' &&
              !this.positions.has(stock.secid) &&
              !this.watchList.has(stock.secid)) {
            itemsToCheck.push({ type: 'watch', stock, klines, screenResult });
          }
          continue;
        }
        itemsToCheck.push({ type: 'candidate', stock, klines, screenResult });
      }
    }

    // [优化] 当排名百分比为1时，跳过相关检查，不发起请求
    const skipBoardRankCheck = this.BOARD_RANK_PCT >= 1;
    const skipStockRankCheck = this.STOCK_RANK_PCT >= 1;
    const uniqueDates = [...new Set(itemsToCheck.map(i => i.screenResult.tDayDate!))];

    // 2. 批量预查 getAllBoards（按日期去重）
    let boardsByDate: Record<string, Array<{ code: string; name: string; zf: number }>> = {};
    if (!skipBoardRankCheck) {
      console.log(`[OptBacktest] [${today}] 批量预查板块: ${itemsToCheck.length}只, 涉及${uniqueDates.length}个日期`);
      if (uniqueDates.length > 0) {
        // 如果 dataProvider 支持批量接口
        if ((dataProvider as any).getAllBoardsBatch) {
          boardsByDate = await (dataProvider as any).getAllBoardsBatch(uniqueDates);
        } else {
          // fallback：用请求锁并发查
          const dateResults = await this.runWithConcurrency(
            uniqueDates,
            async (date) => ({ date, boards: await this.getAllBoardsCached(dataProvider, '', date) }),
            3
          );
          for (const r of dateResults) {
            if (r.status === 'fulfilled') {
              boardsByDate[r.value.date] = r.value.boards || [];
            }
          }
        }
      }
    } else {
      console.log(`[OptBacktest] [${today}] 板块排名检查已跳过(BOARD_RANK_PCT=${this.BOARD_RANK_PCT})`);
    }

    // 3. 预计算每只股票的 boardCode 和是否需要查 boardStocks
    const boardStockRequests: Array<{ date: string; boardCode: string | null; boardName: string; secid: string }> = [];
    const preComputed = new Map<string, {
      boardPass: boolean;
      boardRankPass: boolean;
      boardCode: string | null;
      boardRank: number;
      stockRank: number;
      nonLimitCount: number;
    }>();

    for (const item of itemsToCheck) {
      const { stock, screenResult } = item;
      const date = screenResult.tDayDate!;

      if (skipBoardRankCheck) {
        // 板块排名检查已跳过，所有板块都通过
        if (skipStockRankCheck || screenResult.strongType === 'limit_up') {
          preComputed.set(stock.secid, { boardPass: true, boardRankPass: true, boardCode: null, boardRank: -1, stockRank: -1, nonLimitCount: 0 });
        } else {
          // 仍需查 boardStocks（通过板块名称查找）
          preComputed.set(stock.secid, { boardPass: true, boardRankPass: false, boardCode: null, boardRank: -1, stockRank: -1, nonLimitCount: 0 });
          boardStockRequests.push({ date, boardCode: null, boardName: stock.bk, secid: stock.secid });
        }
        continue;
      }

      const boards = boardsByDate[date] || [];
      
      let boardPass = false;
      let boardCode: string | null = null;
      let boardRank = -1;

      if (boards.length > 0) {
        const sortedBoards = boards.sort((a, b) => b.zf - a.zf);
        boardRank = sortedBoards.findIndex(b => b.name === stock.bk);
        if (boardRank < 0) boardRank = sortedBoards.findIndex(b => b.name.startsWith(stock.bk));
        if (boardRank >= 0) {
          boardPass = (boardRank + 1) <= boards.length * this.BOARD_RANK_PCT;
          boardCode = boards[boardRank].code;
        }
      }

      if (!boardPass) {
        preComputed.set(stock.secid, { boardPass: false, boardRankPass: false, boardCode, boardRank, stockRank: -1, nonLimitCount: 0 });
        continue;
      }

      if (screenResult.strongType === 'limit_up' || skipStockRankCheck) {
        preComputed.set(stock.secid, { boardPass: true, boardRankPass: true, boardCode, boardRank, stockRank: -1, nonLimitCount: 0 });
      } else {
        // 需要查 boardStocks，收集请求
        if (boardCode) {
          boardStockRequests.push({ date, boardCode, boardName: stock.bk, secid: stock.secid });
        }
      }
    }

    // 4. 批量查 boardStocks（按 date+boardCode 去重）
    let boardStocksByKey: Record<string, Array<{ secid: string; zf: number }>> = {};
    if (boardStockRequests.length > 0) {
      // 去重：同 date+boardCode 只查一次
      const uniqueRequests = new Map<string, { date: string; boardCode: string | null; boardName: string }>();
      for (const req of boardStockRequests) {
        const key = `${req.date}_${req.boardCode}`;
        if (!uniqueRequests.has(key)) {
          uniqueRequests.set(key, { date: req.date, boardCode: req.boardCode, boardName: req.boardName });
        }
      }

      if ((dataProvider as any).getBoardStocksBatch) {
        const batchReqs = Array.from(uniqueRequests.values());
        boardStocksByKey = await (dataProvider as any).getBoardStocksBatch(batchReqs);
      } else {
        // fallback：请求锁并发查
        const reqResults = await this.runWithConcurrency(
          Array.from(uniqueRequests.entries()),
          async ([key, req]) => ({
            key,
            stocks: await this.getBoardStocksCached(dataProvider, req.date, req.boardCode, req.boardName)
          }),
          3
        );
        for (const r of reqResults) {
          if (r.status === 'fulfilled') {
            boardStocksByKey[r.value.key] = r.value.stocks || [];
          }
        }
      }

      // 5. 回填 stockRank
      for (const req of boardStockRequests) {
        const key = `${req.date}_${req.boardCode}`;
        const stocks = boardStocksByKey[key] || [];
        const nonLimitStocks = stocks.filter(s => !isLimitUpStock(s.secid, s.zf)).sort((a, b) => b.zf - a.zf);
        const stockRank = nonLimitStocks.findIndex(s => s.secid === req.secid);
        const boardRankPass = stockRank >= 0 && (stockRank + 1) <= nonLimitStocks.length * this.STOCK_RANK_PCT;
        
        const existing = preComputed.get(req.secid)!;
        preComputed.set(req.secid, {
          ...existing,
          boardRankPass: boardRankPass || stockRank < 0, // 找不到排名时宽松处理
          stockRank,
          nonLimitCount: nonLimitStocks.length
        });
      }
    }

    const tPreBoard1 = performance.now();
    console.log(`[Perf] [${today}] 板块预查询: ${(tPreBoard1 - tPreBoard0).toFixed(1)}ms (${uniqueDates}日期, ${boardStockRequests.length}股票需查成分股)`);

    // [新增] 统计有买入信号但因其他原因失败的分布
    const signalFailStats: Record<string, number> = {};
    let hasSignalButFailed = 0;
    for (const item of itemsToCheck) {
      const { screenResult } = item;
      if (!screenResult.pass && screenResult.mDayIndex !== undefined && screenResult.mDayIndex >= 0) {
        hasSignalButFailed++;
        const reason = screenResult.reason || '未知原因';
        signalFailStats[reason] = (signalFailStats[reason] || 0) + 1;
      }
    }
    if (hasSignalButFailed > 0) {
      console.log(`[OptBacktest] [${today}] 📊 有买入信号但筛选失败统计: ${hasSignalButFailed} 只`);
      console.log(`[OptBacktest] [${today}] 📊 失败原因分布:`, signalFailStats);
    }

    // 6. 根据预计算结果分配（纯内存操作，零 IPC）
    for (const item of itemsToCheck) {
      const { type, stock, klines, screenResult } = item;
      const computed = preComputed.get(stock.secid);

      if (!computed || !computed.boardPass) {
        console.log(`[OptBacktest] [${today}] ${stock.secid} ❌ ${type === 'watch' ? '观察' : ''}筛选失败: 板块未进全市场前${(this.BOARD_RANK_PCT * 100).toFixed(0)}%`);
        continue;
      }

      if (!computed.boardRankPass) {
        console.log(`[OptBacktest] [${today}] ${stock.secid} ❌ ${type === 'watch' ? '观察' : ''}筛选失败: 股票未进板块内前${(this.STOCK_RANK_PCT * 100).toFixed(0)}%(排除涨停后${computed.nonLimitCount}只)`);
        continue;
      }

      if (type === 'watch') {
        this.watchList.set(stock.secid, {
          secid: stock.secid,
          boardCode: stock.bk,
          strategyType: screenResult.bestType!,
          strategyParams: screenResult.bestResult!,
          score: screenResult.score!,
          addedDate: today,
          tDayDate: screenResult.tDayDate!,
          strongType: screenResult.strongType!,
          maxWatchDays: this.MAX_WATCH_DAYS,
        });
        const watchParamsStr = this.formatStrategyParams(screenResult.bestType, screenResult.bestResult);
        console.log(`[OptBacktest] [${today}] ${stock.secid} 👀 加入观察列表 (评分${screenResult.score!.toFixed(1)})${watchParamsStr ? ' | ' + watchParamsStr : ''}`);
      } else {
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
      }
    }

    const tScreen1 = performance.now();
    console.log(`[Perf] [${today}] 板块筛选总耗时: ${(tScreen1 - tScreen0).toFixed(1)}ms (${itemsToCheck.length}只→${buyCandidates.length}候选)`);

    // 合并观察列表候选和正常候选，去重
    const allBuyCandidates = [...watchBuyCandidates, ...buyCandidates];
    const uniqueCandidates = new Map<string, typeof allBuyCandidates[0]>();
    for (const c of allBuyCandidates) {
      if (!uniqueCandidates.has(c.secid)) {
        uniqueCandidates.set(c.secid, c);
      }
    }
    const finalCandidates = Array.from(uniqueCandidates.values());

    // 2-4: 排序和仓位筛选
    if (finalCandidates.length > 0) {
      finalCandidates.sort((a, b) => b.score - a.score);
      console.log(`[OptBacktest] [${today}] 候选排序前5:`, finalCandidates.slice(0, 5).map(c => `${c.secid}(${c.score.toFixed(1)})`));

      const boardHoldings = new Map<string, number>();
      for (const pos of this.positions.values()) {
        boardHoldings.set(pos.boardCode, (boardHoldings.get(pos.boardCode) || 0) + 1);
      }

      for (const candidate of finalCandidates) {
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

        const computed = preComputed.get(candidate.secid);
        this.pendingOrders.push({
          secid: candidate.secid,
          type: 'buy',
          reason: candidate.reason,
          signalDate: today,
          boardCode: candidate.boardCode,
          strategyType: candidate.strategyType,
          strategyParams: candidate.strategyParams,
          score: candidate.score,
          boardRank: computed?.boardRank,
          stockRank: computed?.stockRank,
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

    const positionSecids = Array.from(this.positions.keys());
    const klinesMap = positionSecids.length > 0
      ? await dataProvider.getKLines(positionSecids, date, 1)
      : {};

    let posCount = 0;
    for (const [secid, pos] of this.positions) {
      if (this.isCancelled()) return true;
      await this.waitIfPaused();
      if (this.isCancelled()) return true;

      const klines = klinesMap[secid];
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

  // [新增] 按股票聚合交易统计
  private calculateStockStats(): StockTradeStats[] {
    const stockMap = new Map<string, StockTradeStats>();
    const buyRecords = this.tradeRecords.filter(t => t.type === 'buy');
    const sellRecords = this.tradeRecords.filter(t => t.type === 'sell');

    for (const buy of buyRecords) {
      let stats = stockMap.get(buy.secid);
      if (!stats) {
        stats = {
          secid: buy.secid,
          boardCode: '',
          strategyType: buy.strategyType || 'macd',
          strategyParams: buy.strategyParams || ({} as any),
          score: buy.score || 0,
          boardRank: buy.boardRank,
          stockRank: buy.stockRank,
          strategyParamsStr: this.formatStrategyParams(buy.strategyType, buy.strategyParams),
          trades: [],
          totalTrades: 0,
          winTrades: 0,
          lossTrades: 0,
          totalPnl: 0,
          winRate: 0,
          avgReturnPct: 0,
        };
        stockMap.set(buy.secid, stats);
      }
      const currentStats = stats;

      const sell = sellRecords.find(s =>
        s.secid === buy.secid &&
        s.date > buy.date &&
        !currentStats.trades.some(t => t.sellDate === s.date)
      );

      const detail: StockTradeDetail = {
        buyDate: buy.date,
        buyPrice: buy.price,
        quantity: buy.quantity,
      };

      if (sell) {
        detail.sellDate = sell.date;
        detail.sellPrice = sell.price;
        detail.pnl = sell.pnl;
        detail.returnPct = sell.returnPct;
        detail.sellReason = sell.reason;
        detail.holdDays = this.getTradeDaysDiff(buy.date, sell.date);
      }

      currentStats.trades.push(detail);
    }

    const result: StockTradeStats[] = [];
    for (const stats of stockMap.values()) {
      const completed = stats.trades.filter(t => t.sellDate);
      const wins = completed.filter(t => (t.pnl || 0) > 0);
      stats.totalTrades = completed.length;
      stats.winTrades = wins.length;
      stats.lossTrades = completed.length - wins.length;
      stats.totalPnl = completed.reduce((s, t) => s + (t.pnl || 0), 0);
      stats.winRate = completed.length > 0 ? wins.length / completed.length : 0;
      stats.avgReturnPct = completed.length > 0
        ? completed.reduce((s, t) => s + (t.returnPct || 0), 0) / completed.length
        : 0;
      result.push(stats);
    }

    result.sort((a, b) => b.totalPnl - a.totalPnl);
    return result;
  }

  // [新增] 按策略得分区间统计胜率分布
  private calculateScoreDistribution(stockStats: StockTradeStats[]): ScoreWinRateDistribution[] {
    const ranges = [
      { label: '0-50', min: 0, max: 50 },
      { label: '50-100', min: 50, max: 100 },
      { label: '100-150', min: 100, max: 150 },
      { label: '150-200', min: 150, max: 200 },
      { label: '200+', min: 200, max: Infinity },
    ];

    return ranges.map(r => {
      const items = stockStats.filter(s => s.score >= r.min && s.score < r.max && s.totalTrades > 0);
      const totalTrades = items.reduce((sum, s) => sum + s.totalTrades, 0);
      const winTrades = items.reduce((sum, s) => sum + s.winTrades, 0);
      const lossTrades = items.reduce((sum, s) => sum + s.lossTrades, 0);
      const totalReturn = items.reduce((sum, s) => sum + s.avgReturnPct * s.totalTrades, 0);

      return {
        scoreRange: r.label,
        minScore: r.min,
        maxScore: r.max === Infinity ? 9999 : r.max,
        count: items.length,
        winTrades,
        lossTrades,
        winRate: totalTrades > 0 ? winTrades / totalTrades : 0,
        avgReturnPct: totalTrades > 0 ? totalReturn / totalTrades : 0,
      };
    });
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

    const stockStats = this.calculateStockStats();
    const scoreDistribution = this.calculateScoreDistribution(stockStats);

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
      dailyValues: this.dailyValues,
      stockStats,
      scoreDistribution,
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