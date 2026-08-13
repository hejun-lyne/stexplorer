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
    const videoTimersRef = useRef<NodeJS.Timeout[]>([]);
    const webViewReadyRef = useRef(false);
    const prevHookDebugLenRef = useRef(0);
    const prevHookUrlsLenRef = useRef(0);
    const dispatch = useDispatch();

    // 检测网页中的视频（含 m3u8/mpd 等流媒体）
    const detectVideos = useCallback(async (wv: any, source = 'unknown') => {
      // WebView 必须已 attach 到 DOM 且 dom-ready 已触发才能调用 executeJavaScript
      if (!wv || wv.isDestroyed?.() || !webViewReadyRef.current) {
        console.log('[DetectVideos] skip', { source, ready: webViewReadyRef.current });
        return;
      }
      try {
        console.log('[DetectVideos] start', { source, url: wv.getURL ? wv.getURL() : '' });
        // 注入增强版资源捕获 hook
        await wv.executeJavaScript(`
          (function() {
            // 诊断日志：收集到 window.__videoHookDebug，由主流程读取并打印
            window.__videoHookDebug = window.__videoHookDebug || [];
            function dbg(msg, data) {
              try { window.__videoHookDebug.push({ t: Date.now(), msg: msg, data: data || null }); } catch (e) {}
            }
            if (window.__videoHook) { dbg('hook-exists', { url: location.href }); return; }
            dbg('hook-inject-start', { url: location.href });
            const captured = new Map();
            const seen = new Set();
            function add(src, info) {
              if (!src) return;
              // 强制转字符串，避免对象作为 Map key 导致返回时数据丢失
              src = String(src);
              if (!src || seen.has(src)) return;
              seen.add(src);
              captured.set(src, info);
              dbg('captured', { src: src.slice(0, 300), info: info });
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

            dbg('hook-inject-end', {
              existingResources: (window.performance && window.performance.getEntriesByType) ? window.performance.getEntriesByType('resource').length : -1,
              videoEls: document.querySelectorAll('video').length,
              audioEls: document.querySelectorAll('audio').length,
              iframes: document.querySelectorAll('iframe').length,
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
        const rawResult: any = await wv.executeJavaScript(`
          (function() {
            var error = null;
            var videos = [];
            var domCount = 0, hookCount = 0, playerCount = 0, perfCount = 0;
            var hookUrls = [];
            var hookDebug = [];
            function add(src, type, mimeType, title) {
              if (!src) return;
              // 强制转字符串，避免把对象/函数/DOM 节点放进列表导致 IPC 克隆失败
              src = String(src);
              if (!src || src.indexOf('[object') === 0) return;
              if (!seen.has(src)) {
                seen.add(src);
                videos.push({ src: src, type: type, mimeType: mimeType || '', title: title || '' });
              }
            }
            var seen = new Set();
            try {
              // 1. performance 资源扫描（每次轮询都扫，可捕获 hook 注入前发起的 m3u8 请求）
              if (window.performance && window.performance.getEntriesByType) {
                var VIDEO_MIME_RE = /video|audio|mpegurl|mp2t|dash|x-matroska|webm|mp4|flv/i;
                var VIDEO_EXT_RE = /\\.(m3u8|mpd|ts|flv|mp4|webm|mkv|mov|3gp)(\\?|$|#)/i;
                var STREAM_RE = /(m3u8|mpd|\\/stream|\\/video|\\/play|\\/live|\\/hls|\\/dash)/i;
                window.performance.getEntriesByType('resource').forEach(function(r) {
                  var url = r.name;
                  if (!url) return;
                  if (VIDEO_EXT_RE.test(url) || STREAM_RE.test(url)) {
                    add(url, 'video', '', '');
                    perfCount++;
                  }
                  if (r.initiatorType === 'video' || r.initiatorType === 'audio') {
                    add(url, 'video', '', '');
                    perfCount++;
                  }
                });
              }

              // 2. DOM 扫描（blob: src 标记为 mse 类型）
              document.querySelectorAll('video').forEach(function(v) {
                if (v.src) {
                  var isBlob = String(v.src).indexOf('blob:') === 0;
                  add(v.src, isBlob ? 'mse' : 'video', '', v.title || v.getAttribute('data-title') || '');
                  domCount++;
                }
                v.querySelectorAll('source').forEach(function(s) { if (s.src) { add(s.src, 'video', s.type || '', ''); domCount++; } });
              });
              document.querySelectorAll('audio').forEach(function(a) {
                if (a.src) { add(a.src, 'audio', '', a.title || ''); domCount++; }
                a.querySelectorAll('source').forEach(function(s) { if (s.src) { add(s.src, 'audio', s.type || '', ''); domCount++; } });
              });
              document.querySelectorAll('iframe').forEach(function(f) {
                var src = f.src;
                if (src && /youtube|bilibili|vimeo|youku|tudou|iqiyi|dailymotion|facebook|twitter|instagram|tiktok/.test(src)) {
                  add(src, 'iframe', '', '');
                  domCount++;
                }
              });

              // 3. Hook 捕获的动态资源
              hookUrls = (window.__videoHook && window.__videoHook.getUrls) ? window.__videoHook.getUrls() : [];
              hookUrls.forEach(function(v) { add(v.src, v.type, v.mimeType, ''); hookCount++; });

              // 4. 检测 HLS.js 等播放器暴露的媒体信息
              if (window.hls && window.hls.url) {
                add(window.hls.url, 'm3u8', '', '');
                playerCount++;
              }
              if (window.dash && window.dash.getSource && window.dash.getSource()) {
                add(window.dash.getSource(), 'video', '', '');
                playerCount++;
              }
              if (window.player && window.player.src) {
                add(window.player.src, 'video', '', '');
                playerCount++;
              }
              if (window.videojs && window.videojs.getPlayers) {
                Object.values(window.videojs.getPlayers()).forEach(function(p) {
                  if (p.src && p.src()) { add(p.src(), 'video', '', ''); playerCount++; }
                  if (p.currentSrc && p.currentSrc()) { add(p.currentSrc(), 'video', '', ''); playerCount++; }
                });
              }
            } catch (err) {
              error = String((err && err.stack) || err);
            }
            hookDebug = window.__videoHookDebug || [];
            // 返回 JSON 字符串，规避 IPC 结构化克隆失败（An object could not be cloned）
            var resultObj = {
              videos: videos,
              stats: { domCount: domCount, hookCount: hookCount, playerCount: playerCount, perfCount: perfCount, total: videos.length },
              debug: {
                hookExists: !!(window.__videoHook && window.__videoHook.getUrls),
                hookUrls: hookUrls,
                hookDebug: hookDebug.slice(-200),
                videoEls: document.querySelectorAll('video').length,
                audioEls: document.querySelectorAll('audio').length,
                error: error,
              },
            };
            try {
              return JSON.stringify(resultObj);
            } catch (err) {
              return JSON.stringify({ videos: [], stats: { domCount: 0, hookCount: 0, playerCount: 0, perfCount: 0, total: 0 }, debug: { hookExists: false, hookUrls: [], hookDebug: [], videoEls: 0, audioEls: 0, error: 'stringify-failed: ' + String(err) } });
            }
          })()
        `);

        // executeJavaScript 返回值经过 IPC 序列化，收到的可能是 JSON 字符串
        let result: any = rawResult;
        if (typeof rawResult === 'string') {
          try { result = JSON.parse(rawResult); } catch (e) { result = null; }
        }

        // 打印诊断日志（仅新增部分，避免轮询刷屏）
        console.log('[DetectVideos]', source, JSON.stringify(result?.stats), 'hookExists:', result?.debug?.hookExists, 'videoEls:', result?.debug?.videoEls, 'err:', result?.debug?.error || null);
        const hookDebug: any[] = result?.debug?.hookDebug || [];
        if (hookDebug.length < prevHookDebugLenRef.current) prevHookDebugLenRef.current = 0; // hook 被重新注入，debug 被清空
        if (hookDebug.length > prevHookDebugLenRef.current) {
          console.log('[DetectVideos] hookDebug+', JSON.stringify(hookDebug.slice(prevHookDebugLenRef.current)));
          prevHookDebugLenRef.current = hookDebug.length;
        }
        const hookUrls: any[] = result?.debug?.hookUrls || [];
        if (hookUrls.length < prevHookUrlsLenRef.current) prevHookUrlsLenRef.current = 0;
        if (hookUrls.length > prevHookUrlsLenRef.current) {
          console.log('[DetectVideos] hookUrls+', JSON.stringify(hookUrls.slice(prevHookUrlsLenRef.current)));
          prevHookUrlsLenRef.current = hookUrls.length;
        }

        setVideos((prev) => {
          const newVideos: DetectedVideo[] = result?.videos || [];
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
        console.error('Detect videos failed:', e, 'source:', source);
        // 出错不清空已有列表
      }
    }, []);

    // 多次轮询检测（初始 burst + 持续轮询）
    const scheduleDetectVideos = useCallback((wv: any, source = 'did-finish-load') => {
      if (!wv) return;

      // 清除之前的定时器
      cleanupVideoPoll();

      // 立即检测一次
      detectVideos(wv, source + '-immediate');

      // 初始 burst：快速多次检测，应对页面动态加载
      const delays = [1000, 2000, 3000, 5000, 8000];
      delays.forEach((d) => {
        videoTimersRef.current.push(setTimeout(() => detectVideos(wv, 'burst'), d));
      });

      // burst 结束后启动持续轮询，每隔 10 秒检测一次新资源
      videoTimersRef.current.push(setTimeout(() => {
        videoPollRef.current = setInterval(() => {
          detectVideos(wv, 'poll');
        }, 10_000);
      }, 10_000)); // 在首次检测后 10 秒开启轮询，与 burst 最后一批错开
    }, [detectVideos]);

    // 清理所有视频检测定时器
    const cleanupVideoPoll = useCallback(() => {
      videoTimersRef.current.forEach((t) => clearTimeout(t));
      videoTimersRef.current = [];
      if (videoPollRef.current) {
        clearInterval(videoPollRef.current);
        videoPollRef.current = null;
      }
    }, []);

    // blob:/MSE 视频下载：主进程无法直接访问 blob: 协议，需在 webview 页面内 fetch 出数据，
    // 分块以 base64 回传，由主进程写入文件
    const downloadBlobVideo = useCallback(async (blobUrl: string, savePath: string, onProgress: (p: number) => void) => {
      const wv = cans.wv;
      if (!wv || wv.isDestroyed?.() || !webViewReadyRef.current) {
        throw new Error('WebView 未就绪，请稍后重试');
      }
      const { ipcRenderer } = window.contextModules.electron;

      // 第一步：优先捕获底层 m3u8/分片 URL，交给主进程下载并合成；捕获不到再回退 blob 直读
      try {
        const urlsResult: any = await wv.executeJavaScript(
          `(function() {
            try {
              var h = window.__videoHook;
              if (h && h.getUrls) { return h.getUrls(); }
            } catch(e) {}
            return [];
          })()`
        );
        if (Array.isArray(urlsResult) && urlsResult.length > 0) {
          const m3u8s = (urlsResult as any[]).filter((u: any) => {
            const src = String((u && u.src !== undefined) ? u.src : (u || ''));
            const type = String((u && u.type) || '');
            const mime = String((u && u.mimeType) || '').toLowerCase();
            return src.includes('.m3u8') || type === 'm3u8' || mime.includes('mpegurl');
          });
          if (m3u8s.length > 0) {
            const raw = m3u8s[m3u8s.length - 1];
            const m3u8Url = String(raw && raw.src !== undefined ? raw.src : raw);
            console.log('[DownloadBlob] 捕获到底层 m3u8，使用 m3u8 下载合成:', m3u8Url);
            // 复用主进程 m3u8 下载/合成能力，并把进度转发给 UI
            return await new Promise<void>((resolve, reject) => {
              const progressHandler = (_: any, data: { url: string; progress: number }) => {
                if (data.url === m3u8Url) onProgress(data.progress);
              };
              ipcRenderer.on('download-video-progress', progressHandler);
              ipcRenderer
                .invoke('download-video-advanced', { url: m3u8Url, savePath, isM3U8: true })
                .then(() => {
                  onProgress(100);
                  resolve();
                })
                .catch((e: any) => reject(e))
                .finally(() => {
                  ipcRenderer.off('download-video-progress', progressHandler);
                });
            });
          }
        }
      } catch (e) {
        console.warn('[DownloadBlob] 捕获 m3u8 失败，回退 blob 直读:', e);
      }

      // 兜底：在页面内 fetch blob → ArrayBuffer，建立分块读取器
      const initCode = `
        (async function() {
          try {
            var url = ${JSON.stringify(blobUrl)};
            var resp = await fetch(url);
            if (!resp.ok) return { error: 'HTTP ' + resp.status, total: 0 };
            var buf = await resp.arrayBuffer();
            var CHUNK = 2 * 1024 * 1024;
            var offset = 0;
            window.__blobDownloadState = { buf: buf, offset: offset, total: buf.byteLength, CHUNK: CHUNK };
            window.__blobDownloadNext = function() {
              var s = window.__blobDownloadState;
              if (!s || s.offset >= s.total) return { done: true, data: '' };
              var end = Math.min(s.offset + s.CHUNK, s.total);
              var bytes = new Uint8Array(s.buf, s.offset, end - s.offset);
              var binary = '';
              var len = bytes.length;
              for (var i = 0; i < len; i += 0x8000) {
                binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 0x8000, len)));
              }
              s.offset = end;
              return { done: s.offset >= s.total, data: btoa(binary) };
            };
            return { error: null, total: buf.byteLength };
          } catch (e) {
            return { error: String((e && e.message) || e), total: 0 };
          }
        })()
      `;
      const initResult: any = await wv.executeJavaScript(initCode);
      if (!initResult || initResult.error) {
        throw new Error('读取 blob 失败: ' + (initResult?.error || '未知错误') + '（blob 可能已随页面跳转失效，请重新播放视频后再试）');
      }
      const total: number = initResult.total || 0;
      if (total <= 0) throw new Error('blob 内容为空，无法下载');

      // 第二步：循环读取分块，逐块写入文件
      let received = 0;
      let first = true;
      for (;;) {
        const chunkResult: any = await wv.executeJavaScript('window.__blobDownloadNext()');
        if (!chunkResult || chunkResult.done) break;
        const data: string = chunkResult.data;
        if (data) {
          await ipcRenderer.invoke('blob-download-chunk', { savePath, data, append: !first });
          first = false;
          received += Math.floor((data.length * 3) / 4); // base64 长度换算回字节数
          onProgress(Math.min(99, Math.round((received / total) * 100)));
        }
      }
      onProgress(100);
      // 释放页面内临时数据
      try {
        await wv.executeJavaScript('delete window.__blobDownloadState; delete window.__blobDownloadNext;');
      } catch (e) {}
    }, [cans.wv]);

    // 组件卸载时清理轮询定时器
    useEffect(() => {
      return () => {
        cleanupVideoPoll();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
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
          onDownloadBlob={downloadBlobVideo}
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
            // 切换 URL 时清理轮询和重置就绪状态
            cleanupVideoPoll();
            webViewReadyRef.current = false;
            prevHookDebugLenRef.current = 0;
            prevHookUrlsLenRef.current = 0;
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
              webViewReadyRef.current = true;
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
              webViewReadyRef.current = true;
              e.target.insertCSS('.no-select{ -webkit-user-select: auto !important; user-select: auto !important;}');
              detectVideos(e.target, 'dom-ready');
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
