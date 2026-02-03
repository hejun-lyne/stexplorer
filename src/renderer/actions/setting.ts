import { ThunkAction } from '@/reducers/types';
import { SettingState } from '@/reducers/setting';
import { batch } from 'react-redux';
import ReactGridLayout from 'react-grid-layout';
import moment from 'moment';
import { LogLevel } from '@/utils/enums';

export const SYNC_SYSTEM_SETTING = 'SYNC_SYSTEM_SETTING';
export const SYNC_MONITOR_SETTING = 'SYNC_MONITOR_SETTING';
export const SET_SETTING_SYNING = 'SET_SETTING_SYNING';
export const APPEND_SYSTEM_LOG = 'APPEND_SYSTEM_LOG';

export function syncRemoteSettingAction(): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        setting: { systemSetting, monitorSetting, settingModified },
        github: { storage },
      } = getState();
      if (!storage) {
        throw new Error('storage未初始化');
      }
      dispatch({ type: SET_SETTING_SYNING, payload: { v: true, t: '读取setting数据中' } });
      storage
        .ReadRemoteSetting()
        .then((content) => {
          if (!content) {
            // 读取数据失败
            dispatch({ type: SET_SETTING_SYNING, payload: { v: false, t: '读取setting数据失败' } });
          }
          return content;
        })
        .then((content) => {
          if (content && content.data && content.lastModified >= settingModified) {
            const remote = content.data as SettingState;
            batch(() => {
              dispatch({ type: SYNC_SYSTEM_SETTING, payload: [remote.systemSetting, content.lastModified] });
              dispatch({ type: SYNC_MONITOR_SETTING, payload: [remote.monitorSetting, content.lastModified] });
              dispatch({ type: SET_SETTING_SYNING, payload: { v: false, t: '读取setting完成' } });
            });
            return false;
          }
          return true;
        })
        .then((content) => {
          if (content) {
            // eslint-disable-next-line promise/no-nesting
            storage
              .WriteRemoteSetting({ systemSetting, monitorSetting }, settingModified)
              .then((success) => {
                if (!success) {
                  throw new Error('写入远端数据失败');
                }
                return success;
              })
              .catch((error) => {
                dispatch({ type: SET_SETTING_SYNING, payload: { v: false, t: '同步setting失败' } });
              });
          }
          return content;
        });
    } catch (error) {
      console.log('同步设置出错', error);
    }
  };
}

export function setSystemSettingAction(setting: System.Setting): ThunkAction {
  return (dispatch, getState) => {
    try {
      dispatch({ type: SYNC_SYSTEM_SETTING, payload: [{ ...setting }, moment(new Date()).format('YYYY-MM-DD HH:mm:ss')] });
      dispatch(syncRemoteSettingAction());
    } catch (error) {
      console.log('设置系统设置出错', error);
    }
  };
}

export function setMonitorSettingAction(setting: System.MonitorSetting): ThunkAction {
  return (dispatch, getState) => {
    try {
      dispatch({ type: SYNC_MONITOR_SETTING, payload: [{ ...setting }, moment(new Date()).format('YYYY-MM-DD HH:mm:ss')] });
      dispatch(syncRemoteSettingAction());
    } catch (error) {
      console.log('同步监控面板设置出错', error);
    }
  };
}

export function setMADefaultsSetting(defaults: number[]): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        setting: { monitorSetting },
      } = getState();
      monitorSetting.maPanel.defaults = defaults;
      dispatch(setMonitorSettingAction(monitorSetting));
    } catch (error) {
      console.log('同步均线监控设置出错', error);
    }
  };
}

export function setGDefaultsSetting(defaults: number[]): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        setting: { monitorSetting },
      } = getState();
      monitorSetting.gPanel.defaults = defaults;
      dispatch(setMonitorSettingAction(monitorSetting));
    } catch (error) {
      console.log('同步G点监控设置出错', error);
    }
  };
}

export function addTagMonitor(tag: string, bk?: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        setting: { monitorSetting },
      } = getState();
      const id = (monitorSetting.tagPanels.length === 0 ? 0 : Math.max(...monitorSetting.tagPanels.map((_) => _.id))) + 1;
      // 找到最短的那一列
      const allCells = [monitorSetting.gPanel, monitorSetting.hPanel, monitorSetting.maPanel].concat(monitorSetting.tagPanels);
      const maxYs = [];
      for (let i = 0; i < 6; i++) {
        const cells = allCells.filter((_) => _.grid.x === i);
        if (cells.length === 0) {
          maxYs.push(0);
        } else {
          maxYs.push(cells.reduce((prev, cur) => (prev.grid.y > cur.grid.y ? prev : cur)).grid.y);
        }
      }
      const y = Math.min(...maxYs);
      const x = maxYs.indexOf(y);
      monitorSetting.tagPanels.push({
        id,
        tag,
        bk,
        grid: {
          i: `tag-${id}`,
          x,
          y,
          w: 2,
          h: 6,
        },
      });
      dispatch(setMonitorSettingAction(monitorSetting));
    } catch (error) {
      console.log('添加标签监控设置出错', error);
    }
  };
}

export function removeTagMonitor(id: number): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        setting: { monitorSetting },
      } = getState();
      monitorSetting.tagPanels = monitorSetting.tagPanels.filter((_) => _.id !== id);
      dispatch(setMonitorSettingAction(monitorSetting));
    } catch (error) {
      console.log('删除标签监控设置出错', error);
    }
  };
}

export function updateTagMonitor(id: number, tag?: string, bk?: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        setting: { monitorSetting },
      } = getState();
      const p = monitorSetting.tagPanels.find((_) => _.id === id);
      if (p) {
        p.tag = tag || p.tag;
        p.bk = bk || p.bk;
        dispatch(setMonitorSettingAction(monitorSetting));
      }
    } catch (error) {
      console.log('更新标签监控设置出错', error);
    }
  };
}

export function updateMonitorLayouts(layouts: ReactGridLayout.Layout[]): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        setting: { monitorSetting },
      } = getState();
      let changed = false;
      [monitorSetting.hPanel, monitorSetting.maPanel, monitorSetting.gPanel].concat(monitorSetting.tagPanels).forEach((p) => {
        const grid = layouts.find((_) => _.i === p.grid.i);
        if (grid && (p.grid.x != grid.x || p.grid.y != grid.y || p.grid.w != grid.w || p.grid.h != grid.h)) {
          p.grid = {
            i: grid.i,
            x: grid.x,
            y: grid.y,
            w: grid.w,
            h: grid.h,
          };
          changed = true;
        }
      });
      if (changed) {
        dispatch(setMonitorSettingAction(monitorSetting));
      }
    } catch (error) {
      console.log('更新标签监控设置出错', error);
    }
  };
}

export function appendLog(c: string, l = LogLevel.Info): ThunkAction {
  return (dispatch, getState) => {
    try {
      dispatch({ type: APPEND_SYSTEM_LOG, payload: { c, l, t: moment(new Date()).format('HH:mm:ss.sss') } });
    } catch (error) {
      console.log('添加日志出错', error);
    }
  };
}
