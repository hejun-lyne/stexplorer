import { Stock } from '@/types/stock';

/**
 * C5a / C5b：分时特征与形态识别
 *
 * 对应《A股主线与龙头识别系统-实现规格》：
 * - C5a（M7a 全天分时形态分类，盘后）：8 个无量纲特征 + 规则字典，输出形态标签 + 置信度；
 * - C5b（M7b 开盘预测）：8 个特征 + 量能签名 + 最小规则版，输出 T1/T2/T3 概率估计；
 *   不等到 30 分钟才出结果 —— 开盘后每 10 分钟（10 / 20 / 30 分钟窗口）更新一档，
 *   窗口越短概率越向 0.5 收缩，30 分钟后固定用前 30 分钟（规格口径）。
 *
 * 说明：
 * - 规格里的 KMeans / LightGBM 训练（含 walk-forward、增量检验）不在前端做，
 *   这里落地的是「规则版 / 启发式概率」，阈值全部按规格给定值，概率只作排序参考；
 * - 阈值集中在 `INTRADAY_CONFIG` 里，方便后续按历史分位数校准。
 */

/** 全天分时形态标签（C5a） */
export type IntradayPatternName =
  | '强势上攻'
  | '高开低走'
  | '低开高走'
  | '冲高回落'
  | 'V型反转'
  | '尾盘偷袭'
  | '横盘震荡'
  | '无明显形态';

/** C5a 特征（f1~f9，全部无量纲） */
export interface IntradayPatternFeatures {
  /** 均价线上方占比 */
  f1: number;
  /** 收盘位置 (close-low)/(high-low) */
  f2: number;
  /** 穿越均价线次数 */
  f3: number;
  /** 8 段分段斜率（%，每段首尾差） */
  f4: number[];
  /** 量价比：上涨段成交量 / 下跌段成交量 */
  f5: number;
  /** 日内振幅 (high-low)/prevClose */
  f6: number;
  /** 分时最大回撤 */
  f7: number;
  /** 尾盘涨幅占比：最后 30 分钟涨幅 / 全天涨幅 */
  f8: number;
  /** 分时独立性 corr(个股分钟收益, 指数分钟收益)，无指数数据时缺省 */
  f9?: number;
}

/** C5a 结果 */
export interface IntradayPatternResult {
  pattern: IntradayPatternName;
  /** 0~1，规则满足程度换算的置信度 */
  confidence: number;
  features: IntradayPatternFeatures;
  /** 命中的判据说明（便于核对） */
  reason: string;
  /**
   * 分时是否已走完当天（收盘口径）
   *
   * 盘中也会随分时推进动态出形态，但此时只是「截至当前时刻」的临时结论，
   * 收盘前可能变化，展示时需要标注。
   */
  complete: boolean;
}

/** C5b 量能签名 */
export type Early30VolSignature = 'decreasing' | 'increasing' | 'u_shape' | 'flat';

/** C5b 特征（f1~f8） */
export interface Early30Features {
  /** 开盘 5 分钟方向与幅度 price[4]/open - 1 */
  f1: number;
  /** 窗口内量 / 昨日全天量 */
  f2: number;
  /** 均价线上方时间占比 */
  f3: number;
  /** 窗口前后半段波动率比（30 分钟窗口时即前后 15 分钟） */
  f4: number;
  /** 窗口内回撤幅度 (max-cur)/max */
  f5: number;
  /** 上影线比例 (max-cur)/(max-min) */
  f6: number;
  /** 分钟收益一阶自相关 */
  f7: number;
  /** 分时独立性 corr(个股, 指数)，无指数数据时缺省 */
  f8?: number;
}

/** C5b 结果 */
export interface Early30Result {
  /** 数据是否够一个评估档（>= 10 个分时点，即开盘 10 分钟后可用） */
  ready: boolean;
  /** 本次评估窗口（分钟）：10 / 20 / 30，按 10 分钟一档推进；30 分钟后固定为 30 */
  windowMinutes: number;
  /** 是否已走到规格的完整 30 分钟窗口 */
  fullWindow: boolean;
  /** T1 全天方向 / T2 高点出现在开盘 30 分钟内 / T3 接力价值（次日溢价） */
  probs: { T1: number; T2: number; T3: number };
  volSignature: Early30VolSignature;
  /** 是否命中规格里的「最小规则版」（阈值按窗口长度等比缩放） */
  ruleHit: boolean;
  features: Early30Features;
  /** 评估窗口内涨幅（%），窗口为 30 分钟时即前 30 分钟涨幅 */
  ret30: number;
}

