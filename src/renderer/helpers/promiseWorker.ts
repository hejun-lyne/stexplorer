export class PromiseWorker {
  messageIds: number;

  callbacks: Record<number, any>;

  worker: Worker;

  constructor(webWorker: Worker) {
    this.messageIds = 10;
    this.callbacks = {};
    this.worker = webWorker;
    const self = this as any;
    webWorker.addEventListener('message', function (event) {
      self.onMessage(event.data);
    });
  }

  registerHandler(messageType: number, callback: any) {
    this.callbacks[messageType] = function (error: any, result: any) {
      callback(result);
    };
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
      self.worker.postMessage(payload);
    });
  }
}
