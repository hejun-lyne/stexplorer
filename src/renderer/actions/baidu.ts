import { ThunkAction } from '@/reducers/types';
import * as Utils from '@/utils';
import * as CONST from '@/constants';
import moment from 'moment';

export const SYNC_ACCESS_TOKEN = 'SYNC_ACCESS_TOKEN';
export const CLEAR_ACCESS_TOKEN = 'CLEAR_ACCESS_TOKEN';

/**
 * 加载本地保存的百度网盘 Access Token
 */
export function loadBaiduTokensAction(): ThunkAction {
  return (dispatch) => {
    try {
      const saved = Utils.GetStorage(CONST.STORAGE.BAIDU_TOKENS, null) as unknown as BaiDuDisk.Tokens;
      if (saved?.accessToken) {
        dispatch({ type: SYNC_ACCESS_TOKEN, payload: saved });
      } else {
        console.log('没有百度云盘 Access Token 缓存');
      }
    } catch (error) {
      console.log('加载百度 Access Token 出错', error);
    }
  };
}

/**
 * 保存百度网盘 Access Token
 */
export function saveBaiduTokensAction(accessToken: string): ThunkAction {
  return (dispatch) => {
    try {
      const payload = { 
        accessToken, 
        updateTime: moment(new Date()).format() 
      };
      Utils.SetStorage(CONST.STORAGE.BAIDU_TOKENS, payload);
      dispatch({ type: SYNC_ACCESS_TOKEN, payload });
    } catch (error) {
      console.log('保存百度 Access Token 出错', error);
    }
  };
}

/**
 * 清除百度网盘 Access Token
 */
export function clearBaiduTokensAction(): ThunkAction {
  return (dispatch) => {
    try {
      Utils.SetStorage(CONST.STORAGE.BAIDU_TOKENS, null);
      dispatch({ type: CLEAR_ACCESS_TOKEN });
    } catch (error) {
      console.log('清除百度 Access Token 出错', error);
    }
  };
}
