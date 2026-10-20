import { ThunkAction } from '@/reducers/types';
import { batch } from 'react-redux';
import moment from 'moment';
import { setSystemSettingAction, SYNC_SYSTEM_SETTING } from './setting';
import { clearAllStockTradePointAction } from './stock';

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
      return storage
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
      return Promise.resolve();
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

/**
 * 推进/保存训练日（训练工具栏与股票池列表的「下一天」共用）
 *
 * 一次操作同时落盘两处，保证「下次启动从上次的交易日继续」：
 * 1. 训练日写入系统设置（store/setting.json）：重启后数据层会直接按这一天截断，
 *    即使训练进度文件写入失败，游标也不会退回训练开始日；
 * 2. 训练进度（交易窗口 / 交易日列表 / 资金 / 佣金）写入 store/train_progress.json，
 *    供「继续上一次训练」与启动时的 `restoreTrainCursorAction` 使用。
 */
export function saveTrainDayAction(params: {
  /** 要保存到的训练日（YYYY-MM-DD），为空时不做任何事 */
  date: string;
  secid?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  /** 训练窗口内的交易日列表（升序） */
  days?: string[];
  initialCapital?: number;
  commissionRate?: number;
}): ThunkAction {
  return (dispatch, getState) => {
    const { date } = params;
    if (!date) {
      return;
    }
    const {
      setting: { systemSetting },
      train: { progress },
    } = getState();
    const prev = (progress || {}) as Train.Progress;
    const days = params.days && params.days.length ? params.days : prev.days || [];
    // 1) 训练日 + 训练开关落盘
    dispatch(setSystemSettingAction({ ...systemSetting, ontrain: true, trainDate: date }));
    // 2) 训练进度落盘
    dispatch(
      writeTrainProgressAction({
        secid: params.secid || prev.secid || '',
        name: params.name || prev.name || '',
        startDate: params.startDate || prev.startDate || days[0] || '',
        endDate: params.endDate || prev.endDate || '',
        currentDate: date,
        total: days.length || prev.total || 0,
        days,
        initialCapital: Number(params.initialCapital) || prev.initialCapital || 0,
        commissionRate:
          params.commissionRate != null && Number.isFinite(Number(params.commissionRate))
            ? Number(params.commissionRate)
            : prev.commissionRate || 0,
        savedAt: moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
      })
    );
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
    // 不恢复旧的交易日列表：旧版本存的可能是「被训练日截断 / 按个股缺失」的列表，
    // 会让训练工具栏误判「已到窗口最后一天」（不显示「下一天」）。
    // 改由训练工具栏按完整训练窗口（大盘交易日历）重新计算，保证列表覆盖到结束日期。
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

/**
 * 启动时用「未完成训练进度」校正训练游标（trainDate）。
 *
 * 训练日现在会随每次「下一天」写入系统设置（见 saveTrainDayAction），正常重启后
 * 设置里的 trainDate 已经是上次的交易日；这里兼容两种情况：
 * - 设置里的训练日落后（旧版本只写了进度文件）→ 用进度里的 currentDate 补上；
 * - 设置里的训练日更靠后（进度文件写入失败 / 被旧数据覆盖）→ 保留设置里的值，不能倒退。
 * 这里只恢复游标，其它训练配置（窗口/资金/佣金）以设置为准，避免覆盖用户刚改过的配置。
 */
export function restoreTrainCursorAction(): ThunkAction {
  return (dispatch, getState) => {
    const {
      train: { progress },
      setting: { systemSetting },
    } = getState();
    if (!systemSetting.ontrain) return;
    if (!progress || !progress.currentDate) return;
    const current = String(systemSetting.trainDate || '');
    const fromProgress = String(progress.currentDate);
    if (fromProgress === current) return;
    // 只往前恢复：设置里的训练日更靠后时说明它比进度文件新，直接用会倒退训练进度
    if (current && fromProgress <= current) return;
    dispatch(setSystemSettingAction({ ...systemSetting, trainDate: fromProgress }));
  };
}

/** 重新开始训练（丢弃上次进度，并清除所有标的的模拟买卖记录） */
export function restartTrainAction(): ThunkAction {
  return (dispatch, getState) => {
    const {
      train: { progress },
      setting: { systemSetting },
    } = getState();
    // 训练账户为所有标的共享：必须清空全部标的的模拟买卖点，否则其它标的的历史买入
    // 仍会消耗共享资金，导致可用资金不等于初始资金
    dispatch(clearAllStockTradePointAction(true, TRAIN_TYPE));
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
