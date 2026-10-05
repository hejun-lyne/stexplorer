import dayjs from 'dayjs';
import * as Services from '@/services';
import { FundApiType, KLineType } from '@/utils/enums';
import * as Score from './shortTermScore';
import {
  buildStockScoreInputs,
  computeShortTermScoreForDate,
  createScoreContext,
  primeBoards,
  saveScoreSeries,
  ShortTermScoreItem,
  ShortTermScoreSeries,
} from './shortTermScoreList';

/**
 * 训练周期短线评分预计算
 *
 * 用途：训练模式下按「每只股票 × 每个交易日」预先算好短线评分，写入该股票的**评分时间序列**
 * （meta.db/api_cache，key = short_term_score_series_{股票代码}_{数据源}，值为 { 交易日: 评分行 }）。
 * 之后在 STList 执行短线评分会直接命中序列、不再逐只取数计算，个股详情页算完也会写回同一条序列，
 * 因此「列表分」与「详情页分」必然一致。
 *
 * 无有效数据的股票（日K不足 / 取数失败）同样按 0 分写入序列，这样点击短线评分不会因为它们
 * 每次都重新尝试取数；确实需要重算时，删掉对应的 `short_term_score_series_*` 缓存键再跑一次即可。
 *
 * 训练窗口是已知的历史区间，因此这里一次把**整段窗口（trainStartDate ~ trainEndDate）**算完：
 * 取数按窗口末日（`ignoreTrain` 绕过训练日期收敛，原始数据不进入界面，渲染层出口仍按训练日截断），
 * 但每只股票在每个交易日的评分只用「该交易日及之前」的K线/资金明细切片计算，
 * 所以第 D 天算出的分数，与训练日推进到 D 时现算的结果完全一致；界面也只在训练日到达 D 后才读该日结果。
 *
 * 性能设计（把原来「每只股票每天各启动若干 python 进程」变成一次批量取数）：
 * - 个股日K / 指数日K / 板块日K：各一次 `get_kline_data_batch`（内部线程池 + 各自数据库缓存）
 * - 个股资金流：一次 `get_money_flow_batch`
 * - 市值档成交统计：一次 `get_market_activity_stats_batch`
 * - 涨跌比：一次 `get_up_down_ratio_batch`（按日期，历史日期长期缓存）
 * - 板块代码解析：进程内记忆板块列表（见 services/tushare.ts 的 GetBoardListsMemo）
 * 之后逐日只在内存中切片 + 纯函数评分，最后按「股票」一次性写回各自的评分序列。
 *
 * 增量：开始前会检查每只股票的评分序列对本次股票池的覆盖情况，已覆盖全部股票的日子直接跳过；
 * 整段窗口预计算完成后，训练日推进（下一天）无需再做任何取数/计算。
 * 「忽略缓存」（options.ignoreCache）时不做上面的增量判断，先清掉窗口内已存的评分行再整段重算。
 */

/** 每个交易日评分所需的个股历史K线根数（RSI24 + 历史分位需要较长历史） */
const STOCK_KLINES_PER_DAY = 250;
/** 每个交易日评分所需的指数K线根数（大盘维度取近 10 日） */
const INDEX_KLINES_PER_DAY = 60;
/** 每个交易日评分所需的板块K线根数（板块维度取近 20 日） */
const BOARD_KLINES_PER_DAY = 60;
/** 每个交易日评分所需的资金明细天数（20日累计 + 30日形态识别，留缓冲） */
const MONEY_DAYS_PER_DAY = 60;
/** 每计算多少个交易日落盘一次（兼顾中断安全与写入次数） */
const FLUSH_EVERY_DAYS = 20;

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
  /**
   * 忽略已有缓存，整段窗口重新计算：
   * - 不做「已覆盖交易日直接跳过」的增量判断，窗口内所有交易日全部重算并覆盖写入；
   * - 重算前先清掉窗口内这批股票已存的评分行，避免旧行残留（被覆盖判定当成「已覆盖」而跳过）。
   * 默认 false（增量补算）。
   */
  ignoreCache?: boolean;
}

