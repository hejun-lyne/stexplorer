import got from 'got';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';

// Electron 13 内置 Node 14.16.0，尚无全局 AbortController（Node 15 才默认启用），
// 提供最小兼容实现供 got 的 signal 选项使用（只用到 addEventListener/aborted/abort）
class CompatAbortSignal {
  aborted = false;
  private abortListeners = new Set<() => void>();
  addEventListener(_type: string, listener: () => void): void {
    this.abortListeners.add(listener);
  }
  removeEventListener(_type: string, listener: () => void): void {
    this.abortListeners.delete(listener);
  }
  dispatchEvent(_event: unknown): boolean {
    return true;
  }
  fire(): void {
    this.aborted = true;
    const listeners = Array.from(this.abortListeners);
    this.abortListeners.clear();
    listeners.forEach((l) => l());
  }
}

class CompatAbortController {
  signal = new CompatAbortSignal();
  abort(): void {
    this.signal.fire();
  }
}

/** 优先使用全局实现（新版 Electron/Node），否则回退到内置兼容实现 */
const AbortControllerCtor: any = (globalThis as any).AbortController || CompatAbortController;

export type DownloadStatus = 'downloading' | 'paused' | 'done' | 'failed';

export interface DownloadTaskMeta {
  taskId: string;
  url: string;
  savePath: string;
  title: string;
  type: string;
  isM3U8: boolean;
  status: DownloadStatus;
  progress: number;
  error?: string;
  createdAt: number;
  finishedAt?: number;
  workDir: string;
}

export interface DownloadStartOptions {
  taskId: string;
  url: string;
  savePath: string;
  isM3U8?: boolean;
  title?: string;
  type?: string;
}

interface M3U8KeyInfo {
  method: string;
  uri: string;
  iv?: string;
}

interface M3U8Segment {
  url: string;
  key: M3U8KeyInfo | null;
  seq: number;
}

interface M3U8Playlist {
  baseUrl: string;
  segments: M3U8Segment[];
}

