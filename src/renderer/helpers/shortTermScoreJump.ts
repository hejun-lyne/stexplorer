// ==================== 短线评分「突变」识别 ====================
//
// 技术指标里的短线评分是一条 0~100 的曲线，只反映分值高低，看不出「某一天分数跳了多少」。
// 短线真正值得关注的是个别交易日评分的突然跳变（板块/资金/量能某一维度当日翻转），以及跳变的幅度。
// 本模块为纯计算：把逐日评分序列换算成「突变点 + 突变等级 + 相对自身波动的倍数」，
// 图表侧（PriceTrend）只负责把这些信息画成红绿柱 / 提示框，不在这里引入任何图表 API。

/** 突变判定阈值（分值：0~100 刻度下的单日变化绝对值） */
export const SCORE_JUMP_CONFIG = {
  /** 达到该变化才认定为突变，低于该值视为日常波动（柱子淡色显示） */
  minDelta: 4,
  /** 明显突变：提示框标注为「明显突变」 */
  notableDelta: 7,
  /** 剧烈突变：提示框标注为「剧烈突变」 */
  sharpDelta: 12,
};

export type ScoreJumpLevel = 'slight' | 'notable' | 'sharp';

export const SCORE_JUMP_LEVEL_LABELS: Record<ScoreJumpLevel, string> = {
  slight: '小幅突变',
  notable: '明显突变',
  sharp: '剧烈突变',
};

export interface ScoreJumpPoint {
  /** 在传入序列中的下标（与图表 x 轴对齐） */
  index: number;
  /** 交易日（取自传入的 dates，可能为空串） */
  date: string;
  /** 当日评分 */
  value: number;
  /** 相对前一个有效评分日的变化（正=跳升，负=跳降） */
  delta: number;
  level: ScoreJumpLevel;
  /** 变化幅度相对「近期单日平均波动」的倍数（用于描述程度；无法计算时为 null） */
  ratio: number | null;
}

/** 按单日变化幅度分级；未达到 minDelta 返回 null（不算突变） */
export function classifyScoreJump(
  delta: number,
  cfg = SCORE_JUMP_CONFIG,
): ScoreJumpLevel | null {
  const abs = Math.abs(delta);
  if (abs < cfg.minDelta) return null;
  if (abs >= cfg.sharpDelta) return 'sharp';
  if (abs >= cfg.notableDelta) return 'notable';
  return 'slight';
}

/** 变化数值的展示文本：+12.3 / -5.0 */
export const formatScoreDelta = (delta: number) => `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`;

/**
 * 计算评分曲线的突变点。
 *
 * - 只比较「相邻的两个有效评分日」：中间缺失的交易日（停牌/数据不足/周月K 未对齐）会断开比较，
 *   避免把跨越多日的变化当成单日突变。
 * - 程度用两种口径：绝对值分级（评分是固定 0~100 刻度，绝对幅度本身可比），
 *   以及相对该序列「单日变化绝对值中位数」的倍数（同一只股票自己跟自己比，避免不同股票基线不同）。
 */
export function computeScoreJumps(
  values: (number | null | undefined)[],
  dates: string[] = [],
  cfg = SCORE_JUMP_CONFIG,
): ScoreJumpPoint[] {
  // ---- 第一遍：收集相邻有效评分之间的单日变化（用于算波动基线）----
  const deltas: { index: number; delta: number }[] = [];
  let prev: number | null = null;
  values.forEach((v, i) => {
    const cur = typeof v === 'number' && Number.isFinite(v) ? v : null;
    if (cur === null) {
      prev = null; // 缺口：不与隔了好几天的评分比较
      return;
    }
    if (prev !== null) {
      deltas.push({ index: i, delta: cur - prev });
    }
    prev = cur;
  });
  if (!deltas.length) {
    return [];
  }
  const absSorted = deltas.map((d) => Math.abs(d.delta)).sort((a, b) => a - b);
  const base = absSorted[Math.floor(absSorted.length / 2)];
  const baseSafe = base > 0.1 ? base : null;

  // ---- 第二遍：按阈值筛出突变点 ----
  const points: ScoreJumpPoint[] = [];
  deltas.forEach(({ index, delta }) => {
    const level = classifyScoreJump(delta, cfg);
    if (!level) {
      return;
    }
    points.push({
      index,
      date: String(dates[index] || ''),
      value: values[index] as number,
      delta,
      level,
      ratio: baseSafe ? Math.abs(delta) / baseSafe : null,
    });
  });
  return points;
}

/**
 * 突变程度描述（提示框用）：剧烈突变（约为日常波动的 2.8 倍）
 *
 * 变化数值与方向由提示框单独一行展示，这里只补充「有多剧烈」。
 */
export function describeScoreJump(point: ScoreJumpPoint): string {
  const label = SCORE_JUMP_LEVEL_LABELS[point.level];
  if (point.ratio === null || point.ratio < 1.2) {
    return label;
  }
  return `${label}（约为日常波动的 ${point.ratio.toFixed(1)} 倍）`;
}
