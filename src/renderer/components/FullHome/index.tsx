import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Layout } from 'antd';
import { useNativeThemeColor } from '@/utils/hooks';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
import LeftSider from './LeftSider';
import RightSider from './RightSider';
import StockTab, { StockTabId, SiteTabId, NoteTabId, StrategyTabId, TagTabId } from './StockTab';
import SplitPane from 'react-split-pane';
import styles from './index.scss';
import { batch, useDispatch } from 'react-redux';
import { syncStockOnDetailedAction } from '@/actions/stock';
import { appendReferAction } from '@/actions/note';
import { StockMarketType } from '@/utils/enums';

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
  activeTab: { hists: [] as string[], lastSecid: '', current: 'home' },
};
const strategyTid = (s: Strategy.BriefItem) => 'strategy_' + s.groupId + '_' + s.id;
const noteTid = (note: Note.NoteBriefItem) => 'note_' + note.bookId + '_' + note.id;
const FullHome: React.FC<FullHomeProps> = () => {
  const { colors: variableColors, darkMode, lowKey } = useNativeThemeColor(CONST.VARIABLES);
  const [stockTabs, setStockTabs] = useState<StockTabId[]>([]);
  const [tagTabs, setTagTabs] = useState<TagTabId[]>([]);
  const [siteTabs, setSiteTabs] = useState<SiteTabId[]>([]);
  const [noteTabs, setNoteTabs] = useState<NoteTabId[]>([]);
  const [strategyTabs, setStrategyTabs] = useState<StrategyTabId[]>([]);
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
  const openStock = useCallback((secid: string, name: string, change?: number, type?: StockMarketType) => {
    const tab = homeCaches.stockTabs.find((s) => s.tid === secid);
    if (!tab) {
      homeCaches.stockTabs.push({
        tid: secid,
        name: name,
        change: change || 0,
        type: type || StockMarketType.AB,
      });
      dispatch(syncStockOnDetailedAction(secid, true));
    }
    setStockTabs(homeCaches.stockTabs);
    if (!kview) {
      homeCaches.activeTab = {
        hists: homeCaches.activeTab.hists.concat([homeCaches.activeTab.current]),
        lastSecid: secid,
        current: secid,
      };
      setActiveTabid(homeCaches.activeTab);
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
