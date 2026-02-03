import { AnyAction } from 'redux';
import { batch } from 'react-redux';

import { ThunkAction } from '@/reducers/types';
import { sortStocksAction } from '@/actions/stock';
import * as Enums from '@/utils/enums';
import * as Utils from '@/utils';
import * as CONST from '@/constants';
import * as Helpers from '@/helpers';

export const SYNC_SORT_MODE = 'SYNC_SORT_MODE';

export function setStockSortModeAction(stockSortMode: { type?: Enums.StockSortType; order?: Enums.SortOrderType }): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        sort: {
          sortMode: { stockSortMode: _ },
        },
      } = getState();
      Utils.SetStorage(CONST.STORAGE.STOCK_SORT_MODE, {
        ..._,
        ...stockSortMode,
      });
      batch(() => {
        dispatch(syncSortModeAction());
        dispatch(sortStocksAction());
      });
    } catch (error) {
      console.log('设置股票排序方式出错', error);
    }
  };
}

export function troggleStockSortOrderAction(): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        sort: {
          sortMode: {
            stockSortMode,
            stockSortMode: { order },
          },
        },
      } = getState();
      Utils.SetStorage(CONST.STORAGE.STOCK_SORT_MODE, {
        ...stockSortMode,
        order: order === Enums.SortOrderType.Asc ? Enums.SortOrderType.Desc : Enums.SortOrderType.Asc,
      });

      batch(() => {
        dispatch(syncSortModeAction());
        dispatch(sortStocksAction());
      });
    } catch (error) {
      console.log('设置股票排序顺序出错', error);
    }
  };
}

export function syncSortModeAction(): AnyAction {
  const sortMode = Helpers.Sort.GetSortMode();
  return {
    type: SYNC_SORT_MODE,
    payload: sortMode,
  };
}
