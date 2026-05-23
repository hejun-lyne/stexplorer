/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `yarn build` or `yarn build:main`, this file is compiled to
 * `./src/main.prod.js` using webpack. This gives us some performance wins.
 */

import { app, globalShortcut, ipcMain, nativeTheme, dialog } from 'electron';
import { get } from 'https';
import { get as httpGet } from 'http';
import got from 'got';
import windowStateKeeper from 'electron-window-state';
import contextMenu from 'electron-context-menu';
import { appIcon, generateWalletIcon } from './icon';
import { createTray } from './tray';
import { createMenubar, buildContextMenu } from './menubar';
import { lockSingleInstance, checkEnvTool, getAssetPath } from './util';
import { createMainWindow, creatWorkerWindow } from './window';
import log from 'electron-log';
import * as fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { resolve } from 'path';
import { PythonShell } from 'python-shell';
// import ElectronStore from 'electron-store';
import * as ts from 'typescript';
import { PromiseWorker } from './promiseWorker';
import * as localFileStorage from './localFileStorage';

let willQuitApp = false;

// ===== 辅助函数：健壮地解析 Kimi API 错误 =====
function parseKimiError(e: any): string {
  // 1. 优先尝试解析 response body（JSON 或纯文本）
  const body = e.response?.body;
  let msg = '';

  if (body) {
    if (typeof body === 'string' && body.trim()) {
      try {
        const parsed = JSON.parse(body);
        msg = parsed.error?.message || parsed.message || body.trim();
      } catch {
        msg = body.trim();
      }
    } else if (typeof body === 'object') {
      msg = body.error?.message || body.message || JSON.stringify(body);
    }
  }

  // 2. got 特定的传输层错误（比 HTTP 状态码更具体）
  if (!msg && e.message && e.message !== 'undefined' && e.message !== '') {
    msg = e.message;
  }

  // 3. 网络错误码
  if (!msg && e.code) {
    msg = `网络错误: ${e.code}`;
  }

  // 4. HTTP 状态码（仅当非 2xx 时才作为错误信息）
  if (!msg) {
    const statusCode = e.response?.statusCode || e.statusCode;
    if (statusCode && (statusCode < 200 || statusCode >= 300)) {
      const statusMessage = e.response?.statusMessage || e.statusMessage;
      msg = `HTTP ${statusCode}${statusMessage ? ` ${statusMessage}` : ''}`;
    }
  }

  // 5. 最后的兜底
  if (!msg) {
    msg = '请求失败（服务端返回异常空响应）';
  }

  console.error('[Kimi API Full Error]', {
    message: e.message,
    code: e.code,
    statusCode: e.response?.statusCode,
    statusMessage: e.response?.statusMessage,
    body: e.response?.body,
    stack: e.stack?.split('\n').slice(0, 3),
  });

  return msg;
}

// ===== 判断错误是否值得重试 =====
function shouldRetryKimi(error: any): boolean {
  const status = error.response?.statusCode;
  const code = error.code;
  const message = (error.message || '').toLowerCase();

  // 绝不重试
  if (status === 401) return false;
  if (status === 400) return false;
  if (status === 413) return false;
  if (message.includes('invalid api key')) return false;

  // 可以重试
  if ([408, 429, 500, 502, 503, 504, 529].includes(status)) return true;
  if (['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED'].includes(code)) return true;
  if (message.includes('overloaded')) return true;
  if (message.includes('too many requests')) return true;

  return false;
}

// ===== 计算退避时间 =====
function getRetryDelay(error: any, attemptCount: number): number {
  const status = error.response?.statusCode;
  const message = (error.message || '').toLowerCase();

  // 过载错误：指数退避 + 随机抖动
  if (status === 503 || status === 529 || message.includes('overloaded')) {
    const base = 6000;
    const jitter = Math.floor(Math.random() * 4000);
    return base * attemptCount + jitter;
  }

  // 限流
  if (status === 429 || message.includes('too many requests')) {
    return 5000;
  }

  // 其他
  return attemptCount * 3000;
}

