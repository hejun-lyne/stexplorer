import { BrowserWindow, ipcMain, Menu, ipcRenderer } from 'electron';
import { app } from 'electron';
import windowStateKeeper from 'electron-window-state';
import path from 'path';
import { resolveHtmlPath } from './util';

export function createMainWindow(stateKeeper: windowStateKeeper.State, showDev:boolean) {
  console.log('preload', path.join(__dirname, 'preload.js'));
  const mainWindow = new BrowserWindow({
    width: stateKeeper.width,
    height: stateKeeper.height,
    backgroundColor: '#fff',
    minHeight: 600,
    minWidth: 800,
    webPreferences: {
      contextIsolation: true,
      devTools: showDev && !app.isPackaged,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js'),
      nativeWindowOpen: true,
      nodeIntegrationInWorker: true,
    },
    icon: path.join(__dirname, 'assets/logo.png'),
  });

  // and load the index.html of the app.
  mainWindow.loadURL(resolveHtmlPath('full.html'));

  return mainWindow;
}

export function creatWorkerWindow(showDev:boolean) {
  // create hidden worker window
  const workerWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: showDev &&!app.isPackaged,
    },
  });
  workerWindow.loadURL(resolveHtmlPath('worker.html'));
  return workerWindow;
}
