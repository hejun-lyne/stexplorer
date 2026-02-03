import { ThunkAction } from '@/reducers/types';
import * as Utils from '@/utils';
import { batch } from 'react-redux';
import moment from 'moment';

export const SYNC_TRAINING_DATA = 'SYNC_TRAINING_DATA';
export const SET_TRAINING_SYNING = 'SET_TRAINING_SYNING';

export function syncRemoteTrainingAction(): ThunkAction {
    console.log('syncRemoteTrainingAction');
    return (dispatch, getState) => {
      try {
        const {
          training: { records, recordsModified },
          github: { storage },
        } = getState();
        if (!storage) {
          throw new Error('storage未初始化');
        }
        dispatch({ type: SET_TRAINING_SYNING, payload: { v: true, t: '读取ktraining数据中' } });
        storage
          .ReadRemoteKTraining()
          .then((content) => {
            if (!content) {
              // 读取数据失败
              dispatch({ type: SET_TRAINING_SYNING, payload: { v: false, t: '读取ktraining数据失败' } });
            }
            return content;
          })
          .then((content) => {
            if (content && content.data && content.lastModified >= recordsModified) {
              batch(() => {
                dispatch({ type: SYNC_TRAINING_DATA, payload: [content.data, content.lastModified] });
                dispatch({ type: SET_TRAINING_SYNING, payload: { v: false, t: '读取ktraining完成' } });
              });
              return false;
            }
            return true;
          })
          .then((content) => {
            if (content && records.length) {
              dispatch({ type: SET_TRAINING_SYNING, payload: { v: true, t: '写入ktraining数据中' } });
              // eslint-disable-next-line promise/no-nesting
              storage
                .WriteRemoteKTraining(records, recordsModified)
                .then((success) => {
                  if (!success) {
                    throw new Error('写入远端数据失败');
                  }
                  dispatch({ type: SET_TRAINING_SYNING, payload: { v: false, t: '写入ktraining完成' } });
                  return success;
                })
                .catch((error) => {
                  dispatch({ type: SET_TRAINING_SYNING, payload: { v: false, t: '写入ktraining失败' } });
                });
            }
            return content;
          });
      } catch (error) {
        console.log('同步ktraining出错', error);
      }
    };
  }

  export function setRecordsAction(records: Training.Record[]): ThunkAction {
    return (dispatch, getState) => {
      try {
        dispatch({ type: SYNC_TRAINING_DATA, payload: [[...records], moment(new Date()).format('YYYY-MM-DD HH:mm:ss')] });
        dispatch(syncRemoteTrainingAction());
      } catch (error) {
        console.log('同步站点出错', error);
      }
    };
  }

  export function addTradeAction(trade: Training.Trade): ThunkAction {
    return (dispatch, getState) => {
      try {
        const {
          training: { records },
        } = getState();

        let temp = records;
        // If has today records
        const today = moment(new Date()).format('YYYY-MM-DD');
        let t_records: Training.Record;
        if (temp.length == 0 || temp[0].date != today) {
            // make new today list
            t_records = {
                date: today,
                wins: 0,
                lose: 0,
                even: 0,
                records: []
            };
            temp = [t_records].concat(temp);
        } else {
            t_records = temp[0];
        }

        if (trade.gain > 0.1) {
            t_records.wins += 1;
        } else if (trade.gain <= -0.1) {
            t_records.lose += 1;
        } else {
            t_records.even += 1;
        }
        t_records.records = [trade].concat(t_records.records);
        dispatch(setRecordsAction(temp));
      } catch (error) {
        console.log('添加ktraining出错', error);
      }
    };
  }