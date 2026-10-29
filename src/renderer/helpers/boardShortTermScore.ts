import * as Services from '@/services';
import { FundApiType, KLineType } from '@/utils/enums';
import { Stock } from '@/types/stock';
import dayjs from 'dayjs';
import * as TrainFilter from '@/utils/trainFilter';
import * as Score from './shortTermScore';
import {
  buildTrendBar,
  describeLatestKlineShape,
  fetchTrendsOfSource,
  isLatestVolumeExpanded,
  isTradeDayOn,
  klinesCoverDay,
  mergeTrendBar,
  resolveRecentTradingDays,
} from './shortTermScoreList';

// ==================== 板块短线评分（BKList 专用） ====================
//
// 与 STList 的「短线评分」同一套思路，但评分对象是「板块」而不是个股：
// 板块没有「自身相对所属板块」的概念，因此把个股维度换成板块自身的
// 趋势择时位置 + 主力资金 + 量能活跃度，RSI 仅作展示参考（权重最低）。
//
// 维度与权重（缺失维度按剩余权重归一化，与个股短线评分一致）：
//   板块趋势位置 35 分：复用 scoreSector 的趋势判定（MA20 多空分界）与「距反转点/追高」衰减
//   主力资金     35 分：板块主力净流入日序列的拐点/趋势/连续性/位置
//   量能活跃度   20 分：复用 scoreStockVolume 的纵向量能趋势 + 放量启动择时修正
//   RSI 指标     10 分：复用 scoreStockRsi 的形态识别（超买追高同样下调）
//
// 一票否决：板块趋势已被判定为持续下跌（scoreSector 的 down 档）时，总分封顶 55，
// 与个股短线评分的「个股走弱触发一票否决」对应（板块走弱时，资金/量能再好也不适合短线参与）。

/** 行结构版本：新增/变更展示字段或评分口径时递增（界面缓存/调试时可识别） */
export const BOARD_SCORE_ROW_VERSION = 4;

/** 板块短线评分输入项 */
export interface BoardScoreItem {
  secid: string; // 如 90.BK0428
  code: string; // 如 BK0428
  name: string;
}

/** 板块短线评分行（BKList 展示用） */
export interface BoardScoreRow {
  secid: string;
  code: string;
  name: string;
  total: number | null; // 综合评分 0~100
  grade: string; // A/B/C/D
  advice: string;
  summary: string;
  /** 板块趋势位置得分（0~72，含追高衰减后的趋势分） */
  trendScore: number | null;
  trendType: Score.SectorTrendType | '';
  trendDesc: string;
  /** 择时位置说明（距阶段低点涨幅/天数、MA20乖离） */
  positionDesc: string;
  /** 量能活跃度得分（0~30） */
  volumeScore: number | null;
  volumeNote: string;
  /** RSI 得分（0~40） */
  rsiScore: number | null;
  rsiPattern: string;
  /** 主力资金得分（0~30） */
  moneyScore: number | null;
  moneyNote: string;
  main5: number | null; // 近5日主力净流入（元）
  main10: number | null;
  main20: number | null;
  /** 数据未就绪（板块日K不足 / 取数失败）：分值留空，下次运行会重新计算 */
  pending?: boolean;
  error?: string;
  /** 最新交易日单根K线形态名称（复用 helpers/tech 识别结果，与个股短线评分列表同口径） */
  klineShape?: string;
  /** 最新交易日K线是否阴线（true=阴线，false=阳线；无数据时 undefined） */
  klineYin?: boolean;
  /** 最新交易日K线实体大小（实体 / 近期平均实体，1=平均；越大实体越大。用于列表排序） */
  klineSize?: number;
  /** 最新交易日K线上影线长度（上影 / 近期平均影线，1=平均） */
  klineUpperShadow?: number;
  /** 最新交易日K线下影线长度（下影 / 近期平均影线，1=平均） */
  klineLowerShadow?: number;
  /** 最新交易日是否放量（成交量 / 前 5 日均量 ≥ VOLUME_EXPAND_RATIO） */
  volumeExpanded?: boolean;
  /** 当日K线由分时合成（官方日K还没覆盖到当日） */
  intraday?: boolean;
  v?: number;
}

