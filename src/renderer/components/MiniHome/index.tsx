import React, { createContext, useContext, useMemo } from 'react';
import classnames from 'classnames';
import { useSelector } from 'react-redux';

import LoadingScreen from '../LoadingScreen';
import StockList from './StockList';
import ToolBar from '../Toolbar';
import Header from '../Header';
import Footer from '../Footer';
import SortBar from '../SortBar';
import GroupTab from '../GroupTab';
import { StoreState } from '@/reducers/types';
import { useNativeThemeColor, useTrayContent } from '@/utils/hooks';
import { Stock } from '@/types/stock';

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
  const stocksMapping = useSelector((state: StoreState) => state.stock.stocksMapping);

  const { tags, tagMappings } = useMemo(() => {
    const allTags = [...new Set(([] as string[]).concat.apply([], [...configs.map((s) => s.tags || [])]))].filter((t) => t !== '默认');
    const mappings: Record<string, Stock.SettingItem[]> = {};
    allTags.forEach((t) => {
      mappings[t] = configs.filter((c) => c.tags?.includes(t));
    });

    const uncategorized = configs.filter((c) => !c.tags || (c.tags.length === 1 && c.tags[0] === '默认'));
    if (uncategorized.length) {
      allTags.push('未分类');
      mappings['未分类'] = uncategorized;
    }

    allTags.forEach((t) => {
      const arr = mappings[t];
      arr?.sort((a, b) => {
        const da = stocksMapping[a.secid]?.detail.zdf || 0;
        const db = stocksMapping[b.secid]?.detail.zdf || 0;
        return db - da;
      });
    });

    return { tags: allTags, tagMappings: mappings };
  }, [configs, stocksMapping]);

  return (
    <GroupTab>
      <Tabs.TabPane tab="全部" key="all">
        <StockList filter={() => true} />
      </Tabs.TabPane>
      {tags.map((tag) => (
        <Tabs.TabPane tab={tag} key={tag}>
          <StockList filter={(stock) => tagMappings[tag].some((c) => c.secid === stock.detail.secid)} />
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
      <div className={classnames(styles.layout, 'mini-home-layout')}>
        <LoadingScreen />
        <Header>
          <SortBar />
        </Header>
        <div className={styles.content}>
          <StockGroup />
        </div>
        <Footer>
          <ToolBar />
        </Footer>
      </div>
    </HomeContext.Provider>
  );
};
export default MiniHome;
