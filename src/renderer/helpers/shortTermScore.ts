import { Stock } from '@/types/stock';
import { calculateRSI } from './tech';

// ==================== 短线综合评分（大盘/板块/个股） ====================
//
// 用途：短线交易参考。整体评分 = 个股(60%) > 板块(20%) = 大盘(20%)。
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
  // 反转点位置（择时）：越靠近反转点分越高，已走远则衰减
  sectorBiasAllow: 3, // 20日均线乖离容忍（%）：超出的部分按每1%扣3分
  sectorRiseAllow: 6, // 距阶段低点涨幅容忍（%）：超出的部分按每1%扣2.5分
  sectorFreshDays: 6, // 距阶段低点天数容忍（日）：超出的部分按每日扣1.5分
  sectorTrendFloor: 30, // 正向趋势（up/bounce）经追高衰减后的最低分（与持续下跌同档：都不适合当下买入）
  // 板块维度构成：以"个股相对板块的相对强度"为主，板块自身强弱只作窄区间背景，
  // 避免同一板块的股票被整体抬分（高评分股票全部集中在当前最强板块）
  sectorRelWeight: 0.6, // 相对强度占比（其余为板块环境分）
  sectorRelBase: 50, // 相对强度基准分（超额收益为0时）
  sectorRelPerPct: 3, // 每 1% 超额收益（个股区间涨幅 - 板块区间涨幅）对应的分值
  sectorStockAboveBonus: 8, // 个股站上自己的20日均线加/减分
  sectorEnvBase: 45, // 板块环境分下限（板块趋势分为 down 档时）
  sectorEnvSpan: 30, // 板块环境分跨度（趋势分为 up 档时 env = base + span）
  // ---- 个股子项权重（合计 100，仅用于个股维度加权）----
  // 注：权重为 0 的子项仍然照常计算与展示，只是不参与个股综合分。
  stockDims: {
    volume: 20, // 量能活跃度（辅助项）
    rsi: 0, // RSI(6/24)：短线评分定位是选股而非择时，故不计入加权，仅保留计算与展示
    money: 60, // 资金指标：目标是筛出「微笑曲线 + 金叉」的趋势转折点，故权重最高
  },
  /** 子项满分（分值刻度，与权重解耦：权重为 0 时满分仍用于子项计算与展示） */
  stockSubMax: {
    volume: 30,
    rsi: 40,
    money: 30,
  },
  // ---- 个股-量能 ----
  mvSmallBound: 50e8, // 小盘上限（元）
  mvMidBound: 200e8, // 中盘上限（元）
  // 量能择时位置（与板块同逻辑：刚温和放量分最高，过热/已走远则下调）
  volRatioAllow: 2, // 横向活跃度倍数容忍值（默认换手率口径：5日均换手率/同档均值），超出部分每1倍扣6分
  volRiseAllow: 8, // 自放量启动日以来涨幅容忍(%)，超出部分每1%扣1.5分
  volStartRatio: 1.3, // 放量启动判定：5日均量 / 20日均量 ≥ 该倍数
  volStartLookback: 20, // 放量启动日回看窗口(日)
  volFreshDays: 5, // 距放量启动日天数容忍(日)，超出部分每日扣1分
  volScoreFloor: 5, // 量能分经"过热/追高"衰减后的最低分
  // ---- 个股-RSI ----
  rsiShort: 6,
  rsiLong: 24,
  rsiOverbought: 80, // RSI6 绝对超买阈值（真实超买的主口径）
  rsiOversold: 30, // RSI6 绝对超卖阈值
  rsiOverboughtRelaxed: 72, // 弱势行情下的超买补充口径：绝对值可放宽，但必须处于极高历史分位
  rsiOverboughtPercentile: 0.95, // 补充口径要求的历史分位（配合 rsiOverboughtRelaxed 使用）
  rsiExtremeSpread: 10, // 超买/超卖确认：RSI6 与 RSI24 差值绝对值下限
  rsiStateLookback: 60, // 极值状态识别窗口（日）：在窗口内寻找最近一次真实超买/超卖
  rsiPullbackMaxDays: 25, // 距最近一次真实超买超过该天数，不再认定为"超买后回踩"
  rsiCrossFreshDays: 3, // 金叉/死叉时效（日）：超过该天数的交叉视为失效，改按当前的均线排列判定
  rsiOversoldCrossDays: 5, // "超卖后金叉"额外要求：从上穿日往回倒推该天数内须出现过真实超卖状态（否则只是普通交叉）
  rsiBreakSpread: 3, // 判定"贴近24日线"的容差（RSI6 - RSI24）
  rsiPullbackBreakSpread: 8, // 回踩过程中允许的最大跌破幅度：超过则认为已破位，不算回踩
  // 超买追高衰减：偏多形态（金叉/上穿/接近金叉/回踩/修复/多头排列）成立，但 RSI6 已偏高时下调，避免买在高点
  rsiOverboughtPenaltyStart: 68, // RSI6 高于该值开始按"超买追高"下调（偏高区）
  rsiOverboughtPenaltyPerPoint: 1.5, // 偏高区每高 1 点扣 1.5 分（最多扣到 rsiOverbought 处，即 18 分）
  rsiOverboughtSteepPerPoint: 2.5, // 进入超买区（RSI6 ≥ rsiOverbought）后每高 1 点扣的分数（陡增）
  rsiOverboughtFloor: 10, // 超买追高下调后的最低分
  // ---- 个股-资金 ----
  moneyWindow: 20, // 主力/散户累计净流入窗口（日）
  moneyShapeDays: 30, // 微笑/悲伤曲线形态识别窗口（日）
  moneyCrossRecentDays: 5, // 交叉检测窗口（日）
  moneyCrossDecay: 0.8, // 交叉时效衰减系数：刚交叉 1.0，每过一日乘一次（3日后约 0.5）
  moneyHighPosThreshold: 0.72, // 主力资金「位置已高」阈值：区间相对位置 ≥ 该值 视为已持续流入（非转折点）
  // ---- 综合权重 ----
  // 板块权重从 0.3 下调到 0.2：板块强弱是环境因素，若权重过高会导致高评分股票过度集中在当前强势板块
  weights: { stock: 0.6, sector: 0.2, market: 0.2 },
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
  /** 趋势分（仅趋势维度、含追高衰减，未加个股/板块关系修正） */
  trendScore?: number;
  trendPenalty?: number; // 因"已偏离反转点（追高）"被下调的分数
  positionDesc?: string; // 择时位置说明（距低点涨幅/天数/MA20乖离）
  envScore?: number; // 板块环境分（趋势分压缩后的窄区间，作背景）
  relScore?: number; // 个股相对强度分（个股 vs 板块）
  daysSinceLow?: number; // 距阶段低点天数
  riseFromLow?: number; // 距阶段低点涨幅(%)
  bias20?: number; // 20日均线乖离(%)
}

