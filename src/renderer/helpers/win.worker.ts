import { MemoryCache } from '@/cache';
import { ChokeGroupAdapter, ConCurrencyAllAdapter } from '@/utils/adapters';
import { BKType, KLineType, MAPeriodType, TechIndicatorType } from '@/utils/enums';
import * as Services from '@/services';
import * as Utils from '@/utils';
import * as Tech from '@/helpers/tech';
import * as BacktestEngine from '@/helpers/backtestEngine';
import { Stock } from '@/types/stock';
import * as Enums from '@/utils/enums';
const { ipcRenderer } = window.contextModules.electron;

export function postMessageOut(messageId: number, error: any, result?: any) {
  if (error) {
    /* istanbul ignore else */
    if (typeof console !== 'undefined' && 'error' in console) {
      // This is to make errors easier to debug. I think it's important
      // enough to just leave here without giving the user an option
      // to silence it.
      console.error('Worker caught an error:', error);
    }
    ipcRenderer.invoke('message-from-worker', [
      messageId,
      {
        message: error.message,
      },
    ]);
  } else {
    ipcRenderer.invoke('message-from-worker', [messageId, null, result]);
  }
}

let prevlLogTimestamp = 0;
const batchLogs: string[] = [];
function bridgeConsoleLog(...args: any[]) {
  const texts = [];
  for (let i = 0; i < args.length; i++) {
    const str = typeof args[i] == 'string' ? args[i] : JSON.stringify(args[i]);
    if (!str) {
      if (typeof args[i] == 'function') {
        texts.push(args[i].constructor);
      }
    } else {
      texts.push(str);
    }
  }
  // 日志messageId固定为1
  batchLogs.push('[info] ' + texts.join(' , '));
  console.log(batchLogs[batchLogs.length - 1]);
  const now = new Date().getTime();
  if (now - prevlLogTimestamp > 500) {
    postMessageOut(1, null, batchLogs);
    batchLogs.length = 0;
    prevlLogTimestamp = now;
  }
}

function bridgeProgressLog(progress: string) {
  console.log(progress);
  postMessageOut(2, null, progress);
}

export function sayHi(hi: string) {
  console.log(hi);
  return 'Hi too!';
}

export async function calculateIndicators(ks: Stock.KLineItem[], techType: TechIndicatorType, kIndex: number) {
  return Tech.calculateIndicators(ks, techType, kIndex);
}

const kDefaultGroupRequestSize = 10;

export function getAllBks() {
  const checkBkCache = async (key: string, bktype: BKType) => {
    const prev = MemoryCache.get(key);
    if (prev && prev.length) {
      return prev;
    }
    bridgeProgressLog('开始请求所有板块数据');
    const res = await Services.Stock.GetBanKuais(bktype, 500);
    let arr;
    if (res.arr && res.arr.length > 0) {
      arr = res.arr.filter((_) => _.name.indexOf('连板') == -1 && _.name.indexOf('涨停') == -1);
      MemoryCache.set(key, arr, MemoryCache.kDefaultCacheExpireTime);
    }
    bridgeProgressLog('结束请求所有板块数据: ' + (arr || []).length);
    return arr || [];
  };
  return checkBkCache('industryBks', BKType.Industry);
  // return ConCurrencyAllAdapter([() => checkBkCache('industryBks', BKType.Industry), () => checkBkCache('gainianBks', BKType.Gainian)], 100);
}

