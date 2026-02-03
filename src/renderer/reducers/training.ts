import { SET_TRAINING_SYNING, SYNC_TRAINING_DATA } from '@/actions/training';
import { Reducer } from '@/reducers/types';

export type TrainingState = {
    records: Training.Record[];
    recordsModified: string;
    syning: { v: boolean; t: string };
}

const training: Reducer<TrainingState> = (
    state = {
        records: [],
        recordsModified: '1970-01-01 00:00:00',
        syning: { v: false, t: '' },
    },
    action
) => {
    switch (action.type) {
        case SYNC_TRAINING_DATA:
          const [records, recordsModified] = action.payload;
          return {
            ...state,
            records,
            recordsModified,
          };
        case SET_TRAINING_SYNING:
          return {
            ...state,
            syning: action.payload,
          };
        default:
          return state;
      }
}

export default training;