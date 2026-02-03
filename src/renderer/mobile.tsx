import React from 'react';
import { render } from 'react-dom';
import NP from 'number-precision';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/lib/locale/zh_CN';
import { Provider } from 'react-redux';
import store from '@/store/configureStore';
import App from '@/App';

// 移动端入口 - 不包含 Electron 特有的模块
NP.enableBoundaryChecking(false);

render(
  <ConfigProvider locale={zhCN}>
    <Provider store={store}>
      <App type="mini" />
    </Provider>
  </ConfigProvider>,
  document.getElementById('root')
);
