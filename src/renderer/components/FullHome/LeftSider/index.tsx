import React, { useCallback, useState } from 'react';
import { Layout, Input, Collapse, Button } from 'antd';
import LoadingScreen from '@/components/LoadingScreen';
import StockList from '@/components/FullHome/StockList';
import CustomDrawer from '@/components/CustomDrawer';
import AddStock from '@/components/FullHome/AddStock';
import SettingContent from '@/components/SettingContent';
import ReferSites from '@/components/FullHome/ReferSites';
import SiteTagDetail from '../ReferSites/SiteTagDetail';
import StockTagDetail from '../StockList/StockTagDetail';
import styles from '../index.scss';
import { useContextMenu } from '@/utils/hooks';
import * as Enums from '@/utils/enums';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';

export const stockTypesConfig = [
  { name: '指数', code: Enums.StockMarketType.Zindex },
  { name: '板块', code: Enums.StockMarketType.Quotation },
  { name: 'A股', code: Enums.StockMarketType.AB },
  { name: '港股', code: Enums.StockMarketType.HK },
  { name: '美指', code: Enums.StockMarketType.USZindex },
  { name: '美股', code: Enums.StockMarketType.US },
  { name: '期货', code: Enums.StockMarketType.Future },
];

export interface LeftSiderProps {
  activeTabid: string | undefined;
  width: number;
  openStock: (secid: string, name: string, change?: number, type?: Enums.StockMarketType) => void;
  openTag:(name: string, markettype: Enums.StockMarketType) => void;
  openSite: (site: Site.FavorItem) => void;
  barHidden: boolean;
  toggleBarHidden: () => void;
}

const LeftSider: React.FC<LeftSiderProps> = React.memo(({ activeTabid, width, openStock, openSite, barHidden, toggleBarHidden, openTag }) => {
  const [searchText, setSearchText] = useState('');
  const [showSearchDrawer, setShowSearchDrawer] = useState(false);
  const [showSettingDrawer, setShowSettingDrawer] = useState(false);
  const [siteId, setSiteId] = useState('');
  const [showSiteTagDrawer, setShowSiteTagDrawer] = useState(false);
  const [stockId, setStockId] = useState('');
  const [showStockTagDrawer, setShowStockTagDrawer] = useState(false);
  useContextMenu({
    onAddStock: (text) => {
      setSearchText(text);
      setShowSearchDrawer(true);
    },
  });

  const openSiteTagDrawer = useCallback((id: string) => {
    {
      setSiteId(id);
      setShowSiteTagDrawer(true);
    }
  }, []);
  const openStockTagDrawer = useCallback((id: string) => {
    setStockId(id);
    setShowStockTagDrawer(true);
  }, []);
  const openSearch = useCallback((v) => {
    if (!v || /^\s*$/.test(v)) {
      return;
    }
    setSearchText(v);
    setShowSearchDrawer(true);
  }, []);

  const [filterText, setFilterText] = useState('');
  const updateFilter = useCallback((e) => {
    const { value } = e.target;
    setFilterText(value);
  }, []);
  const leftWidth = 220;
  return (
    <>
      <Layout.Sider width={width} trigger={null} className={styles.navbar}>
        {/* 搜索栏，方便直接添加股票 */}
        <section style={{ display: 'flex' }}>
          <Input.Search
            type="text"
            placeholder="股票代码或名称关键字"
            allowClear
            enterButton
            onSearch={openSearch}
            onChange={updateFilter}
            size="middle"
            bordered={false}
          />
        </section>
        <LoadingScreen />
        <div className={styles.category}>
          <div className={styles.categoryHeader}>
            <span>网站</span>
            <Button type="text" icon={!barHidden ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />} onClick={toggleBarHidden} />
          </div>
          <ReferSites filterText={filterText} onOpenSite={openSite} onAddSiteTag={openSiteTagDrawer} />
        </div>
        <Collapse defaultActiveKey={stockTypesConfig.map((type) => type.code)} bordered={false}>
          {stockTypesConfig.map((type) => (
            <div key={type.code} className={styles.category}>
              <div className={styles.categoryHeader}>{type.name}</div>
              <StockList filterText={filterText} type={type.code} onStockDetail={openStock} onAddStockTag={openStockTagDrawer} onTagViewAll={openTag} />
            </div>
          ))}
        </Collapse>
        <CustomDrawer show={showSearchDrawer} width={leftWidth + 'px'}>
          <AddStock
            text={searchText}
            onClose={() => {
              setShowSearchDrawer(false);
            }}
            onOpenStock={openStock}
          />
        </CustomDrawer>
        <CustomDrawer show={showSettingDrawer} width={leftWidth + 'px'}>
          <SettingContent
            onClose={() => {
              setShowSettingDrawer(false);
            }}
          />
        </CustomDrawer>
        <CustomDrawer show={showSiteTagDrawer} width={leftWidth + 'px'}>
          <SiteTagDetail
            siteId={siteId}
            onClose={() => {
              setShowSiteTagDrawer(false);
            }}
          />
        </CustomDrawer>
        <CustomDrawer show={showStockTagDrawer} width={leftWidth + 'px'}>
          <StockTagDetail
            secid={stockId}
            onClose={() => {
              setShowStockTagDrawer(false);
            }}
          />
        </CustomDrawer>
      </Layout.Sider>
      {/* <ToolBar
        onClickSetting={() => {
          setShowSettingDrawer(true);
        }}
      /> */}
    </>
  );
});

export default LeftSider;
