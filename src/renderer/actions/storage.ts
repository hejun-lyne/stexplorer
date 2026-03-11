/**
 * 存储相关的 Redux Actions
 * 支持 GitHub、SQLite 和本地文件三种存储后端
 */
import { ThunkAction } from '@/reducers/types';
import * as Helpers from '@/helpers';
import ThingsStorage from '@/services/things';
import { Storage } from '@/services/storage';
import { batch } from 'react-redux';
import { syncRemoteFavorSitesAction } from './site';
import { syncRemoteStocksAction, syncRemoteTradingsAction, syncRemoteTrainingsAction } from './stock';
import { syncRemoteBooksAction } from './note';
import { syncRemoteSettingAction } from './setting';
import { syncRemoteStrategyGroupsAction } from './strategy';
import { syncRemoteTrainingAction } from './training';

export const SYNC_LOGIN_INFO = 'SYNC_LOGIN_INFO';
export const SYNC_PROFILE = 'SYNC_PROFILE';
export const SYNC_STORAGE = 'SYNC_STORAGE';
export const SYNC_STORAGE_TYPE = 'SYNC_STORAGE_TYPE';

// 初始化存储类型
export function initStorageType(): ThunkAction {
  return (dispatch, getState) => {
    try {
      const storageType = Helpers.Storage.StorageHelper.GetStorageType();
      dispatch({ type: SYNC_STORAGE_TYPE, payload: storageType });
    } catch (error) {
      console.log('初始化存储类型出错', error);
    }
  };
}

// 切换存储类型
export function switchStorageTypeAction(type: 'github' | 'sqlite' | 'local'): ThunkAction {
  return async (dispatch, getState) => {
    try {
      Helpers.Storage.StorageHelper.SetStorageType(type);
      
      batch(() => {
        dispatch({ type: SYNC_STORAGE_TYPE, payload: type });
        dispatch({ type: SYNC_STORAGE, payload: null });
      });

      // 重新初始化存储
      if (type === 'sqlite' || type === 'local') {
        const st = await Helpers.Storage.StorageHelper.InitLocalStorage();
        if (st) {
          batch(() => {
            dispatch({ type: SYNC_STORAGE, payload: st });
            dispatch(syncRemoteFavorSitesAction());
            dispatch(syncRemoteTrainingAction());
            dispatch(syncRemoteStocksAction());
            dispatch(syncRemoteTradingsAction());
            dispatch(syncRemoteTrainingsAction());
            dispatch(syncRemoteBooksAction());
            dispatch(syncRemoteStrategyGroupsAction());
            dispatch(syncRemoteSettingAction());
          });
        }
      } else if (type === 'github') {
        const st = Helpers.Storage.StorageHelper.InitGithubStorage();
        if (st) {
          batch(() => {
            dispatch({ type: SYNC_STORAGE, payload: st });
            dispatch(syncRemoteFavorSitesAction());
            dispatch(syncRemoteTrainingAction());
            dispatch(syncRemoteTradingsAction());
            dispatch(syncRemoteTrainingsAction());
            dispatch(syncRemoteBooksAction());
            dispatch(syncRemoteStrategyGroupsAction());
            dispatch(syncRemoteSettingAction());
          });
        }
      }
    } catch (error) {
      console.log('切换存储类型出错', error);
    }
  };
}

// ===== GitHub 相关 Actions =====

export function initGithubInfo(): ThunkAction {
  return (dispatch, getState) => {
    try {
      const token = Helpers.Storage.GitHub.GetGithubToken();
      const profile = Helpers.Storage.GitHub.GetGithubProfile();
      batch(() => {
        dispatch({ type: SYNC_LOGIN_INFO, payload: token });
        dispatch({ type: SYNC_PROFILE, payload: profile });
        dispatch(renewStorageAction());
      });
    } catch (error) {
      console.log('初始化Github信息出错', error);
    }
  };
}

// ===== 本地存储相关 Actions =====

export function initLocalStorageInfo(): ThunkAction {
  return async (dispatch, getState) => {
    try {
      dispatch(renewStorageAction());
    } catch (error) {
      console.log('初始化本地存储信息出错', error);
    }
  };
}

export function saveLoginInfoAction(token: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      Helpers.Storage.GitHub.SaveGithubToken(token);
      dispatch({ type: SYNC_LOGIN_INFO, payload: token });
    } catch (error) {
      console.log('保存Github登陆信息出错', error);
    }
  };
}

export function syncProfileAction(profile: GitHubSpace.Profile): ThunkAction {
  return (dispatch, getState) => {
    try {
      Helpers.Storage.GitHub.SaveGithubProfile(profile);
      dispatch({ type: SYNC_PROFILE, payload: profile });
    } catch (error) {
      console.log('保存Profile信息出错', error);
    }
  };
}

