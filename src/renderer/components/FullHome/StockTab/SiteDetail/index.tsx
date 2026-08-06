import React, { useCallback, useEffect, useRef } from 'react';
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
  type: 'video' | 'audio' | 'iframe' | 'm3u8' | 'blob' | 'mse';
  mimeType?: string;
  title?: string;
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
    const videoPollRef = useRef<NodeJS.Timeout | null>(null);
    const dispatch = useDispatch();

    // 检测网页中的视频（含 m3u8/mpd 等流媒体）
    const detectVideos = useCallback(async (wv: any) => {
      if (!wv) return;
      try {
        // 注入增强版资源捕获 hook
        await wv.executeJavaScript(`
          (function() {
            if (window.__videoHook) return;
            const captured = new Map();
            const seen = new Set();
            function add(src, info) {
              if (!src || seen.has(src)) return;
              seen.add(src);
              captured.set(src, info);
            }

            // 视频 MIME 类型检测正则
            const VIDEO_MIME_RE = /video|audio|mpegurl|mp2t|dash|x-matroska|webm|mp4|flv/i;
            const VIDEO_EXT_RE = /\\.(m3u8|mpd|ts|flv|mp4|webm|mkv|mov|3gp)(\\?|$|#)/i;
            const STREAM_RE = /(m3u8|mpd|\\/stream|\\/video|\\/play|\\/live|\\/hls|\\/dash)/i;

            // 1. 扫描已加载的资源
            if (window.performance && window.performance.getEntriesByType) {
              window.performance.getEntriesByType('resource').forEach(r => {
                const url = r.name;
                if (!url) return;
                if (VIDEO_EXT_RE.test(url) || STREAM_RE.test(url)) {
                  add(url, { type: 'video', source: 'performance' });
                }
                // 通过 initiatorType 判断
                if (r.initiatorType === 'video' || r.initiatorType === 'audio') {
                  add(url, { type: 'video', source: 'performance-media' });
                }
              });
            }

            // 2. 监听后续加载的资源
            if (window.PerformanceObserver) {
              try {
                const observer = new PerformanceObserver((list) => {
                  list.getEntries().forEach(entry => {
                    const url = entry.name;
                    if (!url) return;
                    if (VIDEO_EXT_RE.test(url) || STREAM_RE.test(url)) {
                      add(url, { type: 'video', source: 'performance-observer' });
                    }
                    if (entry.initiatorType === 'video' || entry.initiatorType === 'audio') {
                      add(url, { type: 'video', source: 'performance-observer-media' });
                    }
                  });
                });
                observer.observe({ entryTypes: ['resource'] });
              } catch(e) {}
            }

            // 3. Hook XMLHttpRequest —— 同时捕获 URL 和 Response Content-Type
            const origOpen = XMLHttpRequest.prototype.open;
            const origSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = function(method, url) {
              this._url = url;
              this._method = method;
              return origOpen.apply(this, arguments);
            };
            XMLHttpRequest.prototype.send = function() {
              const xhr = this;
              const checkResponse = function() {
                try {
                  const ct = xhr.getResponseHeader('content-type') || '';
                  const url = xhr._url || '';
                  if (VIDEO_MIME_RE.test(ct)) {
                    add(url, { type: 'video', mimeType: ct, source: 'xhr-mime' });
                  } else if (VIDEO_EXT_RE.test(url) || STREAM_RE.test(url)) {
                    add(url, { type: 'video', source: 'xhr-url' });
                  }
                } catch(e) {}
              };
              xhr.addEventListener('load', checkResponse);
              xhr.addEventListener('readystatechange', function() {
                if (xhr.readyState === 4) checkResponse();
              });
              return origSend.apply(this, arguments);
            };

            // 4. Hook fetch —— 同时捕获 URL 和 Response Content-Type
            const origFetch = window.fetch;
            window.fetch = function(input, init) {
              const url = typeof input === 'string' ? input : (input && input.url) ? input.url : '';
              return origFetch.apply(this, arguments).then(response => {
                try {
                  const ct = response.headers.get('content-type') || '';
                  if (VIDEO_MIME_RE.test(ct)) {
                    add(url, { type: 'video', mimeType: ct, source: 'fetch-mime' });
                  } else if (VIDEO_EXT_RE.test(url) || STREAM_RE.test(url)) {
                    add(url, { type: 'video', source: 'fetch-url' });
                  }
                } catch(e) {}
                return response;
              }).catch(err => { throw err; });
            };

            // 5. Hook HTMLMediaElement.src setter —— 捕获 blob: URL 和动态设置的 src
            const origSrcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
            if (origSrcDesc && origSrcDesc.set) {
              Object.defineProperty(HTMLMediaElement.prototype, 'src', {
                get() { return origSrcDesc.get.call(this); },
                set(v) {
                  if (v) {
                    const isBlob = String(v).startsWith('blob:');
                    add(v, { type: isBlob ? 'blob' : 'video', source: 'media-src' });
                  }
                  return origSrcDesc.set.call(this, v);
                }
              });
            }

            // 6. Hook URL.createObjectURL —— 捕获 MediaSource 和 Blob
            const origCreateObjectURL = URL.createObjectURL;
            URL.createObjectURL = function(obj) {
              const url = origCreateObjectURL.call(this, obj);
              if (obj instanceof MediaSource) {
                add(url, { type: 'mse', source: 'createObjectURL-mse' });
              } else if (obj instanceof Blob) {
                if (obj.type && VIDEO_MIME_RE.test(obj.type)) {
                  add(url, { type: 'blob', mimeType: obj.type, source: 'createObjectURL-blob' });
                }
              }
              return url;
            };

            // 7. Hook MediaSource.addSourceBuffer —— 记录 MSE 流的 MIME 类型
            const origAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
            MediaSource.prototype.addSourceBuffer = function(mimeType) {
              // 可以在这里记录 mimeType，但 URL 已经在 createObjectURL 中捕获
              return origAddSourceBuffer.call(this, mimeType);
            };

            // 8. Hook SourceBuffer.appendBuffer —— 捕获通过 appendBuffer 传入的数据来源
            const origAppendBuffer = SourceBuffer.prototype.appendBuffer;
            SourceBuffer.prototype.appendBuffer = function(data) {
              // 某些播放器会在这里传入 ArrayBuffer，我们无法直接知道 URL
              // 但 MediaSource 的 URL 已经被 createObjectURL 捕获了
              return origAppendBuffer.call(this, data);
            };

            // 9. MutationObserver —— 监听新增 video/audio 元素
            if (window.MutationObserver) {
              const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                  mutation.addedNodes.forEach((node) => {
                    if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
                      if (node.src) add(node.src, { type: node.tagName === 'VIDEO' ? 'video' : 'audio', source: 'mutation' });
                      node.querySelectorAll && node.querySelectorAll('source').forEach(s => {
                        if (s.src) add(s.src, { type: node.tagName === 'VIDEO' ? 'video' : 'audio', source: 'mutation-source' });
                      });
                    }
                    if (node.querySelectorAll) {
                      node.querySelectorAll('video, audio').forEach(el => {
                        if (el.src) add(el.src, { type: el.tagName === 'VIDEO' ? 'video' : 'audio', source: 'mutation-nested' });
                        el.querySelectorAll('source').forEach(s => {
                          if (s.src) add(s.src, { type: el.tagName === 'VIDEO' ? 'video' : 'audio', source: 'mutation-nested-source' });
                        });
                      });
                    }
                  });
                });
              });
              observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
            }

            // 10. 扫描 srcObject
            document.querySelectorAll('video, audio').forEach(el => {
              if (el.srcObject) {
                // srcObject 是 MediaStream，无法直接下载，但可以标记
              }
            });

            window.__videoHook = {
              getUrls: () => {
                const result = [];
                captured.forEach((info, src) => {
                  let type = info.type || 'video';
                  // 根据 URL 和 MIME 类型进一步细分
                  const url = String(src).toLowerCase();
                  const mime = String(info.mimeType || '').toLowerCase();
                  if (url.includes('.m3u8') || mime.includes('mpegurl') || mime.includes('x-mpegurl')) {
                    type = 'm3u8';
                  } else if (url.includes('.mpd') || mime.includes('dash')) {
                    type = 'video'; // mpd
                  } else if (url.startsWith('blob:')) {
                    type = info.type === 'mse' ? 'mse' : 'blob';
                  }
                  result.push({ src, type, mimeType: info.mimeType || '', source: info.source });
                });
                return result;
              }
            };
          })();
        `);

        // 获取所有视频
        const result: DetectedVideo[] = await wv.executeJavaScript(`
          (function() {
            const videos = [];
            const seen = new Set();
            function add(src, type, mimeType, title) {
              if (src && !seen.has(src)) {
                seen.add(src);
                videos.push({ src, type, mimeType: mimeType || '', title: title || '' });
              }
            }

            // DOM 扫描
            document.querySelectorAll('video').forEach(v => {
              if (v.src) add(v.src, 'video', '', v.title || v.getAttribute('data-title') || '');
              v.querySelectorAll('source').forEach(s => { if (s.src) add(s.src, 'video', s.type || '', ''); });
            });
            document.querySelectorAll('audio').forEach(a => {
              if (a.src) add(a.src, 'audio', '', a.title || '');
              a.querySelectorAll('source').forEach(s => { if (s.src) add(s.src, 'audio', s.type || '', ''); });
            });
            document.querySelectorAll('iframe').forEach(f => {
              const src = f.src;
              if (src && /youtube|bilibili|vimeo|youku|tudou|iqiyi|dailymotion|facebook|twitter|instagram|tiktok/.test(src)) {
                add(src, 'iframe', '', '');
              }
            });

            // Hook 捕获的动态资源
            if (window.__videoHook) {
              window.__videoHook.getUrls().forEach(v => add(v.src, v.type, v.mimeType, ''));
            }

            // 检测 HLS.js 等播放器暴露的媒体信息
            if (window.hls && window.hls.url) {
              add(window.hls.url, 'm3u8', '', '');
            }
            if (window.dash && window.dash.getSource && window.dash.getSource()) {
              add(window.dash.getSource(), 'video', '', '');
            }
            if (window.player && window.player.src) {
              add(window.player.src, 'video', '', '');
            }
            if (window.videojs && window.videojs.getPlayers) {
              Object.values(window.videojs.getPlayers()).forEach(p => {
                if (p.src && p.src()) add(p.src(), 'video', '', '');
                if (p.currentSrc && p.currentSrc()) add(p.currentSrc(), 'video', '', '');
              });
            }

            return videos;
          })()
        `);
        setVideos((prev) => {
          const newVideos = result || [];
          if (newVideos.length === 0) return prev; // 没检测到新视频，保留已有结果
          const map = new Map<string, DetectedVideo>();
          // 已检测到的在前，保持顺序稳定
          prev.forEach((v) => map.set(v.src, v));
          newVideos.forEach((v: DetectedVideo) => {
            if (!map.has(v.src)) map.set(v.src, v);
          });
          return Array.from(map.values());
        });
      } catch (e) {
        console.error('Detect videos failed:', e);
        // 出错不清空已有列表
      }
    }, []);

    // 多次轮询检测（初始 burst + 持续轮询）
    const scheduleDetectVideos = useCallback((wv: any) => {
      if (!wv) return;

      // 清除之前的定时器
      if (videoPollRef.current) {
        clearInterval(videoPollRef.current);
        videoPollRef.current = null;
      }

      // 立即检测一次
      detectVideos(wv);

      // 初始 burst：快速多次检测，应对页面动态加载
      const delays = [1000, 2000, 3000, 5000, 8000];
      const timers: NodeJS.Timeout[] = [];
      delays.forEach((d) => {
        timers.push(setTimeout(() => detectVideos(wv), d));
      });

      // burst 结束后启动持续轮询，每隔 10 秒检测一次新资源
      timers.push(setTimeout(() => {
        videoPollRef.current = setInterval(() => {
          if (wv && !wv.isDestroyed?.()) {
            detectVideos(wv);
          }
        }, 10_000);
      }, 10_000)); // 在首次检测后 10 秒开启轮询，与 burst 最后一批错开

      return () => {
        timers.forEach((t) => clearTimeout(t));
        if (videoPollRef.current) {
          clearInterval(videoPollRef.current);
          videoPollRef.current = null;
        }
      };
    }, [detectVideos]);

    // 组件卸载时清理轮询定时器
    useEffect(() => {
      return () => {
        if (videoPollRef.current) {
          clearInterval(videoPollRef.current);
          videoPollRef.current = null;
        }
      };
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
            // 切换 URL 时清理轮询
            if (videoPollRef.current) {
              clearInterval(videoPollRef.current);
              videoPollRef.current = null;
            }
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
              scheduleDetectVideos(wv);
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
