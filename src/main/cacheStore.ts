/**
 * 回测/业务 KV 缓存的数据库实现（主进程侧）
 *
 * 背景：
 *   旧实现把缓存写成 `backups/backtest_cache/{key}.json` 一个 key 一个文件
 *   （如 `stock_bankuais_1.600519.json`、回测面板 HISTORY_CACHE_KEY 等），
 *   文件多、读写慢、与云盘同步还会产生冲突文件。
 *
 * 现方案：
 *   统一落到 tushare 那套 stock_db 数据库的 `api_cache` 表（`<storage>/stock_db/meta.db`），
 *   通过已有的常驻 Python 进程（py_service.py + stock_db.py 的 CacheAPI）读写，
 *   渲染进程的 readCache / writeCache IPC 契约完全不变。
 *
 * 降级：
 *   常驻进程不可用时回退到旧的 JSON 文件读写，保证功能不中断。
 */

import { pythonService } from './pythonServer';
import * as localFileStorage from './localFileStorage';

/** 承载 CacheAPI 的脚本（已加入 PERSISTENT_SCRIPTS，进程常驻） */
const CACHE_SCRIPT = 'stock_db.py';

let fallbackWarned = false;

function warnFallback(reason: unknown) {
  if (fallbackWarned) {
    return;
  }
  fallbackWarned = true;
  console.error('[CacheStore] 数据库缓存不可用，已回退到文件缓存:', reason);
}

/**
 * 调用 stock_db.py 的 CacheAPI 方法。
 * pythonService 的返回结构为 [...日志行, JSON结果]，结果在最后一行。
 */
async function callCacheApi(method: string, params: Record<string, any>): Promise<any> {
  const storagePath = localFileStorage.getStoragePath();
  const args = [method, '--params', JSON.stringify(params)];
  if (storagePath) {
    args.push('--storage-path', storagePath);
  }
  const lines = await pythonService.run(CACHE_SCRIPT, args);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line || !line.startsWith('{')) {
      continue;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      continue;
    }
    // python 侧异常时返回的是 { error: '...' }
    if (parsed && typeof parsed === 'object' && parsed.error !== undefined && parsed.data === undefined) {
      throw new Error(String(parsed.error));
    }
    return parsed;
  }
  throw new Error(`缓存接口无有效返回: ${method}`);
}

/**
 * 读取缓存。
 * 返回结构与旧文件实现一致（文件内容原样返回），如 `{ data, cachedAt }`；未命中返回 null。
 */
export async function readCache(key: string): Promise<any | null> {
  try {
    const result = await callCacheApi('get', { key });
    if (result !== null && result !== undefined) {
      return result;
    }
    // 数据库未命中：回退读旧 JSON 文件，兼容尚未迁移的历史缓存
    return localFileStorage.readCache(key);
  } catch (error) {
    warnFallback(error);
    return localFileStorage.readCache(key);
  }
}

/**
 * 写入缓存。
 * `data` 为业务数据本体，由 Python 侧统一包一层 `{ data, cachedAt }` 信封。
 */
export async function writeCache(key: string, data: any): Promise<boolean> {
  try {
    const ok = await callCacheApi('put', { key, data });
    return ok !== false;
  } catch (error) {
    warnFallback(error);
    return localFileStorage.writeCache(key, data);
  }
}

/** 删除缓存条目 */
export async function deleteCache(key: string): Promise<boolean> {
  try {
    const ok = await callCacheApi('delete', { key });
    return ok !== false;
  } catch (error) {
    warnFallback(error);
    return false;
  }
}

/** 批量读取，返回 key → 缓存内容（未命中为 null）。用于按列表批量取缓存的场景。 */
export async function readCacheMany(keys: string[]): Promise<Record<string, any>> {
  const result: Record<string, any> = {};
  await Promise.all(
    keys.map(async (key) => {
      result[key] = await readCache(key);
    }),
  );
  return result;
}

/** 缓存规模信息（诊断用） */
export async function cacheInfo(): Promise<any> {
  try {
    return await callCacheApi('info', {});
  } catch (error) {
    warnFallback(error);
    return { root: null, entries: -1, error: String(error) };
  }
}

// ============================================================
// 本地数据层（sqlite-read / sqlite-write）的数据库实现
// ============================================================

/**
 * 走数据库的「缓存类」表白名单。
 *
 * 注意：sqlite-read/sqlite-write 同时被 settings / notes / books 等**用户数据**复用
 * （见 services/localStorage.ts），那些必须继续留在文件里，因此这里只列缓存类表。
 * 后续要迁移别的缓存表，往这个集合里加表名即可。
 */
const DB_BACKED_TABLES = new Set<string>([
  'stock_trend',
  'kline_cache',
  'board_stocks_cache',
]);

/** 判断某张表是否已改为数据库存储 */
export function isDbBackedTable(table: string): boolean {
  if (DB_BACKED_TABLES.has(table)) {
    return true;
  }
  // 兼容 kimi_analysis_<hash> 这类带后缀的表名
  for (const name of DB_BACKED_TABLES) {
    if (table.indexOf(name) >= 0) {
      return true;
    }
  }
  return false;
}

/** 数据库 key：与旧文件相对路径一一对应，便于迁移与排查 */
function localDataKey(table: string, id?: number | string | object): string {
  return `local:${localFileStorage.getStorageRelPath(table, id)}`;
}

/**
 * 读取本地数据（旧 `<dataDir>/<relPath>.json`）。
 * 返回结构与文件实现一致：`{ lastModified, data }`；不存在返回 null。
 */
export async function readLocalData(
  table: string,
  id?: number | string | object,
): Promise<{ lastModified: string; data: any } | null> {
  try {
    const stored = await callCacheApi('get_raw', { key: localDataKey(table, id) });
    if (stored !== null && stored !== undefined) {
      return {
        lastModified: stored.lastModified || '1970-01-01 00:00:00',
        data: stored.data,
      };
    }
    // 数据库未命中：回退读旧文件，兼容尚未迁移的历史缓存
    return localFileStorage.readLocalData(table, id);
  } catch (error) {
    warnFallback(error);
    return localFileStorage.readLocalData(table, id);
  }
}

/** 写入本地数据；数据库不可用时回退写文件 */
export async function writeLocalData(
  table: string,
  data: any,
  lastModified: string,
  id?: number | string | object,
): Promise<boolean> {
  try {
    const ok = await callCacheApi('put_raw', {
      key: localDataKey(table, id),
      value: { lastModified, data },
    });
    return ok !== false;
  } catch (error) {
    warnFallback(error);
    return localFileStorage.writeLocalData(table, data, lastModified, id);
  }
}

/** 删除本地数据 */
export async function deleteLocalData(table: string, id?: number | string | object): Promise<boolean> {
  try {
    const ok = await callCacheApi('delete', { key: localDataKey(table, id) });
    return ok !== false;
  } catch (error) {
    warnFallback(error);
    return localFileStorage.deleteLocalData(table, id);
  }
}
