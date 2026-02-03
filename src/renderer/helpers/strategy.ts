import { ConCurrencyAllAdapter } from '@/utils/adapters';
import { BKType, StrategyPhaseType } from '@/utils/enums';
import * as Services from '@/services';
import { MemoryCache } from '@/cache';
import { Stock } from '@/types/stock';
import * as Utils from '@/utils';
import * as Enums from '@/utils/enums';
import * as Helpers from '@/helpers';
import * as Tech from '@/helpers/tech';
import moment from 'moment';
import { PromiseWorker } from './promiseWorker';

const { compileTS, makeWorkerExec } = window.contextModules.electron;

async function createWebWorker(source: string, onConsoleLog: (text: string | string[]) => void) {
  const logFunc = `
  let outterLogFunc = undefined;
  export function bindOutterLogFunc(func: any) {
    outterLogFunc = func;
  }
  export function bridgeConsoleLog(...args: any) {
    if (outterLogFunc) {
      outterLogFunc(...args);
    } else {
      console.log(...args);
    }
  }
  let Indicators = undefined;
  export function bindIndicatorMethods(methods: any) {
    Indicators = methods
  }
  let Trader = undefined;
  export function bindTrader(t: any) {
    Trader = t
  }
  `;
  const processedSource = source.replaceAll('console.log', 'bridgeConsoleLog') + logFunc; // 替换日志输出
  const result = await compileTS(processedSource);
  // 新建一个WebWorker来处理重计算任务
  const webWorker = new PromiseWorker(new Worker(new URL('./web.worker', import.meta.url)));
  webWorker.registerHandler(1, onConsoleLog);
  const res: any = await webWorker.postMessage({ type: 'strategy_init', args: [result.outputText] });
  if (typeof res !== 'string') {
    onConsoleLog(res.message);
    return null;
  }
  return webWorker;
}

