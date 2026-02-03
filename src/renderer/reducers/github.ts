import { SYNC_LOGIN_INFO, SYNC_PROFILE, SYNC_STORAGE } from '@/actions/github';
import { Reducer } from '@/reducers/types';
import ThingsStorage from '@/services/things';

export type GithubState = {
  token: string | null;
  profile: GitHubSpace.Profile | null;
  storage: ThingsStorage | null;
};

const github: Reducer<GithubState> = (
  state = {
    token: null,
    profile: null,
    storage: null,
  },
  action
) => {
  switch (action.type) {
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

export default github;
