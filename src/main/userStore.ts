/**
 * 用户数据库访问层（主进程侧）
 *
 * 与 cacheStore（股票数据：分时/K线/板块/技术指标）彻底分开：
 * 收藏、标签、配置、复盘、盘前分析、训练进度、买卖记录等用户数据统一落
 * `<storage>/user_db/user_data.db`，通过常驻 python 进程 user_db.py 读写。
 *
 * key 规则沿用 cacheStore 的 `local:<相对路径>`，因此从 stock_db 迁移过来后
 * 数据结构（邮件信封 {lastModified, data}）保持兼容，前端无需改动读取语义。
 */

import { pythonService } from './pythonServer';
import * as localFileStorage from './localFileStorage';

const USER_SCRIPT = 'user_db.py';

let fallbackWarned = false;

function warnFallback(reason: unknown) {
  if (fallbackWarned) {
    return;
  }
  fallbackWarned = true;
  console.error('[UserStore] 用户数据库不可用，已回退到文件存储:', reason);
}

async function callUserApi(method: string, params: Record<string, any>): Promise<any> {
  const storagePath = localFileStorage.getStoragePath();
  const args = [method, '--params', JSON.stringify(params)];
  if (storagePath) {
    args.push('--storage-path', storagePath);
  }
  const lines = await pythonService.run(USER_SCRIPT, args);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      continue;
    }
    if (parsed && typeof parsed === 'object' && parsed.error !== undefined && parsed.data === undefined) {
      throw new Error(String(parsed.error));
    }
    return parsed;
  }
  throw new Error(`用户数据库接口无有效返回: ${method}`);
}

/**
 * 走用户数据库的表白名单（对应 localFileStorage.FILE_MAP 中承载用户数据的表）。
 *
 * 注意：这里只列「用户数据」表；股票相关缓存表（stock_trend/kline_cache/...）
 * 仍由 cacheStore 管，二者不得交叉。
 */
const USER_DB_TABLES = new Set<string>([
  'settings',
  'star_sites',
  'stock_settings',
  'tradings',
  'trainings',
  'ktrainings',
  'train_trade_records',
  'train_progress',
  'train_archives',
  'books',
  'strategy_groups',
]);

export function isUserDbTable(table: string): boolean {
  return USER_DB_TABLES.has(table);
}

function localDataKey(table: string, id?: number | string | object): string {
  return `local:${localFileStorage.getStorageRelPath(table, id)}`;
}

export async function readLocalData(
  table: string,
  id?: number | string | object,
): Promise<{ lastModified: string; data: any } | null> {
  try {
    const stored = await callUserApi('get', { key: localDataKey(table, id) });
    if (stored !== null && stored !== undefined) {
      return {
        lastModified: stored.lastModified || '1970-01-01 00:00:00',
        data: stored.data,
      };
    }
    // 数据库未命中：回退读旧 JSON 文件，兼容尚未迁移的历史数据
    return localFileStorage.readLocalData(table, id);
  } catch (error) {
    warnFallback(error);
    return localFileStorage.readLocalData(table, id);
  }
}

export async function writeLocalData(
  table: string,
  data: any,
  lastModified: string,
  id?: number | string | object,
): Promise<boolean> {
  try {
    const ok = await callUserApi('put', {
      key: localDataKey(table, id),
      value: { lastModified, data },
    });
    return ok !== false;
  } catch (error) {
    warnFallback(error);
    return localFileStorage.writeLocalData(table, data, lastModified, id);
  }
}

export async function deleteLocalData(table: string, id?: number | string | object): Promise<boolean> {
  try {
    const ok = await callUserApi('delete', { key: localDataKey(table, id) });
    return ok !== false;
  } catch (error) {
    warnFallback(error);
    return localFileStorage.deleteLocalData(table, id);
  }
}

/** 把旧版写在股票库 api_cache 里的 local: 用户数据一次性搬到用户库 */
export async function migrateFromStockDb(): Promise<any> {
  return callUserApi('migrate_from_stock_db', {});
}

/** 浏览器 localStorage 命名空间：复盘/盘前笔记等同步读的用户数据镜像 */
const LS_PREFIX = 'ls:';

export async function readLocalStorageMirror(key: string): Promise<any> {
  if (!key) {
    return null;
  }
  try {
    return await callUserApi('get', { key: `${LS_PREFIX}${key}` });
  } catch (error) {
    warnFallback(error);
    return null;
  }
}

export async function writeLocalStorageMirror(key: string, value: any): Promise<boolean> {
  if (!key) {
    return false;
  }
  try {
    const ok = await callUserApi('put', { key: `${LS_PREFIX}${key}`, value });
    return ok !== false;
  } catch (error) {
    warnFallback(error);
    return false;
  }
}
