import React, { useCallback, useState } from 'react';
import { batch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { Tabs, Tooltip, Button, Badge } from 'antd';
import {
  FundTwoTone,
  PictureTwoTone,
  ShrinkOutlined,
  MenuFoldOutlined,
  HomeFilled,
  ProfileOutlined,
  CoffeeOutlined,
  SlidersOutlined,
  UnorderedListOutlined,
  HeatMapOutlined,
  CompassOutlined,
} from '@ant-design/icons';
import Url from 'url-parse';
import classnames from 'classnames';
import StockDetail from './StockDetail';
import SiteDetail from './SiteDetail';
import Empty from '@/components/Empty';
import styles from './index.scss';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
import * as Helpers from '@/helpers';
import Dashboard from './Dashboard';
import NoteDetail from './NoteDetail';
import { useContextMenu } from '@/utils/hooks';
import ActReview from './ActReview';
import { StockMarketType } from '@/utils/enums';
import BKDetail from './BKDetail';
import STMonitor from './Dashboard/StockPool/STMonitor';
import QuantTest from './QuantTest';
import StrategyDetail from './StrategyDetail';
import FuturesDetail from './FuturesDetail';
import TagContentView from './TagContentView';

export interface StockTabId {
  tid: string; // secid
  name: string; // stock name
  change: number; // 涨跌幅
  type?: StockMarketType;
}
export interface TagTabId {
  tid: string;
  name: string;
  type: StockMarketType;
  change?: number;
}
export interface SiteTabId {
  tid: string; // siteid
  title: string; // sitetitle;
  url: string; // siteurl
}
export interface StrategyTabId {
  tid: string;
  sid: number; // strategy id
  gid: number; // group id
  title: string;
  changed: boolean; // need save
}
export interface NoteTabId {
  tid: string;
  nid: number; // note id
  bid: number; // book id
  title: string;
  changed: boolean; // need save
}
export interface StockTabProps {
  rightHidden: boolean;
  toggleRightHidden: () => void;
  leftHidden: boolean;
  toggleLeftHidden: () => void;
  stockTabs: StockTabId[];
  tagTabs: TagTabId[];
  siteTabs: SiteTabId[];
  noteTabs: NoteTabId[];
  strategyTabs: StrategyTabId[];
  onTabClose: (tid: string) => void;
  onActiveChange: (tid: string) => void;
  onStockChange: (tid: string, change: number) => void;
  onSiteChange: (tid: string, title?: string, url?: string) => void;
  onNoteChange: (tid: string, title?: string, changed?: boolean) => void;
  onStrategyChange: (tid: string, title?: string, changed?: boolean) => void;
  onNewSite: (url: string) => void;
  onNewStock: (secid: string, name: string, change?: number) => void;
  onAppendRefer: (tab: NoteTabId, url: string, text: string) => void;
  activeTabid: string | undefined;
}

const referCache = {
  url: '',
  text: '',
};
let cacheNoteTabs = [] as NoteTabId[];
const StockTab: React.FC<StockTabProps> = React.memo(
  ({
    rightHidden,
    toggleRightHidden,
    leftHidden,
    toggleLeftHidden,
    stockTabs,
    tagTabs,
    siteTabs,
    noteTabs,
    strategyTabs,
    onTabClose,
    onActiveChange,
    onStockChange,
    onSiteChange,
    onNoteChange,
    onStrategyChange,
    onNewSite,
    onNewStock,
    onAppendRefer,
    activeTabid,
  }) => {
    const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
    const onTabEdit = useCallback((targetKey: any, action: string) => {
      if (targetKey === 'home' || targetKey === 'quanttest') {
        return;
      }
      if (action === 'remove') {
        onTabClose(targetKey);
      } else if (action === 'add') {
        onNewSite('');
      }
    }, []);

    const onOpenUrl = useCallback((url: string) => {
      const s = siteTabs.find((s) => s.url === url);
      if (s) {
        onActiveChange(s.tid);
      } else {
        onNewSite(url);
      }
    }, []);

    cacheNoteTabs = noteTabs;
    const getEditingNoteTabs = useCallback(() => cacheNoteTabs, []);
    const [tabSelectVisible, setTabSelectVisible] = useState(false);
    const appendRefer = useCallback((tab: NoteTabId) => {
      onAppendRefer(tab, referCache.url, referCache.text);
      setTabSelectVisible(false);
    }, []);
    useContextMenu({
      onAddNote: (url, text) => {
        referCache.url = url;
        referCache.text = text;
        setTabSelectVisible(true);
      },
    });
    const [actReviewHidden, setActReviewHidden] = useState(true);
    if (activeTabid === 'review' && actReviewHidden) {
      setActReviewHidden(false);
    }
    const { stocksMapping } = useSelector((state: StoreState) => state.stock);
    const { monitorSetting } = useSelector((state: StoreState) => state.setting);

    const [kview, setKView] = useState(false);
    const toggleKView = useCallback(() => {
      batch(() => {
        setKView(!kview);
        if (!kview) {
          onActiveChange('kview');
        }
      });
    }, [kview]);
    return (
      <div className={styles.container}>
        {rightHidden && <Button type="primary" icon={<MenuFoldOutlined />} onClick={toggleRightHidden} className={styles.noteBtn} />}
        {leftHidden && <Button type="primary" icon={<ShrinkOutlined />} onClick={toggleLeftHidden} className={styles.fullBtn} />}
        {true ? (
          <Tabs
            className={styles.mainTab}
            activeKey={activeTabid}
            type="editable-card"
            onEdit={onTabEdit}
            onChange={onActiveChange}
            tabBarStyle={{ margin: 0, backgroundColor: variableColors['--nav-background-color'] }}
            tabBarExtraContent={
              <Button
                type="text"
                className={styles.extBtn}
                icon={kview ? <UnorderedListOutlined /> : <SlidersOutlined />}
                onClick={toggleKView}
              />
            }
          >
            <Tabs.TabPane
              key="home"
              closeIcon={<></>}
              tab={
                <>
                  <HomeFilled style={{ width: 15, height: 15, top: 0 }} color={variableColors['--hint-color']} />
                  <span>Dashboard</span>
                </>
              }
            >
              <Dashboard settings={monitorSetting} onOpenStock={onNewStock} />
            </Tabs.TabPane>
            {/* <Tabs.TabPane
              key="quanttest"
              closeIcon={<></>}
              tab={
                <>
                  <HeatMapOutlined style={{ width: 15, height: 15, top: 0 }} color={variableColors['--hint-color']} />
                  <span>测试</span>
                </>
              }
            >
              <QuantTest active={activeTabid == 'quanttest'} openStock={onNewStock} />
            </Tabs.TabPane> */}
            {!actReviewHidden && (
              <Tabs.TabPane
                key="review"
                tab={
                  <>
                    <CoffeeOutlined style={{ width: 15, height: 15, top: 0 }} color={variableColors['--hint-color']} />
                    <span>复盘</span>
                  </>
                }
              >
                <ActReview onOpenStock={onNewStock} />
              </Tabs.TabPane>
            )}
            {kview ? (
              <Tabs.TabPane key="kview" tab="全盘">
                <STMonitor
                  details={stockTabs.map((tab) => stocksMapping[tab.tid].detail)}
                  active={true}
                  noMore={true}
                  onLoadMore={() => { }}
                  onOpenStock={onNewStock}
                  stopStock={(s) => onTabClose(s)}
                />
              </Tabs.TabPane>
            ) : (
              <>
                {tagTabs.map((t) => {
                  return (
                    <Tabs.TabPane tab={t.name} key={t.tid}>
                      <TagContentView name={t.name} type={t.type} openStock={onNewStock} />
                    </Tabs.TabPane>
                  )
                })}
                {stockTabs.map((tab) => {
                  const st = stocksMapping[tab.tid];
                  return (
                    <Tabs.TabPane
                      tab={
                        <>
                          <FundTwoTone
                            twoToneColor={
                              (st ? st.detail.zdf : tab.change) > 0 ? variableColors['--increase-color'] : variableColors['--reduce-color']
                            }
                            style={{ width: 15, height: 15 }}
                          />
                          <span>{tab.name}</span>
                          <span
                            className={classnames(Utils.GetValueColor(st ? st.detail.zdf : tab.change).textClass)}
                            style={{ marginLeft: 2, width: 36, display: 'inline-block' }}
                          >
                            {Utils.Yang(st ? st.detail.zdf : tab.change)}%
                          </span>
                        </>
                      }
                      key={tab.tid}
                    >
                      {tab.type === StockMarketType.Future ? (
                        <FuturesDetail
                          active={true} /** always active */
                          secid={tab.tid}
                          onChangeUpdate={onStockChange}
                          onOpenUrl={onNewSite}
                        />
                      ) : Helpers.Stock.GetStockType(tab.tid) == StockMarketType.Zindex ||
                        Helpers.Stock.GetStockType(tab.tid) == StockMarketType.Quotation ||
                        Helpers.Stock.GetStockType(tab.tid) == StockMarketType.USZindex ? (
                        <BKDetail
                          active={activeTabid === tab.tid}
                          secid={tab.tid}
                          onChangeUpdate={onStockChange}
                          onOpenStock={onNewStock}
                          onOpenUrl={onNewSite}
                        />
                      ) : (
                        <StockDetail
                          active={activeTabid === tab.tid}
                          secid={tab.tid}
                          name={tab.name}
                          onChangeUpdate={onStockChange}
                          onOpenStock={onNewStock}
                          onOpenUrl={onNewSite}
                        />
                      )}
                    </Tabs.TabPane>
                  );
                })}
              </>
            )}

            {siteTabs.map((tab) => (
              <Tabs.TabPane
                tab={
                  <>
                    {tab.url.length ? (
                      <img
                        src={'http://www.google.com/s2/favicons?domain=' + new Url(tab.url).host}
                        style={{
                          position: 'relative',
                          top: -1,
                          width: 15,
                          height: 15,
                          marginRight: 8,
                        }}
                      />
                    ) : (
                      <PictureTwoTone twoToneColor="#52c41a" />
                    )}
                    {tab.title.length > 10 ? (
                      <Tooltip title={tab.title}>
                        <span>{tab.title.substr(0, 9) + '...'}</span>
                      </Tooltip>
                    ) : (
                      tab.title
                    )}
                  </>
                }
                key={tab.tid}
              >
                <SiteDetail
                  tab={tab}
                  active={activeTabid === tab.tid}
                  tabSelectVisible={tabSelectVisible}
                  onSiteUpdated={onSiteChange}
                  onNewWindow={onOpenUrl}
                  getEditingNotes={getEditingNoteTabs}
                  confirmReferTab={appendRefer}
                />
              </Tabs.TabPane>
            ))}
            {strategyTabs.map((tab) => (
              <Tabs.TabPane
                tab={
                  <>
                    <CompassOutlined />
                    {tab.title.length > 10 ? (
                      <Tooltip title={tab.title}>
                        <span>{tab.title.substr(0, 9) + '...'}</span>
                      </Tooltip>
                    ) : (
                      tab.title
                    )}
                    {tab.changed && <Badge status="warning" offset={[5, 0]} />}
                  </>
                }
                key={tab.tid}
              >
                <StrategyDetail tab={tab} active={activeTabid === tab.tid} onStrategyUpdated={onStrategyChange} onOpenStock={onNewStock} />
              </Tabs.TabPane>
            ))}
            {noteTabs.map((tab) => (
              <Tabs.TabPane
                tab={
                  <>
                    <ProfileOutlined />
                    {tab.title.length > 10 ? (
                      <Tooltip title={tab.title}>
                        <span>{tab.title.substr(0, 9) + '...'}</span>
                      </Tooltip>
                    ) : (
                      tab.title
                    )}
                    {tab.changed && <Badge status="warning" offset={[5, 0]} />}
                  </>
                }
                key={tab.tid}
              >
                <NoteDetail tab={tab} active={activeTabid === tab.tid} onNoteUpdated={onNoteChange} />
              </Tabs.TabPane>
            ))}
          </Tabs>
        ) : (
          <Empty text="通过左侧打开股票详情~" />
        )}
      </div>
    );
  }
);
export default StockTab;