export function getAllBkSts(bks: Stock.BanKuaiItem[]) {
  const checkBkStsCache = async (bk: Stock.BanKuaiItem) => {
    const key = `${bk.code}.stocks`;
    const prev = MemoryCache.get(key);
    if (prev && prev.length) {
      return { secid: bk.secid, name: bk.name, stocks: prev };
    }
    bridgeProgressLog('开始请求板块标的数据: ' + bk.name);
    const res = await Services.Stock.GetBankuaiStocksFromDataSource(Enums.FundApiType.Eastmoney, bk.secid, 200);
    if (res.stocks && res.stocks.length > 0) {
      MemoryCache.set(key, res.stocks, MemoryCache.kDefaultCacheExpireTime);
    }
    bridgeProgressLog('结束请求板块标的数据: ' + res.stocks.length);
    return { secid: bk.secid, name: bk.name, stocks: res.stocks || [] };
  };
  return ChokeGroupAdapter(
    [...bks].map((b) => () => checkBkStsCache(b)),
    Math.ceil(bks.length / kDefaultGroupRequestSize),
    100
  );
}

export function getAllStDetails(sts: string[]) {
  const checkStDetailCache = async (secid: string) => {
    const index = sts.indexOf(secid);
    if (index % 20 == 0 || index == sts.length - 1) {
      bridgeProgressLog(`getAllStFinances: ${index + 1}/${sts.length}`);
    }
    const key = `${secid}.detail`;
    const prev = MemoryCache.get(key);
    if (prev && prev.length) {
      return prev;
    }
    const res = await Services.Stock.GetDetailFromEastmoney(secid);
    if (res) {
      MemoryCache.set(key, res, MemoryCache.kDefaultCacheExpireTime);
    }
    return res;
  };
  return ChokeGroupAdapter(
    sts.map((c) => () => checkStDetailCache(c)),
    Math.ceil(sts.length / kDefaultGroupRequestSize),
    100
  );
}

export function getAllStFinances(codes: string[]) {
  const checkStFinanceCache = async (code: string) => {
    const index = codes.indexOf(code);
    if (index % 20 == 0 || index == codes.length - 1) {
      bridgeProgressLog(`getAllStFinances: ${index + 1}/${codes.length}`);
    }
    const key = `${code}.finance`;
    const prev = MemoryCache.get(key);
    if (prev && prev.length) {
      return prev;
    }
    const res = await Services.Stock.GetReportData(code);
    if (res && res.length > 0) {
      MemoryCache.set(key, res, MemoryCache.kDefaultCacheExpireTime);
    }
    return res || [];
  };
  return ChokeGroupAdapter(
    codes.map((d) => () => checkStFinanceCache(d)),
    Math.ceil(codes.length / kDefaultGroupRequestSize),
    100
  );
}

export function getAllStKlines(secids: string[], count = 350) {
  const checkStKlinesCache = async (secid: string) => {
    const index = secids.indexOf(secid);
    if (index % 20 == 0 || index == secids.length - 1) {
      bridgeProgressLog(`getAllStKlines: ${index + 1}/${secids.length}`);
    }
    const key = `${secid}.klines`;
    const prev = MemoryCache.get(key);
    if (prev && prev.length) {
      return prev;
    }
    const res = await Services.Stock.GetKFromEastmoney(secid, KLineType.Day, count);
    if (res.ks && res.ks.length > 0) {
      MemoryCache.set(key, res.ks, MemoryCache.kDefaultCacheExpireTime);
    }
    return res.ks || [];
  };
  return ChokeGroupAdapter(
    secids.map((d) => () => checkStKlinesCache(d)),
    Math.ceil(secids.length / kDefaultGroupRequestSize),
    100
  );
}

export function getAllStLHBs(codes: string[]) {
  const checkStLHBCache = async (code: string) => {
    const index = codes.indexOf(code);
    if (index % 20 == 0 || index == codes.length - 1) {
      bridgeProgressLog(`getAllStLHBs: ${index + 1}/${codes.length}`);
    }
    const key = `${code}.lhb`;
    const prev = MemoryCache.get(key);
    if (prev && prev.length) {
      return prev;
    }
    const res = await Services.Stock.GetLongHuBang(code);
    if (res && res.length > 0) {
      MemoryCache.set(key, res, MemoryCache.kDefaultCacheExpireTime);
    }
    return res || [];
  };
  return ChokeGroupAdapter(
    codes.map((d) => () => checkStLHBCache(d)),
    Math.ceil(codes.length / kDefaultGroupRequestSize),
    100
  );
}

