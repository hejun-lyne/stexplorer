/**
 * GitHub 相关的 Redux Actions
 * 注意：此文件保留用于向后兼容，新的存储相关功能请使用 storage.ts
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

export function initGithubInfo(): ThunkAction {
  return async (dispatch, getState) => {
    try {
      const token = Helpers.Storage.GitHub.GetGithubToken();
      const profile = Helpers.Storage.GitHub.GetGithubProfile();
      
      batch(() => {
        dispatch({ type: SYNC_LOGIN_INFO, payload: token });
        dispatch({ type: SYNC_PROFILE, payload: profile });
      });
      
      // 初始化 GitHub 存储
      dispatch(renewStorageAction());
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
      // 检查当前存储类型
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
