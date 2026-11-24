import dayjs from 'dayjs';
import * as Enums from '@/utils/enums';
import * as Utils from '@/utils';
import * as CONST from '@/constants';

export const defaultSystemSetting: System.Setting = {
  fundApiTypeSetting: Enums.FundApiType.Eastmoney,
  conciseSetting: false,
  lowKeySetting: false,
  baseFontSizeSetting: 12,
  systemThemeSetting: Enums.SystemThemeType.Auto,
  adjustmentNotificationSetting: false,
  adjustmentNotificationTimeSetting: dayjs().hour(14).minute(30).format(),
  trayContentSetting: Enums.TrayContent.Sy,
  autoStartSetting: true,
  autoFreshSetting: true,
  freshDelaySetting: 3,
  useZizaiDayK: false,
  kimiApiKeySetting: '',
  tushareTokenSetting: '',
  initialCapital: 100000,
  ontrain: false,
  trainDate: '',
  trainStartDate: '',
  trainEndDate: '',
  trainTime: '',
  commissionRate: 0.0003,
  favorites: [],
  trainFavorites: [],
  favoriteTags: {},
  trainFavoriteTags: {},
};

/**
 * 当前模式对应的收藏字段名：训练模式用 trainFavorites，非训练模式用 favorites。
 *
 * 两份数据分别存取，切换模式后只显示各自模式下收藏的股票；老版本设置文件
 * 没有 trainFavorites 时由 GetSystemSetting 合并默认值补成空数组。
 */
export function FavoriteKeyOfMode(setting: System.Setting): 'favorites' | 'trainFavorites' {
  return setting?.ontrain ? 'trainFavorites' : 'favorites';
}

/**
 * 当前模式对应的收藏标签字段名：与收藏列表一样，训练 / 非训练各存一份。
 */
export function FavoriteTagsKeyOfMode(setting: System.Setting): 'favoriteTags' | 'trainFavoriteTags' {
  return setting?.ontrain ? 'trainFavoriteTags' : 'favoriteTags';
}

export function GetSystemSetting() {
  const systemSetting: System.Setting = Utils.GetStorage(CONST.STORAGE.SYSTEM_SETTING, defaultSystemSetting);
  return { ...defaultSystemSetting, ...systemSetting };
}
