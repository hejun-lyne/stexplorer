/**
 * SQLite 数据库服务
 * 用于本地数据存储，作为 GitHub 存储的替代方案
 */
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
// 动态加载 better-sqlite3
const loadDatabase = () => {
  try {
    // 首先尝试正常加载（开发环境）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('better-sqlite3');
  } catch (e) {
    // 生产环境：从 extraResources 加载
    const resourcesPath = process.resourcesPath;
    const betterSqlite3Path = path.join(resourcesPath, 'node_modules', 'better-sqlite3');
    console.log('[Database] Loading better-sqlite3 from:', betterSqlite3Path);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(betterSqlite3Path);
  }
};

// 数据库实例
let db: any | null = null;

// 数据库文件路径
function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'stexplorer.db');
}

// 初始化数据库
export function initDatabase(): any {
  if (db) {
    return db;
  }

  const dbPath = getDbPath();
  console.log('[Database] Opening database at:', dbPath);

  // 确保目录存在
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const Database = loadDatabase();
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 创建表结构
  createTables();

  console.log('[Database] Database initialized successfully');
  return db;
}

// 关闭数据库
export function closeDatabase(): void {
  if (db) {
    console.log('[Database] Closing database');
    db.close();
    db = null;
  }
}

// 获取数据库实例
export function getDatabase(): any {
  if (!db) {
    return initDatabase();
  }
  return db;
}

