import * as Utils from '@/utils';
import * as CONST from '@/constants';

export function GetBaiduTokens() {
  return Utils.GetStorage(CONST.STORAGE.BAIDU_TOKENS, null);
}
