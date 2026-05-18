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
