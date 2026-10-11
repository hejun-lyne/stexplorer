import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Layout } from 'antd';
import { useNativeThemeColor } from '@/utils/hooks';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
import LeftSider from './LeftSider';
import RightSider from './RightSider';
import StockTab, { StockTabId, SiteTabId, NoteTabId, StrategyTabId, TagTabId, TrainTabId } from './StockTab';
import SplitPane from 'react-split-pane';
import styles from './index.scss';
import { batch, useDispatch } from 'react-redux';
import { syncStockOnDetailedAction } from '@/actions/stock';
import { appendReferAction } from '@/actions/note';
import { KLineType, StockMarketType } from '@/utils/enums';
import * as Helpers from '@/helpers';
import * as Services from '@/services';
import { preloadDailyKline } from '@/helpers/klinePreload';

/** 打开股票时后台预取的日K条数（与详情页 PriceTrend 的默认条数一致，保证命中同一份缓存） */
const PRELOAD_DAY_KLINE_COUNT = 250;

/**
 * 后台新增标签页时的「短暂激活」时长（ms）
 *
 * 详情页需要在可见状态下完成挂载与尺寸量测，因此打开后台标签页时先切过去一下再切回来。
 * 时间要足够让 React 提交 DOM、跑完 useEffect 量测（约 1~2 帧），又不能太长以免明显闪屏。
 */
const TEMP_ACTIVATE_MS = 120;

export interface FullHomeProps { }

export const FullHomeContext = createContext<{
  variableColors: any;
  darkMode: boolean;
  lowKey: boolean;
}>({
  variableColors: {},
  darkMode: false,
  lowKey: false,
});

export function useHomeContext() {
  const context = useContext(FullHomeContext);
  return context;
}

