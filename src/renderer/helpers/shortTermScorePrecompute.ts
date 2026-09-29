import dayjs from 'dayjs';
import * as Services from '@/services';
import { FundApiType, KLineType } from '@/utils/enums';
import { Stock } from '@/types/stock';
import * as Score from './shortTermScore';
import {
  computeShortTermRowForDate,
  indexSecidOfStock,
  ShortTermScoreItem,
} from './shortTermScoreList';

/**
 * 训练周期短线评分预计算
 *
 * 用途：训练模式下按「每个交易日 × 每只股票」预先算好短线评分并写入数据库缓存
 * （meta.db/api_cache，key = short_term_score_{交易日}_{数据源}），之后在 STList 执行短线评分
 * 会直接命中缓存、不再逐只取数计算。
 *
 * 训练窗口是已知的历史区间，因此这里一次把**整段窗口（trainStartDate ~ trainEndDate）**算完：
 * 取数按窗口末日（`ignoreTrain` 绕过训练日期收敛，原始数据不进入界面，渲染层出口仍按训练日截断），
 * 但每只股票在每个交易日的评分只用「该交易日及之前」的K线/资金明细切片计算，
 * 所以第 D 天算出的分数，与训练日推进到 D 时现算的结果完全一致；界面也只在训练日到达 D 后才读该日缓存。
 *
 * 性能设计（把原来「每只股票每天各启动若干 python 进程」变成一次批量取数）：
 * - 个股日K / 指数日K / 板块日K：各一次 `get_kline_data_batch`（内部线程池 + 各自数据库缓存）
 * - 个股资金流：一次 `get_money_flow_batch`
 * - 市值档成交统计：一次 `get_market_activity_stats_batch`
 * - 涨跌比：一次 `get_up_down_ratio_batch`（按日期，历史日期长期缓存）
 * - 板块代码解析：进程内记忆板块列表（见 services/tushare.ts 的 GetBoardListsMemo）
 * 之后逐日只在内存中切片 + 纯函数评分，并按交易日写入缓存。
 *
 * 增量：开始前会检查每个交易日对本次股票池的缓存覆盖情况，已覆盖全部股票的日子直接跳过；
 * 整段窗口预计算完成后，训练日推进（下一天）无需再做任何取数/计算。
 */

/** 每个交易日评分所需的个股历史K线根数（RSI24 + 历史分位需要较长历史） */
const STOCK_KLINES_PER_DAY = 250;
/** 每个交易日评分所需的指数K线根数（大盘维度取近 10 日） */
const INDEX_KLINES_PER_DAY = 60;
/** 每个交易日评分所需的板块K线根数（板块维度取近 20 日） */
const BOARD_KLINES_PER_DAY = 60;
/** 每个交易日评分所需的资金明细天数（20日累计 + 30日形态识别，留缓冲） */
const MONEY_DAYS_PER_DAY = 60;
/** 板块数据与训练日的最大间隔（天）：超过则认为板块当日无行情，换下一个候选板块 */
const BOARD_NEAR_DAYS = 15;

export interface PrecomputeOptions {
  items: ShortTermScoreItem[];
  /** 训练窗口起始日（YYYY-MM-DD，可为空） */
  startDate: string;
  /** 训练窗口截止日（YYYY-MM-DD）：训练结束时才会到的最晚交易日，评分会覆盖到该日 */
  endDate: string;
  source: FundApiType;
  /** 返回 true 时中断预计算（已算完的交易日已写入缓存） */
  shouldStop?: () => boolean;
  /** 进度回调：已完成交易日数 / 待计算交易日总数 / 说明 */
  onProgress?: (done: number, total: number, message: string) => void;
}

export interface PrecomputeResult {
  /** 本次新计算并写入缓存的交易日数 */
  dates: number;
  /** 因缓存已覆盖本次全部股票而跳过的交易日数 */
  reused: number;
  /** 写入的评分行数 */
  rows: number;
  /** 因数据不足跳过的评分行数 */
  skipped: number;
  /** 训练窗口内的交易日总数 */
  totalDates: number;
  /** 训练窗口内的交易日列表（升序，YYYY-MM-DD） */
  days: string[];
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
  const cut = ks.filter((k) => toDay(k.date) <= date);
  return cut.length > keep ? cut.slice(-keep) : cut;
}

