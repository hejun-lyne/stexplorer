import { Stock } from '@/types/stock';
import { calculateRSI } from './tech';

// ==================== 短线综合评分（大盘/板块/个股） ====================
//
// 用途：短线交易参考。整体评分 = 个股(50%) > 板块(30%) > 大盘(20%)。
// 本模块为纯计算函数集合，不做任何 IO，输入数据由调用方（组件/回测）准备。

/** 涨跌比接口返回的单日数据 */
export interface UpRatioDayData {
  up_in_total?: number; // 上涨家数占比
  up_count?: number;
  down_count?: number;
  total_count?: number;
  error?: string;
  [key: string]: any;
}

export type UpRatioMap = Record<string, UpRatioDayData>;

/** 后端 get_market_activity_stats 返回的市值档统计 */
export interface MarketTierStat {
  count: number;
  avg_amount: number; // 平均成交额（元）
  median_amount: number; // 成交额中位数（元）
  avg_turnover: number; // 平均换手率(%)
}

export interface MarketActivityStats {
  date: string;
  tiers: {
    small?: MarketTierStat; // 流通市值 < 50亿
    mid?: MarketTierStat; // 50亿 ~ 200亿
    large?: MarketTierStat; // > 200亿
  };
  [key: string]: any;
}

// ==================== 配置 ====================

export const SHORT_TERM_SCORE_CONFIG = {
  // ---- 大盘维度 ----
  marketDays: 10, // 统计最近交易日数
  marketUpRatioThreshold: 0.5, // 上涨家数占比阈值（>0.5 视为市场偏强）
  marketDecay: 0.85, // 时间衰减系数（越近权重越高，半衰期约4~5日）
  marketMinValidDays: 3, // 至少有效天数，否则该维度不可用
  // ---- 板块维度 ----
  sectorDays: 20, // 板块趋势判断窗口
  sectorCompareDays: 10, // 个股与板块区间对比窗口
  sectorNoNewLowDays: 3, // 企稳判定：连续N日不创新低
  // ---- 个股-量能 ----
  mvSmallBound: 50e8, // 小盘上限（元）
  mvMidBound: 200e8, // 中盘上限（元）
  // ---- 个股-RSI ----
  rsiShort: 6,
  rsiLong: 24,
  rsiOverbought: 80, // RSI6 绝对超买阈值
  rsiOversold: 30, // RSI6 绝对超卖阈值
  rsiOverboughtPercentile: 0.85, // RSI6 历史分位超买阈值
  rsiExtremeSpread: 10, // 超买/超卖确认：RSI6 与 RSI24 差值绝对值下限
  // ---- 个股-资金 ----
  moneyWindow: 20, // 主力/散户累计净流入窗口（日）
  moneyShapeDays: 30, // 微笑/悲伤曲线形态识别窗口（日）
  moneyCrossRecentDays: 5, // 交叉检测窗口（日）
  moneyCrossDecay: 0.8, // 交叉时效衰减系数：刚交叉 1.0，每过一日乘一次（3日后约 0.5）
  // ---- 综合权重 ----
  weights: { stock: 0.5, sector: 0.3, market: 0.2 },
  vetoThreshold: 40, // 个股得分低于该值触发一票否决
  vetoCap: 55, // 一票否决后的总分上限
};

type ScoreConfig = typeof SHORT_TERM_SCORE_CONFIG;

// ==================== 工具函数 ====================

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** 日期统一为 YYYYMMDD（作为涨跌比 map 的 key） */
export const toDateKey = (date: string) => date.replace(/-/g, '');

const mean = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

/** 滚动 N 日求和（与 MoneyFlowChart 同口径），前 windowSize-1 位为 null */
function rollingSum(arr: number[], windowSize: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < windowSize - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - windowSize + 1; j <= i; j++) {
        sum += arr[j] || 0;
      }
      result.push(sum);
    }
  }
  return result;
}

/** 区间涨幅(%)：last 相对 baseIndex 前一日的涨幅 */
function rangeChange(closes: number[], days: number): number | null {
  if (closes.length < days + 1) return null;
  const base = closes[closes.length - 1 - days];
  const last = closes[closes.length - 1];
  if (!base) return null;
  return (last / base - 1) * 100;
}

// ==================== 大盘表现评分 ====================

export interface MarketDailyScore {
  date: string;
  upRatio: number | null; // 上涨家数占比
  stockZdf: number; // 个股当日涨幅(%)
  indexZdf: number | null; // 对比基准当日涨幅(%)（同类市值风格板块，缺失时为所属指数）
  score: number | null; // 当日得分 0~100
  note: string;
}