let callback: () => void;
const ipcRenderer = window.contextModules.electron.ipcRenderer;
const homeCaches = {
  stockTabs: [] as StockTabId[],
  tagTabs: [] as TagTabId[],
  siteTabs: [] as SiteTabId[],
  strategyTabs: [] as StrategyTabId[],
  noteTabs: [] as NoteTabId[],
  trainTabs: [] as TrainTabId[],
  activeTab: { hists: [] as string[], lastSecid: '', current: 'home' },
};
const strategyTid = (s: Strategy.BriefItem) => 'strategy_' + s.groupId + '_' + s.id;
const noteTid = (note: Note.NoteBriefItem) => 'note_' + note.bookId + '_' + note.id;
const trainTid = (archive: Train.ArchiveRecord) => 'train_' + archive.id;
const FullHome: React.FC<FullHomeProps> = () => {
  const { colors: variableColors, darkMode, lowKey } = useNativeThemeColor(CONST.VARIABLES);
  const [stockTabs, setStockTabs] = useState<StockTabId[]>([]);
  const [tagTabs, setTagTabs] = useState<TagTabId[]>([]);
  const [siteTabs, setSiteTabs] = useState<SiteTabId[]>([]);
  const [noteTabs, setNoteTabs] = useState<NoteTabId[]>([]);
  const [strategyTabs, setStrategyTabs] = useState<StrategyTabId[]>([]);
  const [trainTabs, setTrainTabs] = useState<TrainTabId[]>([]);
  const [activeTabid, setActiveTabid] = useState<{ hists: string[]; lastSecid: string; current: string | undefined }>({
    hists: [],
    lastSecid: '',
    current: 'home',
  });
  useEffect(() => {
    if (activeTabid.current) {
      console.log('rebind close-current-tab');
      ipcRenderer.offAll('close-current-tab');
      callback = () => {
        console.log('will close tab: ' + activeTabid.current);
        if (activeTabid.current) closeDetail(activeTabid.current);
      };
      ipcRenderer.on('close-current-tab', callback);
    }
  }, [activeTabid]);

  const [kview, setKView] = useState(false);
  const dispatch = useDispatch();
  // 打开详情
  // activate=false 时不把界面停在详情页：新增标签页后短暂激活一下（让它以正确尺寸挂载渲染），
  // 随后自动切回原来的页面
  const openStock = useCallback((secid: string, name: string, firstQSAppear?: string, change?: number, backtestDate?: string, type?: StockMarketType, activate = true) => {
    const tab = homeCaches.stockTabs.find((s) => s.tid === secid);
    const isNewTab = !tab;
    // 板块 / 指数 / 期货走的是别的详情页，不需要日K
    const stockType = Helpers.Stock.GetStockType(secid);
    const willShowStockDetail =
      type !== StockMarketType.Future &&
      stockType !== StockMarketType.Zindex &&
      stockType !== StockMarketType.Quotation &&
      stockType !== StockMarketType.USZindex;
    if (!tab) {
      homeCaches.stockTabs.push({
        tid: secid,
        name: name,
        firstQSAppear: firstQSAppear,
        backtestDate,
        change: change || 0,
        type: type || StockMarketType.AB,
      });
      dispatch(syncStockOnDetailedAction(secid, true));
      // 打开股票时后台预取日K线（与详情页同一份缓存）：详情页 K 线组件挂载时可直接画图，
      // 不用再等一次取数往返。
      if (willShowStockDetail) {
        preloadDailyKline(secid, Services.Stock.GetKFromSetting(secid, KLineType.Day, PRELOAD_DAY_KLINE_COUNT));
      }
    } else if (backtestDate) {
      // [新增] 从回测打开同一股票时更新回测日期
      tab.backtestDate = backtestDate;
    }
    // 用新数组引用触发渲染，保证新增的标签页能立刻出现
    setStockTabs([...homeCaches.stockTabs]);
    if (kview) {
      // 全盘视图下不渲染详情面板，无需切换
      return;
    }
    if (activate) {
      homeCaches.activeTab = {
        hists: homeCaches.activeTab.hists.concat([homeCaches.activeTab.current]),
        lastSecid: secid,
        current: secid,
      };
      setActiveTabid(homeCaches.activeTab);
      return;
    }
    // activate=false（后台新增标签页、不切换过去）：先把新标签页「短暂激活」一下，
    // 让它以正确的容器尺寸完成挂载与量测（若在隐藏状态下挂载，容器尺寸是 0，
    // 详情页的分栏高度 / 图表宽度会被量成 0 而塌陷），随后再切回原来的页面。
    // 这样该标签页已挂载完毕（图表也已按正确尺寸渲染），用户之后点开即见，无需再等。
    if (isNewTab && willShowStockDetail) {
      const prevCurrent = homeCaches.activeTab.current;
      const prevLastSecid = homeCaches.activeTab.lastSecid;
      // 临时切到新标签页（不写入 hists，避免污染前进/后退历史）
      homeCaches.activeTab = { hists: homeCaches.activeTab.hists, lastSecid: secid, current: secid };
      setActiveTabid({ ...homeCaches.activeTab });
      setTimeout(() => {
        // 用户已经自己切走了就不要抢回来
        if (homeCaches.activeTab.current !== secid) {
          return;
        }
        homeCaches.activeTab = { hists: homeCaches.activeTab.hists, lastSecid: prevLastSecid, current: prevCurrent };
        setActiveTabid({ ...homeCaches.activeTab });
      }, TEMP_ACTIVATE_MS);
    }
  }, [kview]);
  const openTag = useCallback((name: string, markettype: StockMarketType) => {
    const tid = name + markettype;
    const tab = homeCaches.tagTabs.find((s) => s.tid === tid);
    if (!tab) {
      homeCaches.tagTabs.push({
        tid,
        name,
        type: markettype,
      });
    }
    setTagTabs(homeCaches.tagTabs);
    homeCaches.activeTab = {
      hists: homeCaches.activeTab.hists.concat([homeCaches.activeTab.current]),
      lastSecid: homeCaches.activeTab.lastSecid,
      current: tid,
    };
    setActiveTabid(homeCaches.activeTab);
  },[]);
  const openFavorSite = useCallback((site: Site.FavorItem) => {
    const tab = homeCaches.siteTabs.find((s) => s.tid === site.id);
    if (!tab) {
      homeCaches.siteTabs.push({
        tid: site.id,
        title: site.name,
        url: site.url,
      });
    }
    setSiteTabs(homeCaches.siteTabs);
    homeCaches.activeTab = {
      hists: homeCaches.activeTab.hists.concat([homeCaches.activeTab.current]),
      lastSecid: homeCaches.activeTab.lastSecid,
      current: site.id,
    };
    setActiveTabid(homeCaches.activeTab);
  }, []);
  const openTempSite = useCallback((url: string) => {
    const id = homeCaches.siteTabs.length ? String(Math.max(...homeCaches.siteTabs.map((s) => Number(s.tid))) + 100) : '100';
    homeCaches.siteTabs.push({
      tid: id,
      title: '新页面',
      url: url,
    });
    setSiteTabs(Utils.DeepCopy(homeCaches.siteTabs));
    homeCaches.activeTab = {
      hists: homeCaches.activeTab.hists.concat([homeCaches.activeTab.current]),
      lastSecid: homeCaches.activeTab.lastSecid,
      current: id,
    };
    setActiveTabid(homeCaches.activeTab);
  }, []);

  const openStrategy = useCallback((s: Strategy.BriefItem) => {
    const tid = strategyTid(s);
    const tab = homeCaches.strategyTabs.find((n) => n.tid === tid);
    if (!tab) {
      homeCaches.strategyTabs.push({
        tid,
        sid: s.id,
        gid: s.groupId,
        title: s.firstLine,
        changed: false,
      });
    }
    setStrategyTabs(homeCaches.strategyTabs);
    homeCaches.activeTab = {
      hists: homeCaches.activeTab.hists.concat([homeCaches.activeTab.current]),
      lastSecid: homeCaches.activeTab.lastSecid,
      current: tid,
    };
    setActiveTabid(homeCaches.activeTab);
  }, []);

  const openNote = useCallback((note: Note.NoteBriefItem) => {
    const tid = noteTid(note);
    const tab = homeCaches.noteTabs.find((n) => n.tid === tid);
    if (!tab) {
      homeCaches.noteTabs.push({
        tid,
        nid: note.id,
        bid: note.bookId,
        title: note.firstLine,
        changed: false,
      });
    }
    setNoteTabs(homeCaches.noteTabs);
    homeCaches.activeTab = {
      hists: homeCaches.activeTab.hists.concat([homeCaches.activeTab.current]),
      lastSecid: homeCaches.activeTab.lastSecid,
      current: tid,
    };
    setActiveTabid(homeCaches.activeTab);
  }, []);

  /** 打开训练归档详情：在 StockTab 中新增（或激活）一个归档详情页，而不是在左侧栏就地展开 */
  const openTrainArchive = useCallback((archive: Train.ArchiveRecord) => {
    const tid = trainTid(archive);
    const tab = homeCaches.trainTabs.find((n) => n.tid === tid);
    if (!tab) {
      homeCaches.trainTabs.push({
        tid,
        archiveId: archive.id,
        title: `${archive.name || archive.secid} 训练结算`,
      });
    }
    setTrainTabs(Utils.DeepCopy(homeCaches.trainTabs));
    homeCaches.activeTab = {
      hists: homeCaches.activeTab.hists.concat([homeCaches.activeTab.current]),
      lastSecid: homeCaches.activeTab.lastSecid,
      current: tid,
    };
    setActiveTabid(homeCaches.activeTab);
  }, []);

  const openReview = useCallback(() => {
    homeCaches.activeTab = {
      hists: homeCaches.activeTab.hists.concat([homeCaches.activeTab.current]),
      lastSecid: homeCaches.activeTab.lastSecid,
      current: 'review',
    };
    setActiveTabid(homeCaches.activeTab);
  }, []);

  // 关闭详情
  const closeDetail = useCallback((tid: string) => {
    if (homeCaches.stockTabs.some((s) => s.tid === tid)) {
      homeCaches.stockTabs = homeCaches.stockTabs.filter((s) => s.tid !== tid);
      if (homeCaches.activeTab.lastSecid === tid) {
        homeCaches.activeTab.lastSecid =
          homeCaches.activeTab.hists
            .filter((t) => t != undefined)
            .reverse()
            .find((t) => t.startsWith('1.') || t.startsWith('0.')) || '';
      }
      setStockTabs(homeCaches.stockTabs);
    }
    if (homeCaches.tagTabs.some((s) => s.tid === tid)) {
      homeCaches.tagTabs = homeCaches.tagTabs.filter((s) => s.tid !== tid);
      setTagTabs(homeCaches.tagTabs);
    }
    if (homeCaches.siteTabs.some((s) => s.tid === tid)) {
      homeCaches.siteTabs = homeCaches.siteTabs.filter((s) => s.tid !== tid);
      setSiteTabs(homeCaches.siteTabs);
    }
    if (homeCaches.noteTabs.some((s) => s.tid === tid)) {
      homeCaches.noteTabs = homeCaches.noteTabs.filter((s) => s.tid !== tid);
      setNoteTabs(homeCaches.noteTabs);
    }
    if (homeCaches.strategyTabs.some((s) => s.tid === tid)) {
      homeCaches.strategyTabs = homeCaches.strategyTabs.filter((s) => s.tid !== tid);
      setStrategyTabs(homeCaches.strategyTabs);
    }
    if (homeCaches.trainTabs.some((s) => s.tid === tid)) {
      homeCaches.trainTabs = homeCaches.trainTabs.filter((s) => s.tid !== tid);
      setTrainTabs(homeCaches.trainTabs);
    }
    homeCaches.activeTab.hists = homeCaches.activeTab.hists.filter((t) => t !== tid);
    homeCaches.activeTab.current = homeCaches.activeTab.hists.pop()!;
    setActiveTabid(homeCaches.activeTab);
  }, []);

  const updateStock = useCallback((tid: string, change: number) => {
    const stockTab = homeCaches.stockTabs.find((s) => s.tid === tid);
    if (stockTab) {
      stockTab.change = change;
      setStockTabs(Utils.DeepCopy(homeCaches.stockTabs));
    }
  }, []);

  const updateSite = useCallback((tid: string, title?: string, url?: string) => {
    const siteTab = homeCaches.siteTabs.find((s) => s.tid === tid);
    if (siteTab) {
      if (title) siteTab.title = title;
      if (url) siteTab.url = url;
      setSiteTabs(Utils.DeepCopy(homeCaches.siteTabs));
    }
  }, []);

  const updateNote = useCallback((tid: string, title?: string, changed?: boolean) => {
    const noteTab = homeCaches.noteTabs.find((s) => s.tid === tid);
    if (noteTab) {
      if (title) noteTab.title = title;
      if (changed != undefined) noteTab.changed = changed;
      setNoteTabs(Utils.DeepCopy(homeCaches.noteTabs));
    }
  }, []);

  const updateStrategy = useCallback((tid: string, title?: string, changed?: boolean) => {
    const strategyTab = homeCaches.strategyTabs.find((s) => s.tid === tid);
    if (strategyTab) {
      if (title) strategyTab.title = title;
      if (changed != undefined) strategyTab.changed = changed;
      setStrategyTabs(Utils.DeepCopy(homeCaches.strategyTabs));
    }
  }, []);

  const tabChanged = useCallback((id: string) => {
    homeCaches.activeTab = {
      hists: homeCaches.activeTab.hists.concat([homeCaches.activeTab.current]),
      lastSecid: id.startsWith('1.') || id.startsWith('0.') ? id : homeCaches.activeTab.lastSecid,
      current: id,
    };
    batch(() => {
      if (id === 'kview') {
        setKView(true);
      } else {
        setKView(false);
      }
      setActiveTabid(homeCaches.activeTab);
    });
  }, []);
  const appendReferToNote = useCallback((tab: NoteTabId, url: string, text: string) => {
    dispatch(appendReferAction(tab.nid, url, text));
    tabChanged(tab.tid);
  }, []);
  const [leftbarHidden, setLeftBarHidden] = useState(false);
  const [rightbarHidden, setRightBarHidden] = useState(false);
  const [siderWidth, setSiderWidth] = useState(240);
  const [tabWidth, setTabWidth] = useState<number>(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<SplitPane>(null);
  return (
    <FullHomeContext.Provider value={{ lowKey, darkMode, variableColors }}>
      <Layout style={{ height: '100%' }}>
        <LeftSider
          width={siderWidth}
          activeTabid={activeTabid.current}
          openStock={openStock}
          openTag={openTag}
          openSite={openFavorSite}
          openTrainArchive={openTrainArchive}
          barHidden={leftbarHidden}
          toggleBarHidden={() => {
            setSiderWidth(leftbarHidden ? 240 : 0);
            setLeftBarHidden(!leftbarHidden);
          }}
        />
        <Layout className="site-layout" style={{ height: 'calc(100vh)' }}>
          <Layout.Content className={styles.content}>
            <div style={{ width: '100%', height: '100%' }} ref={contentRef}>
              <SplitPane
                split="vertical"
                primary="second"
                minSize={240}
                style={{ position: 'inherit' }}
                ref={splitRef}
                pane1Style={{
                  width: tabWidth,
                }}
                pane2Style={
                  rightbarHidden
                    ? {
                      width: 0,
                    }
                    : undefined
                }
                onChange={(size) => {
                  if (contentRef.current) {
                    setTabWidth(contentRef.current.offsetWidth - size);
                  }
                }}
              >
                <StockTab
                  leftHidden={leftbarHidden}
                  toggleLeftHidden={() => {
                    setSiderWidth(leftbarHidden ? 240 : 0);
                    setLeftBarHidden(!leftbarHidden);
                  }}
                  rightHidden={rightbarHidden}
                  toggleRightHidden={() => setRightBarHidden(!rightbarHidden)}
                  stockTabs={stockTabs}
                  tagTabs={tagTabs}
                  siteTabs={siteTabs}
                  noteTabs={noteTabs}
                  strategyTabs={strategyTabs}
                  trainTabs={trainTabs}
                  onTabClose={closeDetail}
                  onActiveChange={tabChanged}
                  onStockChange={updateStock}
                  onSiteChange={updateSite}
                  onNoteChange={updateNote}
                  onStrategyChange={updateStrategy}
                  onNewSite={openTempSite}
                  onNewStock={openStock}
                  onAppendRefer={appendReferToNote}
                  activeTabid={activeTabid.current}
                />
                <RightSider
                  onStrategyEdit={openStrategy}
                  onNoteEdit={openNote}
                  activeSecid={activeTabid.lastSecid}
                  onOpenStock={openStock}
                  onOpenUrl={openTempSite}
                  onOpenReview={openReview}
                  barHidden={rightbarHidden}
                  toggleRightBar={() => setRightBarHidden(!rightbarHidden)}
                />
              </SplitPane>
            </div>
          </Layout.Content>
        </Layout>
      </Layout>
    </FullHomeContext.Provider>
  );
};
export default FullHome;
