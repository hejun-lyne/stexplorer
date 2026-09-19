/**
 * 训练模式数据层日期过滤器
 *
 * 训练模式开启后，所有「时间序列」数据（K线、分时、资金流）无论来自网络请求、
 * 磁盘缓存还是实时推送，都必须先经过这里按「当前训练日期」截断，
 * 保证整个应用任何位置都不会出现未来数据。
 *
 * 注意：本模块为无依赖的模块级单例，避免与 redux / services 产生循环引用，
 * 由应用根节点在系统设置变化时同步（见 FullHome）。
 */

const DAY_LENGTH = 10;

let trainToDate: string | undefined;

/** 设置当前训练日期（传空则关闭过滤） */
export function SetTrainToDate(date?: string) {
  trainToDate = date && date.length >= DAY_LENGTH ? date.substring(0, DAY_LENGTH) : undefined;
}

/** 当前训练日期，未开启训练模式时为空 */
export function GetTrainToDate() {
  return trainToDate;
}

/** 是否处于训练过滤状态 */
export function IsTrainFilterOn() {
  return !!trainToDate;
}

/**
 * 临时关闭过滤执行取数
 * 仅用于训练会话自身需要的「日历类」数据（如取整个训练窗口的交易日列表）
 */
export async function WithoutTrainFilter<T>(handler: () => Promise<T>): Promise<T> {
  const prev = trainToDate;
  trainToDate = undefined;
  try {
    return await handler();
  } finally {
    trainToDate = prev;
  }
}

/** 时间戳是否晚于当前训练日期（按天比较，训练日期当天的数据全部保留） */
export function IsAfterTrainDate(date?: string) {
  if (!trainToDate || !date) {
    return false;
  }
  return date.substring(0, DAY_LENGTH) > trainToDate;
}

/** 按训练日期截断时间序列数据，数据本身未被裁剪时返回原引用 */
export function CutTimeSeries<T>(list: T[] | undefined, getDate: (item: T) => string | undefined): T[] {
  if (!list || !list.length || !trainToDate) {
    return list || [];
  }
  let cuted = false;
  const result = list.filter((item) => {
    const date = getDate(item);
    // 无法解析日期的数据保持原样
    const keep = !date || date.substring(0, DAY_LENGTH) <= (trainToDate as string);
    if (!keep) {
      cuted = true;
    }
    return keep;
  });
  return cuted ? result : list;
}

/** K线 */
export function CutKlines(ks?: Stock.KLineItem[]) {
  return CutTimeSeries(ks, (k) => k && k.date);
}

/** 分时 */
export function CutTrends(trends?: Stock.TrendItem[]) {
  return CutTimeSeries(trends, (t) => t && t.datetime);
}

/** 分时资金流 */
export function CutFlowTrends(trends?: Stock.FlowTrendItem[]) {
  return CutTimeSeries(trends, (t) => t && t.time);
}

/** 日资金流 */
export function CutFlowDlines(lines?: Stock.FlowDLineItem[]) {
  return CutTimeSeries(lines, (l) => l && l.date);
}
