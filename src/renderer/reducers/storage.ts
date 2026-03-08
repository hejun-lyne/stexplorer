/**
 * 存储相关的 Reducer
 * 支持 GitHub 和 SQLite 两种存储后端
 */
import {
  SYNC_LOGIN_INFO,
  SYNC_PROFILE,
  SYNC_STORAGE,
  SYNC_STORAGE_TYPE,
} from '@/actions/storage';
import { Reducer } from '@/reducers/types';
import ThingsStorage from '@/services/things';

export type StorageState = {
  type: 'github' | 'sqlite';
  token: string | null;
  profile: GitHubSpace.Profile | null;
  storage: ThingsStorage | null;
};

const storage: Reducer<StorageState> = (
  state = {
    type: 'github',
    token: null,
    profile: null,
    storage: null,
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
    default:
      return state;
  }
};

export default storage;
