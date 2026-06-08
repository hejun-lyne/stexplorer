import {
  backtestMABounce,
  optimizeMACDStrategy,
  optimizeRSIStrategy,
  batchBacktestAndScreen,
} from './backtestCompute';
import type {
  MABacktestResult,
  MACDStrategyResult,
  RSIBacktestResult,
} from './backtestEngine';

// ===== 兼容 Node.js worker_threads 和浏览器 Web Worker =====
let isNodeWorker = false;
let messagePort: any;

try {
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { parentPort } = require('worker_threads');
    if (parentPort) {
      isNodeWorker = true;
      messagePort = parentPort;
    }
  }
} catch (e) {
  // 浏览器环境
}

if (!isNodeWorker) {
  messagePort = self;
}

// [优化] 精简结果：去掉 trades 数组，减少 IPC 序列化和传输开销
function liteMA(r: MABacktestResult): MABacktestResult {
  const { trades, ...rest } = r as any;
  return rest;
}
function liteMACD(r: MACDStrategyResult): MACDStrategyResult {
  const { trades, ...rest } = r as any;
  return rest;
}
function liteRSI(r: RSIBacktestResult): RSIBacktestResult {
  const { trades, ...rest } = r as any;
  return rest;
}

async function handleSingleBacktest(data: any) {
  const { klines, fixedStopLossPct, trailingStopLossPct } = data;
  if (!klines || !Array.isArray(klines)) {
    throw new Error('invalid klines data');
  }

  const maResults = backtestMABounce(
    klines,
    [5, 10, 20, 40, 60],
    [5, 10, 20],
    fixedStopLossPct,
    trailingStopLossPct
  );
  const macdResults = await optimizeMACDStrategy(klines, fixedStopLossPct, trailingStopLossPct);
  const rsiResults = await optimizeRSIStrategy(klines, [6, 12], fixedStopLossPct, trailingStopLossPct);

  return {
    maResults: maResults.map(liteMA),
    macdResults: macdResults.map(liteMACD),
    rsiResults: rsiResults.map(liteRSI),
  };
}

messagePort.on('message', async (payload: any) => {
  const data = payload.data || payload;
  const { taskId, method, args, type, klines, fixedStopLossPct, trailingStopLossPct } = data;

  if (type === 'ping') {
    messagePort.postMessage(isNodeWorker ? { taskId, result: { type: 'pong' } } : { type: 'pong' });
    return;
  }

  // [优化] 处理 NodeWorkerPool 协议 (method + args)
  if (method === 'batchBacktestOptimize') {
    const [klinesList] = args || [];
    try {
      const results: Array<{ macdResults: MACDStrategyResult[]; rsiResults: RSIBacktestResult[] }> = [];
      for (const klinesItem of klinesList) {
        const single = await handleSingleBacktest({ klines: klinesItem, fixedStopLossPct: 0.05, trailingStopLossPct: 0.06 });
        results.push({
          macdResults: single.macdResults,
          rsiResults: single.rsiResults,
        });
      }
      messagePort.postMessage({ taskId, result: results });
    } catch (error: any) {
      messagePort.postMessage({ taskId, error: { message: error?.message || String(error) } });
    }
    return;
  }

  if (method === 'batchBacktestAndScreen') {
    const [items, backtestParams, screenParams] = args || [];
    const t0 = performance.now();
    try {
      const result = batchBacktestAndScreen(items, backtestParams, screenParams);
      const t1 = performance.now();
      console.log(`[PerfWorker] batchBacktestAndScreen: ${items.length}只, ${(t1-t0).toFixed(1)}ms, 单只${((t1-t0)/items.length).toFixed(1)}ms`);
      messagePort.postMessage({ taskId, result });
    } catch (error: any) {
      messagePort.postMessage({ taskId, error: { message: error?.message || String(error) } });
    }
    return;
  }

  // 处理旧版直接调用（兼容 Web Worker / legacy PromiseWorker）
  if (klines && Array.isArray(klines)) {
    try {
      const result = await handleSingleBacktest(data);
      const jsonStr = JSON.stringify(result);
      messagePort.postMessage(
        isNodeWorker
          ? { taskId, result: { success: true, json: jsonStr } }
          : { success: true, json: jsonStr }
      );
    } catch (error: any) {
      messagePort.postMessage(
        isNodeWorker
          ? { taskId, error: { message: error?.message || String(error) } }
          : { success: false, error: error?.message || String(error) }
      );
    }
    return;
  }

  messagePort.postMessage(
    isNodeWorker
      ? { taskId, error: { message: 'Unknown message format' } }
      : { success: false, error: 'Unknown message format' }
  );
});

export {};