/** 参数（与规格第 6 节一致，集中可配置） */
export const INTRADAY_CONFIG = {
  /** 全天分段数 f4 */
  segments: 8,
  /** 独立性「独立走强」阈值 f9 */
  independenceStrong: 0.3,
  /** 横盘：振幅上限 */
  flatAmp: 0.03,
  /** 横盘：贴近均价线的平均偏离上限 */
  flatVwapDev: 0.005,
  /** 强势上攻：均价线上方占比下限 */
  strongAboveRatio: 0.7,
  /** 强势上攻：量价比下限 */
  strongVolRatio: 1.2,
  /** 收盘位置判据 */
  closeLow: 0.3,
  closeHigh: 0.7,
  closeMid: 0.5,
  closeV: 0.8,
  /** 高开/低开幅度（相对昨收） */
  gapTh: 0.01,
  /** 尾盘偷袭：尾盘涨幅占比下限 */
  tailShare: 0.5,
  /** 开盘预测的最大评估窗口（分钟） */
  early30Window: 30,
  /** 开盘预测的最小评估窗口（分钟）：开盘不足 5 分钟样本太少，先不出结果 */
  early30MinWindow: 5,
  /** 量能签名分段数（5 分钟一段） */
  early30VolSegments: 6,
  /** 量能签名倍数 */
  early30VolRatio: 1.5,
  /** U 型判据倍数 */
  early30UUsRatio: 1.3,
  /** 最小规则版：30 分钟涨幅阈值 */
  early30RetTh: 0.03,
  /** 最小规则版：量占昨日全天阈值 */
  early30VolShareTh: 0.25,
};

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function mean(list: number[]) {
  return list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0;
}

function std(list: number[]) {
  if (list.length < 2) {
    return 0;
  }
  const m = mean(list);
  return Math.sqrt(mean(list.map((v) => (v - m) * (v - m))));
}

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}

/** 皮尔逊相关系数 */
function pearson(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n < 3) {
    return undefined;
  }
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va <= 0 || vb <= 0) {
    return undefined;
  }
  return cov / Math.sqrt(va * vb);
}

/** 分时时间取 HH:MM:SS（兼容 "YYYY-MM-DD HH:MM:SS" 与 "HH:MM:SS"） */
function timeLabel(datetime: string) {
  const s = String(datetime || '');
  const m = s.match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? `${m[1]}:${m[2]}:${m[3] || '00'}` : '';
}

/** 分时时刻换算成「当日第几分钟」（无法解析时返回 NaN） */
function minuteOfDay(datetime: string) {
  const label = timeLabel(datetime);
  if (!label) {
    return NaN;
  }
  const [h, m] = label.split(':').map((v) => Number(v));
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    return NaN;
  }
  return h * 60 + m;
}

/**
 * 分时是否已经走完一个交易日（C5a 盘后口径）
 *
 * 训练模式回放时只有推到收盘才有完整 240 点，否则不能出形态结论；
 * 部分数据源（东财实时分时）最后一根是 14:57（尾盘集合竞价不逐分钟出点），
 * 所以用 14:55 作为「已收盘」的时间门槛，而不是死等 15:00。
 */
export function IsIntradayComplete(trends: Stock.TrendItem[]) {
  if (!trends.length) {
    return false;
  }
  const last = timeLabel(trends[trends.length - 1]?.datetime);
  return (!!last && last >= '14:55:00') || trends.length >= 240;
}

/** 只保留有效价格点（停牌/空档价格为 0 的分钟直接丢弃） */
function pickValid(trends: Stock.TrendItem[]) {
  return (trends || []).filter((t) => Number(t?.current) > 0);
}

/** 分钟收益序列（相对上一分钟现价） */
function minuteReturns(list: Stock.TrendItem[]) {
  const returns: number[] = [];
  for (let i = 1; i < list.length; i += 1) {
    const prev = Number(list[i - 1].current) || 0;
    const cur = Number(list[i].current) || 0;
    if (prev > 0 && cur > 0) {
      returns.push(cur / prev - 1);
    } else {
      returns.push(0);
    }
  }
  return returns;
}

/**
 * 计算 C5a 分时特征与形态（随分时推进动态计算）
 *
 * 传入「截至当前时刻」的分时即可：盘中每来一根新分时都会重新判一次，
 * 结果是「截至当前时刻」的临时形态（`complete=false`），收盘后才是最终形态。
 *
 * @param params.trends 当天分时（至少 30 点；收盘口径时为完整 240 点）
 * @param params.prevClose 昨收（强弱与振幅基准）
 * @param params.indexTrends 可选，指数分时，用于 f9 独立性
 */
