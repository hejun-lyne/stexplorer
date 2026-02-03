import * as Tech from './tech';
import { Trader } from './trader';

function postOutgoingMessage(messageId, error, result) {
  function postMessage(msg) {
    self.postMessage(msg);
  }
  if (error) {
    /* istanbul ignore else */
    if (typeof console !== 'undefined' && 'error' in console) {
      // This is to make errors easier to debug. I think it's important
      // enough to just leave here without giving the user an option
      // to silence it.
      console.error('Worker caught an error:', error);
    }
    postMessage([
      messageId,
      {
        message: error.message,
      },
    ]);
  } else {
    postMessage([messageId, null, result]);
  }
}

function tryCatchFunc(callback, message) {
  try {
    return { res: callback(message) };
  } catch (e) {
    return { err: e };
  }
}

function isPromise(obj) {
  // via https://unpkg.com/is-promise@2.1.0/index.js
  return !!obj && (typeof obj === 'object' || typeof obj === 'function') && typeof obj.then === 'function';
}

function handleIncomingMessage(callback, messageId, message) {
  const result = tryCatchFunc(callback, message);

  if (result.err) {
    postOutgoingMessage(messageId, result.err);
  } else if (!isPromise(result.res)) {
    postOutgoingMessage(messageId, null, result.res);
  } else {
    result.res.then(
      function (finalResult) {
        postOutgoingMessage(messageId, null, finalResult);
        return finalResult;
      },
      function (finalError) {
        postOutgoingMessage(messageId, finalError);
      }
    );
  }
}

function registerPromiseWorker(callback) {
  function onIncomingMessage(e) {
    if (!Array.isArray(e.data) || e.data.length !== 2) {
      // message doens't match communication format; ignore
      return;
    }
    const [messageId, message] = e.data;
    if (typeof callback !== 'function') {
      postOutgoingMessage(messageId, new Error('Please pass a function into register().'));
    } else {
      handleIncomingMessage(callback, messageId, message);
    }
  }
  self.addEventListener('message', onIncomingMessage);
}

function evalCommonjsModule(moduleSource, requireMap) {
  const moduleFunc = eval('(module, exports, require) => {' + moduleSource + '}');
  const module = { exports: {} };
  moduleFunc(module, module.exports, (requireName) => {
    const requireModule = requireMap.get(requireName);
    if (requireModule === undefined) throw new Error(`Attempted to require(${requireName}), which was not in requireMap`);
    return requireModule;
  });
  return module.exports;
}

// 避免频繁请求，需要进行batch
let prevlLogTimestamp = 0;
const batchLogs = [];
function bridgeConsoleLog(...args) {
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
  const now = new Date().getTime();
  if (true /*now - prevlLogTimestamp > 500*/) {
    postOutgoingMessage(1, null, batchLogs);
    batchLogs.length = 0;
    prevlLogTimestamp = now;
  }
}

const indicatorMethods = {
  macd: (ks, slowPeriods = 26, fastPeriods = 12, signalPeriods = 9) => {
    return Tech.calculateMACD(ks, slowPeriods, fastPeriods, signalPeriods);
  },
  ma: (ks, days = 5) => {
    return Tech.calculateMA(
      ks.map((_) => _.sp || _),
      days
    );
  },
  jax: (ks, days = 10) => {
    const vals = Tech.calculateJAX(ks, days);
    return {
      short: vals[0],
      long: vals[1],
    };
  },
  kdj: (ks, days = 9, km = 3, dm = 3) => {
    const vals = Tech.calculateKDJ(ks, days, km, dm);
    return {
      kvals: vals[0],
      dvals: vals[1],
      jvals: vals[2],
    };
  },
  dgwy: (ks, days = 15) => {
    const vals = Tech.calculateDGWY(ks, days);
    return {
      kma: vals[0],
      uppers: vals[1],
      lowers: vals[2],
      diffs: vals[3],
    };
  },
  describe: (ks) => {
    Tech.DescribeKlines(ks);
  },
};

const trader = new Trader();

let strategyModule = undefined;
registerPromiseWorker(function (message) {
  const type = message.type;
  if (type == 'strategy_init') {
    const source = message.args[0];
    strategyModule = evalCommonjsModule(source, new Map());
    strategyModule.bindOutterLogFunc(bridgeConsoleLog); // 注入日志方法
    strategyModule.bindIndicatorMethods(indicatorMethods); // 注入技术指标方法
    strategyModule.bindTrader(trader); // 用于回放
    return 'done';
  } else if (type == 'strategy_method') {
    const method = message.args[0];
    const _args = message.args.slice(1);
    if (method == 'initTrader') {
      trader.init(..._args);
      trader.onDeal = (deal) => postOutgoingMessage(2, null, deal);
      return;
    } else if (method == 'onTradeDay') {
      // 更新状态
      trader.onTradeDay(..._args);
      return;
    } else if (method == 'onFinishDay') {
      // 更新状态
      return trader.pack();
    }
    if (!strategyModule[method] || typeof strategyModule[method] != 'function') {
      return new Error('[error] 方法未定义, ' + method);
    }
    const firstArg = _args[0];
    if (method.includes('Filter') && Array.isArray(firstArg)) {
      return firstArg.filter((_, i) => strategyModule[method](..._args.map((a) => a[i])));
    } else if (method.includes('Sort') && Array.isArray(firstArg)) {
      return firstArg.map((_, i) => strategyModule[method](..._args.map((a) => a[i])));
    } else {
      return strategyModule[method](..._args);
    }
  }
});
