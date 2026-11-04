/**
 * 短线评分「突变」策略回测（纯计算，无 IO）
 *
 * 输入必须是**现取数逐日重算**的评分序列（computeShortTermScoreCurve 的 scores），
 * 不能读评分缓存：缓存里混着多个行结构版本（v9/v10/v11/v13），旧版本行是旧公式算的，
 * 与个股详情页曲线口径不一致（应用自身也只认 SCORE_ROW_VERSION 的行）。
 *
 * 规则（与图表上的红绿柱同口径，与离线脚本 backtest_short_score_jump.py 保持一致）：
 *   Δ = 评分(D) - 评分(D-1)，仅相邻交易日才算一次突变；
 *   买入（两种口径都只有「单日跳升」）：Δ ≥ buyDelta 且 评分 ≥ 地板 且「低位启动」→ 次日开盘买入；
 *     地板：buyMode=jump 取 minScore，buyMode=rise 取 riseMinScore（两者默认都是 60）；
 *   抬升（评分自近 riseRefDays 日最低点抬升 ≥ minRise 且 ≥ riseMinScore、当日不回落）
 *     只在 buyMode=rise 时标成「抬升观察」，不建仓——实测该形态期望≈0、盈利因子<1；
 *   Δ ≤ sellDelta                                → 次日开盘卖出；
 *   评分自持仓期最高点回撤 ≥ trailDrop 且 Δ ≤ 0   → 次日开盘卖出（回撤止盈，反弹当天不卖）。
 *
 * 四个入场过滤（均为 0 时关闭）：
 *   低位启动 lowBaseDays/lowBaseMax：jump 口径要求突变前 N 个评分日都 ≤ lowBaseMax；
 *     rise 口径要求近 N 日最低分（抬升起点）≤ lowBaseMax。
 *     只看单日跳升会把「高位跌两天再反抽 +20」当成买点（下跌趋势里的伪信号）；
 *   冷却期 cooldownDays：卖出成交日起 N 个交易日内不开新仓，避免"绿柱卖出后反抽又追回"；
 *     默认关闭（0）：全市场离线回测（925 只 / 203 个交易日）里开启 3 日冷却后，
 *     笔数 -22%、期望 +1.45%→+1.00%、盈利因子 1.65→1.47，收益贡献反而下降；
 *   跳空过滤 maxGapPct：信号日收盘 → 次日开盘的跳空超过 ±该百分比则放弃本次信号，
 *     防止在追高（高开）或破位（低开）时按次日开盘价接盘；默认同样关闭（0），
 *     原因同上——被它挡掉的信号在样本里平均是赚的；
 *   均线区间 maBandLow/maBandHigh：信号日收盘价要在短均线之上、长均线之下
 *     （5/10/20/40/60 的组合，与离线脚本 --ma-band / 列表「区间」过滤同口径）。
 */
import { Stock } from '@/types/stock';
import { MaBand, maBandOkAt } from './maBand';

export interface ShortScoreBacktestParams {
  /** 买入：单日评分跳升阈值（分） */
  buyDelta: number;
  /** 卖出：单日评分跳降阈值（分，负值） */
  sellDelta: number;
  /** 买入时评分下限 */
  minScore: number;
  /** 单次往返成本（佣金+印花税+滑点近似） */
  fee: number;
  /** 回测窗口（最近 N 个交易日，最多 240） */
  limitDays: number;
  /** 卖出后冷却：卖出成交日起 N 个交易日内不再开新仓（0 = 关闭） */
  cooldownDays: number;
  /** 跳空过滤：信号日收盘→次日开盘跳空超过该百分比（绝对值）则放弃买入（0 = 关闭） */
  maxGapPct: number;
  /** 低位启动：突变前 N 个评分日必须都 ≤ lowBaseMax（0 = 关闭，只看单日跳升） */
  lowBaseDays: number;
  /** 低位上限分（配合 lowBaseDays） */
  lowBaseMax: number;
  /** 回撤止盈：评分自持仓期最高点回撤 ≥ 该分数即卖出（0 = 关闭） */
  trailDrop: number;
  /**
   * 买入口径：
   *   jump = 只看单日跳升：Δ ≥ buyDelta 且 评分 ≥ minScore
   *   rise = 买点同样是单日跳升（地板取 riseMinScore），额外把「累计抬升达标」标成
   *          「抬升观察」——只有标记，不下单（历史验证见 ShortScoreSignalKind 注释）
   */
  buyMode: 'jump' | 'rise';
  /** rise 模式：自低点抬升幅度下限（分） */
  minRise: number;
  /** rise 模式：低位参照窗口（近 N 个评分日的最低分） */
  riseRefDays: number;
  /** rise 模式：评分绝对地板（低于该值不算启动） */
  riseMinScore: number;
  /**
   * 均线区间过滤：信号日收盘价必须 > MA(maBandLow) 且 < MA(maBandHigh)
   *
   * 0/0 表示关闭。区间取 5/10/20/40/60 的组合（与离线脚本 --ma-band 同口径），
   * 对应「中期趋势没坏、短期回踩到中继位置」的低吸形态。
   */
  maBandLow: number;
  maBandHigh: number;
}