/** 按日期截断资金明细（主力/散户逐日净流入） */
function sliceMoney(mf: any, date: string): { detailMain: number[]; detailRetail: number[] } {
  const dates: string[] = Array.isArray(mf?.detail_dates) ? mf.detail_dates : [];
  const main: number[] = Array.isArray(mf?.detail_main) ? mf.detail_main : [];
  const retail: number[] = Array.isArray(mf?.detail_retail) ? mf.detail_retail : [];
  const keepIdx: number[] = [];
  dates.forEach((d, i) => {
    if (toDay(d) <= date) {
      keepIdx.push(i);
    }
  });
  const tail = keepIdx.slice(-MONEY_DAYS_PER_DAY);
  return {
    detailMain: tail.map((i) => Number(main[i]) || 0),
    detailRetail: tail.map((i) => Number(retail[i]) || 0),
  };
}

export async function precomputeShortTermScores(options: PrecomputeOptions): Promise<PrecomputeResult> {
  const { items, source, shouldStop, onProgress } = options;
  const result: PrecomputeResult = { dates: 0, reused: 0, rows: 0, skipped: 0, totalDates: 0, days: [] };
  const endDate = toDay(options.endDate);
  if (!items || !items.length || !endDate) {
    return result;
  }
  const startDate = toDay(options.startDate);

  const secidOf = (code: string) => (code.startsWith('6') ? `1.${code}` : `0.${code}`);
  const codes = items.map((i) => i.code);
  const secids = codes.map(secidOf);
  const indexSecids = ['1.000001', '0.399001', '0.399006'];

  // ---- 1. 交易日历：三大指数日K的日期并集，限制在训练窗口 [startDate, endDate] 内 ----
  const windowDays = Math.max(0, dayjs(endDate).diff(dayjs(startDate || endDate), 'day'));
  const indexLimit = Math.ceil(windowDays / 2) + INDEX_KLINES_PER_DAY + 20;
  onProgress?.(0, 0, '拉取指数日K...');
  const indexKlinesMap = await Services.Tushare.BatchGetKFromTushare(indexSecids, endDate, indexLimit, KLineType.Day, {
    ignoreTrain: true,
  });
  const dateSet = new Set<string>();
  indexSecids.forEach((s) => {
    (indexKlinesMap[s] || []).forEach((k) => {
      const d = toDay(k.date);
      if ((!startDate || d >= startDate) && d <= endDate) {
        dateSet.add(d);
      }
    });
  });
  const days = [...dateSet].sort();
  result.totalDates = days.length;
  result.days = days;
  if (!days.length || shouldStop?.()) {
    return result;
  }

  // ---- 2. 增量检查：已覆盖本次全部股票池的交易日直接跳过（只补算新增的交易日 / 股票）----
  const covered = await Services.Tushare.GetShortTermScoreCachedSummaryFromTushare(days, codes, source, {
    ignoreTrain: true,
  });
  const pendingDays = days.filter((d) => (covered[d.replace(/-/g, '')] ?? Infinity) > 0);
  result.reused = days.length - pendingDays.length;
  if (!pendingDays.length) {
    onProgress?.(days.length, days.length, `${days.length} 个交易日均已缓存`);
    return result;
  }

  // ---- 3. 个股日K（一次批量取全：窗口交易日数 + 每个交易日所需历史根数）----
  onProgress?.(0, pendingDays.length, '拉取个股日K...');
  const stockKlinesMap = await Services.Tushare.BatchGetKFromTushare(
    secids,
    endDate,
    days.length + STOCK_KLINES_PER_DAY + 10,
    KLineType.Day,
    { ignoreTrain: true }
  );

  // ---- 4. 个股资金流（一次批量取全，截止到训练窗口末日）----
  onProgress?.(0, pendingDays.length, '拉取资金流向...');
  const moneyFlowMap = await Services.Tushare.BatchGetMoneyFlowFromTushare(
    codes,
    days.length + MONEY_DAYS_PER_DAY + 10,
    { ignoreTrain: true, tradeDate: endDate }
  );

  // ---- 5. 板块：每只股票解析一次所属板块（手动设置优先），再一次性批量取板块K线 ----
  onProgress?.(0, pendingDays.length, '解析所属板块...');
  const candidatesByCode: Record<string, { code: string; name: string }[]> = {};
  const candidateCodes = new Set<string>();
  for (const item of items) {
    if (shouldStop?.()) {
      return result;
    }
    const candidates: any[] = item.hybk
      ? [item.hybk]
      : await Services.Stock.GetStockBankuaisFromEastmoney(secidOf(item.code))
          .then((list: any[]) => (list || []).slice(0, 3))
          .catch(() => []);
    const resolved: { code: string; name: string }[] = [];
    for (const bk of candidates) {
      if (!bk) {
        continue;
      }
      const code = (await Services.Stock.ResolveBoardCodeByName(bk.name, source)) || bk.code;
      if (!code || resolved.some((r) => r.code === code)) {
        continue;
      }
      const name = String(bk.name || '').replace(/[，,]\s*BK\d+\s*$/i, '').trim() || String(bk.name || '');
      resolved.push({ code, name });
      candidateCodes.add(code);
    }
    candidatesByCode[item.code] = resolved;
  }

  const boardKlinesMap: Record<string, Stock.KLineItem[]> = {};
  const candidateList = [...candidateCodes];
  if (candidateList.length) {
    const boardSecids = candidateList.map((c) => `90.${c}`);
    const fetched = await Services.Tushare.BatchGetKFromTushare(
      boardSecids,
      endDate,
      days.length + BOARD_KLINES_PER_DAY + 10,
      KLineType.Day,
      { ignoreTrain: true }
    );
    candidateList.forEach((c, i) => {
      boardKlinesMap[c] = fetched[boardSecids[i]] || [];
    });
  }

  // 与单日评分一致：优先选「训练日期附近仍有行情」的板块（避免选中早已停更的板块）
  const boardChoice: Record<string, { code: string; name: string } | null> = {};
  Object.keys(candidatesByCode).forEach((code) => {
    const list = candidatesByCode[code] || [];
    let picked: { code: string; name: string } | null = null;
    for (const c of list) {
      const ks = boardKlinesMap[c.code] || [];
      const lastDate = ks.length ? toDay(ks[ks.length - 1].date) : '';
      const near = !!lastDate && Math.abs(dayjs(endDate).diff(dayjs(lastDate), 'day')) <= BOARD_NEAR_DAYS;
      if (ks.length && near) {
        picked = c;
        break;
      }
    }
    boardChoice[code] = picked || list[0] || null;
  });

  // ---- 6. 大盘维度公共数据：涨跌比（按日，覆盖每个交易日所需的近10日窗口）----
  const allIndexDays = [
    ...new Set(indexSecids.flatMap((s) => (indexKlinesMap[s] || []).map((k) => toDay(k.date)))),
  ].sort();
  const firstPos = allIndexDays.findIndex((d) => d >= pendingDays[0]);
  const from = firstPos > 0 ? Math.max(0, firstPos - Score.SHORT_TERM_SCORE_CONFIG.marketDays + 1) : 0;
  onProgress?.(0, pendingDays.length, '拉取涨跌比...');
  const upRatioMap = await Services.Tushare.GetUpRatioFromTushare(allIndexDays.slice(from), { ignoreTrain: true });

  // ---- 7. 市值档成交统计（按日，一次批量取回）----
  onProgress?.(0, pendingDays.length, '拉取市值档成交统计...');
  const marketStatsMap = await Services.Tushare.GetMarketActivityStatsBatchFromTushare(pendingDays, {
    ignoreTrain: true,
  });

  // ---- 8. 逐日计算（内存切片 + 纯函数评分），按交易日写入数据库缓存 ----
  for (let di = 0; di < pendingDays.length; di += 1) {
    if (shouldStop?.()) {
      break;
    }
    const day = pendingDays[di];
    const rows: Record<string, any> = {};
    for (const item of items) {
      const code = item.code;
      const klines = sliceKlines(stockKlinesMap[secidOf(code)], day, STOCK_KLINES_PER_DAY);
      if (klines.length < 30) {
        result.skipped += 1;
        continue;
      }
      const bk = boardChoice[code];
      const { detailMain, detailRetail } = sliceMoney(moneyFlowMap[code], day);
      const row = computeShortTermRowForDate({
        code,
        name: item.name,
        klines,
        indexKlines: sliceKlines(indexKlinesMap[indexSecidOfStock(code)], day, INDEX_KLINES_PER_DAY),
        boardKlines: bk ? sliceKlines(boardKlinesMap[bk.code], day, BOARD_KLINES_PER_DAY) : [],
        boardName: bk ? bk.name : '',
        upRatioMap,
        marketStats: marketStatsMap[day.replace(/-/g, '')] || null,
        circMv: item.circMv,
        detailMain,
        detailRetail,
      });
      if (row.error) {
        result.skipped += 1;
        continue;
      }
      rows[code] = row;
    }
    const count = Object.keys(rows).length;
    if (count) {
      await Services.Tushare.SaveShortTermScoreCacheToTushare(day, rows, source);
      result.rows += count;
      result.dates += 1;
    }
    onProgress?.(di + 1, pendingDays.length, `${day} 完成（${count} 只）`);
    // 让出主线程，避免长时间阻塞 UI
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return result;
}
