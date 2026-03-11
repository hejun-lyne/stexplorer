/**
 * 本地存储定时同步到百度云盘服务
 */
import * as BaiduApi from './baidu';
// import * as fs from 'fs';
// import * as path from 'path';

const SYNC_INTERVAL = 5 * 60 * 1000; // 默认5分钟
const BAIDU_DIR = '/STExplorer/backup';

export interface LocalStorageSyncConfig {
  enabled: boolean;
  interval: number; // 同步间隔（毫秒）
  lastSyncTime: string | null;
  baiduDir: string;
}

let syncTimer: NodeJS.Timeout | null = null;
let isSyncing = false;

// 获取同步配置
export function getSyncConfig(): LocalStorageSyncConfig {
  const defaultConfig: LocalStorageSyncConfig = {
    enabled: false,
    interval: SYNC_INTERVAL,
    lastSyncTime: null,
    baiduDir: BAIDU_DIR,
  };
  
  try {
    const config = localStorage.getItem('localStorageSyncConfig');
    if (config) {
      return { ...defaultConfig, ...JSON.parse(config) };
    }
  } catch (error) {
    console.error('[LocalStorageSync] 读取配置失败:', error);
  }
  
  return defaultConfig;
}

// 保存同步配置
export function saveSyncConfig(config: Partial<LocalStorageSyncConfig>) {
  try {
    const currentConfig = getSyncConfig();
    const newConfig = { ...currentConfig, ...config };
    localStorage.setItem('localStorageSyncConfig', JSON.stringify(newConfig));
    return newConfig;
  } catch (error) {
    console.error('[LocalStorageSync] 保存配置失败:', error);
    return null;
  }
}

// 获取本地存储目录路径
export function getLocalStoragePath(): string {
  // 使用 Electron 的 app.getPath('userData')
  const { ipcRenderer } = window.contextModules.electron;
  // 这里需要通过 IPC 获取，因为 userData 路径在主进程中
  return '';
}

// 同步所有文件到百度云盘
export async function syncToBaidu(
  accessToken: string,
  storagePath: string,
  onProgress?: (message: string) => void
): Promise<boolean> {
  if (isSyncing) {
    console.log('[LocalStorageSync] 正在同步中，跳过本次同步');
    return false;
  }
  
  isSyncing = true;
  
  try {
    onProgress?.('开始同步到百度云盘...');
    
    // 1. 确保百度云盘目录存在
    onProgress?.('创建备份目录...');
    await BaiduApi.createDir(accessToken, BAIDU_DIR);
    
    // 2. 读取本地存储目录的所有文件
    onProgress?.('读取本地文件...');
    const files = await readLocalStorageFiles(storagePath);
    
    // 3. 逐个上传文件
    let uploadedCount = 0;
    // for (const file of files) {
    //   try {
    //     onProgress?.(`上传 ${file.name} (${uploadedCount + 1}/${files.length})...`);
        
    //     const content = fs.readFileSync(file.path, 'utf-8');
    //     await BaiduApi.uploadFile(accessToken, BAIDU_DIR, file.name, content);
        
    //     uploadedCount++;
    //     console.log(`[LocalStorageSync] 上传成功: ${file.name}`);
    //   } catch (error) {
    //     console.error(`[LocalStorageSync] 上传失败: ${file.name}`, error);
    //   }
    // }
    
    // 4. 更新同步时间
    saveSyncConfig({ lastSyncTime: new Date().toISOString() });
    
    onProgress?.(`同步完成，成功上传 ${uploadedCount}/${files.length} 个文件`);
    return true;
  } catch (error) {
    console.error('[LocalStorageSync] 同步失败:', error);
    onProgress?.('同步失败: ' + (error as Error).message);
    return false;
  } finally {
    isSyncing = false;
  }
}

// 读取本地存储目录的所有文件
async function readLocalStorageFiles(storagePath: string): Promise<{ name: string; path: string }[]> {
  const files: { name: string; path: string }[] = [];
  
  try {
    // 通过 IPC 获取存储目录内容
    const { ipcRenderer } = window.contextModules.electron;
    
    // 递归读取目录
    // function readDir(dirPath: string, prefix: string = '') {
    //   const items = fs.readdirSync(dirPath);
      
    //   for (const item of items) {
    //     const fullPath = path.join(dirPath, item);
    //     const stat = fs.statSync(fullPath);
        
    //     if (stat.isDirectory()) {
    //       // 递归读取子目录
    //       const subPrefix = prefix ? `${prefix}/${item}` : item;
    //       readDir(fullPath, subPrefix);
    //     } else if (item.endsWith('.json')) {
    //       // 只上传 JSON 文件
    //       const fileName = prefix ? `${prefix}/${item}` : item;
    //       files.push({ name: fileName, path: fullPath });
    //     }
    //   }
    // }
    
    // if (fs.existsSync(storagePath)) {
    //   readDir(storagePath);
    // }
  } catch (error) {
    console.error('[LocalStorageSync] 读取本地文件失败:', error);
  }
  
  return files;
}

// 启动定时同步
export function startAutoSync(
  accessToken: string,
  storagePath: string,
  onProgress?: (message: string) => void
): boolean {
  const config = getSyncConfig();
  
  if (!config.enabled) {
    console.log('[LocalStorageSync] 自动同步未启用');
    return false;
  }
  
  // 停止之前的定时器
  stopAutoSync();
  
  // 立即执行一次同步
  syncToBaidu(accessToken, storagePath, onProgress);
  
  // 设置定时器
  syncTimer = setInterval(() => {
    syncToBaidu(accessToken, storagePath, onProgress);
  }, config.interval);
  
  console.log(`[LocalStorageSync] 自动同步已启动，间隔: ${config.interval / 1000}秒`);
  return true;
}

// 停止定时同步
export function stopAutoSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    console.log('[LocalStorageSync] 自动同步已停止');
  }
}

// 检查是否正在同步
export function getIsSyncing(): boolean {
  return isSyncing;
}

export default {
  getSyncConfig,
  saveSyncConfig,
  syncToBaidu,
  startAutoSync,
  stopAutoSync,
  getIsSyncing,
};
