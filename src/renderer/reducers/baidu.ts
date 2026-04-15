import { Reducer } from '@/reducers/types';
import { SYNC_ACCESS_TOKEN, CLEAR_ACCESS_TOKEN } from '@/actions/baidu';

// 直接使用 Access Token 方式登录百度网盘
// 用户需要从百度网盘开放平台获取 Access Token 并直接输入
// Access Token 有效期为 30 天，过期后需要重新获取
export type BaiduState = {
  accessToken: string | null;
  updateTime: string | null;
};

const baidu: Reducer<BaiduState> = (
  state = {
    accessToken: null,
    updateTime: null,
  },
  action
) => {
  switch (action.type) {
    case SYNC_ACCESS_TOKEN:
      return {
        ...state,
        accessToken: action.payload.accessToken,
        updateTime: action.payload.updateTime,
      };
    case CLEAR_ACCESS_TOKEN:
      return {
        ...state,
        accessToken: null,
        updateTime: null,
      };
    default:
      return state;
  }
};

export default baidu;
