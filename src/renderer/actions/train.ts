import { ThunkAction } from '@/reducers/types';
import { batch } from 'react-redux';
import moment from 'moment';
import { setSystemSettingAction, SYNC_SYSTEM_SETTING } from './setting';
import { clearStockTradePointAction } from './stock';

/** 训练模式买卖点的类型标记，用于和手动标记点区分 */
export const TRAIN_TYPE = 'train';

export const SYNC_TRAIN_DAYS = 'SYNC_TRAIN_DAYS';
export const SYNC_TRAIN_PROGRESS = 'SYNC_TRAIN_PROGRESS';
export const SYNC_TRAIN_ARCHIVES = 'SYNC_TRAIN_ARCHIVES';
export const SET_TRAIN_SYNING = 'SET_TRAIN_SYNING';

/** 记录当前训练会话的交易日列表（训练工具栏与设置页共用） */
export function setTrainDaysAction(daysKey: string, secid: string, name: string, days: string[]): ThunkAction {
  return (dispatch) => {
    dispatch({ type: SYNC_TRAIN_DAYS, payload: [daysKey, secid, name, days] });
  };
}

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

// ==================== 未完成训练进度 ====================

export function syncRemoteTrainProgressAction(): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        train: { progress, progressModified },
        storage: { storage },
      } = getState();
      if (!storage) {
        throw new Error('storage未初始化');
      }
      storage
        .ReadRemoteTrainProgress()
        .then((content) => {
          if (content && content.lastModified >= progressModified) {
            const data = content.data as Train.Progress | null;
            if (data && data.currentDate) {
              batch(() => {
                dispatch({ type: SYNC_TRAIN_PROGRESS, payload: [data, content.lastModified] });
                dispatch({ type: SET_TRAIN_SYNING, payload: { v: false, t: '读取训练进度完成' } });
              });
              return false;
            }
          }
          return true;
        })
        .then((content) => {
          if (content) {
            // 本地有进度（或刚被清除）时写回存储，保证「继续/重新开始」的选择被持久化
            // eslint-disable-next-line promise/no-nesting
            storage
              .WriteRemoteTrainProgress(progress, progressModified)
              .then((success) => {
                if (!success) {
                  dispatch({ type: SET_TRAIN_SYNING, payload: { v: false, t: '写入训练进度失败' } });
                }
                return success;
              })
              .catch(() => {
                dispatch({ type: SET_TRAIN_SYNING, payload: { v: false, t: '写入训练进度失败' } });
              });
          }
          return content;
        });
    } catch (error) {
      console.log('同步训练进度出错', error);
    }
  };
}

/** 保存未完成训练的进度（读取远端后再写入，用于关闭训练等低频场景） */
export function saveTrainProgressAction(progress: Train.Progress): ThunkAction {
  return (dispatch) => {
    dispatch({ type: SYNC_TRAIN_PROGRESS, payload: [progress, moment(new Date()).format('YYYY-MM-DD HH:mm:ss')] });
    dispatch(syncRemoteTrainProgressAction());
  };
}

/**
 * 直接写入训练进度（不读取远端）
 * 训练每推进一个交易日都会调用，走轻量路径避免高频读写
 */
export function writeTrainProgressAction(progress: Train.Progress): ThunkAction {
  return (dispatch, getState) => {
    const modified = moment(new Date()).format('YYYY-MM-DD HH:mm:ss');
    dispatch({ type: SYNC_TRAIN_PROGRESS, payload: [progress, modified] });
    try {
      const {
        storage: { storage },
      } = getState();
      if (storage) {
        // eslint-disable-next-line promise/no-nesting
        storage.WriteRemoteTrainProgress(progress, modified).catch(() => {
          // 单次写入失败不阻塞训练
        });
      }
    } catch (error) {
      console.log('写入训练进度出错', error);
    }
  };
}

/** 清除未完成训练进度 */
export function clearTrainProgressAction(): ThunkAction {
  return (dispatch) => {
    dispatch({ type: SYNC_TRAIN_PROGRESS, payload: [null, moment(new Date()).format('YYYY-MM-DD HH:mm:ss')] });
    dispatch(syncRemoteTrainProgressAction());
  };
}

/** 继续上一次未完成的训练 */
export function resumeTrainAction(): ThunkAction {
  return (dispatch, getState) => {
    const {
      train: { progress },
      setting: { systemSetting },
    } = getState();
    if (!progress) {
      dispatch(startTrainAction());
      return;
    }
    // 恢复交易日列表，使训练工具栏无需重新请求即可继续按天推进
    if (progress.days && progress.days.length) {
      dispatch(setTrainDaysAction(`${progress.secid}_${progress.startDate}_${progress.endDate}`, progress.secid, progress.name, progress.days));
    }
    dispatch(
      setSystemSettingAction({
        ...systemSetting,
        ontrain: true,
        trainStartDate: progress.startDate || systemSetting.trainStartDate,
        trainEndDate: progress.endDate || systemSetting.trainEndDate,
        initialCapital: progress.initialCapital || systemSetting.initialCapital,
        commissionRate: progress.commissionRate >= 0 ? progress.commissionRate : systemSetting.commissionRate,
        trainDate: progress.currentDate,
      })
    );
  };
}

/** 重新开始训练（丢弃上次进度，并清除该标的上一次训练的模拟买卖记录） */
export function restartTrainAction(): ThunkAction {
  return (dispatch, getState) => {
    const {
      train: { progress },
      setting: { systemSetting },
    } = getState();
    if (progress && progress.secid) {
      dispatch(clearStockTradePointAction(progress.secid, true, TRAIN_TYPE));
    }
    batch(() => {
      dispatch({ type: SYNC_TRAIN_PROGRESS, payload: [null, moment(new Date()).format('YYYY-MM-DD HH:mm:ss')] });
      dispatch(
        setSystemSettingAction({
          ...systemSetting,
          ontrain: true,
          trainDate: systemSetting.trainStartDate || (progress ? progress.startDate : systemSetting.trainDate),
        })
      );
    });
    dispatch(syncRemoteTrainProgressAction());
  };
}

// ==================== 训练归档 ====================

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
