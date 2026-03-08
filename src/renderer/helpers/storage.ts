/**
 * 存储帮助函数
 * 支持 GitHub 和 SQLite 两种存储后端
 */
import * as Utils from '@/utils';
import * as CONST from '@/constants';
import ThingsStorage from '@/services/things';
import { Storage } from '@/services/storage';
import type { StorageType } from '@/services/storageTypes';
import GitHubApi from '@/services/github';

// ===== GitHub 相关 =====

export function GetGithubToken() {
  return Utils.GetStorage(CONST.STORAGE.GITHUB_TOKEN, null);
}

export function SaveGithubToken(token: string) {
  Utils.SetStorage(CONST.STORAGE.GITHUB_TOKEN, token);
}

export function GetGithubProfile() {
  const profile: GitHubSpace.Profile | null = Utils.GetStorage(CONST.STORAGE.GITHUB_PROFILE, null);
  return profile;
}

export function SaveGithubProfile(profile: GitHubSpace.Profile) {
  Utils.SetStorage(CONST.STORAGE.GITHUB_PROFILE, profile);
}

export function ClearGithub() {
  Utils.ClearStorage(CONST.STORAGE.GITHUB_TOKEN);
  Utils.ClearStorage(CONST.STORAGE.GITHUB_PROFILE);
}

// ===== 存储类型管理 =====

export function GetStorageType(): StorageType {
  return Utils.GetStorage(CONST.STORAGE.STORAGE_TYPE, 'github') as StorageType;
}

export function SetStorageType(type: StorageType) {
  Utils.SetStorage(CONST.STORAGE.STORAGE_TYPE, type);
}

// ===== 存储初始化 =====

export async function InitStorage(type?: StorageType): Promise<ThingsStorage | null> {
  const storageType = type || GetStorageType();
  
  if (storageType === 'github') {
    return InitGithubStorage();
  } else if (storageType === 'sqlite') {
    return await InitSQLiteStorage();
  }
  
  return null;
}

export function InitGithubStorage() {
  const token: string | null = Utils.GetStorage(CONST.STORAGE.GITHUB_TOKEN, null);
  if (!token) {
    return null;
  }
  const profile: GitHubSpace.Profile | null = Utils.GetStorage(CONST.STORAGE.GITHUB_PROFILE, null);
  if (!profile) {
    return null;
  }
  const githubApi = new GitHubApi({
    token,
    owner: (profile as GitHubSpace.Profile).name,
  });
  const st = new Storage('github', githubApi);
  const s = new ThingsStorage(st);

  return s;
}

export async function InitSQLiteStorage(): Promise<ThingsStorage | null> {
  try {
    const st = new Storage('sqlite');
    await st.init();
    const s = new ThingsStorage(st);
    return s;
  } catch (error) {
    console.error('初始化 SQLite 存储失败:', error);
    return null;
  }
}

// ===== 存储工具函数 =====

export async function GetStorageStats() {
  const storageType = GetStorageType();
  
  if (storageType === 'sqlite') {
    const st = new Storage('sqlite');
    await st.init();
    return st.getStats();
  }
  
  return null;
}

export async function BackupSQLite(backupPath: string) {
  const storageType = GetStorageType();
  
  if (storageType === 'sqlite') {
    const st = new Storage('sqlite');
    await st.init();
    return st.backup(backupPath);
  }
  
  return null;
}

// ===== 兼容性导出（保持原有接口）=====

export const GitHub = {
  GetGithubToken,
  SaveGithubToken,
  GetGithubProfile,
  SaveGithubProfile,
  ClearGithub,
  InitStorage: InitGithubStorage,
};

export const StorageHelper = {
  GetStorageType,
  SetStorageType,
  InitStorage,
  InitGithubStorage,
  InitSQLiteStorage,
  GetStorageStats,
  BackupSQLite,
};

export default {
  GitHub,
  StorageHelper,
};