// 趋势基准分：正向趋势只作为"上限"，实际得分再按距反转点的位置衰减（见 scoreSector）
const TREND_BASE: Record<SectorTrendType, number> = { up: 72, bounce: 70, flat: 45, down: 30 };
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
 * 板块表现评分 = 趋势分（择时位置修正后）+ 个股/板块关系修正。
 *
 * 1) 趋势类型判定以 20 日均线（MA20）为多空分界：收盘站上 MA20 一律不再判为"持续下跌"，
 *    只有「跌破MA20 + 20日区间为负 + 短期均线空头」才认定为持续下跌。
 * 2) 择时位置修正（本模块的核心）：目标是找"短线最佳买点"，因此不是涨得越多分越高，
 *    而是"离趋势反转点（阶段低点）越近分越高"。正向趋势（up/bounce）会按三个维度衰减：
 *      ① 20日均线乖离（超 sectorBiasAllow 部分每 1% 扣 3 分）
 *      ② 距阶段低点涨幅（超 sectorRiseAllow 部分每 1% 扣 2.5 分）
 *      ③ 距阶段低点天数（超 sectorFreshDays 部分每日扣 1.5 分）
 *    衰减下限为 sectorTrendFloor，避免"已大幅拉升的板块"仍得高分（追高风险）。
 * 3) 维度构成：以"个股相对板块的相对强度"为主（sectorRelWeight，默认60%），板块自身强弱只作为窄区间
 *    背景分（envScore，sectorEnvBase ~ base+span）。这样同一板块的股票不会因为板块当红而被整体抬分。
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

  // ---- 板块短期趋势（以 MA20 为多空分界）----
  const bCloses = boardKlines.map((k) => k.sp);
  const bWin = bCloses.slice(-(cfg.sectorDays + 1));
  const lastClose = bCloses[bCloses.length - 1];
  const ret20 = rangeChange(bCloses, cfg.sectorDays) ?? 0;
  const ret5 = rangeChange(bCloses, 5) ?? 0;
  const ma5 = mean(bCloses.slice(-5));
  const ma10 = mean(bCloses.slice(-10));
  const ma20 = mean(bCloses.slice(-cfg.sectorDays));
  const ma20Prev = mean(bCloses.slice(-cfg.sectorDays - 5, -5)); // 5日前的MA20，判断20日线方向
  const ma5Prev = mean(bCloses.slice(-8, -3));
  const high20 = Math.max(...bWin);
  const drawdown = (lastClose / high20 - 1) * 100;

  // 20日线多空分界与短期均线形态
  const aboveMa20 = lastClose > ma20;
  const ma20Rising = ma20 > ma20Prev;
  const shortBull = ma5 >= ma10; // 5/10日线多头
  // 前期存在明显下跌
  const priorDecline = ret20 < -5 || drawdown < -5;
  // 反转点（阶段低点）：窗口内最低收盘，从低点往后数
  const bWinCloses = bCloses.slice(-(cfg.sectorDays + 1));
  let lowIdx = 0;
  bWinCloses.forEach((c, i) => {
    if (c <= bWinCloses[lowIdx]) lowIdx = i; // 取最近一次最低点
  });
  const daysSinceLow = bWinCloses.length - 1 - lowIdx; // 低点距今天数
  const low20 = bWinCloses[lowIdx];
  const riseFromLow = low20 > 0 ? (lastClose / low20 - 1) * 100 : 0; // 距阶段低点涨幅(%)
  const bias20 = ma20 > 0 ? (lastClose / ma20 - 1) * 100 : 0; // 20日均线乖离(%)
  // 底分型：低点出现在 2 日及以前，且此后收盘逐步回升、未再创新低
  const afterLow = bWinCloses.slice(lowIdx + 1);
  const bottomFractal =
    daysSinceLow >= 2 && afterLow[afterLow.length - 1] > bWinCloses[lowIdx] &&
    afterLow.every((c, i) => i === 0 || c >= afterLow[i - 1]);
  // 连续 N 日不创新低（更强的企稳确认）
  const noNewLow = daysSinceLow >= cfg.sectorNoNewLowDays || bottomFractal;

  let trendType: SectorTrendType;
  let trendDesc: string;
  if (aboveMa20 && shortBull && ret20 > 0 && (ma20Rising || ma5 > ma20)) {
    // 站上20日线 + 短期均线多头 + 区间正收益 → 上升趋势
    trendType = 'up';
    trendDesc = TREND_DESC.up;
  } else if (aboveMa20 && (ret5 > 0 || ma20Rising || ma5 > ma5Prev)) {
    // 站上20日线但短期均线尚未走顺：不判为持续下跌，按回升/反弹处理
    trendType = 'bounce';
    trendDesc = `板块站上20日均线（MA20 ${ma20.toFixed(2)}），短线回升`;
  } else if (drawdown < -8 && ret5 > 2 && ma5 > ma5Prev) {
    trendType = 'bounce';
    trendDesc = '板块超跌反弹';
  } else if (priorDecline && noNewLow) {
    // 下跌后企稳：出现底分型或连续 N 日不创新低，不再判定为持续下跌
    trendType = 'bounce';
    trendDesc = bottomFractal ? '板块下跌后企稳（出现底分型）' : `板块下跌后企稳（连续${cfg.sectorNoNewLowDays}日未创新低）`;
  } else if (!aboveMa20 && ret20 < 0 && !shortBull) {
    // 只有同时跌破20日线、区间为负、短期均线空头，才认定为持续下跌
    trendType = 'down';
    trendDesc = `${TREND_DESC.down}（跌破20日均线）`;
  } else {
    trendType = 'flat';
    trendDesc = TREND_DESC.flat;
  }

  // ---- 择时位置修正：寻找短线最佳买点，离反转点越近分越高，已走远则衰减 ----
  // 三个"追高"维度：20日均线乖离 / 距阶段低点涨幅 / 距阶段低点天数（时间越久越不新鲜）
  const extensionPenalty =
    Math.max(0, bias20 - cfg.sectorBiasAllow) * 3 +
    Math.max(0, riseFromLow - cfg.sectorRiseAllow) * 2.5 +
    Math.max(0, daysSinceLow - cfg.sectorFreshDays) * 1.5;
  const isPositiveTrend = trendType === 'up' || trendType === 'bounce';
  const trendScore = isPositiveTrend
    ? clamp(TREND_BASE[trendType] - extensionPenalty, cfg.sectorTrendFloor, TREND_BASE[trendType])
    : TREND_BASE[trendType];
  if (isPositiveTrend) {
    // 描述保持简短（股票池列表直接用该字段），位置明细由详情页单独展示
    trendDesc += extensionPenalty > 0 ? '（已偏离反转点，按追高下调评分）' : '（位置接近反转点）';
  }
  /** 择时位置说明（详情页展示用） */
  const positionDesc = isPositiveTrend
    ? `距阶段低点${riseFromLow >= 0 ? '+' : ''}${riseFromLow.toFixed(1)}%（${daysSinceLow}日前见低）｜MA20乖离${bias20 >= 0 ? '+' : ''}${bias20.toFixed(1)}%`
    : '';

  // ---- 个股与板块关系 ----
  const sCloses = stockKlines.map((k) => k.sp);
  const sLast = sCloses[sCloses.length - 1];
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

  // ---- 个股相对强度分：个股 vs 板块（去"板块整体强→成分股齐涨"的同质加分）----
  const sMa20 = mean(sCloses.slice(-cfg.sectorDays));
  const stockAboveMa20 = sLast > sMa20;
  const relScore = clamp(
    cfg.sectorRelBase + diff * cfg.sectorRelPerPct + (stockAboveMa20 ? cfg.sectorStockAboveBonus : -cfg.sectorStockAboveBonus),
    0,
    100,
  );

  // ---- 板块环境分：把板块趋势分压缩到窄区间（仅作背景，避免板块强弱主导个股评分）----
  const envScore =
    cfg.sectorEnvBase +
    ((trendScore - TREND_BASE.down) / (TREND_BASE.up - TREND_BASE.down)) * cfg.sectorEnvSpan;

  const sectorScore = clamp(relScore * cfg.sectorRelWeight + envScore * (1 - cfg.sectorRelWeight), 0, 100);

  return {
    available: true,
    score: sectorScore,
    boardName,
    trendType,
    trendDesc,
    relation,
    relationDesc: RELATION_DESC[relation],
    boardZdf: bZdf,
    stockZdf: sZdf,
    diff,
    trendScore,
    trendPenalty: isPositiveTrend ? extensionPenalty : 0,
    positionDesc,
    envScore,
    relScore,
    daysSinceLow,
    riseFromLow,
    bias20,
  };
}