export function clearStorageAction(): ThunkAction {
  return (dispatch, getState) => {
    try {
      Helpers.Storage.GitHub.ClearGithub();
      batch(() => {
        dispatch({ type: SYNC_LOGIN_INFO, payload: null });
        dispatch({ type: SYNC_PROFILE, payload: null });
        dispatch({ type: SYNC_STORAGE, payload: null });
      });
    } catch (error) {
      console.log('保存Profile信息出错', error);
    }
  };
}

export function renewStorageAction(): ThunkAction {
  return async (dispatch, getState) => {
    try {
      const storageType = Helpers.Storage.StorageHelper.GetStorageType();
      let st = null;
      
      if (storageType === 'sqlite' || storageType === 'local') {
        st = await Helpers.Storage.StorageHelper.InitLocalStorage();
      } else {
        st = Helpers.Storage.StorageHelper.InitGithubStorage();
      }
      
      dispatch({ type: SYNC_STORAGE, payload: st });
      
      if (st) {
        dispatch(syncRemoteFavorSitesAction());
        dispatch(syncRemoteTrainingAction());
        dispatch(syncRemoteStocksAction());
        dispatch(syncRemoteTradingsAction());
        dispatch(syncRemoteTrainingsAction());
        dispatch(syncRemoteBooksAction());
        dispatch(syncRemoteStrategyGroupsAction());
        dispatch(syncRemoteSettingAction());
      }
    } catch (error) {
      console.log('更新storage信息出错', error);
    }
  };
}

// ===== 数据迁移功能 =====

export const SET_MIGRATING = 'SET_MIGRATING';
export const SET_MIGRATE_PROGRESS = 'SET_MIGRATE_PROGRESS';
export const SET_SYNCING = 'SET_SYNCING';
export const SET_SYNC_PROGRESS = 'SET_SYNC_PROGRESS';
export const SET_SYNC_CONFIG = 'SET_SYNC_CONFIG';

// 从 GitHub 迁移数据到本地存储
export function migrateFromGithubToLocalAction(): ThunkAction {
  return async (dispatch, getState) => {
    try {
      const { token, profile } = getState().storage;
      
      if (!token || !profile) {
        throw new Error('请先连接 GitHub 账号');
      }
      
      dispatch({ type: SET_MIGRATING, payload: true });
      dispatch({ type: SET_MIGRATE_PROGRESS, payload: '开始迁移...' });
      
      // 1. 使用 GitHub 存储读取所有数据
      const githubStorage = Helpers.Storage.StorageHelper.InitGithubStorage();
      if (!githubStorage) {
        throw new Error('无法初始化 GitHub 存储');
      }
      
      dispatch({ type: SET_MIGRATE_PROGRESS, payload: '正在读取 GitHub 数据...' });
      
      // 读取所有数据
      const settings = await githubStorage.ReadRemoteSetting();
      const starSites = await githubStorage.ReadRemoteStarSites();
      const stocks = await githubStorage.ReadRemoteStocks();
      const tradings = await githubStorage.ReadRemoteTradings();
      const trainings = await githubStorage.ReadRemoteTrainings();
      const books = await githubStorage.ReadRemoteBooks();
      const strategyGroups = await githubStorage.ReadRemoteStrategyGroups();
      const ktrainings = await githubStorage.ReadRemoteKTraining();
      
      dispatch({ type: SET_MIGRATE_PROGRESS, payload: '正在切换到本地存储...' });
      
      // 2. 切换到本地存储
      Helpers.Storage.StorageHelper.SetStorageType('local');
      const localStorage = await Helpers.Storage.StorageHelper.InitLocalStorage();
      
      if (!localStorage) {
        throw new Error('无法初始化本地存储');
      }
      
      dispatch({ type: SET_MIGRATE_PROGRESS, payload: '正在写入本地存储...' });
      
      // 3. 将所有数据写入本地存储
      const now = new Date().toISOString();
      
      if (settings && settings.data) {
        await localStorage.WriteRemoteSetting(settings.data, settings.lastModified || now);
      }
      if (starSites && starSites.data) {
        await localStorage.WriteRemoteStarSites(starSites.data, starSites.lastModified || now);
      }
      if (stocks && stocks.data) {
        await localStorage.WriteRemoteStocks(stocks.data, stocks.lastModified || now);
      }
      if (tradings && tradings.data) {
        await localStorage.WriteRemoteTradings(tradings.data, tradings.lastModified || now);
      }
      if (trainings && trainings.data) {
        await localStorage.WriteRemoteTrainings(trainings.data, trainings.lastModified || now);
      }
      if (books && books.data) {
        await localStorage.WriteRemoteBooks(books.data, books.lastModified || now);
      }
      if (strategyGroups && strategyGroups.data) {
        await localStorage.WriteRemoteStrategyGroups(strategyGroups.data, strategyGroups.lastModified || now);
      }
      if (ktrainings && ktrainings.data) {
        await localStorage.WriteRemoteKTraining(ktrainings.data, ktrainings.lastModified || now);
      }
      
      dispatch({ type: SET_MIGRATE_PROGRESS, payload: '迁移完成！' });
      
      // 4. 更新 Redux 状态
      batch(() => {
        dispatch({ type: SYNC_STORAGE_TYPE, payload: 'local' });
        dispatch({ type: SYNC_STORAGE, payload: localStorage });
      });
      
      // 5. 重新加载数据到 Redux
      dispatch(syncRemoteFavorSitesAction());
      dispatch(syncRemoteTrainingAction());
      dispatch(syncRemoteStocksAction());
      dispatch(syncRemoteTradingsAction());
      dispatch(syncRemoteTrainingsAction());
      dispatch(syncRemoteBooksAction());
      dispatch(syncRemoteStrategyGroupsAction());
      dispatch(syncRemoteSettingAction());
      
      dispatch({ type: SET_MIGRATING, payload: false });
      
      return true;
    } catch (error: any) {
      dispatch({ type: SET_MIGRATING, payload: false });
      dispatch({ type: SET_MIGRATE_PROGRESS, payload: '迁移失败: ' + error.message });
      console.error('迁移数据失败:', error);
      throw error;
    }
  };
}