/** 解析 m3u8 内的相对地址：兼容 /绝对路径、相对路径、// 协议相对、完整 URL */
const resolveUrl = (ref: string, base: string): string => {
  if (/^https?:\/\//i.test(ref)) return ref;
  return new URL(ref, base).toString();
};

/**
 * 支持断点续传的下载管理器
 * - 单文件：写入 `savePath.part`，续传时通过 HTTP Range 从断点继续
 * - m3u8：分片缓存到 workDir，续传时跳过已下载分片
 * - 任务元数据持久化到 userData/downloads/tasks.json，应用重启后仍可继续
 */
type ManagedTask = DownloadTaskMeta & { controller?: AbortController };

export class DownloadManager {
  private tasks = new Map<string, ManagedTask>();
  private storageDir: string;
  private tasksFile: string;

  constructor() {
    this.storageDir = path.join(app.getPath('userData'), 'downloads');
    this.tasksFile = path.join(this.storageDir, 'tasks.json');
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.tasksFile)) {
        const list = JSON.parse(fs.readFileSync(this.tasksFile, 'utf-8')) as DownloadTaskMeta[];
        for (const t of list) {
          // 应用重启后没有进行中的下载，统一置为暂停，等待用户手动继续
          if (t.status === 'downloading') {
            t.status = 'paused';
            t.error = undefined;
          }
          this.tasks.set(t.taskId, t as ManagedTask);
        }
      }
    } catch (e) {
      console.error('[DownloadManager] 加载下载任务失败:', e);
    }
  }

  private persist() {
    try {
      const list = Array.from(this.tasks.values()).map(
        ({ controller: _controller, ...meta }) => meta
      );
      fs.mkdirSync(this.storageDir, { recursive: true });
      fs.writeFileSync(this.tasksFile, JSON.stringify(list, null, 2));
    } catch (e) {
      console.error('[DownloadManager] 保存下载任务失败:', e);
    }
  }

  getAll(): DownloadTaskMeta[] {
    return Array.from(this.tasks.values()).map(({ controller: _controller, ...meta }) => meta);
  }

  /** 启动或续传一个下载任务，resolve 时表示下载完成，reject 时表示失败或暂停 */
  async start(
    opts: DownloadStartOptions,
    onProgress: (progress: number) => void
  ): Promise<string> {
    const now = Date.now();
    const existing = this.tasks.get(opts.taskId);
    if (existing && existing.status === 'downloading') {
      return existing.taskId;
    }

    const task: ManagedTask = existing || {
      taskId: opts.taskId,
      url: opts.url,
      savePath: opts.savePath,
      title: opts.title || '',
      type: opts.type || (opts.isM3U8 ? 'm3u8' : 'video'),
      isM3U8: !!opts.isM3U8,
      status: 'downloading',
      progress: 0,
      createdAt: now,
      workDir: path.join(this.storageDir, 'tasks', opts.taskId),
    };
    // 每次（重新）启动都新建 AbortController：
    // - 首次启动必须创建，否则 runFile/runM3U8 读取 task.controller!.signal 会抛 TypeError
    // - 续传时旧 controller 可能已 abort，其 signal.aborted 永远为 true，会立即中断下载
    task.controller = new AbortControllerCtor();
    // 续传：复用已有 workDir / .part 缓存，仅更新状态
    task.url = opts.url;
    task.savePath = opts.savePath;
    if (opts.isM3U8 !== undefined) task.isM3U8 = opts.isM3U8;
    if (opts.title) task.title = opts.title;
    if (opts.type) task.type = opts.type;
    task.status = 'downloading';
    task.error = undefined;
    task.finishedAt = undefined;
    this.tasks.set(task.taskId, task);
    this.persist();

    try {
      let isM3U8 = task.isM3U8;
      if (!isM3U8) {
        try {
          const headRes = await got.head(task.url, {
            retry: 2,
            timeout: { request: 10000 },
            followRedirect: true,
          });
          const ct = headRes.headers['content-type'] || '';
          if (/mpegurl|x-mpegurl|m3u8/i.test(ct)) isM3U8 = true;
        } catch {
          isM3U8 = /\.m3u8([?#]|$)/i.test(task.url);
        }
        task.isM3U8 = isM3U8;
      }

      if (isM3U8) {
        await this.runM3U8(task, onProgress);
      } else {
        await this.runFile(task, onProgress);
      }

      task.status = 'done';
      task.progress = 100;
      task.finishedAt = Date.now();
      this.persist();
      onProgress(100);
      return task.taskId;
    } catch (e: any) {
      const aborted = task.controller?.signal.aborted;
      if (aborted) {
        task.status = 'paused';
        task.error = undefined;
        this.persist();
        const err = new Error('下载已暂停') as Error & { code?: string };
        err.code = 'PAUSED';
        throw err;
      }
      task.status = 'failed';
      task.error = e?.message || String(e);
      this.persist();
      throw e;
    }
  }

  /** 暂停正在下载的任务（保留已下载部分，可继续） */
  pause(taskId: string) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.controller?.abort();
    }
  }

  /** 取消任务并清理已下载的临时文件 */
  cancel(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.controller?.abort();
    try {
      fs.rmSync(task.workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      if (fs.existsSync(task.savePath + '.part')) {
        fs.unlinkSync(task.savePath + '.part');
      }
    } catch {
      /* ignore */
    }
    this.tasks.delete(taskId);
    this.persist();
  }

  /** 仅删除任务记录（用于已完成的记录清理） */
  remove(taskId: string) {
    this.tasks.delete(taskId);
    this.persist();
  }

  // ---------- 单文件下载（Range 断点续传） ----------

  private async runFile(task: DownloadTaskMeta, onProgress: (p: number) => void) {
    const signal = task.controller!.signal;
    const partPath = task.savePath + '.part';

    // 最终文件已存在（此前已完成），直接视为完成
    if (fs.existsSync(task.savePath)) {
      onProgress(100);
      return;
    }

    let partSize = 0;
    if (fs.existsSync(partPath)) {
      partSize = fs.statSync(partPath).size;
    }

    const stream = got.stream(task.url, {
      retry: 2,
      timeout: { response: 30000, read: 30000 },
      followRedirect: true,
      headers: partSize > 0 ? { range: `bytes=${partSize}-` } : undefined,
      signal,
    });

    await new Promise<void>((resolve, reject) => {
      let total = 0;
      let received = 0;
      let writeStream: fs.WriteStream | null = null;

      stream.on('response', (res: any) => {
        const cl = parseInt(String(res.headers['content-length'] || '0'), 10);
        if (res.statusCode === 206) {
          // 服务器支持 Range，从断点继续
          total = partSize + cl;
          writeStream = fs.createWriteStream(partPath, { flags: 'a' });
        } else if (res.statusCode === 200) {
          // 服务器不支持 Range，只能从头下载
          total = cl;
          if (partSize > 0) {
            partSize = 0;
            try {
              fs.unlinkSync(partPath);
            } catch {
              /* ignore */
            }
          }
          writeStream = fs.createWriteStream(partPath);
        } else {
          stream.destroy();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        writeStream.on('error', reject);
        writeStream.on('finish', () => resolve());
        stream.pipe(writeStream);
      });

      stream.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (total > 0) {
          onProgress(Math.min(99.5, ((partSize + received) / total) * 100));
        }
      });
      stream.on('error', reject);
    });

    // 完成：重命名 .part → 最终文件
    if (fs.existsSync(task.savePath)) {
      fs.unlinkSync(task.savePath);
    }
    fs.renameSync(partPath, task.savePath);
    onProgress(100);
  }

  // ---------- m3u8 下载（分片缓存续传） ----------

  private segPath(task: DownloadTaskMeta, index: number): string {
    return path.join(task.workDir, `seg_${index.toString().padStart(5, '0')}.ts`);
  }

  private async runM3U8(task: DownloadTaskMeta, onProgress: (p: number) => void) {
    const signal = task.controller!.signal;
    const playlistFile = path.join(task.workDir, 'playlist.json');

    let playlist: M3U8Playlist;
    if (fs.existsSync(playlistFile)) {
      // 断点续传：复用已缓存的分片清单，不再请求网络
      try {
        playlist = JSON.parse(fs.readFileSync(playlistFile, 'utf-8')) as M3U8Playlist;
      } catch {
        fs.unlinkSync(playlistFile);
        playlist = await this.fetchM3U8Playlist(task.url);
        fs.mkdirSync(task.workDir, { recursive: true });
        fs.writeFileSync(playlistFile, JSON.stringify(playlist));
      }
    } else {
      playlist = await this.fetchM3U8Playlist(task.url);
      fs.mkdirSync(task.workDir, { recursive: true });
      fs.writeFileSync(playlistFile, JSON.stringify(playlist));
    }

    // AES-128 key 缓存
    const keyCache = new Map<string, Buffer>();
    const getKeyBuffer = async (keyInfo: M3U8KeyInfo): Promise<Buffer> => {
      if (keyCache.has(keyInfo.uri)) return keyCache.get(keyInfo.uri)!;
      let keyBuf: Buffer;
      if (keyInfo.uri.startsWith('data:')) {
        const commaIdx = keyInfo.uri.indexOf(',');
        const b64 = commaIdx >= 0 ? keyInfo.uri.substring(commaIdx + 1) : '';
        keyBuf = Buffer.from(b64, 'base64');
      } else {
        const keyUrl = resolveUrl(keyInfo.uri, playlist.baseUrl);
        keyBuf = await got(keyUrl, {
          retry: 2,
          timeout: { request: 15000 },
          followRedirect: true,
          signal,
        }).buffer();
      }
      if (keyBuf.length !== 16) throw new Error('AES-128 密钥长度异常（需要 16 字节）');
      keyCache.set(keyInfo.uri, keyBuf);
      return keyBuf;
    };

    const decryptSegment = (data: Buffer, seg: M3U8Segment, key: Buffer): Buffer => {
      let iv: Buffer;
      if (seg.key?.iv) {
        iv = Buffer.from(seg.key.iv, 'hex');
      } else {
        // 默认 IV 为 media sequence 对应的 16 字节大端表示
        iv = Buffer.alloc(16);
        iv.writeUInt32BE(seg.seq, 12);
      }
      const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
      return Buffer.concat([decipher.update(data), decipher.final()]);
    };

    const segments = playlist.segments;
    const total = segments.length;

    // 统计已缓存分片，得出续传起点
    let completed = 0;
    for (let i = 0; i < total; i++) {
      const segPath = this.segPath(task, i);
      if (fs.existsSync(segPath) && fs.statSync(segPath).size > 0) completed++;
    }
    if (completed > 0) onProgress((completed / total) * 100);

    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new Error('下载已暂停');
      const seg = segments[i];
      const segPath = this.segPath(task, i);
      if (fs.existsSync(segPath) && fs.statSync(segPath).size > 0) continue;
      const tmpPath = segPath + '.tmp';
      try {
        await this.downloadToFile(seg.url, tmpPath, signal);
        let data = fs.readFileSync(tmpPath);
        if (seg.key) {
          const key = await getKeyBuffer(seg.key);
          data = decryptSegment(data, seg, key);
        }
        fs.writeFileSync(tmpPath, data);
        fs.renameSync(tmpPath, segPath);
      } catch (e: any) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
        if (signal.aborted) throw new Error('下载已暂停');
        throw new Error(`下载 TS 分片 ${i + 1}/${total} 失败: ${seg.url}`);
      }
      completed++;
      onProgress((completed / total) * 100);
    }

    // 全部就绪，拼接输出
    const outputStream = fs.createWriteStream(task.savePath);
    for (let i = 0; i < total; i++) {
      if (signal.aborted) {
        outputStream.destroy();
        throw new Error('下载已暂停');
      }
      const data = fs.readFileSync(this.segPath(task, i));
      outputStream.write(data);
    }
    await new Promise<void>((resolve, reject) => {
      outputStream.on('finish', () => resolve());
      outputStream.on('error', reject);
      outputStream.end();
    });
    // 完成后清理分片缓存
    fs.rmSync(task.workDir, { recursive: true, force: true });
    onProgress(100);
  }

  private downloadToFile(url: string, filePath: string, signal: AbortSignal): Promise<void> {
    const stream = got.stream(url, {
      retry: 2,
      timeout: { response: 30000, read: 30000 },
      followRedirect: true,
      signal,
    });
    const writeStream = fs.createWriteStream(filePath);
    return new Promise<void>((resolve, reject) => {
      stream.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('finish', () => resolve());
      stream.pipe(writeStream);
    });
  }

  /** 解析 m3u8（支持 master 变体流）并返回分片清单 */
  private async fetchM3U8Playlist(m3u8Url: string): Promise<M3U8Playlist> {
    const m3u8Text = await got(m3u8Url, {
      retry: 2,
      timeout: { request: 15000 },
      followRedirect: true,
    }).text();

    const lines = m3u8Text.split(/\r?\n/);

    // master 播放列表：选择带宽最高的变体流并递归解析
    const hasStreamInf = lines.some((l) => l.trim().startsWith('#EXT-X-STREAM-INF'));
    if (hasStreamInf) {
      let bestBandwidth = 0;
      let bestUrl = '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-STREAM-INF')) {
          const bwMatch = line.match(/BANDWIDTH=(\d+)/);
          const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;
          const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';
          if (nextLine && !nextLine.startsWith('#')) {
            if (bandwidth > bestBandwidth) {
              bestBandwidth = bandwidth;
              bestUrl = nextLine;
            }
          }
        }
      }
      if (!bestUrl) throw new Error('M3U8 中未找到有效的变体流');
      return this.fetchM3U8Playlist(resolveUrl(bestUrl, m3u8Url));
    }

    const segments: M3U8Segment[] = [];
    let currentKey: M3U8KeyInfo | null = null;
    let mediaSequence = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
        mediaSequence = parseInt(line.substring(line.indexOf(':') + 1).trim(), 10) || 0;
        continue;
      }
      if (line.startsWith('#EXT-X-KEY:')) {
        const attrs = line.substring('#EXT-X-KEY:'.length);
        const methodMatch = attrs.match(/METHOD=([^,]+)/);
        const method = methodMatch ? methodMatch[1].trim() : '';
        if (method === 'AES-128') {
          const uriMatch = attrs.match(/URI="([^"]+)"/);
          const ivMatch = attrs.match(/IV=0x([0-9a-fA-F]+)/);
          currentKey = {
            method,
            uri: uriMatch ? uriMatch[1] : '',
            iv: ivMatch ? ivMatch[1] : undefined,
          };
        } else if (method.toUpperCase() === 'NONE') {
          currentKey = null;
        }
        continue;
      }
      if (line.startsWith('#') || !line) continue;
      segments.push({ url: resolveUrl(line, m3u8Url), key: currentKey, seq: mediaSequence });
      mediaSequence++;
    }
    if (segments.length === 0) throw new Error('M3U8 播放列表中未找到任何分片');
    return { baseUrl: m3u8Url, segments };
  }
}
