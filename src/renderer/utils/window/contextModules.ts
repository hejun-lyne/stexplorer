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