export const DEFAULT_SHORT_SCORE_BACKTEST: ShortScoreBacktestParams = {
  buyDelta: 20,
  sellDelta: -15,
  minScore: 60,
  fee: 0.0012,
  limitDays: 240,
  // 冷却期 / 跳空过滤默认关闭：离线回测（与 --cooldown 3 --max-gap 2 对照组比较）显示
  // 两者都会减少交易并降低每笔期望，收益贡献 0.7%→0.4%/股票年，因此不作为默认开关。
  cooldownDays: 0,
  maxGapPct: 0,
  // 低位启动：突变前 3 个评分日都 ≤45（= 启动地板 riseMinScore，起点高于地板就不算低位启动）
  lowBaseDays: 3,
  lowBaseMax: 45,
  trailDrop: 10,
  // 默认仍是跳升口径（与板块回测的信号扫描一致）；
  // 详情页面板可切到 rise：自近 10 日低点抬升 ≥20 分、地板 45 分
  buyMode: 'jump',
  minRise: 20,
  riseRefDays: 10,
  // 抬升观察的评分地板，同时是 rise 口径下「跳升买入」的评分下限。
  // 历史上是 45，但跳升买点实测在 45 分时信号后 3 日 -0.33%/44%，60 分时 +0.25%/48%，
  // 收益贡献从 0.8% 提到 2.8%/股票年（55 分约 3.2%，与 60 分在噪声范围内），
  // 所以默认抬到 60，与经典跳升策略的 minScore 对齐。
  riseMinScore: 60,
  // 均线区间默认关闭（0/0）：打开后只买「短均线之上、长均线之下」的回调位
  maBandLow: 0,
  maBandHigh: 0,
};

/**
 * 图表 / 列表「信号」共用的默认信号参数
 *
 * rise 口径（自低点抬升 + 单日跳升两种启动形态），列表「信号」列、评分曲线上的买卖点标记、
 * 详情页回测面板的默认值都从这里取，避免各处自己拼一份参数导致口径打架。
 */
export const DEFAULT_SHORT_SCORE_SIGNAL_PARAMS: ShortScoreBacktestParams = {
  ...DEFAULT_SHORT_SCORE_BACKTEST,
  buyMode: 'rise',
};

/** 「抬升观察」标记色：橙色（只观察，不再作为买点） */
export const SHORT_SCORE_RISE_BUY_MARK_COLOR = '#fa8c16';
/** 「跳升买入」标记色：粉色 */
export const SHORT_SCORE_JUMP_BUY_MARK_COLOR = '#eb2f96';
/** 「卖出」标记色：亮绿色 */
export const SHORT_SCORE_SELL_MARK_COLOR = '#00e676';

/** 信号种类 -> 标记色（观察 / 空返回空串，表示不标记） */
export function shortScoreSignalColor(kind?: string): string {
  if (kind === '抬升观察') {
    return SHORT_SCORE_RISE_BUY_MARK_COLOR;
  }
  if (kind === '跳升买入') {
    return SHORT_SCORE_JUMP_BUY_MARK_COLOR;
  }
  if (kind === '卖出') {
    return SHORT_SCORE_SELL_MARK_COLOR;
  }
  return '';
}

/** computeShortScoreSignalSeries 的缓存：评分对象 -> 参数签名 -> 信号表（对象变了自然回收） */
const signalSeriesCache = new WeakMap<object, Map<string, Record<string, ShortScoreSignal>>>();

/**
 * 按评分序列逐日判定信号（图表打点用）
 *
 * 第 i 天只用第 i 天及之前的评分判定（与列表「信号」列、回测同一套规则），不会偷看未来数据。
 * 返回 { [YYYYMMDD]: ShortScoreSignal }；评分缺失的交易日不出现在结果里，序列首日无法判定也不出。
 * 计算量：每天都会重跑一次判定，窗口截断到「判定需要的历史长度」，图上一屏（≤240 根）的开销在毫秒级。
 */
export function computeShortScoreSignalSeries(args: {
  scores: Record<string, number>;
  params: ShortScoreBacktestParams;
}): Record<string, ShortScoreSignal> {
  const scores = args.scores || {};
  // 图表每次重建都会调用，按「评分对象 + 参数」做一层缓存，避免同一份数据反复算
  const paramKey = [
    args.params.buyMode,
    args.params.buyDelta,
    args.params.minScore,
    args.params.minRise,
    args.params.riseRefDays,
    args.params.riseMinScore,
    args.params.lowBaseDays,
    args.params.lowBaseMax,
    args.params.sellDelta,
    args.params.trailDrop,
  ].join('|');
  let byParam = signalSeriesCache.get(scores);
  const cached = byParam?.get(paramKey);
  if (cached) {
    return cached;
  }
  if (!byParam) {
    byParam = new Map();
    signalSeriesCache.set(scores, byParam);
  }
  const keys = Object.keys(scores)
    .filter((d) => typeof scores[d] === 'number' && Number.isFinite(scores[d]))
    .sort();
  const out: Record<string, ShortScoreSignal> = {};
  const window = Math.max(30, Math.max(args.params.riseRefDays || 0, args.params.lowBaseDays || 0) + 5);
  for (let i = 1; i < keys.length; i += 1) {
    const start = Math.max(0, i - window);
    const upto: Record<string, number> = {};
    for (let k = start; k <= i; k += 1) {
      upto[keys[k]] = scores[keys[k]];
    }
    out[keys[i]] = evaluateShortScoreSignal({ scores: upto, params: args.params });
  }
  byParam.set(paramKey, out);
  return out;
}

export interface ShortScoreBacktestTrade {
  signalIn: string;
  entryDate: string;
  entryPrice: number;
  scoreIn: number;
  deltaIn: number;
  signalOut: string;
  exitDate: string;
  exitPrice: number;
  scoreOut: number | null;
  deltaOut: number | null;
  exitReason: '绿柱卖出' | '回撤止盈' | '窗口结束';
  /** 持仓期最高评分（回撤止盈的基准） */
  peakScore: number;
  /** 信号日收盘 → 买入日开盘的跳空幅度（%），正=高开 */
  gapIn: number;
  bars: number;
  ret: number;
}