export function getAllStZJCs(codes: string[]) {
  const checkStZJCCache = async (code: string) => {
    const index = codes.indexOf(code);
    if (index % 20 == 0 || index == codes.length - 1) {
      bridgeProgressLog(`getAllStZJCs: ${index + 1}/${codes.length}`);
    }
    const key = `${code}.zjc`;
    const prev = MemoryCache.get(key);
    if (prev && prev.length) {
      return prev;
    }
    const res = await Services.Stock.GetExchangeChanges(code);
    if (res && res.length > 0) {
      MemoryCache.set(key, res, MemoryCache.kDefaultCacheExpireTime);
    }
    return res || [];
  };
  return ChokeGroupAdapter(
    codes.map((d) => () => checkStZJCCache(d)),
    Math.ceil(codes.length / kDefaultGroupRequestSize),
    100
  );
}

export function getDateDeals(date: string, secids: string[]) {
  const checkStDealCache = async (secid: string, date: string) => {
    const key = `${secid}.${date}.deals`;
    const prev = MemoryCache.get(key);
    if (prev && prev.length) {
      return prev;
    }
    const res = await Services.Stock.requestDealDay(secid, date);
    if (res && res.length > 0) {
      MemoryCache.set(key, res, MemoryCache.kDefaultCacheExpireTime);
    }
    return res || [];
  };
  return ChokeGroupAdapter(
    secids.map((s) => () => checkStDealCache(s, date)),
    Math.ceil(secids.length / kDefaultGroupRequestSize),
    100
  );
}

export function getDatesDeal(secid: string, dates: string[]) {
  const checkStDealCache = async (secid: string, date: string) => {
    const key = `${secid}.${date}.deals`;
    const prev = MemoryCache.get(key);
    if (prev && prev.length) {
      return prev;
    }
    const res = await Services.Stock.requestDealDay(secid, date);
    if (res && res.length > 0) {
      MemoryCache.set(key, res, MemoryCache.kDefaultCacheExpireTime);
    }
    return res || [];
  };
  return ChokeGroupAdapter(
    dates.map((d) => () => checkStDealCache(secid, d)),
    Math.ceil(dates.length / kDefaultGroupRequestSize),
    100
  );
}

export async function getAllStocks() {
  const onExit = () => bridgeProgressLog('[info] 执行完毕');
  // 请求所有板块
  bridgeProgressLog('[info] 获取所有板块信息');
  const bks: Stock.BanKuaiItem[] = await getAllBks();
  if (bks.length == 0) {
    bridgeProgressLog('[error] 获取所有板块信息失败');
    onExit();
    return;
  }
  // 请求所有标的
  bridgeProgressLog('[info] 获取板块标的信息');
  const bkSts = await getAllBkSts(bks);
  if (bkSts.length == 0) {
    bridgeProgressLog('[error] 获取所有板块标的列表失败');
    onExit();
    return;
  }
  bridgeProgressLog('[info] 执行 candidates 调用');
  let candidates: string[] = [];
  for (let i = 0; i < bkSts.length; i++) {
    const sts = (bkSts[i]?.stocks || []) as Stock.DetailItem[];
    candidates = candidates.concat(
      sts
        .filter((_) => _.zx < 100)
        .map(({ secid }) => secid)
        .filter((_) => _.indexOf('.688') == -1 && _.indexOf('.2') == -1 && _.indexOf('.9') == -1)
    );
  }
  if (candidates.length == 0) {
    bridgeProgressLog('[error] 没有符合条件的 candidates');
    onExit();
    return;
  }
  const details = candidates
    .map((s) => {
      let st = undefined;
      for (let i = 0; i < bkSts.length; i++) {
        st = bkSts[i]!.stocks.find((_) => _.secid == s);
        if (st) {
          st.hybk = {
            secid: bks[i].secid,
            name: bks[i].name,
          };
          break;
        }
      }
      return st;
    })
    .filter(Utils.NotEmpty);
  bridgeProgressLog('[info] 获取详情数据完成，length = ' + details.length);
  return details;
}

