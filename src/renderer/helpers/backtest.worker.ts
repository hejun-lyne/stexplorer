import {
  backtestMABounce,
  optimizeMACDStrategy,
  optimizeRSIStrategy,
} from './backtestCompute';
import type {
  MABacktestResult,
  MACDStrategyResult,
  RSIBacktestResult,
} from './backtestEngine';

interface BacktestPayload {
  klines: any[];
  fixedStopLossPct: number;
  trailingStopLossPct: number;
}

interface BacktestResponse {
  maResults: MABacktestResult[];
  macdResults: MACDStrategyResult[];
  rsiResults: RSIBacktestResult[];
}

self.addEventListener('message', async (event: MessageEvent<any>) => {
  console.log('[BacktestWorker] received message', event.data);

  if (event.data?.type === 'ping') {
    console.log('[BacktestWorker] received ping, sending pong');
    self.postMessage({ type: 'pong' });
    return;
  }

  const { klines, fixedStopLossPct, trailingStopLossPct } = event.data || {};

  if (!klines || !Array.isArray(klines)) {
    console.error('[BacktestWorker] invalid klines', klines);
    self.postMessage({ success: false, error: 'invalid klines data' });
    return;
  }

  console.log('[BacktestWorker] starting backtest, klines.length=', klines.length);

  try {
    console.log('[BacktestWorker] running MA backtest...');
    const maResults = backtestMABounce(
      klines,
      [5, 10, 20, 40, 60],
      [5, 10, 20],
      fixedStopLossPct,
      trailingStopLossPct
    );
    console.log('[BacktestWorker] MA done, results=', maResults.length);

    console.log('[BacktestWorker] running MACD backtest...');
    const macdResults = await optimizeMACDStrategy(klines, fixedStopLossPct, trailingStopLossPct);
    console.log('[BacktestWorker] MACD done, results=', macdResults.length);

    console.log('[BacktestWorker] running RSI backtest...');
    const rsiResults = await optimizeRSIStrategy(klines, [6, 12, 24], fixedStopLossPct, trailingStopLossPct);
    console.log('[BacktestWorker] RSI done, results=', rsiResults.length);

    const response: BacktestResponse = { maResults, macdResults, rsiResults };
    console.log('[BacktestWorker] posting success response, data keys=', Object.keys(response));
    try {
      // 先尝试 JSON 序列化，如果失败说明数据有问题
      const jsonStr = JSON.stringify(response);
      console.log('[BacktestWorker] JSON stringify ok, length=', jsonStr.length);
      // 发送字符串避免 structured clone 的潜在问题
      self.postMessage({ success: true, json: jsonStr });
      console.log('[BacktestWorker] postMessage success called');
    } catch (postErr: any) {
      console.error('[BacktestWorker] postMessage threw', postErr);
      self.postMessage({ success: false, error: 'postMessage failed: ' + (postErr?.message || String(postErr)) });
    }
  } catch (error: any) {
    console.error('[BacktestWorker] error during backtest', error);
    self.postMessage({ success: false, error: error?.message || String(error) });
  }
});

export {};
