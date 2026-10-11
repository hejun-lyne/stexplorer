import { Stock } from '@/types/stock';

/**
 * 打开股票时后台预取的日K缓存
 *
 * 详情页的 K 线只有被点开（组件挂载）时才会取数，于是「点开 tab」还得再等一次取数往返。
 * 打开股票时先把日K取好放进这里，K 线组件挂载时同步取用即可立刻画出来。
 * 缓存只用于「先画图」，随后的正常取数流程仍会再跑一遍以保证数据最新。
 */

/** 最多缓存多少只股票，超出后淘汰最早写入的一条 */
const MAX_ENTRIES = 60;
/** 预取结果有效期：过期视为无效（可能已不是最新交易日 / 训练日已切换） */
const MAX_AGE_MS = 30 * 60 * 1000;

interface Entry {
  ks: Stock.KLineItem[];
  at: number;
}

const entries = new Map<string, Entry>();

/** 后台预取日K：传入取数 Promise，完成后缓存；失败静默忽略 */
export function preloadDailyKline(secid: string, promise: Promise<{ ks?: Stock.KLineItem[] } | undefined>) {
  promise
    .then((r) => {
      const ks = (r && r.ks) || [];
      if (!ks.length) {
        return;
      }
      entries.set(secid, { ks, at: Date.now() });
      if (entries.size > MAX_ENTRIES) {
        let oldestKey = '';
        let oldestAt = Number.POSITIVE_INFINITY;
        entries.forEach((v, k) => {
          if (v.at < oldestAt) {
            oldestAt = v.at;
            oldestKey = k;
          }
        });
        if (oldestKey) {
          entries.delete(oldestKey);
        }
      }
    })
    .catch(() => undefined);
}

/** 取一次已就绪的预取日K；未就绪 / 已过期返回 null */
export function getPreloadedDailyKline(secid: string): Stock.KLineItem[] | null {
  const entry = entries.get(secid);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.at > MAX_AGE_MS) {
    entries.delete(secid);
    return null;
  }
  return entry.ks;
}