// ==================== 个股-量能活跃度 ====================

export interface VolumeScoreResult {
  score: number; // 0~30（= stockSubMax.volume）
  max: number;
  available: boolean;
  note: string;
  ratio?: number; // 活跃度横向倍数（默认换手率口径：5日均换手率 / 同类市值平均换手率）
  ratioBasis?: 'turnover' | 'amount' | null; // 横向对比口径（换手率 / 回退成交额 / 无）
  turnover5?: number; // 个股5日平均换手率(%)
  volTrend?: number; // 5日均量 / 20日均量
  zdf5?: number; // 近5日累计涨幅
  degraded?: string; // 降级说明（无同类数据时）
  volPenalty?: number; // 因"过热/已走远（追高）"被下调的分数
  daysSinceVolStart?: number | null; // 距放量启动日天数（null = 窗口内未放量）
  positionDesc?: string; // 择时位置说明
}

/** 根据流通市值(元)选择市值档 */
export function pickMarketTier(circMv: number | null | undefined, cfg: ScoreConfig = SHORT_TERM_SCORE_CONFIG): keyof MarketActivityStats['tiers'] {
  if (!circMv || circMv <= 0) return 'mid';
  if (circMv < cfg.mvSmallBound) return 'small';
  if (circMv < cfg.mvMidBound) return 'mid';
  return 'large';
}

