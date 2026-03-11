/**
 * 本地文件存储服务
 * 用于替代 SQLite 数据库，直接使用 JSON 文件存储数据
 */
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// 存储目录
let dataDir: string = '';

// 文件路径映射（从表名到文件名）
const FILE_MAP: Record<string, string> = {
  settings: 'settings.json',
  star_sites: 'star_sites.json',
  stock_settings: 'stock_settings.json',
  tradings: 'tradings.json',
  trainings: 'trainings.json',
  ktrainings: 'ktrainings.json',
  books: 'books.json',
  strategy_groups: 'strategy_groups.json',
};

// 笔记目录
const NOTES_DIR = 'notes';
// 策略目录
const STRATEGIES_DIR = 'strategies';

// 获取存储目录路径（不初始化）
export function getStoragePath(): string {
  if (!dataDir) {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'storage');
  }
  return dataDir;
}

// 初始化存储
export function initLocalFileStorage(): boolean {
  try {
    const userDataPath = app.getPath('userData');
    dataDir = path.join(userDataPath, 'storage');
    
    // 确保存储目录存在
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // 确保笔记目录存在
    const notesDir = path.join(dataDir, NOTES_DIR);
    if (!fs.existsSync(notesDir)) {
      fs.mkdirSync(notesDir, { recursive: true });
    }
    
    // 确保策略目录存在
    const strategiesDir = path.join(dataDir, STRATEGIES_DIR);
    if (!fs.existsSync(strategiesDir)) {
      fs.mkdirSync(strategiesDir, { recursive: true });
    }
    
    console.log('[LocalFileStorage] Initialized at:', dataDir);
    return true;
  } catch (error) {
    console.error('[LocalFileStorage] Failed to initialize:', error);
    return false;
  }
}

// 获取文件路径
function getFilePath(table: string, id?: number | string | object): string {
  if (table === 'notes' && typeof id === 'object') {
    const { bookId, noteId } = id as { bookId: number; noteId: number | string };
    return path.join(dataDir, NOTES_DIR, `${bookId}_${noteId}.json`);
  }
  
  if (table === 'strategies' && typeof id === 'object') {
    const { groupId, strategyId } = id as { groupId: number; strategyId: number };
    return path.join(dataDir, STRATEGIES_DIR, `${groupId}_${strategyId}.json`);
  }
  
  const filename = FILE_MAP[table];
  if (!filename) {
    return path.join(dataDir, `${table}.json`);
  }
  return path.join(dataDir, filename);
}

// 读取数据
export function readLocalData(table: string, id?: number | string | object): { lastModified: string; data: any } | null {
  try {
    // 确保存储目录已初始化
    if (!dataDir) {
      initLocalFileStorage();
    }
    
    const filePath = getFilePath(table, id);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    
    return {
      lastModified: parsed.lastModified || '1970-01-01 00:00:00',
      data: parsed.data,
    };
  } catch (error) {
    console.error(`[LocalFileStorage] Error reading from ${table}:`, error);
    return null;
  }
}

// 写入数据
export function writeLocalData(table: string, data: any, lastModified: string, id?: number | string | object): boolean {
  try {
    // 确保存储目录已初始化
    if (!dataDir) {
      initLocalFileStorage();
    }
    
    const filePath = getFilePath(table, id);
    
    // 确保文件所在目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const content = JSON.stringify({
      lastModified,
      data,
    }, null, 2);
    
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`[LocalFileStorage] Data written to ${table} at ${filePath}`);
    return true;
  } catch (error) {
    console.error(`[LocalFileStorage] Error writing to ${table}:`, error);
    return false;
  }
}

// 删除数据
export function deleteLocalData(table: string, id?: number | string | object): boolean {
  try {
    // 确保存储目录已初始化
    if (!dataDir) {
      initLocalFileStorage();
    }
    
    const filePath = getFilePath(table, id);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[LocalFileStorage] Data deleted from ${table}`);
    }
    return true;
  } catch (error) {
    console.error(`[LocalFileStorage] Error deleting from ${table}:`, error);
    return false;
  }
}

// 获取存储统计信息
export function getLocalStorageStats(): { size: number; tables: string[]; files: string[] } {
  try {
    const stats = fs.statSync(dataDir);
    const files: string[] = [];
    
    // 读取所有文件
    function readDir(dir: string, prefix: string = '') {
      if (!fs.existsSync(dir)) return;
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const relPath = prefix ? `${prefix}/${item}` : item;
        if (fs.statSync(fullPath).isDirectory()) {
          readDir(fullPath, relPath);
        } else {
          files.push(relPath);
        }
      }
    }
    
    readDir(dataDir);
    
    // 获取表名列表
    const tables = Object.keys(FILE_MAP);
    
    return {
      size: stats.size,
      tables,
      files,
    };
  } catch (error) {
    console.error('[LocalFileStorage] Error getting stats:', error);
    return { size: 0, tables: [], files: [] };
  }
}

// 备份存储
export function backupLocalStorage(backupPath: string): boolean {
  try {
    // 如果备份路径是目录，创建压缩包或复制整个目录
    if (!path.extname(backupPath)) {
      if (!fs.existsSync(backupPath)) {
        fs.mkdirSync(backupPath, { recursive: true });
      }
      
      // 复制所有文件
      function copyDir(src: string, dest: string) {
        if (!fs.existsSync(dest)) {
          fs.mkdirSync(dest, { recursive: true });
        }
        const items = fs.readdirSync(src);
        for (const item of items) {
          const srcPath = path.join(src, item);
          const destPath = path.join(dest, item);
          if (fs.statSync(srcPath).isDirectory()) {
            copyDir(srcPath, destPath);
          } else {
            fs.copyFileSync(srcPath, destPath);
          }
        }
      }
      
      copyDir(dataDir, backupPath);
    } else {
      // 如果是文件路径，需要实现压缩逻辑，这里简单复制
      // 实际使用时可以用 tar 或 zip 库
      console.warn('[LocalFileStorage] Backup to single file not implemented, use directory path instead');
      return false;
    }
    
    console.log('[LocalFileStorage] Backup created at:', backupPath);
    return true;
  } catch (error) {
    console.error('[LocalFileStorage] Error creating backup:', error);
    return false;
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
  initLocalFileStorage,
  readLocalData,
  writeLocalData,
  deleteLocalData,
  getLocalStorageStats,
  backupLocalStorage,
  TABLE_MAP,
};
