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
      const options = {
        mode: 'text',
        pythonPath: '/opt/homebrew/Caskroom/miniforge/base/envs/pytorch_env/bin/python3',
        pythonOptions: ['-u'], // get print results in real-time
        scriptPath: '/Users/jimmy/Documents/git/electron-myquantization/src/main/python',
        args: config.params,
      };
      PythonShell.run(config.fileName, options, (err, results) => {
        if (err) reject(err);
        console.log('hello.py finished.');
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
    // open electron debug
    mainWindow.webContents.openDevTools({ mode: 'undocked' });
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
