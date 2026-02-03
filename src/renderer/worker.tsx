import React, { useCallback, useLayoutEffect, useState } from 'react';
import { render } from 'react-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/lib/locale/zh_CN';
import * as WorkerMethods from './helpers/win.worker';

const { ipcRenderer } = window.contextModules.electron;

const WorkerApp: React.FC = () => {
  const [callbacks] = useState<Record<string, any>>(WorkerMethods);
  const tryCatchFunc = useCallback((callback: any, args: any[]) => {
    try {
      return { res: callback(...args) };
    } catch (e) {
      return { err: e };
    }
  }, []);
  const isPromise = useCallback(
    (obj: any) => !!obj && (typeof obj === 'object' || typeof obj === 'function') && typeof obj.then === 'function',
    []
  );
  useLayoutEffect(() => {
    ipcRenderer.on('message-to-worker', async (e, payload) => {
      if (!Array.isArray(payload) || payload.length !== 2) {
        // message doens't match communication format; ignore
        return;
      }
      const [messageId, message] = payload;
      const method = message.method;
      if (!callbacks[method] || typeof callbacks[method] !== 'function') {
        WorkerMethods.postMessageOut(messageId, new Error(`Method(${method}) not found, Please pass a function into register().`));
      } else {
        const result = tryCatchFunc(callbacks[method], message.args || []);
        if (result.err) {
          WorkerMethods.postMessageOut(messageId, result.err);
        } else if (!isPromise(result.res)) {
          WorkerMethods.postMessageOut(messageId, null, result.res);
        } else {
          result.res.then(
            function (finalResult: any) {
              WorkerMethods.postMessageOut(messageId, null, finalResult);
              return finalResult;
            },
            function (finalError: any) {
              WorkerMethods.postMessageOut(messageId, finalError);
            }
          );
        }
      }
    });
  });
  return <div>Worker Setup!</div>;
};

render(
  <ConfigProvider locale={zhCN}>
    <WorkerApp />
  </ConfigProvider>,
  document.getElementById('root')
);
