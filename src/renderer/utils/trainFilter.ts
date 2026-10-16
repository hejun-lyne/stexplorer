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
  const next = date && date.length >= DAY_LENGTH ? date.substring(0, DAY_LENGTH) : undefined;
  // 从「有训练日期」变成「没有」时给出提示，便于定位是谁把训练日期清掉了
  if (trainToDate && !next) {
    console.warn('[训练过滤] 训练日期被清空：', { prev: trainToDate, next, arg: date });
  }
  trainToDate = next;
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
 * 说明：早期这里的 `WithoutTrainFilter`（全局开关，临时置空训练日期）已被移除。
 * 它是全局状态，一旦与并发请求重叠，就会把「正在取数的其它请求」的过滤一起关掉
 * （或把训练日期永久清掉）。需要绕过过滤的取数（如训练窗口的交易日历）
 * 请改用「按调用」的 `ignoreTrain` 选项，见 Services.Stock.GetKFromSetting。
 *
 * 详情页的「忽略训练」开关走的是下面的 **按股票(secid) 登记**：开关只对当前这一只
 * 股票生效，取数与写入 store 前的截断都会跳过训练过滤，其它股票不受任何影响
 * （避免重蹈全局开关导致训练数据泄漏的覆辙）。
 */

/** secid 归一化：'1.600000' / '600000' / '1.600000.SH' 统一成 6 位代码（小写去空格） */
function normalizeSecidForIgnore(secid?: string | number | null): string {
  const raw = String(secid ?? '').trim();
  if (!raw) {
    return '';
  }
  return raw.split('.').pop()!.trim().toLowerCase();
}

/** 「忽略训练」的股票集合（详情页开关打开时登记当前股票） */
const ignoreTrainSecids = new Set<string>();

/** 登记 / 取消某只股票「忽略训练」（传空 secid 或 on=false 即取消） */
export function SetIgnoreTrain(secid?: string | number | null, on = true) {
  const key = normalizeSecidForIgnore(secid);
  if (!key) {
    return;
  }
  if (on) {
    ignoreTrainSecids.add(key);
  } else {
    ignoreTrainSecids.delete(key);
  }
}

/** 该股票是否处于「忽略训练」状态（未登记即 false） */
export function IsIgnoreTrain(secid?: string | number | null) {
  const key = normalizeSecidForIgnore(secid);
  return !!key && ignoreTrainSecids.has(key);
}

/** 从接口参数里推断出「单只股票」的 secid：批量请求（secids 数组）不参与忽略，避免整批绕过过滤 */
export function PickSingleSecid(params?: Record<string, any> | null): string {
  if (!params) {
    return '';
  }
  const single = params.secid ?? params.ts_code ?? params.code;
  if (single == null || Array.isArray(single)) {
    return '';
  }
  return String(single);
}

/** 时间戳是否晚于当前训练日期（按天比较，训练日期当天的数据全部保留） */
export function IsAfterTrainDate(date?: string) {
  const toDate = GetTrainToDate();
  if (!toDate || !date) {
    return false;
  }
  return date.substring(0, DAY_LENGTH) > toDate;
}

/** 按训练日期截断时间序列数据，数据本身未被裁剪时返回原引用 */
export function CutTimeSeries<T>(list: T[] | undefined, getDate: (item: T) => string | undefined): T[] {
  const toDate = GetTrainToDate();
  if (!list || !list.length || !toDate) {
    return list || [];
  }
  let cuted = false;
  const result = list.filter((item) => {
    const date = getDate(item);
    // 无法解析日期的数据保持原样
    const keep = !date || date.substring(0, DAY_LENGTH) <= toDate;
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
