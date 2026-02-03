import { app } from 'electron';
import { URL } from 'url';
import * as path from 'path';
import log from 'electron-log';

export let resolveHtmlPath: (htmlFileName: string) => string;

if (process.env.NODE_ENV === 'development') {
  const port = process.env.PORT || 1212;
  resolveHtmlPath = (htmlFileName: string) => {
    const url = new URL(`http://localhost:${port}`);
    url.pathname = htmlFileName;
    return url.href;
  };
} else {
  resolveHtmlPath = (htmlFileName: string) => {
    const fs = require('fs');
    // 尝试多个可能的路径
    const possiblePaths = [
      // 1. 从构建目录运行的标准路径
      path.resolve(__dirname, '../renderer/', htmlFileName),
      // 2. 从源码运行时的路径（项目根目录）
      path.join(app.getAppPath(), 'build/app/dist/renderer', htmlFileName),
      // 3. 相对于 cwd 的路径
      path.join(process.cwd(), 'build/app/dist/renderer', htmlFileName),
    ];
    
    for (const tryPath of possiblePaths) {
      if (fs.existsSync(tryPath)) {
        return `file://${tryPath}`;
      }
    }
    
    // 默认返回第一个路径（即使文件不存在，让 Electron 报告错误）
    return `file://${possiblePaths[0]}`;
  };
}

export function getAssetPath(resourceFilename: string) {
  const EXTRA_RESOURCES_PATH = app.isPackaged ? path.join(process.resourcesPath, 'assets') : path.join(__dirname, '../../assets');
  return path.join(EXTRA_RESOURCES_PATH, resourceFilename);
}

export function installExtensions() {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS', 'REDUX_DEVTOOLS'];
  return Promise.all(extensions.map((name) => installer.default(installer[name], forceDownload))).catch(console.log);
}

export function lockSingleInstance() {
  const isSingleInstance = app.requestSingleInstanceLock();
  if (!isSingleInstance) {
    app.quit();
  }
}

export async function checkEnvTool() {
  if (process.env.NODE_ENV === 'production') {
    const sourceMapSupport = require('source-map-support');
    Object.assign(console, log.functions);
    sourceMapSupport.install();
  }

  if (process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true') {
    require('electron-debug')();
  }
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true') {
    await installExtensions();
  }
}

export function base64ToBuffer(dataUrl: string) {
  const data = dataUrl.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
  const imageBuffer = Buffer.from(data![2], 'base64');
  return imageBuffer;
}