// ===== 百度云盘同步功能 =====

import * as LocalStorageSync from '@/services/localStorageSync';

// 更新同步配置
export function updateSyncConfigAction(config: Partial<{
  enabled: boolean;
  interval: number;
}>): ThunkAction {
  return (dispatch, getState) => {
    try {
      const newConfig = LocalStorageSync.saveSyncConfig(config);
      if (newConfig) {
        dispatch({ 
          type: SET_SYNC_CONFIG, 
          payload: { 
            enabled: newConfig.enabled, 
            interval: newConfig.interval,
            lastSyncTime: newConfig.lastSyncTime,
          } 
        });
      }
    } catch (error) {
      console.log('更新同步配置出错', error);
    }
  };
}

// 立即同步到百度云盘
export function syncToBaiduAction(): ThunkAction {
  return async (dispatch, getState) => {
    try {
      const { baidu } = getState();
      const { accessToken } = baidu;
      
      if (!accessToken) {
        throw new Error('请先登录百度账号');
      }
      
      dispatch({ type: SET_SYNCING, payload: true });
      dispatch({ type: SET_SYNC_PROGRESS, payload: '开始同步...' });
      
      // 获取本地存储路径
      const storagePath = await getLocalStoragePath();
      
      const success = await LocalStorageSync.syncToBaidu(
        accessToken,
        storagePath,
        (message) => {
          dispatch({ type: SET_SYNC_PROGRESS, payload: message });
        }
      );
      
      dispatch({ type: SET_SYNCING, payload: false });
      
      if (success) {
        const config = LocalStorageSync.getSyncConfig();
        dispatch({ 
          type: SET_SYNC_CONFIG, 
          payload: { lastSyncTime: config.lastSyncTime } 
        });
      }
      
      return success;
    } catch (error: any) {
      dispatch({ type: SET_SYNCING, payload: false });
      dispatch({ type: SET_SYNC_PROGRESS, payload: '同步失败: ' + error.message });
      console.error('同步到百度云盘失败:', error);
      throw error;
    }
  };
}

// 启动自动同步
export function startAutoSyncAction(): ThunkAction {
  return async (dispatch, getState) => {
    try {
      const { baidu } = getState();
      const { accessToken } = baidu;
      
      if (!accessToken) {
        console.log('未登录百度账号，无法启动自动同步');
        return false;
      }
      
      const config = LocalStorageSync.getSyncConfig();
      if (!config.enabled) {
        console.log('自动同步未启用');
        return false;
      }
      
      // 获取本地存储路径
      const storagePath = await getLocalStoragePath();
      
      LocalStorageSync.startAutoSync(
        accessToken,
        storagePath,
        (message) => {
          dispatch({ type: SET_SYNC_PROGRESS, payload: message });
        }
      );
      
      return true;
    } catch (error) {
      console.log('启动自动同步出错', error);
      return false;
    }
  };
}

// 停止自动同步
export function stopAutoSyncAction(): ThunkAction {
  return (dispatch, getState) => {
    try {
      LocalStorageSync.stopAutoSync();
      return true;
    } catch (error) {
      console.log('停止自动同步出错', error);
      return false;
    }
  };
}

// 加载同步配置
export function loadSyncConfigAction(): ThunkAction {
  return (dispatch, getState) => {
    try {
      const config = LocalStorageSync.getSyncConfig();
      dispatch({
        type: SET_SYNC_CONFIG,
        payload: {
          enabled: config.enabled,
          interval: config.interval,
          lastSyncTime: config.lastSyncTime,
        },
      });
    } catch (error) {
      console.log('加载同步配置出错', error);
    }
  };
}

// 获取本地存储路径
async function getLocalStoragePath(): Promise<string> {
  // 使用 IPC 获取存储路径
  const { ipcRenderer } = window.contextModules.electron;
  // 这里返回默认路径，实际应该通过 IPC 获取
  // macOS: ~/Library/Application Support/STExplorer/storage
  // Windows: %APPDATA%/STExplorer/storage
  // Linux: ~/.config/STExplorer/storage
  return '';
}
