import React from 'react';
import MiniHome from './components/MiniHome';
import FullHome from './components/FullHome';
import { useAdjustmentNotification, useBootStrap, useMappingLocalToSystemSetting, useAllConfigBackup } from '@/utils/hooks';
import '@/App.global.scss';

export interface AppProps {
  type: string;
}
const App: React.FC<AppProps> = ({ type }) => {
  useAdjustmentNotification();
  useAllConfigBackup();
  useMappingLocalToSystemSetting();
  useBootStrap();

  return type === 'mini' ? <MiniHome /> : <FullHome />;
};

export default App;