async function init() {
  console.log('当前工作目录：' + app.getAppPath());
  lockSingleInstance();
  Object.assign(console, log.functions);
  contextMenu();

  await app.whenReady();
  await checkEnvTool();
  
  // 注册全局快捷键打开/关闭开发者工具
  globalShortcut.register('F12', () => {
    const focusedWindow = require('electron').BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      if (focusedWindow.webContents.isDevToolsOpened()) {
        focusedWindow.webContents.closeDevTools();
      } else {
        focusedWindow.webContents.openDevTools({ mode: 'undocked' });
      }
    }
  });
  globalShortcut.register('Alt+Command+I', () => {
    const focusedWindow = require('electron').BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      if (focusedWindow.webContents.isDevToolsOpened()) {
        focusedWindow.webContents.closeDevTools();
      } else {
        focusedWindow.webContents.openDevTools({ mode: 'undocked' });
      }
    }
  });
  log.info('DevTools shortcuts registered: F12, Cmd+Option+I');
  
  const mainWindow = full();

  if (process.platform === 'darwin') {
    app.dock.hide();
  }
  new PromiseWorker(
    worker(),
    (error, text) => mainWindow.webContents.send('on-console-log', text),
    (error, progress) => mainWindow.webContents.send('on-progress-log', progress)
  );

  const mb = mini();
  ipcMain.handle('show-current-window', () => {
    mainWindow.show();
    mb.hideWindow();
  });

  mainWindow.on('close', function(e) {
    if (!willQuitApp) {
      e.preventDefault();
      mainWindow.hide();
      mainWindow.setSkipTaskbar(true);
    }
  });
  app.on('before-quit', function () {
    willQuitApp = true;
  });
  app.on('window-all-closed', () => {
    console.log('[Main] App closing, local file storage is safe');
    if (process.platform !== 'darwin') {
      app.quit()
    }
  });

  app.on('browser-window-focus', function (event, window) {
    globalShortcut.register('CommandOrControl+W', () => {
      window.webContents.send('close-current-tab');
    });
    if (app.isPackaged) {
      globalShortcut.register('CommandOrControl+Shift+R', () => {
        console.log('CommandOrControl+Shift+R is pressed: Shortcut Disabled');
      });
      globalShortcut.register('CommandOrControl+R', () => {
        console.log('CommandOrControl+R is pressed: Shortcut Disabled');
      });
      globalShortcut.register('F5', () => {
        console.log('F5 is pressed: Shortcut Disabled');
      });
    }
  });
  app.on('browser-window-blur', function (event, window) {
    globalShortcut.unregister('CommandOrControl+W');
    if (app.isPackaged) {
      globalShortcut.unregister('CommandOrControl+R');
      globalShortcut.unregister('F5');
      globalShortcut.unregister('CommandOrControl+Shift+R');
    }
  });

  // ipcMain 主进程相关监听
  ipcMain.handle('show-message-box', async (event, config) => {
    return dialog.showMessageBox(config);
  });
  ipcMain.handle('show-save-dialog', async (event, config) => {
    return dialog.showSaveDialog(config);
  });
  ipcMain.handle('show-open-dialog', async (event, config) => {
    return dialog.showOpenDialog(config);
  });
  ipcMain.handle('get-should-use-dark-colors', (event, config) => {
    return nativeTheme.shouldUseDarkColors;
  });
  ipcMain.handle('set-native-theme-source', (event, config) => {
    nativeTheme.themeSource = config;
  });
  ipcMain.handle('set-login-item-settings', (event, config) => {
    app.setLoginItemSettings(config);
  });
  ipcMain.handle('save-string-silently', async (event, config) => {
    const path = `${app.getAppPath()}/${config.fileName}`;
    fs.writeFileSync(path, config.content);
    return path;
  });
  ipcMain.handle('save-tmpstring-silently', async (event, config) => {
    const path = `${app.getPath('temp')}/${config.fileName}`;
    fs.writeFileSync(path, config.content);
    return path;
  });
  ipcMain.handle('compile-ts-source', async (event, config) => {
    const result = ts.transpileModule(config.source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    });
    return result;
  });
  ipcMain.handle('download-video', async (event, { url, savePath }: { url: string; savePath: string }) => {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(savePath);
      const client = url.startsWith('https') ? get : httpGet;
      client(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Status Code: ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(savePath);
        });
      }).on('error', (err) => {
        fs.unlink(savePath, () => {});
        reject(err);
      });
      file.on('error', (err) => {
        fs.unlink(savePath, () => {});
        reject(err);
      });
    });
  });

  // 高级视频下载
  ipcMain.handle('download-video-advanced', async (event, { url, savePath, isM3U8 }: { url: string; savePath: string; isM3U8?: boolean }) => {
    const sendProgress = (progress: number) => {
      event.sender.send('download-video-progress', { url, progress });
    };

    const downloadStream = async (downloadUrl: string, outputPath: string, onProgress?: (received: number, total: number) => void) => {
      const stream = got.stream(downloadUrl, {
        retry: 2,
        timeout: { request: 30000 },
        followRedirect: true,
      });
      const writeStream = fs.createWriteStream(outputPath);
      return new Promise<void>((resolve, reject) => {
        let received = 0;
        let total = 0;
        stream.on('response', (res) => {
          const cl = res.headers['content-length'];
          total = parseInt(Array.isArray(cl) ? cl[0] : (cl || '0'), 10);
        });
        stream.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (onProgress && total > 0) {
            onProgress(received, total);
          }
        });
        stream.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('finish', () => {
          writeStream.close();
          resolve();
        });
        stream.pipe(writeStream);
      });
    };

    const downloadM3U8 = async (m3u8Url: string, outputPath: string): Promise<string> => {
      const m3u8Text = await got(m3u8Url, {
        retry: 2,
        timeout: { request: 15000 },
        followRedirect: true,
      }).text();

      const lines = m3u8Text.split(/\r?\n/);
      const tsUrls: string[] = [];
      let hasEncryption = false;
      const lastSlashIdx = m3u8Url.lastIndexOf('/');
      const baseUrl = lastSlashIdx > 0 ? m3u8Url.substring(0, lastSlashIdx + 1) : m3u8Url + '/';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-KEY')) {
          hasEncryption = true;
        }
        if (line.startsWith('#')) continue;
        if (!line) continue;
        if (line.startsWith('http')) {
          tsUrls.push(line);
        } else {
          tsUrls.push(baseUrl + line);
        }
      }

      if (tsUrls.length === 0) {
        let bestBandwidth = 0;
        let bestUrl = '';
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith('#EXT-X-STREAM-INF')) {
            const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
            const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0;
            const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';
            if (nextLine && !nextLine.startsWith('#')) {
              if (bandwidth > bestBandwidth) {
                bestBandwidth = bandwidth;
                bestUrl = nextLine;
              }
            }
          }
        }
        if (bestUrl) {
          const subUrl = bestUrl.startsWith('http') ? bestUrl : baseUrl + bestUrl;
          return downloadM3U8(subUrl, outputPath);
        }
        throw new Error('M3U8 中未找到有效的 TS 分片');
      }

      if (hasEncryption) {
        throw new Error('M3U8 使用了 AES-128 加密，暂不支持下载加密视频');
      }

      const tmpDir = path.join(app.getPath('temp'), `m3u8_${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      const outputStream = fs.createWriteStream(outputPath);

      for (let i = 0; i < tsUrls.length; i++) {
        const tsUrl = tsUrls[i];
        const tsPath = path.join(tmpDir, `seg_${i.toString().padStart(5, '0')}.ts`);
        try {
          await downloadStream(tsUrl, tsPath);
        } catch (e) {
          outputStream.destroy();
          fs.rmSync(tmpDir, { recursive: true, force: true });
          throw new Error(`下载 TS 分片 ${i + 1}/${tsUrls.length} 失败: ${tsUrl}`);
        }
        const tsBuffer = fs.readFileSync(tsPath);
        outputStream.write(tsBuffer);
        fs.unlinkSync(tsPath);
        sendProgress(((i + 1) / tsUrls.length) * 100);
      }

      await new Promise<void>((resolve, reject) => {
        outputStream.on('finish', resolve);
        outputStream.on('error', reject);
        outputStream.end();
      });
      fs.rmSync(tmpDir, { recursive: true, force: true });
      sendProgress(100);
      return outputPath;
    };

    try {
      let finalIsM3U8 = isM3U8;
      if (!finalIsM3U8) {
        try {
          const headRes = await got.head(url, { retry: 2, timeout: { request: 10000 }, followRedirect: true });
          const ct = headRes.headers['content-type'] || '';
          if (/mpegurl|x-mpegurl|m3u8/i.test(ct)) {
            finalIsM3U8 = true;
          }
        } catch (e) {
          finalIsM3U8 = /\.m3u8([?#]|$)/i.test(url);
        }
      }

      if (!finalIsM3U8) {
        await downloadStream(url, savePath, (received, total) => {
          if (total > 0) sendProgress((received / total) * 100);
        });
        sendProgress(100);
        return savePath;
      }

      return await downloadM3U8(url, savePath);
    } catch (e: any) {
      sendProgress(0);
      throw e;
    }
  });

  // ===== Kimi AI 分析 IPC 处理程序（支持流式响应）=====
  ipcMain.handle('kimi-analyze-stock', async (event, { apiKey, prompt }: { apiKey: string; prompt: string }) => {
    try {
      const trimmedKey = (apiKey || '').trim();
      if (!trimmedKey) {
        return { error: 'API Key 未配置' };
      }
      if (!trimmedKey.startsWith('sk-')) {
        return { error: 'API Key 格式不正确，应以 sk- 开头' };
      }

      const stream = got.stream.post('https://api.moonshot.cn/v1/chat/completions', {
        headers: {
          Authorization: `Bearer ${trimmedKey}`,
          Accept: 'text/event-stream',
        },
        json: {
          model: 'kimi-k2.6',
          messages: [
            { role: 'system', content: '你是一位专业的股票分析师，擅长基本面分析、技术面分析、资金面分析和风险评估。请基于提供的数据给出客观、专业的分析意见。' },
            { role: 'user', content: prompt },
          ],
          temperature: 1,
          stream: true,
        },
        timeout: { 
          request: 120000,
          connect: 10000,
        },
        retry: {
          limit: 2,
          methods: ['POST'],
          statusCodes: [408, 413, 429, 500, 502, 503, 504, 529],
          errorCodes: ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED'],
          calculateDelay: ({ attemptCount, error }: any) => {
            if (!shouldRetryKimi(error)) return 0;
            return getRetryDelay(error, attemptCount);
          },
        },
        hooks: {
          beforeRetry: [
            (options: any, error: any, retryCount: any) => {
              const msg = parseKimiError(error);
              console.warn(`[Kimi] 流式第 ${retryCount} 次重试，原因: ${msg}`);
            },
          ],
        },
      });

      const destroyOnDisconnect = () => {
        console.log('[Kimi] Renderer disconnected, aborting stream to save tokens');
        stream.destroy();
      };
      event.sender.on('destroyed', destroyOnDisconnect);

      return new Promise<{ content?: string; error?: string }>((resolve) => {
        let buffer = '';
        let fullContent = '';
        let hasReceivedData = false;

        stream.on('data', (chunk: Buffer) => {
          hasReceivedData = true;
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === '[DONE]') continue;
            try {
              const data = JSON.parse(dataStr);
              const delta = data.choices?.[0]?.delta;
              if (delta?.content) {
                fullContent += delta.content;
                event.sender.send('kimi-analysis-chunk', { content: fullContent });
              }
            } catch {
              // 忽略解析失败的行
            }
          }
        });

        stream.on('end', () => {
          event.sender.off('destroyed', destroyOnDisconnect);
          if (!hasReceivedData && !fullContent) {
            resolve({ error: 'Kimi API 错误: 服务端未返回任何数据（可能是限流或模型过载）' });
            return;
          }
          resolve({ content: fullContent });
        });

        stream.on('error', (e: any) => {
          event.sender.off('destroyed', destroyOnDisconnect);
          console.error('Kimi stream error:', e);
          const msg = parseKimiError(e);
          resolve({ error: `Kimi API 错误: ${msg}` });
        });
      });
    } catch (e: any) {
      console.error('Kimi API error:', e);
      const msg = parseKimiError(e);
      return { error: `Kimi API 错误: ${msg}` };
    }
  });

  // ===== Kimi AI Tools 调用（支持 function calling + 过载降级）=====
  const pendingToolRequests = new Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void }>();

  ipcMain.handle('kimi-analyze-with-tools', async (event, { apiKey, messages, tools, sessionId }: { apiKey: string; messages: any[]; tools?: any[]; sessionId?: string }) => {
    try {
      const trimmedKey = (apiKey || '').trim();
      if (!trimmedKey) {
        return { error: 'API Key 未配置' };
      }
      if (!trimmedKey.startsWith('sk-')) {
        return { error: 'API Key 格式不正确，应以 sk- 开头' };
      }

      // ===== 第一步：非流式调用，带重试保护 =====
      let firstData: any;
      let firstAttempts = 0;
      const maxFirstAttempts = 3;

      while (firstAttempts < maxFirstAttempts) {
        try {
          const firstResponse = await got.post('https://api.moonshot.cn/v1/chat/completions', {
            headers: {
              Authorization: `Bearer ${trimmedKey}`,
              'Content-Type': 'application/json',
            },
            json: {
              model: 'kimi-k2.6',
              messages,
              tools: tools || [],
              temperature: 1,
              stream: false,
            },
            timeout: { 
              request: 120000,
              connect: 10000,
            },
            retry: {
              limit: 2,
              methods: ['POST'],
              statusCodes: [408, 413, 429, 500, 502, 503, 504, 529],
              errorCodes: ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED'],
              calculateDelay: ({ attemptCount, error }: any) => {
                if (!shouldRetryKimi(error)) return 0;
                return getRetryDelay(error, attemptCount);
              },
            },
            hooks: {
              beforeRetry: [
                (options: any, error: any, retryCount: any) => {
                  const msg = parseKimiError(error);
                  console.warn(`[Kimi] 第一步第 ${retryCount} 次重试，原因: ${msg}`);
                },
              ],
            },
          });
          firstData = JSON.parse(firstResponse.body);
          break; // 成功跳出循环
        } catch (e: any) {
          firstAttempts++;
          const msg = parseKimiError(e);
          const isOverloaded = msg.toLowerCase().includes('overloaded');

          if (firstAttempts >= maxFirstAttempts || !shouldRetryKimi(e)) {
            return { error: `Kimi API 错误(第一步): ${msg}` };
          }

          // 过载时通知用户
          if (isOverloaded) {
            event.sender.send('kimi-analysis-chunk', { 
              content: `⏳ 服务繁忙，正在自动重试（第 ${firstAttempts} 次）...` 
            });
          }

          const delay = getRetryDelay(e, firstAttempts);
          await new Promise(r => setTimeout(r, delay));
        }
      }

      const firstChoice = firstData?.choices?.[0];

      if (firstChoice?.finish_reason === 'tool_calls' && firstChoice?.message?.tool_calls?.length > 0) {
        const requestId = Date.now().toString() + Math.random().toString(36).slice(2);

        event.sender.send('kimi-tool-request', {
          requestId,
          sessionId,
          toolCalls: firstChoice.message.tool_calls,
        });

        const toolResults = await new Promise<any[]>((resolve, reject) => {
          pendingToolRequests.set(requestId, { resolve, reject });
          setTimeout(() => {
            if (pendingToolRequests.has(requestId)) {
              pendingToolRequests.delete(requestId);
              reject(new Error('工具调用超时'));
            }
          }, 30000);
        });

        const newMessages = [
          ...messages,
          firstChoice.message,
          ...toolResults,
        ];

        // ===== 第二步：流式调用，支持过载降级 =====
        const runStreamStep = (): Promise<{ content?: string; error?: string }> => {
          return new Promise((resolve) => {
            const stream = got.stream.post('https://api.moonshot.cn/v1/chat/completions', {
              headers: {
                Authorization: `Bearer ${trimmedKey}`,
                Accept: 'text/event-stream',
              },
              json: {
                model: 'kimi-k2.6',
                messages: newMessages,
                temperature: 1,
                stream: true,
              },
              timeout: { 
                request: 120000,
                connect: 10000,
              },
              retry: {
                limit: 2,
                methods: ['POST'],
                statusCodes: [408, 413, 429, 500, 502, 503, 504, 529],
                errorCodes: ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED'],
                calculateDelay: ({ attemptCount, error }: any) => {
                  if (!shouldRetryKimi(error)) return 0;
                  return getRetryDelay(error, attemptCount);
                },
              },
              hooks: {
                beforeRetry: [
                  (options: any, error: any, retryCount: any) => {
                    const msg = parseKimiError(error);
                    console.warn(`[Kimi] 第二步流式第 ${retryCount} 次重试，原因: ${msg}`);
                    event.sender.send('kimi-analysis-chunk', { 
                      content: `⏳ 服务繁忙，正在自动重试（第 ${retryCount} 次）...` 
                    });
                  },
                ],
              },
            });

            const destroyOnDisconnect = () => {
              console.log('[Kimi] Renderer disconnected (step 2), aborting stream');
              stream.destroy();
            };
            event.sender.on('destroyed', destroyOnDisconnect);

            let buffer = '';
            let fullContent = '';
            let hasReceivedData = false;

            stream.on('data', (chunk: Buffer) => {
              hasReceivedData = true;
              buffer += chunk.toString();
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const dataStr = trimmed.slice(5).trim();
                if (dataStr === '[DONE]') continue;
                try {
                  const data = JSON.parse(dataStr);
                  const delta = data.choices?.[0]?.delta;
                  if (delta?.content) {
                    fullContent += delta.content;
                    event.sender.send('kimi-analysis-chunk', { content: fullContent });
                  }
                } catch {
                  // 忽略
                }
              }
            });

            stream.on('end', () => {
              event.sender.off('destroyed', destroyOnDisconnect);
              if (!hasReceivedData && !fullContent) {
                resolve({ error: 'Kimi API 错误: 第二步服务端未返回数据' });
                return;
              }
              resolve({ content: fullContent });
            });

            stream.on('error', (e: any) => {
              event.sender.off('destroyed', destroyOnDisconnect);
              const msg = parseKimiError(e);
              
              // 如果是过载错误且没有收到任何数据，标记为可降级
              const isOverloaded = msg.toLowerCase().includes('overloaded') || 
                                   e.response?.statusCode === 503 || 
                                   e.response?.statusCode === 529;
              if (isOverloaded && !hasReceivedData) {
                resolve({ error: `OVERLOADED:${msg}` });
                return;
              }
              
              resolve({ error: `Kimi API 错误(第二步): ${msg}` });
            });
          });
        };

        // 先尝试流式
        let result = await runStreamStep();

        // 如果流式因过载失败，降级为非流式
        if (result.error?.startsWith('OVERLOADED:')) {
          console.warn('[Kimi] 流式过载，降级为非流式请求');
          event.sender.send('kimi-analysis-chunk', { content: '⏳ 服务繁忙，切换至稳定模式，请稍候...' });
          
          try {
            const fallbackResponse = await got.post('https://api.moonshot.cn/v1/chat/completions', {
              headers: {
                Authorization: `Bearer ${trimmedKey}`,
                'Content-Type': 'application/json',
              },
              json: {
                model: 'kimi-k2.6',
                messages: newMessages,
                temperature: 1,
                stream: false,
              },
              timeout: { request: 120000, connect: 10000 },
              retry: {
                limit: 2,
                methods: ['POST'],
                statusCodes: [408, 413, 429, 500, 502, 503, 504, 529],
                errorCodes: ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED'],
                calculateDelay: ({ attemptCount, error }: any) => {
                  if (!shouldRetryKimi(error)) return 0;
                  return getRetryDelay(error, attemptCount);
                },
              },
            });
            
            const fallbackData = JSON.parse(fallbackResponse.body);
            const content = fallbackData.choices?.[0]?.message?.content || '';
            result = { content };
          } catch (e: any) {
            const msg = parseKimiError(e);
            result = { error: `Kimi API 错误(第二步降级): ${msg}` };
          }
        }

        return result;
      }

      // 无需 tool_calls，直接返回文本
      const content = firstChoice?.message?.content || '';
      return { content };
    } catch (e: any) {
      const msg = parseKimiError(e);
      return { error: `Kimi API 错误: ${msg}` };
    }
  });

  ipcMain.handle('kimi-tool-response', async (_event, { requestId, results }: { requestId: string; results: any[] }) => {
    const pending = pendingToolRequests.get(requestId);
    if (pending) {
      pending.resolve(results);
      pendingToolRequests.delete(requestId);
      return { success: true };
    }
    return { success: false, error: '未找到对应的工具请求' };
  });

  // ===== 本地文件存储 IPC 处理程序 =====
  ipcMain.handle('local-storage-init', () => {
    try {
      localFileStorage.initLocalFileStorage();
      return { success: true };
    } catch (error: any) {
      console.error('[Main] Error initializing local file storage:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('local-storage-read', (event, { table, id }) => {
    try {
      const result = localFileStorage.readLocalData(table, id);
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Main] Error reading from local storage:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('local-storage-write', (event, { table, data, lastModified, id }) => {
    try {
      localFileStorage.writeLocalData(table, data, lastModified, id);
      return { success: true };
    } catch (error: any) {
      console.error('[Main] Error writing to local storage:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('local-storage-delete', (event, { table, id }) => {
    try {
      localFileStorage.deleteLocalData(table, id);
      return { success: true };
    } catch (error: any) {
      console.error('[Main] Error deleting from local storage:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('local-storage-stats', () => {
    try {
      const stats = localFileStorage.getLocalStorageStats();
      return { success: true, stats };
    } catch (error: any) {
      console.error('[Main] Error getting local storage stats:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('local-storage-backup', (event, { backupPath }) => {
    try {
      localFileStorage.backupLocalStorage(backupPath);
      return { success: true };
    } catch (error: any) {
      console.error('[Main] Error backing up local storage:', error);
      return { success: false, error: error.message };
    }
  });
  
  // 保留 SQLite IPC 处理程序以保持向后兼容
  ipcMain.handle('sqlite-init', () => {
    try {
      localFileStorage.initLocalFileStorage();
      return { success: true };
    } catch (error: any) {
      console.error('[Main] Error initializing storage:', error);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('sqlite-read', (event, { table, id }) => {
    try {
      const result = localFileStorage.readLocalData(table, id);
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Main] Error reading from storage:', error);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('sqlite-write', (event, { table, data, lastModified, id }) => {
    try {
      localFileStorage.writeLocalData(table, data, lastModified, id);
      return { success: true };
    } catch (error: any) {
      console.error('[Main] Error writing to storage:', error);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('sqlite-delete', (event, { table, id }) => {
    try {
      localFileStorage.deleteLocalData(table, id);
      return { success: true };
    } catch (error: any) {
      console.error('[Main] Error deleting from storage:', error);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('sqlite-stats', () => {
    try {
      const stats = localFileStorage.getLocalStorageStats();
      return { success: true, stats };
    } catch (error: any) {
      console.error('[Main] Error getting storage stats:', error);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('sqlite-backup', (event, { backupPath }) => {
    try {
      localFileStorage.backupLocalStorage(backupPath);
      return { success: true };
    } catch (error: any) {
      console.error('[Main] Error backing up storage:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('get-local-storage-path', () => {
    try {
      const storagePath = localFileStorage.getStoragePath();
      return { success: true, path: storagePath };
    } catch (error: any) {
      console.error('[Main] Error getting storage path:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('set-local-storage-path', (event, { dirPath }) => {
    try {
      const result = localFileStorage.setCustomStoragePath(dirPath || null);
      if (result) {
        const newPath = localFileStorage.getStoragePath();
        return { success: true, path: newPath };
      }
      return { success: false, error: '设置存储路径失败' };
    } catch (error: any) {
      console.error('[Main] Error setting storage path:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('get-local-storage-files', () => {
    try {
      const files = localFileStorage.getLocalStorageFiles();
      return { success: true, files };
    } catch (error: any) {
      console.error('[Main] Error getting storage files:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('local-storage-export', () => {
    try {
      const data = localFileStorage.exportLocalData();
      return { success: true, data };
    } catch (error: any) {
      console.error('[Main] Error exporting local storage:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('local-storage-import', (event, { data }) => {
    try {
      const result = localFileStorage.importLocalData(data);
      return { success: result };
    } catch (error: any) {
      console.error('[Main] Error importing local storage:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('local-storage-export-to-file', async (event, { filePath }) => {
    try {
      const result = localFileStorage.exportLocalDataToZip(filePath);
      return { success: result };
    } catch (error: any) {
      console.error('[Main] Error exporting local storage to zip:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('local-storage-import-from-file', async (event, { filePath }) => {
    try {
      const result = localFileStorage.importLocalDataFromZip(filePath);
      return { success: result };
    } catch (error: any) {
      console.error('[Main] Error importing local storage from zip:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('qslist-backup-read', (event, { date }) => {
    try {
      const result = localFileStorage.readQSListBackup(date);
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Main] Error reading QSList backup:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('qslist-backup-write', (event, { date, data }) => {
    try {
      const result = localFileStorage.writeQSListBackup(date, data);
      return { success: result };
    } catch (error: any) {
      console.error('[Main] Error writing QSList backup:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('qslist-backup-list', () => {
    try {
      const result = localFileStorage.listQSListBackups();
      return { success: true, dates: result };
    } catch (error: any) {
      console.error('[Main] Error listing QSList backups:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('run-python-script', async (event, config) => {
    return new Promise((resolve, reject) => {
      const pythonPath = process.env.PYTHON_PATH || 
        (process.platform === 'win32' ? 'python' : '/usr/bin/python3');
      
      let scriptPath: string;
      
      if (process.env.PYTHON_SCRIPT_PATH) {
        scriptPath = process.env.PYTHON_SCRIPT_PATH;
      } else if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
        scriptPath = path.join(__dirname, '../python');
      } else {
        scriptPath = path.join(process.resourcesPath, 'python');
      }
      
      const scriptFullPath = path.join(scriptPath, config.fileName);
      
      console.log(`Running Python script: ${config.fileName}`);
      console.log(`Python path: ${pythonPath}`);
      console.log(`Script path: ${scriptPath}`);
      console.log(`Script full path: ${scriptFullPath}`);
      console.log(`Script exists: ${fs.existsSync(scriptFullPath)}`);
      
      const options = {
        mode: 'text',
        pythonPath: pythonPath,
        pythonOptions: ['-u'],
        scriptPath: scriptPath,
        args: config.params,
      };
      
      PythonShell.run(config.fileName, options, (err, results) => {
        if (err) {
          console.error('Python script error:', err);
          reject(err);
          return;
        }
        console.log(`${config.fileName} finished.`);
        console.log('results', results);
        resolve(results);
      });
    });
  });
  ipcMain.handle('app-quit', (event, config) => {
    app.quit();
  });
}

function full() {
  const mainWindowState = windowStateKeeper({ defaultWidth: 1000, defaultHeight: 600 });
  const mainWindow = createMainWindow(mainWindowState, true);
  mainWindow.webContents.on('did-frame-finish-load', () => {
    mainWindow.webContents.once('devtools-opened', () => {
      mainWindow.webContents.focus();
    });
  });
  mainWindowState.manage(mainWindow);
  app.on('web-contents-created', (e, contents) => {
    if (contents.getType() == 'webview') {
      contextMenu({
        window: contents,
        prepend: (defaultActions, parameters, browserWindow) => [
          {
            label: '添加笔记 “{selection}”',
            visible: parameters.selectionText.trim().length > 0,
            click: () => {
              mainWindow.webContents.send('add-note', { url: parameters.pageURL, text: parameters.selectionText });
            },
          },
          {
            label: '添加标的 “{selection}”',
            visible: parameters.selectionText.trim().length > 0 && parameters.selectionText.trim().length < 5,
            click: () => {
              mainWindow.webContents.send('add-stock', { text: parameters.selectionText });
            },
          },
        ],
      });
      contents.on('new-window', (e, url) => {
        e.preventDefault();
      });
    }
  });
  return mainWindow;
}

function worker() {
  const workerWindow = creatWorkerWindow(false);
  workerWindow.webContents.on('did-frame-finish-load', () => {
    workerWindow.webContents.once('devtools-opened', () => {
      workerWindow.webContents.focus();
    });
  });
  
  workerWindow.on('focus', () => {
    globalShortcut.register('F12', () => {
      if (workerWindow.webContents.isDevToolsOpened()) {
        workerWindow.webContents.closeDevTools();
      } else {
        workerWindow.webContents.openDevTools({ mode: 'undocked' });
      }
    });
  });
  workerWindow.on('blur', () => {
    globalShortcut.unregister('F12');
  });

  return workerWindow;
}

function mini() {
  const tray = createTray();
  const mb = createMenubar({ tray });
  let contextMenu = buildContextMenu({ mb });
  mb.app.commandLine.appendSwitch('disable-backgrounding-occluded-windows', 'true');

  ipcMain.handle('set-tray-content', (event, config) => {
    tray.setTitle(config);
  });
  ipcMain.handle('update-tray-context-menu-wallets', (event, config) => {
    const menus = config.map((item: any) => ({
      ...item,
      icon: generateWalletIcon(item.iconIndex),
      click: () => mb.window?.webContents.send('change-current-wallet-code', item.id),
    }));
    contextMenu = buildContextMenu({ mb });
  });
  mb.on('after-create-window', () => {
    tray.on('right-click', () => {
      mb.tray.popUpContextMenu(contextMenu);
    });
    nativeTheme.on('updated', () => {
      mb.window?.webContents.send('nativeTheme-updated', {
        darkMode: nativeTheme.shouldUseDarkColors,
      });
    });
    mb.window!.on('close', (e) => {
      if (!willQuitApp) {
        e.preventDefault();
        mb.hideWindow();
      }
    });
  });
  mb.on('ready', () => {
    mb.window?.setVisibleOnAllWorkspaces(true);
  });
  return mb;
}

init().catch(console.log);