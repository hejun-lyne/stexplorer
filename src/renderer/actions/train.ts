import { ThunkAction } from '@/reducers/types';
import { batch } from 'react-redux';
import moment from 'moment';
import { setSystemSettingAction, SYNC_SYSTEM_SETTING } from './setting';

export const SYNC_TRAIN_ARCHIVES = 'SYNC_TRAIN_ARCHIVES';
export const SET_TRAIN_SYNING = 'SET_TRAIN_SYNING';

/**
 * 仅更新系统设置中的当前训练日期（不触发远端同步，训练按天推进时频繁调用）
 */
export function setTrainCurrentDateAction(date: string): ThunkAction {
  return (dispatch, getState) => {
    const {
      setting: { systemSetting, settingModified },
    } = getState();
    // 保持 settingModified 不变，避免影响与远端设置的同步比较
    dispatch({
      type: SYNC_SYSTEM_SETTING,
      payload: [{ ...systemSetting, trainDate: date }, settingModified],
    });
  };
}

/**
 * 开始训练：以当前配置（开始/结束日期、初始资金、佣金比例）开启训练会话
 */
export function startTrainAction(): ThunkAction {
  return (dispatch, getState) => {
    const {
      setting: { systemSetting },
    } = getState();
    dispatch(
      setSystemSettingAction({
        ...systemSetting,
        ontrain: true,
        trainDate: systemSetting.trainStartDate || systemSetting.trainDate,
      })
    );
  };
}

/** 结束训练（关闭训练模式，保留训练记录） */
export function stopTrainAction(): ThunkAction {
  return (dispatch, getState) => {
    const {
      setting: { systemSetting },
    } = getState();
    dispatch(setSystemSettingAction({ ...systemSetting, ontrain: false }));
  };
}

export function syncRemoteTrainArchivesAction(): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        train: { archives, archivesModified },
        storage: { storage },
      } = getState();
      if (!storage) {
        throw new Error('storage未初始化');
      }
      dispatch({ type: SET_TRAIN_SYNING, payload: { v: true, t: '读取训练归档中' } });
      storage
        .ReadRemoteTrainArchives()
        .then((content) => {
          if (!content) {
            dispatch({ type: SET_TRAIN_SYNING, payload: { v: false, t: '读取训练归档失败' } });
          }
          return content;
        })
        .then((content) => {
          if (content && content.data && content.lastModified >= archivesModified) {
            const data = content.data as Train.ArchiveRecord[];
            if (Array.isArray(data) && data.length > 0) {
              batch(() => {
                dispatch({ type: SYNC_TRAIN_ARCHIVES, payload: [data, content.lastModified] });
                dispatch({ type: SET_TRAIN_SYNING, payload: { v: false, t: '读取训练归档完成' } });
              });
              return false;
            }
          }
          return true;
        })
        .then((content) => {
          if (content && archives.length) {
            // eslint-disable-next-line promise/no-nesting
            storage
              .WriteRemoteTrainArchives(archives, archivesModified)
              .then((success) => {
                if (!success) {
                  dispatch({ type: SET_TRAIN_SYNING, payload: { v: false, t: '写入训练归档失败' } });
                }
                return success;
              })
              .catch(() => {
                dispatch({ type: SET_TRAIN_SYNING, payload: { v: false, t: '写入训练归档失败' } });
              });
          }
          return content;
        });
    } catch (error) {
      console.log('同步训练归档出错', error);
    }
  };
}

export function setTrainArchivesAction(archives: Train.ArchiveRecord[]): ThunkAction {
  return (dispatch) => {
    dispatch({ type: SYNC_TRAIN_ARCHIVES, payload: [[...archives], moment(new Date()).format('YYYY-MM-DD HH:mm:ss')] });
    dispatch(syncRemoteTrainArchivesAction());
  };
}

/** 归档一次训练 */
export function addTrainArchiveAction(record: Train.ArchiveRecord): ThunkAction {
  return (dispatch, getState) => {
    const {
      train: { archives },
    } = getState();
    dispatch(setTrainArchivesAction([record].concat(archives)));
  };
}

/** 删除归档 */
export function removeTrainArchiveAction(id: string): ThunkAction {
  return (dispatch, getState) => {
    const {
      train: { archives },
    } = getState();
    dispatch(setTrainArchivesAction(archives.filter((_) => _.id !== id)));
  };
}