export interface MarketScoreResult {
  available: boolean;
  reason?: string;
  score: number; // 0~100 加权平均
  daily: MarketDailyScore[];
}

/**
 * 大盘表现评分：按每日涨跌比（上涨家数占比）判断市场强弱，
 * 再结合个股当日涨跌与对比基准（同类市值风格板块：大盘股/中盘股/小盘股/微盘股，缺失时回退所属指数）
 * 的相对表现打分，最后做时间衰减加权平均。
 */
export function scoreMarket(
  stockKlines: Stock.KLineItem[],
  baselineKlines: Stock.KLineItem[] | null | undefined,
  upRatioMap: UpRatioMap | null | undefined,
  cfg: ScoreConfig = SHORT_TERM_SCORE_CONFIG,
): MarketScoreResult {
  const empty: MarketScoreResult = { available: false, score: 0, daily: [] };
  if (!stockKlines || stockKlines.length < cfg.marketMinValidDays) {
    return { ...empty, reason: '个股K线数据不足' };
  }
  const indexMap = new Map<string, Stock.KLineItem>();
  (baselineKlines || []).forEach((k) => indexMap.set(k.date, k));

  const tail = stockKlines.slice(-cfg.marketDays);
  const daily: MarketDailyScore[] = [];
  let weighted = 0;
  let wsum = 0;

  tail.forEach((k, idx) => {
    const age = tail.length - 1 - idx;
    const w = Math.pow(cfg.marketDecay, age);
    const ik = indexMap.get(k.date);
    const ratioRaw = upRatioMap ? upRatioMap[toDateKey(k.date)] : undefined;
    let upRatio: number | null = null;
    if (ratioRaw && !ratioRaw.error) {
      if (typeof ratioRaw.up_in_total === 'number' && ratioRaw.up_in_total <= 1) {
        upRatio = ratioRaw.up_in_total;
      } else if (ratioRaw.up_count && ratioRaw.total_count) {
        upRatio = ratioRaw.up_count / ratioRaw.total_count;
      }
    }
    const s = k.zdf;
    if (!ik || upRatio === null) {
      daily.push({ date: k.date, upRatio, stockZdf: s, indexZdf: ik ? ik.zdf : null, score: null, note: '数据缺失' });
      return;
    }
    const i = ik.zdf;
    const d = s - i;
    let score: number;
    let note: string;
    if (upRatio >= cfg.marketUpRatioThreshold) {
      // 市场偏强（普涨）
      if (s < 0) {
        score = 30 - Math.min(Math.abs(s), 5) * 3;
        note = '市场偏强但个股收跌';
      } else {
        score = 50 + 10 * Math.tanh(d / 2);
        note = d >= 0 ? '普涨日跑赢基准' : '普涨日弱于基准';
      }
    } else {
      // 市场偏弱（普跌）
      if (s > 0) {
        score = 80 + 8 * Math.tanh(s / 3);
        note = '弱市上涨，超预期';
      } else {
        score = 35 + 12 * Math.tanh(d / 2);
        note = d >= 0 ? '弱市抗跌' : '弱市补跌';
      }
    }
    score = clamp(score, 0, 100);
    weighted += score * w;
    wsum += w;
    daily.push({ date: k.date, upRatio, stockZdf: s, indexZdf: i, score, note });
  });

  const validCount = daily.filter((d) => d.score !== null).length;
  if (wsum <= 0 || validCount < cfg.marketMinValidDays) {
    return { ...empty, daily, reason: '涨跌比/指数数据不足' };
  }
  return { available: true, score: weighted / wsum, daily };
}

// ==================== 板块表现评分 ====================

export type SectorTrendType = 'up' | 'bounce' | 'down' | 'flat';
export type SectorRelation = 'sync' | 'positive-divergence' | 'negative-divergence';

export interface SectorScoreResult {
  available: boolean;
  reason?: string;
  score: number; // 0~100
  boardName: string;
  trendType: SectorTrendType;
  trendDesc: string;
  relation: SectorRelation;
  relationDesc: string;
  boardZdf: number; // 板块区间涨幅(%)（对比窗口）
  stockZdf: number; // 个股区间涨幅(%)（对比窗口）
  diff: number; // 个股 - 板块
}

const TREND_BASE: Record<SectorTrendType, number> = { up: 70, bounce: 55, flat: 45, down: 30 };
const TREND_DESC: Record<SectorTrendType, string> = {
  up: '板块短期上升趋势',
  bounce: '板块下跌后反弹',
  down: '板块持续下跌',
  flat: '板块横盘震荡',
};
const RELATION_DESC: Record<SectorRelation, string> = {
  sync: '个股与板块趋同',
  'positive-divergence': '正向背离（板块弱、个股强）',
  'negative-divergence': '负向背离（板块强、个股弱）',
};