/**
 * 量能活跃度：横向（相比同类市值股票的活跃度，默认用换手率——成交额受股价与流通盘大小干扰，
 * 同市值档内换手率才可比；换手率缺失时回退成交额）+ 纵向（自身量能趋势，量价配合），
 * 再按"离放量启动点的位置"做择时修正（与板块同逻辑，目标是找短线买点）：
 * 量能刚从萎缩转为温和放量时分最高；若已放量过热（成交额倍数过高）、
 * 伴随涨幅过大（近5日涨幅高）或距放量启动日已久，则下调评分（避免追高）。
 */
export function scoreStockVolume(
  stockKlines: Stock.KLineItem[],
  stats: MarketActivityStats | null | undefined,
  circMv: number | null | undefined,
  cfg: ScoreConfig = SHORT_TERM_SCORE_CONFIG,
): VolumeScoreResult {
  const max = cfg.stockSubMax.volume;
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
  // 横向对比口径：优先换手率（成交额会被股价/流通盘大小干扰，换手率才是同市值档内可比的活跃度），
  // 换手率数据缺失时回退成交额口径
  const turnover5 = mean(stockKlines.slice(-5).map((k) => k.hsl || 0));
  const turnoverRatio = tierStat && tierStat.avg_turnover > 0 && turnover5 > 0 ? turnover5 / tierStat.avg_turnover : null;
  const amountRatio = tierStat && tierStat.avg_amount > 0 ? avgAmount5 / tierStat.avg_amount : null;
  const ratio = turnoverRatio ?? amountRatio;
  const ratioBasis: 'turnover' | 'amount' | null = ratio === null ? null : turnoverRatio !== null ? 'turnover' : 'amount';
  const ratioLabel = ratioBasis === 'turnover' ? '换手率' : '成交额';

  // ---- 放量启动日：回看窗口内首个"5日均量 / 20日均量 ≥ volStartRatio"的交易日 ----
  let volStartIdx = -1;
  for (let i = Math.max(19, cjls.length - 1 - cfg.volStartLookback); i < cjls.length; i++) {
    const m5 = mean(cjls.slice(i - 4, i + 1));
    const m20 = mean(cjls.slice(i - 19, i + 1));
    if (m20 > 0 && m5 / m20 >= cfg.volStartRatio) {
      volStartIdx = i;
      break;
    }
  }
  const daysSinceVolStart = volStartIdx >= 0 ? cjls.length - 1 - volStartIdx : null;

  // ---- 择时位置修正：过热 / 追高 / 已走远则下调 ----
  // 与板块同一套三维度：① 成交额倍数过热（对应板块的均线乖离）
  //                   ② 自放量启动日以来的涨幅（对应板块的"距阶段低点涨幅"，无启动日时回退近5日涨幅）
  //                   ③ 距放量启动日天数（对应板块的"距阶段低点天数"）
  const volStartClose = volStartIdx >= 0 ? stockKlines[volStartIdx].sp : 0;
  const riseSinceVolStart = volStartClose > 0 ? (stockKlines[stockKlines.length - 1].sp / volStartClose - 1) * 100 : null;
  const riseForChase = riseSinceVolStart !== null ? riseSinceVolStart : zdf5;
  const hotRatio = ratio !== null && ratio > cfg.volRatioAllow ? (ratio - cfg.volRatioAllow) * 6 : 0; // 换手率/成交额过热
  const chasingRise = Math.max(0, riseForChase - cfg.volRiseAllow) * 1.5; // 启动以来涨幅过大
  // 距启动点已远：仅在放量仍在持续（当前量能仍处启动水平）时才惩罚；
  // 若量能已消退（回到萎缩/持平），说明这波放量结束，不应再按"已走远"扣分
  const volStillActive = volTrend >= cfg.volStartRatio;
  const staleVol = daysSinceVolStart !== null && volStillActive ? Math.max(0, daysSinceVolStart - cfg.volFreshDays) * 1 : 0;
  const extensionPenalty = hotRatio + chasingRise + staleVol;
  const applyTiming = (base: number) => clamp(base - extensionPenalty, cfg.volScoreFloor, Math.max(base, cfg.volScoreFloor));
  const timingDesc = [
    daysSinceVolStart !== null ? `距放量启动${daysSinceVolStart}日` : '窗口内未见放量启动',
    riseSinceVolStart !== null
      ? `自启动${riseSinceVolStart >= 0 ? '+' : ''}${riseSinceVolStart.toFixed(1)}%`
      : `近5日涨幅${zdf5 >= 0 ? '+' : ''}${zdf5.toFixed(1)}%`,
  ]
    .filter(Boolean)
    .join('｜');
  const penaltyShown = Math.round(extensionPenalty);
  const timingNote =
    extensionPenalty > 0
      ? `；${timingDesc}${penaltyShown > 0 ? `，已过热/走远（下调${penaltyShown}分）` : ''}`
      : `；${timingDesc}`;
  const ratioDesc = ratio === null ? '未知' : ratio >= 2 ? '显著活跃' : ratio >= 1.2 ? '较为活跃' : ratio >= 0.7 ? '中等' : '清淡';

  // 纵向：自身量能趋势 + 量价配合（最多 40% 权重 + 奖惩）
  let vScore = max * 0.4 * clamp((volTrend - 0.7) / 0.8, 0, 1);
  if (volTrend >= 1.2 && zdf5 > 0) vScore += 5; // 放量上涨
  if (volTrend <= 0.8 && zdf5 < 0) vScore -= 5; // 缩量下跌
  vScore = clamp(vScore, 0, max * 0.4 + 5);
  const volTurnDesc = `量能${volTrend >= 1.2 ? '放大' : volTrend >= 0.9 ? '持平' : '萎缩'}（${volTrend.toFixed(2)}倍）`;

  if (ratio !== null) {
    // 横向：相比同类市值股票的活跃度（默认换手率口径，缺失时回退成交额）
    const hScore = max * 0.6 * clamp((ratio - 0.5) / 1.5, 0, 1);
    const base = clamp(hScore + vScore, 0, max);
    return {
      score: applyTiming(base),
      max,
      available: true,
      note: `同类市值${ratioDesc}（5日${ratioLabel}为同类${ratio.toFixed(2)}倍${ratioBasis === 'amount' ? '，换手率缺失回退成交额' : ''}），${volTurnDesc}${timingNote}`,
      ratio,
      ratioBasis,
      turnover5,
      volTrend,
      zdf5,
      volPenalty: base - applyTiming(base),
      daysSinceVolStart,
      positionDesc: timingDesc,
    };
  }

  // 降级：无同类市值数据，仅用自身量能趋势
  const base = clamp(max * clamp((volTrend - 0.7) / 0.9, 0, 1) + (volTrend >= 1.2 && zdf5 > 0 ? 5 : 0), 0, max);
  return {
    score: applyTiming(base),
    max,
    available: true,
    degraded: '无同类市值统计数据，仅按自身量能趋势评分',
    note: `${volTurnDesc}${timingNote}`,
    ratioBasis: null,
    turnover5,
    volTrend,
    zdf5,
    volPenalty: base - applyTiming(base),
    daysSinceVolStart,
    positionDesc: timingDesc,
  };
}