export const BOARD_SCORE_CONFIG = {
  /** 取数K线根数（RSI24 需要 54 根以上，留足历史） */
  klineLimit: 120,
  /** 带历史列时的取数K线根数：最新交易日往前 N 天仍要留够 RSI24 的 54 根预热 */
  historyKlineLimit: 150,
  /** 评分所需最少K线根数 */
  minKlines: 60,
  /** 主力资金回看交易日数 */
  moneyDays: 40,
  /** 资金维度所需最少交易日数 */
  minMoneyDays: 25,
  /** 各维度权重（合计 100，缺失维度按剩余权重归一化） */
  weights: { trend: 35, money: 35, volume: 20, rsi: 10 },
  /** 各维度满分刻度 */
  subMax: { trend: 72, money: 30, volume: 30, rsi: 40 },
  /** 板块趋势判定为「持续下跌」时的总分封顶 */
  trendVetoCap: 55,
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const gradeOf = (score: number) => (score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D');

const adviceOf = (grade: string) => {
  switch (grade) {
    case 'A':
      return '板块短线强势，可重点关注';
    case 'B':
      return '板块尚可，等回调买点';
    case 'C':
      return '板块表现平平，建议观望';
    default:
      return '板块偏弱，短线回避';
  }
};

/** 金额格式化（元 -> 亿/万） */
export const formatBoardMoney = (val: number | null | undefined) => {
  if (val == null || !Number.isFinite(val)) {
    return '--';
  }
  const abs = Math.abs(val);
  if (abs >= 1e8) {
    return `${(val / 1e8).toFixed(2)}亿`;
  }
  if (abs >= 1e4) {
    return `${(val / 1e4).toFixed(0)}万`;
  }
  return `${val.toFixed(0)}`;
};

/** 空评分行（取数/计算失败或数据不足时使用） */
export function emptyBoardScoreRow(item: BoardScoreItem): BoardScoreRow {
  return {
    secid: item.secid,
    code: item.code,
    name: item.name || item.code,
    total: null,
    grade: '',
    advice: '',
    summary: '',
    trendScore: null,
    trendType: '',
    trendDesc: '',
    positionDesc: '',
    volumeScore: null,
    volumeNote: '',
    rsiScore: null,
    rsiPattern: '',
    moneyScore: null,
    moneyNote: '',
    main5: null,
    main10: null,
    main20: null,
    klineShape: '',
    v: BOARD_SCORE_ROW_VERSION,
  };
}

// ==================== 资金维度 ====================

export interface BoardMoneyResult {
  score: number; // 0~30
  max: number;
  available: boolean;
  note: string;
  main5?: number;
  main10?: number;
  main20?: number;
}

/**
 * 板块主力资金评分（0~30）
 *
 * 与个股资金口径同取向：优先「刚由流出转流入」的拐点（短线最佳买点），
 * 其次才是「持续流入」；已流入很久（区间位置偏高）时下调，避免追高。
 * 持续净流出给低分。
 */
export function scoreBoardMoney(main: number[] | null | undefined): BoardMoneyResult {
  const max = BOARD_SCORE_CONFIG.subMax.money;
  const arr = (main || []).filter((v) => Number.isFinite(v));
  if (arr.length < BOARD_SCORE_CONFIG.minMoneyDays) {
    return { score: 0, max, available: false, note: '板块资金流数据不足' };
  }
  const n = arr.length;
  const sum = (k: number) => arr.slice(-k).reduce((a, b) => a + b, 0);
  const main5 = sum(5);
  const main10 = sum(10);
  const main20 = sum(20);
  const prev5 = arr.slice(-10, -5).reduce((a, b) => a + b, 0);
  const inflowDays5 = arr.slice(-5).filter((v) => v > 0).length;
  // 5日滚动累计净流入序列（用于识别「刚转正」的拐点）
  const roll5: number[] = [];
  for (let i = 0; i < n; i += 1) {
    roll5.push(arr.slice(Math.max(0, i - 4), i + 1).reduce((a, b) => a + b, 0));
  }
  let zeroTurnDaysAgo: number | null = null;
  for (let i = n - 1; i > Math.max(0, n - 1 - 5); i -= 1) {
    if (roll5[i - 1] <= 0 && roll5[i] > 0) {
      zeroTurnDaysAgo = n - 1 - i;
      break;
    }
  }

  const fmt = formatBoardMoney;
  let score: number;
  let note: string;
  if (main5 > 0 && zeroTurnDaysAgo !== null) {
    // 刚由净流出转净流入：资金拐点，短线最优
    score = 28 - zeroTurnDaysAgo;
    note = `主力5日净流入刚转正（${fmt(main5)}，${zeroTurnDaysAgo}日前上穿0轴）｜资金拐点`;
  } else if (main5 > 0 && main10 > 0) {
    // 持续流入：流入天数越多、且5日在加速则更优
    const accelerating = main5 > prev5;
    score = inflowDays5 >= 4 ? (accelerating ? 28 : 25) : accelerating ? 24 : 21;
    note = `主力资金持续流入（5日${fmt(main5)}｜10日${fmt(main10)}｜5日内${inflowDays5}天流入${
      accelerating ? '｜流入加速' : ''
    }）`;
  } else if (main5 > 0 && main20 < 0) {
    // 20日仍净流出、近5日回流：超跌后的资金试探
    score = 20;
    note = `板块短线资金回流（5日${fmt(main5)}），但20日仍净流出（${fmt(main20)}）`;
  } else if (main5 > 0) {
    score = 18;
    note = `主力近5日净流入（${fmt(main5)}），趋势尚未走稳`;
  } else if (main5 < 0 && main10 > 0) {
    // 前期流入、近5日转流出：高位回落
    score = 9;
    note = `主力近5日转为净流出（${fmt(main5)}），资金高位回落`;
  } else if (main5 < 0 && main20 < 0) {
    score = 5;
    note = `主力资金持续净流出（5日${fmt(main5)}｜20日${fmt(main20)}）`;
  } else if (main5 < 0) {
    // 近5日流出、20日仍为净流入：资金阶段性撤离
    score = 10;
    note = `主力近5日净流出（${fmt(main5)}），20日累计仍为净流入（${fmt(main20)}）`;
  } else {
    score = 12;
    note = `主力资金方向不明（5日${fmt(main5)}｜20日${fmt(main20)}）`;
  }

  // 位置修正：近20日累计流入已很大（资金持续流入中后段）时略降，避免追高
  if (main5 > 0 && main20 > 0 && main5 > main20 * 0.8) {
    score -= 3;
    note += '｜已持续流入较久，防追高';
  }
  score = clamp(Math.round(score), 0, max);

  return { score, max, available: true, note, main5, main10, main20 };
}

// ==================== 综合评分 ====================

/**
 * 由板块K线与资金序列计算一行板块短线评分（纯计算，不取数）
 *
 * @param klines 板块日K（升序，最后一根为评分基准日）
 * @param moneyMain 板块主力净流入日序列（升序，缺失时资金维度不参与评分）
 */
export function computeBoardScoreRow(
  item: BoardScoreItem,
  klines: Stock.KLineItem[],
  moneyMain?: number[] | null
): BoardScoreRow {
  const row = emptyBoardScoreRow(item);
  if (!klines || klines.length < BOARD_SCORE_CONFIG.minKlines) {
    row.pending = true;
    row.error = `板块日K数据不足（${klines?.length || 0}条）`;
    return row;
  }

  // ---- 趋势位置（复用个股短线评分的板块趋势判定：MA20 多空分界 + 距反转点择时）----
  const sector = Score.scoreSector(klines, klines, item.name);
  // ---- 量能活跃度（板块自身量能趋势 + 放量启动择时修正）----
  const volume = Score.scoreStockVolume(klines, null, undefined);
  // ---- RSI（形态识别；超买追高同样下调）----
  const rsi = Score.scoreStockRsi(klines);
  // ---- 主力资金 ----
  const money = scoreBoardMoney(moneyMain);

  const dims = [
    {
      label: '板块趋势',
      weight: BOARD_SCORE_CONFIG.weights.trend,
      score: sector.available ? sector.trendScore || 0 : 0,
      max: BOARD_SCORE_CONFIG.subMax.trend,
      available: sector.available,
    },
    { label: '主力资金', weight: BOARD_SCORE_CONFIG.weights.money, score: money.score, max: money.max, available: money.available },
    { label: '量能活跃度', weight: BOARD_SCORE_CONFIG.weights.volume, score: volume.score, max: volume.max, available: volume.available },
    { label: 'RSI指标', weight: BOARD_SCORE_CONFIG.weights.rsi, score: rsi.score, max: rsi.max, available: rsi.available },
  ];
  const usable = dims.filter((d) => d.available);
  const degraded = dims.filter((d) => !d.available).map((d) => `${d.label}数据不足`);

  let total = 0;
  if (usable.length) {
    const wsum = usable.reduce((a, d) => a + d.weight, 0);
    total = (usable.reduce((a, d) => a + (d.max > 0 ? (d.score / d.max) * d.weight : 0), 0) / wsum) * 100;
  }

  // 一票否决：板块已被判定为持续下跌时，资金/量能再好也不给高分
  let vetoed = false;
  if (sector.available && sector.trendType === 'down' && total > BOARD_SCORE_CONFIG.trendVetoCap) {
    total = BOARD_SCORE_CONFIG.trendVetoCap;
    vetoed = true;
  }
  total = clamp(total, 0, 100);

  if (!usable.length) {
    row.pending = true;
    row.error = '各维度数据均不足，无法评分';
    return row;
  }

  const grade = gradeOf(total);
  const parts = usable
    .map((d) => `${d.label}${Math.round((d.score / Math.max(1, d.max)) * 100)}`)
    .join('，');
  row.total = total;
  row.grade = grade;
  row.advice = adviceOf(grade);
  row.summary = `${parts}${vetoed ? '（板块走弱已触发一票否决降级）' : ''}${degraded.length ? `（${degraded.join('、')}）` : ''}`;
  row.trendScore = sector.available ? sector.trendScore ?? null : null;
  row.trendType = sector.available ? sector.trendType : '';
  row.trendDesc = sector.available ? sector.trendDesc : '板块K线数据不足';
  row.positionDesc = sector.available ? sector.positionDesc || '' : '';
  row.volumeScore = volume.available ? volume.score : null;
  row.volumeNote = volume.available ? volume.note : '量能数据不足';
  row.rsiScore = rsi.available ? rsi.score : null;
  row.rsiPattern = rsi.pattern;
  row.moneyScore = money.available ? money.score : null;
  row.moneyNote = money.note;
  row.main5 = money.main5 ?? null;
  row.main10 = money.main10 ?? null;
  row.main20 = money.main20 ?? null;
  return row;
}

/** 取板块日K最后一根的日期（YYYY-MM-DD），用于对齐资金序列 */
const lastDay = (klines: Stock.KLineItem[] | undefined) => {
  if (!klines || !klines.length) {
    return '';
  }
  return String(klines[klines.length - 1]?.date || '').substring(0, 10).replace(/\//g, '-');
};

/** 日期统一成 YYYY-MM-DD */
const toDay = (v: any) => {
  const s = String(v || '').trim();
  if (/^\d{8}$/.test(s)) {
    return `${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}`;
  }
  return s.substring(0, 10).replace(/\//g, '-');
};

/** 日期统一成 YYYYMMDD（评分序列的 key） */
const toDayKey = (v: any) => toDay(v).replace(/-/g, '').substring(0, 8);

// ==================== 评分序列（历史列 / 训练日预计算共用） ====================

/** 「近 N 日评分」历史列展示（与补算/预计算）的交易日数量 */
export const BOARD_SCORE_HISTORY_DAYS = 10;

/** 板块评分序列：{ 板块代码: { 交易日YYYYMMDD: 评分行 } } */
export type BoardScoreSeries = Record<string, Record<string, BoardScoreRow>>;

/** 从序列中取「某交易日」的评分行：只认当前行结构版本，未命中返回 null */
export function pickBoardScoreRow(
  series: Record<string, any> | undefined,
  date: string
): { row: BoardScoreRow; date: string } | null {
  if (!series || !date) {
    return null;
  }
  const target = toDayKey(date);
  const key = Object.keys(series).find((k) => toDayKey(k) === target);
  if (!key || !series[key] || typeof series[key] !== 'object') {
    return null;
  }
  const row = series[key] as BoardScoreRow;
  if ((row as any).v !== BOARD_SCORE_ROW_VERSION) {
    return null;
  }
  return { row, date: target };
}

/**
 * 读取板块评分序列（一次取回整批板块）
 * @param options.dates 只取这些交易日（强烈建议传）：预计算会把整段训练窗口写进序列
 */
export async function loadBoardScoreSeries(
  codes: string[],
  source?: any,
  options?: { dates?: string[]; ignoreTrain?: boolean }
): Promise<BoardScoreSeries> {
  if (!codes || !codes.length) {
    return {};
  }
  try {
    return ((await Services.Tushare.GetBoardScoreSeriesFromTushare(codes, source, {
      ...options,
      rowVersion: BOARD_SCORE_ROW_VERSION,
    })) || {}) as BoardScoreSeries;
  } catch {
    return {};
  }
}

/** 回写板块评分序列（按交易日合并）；失败打日志并返回 false */
export async function saveBoardScoreSeries(series: BoardScoreSeries, source?: any): Promise<boolean> {
  if (!series || !Object.keys(series).length) {
    return true;
  }
  try {
    await Services.Tushare.SaveBoardScoreSeriesToTushare(series, source);
    return true;
  } catch (e: any) {
    console.error('[板块短线评分] 评分序列写入失败，本次结果未落库（下次需重新计算）:', e?.message || e);
    return false;
  }
}

/** 缓存行补上调用方给的板块身份（缓存里可能只存了代码） */
const withItem = (row: BoardScoreRow, item: BoardScoreItem): BoardScoreRow => ({
  ...row,
  secid: item.secid || row.secid,
  code: item.code || row.code,
  name: item.name || row.name || item.code,
});

/** 按交易日截断K线（保留 <= day 的部分） */
function cutKlines(klines: Stock.KLineItem[], dayKey: string): Stock.KLineItem[] {
  if (!dayKey) {
    return klines;
  }
  const target = toDay(dayKey);
  return klines.filter((k) => !k?.date || toDay(k.date) <= target);
}

/** 按交易日截断资金序列 */
function cutMoney(
  money: { dates?: string[]; main?: number[] } | null | undefined,
  dayKey: string
): number[] | null {
  if (!money || !Array.isArray(money.main) || !money.main.length) {
    return null;
  }
  const dates = Array.isArray(money.dates) ? money.dates : [];
  if (!dayKey || dates.length !== money.main.length) {
    return money.main;
  }
  const target = toDay(dayKey);
  return money.main.filter((_, i) => !dates[i] || toDay(dates[i]) <= target);
}

/**
 * 给评分行补上「最新交易日K线形态 / 是否放量」（与个股短线评分列表同一套识别）
 *
 * expectDay 传入评分基准日：最后一根K线日期必须与之一致，否则说明数据没到当天，
 * 不把上一交易日的形态当成当日的（停牌 / 取数失败回退旧缓存）。
 */
export function attachLatestKlineFields(
  row: BoardScoreRow,
  klines: Stock.KLineItem[],
  expectDay?: string
): BoardScoreRow {
  if (!klines || !klines.length) {
    return row;
  }
  const shape = describeLatestKlineShape(klines, expectDay);
  if (shape) {
    row.klineShape = shape.name;
    row.klineYin = shape.yin;
    row.klineSize = shape.size;
    row.klineUpperShadow = shape.upperShadow;
    row.klineLowerShadow = shape.lowerShadow;
  }
  row.volumeExpanded = isLatestVolumeExpanded(klines);
  return row;
}

/**
 * 某交易日的板块评分行（纯计算）
 * @param dayKey 评分基准日（YYYYMMDD / YYYY-MM-DD）；空表示用全部K线的最后一天
 */
export function computeBoardScoreRowForDay(
  item: BoardScoreItem,
  klines: Stock.KLineItem[],
  money: { dates?: string[]; main?: number[] } | null | undefined,
  dayKey: string
): BoardScoreRow {
  const bars = cutKlines(klines, dayKey);
  const row = computeBoardScoreRow(item, bars, cutMoney(money, dayKey));
  return attachLatestKlineFields(row, bars, dayKey || toDayKey(lastDay(bars)));
}

export interface ComputeBoardScoreOptions {
  /** K线数据源（用于取交易日历，必须与列表取数的数据源一致） */
  source: any;
  concurrency?: number;
  /** 返回 true 时停止取新任务（已开始的板块算完为止），用于「再次点击暂停」 */
  shouldStop?: () => boolean;
  onRow?: (row: BoardScoreRow, item: BoardScoreItem, done: number, total: number) => void;
  /** 「近 N 日评分」历史列需要覆盖的交易日数量（0 / 不传 = 不补历史） */
  historyDays?: number;
  /** 历史行计算/补写进度 */
  onHistoryProgress?: (info: { done: number; total: number }) => void;
  /** 每算完一只板块，回调它本轮新算出的历史行（便于边算边刷新历史列） */
  onSeries?: (series: BoardScoreSeries) => void;
}

export interface ComputeBoardScoreResult {
  rows: BoardScoreRow[];
  /** 评分基准日（YYYYMMDD）；未确定时为空串 */
  scoreDayKey: string;
  /** 基准日为止的交易日（升序、含基准日，最多 historyDays 个） */
  recentDays: string[];
  /** 本轮算出的评分序列（含历史行；已写库） */
  series: BoardScoreSeries;
}

/**
 * 批量计算板块短线评分（含「近 N 日评分」历史列）
 *
 * - 评分基准日 = 交易日历里 <= 训练日/今天的最后一个交易日；
 * - 每只板块日K只取一次（覆盖历史列所需的全部交易日），资金序列整批取回一次；
 * - 基准日与历史列的行按交易日切片、用同一个纯函数计算，口径完全一致；
 * - 先查评分序列缓存：命中当天行且历史列已齐的板块零取数（预计算过的训练日切过来是瞬时的）；
 * - 新算出的行按板块合并写回序列，之后重复点击 / 切换训练日都直接命中；
 * - 每算完一只回调 onRow，便于界面逐步出分与暂停。
 */
export async function computeBoardShortTermScoreRows(
  items: BoardScoreItem[],
  options: ComputeBoardScoreOptions
): Promise<ComputeBoardScoreResult> {
  const { source, concurrency = 3, shouldStop, onRow, historyDays = 0, onHistoryProgress, onSeries } = options;
  const rows: BoardScoreRow[] = [];
  const result: ComputeBoardScoreResult = { rows, scoreDayKey: '', recentDays: [], series: {} };
  if (!items || !items.length) {
    return result;
  }
  const total = items.length;
  let done = 0;

  // ---- 交易日：交易日历（训练模式按训练日收敛）----
  const wantDays = Math.max(1, Number(historyDays) || 0);
  let recentDays: string[] = [];
  try {
    recentDays = await resolveRecentTradingDays(source, wantDays);
  } catch {
    recentDays = [];
  }
  result.recentDays = recentDays;
  result.scoreDayKey = recentDays.length ? recentDays[recentDays.length - 1] : '';
  const scoreDayKey = result.scoreDayKey;

  const codes = items.map((i) => i.code);

  // ---- 评分序列缓存：一次取回整批板块在需要交易日上的行 ----
  let cached: BoardScoreSeries = {};
  if (recentDays.length) {
    try {
      cached = await loadBoardScoreSeries(codes, source, { dates: recentDays });
    } catch {
      cached = {};
    }
  }
  const missingDaysOf = (code: string): string[] =>
    recentDays.filter((d) => !pickBoardScoreRow(cached[code], d));
  // 补算进度只统计「历史列」的天数（基准日单独算，避免进度永远差几只到不了 100%）
  const totalMissing = items.reduce(
    (a, item) => a + missingDaysOf(item.code).filter((d) => d !== scoreDayKey).length,
    0
  );
  let historyDone = 0;

  // ---- 资金序列：一次 IPC 取回整批板块（覆盖历史列 + 资金窗口；失败时资金维度缺失）----
  let moneyMap: Record<string, { dates?: string[]; main?: number[] }> = {};
  try {
    moneyMap =
      (await Services.Tushare.GetBoardMoneyFlowHistoryFromTushare(
        codes,
        BOARD_SCORE_CONFIG.moneyDays + Math.max(0, historyDays) + 5
      )) || {};
  } catch {
    moneyMap = {};
  }

  /** 待写库的增量（板块 × 交易日），算完统一写一次 */
  const buffer: BoardScoreSeries = {};
  const appendHistory = (item: BoardScoreItem, history: Record<string, BoardScoreRow>) => {
    const days = Object.keys(history);
    if (!days.length) {
      return;
    }
    result.series[item.code] = result.series[item.code] || {};
    buffer[item.code] = buffer[item.code] || {};
    days.forEach((d) => {
      result.series[item.code][d] = history[d];
      buffer[item.code][d] = history[d];
    });
    try {
      onSeries?.({ [item.code]: { ...result.series[item.code] } });
    } catch {
      // 回调异常不影响主流程
    }
  };

  const scoreOne = async (item: BoardScoreItem): Promise<BoardScoreRow> => {
    const missing = missingDaysOf(item.code);
    const baseHit = scoreDayKey ? pickBoardScoreRow(cached[item.code], scoreDayKey) : null;

    // 当天命中 + 历史列已齐：零取数（预计算过的训练日切换就是走这里）
    if (baseHit && !missing.length) {
      return withItem(baseHit.row, item);
    }

    try {
      const { ks } = await Services.Stock.GetKFromSetting(
        item.secid,
        KLineType.Day,
        BOARD_SCORE_CONFIG.historyKlineLimit
      );
      const klines = (Array.isArray(ks) ? ks : []) as Stock.KLineItem[];
      if (!klines.length) {
        const row = emptyBoardScoreRow(item);
        row.pending = true;
        row.error = '未取到板块日K数据';
        return row;
      }
      const money = moneyMap[item.code] || (moneyMap as any)[item.secid] || null;
      const history: Record<string, BoardScoreRow> = {};

      // 基准日（优先用缓存行，缺了才现算）
      let baseRow: BoardScoreRow | null = baseHit ? withItem(baseHit.row, item) : null;
      if (!baseRow && scoreDayKey) {
        baseRow = computeBoardScoreRowForDay(item, klines, money, scoreDayKey);
        if (!baseRow.pending) {
          history[scoreDayKey] = baseRow;
        }
      }

      // 历史列缺的交易日（不含基准日）：逐日切片后用同一套纯函数计算
      missing.forEach((d) => {
        if (d === scoreDayKey) {
          return;
        }
        const row = computeBoardScoreRowForDay(item, klines, money, d);
        if (!row.pending) {
          history[d] = row;
        }
      });

      const fixedRows = Object.keys(history).filter((d) => d !== scoreDayKey).length;
      if (totalMissing > 0) {
        historyDone += fixedRows;
        try {
          onHistoryProgress?.({ done: Math.min(historyDone, totalMissing), total: totalMissing });
        } catch {
          // 回调异常不影响主流程
        }
      }
      appendHistory(item, history);

      if (!baseRow) {
        // 取不到交易日历时的兜底：按板块自身K线的最后一天评分（不标 pending，照常出分）
        baseRow = computeBoardScoreRowForDay(item, klines, money, toDayKey(lastDay(klines)));
      }
      return baseRow;
    } catch (e: any) {
      const row = emptyBoardScoreRow(item);
      row.pending = true;
      row.error = e?.message || '板块评分失败';
      return row;
    }
  };

  // 并发工作池：逐只回调，支持暂停
  const queue = [...items];
  const worker = async () => {
    while (queue.length > 0) {
      if (shouldStop?.()) {
        return;
      }
      const item = queue.shift() as BoardScoreItem;
      // eslint-disable-next-line no-await-in-loop
      const row = await scoreOne(item);
      rows.push(row);
      done += 1;
      try {
        onRow?.(row, item, done, total);
      } catch {
        // 回调异常不影响主流程
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));

  // 缓存里命中但本轮没重算的日子，也一并回传给调用方（保证历史列完整）
  Object.keys(cached).forEach((code) => {
    Object.keys(cached[code] || {}).forEach((d) => {
      if (!result.series[code]?.[d]) {
        result.series[code] = result.series[code] || {};
        result.series[code][d] = cached[code][d];
      }
    });
  });

  await saveBoardScoreSeries(buffer, source);
  return result;
}

// ==================== 当日评分（只补当日K线形态 + RSI） ====================

export interface ComputeTodayBoardScoreOptions {
  source: any;
  concurrency?: number;
  shouldStop?: () => boolean;
  onRow?: (row: BoardScoreRow, item: BoardScoreItem, done: number, total: number) => void;
  /** 「近 N 日评分」历史列需要覆盖的交易日数量 */
  historyDays?: number;
}

export interface ComputeTodayBoardScoreResult {
  rows: BoardScoreRow[];
  /** 当日（YYYYMMDD） */
  scoreDayKey: string;
  /** 含当日的最近交易日（升序） */
  recentDays: string[];
  /** 当日K线取到并算出形态的板块数 */
  filled: number;
  /** 当日K线不可用（未收盘且分时取不到 / 停牌 / 形态识别失败）的板块数 */
  skipped: number;
}

/**
 * 「当日评分」（板块）
 *
 * 与 STList 的「当日评分」同一套思路：只更新「只依赖K线」的部分 —— K线形态（含阴阳 / 是否放量）与 RSI 评分。
 * 板块日K来自 dc_daily，盘中拿不到当日那根，因此：
 * - 官方日K已覆盖当日的板块不取分时，直接按官方K线计算；
 * - 否则取当日分时（python 侧板块分时走东财 trends2）合成一根日K补在末尾再计算；
 * - 只填 `klineShape / klineYin / klineSize / 上下影线 / volumeExpanded / rsiScore / rsiPattern / intraday`，
 *   综合分与其它维度留空（列表评分列显示「待评分」）；
 * - 当日不给综合分，也不写评分序列缓存（没有综合分可缓存）。
 */
export async function computeTodayBoardScoreRows(
  items: BoardScoreItem[],
  options: ComputeTodayBoardScoreOptions
): Promise<ComputeTodayBoardScoreResult> {
  const { source, concurrency = 4, shouldStop, onRow, historyDays = BOARD_SCORE_HISTORY_DAYS } = options;
  const rows: BoardScoreRow[] = [];
  let done = 0;
  let filled = 0;
  let skipped = 0;
  if (!items || !items.length) {
    return { rows, scoreDayKey: '', recentDays: [], filled, skipped };
  }

  // 当日评分固定针对「当前交易日」：训练模式跟随训练日，非训练模式取真实今天
  const trainDayKey = (TrainFilter.GetTrainToDate() || '').replace(/-/g, '');
  const dayKey = trainDayKey || dayjs().format('YYYYMMDD');
  const scoreDay = `${dayKey.substring(0, 4)}-${dayKey.substring(4, 6)}-${dayKey.substring(6, 8)}`;
  const recentDays = await resolveRecentTradingDays(source, historyDays);

  // 是否交易日：直接查交易日历
  if (!(await isTradeDayOn(source, dayKey))) {
    console.log(`[板块当日评分] ${scoreDay} 不是交易日，已跳过`);
    return { rows, scoreDayKey: dayKey, recentDays, filled, skipped };
  }

  const total = items.length;

  // ---- 1. 批量取板块日K（并发；与完整评分同一取数口径）----
  const klinesMap: Record<string, Stock.KLineItem[]> = {};
  const queue = [...items];
  const fetchWorker = async () => {
    while (queue.length > 0) {
      if (shouldStop?.()) {
        return;
      }
      const item = queue.shift() as BoardScoreItem;
      try {
        const { ks } = await Services.Stock.GetKFromSetting(
          item.secid,
          KLineType.Day,
          BOARD_SCORE_CONFIG.historyKlineLimit
        );
        klinesMap[item.secid] = (Array.isArray(ks) ? ks : []) as Stock.KLineItem[];
      } catch {
        klinesMap[item.secid] = [];
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => fetchWorker()));

  // ---- 2. 批量预取分时：只取「日K还没覆盖到当日」的板块 ----
  const trendMap: Record<string, Stock.TrendItem[]> = {};
  const needTrendItems = items.filter((i) => !klinesCoverDay(klinesMap[i.secid], dayKey));
  if (source === FundApiType.Tushare && needTrendItems.length) {
    try {
      const batch = await Services.Tushare.GetTrendsBatchFromTushare(needTrendItems.map((i) => i.secid));
      needTrendItems.forEach((i) => {
        const ts = batch?.[i.secid];
        if (Array.isArray(ts) && ts.length) {
          trendMap[i.secid] = TrainFilter.CutTrends(ts);
        }
      });
      console.log(
        `[板块当日评分] 批量分时预取 ${needTrendItems.length} 个板块，命中 ${Object.keys(trendMap).length} 个`
      );
    } catch {
      // 批量分时失败时退回逐只取数，不影响主流程
    }
  }

  /** 当日行：只填「只依赖K线」的字段（K线形态 + 放量 + RSI），综合分与其它维度留空 */
  const klineOnlyRow = (
    item: BoardScoreItem,
    info?: {
      shape: { name: string; yin: boolean; size: number; upperShadow: number; lowerShadow: number } | null;
      intraday: boolean;
      volumeExpanded: boolean;
      rsi: Score.RsiScoreResult;
    },
    reason?: string
  ): BoardScoreRow => {
    const row = emptyBoardScoreRow(item);
    row.intraday = !!info?.intraday;
    row.klineShape = info?.shape?.name || '';
    row.klineYin = info?.shape?.yin;
    row.klineSize = info?.shape?.size;
    row.klineUpperShadow = info?.shape?.upperShadow;
    row.klineLowerShadow = info?.shape?.lowerShadow;
    row.volumeExpanded = info?.volumeExpanded;
    if (info?.rsi) {
      // RSI 只依赖K线：当日K线（可能是分时补全的）就绪时同样可算可展示；数据不足时留空显示 --
      row.rsiScore = info.rsi.available ? info.rsi.score : null;
      row.rsiPattern = info.rsi.pattern;
    }
    if (reason) {
      row.error = reason;
      row.pending = true; // 没有当日数据可展示：标记未就绪，行内悬停可看原因
    }
    return row;
  };

  const processOne = async (item: BoardScoreItem): Promise<BoardScoreRow> => {
    try {
      let bars = klinesMap[item.secid] || [];
      if (!bars.length) {
        const { ks } = await Services.Stock.GetKFromSetting(
          item.secid,
          KLineType.Day,
          BOARD_SCORE_CONFIG.historyKlineLimit
        );
        bars = (Array.isArray(ks) ? ks : []) as Stock.KLineItem[];
        klinesMap[item.secid] = bars;
      }
      let intraday = false;
      if (!klinesCoverDay(bars, dayKey)) {
        // 官方日K还没到当日：用当日分时合成一根日K补在末尾（优先用批量预取的结果）
        const prefetched = trendMap[item.secid];
        const trends = prefetched ? prefetched : await fetchTrendsOfSource(source, item.secid);
        const bar = buildTrendBar({ secid: item.secid, trends, klines: bars, dayKey });
        if (!bar) {
          skipped += 1;
          return klineOnlyRow(item, undefined, `当日分时不可用，无法补全 ${scoreDay} 的K线`);
        }
        bars = mergeTrendBar(bars, bar);
        intraday = true;
      }
      // 复用完整评分同一套纯计算函数，保证「当日评分」与「短线评分」口径一致
      const shape = describeLatestKlineShape(bars, dayKey);
      const rsi = Score.scoreStockRsi(bars);
      if (!shape) {
        skipped += 1;
        return klineOnlyRow(
          item,
          { shape: null, intraday, volumeExpanded: false, rsi },
          `K线形态识别失败（日K ${bars.length} 条）`
        );
      }
      filled += 1;
      return klineOnlyRow(item, { shape, intraday, volumeExpanded: isLatestVolumeExpanded(bars), rsi });
    } catch (e: any) {
      skipped += 1;
      return klineOnlyRow(item, undefined, e?.message || '取数失败');
    }
  };

  // 并发工作池：逐只回调，支持暂停
  const queue2 = [...items];
  const worker = async () => {
    while (queue2.length > 0) {
      if (shouldStop?.()) {
        return;
      }
      const item = queue2.shift() as BoardScoreItem;
      // eslint-disable-next-line no-await-in-loop
      const row = await processOne(item);
      rows.push(row);
      done += 1;
      try {
        onRow?.(row, item, done, total);
      } catch {
        // 回调异常不影响主流程
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));

  console.log(
    `[板块当日评分] 交易日 ${scoreDay}：共 ${total} 个板块，更新K线形态/RSI ${filled} 个、未取到 ${skipped} 个`
  );
  return { rows, scoreDayKey: dayKey, recentDays, filled, skipped };
}

// ==================== 训练周期预计算 ====================

const INDEX_SECIDS = ['1.000001', '0.399001', '0.399006'];
/** 每预计算多少个交易日写一次库（控制单次写入体积） */
const PRECOMPUTE_FLUSH_DAYS = 20;
/** 预计算时每只板块多取的K线根数（RSI24 预热 + 板块趋势窗口 + 余量） */
const PRECOMPUTE_KLINE_MARGIN = 120;

export interface PrecomputeBoardScoreOptions {
  items: BoardScoreItem[];
  /** 训练窗口起始日（YYYY-MM-DD / YYYYMMDD） */
  startDate: string;
  /** 训练窗口结束日（缺省 = 训练窗口终点 / 今天） */
  endDate?: string;
  /** 起始日之前额外预计算的交易日数量（供「近 N 日评分」历史列直接命中） */
  historyDays?: number;
  source: any;
  /** 忽略已有缓存，整段窗口重算 */
  ignoreCache?: boolean;
  shouldStop?: () => boolean;
  onProgress?: (done: number, total: number, message: string) => void;
}

export interface PrecomputeBoardScoreResult {
  /** 实际计算（写库）的交易日 */
  dates: string[];
  /** 写入的评分行数 */
  rows: number;
  /** 因已有缓存跳过的交易日数 */
  reusedDays: number;
  /** 写库失败的次数 */
  writeErrors: number;
}

/**
 * 训练周期预计算：把训练窗口（含起始日之前 N 个交易日）每个交易日 × 每个板块的评分预先算好并落库
 *
 * 之后在任一训练日点「短线评分 / 切换训练日」都直接命中序列（零取数），
 * 与 STList 的「预计算训练评分」是同一套思路：板块K线 / 板块资金流各只批量取一次，
 * 逐日只在内存里切片 + 纯函数评分，每 20 个交易日落盘一次，支持暂停。
 */
export async function precomputeBoardScores(
  options: PrecomputeBoardScoreOptions
): Promise<PrecomputeBoardScoreResult> {
  const {
    items,
    startDate,
    endDate,
    historyDays = BOARD_SCORE_HISTORY_DAYS,
    source,
    ignoreCache,
    shouldStop,
    onProgress,
  } = options;
  const result: PrecomputeBoardScoreResult = { dates: [], rows: 0, reusedDays: 0, writeErrors: 0 };
  if (!items || !items.length || !startDate) {
    return result;
  }
  const startKey = toDayKey(startDate);
  const endKey = toDayKey(endDate || TrainFilter.GetTrainToDate() || startDate);

  // ---- 1. 交易日历：用指数日K（忽略训练过滤，才能覆盖到窗口之后的日子）----
  const indexMap = await Services.Tushare.BatchGetKFromTushare(
    INDEX_SECIDS,
    endKey,
    800,
    KLineType.Day,
    { ignoreTrain: true }
  );
  const calendar = [
    ...new Set(
      Object.keys(indexMap || {}).flatMap((s) =>
        (indexMap[s] || []).map((k) => toDayKey(k?.date)).filter((d) => d.length === 8)
      )
    ),
  ].sort();
  const windowStartIdx = calendar.findIndex((d) => d >= startKey);
  const windowEndIdx = calendar.reduce((acc, d, i) => (d <= endKey ? i : acc), -1);
  if (windowStartIdx < 0 || windowEndIdx < windowStartIdx) {
    console.warn(`[板块预计算] 训练窗口 ${startKey}~${endKey} 内没有交易日，已跳过`);
    return result;
  }
  // 起始日之前多取 historyDays 个交易日：列表的历史列因此能直接命中，不用回头补算
  const firstIdx = Math.max(0, windowStartIdx - Math.max(1, Number(historyDays) || 0));
  const targets = calendar.slice(firstIdx, windowEndIdx + 1);
  if (!targets.length) {
    return result;
  }

  // ---- 2. 板块日K：一次批量取全（覆盖窗口 + 预热）----
  const secids = items.map((i) => i.secid);
  const klineMap = await Services.Tushare.BatchGetKFromTushare(
    secids,
    endKey,
    targets.length + PRECOMPUTE_KLINE_MARGIN,
    KLineType.Day,
    { ignoreTrain: true }
  );

  // ---- 3. 板块资金流：一次批量取全（覆盖第一个目标日之前 40 个交易日）----
  const moneyStartIdx = Math.max(0, firstIdx - (BOARD_SCORE_CONFIG.moneyDays + 10));
  const moneyStart = calendar[moneyStartIdx] || targets[0];
  let moneyMap: Record<string, { dates?: string[]; main?: number[] }> = {};
  try {
    moneyMap =
      (await Services.Tushare.GetBoardMoneyFlowHistoryFromTushare(
        items.map((i) => i.code),
        targets.length + BOARD_SCORE_CONFIG.moneyDays + 10,
        { startDate: moneyStart, endDate: endKey, ignoreTrain: true }
      )) || {};
  } catch {
    moneyMap = {};
  }

  // ---- 4. 增量：已覆盖的交易日直接跳过（忽略缓存时整段重算）----
  let pendingDays = targets;
  if (!ignoreCache) {
    try {
      const summary = await Services.Tushare.GetBoardScoreSeriesSummaryFromTushare(
        items.map((i) => i.code),
        targets,
        source,
        { rowVersion: BOARD_SCORE_ROW_VERSION, ignoreTrain: true }
      );
      pendingDays = targets.filter((d) => (summary[d] || 0) > 0);
      result.reusedDays = targets.length - pendingDays.length;
    } catch {
      pendingDays = targets;
    }
  }
  if (!pendingDays.length) {
    console.log(`[板块预计算] ${targets.length} 个交易日均已覆盖，无需重算`);
    onProgress?.(targets.length, targets.length, '已全部覆盖');
    return result;
  }

  // ---- 5. 逐日切片计算 + 分批写库 ----
  const total = pendingDays.length;
  let done = 0;
  let buffer: BoardScoreSeries = {};
  const flush = async () => {
    if (!Object.keys(buffer).length) {
      return;
    }
    const payload = buffer;
    buffer = {};
    // eslint-disable-next-line no-await-in-loop
    const ok = await saveBoardScoreSeries(payload, source);
    if (!ok) {
      result.writeErrors += 1;
    }
  };

  for (const day of pendingDays) {
    if (shouldStop?.()) {
      break;
    }
    for (const item of items) {
      const ks = klineMap[item.secid] || [];
      if (!ks.length) {
        continue;
      }
      const row = computeBoardScoreRowForDay(item, ks, moneyMap[item.code] || null, day);
      if (row.pending) {
        continue;
      }
      buffer[item.code] = buffer[item.code] || {};
      buffer[item.code][day] = row;
      result.rows += 1;
    }
    done += 1;
    result.dates.push(day);
    if (done % PRECOMPUTE_FLUSH_DAYS === 0) {
      // eslint-disable-next-line no-await-in-loop
      await flush();
    }
    try {
      onProgress?.(done, total, `${toDay(day)}`);
    } catch {
      // 回调异常不影响主流程
    }
    // 让出主线程，避免长时间阻塞 UI
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await flush();
  console.log(
    `[板块预计算] 完成：${result.dates.length}/${total} 个交易日、${result.rows} 行` +
      `${result.reusedDays ? `（已有缓存跳过 ${result.reusedDays} 天）` : ''}` +
      `${result.writeErrors ? `，写库失败 ${result.writeErrors} 次` : ''}`
  );
  if (!result.rows) {
    console.warn(
      '[板块预计算] 没有写入任何评分行：批量取板块日K为空或K线根数不足（检查数据源是否支持该批板块的日K批量取数）'
    );
  }
  return result;
}
