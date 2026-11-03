/**
 * 短线评分「突变」策略回测（纯计算，无 IO）
 *
 * 输入必须是**现取数逐日重算**的评分序列（computeShortTermScoreCurve 的 scores），
 * 不能读评分缓存：缓存里混着多个行结构版本（v9/v10/v11/v13），旧版本行是旧公式算的，
 * 与个股详情页曲线口径不一致（应用自身也只认 SCORE_ROW_VERSION 的行）。
 *
 * 规则（与图表上的红绿柱同口径）：
 *   Δ = 评分(D) - 评分(D-1)，仅相邻交易日才算一次突变；
 *   Δ ≥ buyDelta 且 评分 ≥ minScore → 次日开盘买入；
 *   Δ ≤ sellDelta                  → 次日开盘卖出（窗口结束按最后收盘价强平）。
 *
 * 两个入场过滤（均为 0 时关闭）：
 *   冷却期 cooldownDays：卖出成交日起 N 个交易日内不开新仓，避免"绿柱卖出后反抽又追回"；
 *   跳空过滤 maxGapPct：信号日收盘 → 次日开盘的跳空超过 ±该百分比则放弃本次信号，
 *     防止在追高（高开）或破位（低开）时按次日开盘价接盘。
 */
import { Stock } from '@/types/stock';

export interface ShortScoreBacktestParams {
  /** 买入：单日评分跳升阈值（分） */
  buyDelta: number;
  /** 卖出：单日评分跳降阈值（分，负值） */
  sellDelta: number;
  /** 买入时评分下限 */
  minScore: number;
  /** 单次往返成本（佣金+印花税+滑点近似） */
  fee: number;
  /** 回测窗口（最近 N 个交易日，最多 240） */
  limitDays: number;
  /** 卖出后冷却：卖出成交日起 N 个交易日内不再开新仓（0 = 关闭） */
  cooldownDays: number;
  /** 跳空过滤：信号日收盘→次日开盘跳空超过该百分比（绝对值）则放弃买入（0 = 关闭） */
  maxGapPct: number;
}

export const DEFAULT_SHORT_SCORE_BACKTEST: ShortScoreBacktestParams = {
  buyDelta: 20,
  sellDelta: -15,
  minScore: 60,
  fee: 0.0012,
  limitDays: 240,
  cooldownDays: 3,
  maxGapPct: 2,
};

export interface ShortScoreBacktestTrade {
  signalIn: string;
  entryDate: string;
  entryPrice: number;
  scoreIn: number;
  deltaIn: number;
  signalOut: string;
  exitDate: string;
  exitPrice: number;
  scoreOut: number | null;
  deltaOut: number | null;
  exitReason: '绿柱卖出' | '窗口结束';
  /** 信号日收盘 → 买入日开盘的跳空幅度（%），正=高开 */
  gapIn: number;
  bars: number;
  ret: number;
}

/** 因冷却期 / 跳空过滤被放弃的买入信号 */
export interface ShortScoreBacktestSkip {
  /** 信号日 */
  date: string;
  score: number;
  delta: number;
  reason: '冷却期' | '跳空高开' | '跳空低开';
  /** 次日开盘相对信号日收盘的跳空幅度（%），正=高开 */
  gap: number;
}

export interface ShortScoreBacktestStats {
  trades: number;
  winRate: number;
  avgRet: number;
  medianRet: number;
  avgWin: number;
  avgLoss: number;
  payoff: number;
  profitFactor: number;
  sharpe: number;
  avgBars: number;
  cumulative: number;
  maxDrawdown: number;
  exposure: number;
  tradesPerYear: number;
  best: number;
  worst: number;
}

export interface ShortScoreBacktestResult {
  code: string;
  params: ShortScoreBacktestParams;
  windowStart: string;
  windowEnd: string;
  windowBars: number;
  scoreDays: number;
  stats: ShortScoreBacktestStats;
  trades: ShortScoreBacktestTrade[];
  /** 被冷却期 / 跳空过滤拦下的信号，便于核对过滤是否误伤 */
  skips: ShortScoreBacktestSkip[];
  /** 窗口内的评分序列（YYYYMMDD -> 分数），便于核对口径 */
  scores: Record<string, number>;
  /** 窗口内的日K收盘价，便于核对成交价 */
  bars: { date: string; open: number; close: number }[];
}

