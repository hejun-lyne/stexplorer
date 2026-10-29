/**
 * 「RSI形态」类型定义与表头筛选项
 *
 * 形态只描述**当日**的 RSI(6/24) 结构，不记录「X日前金叉」这类历史时间信息：
 * - 类型由当日 6 日线、24 日线的位置/差值/收敛方向 + 当日是否发生交叉决定；
 * - 唯一保留的「背景」是超买/超卖格局（回踩、超卖反转需要它来定性），但文案里不出现天数。
 *
 * `scoreStockRsi` 产出的 `pattern` 就是这里的类型名（可能带「｜RSI6=78 偏高，下调15分」后缀），
 * 因此筛选直接按类型名归一化成 key，不做关键词猜测。
 *
 * 顺序按「买点强弱」从强到弱排列（越靠前越接近可买点），方便按顺序勾选。
 */
export const RSI_SHAPE_LABELS = {
  pullback_hold: '超买回踩企稳',
  pullback: '超买回踩中',
  oversold_reversal: '超卖反转',
  cross_up: '金叉',
  bull: '多头排列',
  cross_up_imminent: '金叉在即',
  repairing: '修复中',
  cross_down: '死叉',
  bear: '空头排列',
  overbought_stagnant: '超买钝化',
} as const;

export type RsiShapeKey = keyof typeof RSI_SHAPE_LABELS;

/** 表头筛选项（末尾追加「未识别」，对应无文案 / 数据不足 / 无法归类的行） */
export const RSI_SHAPE_FILTER_OPTIONS = [
  ...(Object.keys(RSI_SHAPE_LABELS) as RsiShapeKey[]).map((key) => ({
    label: RSI_SHAPE_LABELS[key],
    value: key,
  })),
  { label: '（未识别）', value: '' },
];

/**
 * 把 RSI 形态文案归一化成筛选用的形态 key
 *
 * `pattern` 形如「金叉｜RSI6=78 偏高，下调15分」，先去掉「｜」之后的追高衰减后缀，
 * 再与类型名精确比对。返回 '' 表示未识别（无文案 / 数据未就绪 / 无法归类）。
 */
export const normalizeRsiShape = (pattern?: string): string => {
  const name = String(pattern || '').split('｜')[0].trim();
  if (!name) {
    return '';
  }
  const hit = (Object.keys(RSI_SHAPE_LABELS) as RsiShapeKey[]).find((key) => RSI_SHAPE_LABELS[key] === name);
  return hit || '';
};
