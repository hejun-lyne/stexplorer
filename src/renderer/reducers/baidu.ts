import { Reducer } from '@/reducers/types';
import { SYNC_TOKENS, GET_ACCESS_TOKEN, REFRESH_ACCESS_TOKEN } from '@/actions/baidu';

// 如果存在配置文件且token存在时间少于27天，则直接从配置文件中读入token；
// 如果存在配置文件且token存在时间超过10个平年，则重新申请token；
// 如果存在配置文件且token存在时间大于27天，少于10个平年，则刷新token；
// 如果不存在配置文件，则申请token。
// access_token的有效期是一个月，refresh_token的有效期是十年，access_token过期后，使用refresh_token刷新token即可
export type BaiduState = {
  code: string | null;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken: string | null;
  accessToken: string | null;
  updateTime: string | null;
};

const baidu: Reducer<BaiduState> = (
  state = {
    code: null,
    clientId: 'XRUlsAlaWm5XUd4QehFDQihKwhqhOdLq',
    clientSecret: 'NNdPMwMLnGn56dkIvsaDomtGZCNY66Qu',
    redirectUri: 'oob',
    refreshToken: null,
    accessToken: null,
    updateTime: null,
  },
  action
) => {
  switch (action.type) {
    case SYNC_TOKENS:
      return {
        ...state,
        code: action.payload.code,
        accessToken: action.payload.accessToken,
        refreshToken: action.payload.refreshToken,
        updateTime: action.payload.updateTime,
      };
    case REFRESH_ACCESS_TOKEN:
      return {
        ...state,
        accessToken: action.payload.accessToken,
        refreshToken: action.payload.refreshToken,
        updateTime: action.payload.updateTime,
      };
    default:
      return state;
  }
};

export default baidu;
