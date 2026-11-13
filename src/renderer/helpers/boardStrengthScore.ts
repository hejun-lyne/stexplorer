import * as Services from '@/services';
import { KLineType } from '@/utils/enums';
import { Stock } from '@/types/stock';
import { resolveRecentTradingDays, SHORT_SCORE_SOURCE } from './shortTermScoreList';

/**
 * 板块成份股强势度评分（《板块成份股强势度评分模型·实现说明 v1.0》的 TypeScript 实现）
 *
 * 口径要点（与文档一致，改动前请回看文档 §2/§4/§5）：
 * - 价格：数据源日K已是按最新复权因子归一的前复权价（等价于文档的 h_* = close × adj/adj[-1]），
 *   直接用于形态计算；涨跌停判定改用日K自带的 zdf（涨跌幅%，按未复权价算），不混用两套价格。
 * - 窗口：as_of 往前 N 个交易日（由调用方传入 N=fdays），基准期为窗口之前 60 个交易日。
 * - 停牌日：按交易日历对齐成 null，不插值、不填 0，分母按有效交易日数修正。
 * - 归一化：横截面 min-rank 百分位；稀疏计数用 pctCount；零方差分量从子指标中剔除（blend）。
 * - 双模式：scoreRel 用于板块内排序，scoreAbs 用于跨板块/等级判定与板块聚合。
 * - 数据源没有板块指数日线与 up_limit，涨跌停按 zdf + 档位推算；与 §9 参考实现一致，
 *   Bonus（B1~B4）恒为 0、P3 高位涨停不单独扣分，保证与 §13 合成数据实测值同口径。
 * - 板块内有效样本 < 10 只时百分位会退化，按 §10 陷阱 12 改用绝对分排序。
 */

/** 模型默认参数（文档 §9 CFG） */
export const BOARD_STRENGTH_CONFIG = {
  thBodyCoef: 0.4,
  thBodyFloor: 0.03,
  bigBodyRel: 1.5,
  gapCoef: 0.1,
  gapFloor: 0.005,
  baseDays: 60,
  minValidDays: 10,
  maxSuspendRatio: 0.2,
  w1: 0.25,
  w2: 0.25,
  w3: 0.2,
  w4: 0.3,
  wS1: [0.6, 0.4],
  wS2: [0.45, 0.25, 0.3],
  wS3: [0.3, 0.25, 0.2, 0.25],
  wS4: [0.7, 0.3],
  penCumRet: 0.4,
  penCumCap: 20,
  penLast3: 8,
  penLast3Ratio: 0.7,
  penLast5: 6,
  penLast5Ratio: 0.85,
  bonusCap: 10,
} as const;

/** 绝对模式分段曲线（文档 §6.3），升序 */
const ABS_CURVES: Record<string, [number, number][]> = {
  up_body_ratio: [[0.1, 0], [0.25, 15], [0.35, 30], [0.45, 48], [0.55, 68], [0.65, 86], [0.8, 100]],
  up_chg_ratio: [[0.1, 0], [0.25, 15], [0.35, 30], [0.45, 48], [0.55, 68], [0.65, 86], [0.8, 100]],
  consec_score: [[0, 35], [1, 45], [3, 60], [6, 78], [10, 90], [15, 100]],
  n_big_yang: [[0, 35], [1, 55], [2, 70], [3, 82], [5, 93], [7, 100]],
  n_limit_up: [[0, 40], [1, 65], [2, 85], [3, 95], [4, 100]],
  n_gap_up: [[0, 40], [1, 62], [2, 82], [3, 100]],
  n_gap_unfilled: [[0, 40], [1, 70], [2, 90], [3, 100]],
  sum_gap_pct: [[0, 35], [0.01, 52], [0.03, 70], [0.06, 86], [0.1, 100]],
  trend_ret: [[-0.1, 0], [0.0, 30], [0.08, 50], [0.15, 65], [0.25, 80], [0.4, 100]],
};

/** 评分输入：板块成份股名单 */
export interface BoardStrengthItem {
  code: string;
  name?: string;
}

