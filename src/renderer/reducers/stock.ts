import {
  SET_STOCKS_LOADING,
  SYNC_STOCK_CONFIG,
  SYNC_STOCKS_MAPPING,
  SYNC_STOCK_DATA,
  SET_STOCK_SYNING,
  SYNC_MA_MONITOR,
  SYNC_CHAN_MONITOR,
  SYNC_G_MONITOR,
  SYNC_LONG_MONITOR,
  SYNC_SHORT_MONITOR,
  SYNC_STOCK_NEWS,
  SYNC_HOLDINGS,
  SYNC_STOCK_TRADING,
  SYNC_STOCK_TRAININGS,
  SYNC_STOCKS_DATA,
  SYNC_NOWHOLDS,
} from '@/actions/stock';
import { Reducer } from '@/reducers/types';
import { Stock } from '@/types/stock';

export interface StockState {
  stocksLoading: boolean;
  stockConfigs: Stock.SettingItem[];
  stocksMapping: Record<string, Stock.AllData>;
  stockConfigsMapping: Record<string, Stock.SettingItem>;
  stockNewsMapping: Record<string, Stock.NewsItem[]>;
  maMonitors: Record<number, Record<number, Record<number, string[]>>>;
  chanMonitors: Record<number, Record<number, string[]>>;
  gMonitors: Record<number, Record<number, string[]>>;
  longMonitors: Record<number, string[]>;
  shortMonitors: Record<number, string[]>;
  relayMonitors: string[];
  holdings: string[];
  concerns: string[];
  tradings: Stock.DoTradeItem[];
  tradingsMapping: Record<string, Stock.DoTradeItem[]>;
  nowHolds: Stock.NowHoldItem[];
  trainings: Stock.QuantActionItem[];
  trainingsModified: string;
  stockConfigsModified: string;
  tradingsModified: string;
  syning: { v: boolean; t: string };
}

const stock: Reducer<StockState> = (
  state = {
    stocksLoading: false,
    stockConfigs: [],
    stocksMapping: {},
    stockConfigsMapping: {},
    stockNewsMapping: {},
    maMonitors: {},
    chanMonitors: {},
    gMonitors: {},
    longMonitors: {},
    shortMonitors: {},
    relayMonitors: [],
    holdings: [],
    concerns: [],
    tradings: [],
    tradingsMapping: {},
    nowHolds: [],
    trainings: [],
    stockConfigsModified: '1970-01-01 00:00:00',
    tradingsModified: '1970-01-01 00:00:00',
    trainingsModified: '1970-01-01 00:00:00',
    syning: { v: false, t: '' },
  },
  action
) => {
  switch (action.type) {
    case SET_STOCKS_LOADING:
      return {
        ...state,
        stocksLoading: action.payload,
      };
    case SYNC_STOCKS_MAPPING:
      return {
        ...state,
        stocksMapping: action.payload,
      };
    case SYNC_STOCK_DATA:
      const allData = action.payload as Stock.AllData;
      return {
        ...state,
        stocksMapping: {
          ...state.stocksMapping,
          [allData.detail.secid]: allData,
        },
      };
    case SYNC_STOCKS_DATA:
      return {
        ...state,
        stocksMapping: action.payload,
      };
    case SYNC_STOCK_NEWS:
      return {
        ...state,
        stockNewsMapping: {
          ...state.stockNewsMapping,
          [action.payload.data.secid]: action.payload.data,
        },
      };
    case SYNC_STOCK_TRADING:
      const [tradings, tradingModified] = action.payload;
      const tradeMappings: Record<string, any> = {};
      (tradings as Stock.DoTradeItem[]).forEach((t) => {
        if (t.stoplossAt) {
          t.stoplossAt = t.price * 0.9;
        }
        if (tradeMappings[t.secid]) {
          tradeMappings[t.secid].push(t);
        } else {
          tradeMappings[t.secid] = [t];
        }
      });
      return {
        ...state,
        tradings,
        tradingsMapping: tradeMappings,
        tradingsModified: tradingModified || state.tradingsModified,
      };
    case SYNC_MA_MONITOR:
      return {
        ...state,
        maMonitors: action.payload,
      };
    case SYNC_CHAN_MONITOR:
      return {
        ...state,
        chanMonitors: action.payload,
      };
    case SYNC_G_MONITOR:
      return {
        ...state,
        gMonitors: action.payload,
      };
    case SYNC_LONG_MONITOR:
      return {
        ...state,
        longMonitors: action.payload,
      };
    case SYNC_SHORT_MONITOR:
      return {
        ...state,
        shortMonitors: action.payload,
      };
    case SYNC_HOLDINGS:
      return {
        ...state,
        holdings: action.payload,
      };
    case SYNC_NOWHOLDS:
      return {
        ...state,
        nowHolds: action.payload,
      };
    case SYNC_STOCK_TRAININGS:
      const [trainings, trainingModified] = action.payload;
      return {
        ...state,
        trainings,
        trainingsModified: trainingModified || state.trainingsModified,
      };
    case SYNC_STOCK_CONFIG:
      const [configs, configModified] = action.payload;
      const configMappings: Record<string, any> = {};
      (configs as Stock.SettingItem[]).forEach((config) => {
        configMappings[config.secid] = config;
      });
      return {
        ...state,
        stockConfigs: configs,
        stockConfigsMapping: configMappings,
        stockConfigsModified: configModified,
      };
    case SET_STOCK_SYNING:
      return {
        ...state,
        syning: action.payload,
      };
    default:
      return state;
  }
};

export default stock;
