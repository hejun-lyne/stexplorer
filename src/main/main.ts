/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `yarn build` or `yarn build:main`, this file is compiled to
 * `./src/main.prod.js` using webpack. This gives us some performance wins.
 */

import { app, globalShortcut, ipcMain, nativeTheme, dialog } from 'electron';
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
import * as database from './database';

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
    app.dock.setIcon(getAssetPath('icon.png'));
    app.setAppUserModelId(app.name);
  }
  new PromiseWorker(
    worker(),
    (error, text) => mainWindow.webContents.send('on-console-log', text),
    (error, progress) => mainWindow.webContents.send('on-progress-log', progress)
  );

  // mini();

  // 相关监听
  let willQuitApp = true;
  mainWindow.on('close', function(e) {
    if (!willQuitApp) {
      e.preventDefault();
      mainWindow.hide();
      mainWindow.setSkipTaskbar(true);
    } else {
      app.quit()
    }
  });
  app.on('before-quit', function () {
    willQuitApp = true;
  });
  app.on('window-all-closed', () => {
    // 关闭数据库连接
    database.closeDatabase();
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
  // SQLite 数据库 IPC 处理程序
  ipcMain.handle('sqlite-init', () => {
    try {
      database.initDatabase();
      return { success: true };
    } catch (error: any) {
      console.error('[Main] Error initializing SQLite:', error);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('sqlite-read', (event, { table, id }) => {
    try {
      const result = database.readData(table, id);
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Main] Error reading from SQLite:', error);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('sqlite-write', (event, { table, data, lastModified, id }) => {
    try {
      database.writeData(table, data, lastModified, id);
      return { success: true };
    } catch (error: any) {
      console.error('[Main] Error writing to SQLite:', error);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('sqlite-delete', (event, { table, id }) => {
    try {
      database.deleteData(table, id);
      return { success: true };
    } catch (error: any) {
      console.error('[Main] Error deleting from SQLite:', error);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('sqlite-stats', () => {
    try {
      const stats = database.getDatabaseStats();
      return { success: true, stats };
    } catch (error: any) {
      console.error('[Main] Error getting SQLite stats:', error);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('sqlite-backup', (event, { backupPath }) => {
    try {
      database.backupDatabase(backupPath);
      return { success: true };
    } catch (error: any) {
      console.error('[Main] Error backing up SQLite:', error);
      return { success: false, error: error.message };
    }
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
  ipcMain.handle('show-current-window', (event, config) => {
    mainWindow.show();
  });
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

    // 目前没有适配tray，不需要隐藏dock
    // app.dock.hide();
  });
  mb.on('ready', () => {
    mb.window?.setVisibleOnAllWorkspaces(true);
  });
  return mb;

  // new AppUpdater({ icon: nativeIcon, win: mb.window });
}

init().catch(console.log);
