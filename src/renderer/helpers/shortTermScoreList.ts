import * as Services from '@/services';
import * as TrainFilter from '@/utils/trainFilter';
import { FundApiType, KLineType } from '@/utils/enums';
import { Stock } from '@/types/stock';
import * as Score from './shortTermScore';

/** 短线评分列表输入项 */
export interface ShortTermScoreItem {
  code: string; // 6位代码
  name?: string;
  circMv?: number; // 流通市值（元）
  hybk?: { code: string; name: string } | null; // 手动设置的板块（优先）
}

/** 短线评分列表行（用于 STList 展示） */
export interface ShortTermScoreRow {
  code: string;
  name: string;
  total: number | null; // 综合评分 0~100
  grade: string; // A/B/C/D
  advice: string; // 操作建议
  summary: string; // 综合评语
  stockScore: number | null; // 个股维度得分
  sectorScore: number | null; // 板块维度得分
  marketScore: number | null; // 大盘维度得分
  volumeScore: number | null; // 量能得分 /30
  rsiScore: number | null; // RSI得分 /40
  rsiPattern: string; // RSI命中情形
  sectorTrend: string; // 板块趋势描述
  moneyScore: number | null; // 资金得分 /30
  moneyNote: string; // 资金形态说明
  error?: string; // 评分失败原因
}

/**
 * 由各维度评分结果生成列表行（STList 与个股详情页共用）
 * 这样「个股详情页执行短线评分」与「列表批量评分」写入数据库缓存的字段结构完全一致。
 */
export function buildShortTermScoreRow(params: {
  code: string;
  name?: string;
  overall: Score.ShortTermScoreResult;
  market: Score.MarketScoreResult;
  sector: Score.SectorScoreResult;
  stock: Score.StockScoreResult;
  volume: Score.VolumeScoreResult;
  rsi: Score.RsiScoreResult;
  money: Score.MoneyScoreResult;
  /** 评分失败原因（有值时该行不会写入缓存，便于下次重算） */
  error?: string;
}): ShortTermScoreRow {
  const { code, name, overall, market, sector, stock, volume, rsi, money, error } = params;
  const row: ShortTermScoreRow = {
    code,
    name: name || code,
    total: overall.total,
    grade: overall.grade,
    advice: overall.advice,
    summary: overall.summary,
    stockScore: stock.available ? stock.score : null,
    sectorScore: sector.available ? sector.score : null,
    marketScore: market.available ? market.score : null,
    volumeScore: volume.available ? volume.score : null,
    rsiScore: rsi.available ? rsi.score : null,
    rsiPattern: rsi.pattern,
    sectorTrend: sector.available ? sector.trendDesc : '',
    moneyScore: money.available ? money.score : null,
    moneyNote: money.note,
  };
  if (error) {
    row.error = error;
  }
  return row;
}

/** 空评分行（取数/计算失败时使用） */
export function emptyShortTermScoreRow(code: string, name?: string): ShortTermScoreRow {
  return {
    code,
    name: name || code,
    total: null,
    grade: '',
    advice: '',
    summary: '',
    stockScore: null,
    sectorScore: null,
    marketScore: null,
    volumeScore: null,
    rsiScore: null,
    rsiPattern: '',
    sectorTrend: '',
    moneyScore: null,
    moneyNote: '',
  };
}

/**
 * 「无有效数据」的占位评分行：分值记 0，并写明原因
 *
 * 这类结果（如日K不足、数据源没有该股行情）不会再变化，因此也按 0 分写入评分序列，
 * 避免每次点击短线评分都为它们重新取数 —— 有缓存就不再重试拉取。
 */
export function zeroShortTermScoreRow(code: string, name?: string, reason?: string): ShortTermScoreRow {
  const row = emptyShortTermScoreRow(code, name);
  row.total = 0;
  row.grade = 'D';
  row.error = reason || '无有效数据';
  return row;
}