/** 单只股票的强势度结果（结果列表「强势度」列直接读 scoreRel） */
export interface BoardStrengthScore {
  code: string;
  name: string;
  /** 相对分 0~100（板块内横截面百分位合成，排序用） */
  scoreRel: number | null;
  /** 绝对分 0~100（固定阈值曲线，等级判定与板块聚合用） */
  scoreAbs: number | null;
  /** 等级 A~E（作用于 scoreAbs） */
  grade: string;
  s1: number | null;
  s2: number | null;
  s3: number | null;
  s4: number | null;
  bonus: number;
  penalty: number;
  rank: number | null;
  pct: number | null;
  cumRet: number | null;
  upBodyRatio: number | null;
  upChgRatio: number | null;
  consecScore: number;
  nBigYang: number;
  nLimitUp: number;
  nGapUp: number;
  nGapUnfilled: number;
  sumGapPct: number;
  gapFadeRatio: number;
  trendRet: number;
  r2: number;
  accel: number;
  slopeQuality: number;
  last3Ratio: number;
  last5Ratio: number;
  pathEr: number;
  validDays: number;
  window: number;
  flags: string[];
  excludedReason: string;
}

/** 板块整体强势度（一律用 scoreAbs 聚合） */
export interface BoardStrengthSummary {
  asOf: string;
  window: number;
  tradingDays: string[];
  n: number;
  sectorMedian: number | null;
  sectorMean: number | null;
  strongRatio: number | null;
  dispersion: number | null;
  top3: string[];
}

export interface BoardStrengthResult {
  scores: Record<string, BoardStrengthScore>;
  summary: BoardStrengthSummary;
}

/** 按交易日历对齐后的单日数据（null = 停牌，不插值） */
interface BarSlot {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
  amount: number;
  hsl: number;
  zdf: number;
  preClose: number;
  preHigh: number;
  ret: number;
  body: number;
  bodyPct: number;
  absBodyPct: number;
  openPct: number;
  limitUp: boolean;
  yizi: boolean;
  bigYang: boolean;
  gapUnfilled: boolean;
  volPrev5: number;
}

type Slot = BarSlot | null;

interface AtomicMetrics {
  nValid: number;
  suspendRatio: number;
  upBodyRatio: number;
  upChgRatio: number;
  consecScore: number;
  nBigYang: number;
  maxConsec: number;
  nLimitUp: number;
  nGapUp: number;
  nGapTrue: number;
  nGapUnfilled: number;
  sumGapPct: number;
  gapFadeRatio: number;
  nGapFilled: number;
  slopeB: number;
  trendRet: number;
  r2: number;
  tstat: number;
  accel: number;
  slopeQuality: number;
  cumRet: number;
  last3Ratio: number;
  last5Ratio: number;
  pathEr: number;
  nUpperShadow: number;
  nVolDump: number;
  turnoverAvg: number;
  amountAvg: number;
  isYiziRecent: boolean;
  isIgnition: boolean;
  noBenchmark: boolean;
}

interface ScoreRow {
  code: string;
  name: string;
  m: AtomicMetrics;
  excludedReason: string;
  score: BoardStrengthScore;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function quantile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * clamp(p, 0, 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/** 对数价 OLS：斜率、R²、t 值（文档 §3.4） */
function ols(y: number[]): { b: number; r2: number; tstat: number } {
  const n = y.length;
  if (n < 3) return { b: 0, r2: 0, tstat: 0 };
  const mt = (n - 1) / 2;
  const my = mean(y);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (i - mt) ** 2;
    sxy += (i - mt) * (y[i] - my);
  }
  if (sxx <= 1e-12) return { b: 0, r2: 0, tstat: 0 };
  const b = sxy / sxx;
  const a = my - b * mt;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssRes += (y[i] - (a + b * i)) ** 2;
    ssTot += (y[i] - my) ** 2;
  }
  const r2 = ssTot > 1e-12 ? 1 - ssRes / ssTot : 0;
  const se = Math.sqrt(ssRes / Math.max(n - 2, 1) / sxx);
  const tstat = se > 1e-12 && Number.isFinite(se) ? b / se : 0;
  return { b, r2, tstat };
}

/** 连续 True 的游程长度 */
function runLengths(flags: boolean[]): number[] {
  const out: number[] = [];
  let run = 0;
  for (const f of flags) {
    if (f) run += 1;
    else if (run) {
      out.push(run);
      run = 0;
    }
  }
  if (run) out.push(run);
  return out;
}

