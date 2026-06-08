import { parentPort } from 'worker_threads';

// 捕获模块加载阶段的任何错误，避免 worker 静默崩溃
let BacktestCompute: any;
try {
  BacktestCompute = require('../renderer/helpers/backtestCompute');
  console.log('[Worker] backtestCompute 模块加载成功');
} catch (e: any) {
  console.error('[Worker] backtestCompute 模块加载失败:', e.message, e.stack);
  parentPort?.postMessage({
    taskId: 0,
    error: { message: `Worker init failed: ${e.message}` },
  });
  throw e;
}

interface WorkerTask {
  taskId: number;
  method: string;
  args: any[];
}

const methodMap: Record<string, (...args: any[]) => any> = {
  batchBacktestOptimize: (klinesBatch: any[][]) => {
    console.log(`[Worker] batchBacktestOptimize 开始，共 ${klinesBatch.length} 只股票`);
    const results = klinesBatch.map((klines, i) => {
      const macdResults = BacktestCompute.optimizeMACDStrategy(klines);
      const rsiResults = BacktestCompute.optimizeRSIStrategy(klines, [12, 24]);
      if ((i + 1) % 5 === 0 || i === klinesBatch.length - 1) {
        console.log(`[Worker] batchBacktestOptimize 进度: ${i + 1}/${klinesBatch.length}`);
      }
      return { macdResults, rsiResults };
    });
    console.log(`[Worker] batchBacktestOptimize 完成`);
    return results;
  },
  optimizeMACDStrategy: BacktestCompute.optimizeMACDStrategy,
  optimizeRSIStrategy: BacktestCompute.optimizeRSIStrategy,
  backtestMABounce: BacktestCompute.backtestMABounce,
  batchBacktestAndScreen: BacktestCompute.batchBacktestAndScreen,
};

console.log('[Worker] 方法映射就绪，等待任务...');

parentPort?.on('message', async (task: WorkerTask) => {
  const { taskId, method, args } = task;
  console.log(`[Worker] 收到任务 taskId=${taskId}, method=${method}`);
  try {
    const fn = methodMap[method];
    if (!fn) {
      throw new Error(
        `Worker method "${method}" not found. Available: ${Object.keys(methodMap).join(', ')}`
      );
    }
    const result = await fn(...(args || []));
    console.log(`[Worker] 任务 taskId=${taskId} 执行成功`);
    parentPort?.postMessage({ taskId, result });
  } catch (error: any) {
    console.error(`[Worker] 任务 taskId=${taskId} 执行失败:`, error.message);
    parentPort?.postMessage({
      taskId,
      error: { message: error.message, stack: error.stack },
    });
  }
});
