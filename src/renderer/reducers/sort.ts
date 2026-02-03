import { SYNC_SORT_MODE } from '@/actions/sort';
import { Reducer } from '@/reducers/types';
import * as Helpers from '@/helpers';
import { SortOrderType, StockSortType } from '@/utils/enums';

export type SortState = {
  sortMode: {
    stockSortMode: Helpers.Sort.StockSortType;
  };
};

const sort: Reducer<SortState> = (
  state = {
    sortMode: {
      stockSortMode: {
        type: StockSortType.Zdf,
        order: SortOrderType.Desc,
      },
    },
  },
  action
) => {
  switch (action.type) {
    case SYNC_SORT_MODE:
      return {
        ...state,
        sortMode: action.payload,
      };
    default:
      return state;
  }
};

export default sort;