/** 0-based min-rank：并列取最靠前的名次（文档 §4.1，不能用 average-rank） */
function minRanks(values: number[]): number[] {
  const n = values.length;
  const ranks = new Array<number>(n).fill(0);
  if (n <= 1) return ranks;
  const sorted = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && sorted[j].v === sorted[i].v) j += 1;
    for (let k = i; k < j; k++) ranks[sorted[k].i] = i;
    i = j;
  }
  return ranks;
}

/** 横截面百分位 0~100 */
function pctSeries(values: number[]): number[] {
  const n = values.length;
  if (n <= 1) return values.map(() => 50);
  return minRanks(values).map((r) => (r / (n - 1)) * 100);
}

/**
 * 稀疏计数指标专用归一化（文档 §4.2）
 * 0 值锚定 35（常态、中性偏低），非零值排到 45~100，保证「有 1 根」高于「一根都没有」
 */
function pctCountSeries(values: number[], zeroScore = 35): number[] {
  const out = values.map(() => zeroScore);
  const idx = values.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 1) {
    out[idx[0]] = 100;
  } else if (idx.length > 1) {
    const ranks = minRanks(idx.map((i) => values[i]));
    idx.forEach((i, k) => {
      out[i] = 45 + 55 * (ranks[k] / (idx.length - 1));
    });
  }
  return out;
}

/** 子指标合成：剔除零方差分量后权重重归一（文档 §4.5） */
function blendSeries(parts: { values: number[]; w: number }[]): number[] {
  const n = parts[0]?.values.length || 0;
  const acc = new Array<number>(n).fill(0);
  let totalW = 0;
  for (const p of parts) {
    if (std(p.values) < 1e-9) continue;
    totalW += p.w;
    for (let i = 0; i < n; i++) acc[i] += p.values[i] * p.w;
  }
  if (!totalW) return new Array<number>(n).fill(50);
  return acc.map((v) => v / totalW);
}

