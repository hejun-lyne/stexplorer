/**
 * 板块批量回测 + 信号质量评分（纯计算 + 逐只现算评分曲线）
 *
 * 用途：选定东财行业/概念板块，对板块内成分股逐只跑「短线评分突变」回测，
 * 并把每只股票窗口最后一根 K 线的突变判定为「今日信号」（次日开盘买入），
 * 再按信号质量评分排序 —— 多只股票同时触发买入信号时按分数从高到低选。
 *
 * 口径与个股回测面板（shortTermScoreBacktest）完全一致：
 *   评分来自 computeShortTermScoreCurve（逐日现算，不读评分缓存）；
 *   买入 Δ ≥ buyDelta 且 评分 ≥ minScore，次日开盘买；
 *   卖出 Δ ≤ sellDelta，次日开盘卖；
 *   冷却期 / 跳空过滤同样生效（被过滤的信号不会出现在今日信号里）。
 *
 * 信号质量评分（满分 100）只评估「当前这个信号」，维度全部来自已有数据，不含未来数据：
 *   突变强度 15 + 评分水平 10 + 历史胜率 12 + 历史期望 8 + 盈亏比 5
 *   + 入场位置 20 + 量能确认 15 + 板块共振 15
 */
import { Stock } from '@/types/stock';
import { FundApiType } from '@/utils/enums';
import { computeShortTermScoreCurve, createScoreContext, SHORT_SCORE_SOURCE } from './shortTermScoreList';
import {
  DEFAULT_SHORT_SCORE_BACKTEST,
  runShortScoreBacktest,
  ShortScoreBacktestParams,
  ShortScoreBacktestStats,
} from './shortTermScoreBacktest';

const dayKey = (d?: string) => String(d || '').replace(/-/g, '').substring(0, 8);
const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v)) || 0;
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
const round1 = (v: number) => Number((Number.isFinite(v) ? v : 0).toFixed(1));

/** 信号质量评分的单个维度 */
export interface SignalQualityDim {
  key: string;
  label: string;
  score: number;
  max: number;
  detail: string;
}

export interface SignalQuality {
  /** 总分 0~100 */
  total: number;
  grade: 'A' | 'B' | 'C' | 'D';
  dims: SignalQualityDim[];
}

/** 窗口最后一根 K 线上触发的买入信号（次日开盘买入） */
export interface BoardLiveSignal {
  /** 信号日 */
  date: string;
  /** 信号日评分 */
  score: number;
  /** 信号日 Δ */
  delta: number;
  /** 信号日收盘（次日开盘价的参考） */
  close: number;
  /** 信号日成交量 / 前 5 日均量 */
  volumeRatio: number;
  /** 相对近 60 日最高收盘的回撤（0 = 创新高） */
  drawdownFromHigh: number;
}

export interface BoardBacktestStock {
  code: string;
  name: string;
  status: 'ok' | 'error';
  message?: string;
  /** 窗口内交易日数 */
  bars: number;
  /** 窗口末端是否仍持仓（回测按窗口最后收盘强平，不代表卖出信号） */
  holding: boolean;
  /** 持仓中且最后一根 K 线已出现卖出突变（次日开盘卖出） */
  exitSignal?: boolean;
  stats?: ShortScoreBacktestStats;
  /** 今日信号；无信号 / 持仓中 / 被过滤时为 undefined */
  live?: BoardLiveSignal;
  quality?: SignalQuality;
}

export interface BoardScoreBacktestResult {
  board: { secid: string; name: string; type: number };
  params: ShortScoreBacktestParams;
  generatedAt: string;
  /** 评分曲线窗口（交易日） */
  limit: number;
  total: number;
  succeeded: number;
  failed: number;
  /** 触发今日信号的股票数 */
  liveCount: number;
  /** 有信号的股票，按质量分倒序 */
  signals: BoardBacktestStock[];
  /** 全部股票，按「有信号 → 质量分 → 胜率」倒序 */
  stocks: BoardBacktestStock[];
}

/**
 * 信号质量评分
 *
 * 注意这是「事后可核对」的经验评分，不是收益率预测：
 * 历史胜率/期望/盈亏比用该股自身在窗口内的回测结果（样本很少时会被打折），
 * 入场位置/量能/共振衡量这次突变本身的质量。
 */