// ==================== 个股-RSI 指标 ====================

export interface RsiScoreResult {
  score: number; // 0~40（= stockSubMax.rsi）；权重为 0，仅计算与展示，不参与个股综合分
  max: number;
  available: boolean;
  pattern: string; // 命中情形
  rsi6: number;
  rsi24: number;
  rsi6Percentile: number; // RSI6 历史分位 0~1
}

/**
 * RSI(6/24) 指标评分：
 * 最佳为【真实超买状态】后6日线回踩24日线企稳；其次为超卖后6日线上穿24日线；应避免持续超买钝化与死叉。
 *
 * 判定原则（先定"格局"，再定形态）：
 * 在回看窗口内找到最近一次真实超买状态与最近一次真实超卖状态，谁的日期更靠后，当前就属于哪一种格局：
 *  - 最近一次是超买  → 才可能判定为"超买后回踩"；
 *  - 最近一次是超卖  → 其后的一切上行（哪怕中途冲高再回落）都属于"超卖后反抽/金叉"，
 *    避免如 601360.SH 这类"从深度超卖金叉 24 日线后又回落至线附近"被误判成超买后回踩。
 * 所谓"真实极值状态"必须同时满足：RSI6 绝对值越界 + 与 24 日线拉开明显差值。
 * 历史分位只作为弱势行情下的补充口径（要求极高绝对值 + 极高历史分位），不再作为超买主口径，
 * 否则长期弱势股一旦反弹到中高位就会被历史分位误判成超买。
 *
 * 交叉的时效性：金叉/死叉只在 cfg.rsiCrossFreshDays（默认3日）内有效，
 * 过期后一律改按当前均线排列判定（多头/空头排列），避免 6日线与24日线反复缠绕时长期挂着"金叉"高分。
 * 并且"超卖后金叉"还要求：从上穿日往回倒推 cfg.rsiOversoldCrossDays（默认5日）内出现过真实超卖状态，
 * 超卖早已过去（区间内 6/24 线反复缠绕）时的上穿只是普通交叉，不予加分。
 *
 * 超买追高衰减：偏多形态（金叉/上穿/接近金叉/回踩/修复/多头排列）即便成立，只要 RSI6 高于
 * cfg.rsiOverboughtPenaltyStart（默认72），就按超出点数下调评分（下限 cfg.rsiOverboughtFloor），
 * 因为此时位置已高，追进去容易买在高点；死叉/空头/超买钝化等本就低分的形态不再叠加。
 */