/** 因低位过滤 / 冷却期 / 跳空过滤被放弃的买入信号 */
export interface ShortScoreBacktestSkip {
  /** 信号日 */
  date: string;
  score: number;
  delta: number;
  reason: '非低位启动' | '评分历史不足' | '冷却期' | '跳空高开' | '跳空低开' | '均线区间';
  /** 次日开盘相对信号日收盘的跳空幅度（%），正=高开；未成交时为 0 */
  gap: number;
  /** 非低位启动时：突变前 N 日里的最高评分（便于核对） */
  prevHigh?: number;
}

export interface ShortScoreBacktestStats {
  trades: number;
  winRate: number;
  avgRet: number;
  medianRet: number;
  avgWin: number;
  avgLoss: number;
  payoff: number;
  profitFactor: number;
  sharpe: number;
  avgBars: number;
  cumulative: number;
  maxDrawdown: number;
  exposure: number;
  tradesPerYear: number;
  best: number;
  worst: number;
}

export interface ShortScoreBacktestResult {
  code: string;
  params: ShortScoreBacktestParams;
  windowStart: string;
  windowEnd: string;
  windowBars: number;
  scoreDays: number;
  stats: ShortScoreBacktestStats;
  trades: ShortScoreBacktestTrade[];
  /** 被冷却期 / 跳空过滤拦下的信号，便于核对过滤是否误伤 */
  skips: ShortScoreBacktestSkip[];
  /** 窗口内的评分序列（YYYYMMDD -> 分数），便于核对口径 */
  scores: Record<string, number>;
  /** 窗口内的日K收盘价，便于核对成交价 */
  bars: { date: string; open: number; close: number }[];
}

const dayKey = (d?: string) => String(d || '').replace(/-/g, '').substring(0, 8);
const dayStr = (d?: string) => {
  const k = dayKey(d);
  return k.length === 8 ? `${k.substring(0, 4)}-${k.substring(4, 6)}-${k.substring(6, 8)}` : String(d || '');
};
const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v));

/**
 * 列表「信号」列的取值
 *
 * 只有「跳升买入」是买点。抬升买入已降级为「抬升观察」：
 * 实测（2026-02~11，小盘成长 / 300 只抽样）抬升信号 18 次/股票年、是跳升的 17~21 倍，
 * 单笔期望 -0.07%~-0.19%、盈利因子 0.94~0.98（扣成本后为负），27% 还是连续重复触发，
 * 当买点会把跳升的 +1.5~+2.7%/笔优势稀释到 0 附近。所以只保留标记、不建仓：
 * - 抬升观察：自近 N 日低点累计抬升达标（rise），仅提示，不产生买点
 * - 跳升买入：单日跳升达阈值（jump），唯一的买点
 */
export type ShortScoreSignalKind = '抬升观察' | '跳升买入' | '卖出' | '观察';

export interface ShortScoreSignal {
  kind: ShortScoreSignalKind;
  /** 判定依据（一句话，鼠标悬停展示，便于人工核对） */
  reason: string;
  /** 买入信号按哪套口径成立：rise=自低点抬升 / jump=单日跳升（观察、卖出时为空） */
  via?: 'rise' | 'jump';
}

/** 信号是否为买点（只有「跳升买入」；抬升观察不算） */
export function isBuySignalKind(kind?: string): boolean {
  return kind === '跳升买入';
}

/** 保留一位小数（-0 归零，避免显示 -0.0） */
const f1 = (v: number) => {
  const x = Number(v.toFixed(1));
  return x === 0 ? 0 : x;
};
const round1 = (v: number) => Number(v.toFixed(1));
const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/** 基准日的信号上下文（信号判定与质量评分共用，避免两处各推一遍序列） */
interface SignalContext {
  cur: number;
  prev: number;
  delta: number;
  refDays: number;
  lowRef: number;
  /** 近 refDays 日最高评分（含基准日） */
  highRef: number;
  riseAmt: number;
  dropFromHigh: number;
  /** 基准日之前的评分日（升序） */
  prevDays: string[];
  map: Record<string, number>;
}

function signalContext(
  scores: Record<string, number>,
  params: ShortScoreBacktestParams
): SignalContext | null {
  const map = scores || {};
  const days = Object.keys(map)
    .filter((k) => typeof map[k] === 'number' && Number.isFinite(map[k]))
    .sort();
  if (days.length < 2) {
    return null;
  }
  const cur = map[days[days.length - 1]];
  const prev = map[days[days.length - 2]];
  const refDays = Math.max(1, Math.floor(Number(params.riseRefDays) || 10));
  const prevDays = days.slice(0, days.length - 1);
  const ref = prevDays.slice(-refDays).map((d) => map[d]);
  const lowRef = Math.min(...ref);
  const highRef = Math.max(cur, ...ref);
  return {
    cur,
    prev,
    delta: cur - prev,
    refDays,
    lowRef,
    highRef,
    riseAmt: cur - lowRef,
    dropFromHigh: highRef - cur,
    prevDays,
    map,
  };
}

