import { Reducer } from '@/reducers/types';
import { SET_TRAIN_SYNING, SYNC_TRAIN_ARCHIVES } from '@/actions/train';

export type TrainState = {
  /** 训练归档记录 */
  archives: Train.ArchiveRecord[];
  archivesModified: string;
  syning: { v: boolean; t: string };
};

const train: Reducer<TrainState> = (
  state = {
    archives: [],
    archivesModified: '1970-01-01 00:00:00',
    syning: { v: false, t: '' },
  },
  action
) => {
  switch (action.type) {
    case SYNC_TRAIN_ARCHIVES: {
      const [archives, archivesModified] = action.payload;
      return {
        ...state,
        archives: archives || [],
        archivesModified,
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
