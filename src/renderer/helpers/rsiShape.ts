/**
 * 「RSI形态」表头筛选项（参照 helpers/klineShape.ts 的 K线形态筛选）
 *
 * 评分逻辑（helpers/shortTermScore.ts 的 scoreStockRsi）产出的 `pattern` 是自由文案：
 * 既带「当日 / X日前」这类动态片段，也会有「｜RSI6=78 偏高，下调15分」这类追高衰减后缀，
 * 因此不能像 K线形态那样按整串精确匹配，这里先归一化成稳定的形态 key，筛选按 key 进行。
 *
 * 顺序大致按「买点强弱」从强到弱排列（越靠前越接近可买点），方便按顺序勾选。
 */
export const RSI_SHAPE_FILTER_OPTIONS = [
  { label: '超买回踩', value: 'pullback' },
  { label: '超卖后金叉', value: 'oversold_cross_up' },
  { label: '金叉', value: 'cross_up' },
  { label: '金叉在即', value: 'cross_up_imminent' },
  { label: '修复中', value: 'repairing' },
  { label: '多头排列', value: 'bull' },
  { label: '金叉失效', value: 'cross_up_invalid' },
  { label: '死叉', value: 'cross_down' },
  { label: '空头排列', value: 'bear' },
  { label: '超买钝化', value: 'overbought_stagnant' },
  { label: '（未识别）', value: '' },
];

/**
 * 把 RSI 形态文案归一化成筛选用的形态 key
 *
 * 只用关键词判定（不依赖括号全/半角与具体措辞），这样缓存里的旧文案也能落到正确分类；
 * 判定顺序很重要，例如：
 * - 「持续超买钝化」要在超买分支之前；
 * - 「金叉在即 / 接近金叉」要在「超卖后金叉」之前（「超卖反弹(接近金叉)」同时含两边的词）；
 * - 「修复中(未金叉)」要在金叉分支之前（否则会被「金叉」二字误判）；
 * - 「多头排列(金叉时效已过)」要在金叉分支之前（否则会被「金叉」误判）。
 *
 * 返回 '' 表示未识别（无文案 / 数据未就绪 / 无法归类），对应筛选里的「（未识别）」。
 */
export const normalizeRsiShape = (pattern?: string): string => {
  const p = String(pattern || '').trim();
  if (!p) {
    return '';
  }
  // 持续超买钝化（追高风险）
  if (p.includes('钝化')) {
    return 'overbought_stagnant';
  }
  // 超买后的回踩 / 回落（最佳买点或回踩中）
  if (p.includes('超买') && (p.includes('回踩') || p.includes('回落'))) {
    return 'pullback';
  }
  // 死叉系列（含「反弹中死叉」「超卖后死叉」「死叉后已收复12日线 / 快速收复中」）
  if (p.includes('死叉')) {
    return 'cross_down';
  }
  // 金叉失效（「超卖金叉失效」「3日内金叉失效」「金叉失效」）
  if (p.includes('失效')) {
    return 'cross_up_invalid';
  }
  // 金叉在即 / 接近金叉（含「跌深修复、逼近24日线(金叉在即)」）
  if (p.includes('金叉在即') || p.includes('接近金叉') || p.includes('逼近24日线')) {
    return 'cross_up_imminent';
  }
  // 修复中（未金叉 / 跌深修复中）
  if (p.includes('修复')) {
    return 'repairing';
  }
  // 均线排列（需在金叉判定之前：「多头排列强势区(金叉时效已过)」含「金叉」）
  if (p.includes('多头')) {
    return 'bull';
  }
  if (p.includes('空头')) {
    return 'bear';
  }
  // 超卖后的金叉（含「超卖金叉待确认」）
  if (p.includes('超卖') && p.includes('金叉')) {
    return 'oversold_cross_up';
  }
  // 其余金叉 / 上穿（「3日内金叉(非超卖反转)」）
  if (p.includes('金叉') || p.includes('上穿')) {
    return 'cross_up';
  }
  return '';
};
