/**
 * 存储相关的 Reducer
 * 支持 GitHub、SQLite 和本地文件三种存储后端
 */
import {
  SYNC_LOGIN_INFO,
  SYNC_PROFILE,
  SYNC_STORAGE,
  SYNC_STORAGE_TYPE,
  SET_MIGRATING,
  SET_MIGRATE_PROGRESS,
  SET_SYNCING,
  SET_SYNC_PROGRESS,
  SET_SYNC_CONFIG,
} from '@/actions/storage';
import { Reducer } from '@/reducers/types';
import ThingsStorage from '@/services/things';

export type StorageState = {
  type: 'github' | 'sqlite' | 'local';
  token: string | null;
  profile: GitHubSpace.Profile | null;
  storage: ThingsStorage | null;
  migrating: boolean;
  migrateProgress: string;
  syncing: boolean;
  syncProgress: string;
  syncConfig: {
    enabled: boolean;
    interval: number;
    lastSyncTime: string | null;
  };
};

const storage: Reducer<StorageState> = (
  state = {
    type: 'github',
    token: null,
    profile: null,
    storage: null,
    migrating: false,
    migrateProgress: '',
    syncing: false,
    syncProgress: '',
    syncConfig: {
      enabled: false,
      interval: 5 * 60 * 1000,
      lastSyncTime: null,
    },
  },
  action
) => {
  switch (action.type) {
    case SYNC_STORAGE_TYPE:
      return {
        ...state,
        type: action.payload,
      };
    case SYNC_LOGIN_INFO:
      return {
        ...state,
        token: action.payload,
      };
    case SYNC_PROFILE:
      return {
        ...state,
        profile: action.payload,
      };
    case SYNC_STORAGE:
      return {
        ...state,
        storage: action.payload,
      };
    case SET_MIGRATING:
      return {
        ...state,
        migrating: action.payload,
      };
    case SET_MIGRATE_PROGRESS:
      return {
        ...state,
        migrateProgress: action.payload,
      };
    case SET_SYNCING:
      return {
        ...state,
        syncing: action.payload,
      };
    case SET_SYNC_PROGRESS:
      return {
        ...state,
        syncProgress: action.payload,
      };
    case SET_SYNC_CONFIG:
      return {
        ...state,
        syncConfig: { ...state.syncConfig, ...action.payload },
      };
    default:
      return state;
  }
};

export default storage;