export function scoreSignalQuality(args: {
  delta: number;
  score: number;
  params: ShortScoreBacktestParams;
  stats?: ShortScoreBacktestStats;
  drawdownFromHigh: number;
  volumeRatio: number;
  boardSignalCount: number;
  boardSignalDensity: number;
}): SignalQuality {
  const { delta, score, params, stats, drawdownFromHigh, volumeRatio } = args;
  const trades = stats?.trades || 0;
  const winRate = stats?.winRate || 0;
  const avgRet = stats?.avgRet || 0;
  const payoff = stats?.payoff || 0;
  const dims: SignalQualityDim[] = [];

  // 1. 突变强度 15：超过买入门槛多少
  const overDelta = delta - params.buyDelta;
  const strength = overDelta >= 20 ? 15 : overDelta >= 12 ? 12 : overDelta >= 6 ? 9 : 5;
  dims.push({
    key: 'delta',
    label: '突变强度',
    score: strength,
    max: 15,
    detail: `Δ ${delta > 0 ? '+' : ''}${delta.toFixed(2)}（门槛 ${params.buyDelta > 0 ? '+' : ''}${params.buyDelta}）`,
  });

  // 2. 评分水平 10
  const level = score >= 85 ? 10 : score >= 75 ? 8 : score >= 65 ? 6 : 4;
  dims.push({ key: 'level', label: '评分水平', score: level, max: 10, detail: `评分 ${score.toFixed(2)}` });

  // 3. 历史胜率 12（无样本给中性 4 分，单笔样本打 6 折）
  const winScore = trades <= 0 ? 4 : trades === 1 ? winRate * 12 * 0.6 : winRate * 12;
  dims.push({
    key: 'winRate',
    label: '历史胜率',
    score: winScore,
    max: 12,
    detail: trades ? `${trades} 笔，胜率 ${(winRate * 100).toFixed(1)}%` : '窗口内无历史成交',
  });

  // 4. 历史期望 8：0% → 4 分，+8% → 8 分，-8% → 0 分
  const expScore = trades <= 0 ? 4 : 4 + Math.max(-1, Math.min(1, avgRet / 0.08)) * 4;
  dims.push({
    key: 'avgRet',
    label: '历史期望',
    score: expScore,
    max: 8,
    detail: trades ? `${avgRet >= 0 ? '+' : ''}${(avgRet * 100).toFixed(2)}% / 笔` : '窗口内无历史成交',
  });

  // 5. 盈亏比 5
  const payoffScore =
    trades < 2 ? 2 : payoff >= 3 ? 5 : payoff >= 2 ? 4 : payoff >= 1.5 ? 3 : payoff >= 1 ? 2 : 0;
  dims.push({
    key: 'payoff',
    label: '盈亏比',
    score: payoffScore,
    max: 5,
    detail: trades < 2 ? '样本不足' : Number.isFinite(payoff) ? payoff.toFixed(2) : '∞',
  });

  // 6. 入场位置 20：距 60 日高点回撤 15% 最佳（既有空间、又不是下跌趋势）；
  //    贴新高扣分（追高，如 4-09 那种反抽），深跌也扣分（趋势走坏）
  const posScore = 20 * clamp01(1 - Math.abs(drawdownFromHigh - 0.15) / 0.25);
  dims.push({
    key: 'position',
    label: '入场位置',
    score: posScore,
    max: 20,
    detail: `距 60 日高点 ${(-drawdownFromHigh * 100).toFixed(1)}%`,
  });

  // 7. 量能确认 15：信号日量比越大越可信
  const volScore = volumeRatio >= 2 ? 15 : volumeRatio >= 1.5 ? 12 : volumeRatio >= 1.2 ? 9 : volumeRatio >= 1 ? 6 : 2;
  dims.push({
    key: 'volume',
    label: '量能确认',
    score: volScore,
    max: 15,
    detail: `量比 ${volumeRatio.toFixed(2)}（对前 5 日均量）`,
  });

  // 8. 板块共振 15：同板块同日触发信号的只数 + 占比
  const density = clamp01(args.boardSignalDensity);
  const densityScore = density >= 0.15 ? 15 : density >= 0.08 ? 12 : density >= 0.04 ? 8 : density >= 0.01 ? 4 : 0;
  const count = args.boardSignalCount;
  const countScore = count >= 8 ? 15 : count >= 5 ? 12 : count >= 3 ? 9 : count >= 2 ? 5 : 2;
  dims.push({
    key: 'resonance',
    label: '板块共振',
    score: densityScore * 0.6 + countScore * 0.4,
    max: 15,
    detail: `板块内 ${count} 只触发（占比 ${(density * 100).toFixed(1)}%）`,
  });

  const raw = dims.reduce((a, d) => a + d.score, 0);
  const total = round1(raw);
  const grade: SignalQuality['grade'] = total >= 80 ? 'A' : total >= 65 ? 'B' : total >= 50 ? 'C' : 'D';
  return { total, grade, dims: dims.map((d) => ({ ...d, score: round1(d.score) })) };
}