/**
 * 板块表现评分：先判定板块短期趋势（上升 > 下跌反弹 > 持续下跌），
 * 再看个股与板块的趋同/背离关系及区间涨幅差值做修正。
 */
export function scoreSector(
  stockKlines: Stock.KLineItem[],
  boardKlines: Stock.KLineItem[] | null | undefined,
  boardName: string,
  cfg: ScoreConfig = SHORT_TERM_SCORE_CONFIG,
): SectorScoreResult {
  const empty: SectorScoreResult = {
    available: false,
    score: 0,
    boardName,
    trendType: 'flat',
    trendDesc: '',
    relation: 'sync',
    relationDesc: '',
    boardZdf: 0,
    stockZdf: 0,
    diff: 0,
  };
  if (!boardKlines || boardKlines.length < cfg.sectorDays + 1) {
    return { ...empty, reason: '板块K线数据不足' };
  }
  if (!stockKlines || stockKlines.length < cfg.sectorCompareDays + 1) {
    return { ...empty, reason: '个股K线数据不足' };
  }

  // ---- 板块短期趋势 ----
  const bCloses = boardKlines.map((k) => k.sp);
  const bWin = bCloses.slice(-(cfg.sectorDays + 1));
  const ret20 = rangeChange(bCloses, cfg.sectorDays) ?? 0;
  const ret5 = rangeChange(bCloses, 5) ?? 0;
  const ma5 = mean(bCloses.slice(-5));
  const ma10 = mean(bCloses.slice(-10));
  const ma5Prev = mean(bCloses.slice(-8, -3));
  const high10 = Math.max(...bCloses.slice(-10));
  const highPrev10 = Math.max(...bCloses.slice(-20, -10));
  const high20 = Math.max(...bWin);
  const drawdown = (bCloses[bCloses.length - 1] / high20 - 1) * 100;

  // 前期存在明显下跌
  const priorDecline = ret20 < -5 || drawdown < -5;
  // 企稳判定：以窗口内最低收盘为阶段低点，从低点往后数
  const bWinCloses = bCloses.slice(-(cfg.sectorDays + 1));
  let lowIdx = 0;
  bWinCloses.forEach((c, i) => {
    if (c <= bWinCloses[lowIdx]) lowIdx = i; // 取最近一次最低点
  });
  const daysSinceLow = bWinCloses.length - 1 - lowIdx; // 低点距今天数
  // 底分型：低点出现在 2 日及以前，且此后收盘逐步回升、未再创新低
  const afterLow = bWinCloses.slice(lowIdx + 1);
  const bottomFractal =
    daysSinceLow >= 2 && afterLow[afterLow.length - 1] > bWinCloses[lowIdx] &&
    afterLow.every((c, i) => i === 0 || c >= afterLow[i - 1]);
  // 连续 N 日不创新低（更强的企稳确认）
  const noNewLow = daysSinceLow >= cfg.sectorNoNewLowDays || bottomFractal;

  let trendType: SectorTrendType;
  let trendDesc: string;
  if (ret20 > 3 && ma5 > ma10 && high10 >= highPrev10) {
    trendType = 'up';
    trendDesc = TREND_DESC.up;
  } else if (drawdown < -8 && ret5 > 2 && ma5 > ma5Prev) {
    trendType = 'bounce';
    trendDesc = '板块超跌反弹';
  } else if (priorDecline && noNewLow) {
    // 下跌后企稳：出现底分型或连续 N 日不创新低，不再判定为持续下跌
    trendType = 'bounce';
    trendDesc = bottomFractal ? '板块下跌后企稳（出现底分型）' : `板块下跌后企稳（连续${cfg.sectorNoNewLowDays}日未创新低）`;
  } else if (ret20 < 0 && ma5 < ma10) {
    trendType = 'down';
    trendDesc = TREND_DESC.down;
  } else {
    trendType = 'flat';
    trendDesc = TREND_DESC.flat;
  }

  // ---- 个股与板块关系 ----
  const sCloses = stockKlines.map((k) => k.sp);
  const bZdf = rangeChange(bCloses, cfg.sectorCompareDays) ?? 0;
  const sZdf = rangeChange(sCloses, cfg.sectorCompareDays) ?? 0;
  const diff = sZdf - bZdf;

  let relation: SectorRelation;
  if (sZdf >= 0 && bZdf >= 0) {
    relation = 'sync';
  } else if (sZdf < 0 && bZdf < 0) {
    relation = 'sync';
  } else if (sZdf > 0 && bZdf < 0) {
    relation = 'positive-divergence';
  } else {
    relation = 'negative-divergence';
  }

  let modifier: number;
  if (relation === 'sync') {
    // 趋同：按区间涨幅差值打分，强于板块加分、弱于板块减分
    modifier = clamp(diff * 4, -25, 25);
  } else if (relation === 'positive-divergence') {
    // 正向背离：板块弱个股强，独立行情，高分
    modifier = clamp(20 + diff * 1.5, 10, 30);
  } else {
    // 负向背离：板块强个股弱，最弱形态
    modifier = clamp(-18 + diff * 1.5, -30, -12);
  }

  return {
    available: true,
    score: clamp(TREND_BASE[trendType] + modifier, 0, 100),
    boardName,
    trendType,
    trendDesc,
    relation,
    relationDesc: RELATION_DESC[relation],
    boardZdf: bZdf,
    stockZdf: sZdf,
    diff,
  };
}

