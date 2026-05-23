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

async function init() {
  console.log('当前工作目录：' + app.getAppPath());
  lockSingleInstance();
  Object.assign(console, log.functions);
  // ElectronStore.initRenderer();
  // This code adds 2 new items to the context menu to zoom in the window (in and out)
  // Read other steps for more information
  contextMenu();

  await app.whenReady();
  await checkEnvTool();
  
  // 注册全局快捷键打开/关闭开发者工具（release 版本也可用）
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
  // Mac: Cmd+Option+I
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

  // 相关监听
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
    // 本地文件存储无需关闭操作
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

  // 高级视频下载：支持 M3U8/TS 解析、重定向跟随、进度报告
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
      // 1. 下载 M3U8 内容
      const m3u8Text = await got(m3u8Url, {
        retry: 2,
        timeout: { request: 15000 },
        followRedirect: true,
      }).text();

      // 2. 解析 M3U8
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
        // 这是一个媒体 URL
        if (line.startsWith('http')) {
          tsUrls.push(line);
        } else {
          // 相对 URL
          tsUrls.push(baseUrl + line);
        }
      }

      if (tsUrls.length === 0) {
        // 可能是主播放列表（master playlist），尝试找子播放列表
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
          // 递归下载子 M3U8
          return downloadM3U8(subUrl, outputPath);
        }
        throw new Error('M3U8 中未找到有效的 TS 分片');
      }

      if (hasEncryption) {
        throw new Error('M3U8 使用了 AES-128 加密，暂不支持下载加密视频');
      }

      // 3. 逐个下载 TS 并合并
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
        // 追加到输出文件
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
      // 1. 判断是否为 M3U8（通过 URL 或 Content-Type）
      let finalIsM3U8 = isM3U8;
      if (!finalIsM3U8) {
        try {
          const headRes = await got.head(url, { retry: 2, timeout: { request: 10000 }, followRedirect: true });
          const ct = headRes.headers['content-type'] || '';
          if (/mpegurl|x-mpegurl|m3u8/i.test(ct)) {
            finalIsM3U8 = true;
          }
        } catch (e) {
          // 如果 head 失败，通过 URL 后缀判断
          finalIsM3U8 = /\.m3u8([?#]|$)/i.test(url);
        }
      }

      if (!finalIsM3U8) {
        // 普通视频：直接下载
        await downloadStream(url, savePath, (received, total) => {
          if (total > 0) sendProgress((received / total) * 100);
        });
        sendProgress(100);
        return savePath;
      }

      // M3U8 下载
      return await downloadM3U8(url, savePath);
    } catch (e: any) {
      sendProgress(0);
      throw e;
    }
  });

  // ===== 辅助函数：健壮的错误解析 =====
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

    // 2. 如果 body 没解析出内容，用 HTTP 状态信息
    if (!msg) {
      const statusCode = e.response?.statusCode || e.statusCode;
      const statusMessage = e.response?.statusMessage || e.statusMessage;
      if (statusCode) {
        msg = `HTTP ${statusCode}${statusMessage ? ` ${statusMessage}` : ''}`;
      }
    }

    // 3. 网络层错误码（比 e.message 更具体）
    if (!msg && e.code) {
      msg = `网络错误: ${e.code}`;
    }

    // 4. 最后的兜底
    if (!msg) {
      msg = e.message || '请求失败（未知错误）';
    }

    // 记录完整错误结构到主进程日志，方便排查
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
      timeout: { request: 120000 },
      retry: { limit: 2, methods: ['POST'] }, // ← 增加重试，减少偶发网络错误
    });

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
        if (!hasReceivedData && !fullContent) {
          // 流正常结束但没有任何数据，可能是服务端直接断开
          resolve({ error: 'Kimi API 错误: 服务端未返回任何数据（可能是限流或模型过载）' });
          return;
        }
        resolve({ content: fullContent });
      });

      stream.on('error', (e: any) => {
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

  // ===== Kimi AI Tools 调用（支持 function calling）=====
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

    // 第一步：非流式调用
    let firstData: any;
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
        timeout: { request: 120000 },
        retry: { limit: 2, methods: ['POST'] },
      });
      firstData = JSON.parse(firstResponse.body);
    } catch (e: any) {
      const msg = parseKimiError(e);
      return { error: `Kimi API 错误(第一步): ${msg}` };
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

      // 第二步：流式调用
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
        timeout: { request: 120000 },
        retry: { limit: 2, methods: ['POST'] },
      });

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
              // 忽略
            }
          }
        });

        stream.on('end', () => {
          if (!hasReceivedData && !fullContent) {
            resolve({ error: 'Kimi API 错误: 第二步服务端未返回数据' });
            return;
          }
          resolve({ content: fullContent });
        });

        stream.on('error', (e: any) => {
          const msg = parseKimiError(e);
          resolve({ error: `Kimi API 错误(第二步): ${msg}` });
        });
      });
    }

    // 无需 tool_calls
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
  
  // 保留 SQLite IPC 处理程序以保持向后兼容（内部调用本地文件存储）
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
  
  // 获取本地存储路径
  ipcMain.handle('get-local-storage-path', () => {
    try {
      const storagePath = localFileStorage.getStoragePath();
      return { success: true, path: storagePath };
    } catch (error: any) {
      console.error('[Main] Error getting storage path:', error);
      return { success: false, error: error.message };
    }
  });
  
  // 设置自定义本地存储路径
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
  
  // 获取本地存储所有文件内容（用于同步到百度云盘）
  ipcMain.handle('get-local-storage-files', () => {
    try {
      const files = localFileStorage.getLocalStorageFiles();
      return { success: true, files };
    } catch (error: any) {
      console.error('[Main] Error getting storage files:', error);
      return { success: false, error: error.message };
    }
  });

  // 导出本地存储数据
  ipcMain.handle('local-storage-export', () => {
    try {
      const data = localFileStorage.exportLocalData();
      return { success: true, data };
    } catch (error: any) {
      console.error('[Main] Error exporting local storage:', error);
      return { success: false, error: error.message };
    }
  });

  // 导入本地存储数据
  ipcMain.handle('local-storage-import', (event, { data }) => {
    try {
      const result = localFileStorage.importLocalData(data);
      return { success: result };
    } catch (error: any) {
      console.error('[Main] Error importing local storage:', error);
      return { success: false, error: error.message };
    }
  });

  // 导出本地存储数据到 zip 文件
  ipcMain.handle('local-storage-export-to-file', async (event, { filePath }) => {
    try {
      const result = localFileStorage.exportLocalDataToZip(filePath);
      return { success: result };
    } catch (error: any) {
      console.error('[Main] Error exporting local storage to zip:', error);
      return { success: false, error: error.message };
    }
  });

  // 从 zip 文件导入本地存储数据
  ipcMain.handle('local-storage-import-from-file', async (event, { filePath }) => {
    try {
      const result = localFileStorage.importLocalDataFromZip(filePath);
      return { success: result };
    } catch (error: any) {
      console.error('[Main] Error importing local storage from zip:', error);
      return { success: false, error: error.message };
    }
  });

  // QSList 备份读取
  ipcMain.handle('qslist-backup-read', (event, { date }) => {
    try {
      const result = localFileStorage.readQSListBackup(date);
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Main] Error reading QSList backup:', error);
      return { success: false, error: error.message };
    }
  });

  // QSList 备份写入
  ipcMain.handle('qslist-backup-write', (event, { date, data }) => {
    try {
      const result = localFileStorage.writeQSListBackup(date, data);
      return { success: result };
    } catch (error: any) {
      console.error('[Main] Error writing QSList backup:', error);
      return { success: false, error: error.message };
    }
  });

  // QSList 备份列表
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
      // 获取 Python 路径，优先使用环境变量，否则使用默认路径
      const pythonPath = process.env.PYTHON_PATH || 
        (process.platform === 'win32' ? 'python' : '/usr/bin/python3');
      
      // 获取脚本路径
      let scriptPath: string;
      
      if (process.env.PYTHON_SCRIPT_PATH) {
        // 使用环境变量指定的路径
        scriptPath = process.env.PYTHON_SCRIPT_PATH;
      } else if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
        // 开发环境：使用相对路径
        scriptPath = path.join(__dirname, '../python');
      } else {
        // 生产环境：Python 脚本在 extraResources 中
        // 使用 process.resourcesPath/python
        scriptPath = path.join(process.resourcesPath, 'python');
      }
      
      // 验证脚本文件是否存在
      const scriptFullPath = path.join(scriptPath, config.fileName);
      const fs = require('fs');
      
      console.log(`Running Python script: ${config.fileName}`);
      console.log(`Python path: ${pythonPath}`);
      console.log(`Script path: ${scriptPath}`);
      console.log(`Script full path: ${scriptFullPath}`);
      console.log(`Script exists: ${fs.existsSync(scriptFullPath)}`);
      
      const options = {
        mode: 'text',
        pythonPath: pythonPath,
        pythonOptions: ['-u'], // get print results in real-time
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
    // 启动时不自动打开开发者工具，使用 F12 或 Cmd+Option+I 手动打开
    // mainWindow.webContents.openDevTools({ mode: 'undocked' });
  });
  mainWindowState.manage(mainWindow);
  app.on('web-contents-created', (e, contents) => {
    // Check for a webview
    if (contents.getType() == 'webview') {
      contextMenu({
        window: contents,
        prepend: (defaultActions, parameters, browserWindow) => [
          {
            label: '添加笔记 “{selection}”',
            // Only show it when right-clicking text
            visible: parameters.selectionText.trim().length > 0,
            click: () => {
              mainWindow.webContents.send('add-note', { url: parameters.pageURL, text: parameters.selectionText });
              // shell.openExternal(`https://google.com/search?q=${encodeURIComponent(parameters.selectionText)}`);
            },
          },
          {
            label: '添加标的 “{selection}”',
            // Only show it when right-clicking text
            visible: parameters.selectionText.trim().length > 0 && parameters.selectionText.trim().length < 5,
            click: () => {
              mainWindow.webContents.send('add-stock', { text: parameters.selectionText });
              // shell.openExternal(`https://google.com/search?q=${encodeURIComponent(parameters.selectionText)}`);
            },
          },
        ],
      });
      // Listen for any new window events
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
    // open electron debug
    // workerWindow.webContents.openDevTools({ mode: 'undocked' });
  });
  
  // Worker 窗口也支持 F12 打开 DevTools
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
  // menubar 相关监听
  mb.on('after-create-window', () => {
    // 打开开发者工具
    // if (!app.isPackaged) {
    //   mb.window!.webContents.openDevTools({ mode: 'undocked' });
    // }
    // 右键菜单
    tray.on('right-click', () => {
      mb.tray.popUpContextMenu(contextMenu);
    });
    // 监听主题颜色变化
    nativeTheme.on('updated', () => {
      mb.window?.webContents.send('nativeTheme-updated', {
        darkMode: nativeTheme.shouldUseDarkColors,
      });
    });

    // 点击关闭按钮只隐藏窗口，不销毁；应用真正退出时允许关闭
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

  // new AppUpdater({ icon: nativeIcon, win: mb.window });
}

init().catch(console.log);