export async function runStrategy(
  source: string,
  onPhaseResult: (phase: StrategyPhaseType, result: any[]) => void,
  onConsoleLog: (text: string | string[]) => void,
  onProgressLog: (text: string) => void
) {
  const onExit = () => onPhaseResult(StrategyPhaseType.Finished, []);
  // 新建一个WebWorker来处理重计算任务
  const webWorker = await createWebWorker(source, onConsoleLog);
  if (!webWorker) {
    onExit();
    return;
  }
  // 请求所有板块
  onConsoleLog('[info] 获取所有板块信息');
  const bks: Stock.BanKuaiItem[] = await makeWorkerExec('getAllBks');
  if (bks.length == 0) {
    onConsoleLog('[error] 获取所有板块信息失败');
    onExit();
    return;
  }
  // 请求所有标的
  onConsoleLog('[info] 获取板块标的信息');
  const bkSts = await makeWorkerExec('getAllBkSts', [bks]);
  if (bkSts.length == 0) {
    onConsoleLog('[error] 获取所有板块标的列表失败');
    onExit();
    return;
  }
  onConsoleLog('[info] 执行 candidates 调用');
  let candidates: string[];
  try {
    candidates = (await webWorker.postMessage({ type: 'strategy_method', args: ['candidates', bkSts] })) as string[];
  } catch (error: any) {
    onConsoleLog('[error] 执行 candidates 调用异常: ' + error.message);
    onExit();
    return;
  }
  onPhaseResult(StrategyPhaseType.Candidates, candidates);
  if (candidates.length == 0) {
    onConsoleLog('[error] 没有符合条件的 candidates');
    onExit();
    return;
  }
  const details = candidates
    .map((s) => {
      let st = undefined;
      for (let i = 0; i < bkSts.length; i++) {
        st = bkSts[i].stocks.find((_) => _.secid == s);
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
  onConsoleLog('[info] 获取详情数据完成，length = ' + details.length);
  onConsoleLog('[info] 准备 finances 数据');
  const finances = await makeWorkerExec('getAllStFinances', [details.map(({ code }) => code)]);
  if (finances.length == 0) {
    onConsoleLog('[error] 获取 candidates 财务数据失败');
    onExit();
    return;
  }
  onConsoleLog('[info] 获取 finances 数据完成，length = ' + finances.length);

  const partSize = 20;
  onConsoleLog('[info] 执行 baseFilter 调用');
  let baseFilterSts: any[];
  try {
    baseFilterSts = [];
    for (let i = 0; i < details.length;) {
      const stsParts = i + partSize < details.length - 1 ? details.slice(i, i + partSize) : details.slice(i);
      const financesParts = finances.slice(i, i + stsParts.length);
      const passed = (await webWorker.postMessage({ type: 'strategy_method', args: ['baseFilter', stsParts, financesParts] })) as any[];
      if (passed) {
        baseFilterSts.push(...passed);
      }
      i += partSize;
      onProgressLog(`[info] 执行 baseFilter 进度: ${i > details.length ? details.length : i}/${details.length}`);
    }
  } catch (error: any) {
    onConsoleLog('[error] 执行 baseFilter 调用异常: ' + error.message);
    onExit();
    return;
  }
  onPhaseResult(
    StrategyPhaseType.BaseFilter,
    baseFilterSts.map(({ secid }) => secid)
  );
  if (baseFilterSts.length == 0) {
    onConsoleLog('[error] 没有符合 baseFilter 条件的标的');
    onExit();
    return;
  }
  onConsoleLog('[info] baseFilter 执行完成，length = ' + baseFilterSts.length);

  onConsoleLog('[info] 准备标的K线数据');
  const klines: Stock.KLineItem[][] = await makeWorkerExec('getAllStKlines', [baseFilterSts.map(({ secid }) => secid)]);
  if (klines.length == 0) {
    onConsoleLog('[error] 请求标的K线数据失败');
    onExit();
    return;
  }
  const klinesMap: Record<string, Stock.KLineItem[]> = {};
  klines.forEach((ks, i) => {
    Helpers.Tech.DescribeKlines(ks);
    klinesMap[baseFilterSts[i].secid] = ks;
  });
  onConsoleLog('[info] 获取 klines 数据完成，length = ' + klines.length);
  onConsoleLog('[info] 执行 techFilter 调用');
  let techFilterSts: any[];
  try {
    techFilterSts = [];
    for (let i = 0; i < baseFilterSts.length;) {
      const stsParts = i + partSize < baseFilterSts.length - 1 ? baseFilterSts.slice(i, i + partSize) : baseFilterSts.slice(i);
      const klinesParts = klines.slice(i, i + stsParts.length);
      const passed = (await webWorker.postMessage({ type: 'strategy_method', args: ['techFilter', stsParts, klinesParts] })) as any[];
      if (passed) {
        techFilterSts.push(...passed);
      }
      i += partSize;
      onProgressLog(`[info] 执行 techFilter 进度: ${i > baseFilterSts.length ? baseFilterSts.length : i}/${baseFilterSts.length}`);
    }
  } catch (error: any) {
    onConsoleLog('[error] 执行 techFilter 调用异常: ' + error.message);
    onExit();
    return;
  }
  onPhaseResult(
    StrategyPhaseType.TechFilter,
    techFilterSts.map(({ secid }) => secid)
  );
  if (techFilterSts.length == 0) {
    onConsoleLog('[error] 没有符合 techFilter 条件的标的');
    onExit();
    return;
  }
  onConsoleLog('[info] techFilter 执行完成，length = ' + techFilterSts.length);

  onConsoleLog('[info] 准备标的龙虎榜数据');
  const lhbs = await makeWorkerExec('getAllStLHBs', [techFilterSts.map(({ code }) => code)]);
  if (lhbs.length == 0) {
    onConsoleLog('[error] 请求标的龙虎榜数据失败');
    onExit();
    return;
  }
  onConsoleLog('[info] 获取 龙虎榜 数据完成，length = ' + lhbs.length);

  onConsoleLog('[info] 准备标的高管增减持数据');
  const zjcs = await makeWorkerExec('getAllStZJCs', [techFilterSts.map(({ code }) => code)]);
  if (lhbs.length == 0) {
    onConsoleLog('[error] 请求标的增减持数据失败');
    onExit();
    return;
  }
  onConsoleLog('[info] 获取 高管增减持 数据完成，length = ' + zjcs.length);

  onConsoleLog('[info] 执行 fundFilter 调用');
  let fundFilterSts: any[];
  try {
    fundFilterSts = [];
    for (let i = 0; i < techFilterSts.length;) {
      const stsParts = i + partSize < techFilterSts.length - 1 ? techFilterSts.slice(i, i + partSize) : techFilterSts.slice(i);
      const klinesParts = stsParts.map(({ secid }) => klinesMap[secid]);
      const lhbsParts = lhbs.slice(i, i + stsParts.length);
      const zjcsParts = zjcs.slice(i, i + stsParts.length);
      const passed = (await webWorker.postMessage({
        type: 'strategy_method',
        args: ['fundFilter', stsParts, klinesParts, lhbsParts, zjcsParts],
      })) as any[];
      if (passed) {
        fundFilterSts.push(...passed);
      }
      i += partSize;
      onProgressLog(`[info] 执行 fundFilter 进度: ${i > techFilterSts.length ? techFilterSts.length : i}/${techFilterSts.length}`);
    }
  } catch (error: any) {
    onConsoleLog('[error] 执行 fundFilter 调用异常: ' + error.message);
    onExit();
    return;
  }
  onPhaseResult(
    StrategyPhaseType.FundFilter,
    fundFilterSts.map(({ secid }) => secid)
  );
  if (fundFilterSts.length == 0) {
    onConsoleLog('[error] 没有符合 fundFilter 条件的标的');
    onExit();
    return;
  }
  onConsoleLog('[info] fundFilter 执行完成，length = ' + fundFilterSts.length);

  onConsoleLog('[info] 准备板块数据');
  const filterBkSecids = Array.from(new Set(fundFilterSts.map(({ hybk }) => hybk.secid)));
  if (filterBkSecids.length == 0) {
    onConsoleLog('[error] 没有找到 fundFilterSts 对应的板块数据');
    onExit();
    return;
  }
  const bkKlines: Stock.KLineItem[][] = await makeWorkerExec('getAllStKlines', [filterBkSecids]);
  if (klines.length == 0) {
    onConsoleLog('[error] 请求板块K线数据失败');
    onExit();
    return;
  }
  const bkKlinesMap: Record<string, Stock.KLineItem[]> = {};
  bkKlines.forEach((ks, i) => (bkKlinesMap[filterBkSecids[i]] = ks));
  onConsoleLog('[info] 获取板块 klines 数据完成，length = ' + bkKlines.length);

  onConsoleLog('[info] 执行 bkFilter 调用');
  let bkFilterSts: any[];
  try {
    bkFilterSts = [];
    for (let i = 0; i < fundFilterSts.length;) {
      const stsParts = i + partSize < fundFilterSts.length - 1 ? fundFilterSts.slice(i, i + partSize) : fundFilterSts.slice(i);
      const klinesParts = stsParts.map(({ secid }) => klinesMap[secid]);
      const bkKlinesParts = stsParts.map(({ hybk }) => bkKlinesMap[hybk.secid]);
      const passed = (await webWorker.postMessage({
        type: 'strategy_method',
        args: ['bkFilter', stsParts, klinesParts, bkKlinesParts],
      })) as any[];
      if (passed) {
        bkFilterSts.push(...passed);
      }
      i += partSize;
      onProgressLog(`[info] 执行 bkFilter 进度: ${i > fundFilterSts.length ? fundFilterSts.length : i}/${fundFilterSts.length}`);
    }
  } catch (error: any) {
    onConsoleLog('[error] 执行 bkFilter 调用异常: ' + error.message);
    onExit();
    return;
  }
  onPhaseResult(
    StrategyPhaseType.BKFilter,
    bkFilterSts.map(({ secid }) => secid)
  );
  if (bkFilterSts.length == 0) {
    onConsoleLog('[error] 没有符合 bkFilter 条件的标的');
    onExit();
    return;
  }
  // 结束信号
  onExit();
}

export async function runBackTest(
  source: string,
  onPhaseResult: (phase: StrategyPhaseType, result: Strategy.BackTestResult | null) => void,
  onConsoleLog: (text: string | string[]) => void,
  onProgressLog: (text: string) => void,
  onDeal: (deal: Strategy.BackTestTrading) => void,
  onTradeDate: (result: Strategy.BackTestResult) => void
) {
  const onExit = () => onPhaseResult(StrategyPhaseType.Finished, null);
  // 新建一个WebWorker来处理重计算任务
  const webWorker = await createWebWorker(source, onConsoleLog);
  if (!webWorker) {
    onExit();
    return;
  }
  webWorker.registerHandler(2, onDeal);
  onProgressLog('[info] 获取回测时间周期');
  const period = (await webWorker.postMessage({ type: 'strategy_method', args: ['period'] })) as string[];
  if (period.length != 2) {
    onConsoleLog('[error] 返回回测周期错误' + period.join(','));
    onExit();
    return;
  }
  const startDate = new Date(period[0]);
  const nowDate = new Date();
  const diffTime = Math.abs(nowDate.getTime() - startDate.getTime());
  const oneDay = 1000 * 60 * 60 * 24;
  if (diffTime <= oneDay) {
    onConsoleLog('[info] startDate is too close to todate');
    return;
  }
  onProgressLog('[info] 获取对照指数');
  const index = (await webWorker.postMessage({ type: 'strategy_method', args: ['index'] })) as string;
  if (!index) {
    onConsoleLog('[error] 获取对照指数出错');
    onExit();
    return;
  }
  onProgressLog('[info] 获取初始金额');
  const initialAmount = (await webWorker.postMessage({ type: 'strategy_method', args: ['initialAmount'] })) as number;
  if (isNaN(initialAmount) || initialAmount < 10000) {
    onConsoleLog('[error] 获取初始金额出错');
    onExit();
    return;
  }
  onProgressLog('[info] 获取交易费率');
  const commission = (await webWorker.postMessage({ type: 'strategy_method', args: ['commission'] })) as number;
  if (isNaN(commission)) {
    onConsoleLog('[error] 获取交易费率出错');
    onExit();
    return;
  }
  onProgressLog('[info] 获取交易频率');
  const tradeFrequency = (await webWorker.postMessage({ type: 'strategy_method', args: ['tradeFrequency'] })) as number;
  if (isNaN(tradeFrequency)) {
    onConsoleLog('[error] 获取交易频率出错');
    onExit();
    return;
  }
  onProgressLog('[info] 获取最大持仓数');
  const maxHold = (await webWorker.postMessage({ type: 'strategy_method', args: ['maxHold'] })) as number;
  if (isNaN(maxHold)) {
    onConsoleLog('[error] 获取最大持仓数出错');
    onExit();
    return;
  }

  // 初始化trader
  await webWorker.postMessage({ type: 'strategy_method', args: ['initTrader', initialAmount, commission] });

  onProgressLog('[info] 准备回测数据');
  onConsoleLog('[info] 获取所有板块信息');
  const bks: Stock.BanKuaiItem[] = await makeWorkerExec('getAllBks');
  if (bks.length == 0) {
    onConsoleLog('[error] 获取所有板块信息失败');
    onExit();
    return;
  }
  // 请求所有标的
  onConsoleLog('[info] 获取板块标的信息');
  const bkSts = await makeWorkerExec('getAllBkSts', [bks]);
  if (bkSts.length == 0) {
    onConsoleLog('[error] 获取所有板块标的列表失败');
    onExit();
    return;
  }
  onConsoleLog('[info] 执行 candidates 调用');
  let candidates: string[];
  try {
    candidates = (await webWorker.postMessage({ type: 'strategy_method', args: ['candidates', bkSts] })) as string[];
  } catch (error: any) {
    onConsoleLog('[error] 执行 candidates 调用异常: ' + error.message);
    onExit();
    return;
  }
  if (candidates.length == 0) {
    onConsoleLog('[error] 没有符合条件的 candidates');
    onExit();
    return;
  }
  const details: Stock.DetailItem[] = candidates
    .map((s) => {
      let st = undefined;
      for (let i = 0; i < bkSts.length; i++) {
        st = bkSts[i].stocks.find((_) => _.secid == s);
        if (st) {
          st.hybk = {
            code: bks[i].secid,
            name: bks[i].name,
          };
          break;
        }
      }
      return st;
    })
    .filter(Utils.NotEmpty);
  onConsoleLog('[info] 获取详情数据完成，length = ' + details.length);
  onConsoleLog('[info] 准备 finances 数据');
  const finances = await makeWorkerExec('getAllStFinances', [details.map(({ code }) => code)]);
  if (finances.length == 0) {
    onConsoleLog('[error] 获取 candidates 财务数据失败');
    onExit();
    return;
  }
  onConsoleLog('[info] 获取 finances 数据完成，length = ' + finances.length);

  const partSize = 100;
  onConsoleLog('[info] 执行 baseFilter 调用');
  let baseFilterSts: any[];
  try {
    baseFilterSts = [];
    for (let i = 0; i < details.length;) {
      const stsParts = i + partSize < details.length - 1 ? details.slice(i, i + partSize) : details.slice(i);
      const financesParts = finances.slice(i, i + stsParts.length);
      const passed = (await webWorker.postMessage({ type: 'strategy_method', args: ['baseFilter', stsParts, financesParts] })) as any[];
      if (passed) {
        baseFilterSts.push(...passed);
      }
      i += partSize;
      onProgressLog(`[info] 执行 baseFilter 进度: ${i > details.length ? details.length : i}/${details.length}`);
    }
  } catch (error: any) {
    onConsoleLog('[error] 执行 baseFilter 调用异常: ' + error.message);
    onExit();
    return;
  }
  if (baseFilterSts.length == 0) {
    onConsoleLog('[error] 没有符合 baseFilter 条件的标的');
    onExit();
    return;
  }
  onConsoleLog('[info] baseFilter 执行完成，length = ' + baseFilterSts.length);

  // 详情，k线
  const days = Math.ceil(diffTime / oneDay);
  const klines: Stock.KLineItem[][] = await makeWorkerExec('getAllStKlines', [
    baseFilterSts.map(({ secid }) => secid).concat([index]),
    days + 100,
  ]);
  if (klines.length == 0) {
    onConsoleLog('[error] 请求标的K线数据失败');
    onExit();
    return;
  }

  onConsoleLog('[info] 准备 板块 kline 数据');
  const bksecids = baseFilterSts.map((_) => _.hybk.code);
  const bkKlines: Stock.KLineItem[][] = await makeWorkerExec('getAllStKlines', [bksecids, days + 100]);
  if (bkKlines.length == 0) {
    onConsoleLog('[error] 请求板块K线数据失败');
    onExit();
    return;
  }
  const bkKlinesMappings: Record<string, Stock.KLineItem[]> = {};
  bksecids.forEach((s, i) => (bkKlinesMappings[s] = bkKlines[i]));

  const indexKlines = klines[klines.length - 1];
  const ndays = 10;
  const datesParts = [];
  for (let i = 0; i < indexKlines.length; i++) {
    if (indexKlines[i].date >= period[0] && indexKlines[i].date <= period[1]) {
      let dates: string[];
      if (i + ndays > indexKlines.length) {
        dates = indexKlines.slice(i).map(({ date }) => date);
      } else {
        dates = indexKlines.slice(i, i + ndays).map(({ date }) => date);
      }
      if (dates.length > 0) {
        datesParts.push(dates);
      }
      i += ndays - 1;
    }
  }
  for (let i = 0; i < datesParts.length; i++) {
    const dates = datesParts[i];
    for (let j = 0; j < dates.length; j++) {
      const date = dates[j];
      // 更新数据
      await webWorker.postMessage({
        type: 'strategy_method',
        args: ['onTradeDay', date],
      });
      // 判断哪些标的符合买入条件
      let buyFilterSts: Stock.DetailItem[];
      try {
        buyFilterSts = [];
        for (let i = 0; i < baseFilterSts.length;) {
          const stsParts = i + partSize < baseFilterSts.length - 1 ? baseFilterSts.slice(i, i + partSize) : baseFilterSts.slice(i);
          const klinesParts = klines.slice(i, i + stsParts.length);
          const financeParts = finances.slice(i, i + stsParts.length);
          klinesParts.forEach((ks) => Helpers.Tech.DescribeKlines(ks));
          const prevKlinesParts = klinesParts.map((ks) => {
            let kIndex = -1;
            for (let n = 0; n < ks.length; n++) {
              if (ks[n].date == date) {
                kIndex = n;
                break;
              }
            }
            if (kIndex == -1) {
              return [];
            }
            return ks.slice(0, kIndex);
          });
          const prevFinanceParts = financeParts.map((reports) => {
            let rIndex = -1;
            for (let n = 0; n < reports.length; n++) {
              if (reports[n].NOTICE_DATE.substring(0, 10) <= date) {
                rIndex = n;
                break;
              }
            }
            if (rIndex == -1) {
              return [];
            }
            return reports.slice(0, rIndex);
          });
          const passed = (await webWorker.postMessage({
            type: 'strategy_method',
            args: ['buyFilter', stsParts, prevKlinesParts, prevFinanceParts],
          })) as any[];
          if (passed) {
            buyFilterSts.push(...passed);
          }
          i += partSize;
          onProgressLog(`[info] 执行 buyFilter 进度: ${i > baseFilterSts.length ? baseFilterSts.length : i}/${baseFilterSts.length}`);
        }
      } catch (error: any) {
        onConsoleLog('[error] 执行 buyFilter 调用异常: ' + error.message);
        onExit();
        return;
      }
      const weights = (await webWorker.postMessage({ type: 'strategy_method', args: ['buySort', buyFilterSts, klines] })) as number[];
      const mappings: Record<string, number> = {};
      buyFilterSts.forEach((a, i) => (mappings[a.secid] = weights[i]));
      buyFilterSts.sort((a, b) => mappings[a.secid] - mappings[b.secid]);

      // 需要合并当前的持有
      const traderContext = (await webWorker.postMessage({ type: 'strategy_method', args: ['onFinishDay'] })) as Strategy.BackTestResult;
      const holds = traderContext.shares || [];
      const secids = Array.from(new Set(holds.map(({ secid }) => secid).concat(buyFilterSts.map(({ secid }) => secid))));
      onProgressLog(`[info] 获取趋势数据: ${date}, ${secids.length}`);
      const dateDeals = (await makeWorkerExec('getDateDeals', [date, secids])) as Stock.TrendItem[][];
      // 获取板块数据
      const bksecids: string[] = [];
      secids.forEach((s) => {
        const d = details.find((_) => _.secid == s);
        if (d?.hybk) {
          bksecids.push(d.hybk.code);
        }
      });
      const data: Record<string, any> = {};
      secids.forEach((s, i) => {
        const detail = details.find((d) => d.secid == s);
        const ks = klines.find((k) => k && k.length > 0 && k[0].secid == s);
        const ts = dateDeals[i];
        const holded = holds.find((h) => h.secid == s) != undefined;
        const buyed = buyFilterSts.find((d) => d.secid == s) != undefined;
        data[s] = {
          detail,
          ks,
          ts,
          holded,
          buyed,
        };
        const d = details.find((_) => _.secid == s);
        if (d?.hybk && bkKlinesMappings[d.hybk.code]) {
          data[s].bkks = bkKlinesMappings[d.hybk.code];
        }
      });
      // 根据交易频率进行分片
      const startTime2 = moment(date + ' 13:00:00');
      const endTime1 = moment(date + ' 11:30:00');
      const endTime2 = moment(date + ' 15:00:00');
      let currentTime = moment(date + ' 09:25:00');
      while (!currentTime.isAfter(endTime2)) {
        if (currentTime.isAfter(endTime1) && currentTime.isBefore(startTime2)) {
          // 跳过午间休盘
          currentTime = moment(date + ' 13:00:00');
          continue;
        }
        currentTime = currentTime.add(tradeFrequency, 'minutes');
        for (const k in data) {
          const stock = data[k].detail;
          const trends = data[k].ts;
          const bkKlines = data[k].bkks;
          const stKlines = data[k].ks;

          if (!trends || trends.length == 0) {
            continue;
          }
          if (!stKlines || stKlines.length == 0) {
            continue;
          }
          function generatePrevKlines(aks: Stock.KLineItem[], d: string) {
            let kIndex = -1;
            for (let n = 0; n < aks.length; n++) {
              if (aks[n].date == d) {
                kIndex = n;
                break;
              }
            }
            if (kIndex == -1) {
              return null;
            }
            return aks.slice(0, kIndex);
          }

          const prevKlines = generatePrevKlines(stKlines, date);
          if (!prevKlines) {
            continue;
          }
          const prevBKKlines = generatePrevKlines(bkKlines, date);
          function generatedayK(ct: moment.Moment, ts: Stock.TrendItem[]) {
            const dk = {
              secid: stock.secid,
              date: ct.format('YYYY-MM-DD HH:mm:ss'),
              type: Enums.KLineType.Day,
              kp: ts[0].current,
              sp: ts[0].current,
              zg: ts[0].current,
              zd: ts[0].current,
              zs: prevKlines![prevKlines!.length - 1].sp,
            } as unknown as Stock.KLineItem;
            let totalVol = 0;
            let totalAmount = 0;
            for (let n = 0; n < ts.length; n++) {
              const t = ts[n];
              if (!moment(date + ' ' + t.datetime).isAfter(ct)) {
                dk.sp = t.current;
                if (dk.zg < t.current) {
                  dk.zg = t.current;
                }
                if (dk.zd > t.current) {
                  dk.zd = t.current;
                }
                totalVol += t.vol;
                totalAmount += t.vol * t.average;
              }
            }
            dk.cjl = totalVol;
            dk.cje = totalAmount;
            dk.hsl = totalVol / stock.ltg;
            return dk;
          }
          const dayK = generatedayK(currentTime, trends);
          // 更新数据
          await webWorker.postMessage({
            type: 'strategy_method',
            args: ['onTradeDay', date, stock, dayK],
          });
          // 确定是否满足买入条件
          if (data[k].buyed) {
            const b = await webWorker.postMessage({
              type: 'strategy_method',
              args: [
                'doBuy',
                currentTime.format('YYYY-MM-DD HH:mm:ss'),
                stock,
                prevKlines,
                dayK,
                prevBKKlines,
                prevBKKlines ? bkKlines[prevBKKlines.length] : null,
              ],
            });
          }
          // 检查是否满足卖出条件
          if (data[k].holded) {
            const shares = traderContext.shares.find(({ secid }) => secid == stock.secid);
            if (shares) {
              if (shares.lastDate.substring(0, 10) != date) {
                // 不能同一天买卖
                await webWorker.postMessage({
                  type: 'strategy_method',
                  args: ['doSell', currentTime.format('YYYY-MM-DD HH:mm:ss'), stock, prevKlines, dayK],
                });
              }
            }
          }
        }
      }
      const r = (await webWorker.postMessage({
        type: 'strategy_method',
        args: ['onFinishDay'],
      })) as Strategy.BackTestResult;
      const indexK = indexKlines.find((k) => k.date == r.date.substring(0, 10));
      if (indexK) {
        r.indexVal = indexK.sp;
      }
      onTradeDate(r);
    }
  }
  onExit();
}

export async function runMatching(
  templateSecid: string,
  templateStartDate: string,
  templateEndDate: string,
  onProgressLog: (text: string) => void
) {
  const templateKlines = (await Services.Stock.GetKFromEastmoney(templateSecid, Enums.KLineType.Day, 350)).ks;
  let startIndex = -1;
  let endIndex = -1;
  for (let i = templateKlines.length - 1; i >= 0; i--) {
    if (templateKlines[i].date == templateEndDate) {
      endIndex = i;
    } else if (templateKlines[i].date == templateStartDate) {
      startIndex = i;
    }
  }
  if (startIndex == -1) {
    onProgressLog('[error] startIndex == -1');
    return;
  }
  if (endIndex == -1) {
    onProgressLog('[error] endIndex == -1');
    return;
  }
  const template = templateKlines.slice(startIndex, endIndex + 1);
  onProgressLog('[info] 获取所有板块信息');
  const bks: Stock.BanKuaiItem[] = await makeWorkerExec('getAllBks');
  if (bks.length == 0) {
    onProgressLog('[error] 获取所有板块信息失败');
    return;
  }
  // 请求所有标的
  onProgressLog('[info] 获取板块标的信息');
  const bkSts = await makeWorkerExec('getAllBkSts', [bks]);
  if (bkSts.length == 0) {
    onProgressLog('[error] 获取所有板块标的列表失败');
    return;
  }
  let candidates: Stock.DetailItem[] = [];
  for (let i = 0; i < bkSts.length; i++) {
    if (!bkSts[i].stocks) {
      continue;
    }
    candidates = candidates.concat(
      bkSts[i].stocks.filter(
        (_: Stock.DetailItem) =>
          _.code.indexOf('.688') == -1 && _.code.indexOf('.2') == -1 && _.name.indexOf('ST') == -1 && _.zx < 100 && _.lt < 10000000000
      )
    );
  }
  const partSize = 10;
  const allResults: Stock.MatchItem[] = [];
  for (let i = 0; i < candidates.length; i += partSize) {
    const klines: Stock.KLineItem[][] = await makeWorkerExec('getAllStKlines', [
      candidates.slice(i, partSize).map(({ secid }) => secid),
      250,
    ]);
    for (let j = 0; j < klines.length; j++) {
      onProgressLog('[info] Matching ' + candidates[i + j].name);
      allResults.push({ ...candidates[i + j], match: Helpers.Tech.MatchKlines(template, klines[j]) });
    }
  }
  allResults.sort((a, b) => a.match.diff - b.match.diff);
  return allResults;
}