// ==================== 个股-量能活跃度 ====================

export interface VolumeScoreResult {
  score: number; // 0~35
  max: number;
  available: boolean;
  note: string;
  ratio?: number; // 5日均成交额 / 同类市值平均
  volTrend?: number; // 5日均量 / 20日均量
  zdf5?: number; // 近5日累计涨幅
  degraded?: string; // 降级说明（无同类数据时）
}

/** 根据流通市值(元)选择市值档 */
export function pickMarketTier(circMv: number | null | undefined, cfg: ScoreConfig = SHORT_TERM_SCORE_CONFIG): keyof MarketActivityStats['tiers'] {
  if (!circMv || circMv <= 0) return 'mid';
  if (circMv < cfg.mvSmallBound) return 'small';
  if (circMv < cfg.mvMidBound) return 'mid';
  return 'large';
}

/**
 * 量能活跃度：横向（相比同类市值股票平均成交额）+ 纵向（自身量能趋势，量价配合）。
 */
export function scoreStockVolume(
  stockKlines: Stock.KLineItem[],
  stats: MarketActivityStats | null | undefined,
  circMv: number | null | undefined,
  cfg: ScoreConfig = SHORT_TERM_SCORE_CONFIG,
): VolumeScoreResult {
  const max = 35;
  if (!stockKlines || stockKlines.length < 25) {
    return { score: 0, max, available: false, note: 'K线数据不足' };
  }
  const cjes = stockKlines.map((k) => k.cje);
  const cjls = stockKlines.map((k) => k.cjl);
  const avgAmount5 = mean(cjes.slice(-5));
  const avgVol5 = mean(cjls.slice(-5));
  const avgVol20 = mean(cjls.slice(-20));
  const volTrend = avgVol20 > 0 ? avgVol5 / avgVol20 : 1;
  const zdf5 = stockKlines.slice(-5).reduce((a, k) => a + k.zdf, 0);

  const tier = pickMarketTier(circMv, cfg);
  const tierStat = stats?.tiers?.[tier];

  // 纵向：自身量能趋势 + 量价配合（最多 40% 权重 + 奖惩）
  let vScore = max * 0.4 * clamp((volTrend - 0.7) / 0.8, 0, 1);
  if (volTrend >= 1.2 && zdf5 > 0) vScore += 5; // 放量上涨
  if (volTrend <= 0.8 && zdf5 < 0) vScore -= 5; // 缩量下跌
  vScore = clamp(vScore, 0, max * 0.4 + 5);

  if (tierStat && tierStat.avg_amount > 0) {
    // 横向：相比同类市值股票平均成交额
    const ratio = avgAmount5 / tierStat.avg_amount;
    const hScore = max * 0.6 * clamp((ratio - 0.5) / 1.5, 0, 1);
    const ratioDesc = ratio >= 2 ? '显著活跃' : ratio >= 1.2 ? '较为活跃' : ratio >= 0.7 ? '中等' : '清淡';
    return {
      score: clamp(hScore + vScore, 0, max),
      max,
      available: true,
      note: `同类市值成交${ratioDesc}（5日均额为同类${ratio.toFixed(2)}倍），量能${volTrend >= 1.2 ? '放大' : volTrend >= 0.9 ? '持平' : '萎缩'}（${volTrend.toFixed(2)}倍）`,
      ratio,
      volTrend,
      zdf5,
    };
  }

  // 降级：无同类市值数据，仅用自身量能趋势
  return {
    score: clamp(max * clamp((volTrend - 0.7) / 0.9, 0, 1) + (volTrend >= 1.2 && zdf5 > 0 ? 5 : 0), 0, max),
    max,
    available: true,
    degraded: '无同类市值统计数据，仅按自身量能趋势评分',
    note: `量能${volTrend >= 1.2 ? '放大' : volTrend >= 0.9 ? '持平' : '萎缩'}（${volTrend.toFixed(2)}倍）`,
    volTrend,
    zdf5,
  };
}

