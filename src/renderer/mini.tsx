import React from 'react';
import { render } from 'react-dom';
import NP from 'number-precision';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/lib/locale/zh_CN';
import { Provider } from 'react-redux';
import store from '@/store/configureStore';
import App from '@/App';
import 'electron-disable-file-drop';
import '@/utils/window';

NP.enableBoundaryChecking(false);

render(
  <ConfigProvider locale={zhCN}>
    <Provider store={store}>
      <App type="mini" />
    </Provider>
  </ConfigProvider>,
  document.getElementById('root')
);
