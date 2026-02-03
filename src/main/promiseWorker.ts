import { BrowserWindow, ipcMain, Menu, ipcRenderer } from 'electron';

export class PromiseWorker {
  messageIds: number;

  callbacks: Record<number, any>;

  workerWindow: BrowserWindow;

  constructor(
    workerWindow: BrowserWindow,
    onConsolelog: (error: any, text: string | string[]) => void,
    onProgressLog: (error: any, progress: string) => void
  ) {
    this.messageIds = 10;
    this.callbacks = {
      1: onConsolelog,
      2: onProgressLog,
    };
    this.workerWindow = workerWindow;
    ipcMain.handle('message-from-worker', (event, args) => {
      this.onMessage(args);
    });
    ipcMain.handle('message-to-worker', (event, args) => {
      return this.postMessage(args);
    });
  }

  onMessage(args: any[]) {
    if (!Array.isArray(args) || args.length < 2) {
      // Ignore - this message is not for us.
      return;
    }
    const [messageId, error, result] = args;
    const callback = this.callbacks[messageId];

    if (!callback) {
      // This message is not for us.
      return;
    }
    if (messageId >= 10) {
      delete this.callbacks[messageId];
    }
    callback(error, result);
  }

  postMessage(content: any) {
    const messageId = this.messageIds++;
    const payload = [messageId, content];
    const self = this as any;
    return new Promise(function (resolve, reject) {
      self.callbacks[messageId] = function (error: any, result: any) {
        if (error) {
          return reject(new Error(error.message));
        }
        resolve(result);
      };

      self.workerWindow.webContents.send('message-to-worker', payload);
    });
  }
}