// ==================== 个股-RSI 指标 ====================

export interface RsiScoreResult {
  score: number; // 0~30
  max: number;
  available: boolean;
  pattern: string; // 命中情形
  rsi6: number;
  rsi24: number;
  rsi6Percentile: number; // RSI6 历史分位 0~1
}

/**
 * RSI(6/24) 指标评分：
 * 最佳为超买后6日线回踩24日线企稳；其次为超卖后6日线上穿24日线；
 * 应避免持续超买钝化与死叉。
 */
export function scoreStockRsi(
  stockKlines: Stock.KLineItem[],
  cfg: ScoreConfig = SHORT_TERM_SCORE_CONFIG,
): RsiScoreResult {
  const max = 30;
  const empty: RsiScoreResult = { score: 0, max, available: false, pattern: '', rsi6: 0, rsi24: 0, rsi6Percentile: 0 };
  if (!stockKlines || stockKlines.length < cfg.rsiLong + 30) {
    return { ...empty, pattern: 'K线数据不足' };
  }
  const closes = stockKlines.map((k) => k.sp);
  const rsi6s = calculateRSI(closes, cfg.rsiShort);
  const rsi24s = calculateRSI(closes, cfg.rsiLong);

  const start = cfg.rsiLong + 5; // 跳过 RSI24 预热期
  const n = closes.length;
  const rsi6 = rsi6s[n - 1];
  const rsi24 = rsi24s[n - 1];
  const spread = rsi6 - rsi24;

  // RSI6 历史分位（可用历史内）
  const hist = rsi6s.slice(start);
  const rsi6Percentile = hist.length ? hist.filter((v) => v < rsi6).length / hist.length : 0.5;

  // ---- 情形识别（按时间序：以最近一次极值事件为准，避免被更早的旧信号霸占判定）----
  const s20 = Math.max(start, n - 20);
  const rsi6Win = rsi6s.slice(s20);
  const peak20 = Math.max(...rsi6Win);
  const trough20 = Math.min(...rsi6Win);
  // 最近一次峰值/谷值位置（各自取最近一次出现）
  const idxPeak = s20 + rsi6Win.lastIndexOf(peak20);
  const idxTrough = s20 + rsi6Win.lastIndexOf(trough20);
  // 超买/超卖确认：除 RSI6 绝对值（或高分位）外，极值当日还须与 24 日线拉开明显差值（|RSI6-RSI24| ≥ rsiExtremeSpread），
  // 单纯 RSI6 绝对值低/高但与 24 日线贴合的，属于正常波动而非超买/超卖状态
  const spreadAt = (i: number) => rsi6s[i] - rsi24s[i];
  const peakSpread = spreadAt(idxPeak);
  const troughSpread = spreadAt(idxTrough);
  // 近20日内 RSI6 曾真正超买：绝对值口径为主；
  // 高分位口径须绝对值 >= 65，避免长期弱势股历史分位失真（整段历史偏低，刚反弹上50就成"高分位"被误判超买）
  const overboughtRecent =
    (peak20 > cfg.rsiOverbought ||
      (peak20 > 65 && hist.filter((x) => x < peak20).length / hist.length > cfg.rsiOverboughtPercentile)) &&
    peakSpread > cfg.rsiExtremeSpread;
  // 近20日内 RSI6 曾真正超卖：绝对值 + 与24日线差值双重确认
  const oversoldRecent = trough20 < cfg.rsiOversold && troughSpread < -cfg.rsiExtremeSpread;
  // 最近一次极值是超买峰值（超卖反弹后又冲高），还是超卖谷底
  const lastExtremeIsPeak = idxPeak > idxTrough;

  // 超买后回踩：最近极值为超买峰值，6日线已从峰值回落、贴近24日线
  const pullback =
    overboughtRecent &&
    lastExtremeIsPeak &&
    spread < 5 &&
    spread > -3 &&
    rsi6 < peak20 - 5 && // 已从峰值明显回落
    rsi6 < cfg.rsiOverbought + 10;
  // 回踩后已拐头企稳（当日 RSI6 不再下行）
  const pullbackStabilized = pullback && rsi6s[n - 1] >= rsi6s[n - 2];

  // 超卖后金叉：近10日内 RSI6 上穿 RSI24，且穿越前 RSI6 曾超卖；
  // 若金叉发生在最近一次超买峰值之前（其后又冲高回落），则旧金叉失效，形态已演进为"超买后回落"
  let oversoldCross = false;
  for (let i = Math.max(start + 1, n - 10); i < n; i++) {
    if (rsi6s[i - 1] <= rsi24s[i - 1] && rsi6s[i] > rsi24s[i]) {
      const bStart = Math.max(start, i - 10);
      const before = rsi6s.slice(bStart, i + 1);
      // 穿越前曾真正超卖：绝对值 + 与24日线差值双重确认
      const oversoldBefore = before.some((v, j) => v < cfg.rsiOversold && spreadAt(bStart + j) < -cfg.rsiExtremeSpread);
      if (oversoldBefore && !(overboughtRecent && idxPeak > i)) {
        oversoldCross = true;
      }
      break;
    }
  }

  // 近5日死叉
  let deadCross = false;
  for (let i = Math.max(start + 1, n - 5); i < n; i++) {
    if (rsi6s[i - 1] >= rsi24s[i - 1] && rsi6s[i] < rsi24s[i]) {
      deadCross = true;
      break;
    }
  }

  // 持续超买钝化：连续5日 RSI6 > 80 且与24日线差值大
  const last5 = rsi6s.slice(-5);
  const persistentOverbought = last5.every((v) => v > cfg.rsiOverbought) && spread > 15;

  let score: number;
  let pattern: string;
  if (pullbackStabilized) {
    score = 30;
    pattern = '超买后回踩24日线企稳（最佳买点）';
  } else if (pullback) {
    score = 26;
    pattern = '超买后回落，6日线临近24日线（回踩中）';
  } else if (oversoldCross) {
    score = 26;
    pattern = '超卖后6日线上穿24日线（金叉）';
  } else if (!lastExtremeIsPeak && oversoldRecent && rsi6 < rsi24 && rsi6 >= rsi6s[n - 2] && rsi6 - trough20 > 5) {
    // 超卖后反弹修复中：RSI6 已显著脱离超卖谷底且当日回升，但尚未上穿24日线
    score = 18;
    pattern = '超卖后反弹修复中（尚未金叉）';
  } else if (deadCross) {
    score = 6;
    pattern = '近期6日线下穿24日线（死叉）';
  } else if (persistentOverbought) {
    score = 8;
    pattern = '持续超买钝化，追高风险大';
  } else if (rsi6 > rsi24) {
    score = 20;
    pattern = 'RSI多头排列，处于强势区';
  } else {
    score = 10;
    pattern = 'RSI空头排列，处于弱势区';
  }

  return { score, max, available: true, pattern, rsi6, rsi24, rsi6Percentile };
}

