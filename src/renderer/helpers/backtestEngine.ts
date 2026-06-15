import { Stock } from '@/types/stock';

import { WriteCache } from '@/helpers/backtestCache';
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
import stock from '@/reducers/stock';

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
  // const macdCacheKey = secid && lastDate
  //   ? getCacheKey('macd', secid, lastDate, `${fixedStopLossPct}_${trailingStopLossPct}`)
  //   : null;
  // if (macdCacheKey) {
  //   const cached = await ReadCache<MACDStrategyResult[]>(macdCacheKey);
  //   if (cached) {
  //     console.log(`[Cache] MACD 命中缓存: ${secid} ${lastDate}`);
  //     return cached;
  //   }
  // }

  const results = computeMACDStrategy(klines, fixedStopLossPct, trailingStopLossPct);

  // if (macdCacheKey) {
  //   await WriteCache(macdCacheKey, results);
  //   console.log(`[Cache] MACD 写入缓存: ${secid} ${lastDate} (${results.length} 组)`);
  // }

  return results;
}

export async function optimizeRSIStrategy(
  klines: Stock.KLineItem[],
  rsiPeriods: number[] = [12, 24],
  fixedStopLossPct: number = 0.05,
  trailingStopLossPct: number = 0.06,
  secid?: string
): Promise<RSIBacktestResult[]> {
  const lastDate = klines[klines.length - 1]?.date;
  // const rsiCacheKey = secid && lastDate
  //   ? getCacheKey('rsi', secid, lastDate, `${rsiPeriods.join('_')}_${fixedStopLossPct}_${trailingStopLossPct}`)
  //   : null;
  // if (rsiCacheKey) {
  //   const cached = await ReadCache<RSIBacktestResult[]>(rsiCacheKey);
  //   if (cached) {
  //     console.log(`[Cache] RSI 命中缓存: ${secid} ${lastDate}`);
  //     return cached;
  //   }
  // }

  const results = computeRSIStrategy(klines, rsiPeriods, fixedStopLossPct, trailingStopLossPct);

  // if (rsiCacheKey) {
  //   await WriteCache(rsiCacheKey, results);
  //   console.log(`[Cache] RSI 写入缓存: ${secid} ${lastDate} (${results.length} 组)`);
  // }

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
  highestPrice: number;        // 用于移动止损
  stopLossPrice: number;       // 固定止损价
  strategyType: 'macd' | 'rsi';
  strategyParams: MACDStrategyResult | RSIBacktestResult;
  
  // [新增] 止盈相关
  takeProfitPrice: number;     // 固定止盈目标价

  // [新增] 出现买入信号当天K线实体最低价（用于时间止损）
  signalDayEntityLow: number;

  consecutiveDeclineDays: number;  // 买入后连续下跌天数
  pullBackPct?: number;             // 买入时深度回调比例
  zsz?: number;                     // 总市值（亿元）
}

export interface StrategyPendingOrder {
  secid: string;
  type: 'buy' | 'sell';
  reason: string;
  signalDate: string;
  signalOpenPrice?: number;      // [新增] 信号日开盘价（买入订单保留条件判断用）
  signalEntityLow?: number;      // [新增] 信号日K线实体最低价
  executePrice?: number;         // [新增] 指定执行价格（当日收盘卖使用收盘价，次日开盘卖不设置）
  canExecuteToday?: boolean;     // [新增] 当天是否可立即执行（用于 UI 区分保留/执行）
  watching?: boolean;            // [新增] 买入订单是否处于观察状态（暂不执行，次日继续确认）
  boardCode?: string;
  strategyType?: 'macd' | 'rsi';
  strategyParams?: MACDStrategyResult | RSIBacktestResult;
  score?: number;
  boardRank?: number;
  stockRank?: number;
  strongType?: 'limit_up' | 'new_high_60';
  pullBackPct?: number;
  zsz?: number; // 总市值（亿元）
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
  boardCode?: string;
  returnPct?: number;
  strategyType?: 'macd' | 'rsi';
  strategyParams?: MACDStrategyResult | RSIBacktestResult;
  pullBackPct?: number;
  zsz?: number; // 总市值（亿元）
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
  strongType?: 'limit_up' | 'new_high_60';
  zsz?: number; // 总市值（亿元）
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

export interface RankWinRateDistribution {
  rankType: 'boardRank' | 'stockRank';
  rankRange: string;
  minRank: number;
  maxRank: number;
  count: number;        // 该区间完成交易次数
  uniqueCount: number;  // 涉及的唯一股票数
  winTrades: number;
  lossTrades: number;
  winRate: number;
  avgReturnPct: number;
}

export interface PullBackWinRateDistribution {
  pullBackRange: string;
  minPullBack: number;
  maxPullBack: number;
  count: number;
  uniqueCount: number;
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
  boardRankDistribution: RankWinRateDistribution[];
  stockRankDistribution: RankWinRateDistribution[];
  pullBackDistribution: PullBackWinRateDistribution[];
  marketCapDistribution: MarketCapWinRateDistribution[];
}

export interface StrategyDataProvider {
  getStrongStocks(date: string): Promise<Stock.DetailItem[]>;
  getKLines(secids: string[], endDate: string, days?: number): Promise<Record<string, Stock.KLineItem[]>>;
  getAllBoards(associateBoardName: string, date: string): Promise<Array<{ code: string; name: string; zf: number }>>;
  getBoardStocks(date: string, boardCode: string | null, boardName: string): Promise<Array<{ secid: string; zf: number }>>;
  // [新增] 批量接口
  getAllBoardsBatch(dates: string[]): Promise<Record<string, Array<{ code: string; name: string; zf: number }>>>;
  getBoardStocksBatch(requests: Array<{ date: string; boardCode: string | null; boardName: string }>): Promise<Record<string, Array<{ secid: string; zf: number }>>>;
  // 获取指定日期的涨跌比
  getUpRatio(dates: string[]): Promise<number[]>;
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
  strongStockDay: string;
  zsz: number; // 增加市值指标
}

// ===== 回测断点续跑快照 =====
const BACKTEST_SNAPSHOT_VERSION = 1;

export type BacktestNodeType =
  | 'day-start'        // 当天 stage1 开始前（pendingOrders 为当日待执行或空）
  | 'pending-review'   // stage1 已过滤出可执行订单，等待用户确认前
  | 'after-stage1'     // stage1 执行完毕（pendingOrders 已清空）
  | 'after-stage2'     // stage2 信号生成完毕（pendingOrders 为次日待执行）
  | 'day-end';         // stage3 净值记录完毕，可进入下一交易日

export interface BacktestSnapshotParams {
  initialCapital: number;
  maxPositions: number;
  positionRatio: number;
  stopLossInitPct: number;
  trailingStopPct: number;
  takeProfitPct: number;
  minStrategyScore: number;
  strongLookback: number;
  maxWatchDays: number;
  boardRankPct: number;
  stockRankPct: number;
  strategyMode: 'macd' | 'rsi' | 'both';
  structureBreakDays: number;
  rangeBoundDays: number;
  upDownRateHighThresh: number;
  upDownRateLowThresh: number;
  pullbackPct: number;
  sellAtOpen: boolean;
  timeExitMaxDays: number;
  timeExitMinReturn: number;
  profitIgnoreSignalPct: number;
  trailingStopStartPct: number;
  trailingStopTightenPct: number;
  buyThresholds: number[];
  sellThresholds: number[];
  filterStrongType: 'limit_up' | 'new_high_60' | 'both';
  steepness: number;
}

export interface BacktestSnapshot {
  version: number;
  createdAt: number;
  nodeType: BacktestNodeType;
  currentDayIndex: number;
  currentDate: string;
  params: BacktestSnapshotParams;
  state: {
    capital: number;
    availableCash: number;
    positions: [string, StrategyPosition][];
    pendingOrders: StrategyPendingOrder[];
    tradeRecords: StrategyTradeRecord[];
    dailyValues: StrategyDailyValue[];
    tradeDays: string[];
    watchList: [string, WatchListItem][];
    dailyRiskPreference: [string, { prefer: string; upRatio: number; upRatioMA5: number }][];
    lastPositionPrices: [string, number][];
  };
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
  private pendingOrderReviewCallback?: (orders: StrategyPendingOrder[], today: string) => Promise<StrategyPendingOrder[]>;
  private onPartialResultCallback?: (result: StrategyBacktestResult) => void;
  private workerExecutor?: (method: string, args?: any[]) => Promise<any>;
  private filterTradeDaysCache: Map<string, string[]> = new Map();
  // [新增] 持仓最后收盘价，用于回测结束时统计持仓盈亏
  private lastPositionPrices = new Map<string, number>();

  // [新增] 断点续跑相关状态
  private currentDayIndex = 0;
  private currentStage: 'stage1' | 'stage2' | 'stage3' | 'between' = 'between';
  private stage1Reviewed = false;
  private onSnapshotCallback?: (snapshot: BacktestSnapshot) => void;

    // [优化] 板块数据内存缓存
  private boardCache = new Map<string, Array<{ code: string; name: string; zf: number }>>();
  private boardStocksCache = new Map<string, Array<{ secid: string; zf: number }>>();
  
  // [新增] 请求锁：同一 key 的并发查询复用同一个 Promise，避免重复 IPC
  private boardRequestLock = new Map<string, Promise<Array<{ code: string; name: string; zf: number }> | null>>();
  private boardStocksRequestLock = new Map<string, Promise<Array<{ secid: string; zf: number }> | null>>();
  // [新增] 每日市场风险偏好缓存（high/mid/low），供止损参数动态选择使用
  private dailyRiskPreference: Map<string, {prefer: string, upRatio: number, upRatioMA5: number}> = new Map();

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
  private readonly MAX_PENDING_DAYS = 3; // [新增] 买入信号未成交时最多保留的交易日数

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
  private readonly MAX_SAME_BOARD = 1;
  private readonly MIN_POSITION_RATIO = 0.05;
  private readonly SLIPPAGE = 0.001;
  private readonly COMMISSION = 0.0003;
  private readonly STAMP_TAX = 0.001;
  private readonly BATCH_SIZE = 30; // [优化] 从 5 改为 20，减少 Worker 调度开销
  private readonly KLINE_DAYS = 150; // 应该至少要半年

  // 止损参数（根据市场风险偏好高/中/低动态选择）
  private STOP_LOSS_INIT_PCT = 0.95;   // 固定止损基准：买入价下跌 5% 止损（根据市场风险偏好动态调整）
  private TRAILING_STOP_PCT = 0.90;    // 移动止损基准：最高价回落 10%（根据市场风险偏好动态调整）
  
  // [新增] 止盈参数
  private TAKE_PROFIT_PCT = 1.15;         // 固定止盈：买入价上涨 15% 止盈

  // [新增] 移动止损盈利阈值参数
  private TRAILING_STOP_START_PCT = 0.05;  // 盈利低于该比例时移动止损不启动
  private TRAILING_STOP_TIGHTEN_PCT = 0.15; // 盈利超过该比例时收紧移动止损保护

  private MIN_STRATEGY_SCORE = 100;
  private STRONG_LOOKBACK = 10;
  private BOARD_RANK_PCT = 0.3;
  private STOCK_RANK_PCT = 0.3;
  private strategyMode: 'macd' | 'rsi' | 'both' = 'both';
  // [新增] 时间止损参数
  private STRUCTURE_BREAK_DAYS = 3;   // 结构破坏：持仓天数阈值
  private RANGE_BOUND_DAYS = 5;       // 横盘震荡：持仓天数阈值
  // [新增] 涨跌比阈值配置（用于动态计算最大回撤阈值）
  private UP_DOWN_RATE_HIGH_THRESH = 1.5;  // ma5 > 该阈值，市场风险偏好高
  private UP_DOWN_RATE_LOW_THRESH = 1.0;   // ma5 < 该阈值，市场风险偏好低
  // [新增] 深度回调阈值配置（根据市场风险偏好动态选择）
  private PULLBACK_PCT = 0.3;    // 最大回撤基准：30%（根据市场风险偏好动态调整）
  // [新增] 卖出时机配置
  private SELL_AT_OPEN = false;            // true=次日开盘卖, false=当日收盘卖
  // [新增] 时间止盈参数
  private TIME_EXIT_MAX_DAYS = 5;     // 最大持有天数，资金效率止盈
  private TIME_EXIT_MIN_RETURN = 0.05; // 收益率低于该值触发资金效率止盈
  private PROFIT_IGNORE_SIGNAL_PCT = 0.10; // 盈利超过该比例后忽略策略信号（让利润奔跑）
  private RSI_BUY_THRESHOLDS = [35, 40, 45]; // RSI 买入阈值网格
  private RSI_SELL_THRESHOLDS = [65, 70, 75, 80, 85]; // RSI 卖出阈值网格
  private FILTER_STRONG_TYPE: 'limit_up' | 'new_high_60' | 'both' = 'both'; // 强势股票筛选类型
  /** Sigmoid陡度系数（控制变化速度） */
  private STEEPNESS = 20;  // 默认10，推荐20，激进30

