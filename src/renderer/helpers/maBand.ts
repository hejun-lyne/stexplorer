/**
 * 均线区间（短均线之上、长均线之下）——列表过滤与板块回测共用的口径
 *
 * 形态含义：收盘价在短均线上方、长均线下方，即「中期趋势还没坏、短期回调到中继位置」。
 * 离线脚本 backtest_short_score_jump.py 的 --ma-band 5:20 / --below-ma 同口径，
 * 只用 5/10/20/40/60 这几条均线，保证脚本与界面看到的信号一致。
 *
 * 本模块只做纯计算（不取数、不依赖组件），列表过滤（helpers/stock.ts）与板块回测
 * （helpers/boardScoreBacktest.ts）都从这里取，避免两处各写一套边界判定。
 */

/** 可选的均线周期（与离线脚本一致） */
export const MA_BAND_PERIODS = [5, 10, 20, 40, 60];

/** 均线区间：收盘价 > MA(low) 且 < MA(high) */
export interface MaBand {
  low: number;
  high: number;
}

/** '5:20' -> { low: 5, high: 20 }；空串 / 非法 / 短>=长 一律返回 null（= 不过滤） */
export function parseMaBand(value?: string | number | null): MaBand | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parts = String(value)
    .replace(/：/g, ':')
    .replace(/-/g, ':')
    .split(':')
    .map((x) => x.trim())
    .filter((x) => x !== '');
  if (parts.length !== 2) {
    return null;
  }
  const low = Math.floor(Number(parts[0]));
  const high = Math.floor(Number(parts[1]));
  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= 0 || low >= high) {
    return null;
  }
  return { low, high };
}

/** 区间 -> '5:20'（下拉框 / 参数签名用） */
export function maBandKey(band?: MaBand | null): string {
  return band ? `${band.low}:${band.high}` : '';
}

/** 所有两两组合（短 < 长），默认 5/10/20/40/60 的 10 种 */
export function maBandPairs(periods: number[] = MA_BAND_PERIODS): MaBand[] {
  const ps = Array.from(new Set(periods.map((p) => Math.floor(Number(p)))))
    .filter((p) => Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);
  const out: MaBand[] = [];
  ps.forEach((low, i) => {
    ps.slice(i + 1).forEach((high) => out.push({ low, high }));
  });
  return out;
}

/** 下拉框选项：第一项为「不过滤」 */
export const MA_BAND_OPTIONS: { label: string; value: string }[] = [
  { label: '不过滤', value: '' },
  ...maBandPairs().map((b) => ({ label: `MA${b.low}<价<MA${b.high}`, value: maBandKey(b) })),
];

/** 第 idx 根收盘价的 n 日均线；越界或数据不足返回 null */
export function smaAt(closes: number[], idx: number, period: number): number | null {
  const p = Math.floor(Number(period));
  if (!Number.isFinite(p) || p < 1 || idx < 0 || idx >= closes.length || idx + 1 < p) {
    return null;
  }
  let sum = 0;
  for (let i = idx + 1 - p; i <= idx; i += 1) {
    const v = Number(closes[i]);
    if (!Number.isFinite(v)) {
      return null;
    }
    sum += v;
  }
  return sum / p;
}

/**
 * 收盘价是否落在区间内（> 短均线 且 < 长均线）
 *
 * 返回 null 表示数据不足（均线算不出来）：调用方应视为「不通过」，
 * 避免「拿不足 N 天的数据硬算均线」造成误判（与 helpers/stock.ts 的 AboveMAs 同口径）。
 */
export function maBandOkAt(closes: number[], idx: number, band?: MaBand | null): boolean | null {
  if (!band) {
    return true;
  }
  const lowMa = smaAt(closes, idx, band.low);
  const highMa = smaAt(closes, idx, band.high);
  if (lowMa === null || highMa === null) {
    return null;
  }
  const close = Number(closes[idx]);
  if (!Number.isFinite(close)) {
    return null;
  }
  return close > lowMa && close < highMa;
}

/** 均线区间的文案（表格 / 参数摘要用） */
export function maBandLabel(band?: MaBand | null): string {
  return band ? `MA${band.low}<价<MA${band.high}` : '';
}