// ==================== 个股-资金指标 ====================

export type MoneyShape = 'smile' | 'sad' | 'flat' | 'unknown';

export interface MoneyScoreResult {
  score: number; // 0~35
  max: number;
  available: boolean;
  shape: MoneyShape;
  shapeDesc: string;
  cross: 'up' | 'down' | null; // 近期主力线上穿/下穿散户线
  crossDaysAgo: number | null;
  aboveZero: boolean; // 主力20日累计线是否在0轴上方
  main20: number; // 最新主力20日累计净流入（元）
  retail20: number; // 最新散户20日累计净流入（元）
  note: string;
}

const SHAPE_DESC: Record<MoneyShape, string> = {
  smile: '主力线走出微笑曲线（U型）',
  sad: '主力线走出悲伤曲线（倒U型）',
  flat: '主力线走势平缓',
  unknown: '形态不明',
};

/**
 * 资金指标（20日）：基于主力/散户 N 日累计净流入曲线识别形态。
 * 最佳：主力微笑曲线上穿散户线且在0轴上方；最差：悲伤曲线向下穿越散户线且在0轴下方。
 */
export function scoreStockMoney(
  detailMain: number[] | null | undefined,
  detailRetail: number[] | null | undefined,
  cfg: ScoreConfig = SHORT_TERM_SCORE_CONFIG,
): MoneyScoreResult {
  const max = 35;
  const empty: MoneyScoreResult = {
    score: 0,
    max,
    available: false,
    shape: 'unknown',
    shapeDesc: '',
    cross: null,
    crossDaysAgo: null,
    aboveZero: false,
    main20: 0,
    retail20: 0,
    note: '资金流向数据不足',
  };
  const mainArr = detailMain || [];
  const retailArr = detailRetail || [];
  const len = Math.min(mainArr.length, retailArr.length);
  if (len < cfg.moneyWindow + cfg.moneyShapeDays) {
    return empty;
  }
  const main20 = rollingSum(mainArr.slice(0, len), cfg.moneyWindow);
  const retail20 = rollingSum(retailArr.slice(0, len), cfg.moneyWindow);

  // 有效区间（两者都非 null）
  const validIdx: number[] = [];
  for (let i = 0; i < len; i++) {
    if (main20[i] !== null && retail20[i] !== null) validIdx.push(i);
  }
  if (validIdx.length < cfg.moneyShapeDays) {
    return empty;
  }
  const mainSeries = validIdx.map((i) => main20[i] as number);
  const retailSeries = validIdx.map((i) => retail20[i] as number);
  const last = mainSeries.length - 1;
  const mainLast = mainSeries[last];
  const retailLast = retailSeries[last];
  const aboveZero = mainLast > 0;

  // ---- 形态识别（近 moneyShapeDays 日的 U 型 / 倒U 型）----
  const shapeWin = mainSeries.slice(-cfg.moneyShapeDays);
  const mid = Math.floor(shapeWin.length / 2);
  const magnitude = Math.max(...shapeWin.map((v) => Math.abs(v)), 1);
  const s1 = shapeWin[mid] - shapeWin[0];
  const s2 = shapeWin[shapeWin.length - 1] - shapeWin[mid];
  const threshold = magnitude * 0.08;
  let shape: MoneyShape;
  if (s1 < -threshold && s2 > threshold) {
    shape = 'smile';
  } else if (s1 > threshold && s2 < -threshold) {
    shape = 'sad';
  } else if (Math.abs(s1) <= threshold * 2 && Math.abs(s2) <= threshold * 2) {
    shape = 'flat';
  } else {
    shape = 'unknown';
  }

  // ---- 近期交叉检测 ----
  let cross: 'up' | 'down' | null = null;
  let crossDaysAgo: number | null = null;
  for (let i = last; i > Math.max(0, last - cfg.moneyCrossRecentDays); i--) {
    if (mainSeries[i - 1] <= retailSeries[i - 1] && mainSeries[i] > retailSeries[i]) {
      cross = 'up';
      crossDaysAgo = last - i;
      break;
    }
    if (mainSeries[i - 1] >= retailSeries[i - 1] && mainSeries[i] < retailSeries[i]) {
      cross = 'down';
      crossDaysAgo = last - i;
      break;
    }
  }

  // ---- 评分 ----
  // 交叉时效系数：刚交叉 1.0，每过一日乘一次衰减（3日后约 0.5，越新鲜越有效）
  const upFresh = cross === 'up' && crossDaysAgo !== null ? Math.pow(cfg.moneyCrossDecay, crossDaysAgo) : 0;
  const downFresh = cross === 'down' && crossDaysAgo !== null ? Math.pow(cfg.moneyCrossDecay, crossDaysAgo) : 0;
  const ageDesc = cross ? (crossDaysAgo === 0 ? '当日' : `${crossDaysAgo}日前`) : '';

  let score: number;
  let note: string;
  if (shape === 'smile' && cross === 'up') {
    // 微笑曲线金叉：越新鲜越强，随时间衰减回落到形态分（18）
    score = 18 + (aboveZero ? 12 : 4) * upFresh;
    note = `微笑曲线${ageDesc}上穿散户线${aboveZero ? '且在0轴上方' : '，尚未站上0轴'}`;
  } else if (aboveZero && mainLast > retailLast) {
    score = 24 + 4 * upFresh;
    note = `主力20日净流入为正且强于散户${cross === 'up' ? `（${ageDesc}上穿）` : ''}`;
  } else if (shape === 'smile') {
    score = 18;
    note = '主力线呈U型，等待上穿确认';
  } else if (shape === 'sad' && cross === 'down') {
    // 悲伤曲线死叉：越新鲜惩罚越重，随时间衰减回升到形态分（8）
    score = 8 - (aboveZero ? 2 : 5) * downFresh;
    note = `悲伤曲线${ageDesc}下穿散户线${aboveZero ? '' : '且在0轴下方'}`;
  } else if (shape === 'sad') {
    score = 8;
    note = '主力线呈倒U型，资金撤离迹象';
  } else if (aboveZero) {
    score = 18 - 3 * downFresh;
    note = `主力20日净流入为正${cross === 'down' ? `（${ageDesc}被下穿，注意风险）` : ''}`;
  } else if (cross === 'down') {
    score = 12 - 4 * downFresh;
    note = `主力线${ageDesc}下穿散户线且在0轴下方`;
  } else {
    score = 12;
    note = '主力资金观望，方向不明';
  }

  return {
    score,
    max,
    available: true,
    shape,
    shapeDesc: SHAPE_DESC[shape],
    cross,
    crossDaysAgo,
    aboveZero,
    main20: mainLast,
    retail20: retailLast,
    note,
  };
}

