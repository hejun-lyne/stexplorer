/**
 * 常驻 Python 服务（主进程侧）
 *
 * 旧模式：渲染进程每次取数都触发主进程 spawn 一个新 python 进程
 *        （重新启动解释器 + import pandas/tushare + 初始化 stock_db），
 *        训练模式点一次「下一天」会发起多路取数，于是「一个接一个启动进程」非常慢。
 *
 * 新模式：按目标脚本维护一个常驻子进程，之后所有调用通过 stdin/stdout 的 JSON 行协议传递，
 *        进程只启动一次，import 只做一次。对外仍保持 execPyScript 的返回结构
 *        （stdout 行数组，末行为 JSON 结果），渲染进程无需改动。
 *
 * 协议见 src/main/python/py_service.py。
 */

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { app } from 'electron';
import * as path from 'path';

/**
 * 走常驻进程的脚本；其余脚本（如 hello.py）仍回退到「每次 spawn」。
 * stock_db.py 承载主进程 KV 缓存（CacheAPI）的读写，属于高频调用，同样常驻。
 */
export const PERSISTENT_SCRIPTS = new Set<string>([
  'tushare_api.py',
  'akshare_api.py',
  'stock_db.py',
]);

interface PendingTask {
  resolve: (value: string[]) => void;
  reject: (reason?: any) => void;
}

interface PyChild {
  proc: ChildProcessWithoutNullStreams;
  stdoutBuffer: string;
  pending: Map<number, PendingTask>;
  seq: number;
}

/** 解析 python 脚本目录（与旧 run-python-script 保持一致） */
export function resolvePythonScriptDir(): string {
  if (process.env.PYTHON_SCRIPT_PATH) {
    return process.env.PYTHON_SCRIPT_PATH;
  }
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    return path.join(__dirname, '../python');
  }
  return path.join(process.resourcesPath, 'python');
}

/**
 * 每个脚本最多起几个常驻进程
 *
 * py_service.py 是「一行一个请求、串行处理」的循环，所以单进程时渲染层的并发在 IPC 边界会被压成 1；
 * 起 2~3 个进程轮转，才能真正并行（取数/批量方法内部另有线程池）。
 * 进程是按需创建的：只有「现有进程都忙」且未达上限时才再起一个，平时只占 1 个进程。
 */
const MAX_WORKERS_PER_SCRIPT = Math.max(1, Number(process.env.PY_MAX_WORKERS) || 3);

class PythonService {
  /** 每个脚本对应一组常驻进程（轮转使用） */
  private children = new Map<string, PyChild[]>();

  private pythonPath =
    process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : '/usr/bin/python3');

  /**
   * 调用常驻进程，返回 stdout 行数组（末行为 JSON 结果），与旧 execPyScript 一致
   */
  run(fileName: string, args: string[]): Promise<string[]> {
    const child = this.acquireChild(fileName);
    return new Promise<string[]>((resolve, reject) => {
      const id = child.seq + 1;
      child.seq = id;
      child.pending.set(id, { resolve, reject });
      try {
        child.proc.stdin.write(`${JSON.stringify({ id, args })}\n`);
      } catch (error) {
        child.pending.delete(id);
        reject(error);
      }
    });
  }

  /**
   * 选一个进程执行本次调用：
   * 1) 有完全空闲的进程（没有在排队/执行的请求）→ 直接用；
   * 2) 都忙且未达上限 → 再起一个新进程（首次会付一次 python import 成本，之后一直复用）；
   * 3) 已达上限 → 交给排队最少的那个，避免某个进程积压。
   */
  private acquireChild(fileName: string): PyChild {
    const pool = this.children.get(fileName) || [];
    const idle = pool.find((c) => c.pending.size === 0);
    if (idle) {
      return idle;
    }
    if (pool.length < MAX_WORKERS_PER_SCRIPT) {
      return this.spawnChild(fileName);
    }
    return pool.reduce((a, b) => (a.pending.size <= b.pending.size ? a : b));
  }

  private spawnChild(fileName: string): PyChild {
    const scriptDir = resolvePythonScriptDir();
    const serviceScript = path.join(scriptDir, 'py_service.py');
    const proc = spawn(this.pythonPath, ['-u', serviceScript, fileName], {
      cwd: scriptDir,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    }) as ChildProcessWithoutNullStreams;

    const child: PyChild = { proc, stdoutBuffer: '', pending: new Map(), seq: 0 };
    const pool = this.children.get(fileName) || [];
    pool.push(child);
    this.children.set(fileName, pool);
    console.log(`[py] 启动常驻进程: ${fileName} #${pool.length} (${this.pythonPath})`);

    proc.stdout.on('data', (data: Buffer) => {
      child.stdoutBuffer += data.toString();
      let idx = child.stdoutBuffer.indexOf('\n');
      while (idx >= 0) {
        const line = child.stdoutBuffer.slice(0, idx).trim();
        child.stdoutBuffer = child.stdoutBuffer.slice(idx + 1);
        if (line) {
          this.handleLine(child, line);
        }
        idx = child.stdoutBuffer.indexOf('\n');
      }
    });

    // python 侧的诊断输出统一走 stderr，直接打到主进程控制台
    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        console.log(`[py:${fileName}] ${text}`);
      }
    });

    proc.on('error', (err: Error) => {
      console.error(`[py:${fileName}] 常驻进程启动失败:`, err);
      this.removeChild(fileName, child);
      this.rejectAll(child, err);
    });

    proc.on('close', (code: number | null) => {
      this.removeChild(fileName, child);
      this.rejectAll(child, new Error(`python 常驻进程退出，code=${code}`));
    });

    return child;
  }

  /** 进程退出/启动失败后从进程池里摘掉（池空了就删除该脚本的键） */
  private removeChild(fileName: string, child: PyChild) {
    const pool = this.children.get(fileName);
    if (!pool) {
      return;
    }
    const next = pool.filter((c) => c !== child);
    if (next.length) {
      this.children.set(fileName, next);
    } else {
      this.children.delete(fileName);
    }
  }

  private handleLine(child: PyChild, line: string) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch (e) {
      // import 期的零散输出等非协议行，忽略即可
      return;
    }
    const task = child.pending.get(msg.id);
    if (!task) {
      return;
    }
    child.pending.delete(msg.id);
    const logs: string[] = Array.isArray(msg.logs) ? msg.logs : [];
    if (msg.ok) {
      // 保持旧返回结构：[...日志行, JSON结果]，渲染进程从末尾找 JSON 行解析
      task.resolve([...logs, JSON.stringify(msg.data === undefined ? null : msg.data)]);
    } else {
      task.resolve([...logs, JSON.stringify({ error: msg.error || 'python 调用失败' })]);
    }
  }

  private rejectAll(child: PyChild, reason: any) {
    child.pending.forEach((task) => task.reject(reason));
    child.pending.clear();
  }

  /** 退出应用时回收所有常驻进程（含并发池里的每一个） */
  dispose() {
    this.children.forEach((pool, fileName) => {
      pool.forEach((child) => {
        try {
          child.proc.stdin.end();
        } catch (e) {
          // ignore
        }
        try {
          child.proc.kill();
        } catch (e) {
          // ignore
        }
      });
      this.children.delete(fileName);
    });
  }
}

export const pythonService = new PythonService();