/** 绝对模式分段线性映射，超出端点取端点值 */
function absMap(v: number, points: [number, number][]): number {
  if (!points.length) return 0;
  if (v <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x0, y0] = points[i - 1];
    if (v <= x1) {
      return x1 === x0 ? y1 : y0 + ((v - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

/** 涨跌幅档位（文档 §2.3）；ST 名称优先 */
function limitPctOf(code: string, name: string): number {
  if (/ST/i.test(name)) return 0.05;
  if (/^(300|301|688|689)/.test(code)) return 0.2;
  if (/^(4|8|920)/.test(code)) return 0.3;
  return 0.1;
}

const secidOf = (code: string) => (code.startsWith('6') ? `1.${code}` : `0.${code}`);
const dayKeyOf = (date: string) => String(date || '').replace(/-/g, '').substring(0, 8);

/** 按交易日历把日K对齐成窗口序列：停牌日为 null */
function alignBars(klines: Stock.KLineItem[], days: string[]): Slot[] {
  const byDate = new Map<string, Stock.KLineItem>();
  (klines || []).forEach((k) => {
    if (k && k.date) byDate.set(dayKeyOf(k.date), k);
  });
  let prevClose = 0;
  let prevHigh = 0;
  const vols: number[] = [];
  return days.map((d) => {
    const k = byDate.get(d);
    if (!k) return null;
    const open = num(k.kp);
    const high = num(k.zg);
    const low = num(k.zd);
    const close = num(k.sp);
    if (!(open > 0 && high > 0 && low > 0 && close > 0)) return null;
    const preClose = prevClose > 0 ? prevClose : close;
    const preHigh = prevHigh > 0 ? prevHigh : high;
    const volPrev5 = mean(vols.slice(-5));
    vols.push(num(k.cjl));
    prevClose = close;
    prevHigh = high;
    return {
      date: d,
      open,
      high,
      low,
      close,
      vol: num(k.cjl),
      amount: num(k.cje),
      hsl: num(k.hsl),
      zdf: num(k.zdf),
      preClose,
      preHigh,
      ret: preClose > 0 ? close / preClose - 1 : 0,
      body: close - open,
      bodyPct: open > 0 ? (close - open) / open : 0,
      absBodyPct: open > 0 ? Math.abs(close - open) / open : 0,
      openPct: preClose > 0 ? open / preClose - 1 : 0,
      limitUp: false,
      yizi: false,
      bigYang: false,
      gapUnfilled: false,
      volPrev5,
    };
  });
}

/** 原子指标（文档 §3 + §5 的上下文诊断量） */
function atomicMetrics(windowSlots: Slot[], baseSlots: Slot[], limitPct: number, cfg: typeof BOARD_STRENGTH_CONFIG): AtomicMetrics {
  const slots = windowSlots.filter((s): s is BarSlot => !!s);
  const nValid = slots.length;
  const empty: AtomicMetrics = {
    nValid,
    suspendRatio: windowSlots.length ? 1 - nValid / windowSlots.length : 1,
    upBodyRatio: 0, upChgRatio: 0, consecScore: 0, nBigYang: 0, maxConsec: 0, nLimitUp: 0,
    nGapUp: 0, nGapTrue: 0, nGapUnfilled: 0, sumGapPct: 0, gapFadeRatio: 0, nGapFilled: 0,
    slopeB: 0, trendRet: 0, r2: 0, tstat: 0, accel: 0, slopeQuality: 0,
    cumRet: 0, last3Ratio: 0, last5Ratio: 0, pathEr: 0, nUpperShadow: 0, nVolDump: 0,
    turnoverAvg: 0, amountAvg: 0, isYiziRecent: false, isIgnition: false, noBenchmark: true,
  };
  if (nValid < 3) return empty;

  const baseValid = baseSlots.filter((s): s is BarSlot => !!s);
  const noBenchmark = baseValid.length < 20;
  const baseBody = Math.max(noBenchmark ? median(slots.map((s) => s.absBodyPct)) : median(baseValid.map((s) => s.absBodyPct)), 1e-4);
  const thBody = Math.max(cfg.thBodyFloor, cfg.thBodyCoef * limitPct);
  const thGap = Math.max(cfg.gapFloor, cfg.gapCoef * limitPct);
  const limitZdf = limitPct * 100 - 0.5;

  // 逐日派生：涨跌停必须用涨跌幅（未复权口径），布尔组合每一段都加括号（文档 §14 陷阱 4）
  const bigFlags: boolean[] = [];
  const gapFlags: boolean[] = [];
  let nLimitUp = 0;
  let nGapUp = 0;
  let nGapTrue = 0;
  let nGapUnfilled = 0;
  let sumGapPct = 0;
  let nFade = 0;
  let nUpperShadow = 0;
  let nVolDump = 0;
  slots.forEach((s) => {
    s.limitUp = (s.zdf >= limitZdf) || (Math.abs(s.zdf) < 1e-9 && s.ret >= limitPct - 0.005);
    s.yizi = s.limitUp && (s.high - s.low <= Math.max(0.01, s.close * 0.002)) && s.close >= s.high * 0.999;
    s.bigYang =
      s.body > 0 &&
      s.bodyPct >= thBody &&
      s.bodyPct >= cfg.bigBodyRel * baseBody &&
      s.close > s.preClose;
    const weakGapUp = s.openPct >= thGap;
    const trueGap = weakGapUp && s.open > s.preHigh;
    s.gapUnfilled = trueGap && s.low > s.preHigh;
    bigFlags.push(s.bigYang);
    gapFlags.push(trueGap);
    if (s.limitUp) nLimitUp += 1;
    if (weakGapUp) nGapUp += 1;
    if (trueGap) nGapTrue += 1;
    if (s.gapUnfilled) {
      nGapUnfilled += 1;
      sumGapPct += s.openPct;
    }
    if (weakGapUp && s.close < s.open) nFade += 1;
    const bodyAbs = Math.abs(s.body);
    if (bodyAbs > 1e-9 && s.high - Math.max(s.open, s.close) > 2 * bodyAbs) nUpperShadow += 1;
    if (s.ret < -0.05 && s.volPrev5 > 0 && s.vol >= 2 * s.volPrev5) nVolDump += 1;
  });

  const runs = runLengths(bigFlags);
  const consecScore = runs.filter((r) => r >= 2).reduce((sum, r) => sum + (r * (r + 1)) / 2, 0);
  // 缺口回补只看窗口内后续交易日（文档 §3.3，禁止未来函数）
  let nGapFilled = 0;
  let validIdx = 0;
  windowSlots.forEach((s, i) => {
    if (!s) return;
    const idx = validIdx;
    validIdx += 1;
    if (!gapFlags[idx]) return;
    // 只看窗口内后续交易日，缺口被回补说明该价位买盘已消化完毕
    for (let j = i + 1; j < windowSlots.length; j++) {
      const later = windowSlots[j];
      if (later && later.low <= s.preHigh + 1e-9) {
        nGapFilled += 1;
        break;
      }
    }
  });

  const closes = slots.map((s) => s.close);
  const y = closes.map((c) => Math.log(Math.max(c, 1e-6)));
  const { b, r2, tstat } = ols(y);
  const trendRet = Math.exp(b * y.length) - 1;
  const half = Math.floor(y.length / 2);
  const accel = half >= 5 ? ols(y.slice(-half)).b - b : 0;
  const slopeQuality = trendRet * (0.5 + 0.5 * clamp(r2, 0, 1));

  const cumRet = closes.length >= 2 ? closes[closes.length - 1] / closes[0] - 1 : 0;
  const last3Ratio = closes.length >= 4 && cumRet > 1e-6 ? (closes[closes.length - 1] / closes[closes.length - 4] - 1) / cumRet : 0;
  const last5Ratio = closes.length >= 6 && cumRet > 1e-6 ? (closes[closes.length - 1] / closes[closes.length - 6] - 1) / cumRet : 0;
  const totalAbsRet = slots.reduce((sum, s) => sum + Math.abs(s.ret), 0);
  const pathEr = totalAbsRet > 1e-9 ? Math.abs(cumRet) / totalAbsRet : 0;

  // 启动诊断（文档 §11.3，只打标不进总分）
  const head = slots.slice(0, Math.max(1, Math.floor(slots.length * 2 / 3)));
  const headRet = head.length >= 2 ? head[head.length - 1].close / head[0].close - 1 : 0;
  const tail = slots.slice(-3);
  const isIgnition =
    headRet < 0.05 &&
    tail.some((s) => (s.bigYang || s.gapUnfilled) && s.volPrev5 > 0 && s.vol >= 1.5 * s.volPrev5);

  return {
    nValid,
    suspendRatio: windowSlots.length ? 1 - nValid / windowSlots.length : 1,
    upBodyRatio: slots.filter((s) => s.body > 0).length / nValid,
    upChgRatio: slots.filter((s) => s.ret > 0).length / nValid,
    consecScore,
    nBigYang: bigFlags.filter(Boolean).length,
    maxConsec: runs.length ? Math.max(...runs) : 0,
    nLimitUp,
    nGapUp,
    nGapTrue,
    nGapUnfilled,
    sumGapPct,
    gapFadeRatio: nFade / Math.max(nGapUp, 1),
    nGapFilled,
    slopeB: b,
    trendRet,
    r2,
    tstat,
    accel,
    slopeQuality,
    cumRet,
    last3Ratio,
    last5Ratio,
    pathEr,
    nUpperShadow,
    nVolDump,
    turnoverAvg: mean(slots.map((s) => s.hsl)),
    amountAvg: mean(slots.map((s) => s.amount)),
    isYiziRecent: slots.slice(-2).some((s) => s.yizi),
    isIgnition,
    noBenchmark,
  };
}

function emptyScore(item: BoardStrengthItem, window: number, reason: string): BoardStrengthScore {
  return {
    code: item.code,
    name: item.name || item.code,
    scoreRel: null,
    scoreAbs: null,
    grade: '-',
    s1: null, s2: null, s3: null, s4: null,
    bonus: 0, penalty: 0, rank: null, pct: null, cumRet: null,
    upBodyRatio: null, upChgRatio: null,
    consecScore: 0, nBigYang: 0, nLimitUp: 0, nGapUp: 0, nGapUnfilled: 0,
    sumGapPct: 0, gapFadeRatio: 0, trendRet: 0, r2: 0, accel: 0, slopeQuality: 0,
    last3Ratio: 0, last5Ratio: 0, pathEr: 0,
    validDays: 0, window,
    flags: [],
    excludedReason: reason,
  };
}

function makeScore(
  code: string,
  name: string,
  m: AtomicMetrics,
  reason: string,
  window: number
): BoardStrengthScore {
  return {
    code,
    name,
    scoreRel: null,
    scoreAbs: null,
    grade: '-',
    s1: null, s2: null, s3: null, s4: null,
    bonus: 0, penalty: 0, rank: null, pct: null,
    cumRet: m.cumRet,
    upBodyRatio: m.upBodyRatio,
    upChgRatio: m.upChgRatio,
    consecScore: m.consecScore,
    nBigYang: m.nBigYang,
    nLimitUp: m.nLimitUp,
    nGapUp: m.nGapUp,
    nGapUnfilled: m.nGapUnfilled,
    sumGapPct: m.sumGapPct,
    gapFadeRatio: m.gapFadeRatio,
    trendRet: m.trendRet,
    r2: m.r2,
    accel: m.accel,
    slopeQuality: m.slopeQuality,
    last3Ratio: m.last3Ratio,
    last5Ratio: m.last5Ratio,
    pathEr: m.pathEr,
    validDays: m.nValid,
    window,
    flags: [],
    excludedReason: reason,
  };
}

function gradeOf(abs: number): string {
  if (abs >= 80) return 'A';
  if (abs >= 70) return 'B';
  if (abs >= 60) return 'C';
  if (abs >= 45) return 'D';
  return 'E';
}

/**
 * 计算板块成份股强势度
 *
 * @param items      成份股名单（板块成份股快照，横截面归一化就在该名单内部做）
 * @param windowDays 回看周期 N（当前日期往前 N 个交易日，调用方传 fdays）
 * @param onProgress 进度回调
 * @param shouldStop 由调用方在板块切换时中止
 * @param skipLastDay 训练时钟未走到 15:00 时置 true：基准日回退到上一交易日，
 *                    避免把训练日当天的完整日K（此时属于未来数据）算进窗口
 */
export async function computeBoardStrengthScores(
  items: BoardStrengthItem[],
  windowDays: number,
  options?: {
    onProgress?: (done: number, total: number) => void;
    shouldStop?: () => boolean;
    skipLastDay?: boolean;
  }
): Promise<BoardStrengthResult> {
  const cfg = BOARD_STRENGTH_CONFIG;
  const n = Math.max(1, Math.floor(num(windowDays)));
  const scores: Record<string, BoardStrengthScore> = {};
  const emptySummary = (asOf: string, days: string[]): BoardStrengthSummary => ({
    asOf, window: n, tradingDays: days, n: 0,
    sectorMedian: null, sectorMean: null, strongRatio: null, dispersion: null, top3: [],
  });
  if (!items.length) return { scores, summary: emptySummary('', []) };

  // 交易日历：基准日（训练模式为训练日，否则真实今天）往前 N+60 个交易日，
  // 后 N 个是评分窗口，前面 60 个是大阳阈值的基准期（基准期必须落在窗口之前）
  let allDays: string[] = [];
  const needed = n + cfg.baseDays + (options?.skipLastDay ? 1 : 0);
  try {
    allDays = await resolveRecentTradingDays(SHORT_SCORE_SOURCE, needed);
    // 先回退「尚未收盘的当前交易日」，再取最后 N+60 个交易日，窗口与基准期都随之整体前移
    if (options?.skipLastDay && allDays.length === needed) {
      allDays = allDays.slice(0, -1);
    }
  } catch (e) {
    console.error('[强势度] 交易日历取数失败', e);
  }
  let asOf = allDays[allDays.length - 1] || '';
  if (!asOf) {
    items.forEach((it) => { scores[it.code] = emptyScore(it, n, 'no_calendar'); });
    return { scores, summary: emptySummary('', []) };
  }
  if (options?.shouldStop?.()) return { scores, summary: emptySummary(asOf, []) };

  const endDate = `${asOf.substring(0, 4)}-${asOf.substring(4, 6)}-${asOf.substring(6, 8)}`;
  const limit = Math.min(250, Math.max(30, allDays.length + 15));
  const secids = items.map((it) => secidOf(it.code));
  // 一次 IPC 批量取日K；超大股票池分批，避免单次请求体过大
  const klineMap: Record<string, Stock.KLineItem[]> = {};
  for (let i = 0; i < secids.length; i += 200) {
    const chunk = secids.slice(i, i + 200);
    try {
      const batch = await Services.Tushare.BatchGetKFromTushare(chunk, endDate, limit, KLineType.Day);
      chunk.forEach((sid) => {
        const ks = batch?.[sid];
        if (Array.isArray(ks) && ks.length) klineMap[sid] = ks;
      });
    } catch (e) {
      console.error('[强势度] 批量日K取数失败', e);
    }
    if (options?.shouldStop?.()) return { scores, summary: emptySummary(asOf, []) };
  }

  // 尾部交易日若大多数成份股还没有日K（盘中 / 训练日未收盘 / 数据源延迟），整体回退一个交易日：
  // 既避免把「当天没数据」算成大面积停牌，也避免误用当天尚未走完的日K（未来数据）
  const sampleSets = Object.values(klineMap)
    .slice(0, 50)
    .map((ks) => new Set(ks.map((k) => dayKeyOf(k.date))));
  if (sampleSets.length) {
    const covered = (d: string) => sampleSets.filter((set) => set.has(d)).length / sampleSets.length;
    while (allDays.length > n + 5 && covered(allDays[allDays.length - 1]) < 0.5) {
      allDays = allDays.slice(0, -1);
    }
  }
  asOf = allDays[allDays.length - 1] || asOf;
  if (options?.shouldStop?.()) return { scores, summary: emptySummary(asOf, []) };

  const rows: ScoreRow[] = [];
  // 文档默认 N=20 / min_valid_days=10；本应用的 N 由 fdays 决定（默认 8），
  // 固定 10 会把所有股票判成「数据不足」，因此按比例收缩且至少 3 天（OLS 的最小样本）
  const minValidDays = Math.max(3, Math.min(cfg.minValidDays, Math.ceil(n * 0.6)));
  const win = allDays.slice(-n);
  items.forEach((it, idx) => {
    const code = String(it.code || '').trim();
    const name = it.name || code;
    const item = { code, name };
    if (!code) return;
    const ks = klineMap[secidOf(code)] || [];
    if (ks.length < n + 5) {
      scores[code] = emptyScore(item, n, 'history_short');
      return;
    }
    const aligned = alignBars(ks, allDays);
    const windowSlots = aligned.slice(-n);
    const baseSlots = aligned.length > n ? aligned.slice(0, -n) : [];
    const m = atomicMetrics(windowSlots, baseSlots, limitPctOf(code, name), cfg);
    let reason = '';
    if (m.nValid < minValidDays) reason = 'valid_days_short';
    else if (m.suspendRatio > cfg.maxSuspendRatio) reason = 'suspend_heavy';
    else if (/ST/i.test(name)) reason = 'st';
    const score = makeScore(code, name, m, reason, n);
    scores[code] = score;
    if (!reason) rows.push({ code, name, m, excludedReason: '', score });
    options?.onProgress?.(idx + 1, items.length);
  });

  const valid = rows.filter((r) => !r.excludedReason);
  const summary = emptySummary(asOf, win);
  if (!valid.length) return { scores, summary };

  const pick = (f: (m: AtomicMetrics) => number) => valid.map((r) => f(r.m));
  const fadeScores = pick((m) => (1 - clamp(m.gapFadeRatio, 0, 1)) * 100);

  // 相对模式：横截面百分位 + 稀疏计数 + 零方差剔除
  const s1 = blendSeries([
    { values: pctSeries(pick((m) => m.upBodyRatio)), w: cfg.wS1[0] },
    { values: pctSeries(pick((m) => m.upChgRatio)), w: cfg.wS1[1] },
  ]);
  const s2 = blendSeries([
    { values: pctCountSeries(pick((m) => m.consecScore)), w: cfg.wS2[0] },
    { values: pctCountSeries(pick((m) => m.nBigYang)), w: cfg.wS2[1] },
    { values: pctCountSeries(pick((m) => m.nLimitUp)), w: cfg.wS2[2] },
  ]);
  const s3 = blendSeries([
    { values: pctCountSeries(pick((m) => m.nGapUp)), w: cfg.wS3[0] },
    { values: pctCountSeries(pick((m) => m.nGapUnfilled)), w: cfg.wS3[1] },
    { values: pctCountSeries(pick((m) => m.sumGapPct)), w: cfg.wS3[2] },
    { values: fadeScores, w: cfg.wS3[3] },
  ]);
  const s4 = blendSeries([
    { values: pctSeries(pick((m) => m.slopeQuality)), w: cfg.wS4[0] },
    { values: pctSeries(pick((m) => m.accel)), w: cfg.wS4[1] },
  ]);

  // 绝对模式：固定阈值分段曲线
  const s1Abs = pick((m) => cfg.wS1[0] * absMap(m.upBodyRatio, ABS_CURVES.up_body_ratio) + cfg.wS1[1] * absMap(m.upChgRatio, ABS_CURVES.up_chg_ratio));
  const s2Abs = pick(
    (m) =>
      cfg.wS2[0] * absMap(m.consecScore, ABS_CURVES.consec_score) +
      cfg.wS2[1] * absMap(m.nBigYang, ABS_CURVES.n_big_yang) +
      cfg.wS2[2] * absMap(m.nLimitUp, ABS_CURVES.n_limit_up)
  );
  const s3Abs = pick(
    (m) =>
      cfg.wS3[0] * absMap(m.nGapUp, ABS_CURVES.n_gap_up) +
      cfg.wS3[1] * absMap(m.nGapUnfilled, ABS_CURVES.n_gap_unfilled) +
      cfg.wS3[2] * absMap(m.sumGapPct, ABS_CURVES.sum_gap_pct) +
      cfg.wS3[3] * (100 - m.gapFadeRatio * 100)
  );
  const s4Abs = pick(
    (m) => cfg.wS4[0] * absMap(m.slopeQuality, ABS_CURVES.trend_ret) + cfg.wS4[1] * clamp(50 + m.accel * 500, 0, 100)
  );

  // 样本 < 10 只时百分位会退化成几个离散档位（文档 §10 陷阱 12）：改用绝对模式排序
  const smallSample = valid.length < 10;
  valid.forEach((r, i) => {
    const { m, score } = r;
    // 位置透支惩罚（文档 §5.1 / §9 参考实现）
    let penalty = Math.min(cfg.penCumCap, (Math.max(0, m.cumRet - cfg.penCumRet) / cfg.penCumRet) * cfg.penCumCap);
    penalty += Math.max(
      m.last3Ratio >= cfg.penLast3Ratio ? cfg.penLast3 : 0,
      m.last5Ratio >= cfg.penLast5Ratio ? cfg.penLast5 : 0
    );
    if (m.pathEr < 0.25 && m.nBigYang >= 2) penalty += m.pathEr < 0.15 ? 10 : 6;
    if (m.nUpperShadow >= 2) penalty += 5;
    if (m.nVolDump >= 1) penalty += 8;
    if (m.turnoverAvg > 20) penalty += 5;
    // B1~B4 需要板块指数与均线数据，v1.0 参考实现里 Bonus 恒为 0（文档 §5.2 / §9）
    const bonus = 0;

    score.s1 = s1[i];
    score.s2 = s2[i];
    score.s3 = s3[i];
    score.s4 = s4[i];
    score.bonus = bonus;
    score.penalty = penalty;
    score.scoreRel = clamp(cfg.w1 * s1[i] + cfg.w2 * s2[i] + cfg.w3 * s3[i] + cfg.w4 * s4[i] + bonus - penalty, 0, 100);
    score.scoreAbs = clamp(cfg.w1 * s1Abs[i] + cfg.w2 * s2Abs[i] + cfg.w3 * s3Abs[i] + cfg.w4 * s4Abs[i] + bonus - penalty, 0, 100);
    if (smallSample) score.scoreRel = score.scoreAbs;
    score.grade = gradeOf(score.scoreAbs);
    const flags: string[] = [];
    if (m.isYiziRecent) flags.push('is_yizi_recent');
    if (m.amountAvg > 0 && m.amountAvg < 3e8) flags.push('liquidity_fail');
    if (m.cumRet < -0.25) flags.push('weak');
    if (m.noBenchmark) flags.push('no_benchmark');
    if (m.isIgnition) flags.push('is_ignition');
    if (smallSample) flags.push('small_sample_abs');
    score.flags = flags;
    scores[r.code] = score;
  });

  // 排名（按 scoreRel 降序，并列取 min-rank），板块聚合一律用 scoreAbs
  const ranked = [...valid].sort((a, b) => (b.score.scoreRel || 0) - (a.score.scoreRel || 0));
  ranked.forEach((r, i) => {
    const tied = i > 0 && (ranked[i - 1].score.scoreRel || 0) === (r.score.scoreRel || 0);
    r.score.rank = tied ? (ranked[i - 1].score.rank as number) : i + 1;
    r.score.pct = ((ranked.length - i) / ranked.length) * 100;
    scores[r.code] = r.score;
  });
  const absValues = valid.map((r) => r.score.scoreAbs as number);
  summary.n = valid.length;
  summary.sectorMedian = median(absValues);
  summary.sectorMean = mean(absValues);
  summary.strongRatio = absValues.filter((v) => v >= 70).length / absValues.length;
  summary.dispersion = quantile(absValues, 0.75) - quantile(absValues, 0.25);
  summary.top3 = ranked.slice(0, 3).map((r) => r.code);
  return { scores, summary };
}
