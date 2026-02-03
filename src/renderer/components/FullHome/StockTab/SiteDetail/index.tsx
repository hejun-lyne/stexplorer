import React, { useCallback, useRef } from 'react';
import { useState } from 'react';
import SiteBar from './SiteBar';
import styles from './index.scss';
import { addFavorSiteAction, deleteFavorSiteAction } from '@/actions/site';
import { useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import WebView from 'react-electron-web-view';
import { NoteTabId, SiteTabId } from '..';

export interface StockDetailProps {
  tab: SiteTabId;
  active: boolean;
  tabSelectVisible: boolean;
  onSiteUpdated: (tid: string, title?: string, url?: string) => void;
  onNewWindow: (url: string) => void;
  getEditingNotes: () => NoteTabId[];
  confirmReferTab: (tad: NoteTabId) => void;
}

const SiteDetail: React.FC<StockDetailProps> = React.memo(
  ({ tab, active, tabSelectVisible, onSiteUpdated, onNewWindow, getEditingNotes, confirmReferTab }) => {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [cans, setCans] = useState<{ wv: any; url: string; back: boolean; forward: boolean }>({
      wv: undefined,
      url: tab.url,
      back: false,
      forward: false,
    });
    const stars = useSelector((storeState: StoreState) => storeState.site.stars);
    const [title, setTitle] = useState('');
    const [stared, setStared] = useState(stars.find((s) => s.url === tab.url) ? true : false);
    const [siteUrl, setSiteUrl] = useState(tab.url);
    const dispatch = useDispatch();

    // 检测可下载视频
    const videoDetect = useCallback((doc: any) => {

    }, []);
    return (
      <>
        <SiteBar
          url={siteUrl}
          canBackward={cans.back}
          canForward={cans.forward}
          stared={stared}
          tabsSelectVisible={active && tabSelectVisible}
          onBackward={() => cans.wv?.goBack()}
          onForward={() => cans.wv.goForward()}
          onRefresh={() => cans.wv?.reload()}
          getEditingNotes={getEditingNotes}
          confirmReferTab={confirmReferTab}
          onToggleStar={(url) => {
            console.log('toggle star: ', url);
            if (url.includes('http')) {
              if (stared) {
                dispatch(deleteFavorSiteAction(url));
                setStared(false);
              } else {
                dispatch(addFavorSiteAction(title, url));
                setStared(true);
              }
            }
          }}
          onChangeUrl={(url) => {
            setSiteUrl(url);
            if (cans.wv) cans.wv.loadURL(url);
          }}
        />
        {siteUrl.length ? (
          <WebView
            ref={wrapperRef}
            src={siteUrl}
            style={{ width: '100%', height: 'calc(100% - 30px)', background: 'white' }}
            className={styles.container}
            onDidFinishLoad={(e) => {
              const wv = e.target;
              const url = wv.getURL();
              setCans({
                wv: wv,
                url: url,
                back: wv.canGoBack(),
                forward: wv.canGoForward(),
              });
              setStared(stars.find((s) => s.url === url) !== undefined);
              onSiteUpdated(tab.tid, undefined, url);
            }}
            onPageTitleUpdated={({ title }) => {
              setTitle(title);
              onSiteUpdated(tab.tid, title);
            }}
            onNewWindow={(e) => {
              e.preventDefault();
              onNewWindow(e.url);
            }}
            onDomReady={(e) => {
              e.target.insertCSS('.no-select{ -webkit-user-select: auto !important; user-select: auto !important;}');
            }}
            allowpopups
          />
        ) : (
          <span>输入地址～</span>
        )}
      </>
    );
  }
);
export default SiteDetail;