export function ComputeIntradayPattern(params: {
  trends: Stock.TrendItem[];
  prevClose: number;
  indexTrends?: Stock.TrendItem[];
}): IntradayPatternResult | null {
  const list = pickValid(params.trends);
  const prevClose = Number(params.prevClose) || 0;
  if (list.length < 30 || prevClose <= 0) {
    return null;
  }
  const complete = IsIntradayComplete(list);
  const cfg = INTRADAY_CONFIG;
  const prices = list.map((t) => Number(t.current) || 0);
  const n = prices.length;
  const open = prices[0];
  const close = prices[n - 1];
  const high = Math.max(...prices);
  const low = Math.min(...prices);

  // f1 均价线上方占比（均价缺失时以现价代，占比记 1）
  const aboveFlags = list.map((t) => {
    const avg = Number(t.average) || 0;
    return avg > 0 ? (Number(t.current) > avg ? 1 : 0) : 1;
  });
  const f1 = mean(aboveFlags);

  // f2 收盘位置
  const f2 = high > low ? (close - low) / (high - low) : 0.5;

  // f3 穿越均价线次数
  let f3 = 0;
  let prevSign = 0;
  list.forEach((t) => {
    const avg = Number(t.average) || 0;
    if (avg <= 0) {
      return;
    }
    const diff = Number(t.current) - avg;
    const sign = diff > 0 ? 1 : diff < 0 ? -1 : 0;
    if (sign && prevSign && sign !== prevSign) {
      f3 += 1;
    }
    if (sign) {
      prevSign = sign;
    }
  });

  // f4 分段斜率（%，每段首尾差）
  const segCount = Math.max(1, Math.min(cfg.segments, n));
  const f4: number[] = [];
  for (let i = 0; i < segCount; i += 1) {
    const from = Math.floor((n * i) / segCount);
    const to = Math.min(n - 1, Math.floor((n * (i + 1)) / segCount) - 1);
    const startPrice = prices[from];
    const endPrice = prices[Math.max(from, to)];
    f4.push(startPrice > 0 ? (endPrice / startPrice - 1) * 100 : 0);
  }

  // f5 量价比：上涨分钟成交量 / 下跌分钟成交量
  let upVol = 0;
  let downVol = 0;
  for (let i = 1; i < n; i += 1) {
    const vol = Math.max(0, Number(list[i].vol) || 0);
    if (prices[i] > prices[i - 1]) {
      upVol += vol;
    } else if (prices[i] < prices[i - 1]) {
      downVol += vol;
    }
  }
  const f5 = downVol > 0 ? upVol / downVol : upVol > 0 ? 9.99 : 1;

  // f6 日内振幅
  const f6 = (high - low) / prevClose;

  // f7 最大回撤
  let peak = prices[0];
  let f7 = 0;
  prices.forEach((p) => {
    if (p > peak) {
      peak = p;
    }
    if (peak > 0) {
      f7 = Math.max(f7, (peak - p) / peak);
    }
  });

  // f8 尾盘涨幅占比：最后 30 分钟涨幅 / 全天涨幅
  const tailStart = prices[Math.max(0, n - 30)];
  const dayChange = close - prevClose;
  const tailChange = close - tailStart;
  const f8 = Math.abs(dayChange) > 1e-6 ? tailChange / dayChange : 0;

  // f9 分时独立性
  let f9: number | undefined;
  const indexList = pickValid(params.indexTrends || []);
  if (indexList.length >= 30) {
    const stockRet = minuteReturns(list);
    const indexRet = minuteReturns(indexList);
    f9 = pearson(stockRet, indexRet);
  }

  const features: IntradayPatternFeatures = { f1, f2, f3, f4, f5, f6, f7, f8, f9 };

  // ===== 规则字典（形态 → 判据 + 满足程度）=====
  const maxPos = n > 1 ? prices.indexOf(high) / (n - 1) : 0;
  const minPos = n > 1 ? prices.indexOf(low) / (n - 1) : 0;
  const gap = open / prevClose - 1;
  const positiveSegs = f4.filter((v) => v > 0).length;
  const vwapDev = mean(
    list.map((t) => {
      const avg = Number(t.average) || 0;
      return avg > 0 ? Math.abs(Number(t.current) / avg - 1) : 0;
    })
  );

  interface Candidate {
    pattern: IntradayPatternName;
    margins: number[];
    reason: string;
  }
  const candidates: Candidate[] = [];

  // 强势上攻：f1>0.7 且 f4 多数为正 且 f5>1.2
  if (f1 > cfg.strongAboveRatio && positiveSegs * 2 > f4.length && f5 > cfg.strongVolRatio) {
    candidates.push({
      pattern: '强势上攻',
      margins: [
        (f1 - cfg.strongAboveRatio) / 0.3,
        (positiveSegs / f4.length - 0.5) * 2,
        (f5 - cfg.strongVolRatio) / 1.5,
      ],
      reason: `均价线上方 ${(f1 * 100).toFixed(0)}% / 正斜率 ${positiveSegs}/${f4.length} / 量价比 ${f5.toFixed(2)}`,
    });
  }

  // 高开低走：高开 且 f2<0.3 且 下跌放量
  if (gap > cfg.gapTh && f2 < cfg.closeLow && f5 < 1) {
    candidates.push({
      pattern: '高开低走',
      margins: [(gap - cfg.gapTh) / 0.03, (cfg.closeLow - f2) / 0.3, 1 - f5],
      reason: `高开 ${(gap * 100).toFixed(2)}% / 收盘位置 ${f2.toFixed(2)} / 量价比 ${f5.toFixed(2)}`,
    });
  }

  // 低开高走：低开 且 f2>0.7 且 尾盘拉升
  if (gap < -cfg.gapTh && f2 > cfg.closeHigh && (tailChange > 0 || f8 > 0.3)) {
    candidates.push({
      pattern: '低开高走',
      margins: [(-gap - cfg.gapTh) / 0.03, (f2 - cfg.closeHigh) / 0.3, Math.max(tailChange > 0 ? 0.3 : 0, (f8 - 0.3) / 0.7)],
      reason: `低开 ${(gap * 100).toFixed(2)}% / 收盘位置 ${f2.toFixed(2)} / 尾盘占比 ${f8.toFixed(2)}`,
    });
  }

  // 冲高回落：最高点在前 1/3 且 f2<0.5
  if (maxPos < 1 / 3 && f2 < cfg.closeMid) {
    candidates.push({
      pattern: '冲高回落',
      margins: [(1 / 3 - maxPos) / (1 / 3), (cfg.closeMid - f2) / 0.5],
      reason: `高点位置 ${(maxPos * 100).toFixed(0)}% / 收盘位置 ${f2.toFixed(2)}`,
    });
  }

  // V 型反转：最低点在中间且 f2>0.8
  if (minPos >= 1 / 3 && minPos <= (2 / 3) && f2 > cfg.closeV) {
    candidates.push({
      pattern: 'V型反转',
      margins: [1 - Math.abs(minPos - 0.5) / 0.5, (f2 - cfg.closeV) / 0.2],
      reason: `低点位置 ${(minPos * 100).toFixed(0)}% / 收盘位置 ${f2.toFixed(2)}`,
    });
  }

  // 尾盘偷袭：f8>0.5
  if (f8 > cfg.tailShare) {
    candidates.push({
      pattern: '尾盘偷袭',
      margins: [(f8 - cfg.tailShare) / 0.5],
      reason: `尾盘涨幅占全天 ${(f8 * 100).toFixed(0)}%`,
    });
  }

  // 横盘震荡：f6<0.03 且 全程贴近均价线
  if (f6 < cfg.flatAmp && vwapDev < cfg.flatVwapDev) {
    candidates.push({
      pattern: '横盘震荡',
      margins: [(cfg.flatAmp - f6) / cfg.flatAmp, (cfg.flatVwapDev - vwapDev) / cfg.flatVwapDev],
      reason: `振幅 ${(f6 * 100).toFixed(2)}% / 偏离均价 ${(vwapDev * 100).toFixed(2)}%`,
    });
  }

  if (!candidates.length) {
    return { pattern: '无明显形态', confidence: 0, features, reason: '未命中任何形态规则', complete };
  }

  // 多条命中时取置信度最高的一条（置信度 = 0.5 + 满足程度均值的一半）
  let best = candidates[0];
  let bestConf = 0;
  candidates.forEach((c) => {
    const conf = clamp(0.5 + mean(c.margins.map((m) => clamp(m, -1, 1))) * 0.5, 0.5, 0.95);
    if (conf > bestConf) {
      best = c;
      bestConf = conf;
    }
  });

  return { pattern: best.pattern, confidence: bestConf, features, reason: best.reason, complete };
}