/** 日期统一成 YYYY-MM-DD（兼容 YYYYMMDD / 带时间） */
const toDay = (v: any): string => {
  const s = String(v || '').trim();
  if (/^\d{8}$/.test(s)) {
    return `${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}`;
  }
  return s.substring(0, 10).replace(/\//g, '-');
};

/** 按日期截断K线：保留 <= date 的最后 keep 根 */
function sliceKlines(ks: Stock.KLineItem[] | undefined, date: string, keep: number): Stock.KLineItem[] {
  // 取数失败时上游可能返回 {error} 之类的对象，必须挡住，否则会抛异常把整只股票打成 0 分
  if (!ks || !Array.isArray(ks) || !ks.length) {
    return [];
  }
  if (!date) {
    return ks.length > keep ? ks.slice(-keep) : ks;
  }
  const cut = ks.filter((k) => toDay(k.date) <= date);
  return cut.length > keep ? cut.slice(-keep) : cut;
}

/**
 * 按日期截断资金明细
 *
 * 评分必须严格基于「评分基准日」为止的数据。上游取数可能因训练过滤未生效/数据源缓存
 * 而返回更晚的数据（个股详情页使用的是已截断的同一份数据），这里统一再切一次，
 * 保证列表侧与详情页口径完全一致，且缓存键与数据基准日对应。
 */
function sliceMoneyTo(mf: any, date: string, keep: number): { detailMain: number[]; detailRetail: number[] } {
  const dates: string[] = Array.isArray(mf?.detail_dates) ? mf.detail_dates : [];
  const main: number[] = Array.isArray(mf?.detail_main) ? mf.detail_main : [];
  const retail: number[] = Array.isArray(mf?.detail_retail) ? mf.detail_retail : [];
  if (!main.length) {
    return { detailMain: [], detailRetail: [] };
  }
  const keepIdx: number[] = [];
  dates.forEach((d, i) => {
    if (!d || !date || toDay(d) <= date) {
      keepIdx.push(i);
    }
  });
  const tail = keepIdx.slice(-keep);
  return {
    detailMain: tail.map((i) => Number(main[i]) || 0),
    detailRetail: tail.map((i) => Number(retail[i]) || 0),
  };
}

/** 个股对应的大盘评分基准指数（沪市→上证指数，创业板→创业板指，其余→深证成指） */
export function indexSecidOfStock(code: string): string {
  return code.startsWith('6') ? '1.000001' : code.startsWith('3') ? '0.399006' : '0.399001';
}

/** 单只股票评分的完整结果（各维度明细，个股详情页展示用） */
export interface ShortTermScoreDetail {
  overall: Score.ShortTermScoreResult;
  market: Score.MarketScoreResult;
  sector: Score.SectorScoreResult;
  stock: Score.StockScoreResult;
  volume: Score.VolumeScoreResult;
  rsi: Score.RsiScoreResult;
  money: Score.MoneyScoreResult;
}

/**
 * 单只股票在「某个交易日」的短线评分（纯计算，不取数）：
 * 传入的 K线/资金明细必须已按该交易日截断。列表批量评分、训练周期预计算、个股详情页
 * 共用这一个函数，保证同一天的评分口径完全一致。
 *
 * 注意：大盘维度的对比基准用 `baselineKlines`（市值风格板块优先，缺失时由调用方回退所属指数）。
 */
export function computeShortTermScoreForDate(params: {
  code: string;
  name?: string;
  klines: Stock.KLineItem[];
  baselineKlines?: Stock.KLineItem[] | null;
  boardKlines: Stock.KLineItem[];
  boardName: string;
  upRatioMap?: Score.UpRatioMap | null;
  marketStats?: Score.MarketActivityStats | null;
  circMv?: number;
  detailMain?: number[];
  detailRetail?: number[];
}): { row: ShortTermScoreRow; detail: ShortTermScoreDetail | null } {
  const { code, name, klines, baselineKlines, boardKlines, boardName, upRatioMap, marketStats, circMv, detailMain, detailRetail } = params;
  if (!klines || klines.length < 30) {
    // 无有效数据：按 0 分写入缓存（见 zeroShortTermScoreRow 说明）
    return { row: zeroShortTermScoreRow(code, name, `日K数据不足（${klines?.length || 0}条）`), detail: null };
  }
  const market = Score.scoreMarket(klines, baselineKlines || [], upRatioMap);
  const sector = Score.scoreSector(klines, boardKlines, boardName);
  const volume = Score.scoreStockVolume(klines, marketStats, circMv);
  const rsi = Score.scoreStockRsi(klines);
  const money = Score.scoreStockMoney(detailMain, detailRetail);
  const stock = Score.scoreStock(volume, rsi, money);
  const overall = Score.composeShortTermScore(market, sector, stock);
  return {
    row: buildShortTermScoreRow({ code, name, overall, market, sector, stock, volume, rsi, money }),
    detail: { overall, market, sector, stock, volume, rsi, money },
  };
}

/** 市值风格板块（大盘评分的对比基准，与个股详情页口径一致） */
export const SIZE_BOARD_NAMES = ['微盘股', '小盘股', '中盘股', '大盘股'];

/** 板块数据与基准日的最大间隔（天）：超过则认为该板块在基准日附近无行情，换下一个候选 */
const BOARD_NEAR_DAYS = 15;
/** 板块候选数量上限（与个股详情页一致） */
const BOARD_CANDIDATE_LIMIT = 10;

/** 评分序列缓存：{ 股票代码: { 交易日YYYYMMDD: 评分行 } } */
export type ShortTermScoreSeries = Record<string, Record<string, ShortTermScoreRow>>;

/** 单只股票的板块选择结果（所属板块 + 市值风格板块） */
export interface BoardChoice {
  board: { code: string; name: string } | null;
  sizeBoard: { code: string; name: string } | null;
}

/** 个股评分输入（所有序列均已按评分基准日截断） */
export interface StockScoreInputs {
  klines: Stock.KLineItem[];
  /** 大盘维度对比基准：市值风格板块优先，缺失时回退所属指数 */
  baselineKlines: Stock.KLineItem[];
  baselineName: string;
  boardKlines: Stock.KLineItem[];
  boardName: string;
  upRatioMap?: Score.UpRatioMap | null;
  marketStats?: Score.MarketActivityStats | null;
  circMv?: number;
  detailMain?: number[];
  detailRetail?: number[];
}

/**
 * 评分共享上下文
 *
 * 「列表批量评分 / 训练周期预计算 / 个股详情页」三条路径共用同一个上下文与同一套取数逻辑，
 * 保证「同一基准日 + 同一数据源」算出的分数完全一致：
 * - 预计算：把批量取到的数据（个股K线 / 资金 / 板块K线 / 涨跌比 / 市值档统计）塞进 ctx，
 *   逐日只在内存中切片 + 纯函数评分；
 * - 单只评分（列表补算、详情页）：走同一批函数，缺什么取什么，并回填 ctx 供后续复用。
 */
export interface ScoreSharedContext {
  source: FundApiType;
  /** 指数日K（secid -> 日K；取数时未截断，使用时按基准日切片） */
  indexKlinesMap: Record<string, Stock.KLineItem[]>;
  /** 个股日K（secid -> 日K，同上） */
  stockKlinesMap: Record<string, Stock.KLineItem[]>;
  /** 资金流（code -> moneyflow） */
  moneyFlowMap: Record<string, any>;
  /** 板块日K（板块代码 -> 日K） */
  boardKlinesMap: Record<string, Stock.KLineItem[]>;
  /** 涨跌比（YYYYMMDD -> 当日涨跌数据） */
  upRatioMap: Score.UpRatioMap | null;
  /** 市值档成交统计（YYYYMMDD -> stats） */
  marketStatsMap: Record<string, any>;
  /** 板块选择缓存（"代码|基准日" -> 选择结果） */
  boardChoiceMap: Record<string, BoardChoice>;
  /** 东财所属板块缓存（secid -> 板块列表） */
  bankuaiMap: Record<string, any[]>;
  /** 板块名称 -> 板块代码 解析缓存 */
  boardCodeMap: Record<string, string>;
  /** 板块「某基准日下最后一个有行情的日期」缓存（"板块代码|基准日" -> 日期） */
  boardLastDateMap: Record<string, string>;
  /** 板块「基准日附近是否有行情」的判定基准日（训练模式=训练日，预计算=窗口末日） */
  referenceDate?: string;
}

export function createScoreContext(source: FundApiType, init?: Partial<ScoreSharedContext>): ScoreSharedContext {
  return {
    source,
    indexKlinesMap: {},
    stockKlinesMap: {},
    moneyFlowMap: {},
    boardKlinesMap: {},
    upRatioMap: null,
    marketStatsMap: {},
    boardChoiceMap: {},
    bankuaiMap: {},
    boardCodeMap: {},
    boardLastDateMap: {},
    ...(init || {}),
  };
}

/** 三大指数 secid（大盘对比基准 + 涨跌比日期来源 + 交易日历来源） */
const INDEX_SECIDS = ['1.000001', '0.399001', '0.399006'];

/** 拉取日K：统一走数据源（探测板块真实历史时传 allowSynthesis:false，避免用成分股合成值参与评分） */
async function fetchDayKlines(
  source: FundApiType,
  secid: string,
  limit: number,
  options?: { allowSynthesis?: boolean; ignoreTrain?: boolean }
): Promise<Stock.KLineItem[]> {
  const r = await Services.Stock.GetKFromDataSource(source, secid, KLineType.Day, limit, options);
  return ((r?.ks as Stock.KLineItem[]) || []);
}

/** 公共上下文：三大指数日K（缺失的才取，已预取的部分保持不动） */
export async function ensureIndexKlines(ctx: ScoreSharedContext, limit = 60): Promise<Record<string, Stock.KLineItem[]>> {
  const missing = INDEX_SECIDS.filter((s) => !ctx.indexKlinesMap[s] || !ctx.indexKlinesMap[s].length);
  if (!missing.length) {
    return ctx.indexKlinesMap;
  }
  await Promise.all(
    missing.map(async (s) => {
      try {
        ctx.indexKlinesMap[s] = await fetchDayKlines(ctx.source, s, limit);
      } catch {
        ctx.indexKlinesMap[s] = [];
      }
    })
  );
  return ctx.indexKlinesMap;
}

/** 公共上下文：近 N 日涨跌比（日期来自指数日K，预计算可整段预取后直接塞进 ctx） */
export async function ensureUpRatio(ctx: ScoreSharedContext): Promise<Score.UpRatioMap> {
  if (ctx.upRatioMap && Object.keys(ctx.upRatioMap).length) {
    return ctx.upRatioMap;
  }
  await ensureIndexKlines(ctx);
  const dates = new Set<string>();
  Object.keys(ctx.indexKlinesMap).forEach((s) => {
    (ctx.indexKlinesMap[s] || [])
      .slice(-Score.SHORT_TERM_SCORE_CONFIG.marketDays)
      .forEach((k) => {
        const d = String(k?.date || '').replace(/-/g, '').substring(0, 8);
        if (d) {
          dates.add(d);
        }
      });
  });
  const list = [...dates];
  if (!list.length) {
    ctx.upRatioMap = {};
    return ctx.upRatioMap;
  }
  try {
    ctx.upRatioMap = (await Services.Tushare.GetUpRatioFromTushare(list)) || {};
  } catch {
    ctx.upRatioMap = {};
  }
  return ctx.upRatioMap;
}

/** 公共上下文：某交易日的市值档成交统计（量能横向对比） */
export async function ensureMarketStats(ctx: ScoreSharedContext, dayKey: string): Promise<any> {
  const key = (dayKey || '').replace(/-/g, '');
  if (!key) {
    return null;
  }
  if (ctx.marketStatsMap[key] !== undefined) {
    return ctx.marketStatsMap[key];
  }
  try {
    ctx.marketStatsMap[key] = await Services.Tushare.GetMarketActivityStatsFromTushare(key);
  } catch {
    ctx.marketStatsMap[key] = null;
  }
  return ctx.marketStatsMap[key];
}

/** 板块名称清洗（去掉名字里附带的 BK 代码） */
const cleanBoardName = (name: string) => String(name || '').replace(/[，,]\s*BK\d+\s*$/i, '').trim();

/** 东财所属板块（按 secid 缓存，避免同一只股票在多个交易日里重复请求） */
async function getBankuais(ctx: ScoreSharedContext, secid: string): Promise<any[]> {
  if (ctx.bankuaiMap[secid]) {
    return ctx.bankuaiMap[secid];
  }
  try {
    const list = (await Services.Stock.GetStockBankuaisFromEastmoney(secid)) || [];
    ctx.bankuaiMap[secid] = Array.isArray(list) ? list : [];
  } catch {
    ctx.bankuaiMap[secid] = [];
  }
  return ctx.bankuaiMap[secid];
}

/** 板块日K（真实数据，不用成分股合成值；按板块代码缓存） */
async function getBoardKlines(ctx: ScoreSharedContext, boardCode: string): Promise<Stock.KLineItem[]> {
  if (ctx.boardKlinesMap[boardCode]) {
    return ctx.boardKlinesMap[boardCode];
  }
  try {
    ctx.boardKlinesMap[boardCode] = await fetchDayKlines(ctx.source, `90.${boardCode}`, 60, { allowSynthesis: false });
  } catch {
    ctx.boardKlinesMap[boardCode] = [];
  }
  return ctx.boardKlinesMap[boardCode];
}

/** 板块名称 -> 代码（按名称缓存） */
async function resolveBoardCode(ctx: ScoreSharedContext, name: string): Promise<string> {
  const key = cleanBoardName(name);
  if (!key) {
    return '';
  }
  if (ctx.boardCodeMap[key]) {
    return ctx.boardCodeMap[key];
  }
  try {
    const code = await Services.Stock.ResolveBoardCodeByName(key, ctx.source);
    if (code) {
      ctx.boardCodeMap[key] = code;
    }
    return code || '';
  } catch {
    return '';
  }
}

/** 板块在 <= date 的最后一个有行情的日期（按"板块代码|基准日"缓存，预计算逐日调用时才够快） */
function boardLastDateOnOrBefore(ctx: ScoreSharedContext, boardCode: string, ks: Stock.KLineItem[], date: string): string {
  const key = `${boardCode}|${date || ''}`;
  const cached = ctx.boardLastDateMap[key];
  if (cached !== undefined) {
    return cached;
  }
  let last = '';
  if (ks && ks.length) {
    const target = date ? toDay(date) : '';
    ks.forEach((k) => {
      const d = toDay(k?.date);
      if (!d) {
        return;
      }
      if (target && d > target) {
        return;
      }
      if (d > last) {
        last = d;
      }
    });
  }
  ctx.boardLastDateMap[key] = last;
  return last;
}

/**
 * 解析某只股票在「基准日」的板块选择：
 * 所属板块（手动设置优先，其次东财所属板块）+ 市值风格板块（大盘评分对比基准）。
 *
 * 与个股详情页口径完全一致：候选取前 10 个，逐个按名称解析代码，
 * 并取「基准日附近仍有真实行情」的第一个；板块自身数据缺失时该维度不参与评分。
 */
export async function resolveBoards(
  ctx: ScoreSharedContext,
  code: string,
  secid: string,
  hybk: { code: string; name: string } | null | undefined,
  referenceDate: string
): Promise<BoardChoice> {
  const cacheKey = `${code}|${referenceDate || ''}`;
  if (ctx.boardChoiceMap[cacheKey]) {
    return ctx.boardChoiceMap[cacheKey];
  }
  const choice: BoardChoice = { board: null, sizeBoard: null };
  try {
    const boards = await getBankuais(ctx, secid);
    const candidates: { code: string; name: string }[] = [];
    if (hybk) {
      candidates.push({ code: hybk.code, name: hybk.name });
    }
    boards.forEach((b: any) => {
      if (b && b.code && !candidates.some((c) => c.code === b.code)) {
        candidates.push({ code: b.code, name: b.name });
      }
    });

    for (const c of candidates.slice(0, BOARD_CANDIDATE_LIMIT)) {
      const resolved = (await resolveBoardCode(ctx, c.name)) || c.code;
      const ks = await getBoardKlines(ctx, resolved);
      const last = boardLastDateOnOrBefore(ctx, resolved, ks, referenceDate);
      const near =
        !!last &&
        (!referenceDate ||
          Math.abs((new Date(toDay(referenceDate)).getTime() - new Date(last).getTime()) / 86400000) <= BOARD_NEAR_DAYS);
      if (near) {
        choice.board = { code: resolved, name: cleanBoardName(c.name) || c.name };
        break;
      }
    }
    if (!choice.board) {
      if (hybk) {
        choice.board = { code: hybk.code, name: cleanBoardName(hybk.name) };
      } else if (boards.length) {
        choice.board = { code: boards[0].code, name: cleanBoardName(boards[0].name) };
      }
    }

    const size = boards.find((b: any) => SIZE_BOARD_NAMES.includes(b?.name));
    if (size) {
      const sizeCode = (await resolveBoardCode(ctx, size.name)) || size.code;
      choice.sizeBoard = { code: sizeCode, name: size.name };
    }
  } catch {
    // 板块解析失败时按维度缺失处理
  }
  ctx.boardChoiceMap[cacheKey] = choice;
  return choice;
}

/**
 * 准备某只股票在某个评分基准日的全部输入（列表 / 预计算 / 详情页共用）
 *
 * 所有序列都严格按 `scoreDay` 截断，保证「预计算第 D 天的结果」与「训练日推进到 D 时现算的结果」
 * 以及「个股详情页看到的结果」完全同源同口径。
 */
export async function buildStockScoreInputs(
  ctx: ScoreSharedContext,
  item: ShortTermScoreItem,
  scoreDay: string,
  options?: { moneyFlow?: any }
): Promise<StockScoreInputs> {
  const code = item.code;
  const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`;

  // 个股日K（预计算走批量预取，单只评分现取并回填缓存）
  if (!ctx.stockKlinesMap[secid]) {
    ctx.stockKlinesMap[secid] = await fetchDayKlines(ctx.source, secid, 250);
  }
  const klines = sliceKlines(ctx.stockKlinesMap[secid], scoreDay, 250);

  await ensureIndexKlines(ctx);
  const indexKlines = sliceKlines(ctx.indexKlinesMap[indexSecidOfStock(code)], scoreDay, 60);

  // 板块 + 市值风格板块（基准日附近仍有行情的优先）
  const referenceDate = ctx.referenceDate || scoreDay;
  const choice = await resolveBoards(ctx, code, secid, item.hybk || null, referenceDate);
  let boardKlines: Stock.KLineItem[] = [];
  let boardName = '';
  if (choice.board) {
    boardKlines = sliceKlines(await getBoardKlines(ctx, choice.board.code), scoreDay, 60);
    boardName = choice.board.name;
  }

  // 大盘对比基准：市值风格板块优先，无数据时回退所属指数
  let baselineKlines = indexKlines;
  let baselineName = code.startsWith('6') ? '上证指数' : code.startsWith('3') ? '创业板指' : '深证成指';
  if (choice.sizeBoard) {
    const ks = sliceKlines(await getBoardKlines(ctx, choice.sizeBoard.code), scoreDay, 60);
    if (ks.length) {
      baselineKlines = ks;
      baselineName = choice.sizeBoard.name;
    }
  }

  // 资金：60日主力/散户明细（详情页可传入已取好的同名数据）
  let detailMain: number[] | undefined;
  let detailRetail: number[] | undefined;
  try {
    let mf = options?.moneyFlow;
    if (!mf) {
      mf = ctx.moneyFlowMap[code];
    }
    if (!mf) {
      mf = await Services.Tushare.GetMoneyFlowFromTushare(code, 60);
      ctx.moneyFlowMap[code] = mf;
    }
    const sliced = sliceMoneyTo(mf, scoreDay, 60);
    detailMain = sliced.detailMain;
    detailRetail = sliced.detailRetail;
  } catch {
    // 资金获取失败时按维度缺失处理
  }

  const upRatioMap = await ensureUpRatio(ctx);
  const marketStats = await ensureMarketStats(ctx, scoreDay);

  return {
    klines,
    baselineKlines,
    baselineName,
    boardKlines,
    boardName,
    upRatioMap,
    marketStats,
    circMv: item.circMv,
    detailMain,
    detailRetail,
  };
}

/**
 * 评分基准日归位到「真实交易日」
 *
 * 训练模式下基准日直接取自训练日期，而训练日期可能落在非交易日（节假日/周末）。
 * 此时 K线/资金等数据实际只到「该日之前的最后一个交易日」，若仍按非交易日读写缓存，
 * 就会把上一交易日的结果写成该日评分，之后再读取就会拿到名不副实（已过期）的分数。
 * 这里用指数日K（取时不截断）把基准日归位到 <= 该日期的最后一个真实交易日。
 */
export async function resolveScoreDate(source: FundApiType, date: string, ctx?: ScoreSharedContext): Promise<string> {
  const canonical = toDay(date);
  try {
    let ks: Stock.KLineItem[] = [];
    if (ctx && ctx.indexKlinesMap['1.000001'] && ctx.indexKlinesMap['1.000001'].length) {
      ks = ctx.indexKlinesMap['1.000001'];
    } else {
      // 关键：这里必须让训练过滤生效（不能传 ignoreTrain）。
      // 训练过滤生效时取到的是「截止到训练日」的数据，训练日为非交易日（周末/节假日）时，
      // 最后一根就是上一个真实交易日；若传 ignoreTrain，拿到的是「真实今天」的最近 N 根，
      // 筛 `<= 训练日` 永远为空，归位就形同虚设（缓存 key 会写成非交易日 → 必然未命中）。
      ks = await fetchDayKlines(source, '1.000001', 30);
      if (ctx) {
        ctx.indexKlinesMap['1.000001'] = ks;
      }
    }
    const dates = [...new Set(ks.map((k) => toDay(k?.date)).filter(Boolean))].sort();
    const before = dates.filter((d) => d <= canonical);
    if (before.length) {
      const resolved = before[before.length - 1].replace(/-/g, '');
      if (resolved !== date.replace(/-/g, '')) {
        console.warn(`[短线评分] 基准日 ${canonical} 不是交易日（或当天无数据），按 ${resolved} 读写评分缓存`);
      }
      return resolved;
    }
  } catch {
    // 归位失败时沿用原日期
  }
  return date.replace(/-/g, '');
}

/**
 * 取最近 count 个交易日（YYYYMMDD，升序）
 *
 * 用于短线评分列表的「近 N 日评分」历史列：日期口径与评分基准日一致（指数日K），
 * 训练模式下受训练日收敛，因此不会取到训练日之后的交易日。
 */
export async function resolveRecentTradingDays(source: FundApiType, count: number): Promise<string[]> {
  if (!count || count <= 0) {
    return [];
  }
  try {
    const ks = await fetchDayKlines(source, '1.000001', count + 20);
    const dates = [...new Set(ks.map((k) => toDay(k?.date)).filter(Boolean))].sort();
    return dates.slice(-count).map((d) => d.replace(/-/g, ''));
  } catch {
    return [];
  }
}

/**
 * 预热某只股票的板块信息：拉取所属板块、解析候选板块代码
 *
 * 预计算用它把「需要批量取K线的板块代码」一次性收集好（所属板块候选 + 市值风格板块），
 * 避免逐日逐只重复解析；实际选择哪个板块仍由 resolveBoards 按基准日决定。
 */
export async function primeBoards(ctx: ScoreSharedContext, item: ShortTermScoreItem): Promise<string[]> {
  const code = item.code;
  const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`;
  const codes: string[] = [];
  try {
    const boards = await getBankuais(ctx, secid);
    const candidates: { code: string; name: string }[] = [];
    if (item.hybk) {
      candidates.push({ code: item.hybk.code, name: item.hybk.name });
    }
    boards.forEach((b: any) => {
      if (b && b.code && !candidates.some((c) => c.code === b.code)) {
        candidates.push({ code: b.code, name: b.name });
      }
    });
    for (const c of candidates.slice(0, BOARD_CANDIDATE_LIMIT)) {
      const resolved = (await resolveBoardCode(ctx, c.name)) || c.code;
      if (resolved) {
        codes.push(resolved);
      }
    }
    const size = boards.find((b: any) => SIZE_BOARD_NAMES.includes(b?.name));
    if (size) {
      const sizeCode = (await resolveBoardCode(ctx, size.name)) || size.code;
      if (sizeCode) {
        codes.push(sizeCode);
      }
    }
  } catch {
    // 板块解析失败时按维度缺失处理
  }
  return [...new Set(codes)];
}

/** 读取评分序列（一次取回整个股票池的序列，{ 股票代码: { 交易日: 评分行 } }） */
export async function loadScoreSeries(
  codes: string[],
  source: FundApiType,
  options?: { ignoreTrain?: boolean }
): Promise<ShortTermScoreSeries> {
  if (!codes || !codes.length) {
    return {};
  }
  try {
    return (await Services.Tushare.GetShortTermScoreSeriesFromTushare(codes, source, options)) || {};
  } catch {
    return {};
  }
}

/**
 * 从序列中取「评分基准日」的评分行
 *
 * 只认基准日当天的结果：取更早的一天会把上一交易日的分数当成今天的分数（名不副实的旧分），
 * 因此未命中就返回 null，由调用方现算并写回序列。
 */
export function pickScoreRow(
  series: Record<string, any> | undefined,
  date: string
): { row: ShortTermScoreRow; date: string } | null {
  if (!series || !date) {
    return null;
  }
  const target = date.replace(/-/g, '');
  const key = Object.keys(series).find((k) => String(k).replace(/-/g, '') === target);
  if (!key || !series[key] || typeof series[key] !== 'object') {
    return null;
  }
  return { row: series[key] as ShortTermScoreRow, date: target };
}

/**
 * 读某只股票在「某个基准日」的缓存评分行（详情页/列表共用的唯一分数来源）
 *
 * 命中即返回该日缓存行，未命中返回 null（由调用方现算并回写序列）。
 * 有了它，「列表分」与「详情页分」读的是同一份数据，不会再出现两边不一致。
 */
export async function getCachedScoreRow(params: {
  code: string;
  source: FundApiType;
  /** 训练日期（YYYY-MM-DD / YYYYMMDD）；留空表示非训练模式（按行情最后交易日） */
  date?: string;
}): Promise<{ row: ShortTermScoreRow; day: string } | null> {
  const { code, source } = params;
  const trainDay = params.date ? toDay(params.date) : '';
  let dayKey = '';
  if (trainDay) {
    dayKey = await resolveScoreDate(source, trainDay.replace(/-/g, ''));
  } else {
    try {
      const ks = await fetchDayKlines(source, '1.000001', 30);
      const dates = [...new Set(ks.map((k) => toDay(k?.date)).filter(Boolean))].sort();
      dayKey = (dates[dates.length - 1] || '').replace(/-/g, '');
    } catch {
      dayKey = '';
    }
  }
  if (!dayKey) {
    return null;
  }
  const series = await loadScoreSeries([code], source);
  const hit = pickScoreRow(series[code], dayKey);
  return hit ? { row: { ...hit.row, code, name: hit.row.name || code }, day: hit.date } : null;
}

/** 回写评分序列（按交易日合并到每只股票自己的序列里） */
export async function saveScoreSeries(series: ShortTermScoreSeries, source: FundApiType): Promise<void> {
  if (!series || !Object.keys(series).length) {
    return;
  }
  try {
    await Services.Tushare.SaveShortTermScoreSeriesToTushare(series, source);
  } catch {
    // 回写失败不影响本次展示
  }
}

interface ComputeOptions {
  source: FundApiType; // K线数据源
  concurrency?: number; // 并发数，默认3
  shouldStop?: () => boolean; // 返回 true 时暂停（当前股票完成后停止取新任务）
  onRow?: (row: ShortTermScoreRow, item: ShortTermScoreItem, done: number, total: number) => void;
}

/**
 * 批量计算股票短线评分（与个股详情页"短线评分"同源逻辑）：
 * 个股(量能20+资金60，RSI 仅展示不计入) 60% + 板块 20% + 大盘 20%，缺失维度按剩余权重归一化。
 *
 * 评分结果按「个股时间序列」缓存（一只股票一条序列，含多个交易日的评分行）：
 * - 训练模式下先按训练日（归位到真实交易日）在序列里取点，命中的直接出分、零取数；
 * - 未命中的才取数计算，算完合并回各自的序列，之后（含训练日推进后的回看）直接命中。
 *
 * 公共数据（指数K线 / 涨跌比 / 市值档统计）只准备一次，个股数据并发拉取并逐只回调，支持中途暂停。
 */
export async function computeShortTermScoreRows(items: ShortTermScoreItem[], options: ComputeOptions): Promise<ShortTermScoreRow[]> {
  const { source, concurrency = 3, shouldStop, onRow } = options;
  const results: ShortTermScoreRow[] = [];
  if (!items || items.length === 0) {
    return results;
  }

  const total = items.length;
  let done = 0;
  /** 未命中序列、需要实际取数计算的股票 */
  const pending: ShortTermScoreItem[] = [...items];
  const ctx = createScoreContext(source);

  // ---- 评分基准日：训练模式用训练日（归位到真实交易日），非训练模式取行情最后交易日 ----
  const trainDateKey = (TrainFilter.GetTrainToDate() || '').replace(/-/g, '');
  let scoreDayKey = trainDateKey ? await resolveScoreDate(source, trainDateKey, ctx) : '';

  const codes = items.map((i) => i.code);

  /** 用评分序列填充（未命中的进入 pending） */
  const fillFromSeries = (series: ShortTermScoreSeries) => {
    pending.length = 0;
    items.forEach((item) => {
      const hit = pickScoreRow(series[item.code], scoreDayKey);
      if (hit?.row && typeof hit.row === 'object') {
        // 名字以调用方股票池为准（缓存行可能只存了代码）
        const row = { ...hit.row, code: item.code, name: hit.row.name || item.name || item.code } as ShortTermScoreRow;
        results.push(row);
        done += 1;
        try {
          onRow?.(row, item, done, total);
        } catch {
          // 回调异常不影响主流程
        }
        return;
      }
      pending.push(item);
    });
  };

  // ---- 命中序列即出分：一次调用取回整个股票池的全部序列 ----
  if (scoreDayKey) {
    fillFromSeries(await loadScoreSeries(codes, source));
    if (!pending.length) {
      console.log(`[短线评分] 基准日 ${scoreDayKey}：${total} 只全部命中评分序列缓存，无需取数`);
      return results;
    }
    console.log(`[短线评分] 基准日 ${scoreDayKey}：序列命中 ${total - pending.length} 只，需现算 ${pending.length} 只`);
  }

  // ---- 未命中：准备公共上下文（指数日K / 涨跌比）----
  await ensureIndexKlines(ctx);
  await ensureUpRatio(ctx);

  if (!scoreDayKey) {
    // 非训练模式：此时才拿到行情基准日（指数数据里的最后一个交易日）
    const dates = new Set<string>();
    Object.keys(ctx.indexKlinesMap).forEach((s) => {
      (ctx.indexKlinesMap[s] || []).forEach((k) => {
        const d = String(k?.date || '').replace(/-/g, '').substring(0, 8);
        if (d) {
          dates.add(d);
        }
      });
    });
    scoreDayKey = [...dates].sort().pop() || '';
    if (scoreDayKey) {
      fillFromSeries(await loadScoreSeries(codes, source));
      if (!pending.length) {
        console.log(`[短线评分] 基准日 ${scoreDayKey}：${total} 只全部命中评分序列缓存，无需取数`);
        return results;
      }
      console.log(`[短线评分] 基准日 ${scoreDayKey}：序列命中 ${total - pending.length} 只，需现算 ${pending.length} 只`);
    }
  }
  await ensureMarketStats(ctx, scoreDayKey);

  // 评分基准日（YYYY-MM-DD）：所有输入序列都按它截断，保证与个股详情页同口径
  const scoreDay = scoreDayKey ? `${scoreDayKey.substring(0, 4)}-${scoreDayKey.substring(4, 6)}-${scoreDayKey.substring(6, 8)}` : '';

  const processOne = async (item: ShortTermScoreItem): Promise<ShortTermScoreRow> => {
    try {
      const inputs = await buildStockScoreInputs(ctx, item, scoreDay);
      return computeShortTermScoreForDate({ code: item.code, name: item.name, ...inputs }).row;
    } catch (e: any) {
      // 取数异常同样按 0 分入缓存，避免每次点击都为同一只股票重复取数
      return zeroShortTermScoreRow(item.code, item.name, e?.message || '评分失败');
    }
  };

  // 并发工作池：逐只回调，支持暂停
  const queue = [...pending];
  const worker = async () => {
    while (queue.length > 0) {
      if (shouldStop?.()) {
        return;
      }
      const item = queue.shift()!;
      const row = await processOne(item);
      results.push(row);
      done += 1;
      try {
        onRow?.(row, item, done, total);
      } catch {
        // 回调异常不影响主流程
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()));

  // ---- 回写评分序列：按交易日合并到每只股票自己的序列 ----
  // 无有效数据的股票也按 0 分写入（行内带原因），下次点击直接命中，不再重新取数。
  if (scoreDayKey) {
    const series: ShortTermScoreSeries = {};
    let zeroCount = 0;
    results.forEach((r) => {
      if (r.error) {
        zeroCount += 1;
      }
      series[r.code] = { [scoreDayKey]: r };
    });
    await saveScoreSeries(series, source);
    if (zeroCount) {
      console.log(`[短线评分] 其中 ${zeroCount} 只无有效数据，已按 0 分写入缓存（后续不再重复取数）`);
    }
  }
  return results;
}

/**
 * 个股详情页「短线评分」入口：与列表 / 预计算共用同一套取数与评分逻辑
 *
 * 训练模式下按训练日（归位到真实交易日）取数，算完把该交易日的结果写回个股的评分序列，
 * 列表下次评分直接命中同一份数据 —— 详情页与列表的分数因此必然一致。
 */
export async function computeStockScoreForCode(params: {
  code: string;
  name?: string;
  source: FundApiType;
  /** 训练日期（YYYY-MM-DD / YYYYMMDD）；非训练模式留空，按数据里最后一个交易日 */
  date?: string;
  circMv?: number;
  /** 详情页已在「核心交易」取好的资金流向（含 60 日明细），传入可复用、避免重复取数 */
  moneyFlow?: { detail_main?: number[]; detail_retail?: number[]; detail_dates?: string[] } | null;
  /** 手动设置的活跃板块 */
  hybk?: { code: string; name: string } | null;
  ctx?: ScoreSharedContext;
}): Promise<{
  row: ShortTermScoreRow;
  detail: ShortTermScoreDetail | null;
  klines: Stock.KLineItem[];
  /** 数据截止日（个股日K最后一根） */
  lastDate: string;
  /** 评分基准日（YYYY-MM-DD） */
  scoreDay: string;
  /** 评分基准日（YYYYMMDD，缓存序列的 key） */
  scoreDayKey: string;
  boardName: string;
  baselineName: string;
} | null> {
  const { code, name, source, circMv, moneyFlow, hybk } = params;
  const ctx = params.ctx || createScoreContext(source);
  const trainDay = params.date ? toDay(params.date) : '';
  const scoreDayKey = trainDay ? await resolveScoreDate(source, trainDay, ctx) : '';
  const item: ShortTermScoreItem = { code, name, circMv, hybk: hybk || null };

  const inputs = await buildStockScoreInputs(ctx, item, scoreDayKey, { moneyFlow });
  const { row, detail } = computeShortTermScoreForDate({ code, name, ...inputs });
  const lastDate = inputs.klines.length ? toDay(inputs.klines[inputs.klines.length - 1].date) : '';
  const dayKey = scoreDayKey || lastDate.replace(/-/g, '');
  const scoreDay = dayKey ? `${dayKey.substring(0, 4)}-${dayKey.substring(4, 6)}-${dayKey.substring(6, 8)}` : '';

  // 把该交易日的结果写回这只股票的评分序列，供列表直接命中；
  // 无有效数据时同样是 0 分占位行（带原因），避免列表为它重复取数。
  if (dayKey) {
    await saveScoreSeries({ [code]: { [dayKey]: row } }, source);
  }

  return {
    row,
    detail,
    klines: inputs.klines,
    lastDate,
    scoreDay,
    scoreDayKey: dayKey,
    boardName: inputs.boardName,
    baselineName: inputs.baselineName,
  };
}