/**
 * 单日「信号」判定（只看评分序列，不看持仓与K线）
 *
 * 给训练模式下的列表用：每行股票在「基准日」是否满足开仓条件 / 是否出现离场信号。
 * 与 runShortScoreBacktest 共用同一套阈值（buyMode / minRise / riseRefDays / lowBase* /
 * sellDelta / trailDrop），差别只有两点，都是因为这里没有持仓上下文：
 *   1. 回撤止盈的基准取「近 riseRefDays 个评分日的最高分」，不是持仓期最高分；
 *   2. 没有冷却期与跳空过滤（那两项依赖卖出成交日与次日开盘价）。
 * 买入与卖出同时成立时按买入输出（reason 里仍会写明回撤值，便于自己判断）。
 *
 * **只有「跳升买入」是买点**：
 *   - 跳升买入：当日 Δ ≥ buyDelta 且 评分 ≥（rise 口径取 riseMinScore，jump 口径取 minScore），
 *     一根大跳升柱就是启动日本身；
 *   - 抬升观察：近 riseRefDays 日最低分 → 当日评分抬升 ≥ minRise（分几天磨出来的低位启动）。
 *     这一类只做标记、不建仓——实测 18 次/股票年（跳升的十几倍）、单笔期望≈0、
 *     盈利因子 <1，混进买点会把跳升的优势稀释掉，理由见 ShortScoreSignalKind 的注释。
 * 两者同时成立时仍标「跳升买入」（当日确实是跳升柱），reason 里会注明累计抬升也达标。
 */
export function evaluateShortScoreSignal(args: {
  scores: Record<string, number>;
  params: ShortScoreBacktestParams;
}): ShortScoreSignal {
  const p = args.params;
  const ctx = signalContext(args.scores, p);
  if (!ctx) {
    return { kind: '观察', reason: '评分历史不足 2 个交易日' };
  }
  const { cur, delta, lowRef, highRef, riseAmt, dropFromHigh, refDays, prevDays, map } = ctx;

  // ---- 口径一：单日跳升（jump）：Δ 达阈值 + 评分下限 + 低位启动 ----
  const lowBaseHigh = p.lowBaseDays > 0 ? Math.max(...prevDays.slice(-p.lowBaseDays).map((d) => map[d])) : NaN;
  /** 低位上限判定：一律 ≤ lowBaseMax 才算低位（NaN/未启用时放行） */
  const inLowBase = (v: number) => p.lowBaseDays <= 0 || !Number.isFinite(v) || v <= p.lowBaseMax;
  // 跳升口径看「突变前 N 日最高」；并集口径（rise 模式）下，抬升起点在低位同样认，
  // 避免两种口径差一两分时把当天明明已经启动的股票卡成观察
  const jumpLowOk = inLowBase(lowBaseHigh) || (p.buyMode === 'rise' && inLowBase(lowRef));
  /**
   * 跳升分支的评分下限
   *
   * rise 口径下与「抬升」共用同一个绝对地板（riseMinScore），否则会出现
   * 「单日 Δ 明明跳了 20+ 分，却因为评分 58 < 60 被判成抬升」这种自相矛盾的结果。
   * jump 口径仍用 minScore（经典跳升策略的 60 分下限）。
   */
  const jumpMinScore = p.buyMode === 'rise' ? p.riseMinScore : p.minScore;
  let jumpOk = false;
  let jumpReason = '';
  if (delta < p.buyDelta) {
    jumpReason = `单日跳升 ${f1(delta)} < +${p.buyDelta}`;
  } else if (cur < jumpMinScore) {
    jumpReason = `评分 ${f1(cur)} < 下限 ${jumpMinScore}`;
  } else if (!jumpLowOk) {
    jumpReason = `突变前 ${p.lowBaseDays} 日最高 ${f1(lowBaseHigh)} > 低位上限 ${p.lowBaseMax}`;
  } else {
    jumpOk = true;
    jumpReason = `单日跳升 +${f1(delta)}，评分 ${f1(cur)}`;
  }

  // ---- 口径二：自近 N 日低点抬升（rise）：抬升达阈值 + 启动地板 + 抬升起点在低位 ----
  let riseOk = false;
  let riseReason = '';
  if (p.buyMode === 'rise') {
    if (delta < 0) {
      riseReason = `当日回落 ${f1(delta)}（只认仍在抬升的日子）`;
    } else if (riseAmt < p.minRise) {
      riseReason = `自近${refDays}日低点 ${f1(lowRef)} 抬升 +${f1(riseAmt)}（需 ≥${p.minRise}）`;
    } else if (cur < p.riseMinScore) {
      riseReason = `评分 ${f1(cur)} < 启动地板 ${p.riseMinScore}`;
    } else if (p.lowBaseDays > 0 && lowRef > p.lowBaseMax) {
      riseReason = `近${refDays}日最低 ${f1(lowRef)} > 低位上限 ${p.lowBaseMax}（不算低位启动）`;
    } else {
      riseOk = true;
      // 归到「抬升」而不是「跳升」时，把跳升口径卡在哪一条写出来（Δ 没到门槛 / 评分不够 / 起点不低）
      riseReason = `自近${refDays}日低点 ${f1(lowRef)} 抬升 +${f1(riseAmt)}，评分 ${f1(cur)}（未按跳升：${jumpReason}）`;
    }
  }

  let sellOk = false;
  let sellReason = '';
  if (delta <= p.sellDelta) {
    sellOk = true;
    sellReason = `绿柱：单日 ${f1(delta)} ≤ ${p.sellDelta}`;
  } else if (p.trailDrop > 0 && dropFromHigh >= p.trailDrop && delta <= 0) {
    // 回撤止盈只在「当日评分没有继续走高」时才算卖点：
    // 评分还在往上冲（比如 34.2 → 53.4）说明只是还没回到前高，不是走弱，不能给卖出信号
    sellOk = true;
    sellReason = `自近${refDays}日最高 ${f1(highRef)} 回撤 ${f1(dropFromHigh)} 分（≥${p.trailDrop}，当日未走高）`;
  }
  const withSell = (reason: string) => (sellOk ? `${reason}；同时回撤 ${f1(dropFromHigh)} 分` : reason);

  if (p.buyMode === 'jump') {
    if (jumpOk) {
      return { kind: '跳升买入', reason: withSell(jumpReason), via: 'jump' };
    }
  } else if (jumpOk) {
    // 当日就是一根明显的跳升柱：优先标成「跳升买入」（单日怼上去的启动日），
    // 累计抬升同时达标时在 reason 里注明，方便回看是哪一种启动
    return {
      kind: '跳升买入',
      reason: withSell(
        `${jumpReason}（累计抬升 ${f1(riseAmt)} ${riseOk ? `也达标 ≥${p.minRise}` : `未到 ${p.minRise}`}）`
      ),
      via: 'jump',
    };
  } else if (riseOk) {
    // 抬升只作观察：历史回测里这类信号单笔期望≈0、盈利因子<1，当买点只会摊薄收益
    return { kind: '抬升观察', reason: withSell(`仅观察不建仓：${riseReason}`), via: 'rise' };
  }

  if (sellOk) {
    return { kind: '卖出', reason: sellReason };
  }
  // 观察：当日已经是明显的跳升柱却没成立时，把跳升口径的卡点一并写出来（避免只看到「抬升不足」）
  const observeReason =
    p.buyMode === 'jump'
      ? jumpReason
      : delta >= p.buyDelta
        ? `${riseReason}；跳升口径：${jumpReason}`
        : riseReason;
  return { kind: '观察', reason: observeReason };
}