/** 并发池：保持 concurrency 路同时跑，支持 shouldStop 提前退出 */
async function runPool<T, R>(
  list: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  shouldStop?: () => boolean
): Promise<R[]> {
  const out: R[] = [];
  let cursor = 0;
  const run = async (): Promise<void> => {
    while (true) {
      if (shouldStop?.()) {
        return;
      }
      const i = cursor;
      cursor += 1;
      if (i >= list.length) {
        return;
      }
      out.push(await worker(list[i], i));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(6, concurrency)) }, run));
  return out;
}

/** 取信号日那根 K 线之前的量能 / 高点位置 */
function liveMetrics(klines: Stock.KLineItem[], signalKey: string) {
  const idx = klines.findIndex((k) => dayKey(k.date) === signalKey);
  if (idx < 0) {
    return { volumeRatio: 1, drawdownFromHigh: 0.15, found: false };
  }
  const close = num(klines[idx].sp);
  // 前 5 日均量（不含信号日）
  const prev5 = klines.slice(Math.max(0, idx - 5), idx).map((k) => num(k.cjl));
  const avgVol = prev5.length ? prev5.reduce((a, b) => a + b, 0) / prev5.length : 0;
  const volumeRatio = avgVol > 0 ? num(klines[idx].cjl) / avgVol : 1;
  // 近 60 日最高收盘（含信号日）
  const window60 = klines.slice(Math.max(0, idx - 59), idx + 1).map((k) => num(k.sp));
  const high = window60.length ? Math.max(...window60) : close;
  const drawdownFromHigh = high > 0 ? Math.max(0, 1 - close / high) : 0.15;
  return { volumeRatio, drawdownFromHigh, found: true };
}

/**
 * 板块批量回测
 *
 * 每只股票单独现算评分曲线（与个股回测面板同口径），因此耗时与成分股数量线性相关；
 * 通过 concurrency / maxStocks / shouldStop 控制成本。
 */