  constructor(
    tradeDays: string[],
    initialCapital: number = 1000000,
    workerExecutor?: (method: string, args?: any[]) => Promise<any>,
    options?: {
      stopLossInitPct?: number;
      trailingStopPct?: number;
      takeProfitPct?: number;
      minStrategyScore?: number;
      strongLookback?: number;
      maxPositions?: number;
      positionRatio?: number;
      workerCount?: number; // [优化] 新增
      maxWatchDays?: number;
      boardRankPct?: number;
      stockRankPct?: number;
      strategyMode?: 'macd' | 'rsi' | 'both';
      structureBreakDays?: number;
      rangeBoundDays?: number;
      upDownRateHighThresh?: number;
      upDownRateLowThresh?: number;
      pullbackPct?: number;
      sellAtOpen?: boolean;
      timeExitMaxDays?: number;
      timeExitMinReturn?: number;
      profitIgnoreSignalPct?: number;
      trailingStopStartPct?: number;
      trailingStopTightenPct?: number;
      buyThresholds?: number[];
      sellThresholds?: number[];
      filterStrongType?: 'limit_up' | 'new_high_60' | 'both';
      steepness?: number;
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
    if (options?.takeProfitPct !== undefined) this.TAKE_PROFIT_PCT = options.takeProfitPct;
    if (options?.minStrategyScore !== undefined) this.MIN_STRATEGY_SCORE = options.minStrategyScore;
    if (options?.strongLookback !== undefined) this.STRONG_LOOKBACK = options.strongLookback;
    if (options?.maxPositions !== undefined) this.MAX_POSITIONS = options.maxPositions;
    if (options?.positionRatio !== undefined) this.POSITION_RATIO = options.positionRatio;
    if (options?.maxWatchDays !== undefined) this.MAX_WATCH_DAYS = options.maxWatchDays;
    if (options?.boardRankPct !== undefined) this.BOARD_RANK_PCT = options.boardRankPct;
    if (options?.stockRankPct !== undefined) this.STOCK_RANK_PCT = options.stockRankPct;
    if (options?.strategyMode !== undefined) this.strategyMode = options.strategyMode;
    if (options?.structureBreakDays !== undefined) this.STRUCTURE_BREAK_DAYS = options.structureBreakDays;
    if (options?.rangeBoundDays !== undefined) this.RANGE_BOUND_DAYS = options.rangeBoundDays;
    if (options?.upDownRateHighThresh !== undefined) this.UP_DOWN_RATE_HIGH_THRESH = options.upDownRateHighThresh;
    if (options?.upDownRateLowThresh !== undefined) this.UP_DOWN_RATE_LOW_THRESH = options.upDownRateLowThresh;
    if (options?.pullbackPct !== undefined) this.PULLBACK_PCT = options.pullbackPct;
    if (options?.sellAtOpen !== undefined) this.SELL_AT_OPEN = options.sellAtOpen;
    if (options?.steepness !== undefined) this.STEEPNESS = options.steepness;
    if (options?.timeExitMaxDays !== undefined) this.TIME_EXIT_MAX_DAYS = options.timeExitMaxDays;
    if (options?.timeExitMinReturn !== undefined) this.TIME_EXIT_MIN_RETURN = options.timeExitMinReturn;
    if (options?.profitIgnoreSignalPct !== undefined) this.PROFIT_IGNORE_SIGNAL_PCT = options.profitIgnoreSignalPct;
    if (options?.trailingStopStartPct !== undefined) this.TRAILING_STOP_START_PCT = options.trailingStopStartPct;
    if (options?.trailingStopTightenPct !== undefined) this.TRAILING_STOP_TIGHTEN_PCT = options.trailingStopTightenPct;
    if (options?.buyThresholds !== undefined) this.RSI_BUY_THRESHOLDS = options.buyThresholds;
    if (options?.sellThresholds !== undefined) this.RSI_SELL_THRESHOLDS = options.sellThresholds;
    if (options?.filterStrongType !== undefined) this.FILTER_STRONG_TYPE = options.filterStrongType;
    console.log(`[OptBacktest] 初始化完成 | 初始资金: ${initialCapital.toLocaleString()} | 交易日数: ${tradeDays.length} | Worker: ${workerExecutor ? '启用' : '禁用'} | 并发: ${this.WORKER_CONCURRENCY}`);
    console.log(`[OptBacktest] 动态参数:`, {
      STOP_LOSS_INIT_PCT: this.STOP_LOSS_INIT_PCT,
      TRAILING_STOP_PCT: this.TRAILING_STOP_PCT,
      TAKE_PROFIT_PCT: this.TAKE_PROFIT_PCT,
      TRAILING_STOP_START_PCT: this.TRAILING_STOP_START_PCT,
      TRAILING_STOP_TIGHTEN_PCT: this.TRAILING_STOP_TIGHTEN_PCT,
      MIN_STRATEGY_SCORE: this.MIN_STRATEGY_SCORE,
      STRONG_LOOKBACK: `${this.STRONG_LOOKBACK}天前`,
      SLIPPAGE: this.SLIPPAGE,
      COMMISSION: this.COMMISSION,
      STAMP_TAX: this.STAMP_TAX,
      BATCH_SIZE: this.BATCH_SIZE,
      BOARD_RANK_PCT: this.BOARD_RANK_PCT,
      STOCK_RANK_PCT: this.STOCK_RANK_PCT,
      STRATEGY_MODE: this.strategyMode,
      STRUCTURE_BREAK_DAYS: this.STRUCTURE_BREAK_DAYS,
      RANGE_BOUND_DAYS: this.RANGE_BOUND_DAYS,
      UP_DOWN_RATE_HIGH_THRESH: this.UP_DOWN_RATE_HIGH_THRESH,
      UP_DOWN_RATE_LOW_THRESH: this.UP_DOWN_RATE_LOW_THRESH,
      PULLBACK_PCT: this.PULLBACK_PCT,
      SELL_AT_OPEN: this.SELL_AT_OPEN,
      TIME_EXIT_MAX_DAYS: this.TIME_EXIT_MAX_DAYS,
      TIME_EXIT_MIN_RETURN: this.TIME_EXIT_MIN_RETURN,
      PROFIT_IGNORE_SIGNAL_PCT: this.PROFIT_IGNORE_SIGNAL_PCT,
      RSI_BUY_THRESHOLDS: this.RSI_BUY_THRESHOLDS,
      RSI_SELL_THRESHOLDS: this.RSI_SELL_THRESHOLDS,
      FILTER_STRONG_TYPE: this.FILTER_STRONG_TYPE,
    });
  }

  public async run(
    dataProvider: StrategyDataProvider,
    onProgress?: (message: string, percent?: number) => void,
    options?: {
      onShouldCancel?: () => boolean;
      onShouldPause?: () => boolean;
      onPendingOrdersReview?: (orders: StrategyPendingOrder[], today: string) => Promise<StrategyPendingOrder[]>;
      onPartialResult?: (result: StrategyBacktestResult) => void;
      onSnapshot?: (snapshot: BacktestSnapshot) => void;
      resumeFromSnapshot?: BacktestSnapshot;
    }
  ) {
    this.cancelOptions = options;
    this.pendingOrderReviewCallback = options?.onPendingOrdersReview;
    this.onPartialResultCallback = options?.onPartialResult;
    this.onSnapshotCallback = options?.onSnapshot;

    let startIndex = 0;
    if (options?.resumeFromSnapshot) {
      console.log('[OptBacktest] 检测到断点续跑快照，正在恢复状态...');
      startIndex = await this.applyResumeSnapshot(options.resumeFromSnapshot, dataProvider, onProgress);
    } else {
      // 需要对tradeDays过滤
      this.tradeDays = await dataProvider.filterTradeDays(this.tradeDays);
    }
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
      TAKE_PROFIT_PCT: this.TAKE_PROFIT_PCT,
      TRAILING_STOP_START_PCT: this.TRAILING_STOP_START_PCT,
      TRAILING_STOP_TIGHTEN_PCT: this.TRAILING_STOP_TIGHTEN_PCT,
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

    for (let i = startIndex; i < totalDays; i++) {
      this.currentDayIndex = i;
      this.currentStage = 'between';
      this.stage1Reviewed = false;

      // [新增] 每个交易日开始时保存断点快照
      await this.saveSnapshot('day-start', i, this.tradeDays[i]);

      if (this.isCancelled()) {
        console.log(`[OptBacktest] 回测在第 ${i + 1}/${totalDays} 天被取消`);
        onProgress?.('回测已取消', 100);
        return this.completeRun(this.calculateResult());
      }
      const cancelledDuringPause = await this.waitIfPaused();
      if (cancelledDuringPause) {
        console.log(`[OptBacktest] 回测在暂停期间被取消`);
        onProgress?.('回测已取消', 100);
        return this.completeRun(this.calculateResult());
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
        return this.completeRun(this.calculateResult());
      }

      if (i < totalDays - 1) {
        const nextDay = this.tradeDays[i + 1];
        onProgress?.(`[${i + 1}/${totalDays}] ${today} 生成交易信号...`, Math.round(currentBase + dayPercentStep * 0.3));
        console.log(`[OptBacktest] [${today}] 阶段2: 生成交易信号 (次日执行: ${nextDay})`);
        if (await this.generateSignals(today, nextDay, dataProvider, currentBase, dayPercentStep, (msg, pct) => {
          onProgress?.(msg, pct ?? Math.round(currentBase + dayPercentStep * 0.6));
        })) {
          onProgress?.('回测已取消', 100);
          return this.completeRun(this.calculateResult());
        }
      }

      onProgress?.(`[${i + 1}/${totalDays}] ${today} 记录净值...`, Math.round(currentBase + dayPercentStep * 0.8));
      console.log(`[OptBacktest] [${today}] 阶段3: 记录净值`);
      if (await this.recordDailyValue(today, dataProvider)) {
        onProgress?.('回测已取消', 100);
        return this.completeRun(this.calculateResult());
      }

      // [新增] 实时推送当前部分结果给 UI，便于展示动态更新的净值/交易统计
      if (this.onPartialResultCallback) {
        const partialResult = this.calculateResult(true);
        this.onPartialResultCallback(partialResult);
        await yieldToMain();
      }

      console.log(`[OptBacktest] [${today}] 日终状态: 持仓 ${this.positions.size} 只 | 净值 ${this.dailyValues[this.dailyValues.length - 1]?.totalValue.toFixed(2)}`);

      await yieldToMain();
    }

    onProgress?.('正在计算回测结果...', 95);
    console.log(`\n[OptBacktest] ====== 计算最终结果 ======`);
    const result = this.calculateResult();
    onProgress?.('回测完成！', 100);
    console.log(`[OptBacktest] ====== 回测结束 ======\n`);
    return this.completeRun(result);
  }

  private async getRiskPreference(today: string, dataProvider: StrategyDataProvider): Promise<{prefer: string, upRatio: number, upRatioMA5: number}> {
    // 先检查缓存
    const cached = this.dailyRiskPreference.get(today);
    if (cached) {
      return cached;
    }

    const defaultValue = {prefer: 'mid', upRatio: 0.5, upRatioMA5: 0.5};
    const todayIndex = this.tradeDays.indexOf(today);
    if (todayIndex < 0) {
      this.dailyRiskPreference.set(today, defaultValue);
      return defaultValue;
    }

    const startIndex = Math.max(0, todayIndex - 4);
    const recentDates = this.tradeDays.slice(startIndex, todayIndex + 1);

    let result: 'high' | 'mid' | 'low' = 'mid';
    try {
      const rates = await dataProvider.getUpRatio(recentDates);
      if (!rates || rates.length === 0) {
        result = 'mid';
      } else {
        const ma5 = rates.reduce((sum, r) => sum + r, 0) / rates.length;
        if (ma5 > this.UP_DOWN_RATE_HIGH_THRESH) result = 'high';
        else if (ma5 < this.UP_DOWN_RATE_LOW_THRESH) result = 'low';
        else result = 'mid';
        defaultValue.upRatioMA5 = ma5;
        defaultValue.upRatio = rates[rates.length - 1];
      }
    } catch (e) {
      console.error(`[OptBacktest] [${today}] 获取涨跌比失败，使用默认风险偏好:`, e);
      result = 'mid';
    }
    defaultValue.prefer = result;
    this.dailyRiskPreference.set(today, defaultValue);
    console.log(`[OptBacktest] [${today}] dailyRiskPreference.upRatioMA5: ${defaultValue.upRatioMA5}`);

    return defaultValue;
  }

// 固定止损 = 0.05 + sigmoid((MA5 - 0.50) × 14) × 0.10
//          范围: [5%, 15%]
//          中性点(MA5=0.50): 约8.5%

// 移动止损 = 固定止损 × (0.15 + sigmoid((MA5 - 0.50) × 14) × 0.55)
//          范围: 固定止损的 15% ~ 70%
//          自动保证: 移动止损 < 固定止损

// 【中性点 MA5=0.50】
//   固定止损 = 10.00%
//   移动止损 = 4.25%
//   移动/固定 = 42.5%

// 【过去一年实际范围 MA5=0.322~0.888】
//   固定止损: 5.76% ~ 14.96%
//   移动止损: 1.10% ~ 10.43%
//   移动/固定比: 19.2% ~ 69.8%
  /** Sigmoid激活函数：将任意实数压缩到(0, 1) */
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  /** 将数值限制在[min, max]范围内 */
  private  clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private async getRelativeMarketPullbackPct(startDate: string, endDate: string, dataProvider: StrategyDataProvider): Promise<number> {

    /** 基准指数代码 */
    const BENCHMARK_INDEX = "1.000300"; // 沪深300（可改为中证500/1000）
    // 波动率缩放系数（个股波动率 / 指数波动率）
    
    const indexKline = await dataProvider.getKLines([BENCHMARK_INDEX], endDate, 60);
    // 1. 获取基准指数在特定时间段下跌indexDrawdown;
    const klines = indexKline[BENCHMARK_INDEX];
    const startIndex = klines.findIndex(k => k.date >= startDate);
    const rangeKlines = klines.slice(startIndex);
    const highRange = Math.max(...rangeKlines.map(k => k.zg));
    const lowRange = Math.min(...rangeKlines.map(k => k.zd));
    const indexDrawdown = (highRange - lowRange) / highRange;

    return indexDrawdown;
  }

    /**
 * 回撤过滤阈值 - 趋势跟随版
 * 
 * 情绪强(MA5高) → 放宽到20~25%（强市中允许较大回调，趋势可能延续）
 * 情绪弱(MA5低) → 收紧到5~10%（弱市中跌5%可能就废了）
 * 
 * 中性点MA5=0.50 → 15%
 * 范围: [5%, 25%]
 * 
 * 使用方式: 当前回撤 > 阈值 → 不买入（趋势被破坏）
 */
  private async getMaxPullbackPct(today: string): Promise<number> {
    // * 情绪强→收紧(强市中不做弱势股)，情绪弱→放宽(弱市中强势股也会放大回调)
    // 如果市场很差，尽量不要交易
    const riskPref = this.dailyRiskPreference.get(today)?.upRatioMA5 || 0.5;
    const s = this.sigmoid((riskPref - 0.50) * this.STEEPNESS);
    // 中心15%，情绪强→25%，情绪弱→5%
    const result = this.clamp(this.PULLBACK_PCT - (s - 0.5) * 0.20, 0.1, 0.4)

    console.log(`[OptBacktest] [${today}] getMaxPullbackPct — riskPref=${riskPref}, result=${result}`);
    return result;
  }

  // 你原本想的：回撤大 = 趋势破坏 = 不能买
  //          （这是趋势跟随逻辑，适用于美股等趋势市场）

  // A股现实：回撤大 = 超跌 = 反弹在即 = 应该买
  //        （这是均值回归逻辑，适用于A股等震荡市场）

  private async getMinPullbackPct(today: string, dataProvider: StrategyDataProvider): Promise<number> {

    // * 中性点MA5=0.50 → 11.5%
    // * 范围: [3%, 25%]
    // * 情绪强→收紧(强市中跌一点算弱)，情绪弱→放宽(弱市中深跌才过滤)
    const riskPref = this.dailyRiskPreference.get(today)?.upRatioMA5 || 0.5;
    const s = this.sigmoid((riskPref - 0.50) * this.STEEPNESS);
    // 中心11.5%，情绪强→3%，情绪弱→25%
    const result = this.clamp(this.PULLBACK_PCT - (s - 0.5) * 0.22, 0.03, 0.25);

    console.log(`[OptBacktest] [${today}] getMinPullbackPct — riskPref=${riskPref}, result=${result}`);
    return result;
  }

  private getDailyStopLossPct(today: string): number {
    const riskPref = this.dailyRiskPreference.get(today);
    if (Number.isNaN(riskPref)) 
      return this.STOP_LOSS_INIT_PCT;

    // 第一层：MA5绝对水平（原有逻辑）
    const upRatioMA5 = riskPref?.upRatioMA5 || 0.5;
    const s = this.sigmoid((upRatioMA5 - 0.50) * this.STEEPNESS);
    const based = this.clamp((1 - this.STOP_LOSS_INIT_PCT) + (s - 0.5) * 0.12, 0.07, 0.14);

    // 当弱市下限从5%提到7%后，惩罚机制几乎被下限完全架空
    // if (false) {
      // 第二层：当日情绪突变检测（关键！提前1-2天感知拐点）
      let emergency = 0.2; // 默认不限制（取大值让第一层生效）
      const yesterday = this.tradeDays[this.tradeDays.indexOf(today) - 1];
      const riskPrefYesterday = this.dailyRiskPreference.get(yesterday);
      const upRatioMA5Yesterday = riskPrefYesterday?.upRatioMA5 || 0.5;
      
      // 二层：MA5变化率惩罚（关键修正！）
      let penalty = 0;
      const ma5Diff = upRatioMA5 - upRatioMA5Yesterday; // MA5变化（百分点）
      
      if (ma5Diff < -0.02) {
        // MA5暴跌2pp+ → 趋势急转 → 大幅收紧2%
        penalty = 0.02;
      } else if (ma5Diff < -0.01) {
        // MA5下降1-2pp → 趋势恶化 → 中度收紧1%
        penalty = 0.01;
      } else if (ma5Diff < 0) {
        // MA5轻微下降 → 趋势转弱 → 轻度收紧0.5%
        penalty = 0.005;
      }
      // MA5在上升 → 无惩罚

      // 极端恐慌备份：当日上涨比例<25%（备用保险）
      const upRatioToday = riskPref?.upRatio || 0.5;
      if (upRatioToday < 0.25) {
        penalty = Math.max(penalty, 0.03); // 至少收紧3%
      }
      const result = 1 - this.clamp(based - penalty, 0.07, 0.14);
    // }
    
    // const result = 1 - based;
    console.log(`[OptBacktest] [${today}] getDailyStopLossPct — upRatioMA5=${upRatioMA5}, result=${result}`);
    return result;
  }

  private getDailyTrailingStopPct(today: string): number {
    const riskPref = this.dailyRiskPreference.get(today)?.upRatioMA5 || 0.5;
    if (Number.isNaN(riskPref)) 
      return this.TRAILING_STOP_PCT;

    const s = this.sigmoid((riskPref - 0.50) * this.STEEPNESS);
    const stoploss = this.clamp((1 - this.TRAILING_STOP_PCT) + (s - 0.5) * 0.30, 0.04, 0.07);
    const result = 1 - stoploss;
    // console.log(`[OptBacktest] [${today}] getDailyTrailingStopPct — riskPref=${riskPref}, result=${result}`);
    return result;
  }

  // ===== 阶段1: 执行待处理订单 =====
  private async executePendingOrders(today: string, dataProvider: StrategyDataProvider): Promise<boolean> {
    this.currentStage = 'stage1';
    this.stage1Reviewed = false;

    console.log(`[OptBacktest] [${today}] 阶段1开始: 待处理订单 ${this.pendingOrders.length} 笔`, this.pendingOrders.map(o => `${o.secid}:${o.type}${o.watching ? '(watch)' : ''}`));
    if (this.pendingOrders.length === 0) {
      console.log(`[OptBacktest] [${today}] 无待执行订单`);
      return false;
    }

    // [修复] 提前计算当天市场风险偏好，确保 executeBuy 中 getDailyStopLossPct 能命中
    await this.getRiskPreference(today, dataProvider);

    // [优化] 记录因停牌/一字板/跌破开盘价/过期而跳过的订单，用于统计
    const skippedOrders: Array<{ secid: string; type: string; reason: string }> = [];

    const secidsToFetch = this.pendingOrders.map(o => o.secid);
    const klinesMap = await dataProvider.getKLines(secidsToFetch, today, 5);

    // 第一步：验证所有待处理订单；
    // 买入订单若未成交（一字板/停牌/资金不足）则保留在待买入列表，最多保留 MAX_PENDING_DAYS 个交易日，
    // 期间若开盘价跌破信号日开盘价则放弃。
    // 所有有效的买入/sell 订单每天都会进入待执行订单确认列表，由用户决定是否执行/保留。
    const executableOrders: StrategyPendingOrder[] = [];
    const remainingOrders: StrategyPendingOrder[] = [];
    const reviewableOrders: StrategyPendingOrder[] = [];
    for (const order of this.pendingOrders) {
      if (this.isCancelled()) return true;
      await this.waitIfPaused();
      if (this.isCancelled()) return true;

      const klines = klinesMap[order.secid];
      const todayKLine = klines?.find(k => k.date === today);

      // sell 订单：当天可执行才 review & 执行；停牌/无K线直接跳过
      if (order.type === 'sell') {
        // [修复] 当日收盘卖订单不在 stage1 处理，由 stage2 末尾统一确认执行
        if (order.executePrice !== undefined) {
          remainingOrders.push(order);
          continue;
        }
        if (!klines || klines.length === 0) {
          console.log(`[OptBacktest] [${today}] 卖出订单执行失败: ${order.secid} 未获取到K线数据`);
          skippedOrders.push({ secid: order.secid, type: order.type, reason: '无K线数据' });
          continue;
        }
        if (!todayKLine) {
          const lastKline = klines[klines.length - 1];
          console.log(`[OptBacktest] [${today}] 卖出订单执行跳过: ${order.secid} 停牌 (最近交易日: ${lastKline?.date || '无'})`);
          skippedOrders.push({ secid: order.secid, type: order.type, reason: `停牌(最近:${lastKline?.date || '无'})` });
          continue;
        }
        reviewableOrders.push({ ...order, canExecuteToday: true });
        executableOrders.push(order);
        continue;
      }

      // buy 订单：先检查已等待天数（最大 MAX_PENDING_DAYS 个交易日）
      const pendingDays = await this.getTradeDaysDiffAsync(order.signalDate, today, dataProvider);
      if (pendingDays > this.MAX_PENDING_DAYS) {
        console.log(`[OptBacktest] [${today}] ${order.secid} 待买入订单过期: 已等待${pendingDays}个交易日，超过最大${this.MAX_PENDING_DAYS}天`);
        skippedOrders.push({ secid: order.secid, type: order.type, reason: `待买入过期(${pendingDays}天)` });
        continue;
      }

      // [新增] 观察状态买入订单默认保留，但仍检查当天是否可执行（用户可随时改为执行）
      const isWatching = order.watching === true;

      if (!klines || klines.length === 0) {
        console.log(`[OptBacktest] [${today}] 待买入订单保留: ${order.secid} 未获取到K线数据，等待${pendingDays}/${this.MAX_PENDING_DAYS}天`);
        reviewableOrders.push({ ...order, canExecuteToday: false });
        remainingOrders.push(order);
        continue;
      }

      if (!todayKLine) {
        const lastKline = klines[klines.length - 1];
        console.log(`[OptBacktest] [${today}] 待买入订单保留: ${order.secid} 停牌 (最近交易日: ${lastKline?.date || '无'})，等待${pendingDays}/${this.MAX_PENDING_DAYS}天`);
        reviewableOrders.push({ ...order, canExecuteToday: false });
        remainingOrders.push(order);
        continue;
      }

      // [新增] 开盘价跌破信号日开盘价则放弃买入（观察状态订单除外，用户明确选择继续观察）
      if (!isWatching && order.signalOpenPrice !== undefined && todayKLine.kp < order.signalOpenPrice) {
        console.log(`[OptBacktest] [${today}] ${order.secid} 待买入订单移除: 开盘价${todayKLine.kp.toFixed(2)} 跌破信号日开盘价${order.signalOpenPrice.toFixed(2)}，等待${pendingDays}/${this.MAX_PENDING_DAYS}天`);
        skippedOrders.push({ secid: order.secid, type: order.type, reason: '跌破信号日开盘价' });
        continue;
      }

      // [新增] 剔除一字板：开盘即涨停且全天没有更高价格，无法买入，保留待次日再试
      if (todayKLine.kp === todayKLine.zg && isLimitUpStock(order.secid, todayKLine.zdf)) {
        console.log(`[OptBacktest] [${today}] ${order.secid} 待买入订单保留: 一字板 (开盘${todayKLine.kp.toFixed(2)}=最高${todayKLine.zg.toFixed(2)}, 涨幅${todayKLine.zdf.toFixed(2)}%)，等待${pendingDays}/${this.MAX_PENDING_DAYS}天`);
        reviewableOrders.push({ ...order, canExecuteToday: false });
        remainingOrders.push(order);
        continue;
      }

      reviewableOrders.push({ ...order, canExecuteToday: true });
      executableOrders.push(order);
      // [新增] 观察状态买入订单即使当天可执行也保留，等待用户后续决定
      if (isWatching) {
        remainingOrders.push(order);
      }
    }

    // [新增] UI 交互：让用户决定执行/保留或取消待处理订单
    // [新增] 无确认回调时，观察状态买入订单不自动执行
    let ordersToExecute = executableOrders.filter(o => !(o.type === 'buy' && o.watching === true));
    if (this.pendingOrderReviewCallback && reviewableOrders.length > 0) {
      // [新增] 在订单确认节点保存快照，崩溃/关闭后可从该节点恢复
      await this.saveSnapshot('pending-review', this.currentDayIndex, today);
      console.log(`[OptBacktest] [${today}] 等待用户确认 ${reviewableOrders.length} 笔待处理订单（其中可执行${executableOrders.length}笔）`);
      const approvedOrders = await this.pendingOrderReviewCallback(reviewableOrders, today);
      this.stage1Reviewed = true;
      // 只认可 reviewableOrders 范围内的批准结果
      const approvedInReviewable = approvedOrders.filter(ao => reviewableOrders.some(ro => ro.secid === ao.secid));
      const approvedMap = new Map(approvedInReviewable.map(o => [o.secid, o.watching === true]));
      const approvedSecids = new Set(approvedMap.keys());
      // 用户未批准的保留类买入订单从 remainingOrders 中移除（当日收盘卖订单由 stage2 末尾单独确认，此处保留）
      for (let i = remainingOrders.length - 1; i >= 0; i--) {
        if (remainingOrders[i].type === 'buy' && !approvedSecids.has(remainingOrders[i].secid)) {
          console.log(`[OptBacktest] [${today}] ${remainingOrders[i].secid} 用户取消保留/观察，从待买入列表移除`);
          remainingOrders.splice(i, 1);
        }
      }
      // [新增] 同步 approvedOrders 中的 watching 标记到 remainingOrders
      for (const order of remainingOrders) {
        if (order.type === 'buy') {
          order.watching = approvedMap.get(order.secid) === true;
        }
      }
      // 只执行用户批准、当天可执行且非观察状态的订单
      ordersToExecute = executableOrders.filter(o => approvedSecids.has(o.secid) && approvedMap.get(o.secid) !== true);
      const executedSecids = new Set(ordersToExecute.map(o => o.secid));
      // [新增] 已执行的观察订单从 remainingOrders 中移除，避免次日重复出现
      for (let i = remainingOrders.length - 1; i >= 0; i--) {
        if (executedSecids.has(remainingOrders[i].secid)) {
          remainingOrders.splice(i, 1);
        }
      }
      const watchCount = Array.from(approvedMap.values()).filter(v => v).length;
      console.log(`[OptBacktest] [${today}] 用户确认执行 ${ordersToExecute.length}/${executableOrders.length} 笔可执行订单，观察 ${watchCount} 笔，当前待买入列表剩余${remainingOrders.length}笔`);
      if (this.isCancelled()) return true;
    }

    // 第二步：执行用户确认的订单
    for (const order of ordersToExecute) {
      if (this.isCancelled()) return true;
      await this.waitIfPaused();
      if (this.isCancelled()) return true;

      const klines = klinesMap[order.secid];
      const todayKLine = klines.find(k => k.date === today)!;
      const openPrice = todayKLine.kp;
      // [修复] 使用 pendingOrder 中保存的信号日实体最低价，避免延迟买入时取错K线
      const signalDayEntityLow = order.signalEntityLow ?? 0;

      // [调试] 打印K线原始数据，用于核对价格是否匹配
      console.log(`[Debug][ executePendingOrders][${today}] ${order.secid} ${order.type} K线确认: date=${todayKLine.date} kp=${todayKLine.kp.toFixed(2)} sp=${todayKLine.sp.toFixed(2)} zg=${todayKLine.zg.toFixed(2)} zd=${todayKLine.zd.toFixed(2)}`);

      if (order.type === 'buy') {
        console.log(`[OptBacktest] [${today}] 执行买入: ${order.secid} | 开盘价: ${openPrice.toFixed(2)} | 原因: ${order.reason}`);
        const hadPosition = this.positions.has(order.secid);
        this.executeBuy(order, today, openPrice, signalDayEntityLow);
        // 若买入未成交（资金不足或低于最小仓位），保留在待买入列表
        if (!hadPosition && !this.positions.has(order.secid)) {
          console.log(`[OptBacktest] [${today}] ${order.secid} 买入未成交，保留在待买入列表`);
          remainingOrders.push(order);
        }
      } else if (order.type === 'sell') {
        const position = this.positions.get(order.secid);
        if (position) {
          const execPrice = order.executePrice ?? openPrice;
          const priceLabel = order.executePrice !== undefined ? '收盘价' : '开盘价';
          console.log(`[OptBacktest] [${today}] 执行卖出: ${order.secid} | ${priceLabel}: ${execPrice.toFixed(2)} | 持仓成本: ${position.buyPrice.toFixed(2)} | 原因: ${order.reason}`);
          this.executeSell(order.secid, today, execPrice, position.quantity, order.reason);
        } else {
          console.log(`[OptBacktest] [${today}] 卖出订单忽略: ${order.secid} 无持仓`);
        }
      }

      // [优化] 每执行一个订单让出一次，避免订单多的时候卡
      await yieldToMain(1);
    }

    if (skippedOrders.length > 0) {
      console.log(`[OptBacktest] [${today}] 跳过订单统计:`, skippedOrders);
    }

    this.pendingOrders = remainingOrders;
    console.log(`[OptBacktest] [${today}] 阶段1结束: 剩余待处理订单 ${this.pendingOrders.length} 笔`, this.pendingOrders.map(o => `${o.secid}:${o.type}${o.watching ? '(watch)' : ''}`));
    // [新增] stage1 结束后保存快照，便于暂停后安全恢复
    await this.saveSnapshot('after-stage1', this.currentDayIndex, today);
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

    /** [修复] 安全的交易日差计算，支持 fallback 到 filterTradeDays */
  private async getTradeDaysDiffAsync(
    date1: string,
    date2: string,
    dataProvider: StrategyDataProvider
  ): Promise<number> {
    // 优先走同步路径（快）
    const idx1 = this.tradeDays.indexOf(date1);
    const idx2 = this.tradeDays.indexOf(date2);
    if (idx1 >= 0 && idx2 >= 0) {
      return Math.abs(idx2 - idx1);
    }

    // fallback: 生成日期范围并过滤出交易日
    const dates: string[] = [];
    const start = dayjs(date1, 'YYYY-MM-DD');
    const end = dayjs(date2, 'YYYY-MM-DD');
    const diffDays = end.diff(start, 'day');
    const step = diffDays >= 0 ? 1 : -1;
    for (let i = 0; i <= Math.abs(diffDays); i++) {
      dates.push(start.add(i * step, 'day').format('YYYY-MM-DD'));
    }

    const validDays = await dataProvider.filterTradeDays(dates);
    const validIdx1 = validDays.indexOf(date1);
    const validIdx2 = validDays.indexOf(date2);
    if (validIdx1 >= 0 && validIdx2 >= 0) {
      return Math.abs(validIdx2 - validIdx1);
    }

    console.warn(`[OptBacktest] 无法计算交易日差: ${date1} ~ ${date2}`);
    return 0;
  }

  private executeBuy(order: StrategyPendingOrder, date: string, price: number, signalDayEntityLow: number) {
    console.log(`[Debug][ executeBuy in][${date}] ${order.secid} order.boardRank=${order.boardRank !== undefined && order.boardRank >= 0 ? order.boardRank + 1 : '-'} order.stockRank=${order.stockRank !== undefined && order.stockRank >= 0 ? order.stockRank + 1 : '-'} type=${order.strategyType}`);
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
    const dailyStopLossPct = this.getDailyStopLossPct(date);
    const dailyTrailingStopPct = this.getDailyTrailingStopPct(date);
    const stopLossPrice = adjustedPrice * dailyStopLossPct;
    const takeProfitPrice = adjustedPrice * this.TAKE_PROFIT_PCT;
    console.log(`[OptBacktest] [${date}] ${order.secid} 买入止损配置: 固定止损=${((1 - dailyStopLossPct) * 100).toFixed(1)}%, 移动止损=${((1 - dailyTrailingStopPct) * 100).toFixed(1)}%`);
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
      // [新增]
      takeProfitPrice,                    // 固定止盈
      signalDayEntityLow, // [新增] 保存买入当天实体最低价
      consecutiveDeclineDays: 0,
      pullBackPct: order.pullBackPct,
      zsz: order.zsz,
    });

    const paramsStr = this.formatStrategyParams(order.strategyType, order.strategyParams);
    const finalReason = paramsStr ? `${order.reason} | ${paramsStr}` : order.reason;

    console.log(`[Debug][ executeBuy][${date}] ${order.secid} 原始价=${price.toFixed(2)} 滑点调整后=${adjustedPrice.toFixed(2)} (SLIPPAGE=${this.SLIPPAGE})`);
    console.log(`[OptBacktest] [${date}] ${order.secid} 买入成功: 价${adjustedPrice.toFixed(2)} | 量${quantity} | 总成本${totalCost.toFixed(2)} | 策略${order.strategyType} | 实体最低${signalDayEntityLow.toFixed(2)} | 止损价${stopLossPrice.toFixed(2)} | 剩余资金${this.availableCash.toFixed(2)}`);

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
      boardCode: order.boardCode || '',
      strategyType: order.strategyType,
      strategyParams: order.strategyParams,
      strongType: order.strongType,
      pullBackPct: order.pullBackPct,
      zsz: order.zsz,
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
      boardCode: position.boardCode || '',
      returnPct,
      strategyType: position.strategyType,
      strategyParams: position.strategyParams,
    });