export interface ShortScoreSignalDim {
  key: string;
  label: string;
  score: number;
  max: number;
  /** 该维度的原始计算依据，便于人工核对 */
  detail: string;
}

export interface ShortScoreSignalQuality {
  /** 0~100（按实际参与计算的维度满分归一） */
  total: number;
  grade: 'A' | 'B' | 'C' | 'D';
  dims: ShortScoreSignalDim[];
}

/**
 * 信号质量评分（列表口径）
 *
 * 与板块回测面板的 scoreSignalQuality（8 维）同源同理，但列表里拿不到：
 * 该股自身的历史胜率/期望/盈亏比（要跑单股回测）与板块共振（要统计全表同日触发数），
 * 所以这里只算「这一次信号本身」的 5 个维度，再按满分归一到 0~100：
 *   抬升强度 15 / 评分水平 10 / 低位起点 15 / 量能确认 15 / 位置 20
 * 因此两个分数**不完全可比**：列表分衡量「这一个信号的成色」，面板分还含该股历史表现。
 *
 * 返回 null 表示评分历史不足（无法判定）。
 */
export function scoreShortScoreSignalQuality(args: {
  scores: Record<string, number>;
  params: ShortScoreBacktestParams;
  /** 评分里的量能维度得分（0~30，列表行自带）；拿不到时按中性计 */
  volumeScore?: number | null;
  /** 该信号实际按哪套口径成立（不传时按 params.buyMode）：决定强度 / 低位起点用哪组数 */
  via?: 'rise' | 'jump';
}): ShortScoreSignalQuality | null {
  const p = args.params;
  const ctx = signalContext(args.scores, p);
  if (!ctx) {
    return null;
  }
  const { cur, delta, lowRef, highRef, riseAmt, dropFromHigh, refDays, prevDays, map } = ctx;
  const dims: ShortScoreSignalDim[] = [];
  const useJump = (args.via || (p.buyMode === 'jump' ? 'jump' : 'rise')) === 'jump';
  /** 单日跳升口径的「低位起点」= 突变前 N 日最高分（rise 口径用近 N 日最低分） */
  const jumpBaseHigh =
    p.lowBaseDays > 0 && prevDays.length
      ? Math.max(...prevDays.slice(-p.lowBaseDays).map((d) => map[d]))
      : NaN;

  // 1. 抬升强度 15：超过门槛多少（rise 看抬升幅度，jump 看单日跳升）
  const amount = useJump ? delta : riseAmt;
  const over = amount - (useJump ? p.buyDelta : p.minRise);
  dims.push({
    key: 'strength',
    label: '抬升强度',
    max: 15,
    score: over >= 20 ? 15 : over >= 12 ? 12 : over >= 6 ? 9 : over >= 0 ? 6 : 2,
    detail: `${useJump ? '跳升' : '抬升'} ${f1(amount)}，超出门槛 ${f1(over)} 分`,
  });

  // 2. 评分水平 10
  dims.push({
    key: 'level',
    label: '评分水平',
    max: 10,
    score: cur >= 85 ? 10 : cur >= 75 ? 8 : cur >= 65 ? 6 : 4,
    detail: `评分 ${f1(cur)}`,
  });

  // 3. 低位起点 15：抬升的起点越低，越像「低位启动」而不是高位反抽
  //    jump 口径的起点是「突变前 N 日最高分」，rise 口径是「近 N 日最低分」
  const lowBaseVal = useJump ? jumpBaseHigh : lowRef;
  dims.push({
    key: 'lowBase',
    label: '低位起点',
    max: 15,
    score:
      lowBaseVal <= 15 ? 15 : lowBaseVal <= 25 ? 12 : lowBaseVal <= 30 ? 9 : lowBaseVal <= 35 ? 6 : lowBaseVal <= p.lowBaseMax ? 3 : 0,
    detail: useJump
      ? `突变前 ${p.lowBaseDays} 日最高 ${Number.isFinite(jumpBaseHigh) ? f1(jumpBaseHigh) : '--'}（低位上限 ${p.lowBaseMax}）`
      : `近${refDays}日最低 ${f1(lowRef)}（低位上限 ${p.lowBaseMax}）`,
  });

  // 4. 量能确认 15：用评分里的量能维度（0~30）等比折算
  const volRatio = args.volumeScore == null ? 0.5 : clamp01(Number(args.volumeScore) / 30);
  dims.push({
    key: 'volume',
    label: '量能确认',
    max: 15,
    score: 15 * volRatio,
    detail: args.volumeScore == null ? '量能维度缺失，按中性计' : `量能维度 ${round1(Number(args.volumeScore))}/30`,
  });

  // 5. 位置 20：评分距近 N 日最高回撤 10 分左右最佳
  //    （贴高点=追高，深跌=趋势走坏；与面板「距 60 日高点回撤 15% 最佳」同一思路，这里换成评分口径）
  dims.push({
    key: 'position',
    label: '位置',
    max: 20,
    score: 20 * clamp01(1 - Math.abs(dropFromHigh - 10) / 20),
    detail: `距近${refDays}日最高 ${f1(highRef)} 回撤 ${f1(dropFromHigh)} 分`,
  });

  const maxSum = dims.reduce((a, d) => a + d.max, 0);
  const raw = dims.reduce((a, d) => a + d.score, 0);
  const total = round1((raw / maxSum) * 100);
  return {
    total,
    grade: total >= 80 ? 'A' : total >= 65 ? 'B' : total >= 50 ? 'C' : 'D',
    dims: dims.map((d) => ({ ...d, score: round1(d.score) })),
  };
}

