/**
 * 本地存储定时同步到百度云盘服务
 */
import * as BaiduApi from './baidu';

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

// 读取本地存储文件列表和内容
async function readLocalStorageFiles(storagePath: string): Promise<{ name: string; content: string }[]> {
  try {
    const { electron } = window.contextModules;

    // 通过 IPC 获取存储目录内容
    const result = await electron.getLocalStorageFiles();

    if (!result.success) {
      throw new Error(result.error || '读取文件失败');
    }

    return result.files || [];
  } catch (error) {
    console.error('[LocalStorageSync] 读取本地文件失败:', error);
    return [];
  }
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

    if (files.length === 0) {
      onProgress?.('没有需要同步的文件');
      isSyncing = false;
      return true;
    }

    // 3. 逐个上传文件
    let uploadedCount = 0;
    for (const file of files) {
      try {
        onProgress?.(`上传 ${file.name} (${uploadedCount + 1}/${files.length})...`);

        await BaiduApi.uploadFile(accessToken, BAIDU_DIR, file.name, file.content);

        uploadedCount++;
        console.log(`[LocalStorageSync] 上传成功: ${file.name}`);
      } catch (error) {
        console.error(`[LocalStorageSync] 上传失败: ${file.name}`, error);
      }
    }

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