export interface PrecomputeResult {
  /** 本次新计算并写入缓存的交易日数 */
  dates: number;
  /** 因缓存已覆盖本次全部股票而跳过的交易日数 */
  reused: number;
  /** 写入的评分行数 */
  rows: number;
  /** 因数据不足跳过的评分行数 */
  /** 其中无有效数据（日K不足 / 取数失败）的行数：这些行同样按 0 分写入缓存 */
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

export async function precomputeShortTermScores(options: PrecomputeOptions): Promise<PrecomputeResult> {
  const { items, source, shouldStop, onProgress, ignoreCache } = options;
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

  // ---- 1. 交易日历：三大指数日K的日期并集，限制在训练窗口 [startDate 的归位日, endDate] 内 ----
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
      if (d && d <= endDate) {
        dateSet.add(d);
      }
    });
  });
  const allDays = [...dateSet].sort();
  // 窗口起点若非交易日（如 2024-01-01 元旦），其评分基准日会归位到上一个交易日，
  // 因此往前多覆盖一个交易日，避免训练第一天必然未命中缓存。
  const firstIdx = startDate ? allDays.findIndex((d) => d >= startDate) : 0;
  const days = allDays.slice(firstIdx > 0 ? firstIdx - 1 : 0);
  result.totalDates = days.length;
  result.days = days;
  if (!days.length || shouldStop?.()) {
    return result;
  }

  // ---- 2. 待计算交易日 ----
  // 默认增量：本次股票池已全覆盖的交易日直接跳过，只补缺口；
  // ignoreCache（点「预计算训练评分」从头重算）时：先清掉窗口内已存的评分行，再整段重算，
  // 避免旧行残留导致「明明重算了却还是旧分数 / 显示未覆盖」。
  let pendingDays: string[];
  if (ignoreCache) {
    onProgress?.(0, days.length, '忽略缓存：清理窗口内旧评分...');
    await Services.Tushare.ClearShortTermScoreSeriesFromTushare(codes, days, source);
    pendingDays = [...days];
    result.reused = 0;
  } else {
    const summary = await Services.Tushare.GetShortTermScoreSeriesSummaryFromTushare(codes, days, source, {
      ignoreTrain: true,
    });
    pendingDays = days.filter((d) => (summary[d.replace(/-/g, '')] ?? Infinity) > 0);
    result.reused = days.length - pendingDays.length;
    if (!pendingDays.length) {
      onProgress?.(days.length, days.length, `${days.length} 个交易日均已缓存`);
      return result;
    }
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

  // ---- 5. 大盘维度公共数据：涨跌比（按日，覆盖每个交易日所需的近10日窗口）----
  const allIndexDays = [
    ...new Set(indexSecids.flatMap((s) => (indexKlinesMap[s] || []).map((k) => toDay(k.date)))),
  ].sort();
  const firstPos = allIndexDays.findIndex((d) => d >= pendingDays[0]);
  const from = firstPos > 0 ? Math.max(0, firstPos - Score.SHORT_TERM_SCORE_CONFIG.marketDays + 1) : 0;
  onProgress?.(0, pendingDays.length, '拉取涨跌比...');
  const upRatioMap = await Services.Tushare.GetUpRatioFromTushare(allIndexDays.slice(from), { ignoreTrain: true });

  // ---- 6. 市值档成交统计（按日，一次批量取回）----
  onProgress?.(0, pendingDays.length, '拉取市值档成交统计...');
  const marketStatsMap = await Services.Tushare.GetMarketActivityStatsBatchFromTushare(pendingDays, {
    ignoreTrain: true,
  });

  // ---- 7. 评分共享上下文：批量数据一次性塞进 ctx，逐日只在内存切片 ----
  // 与列表 / 详情页共用同一套取数与评分逻辑（buildStockScoreInputs + computeShortTermScoreForDate），
  // 保证「预计算第 D 天」=「训练日推进到 D 现算」=「个股详情页看到的结果」。
  const ctx = createScoreContext(source, {
    indexKlinesMap,
    stockKlinesMap,
    moneyFlowMap,
    upRatioMap,
    marketStatsMap,
  });

  // ---- 8. 板块：每只股票解析一次所属板块（手动设置优先），再一次性批量取板块K线 ----
  onProgress?.(0, pendingDays.length, '解析所属板块...');
  const boardCodes = new Set<string>();
  for (const item of items) {
    if (shouldStop?.()) {
      return result;
    }
    (await primeBoards(ctx, item)).forEach((c) => boardCodes.add(c));
  }
  if (boardCodes.size) {
    const boardList = [...boardCodes];
    const fetched = await Services.Tushare.BatchGetKFromTushare(
      boardList.map((c) => `90.${c}`),
      endDate,
      days.length + BOARD_KLINES_PER_DAY + 10,
      KLineType.Day,
      { ignoreTrain: true }
    );
    boardList.forEach((c) => {
      // 取数失败时接口会返回 {error}，这里必须归一成数组，否则后续切片会抛异常把该股打成 0 分
      const ks = fetched[`90.${c}`];
      ctx.boardKlinesMap[c] = Array.isArray(ks) ? ks : [];
    });
  }

  // ---- 9. 逐日计算（内存切片 + 纯函数评分），按「股票」写回评分序列 ----
  let buffer: ShortTermScoreSeries = {};
  for (let di = 0; di < pendingDays.length; di += 1) {
    if (shouldStop?.()) {
      break;
    }
    const day = pendingDays[di];
    const dayKey = day.replace(/-/g, '');
    let count = 0;
    for (const item of items) {
      try {
        const inputs = await buildStockScoreInputs(ctx, item, day);
        const { row } = computeShortTermScoreForDate({ code: item.code, name: item.name, scoreDay: day, ...inputs });
        // 数据未就绪（日K不足 / 未覆盖到基准日）：不写缓存，留给后续运行重新取数计算
        if (row.pending) {
          result.skipped += 1;
          continue;
        }
        buffer[item.code] = { ...(buffer[item.code] || {}), [dayKey]: row };
        count += 1;
        result.rows += 1;
      } catch {
        result.skipped += 1;
      }
    }
    result.dates += 1;
    onProgress?.(di + 1, pendingDays.length, `${day} 完成（${count} 只）`);
    // 定期落盘，中断时已算完的交易日不会丢失
    if ((di + 1) % FLUSH_EVERY_DAYS === 0 && Object.keys(buffer).length) {
      await saveScoreSeries(buffer, source);
      buffer = {};
    }
    // 让出主线程，避免长时间阻塞 UI
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (Object.keys(buffer).length) {
    await saveScoreSeries(buffer, source);
  }

  return result;
}