export function scoreStockRsi(
  stockKlines: Stock.KLineItem[],
  cfg: ScoreConfig = SHORT_TERM_SCORE_CONFIG,
): RsiScoreResult {
  const max = cfg.stockSubMax.rsi;
  // 形态基础分（原 30 分制 × max/30 取整，保持各形态相对高低不变）
  const s = (v: number) => Math.round((v * max) / 30);
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

  // ---- RSI6 历史分位（可用历史内）----
  const hist = rsi6s.slice(start);
  const sortedHist = [...hist].sort((a, b) => a - b);
  /** 某数值处在历史分位的位置 0~1 */
  const percentileOf = (v: number) => {
    if (!sortedHist.length) return 0.5;
    let lo = 0;
    let hi = sortedHist.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedHist[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo / sortedHist.length;
  };
  const rsi6Percentile = percentileOf(rsi6);

  const spreadAt = (i: number) => rsi6s[i] - rsi24s[i];

  // 真实极值状态：绝对值越界 + 与 24 日线拉开差值。单纯与 24 日线贴合的是正常波动，不算超买/超卖。
  const isOverboughtState = (i: number) =>
    (rsi6s[i] >= cfg.rsiOverbought ||
      (rsi6s[i] >= cfg.rsiOverboughtRelaxed && percentileOf(rsi6s[i]) >= cfg.rsiOverboughtPercentile)) &&
    spreadAt(i) >= cfg.rsiExtremeSpread;
  const isOversoldState = (i: number) => rsi6s[i] <= cfg.rsiOversold && spreadAt(i) <= -cfg.rsiExtremeSpread;

  // ---- 最近一次真实超买/超卖状态 ----
  const lookbackStart = Math.max(start, n - cfg.rsiStateLookback);
  let lastOverboughtIdx = -1;
  let lastOversoldIdx = -1;
  for (let i = n - 1; i >= lookbackStart; i--) {
    if (lastOverboughtIdx < 0 && isOverboughtState(i)) lastOverboughtIdx = i;
    if (lastOversoldIdx < 0 && isOversoldState(i)) lastOversoldIdx = i;
    if (lastOverboughtIdx >= 0 && lastOversoldIdx >= 0) break;
  }
  // 当前格局：两者都为 -1 时均不成立
  const overboughtRegime = lastOverboughtIdx > lastOversoldIdx;
  const reboundRegime = lastOversoldIdx > lastOverboughtIdx;

  // ---- 超买后回踩：最近一次真实超买之后，6日线自上方回落至24日线附近，且未破位 ----
  let pullback = false;
  if (overboughtRegime && n - 1 - lastOverboughtIdx <= cfg.rsiPullbackMaxDays) {
    let peakAfter = rsi6s[lastOverboughtIdx];
    let minSpreadAfter = spreadAt(lastOverboughtIdx);
    for (let i = lastOverboughtIdx + 1; i < n; i++) {
      peakAfter = Math.max(peakAfter, rsi6s[i]);
      minSpreadAfter = Math.min(minSpreadAfter, spreadAt(i));
    }
    pullback =
      rsi6 <= peakAfter - 5 && // 已从超买峰值明显回落
      spread <= 5 &&
      spread >= -cfg.rsiBreakSpread && // 当前贴近24日线（含小幅虚破）
      minSpreadAfter >= -cfg.rsiPullbackBreakSpread; // 回落过程中未大幅跌破24日线（未破位）
  }

  // ---- 交叉的时效性：金叉/死叉只在 rsiCrossFreshDays 日内有效，过期后按当前的均线排列判定 ----
  let crossUpIdx = -1;
  let crossDownIdx = -1;
  // 起点为"rsiCrossFreshDays 日前"，保证刚好 rsiCrossFreshDays 日前发生的交叉仍在时效内
  for (let i = Math.max(start + 1, n - 1 - cfg.rsiCrossFreshDays); i < n; i++) {
    if (rsi6s[i - 1] <= rsi24s[i - 1] && rsi6s[i] > rsi24s[i]) crossUpIdx = i;
    else if (rsi6s[i - 1] >= rsi24s[i - 1] && rsi6s[i] < rsi24s[i]) crossDownIdx = i;
  }
  // 时效窗口内最近一次交叉的方向（两者不可能同日，取更晚的一个）
  const hasFreshCross = crossUpIdx >= 0 || crossDownIdx >= 0;
  const freshCrossIsUp = crossUpIdx > crossDownIdx;
  const freshCrossDaysAgo = hasFreshCross ? n - 1 - Math.max(crossUpIdx, crossDownIdx) : null;
  // "超卖后金叉/死叉"：从上穿（下穿）日往回倒推 rsiOversoldCrossDays 日内，须出现过真实超卖状态。
  // 超卖早已过去（期间 6/24 线反复缠绕）时，此后的交叉只是普通交叉，不能算作超卖后金叉。
  const crossAfterOversold = (crossIdx: number) => {
    if (crossIdx < 0) return false;
    const from = Math.max(start, crossIdx - cfg.rsiOversoldCrossDays);
    for (let i = from; i <= crossIdx; i++) {
      if (isOversoldState(i)) return true;
    }
    return false;
  };
  const crossFromOversold = crossAfterOversold(crossUpIdx);
  const crossDownFromOversold = crossAfterOversold(crossDownIdx);

  // ---- 超卖后反抽：超卖谷底参考值（判断是否已明显脱离谷底）----
  let troughAfterOversold = 0;
  if (reboundRegime) {
    // 从超卖状态日往前多看 5 日再取最小值，
    // 避免"超卖状态日就是今天"时谷底取到当日、导致刚反弹的第一天无法体现"已脱离谷底"
    const troughFrom = Math.max(start, lastOversoldIdx - 5);
    let trough = rsi6s[troughFrom];
    for (let i = troughFrom; i < n; i++) trough = Math.min(trough, rsi6s[i]);
    troughAfterOversold = trough;
  }

  // 最近一次上穿（不限时效，仅用于形态描述：区分"金叉已过时效"与"本就无金叉"）
  let lastCrossUpIdx = -1;
  for (let i = Math.max(start + 1, n - cfg.rsiStateLookback); i < n; i++) {
    if (rsi6s[i - 1] <= rsi24s[i - 1] && rsi6s[i] > rsi24s[i]) lastCrossUpIdx = i;
  }

  // 6日线在24日线下方、但正在向上收敛 → 接近金叉（前瞻信号，非已发生的交叉）
  const approachingCross =
    !hasFreshCross && rsi6 < rsi24 && spread >= -cfg.rsiBreakSpread && spread > spreadAt(n - 2);

  // 持续超买钝化：连续5日 RSI6 > 80 且与24日线差值大
  const last5 = rsi6s.slice(-5);
  const persistentOverbought = last5.every((v) => v > cfg.rsiOverbought) && spread > 15;

  let score: number;
  let pattern: string;
  // 交叉的时效描述：金叉/死叉只在其时效窗口内作为形态依据
  const crossAgo = freshCrossDaysAgo === 0 ? '当日' : `${freshCrossDaysAgo}日前`;

  // ---- 超买追高衰减（两段式）----
  // 金叉/多头排列等偏多形态即便成立，只要 RSI6 已偏高（>rsiOverboughtPenaltyStart）就下调；
  // 进入超买区（≥ rsiOverbought）后惩罚陡增，确保"高分"不会落在超买区（避免追高买在高点）。
  const startAt = cfg.rsiOverboughtPenaltyStart;
  const mildExcess = clamp(rsi6 - startAt, 0, Math.max(0, cfg.rsiOverbought - startAt)); // 偏高区部分（最多到超买临界）
  const steepExcess = Math.max(0, rsi6 - cfg.rsiOverbought); // 超买区部分
  const overboughtPenalty = mildExcess * cfg.rsiOverboughtPenaltyPerPoint + steepExcess * cfg.rsiOverboughtSteepPerPoint;
  let overboughtCut = 0;
  const applyOverbought = (v: number) => {
    const after = clamp(v - overboughtPenalty, Math.min(cfg.rsiOverboughtFloor, v), v);
    overboughtCut = Math.max(overboughtCut, v - after);
    return after;
  };

  if (pullback) {
    const stabilized = rsi6s[n - 1] >= rsi6s[n - 2];
    score = applyOverbought(stabilized ? s(30) : s(26));
    pattern = stabilized ? '超买后回踩24日线企稳（最佳买点）' : '超买后回落，6日线临近24日线（回踩中）';
  } else if (hasFreshCross && freshCrossIsUp && crossFromOversold) {
    // 超卖后金叉：上穿紧跟在最近一次真实超卖之后（时效窗口内），才是超卖反转买点
    if (spread >= 0) {
      score = applyOverbought(s(26));
      pattern = `超卖后${crossAgo}6日线上穿24日线（金叉）`;
    } else if (spread >= -cfg.rsiBreakSpread) {
      score = applyOverbought(s(22));
      pattern = '超卖后上穿24日线后回落至线附近整理（金叉待确认）';
    } else {
      score = applyOverbought(s(16));
      pattern = '超卖后上穿24日线后已跌回24日线下方（金叉失效）';
    }
  } else if (hasFreshCross && freshCrossIsUp) {
    // 近3日内上穿，但距最近一次真实超卖已超过时效窗口（区间反复缠绕）→ 不按超卖后金叉加分
    if (spread >= -cfg.rsiBreakSpread) {
      score = applyOverbought(s(20));
      pattern = '近3日内6日线上穿24日线（非超卖反转，不加分）';
    } else {
      score = applyOverbought(s(12));
      pattern = '近3日内6日线上穿24日线后跌回24日线下方（上穿失效）';
    }
  } else if (reboundRegime && approachingCross) {
    // 时效内无新交叉，但6日线在24日线下方向上收敛 → 等待金叉
    score = applyOverbought(s(20));
    pattern = '超卖反弹后6日线回抽24日线（接近金叉）';
  } else if (hasFreshCross && !freshCrossIsUp) {
    // 时效窗口内的死叉：金叉结构已被破坏
    if (crossDownFromOversold) {
      // 直接把 RSI6 打进超卖区的死叉：短线已进入超卖，等待企稳信号
      score = s(12);
      pattern = `超卖后${crossAgo}6日线下穿24日线，RSI6已进入超卖区（死叉，等待企稳）`;
    } else if (reboundRegime) {
      score = spread >= -cfg.rsiBreakSpread ? s(16) : s(12);
      pattern =
        spread >= -cfg.rsiBreakSpread
          ? `反弹结构中${crossAgo}6日线下穿24日线，在24日线下方震荡（死叉）`
          : '反弹结构中6日线再度跌回24日线下方，结构转弱';
    } else {
      score = spread >= -cfg.rsiBreakSpread ? s(8) : s(6);
      pattern = `${crossAgo}6日线下穿24日线，在24日线下方震荡（死叉）`;
    }
  } else if (reboundRegime && rsi6 < rsi24 && rsi6 >= rsi6s[n - 2] && rsi6 - troughAfterOversold > 5) {
    // 超卖后反弹修复中：RSI6 已显著脱离超卖谷底且当日回升，但尚未上穿24日线
    score = applyOverbought(s(18));
    pattern = '超卖后反弹修复中（尚未金叉）';
  } else if (persistentOverbought) {
    score = s(8);
    pattern = '持续超买钝化，追高风险大';
  } else if (rsi6 > rsi24) {
    // 交叉已过时效（或从未出现）：按当前均线排列判定，不再算作金叉
    score = applyOverbought(s(20));
    pattern = lastCrossUpIdx >= 0 ? 'RSI多头排列，处于强势区（金叉时效已过）' : 'RSI多头排列，处于强势区';
  } else {
    score = s(10);
    pattern = 'RSI空头排列，处于弱势区';
  }

  // 偏多形态但位置偏高（超买追高）时，在形态后补充下调说明
  if (overboughtCut >= 1) {
    pattern +=
      rsi6 >= cfg.rsiOverbought
        ? `｜RSI6=${rsi6.toFixed(0)} 已进入超买区，追高下调${overboughtCut.toFixed(0)}分`
        : `｜RSI6=${rsi6.toFixed(0)} 偏高，下调${overboughtCut.toFixed(0)}分`;
  }

  return { score, max, available: true, pattern, rsi6, rsi24, rsi6Percentile };
}

// ==================== 个股-资金指标 ====================

export type MoneyShape = 'smile' | 'sad' | 'flat' | 'unknown';

export interface MoneyScoreResult {
  score: number; // 0~30（= stockSubMax.money）
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
 * 资金指标（20日）：基于主力/散户 N 日累计净流入曲线识别形态，目标是筛出**趋势转折点**。
 *
 * 评分取向（短线以资金为重）：
 * 1) 最高分给「完美微笑曲线金叉」：主力线走出 U 型（先流出后回流）**且** 近期上穿散户线，
 *    站上 0 轴更优；越新鲜越接近满分（衰减后回落到该档下限）。
 * 2) 次高给「近期上穿散户线」（形态未被判定为 U 型，但同样是资金转折信号）。
 * 3) U 型但还没上穿 → 转折前夜，等待确认。
 * 4) 已在 0 轴上方且强于散户、但近期**没有**金叉 → 资金已持续流入（趋势中后段），
 *    按主力线在近窗口内的**相对位置**降分：位置越高越接近区间顶部，越要避免追高
 *    （这样高分不会再集中落在"已经处于趋势高位"的股票上）。
 * 5) 倒 U 型 / 下穿散户线 / 0 轴下方 → 低位分。
 */