    this.positions.delete(secid);
    console.log(`[OptBacktest] [${date}] ${secid} 已从持仓移除`);
  }

  private queueOrExecuteSell(secid: string, date: string, price: number, quantity: number, reason: string) {
    // [修复] 卖出订单统一进入待执行队列，经过用户确认后再执行
    this.pendingOrders.push({
      secid,
      type: 'sell',
      reason,
      signalDate: date,
      executePrice: this.SELL_AT_OPEN ? undefined : price,
    });
    console.log(`[OptBacktest] [${date}] ${secid} 卖出已排队: ${reason}（${this.SELL_AT_OPEN ? '次日开盘' : '当日收盘'}执行）`);
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
    strongType?: 'limit_up' | 'new_high_60';
    strategyType: 'macd' | 'rsi';
    strategyParams: MACDStrategyResult | RSIBacktestResult;
    pullBackPct?: number;
    zsz?: number;
    signalOpenPrice: number;
    signalEntityLow: number;
  }>> {
    const candidates: Array<{
      secid: string;
      score: number;
      boardCode: string;
      price: number;
      reason: string;
      strongType?: 'limit_up' | 'new_high_60';
      strategyType: 'macd' | 'rsi';
      strategyParams: MACDStrategyResult | RSIBacktestResult;
      pullBackPct?: number;
      zsz?: number;
      signalOpenPrice: number;
      signalEntityLow: number;
    }> = [];

    // 预处理：移除已持仓、观察期满的股票
    for (const [secid, item] of this.watchList) {
      if (this.positions.has(secid)) {
        console.log(`[OptBacktest] [${today}] ${secid} 观察移除: 已持仓`);
        this.watchList.delete(secid);
        continue;
      }
      // [修复] 使用异步安全的交易日差计算
      const daysInWatch = await this.getTradeDaysDiffAsync(item.addedDate, today, dataProvider);
      // const daysInWatch = this.getTradeDaysDiff(item.addedDate, today);
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

      // const closes = klines.map(s => s.sp);
      // const ma5 = calculateMA(closes, 60);
      // if (closes[closes.length - 1] < ma5[ma5.length - 1]) {
      //   console.log(`[OptBacktest] [${today}] ${secid} 观察跳过: 跌破60日均线`);
      //   continue;
      // }

      const daysInWatch = this.getTradeDaysDiff(item.addedDate, today);

      let mDayIndex = -1;
      if (item.strategyType === 'macd') {
        mDayIndex = checkMACDBuySignal(klines, item.strategyParams as MACDStrategyResult, 3);
      } else {
        mDayIndex = checkRSIBuySignal(klines, item.strategyParams as RSIBacktestResult, 3);
      }

      if (mDayIndex < 0) {
        // console.log(`[OptBacktest] [${today}] ${secid} 观察中 ${daysInWatch}/${item.maxWatchDays}，暂无买入信号`);
        continue;
      }

      const lastIndex = klines.length - 1;
      const mDayKline = klines[mDayIndex];

      // [新增] 观察期间深度回调检查：出现买入信号后，从强势参考日到当天若高点到低点的回调超过阈值则忽略本次买入
      const strongStockIndex = klines.findIndex(k => k.date >= item.strongStockDay);
      const rangeKlines = strongStockIndex >= 0 ? klines.slice(strongStockIndex) : klines;
      const highRange = Math.max(...rangeKlines.map(k => k.zg));
      const lowRange = Math.min(...rangeKlines.map(k => k.zd));
      const pullBackPct = (highRange - lowRange) / highRange;

      
      // 获取同一阶段市场的回撤情况
      // 相对回撤 = 个股回撤 - 市场回撤
      // >0: 个股跌得比市场多（跑输）
      // <0: 个股跌得比市场少（跑赢）
      const indexDrawdown = await this.getRelativeMarketPullbackPct(klines[strongStockIndex].date, klines[klines.length - 1].date, dataProvider);
      // 2. 根据市值选择系数，返回 indexDrawdown / volScale;
      const DEFAULT_VOL_SCALE = {
        largeCap: 1.0, // 大盘股 >500亿
        midCap: 1.2,  // 中盘股 100~500亿
        smallCap: 1.4, // 小盘股 30~100亿
        microCap: 1.8, // 微盘股 <30亿
      };
      let volScale = 1.0;
      if (item.zsz < 30) volScale = DEFAULT_VOL_SCALE.microCap;
      else if (item.zsz < 100) volScale = DEFAULT_VOL_SCALE.smallCap;
      else if (item.zsz < 500) volScale = DEFAULT_VOL_SCALE.midCap;
      else volScale = DEFAULT_VOL_SCALE.largeCap;
      const relativeDrawdown = pullBackPct / volScale - indexDrawdown;

      // 最大允许相对回撤（滑动窗口）
      const maxPullbackPct = await this.getMaxPullbackPct(today);
        
      // ========== 实际数值参考 ==========
      // 情绪强(MA5=0.60): maxRelativeDrawdown ≈ 4.3%
      //   市场回撤-5%，个股回撤-8% → 相对回撤3% → 可以买入 ✓
      //   市场回撤-5%，个股回撤-12% → 相对回撤7% → 不买入 ✗（跑输太多）

      // 情绪中(MA5=0.50): maxRelativeDrawdown = 7.0%
      //   市场回撤-10%，个股回撤-15% → 相对回撤5% → 可以买入 ✓
      //   市场回撤-10%，个股回撤-20% → 相对回撤10% → 不买入 ✗

      // 情绪弱(MA5=0.40): maxRelativeDrawdown ≈ 10.0%
      //   市场回撤-15%，个股回撤-20% → 相对回撤5% → 可以买入 ✓
      //   市场回撤-15%，个股回撤-8% → 相对回撤-7% → 可以买入 ✓（强势股！）
      //   市场回撤-15%，个股回撤-30% → 相对回撤15% → 不买入 ✗（跌过头了）
  
      // 相对回撤超过窗口上限 → 跑输太多 → 不买入
      let failReason = '';
      if (relativeDrawdown > maxPullbackPct) {
        failReason = `相对回调 ${(relativeDrawdown * 100).toFixed(1)}% (${rangeKlines.length}天) 阈值=${(maxPullbackPct * 100).toFixed(0)}%`;
      } else {
        console.log(`[OptBacktest] [${today}] ${secid} 观察期出现信号且相对回调 ${(relativeDrawdown * 100).toFixed(1)}% (${rangeKlines.length}天) 阈值=${(maxPullbackPct * 100).toFixed(0)}%，可以买入`);
      }

      // const minPullbackPct = await this.getMinPullbackPct(today, dataProvider);
      // if (pullBackPct < minPullbackPct) {
      //   console.log(`[OptBacktest] [${today}] ${secid} 观察期出现信号但较浅回调 ${(pullBackPct * 100).toFixed(1)}% (${rangeKlines.length}天) 阈值=${(minPullbackPct * 100).toFixed(0)}%，忽略买入`);
      //   continue;
      // } else {
      //   console.log(`[OptBacktest] [${today}] ${secid} 观察期出现信号且回调满足 ${(pullBackPct * 100).toFixed(1)}% (${rangeKlines.length}天) 阈值=${(minPullbackPct * 100).toFixed(0)}%，可以买入`);
      // }

      if(!failReason) {
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
      }

      if (failReason) {
        console.log(`[OptBacktest] [${today}] ${secid} 观察期出现信号但${failReason}，踢出`);
        this.watchList.delete(secid);
        continue;
      }

      const currentPrice = klines[lastIndex].sp;
      const upRatioMA5 = this.dailyRiskPreference.get(today)?.upRatioMA5 ?? 0.5;
      candidates.push({
        secid,
        score: item.score,
        boardCode: item.boardCode,
        price: currentPrice,
        reason: `${item.strategyType.toUpperCase()}观察期买入 M-Day=${mDayKline.date} T-Day=${item.tDayDate}, 回调=${(pullBackPct * 100).toFixed(1)}%, 评分=${item.score.toFixed(1)}, 市场情绪=${upRatioMA5.toFixed(2)}`,
        strongType: item.strongType,
        strategyType: item.strategyType,
        strategyParams: item.strategyParams,
        pullBackPct,
        zsz: item.zsz,
        signalOpenPrice: mDayKline.kp,
        signalEntityLow: Math.min(mDayKline.kp, mDayKline.sp),
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
    this.currentStage = 'stage2';
    const tStart = performance.now();
    this.boardCache.clear();
    this.boardStocksCache.clear();

    // [修复] 提前计算当天市场风险偏好，确保 dailyRiskPreference 有值，供后续止损/回撤使用
    await this.getRiskPreference(today, dataProvider);

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

      // A股T+1，今天买入的不能今天卖出（次日卖出）
      // if (position.buyDate === today) {
      //   console.log(`[OptBacktest] [${today}] ${secid} 卖出检查跳过: 今日买入的股票`);
      //   continue;
      // }

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

      // 0. 时间止损：持仓 ≥3 天且亏损，强制离场
      const daysHeld = this.getTradeDaysDiff(position.buyDate, today);
      // const isProfitable = currentPrice > position.buyPrice;
      
      // 连续下跌止损：买入后连续3天收盘价低于前一天，反弹逻辑不成立
      // if (daysHeld >= 3) {
      //   const buyIndex = klines.findIndex(k => k.date === position.buyDate);
      //   if (buyIndex >= 0) {
      //     let declineDays = 0;
      //     // 从买入后开始检查，最多检查3天
      //     for (let i = buyIndex; i < klines.length && i < buyIndex + 3; i++) {
      //       if (klines[i].sp < klines[i - 1].sp) {
      //         declineDays++;
      //       } else {
      //         break; // 中断连续性
      //       }
      //     }
      //     if (declineDays >= 3) {
      //       console.log(`[OptBacktest] [${today}] ${secid} 🔴 连续下跌止损: 买入后连续${declineDays}个交易日收盘价下跌，反弹逻辑不成立`);
      //       this.executeSell(secid, today, currentPrice, position.quantity, '连续下跌止损');
      //       continue;
      //     }
      //   }
      // }
      // 档1：结构破坏（跌破买入实体）
      // if (daysHeld >= this.STRUCTURE_BREAK_DAYS && currentPrice < position.signalDayEntityLow) {
      //   console.log(`[OptBacktest] [${today}] ${secid} ⏱️ 时间止损(结构破坏): 持仓${daysHeld}天, 当前${currentPrice.toFixed(2)} < 信号日实体最低${position.signalDayEntityLow.toFixed(2)}`);
      //   this.executeSell(secid, today, currentPrice, position.quantity, `时间止损-结构破坏(${daysHeld}天)`);
      //   continue;
      // }

      // 档2：横盘震荡（未脱离成本区，资金效率止损）
      const buyEntityRange = position.buyPrice * 0.03; // ±3% 视为成本区
      const inCostZone = Math.abs(currentPrice - position.buyPrice) <= buyEntityRange;
      if (daysHeld >= this.RANGE_BOUND_DAYS && inCostZone) {
        console.log(`[OptBacktest] [${today}] ${secid} ⏱️ 时间止损(横盘): 持仓${daysHeld}天, 仍在成本区±3%(${currentPrice.toFixed(2)} vs ${position.buyPrice.toFixed(2)})`);
        this.queueOrExecuteSell(secid, today, currentPrice, position.quantity, `时间止损-横盘(${daysHeld}天)`);
        continue;
      }

      const dailyStopLossPct = this.getDailyStopLossPct(today);
      const dailyTrailingStopPct = this.getDailyTrailingStopPct(today);

      // 1. 更新最高价（使用当日最高价 zg 计算移动止损）
      if (kLast.zg > position.highestPrice) {
        position.highestPrice = kLast.zg;
      }
      // 2. 固定止损（硬性风控，最先检查）
      if (currentPrice < position.buyPrice * dailyStopLossPct) {
        console.log(`[OptBacktest] [${today}] ${secid} 🔴 固定止损: 当前${currentPrice.toFixed(2)} < 买入价${position.buyPrice.toFixed(2)} (跌幅${((1 - dailyStopLossPct) * 100).toFixed(1)}%)`);
        this.queueOrExecuteSell(secid, today, currentPrice, position.quantity, `固定止损(跌幅${((1 - dailyStopLossPct) * 100).toFixed(1)}%)`);
        continue;
      }

      const profitPct = (currentPrice - position.buyPrice) / position.buyPrice;

      // 3. 移动止损（保护利润）
      // 3.1 更新移动止损价格(因为dailyTrailingStopPct更新了)
      position.stopLossPrice = position.highestPrice * dailyTrailingStopPct;
      console.log(`[OptBacktest] [${today}] ${secid} 移动止损更新: ${position.stopLossPrice.toFixed(2)} (回落${(dailyTrailingStopPct * 100).toFixed(1)}%)`);
      if (currentPrice < position.stopLossPrice) {
        console.log(`[OptBacktest] [${today}] ${secid} 🟡 移动止损: 当前${currentPrice.toFixed(2)} < 止损价${position.stopLossPrice.toFixed(2)}`);
        this.queueOrExecuteSell(secid, today, currentPrice, position.quantity, `移动止损(回落${((1 - dailyTrailingStopPct) * 100).toFixed(1)}%)`);
        continue;
      }
      

      // [新增] 档2.5：最大持有N天且收益率低于阈值，资金效率止盈
      if (daysHeld >= this.TIME_EXIT_MAX_DAYS) {
        const returnPct = (currentPrice - position.buyPrice) / position.buyPrice;
        if (returnPct < this.TIME_EXIT_MIN_RETURN) {
          console.log(`[OptBacktest] [${today}] ${secid} ⏱️ 时间止盈: 持仓${daysHeld}天, 收益率${(returnPct*100).toFixed(2)}% < ${(this.TIME_EXIT_MIN_RETURN*100).toFixed(0)}%，资金效率止盈`);
          this.queueOrExecuteSell(secid, today, currentPrice, position.quantity, `时间止盈(持有${daysHeld}天收益<${(this.TIME_EXIT_MIN_RETURN*100).toFixed(0)}%)`);
          continue;
        }
      }

      // 3. [新增] 如果已经盈利超过阈值，不再受 MACD 死叉影响（让利润奔跑）
      if (profitPct > this.PROFIT_IGNORE_SIGNAL_PCT) {
        // 盈利超过阈值，只认移动止损，忽略死叉 --> 不能只认移动止损
        // 4. 固定止盈（达到目标收益率）
        if (currentPrice >= position.takeProfitPrice) {
          console.log(`[OptBacktest] [${today}] ${secid} 🟢 固定止盈: 当前${currentPrice.toFixed(2)} >= 目标${position.takeProfitPrice.toFixed(2)}`);
          this.queueOrExecuteSell(secid, today, currentPrice, position.quantity, '固定止盈');
          continue;
        }
        console.log(`[OptBacktest] [${today}] ${secid} 盈利${(profitPct*100).toFixed(1)}% > ${(this.PROFIT_IGNORE_SIGNAL_PCT*100).toFixed(0)}%，忽略策略信号`);
        continue;
      }

      

      // 4. 策略信号（只在盈利 <10% 时生效）
      let hasSellSignal = false;
      let sellReason = '';
      if (position.strategyType === 'macd') {
        hasSellSignal = this.checkMACDSellSignal(klines, position.strategyParams as MACDStrategyResult);
        sellReason = 'MACD死叉';
      } else if (position.strategyType === 'rsi') {
        hasSellSignal = this.checkRSISellSignal(klines, position.strategyParams as RSIBacktestResult);
        sellReason = 'RSI超买';
      }
      if (hasSellSignal) {
        this.queueOrExecuteSell(secid, today, currentPrice, position.quantity, sellReason);
        continue;
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
    for (let d = 1; d <= 40; d++) {
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

    let strongStocks = await dataProvider.getStrongStocks(strongStockDay);
    // [新增] 排除60日新高但strongDay当天收阴线的股票（冲高回落，不够强势）
    const beforeFilterCount = strongStocks.length;
    strongStocks = strongStocks.filter((s: any) => {
      if (s.strongType === 'new_high_60' && s.jk !== undefined && s.zx !== undefined && s.zx < s.jk) {
        console.log(`[OptBacktest] [${today}] ${s.secid} 排除: 60日新高但${strongStockDay}收阴线(${s.zx.toFixed(2)} < ${s.jk.toFixed(2)})`);
        return false;
      }
      return true;
    });
    if (strongStocks.length < beforeFilterCount) {
      console.log(`[OptBacktest] [${today}] 60日新高收阴线排除: ${beforeFilterCount - strongStocks.length} 只`);
    }
    console.log(`[OptBacktest] [${today}] ${strongStockDay} 强势股票数量: ${strongStocks.length} (筛选后${this.FILTER_STRONG_TYPE})`); 

    const tStrong1 = performance.now();
    console.log(`[Perf] [${today}] 强势股票IO: ${(tStrong1 - tStrong0).toFixed(1)}ms (${strongStocks.length}只)`);

    // [新增] 强势股票中的观察列表股票踢出，由当天重新计算决定是否重新加入
    // [新增] 踢出观察列表计时
    const tKick0 = performance.now();
    let watchKicked = 0;
    for (const stock of strongStocks) {
      if (this.watchList.has(stock.secid)) {
        const item = this.watchList.get(stock.secid)!;
        // const daysInWatch = this.getTradeDaysDiff(item.addedDate, today); // 这里保持同步，因为 today 和 addedDate 都应在 tradeDays 中
        this.watchList.delete(stock.secid);
        watchKicked++;
        // console.log(`[OptBacktest] [${today}] ${stock.secid} 出现在强势列表，从观察列表踢出(已观察${daysInWatch}个交易日)`);
      }
    }
    if (watchKicked > 0) {
      console.log(`[OptBacktest] [${today}] 强势列表踢出观察列表: ${watchKicked} 只，剩余观察 ${this.watchList.size} 只`);
    }
    const tKick1 = performance.now();
    console.log(`[Perf] [${today}] 踢出观察: ${(tKick1 - tKick0).toFixed(1)}ms`);

    // 先踢出，再过滤
    if (this.FILTER_STRONG_TYPE !== 'both') {
      strongStocks = strongStocks.filter((s: any) => s.strongType === this.FILTER_STRONG_TYPE);
    }
    const filteredStocks = strongStocks.filter(s => !this.positions.has(s.secid));
    console.log(`[OptBacktest] [${today}] 排除已持仓后剩余 ${filteredStocks.length} 只`);

    // ===== 2-3: 批量获取K线（限制并发，避免IPC反序列化阻塞） =====
    const tK0 = performance.now();
    const batchTasks: Array<{
      batchStart: number;
      batch: Stock.DetailItem[];
      validItems: Array<{ stock: Stock.DetailItem; klines: Stock.KLineItem[]; batchIndex: number; pullBackPct?: number }>;
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
      const validItems: Array<{ stock: Stock.DetailItem; klines: Stock.KLineItem[]; batchIndex: number; pullBackPct?: number }> = [];
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
          // 在 filteredStocks 筛选后，进入 batch 前增加
          const strongStockIndex = klines.findIndex(k => k.date >= strongStockDay);
          const rangeKlines = strongStockIndex >= 0 ? klines.slice(strongStockIndex) : klines;
          const highRange = Math.max(...rangeKlines.map(k => k.zg));
          const lowRange = Math.min(...rangeKlines.map(k => k.zd));
          const pullBackPct = (highRange - lowRange) / highRange;
          
          // 如果从 strongStockDay 到当天，从高点到低点的回调超过阈值，说明深度回调，排除
          if (false) { // 应该根据买入当天进行过滤
            const maxPullbackPct = await this.getMaxPullbackPct(today);
            if (pullBackPct > maxPullbackPct) {
              console.log(`[OptBacktest] [${today}] ${stock.secid} 排除: 已深度回调 ${(pullBackPct*100).toFixed(1)}% (${rangeKlines.length}天) 阈值=${(maxPullbackPct * 100).toFixed(0)}%`);
              continue;
            }
          }
          
          // [优化] 只保留策略计算需要的字段，减少内存占用和后续传输
          const liteKlines = klines.map(k => ({
            date: k.date,
            kp: k.kp,
            sp: k.sp,
            zg: k.zg,
            zd: k.zd,
          }));
          validItems.push({ stock, klines: liteKlines, batchIndex: i, pullBackPct });
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
        // [优化] 每批次开始时立即报告进度，避免"启动后很久没动静"
        onProgress?.(
          `[${today}] 优化 batch ${batchIndex+1}/${totalBatches} (${b.validItems.length}只)...`,
          batchPhaseStartPercent + Math.round((batchIndex / totalBatches) * batchPercentRange * 0.3)
        );
        const backtestParams = {
          fixedStopLossPct: 1 - this.STOP_LOSS_INIT_PCT,
          trailingStopLossPct: 1 - this.TRAILING_STOP_PCT,
          strategyMode: this.strategyMode,
          buyThresholds: this.RSI_BUY_THRESHOLDS,
          sellThresholds: this.RSI_SELL_THRESHOLDS,
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

        // 初始化文件缓存（用于后续写入），不读取上一次缓存结果
        const fileCache = new Map<string, StockScreenCacheFile>();
        for (let i = 0; i < items.length; i++) {
          const { stock, klines } = items[i];
          const key = getScreenCacheKey(stock.secid);
          if (!fileCache.has(key)) {
            fileCache.set(key, {});
          }
          uncachedIndices.push(cachedResults.length);
          uncachedItems.push({ stock, klines });
          cachedResults.push(undefined); // 占位
        }

        const cachedCount = items.length - uncachedItems.length;
        // console.log(`[OptBacktest] [${today}] batch ${batchIndex} 共 ${items.length} 只，聚合缓存命中 ${cachedCount} 只，实际计算 ${uncachedItems.length} 只`);

        let workerResults: BatchBacktestAndScreenResult[] = [];
        if (uncachedItems.length > 0) {
          const tIpc0 = performance.now();
          if (this.workerExecutor) {
            workerResults = await this.workerExecutor('batchBacktestAndScreen', [
              uncachedItems,
              backtestParams,
              screenParams,
            ]);
          } else {
            workerResults = batchBacktestAndScreen(uncachedItems, backtestParams, screenParams);
          }
          const tIpc1 = performance.now();
          // console.log(`[PerfWorker] batch ${batchIndex} IPC传输+计算: ${(tIpc1-tIpc0).toFixed(1)}ms (items=${uncachedItems.length})`);
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

            if (false) {
              // 不写缓存了
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
        }

        completedBatches++;
        // console.log(`[OptBacktest] [${today}] batch ${batchIndex} 优化+筛选完成 (${completedBatches}/${totalBatches})`);
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
      strongType?: 'limit_up' | 'new_high_60';
      strategyType: 'macd' | 'rsi';
      strategyParams: MACDStrategyResult | RSIBacktestResult;
      pullBackPct?: number;
      signalOpenPrice: number;
      signalEntityLow: number;
    }> = [];

    // ===== 2-4 前置：批量预查询所有板块条件 =====
    const tPreBoard0 = performance.now();

    // 1. 收集所有需要检查的日期和股票
    const itemsToCheck: Array<{
      type: 'watch' | 'candidate';
      stock: Stock.DetailItem;
      klines: Stock.KLineItem[];
      screenResult: BatchBacktestAndScreenResult['screenResult'];
      pullBackPct?: number;
    }> = [];

    for (let i = 0; i < batchTasks.length; i++) {
      const b = batchTasks[i];
      const batchResults = allBatchResults[i];
      for (let j = 0; j < batchResults.length; j++) {
        const { screenResult } = batchResults[j];
        const { stock, klines } = b.validItems[j];
        // 如果持仓已经有则忽略
        if (this.positions.has(stock.secid)) {
          continue;
        }
        if (!screenResult.pass) {
          // if (screenResult.reason === '最近3天无买入信号' &&
          //     !this.positions.has(stock.secid) &&
          //     !this.watchList.has(stock.secid)) {
          //   itemsToCheck.push({ type: 'watch', stock, klines, screenResult, pullBackPct: b.validItems[j].pullBackPct });
          // }
          continue;
        }
        // itemsToCheck.push({ type: 'candidate', stock, klines, screenResult });
        itemsToCheck.push({ type: 'watch', stock, klines, screenResult, pullBackPct: b.validItems[j].pullBackPct }); // 也加入watchList
      }
    }

    // [优化] 当排名百分比为1时，跳过相关检查，不发起请求
    const skipBoardRankCheck = this.BOARD_RANK_PCT >= 1;
    const skipStockRankCheck = this.STOCK_RANK_PCT >= 1;
    const uniqueDates = [strongStockDay];//[...new Set(itemsToCheck.map(i => i.screenResult.tDayDate!))];

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
    const boardStockRequests: Array<{ date: string; boardCode: string | null; boardName: string; secid: string, boardRank:number, boardZf: number }> = [];
    const preComputed = new Map<string, {
      boardPass: boolean;
      boardRankPass: boolean;
      boardCode: string | null;
      boardRank: number;
      boardZf: number;
      stockRank: number;
      stockZf: number;
      nonLimitCount: number;
    }>();

    for (const item of itemsToCheck) {
      const { stock, screenResult } = item;
      const date = strongStockDay;//screenResult.tDayDate!;

      if (skipBoardRankCheck) {
        // 板块排名检查已跳过，所有板块都通过
        if (skipStockRankCheck || stock.strongType === 'limit_up') {
          preComputed.set(stock.secid, { boardPass: true, boardRankPass: true, boardCode: null, boardRank: -1, boardZf: 0, stockRank: -1, stockZf: 0, nonLimitCount: 0 });
        } else {
          // 仍需查 boardStocks（通过板块名称查找）
          preComputed.set(stock.secid, { boardPass: true, boardRankPass: false, boardCode: null, boardRank: -1, stockRank: -1, boardZf: 0, stockZf: 0, nonLimitCount: 0 });
          boardStockRequests.push({ date, boardCode: null, boardName: stock.bk, secid: stock.secid, boardRank: -1, boardZf: 0 });
        }
        continue;
      }

      const boards = boardsByDate[date] || [];
      
      let boardPass = false;
      let boardCode: string | null = null;
      let boardRank = -1;
      let boardZf = 0;
      if (boards.length > 0) {
        const sortedBoards = boards.sort((a, b) => b.zf - a.zf);
        boardRank = sortedBoards.findIndex(b => b.name === stock.bk);
        if (boardRank < 0) boardRank = sortedBoards.findIndex(b => b.name.startsWith(stock.bk));
        // 条件2：绝对涨幅（板块当日必须涨 > 2%）
        boardZf = boardRank >= 0 ? sortedBoards[boardRank].zf : 0;
        if (boardRank >= 0) {
          const absolutePass = boardZf > 2; // 板块涨幅必须 > 2%

          boardPass = absolutePass && (boardRank + 1) <= boards.length * this.BOARD_RANK_PCT;
          boardCode = boards[boardRank].code;
        }
      }

      if (!boardPass) {
        preComputed.set(stock.secid, { boardPass: false, boardRankPass: false, boardCode, boardRank, boardZf, stockRank: -1, stockZf: 0, nonLimitCount: 0 });
        continue;
      }

      if (stock.strongType === 'limit_up' || skipStockRankCheck) {
        preComputed.set(stock.secid, { boardPass: true, boardRankPass: true, boardCode, boardRank, boardZf, stockRank: -1, stockZf: 0, nonLimitCount: 0 });
      } else {
        // 需要查 boardStocks，收集请求
        if (boardCode) {
          boardStockRequests.push({ date, boardCode, boardName: stock.bk, secid: stock.secid, boardRank, boardZf, });
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
        const stockRankInAll = stocks.findIndex(s => s.secid === req.secid);
        const nonLimitStocks = stocks.filter(s => !isLimitUpStock(s.secid, s.zf)).sort((a, b) => b.zf - a.zf);
        let stockRank = nonLimitStocks.findIndex(s => s.secid === req.secid);
        if (stockRank == -1 && stockRankInAll != -1) {
          stockRank = 1; // 应该是涨停了
        }
        const stockZf = stockRankInAll > 0 ? stocks[stockRankInAll].zf : 0;
        const boardRankPass = stockZf > 3 && stockRank >= 0 && (stockRank + 1) <= nonLimitStocks.length * this.STOCK_RANK_PCT;
        
        const existing = preComputed.get(req.secid)!;
        preComputed.set(req.secid, {
          ...existing,
          boardRankPass: boardRankPass || stockRank < 0, // 找不到排名时宽松处理
          stockRank,
          stockZf,
          boardRank: req.boardRank,
          nonLimitCount: nonLimitStocks.length
        });
        // [调试] 打印个股排名回填结果
        console.log(`[Debug][ stockRank回填][${req.date}] ${req.secid} 板块=${req.boardName} 个股排名=${stockRank >= 0 ? stockRank + 1 : '未找到'} 涨幅${stockZf.toFixed(2)}% 板块内非涨停数=${nonLimitStocks.length} 通过=${boardRankPass || stockRank < 0}`);
        if (stockRank < 0) {
          console.log(`[Debug][ stockRank回填][${req.date}] ${req.secid} stockRank<0, nonLimitStocks内容:`, nonLimitStocks.map(s => `${s.secid}(${s.zf.toFixed(2)}%)`).join(', '));
        }
      }
    }

    const tPreBoard1 = performance.now();
    console.log(`[Perf] [${today}] 板块预查询: ${(tPreBoard1 - tPreBoard0).toFixed(1)}ms (${uniqueDates}日期, ${boardStockRequests.length}股票需查成分股)`);

    // [新增] 统计有买入信号但因其他原因失败的分布
    // const signalFailStats: Record<string, number> = {};
    // let hasSignalButFailed = 0;
    // for (const item of itemsToCheck) {
    //   const { screenResult } = item;
    //   if (!screenResult.pass && screenResult.mDayIndex !== undefined && screenResult.mDayIndex >= 0) {
    //     hasSignalButFailed++;
    //     const reason = screenResult.reason || '未知原因';
    //     signalFailStats[reason] = (signalFailStats[reason] || 0) + 1;
    //   }
    // }
    // if (hasSignalButFailed > 0) {
    //   console.log(`[OptBacktest] [${today}] 📊 有买入信号但筛选失败统计: ${hasSignalButFailed} 只`);
    //   console.log(`[OptBacktest] [${today}] 📊 失败原因分布:`, signalFailStats);
    // }

    // 6. 根据预计算结果分配（纯内存操作，零 IPC）
    for (const item of itemsToCheck) {
      const { type, stock, klines, screenResult } = item;
      const computed = preComputed.get(stock.secid);

      if (!computed || !computed.boardPass) {
        console.log(`[OptBacktest] [${today}] ${stock.secid} ❌ ${type === 'watch' ? '观察' : ''}筛选失败: 板块未进全市场前${(this.BOARD_RANK_PCT * 100).toFixed(0)}% 涨幅${computed?.boardZf.toFixed(2)}%`);
        continue;
      }

      if (!computed.boardRankPass) {
        console.log(`[OptBacktest] [${today}] ${stock.secid} ❌ ${type === 'watch' ? '观察' : ''}筛选失败: 股票未进板块内前${(this.STOCK_RANK_PCT * 100).toFixed(0)}%(排除涨停后${computed.nonLimitCount}只)`);
        continue;
      }

      if (type === 'watch') {
        // 满足评分的强势股票加入候选列表
        this.watchList.set(stock.secid, {
          secid: stock.secid,
          boardCode: stock.bk,
          strategyType: screenResult.bestType!,
          strategyParams: screenResult.bestResult!,
          score: screenResult.score!,
          addedDate: today,
          tDayDate: strongStockDay,// screenResult.tDayDate!,
          strongType: stock.strongType!,
          maxWatchDays: this.MAX_WATCH_DAYS,
          strongStockDay: strongStockDay,
          zsz: stock.sz,
        });
        const watchParamsStr = this.formatStrategyParams(screenResult.bestType, screenResult.bestResult);
        console.log(`[OptBacktest] [${today}] ${stock.secid} 👀 加入观察列表 (评分${screenResult.score!.toFixed(1)})${watchParamsStr ? ' | ' + watchParamsStr : ''}`);
      } else {
        const currentPrice = klines[klines.length - 1].sp;
        const pullBackStr = item.pullBackPct !== undefined ? `, 回调=${(item.pullBackPct * 100).toFixed(1)}%` : '';
        const upRatioMA5 = this.dailyRiskPreference.get(today)?.upRatioMA5 ?? 0.5;
        const signalKline = klines[klines.length - 1];
        buyCandidates.push({
          secid: stock.secid,
          score: screenResult.score!,
          boardCode: stock.bk,
          price: currentPrice,
          reason: `${screenResult.reason!}${pullBackStr}, 评分=${screenResult.score!.toFixed(1)}, 市场情绪=${upRatioMA5.toFixed(2)}`,
          strongType: stock.strongType,
          strategyType: screenResult.bestType!,
          strategyParams: screenResult.bestResult!,
          pullBackPct: item.pullBackPct,
          zsz: stock.sz,
          signalOpenPrice: signalKline.kp,
          signalEntityLow: Math.min(signalKline.kp, signalKline.sp),
        });
        console.log(`[OptBacktest] [${today}] ${stock.secid} ✅ 通过筛选 | ${screenResult.reason}${pullBackStr}${computed.boardRank >= 0 ? ` | 板块排名=${computed.boardRank + 1}` : ''}${computed.stockRank >= 0 ? ` | 个股排名=${computed.stockRank + 1}` : ''}`);
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

        if (this.pendingOrders.some(o => o.secid === candidate.secid)) {
          console.log(`[OptBacktest] [${today}] ${candidate.secid} 买入跳过: 已存在待买入订单`);
          continue;
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
        // [调试] 打印即将传入pendingOrders的排名信息
        console.log(`[Debug][ pendingOrder][${today}] ${candidate.secid} score=${candidate.score.toFixed(1)} boardRank=${computed?.boardRank !== undefined && computed.boardRank >= 0 ? computed.boardRank + 1 : '-'} stockRank=${computed?.stockRank !== undefined && computed.stockRank >= 0 ? computed.stockRank + 1 : '-'}`);
        this.pendingOrders.push({
          secid: candidate.secid,
          type: 'buy',
          reason: candidate.reason,
          signalDate: today,
          signalOpenPrice: candidate.signalOpenPrice,
          signalEntityLow: candidate.signalEntityLow,
          boardCode: candidate.boardCode,
          strategyType: candidate.strategyType,
          strategyParams: candidate.strategyParams,
          score: candidate.score,
          boardRank: computed?.boardRank,
          stockRank: computed?.stockRank,
          strongType: candidate.strongType,
          pullBackPct: candidate.pullBackPct,
          zsz: candidate.zsz,
        });
        boardHoldings.set(candidate.boardCode, boardCount + 1);
        console.log(`[OptBacktest] [${today}] ${candidate.secid} ✅ 生成买入订单 (次日${nextDay}执行) | 评分${candidate.score.toFixed(1)} | 板块${candidate.boardCode}`);
      }
    } else {
      console.log(`[OptBacktest] [${today}] 无买入候选触发`);
    }

    // [修复] 阶段2-5：对当日收盘卖出的订单进行用户确认并立即执行
    if (this.pendingOrders.some(o => o.type === 'sell' && o.executePrice !== undefined)) {
      if (await this.executeIntradaySellOrders(today, dataProvider)) {
        return true;
      }
    }

    // [新增] stage2 结束后保存快照，pendingOrders 已包含次日待执行订单
    await this.saveSnapshot('after-stage2', this.currentDayIndex, today);
    return false;
  }

  // [新增] 执行当日收盘卖订单（在 stage2 末尾调用，经过用户确认）
  private async executeIntradaySellOrders(today: string, dataProvider: StrategyDataProvider): Promise<boolean> {
    const indices: number[] = [];
    const intradaySellOrders: StrategyPendingOrder[] = [];
    this.pendingOrders.forEach((o, idx) => {
      // [修复] 处理所有带执行价格的收盘卖订单（含崩溃恢复遗留的订单）
      if (o.type === 'sell' && o.executePrice !== undefined) {
        indices.push(idx);
        intradaySellOrders.push(o);
      }
    });

    if (intradaySellOrders.length === 0) return false;

    console.log(`[OptBacktest] [${today}] 阶段2-5: 处理当日收盘卖订单 ${intradaySellOrders.length} 笔`);

    const secidsToFetch = intradaySellOrders.map(o => o.secid);
    const klinesMap = await dataProvider.getKLines(secidsToFetch, today, 5);

    const reviewableOrders: StrategyPendingOrder[] = [];
    for (const order of intradaySellOrders) {
      if (this.isCancelled()) return true;
      await this.waitIfPaused();
      if (this.isCancelled()) return true;

      const klines = klinesMap[order.secid];
      const todayKLine = klines?.find(k => k.date === today);
      if (!klines || klines.length === 0) {
        console.log(`[OptBacktest] [${today}] 当日收盘卖订单跳过: ${order.secid} 未获取到K线数据`);
        continue;
      }
      if (!todayKLine) {
        const lastKline = klines[klines.length - 1];
        console.log(`[OptBacktest] [${today}] 当日收盘卖订单跳过: ${order.secid} 停牌 (最近交易日: ${lastKline?.date || '无'})`);
        continue;
      }
      reviewableOrders.push({ ...order, canExecuteToday: true });
    }

    let ordersToExecute = reviewableOrders;
    if (this.pendingOrderReviewCallback && reviewableOrders.length > 0) {
      // 在确认前保存快照，若暂停/崩溃可从 stage2 重新生成信号并再次确认
      await this.saveSnapshot('after-stage1', this.currentDayIndex, today);
      console.log(`[OptBacktest] [${today}] 等待用户确认 ${reviewableOrders.length} 笔当日收盘卖订单`);
      const approvedOrders = await this.pendingOrderReviewCallback(reviewableOrders, today);
      // 只认可 reviewableOrders 范围内的批准结果
      const approvedInReviewable = approvedOrders.filter(ao => reviewableOrders.some(ro => ro.secid === ao.secid));
      const approvedSecids = new Set(approvedInReviewable.map(o => o.secid));
      ordersToExecute = reviewableOrders.filter(o => approvedSecids.has(o.secid));
      console.log(`[OptBacktest] [${today}] 用户确认执行 ${ordersToExecute.length}/${reviewableOrders.length} 笔当日收盘卖订单`);
      if (this.isCancelled()) return true;
    }

    for (const order of ordersToExecute) {
      if (this.isCancelled()) return true;
      await this.waitIfPaused();
      if (this.isCancelled()) return true;

      const position = this.positions.get(order.secid);
      if (!position) {
        console.log(`[OptBacktest] [${today}] 当日收盘卖订单忽略: ${order.secid} 无持仓`);
        continue;
      }
      const execPrice = order.executePrice!;
      console.log(`[OptBacktest] [${today}] 执行当日收盘卖: ${order.secid} | 收盘价: ${execPrice.toFixed(2)} | 持仓成本: ${position.buyPrice.toFixed(2)} | 原因: ${order.reason}`);
      this.executeSell(order.secid, today, execPrice, position.quantity, order.reason);
      await yieldToMain(1);
    }

    // 从 pendingOrders 中移除所有当日收盘卖订单（无论是否执行/确认）
    for (let i = indices.length - 1; i >= 0; i--) {
      this.pendingOrders.splice(indices[i], 1);
    }

    return false;
  }

  // ===== 阶段3: 记录净值 =====
  private async recordDailyValue(date: string, dataProvider: StrategyDataProvider): Promise<boolean> {
    this.currentStage = 'stage3';
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
        this.lastPositionPrices.set(secid, close);
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
    // [新增] 当日结束后保存快照，下一交易日可从此恢复
    await this.saveSnapshot('day-end', this.currentDayIndex, date);
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
          boardCode: buy.boardCode || '',
          strategyType: buy.strategyType || 'macd',
          strategyParams: buy.strategyParams || ({} as any),
          score: buy.score || 0,
          boardRank: buy.boardRank,
          stockRank: buy.stockRank,
          strategyParamsStr: this.formatStrategyParams(buy.strategyType, buy.strategyParams),
          strongType: buy.strongType,
          zsz: buy.zsz,
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
      } else {
        // [修正] 回测结束时仍持仓，按最后收盘价虚拟结算
        const position = this.positions.get(buy.secid);
        const lastPrice = this.lastPositionPrices.get(buy.secid);
        if (position && lastPrice !== undefined && position.buyDate === buy.date) {
          const adjustedPrice = lastPrice * (1 - this.SLIPPAGE);
          const totalAmount = adjustedPrice * position.quantity;
          const commission = totalAmount * this.COMMISSION;
          const stampTax = totalAmount * this.STAMP_TAX;
          const netAmount = totalAmount - commission - stampTax;
          const pnl = netAmount - position.buyAmount;
          detail.sellDate = this.tradeDays[this.tradeDays.length - 1] || buy.date;
          detail.sellPrice = adjustedPrice;
          detail.pnl = pnl;
          detail.returnPct = position.buyAmount > 0 ? (pnl / position.buyAmount) * 100 : 0;
          detail.sellReason = '持仓期末结算';
          detail.holdDays = this.getTradeDaysDiff(buy.date, detail.sellDate);
        }
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

  // [新增] 按排名区间统计胜率分布（基于每笔交易，避免按股票聚合导致的口径不一致）
  private calculateRankDistribution(): {
    boardRankDistribution: RankWinRateDistribution[];
    stockRankDistribution: RankWinRateDistribution[];
  } {
    const buyRecords = this.tradeRecords.filter(t => t.type === 'buy');
    const sellRecords = this.tradeRecords.filter(t => t.type === 'sell');

    const rankRanges = [
      { label: '1-3', min: 0, max: 3 },
      { label: '4-10', min: 3, max: 10 },
      { label: '11-30', min: 10, max: 30 },
      { label: '31-50', min: 30, max: 50 },
      { label: '50+', min: 50, max: Infinity },
    ];

    const calc = (rankType: 'boardRank' | 'stockRank'): RankWinRateDistribution[] => {
      return rankRanges.map(r => {
        let count = 0;
        let winTrades = 0;
        let lossTrades = 0;
        let totalReturnPct = 0;
        const uniqueSecids = new Set<string>();
        const usedSellKeys = new Set<string>();

        // 按日期排序买入记录，确保配对顺序正确
        const sortedBuys = [...buyRecords].sort((a, b) => a.date.localeCompare(b.date));

        for (const buy of sortedBuys) {
          const rank = buy[rankType];
          if (rank === undefined || rank < r.min || rank >= r.max) continue;

          const sell = sellRecords.find(s =>
            s.secid === buy.secid &&
            s.date > buy.date &&
            !usedSellKeys.has(`${s.secid}_${s.date}`)
          );

          let actualSell: StrategyTradeRecord | undefined = sell;
          if (!actualSell) {
            // [修正] 回测结束时仍持仓，按最后收盘价虚拟结算
            const position = this.positions.get(buy.secid);
            const lastPrice = this.lastPositionPrices.get(buy.secid);
            if (position && lastPrice !== undefined && position.buyDate === buy.date) {
              const adjustedPrice = lastPrice * (1 - this.SLIPPAGE);
              const totalAmount = adjustedPrice * position.quantity;
              const commission = totalAmount * this.COMMISSION;
              const stampTax = totalAmount * this.STAMP_TAX;
              const netAmount = totalAmount - commission - stampTax;
              const pnl = netAmount - position.buyAmount;
              const returnPct = position.buyAmount > 0 ? (pnl / position.buyAmount) * 100 : 0;
              actualSell = {
                date: this.tradeDays[this.tradeDays.length - 1] || buy.date,
                secid: buy.secid,
                type: 'sell',
                price: adjustedPrice,
                quantity: position.quantity,
                amount: netAmount,
                reason: '持仓期末结算',
                pnl,
                score: (position as any).score,
                boardRank: (position as any).boardRank,
                stockRank: (position as any).stockRank,
                boardCode: position.boardCode,
                returnPct,
                strategyType: position.strategyType,
                strategyParams: position.strategyParams,
              } as StrategyTradeRecord;
            }
          }
          if (!actualSell) continue;

          usedSellKeys.add(`${actualSell.secid}_${actualSell.date}`);
          uniqueSecids.add(buy.secid);
          count++;
          const returnPct = actualSell.returnPct || 0;
          totalReturnPct += returnPct;
          if ((actualSell.pnl || 0) > 0) {
            winTrades++;
          } else {
            lossTrades++;
          }
        }

        const totalTrades = winTrades + lossTrades;
        return {
          rankType,
          rankRange: r.label,
          minRank: r.min,
          maxRank: r.max === Infinity ? 9999 : r.max,
          count,
          uniqueCount: uniqueSecids.size,
          winTrades,
          lossTrades,
          winRate: totalTrades > 0 ? winTrades / totalTrades : 0,
          avgReturnPct: totalTrades > 0 ? totalReturnPct / totalTrades : 0,
        };
      });
    };

    return {
      boardRankDistribution: calc('boardRank'),
      stockRankDistribution: calc('stockRank'),
    };
  }

  // [新增] 按深度回调区间统计胜率分布
  private calculatePullBackDistribution(): PullBackWinRateDistribution[] {
    const buyRecords = this.tradeRecords.filter(t => t.type === 'buy');
    const sellRecords = this.tradeRecords.filter(t => t.type === 'sell');

    const pullBackRanges = [
      { label: '<5%', min: 0, max: 0.05 },
      { label: '5%-10%', min: 0.05, max: 0.10 },
      { label: '10%-15%', min: 0.10, max: 0.15 },
      { label: '15%-20%', min: 0.15, max: 0.20 },
      { label: '20%-30%', min: 0.20, max: 0.30 },
      { label: '30%+', min: 0.30, max: Infinity },
    ];

    return pullBackRanges.map(r => {
      let count = 0;
      let winTrades = 0;
      let lossTrades = 0;
      let totalReturnPct = 0;
      const uniqueSecids = new Set<string>();
      const usedSellKeys = new Set<string>();

      const sortedBuys = [...buyRecords].sort((a, b) => a.date.localeCompare(b.date));

      for (const buy of sortedBuys) {
        const pb = buy.pullBackPct;
        if (pb === undefined || pb < r.min || pb >= r.max) continue;

        const sell = sellRecords.find(s =>
          s.secid === buy.secid &&
          s.date > buy.date &&
          !usedSellKeys.has(`${s.secid}_${s.date}`)
        );

        let actualSell: StrategyTradeRecord | undefined = sell;
        if (!actualSell) {
          const position = this.positions.get(buy.secid);
          const lastPrice = this.lastPositionPrices.get(buy.secid);
          if (position && lastPrice !== undefined && position.buyDate === buy.date) {
            const adjustedPrice = lastPrice * (1 - this.SLIPPAGE);
            const totalAmount = adjustedPrice * position.quantity;
            const commission = totalAmount * this.COMMISSION;
            const stampTax = totalAmount * this.STAMP_TAX;
            const netAmount = totalAmount - commission - stampTax;
            const pnl = netAmount - position.buyAmount;
            const returnPct = position.buyAmount > 0 ? (pnl / position.buyAmount) * 100 : 0;
            actualSell = {
              date: this.tradeDays[this.tradeDays.length - 1] || buy.date,
              secid: buy.secid,
              type: 'sell',
              price: adjustedPrice,
              quantity: position.quantity,
              amount: netAmount,
              reason: '持仓期末结算',
              pnl,
              score: (position as any).score,
              boardRank: (position as any).boardRank,
              stockRank: (position as any).stockRank,
              boardCode: position.boardCode,
              returnPct,
              strategyType: position.strategyType,
              strategyParams: position.strategyParams,
              pullBackPct: (position as any).pullBackPct,
              zsz: (position as any).zsz,
            } as StrategyTradeRecord;
          }
        }
        if (!actualSell) continue;

        usedSellKeys.add(`${actualSell.secid}_${actualSell.date}`);
        uniqueSecids.add(buy.secid);
        count++;
        const returnPct = actualSell.returnPct || 0;
        totalReturnPct += returnPct;
        if ((actualSell.pnl || 0) > 0) {
          winTrades++;
        } else {
          lossTrades++;
        }
      }

      const totalTrades = winTrades + lossTrades;
      return {
        pullBackRange: r.label,
        minPullBack: r.min,
        maxPullBack: r.max === Infinity ? 9999 : r.max,
        count,
        uniqueCount: uniqueSecids.size,
        winTrades,
        lossTrades,
        winRate: totalTrades > 0 ? winTrades / totalTrades : 0,
        avgReturnPct: totalTrades > 0 ? totalReturnPct / totalTrades : 0,
      };
    });
  }

  // [新增] 按总市值区间统计胜率分布
  private calculateMarketCapDistribution(stockStats: StockTradeStats[]): MarketCapWinRateDistribution[] {
    const ranges = [
      { label: '<30亿', min: 0, max: 30 },
      { label: '30-100亿', min: 30, max: 100 },
      { label: '100-300亿', min: 100, max: 300 },
      { label: '300-500亿', min: 300, max: 500 },
      { label: '500-1000亿', min: 500, max: 1000 },
      { label: '1000亿+', min: 1000, max: Infinity },
    ];

    return ranges.map(r => {
      const items = stockStats.filter(s => s.zsz !== undefined && s.zsz >= r.min && s.zsz < r.max && s.totalTrades > 0);
      const totalTrades = items.reduce((sum, s) => sum + s.totalTrades, 0);
      const winTrades = items.reduce((sum, s) => sum + s.winTrades, 0);
      const lossTrades = items.reduce((sum, s) => sum + s.lossTrades, 0);
      const totalReturn = items.reduce((sum, s) => sum + s.avgReturnPct * s.totalTrades, 0);
      const uniqueSecids = new Set(items.map(s => s.secid));

      return {
        marketCapRange: r.label,
        minMarketCap: r.min,
        maxMarketCap: r.max === Infinity ? 99999 : r.max,
        count: totalTrades,
        uniqueCount: uniqueSecids.size,
        winTrades,
        lossTrades,
        winRate: totalTrades > 0 ? winTrades / totalTrades : 0,
        avgReturnPct: totalTrades > 0 ? totalReturn / totalTrades : 0,
      };
    });
  }

  // ===== 结果计算 =====
  private calculateResult(silent: boolean = false): StrategyBacktestResult {
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

    // [修正] 为持仓中的股票生成虚拟卖出记录，回测结束时按最后收盘价结算盈亏
    const virtualSellTrades: StrategyTradeRecord[] = [];
    const lastDate = this.tradeDays[this.tradeDays.length - 1] || '';
    for (const [secid, pos] of this.positions) {
      const lastPrice = this.lastPositionPrices.get(secid);
      if (lastPrice === undefined) continue;
      const adjustedPrice = lastPrice * (1 - this.SLIPPAGE);
      const totalAmount = adjustedPrice * pos.quantity;
      const commission = totalAmount * this.COMMISSION;
      const stampTax = totalAmount * this.STAMP_TAX;
      const netAmount = totalAmount - commission - stampTax;
      const pnl = netAmount - pos.buyAmount;
      const returnPct = pos.buyAmount > 0 ? (pnl / pos.buyAmount) * 100 : 0;
      virtualSellTrades.push({
        date: lastDate,
        secid,
        type: 'sell',
        price: adjustedPrice,
        quantity: pos.quantity,
        amount: netAmount,
        reason: '持仓期末结算',
        pnl,
        score: (pos as any).score,
        boardRank: (pos as any).boardRank,
        stockRank: (pos as any).stockRank,
        boardCode: pos.boardCode,
        returnPct,
        strategyType: pos.strategyType,
        strategyParams: pos.strategyParams,
        pullBackPct: (pos as any).pullBackPct,
        zsz: (pos as any).zsz,
      });
    }

    const sellTrades = this.tradeRecords.filter(t => t.type === 'sell');
    const allSellTrades = [...sellTrades, ...virtualSellTrades];
    const winTrades = allSellTrades.filter(t => (t.pnl || 0) > 0);
    const winRate = allSellTrades.length > 0 ? winTrades.length / allSellTrades.length : 0;

    const totalProfit = winTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const lossTrades = allSellTrades.filter(t => (t.pnl || 0) <= 0);
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
    for (const sell of allSellTrades) {
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
    const { boardRankDistribution, stockRankDistribution } = this.calculateRankDistribution();
    const pullBackDistribution = this.calculatePullBackDistribution();
    const marketCapDistribution = this.calculateMarketCapDistribution(stockStats);

    const result: StrategyBacktestResult = {
      totalReturn,
      annualizedReturn,
      maxDrawdown,
      winRate,
      profitFactor,
      sharpeRatio,
      totalTrades: allSellTrades.length,
      avgHoldingDays,
      trades: this.tradeRecords,
      dailyValues: this.dailyValues,
      stockStats,
      scoreDistribution,
      boardRankDistribution,
      stockRankDistribution,
      pullBackDistribution,
      marketCapDistribution,
    };

    if (!silent) {
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
        总交易次数: allSellTrades.length,
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
    }

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

    if (i < 3 || isNaN(dif[i]) || isNaN(dea[i])) return false;

    // [优化] 死叉必须连续 2 天确认，避免单日假死叉
    const deadCrossToday = dif[i] < dea[i] && dif[i - 1] >= dea[i - 1];
    const deadCrossYesterday = dif[i - 1] < dea[i - 1] && dif[i - 2] >= dea[i - 2];
    
    // 策略1：连续 2 天死叉才卖出
    if (deadCrossToday && deadCrossYesterday) return true;

    // 策略2：柱状线连续 3 天显著缩短（动能衰竭），且 DIF 开始拐头向下
    if (hist[i] > 0 && hist[i] < hist[i - 1] && hist[i - 1] < hist[i - 2] && hist[i - 2] < hist[i - 3]) {
      const sharpShrink = hist[i] < hist[i - 1] * 0.6; // 从 0.7 改为 0.6，更严格
      if (sharpShrink && dif[i] < dif[i - 1]) return true;
    }

    return false;
  }

  private checkRSISellSignal(klines: Stock.KLineItem[], params: RSIBacktestResult): boolean {
    const closes = klines.map(k => k.sp);
    const rsi = calculateRSI(closes, params.rsiPeriod);
    const i = closes.length - 1;

    if (i < 1 || isNaN(rsi[i]) || isNaN(rsi[i - 1])) return false;

    // [优化] RSI冲高回落卖出：前一天在超买区，今天RSI开始回落
    const wasOverbought = rsi[i - 1] >= params.sellThreshold;
    const isFalling = rsi[i] < rsi[i - 1];

    if (wasOverbought && isFalling) {
      return true;
    }

    return false;
  }

  // ===== K线形态判断 =====


  // ===== 断点续跑工具 =====
  private getSnapshotParams(): BacktestSnapshotParams {
    return {
      initialCapital: this.initialCapital,
      maxPositions: this.MAX_POSITIONS,
      positionRatio: this.POSITION_RATIO,
      stopLossInitPct: this.STOP_LOSS_INIT_PCT,
      trailingStopPct: this.TRAILING_STOP_PCT,
      takeProfitPct: this.TAKE_PROFIT_PCT,
      minStrategyScore: this.MIN_STRATEGY_SCORE,
      strongLookback: this.STRONG_LOOKBACK,
      maxWatchDays: this.MAX_WATCH_DAYS,
      boardRankPct: this.BOARD_RANK_PCT,
      stockRankPct: this.STOCK_RANK_PCT,
      strategyMode: this.strategyMode,
      structureBreakDays: this.STRUCTURE_BREAK_DAYS,
      rangeBoundDays: this.RANGE_BOUND_DAYS,
      upDownRateHighThresh: this.UP_DOWN_RATE_HIGH_THRESH,
      upDownRateLowThresh: this.UP_DOWN_RATE_LOW_THRESH,
      pullbackPct: this.PULLBACK_PCT,
      sellAtOpen: this.SELL_AT_OPEN,
      timeExitMaxDays: this.TIME_EXIT_MAX_DAYS,
      timeExitMinReturn: this.TIME_EXIT_MIN_RETURN,
      profitIgnoreSignalPct: this.PROFIT_IGNORE_SIGNAL_PCT,
      trailingStopStartPct: this.TRAILING_STOP_START_PCT,
      trailingStopTightenPct: this.TRAILING_STOP_TIGHTEN_PCT,
      buyThresholds: this.RSI_BUY_THRESHOLDS,
      sellThresholds: this.RSI_SELL_THRESHOLDS,
      filterStrongType: this.FILTER_STRONG_TYPE,
      steepness: this.STEEPNESS,
    };
  }

  public getSnapshot(nodeType: BacktestNodeType, currentDayIndex: number, currentDate: string): BacktestSnapshot {
    return {
      version: BACKTEST_SNAPSHOT_VERSION,
      createdAt: Date.now(),
      nodeType,
      currentDayIndex,
      currentDate,
      params: this.getSnapshotParams(),
      state: {
        capital: this.capital,
        availableCash: this.availableCash,
        positions: Array.from(this.positions.entries()),
        pendingOrders: this.pendingOrders,
        tradeRecords: this.tradeRecords,
        dailyValues: this.dailyValues,
        tradeDays: this.tradeDays,
        watchList: Array.from(this.watchList.entries()),
        dailyRiskPreference: Array.from(this.dailyRiskPreference.entries()),
        lastPositionPrices: Array.from(this.lastPositionPrices.entries()),
      },
    };
  }

  public applySnapshot(snapshot: BacktestSnapshot): void {
    if (snapshot.version !== BACKTEST_SNAPSHOT_VERSION) {
      throw new Error(`不支持的快照版本: ${snapshot.version}`);
    }
    this.tradeDays = snapshot.state.tradeDays;
    this.capital = snapshot.state.capital;
    this.availableCash = snapshot.state.availableCash;
    this.positions = new Map(snapshot.state.positions);
    this.pendingOrders = snapshot.state.pendingOrders;
    this.tradeRecords = snapshot.state.tradeRecords;
    this.dailyValues = snapshot.state.dailyValues;
    this.watchList = new Map(snapshot.state.watchList);
    this.dailyRiskPreference = new Map(snapshot.state.dailyRiskPreference);
    this.lastPositionPrices = new Map(snapshot.state.lastPositionPrices);
    this.currentDayIndex = snapshot.currentDayIndex;
  }

  private async saveSnapshot(nodeType: BacktestNodeType, currentDayIndex: number, currentDate: string): Promise<void> {
    try {
      const snapshot = this.getSnapshot(nodeType, currentDayIndex, currentDate);
      // [优化] 不再直接写入磁盘，而是通过回调交给 UI 保存到历史记录结构中
      this.onSnapshotCallback?.(snapshot);
    } catch (error: any) {
      console.error('[OptBacktest] 保存断点快照失败:', error);
    }
  }

  public static fromSnapshot(
    snapshot: BacktestSnapshot,
    workerExecutor?: (method: string, args?: any[]) => Promise<any>
  ): OptimizedStrategyBacktest {
    const instance = new OptimizedStrategyBacktest(
      snapshot.state.tradeDays,
      snapshot.params.initialCapital,
      workerExecutor,
      snapshot.params
    );
    instance.applySnapshot(snapshot);
    return instance;
  }

  private async completeRun(result: StrategyBacktestResult): Promise<StrategyBacktestResult> {
    // [优化] 清理工作由 UI 通过 onSnapshot 回调完成，引擎不再直接操作存储
    return result;
  }

  private async applyResumeSnapshot(
    snapshot: BacktestSnapshot,
    dataProvider: StrategyDataProvider,
    onProgress?: (message: string, percent?: number) => void
  ): Promise<number> {
    this.applySnapshot(snapshot);
    const totalDays = this.tradeDays.length;
    const dayPercentStep = totalDays > 0 ? 90 / totalDays : 0;
    const { nodeType, currentDayIndex, currentDate } = snapshot;

    console.log(`[OptBacktest] 恢复快照: nodeType=${nodeType}, currentDayIndex=${currentDayIndex}, currentDate=${currentDate}`);

    if (currentDayIndex < 0 || currentDayIndex >= totalDays) {
      return totalDays; // 已处理完所有交易日
    }

    switch (nodeType) {
      case 'day-start':
      case 'pending-review':
        // 从当前交易日完整重跑
        return currentDayIndex;
      case 'after-stage1': {
        // stage1 已完成，继续 stage2 + stage3
        const today = this.tradeDays[currentDayIndex];
        const nextDay = this.tradeDays[currentDayIndex + 1];
        if (!nextDay) {
          // 最后一个交易日，没有 nextDay，直接记录净值
          await this.recordDailyValue(today, dataProvider);
          return currentDayIndex + 1;
        }
        const currentBase = Math.round(currentDayIndex * dayPercentStep);
        onProgress?.(`[${currentDayIndex + 1}/${totalDays}] ${today} 生成交易信号...`, Math.round(currentBase + dayPercentStep * 0.3));
        const cancelledInStage2 = await this.generateSignals(today, nextDay, dataProvider, currentBase, dayPercentStep, (msg, pct) => {
          onProgress?.(msg, pct ?? Math.round(currentBase + dayPercentStep * 0.6));
        });
        if (cancelledInStage2) return totalDays;
        onProgress?.(`[${currentDayIndex + 1}/${totalDays}] ${today} 记录净值...`, Math.round(currentBase + dayPercentStep * 0.8));
        const cancelledInStage3 = await this.recordDailyValue(today, dataProvider);
        if (cancelledInStage3) return totalDays;
        return currentDayIndex + 1;
      }
      case 'after-stage2': {
        // stage1/stage2 已完成，继续 stage3
        const today = this.tradeDays[currentDayIndex];
        const currentBase = Math.round(currentDayIndex * dayPercentStep);
        onProgress?.(`[${currentDayIndex + 1}/${totalDays}] ${today} 记录净值...`, Math.round(currentBase + dayPercentStep * 0.8));
        const cancelledInStage3 = await this.recordDailyValue(today, dataProvider);
        if (cancelledInStage3) return totalDays;
        return currentDayIndex + 1;
      }
      case 'day-end':
        // 当前交易日已全部完成，从下一个交易日开始
        return currentDayIndex + 1;
      default:
        return currentDayIndex;
    }
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
    let enteredPause = false;
    while (this.cancelOptions?.onShouldPause?.()) {
      if (!enteredPause) {
        enteredPause = true;
        // [新增] 进入暂停时保存快照，崩溃/关闭后可恢复
        const nodeType: BacktestNodeType =
          this.currentStage === 'stage1'
            ? this.stage1Reviewed
              ? 'after-stage1'
              : 'pending-review'
            : this.currentStage === 'stage2'
            ? 'after-stage1'
            : this.currentStage === 'stage3'
            ? 'after-stage2'
            : 'day-start';
        await this.saveSnapshot(nodeType, this.currentDayIndex, this.tradeDays[this.currentDayIndex]);
        console.log(`[OptBacktest] 回测已暂停并保存快照: ${nodeType}, 当前日期: ${this.tradeDays[this.currentDayIndex]}`);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      if (this.isCancelled()) {
        return true;
      }
    }
    return false;
  }
}