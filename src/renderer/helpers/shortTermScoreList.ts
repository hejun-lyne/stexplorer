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
  options?: { allowSynthesis?: boolean }
): Promise<Stock.KLineItem[]> {
  const r = await Services.Stock.GetKFromDataSource(source, secid, KLineType.Day, limit, options);
  return ((r?.ks as Stock.KLineItem[]) || []);
}

/**
 * 批量计算股票短线评分（与个股详情页"短线评分"同源逻辑）：
 * 个股(量能30+RSI40+资金30) 60% + 板块 20% + 大盘 20%，缺失维度按剩余权重归一化。
 * 公共数据（指数K线/涨跌比/市值档统计）只拉取一次，个股数据并发拉取并逐只回调，支持中途暂停。
 */
export async function computeShortTermScoreRows(items: ShortTermScoreItem[], options: ComputeOptions): Promise<ShortTermScoreRow[]> {
  const { source, concurrency = 3, shouldStop, onRow } = options;
  const results: ShortTermScoreRow[] = [];
  if (!items || items.length === 0) {
    return results;
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
    marketStats = await Services.Tushare.GetMarketActivityStatsFromTushare(anchorDate);
  } catch {
    marketStats = null;
  }

  const emptyRow = (item: ShortTermScoreItem): ShortTermScoreRow => ({
    code: item.code,
    name: item.name || item.code,
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
  });

  const processOne = async (item: ShortTermScoreItem): Promise<ShortTermScoreRow> => {
    const row = emptyRow(item);
    const code = item.code;
    const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`;
    const indexSecid = code.startsWith('6') ? '1.000001' : code.startsWith('3') ? '0.399006' : '0.399001';
    try {
      const dklines = await fetchDayKlines(source, secid, 250);
      if (!dklines || dklines.length < 30) {
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
            boardKlines = ks;
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
        detailMain = mf?.detail_main;
        detailRetail = mf?.detail_retail;
      } catch {
        // 资金获取失败时按维度缺失处理
      }

      const market = Score.scoreMarket(dklines, indexKlinesMap[indexSecid] || [], upRatioMap);
      const sector = Score.scoreSector(dklines, boardKlines, boardName);
      const volume = Score.scoreStockVolume(dklines, marketStats, item.circMv);
      const rsi = Score.scoreStockRsi(dklines);
      const money = Score.scoreStockMoney(detailMain, detailRetail);
      const stock = Score.scoreStock(volume, rsi, money);
      const overall = Score.composeShortTermScore(market, sector, stock);

      row.total = overall.total;
      row.grade = overall.grade;
      row.advice = overall.advice;
      row.summary = overall.summary;
      row.stockScore = stock.available ? stock.score : null;
      row.sectorScore = sector.available ? sector.score : null;
      row.marketScore = market.available ? market.score : null;
      row.volumeScore = volume.available ? volume.score : null;
      row.rsiScore = rsi.available ? rsi.score : null;
      row.rsiPattern = rsi.pattern;
      row.sectorTrend = sector.available ? sector.trendDesc : '';
      row.moneyScore = money.available ? money.score : null;
      row.moneyNote = money.note;
      return row;
    } catch (e: any) {
      row.error = e?.message || '评分失败';
      return row;
    }
  };

  // 并发工作池：逐只回调，支持暂停
  const queue = [...items];
  const total = items.length;
  let done = 0;
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
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
