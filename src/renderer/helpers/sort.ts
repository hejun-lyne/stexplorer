import * as Enums from '@/utils/enums';
import * as Utils from '@/utils';
import * as CONST from '@/constants';

export interface StockSortType {
  type: Enums.StockSortType;
  order: Enums.SortOrderType;
}

export const stockSortModeOptions: Option.EnumsOption<Enums.StockSortType>[] = [
  { key: Enums.StockSortType.Custom, value: '自定义' },
  { key: Enums.StockSortType.Zdd, value: '涨跌点' },
  { key: Enums.StockSortType.Zdf, value: '涨跌幅' },
  { key: Enums.StockSortType.Zx, value: '最新值' },
];

export function GetSortConfig() {
  const stockSortModeOptionsMap = stockSortModeOptions.reduce((r, c) => {
    r[c.key] = c;
    return r;
  }, {} as Record<Enums.StockSortType, Option.EnumsOption<Enums.StockSortType>>);
  return {
    stockSortModeOptions,
    stockSortModeOptionsMap,
  };
}

export function GetSortMode() {
  const stockSortMode: StockSortType = Utils.GetStorage(CONST.STORAGE.STOCK_SORT_MODE, {
    type: Enums.StockSortType.Custom,
    order: Enums.SortOrderType.Desc,
  });
  return {
    stockSortMode,
  };
}