// 创建表结构
function createTables(): void {
  if (!db) return;

  // 设置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      last_modified TEXT NOT NULL
    )
  `);

  // 收藏网站表
  db.exec(`
    CREATE TABLE IF NOT EXISTS star_sites (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      last_modified TEXT NOT NULL
    )
  `);

  // 股票设置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      last_modified TEXT NOT NULL
    )
  `);

  // 交易记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS tradings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      last_modified TEXT NOT NULL
    )
  `);

  // 训练记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS trainings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      last_modified TEXT NOT NULL
    )
  `);

  // K线训练记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS ktrainings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      last_modified TEXT NOT NULL
    )
  `);

  // 笔记本表
  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      last_modified TEXT NOT NULL
    )
  `);

  // 笔记内容表（单独存储）
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      book_id INTEGER NOT NULL,
      note_id INTEGER NOT NULL,
      data TEXT NOT NULL,
      last_modified TEXT NOT NULL,
      PRIMARY KEY (book_id, note_id)
    )
  `);

  // 策略组表
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategy_groups (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      last_modified TEXT NOT NULL
    )
  `);

  // 策略内容表（单独存储）
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategies (
      group_id INTEGER NOT NULL,
      strategy_id INTEGER NOT NULL,
      data TEXT NOT NULL,
      last_modified TEXT NOT NULL,
      PRIMARY KEY (group_id, strategy_id)
    )
  `);

  console.log('[Database] Tables created successfully');
}

// 读取数据
export function readData(table: string, id?: number | string | object): { lastModified: string; data: any } | null {
  const database = getDatabase();
  let stmt: any;
  let result: any;

  try {
    if (table === 'notes') {
      // 笔记需要 book_id 和 note_id
      if (typeof id === 'object') {
        const { bookId, noteId } = id as { bookId: number; noteId: number | string };
        stmt = database.prepare('SELECT data, last_modified FROM notes WHERE book_id = ? AND note_id = ?');
        result = stmt.get(bookId, noteId);
      }
    } else if (table === 'strategies') {
      // 策略需要 group_id 和 strategy_id
      if (typeof id === 'object') {
        const { groupId, strategyId } = id as { groupId: number; strategyId: number };
        stmt = database.prepare('SELECT data, last_modified FROM strategies WHERE group_id = ? AND strategy_id = ?');
        result = stmt.get(groupId, strategyId);
      }
    } else {
      stmt = database.prepare(`SELECT data, last_modified FROM ${table} WHERE id = 1`);
      result = stmt.get();
    }

    if (!result) {
      return null;
    }

    return {
      lastModified: result.last_modified,
      data: JSON.parse(result.data),
    };
  } catch (error) {
    console.error(`[Database] Error reading from ${table}:`, error);
    throw error;
  }
}

// 写入数据
export function writeData(table: string, data: any, lastModified: string, id?: number | string | object): void {
  const database = getDatabase();

  try {
    const dataStr = JSON.stringify(data);

    if (table === 'notes') {
      // 笔记需要 book_id 和 note_id
      if (typeof id === 'object') {
        const { bookId, noteId } = id as { bookId: number; noteId: number | string };
        const stmt = database.prepare(`
          INSERT INTO notes (book_id, note_id, data, last_modified)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(book_id, note_id) DO UPDATE SET
          data = excluded.data,
          last_modified = excluded.last_modified
        `);
        stmt.run(bookId, noteId, dataStr, lastModified);
      }
    } else if (table === 'strategies') {
      // 策略需要 group_id 和 strategy_id
      if (typeof id === 'object') {
        const { groupId, strategyId } = id as { groupId: number; strategyId: number };
        const stmt = database.prepare(`
          INSERT INTO strategies (group_id, strategy_id, data, last_modified)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(group_id, strategy_id) DO UPDATE SET
          data = excluded.data,
          last_modified = excluded.last_modified
        `);
        stmt.run(groupId, strategyId, dataStr, lastModified);
      }
    } else {
      const stmt = database.prepare(`
        INSERT INTO ${table} (id, data, last_modified)
        VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
        data = excluded.data,
        last_modified = excluded.last_modified
      `);
      stmt.run(dataStr, lastModified);
    }

    console.log(`[Database] Data written to ${table}`);
  } catch (error) {
    console.error(`[Database] Error writing to ${table}:`, error);
    throw error;
  }
}

// 删除数据
export function deleteData(table: string, id?: number | string | object): void {
  const database = getDatabase();

  try {
    if (table === 'notes' && typeof id === 'object') {
      const { bookId, noteId } = id as { bookId: number; noteId: number | string };
      const stmt = database.prepare('DELETE FROM notes WHERE book_id = ? AND note_id = ?');
      stmt.run(bookId, noteId);
    } else if (table === 'strategies' && typeof id === 'object') {
      const { groupId, strategyId } = id as { groupId: number; strategyId: number };
      const stmt = database.prepare('DELETE FROM strategies WHERE group_id = ? AND strategy_id = ?');
      stmt.run(groupId, strategyId);
    } else {
      const stmt = database.prepare(`DELETE FROM ${table} WHERE id = 1`);
      stmt.run();
    }

    console.log(`[Database] Data deleted from ${table}`);
  } catch (error) {
    console.error(`[Database] Error deleting from ${table}:`, error);
    throw error;
  }
}

// 获取数据库统计信息
export function getDatabaseStats(): { size: number; tables: string[] } {
  const database = getDatabase();
  const dbPath = getDbPath();

  try {
    const stats = fs.statSync(dbPath);
    const stmt = database.prepare("SELECT name FROM sqlite_master WHERE type='table'");
    const tables = stmt.all().map((row: any) => row.name);

    return {
      size: stats.size,
      tables,
    };
  } catch (error) {
    console.error('[Database] Error getting stats:', error);
    return { size: 0, tables: [] };
  }
}

// 备份数据库
export function backupDatabase(backupPath: string): void {
  const database = getDatabase();

  try {
    database.backup(backupPath);
    console.log('[Database] Backup created at:', backupPath);
  } catch (error) {
    console.error('[Database] Error creating backup:', error);
    throw error;
  }
}

// 表名映射（从 ThingsStorage 的 path 到表名）
export const TABLE_MAP: Record<string, string> = {
  'store/setting.json': 'settings',
  'store/star_sites.json': 'star_sites',
  'store/stock_settings.json': 'stock_settings',
  'store/books.json': 'books',
  'store/tradings.json': 'tradings',
  'store/trainings.json': 'trainings',
  'store/ktrainings.json': 'ktrainings',
  'store/strategy_groups.json': 'strategy_groups',
};

export default {
  initDatabase,
  closeDatabase,
  getDatabase,
  readData,
  writeData,
  deleteData,
  getDatabaseStats,
  backupDatabase,
  TABLE_MAP,
};