// ==================== 个股综合 + 总评分 ====================

export interface StockScoreResult {
  available: boolean;
  reason?: string;
  score: number; // 0~100
  volume: VolumeScoreResult;
  rsi: RsiScoreResult;
  money: MoneyScoreResult;
  degraded: string[];
}

/** 个股表现评分 = 量能活跃度(35) + RSI(30) + 资金(35)，子项缺失时按剩余权重归一化 */
export function scoreStock(
  volume: VolumeScoreResult,
  rsi: RsiScoreResult,
  money: MoneyScoreResult,
): StockScoreResult {
  const subs = [
    { name: '量能活跃度', r: volume },
    { name: 'RSI指标', r: rsi },
    { name: '资金指标', r: money },
  ];
  const available = subs.filter((s) => s.r.available);
  const degraded = subs.filter((s) => !s.r.available).map((s) => `${s.name}数据不足`);
  if (!available.length) {
    return { available: false, reason: '个股份项数据均不足', score: 0, volume, rsi, money, degraded };
  }
  const sum = available.reduce((a, s) => a + s.r.score, 0);
  const sumMax = available.reduce((a, s) => a + s.r.max, 0);
  return {
    available: true,
    score: sumMax > 0 ? (sum / sumMax) * 100 : 0,
    volume,
    rsi,
    money,
    degraded,
  };
}

