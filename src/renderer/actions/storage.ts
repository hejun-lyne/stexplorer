/**
 * 存储相关的 Redux Actions
 * 支持 GitHub 和 SQLite 两种存储后端
 */
import { ThunkAction } from '@/reducers/types';
import * as Helpers from '@/helpers';
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
export function switchStorageTypeAction(type: 'github' | 'sqlite'): ThunkAction {
  return async (dispatch, getState) => {
    try {
      Helpers.Storage.StorageHelper.SetStorageType(type);
      
      batch(() => {
        dispatch({ type: SYNC_STORAGE_TYPE, payload: type });
        dispatch({ type: SYNC_STORAGE, payload: null });
      });

      // 重新初始化存储
      if (type === 'sqlite') {
        const st = await Helpers.Storage.StorageHelper.InitSQLiteStorage();
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
      
      if (storageType === 'sqlite') {
        st = await Helpers.Storage.StorageHelper.InitSQLiteStorage();
      } else {
        st = Helpers.Storage.StorageHelper.InitGithubStorage();
      }
      
      dispatch({ type: SYNC_STORAGE, payload: st });
      
      if (st) {
        dispatch(syncRemoteFavorSitesAction());
        dispatch(syncRemoteTrainingAction());
        // dispatch(syncRemoteStocksAction());
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
