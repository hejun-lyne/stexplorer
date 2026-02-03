import { SYNC_SYSTEM_SETTING, SYNC_MONITOR_SETTING, SET_SETTING_SYNING, APPEND_SYSTEM_LOG } from '@/actions/setting';
import { Reducer } from '@/reducers/types';
import * as Enums from '@/utils/enums';
import dayjs from 'dayjs';

export type SettingState = {
  systemSetting: System.Setting;
  monitorSetting: System.MonitorSetting;
  settingModified: string;
  syning: { v: boolean; t: string };
  logs: { c: string; l: number; t: string }[];
};

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
  ontrain: false,
  trainDate: '',
  kLineApiSource: Enums.FundApiType.Eastmoney
};

export const defaultMonitorSetting: System.MonitorSetting = {
  hPanel: {
    grid: {
      i: 'holding',
      x: 0,
      y: 0,
      w: 2,
      h: 6,
    },
  },
  maPanel: {
    grid: {
      i: 'average',
      x: 2,
      y: 0,
      w: 2,
      h: 6,
    },
    defaults: [Enums.KLineType.Day, Enums.MAType.MA10, Enums.PriceMAState.CloseAboveMA],
  },
  gPanel: {
    grid: {
      i: 'chan-g',
      x: 4,
      y: 0,
      w: 2,
      h: 6,
    },
    defaults: [Enums.KLineType.Day, Enums.ChanTrendState.BottomUp, Enums.ChanGSpotState.CloseAboveGSpot],
  },
  tagPanels: [],
};

const setting: Reducer<SettingState> = (
  state = {
    systemSetting: defaultSystemSetting,
    monitorSetting: defaultMonitorSetting,
    settingModified: '1970-01-01 00:00:00',
    syning: { v: false, t: '' },
    logs: [],
  },
  action
) => {
  switch (action.type) {
    case SYNC_SYSTEM_SETTING:
      const [systemSetting, smodified] = action.payload;
      return {
        ...state,
        systemSetting,
        settingModified: smodified,
      };
    case SYNC_MONITOR_SETTING:
      const [monitorSetting, mmodified] = action.payload;
      return {
        ...state,
        monitorSetting,
        settingModified: mmodified,
      };
    case SET_SETTING_SYNING:
      return {
        ...state,
        syning: action.payload,
      };
    case APPEND_SYSTEM_LOG:
      return {
        ...state,
        logs: state.logs.concat(action.payload),
      };
    default:
      return state;
  }
};

export default setting;
