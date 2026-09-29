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
  if (!ks || !ks.length) {
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

/**
 * 单只股票在「某个交易日」的短线评分（纯计算，不取数）：
 * 传入的 K线/资金明细必须已按该交易日截断。列表批量评分、训练周期预计算共用这一套算法，
 * 保证同一天的评分口径完全一致。
 */
export function computeShortTermRowForDate(params: {
  code: string;
  name?: string;
  klines: Stock.KLineItem[];
  indexKlines: Stock.KLineItem[];
  boardKlines: Stock.KLineItem[];
  boardName: string;
  upRatioMap?: Score.UpRatioMap | null;
  marketStats?: Score.MarketActivityStats | null;
  circMv?: number;
  detailMain?: number[];
  detailRetail?: number[];
}): ShortTermScoreRow {
  const { code, name, klines, indexKlines, boardKlines, boardName, upRatioMap, marketStats, circMv, detailMain, detailRetail } = params;
  if (!klines || klines.length < 30) {
    const row = emptyShortTermScoreRow(code, name);
    row.error = `日K数据不足（${klines?.length || 0}条）`;
    return row;
  }
  const market = Score.scoreMarket(klines, indexKlines || [], upRatioMap);
  const sector = Score.scoreSector(klines, boardKlines, boardName);
  const volume = Score.scoreStockVolume(klines, marketStats, circMv);
  const rsi = Score.scoreStockRsi(klines);
  const money = Score.scoreStockMoney(detailMain, detailRetail);
  const stock = Score.scoreStock(volume, rsi, money);
  const overall = Score.composeShortTermScore(market, sector, stock);
  return buildShortTermScoreRow({ code, name, overall, market, sector, stock, volume, rsi, money });
}

interface ComputeOptions {
  source: FundApiType; // K线数据源
  concurrency?: number; // 并发数，默认3
  shouldStop?: () => boolean; // 返回 true 时暂停（当前股票完成后停止取新任务）
  onRow?: (row: ShortTermScoreRow, item: ShortTermScoreItem, done: number, total: number) => void;
}

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

/**
 * 评分基准日归位到「真实交易日」
 *
 * 训练模式下 key 直接取自训练日期，而训练日期可能落在非交易日（节假日/周末）。
 * 此时 K线/资金等数据实际只到「该日之前的最后一个交易日」，若仍按非交易日读写缓存，
 * 就会把上一交易日的结果写成该日评分，之后再读取就会拿到名不副实（已过期）的分数。
 * 这里用指数日K（取时不截断）把基准日归位到 <= 该日期的最后一个真实交易日。
 */
async function resolveScoreCacheDate(source: FundApiType, date: string): Promise<string> {
  const canonical = `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}`;
  try {
    const ks = await fetchDayKlines(source, '1.000001', 30, { ignoreTrain: true });
    const dates = [
      ...new Set(ks.map((k) => String(k?.date || '').substring(0, 10)).filter(Boolean)),
    ].sort();
    const before = dates.filter((d) => d <= canonical);
    if (before.length) {
      const resolved = before[before.length - 1].replace(/-/g, '');
      if (resolved !== date) {
        console.warn(`[短线评分] 基准日 ${canonical} 不是交易日，按 ${resolved} 读写评分缓存`);
      }
      return resolved;
    }
  } catch {
    // 归位失败时沿用原日期
  }
  return date;
}

/**
 * 批量计算股票短线评分（与个股详情页"短线评分"同源逻辑）：
 * 个股(量能20+资金60，RSI 仅展示不计入) 60% + 板块 20% + 大盘 20%，缺失维度按剩余权重归一化。
 * 公共数据（指数K线/涨跌比/市值档统计）只拉取一次，个股数据并发拉取并逐只回调，支持中途暂停。
 */
export async function computeShortTermScoreRows(items: ShortTermScoreItem[], options: ComputeOptions): Promise<ShortTermScoreRow[]> {
  const { source, concurrency = 3, shouldStop, onRow } = options;
  const results: ShortTermScoreRow[] = [];
  if (!items || items.length === 0) {
    return results;
  }

  const total = items.length;
  let done = 0;
  /** 未命中缓存、需要实际取数计算的股票 */
  const pending: ShortTermScoreItem[] = [...items];

  // ---- 评分结果缓存（meta.db/api_cache，按交易日分桶）----
  // 命中缓存的股票直接出分（不再取数/计算），未命中的计算完成后回写数据库。
  // 训练模式下「当前训练日」就是评分基准日，可先查缓存；非训练模式需先取到行情最后交易日再查。
  const trainDateKey = (TrainFilter.GetTrainToDate() || '').replace(/-/g, '');
  let cacheDate = trainDateKey;
  let cachedRows: Record<string, any> = {};

  /** 用缓存结果填充（未命中的进入 pending） */
  const fillFromCache = () => {
    pending.length = 0;
    items.forEach((item) => {
      const hit = cachedRows[item.code];
      if (hit && typeof hit === 'object') {
        // 名字以调用方股票池为准（缓存行可能只存了代码）
        const row = { ...hit, code: item.code, name: hit.name || item.name || item.code } as ShortTermScoreRow;
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

  if (cacheDate) {
    // 训练日期可能是非交易日，先归位到真实交易日再读写缓存
    cacheDate = await resolveScoreCacheDate(source, cacheDate);
    cachedRows = await Services.Tushare.GetShortTermScoreCacheFromTushare(cacheDate, source);
    fillFromCache();
    if (!pending.length) {
      // 该交易日已全部缓存，无需再取数计算
      return results;
    }
  }

  // ---- 公共上下文：三大指数日K（大盘评分对比基准 + 涨跌比日期来源）----
  const indexSecids = ['1.000001', '0.399001', '0.399006'];
  const indexKlinesMap: Record<string, Stock.KLineItem[]> = {};
  await Promise.all(
    indexSecids.map(async (s) => {
      try {
        indexKlinesMap[s] = await fetchDayKlines(source, s, 60);
      } catch {
        indexKlinesMap[s] = [];
      }
    })
  );

  // ---- 公共上下文：近 N 日涨跌比 ----
  let upRatioMap: Record<string, any> = {};
  const allIndexDates = new Set<string>();
  indexSecids.forEach((s) => {
    (indexKlinesMap[s] || []).slice(-Score.SHORT_TERM_SCORE_CONFIG.marketDays).forEach((k) => {
      allIndexDates.add(k.date.replace(/-/g, ''));
    });
  });
  if (allIndexDates.size > 0) {
    try {
      upRatioMap = (await Services.Tushare.GetUpRatioFromTushare([...allIndexDates])) || {};
    } catch {
      upRatioMap = {};
    }
  }

  // ---- 公共上下文：市值档成交统计（量能横向对比）----
  // 显式以数据中最后一个交易日为基准（训练模式下即训练日期），避免默认取到「最近交易日」
  let marketStats: any = null;
  const anchorDate = [...allIndexDates].sort().pop();
  try {
    // 训练模式已有明确基准日，优先用它（数据源若返回更晚的数据，这里不能跟着取更晚的统计）
    marketStats = await Services.Tushare.GetMarketActivityStatsFromTushare(cacheDate || anchorDate);
  } catch {
    marketStats = null;
  }

  const emptyRow = (item: ShortTermScoreItem): ShortTermScoreRow => emptyShortTermScoreRow(item.code, item.name);

  // 评分基准日（YYYY-MM-DD）：与写入缓存用的 key 对应，所有输入序列都按它截断，
  // 保证「列表批量评分」与「个股详情页」完全同口径（见 sliceKlines / sliceMoneyTo 说明）
  const scoreDay = cacheDate ? `${cacheDate.substring(0, 4)}-${cacheDate.substring(4, 6)}-${cacheDate.substring(6, 8)}` : '';

  const processOne = async (item: ShortTermScoreItem): Promise<ShortTermScoreRow> => {
    const code = item.code;
    const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`;
    try {
      const dklines = sliceKlines(await fetchDayKlines(source, secid, 250), scoreDay, 250);
      if (!dklines || dklines.length < 30) {
        const row = emptyRow(item);
        row.error = `日K数据不足（${dklines?.length || 0}条）`;
        return row;
      }

      // 板块：手动设置优先；否则按顺序探测所属板块，取"训练日期附近仍有行情"的一个
      // （只用真实板块数据，不用成分股合成；避免选中训练日之后才成立或早已停更的板块）
      // 板块 BK 代码在不同数据源命名空间不一致，统一按「名称」在当前数据源里解析代码
      const cleanBoardName = (name: string) => String(name || '').replace(/[，,]\s*BK\d+\s*$/i, '').trim();
      const resolveBoardCode = (name: string): Promise<string> =>
        Services.Stock.ResolveBoardCodeByName(name, source);
      let boardKlines: Stock.KLineItem[] = [];
      let boardName = '';
      try {
        const trainDate = TrainFilter.GetTrainToDate();
        const candidates: any[] = item.hybk
          ? [item.hybk]
          : (((await Services.Stock.GetStockBankuaisFromEastmoney(secid)) || []) as any[]).slice(0, 3);
        for (const bk of candidates) {
          if (!bk) {
            continue;
          }
          const boardCode = (await resolveBoardCode(bk.name)) || bk.code;
          const ks = await fetchDayKlines(source, `90.${boardCode}`, 60, { allowSynthesis: false });
          const lastDate = ks.length ? String(ks[ks.length - 1].date).substring(0, 10) : '';
          const nearTrainDate =
            !trainDate ||
            (!!lastDate && Math.abs(new Date(trainDate).getTime() - new Date(lastDate).getTime()) / 86400000 <= 15);
          if (ks.length && nearTrainDate) {
            boardName = cleanBoardName(bk.name) || bk.name;
            boardKlines = sliceKlines(ks, scoreDay, 60);
            break;
          }
        }
      } catch {
        // 板块获取失败时按维度缺失处理
      }

      // 资金：60日主力/散户明细
      let detailMain: number[] | undefined;
      let detailRetail: number[] | undefined;
      try {
        const mf = await Services.Tushare.GetMoneyFlowFromTushare(code, 60);
        const sliced = sliceMoneyTo(mf, scoreDay, 60);
        detailMain = sliced.detailMain;
        detailRetail = sliced.detailRetail;
      } catch {
        // 资金获取失败时按维度缺失处理
      }

      return computeShortTermRowForDate({
        code,
        name: item.name,
        klines: dklines,
        indexKlines: sliceKlines(indexKlinesMap[indexSecidOfStock(code)], scoreDay, 60),
        boardKlines,
        boardName,
        upRatioMap,
        marketStats,
        circMv: item.circMv,
        detailMain,
        detailRetail,
      });
    } catch (e: any) {
      const row = emptyRow(item);
      row.error = e?.message || '评分失败';
      return row;
    }
  };

  // 非训练模式：此时才拿到行情基准日（数据中的最后一个交易日），按该日查一次缓存
  if (!cacheDate) {
    cacheDate = anchorDate || '';
    if (cacheDate) {
      cachedRows = await Services.Tushare.GetShortTermScoreCacheFromTushare(cacheDate, source);
      fillFromCache();
    }
  }

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

  // ---- 回写本次评分结果（失败行不写，便于下次重算）----
  if (cacheDate) {
    const fresh: Record<string, any> = {};
    results.forEach((r) => {
      if (!r.error) {
        fresh[r.code] = r;
      }
    });
    if (Object.keys(fresh).length) {
      await Services.Tushare.SaveShortTermScoreCacheToTushare(cacheDate, fresh, source);
    }
  }
  return results;
}