export async function runBoardScoreBacktest(args: {
  board: { secid: string; name: string; type: number };
  stocks: { code: string; name: string }[];
  params: ShortScoreBacktestParams;
  /** K线数据源（与设置里的 K线API 一致） */
  source?: FundApiType;
  /** 评分曲线窗口（交易日，20~120） */
  limit?: number;
  /** 只回测前 N 只（0 = 全部） */
  maxStocks?: number;
  concurrency?: number;
  shouldStop?: () => boolean;
  onProgress?: (info: { done: number; total: number; code: string; name: string }) => void;
}): Promise<BoardScoreBacktestResult> {
  const params: ShortScoreBacktestParams = { ...DEFAULT_SHORT_SCORE_BACKTEST, ...args.params };
  const limit = Math.max(20, Math.min(120, Math.floor(Number(args.limit) || 120)));
  const maxStocks = Math.max(0, Math.floor(Number(args.maxStocks) || 0));
  const concurrency = Math.max(1, Math.min(4, Math.floor(Number(args.concurrency) || 2)));

  // 整批复用同一个评分上下文：指数日K / 涨跌比 / 市值档 / 板块K线只取一次，
  // 否则 60 只股票会把公共数据重取 60 遍（这是板块批量回测的主要成本）
  const source = args.source || SHORT_SCORE_SOURCE;
  const ctx = createScoreContext(source, { boardKlineLimit: limit + 60 });

  const items = args.stocks
    .map((s) => ({ code: String(s.code || ''), name: String(s.name || '') }))
    .filter((s) => /^\d{6}$/.test(s.code));
  const list = maxStocks > 0 ? items.slice(0, maxStocks) : items;
  const total = list.length;
  let done = 0;

  const results = await runPool(
    list,
    concurrency,
    async (item): Promise<BoardBacktestStock> => {
      const base: BoardBacktestStock = { code: item.code, name: item.name, status: 'error', bars: 0, holding: false };
      try {
        const curve = await computeShortTermScoreCurve({
          code: item.code,
          name: item.name,
          limit,
          ignoreTrain: true,
          source,
          ctx,
          forceIndex: false,
          shouldStop: args.shouldStop,
        });
        if (!curve.klines.length || !Object.keys(curve.scores).length) {
          return { ...base, status: 'error', message: '取数为空（停牌/上市时间不足）' };
        }
        const bt = runShortScoreBacktest({
          code: item.code,
          scores: curve.scores,
          klines: curve.klines,
          params,
        });
        const bars = bt.bars;
        const lastIdx = bars.length - 1;
        const holding = bt.trades.length > 0 && bt.trades[bt.trades.length - 1].exitReason === '窗口结束';
        const out: BoardBacktestStock = {
          code: item.code,
          name: item.name,
          status: 'ok',
          bars: bars.length,
          holding,
          stats: bt.stats,
        };
        if (lastIdx < 1) {
          return out;
        }
        // 窗口最后一根 K 线的突变：买入判定（次日开盘买）与卖出提示共用，
        // 与回测循环同口径（相邻 bar 才计 Δ）
        const lastKey = dayKey(bars[lastIdx].date);
        const prevKey = dayKey(bars[lastIdx - 1].date);
        const cur = curve.scores[lastKey];
        const prev = curve.scores[prevKey];
        if (typeof cur !== 'number' || typeof prev !== 'number') {
          return out;
        }
        const delta = cur - prev;
        if (holding) {
          // 持仓中：最后一根 K 线已出绿柱时提示（回测里这根不参与卖出，因为卖出要次日开盘）
          out.exitSignal = delta <= params.sellDelta;
          return out;
        }
        if (delta < params.buyDelta || cur < params.minScore) {
          return out;
        }
        const metrics = liveMetrics(curve.klines, lastKey);
        out.live = {
          date: bars[lastIdx].date,
          score: Number(cur.toFixed(2)),
          delta: Number(delta.toFixed(2)),
          close: bars[lastIdx].close,
          volumeRatio: Number(metrics.volumeRatio.toFixed(2)),
          drawdownFromHigh: Number(metrics.drawdownFromHigh.toFixed(4)),
        };
        return out;
      } catch (e: any) {
        return { ...base, status: 'error', message: e?.message || '计算失败' };
      } finally {
        done += 1;
        args.onProgress?.({ done, total, code: item.code, name: item.name });
      }
    },
    args.shouldStop
  );

  // 板块共振要等全部股票算完才知道，所以质量分在第二阶段统一计算
  const liveCount = results.filter((r) => r.live).length;
  const density = total > 0 ? liveCount / total : 0;
  results.forEach((r) => {
    if (!r.live || !r.stats) {
      return;
    }
    r.quality = scoreSignalQuality({
      delta: r.live.delta,
      score: r.live.score,
      params,
      stats: r.stats,
      drawdownFromHigh: r.live.drawdownFromHigh,
      volumeRatio: r.live.volumeRatio,
      boardSignalCount: liveCount,
      boardSignalDensity: density,
    });
  });

  const byQuality = (a: BoardBacktestStock, b: BoardBacktestStock) => {
    const qa = a.quality?.total || -1;
    const qb = b.quality?.total || -1;
    if (qb !== qa) {
      return qb - qa;
    }
    return (b.stats?.winRate || 0) - (a.stats?.winRate || 0);
  };

  return {
    board: args.board,
    params,
    generatedAt: new Date().toISOString(),
    limit,
    total,
    succeeded: results.filter((r) => r.status === 'ok').length,
    failed: results.filter((r) => r.status === 'error').length,
    liveCount,
    signals: results.filter((r) => r.live).sort(byQuality),
    stocks: results.slice().sort((a, b) => {
      // 有信号的排前面，其余按质量分 / 胜率
      if (!!a.live !== !!b.live) {
        return a.live ? -1 : 1;
      }
      return byQuality(a, b);
    }),
  };
}
