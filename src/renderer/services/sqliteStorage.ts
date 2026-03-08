/**
 * SQLite 存储适配器
 * 提供与 Storage 类相同的接口，但使用本地 SQLite 数据库存储
 */
import { encryptObj, decryptObj } from '@/utils/crypto';
import type { ContentRef } from './storageTypes';

// 表名映射（从 ThingsStorage 的 path 到表名）
const TABLE_MAP: Record<string, string> = {
  'store/setting.json': 'settings',
  'store/star_sites.json': 'star_sites',
  'store/stock_settings.json': 'stock_settings',
  'store/books.json': 'books',
  'store/tradings.json': 'tradings',
  'store/trainings.json': 'trainings',
  'store/ktrainings.json': 'ktrainings',
  'store/strategy_groups.json': 'strategy_groups',
};

const { electron } = window.contextModules;

export class SQLiteRefError extends Error {
  code: number;

  constructor(code: number, m = 'Error') {
    super(m);
    this.code = code;
  }
}

export class SQLiteContentRef implements ContentRef {
  encryptKey: string;

  table: string;

  id?: number | string | object;

  reading: boolean;

  writing: boolean;

  writing_Indexs: Record<number, boolean>;

  _cache: { cached: boolean; content: any; lastModified: string };

  constructor(table: string, id: number | string | object | undefined, options: { encryptKey: string }) {
    this.encryptKey = options.encryptKey;
    this.table = table;
    this.id = id;
    this.reading = false;
    this.writing = false;
    this.writing_Indexs = {};
    this._cache = {
      cached: false,
      content: null,
      lastModified: '1970-01-01 00:00:00',
    };
  }

  _parse(json: string) {
    const obj = JSON.parse(json);
    return decryptObj(obj, this.encryptKey);
  }

  _stringify(obj: any) {
    const enc = encryptObj(obj, this.encryptKey);
    return JSON.stringify(enc, null, ' ');
  }

  async load() {
    if (this.reading) {
      while (this.reading) {
        // 等待直到读取完成
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return this._cache.content;
    }
    this.reading = true;

    try {
      const result = await electron.sqliteRead(this.table, this.id);
      
      if (!result.success || !result.data) {
        // 数据不存在，抛出 404 错误
        this.reading = false;
        const error = new SQLiteRefError(404, 'Data not found');
        throw error;
      }

      const { data, lastModified } = result.data;
      this._cache.cached = true;
      this._cache.content = data;
      this._cache.lastModified = lastModified;
      
      this.reading = false;
      return this._cache.content;
    } catch (e: any) {
      this.reading = false;
      if (e instanceof SQLiteRefError) {
        throw e;
      }
      console.error('[SQLiteContentRef] Error loading data:', e);
      throw new SQLiteRefError(500, e.message);
    }
  }

  async save(contentObj: any) {
    if (this.writing) {
      // cancel waiting writing
      const keys = Object.keys(this.writing_Indexs).map((s) => parseInt(s));
      keys.forEach((i) => (this.writing_Indexs[i] = false));
      const curKey = keys.length ? Math.max(...keys) + 1 : 0;
      this.writing_Indexs[curKey] = true;
      while (this.writing && this.writing_Indexs[curKey]) {
        // 等待直到写入完成
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const willContinue = this.writing_Indexs[curKey];
      delete this.writing_Indexs[curKey];
      if (!willContinue) {
        // 无需执行中间的写入操作
        return;
      }
      console.log('[SQLiteContentRef] Will continue writing');
    }

    this.writing = true;
    try {
      const lastModified = contentObj.lastModified || new Date().toISOString();
      const result = await electron.sqliteWrite(this.table, contentObj.data, lastModified, this.id);
      
      if (result.success) {
        this._cache.content = contentObj.data;
        this._cache.lastModified = lastModified;
        this._cache.cached = true;
        console.log('[SQLiteContentRef] Cache updated:', this.table, this.id);
        this.writing = false;
        return { success: true };
      } else {
        this.writing = false;
        throw new SQLiteRefError(500, result.error || 'Write failed');
      }
    } catch (e: any) {
      console.error('[SQLiteContentRef] Error saving data:', e);
      this.writing = false;
      return null;
    }
  }

  async delete() {
    try {
      const result = await electron.sqliteDelete(this.table, this.id);
      if (result.success) {
        this._cache.cached = false;
        this._cache.content = null;
        return { success: true };
      }
      return null;
    } catch (e: any) {
      console.error('[SQLiteContentRef] Error deleting data:', e);
      return null;
    }
  }
}

export class SQLiteStorage {
  encryptKey: string;

  refs: Record<string, SQLiteContentRef>;

  initialized: boolean;

  constructor(options: { encryptKey: string } = { encryptKey: 'jimmy' }) {
    this.encryptKey = options.encryptKey;
    this.refs = {};
    this.initialized = false;
  }

  async init() {
    if (this.initialized) {
      return;
    }
    const result = await electron.sqliteInit();
    if (result.success) {
      this.initialized = true;
      console.log('[SQLiteStorage] Initialized successfully');
    } else {
      console.error('[SQLiteStorage] Failed to initialize:', result.error);
      throw new Error(result.error);
    }
  }

  // 将文件路径转换为表名
  pathToTable(path: string): { table: string; id?: number | string | object } {
    if (!path) {
      console.error('[SQLiteStorage] path is undefined or empty');
      return { table: 'unknown' };
    }
    
    // 检查是否是笔记路径 note_${bookId}_${noteId}.json
    const noteMatch = path.match(/note_(\d+)_(.+?)\.json$/);
    if (noteMatch) {
      return {
        table: 'notes',
        id: { bookId: parseInt(noteMatch[1]), noteId: noteMatch[2] },
      };
    }

    // 检查是否是策略路径 strategy_${groupId}_${strategyId}.json
    const strategyMatch = path.match(/strategy_(\d+)_(\d+)\.json$/);
    if (strategyMatch) {
      return {
        table: 'strategies',
        id: { groupId: parseInt(strategyMatch[1]), strategyId: parseInt(strategyMatch[2]) },
      };
    }

    // 使用 TABLE_MAP 映射
    const table = TABLE_MAP[path];
    if (table) {
      return { table };
    }

    // 默认使用路径作为表名（去掉扩展名和目录）
    const defaultTable = path.replace(/\//g, '_').replace(/\.json$/, '');
    return { table: defaultTable };
  }

  async ref(path: string, initContent = '{}') {
    await this.init();

    const c = this.refs[path];
    if (c && c._cache && c._cache.cached) {
      return this.refs[path];
    }

    const { table, id } = this.pathToTable(path);

    // 检查数据是否存在
    const existedItem = await this.existsRef(table, id);
    if (!existedItem) {
      // 初始化数据
      const defaultData = JSON.parse(initContent);
      const lastModified = new Date().toISOString();
      await electron.sqliteWrite(table, defaultData, lastModified, id);
    }

    this.refs[path] = new SQLiteContentRef(table, id, { encryptKey: this.encryptKey });
    return this.refs[path];
  }

  async existsRef(table: string, id?: number | string | object): Promise<boolean> {
    try {
      const result = await electron.sqliteRead(table, id);
      return result.success && result.data !== null;
    } catch (error) {
      return false;
    }
  }

  // 获取数据库统计信息
  async getStats() {
    return electron.sqliteStats();
  }

  // 备份数据库
  async backup(backupPath: string) {
    return electron.sqliteBackup(backupPath);
  }
}

export default SQLiteStorage;