const dayKey = (d?: string) => String(d || '').replace(/-/g, '').substring(0, 8);
const dayStr = (d?: string) => {
  const k = dayKey(d);
  return k.length === 8 ? `${k.substring(0, 4)}-${k.substring(4, 6)}-${k.substring(6, 8)}` : String(d || '');
};
const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v));

/** 回测：单只股票、单笔持仓、次日开盘成交 */
export function runShortScoreBacktest(args: {
  code: string;
  scores: Record<string, number>;
  klines: Stock.KLineItem[];
  params: ShortScoreBacktestParams;
}): ShortScoreBacktestResult {
  const { code, scores } = args;
  const raw = args.params;
  // 归一化新增过滤参数：缺省（旧调用方/旧导出参数）视为关闭，保持向后兼容
  const params: ShortScoreBacktestParams = {
    ...raw,
    cooldownDays: Math.max(0, Math.min(20, Math.floor(Number(raw.cooldownDays) || 0))),
    maxGapPct: Math.max(0, Math.min(20, Number(raw.maxGapPct) || 0)),
  };
  const limitDays = Math.max(20, Math.min(240, Math.floor(Number(params.limitDays) || 240)));

  // 只取窗口内的日K（升序、去重）
  const all = (args.klines || [])
    .filter((k) => k && k.date && num(k.sp) > 0)
    .map((k) => ({
      key: dayKey(k.date),
      date: dayStr(k.date),
      open: num(k.kp),
      close: num(k.sp),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const scoreKeys = Object.keys(scores || {}).sort();
  const lastScoreKey = scoreKeys[scoreKeys.length - 1] || '';
  const inWindow = all.filter((b) => (!lastScoreKey || b.key <= lastScoreKey) && b.open > 0);
  const window = inWindow.slice(-limitDays);

  const emptyStats: ShortScoreBacktestStats = {
    trades: 0, winRate: 0, avgRet: 0, medianRet: 0, avgWin: 0, avgLoss: 0, payoff: 0,
    profitFactor: 0, sharpe: 0, avgBars: 0, cumulative: 0, maxDrawdown: 0, exposure: 0,
    tradesPerYear: 0, best: 0, worst: 0,
  };

  if (window.length < 30) {
    return {
      code, params,
      windowStart: window[0]?.date || '',
      windowEnd: window[window.length - 1]?.date || '',
      windowBars: window.length,
      scoreDays: 0,
      stats: emptyStats,
      trades: [],
      skips: [],
      scores: {},
      bars: [],
    };
  }

  const scoreOf = (i: number): number | null => {
    const v = scores[window[i].key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const deltaOf = (i: number): number | null => {
    if (i <= 0) return null;
    const cur = scoreOf(i);
    const prev = scoreOf(i - 1);
    if (cur === null || prev === null) return null;
    return cur - prev;
  };

  const trades: ShortScoreBacktestTrade[] = [];
  const skips: ShortScoreBacktestSkip[] = [];
  let pos: { signalIdx: number; entryIdx: number; score: number; delta: number; gap: number } | null = null;
  /** 上次卖出成交日的窗口索引；冷却期从这一天起算 */
  let lastExitIdx = Number.NEGATIVE_INFINITY;

  for (let i = 1; i < window.length - 1; i += 1) {
    const cur = scoreOf(i);
    const delta = deltaOf(i);
    if (cur === null || delta === null) {
      continue;
    }
    if (pos) {
      if (delta <= params.sellDelta) {
        const entry = window[pos.entryIdx];
        const exit = window[i + 1];
        const ret = exit.open / entry.open - 1 - params.fee;
        trades.push({
          signalIn: window[pos.signalIdx].date,
          entryDate: entry.date,
          entryPrice: entry.open,
          scoreIn: pos.score,
          deltaIn: Number(pos.delta.toFixed(2)),
          signalOut: window[i].date,
          exitDate: exit.date,
          exitPrice: exit.open,
          scoreOut: Number(cur.toFixed(2)),
          deltaOut: Number(delta.toFixed(2)),
          exitReason: '绿柱卖出',
          gapIn: Number((pos.gap * 100).toFixed(2)),
          bars: i + 1 - pos.entryIdx,
          ret,
        });
        lastExitIdx = i + 1;
        pos = null;
      }
      continue;
    }
    if (delta >= params.buyDelta && cur >= params.minScore) {
      const signalBar = window[i];
      // 信号日收盘 → 次日开盘的跳空（次日开盘就是成交价）
      const gap = signalBar.close > 0 ? window[i + 1].open / signalBar.close - 1 : 0;
      const gapPct = gap * 100;

      if (params.cooldownDays > 0 && i - lastExitIdx <= params.cooldownDays) {
        skips.push({
          date: signalBar.date,
          score: Number(cur.toFixed(2)),
          delta: Number(delta.toFixed(2)),
          reason: '冷却期',
          gap: Number(gapPct.toFixed(2)),
        });
        continue;
      }
      if (params.maxGapPct > 0 && Math.abs(gapPct) > params.maxGapPct) {
        skips.push({
          date: signalBar.date,
          score: Number(cur.toFixed(2)),
          delta: Number(delta.toFixed(2)),
          reason: gapPct > 0 ? '跳空高开' : '跳空低开',
          gap: Number(gapPct.toFixed(2)),
        });
        continue;
      }
      pos = { signalIdx: i, entryIdx: i + 1, score: cur, delta, gap };
    }
  }

  // 窗口结束仍持仓：按最后一根收盘价强平
  if (pos) {
    const entry = window[pos.entryIdx];
    const last = window[window.length - 1];
    const ret = last.close / entry.open - 1 - params.fee;
    trades.push({
      signalIn: window[pos.signalIdx].date,
      entryDate: entry.date,
      entryPrice: entry.open,
      scoreIn: pos.score,
      deltaIn: Number(pos.delta.toFixed(2)),
      signalOut: '',
      exitDate: last.date,
      exitPrice: last.close,
      scoreOut: scoreOf(window.length - 1),
      deltaOut: deltaOf(window.length - 1),
      exitReason: '窗口结束',
      gapIn: Number((pos.gap * 100).toFixed(2)),
      bars: window.length - 1 - pos.entryIdx,
      ret,
    });
  }

  // ---- 统计 ----
  const rets = trades.map((t) => t.ret);
  const wins = rets.filter((r) => r > 0);
  const losses = rets.filter((r) => r <= 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const median = (xs: number[]) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const std = (xs: number[]) => {
    if (xs.length < 2) return 0;
    const mu = mean(xs);
    return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1));
  };

  const years = window.length / 252;
  const tradesPerYear = years > 0 ? trades.length / years : 0;
  const sd = std(rets);
  const holdingBars = trades.reduce((a, t) => a + Math.max(1, t.bars), 0);

  // 权益曲线（单笔顺序复利）→ 累计收益 / 最大回撤
  let equity = 1;
  let peak = 1;
  let maxDD = 0;
  trades.forEach((t) => {
    equity *= 1 + t.ret;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, 1 - equity / peak);
  });

  const avgWin = mean(wins);
  const avgLoss = mean(losses);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));

  const stats: ShortScoreBacktestStats = {
    trades: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    avgRet: mean(rets),
    medianRet: median(rets),
    avgWin,
    avgLoss,
    payoff: losses.length && avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : wins.length ? Infinity : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    sharpe: sd > 0 && tradesPerYear > 0 ? (mean(rets) / sd) * Math.sqrt(tradesPerYear) : 0,
    avgBars: trades.length ? mean(trades.map((t) => t.bars)) : 0,
    cumulative: equity - 1,
    maxDrawdown: maxDD,
    exposure: window.length ? holdingBars / window.length : 0,
    tradesPerYear,
    best: rets.length ? Math.max(...rets) : 0,
    worst: rets.length ? Math.min(...rets) : 0,
  };

  const winScores: Record<string, number> = {};
  window.forEach((b) => {
    const v = scores[b.key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      winScores[b.key] = Number(v.toFixed(2));
    }
  });

  return {
    code,
    params,
    windowStart: window[0].date,
    windowEnd: window[window.length - 1].date,
    windowBars: window.length,
    scoreDays: Object.keys(winScores).length,
    stats,
    trades: trades.map((t) => ({ ...t, ret: Number(t.ret.toFixed(6)) })),
    skips,
    scores: winScores,
    bars: window.map((b) => ({ date: b.date, open: Number(b.open.toFixed(3)), close: Number(b.close.toFixed(3)) })),
  };
}