/**
 * 量能签名（按约 5 分钟一段等分，最多 6 段）
 *
 * 窗口随分时推进变长：5~9 分钟 = 2 段、10~14 分钟 = 2 段、15~19 分钟 = 3 段 …
 * 30 分钟 = 6 段（与规格一致）。判据统一按「前半段量 / 后半段量」，
 * 保证不同窗口之间口径一致、可比较。
 */
function detectVolSignature(list: Stock.TrendItem[], windowMinutes: number): Early30VolSignature {
  const cfg = INTRADAY_CONFIG;
  const segMinutes = cfg.early30Window / cfg.early30VolSegments;
  const n = list.length;
  const segCount = Math.max(2, Math.min(cfg.early30VolSegments, Math.floor(windowMinutes / segMinutes)));
  if (n < segCount) {
    return 'flat';
  }
  const segVols: number[] = [];
  for (let i = 0; i < segCount; i += 1) {
    const from = Math.floor((n * i) / segCount);
    const to = Math.max(from + 1, Math.floor((n * (i + 1)) / segCount));
    segVols.push(list.slice(from, to).reduce((sum, t) => sum + Math.max(0, Number(t.vol) || 0), 0));
  }
  const half = Math.max(1, Math.floor(segCount / 2));
  const firstHalf = segVols.slice(0, half).reduce((s, v) => s + v, 0);
  const lastHalf = segVols.slice(segCount - half).reduce((s, v) => s + v, 0);
  if (firstHalf > lastHalf * cfg.early30VolRatio) {
    return 'decreasing';
  }
  if (lastHalf > firstHalf * cfg.early30VolRatio) {
    return 'increasing';
  }
  if (segCount >= 3) {
    const middle = segVols.slice(1, segCount - 1).reduce((s, v) => s + v, 0);
    const headTail = segVols[0] + segVols[segCount - 1];
    if (headTail > middle * cfg.early30UUsRatio) {
      return 'u_shape';
    }
  }
  return 'flat';
}