export async function getFilteredStocks(financeThreshold: number) {
  const onExit = () => bridgeProgressLog('[info] 执行完毕');
  // 请求所有板块
  bridgeProgressLog('[info] 获取所有板块信息');
  const bks: Stock.BanKuaiItem[] = await getAllBks();
  if (bks.length == 0) {
    bridgeProgressLog('[error] 获取所有板块信息失败');
    onExit();
    return;
  }
  // 请求所有标的
  bridgeProgressLog('[info] 获取板块标的信息');
  const bkSts = await getAllBkSts(bks);
  if (bkSts.length == 0) {
    bridgeProgressLog('[error] 获取所有板块标的列表失败');
    onExit();
    return;
  }
  bridgeProgressLog('[info] 执行 candidates 调用');
  let candidates: string[] = [];
  for (let i = 0; i < bkSts.length; i++) {
    const sts = (bkSts[i]?.stocks || []) as Stock.DetailItem[];
    candidates = candidates.concat(
      sts
        .filter((_) => _.zx < 100)
        .map(({ secid }) => secid)
        .filter((_) => _.indexOf('.688') == -1 && _.indexOf('.2') == -1 && _.indexOf('.9') == -1)
    );
  }
  if (candidates.length == 0) {
    bridgeProgressLog('[error] 没有符合条件的 candidates');
    onExit();
    return;
  }
  const details = candidates
    .map((s) => {
      let st = undefined;
      for (let i = 0; i < bkSts.length; i++) {
        st = bkSts[i]!.stocks.find((_) => _.secid == s);
        if (st) {
          st.hybk = {
            secid: bks[i].secid,
            name: bks[i].name,
          };
          break;
        }
      }
      return st;
    })
    .filter(Utils.NotEmpty);
  bridgeProgressLog('[info] 获取详情数据完成，length = ' + details.length);
  
  const finances = await getAllStFinances(details.map(({ code }) => code));
  if (finances.length == 0) {
    bridgeProgressLog('[error] 获取 candidates 财务数据失败');
    onExit();
    return;
  }
  bridgeProgressLog('[info] 获取 finances 数据完成，length = ' + finances.length);
  const baseFilterSts: Stock.CLItem[] = [];
  for (let i = 0; i < finances.length; i++) {
    if (finances[i].length == 0) {
      continue;
    }
    const latestFinance = finances[i][0];
    if (latestFinance.YYZSRGDHBZC < financeThreshold) {
      continue;
    }
    baseFilterSts.push({
      ...details[i],
      finance: latestFinance,
    });
  }
  if (baseFilterSts.length == 0) {
    bridgeProgressLog('[error] 没有符合 baseFilter 条件的标的');
    onExit();
    return;
  }
  bridgeProgressLog('[info] baseFilter 执行完成，length = ' + baseFilterSts.length);
  const klines: Stock.KLineItem[][] = await getAllStKlines(baseFilterSts.map(({ secid }) => secid));
  if (klines.length == 0) {
    bridgeProgressLog('[error] 请求标的K线数据失败');
    onExit();
    return;
  }
  bridgeProgressLog('[info] 获取 klines 数据完成，length = ' + klines.length);
  const techFilterSts: Stock.CLItem[] = [];
  for (let i = 0; i < klines.length; i++) {
    if (klines[i].length < 100) {
      continue;
    }
    Tech.DescribeKlines(klines[i]);
    Tech.DetermineKlines(klines[i]);
    const latestK = klines[i].slice(-1)[0];
    if (!latestK.buyorsell?.doBuy) {
      continue;
    }
    baseFilterSts[i].latestK = latestK;
    techFilterSts.push(baseFilterSts[i]);
  }
  bridgeProgressLog('[info] techFilter 执行完成，length = ' + techFilterSts.length);
  return techFilterSts;
}