export function scoreStockMoney(
  detailMain: number[] | null | undefined,
  detailRetail: number[] | null | undefined,
  cfg: ScoreConfig = SHORT_TERM_SCORE_CONFIG,
): MoneyScoreResult {
  const max = cfg.stockSubMax.money;
  // 分值刻度：以 30 分制为基准 × max/30 取整
  const s = (v: number) => Math.round((v * max) / 30);
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

  // ---- 位置分：主力线在近 moneyShapeDays 日区间中的相对位置（0~1）----
  // 位置越高 = 资金已持续流入越久（趋势中后段），越不应当作"转折点"买入
  const winMin = Math.min(...shapeWin);
  const winMax = Math.max(...shapeWin);
  const posInRange = winMax > winMin ? clamp((mainLast - winMin) / (winMax - winMin), 0, 1) : 0.5;
  const highPos = posInRange >= cfg.moneyHighPosThreshold;

  let score: number;
  let note: string;
  if (shape === 'smile' && cross === 'up') {
    // 完美微笑曲线金叉：U型（先流出后回流）+ 上穿散户线，站上0轴最优；越新鲜越高（衰减到该档下限）
    score = (aboveZero ? s(20) : s(15)) + (aboveZero ? s(10) : s(7)) * upFresh;
    note = `${aboveZero ? '完美' : ''}微笑曲线${ageDesc}上穿散户线${
      aboveZero ? '且站上0轴' : '（尚未站上0轴）'
    }｜趋势转折买点`;
  } else if (cross === 'up') {
    // 近期上穿散户线（形态未被判定为U型）：同为资金转折信号，略低于完美微笑金叉
    score = (aboveZero ? s(16) : s(12)) + s(6) * upFresh;
    note = `主力线${ageDesc}上穿散户线${aboveZero ? '且站上0轴' : ''}（资金转折信号）`;
  } else if (shape === 'smile') {
    // U型但还没上穿：转折前夜，等待确认
    score = s(15);
    note = '主力线走出微笑曲线（资金回流），等待上穿散户线确认';
  } else if (aboveZero && mainLast > retailLast) {
    // 已站上0轴且强于散户，但近期没有金叉：资金已持续流入（趋势中后段），位置越高越要避免追高
    score = highPos ? s(7) : s(13);
    note = highPos
      ? `主力资金已持续流入（区间位置${(posInRange * 100).toFixed(0)}%），非转折点，谨防追高`
      : '主力20日净流入为正且强于散户（已过转折点，无新金叉）';
  } else if (aboveZero) {
    score = s(9);
    note = '主力20日净流入为正，但弱于散户（资金分歧）';
  } else if (shape === 'sad' && cross === 'down') {
    // 悲伤曲线死叉：越新鲜惩罚越重，随时间衰减回升到形态分
    score = s(6) - (aboveZero ? s(2) : s(4)) * downFresh;
    note = `悲伤曲线${ageDesc}下穿散户线${aboveZero ? '' : '且在0轴下方'}`;
  } else if (shape === 'sad') {
    score = s(6);
    note = '主力线呈倒U型，资金撤离迹象';
  } else if (cross === 'down') {
    score = s(9) - s(4) * downFresh;
    note = `主力线${ageDesc}下穿散户线且在0轴下方`;
  } else {
    score = s(11);
    note = '主力资金观望，方向不明';
  }
  score = clamp(Math.round(score), 0, max);

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

/**
 * 个股表现评分 = 量能活跃度 + 资金（权重见 stockDims）
 * RSI 权重为 0：只计算与展示，不参与个股综合分（短线评分定位是选股，不做择时）。
 * 各子项先归一到 0~1 再乘权重，再按「参与加权的权重之和」折算到 100；子项缺失时按剩余权重归一化。
 */
export function scoreStock(
  volume: VolumeScoreResult,
  rsi: RsiScoreResult,
  money: MoneyScoreResult,
): StockScoreResult {
  const dims = SHORT_TERM_SCORE_CONFIG.stockDims;
  const subs = [
    { name: '量能活跃度', r: volume, w: dims.volume },
    { name: 'RSI指标', r: rsi, w: dims.rsi },
    { name: '资金指标', r: money, w: dims.money },
  ];
  // 只有「参与加权」的子项缺失才算影响评分（RSI 权重为 0，不缺数据也不影响分）
  const degraded = subs.filter((s) => s.w > 0 && !s.r.available).map((s) => `${s.name}数据不足`);
  const weighted = subs.filter((s) => s.r.available && s.w > 0);
  if (!weighted.length) {
    return { available: false, reason: '个股份项数据均不足', score: 0, volume, rsi, money, degraded };
  }
  const sumW = weighted.reduce((a, s) => a + s.w, 0);
  const sum = weighted.reduce((a, s) => a + (s.r.max > 0 ? (s.r.score / s.r.max) * s.w : 0), 0);
  return {
    available: true,
    score: sumW > 0 ? (sum / sumW) * 100 : 0,
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
 * 综合评分：个股 + 板块 + 大盘（权重见 cfg.weights，默认 60/20/20），缺失维度按剩余权重归一化；
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
