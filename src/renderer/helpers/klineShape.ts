import { SingleKLineShapeNames } from '@/utils/enums';

/**
 * 「K线形态」列的排序键
 *
 * 该列的排序不是单一数值：先阳线后阴线（阳线在前），同为阳/阴时再按形态优先级
 * （见 klineShapeWeight）；同一形态内按「下影 - 上影」从小到大，再按K线实体大小兜底。
 * 因此它在列表里有专门的比较逻辑（见 compareKlineShape），不走通用的数值排序。
 */
export const KLINE_SHAPE_SORT_KEY = 'klineShape';

/** 阳线形态排序优先级（越靠前越优先） */
export const KLINE_SHAPE_ORDER_YANG = [
  '铁锤线',
  '倒宝剑线',
  '十字星',
  '螺旋桨',
  '纺锤线',
  '地线宝宝',
  '中海绵宝宝',
  '大海绵宝宝',
  '天线宝宝',
  '倒铁锤线',
  '宝剑线',
];

/** 阴线形态排序优先级（越靠前越优先） */
export const KLINE_SHAPE_ORDER_YIN = [
  '倒宝剑线',
  '十字星',
  '铁锤线',
  '螺旋桨',
  '纺锤线',
  '宝剑线',
  '倒铁锤线',
  '地线宝宝',
  '天线宝宝',
  '中海绵宝宝',
  '大海绵宝宝',
];

/**
 * K线形态排序权重（越大越靠前）
 *
 * 阳线整体大于阴线；同为阳/阴时按各自的形态优先级表（上面的顺序即优先级）；
 * 形态未识别（空 / 未知）的统一排最后。
 */
export const klineShapeWeight = (shape?: string, yin?: boolean): number => {
  const list = yin ? KLINE_SHAPE_ORDER_YIN : KLINE_SHAPE_ORDER_YANG;
  const idx = list.indexOf(String(shape || ''));
  if (idx < 0) {
    return 0; // 未识别形态：排在所有已识别形态之后
  }
  // 阳线权重从 100 起、阴线从 50 起，各组内按优先级递减；这样阳线整体大于阴线，两者都大于未识别形态（0）
  return (yin ? 50 : 100) - idx;
};

/**
 * 「K线形态」表头筛选项
 *
 * 先按排序优先级表（阳线、阴线）给出顺序，再补上优先级表里没有的形态
 * （目前是「小海绵宝宝」，保证筛选器覆盖所有可识别形态）；
 * 末尾追加「未识别」（value 为空字符串），对应列表里形态为空或「未知」的股票，Excel 式筛选可以连空值一起筛。
 */
export const KLINE_SHAPE_FILTER_OPTIONS = [
  ...Array.from(
    new Set([
      ...KLINE_SHAPE_ORDER_YANG,
      ...KLINE_SHAPE_ORDER_YIN,
      ...Object.values(SingleKLineShapeNames).filter((name) => name && name !== '未知'),
    ])
  ).map((name) => ({ label: name, value: name })),
  { label: '（未识别）', value: '' },
];

/**
 * 行内 K线形态归一化：把「未知」和空值统一成空字符串，
 * 这样表头筛选里的「（未识别）」一项能同时覆盖它们（勾「全选」不会漏行）。
 */
export const normalizeKlineShape = (shape?: string): string => {
  const v = String(shape || '');
  return v === '未知' ? '' : v;
};

/**
 * K线形态排序比较器（供列表 sort 使用）
 *
 * t=2（降序）：阳线在前、形态优先级高的在前、同形态内（下影-上影）小的在前、实体大的在前；
 * t=1（升序）：完全相反。
 */
export const compareKlineShape = (a: any, b: any, t: number): number => {
  const left = klineShapeWeight(a?.klineShape, a?.klineYin);
  const right = klineShapeWeight(b?.klineShape, b?.klineYin);
  if (left !== right) {
    return t === 2 ? right - left : left - right;
  }
  // 同一形态：下影 - 上影，越低越靠前（无上下影线时两者都是 0，自然交给实体大小兜底）
  const shadowDiff = (r: any) => (Number(r?.klineLowerShadow) || 0) - (Number(r?.klineUpperShadow) || 0);
  const leftShadow = shadowDiff(a);
  const rightShadow = shadowDiff(b);
  if (leftShadow !== rightShadow) {
    return t === 2 ? leftShadow - rightShadow : rightShadow - leftShadow;
  }
  const leftSize = Number(a?.klineSize) || 0;
  const rightSize = Number(b?.klineSize) || 0;
  if (leftSize === rightSize) return 0;
  return t === 2 ? rightSize - leftSize : leftSize - rightSize;
};
