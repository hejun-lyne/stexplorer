import path from 'path';
import windowStateKeeper from 'electron-window-state';
import { menubar, Menubar } from 'menubar';
import { app, Tray, Menu } from 'electron';
import { resolveHtmlPath } from './util';

export function createMenubar({ tray }: { tray: Tray }) {
  return menubar({
    index: resolveHtmlPath('mini.html'),
    tray,
    tooltip: 'Make Money',
    preloadWindow: true,
    showOnAllWorkspaces: true,
    browserWindow: {
      backgroundColor: '#fff',
      width: 300,
      height: 550,
      minHeight: 400,
      minWidth: 300,
      maxHeight: 1000,
      maxWidth: 600,
      webPreferences: {
        contextIsolation: true,
        devTools: !app.isPackaged,
        webviewTag: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    },
  });
}

export function buildContextMenu({ mb }: { mb: Menubar }) {
  return Menu.buildFromTemplate([
    {
      role: 'about',
      label: '关于 My Quantization',
    },
    {
      click: () => {
        // appUpdater.checkUpdate('mainer');
      },
      label: '检查更新',
    },
    { type: 'separator' },
    {
      click: () => {
        mb.window?.webContents.send('clipboard-funds-import');
      },
      label: '录入基金JSON配置',
    },
    {
      click: () => {
        mb.window?.webContents.send('clipboard-funds-copy');
      },
      label: '复制基金JSON配置',
    },
    { type: 'separator' },
    {
      click: () => {
        mb.window?.webContents.send('backup-all-config-import');
      },
      label: '导入全局配置',
    },
    {
      click: () => {
        mb.window?.webContents.send('backup-all-config-export');
      },
      label: '导出全局配置',
    },
    { type: 'separator' },
    // { label: '默认钱包 +980.12', type: 'radio', icon: generateWalletIcon(0), sublabel: '123' },
    // { label: '钱包1 +128.50', icon: generateWalletIcon(2) },
    // { label: '钱包2 +128.50', icon: generateWalletIcon(3) },
    // { label: '钱包3 +128.50', icon: generateWalletIcon(4) },
    { role: 'quit', label: '退出' },
  ]);
}
