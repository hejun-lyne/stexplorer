import * as Services from '@/services';

/**
 * 板块日K强势度评分（《板块日K强势度评分_调整说明 v1.1》）—— 渲染层类型与展示辅助
 *
 * 计算在 python 侧完成（board_strength_model.py / TushareAPI.score_board_strength）：
 * 成份股 qfq 日线 → 等权板块指数 + 广度聚合 → 全A等权市场中性化 → 重标定绝对曲线
 * → S1 广度 / S2 爆发 / S3 跳空 / S4 趋势 / S5 结构 → 修正项 → 双轨输出。
 *
 * scoreAlpha（超额强度）用于板块间排序；scoreAbs（绝对冷热）用于判断板块自身是否在涨。
 * 两者会显著分歧，UI 必须同时展示，不能只按一个口径下结论。
 */

export interface BoardStrengthItem {
  secid: string;
  code: string;
  name: string;
  stockCount?: number;
}

export interface BoardStrengthRow {
  secid: string;
  code: string;
  name: string;
  /** 超额强度：市场中性化后，板块间排序用 */
  scoreAlpha: number;
  /** 绝对冷热：不看相对市场，判断板块自身是否在涨 */
  scoreAbs: number;
  grade: string;
  rank: number;
  rankAbs: number;
  /** S1 广度 */
  s1: number;
  /** S2 爆发 */
  s2: number;
  /** S3 跳空 */
  s3: number;
  /** S4 趋势 */
  s4: number;
  /** S5 结构 */
  s5: number;
  penalty: number;
  flags: string;
  members: number;
  sigma: number;
  cumRet: number;
  exTrend: number;
  r2: number;
  pathEr: number;
  volRatio: number;
  upShare: number;
  exUp: number;
  upShare5: number;
  diffusion: number;
  limitShare: number;
  bigShare: number;
  gapNet: number;
  exGap: number;
  gapUnfilled: number;
  consistency: number;
  dispersion: number;
  concentration: number;
  /** 成份股映射缺失 / 数据不足等原因，此时分数为 0，列表显示「—」 */
  error?: string;
}

export interface BoardStrengthResult {
  rows: BoardStrengthRow[];
  asOf: string;
  window: number;
  scored: number;
  skipped: { secid: string; name: string; reason: string }[];
  error?: string;
}

