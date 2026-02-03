import React, { createContext, useContext } from 'react';
import classnames from 'classnames';
import { useSelector } from 'react-redux';

import LoadingScreen from '../LoadingScreen';
import StockList from './StockList';
import ToolBar from '../Toolbar';
import Header from '../Header';
import Footer from '../Footer';
import SortBar from '../SortBar';
import GroupTab from '../GroupTab';
import { stockTypesConfig } from './StockList/AddStockContent';
import { StoreState } from '@/reducers/types';
import { useNativeThemeColor, useTrayContent } from '@/utils/hooks';

import * as CONST from '@/constants';
import styles from './index.scss';
import { Tabs } from 'antd';

export interface MiniHomeProps { }

export const HomeContext = createContext<{
  variableColors: any;
  darkMode: boolean;
}>({
  variableColors: {},
  darkMode: false,
});

export function useHomeContext() {
  const context = useContext(HomeContext);
  return context;
}

const StockGroup = () => {
  const configs = useSelector((state: StoreState) => state.stock.stockConfigs);
  return (
    <GroupTab>
      <Tabs.TabPane tab="全部" key={String(-1)}>
        <StockList filter={() => true} />
      </Tabs.TabPane>
      {stockTypesConfig.map((type) => (
        <Tabs.TabPane tab={type.name.slice(0, 2)} key={String(type.code)}>
          <StockList filter={(stock) => configs.find((s) => s.secid === stock.detail.secid)!.type === type.code} />
        </Tabs.TabPane>
      ))}
    </GroupTab>
  );
};

const MiniHome: React.FC<MiniHomeProps> = () => {
  useTrayContent();
  const { colors: variableColors, darkMode } = useNativeThemeColor(CONST.VARIABLES);
  return (
    <HomeContext.Provider value={{ darkMode, variableColors }}>
      <div className={classnames(styles.layout)}>
        <LoadingScreen />
        <Header>
          <SortBar />
        </Header>
        <StockGroup />
        <Footer>
          <ToolBar />
        </Footer>
      </div>
    </HomeContext.Provider>
  );
};
export default MiniHome;
