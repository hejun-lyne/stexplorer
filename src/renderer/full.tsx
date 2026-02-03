import React from 'react';
import { render } from 'react-dom';
import NP from 'number-precision';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/lib/locale/zh_CN';
import { Provider } from 'react-redux';
import store from '@/store/configureStore';
import App from '@/App';

// 检测是否在 Electron 环境
const isElectron = () => {
  return typeof window !== 'undefined' && 
    (window as any).process?.type === 'renderer';
};

// 只在 Electron 环境中加载 Electron 特有模块
if (isElectron()) {
  require('electron-disable-file-drop');
  require('@/utils/window');
}

NP.enableBoundaryChecking(false);

render(
  <ConfigProvider locale={zhCN}>
    <Provider store={store}>
      <App type="full" />
    </Provider>
  </ConfigProvider>,
  document.getElementById('root')
);
