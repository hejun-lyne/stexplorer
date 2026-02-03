import { ThunkAction } from '@/reducers/types';
import * as Utils from '@/utils';
import * as CONST from '@/constants';
import * as Services from '@/services';
import moment from 'moment';
export const SYNC_TOKENS = 'SYNC_TOKENS';
export const GET_ACCESS_TOKEN = 'GET_ACCESS_TOKEN';
export const REFRESH_ACCESS_TOKEN = 'REFRESH_ACCESS_TOKEN';

export function loadBaiduTokensAction(): ThunkAction {
  return (dispatch, getState) => {
    try {
      let saved = Utils.GetStorage(CONST.STORAGE.BAIDU_TOKENS, null) as unknown as BaiDuDisk.Tokens;
      if (saved) {
        // 如果存在配置文件且token存在时间少于27天，则直接从配置文件中读入token；
        // 如果存在配置文件且token存在时间超过10个平年，则重新申请token；
        // 如果存在配置文件且token存在时间大于27天，少于10个平年，则刷新token；
        // 如果不存在配置文件，则申请token。
        // access_token的有效期是一个月，refresh_token的有效期是十年，access_token过期后，使用refresh_token刷新token即可
        const now = moment(new Date());
        const prev = moment(saved.updateTime);
        if (now.diff(prev, 'day') > 27) {
          const {
            baidu: { clientId, clientSecret },
          } = getState();
          Services.Baidu.refreshOAuthTokens(saved.refreshToken, clientId, clientSecret).then((tokens) => {
            if (tokens) {
              dispatch({ type: SYNC_TOKENS, payload: saved });
            } else {
              console.log('刷新baidu access_token失败')
            }
            return tokens;
          });
        } else {
          dispatch({ type: SYNC_TOKENS, payload: saved });
        }
      } else {
        console.log('没有百度云盘缓存信息');
      }
    } catch (error) {
      console.log('更新百度授权码出错', error);
    }
  };
}
export function saveBaiduTokensAction(tokens: BaiDuDisk.Tokens): ThunkAction {
  return (dispatch) => {
    try {
      const payload = { ...tokens, updateTime: moment(new Date()).format() };
      Utils.SetStorage(CONST.STORAGE.BAIDU_TOKENS, payload);
      dispatch({ type: SYNC_TOKENS, payload });
    } catch (error) {
      console.log('更新百度授权码出错', error);
    }
  };
}