/** 回测：单只股票、单笔持仓、次日开盘成交 */
export function runShortScoreBacktest(args: {
  code: string;
  scores: Record<string, number>;
  klines: Stock.KLineItem[];
  params: ShortScoreBacktestParams;
}): ShortScoreBacktestResult {
  const { code, scores } = args;
  const raw = args.params;
  // 归一化新增过滤参数：缺省（旧调用方/旧导出参数）视为关闭，保持向后兼容
  const params: ShortScoreBacktestParams = {
    ...raw,
    cooldownDays: Math.max(0, Math.min(20, Math.floor(Number(raw.cooldownDays) || 0))),
    maxGapPct: Math.max(0, Math.min(20, Number(raw.maxGapPct) || 0)),
    // 旧调用方 / 旧导出参数没有这三个字段：按 0 处理（关闭），保持向后兼容
    lowBaseDays: Math.max(0, Math.min(60, Math.floor(Number(raw.lowBaseDays) || 0))),
    lowBaseMax: Number.isFinite(Number(raw.lowBaseMax)) ? Number(raw.lowBaseMax) : 40,
    trailDrop: Math.max(0, Number(raw.trailDrop) || 0),
    // 旧调用方没有 rise 相关字段：默认回到 jump 口径，保持行为不变
    buyMode: raw.buyMode === 'rise' ? 'rise' : 'jump',
    minRise: Math.max(0, Number(raw.minRise) || 0),
    riseRefDays: Math.max(1, Math.min(60, Math.floor(Number(raw.riseRefDays) || 10))),
    riseMinScore: Number.isFinite(Number(raw.riseMinScore)) ? Number(raw.riseMinScore) : 60,
    // 均线区间：旧调用方没有这两个字段 → 0/0（关闭），保持行为不变
    maBandLow: Math.max(0, Math.floor(Number(raw.maBandLow) || 0)),
    maBandHigh: Math.max(0, Math.floor(Number(raw.maBandHigh) || 0)),
  };
  // rise 模式必须有抬升阈值，否则退化成「评分 ≥ 地板就买」，信号会爆量
  if (params.buyMode === 'rise' && params.minRise <= 0) {
    params.minRise = 35;
  }
  const limitDays = Math.max(20, Math.min(240, Math.floor(Number(params.limitDays) || 240)));

  // 只取窗口内的日K（升序、去重）
  const all = (args.klines || [])
    .filter((k) => k && k.date && num(k.sp) > 0)
    .map((k) => ({
      key: dayKey(k.date),
      date: dayStr(k.date),
      open: num(k.kp),
      close: num(k.sp),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const scoreKeys = Object.keys(scores || {}).sort();
  const lastScoreKey = scoreKeys[scoreKeys.length - 1] || '';
  const inWindow = all.filter((b) => (!lastScoreKey || b.key <= lastScoreKey) && b.open > 0);
  const window = inWindow.slice(-limitDays);
  // 均线区间要在「窗口之前的历史」上算：只用窗口内K线算，最早几十根会因不足 N 日被判成不通过
  const allCloses = all.map((b) => b.close);
  const allIdxByKey = new Map(all.map((b, i) => [b.key, i]));
  const maBand: MaBand | null =
    params.maBandLow > 0 && params.maBandHigh > params.maBandLow
      ? { low: params.maBandLow, high: params.maBandHigh }
      : null;
  /** 第 i 根窗口K线是否落在均线区间内（数据不足 / 找不到对应K线按不通过） */
  const maBandOk = (i: number) => {
    if (!maBand) {
      return true;
    }
    const idx = allIdxByKey.get(window[i].key);
    return idx === undefined ? false : maBandOkAt(allCloses, idx, maBand) === true;
  };

  const emptyStats: ShortScoreBacktestStats = {
    trades: 0, winRate: 0, avgRet: 0, medianRet: 0, avgWin: 0, avgLoss: 0, payoff: 0,
    profitFactor: 0, sharpe: 0, avgBars: 0, cumulative: 0, maxDrawdown: 0, exposure: 0,
    tradesPerYear: 0, best: 0, worst: 0,
  };

  if (window.length < 30) {
    return {
      code, params,
      windowStart: window[0]?.date || '',
      windowEnd: window[window.length - 1]?.date || '',
      windowBars: window.length,
      scoreDays: 0,
      stats: emptyStats,
      trades: [],
      skips: [],
      scores: {},
      bars: [],
    };
  }

  const scoreOf = (i: number): number | null => {
    const v = scores[window[i].key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const deltaOf = (i: number): number | null => {
    if (i <= 0) return null;
    const cur = scoreOf(i);
    const prev = scoreOf(i - 1);
    if (cur === null || prev === null) return null;
    return cur - prev;
  };

  const trades: ShortScoreBacktestTrade[] = [];
  const skips: ShortScoreBacktestSkip[] = [];
  let pos: {
    signalIdx: number;
    entryIdx: number;
    score: number;
    delta: number;
    gap: number;
    /** 持仓期最高评分（含买入信号日），回撤止盈的基准 */
    peak: number;
  } | null = null;
  /** 上次卖出成交日的窗口索引；冷却期从这一天起算 */
  let lastExitIdx = Number.NEGATIVE_INFINITY;

  /** 突变前 N 个评分日的最高分（数据不足返回 null） */
  const prevHighOf = (i: number, days: number): { high: number } | null => {
    const start = i - days;
    if (start < 0) {
      return null;
    }
    let high = Number.NEGATIVE_INFINITY;
    for (let k = start; k < i; k += 1) {
      const v = scoreOf(k);
      if (v === null) {
        return null;
      }
      high = Math.max(high, v);
    }
    return { high };
  };

  /** rise 模式：近 N 个评分日的最低分（不足 N 日时取可用部分，与离线脚本同口径） */
  const recentLowOf = (i: number, days: number): number | null => {
    const start = Math.max(i - days, 0);
    let low = Number.POSITIVE_INFINITY;
    for (let k = start; k < i; k += 1) {
      const v = scoreOf(k);
      if (v === null) {
        return null;
      }
      low = Math.min(low, v);
    }
    return Number.isFinite(low) ? low : null;
  };

  for (let i = 1; i < window.length - 1; i += 1) {
    const cur = scoreOf(i);
    const delta = deltaOf(i);
    if (cur === null || delta === null) {
      continue;
    }
    if (pos) {
      // 评分从高位阴跌时单日 Δ 往往很小，只靠「单日跳降」会一路坐电梯，
      // 所以按「自持仓期最高点回撤」止盈（与离线脚本 trail_drop 同口径）
      if (cur > pos.peak) {
        pos.peak = cur;
      }
      const drop = pos.peak - cur;
      const hitSellDelta = delta <= params.sellDelta;
      // 回撤止盈要求当日评分没有继续走高：评分还在反弹时只是「离前高还远」，不是走弱，不该卖
      const hitTrail = params.trailDrop > 0 && drop >= params.trailDrop && delta <= 0;
      if (hitSellDelta || hitTrail) {
        const entry = window[pos.entryIdx];
        const exit = window[i + 1];
        const ret = exit.open / entry.open - 1 - params.fee;
        trades.push({
          signalIn: window[pos.signalIdx].date,
          entryDate: entry.date,
          entryPrice: entry.open,
          scoreIn: pos.score,
          deltaIn: Number(pos.delta.toFixed(2)),
          signalOut: window[i].date,
          exitDate: exit.date,
          exitPrice: exit.open,
          scoreOut: Number(cur.toFixed(2)),
          deltaOut: Number(delta.toFixed(2)),
          exitReason: hitSellDelta ? '绿柱卖出' : '回撤止盈',
          peakScore: Number(pos.peak.toFixed(2)),
          gapIn: Number((pos.gap * 100).toFixed(2)),
          bars: i + 1 - pos.entryIdx,
          ret,
        });
        lastExitIdx = i + 1;
        pos = null;
      }
      continue;
    }
    // 买点只有单日跳升一种。历史上 rise 口径按「累计抬升达标 或 单日跳升达标」取并集，
    // 但抬升那一路信号太密（18 次/股票年，是跳升的十几倍）且扣成本后期望≈0，
    // 已降级为列表里的「抬升观察」标记，不再产生交易。
    const lowRef = params.buyMode === 'rise' ? recentLowOf(i, params.riseRefDays) : null;
    // 跳升的评分下限：rise 口径沿用 riseMinScore（与列表「信号」列同一套阈值）
    const jumpMinScore = params.buyMode === 'rise' ? params.riseMinScore : params.minScore;
    const jumpHit = delta >= params.buyDelta && cur >= jumpMinScore;
    // 抬升命中只用于「信号列/图上标记」，不再开仓：实测该形态单笔期望≈0、盈利因子<1，
    // 频率还是跳升的十几倍，并进买点会把跳升的优势完全稀释
    const hitBuy = jumpHit;
    /** 唯一买点就是单日跳升，低位过滤按 jump 口径看突变前 N 日 */
    const viaJump = true;
    if (hitBuy) {
      const signalBar = window[i];
      // 信号日收盘 → 次日开盘的跳空（次日开盘就是成交价）
      const gap = signalBar.close > 0 ? window[i + 1].open / signalBar.close - 1 : 0;
      const gapPct = gap * 100;

      // 均线区间过滤：收盘价要夹在短均线之上、长均线之下（上升中继回调），
      // 站上长均线（追高）或跌破短均线（走坏）都不买
      if (!maBandOk(i)) {
        skips.push({
          date: signalBar.date,
          score: Number(cur.toFixed(2)),
          delta: Number(delta.toFixed(2)),
          reason: '均线区间',
          gap: Number(gapPct.toFixed(2)),
        });
        continue;
      }

      // 低位启动过滤：
      //   rise：抬升的起点（近 N 日最低分）本身要在低位
      //   jump：突变前 N 个评分日都要在低位，排除「高位跌两天后的反抽」；
      //         rise 模式下靠单日跳升成立的信号，抬升起点在低位也算低位启动
      if (params.lowBaseDays > 0) {
        if (!viaJump) {
          if (lowRef !== null && lowRef > params.lowBaseMax) {
            skips.push({
              date: signalBar.date,
              score: Number(cur.toFixed(2)),
              delta: Number(delta.toFixed(2)),
              reason: '非低位启动',
              gap: Number(gapPct.toFixed(2)),
              prevHigh: Number(lowRef.toFixed(2)),
            });
            continue;
          }
        } else {
          const riseLowOk = params.buyMode === 'rise' && lowRef !== null && lowRef <= params.lowBaseMax;
          if (!riseLowOk) {
            const prevHigh = prevHighOf(i, params.lowBaseDays);
            if (!prevHigh) {
              skips.push({
                date: signalBar.date,
                score: Number(cur.toFixed(2)),
                delta: Number(delta.toFixed(2)),
                reason: '评分历史不足',
                gap: Number(gapPct.toFixed(2)),
              });
              continue;
            }
            if (prevHigh.high > params.lowBaseMax) {
              skips.push({
                date: signalBar.date,
                score: Number(cur.toFixed(2)),
                delta: Number(delta.toFixed(2)),
                reason: '非低位启动',
                gap: Number(gapPct.toFixed(2)),
                prevHigh: Number(prevHigh.high.toFixed(2)),
              });
              continue;
            }
          }
        }
      }

      if (params.cooldownDays > 0 && i - lastExitIdx <= params.cooldownDays) {
        skips.push({
          date: signalBar.date,
          score: Number(cur.toFixed(2)),
          delta: Number(delta.toFixed(2)),
          reason: '冷却期',
          gap: Number(gapPct.toFixed(2)),
        });
        continue;
      }
      if (params.maxGapPct > 0 && Math.abs(gapPct) > params.maxGapPct) {
        skips.push({
          date: signalBar.date,
          score: Number(cur.toFixed(2)),
          delta: Number(delta.toFixed(2)),
          reason: gapPct > 0 ? '跳空高开' : '跳空低开',
          gap: Number(gapPct.toFixed(2)),
        });
        continue;
      }
      pos = { signalIdx: i, entryIdx: i + 1, score: cur, delta, gap, peak: cur };
    }
  }

  // 窗口结束仍持仓：按最后一根收盘价强平
  if (pos) {
    const entry = window[pos.entryIdx];
    const last = window[window.length - 1];
    const ret = last.close / entry.open - 1 - params.fee;
    trades.push({
      signalIn: window[pos.signalIdx].date,
      entryDate: entry.date,
      entryPrice: entry.open,
      scoreIn: pos.score,
      deltaIn: Number(pos.delta.toFixed(2)),
      signalOut: '',
      exitDate: last.date,
      exitPrice: last.close,
      scoreOut: scoreOf(window.length - 1),
      deltaOut: deltaOf(window.length - 1),
      exitReason: '窗口结束',
      peakScore: Number(pos.peak.toFixed(2)),
      gapIn: Number((pos.gap * 100).toFixed(2)),
      bars: window.length - 1 - pos.entryIdx,
      ret,
    });
  }

  // ---- 统计 ----
  const rets = trades.map((t) => t.ret);
  const wins = rets.filter((r) => r > 0);
  const losses = rets.filter((r) => r <= 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const median = (xs: number[]) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const std = (xs: number[]) => {
    if (xs.length < 2) return 0;
    const mu = mean(xs);
    return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1));
  };

  const years = window.length / 252;
  const tradesPerYear = years > 0 ? trades.length / years : 0;
  const sd = std(rets);
  const holdingBars = trades.reduce((a, t) => a + Math.max(1, t.bars), 0);

  // 权益曲线（单笔顺序复利）→ 累计收益 / 最大回撤
  let equity = 1;
  let peak = 1;
  let maxDD = 0;
  trades.forEach((t) => {
    equity *= 1 + t.ret;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, 1 - equity / peak);
  });

  const avgWin = mean(wins);
  const avgLoss = mean(losses);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));

  const stats: ShortScoreBacktestStats = {
    trades: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    avgRet: mean(rets),
    medianRet: median(rets),
    avgWin,
    avgLoss,
    payoff: losses.length && avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : wins.length ? Infinity : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    sharpe: sd > 0 && tradesPerYear > 0 ? (mean(rets) / sd) * Math.sqrt(tradesPerYear) : 0,
    avgBars: trades.length ? mean(trades.map((t) => t.bars)) : 0,
    cumulative: equity - 1,
    maxDrawdown: maxDD,
    exposure: window.length ? holdingBars / window.length : 0,
    tradesPerYear,
    best: rets.length ? Math.max(...rets) : 0,
    worst: rets.length ? Math.min(...rets) : 0,
  };

  const winScores: Record<string, number> = {};
  window.forEach((b) => {
    const v = scores[b.key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      winScores[b.key] = Number(v.toFixed(2));
    }
  });

  return {
    code,
    params,
    windowStart: window[0].date,
    windowEnd: window[window.length - 1].date,
    windowBars: window.length,
    scoreDays: Object.keys(winScores).length,
    stats,
    trades: trades.map((t) => ({ ...t, ret: Number(t.ret.toFixed(6)) })),
    skips,
    scores: winScores,
    bars: window.map((b) => ({ date: b.date, open: Number(b.open.toFixed(3)), close: Number(b.close.toFixed(3)) })),
  };
}
