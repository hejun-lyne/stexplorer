import React, { useCallback, useRef } from 'react';
import { useState } from 'react';
import SiteBar from './SiteBar';
import styles from './index.scss';
import { addFavorSiteAction, deleteFavorSiteAction } from '@/actions/site';
import { useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import WebView from 'react-electron-web-view';
import { NoteTabId, SiteTabId } from '..';

export interface DetectedVideo {
  src: string;
  type: 'video' | 'audio' | 'iframe';
}

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
    const [videos, setVideos] = useState<DetectedVideo[]>([]);
    const dispatch = useDispatch();

    // 检测网页中的视频（含 m3u8/mpd 等流媒体）
    const detectVideos = useCallback(async (wv: any) => {
      if (!wv) return;
      try {
        // 先注入资源捕获 hook（尽早拦截 XHR / fetch / PerformanceObserver）
        await wv.executeJavaScript(`
          (function() {
            if (window.__videoHook) return;
            const captured = new Set();
            const VIDEO_RE = /\.(m3u8|mpd|ts|flv|mp4|webm)(\?|$)/i;

            // 1. 扫描已加载的资源
            if (window.performance && window.performance.getEntriesByType) {
              window.performance.getEntriesByType('resource').forEach(r => {
                const url = r.name;
                if (url && VIDEO_RE.test(url)) captured.add(url);
              });
            }

            // 2. 监听后续加载的资源
            if (window.PerformanceObserver) {
              const observer = new PerformanceObserver((list) => {
                list.getEntries().forEach(entry => {
                  const url = entry.name;
                  if (url && VIDEO_RE.test(url)) captured.add(url);
                });
              });
              observer.observe({ entryTypes: ['resource'] });
            }

            // 3. Hook XMLHttpRequest
            const origOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function() {
              const url = arguments[1];
              if (typeof url === 'string' && VIDEO_RE.test(url)) captured.add(url);
              return origOpen.apply(this, arguments);
            };

            // 4. Hook fetch
            const origFetch = window.fetch;
            window.fetch = function() {
              const url = typeof arguments[0] === 'string' ? arguments[0] : arguments[0]?.url;
              if (url && VIDEO_RE.test(url)) captured.add(url);
              return origFetch.apply(this, arguments);
            };

            window.__videoHook = {
              getUrls: () => Array.from(captured).map(url => ({ src: url, type: 'video' }))
            };
          })();
        `);

        // 获取所有视频
        const result: DetectedVideo[] = await wv.executeJavaScript(`
          (function() {
            const videos = [];
            const seen = new Set();
            function add(src, type) {
              if (src && !seen.has(src)) {
                seen.add(src);
                videos.push({ src, type });
              }
            }

            // DOM 扫描
            document.querySelectorAll('video').forEach(v => {
              if (v.src) add(v.src, 'video');
              v.querySelectorAll('source').forEach(s => { if (s.src) add(s.src, 'video'); });
            });
            document.querySelectorAll('audio').forEach(a => {
              if (a.src) add(a.src, 'audio');
              a.querySelectorAll('source').forEach(s => { if (s.src) add(s.src, 'audio'); });
            });
            document.querySelectorAll('iframe').forEach(f => {
              const src = f.src;
              if (src && /youtube|bilibili|vimeo|youku|tudou|iqiyi/.test(src)) {
                add(src, 'iframe');
              }
            });

            // Hook 捕获的动态资源
            if (window.__videoHook) {
              window.__videoHook.getUrls().forEach(v => add(v.src, v.type));
            }

            return videos;
          })()
        `);
        setVideos(result || []);
      } catch (e) {
        console.error('Detect videos failed:', e);
        setVideos([]);
      }
    }, []);
    return (
      <>
        <SiteBar
          url={siteUrl}
          canBackward={cans.back}
          canForward={cans.forward}
          stared={stared}
          tabsSelectVisible={active && tabSelectVisible}
          videos={videos}
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
            setVideos([]);
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
              detectVideos(wv);
              setTimeout(() => detectVideos(wv), 2000);
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
              detectVideos(e.target);
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
