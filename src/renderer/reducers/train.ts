import { Reducer } from '@/reducers/types';
import { SET_TRAIN_SYNING, SYNC_TRAIN_DAYS, SYNC_TRAIN_PROGRESS, SYNC_TRAIN_TRADE_RECORDS } from '@/actions/train';

export type TrainState = {
  /** 当前训练会话的交易日列表（训练工具栏与设置页共用） */
  days: string[];
  /** days 对应的会话标识：标 + 训练窗口 */
  daysKey: string;
  daysSecid: string;
  daysName: string;
  /** 未完成训练的进度（持久化，用于下次继续训练） */
  progress: Train.Progress | null;
  progressModified: string;
  /** 训练记录：每只股票每次清仓归档一条（建仓 → 清仓的完整交易） */
  tradeRecords: Train.StockTradeRecord[];
  tradeRecordsModified: string;
  syning: { v: boolean; t: string };
};

const train: Reducer<TrainState> = (
  state = {
    days: [],
    daysKey: '',
    daysSecid: '',
    daysName: '',
    progress: null,
    progressModified: '1970-01-01 00:00:00',
    tradeRecords: [],
    tradeRecordsModified: '1970-01-01 00:00:00',
    syning: { v: false, t: '' },
  },
  action
) => {
  switch (action.type) {
    case SYNC_TRAIN_DAYS: {
      const [daysKey, daysSecid, daysName, days] = action.payload;
      return {
        ...state,
        daysKey,
        daysSecid,
        daysName,
        days,
      };
    }
    case SYNC_TRAIN_PROGRESS: {
      const [progress, progressModified] = action.payload;
      return {
        ...state,
        progress: progress || null,
        progressModified,
      };
    }
    case SYNC_TRAIN_TRADE_RECORDS: {
      const [tradeRecords, tradeRecordsModified] = action.payload;
      return {
        ...state,
        tradeRecords: tradeRecords || [],
        tradeRecordsModified,
      };
    }
    case SET_TRAIN_SYNING:
      return {
        ...state,
        syning: action.payload,
      };
    default:
      return state;
  }
};

export default train;