/** MA 均线回踩回测（Worker 代理） */
export function backtestMABounce(
  klines: Stock.KLineItem[],
  maPeriods: number[],
  trendDays: number[],
  fixedStopLossPct: number,
  trailingStopLossPct: number
) {
  bridgeProgressLog('[info] Worker 开始执行 MA 回踩回测...');
  const result = BacktestEngine.backtestMABounce(klines, maPeriods, trendDays, fixedStopLossPct, trailingStopLossPct);
  bridgeProgressLog(`[info] MA 回踩回测完成，共 ${result.length} 组参数`);
  return result;
}

/** MACD 金叉回测（Worker 代理） */
export function optimizeMACDStrategy(
  klines: Stock.KLineItem[],
  fixedStopLossPct: number,
  trailingStopLossPct: number
) {
  bridgeProgressLog('[info] Worker 开始执行 MACD 回测...');
  const result = BacktestEngine.optimizeMACDStrategy(klines, fixedStopLossPct, trailingStopLossPct);
  bridgeProgressLog(`[info] MACD 回测完成，共 ${result.length} 组参数`);
  return result;
}

/** RSI 超卖反弹回测（Worker 代理） */
export function optimizeRSIStrategy(
  klines: Stock.KLineItem[],
  rsiPeriods: number[],
  fixedStopLossPct: number,
  trailingStopLossPct: number
) {
  bridgeProgressLog('[info] Worker 开始执行 RSI 回测...');
  const result = BacktestEngine.optimizeRSIStrategy(klines, rsiPeriods, fixedStopLossPct, trailingStopLossPct);
  bridgeProgressLog(`[info] RSI 回测完成，共 ${result.length} 组参数`);
  return result;
}

/** 批量策略优化（用于 OptimizedStrategyBacktest，避免阻塞主线程） */
export function batchBacktestOptimize(klinesBatch: Stock.KLineItem[][]) {
  bridgeProgressLog(`[info] Worker 批量策略优化开始，共 ${klinesBatch.length} 只股票`);
  const results = klinesBatch.map((klines, i) => {
    const macdResults = BacktestEngine.optimizeMACDStrategy(klines);
    const rsiResults = BacktestEngine.optimizeRSIStrategy(klines, [6, 12, 24]);
    bridgeProgressLog(`[info] Worker 批量策略优化进度: ${i + 1}/${klinesBatch.length}`);
    return { macdResults, rsiResults };
  });
  bridgeProgressLog(`[info] Worker 批量策略优化完成`);
  return results;
}

// ==================== 多Worker并行任务监听 ====================
// 主进程通过此通道分发计算任务到多个Worker窗口
ipcRenderer.on('execute-worker-task', async (event, payload: { taskId: number; method: string; args: any[] }) => {
  const { taskId, method, args } = payload;
  
  // 方法映射：将主进程传来的方法名映射到本文件导出的函数
  const methodMap: Record<string, (...args: any[]) => any> = {
    batchBacktestOptimize,
    optimizeMACDStrategy,
    optimizeRSIStrategy,
    backtestMABounce,
    calculateIndicators,
    getAllBks,
    getAllBkSts,
    getAllStDetails,
    getAllStFinances,
    getAllStKlines,
    getAllStLHBs,
    getAllStZJCs,
    getDateDeals,
    getDatesDeal,
    getAllStocks,
    getFilteredStocks,
  };
  
  try {
    const fn = methodMap[method];
    if (typeof fn !== 'function') {
      throw new Error(`Worker method "${method}" not found. Available: ${Object.keys(methodMap).join(', ')}`);
    }
    const result = await fn(...(args || []));
    postMessageOut(taskId, null, result);
  } catch (e: any) {
    console.error(`[Worker] Task ${taskId} (${method}) failed:`, e);
    postMessageOut(taskId, { message: e.message + '\n' + e.stack });
  }
});