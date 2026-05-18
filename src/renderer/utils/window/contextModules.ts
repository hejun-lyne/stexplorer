/* eslint-disable @typescript-eslint/no-explicit-any */
import { GotRequestFunction } from 'got/dist/source';
import { Shell, Dialog, App, IpcRenderer, Clipboard } from 'electron';

declare global {
  interface Window {
    contextModules: {
      got: GotRequestFunction;
      electron: {
        shell: Shell;
        ipcRenderer: IpcRenderer;
        dialog: Dialog;
        app: App;
        clipboard: {
          writeText: Clipboard['writeText'];
          readText: Clipboard['readText'];
          writeImage: (dataUrl: string) => void;
        };
        downloadVideo: (url: string, savePath: string) => Promise<string>;
        invoke: {
          showCurrentWindow: () => void;
          getShouldUseDarkColors: () => Promise<boolean>;
          setNativeThemeSource: (theme: string) => Promise<void>;
        };
        saveImage: (filePath: string, dataUrl: string) => void;
        saveString: (filePath: string, content: string) => Promise<any>;
        encodeFF: (content: any) => string;
        decodeFF: (content: string) => any;
        readFile: (content: string) => string;
        uploadBaiduFile: (content: string, dir: string, fileName: string, accessToken: string) => Promise<any>;
        execPyScript: (fileName: string, params: string[]) => Promise<any>;
        compileTS: (source: string) => Promise<any>;
        makeWorkerExec: (method: string, args?: any[]) => Promise<any>;
        // SQLite 数据库操作（本地文件存储兼容接口）
        sqliteInit: () => Promise<{ success: boolean; error?: string }>;
        sqliteRead: (table: string, id?: number | string | object) => Promise<{ success: boolean; data?: any; error?: string }>;
        sqliteWrite: (table: string, data: any, lastModified: string, id?: number | string | object) => Promise<{ success: boolean; error?: string }>;
        sqliteDelete: (table: string, id?: number | string | object) => Promise<{ success: boolean; error?: string }>;
        sqliteStats: () => Promise<{ success: boolean; stats?: { size: number; tables: string[]; files?: string[] }; error?: string }>;
        sqliteBackup: (backupPath: string) => Promise<{ success: boolean; error?: string }>;
        // 本地存储路径管理
        getLocalStoragePath: () => Promise<{ success: boolean; path?: string; error?: string }>;
        setLocalStoragePath: (dirPath: string | null) => Promise<{ success: boolean; path?: string; error?: string }>;
        getLocalStorageFiles: () => Promise<{ success: boolean; files?: { name: string; content: string }[]; error?: string }>;
        exportLocalStorage: () => Promise<{ success: boolean; data?: any; error?: string }>;
        importLocalStorage: (data: { version?: string; files: { name: string; content: string }[] }) => Promise<{ success: boolean; error?: string }>;
        exportLocalStorageToFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
        importLocalStorageFromFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
      };
      process: {
        production: boolean;
        electron: string;
        version: string;
      };
    };
  }
}

export { };