export interface ShortTermScoreResult {
  total: number; // 0~100
  grade: 'A' | 'B' | 'C' | 'D';
  advice: string;
  summary: string;
  vetoed: boolean;
  market: MarketScoreResult;
  sector: SectorScoreResult;
  stock: StockScoreResult;
  degraded: string[];
}

const gradeOf = (score: number): 'A' | 'B' | 'C' | 'D' => (score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D');

const adviceOf = (grade: 'A' | 'B' | 'C' | 'D') => {
  switch (grade) {
    case 'A':
      return '短线强势，可重点关注';
    case 'B':
      return '表现尚可，可关注等待更好买点';
    case 'C':
      return '表现平平，建议观望';
    default:
      return '形态偏弱，短线回避';
  }
};

/**
 * 综合评分：个股(50%) + 板块(30%) + 大盘(20)，缺失维度按剩余权重归一化；
 * 个股得分过低时触发一票否决（总分封顶）。
 */
export function composeShortTermScore(
  market: MarketScoreResult,
  sector: SectorScoreResult,
  stock: StockScoreResult,
  cfg: ScoreConfig = SHORT_TERM_SCORE_CONFIG,
): ShortTermScoreResult {
  const dims: { key: string; label: string; weight: number; available: boolean; score: number }[] = [
    { key: 'stock', label: '个股', weight: cfg.weights.stock, available: stock.available, score: stock.score },
    { key: 'sector', label: '板块', weight: cfg.weights.sector, available: sector.available, score: sector.score },
    { key: 'market', label: '大盘', weight: cfg.weights.market, available: market.available, score: market.score },
  ];
  const usable = dims.filter((d) => d.available);
  const degraded = dims.filter((d) => !d.available).map((d) => `${d.label}数据不足`);
  degraded.push(...stock.degraded);

  let total = 0;
  if (usable.length) {
    const wsum = usable.reduce((a, d) => a + d.weight, 0);
    total = usable.reduce((a, d) => a + (d.score * d.weight) / wsum, 0);
  }

  // 一票否决：个股形态差时，大盘/板块再好也不给高分
  let vetoed = false;
  if (stock.available && stock.score < cfg.vetoThreshold && total > cfg.vetoCap) {
    total = cfg.vetoCap;
    vetoed = true;
  }
  total = clamp(total, 0, 100);

  const grade = gradeOf(total);
  const parts = usable.map((d) => `${d.label}${d.score.toFixed(0)}`).join('，');
  const summary = `${parts || '暂无可用维度'}${vetoed ? '（个股走弱已触发一票否决降级）' : ''}`;

  return {
    total,
    grade,
    advice: adviceOf(grade),
    summary,
    vetoed,
    market,
    sector,
    stock,
    degraded,
  };
}

/** 评分 -> 展示颜色 */
export const scoreColor = (score: number) =>
  score >= 80 ? '#52c41a' : score >= 65 ? '#1890ff' : score >= 50 ? '#faad14' : '#ff4d4f';