/**
 * 计算 C5b 开盘预测：窗口随分时推进动态增长（5 分钟起，最多 30 分钟）
 *
 * 只等 30 分钟会错过开盘第一波，所以每来一根新分时就用「已走出的分钟」重算一次：
 * 窗口从 5 分钟一路长到 30 分钟，之后固定用前 30 分钟（规格口径）。
 * 窗口越短样本越少，概率会向 0.5 收缩（见下方的 damp），不做过度解读。
 *
 * @param params.trends 当天分时（从 09:25/09:30 开始，传「截至当前时刻」的部分即可）
 * @param params.prevDayVol 昨日全天成交量（与分时 vol 同口径：手）
 * @param params.indexTrends 可选，指数分时，用于 f8 独立性
 */
export function ComputeEarly30Prediction(params: {
  trends: Stock.TrendItem[];
  prevDayVol: number;
  indexTrends?: Stock.TrendItem[];
}): Early30Result | null {
  const cfg = INTRADAY_CONFIG;
  const all = pickValid(params.trends);
  if (!all.length) {
    return null;
  }
  const minutes = all.map((t) => minuteOfDay(t.datetime));
  const hasTime = minutes.every((v) => Number.isFinite(v));
  const n = all.length;
  // 已走出的分钟数：有分时时间就按「距 09:30 多少分钟」算（09:25 的竞价点不重复计）
  const elapsed = hasTime ? Math.max(0, minutes[minutes.length - 1] - (9 * 60 + 30)) : n;
  const ready = elapsed >= cfg.early30MinWindow;
  // 动态窗口：够 5 分钟就出结果，随时间逐分钟变长，到 30 分钟为止
  const windowMinutes = clamp(elapsed, cfg.early30MinWindow, cfg.early30Window);

  // 只取该窗口内的分时（含 09:25 竞价点）
  const list = hasTime
    ? all.filter((_, i) => minutes[i] <= 9 * 60 + 30 + windowMinutes)
    : all.slice(0, Math.min(n, windowMinutes + 1));
  if (!list.length) {
    return null;
  }

  const prevDayVol = Number(params.prevDayVol) || 0;
  const prices = list.map((t) => Number(t.current) || 0);
  const size = prices.length;
  const open = prices[0];
  const cur = prices[size - 1];
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const returns = minuteReturns(list);

  // f1 开盘 5 分钟方向与幅度
  const f1 = open > 0 && size >= 5 ? prices[4] / open - 1 : 0;
  // f2 窗口内量 / 昨日全天量
  const windowVol = list.reduce((sum, t) => sum + Math.max(0, Number(t.vol) || 0), 0);
  const f2 = prevDayVol > 0 ? windowVol / prevDayVol : 0;
  // f3 均价线上方时间占比
  const f3 = mean(
    list.map((t) => {
      const avg = Number(t.average) || 0;
      return avg > 0 ? (Number(t.current) > avg ? 1 : 0) : 1;
    })
  );
  // f4 窗口前后半段波动率比（30 分钟窗口时即前后 15 分钟）
  const half = Math.max(1, Math.floor(returns.length / 2));
  const stdFirst = std(returns.slice(0, half));
  const stdNext = std(returns.slice(half));
  const f4 = stdNext > 0 ? stdFirst / stdNext : stdFirst > 0 ? 9.99 : 1;
  // f5 窗口内回撤
  const f5 = high > 0 ? (high - cur) / high : 0;
  // f6 上影线比例
  const f6 = high > low ? (high - cur) / (high - low) : 0;
  // f7 分钟收益一阶自相关
  let f7 = 0;
  if (returns.length >= 4) {
    const r = pearson(returns.slice(0, -1), returns.slice(1));
    f7 = r || 0;
  }
  // f8 分时独立性
  let f8: number | undefined;
  const indexList = pickValid(params.indexTrends || []).slice(0, list.length);
  if (indexList.length >= 10) {
    f8 = pearson(returns, minuteReturns(indexList));
  }

  const features: Early30Features = { f1, f2, f3, f4, f5, f6, f7, f8 };
  const volSignature = detectVolSignature(list, windowMinutes);

  // 最小规则版：窗口涨幅 / 量占昨日全天 两个阈值按窗口长度开方缩放
  // （10 分钟不可能用满 30 分钟的 3% 和 25%，否则前 20 分钟永远不命中）
  const scale = Math.sqrt(windowMinutes / cfg.early30Window);
  const retTh = cfg.early30RetTh * scale;
  const volShareTh = cfg.early30VolShareTh * scale;
  const ret30 = open > 0 ? cur / open - 1 : 0;
  const neverBelowVwap = list.every((t) => {
    const avg = Number(t.average) || 0;
    return avg <= 0 || Number(t.current) >= avg * 0.999;
  });
  const ruleHit = ret30 > retTh && f2 > volShareTh && neverBelowVwap;

  // ===== T1/T2/T3 概率（启发式，仅作排序参考）=====
  // 窗口越短越没有把握：logit 乘一个「完整度」，10 分钟时向 0.5 收缩
  const damp = clamp(0.35 + 0.65 * (windowMinutes / cfg.early30Window), 0.35, 1);
  const ret30Pct = ret30 * 100;
  const volTrend = volSignature === 'increasing' ? 1 : volSignature === 'decreasing' ? -1 : 0;
  const volHealthy = volSignature === 'increasing' ? 1 : volSignature === 'u_shape' ? 0.4 : 0;
  const t1 = sigmoid(
    (0.35 * ret30Pct + 1.2 * (f3 - 0.5) + 0.35 * volTrend + 0.5 * (ruleHit ? 1 : 0) - 1.5 * f5) * damp
  );
  const t2 = sigmoid(
    (2.5 * f5 +
      2 * f6 +
      0.6 * (f4 > 1.5 ? 1 : 0) +
      0.6 * (volSignature === 'decreasing' ? 1 : 0) -
      0.02 * ret30Pct -
      0.8) *
      damp
  );
  const t3 = sigmoid(
    (0.08 * ret30Pct + 1.4 * (f3 - 0.5) + 0.9 * volHealthy + 0.8 * (ruleHit ? 1 : 0) - 1.0 * f5 - 0.3) * damp
  );

  return {
    ready,
    windowMinutes,
    fullWindow: windowMinutes >= cfg.early30Window,
    probs: {
      T1: clamp(t1, 0.02, 0.98),
      T2: clamp(t2, 0.02, 0.98),
      T3: clamp(t3, 0.02, 0.98),
    },
    volSignature,
    ruleHit,
    features,
    ret30,
  };
}

/** 量能签名的中文标签 */
export const Early30VolSignatureNames: Record<Early30VolSignature, string> = {
  decreasing: '递减',
  increasing: '递增',
  u_shape: 'U 型',
  flat: '平稳',
};