const num = (v: any, def = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

/** 等级作用于 scoreAbs（与 v1.0 一致：绝对冷热才是「板块自身是否在涨」） */
export function strengthGrade(scoreAbs: number): string {
  if (!Number.isFinite(scoreAbs) || scoreAbs <= 0) return '—';
  if (scoreAbs >= 80) return '极强';
  if (scoreAbs >= 65) return '强';
  if (scoreAbs >= 50) return '中性偏强';
  if (scoreAbs >= 35) return '中性偏弱';
  return '弱';
}

/** 超额分的配色：>60 强 / 45~60 中性 / <45 弱 */
export function strengthColor(score: number): string {
  if (!Number.isFinite(score) || score <= 0) return 'var(--secondary-text-color)';
  if (score >= 60) return 'var(--increase-color)';
  if (score >= 45) return 'var(--primary-color)';
  return 'var(--reduce-color)';
}

/** 名称列的明细 tooltip：双轨分 + 五个维度 + 原子指标 + 修正项 */
export function strengthTooltip(r: BoardStrengthRow): string {
  if (r.error) return `${r.name}（${r.secid}）\n${r.error}`;
  const lines = [
    `${r.name}（${r.secid}）  成份股 ${r.members} 只`,
    `超额强度 ${r.scoreAlpha.toFixed(1)}（第 ${r.rank}）　绝对冷热 ${r.scoreAbs.toFixed(1)}（第 ${r.rankAbs}）　评级 ${r.grade}`,
    `S1 广度 ${r.s1.toFixed(1)}　S2 爆发 ${r.s2.toFixed(1)}　S3 跳空 ${r.s3.toFixed(1)}　S4 趋势 ${r.s4.toFixed(1)}　S5 结构 ${r.s5.toFixed(1)}`,
    `区间涨幅 ${pct(r.cumRet)}　超额 ${pct(r.exTrend)}　R² ${r.r2.toFixed(2)}　路径效率 ${r.pathEr.toFixed(2)}`,
    `上涨广度 ${pct(r.upShare)}　超额广度 ${pct(r.exUp)}　末5日 ${pct(r.upShare5)}　扩散 ${pct(r.diffusion)}`,
    `涨停占比 ${pct(r.limitShare)}　大阳占比 ${pct(r.bigShare)}　净高开 ${pct(r.gapNet)}（超额 ${pct(r.exGap)}）`,
    `一致性 ${r.consistency.toFixed(4)}　离散度 ${r.dispersion.toFixed(4)}　集中度 ${r.concentration.toFixed(2)}`,
    `波动率 σ ${pct(r.sigma)}（放大 ${r.volRatio.toFixed(2)}×）　扣分 ${r.penalty.toFixed(1)}${r.flags ? `：${r.flags}` : ''}`,
  ];
  return lines.join('\n');
}

function emptyRow(item: BoardStrengthItem, reason: string): BoardStrengthRow {
  return {
    secid: item.secid,
    code: item.code,
    name: item.name,
    scoreAlpha: 0,
    scoreAbs: 0,
    grade: '—',
    rank: 0,
    rankAbs: 0,
    s1: 0, s2: 0, s3: 0, s4: 0, s5: 0,
    penalty: 0,
    flags: '',
    members: 0,
    sigma: 0,
    cumRet: 0,
    exTrend: 0,
    r2: 0,
    pathEr: 0,
    volRatio: 0,
    upShare: 0,
    exUp: 0,
    upShare5: 0,
    diffusion: 0,
    limitShare: 0,
    bigShare: 0,
    gapNet: 0,
    exGap: 0,
    gapUnfilled: 0,
    consistency: 0,
    dispersion: 0,
    concentration: 0,
    error: reason,
  };
}

function mapRow(raw: any, item: BoardStrengthItem): BoardStrengthRow {
  const scoreAbs = num(raw.score_abs);
  return {
    secid: item.secid,
    code: item.code,
    name: item.name,
    scoreAlpha: num(raw.score_alpha),
    scoreAbs,
    grade: strengthGrade(scoreAbs),
    rank: num(raw.rank),
    rankAbs: num(raw.rank_abs),
    s1: num(raw.s1), s2: num(raw.s2), s3: num(raw.s3), s4: num(raw.s4), s5: num(raw.s5),
    penalty: num(raw.penalty),
    flags: String(raw.flags || ''),
    members: num(raw.members),
    sigma: num(raw.sigma),
    cumRet: num(raw.cum_ret),
    exTrend: num(raw.ex_trend),
    r2: num(raw.r2),
    pathEr: num(raw.path_er),
    volRatio: num(raw.vol_ratio),
    upShare: num(raw.up_share),
    exUp: num(raw.ex_up),
    upShare5: num(raw.up_share5),
    diffusion: num(raw.diffusion),
    limitShare: num(raw.limit_share),
    bigShare: num(raw.big_share),
    gapNet: num(raw.gap_net),
    exGap: num(raw.ex_gap),
    gapUnfilled: num(raw.gap_unfilled),
    consistency: num(raw.consistency),
    dispersion: num(raw.dispersion),
    concentration: num(raw.concentration),
  };
}

/**
 * 取一次评分结果：一次 IPC 算完所有板块。
 * 没有成份股映射 / 数据不足的板块仍保留一行（error），这样右侧图表面板依然可点。
 */
export async function computeBoardDailyStrength(
  items: BoardStrengthItem[],
  options?: { window?: number; asOf?: string }
): Promise<BoardStrengthResult> {
  const window = options?.window || 20;
  if (!items.length) {
    return { rows: [], asOf: '', window, scored: 0, skipped: [] };
  }
  const res = await Services.Tushare.ScoreBoardStrengthFromTushare(
    items.map((i) => ({ secid: i.secid, code: i.code, name: i.name })),
    options?.asOf,
    window
  );
  const rawRows: any[] = Array.isArray(res?.rows) ? res.rows : [];
  const skipped = Array.isArray(res?.skipped) ? res.skipped : [];
  const bySecid = new Map(rawRows.map((r) => [String(r.secid), r]));
  const skipReason = new Map(skipped.map((s) => [String(s.secid), s.reason]));
  const rows = items.map((item) => {
    const raw = bySecid.get(item.secid);
    if (raw) return mapRow(raw, item);
    return emptyRow(
      item,
      res?.error || skipReason.get(item.secid) || '成份股数据不足，未参与本轮评分'
    );
  });
  // 有效分按超额强度倒序，无分数沉底
  rows.sort((a, b) => {
    if (a.error && !b.error) return 1;
    if (!a.error && b.error) return -1;
    return b.scoreAlpha - a.scoreAlpha;
  });
  return {
    rows,
    asOf: String(res?.as_of || ''),
    window: num(res?.window, window),
    scored: num(res?.scored, rawRows.length),
    skipped,
    error: res?.error,
  };
}
