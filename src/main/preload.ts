import { contextBridge, ipcRenderer, shell, clipboard, nativeImage, app } from 'electron';
import got from 'got';
import { encode, decode } from 'js-base64';
import * as fs from 'fs';
import { base64ToBuffer } from './util';
import { version } from '../../build/app/package.json';
const FormData = require('form-data');
const CryptoJS = require('crypto-js');
const fss = require('fs-slice');

import log from 'electron-log';
Object.assign(console, log.functions);
console.log('will run preload');
contextBridge.exposeInMainWorld('contextModules', {
  got: async (url: string, config = {}) => got(url, { ...config, retry: 3, timeout: 6000 }),
  process: {
    production: process.env.NODE_ENV === 'production',
    electron: process.versions.electron,
    version: process.env.VERSION || version,
  },
  electron: {
    shell: {
      openExternal: shell.openExternal,
    },
    ipcRenderer: {
      invoke: ipcRenderer.invoke,
      on(channel: string, func: any) {
        const validChannels = [
          'nativeTheme-updated',
          'clipboard-funds-copy',
          'clipboard-funds-import',
          'backup-all-config-export',
          'backup-all-config-import',
          'update-available',
          'change-current-wallet-code',
          'add-note',
          'add-stock',
          'close-current-tab',
          'message-to-worker',
          'message-from-worker',
          'on-console-log',
          'on-progress-log',
        ];
        if (validChannels.includes(channel)) {
          return ipcRenderer.on(channel, func);
        } else {
          return null;
        }
      },
      off(channel: string, func: any) {
        return ipcRenderer.removeListener(channel, func);
      },
      offAll(channel: string) {
        return ipcRenderer.removeAllListeners(channel);
      },
    },
    dialog: {
      showMessageBox: async (config: any) => ipcRenderer.invoke('show-message-box', config),
      showSaveDialog: async (config: any) => ipcRenderer.invoke('show-save-dialog', config),
      showOpenDialog: async (config: any) => ipcRenderer.invoke('show-open-dialog', config),
    },
    invoke: {
      showCurrentWindow: () => ipcRenderer.invoke('show-current-window'),
      getShouldUseDarkColors: () => ipcRenderer.invoke('get-should-use-dark-colors'),
      setNativeThemeSource: (config: any) => ipcRenderer.invoke('set-native-theme-source', config),
    },
    app: {
      setLoginItemSettings: (config: any) => ipcRenderer.invoke('set-login-item-settings', config),
      quit: () => ipcRenderer.invoke('app-quit'),
    },
    clipboard: {
      readText: clipboard.readText,
      writeText: clipboard.writeText,
      writeImage: (dataUrl: string) => clipboard.writeImage(nativeImage.createFromDataURL(dataUrl)),
    },
    saveImage: (filePath: string, dataUrl: string) => {
      const imageBuffer = base64ToBuffer(dataUrl);
      fs.writeFileSync(filePath, imageBuffer);
    },
    saveString: async (fileName: string, content: string) => {
      const filePath = await ipcRenderer.invoke('save-string-silently', { fileName, content });
      return filePath;
    },
    encodeFF(content: any) {
      const ffprotocol = 'ff://'; // FF协议
      return `${ffprotocol}${encode(JSON.stringify(content))}`;
    },
    decodeFF(content: string) {
      const ffprotocol = 'ff://'; // FF协议
      try {
        const protocolLength = ffprotocol.length;
        const protocol = content.slice(0, protocolLength);
        if (protocol !== ffprotocol) {
          throw Error('协议错误');
        }
        const body = content.slice(protocolLength);
        return JSON.parse(decode(body));
      } catch (error) {
        console.log('解码失败', error);
        return null;
      }
    },
    readFile(path: string) {
      return fs.readFileSync(path, 'utf-8');
    },
    async uploadBaiduFile(content: string, dir: string, fileName: string, accessToken: string) {
      async function uploadFileStep1(params: any) {
        console.log('uploadFileStep1: ' + JSON.stringify(params));
        const url = `http://pan.baidu.com/rest/2.0/xpan/file?method=precreate&access_token=${params.accessToken}`;
        const data = `path=${params.remotePath}&size=${params.fileSize}&isdir=0&autoinit=1&rtype=0&block_list=["${params.hash}"]`;
        const { body } = await got(url, {
          method: 'POST',
          body: data,
        });
        const res1 = JSON.parse(body);
        return { ...params, res1 };
      }
      async function uploadFileStep2(params: any) {
        console.log('uploadFileStep2: ' + JSON.stringify(params));
        const url = `https://d.pcs.baidu.com/rest/2.0/pcs/superfile2?access_token=${params.accessToken}&method=upload&type=tmpfile&path=${params.remotePath}&uploadid=${params.res1.uploadid}=&partseq=0`;
        const formData = new FormData();
        formData.append('access_token', params.accessToken);
        formData.append('file', fs.createReadStream(params.filePath));
        const { body } = await got.post(url, {
          body: formData,
        });
        const res2 = JSON.parse(body);
        return { ...params, res2 };
      }

      async function uploadFileStep3(params: any) {
        console.log('uploadFileStep3: ' + JSON.stringify(params));
        const url = `https://pan.baidu.com/rest/2.0/xpan/file?method=create&access_token=${params.accessToken}`;
        const data = `path=${params.remotePath}&size=${params.fileSize}&isdir=0&uploadid=${params.res1.uploadid}&block_list=["${params.res2.md5}"]`;
        const { body } = await got(url, {
          method: 'POST',
          body: data,
        });
        const res3 = JSON.parse(body);
        return { ...params, res3 };
      }
      const filePath = await ipcRenderer.invoke('save-tmpstring-silently', { fileName, content });
      const stats = fs.statSync(filePath);
      const fileSize = stats.size;
      if (fileSize > 4 * 1024 * 1024) {
        // 大于4M要切片
        const files = fss(filePath).avgSliceAsFile({ blockSize: 4 * 1024 * 1024 });
      }
      const remotePath = encodeURI(`${dir}/${fileName}`);
      const hash = CryptoJS.MD5(content).toString();
      try {
        let res = await uploadFileStep1({ filePath, fileSize, fileName, remotePath, hash, accessToken });
        console.log('step1: ' + JSON.stringify(res));
        if (!res.res1 || res.res1.errno != 0) {
          console.log('创建预上传任务失败');
        }
        res = await uploadFileStep2(res);
        console.log('step2: ' + JSON.stringify(res));
        if (!res.res2 || !res.res2.md5) {
          console.log('执行上传过程失败');
        }
        res = await uploadFileStep3(res);
        console.log('step3: ' + JSON.stringify(res));
        if (!res.res3 || res.res3.errno != 0) {
          console.log('创建文件记录失败');
        }
        return res;
      } catch (error) {
        console.log(error);
      }
    },
    async execPyScript(fileName: string, params: string[]) {
      const result = await ipcRenderer.invoke('run-python-script', { fileName, params });
      return result;
    },
    async compileTS(source: string) {
      const result = await ipcRenderer.invoke('compile-ts-source', { source });
      return result;
    },
    async makeWorkerExec(method: string, args?: any[]) {
      return ipcRenderer.invoke('message-to-worker', { method, args });
    },
  },
});
