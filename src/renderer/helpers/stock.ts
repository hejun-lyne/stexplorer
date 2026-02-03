import { batch } from 'react-redux';
import store from '@/store/configureStore';
import * as Utils from '@/utils';
import * as Adapter from '@/utils/adapters';
import * as Services from '@/services';
import * as Helpers from '@/helpers';
import * as Enums from '@/utils/enums';
import * as Indicators from '@/helpers/tech';
import dayjs from 'dayjs';
import {
  setStockConfigAction,
  SET_STOCKS_LOADING,
  syncStockDataAction,
  SYNC_CHAN_MONITOR,
  SYNC_G_MONITOR,
  SYNC_MA_MONITOR,
  SYNC_STOCKS_DATA,
  SYNC_STOCK_TRADING,
  updateStockPartDetailsAction,
} from '@/actions/stock';
import { Stock } from '@/types/stock';
import { ChanGSpotState, ChanTrendState, ChanType, MAType, PriceMAState } from '@/utils/enums';
import moment from 'moment';
import { EastmoneySingleStockPush, EastmoneySingleTrendsPush, EastmoneyStockDetailsPush, EastmoneyStockKlinesPush } from '@/services/push';
const { saveString } = window.contextModules.electron;

export async function GetStockDetail(secid: string) {
  const detail = (await Services.Stock.GetDetailFromEastmoney(secid)) as unknown as Stock.DetailItem;
  return detail;
}

export async function GetFutureDetail(secid: string) {
  const detail = (await Services.Stock.GetFutureDetailFromSina(secid)) as unknown as Stock.DetailItem;
  return detail;
}

export async function GetStockDetails(secids: string[]) {
  return Adapter.ChokeGroupAdapter(
    secids.map((secid) => () => Services.Stock.GetDetailFromEastmoney(secid)),
    10
  );
}

export async function GetFutureDetails(secids: string[]) {
  return Adapter.ChokeGroupAdapter(
    secids.map((secid) => () => Services.Stock.GetFutureDetailFromSina(secid)),
    10
  );
}

export async function GetStockDetailAndTrendsAndFlows(secid: string) {
  const collectors = [
    () => Services.Stock.GetDetailFromEastmoney(secid),
    () => Services.Stock.GetTrendFromEastmoney(secid),
    () => Services.Stock.GetFlowTrendFromEastmoney(secid),
  ];
  return Adapter.ConCurrencyAllAdapter(collectors);
}

export async function GetStockTrendsAndFlows(secid: string) {
  const collectors = [() => Services.Stock.GetTrendFromEastmoney(secid), () => Services.Stock.GetFlowTrendFromEastmoney(secid)];
  return Adapter.ConCurrencyAllAdapter(collectors);
}

export async function GetStockTrends(secids: string[]) {
  return Adapter.ChokeGroupAdapter(
    secids.map((secid) => () => Services.Stock.GetTrendFromEastmoney(secid)),
    10
  );
}

export async function GetStockFlowTrends(secids: string[]) {
  return Adapter.ChokeGroupAdapter(
    secids.map((secid) => () => Services.Stock.GetFlowTrendFromEastmoney(secid)),
    10
  );
}

export function SortStocks(responseStocks: Stock.AllData[], stockConfigs?: Stock.SettingItem[]) {
  const {
    stockSortMode: { type: stockSortType, order: stockSortOrder },
  } = Helpers.Sort.GetSortMode();
  const sortList = Utils.DeepCopy(responseStocks);
  sortList.sort((a, b) => {
    const t = stockSortOrder === Enums.SortOrderType.Asc ? 1 : -1;
    switch (stockSortType) {
      case Enums.StockSortType.Zdd:
        return (Number(a.detail.zdd) - Number(b.detail.zdd)) * t;
      case Enums.StockSortType.Zdf:
        return (Number(a.detail.zdf) - Number(b.detail.zdf)) * t;
      case Enums.StockSortType.Zx:
        return (Number(a.detail.zx) - Number(b.detail.zx)) * t;
      case Enums.StockSortType.Custom:
      default:
        if (stockConfigs) {
          const c = stockConfigs.find((s) => s.secid === a.detail.secid);
          const d = stockConfigs.find((s) => s.secid === a.detail.secid);
          return c && d ? c?.pos - d?.pos : 0;
        }
        return 0;
    }
  });
  return sortList;
}

export async function UpdateStockDetail(secid: string) {
  try {
    const detail = (await GetStockDetail(secid)) as unknown as Stock.DetailItem;

    batch(() => {
      store.dispatch(syncStockDataAction(secid, detail));
    });
  } catch (error) {
    console.log('加载股票失败', error);
  }
}

export function SingleStockTrendPush(secid: string, callback: (trends: Stock.TrendItem[]) => void) {
  return new EastmoneySingleTrendsPush({
    secid,
    success: (data: {
      code: '300059';
      market: 0;
      type: 80;
      status: 0;
      name: '东方财富';
      decimal: 2;
      preSettlement: 0.0;
      preClose: 33.66;
      beticks: '33300|34200|54000|34200|41400|46800|54000';
      trendsTotal: 241;
      time: 1642044600;
      kind: 1;
      prePrice: 33.66;
      trends: ['2022-01-13 09:30,33.70,33.70,33.70,33.70,4898,16505586.00,33.700'];
    }) => {
      const trends = data.trends.map((item) => {
        const [datetime, last, current, zg, zd, vol, money, average] = item.split(',');
        return {
          datetime,
          last: Number(last),
          current: Number(current),
          vol: Number(vol),
          average: Number(average),
          up: Number(current) < Number(last) ? -1 : 1,
        };
      });
      callback(trends);
    },
    error: (message) => {
      console.error('SingleStockTrendPush error', message);
    },
  });
}

const w = 10 ** 4;
export function SingleStockDetailPush(secid: string, callback: (detail: Stock.DetailItem) => void): EastmoneySingleStockPush {
  return new EastmoneySingleStockPush({
    secid,
    success: (data: {
      f43: 14.34; // 最新
      f44: 14.66; // 最高
      f45: 14.25; // 最低
      f46: 14.45; // 今开
      f47: 82787; // 成交量
      f48: 119677563.0; // 成交额
      f49: 44706; // 外盘
      f50: 1.1; // 量比
      f51: 15.58; // 涨停
      f52: 12.74; // 跌停
      f55: 0.037979672;
      f57: '601808';
      f58: '中海油服';
      f60: 14.16; // 昨收
      f62: 1; // 市场类型
      f71: 14.46; // 均价
      f78: 0;
      f80: '[{"b":202107020930,"e":202107021130},{"b":202107021300,"e":202107021500}]';
      f84: 4771592000.0;
      f85: 2960468000.0;
      f86: 1625212803;
      f92: 8.1105323;
      f104: 26693335931.0;
      f105: 181223498.0;
      f107: 1;
      f110: 1;
      f111: 2;
      f116: 68424629280.0;
      f117: 42453111120.0;
      f127: '石油行业';
      f128: '天津板块';
      f135: 26795631.0;
      f136: 18589140.0;
      f137: 8206491.0;
      f138: 2051832.0;
      f139: 1684343.0;
      f140: 367489.0;
      f141: 24743799.0;
      f142: 16904797.0;
      f143: 7839002.0;
      f144: 42304379.0;
      f145: 52331656.0;
      f146: -10027277.0;
      f147: 47659827.0;
      f148: 45839042.0;
      f149: 1820785.0;
      f161: 38081;
      f162: 94.39;
      f163: 25.31;
      f164: 39.21;
      f167: 1.77;
      f168: 0.28;
      f169: 0.18;
      f170: 1.27;
      f173: 0.5;
      f177: 577;
      f183: 5902547125.0;
      f184: -27.7393;
      f185: -84.0958;
      f186: 10.1517;
      f187: 3.1199999999999998;
      f188: 48.03751339173166;
      f189: 20070928;
      f190: 3.87500256748691;
      f191: 68.95;
      f192: 875;
      f193: 6.86;
      f194: 0.31;
      f195: 6.55;
      f196: -8.38;
      f197: 1.52;
      f199: 90;
      f250: 6.96;
      f251: 6.92;
      f252: -0.57;
      f253: 148.35;
      f254: 2.48;
      f255: 3;
      f256: '02883';
      f257: 116;
      f258: '中海油田服务';
      f262: '-';
      f263: 0;
      f264: '-';
      f266: '-';
      f267: '-';
      f268: '-';
      f269: '-';
      f270: 0;
      f271: '-';
      f273: '-';
      f274: '-';
      f275: '-';
      f280: '-';
      f281: '-';
      f282: '-';
      f284: 0;
      f285: '-';
      f286: 0;
      f287: '-';
      f292: 5;
      f31: 14.38;
      f32: 97;
      f33: 14.37;
      f34: 43;
      f35: 14.36;
      f36: 22;
      f37: 14.35;
      f38: 3;
      f39: 14.34;
      f40: 32;
      f19: 14.33;
      f20: 162;
      f17: 14.32;
      f18: 195;
      f15: 14.31;
      f16: 148;
      f13: 14.3;
      f14: 496;
      f11: 14.29;
      f12: 71;
    }) => {
      // 更新详情
      if (data) {
        const r: Stock.DetailItem = { secid };
        if (data.f57) {
          r.code = data.f57;
        }
        if (data.f58) {
          r.name = data.f58;
        }
        if (data.f62) {
          r.market = data.f62;
        }
        if (data.f43) {
          r.zx = data.f43;
        }
        if (data.f44) {
          r.zg = data.f44;
        }
        if (data.f45) {
          r.zd = data.f45;
        }
        if (data.f46) {
          r.jk = data.f46;
        }
        if (data.f47) {
          r.cjl = data.f47;
          r.zss = typeof data.f47 === 'string' ? data.f47 : Number(data.f47);
        }
        if (data.f48) {
          r.cje = data.f48;
        }
        if (data.f49) {
          r.wp = typeof data.f49 === 'string' ? data.f49 : Number(data.f49); // 外盘
        }
        if (data.f50) {
          r.lb = data.f50;
        }
        if (data.f51) {
          r.zt = data.f51;
        }
        if (data.f52) {
          r.dt = data.f52;
        }
        if (data.f60) {
          r.zs = data.f60;
        }
        if (data.f71) {
          r.jj = data.f71;
        }
        if (data.f161) {
          r.np = typeof data.f161 === 'string' ? data.f161 : Number(data.f161); // 内盘
        }
        if (data.f168) {
          r.hsl = typeof data.f168 === 'string' ? data.f168 : Number(data.f168); // 内盘
        }
        if (data.f169) {
          r.zdd = data.f169;
        }
        if (data.f170) {
          r.zdf = data.f170;
        }
        if (data.f40) {
          r.s1 = data.f40;
        }
        if (data.f39) {
          r.s1p = data.f39;
        }
        if (data.f38) {
          r.s2 = data.f38;
        }
        if (data.f37) {
          r.s2p = data.f37;
        }
        if (data.f36) {
          r.s3 = data.f36;
        }
        if (data.f35) {
          r.s3p = data.f35;
        }
        if (data.f34) {
          r.s4 = data.f34;
        }
        if (data.f33) {
          r.s4p = data.f33;
        }
        if (data.f32) {
          r.s5 = data.f32;
        }
        if (data.f31) {
          r.s5p = data.f31;
        }
        if (data.f20) {
          r.b1 = data.f20;
        }
        if (data.f19) {
          r.b1p = data.f19;
        }
        if (data.f18) {
          r.b2 = data.f18;
        }
        if (data.f17) {
          r.b2p = data.f17;
        }
        if (data.f16) {
          r.b3 = data.f16;
        }
        if (data.f15) {
          r.b3p = data.f15;
        }
        if (data.f14) {
          r.b4 = data.f14;
        }
        if (data.f13) {
          r.b4p = data.f13;
        }
        if (data.f12) {
          r.b5 = data.f12;
        }
        if (data.f11) {
          r.b5p = data.f11;
        }
        if (data.f86) {
          r.time = dayjs.unix(data.f86).format('MM-DD HH:mm');
        }
        callback(r);
      }
    },
    error: (message) => {
      console.error('GetSingleStockPush error', message);
    },
  });
}

let sPush: EastmoneyStockDetailsPush;
let sAppendStocks: {
  secid: string;
  callback: Function;
}[] = [];

export function AppendStockDetailPush(secid: string, callback: (detail: Stock.PartDetailItem) => void) {
  const kv = sAppendStocks.find((o) => {o.secid == secid});
  if (kv) {
    kv.callback = callback;
    return;
  }
  sAppendStocks.push({
    secid,
    callback
  });

  // 重新开始
  MultiStockDetailPush(true);
}

export function RemoveStockDetailPush(secid: string) {
  let found = false;
  for (let i = 0; i < sAppendStocks.length; i++) {
    if (sAppendStocks[i].secid == secid) {
      found = true;
      sAppendStocks.splice(i);
      break;
    }
  }
  if (found) {
    // 重新开始
    MultiStockDetailPush(true);
  }
}
export function MultiStockDetailPush(restart:boolean) {
  // if (sPush && !Utils.JudgeWorkDayTime(new Date().getTime())) {
  //   // 非交易时间不更新
  //   return;
  // }
  if (sPush != null) {
    if(!restart) {
      return;
    }
    sPush.close();
  }
  try {
    const {
      stock: { stockConfigs },
    } = store.getState();
    const secids = stockConfigs.filter((_) => _.type != Enums.StockMarketType.Future).map((s) => s.secid);
    const appendSecids = sAppendStocks.map((s) => s.secid);
    sPush = new EastmoneyStockDetailsPush({
      secids: secids.concat(appendSecids),
      success: (data: {
        total: 1;
        diff: {
          '0': {
            f1: 2;
            f2: 3464; // 最新价
            f3: 481; // 涨跌幅
            f4: 159; // 涨跌额
            f5: 510312; // 总手
            f6: 1745330768.0; // 成交额
            f7: 980; // 振幅
            f8: 1954; // 换手率
            f9: 50181; // 市盈率
            f10: 81; // 量比
            f12: '300052'; // 代码
            f13: 0; // 市场类型
            f14: '中青宝'; // 名字
            f15: 3555; // 最高价
            f16: 3231; // 最低价
            f17: 3274; // 开盘价
            f18: 3305; // 昨收
            f19: 80; // 类型
            f22: 3; // 涨速
            f30: 5521; // 现手
            f31: 3463; // 买入价
            f32: 3464; // 卖出价
            f100: '游戏'; // 行业
            f112: 0.051772557; // 每股收益
            f125: 0; // 状态，2表示停牌
            f139: 5; // 11 表示可转债
            f148: 1; // f148 & 2 表示已退市
            f152: 2; // 小数点位数
          };
        };
      }) => {
        // 更新详情
        if (data.diff) {
          console.log('Detail push', data.diff);
          const details = Object.values(data.diff).map((d) => {
            const r: Stock.PartDetailItem = { secid: d.f13 + '.' + d.f12 };
            if (d.f12) {
              r.code = d.f12;
            }
            if (d.f13) {
              r.market = d.f13;
            }
            if (d.f14) {
              r.name = d.f14;
            }
            if (d.f2) {
              r.zx = d.f2 / 100;
            }
            if (d.f3) {
              r.zdf = d.f3 / 100;
            }
            if (d.f4) {
              r.zdd = d.f4 / 100;
            }
            if (d.f5) {
              r.zss = typeof d.f5 === 'string' ? d.f5 : Number(d.f5);
              r.cjl = d.f5;
            }
            if (d.f6) {
              r.cje = d.f6;
            }
            if (d.f8) {
              r.hsl = d.f8;
            }
            if (d.f9) {
              r.syl = d.f9;
            }
            if (d.f10) {
              r.lb = d.f10;
            }
            if (d.f15) {
              r.zg = d.f15 / 100;
            }
            if (d.f16) {
              r.zd = d.f16 / 100;
            }
            if (d.f17) {
              r.jk = d.f17 / 100;
            }
            if (d.f18) {
              r.zs = d.f18 / 100;
            }
            if (d.f22) {
              r.cs = d.f22 / 100;
            }
            return r;
          });
          details.forEach((v) => {
            const kv = sAppendStocks.find((o) => {o.secid == v.secid});
            if (kv) {
              kv.callback(v);
            }
          });
          
          store.dispatch(updateStockPartDetailsAction(details));
        }
      },
      error: (message) => {
        if (message) {
          console.error('EastmoneyStockPush error', message);
        }
      },
    });
  } catch (e) {
    console.error('ResetStockPush', e);
  }
}

let klinePush: EastmoneyStockKlinesPush;
export function SubscribeKlinePush(type: Enums.KLineType) {
  if (!klinePush) {
    klinePush = new EastmoneyStockKlinesPush();
  }
  klinePush.subscribe(type);
}
export function UnsubscribeKlinePush(type: Enums.KLineType) {
  if (klinePush) {
    klinePush.unsubscribe(type);
  }
}
const updatingKlineState: Record<number, boolean> = {};
export async function UpdateStocksKline(type: Enums.KLineType) {
  if (updatingKlineState[type]) {
    return;
  }
  updatingKlineState[type] = true;
  try {
    const {
      stock: { stockConfigs, stocksMapping, maMonitors, chanMonitors, gMonitors },
    } = store.getState();
    let secids = stockConfigs.filter((_) => _.type === Enums.StockMarketType.AB).map((_) => _.secid);
    // 延后10秒钟，获得最后的数据更新
    const isWorkDayTime = Utils.JudgeWorkDayTime(Number(new Date().getTime() - 10000));
    if (!isWorkDayTime) {
      // 无需重复更新
      secids = secids.filter((s) => !stocksMapping[s] || !stocksMapping[s].klines[type] || !stocksMapping[s].klines[type].length);
    }
    if (secids.length > 0) {
      const responseKlines = (await GetStocksKlinesAndFlows(secids, type)).filter(Utils.NotEmpty);
      responseKlines.forEach(([ks, fs]) => {
        if (ks.length > 0) {
          const secid = ks[0].secid;
          stocksMapping[secid] = UpdateStockData(
            stocksMapping[secid],
            secid,
            undefined,
            undefined,
            undefined,
            undefined,
            ks,
            fs,
            maMonitors,
            chanMonitors,
            gMonitors
          );
        }
      });
      batch(() => {
        store.dispatch({ type: SYNC_STOCKS_DATA, payload: Utils.DeepCopy(stocksMapping) });
        store.dispatch({ type: SYNC_MA_MONITOR, payload: Utils.DeepCopy(maMonitors) });
        store.dispatch({ type: SYNC_CHAN_MONITOR, payload: Utils.DeepCopy(chanMonitors) });
        store.dispatch({ type: SYNC_G_MONITOR, payload: Utils.DeepCopy(gMonitors) });
      });
      if (type == Enums.KLineType.Day) {
        setTimeout(() => UpdateTradings(secids, stocksMapping), 1000);
      }
    }
  } catch (error) {
    console.log('更新股票K线失败', error);
    store.dispatch({ type: SET_STOCKS_LOADING, payload: false });
  }
  updatingKlineState[type] = false;
}

export async function UpdateStockDetails() {
  try {
    const {
      stock: { stockConfigs, stocksLoading, stocksMapping, maMonitors, chanMonitors, gMonitors },
    } = store.getState();

    if (stocksLoading) {
      return;
    }
    store.dispatch({
      type: SET_STOCKS_LOADING,
      payload: true,
    });
    const stsecids = stockConfigs.filter((_) => _.type != Enums.StockMarketType.Future).map((_) => _.secid);
    const stResponseDetails = (await GetStockDetails(stsecids)).filter(Utils.NotEmpty);
    stsecids.forEach((secid) => {
      const detail = stResponseDetails.find((b) => b?.secid === secid);
      stocksMapping[secid] = UpdateStockData(stocksMapping[secid], secid, detail);
    });
    const ftsecids = stockConfigs.filter((_) => _.type == Enums.StockMarketType.Future).map((_) => _.secid);
    const ftResponseDetails = (await GetFutureDetails(ftsecids)).filter(Utils.NotEmpty);
    ftsecids.forEach((secid) => {
      const detail = ftResponseDetails.find((b) => b?.secid === secid);
      stocksMapping[secid] = UpdateStockData(stocksMapping[secid], secid, detail);
    });
    batch(() => {
      store.dispatch({ type: SYNC_STOCKS_DATA, payload: Utils.DeepCopy(stocksMapping) });
      store.dispatch({ type: SET_STOCKS_LOADING, payload: false });
    });
  } catch (error) {
    console.log('更新股票详情失败', error);
    store.dispatch({ type: SET_STOCKS_LOADING, payload: false });
  }
}

const updatingAllState = {
  updating: false,
};
export async function UpdateStocksAllData() {
  if (updatingAllState.updating) {
    return;
  }
  updatingAllState.updating = true;
  try {
    const {
      stock: { stockConfigs, stocksLoading, stocksMapping, maMonitors, chanMonitors, gMonitors },
    } = store.getState();

    if (stocksLoading) {
      return;
    }
    store.dispatch({
      type: SET_STOCKS_LOADING,
      payload: true,
    });
    const secids = stockConfigs.map((_) => _.secid);
    const responseDetails = (await GetStockDetails(secids)).filter(Utils.NotEmpty);
    const responseTrends = (await GetStockTrends(secids)).filter(Utils.NotEmpty);
    const responseFlows = (await GetStockFlowTrends(secids)).filter(Utils.NotEmpty);
    const responseKlines = (await GetStocksKlinesAndFlows(secids, Enums.KLineType.Day)).filter(Utils.NotEmpty);

    secids.forEach((secid) => {
      const detail = responseDetails.find((b) => b?.secid === secid);
      const trends = responseTrends.find((t) => t?.secid === secid)?.trends;
      const flows = responseFlows.find((f) => f?.secid === secid)?.ffTrends;
      const klineAndFlows = responseKlines ? responseKlines.find(([a, b]) => a[0]?.secid === secid) : undefined;
      stocksMapping[secid] = UpdateStockData(
        stocksMapping[secid],
        maMonitors,
        chanMonitors,
        gMonitors,
        secid,
        detail,
        trends,
        undefined,
        flows,
        klineAndFlows ? klineAndFlows[0] : undefined,
        klineAndFlows ? klineAndFlows[1] : undefined
      );
    });
    batch(() => {
      store.dispatch({ type: SYNC_STOCKS_DATA, payload: Utils.DeepCopy(stocksMapping) });
      store.dispatch({ type: SYNC_MA_MONITOR, payload: Utils.DeepCopy(maMonitors) });
      store.dispatch({ type: SYNC_CHAN_MONITOR, payload: Utils.DeepCopy(chanMonitors) });
      store.dispatch({ type: SYNC_G_MONITOR, payload: Utils.DeepCopy(gMonitors) });
      store.dispatch({ type: SET_STOCKS_LOADING, payload: false });
    });

    setTimeout(() => UpdateTradings(secids, stocksMapping), 1000);
  } catch (error) {
    console.log('更新股票失败', error);
    store.dispatch({ type: SET_STOCKS_LOADING, payload: false });
  }
  updatingAllState.updating = false;
}

function UpdateTradings(secids: string[], stocksMapping: Record<string, Stock.AllData>) {
  const {
    stock: { tradingsMapping },
  } = store.getState();
  const tradings: Stock.DoTradeItem[] = [];
  secids.forEach((secid) => {
    if (!tradingsMapping[secid]) {
      return;
    }
    tradingsMapping[secid].forEach((trade: Stock.DoTradeItem) => {
      const current = stocksMapping[secid].detail.zx;
      const klines = stocksMapping[secid].klines[Enums.KLineType.Day];
      const dealDay = trade.time.substring(0, 10);
      const dIndex = klines.map((k) => k.date).indexOf(dealDay);
      if (dIndex == -1) {
        // 没有找到，可能历史比较久远了
        trade.profits = [-1, -1, -1, -1, (current - trade.price) / trade.price];
      } else {
        trade.profits = [((klines[dIndex].sp - trade.price) / trade.price) * 100];
        const nowprofit = ((current - trade.price) / trade.price) * 100;
        if (dIndex + 1 < klines.length - 1) {
          trade.profits.push(((klines[dIndex + 1].sp - trade.price) / trade.price) * 100);
        } else {
          trade.profits.push(nowprofit);
        }
        if (dIndex + 5 < klines.length - 1) {
          trade.profits.push(((klines[dIndex + 5].sp - trade.price) / trade.price) * 100);
        } else {
          trade.profits.push(nowprofit);
        }
        if (dIndex + 10 < klines.length - 1) {
          trade.profits.push(((klines[dIndex + 10].sp - trade.price) / trade.price) * 100);
        } else {
          trade.profits.push(nowprofit);
        }
        trade.profits.push(((current - trade.price) / trade.price) * 100);
      }
      tradings.push(trade);
    });
  });
  tradings.sort((a, b) => {
    const t1 = new Date(a.time);
    const t2 = new Date(b.time);
    return t1.getTime() > t2.getTime() ? 1 : -1;
  });
  store.dispatch({ type: SYNC_STOCK_TRADING, payload: [tradings] });
}

export function UpdateStockData(
  prev: Stock.AllData | undefined,
  secid: string,
  detail?: Stock.DetailItem,
  trends?: Stock.TrendItem[],
  trendsPic?: { secid: string; pic: string },
  tflows?: Stock.FlowTrendItem[],
  klines?: Stock.KLineItem[],
  dflows?: Stock.FlowDLineItem[],
  maMonitors?: Record<number, any>,
  chanMonitors?: Record<number, any>,
  gMonitors?: Record<number, any>
) {
  let data = prev;
  if (!data) {
    data = {
      detail: {} as unknown as Stock.DetailItem,
      bankuais: [],
      trendspic: '',
      trends: [],
      tflows: [],
      klines: {},
      dflows: [],
      chans: {},
      chanStokes: {},
      chanLines: {},
      chanPlatforms: {},
      kstates: {},
      chanState: [0, 0],
      extra: {
        position: 0,
      },
    };
  }
  if (detail) {
    data.detail = detail;
  }
  if (trends) {
    data.trends = trends;
  }
  if (trendsPic) {
    data.trendspic = trendsPic.pic;
  }
  if (tflows) {
    data.tflows = tflows;
  }
  if (dflows && dflows.length > 0) {
    let prevLines = data.dflows;
    if (!prevLines || dflows.length > prevLines.length) {
      prevLines = dflows;
    } else {
      for (let i = 0; i < prevLines.length; i++) {
        if (dflows[0].date === prevLines[i].date) {
          prevLines = prevLines.slice(0, i).concat(dflows);
          break;
        }
        if (i === prevLines.length - 1) {
          // 没有找到
          prevLines = dflows;
          break;
        }
      }
    }
    data.dflows = prevLines;
  }
  if (dflows) {
    data.dflows = dflows;
  }
  if (klines) {
    // 合并数据
    const ktype = klines[0].type;
    data.klines[ktype] = MergeKlines(data.klines[ktype], klines);
    // 更新其他数据
    // 计算k线状态
    const kstates = ComputeKState(klines);
    if (!maMonitors[ktype]) {
      maMonitors[ktype] = {};
    }
    const typeMAMonitors = maMonitors[ktype];
    let maMonitorChanged = false;
    Object.keys(kstates)
      .map(parseInt)
      .forEach((ma_t) => {
        const ma_s = kstates[ma_t];
        if (!typeMAMonitors[ma_t]) {
          typeMAMonitors[ma_t] = {};
          maMonitorChanged = true;
        }
        if (!typeMAMonitors[ma_t][ma_s]) {
          typeMAMonitors[ma_t][ma_s] = [secid];
          maMonitorChanged = true;
        } else {
          typeMAMonitors[ma_t][ma_s].push(secid);
          maMonitorChanged = true;
        }
      });
    // 缠论数据计算
    const { chansData, chansStokes, chansLines, chansPlatforms, chanGspot } = ComputeChans(klines);
    data.kstates[ktype] = kstates;
    data.chans[ktype] = chansData;
    data.chanLines[ktype] = chansLines;
    data.chanStokes[ktype] = chansStokes;
    data.chanPlatforms[ktype] = chansPlatforms;

    let cstate = 0;
    if (chansData.length > 2) {
      const today = moment(new Date()).format('YYYY-MM-DD');
      const beforeLastChan = chansData[chansData.length - 2]; //(today === chansData[chansData.length - 1].date ? 3 : 2)];
      if (beforeLastChan.type === ChanType.Top) {
        cstate = ChanTrendState.TopDown;
      } else if (beforeLastChan.type === ChanType.Bottom) {
        cstate = ChanTrendState.BottomUp;
      } else {
        cstate = chansData[chansData.length - 1].type === ChanType.StepDown ? ChanTrendState.TrendDown : ChanTrendState.TrendUp;
      }
    }
    let gstate: ChanGSpotState = 0;
    if (chanGspot > 0) {
      gstate = ComputeGSpotState(chanGspot, klines[klines.length - 1]);
    }
    const [prevcstate, prevgstate] = data.chanState;
    if (!chanMonitors[ktype]) {
      chanMonitors[ktype] = {};
    }
    const cData = chanMonitors[ktype];
    if (cstate != prevcstate) {
      if (cData[prevcstate] && cData[prevcstate].includes(secid)) {
        cData[prevcstate] = cData[prevcstate].filter((_) => _ !== secid);
      }
      cData[cstate] = (cData[cstate] || []).concat(secid);
    }

    if (!gMonitors[ktype]) {
      gMonitors[ktype] = {};
    }
    const gData = gMonitors[ktype];
    if (gstate != prevgstate) {
      if (gData[prevgstate] && gData[prevgstate].includes(secid)) {
        gData[prevgstate] = gData[prevgstate].filter((_) => _ !== secid);
      }
      gData[gstate] = (gData[gstate] || []).concat(secid);
    }
    data.chanState = [cstate, gstate, chanGspot];
  }
  return data;
}

function MergeKlines(prevLines: Stock.KLineItem[] | undefined, data: Stock.KLineItem[]) {
  if (prevLines) {
    for (let i = 0; i < prevLines.length; i++) {
      if (data[0].date === prevLines[i].date) {
        return prevLines.slice(0, i).concat(data);
      }
    }
  }
  return data;
}

export function ComputeChans(data: Stock.KLineItem[]) {
  const chansData: Stock.ChanItem[] = data.map((k) => {
    return {
      date: k.date,
      kp: k.kp,
      sp: k.sp,
      zdf: k.zdf,
      zg: Math.max(k.sp, k.kp),
      zd: Math.min(k.sp, k.kp),
      cjl: k.cjl,
      cje: k.cje,
      hsl: k.hsl,
      type: k.type,
      days: 1,
    };
  });
  if (data.length < 10) {
    return {
      chansData: [],
      chansStokes: [],
    };
  }
  // 设置类型
  let prevToB = ChanType.Unknow;
  chansData.forEach((c, i) => {
    if (i == 0) {
      c.type = c.sp > chansData[i + 1].sp ? ChanType.Top : ChanType.Bottom;
      prevToB = c.type;
      return;
    }
    if (i == chansData.length - 1) {
      c.type = prevToB === ChanType.Top ? ChanType.Bottom : ChanType.Top;
    } else if (c.sp > chansData[i - 1].sp) {
      // 接下来三根k线没有创出新高
      c.type = ChanType.Top;
      for (let j = 1; j <= 3 && i + j < chansData.length; j++) {
        if (chansData[i + j].sp > c.sp) {
          c.type = ChanType.Child;
          break;
        }
      }
    } else if (c.sp <= chansData[i - 1].sp) {
      // 接下来三根k线没有创出新低
      c.type = ChanType.Bottom;
      for (let j = 1; j <= 3 && i + j < chansData.length; j++) {
        if (chansData[i + j].sp < c.sp) {
          c.type = ChanType.Child;
          break;
        }
      }
    }
    if (prevToB === c.type) {
      c.type = ChanType.Child;
    } else if (c.type != ChanType.Child) {
      prevToB = c.type;
    }
  });
  const chansStokes: Stock.ChanStokeItem[] = [];
  let start: Stock.ChanItem, end: Stock.ChanItem;
  let startIndex = 0;
  let endIndex = 0;
  let days = 0;
  chansData.forEach((d, i) => {
    // 判断连线
    if (!start) {
      start = d;
      days = d.days;
      return;
    }
    days += d.days;
    if (d.type == ChanType.Top || d.type == ChanType.Bottom) {
      end = d;
      endIndex = i;
      chansStokes.push({
        start,
        end,
        startIndex,
        endIndex,
        days,
        direction: start.type == ChanType.Bottom ? 'up' : 'down',
      });
      start = d;
      startIndex = i;
      days = d.days;
    }
  });

  return { chansData, chansStokes };
}

export function ComputeKState(klines: Stock.KLineItem[]) {
  const maState: Record<number, PriceMAState> = {};
  let sum = 0;
  let count = 0;
  let ma5 = 0;
  let ma10 = 0;
  let ma20 = 0;
  let ma30 = 0;
  for (let i = klines.length - 1; i > 0; i--) {
    sum += klines[i].sp;
    count++;
    if (count == 5) {
      ma5 = sum / 5;
    }
    if (count == 10) {
      ma10 = sum / 10;
    }
    if (count == 20) {
      ma20 = sum / 20;
    }
    if (count == 30) {
      ma30 = sum / 30;
      break;
    }
  }
  const k = klines[klines.length - 1];
  const keys = [MAType.MA5, MAType.MA10, MAType.MA20, MAType.MA30];
  [ma5, ma10, ma20, ma30].forEach((ma, i) => {
    const key = keys[i];
    if (ma < k.zg && ma > k.zd) {
      // 上影线形态
      if (ma > Math.max(k.kp, k.sp)) {
        // 均线在实体上方
        maState[key] = PriceMAState.HighCrossMA;
      } else if (ma < Math.min(k.kp, k.sp)) {
        // 均线在实体下方，说明有下影线
        maState[key] = PriceMAState.LowCrossMA;
      } else {
        // 均线在实体内部
        if (ma > k.kp) {
          // 收阳线
          maState[key] = PriceMAState.CloseAboveMA;
        } else {
          // 收阴线
          maState[key] = PriceMAState.CloseBelowMA;
        }
      }
    } else {
      if (ma < k.zd) {
        maState[key] = PriceMAState.AllAboveMA;
      } else if (ma > k.zg) {
        maState[key] = PriceMAState.AllBelowMA;
      }
    }
  });
  return maState;
}

export function ComputeGSpotState(gspot: number, k: Stock.KLineItem) {
  if (gspot < k.zg && gspot > k.zd) {
    // 上影线形态
    if (gspot > Math.max(k.kp, k.sp)) {
      // 在实体上方
      return ChanGSpotState.HighCrossGSpot;
    } else if (gspot < Math.min(k.kp, k.sp)) {
      // 均线在实体下方，说明有下影线
      return ChanGSpotState.LowCrossGSpot;
    } else {
      // 均线在实体内部
      if (gspot > k.kp) {
        // 收阳线
        return ChanGSpotState.CloseAboveGSpot;
      } else {
        // 收阴线
        return ChanGSpotState.CloseBelowGSpot;
      }
    }
  } else {
    if (gspot < k.zd) {
      return ChanGSpotState.AllBelowGSpot;
    } else if (gspot > k.zg) {
      return ChanGSpotState.AllAboveGSpot;
    }
  }
  return ChanGSpotState.Unknow;
}

/**
 *
 * @param klines K线数据
 * @param accuracyFactor 分多少组
 */
export function ComputeChouMa(klines: { date: string; zg: number; zd: number; hsl: number }[], accuracyFactor = 150) {
  // r => accuracyFactor
  let maxZg = 0; // e
  let minZd = 0; // o
  // 计算周期的最高、最低
  klines.forEach((k, i) => {
    // s => k, a => i
    maxZg = maxZg ? Math.max(maxZg, k.zg) : k.zg;
    minZd = minZd ? Math.min(minZd, k.zd) : k.zd;
  });

  const step = Math.max(0.01, (maxZg - minZd) / (accuracyFactor - 1)); // l
  const steps = []; // h
  const data: number[] = []; // d
  for (let i = 0; i < accuracyFactor; i++) {
    steps.push((minZd + step * i).toFixed(2));
    data.push(0);
  }
  klines.forEach((k, i) => {
    // i => a, c => k, p => k.kp, g => k.sp, A => k.zg, u => k.zd
    const avg = (k.kp + k.sp + k.zg + k.zd) / 4; // f
    const hsl = Math.min(1, k.hsl / 100 || 0); // m
    const ZgtoMinZd = Math.floor((k.zg - minZd) / step); // C
    const ZdtoMinZd = Math.ceil((k.zd - minZd) / step); // y
    const pair = [k.zg === k.zd ? accuracyFactor - 1 : 2 / (k.zg - k.zd), Math.floor((avg - minZd) / step)]; // v
    for (let j = 0; j < data.length; j++) {
      // j => x
      data[j] *= 1 - hsl;
    }
    if (k.zg === k.zd) {
      data[pair[1]] += (pair[0] * hsl) / 2;
    } else {
      for (let ii = ZdtoMinZd; ii <= ZgtoMinZd; ii++) {
        // ii => I
        const b = minZd + step * ii;
        if (b <= avg) {
          if (Math.abs(avg - k.zd) < 1e-8) {
            data[ii] += pair[0] * hsl;
          } else {
            data[ii] += ((b - k.zd) / (avg - k.zd)) * pair[0] * hsl;
          }
        } else {
          if (Math.abs(k.zg - avg) < 1e-8) {
            data[ii] += pair[0] * hsl;
          } else {
            data[ii] += ((k.zg - b) / (k.zg - avg)) * pair[0] * hsl;
          }
        }
      }
    }
  });

  let total = 0; // k
  const lastSp = klines[klines.length - 1].sp; // w
  let benefitTotal = 0;
  for (let i = 0; i < data.length; i++) {
    // i => a
    total += data[i];
    if (minZd + i * step <= lastSp) {
      benefitTotal += data[i];
    }
  }
  if (total === 0) {
    console.log('ComputeChouMa: something bad happen');
  }
  const benefitPart = total == 0 ? 0 : benefitTotal / total;

  function findPercentValue(p: number) {
    let sum = 0;
    let result = 0;
    for (let i = 0; i < accuracyFactor; i++) {
      const a = data[i];
      if (p < sum + a) {
        result = minZd + i * step;
        break;
      }
      sum += a;
    }
    return result;
  }

  function computePercentChips(p: number) {
    const pair = [(1 - p) / 2, (1 + p) / 2]; // e
    const result = [findPercentValue(total * pair[0]), findPercentValue(total * pair[1])];
    return {
      percentile: p,
      priceRange: {
        start: result[0].toFixed(2),
        end: result[1].toFixed(2),
      },
      concentration: result[0] + result[1] === 0 ? 0 : (result[1] - result[0]) / (result[0] + result[1]),
    };
  }

  const percentChips = [computePercentChips(0.9), computePercentChips(0.7)];

  const avgCost = findPercentValue(0.5 * total).toFixed(2);
  return {
    date: klines.slice(-1)[0].date,
    values: data,
    steps,
    benefitRatio: benefitPart,
    avgCost,
    percentChips,
  } as Stock.ChouMaItem;
}

export async function UpdateStockDetailsAndTrends(loading: boolean) {
  try {
    if (loading) {
      store.dispatch({
        type: SET_STOCKS_LOADING,
        payload: true,
      });
    }
    const {
      stock: { stocksMapping, stockConfigs },
    } = store.getState();
    const secids = stockConfigs.filter((_) => !stocksMapping[_.secid]).map((_) => _.secid);
    const responseDetails = (await GetStockDetails(secids)).filter(Utils.NotEmpty);
    const responseTrends = (await GetStockTrends(secids)).filter(Utils.NotEmpty);
    const responseFlows = (await GetStockFlowTrends(secids)).filter(Utils.NotEmpty);
    batch(() => {
      secids.forEach((secid) => {
        const detail = responseDetails.find((b) => b?.secid === secid);
        const trends = responseTrends.find((t) => t?.secid === secid)?.trends;
        const flows = responseFlows.find((f) => f?.secid === secid)?.ffTrends;
        store.dispatch(syncStockDataAction(secid, detail, trends, undefined, flows));
      });
      if (loading) {
        store.dispatch({ type: SET_STOCKS_LOADING, payload: false });
      }
    });
  } catch (error) {
    console.log('更新股票失败', error);
    if (loading) {
      store.dispatch({ type: SET_STOCKS_LOADING, payload: false });
    }
  }
}

export async function UpdateStockKlinesAndFlows(type: Enums.KLineType) {
  try {
    const {
      stock: { stocksMapping, stockConfigs },
    } = store.getState();
    // onDetailed的情况下应该频率更高
    const secids = stockConfigs.map((_) => _.secid);
    const responses = (await GetStocksKlinesAndFlows(secids, type)).filter(Utils.NotEmpty);
    batch(() => {
      secids.forEach((secid) => {
        const [klines, flows] = responses.find(([a, b]) => a[0]?.secid === secid);
        store.dispatch(syncStockDataAction(secid, undefined, undefined, undefined, undefined, klines, flows));
      });
      store.dispatch({ type: SET_STOCKS_LOADING, payload: false });
    });
  } catch (error) {
    console.log('更新股票失败', error);
    store.dispatch({ type: SET_STOCKS_LOADING, payload: false });
  }
}

async function GetTrendsPic(secids: string[]) {
  const collectors = secids.map((secid) => {
    return () => Services.Stock.GetPicTrendFromEastmoney(secid);
  });
  return Adapter.ConCurrencyAllAdapter(collectors);
}

export async function UpdateTrendsPic(secids: string[]) {
  try {
    const pics = await GetTrendsPic(secids);
    if (pics) {
      batch(() => {
        pics.forEach((p, i) => {
          store.dispatch(syncStockDataAction(secids[i], undefined, undefined, p));
        });
      });
    }
  } catch (error) {
    console.log('加载股票K线失败', error);
  }
}

export async function UpdateKlines(secid: string, type: Enums.KLineType) {
  try {
    const { ks } = await Services.Stock.GetKFromEastmoney(secid, type);
    let flines;
    if (type === Enums.KLineType.Day) {
      flines = await Services.Stock.GetFlowKFromEastmoney(secid);
    }
    store.dispatch(syncStockDataAction(secid, undefined, undefined, undefined, undefined, responseKlines, flines));
  } catch (error) {
    console.log('加载股票K线失败', error);
  }
}

export async function GetStocksKlinesAndFlows(secids: string[], type: Enums.KLineType) {
  return Adapter.ChokeGroupAdapter(
    secids.map((secid) => () => GetKlinesAndFlows(secid, type)),
    10
  );
}

export async function GetKlinesAndFlows(secid: string, type: Enums.KLineType, context?: any) {
  // 如果初次请求
  const {
    stock: { stocksMapping },
  } = store.getState();
  let count: number;
  let needMakeReq = true;
  const st = stocksMapping[secid];
  if (!st || !st.klines[type] || !st.klines[type].length) {
    // 请求所有数据
    count = type >= Enums.KLineType.Day ? 350 : 100000;
  } else {
    const lastTimeStr = st.klines[type].slice(-1)[0].date;
    let lastTime: moment.Moment;
    if (type >= Enums.KLineType.Day) {
      lastTime = moment(lastTimeStr, 'YYYY-MM-DD');
    } else {
      lastTime = moment(lastTimeStr, 'YYYY-MM-DD HH:MM');
    }
    const now = moment(new Date());
    const days = now.diff(lastTime, 'days');
    if (days === 0) {
      // 当天，如果非交易时段，不需要重新请求
      needMakeReq = Utils.JudgeWorkDayTime(Number(new Date().getTime()));
    }
    let quant = 1; // DAY
    if (type === Enums.KLineType.Mint60) {
      quant = 4;
    } else if (type === Enums.KLineType.Mint30) {
      quant = 8;
    } else if (type === Enums.KLineType.Mint15) {
      quant = 16;
    } else if (type === Enums.KLineType.Mint5) {
      quant = 32;
    } else {
      quant = 64;
    }
    count = quant * (days + 1);
  }
  async function getKlines(s: string, t: number, c: number) {
    return Services.Stock.GetKFromEastmoney(s, t, c);
  }
  async function getDFlows(s: string) {
    if (type == Enums.KLineType.Day) {
      return Services.Stock.GetFlowKFromEastmoney(s);
    }
    return undefined;
  }
  const collectors = [
    needMakeReq ? () => getKlines(secid, type, count) : st.klines[type],
    needMakeReq ? () => getDFlows(secid) : st.dflows,
    context,
  ];
  return Adapter.ConCurrencyAllAdapter(collectors);
}

export async function GetStockNews(secid: string, pageIndex: number, pageSize: number) {
  try {
    const shortList = (await Services.Stock.GetNews(secid, pageIndex, pageSize)) as unknown as Stock.NewsItem[];
    const briefs = await Adapter.ChokeGroupAdapter(
      shortList.map((n) => () => Services.Stock.GetNewsBrief(n.newsid)),
      5
    );
    briefs.forEach((b, i) => {
      if (b?.postid) {
        shortList[i].postid = `${b.postid}`;
      }
    });
    const contents = await Adapter.ChokeGroupAdapter(
      shortList.map((n) => () => Services.Stock.GetNewsContent(n.postid, n.newsid)),
      5
    );
    contents.forEach((c, i) => {
      if (c?.abstract) {
        shortList[i].abstract = c.abstract;
        shortList[i].content = c.content;
      }
    });
    return shortList;
  } catch (error) {
    console.log('加载股票资讯失败', error);
    return [];
  }
}

export async function PositionStock(secid: string, type: Enums.PositionType) {
  try {
    const {
      stock: { stockConfigs },
    } = store.getState();
    const list = Utils.DeepCopy(stockConfigs);
    let sourceIndex = -1;
    let sourceEle: Stock.SettingItem | undefined = undefined;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.secid !== secid) {
        continue;
      }
      sourceEle = s;
      sourceIndex = i;
    }
    if (sourceIndex !== -1) {
      switch (type) {
        case Enums.PositionType.Top:
          list.splice(sourceIndex, 1);
          list.unshift(sourceEle!);
          break;
        case Enums.PositionType.Bottom:
          list.splice(sourceIndex, 1);
          list.push(sourceEle!);
          break;
        case Enums.PositionType.Up:
          if (sourceIndex != 0) {
            list[sourceIndex] = list.splice(sourceIndex - 1, 1, sourceEle!)[0];
          }
          break;
        case Enums.PositionType.Down:
          if (sourceIndex != stockConfigs.length - 1) {
            list[sourceIndex] = list.splice(sourceIndex + 1, 1, sourceEle!)[0];
          }
          break;
      }
    }
    store.dispatch(setStockConfigAction(list));
  } catch (error) {
    console.log('调整股票位置失败', error);
  }
}

export function UpdateStockMAState(secid: string) {
  try {
    const {
      stock: { stocksMapping },
    } = store.getState();
    const data = stocksMapping[secid];
    if (data) {
      let kstates = data.kstates;
      if (!kstates) {
        kstates = {};
      }
      Object.entries(data.klines).forEach(([type, lines]) => {
        let typekstates = kstates[type];
        if (!typekstates) {
          typekstates = {
            maStates: {},
            chanState: {},
          } as Stock.StateItem;
          kstates[type] = typekstates;
        }
        let sum = 0;
        let count = 0;
        let ma5 = 0;
        let ma10 = 0;
        let ma20 = 0;
        let ma30 = 0;
        const maState = typekstates.maStates;
        for (let i = lines.length - 1; i > 0; i--) {
          sum += lines[i].sp;
          count++;
          if (count == 5) {
            ma5 = sum / 5;
          }
          if (count == 10) {
            ma10 = sum / 10;
          }
          if (count == 20) {
            ma20 = sum / 20;
          }
          if (count == 30) {
            ma30 = sum / 30;
            break;
          }
        }
        const k = lines[lines.length - 1];
        const keys = ['ma5', 'ma10', 'ma20', 'ma30'];
        [ma5, ma10, ma20, ma30].forEach((ma, i) => {
          if (ma < k.zg && ma > k.zd) {
            const key = keys[i];
            if (k.zg > k.kp && k.zg > k.sp) {
              // 上影线形态
              if (ma > Math.max(k.kp, k.sp)) {
                // 均线在实体上方
                maState[key] = Enums.PriceMAState.HighCrossMA;
              } else if (ma < Math.min(k.kp, k.sp)) {
                // 均线在实体下方，说明有下影线
                maState[key] = Enums.PriceMAState.LowCrossMA;
              } else {
                // 均线在实体内部
                if (ma > k.kp) {
                  // 收阳线
                  maState[key] = Enums.PriceMAState.CloseAboveMA;
                } else {
                  // 收阴线
                  maState[key] = Enums.PriceMAState.CloseBelowMA;
                }
              }
            }
          }
        });
      });
      store.dispatch(syncStockDataAction(secid, undefined, undefined, undefined, undefined, undefined, undefined, kstates));
    }
  } catch (error) {
    console.log('更新股票K线状态失败', error);
  }
}

export function GetStockCode(secid: string) {
  let dotIndex = secid.indexOf('.');
  if (dotIndex != -1) {
    return secid.substring(dotIndex + 1);
  }
  return secid;
}

export function GetStockType(secid: string) {
  if (secid == '1.000001' || secid == '0.399006') {
    return Enums.StockMarketType.Zindex;
  }
  if (secid.startsWith('0.') || secid.startsWith('1.')) {
    return Enums.StockMarketType.AB;
  } else if (secid.startsWith('90.') || secid.startsWith('BK')) {
    return Enums.StockMarketType.Quotation;
  } else if (secid.startsWith('100')) {
    return Enums.StockMarketType.USZindex;
  } else if (secid.startsWith('105')) {
    return Enums.StockMarketType.US;
  }
  return Enums.StockMarketType.Zindex;
}

export function ComputJLInfo(klines: Stock.KLineItem[], bDate: string, p1 = 2, p2 = 1.1) {
  if (!klines) {
    return;
  }
  // 突破阳线
  let bk = klines[0];
  let bi = 0;
  for (let i = 0; i < klines.length - 1; i++) {
    if (klines[i].date == bDate) {
      bk = klines[i];
      bi = i;
      break;
    }
  }

  // 找到平台最高点K线
  let chi = bi;
  let zg = bk.zg;
  for (let i = bi; i < klines.length; i++) {
    if (klines[i].zg > zg) {
      chi = i;
      zg = klines[i].zg;
    }
  }

  // 找到平台最低点K线
  let cli = chi;
  let zd = klines[chi].zd;
  for (let i = chi; i < klines.length; i++) {
    if (klines[i].zd < zd) {
      zd = klines[i].zd;
      cli = i;
    }
  }

  // 找到底部平台的最高和最低
  let asi = 0;
  for (let i = bi; i >= 0; i--) {
    if (klines[i].zg > bk.zg) {
      // 再往后找到反弹底部
      let prevk = klines[i];
      for (let j = i + 1; j < bi; j++) {
        if (klines[j].zd > prevk.zd && klines[j].zg < prevk.zg) {
          // 包含关系
          continue;
        }
        if (klines[j].zd > prevk.zd) {
          // 反弹了
          asi = j;
          break;
        }
        prevk = klines[j];
      }
      break;
    } else {
      // 如果超过250天，就直接限定到250天前
      asi = i;
    }
  }

  // 找到底部平台的最高和最低
  zd = klines[asi].zd;
  zg = klines[asi].zg;
  let ahi = asi;
  let ali = asi;
  for (let i = asi + 1; i < bi; i++) {
    if (klines[i].zd < zd) {
      zd = klines[i].zd;
      ali = i;
    }
    if (klines[i].zg > zg) {
      zg = klines[i].zg;
      ahi = i;
    }
  }
  let acjlt = 0;
  for (let i = asi; i < bi; i++) {
    acjlt += klines[i].cjl;
  }
  let ccjlt = 0;
  for (let i = chi; i < klines.length - 1; i++) {
    ccjlt += klines[i].cjl;
  }
  return {
    ask: klines[asi], // A起始K线
    alk: klines[ali], // A最低
    ahk: klines[ahi], // A最高
    adays: bi - asi, // A周期
    bk, // B K线
    blb: bk.cjl / (acjlt / (bi - asi)), // B 量比
    chk: klines[chi], // C最高
    clk: klines[cli], // C最低
    clb: klines[klines.length - 1].cjl / (ccjlt / (klines.length - chi - 1)),
    cdays: klines.length - chi, // C周期
  } as Stock.JLStrategyItem;
}

export function ComputLQSInfo(klines: Stock.KLineItem[], mtype: MAType, p1 = 0.1) {
  const ma = Utils.calculateMA(
    mtype,
    klines.map((_) => _.sp)
  ).map((_) => parseFloat(_));
  // 往前找到趋势的起点
  let si = 0;
  for (let i = klines.length - 1; i >= 0; i--) {
    if (klines[i].zd < ma[i] * (1 - p1)) {
      // 均线偏离值比较高，可以认为再往前不属于趋势段
      // 往后找到均线突破k线，作为趋势起点
      for (let j = i + 1; j < klines.length; j++) {
        if (klines[j].zg > ma[j]) {
          si = j;
          break;
        }
      }
      if (si != 0) {
        break;
      }
    }
  }

  // 计算上涨段
  const segs = [];
  let upcrossma = false;
  let downcrossma = false;
  let upi = 0;
  let downi = 0;
  for (let i = si; i < klines.length; i++) {
    // 找到脱离均线的位置
    if (!upcrossma) {
      if (klines[i].zd > ma[i]) {
        upcrossma = true;
        upi = i;
      } else {
        continue;
      }
    }
    // 找到下穿均线的位置
    if (!downcrossma) {
      if (klines[i].zd < ma[i]) {
        downcrossma = true;
        downi = i;
      } else {
        continue;
      }
    }

    let szg = klines[upi].zg;
    let hi = upi;
    for (let j = upi; j < downi; j++) {
      if (klines[j].zg > szg) {
        szg = klines[j].zg;
        hi = j;
      }
    }

    // 记录
    segs.push({
      si: upi,
      hi,
      ei: downi,
    });

    // 重置参数
    i = downi;
    upcrossma = false;
    downcrossma = false;
    upi = i + 1;
    downi = i + 1;
  }
  return {
    mtype,
    segs,
    touchMa: klines[klines.length - 1].zd < ma[ma.length - 1],
  } as Stock.QSStrategyItem;
}

export async function GetMarketMood(date: string) {
  const collectors = [() => Services.Stock.requestMoodTrend(date, 0), () => Services.Stock.requestMoodTrend(date, 1)];
  return Adapter.ConCurrencyAllAdapter(collectors);
}

export async function StatisticMultiKlines(secids: string[], klimit = 100) {
  const collectors = secids.map((s) => () => StatisticiKline(s, klimit));
  const vals = (await Adapter.ConCurrencyAllAdapter(collectors)) as Stock.KLineStatisticItem[];
  vals.sort((a, b) => {
    const av = a.b1d_zdf || 0;
    const bv = b.b1d_zdf || 0;
    return bv - av;
  });
  vals.forEach((a, i) => (a.b1d_rank = i + 1));
  vals.sort((a, b) => {
    const av = a.b3d_zdf || 0;
    const bv = b.b3d_zdf || 0;
    return bv - av;
  });
  vals.forEach((a, i) => (a.b3d_rank = i + 1));
  vals.sort((a, b) => {
    const av = a.b5d_zdf || 0;
    const bv = b.b5d_zdf || 0;
    return bv - av;
  });
  vals.forEach((a, i) => (a.b5d_rank = i + 1));
  vals.sort((a, b) => {
    const av = a.b10d_zdf || 0;
    const bv = b.b10d_zdf || 0;
    return bv - av;
  });
  vals.forEach((a, i) => (a.b10d_rank = i + 1));
  vals.sort((a, b) => {
    const av = a.b20d_zdf || 0;
    const bv = b.b20d_zdf || 0;
    return bv - av;
  });
  vals.forEach((a, i) => (a.b20d_rank = i + 1));
  return vals;
}

export async function StatisticiKline(secid: string, klimit: number, lines?: Stock.KLineItem[]) {
  const ks = lines || ((await Services.Stock.GetKFromEastmoney(secid, Enums.KLineType.Day, klimit)).ks as Stock.KLineItem[]);
  if (!ks.length) {
    return {
      secid,
    } as Stock.KLineStatisticItem;
  }
  const wd = Utils.JudgeWorkDayTime(new Date().getTime());
  const r = { secid, zdf: ks[ks.length - 1].zdf } as Stock.KLineStatisticItem;
  const lastIndex = wd ? 1 : 0;
  const zgs = ks.map(({ zg }) => zg);
  const zds = ks.map(({ zd }) => zd);
  if (ks.length > 2) {
    r.b1d_zdf = ks[ks.length - lastIndex - 1].zdf;
    r.b1d_hsl = ks[ks.length - lastIndex - 1].hsl;
  }
  const findMaxZdf = (kss: Stock.KLineItem[]) => {
    let max = 0,
      maxi = 0;
    for (let i = 0; i < kss.length; i++) {
      if (max < kss[i].zg) {
        max = kss[i].zg;
        maxi = i;
      }
    }
    let min = 0;
    if (maxi == 0) {
      min = kss[0].zd;
    } else {
      min = Math.min(...kss.slice(0, maxi).map(({ zd }) => zd));
    }
    return ((max - min) / min) * 100;
  };
  if (ks.length > 3) {
    const kp = ks[ks.length - 3 - lastIndex].kp;
    const sp = ks[ks.length - 1 - lastIndex].sp;
    r.b3d_zdf = ((sp - kp) / kp) * 100;
    r.b3d_hsl = ks.slice(ks.length - 3 - lastIndex, ks.length - lastIndex).reduce((s, a) => s + a.hsl, 0) / 3;
  }
  if (ks.length > 5) {
    r.b5d_zdf = findMaxZdf(ks.slice(ks.length - 5 - lastIndex, ks.length - 1 - lastIndex));
    r.b5d_hsl = ks.slice(ks.length - lastIndex - 5, ks.length - lastIndex).reduce((s, a) => s + a.hsl, 0) / 5;
  }
  if (ks.length > 10) {
    r.b10d_zdf = findMaxZdf(ks.slice(ks.length - 10 - lastIndex, ks.length - 1 - lastIndex));
    r.b10d_hsl = ks.slice(ks.length - 10 - lastIndex, ks.length - lastIndex).reduce((s, a) => s + a.hsl, 0) / 10;
  }
  if (ks.length > 20) {
    r.b20d_zdf = findMaxZdf(ks.slice(ks.length - 20 - lastIndex, ks.length - 1 - lastIndex));
    r.b20d_hsl = ks.slice(ks.length - 20 - lastIndex, ks.length - lastIndex).reduce((s, a) => s + a.hsl, 0) / 20;
  }
  if (ks[ks.length - 1].zdf > 9.9) {
    let lb = 1;
    for (let i = ks.length - 2; i >= 0; i--) {
      if (ks[i].zdf > 9.9) {
        lb += 1;
      } else {
        break;
      }
    }
    r.lb = lb;
  } else {
    r.lb = 0;
  }
  let zdays_5d = 0;
  let zdays_10d = 0;
  let zt_5d = 0;
  let zt_10d = 0;
  for (let i = ks.length - 1; i >= 0; i--) {
    if (ks.length - i <= 5) {
      if (ks[i].zdf > 0) {
        zdays_5d += 1;
        if (ks[i].zdf > 9.9) {
          zt_5d += 1;
        }
      }
    }
    if (ks.length - i <= 10) {
      if (ks[i].zdf > 0) {
        zdays_10d += 1;
        if (ks[i].zdf > 9.9) {
          zt_10d += 1;
        }
      }
    } else {
      break;
    }
  }
  r.zdays_5d = zdays_5d;
  r.zdays_10d = zdays_10d;
  r.zt_5d = zt_5d;
  r.zt_10d = zt_10d;

  // 增加龙虎榜数据
  if (Helpers.Stock.GetStockType(secid) == Enums.StockMarketType.AB) {
    const lhbs = await Services.Stock.GetLongHuBang(secid.substring(2), 1);
    if (lhbs?.length) {
      r.lhb_date = lhbs[0].TRADE_DATE.substring(0, 10);
    }
  }

  return r;
}

/// 排序
export async function SortMultiKlines(secids: string[], type: Enums.KSortType, klimit = 100) {
  const collectors = secids.map((s) => () => AnalyzeKline(s, type, klimit));
  const vals = await Adapter.ConCurrencyAllAdapter(collectors);
  const r = {} as Record<string, any>;
  secids.forEach((s, i) => {
    r[s] = vals[i];
  });
  return r;
}

export async function AnalyzeKline(secid: string, type: Enums.KSortType, klimit: number) {
  const { ks } = await Services.Stock.GetKFromEastmoney(secid, Enums.KLineType.Day, klimit);
  if (!ks.length) {
    return Enums.KSortType.ZDSJ ? '1970-01-01' : -999;
  }
  if (type == Enums.KSortType.WRZF) {
    if (ks.length < 6) {
      return 0;
    }
    return (ks[ks.length - 1].sp - ks[ks.length - 6].kp) / ks[ks.length - 6].kp;
  } else {
    let zdk = ks[0];
    let zdi = 0;
    ks.forEach((k, i) => {
      if (k.zd < zdk.zd) {
        zdk = k;
        zdi = i;
      }
    });
    if (type == Enums.KSortType.ZDSJ) {
      return zdk.date;
    } else if (type == Enums.KSortType.FTGD) {
      let zgk = zdk;
      for (let i = zdi + 1; i < ks.length; i++) {
        if (ks[i].zg > zgk.zg) {
          zgk = ks[i];
        }
      }
      return (zgk.zg - zdk.kp) / zdk.kp;
    }
  }
}

/// 找到最近几天有涨停的
export async function FilterMultiKlines(secids: string[], types: Enums.KFilterType[], days: number) {
  const collectors = secids.map((s) => () => FilterKline(s, types, days));
  return Adapter.ConCurrencyAllAdapter(collectors);
}

export async function FilterKline(secid: string, types: Enums.KFilterType[], days: number, klimit = 100) {
  if (types.length == 1 && types[0] == Enums.KFilterType.NKCB) {
    if (secid.indexOf('1.688') == -1 ) {
      return secid;
    } else {
      return null;
    }
  }
  const { ks } = await Services.Stock.GetKFromEastmoney(secid, Enums.KLineType.Day, klimit);
  if (!ks.length) {
    return null;
  }
  let passed = true;
  if (ks.length > 10) {
    for (let i = 0; i < types.length; i++) {
      if (types[i] == Enums.KFilterType.ZJZT && !ZJZT(ks, days)) {
        passed = false;
      }
      if (types[i] == Enums.KFilterType.FLYX && !FLYX(ks, days, 4)) {
        passed = false;
      }
      if (types[i] == Enums.KFilterType.XYJC && !XYJC(ks, days, 6)) {
        passed = false;
      }
      if (types[i] == Enums.KFilterType.TPHP && !TPHP(ks, 3, 9)) {
        passed = false;
      }
      if (types[i] == Enums.KFilterType.FQFB && !FQFB(ks, days)) {
        passed = false;
      }
      if (types[i] == Enums.KFilterType.FYZS && !FYZS(ks)) {
        passed = false;
      }
      if (!passed) {
        break;
      }
    }
  } else {
    passed = false;
  }
  return passed ? secid : null;
}

function ZJZT(ks: Stock.KLineItem[], days: number) {
  for (let i = ks.length - 1; i >= ks.length - days; i--) {
    if (ks[i].zdf > 9.9) {
      return true;
    }
  }
  return false;
}

function FLYX(ks: Stock.KLineItem[], days: number, sdays: number, syxLength = 0.05, stLength = 0.02, cjbs = 1.1) {
  const lastK = ks[ks.length - 1];
  if (lastK.kp >= lastK.sp) {
    // 阴线/十字星
    return false;
  }
  const syx = (lastK.zg - lastK.sp) / lastK.sp;
  if (syx > syxLength) {
    // 上影线长度
    return false;
  }
  if (lastK.zdf / 100 < stLength) {
    // 实体长度
    return false;
  }
  if (ks[ks.length - 1].cjl < ks[ks.length - 2].cjl * cjbs) {
    // 成交量没有放大
    return false;
  }
  let maxVoli = ks.length - 1;
  let maxVol = ks[maxVoli].cjl;
  for (let i = ks.length - 1; i >= ks.length - days; i--) {
    if (ks[i].cjl > maxVol) {
      maxVol = ks[i].cjl;
      maxVoli = i;
      break;
    }
  }
  if (ks.length - maxVoli > sdays) {
    return false;
  }
  return true;
}

function XYJC(ks: Stock.KLineItem[], days: number, ydays: number) {
  let ds = 0;
  for (let i = ks.length - 1; i >= ks.length - days; i--) {
    if (ks[i].kp < ks[i].sp && ks[i].zdf > 0) {
      ds += 1;
    }
  }
  return ds >= ydays;
}

function TPHP(ks: Stock.KLineItem[], hmindays = 3, hmaxdays = 9) {
  let ztindex = -1;
  for (let i = ks.length - hmindays; i >= ks.length - hmaxdays - 1; i--) {
    if (ks[i].zdf > 9.9 && ks[i - 1].zdf < 9.9) {
      // 找涨停
      ztindex = i;
      break;
    }
  }
  if (ztindex == -1) {
    return false;
  }
  // 是否60日新高
  let h = 0;
  for (let j = ztindex - 1; j >= ztindex - 60 && j >= 0; j--) {
    if (h < ks[j].zg) {
      h = ks[j].zg;
    }
  }
  if (ks[ztindex].sp < h) {
    return false;
  }

  // 后续走势是否破了起涨点
  for (let k = ks.length - 1; k > ztindex; k--) {
    if (ks[k].zd < ks[ztindex].kp) {
      return false;
    }
  }

  // 并且最后没有创新高
  let rh = 0;
  for (let j = ks.length - 2; j > ztindex; j--) {
    if (rh < ks[j].zg) {
      rh = ks[j].zg;
    }
  }
  if (ks[ks.length - 1].sp > rh) {
    return false;
  }
  return true;
}

function FQFB(ks: Stock.KLineItem[], fdays = 3, stLength = 0.05, cjbs = 1.1) {
  let ztindex = -1;
  for (let i = ks.length - 2; i > ks.length - fdays; i--) {
    if (ks[i].zdf > 9.9) {
      // 找涨停
      ztindex = i;
      break;
    }
  }
  if (ztindex == -1 || ztindex == ks.length - 1) {
    return false;
  }
  // 次日是否为放量量小阳线（有分歧但是有承接，并且买方能量大于卖方能量）
  const nextk = ks[ztindex + 1];
  if (nextk.zdf > 0 && nextk.zdf / 100 > stLength) {
    // 实体长度不宜过大（过大说明当天入场筹码获利太高，容易多杀多）
    return false;
  }
  if (nextk.cjl < ks[ztindex].cjl * cjbs) {
    // 成交量要有放大（太小说明前一天的获利筹码置换没有充分交换出来）
    return false;
  }
  return true;
}

function FYZS(ks: Stock.KLineItem[], fdays = 20, rtimes = 2) {
  const sps = ks.map((k) => k.sp);
  const [ma20, ma40, ma60] = [Utils.calculateMA(20, sps), Utils.calculateMA(20, sps), Utils.calculateMA(20, sps)];
  // 均线没有粘合
  for (let i = ma20.length - 1; i > ma20.length - fdays; i--) {
    if (ma20[i] <= ma40[i] || ma40[i] <= ma60[i]) {
      return false;
    }
  }
  // 是否回踩均线
  let lasthki = -1;
  let ht = 0;
  for (let i = ma20.length - 1; i > ma20.length - fdays; i--) {
    if (ma20[i] * 1.01 >= ks[i].zd) {
      if (lasthki > 0 && Math.abs(lasthki - i) < 3) {
        continue;
      }
      ht += 1;
      lasthki = i;
    }
  }
  if (ht < rtimes) {
    return false;
  }
  return true;
}

export async function GetDeptTradeBacks(codes: string[]) {
  const collectors = codes.map((code) => {
    return () => Services.Stock.GetLHBReview(code);
  });
  return Adapter.ConCurrencyAllAdapter(collectors);
}

const QUANT_CACHE = {
  indexKlines: null as Stock.KLineItem[] | null,
  bks: null as Stock.BanKuaiItem[] | null,
  bkKlines: null as Stock.KLineItem[][] | null,
  bkSts: null as Record<string, Stock.DetailItem[]> | null,
  stKlines: null as Record<string, any[]> | null,
  bkFFlows: null as Record<string, Record<string, any[]>> | null,
};

export function QuantGetDetail(secid: string) {
  let d = QUANT_CACHE.bks?.find((_) => _.secid == secid);
  if (!d) {
    const keys = Object.keys(QUANT_CACHE.bkSts || {});
    for (let i = 0; i < keys.length; i++) {
      const sts = QUANT_CACHE.bkSts![keys[i]];
      d = sts.find((_) => _.secid == secid);
      if (d) {
        break;
      }
    }
  }
  return d;
}

export function QuantGetKline(secid: string) {
  let ks = QUANT_CACHE.stKlines ? QUANT_CACHE.stKlines[secid] : undefined;
  if (!ks) {
    ks = QUANT_CACHE.bkKlines?.find((_) => _[0].secid == secid);
  }
  if (!ks) {
    ks = [];
  }
  return ks;
}

export function QuantSetKlines(ks: Stock.KLineItem[]) {
  if (ks.length == 0) {
    return;
  }
  const stKlines: Record<string, any[]> = QUANT_CACHE.stKlines || {};
  stKlines[ks[0].secid] = ks;
  QUANT_CACHE.stKlines = stKlines;
}
export async function QuantBKAnalyze(
  fromDate: moment.Moment,
  endDate: moment.Moment,
  bkType: Enums.BKType,
  onMessage: (message: string) => void,
  kCount = 350
) {
  onMessage('获取上证指数历史K线');
  const indexKlines = QUANT_CACHE.indexKlines || (await Services.Stock.GetKFromEastmoney('1.000001', Enums.KLineType.Day, kCount)).ks;
  const tradeDays = indexKlines.map((_) => moment(_.date, 'YYYY-MM-DD'));
  const indexMA5 = Utils.calculateMA(
    5,
    indexKlines.map((_) => _.sp)
  );
  let fromIndex = 0,
    endIndex = 0;
  for (let i = 0; i < tradeDays.length; i++) {
    const d = tradeDays[i];
    if (d.isSame(fromDate, 'day')) {
      fromIndex = i;
    } else if (d.isSame(endDate, 'day')) {
      endIndex = i;
      break;
    }
    if (i > 0) {
      if (!fromIndex && tradeDays[i - 1].isBefore(fromDate, 'day') && tradeDays[i].isAfter(fromDate, 'day')) {
        fromIndex = i;
      }
      if (!endIndex && tradeDays[i - 1].isBefore(endDate, 'day') && tradeDays[i].isAfter(endDate, 'day')) {
        endIndex = i - 1;
        break;
      }
    }
  }
  if (!fromIndex) {
    onMessage('开始日期超过允许范围！');
    return;
  }
  if (!endIndex) {
    endIndex = tradeDays.length - 1;
  }
  onMessage('获取所有板块信息: ' + bkType);
  const bks =
    QUANT_CACHE.bks ||
    (await Services.Stock.GetBanKuais(bkType, 500)).arr!.filter((_) => _.name.indexOf('连板') == -1 && _.name.indexOf('涨停') == -1);
  onMessage('获取所有板块历史k线');
  const collectors = bks?.map((bk) => () => Services.Stock.GetKFromEastmoney(bk.secid, Enums.KLineType.Day, kCount));
  const bkKlines = QUANT_CACHE.bkKlines || (await Adapter.ConCurrencyAllAdapter(collectors)).map((_) => _?.ks);
  const allbkStats: Record<string, Stock.KLineStatisticItem[]> = {};
  for (let i = fromIndex; i <= endIndex; i++) {
    onMessage('统计板块换手情况');
    const bkstats: Stock.KLineStatisticItem[] = [];
    const daystr = tradeDays[i].format('YYYY-MM-DD');
    for (let j = 0; j < bkKlines.length; j++) {
      const ks = bkKlines[j]! as Stock.KLineItem[];
      if (ks[0].date > daystr) {
        // 超过范围
        continue;
      }
      let endIdx = 0;
      for (let k = 0; k < ks.length; k++) {
        if (ks[k].date == daystr) {
          endIdx = k;
          break;
        }
      }
      const bk = bks.find((_) => _.secid == ks[0].secid)!;
      const s = await StatisticiKline(ks[0].secid, 0, ks.slice(0, endIdx + 1));
      s.name = bk.name;
      s.lt = bk.zsz;
      bkstats.push(s);
    }
    // 找到人气板块
    bkstats.sort((a, b) => {
      const av = a.b1d_zdf || 0;
      const bv = b.b1d_zdf || 0;
      return bv - av;
    });
    bkstats.forEach((a, i) => (a.b1d_rank = i + 1));
    bkstats.sort((a, b) => {
      const av = a.b3d_zdf || 0;
      const bv = b.b3d_zdf || 0;
      return bv - av;
    });
    bkstats.forEach((a, i) => (a.b3d_rank = i + 1));
    bkstats.sort((a, b) => {
      const av = a.b5d_zdf || 0;
      const bv = b.b5d_zdf || 0;
      return bv - av;
    });
    bkstats.forEach((a, i) => (a.b5d_rank = i + 1));
    bkstats.sort((a, b) => {
      const av = a.b10d_zdf || 0;
      const bv = b.b10d_zdf || 0;
      return bv - av;
    });
    bkstats.forEach((a, i) => (a.b10d_rank = i + 1));
    allbkStats[daystr] = bkstats;
  }
  QUANT_CACHE.bks = bks;
  QUANT_CACHE.bkKlines = bkKlines;
  onMessage('板块分析完成');
  return allbkStats;
}
export async function QuantAllStsAnalyze(tilDate: string, onMessage: (message: string) => void, kCount = 350) {
  const bks = QUANT_CACHE.bks || [];
  const sts = [];
  const bkSts: Record<string, any[]> = QUANT_CACHE.bkSts || {};
  const stKlines: Record<string, any[]> = QUANT_CACHE.stKlines || {};
  const ststats: Stock.KLineStatisticItem[] = [];
  for (let i = 0; i < bks.length; i++) {
    const bksecid = bks[i].secid;
    onMessage('获取板块所有股票信息 ' + bks[i].name);
    bkSts[bksecid] = (await Services.Stock.GetBankuaiStocksFromEastmoney(bksecid, 50)).stocks;
    onMessage('获取板块所有股票信息完毕 ' + bks[i].name);
    QUANT_CACHE.bkSts = bkSts;
    async function getKlines(s: string, t: number, c: number) {
      return Services.Stock.GetKFromEastmoney(s, t, c);
    }
    onMessage('获取板块所有股票K线信息 ' + bks[i].name);
    const collectors = bkSts[bksecid].map((st) => () => getKlines(st.secid, Enums.KLineType.Day, kCount));
    const data = await Adapter.ConCurrencyAllAdapter(collectors, 500);
    data.forEach((d) => {
      if (d?.ks && d.ks.length > 0) stKlines[d.ks[0].secid] = d.ks;
    });
    onMessage('获取板块所有股票K线信息完毕 ' + bks[i].name);
    QUANT_CACHE.stKlines = stKlines;
    onMessage('分析板块所有股票k线统计信息 ' + bks[i].name);
    const sts = bkSts[bksecid].filter((_) => _.name.indexOf('ST') == -1 && _.secid.indexOf('688') == -1);
    for (let k = 0; k < sts.length; k++) {
      const ssecid = sts[k].secid;
      if (!stKlines[ssecid] || !stKlines[ssecid].length) {
        continue;
      }
      const ks = stKlines[ssecid];
      if (!ks || ks.length == 0 || ks[0].date > tilDate) {
        continue;
      }
      let endIdx = 0;
      for (let k = 0; k < ks.length; k++) {
        if (ks[k].date == tilDate) {
          endIdx = k;
          break;
        }
      }
      const s = await StatisticiKline(ssecid, 0, stKlines[ssecid].slice(0, endIdx + 1));
      if (s.b20d_zdf > 0) {
        s.name = sts[k].name;
        s.bkname = bks[i].name;
        s.bksecid = bksecid;
        s.lt = sts[k].lt;
        ststats.push(s);
      }
    }
    onMessage('分析板块所有股票k线统计信息完毕 ' + bks[i].name);
  }
  // 找到人气龙头
  ststats.sort((a, b) => {
    const av = a.b1d_zdf || 0;
    const bv = b.b1d_zdf || 0;
    return bv - av;
  });
  ststats.forEach((a, i) => (a.b1d_rank = i + 1));
  ststats.sort((a, b) => {
    const av = a.b3d_zdf || 0;
    const bv = b.b3d_zdf || 0;
    return bv - av;
  });
  ststats.forEach((a, i) => (a.b3d_rank = i + 1));
  ststats.sort((a, b) => {
    const av = a.b5d_zdf || 0;
    const bv = b.b5d_zdf || 0;
    return bv - av;
  });
  ststats.forEach((a, i) => (a.b5d_rank = i + 1));
  ststats.sort((a, b) => {
    const av = a.b10d_zdf || 0;
    const bv = b.b10d_zdf || 0;
    return bv - av;
  });
  ststats.forEach((a, i) => (a.b10d_rank = i + 1));
  ststats.sort((a, b) => {
    const av = a.b20d_zdf || 0;
    const bv = b.b20d_zdf || 0;
    return bv - av;
  });
  ststats.forEach((a, i) => (a.b20d_rank = i + 1));
  onMessage('个股分析完成');
  return ststats;
}
export async function QuantStsAnalyze(bksecid: string, tilDate: string, onMessage: (message: string) => void, kCount = 350) {
  const bks = QUANT_CACHE.bks || [];
  const bk = bks.find((_) => _.secid == bksecid);
  const bkSts: Record<string, any[]> = QUANT_CACHE.bkSts || {};
  const stKlines: Record<string, any[]> = QUANT_CACHE.stKlines || {};
  if (!bkSts[bksecid]) {
    onMessage('获取板块所有股票信息');
    bkSts[bksecid] = (await Services.Stock.GetBankuaiStocksFromEastmoney(bksecid, 50)).stocks;
  }
  const ststats: Stock.KLineStatisticItem[] = [];
  const sts = bkSts[bksecid].filter((_) => _.name.indexOf('ST') == -1 && _.secid.indexOf('688') == -1);
  for (let k = 0; k < sts.length; k++) {
    const ssecid = sts[k].secid;
    if (!stKlines[ssecid] || !stKlines[ssecid].length) {
      onMessage('获取股票历史k线: ' + ssecid);
      stKlines[ssecid] = (await Services.Stock.GetKFromEastmoney(ssecid, Enums.KLineType.Day, kCount)).ks;
    }
    const ks = stKlines[ssecid];
    if (!ks || ks.length == 0 || ks[0].date > tilDate) {
      continue;
    }
    let endIdx = 0;
    for (let k = 0; k < ks.length; k++) {
      if (ks[k].date == tilDate) {
        endIdx = k;
        break;
      }
    }
    const s = await StatisticiKline(ssecid, 0, stKlines[ssecid].slice(0, endIdx + 1));
    s.name = sts[k].name;
    s.bksecid = bksecid;
    s.bkname = bk?.name || '';
    s.lt = sts[k].lt;
    ststats.push(s);
  }
  // 找到人气龙头
  ststats.sort((a, b) => {
    const av = a.b1d_zdf || 0;
    const bv = b.b1d_zdf || 0;
    return bv - av;
  });
  ststats.forEach((a, i) => (a.b1d_rank = i + 1));
  ststats.sort((a, b) => {
    const av = a.b3d_zdf || 0;
    const bv = b.b3d_zdf || 0;
    return bv - av;
  });
  ststats.forEach((a, i) => (a.b3d_rank = i + 1));
  ststats.sort((a, b) => {
    const av = a.b5d_zdf || 0;
    const bv = b.b5d_zdf || 0;
    return bv - av;
  });
  ststats.forEach((a, i) => (a.b5d_rank = i + 1));
  ststats.sort((a, b) => {
    const av = a.b10d_zdf || 0;
    const bv = b.b10d_zdf || 0;
    return bv - av;
  });
  ststats.forEach((a, i) => (a.b10d_rank = i + 1));
  ststats.sort((a, b) => {
    const av = a.b20d_zdf || 0;
    const bv = b.b20d_zdf || 0;
    return bv - av;
  });
  ststats.forEach((a, i) => (a.b20d_rank = i + 1));
  QUANT_CACHE.bkSts = bkSts;
  QUANT_CACHE.stKlines = stKlines;
  onMessage('个股分析完成');
  return ststats;
}

export async function GenerateTrainData(
  bkAccessToken: string,
  fromDate: moment.Moment,
  endDate: moment.Moment,
  bkType: Enums.BKType,
  onMessage: (message: string) => void,
  kCount = 350
) {
  // 考虑数据结构：
  // 板块换手增速，板块排名(10, 5, 3, 1)，个股上涨天数(10,5)，个股排名，30分钟分时数据，30分钟资金流数据
  // 输出结果：涨/跌
  // 获取板块统计信息
  const bkstats = await QuantBKAnalyze(fromDate, endDate, bkType, onMessage, kCount);
  if (!bkstats) {
    onMessage('无法获取板块统计信息');
    return;
  }
  let data: Record<string, any>[] = [];
  const days = Object.keys(bkstats);
  for (let i = 0; i < days.length - 1; i++) {
    const tilDate = days[i];
    const nexDate = days[i + 1];
    onMessage('开始分析交易日：' + tilDate);
    for (let j = 0; j < bkstats[tilDate].length; j++) {
      const bkstat = bkstats[tilDate][j];
      onMessage('开始分析板块：' + bkstat.secid);
      const ststats = await QuantStsAnalyze(bkstat.secid, tilDate, onMessage, kCount);
      if (!ststats.length) {
        continue;
      }
      // 组装数据
      for (let k = 0; k < ststats.length; k++) {
        const ststat = ststats[k];
        onMessage('开始分析个股：' + ststat.secid);
        if (
          !ststat.secid.startsWith('1.6') && // B股
          !ststat.secid.startsWith('0.0') && // B股
          !ststat.secid.startsWith('0.3')
        ) {
          onMessage('个股不符合要求');
          continue;
        }
        const ks = (QUANT_CACHE.stKlines || {})[ststat.secid];
        if (!ks) {
          onMessage('未找到个股k线数据：' + ststat.secid);
          continue;
        }
        // 找到结果
        let res = 0;
        for (let n = ks.length - 2; n >= 0; n--) {
          if (ks[n].date.indexOf(nexDate) != -1) {
            res = ks[n + 1].zdf > 0 ? 1 : 0;
          }
        }
        // 获取分时数据
        onMessage('开始获取分时数据：' + ststat.secid);
        const trends = await Services.Stock.requestDealDay(ststat.secid, nexDate);
        if (!trends || trends.length < 240) {
          onMessage('无法获取个股分时数据：' + ststat.secid);
          continue;
        }
        // 获取资金流数据
        onMessage('开始获取资金流数据：' + ststat.secid);
        const flows = (await downloadStockFFlows(bkAccessToken, ststat.secid, nexDate, onMessage)) as Record<string, any>[];
        if (!flows.length) {
          onMessage('无法获取个股资金流数据：' + ststat.secid);
          continue;
        }
        const r = {
          secid: ststat.secid,
          res,
          bk_b1d_hsl_zs: (bkstat.b1d_hsl - bkstat.b3d_hsl) / bkstat.b3d_hsl,
          bk_b3d_hsl_zs: (bkstat.b3d_hsl - bkstat.b5d_hsl) / bkstat.b5d_hsl,
          bk_b5d_hsl_zs: (bkstat.b5d_hsl - bkstat.b10d_hsl) / bkstat.b10d_hsl,
          bk_zdays_5d: bkstat.zdays_5d,
          bk_zdays_10d: bkstat.zdays_10d,
          bk_b1d_rank: bkstat.b1d_rank,
          bk_b3d_rank: bkstat.b3d_rank,
          bk_b5d_rank: bkstat.b5d_rank,
          bk_b10d_rank: bkstat.b10d_rank,
          b1d_hsl_zs: (ststat.b1d_hsl - ststat.b3d_hsl) / ststat.b3d_hsl,
          b3d_hsl_zs: (ststat.b3d_hsl - ststat.b5d_hsl) / ststat.b5d_hsl,
          b5d_hsl_zs: (ststat.b5d_hsl - ststat.b10d_hsl) / ststat.b10d_hsl,
          zdays_5d: ststat.zdays_5d,
          zdays_10d: ststat.zdays_10d,
          b1d_rank: ststat.b1d_rank,
          b3d_rank: ststat.b3d_rank,
          b5d_rank: ststat.b5d_rank,
          b10d_rank: ststat.b10d_rank,
        } as Record<string, any>;
        // 只保留分钟
        const minttrends = trends.filter(
          (t, i) => i == trends.length - 1 || trends[i + 1].datetime.substring(3, 5) != trends[i].datetime.substring(3, 5)
        );
        for (let n = 1; n <= 30; n++) {
          if (!minttrends[n]) {
            console.log('error happened!');
          }
          const changes = (minttrends[n].current - minttrends[0].current) / minttrends[0].current;
          r[`trends_${n}`] = changes;
        }
        // 资金流
        for (let n = 1; n <= 30; n++) {
          const d = flows[n];
          let ssum = 1;
          let bsum = 1;
          ['small', 'medium', 'big', 'superbig'].forEach((t) => {
            if (d[t] < 0) {
              ssum += Math.abs(d[t]);
            } else {
              bsum += Math.abs(d[t]);
            }
          });
          ['small', 'medium', 'big', 'superbig'].forEach((t) => (r[`flows_${t}_${n}`] = d[t] / (d[t] < 0 ? ssum : bsum)));
        }
        onMessage('个股数据收集完毕：' + ststat.secid);
        data.push(r);
      }
    }
    if (data.length > 0) {
      const header = Object.keys(data[0]);
      let csv = header.join(',') + '\r\n';
      data.forEach((r) => {
        csv += Object.values(r).join(',') + '\r\n';
      });
      const fileName = `data_${tilDate}.csv`;
      const filePath = await saveString(fileName, csv);
      onMessage('数据保存成功：' + filePath);
    }
    data = [];
  }
  // 上传到百度云盘?
  if (false) {
    const dir = '/apps/股事/qtest';
    const res = (await Services.Baidu.uploadFile(bkAccessToken, dir, fileName, csv)) as Record<string, any>;
    if (res.res3) {
      // 走到了第三步
      if (res.res3.errno != 0) {
        onMessage(Enums.BaiduErrors[res.res3.errno.toString()]);
      } else {
        onMessage(`训练数据生成成功:${dir}/${fileName}`);
      }
    } else if (res.res2) {
      // 走到了第二步
      if (res.res2.errno != 0) {
        onMessage(Enums.BaiduErrors[res.res2.errno.toString()]);
      }
    } else if (res.res1) {
      if (res.res1.errno != 0) {
        onMessage(Enums.BaiduErrors[res.res1.errno.toString()]);
      }
    }
  }
}

export async function TestQuantStrategy(
  fromDate: moment.Moment,
  endDate: moment.Moment,
  bkType: Enums.BKType,
  bkCount: number,
  stCount: number,
  maxHolds: number,
  onProgress: (actions: Stock.QuantActionItem[]) => void,
  onMessage: (message: string) => void,
  onFinished: () => void,
  kCount = 350
) {
  onMessage('获取上证指数历史K线');
  const indexKlines = QUANT_CACHE.indexKlines || (await Services.Stock.GetKFromEastmoney('1.000001', Enums.KLineType.Day, kCount)).ks;
  const tradeDays = indexKlines.map((_) => moment(_.date, 'YYYY-MM-DD'));
  const indexMA5 = Utils.calculateMA(
    5,
    indexKlines.map((_) => _.sp)
  );
  let fromIndex = 0,
    endIndex = 0;
  for (let i = 0; i < tradeDays.length; i++) {
    const d = tradeDays[i];
    if (d.isSame(fromDate, 'day')) {
      fromIndex = i;
    } else if (d.isSame(endDate, 'day')) {
      endIndex = i;
      break;
    }
    if (i > 0) {
      if (!fromIndex && tradeDays[i - 1].isBefore(fromDate, 'day') && tradeDays[i].isAfter(fromDate, 'day')) {
        fromIndex = i;
      }
      if (!endIndex && tradeDays[i - 1].isBefore(endDate, 'day') && tradeDays[i].isAfter(endDate, 'day')) {
        endIndex = i - 1;
        break;
      }
    }
  }
  if (!fromIndex) {
    onMessage('开始日期超过允许范围！');
    return;
  }
  if (!endIndex) {
    endIndex = tradeDays.length - 1;
  }
  onMessage('获取所有板块信息: ' + bkType);
  const bks =
    QUANT_CACHE.bks ||
    (await Services.Stock.GetBanKuais(bkType, 100)).arr!.filter((_) => _.name.indexOf('连板') == -1 && _.name.indexOf('涨停') == -1);
  onMessage('获取所有板块历史k线');
  const collectors = bks?.map((bk) => () => Services.Stock.GetKFromEastmoney(bk.secid, Enums.KLineType.Day, kCount));
  const bkKlines = QUANT_CACHE.bkKlines || (await Adapter.ConCurrencyAllAdapter(collectors)).map((_) => _?.ks);
  onMessage('开始执行策略');
  const tdays = [];
  const winRates = [];
  const netValues = [];
  const actions = [];
  const bkSts: Record<string, any[]> = QUANT_CACHE.bkSts || {};
  const stKlines: Record<string, any[]> = QUANT_CACHE.stKlines || {};
  for (let i = fromIndex; i <= endIndex; i++) {
    tdays.push(tradeDays[i]);
    if (i == fromIndex) {
      winRates.push(0);
      netValues.push(1);
    }
    const indexBear = indexMA5[i] > indexKlines[i].sp; // 5日线下方是熊
    const action = { day: tradeDays[i], choosenBks: [], choosenSts: [], makeBuys: [], makeSells: [] } as unknown as Stock.QuantActionItem;
    onMessage('统计板块换手情况');
    let bkstats: Stock.KLineStatisticItem[] = [];
    const daystr = tradeDays[i].format('YYYY-MM-DD');
    for (let j = 0; j < bkKlines.length; j++) {
      const ks = bkKlines[j]! as Stock.KLineItem[];
      if (ks[0].date > daystr) {
        // 超过范围
        continue;
      }
      let endIdx = 0;
      for (let k = 0; k < ks.length; k++) {
        if (ks[k].date == daystr) {
          endIdx = k;
          break;
        }
      }
      const bk = bks.find((_) => _.secid == ks[0].secid)!;
      const s = await StatisticiKline(ks[0].secid, 0, ks.slice(0, endIdx + 1));
      s.name = bk.name;
      s.lt = bk.zsz;
      bkstats.push(s);
    }
    // 找到人气板块
    bkstats.sort((a, b) => {
      const av = a.b1d_zdf || 0;
      const bv = b.b1d_zdf || 0;
      return bv - av;
    });
    bkstats.forEach((a, i) => (a.b1d_rank = i + 1));
    bkstats.sort((a, b) => {
      const av = a.b3d_zdf || 0;
      const bv = b.b3d_zdf || 0;
      return bv - av;
    });
    bkstats.forEach((a, i) => (a.b3d_rank = i + 1));
    bkstats.sort((a, b) => {
      const av = a.b5d_zdf || 0;
      const bv = b.b5d_zdf || 0;
      return bv - av;
    });
    bkstats.forEach((a, i) => (a.b5d_rank = i + 1));
    bkstats.sort((a, b) => {
      const av = a.b10d_zdf || 0;
      const bv = b.b10d_zdf || 0;
      return bv - av;
    });
    bkstats.forEach((a, i) => (a.b10d_rank = i + 1));
    action.bkstats = bkstats;
    bkstats = bkstats.filter((bs) => bs.b1d_rank <= 3 || bs.b3d_rank <= 3 || bs.b5d_rank <= 3 || bs.b10d_rank <= 3);
    bkstats = bkstats.filter((bs) => bs.zdays_5d >= 3 || bs.zdays_10d >= 5);
    bkstats = bkstats.filter((bs) => bs.b3d_hsl > bs.b10d_hsl);
    bkstats.sort((a, b) => b.b3d_hsl - b.b10d_hsl - (a.b3d_hsl - a.b10d_hsl));
    const choosenBkSecids = bkstats
      // .filter((s) => s.b1d_hsl > s.b3d_hsl /*&& s.b3d_hsl > s.b10d_hsl*/)
      .map((_) => _.secid)
      .slice(0, bkCount);
    action.choosenBks = choosenBkSecids.map((s) => bks.find((b) => b.secid == s)).filter(Utils.NotEmpty);
    onMessage('选中板块: ' + action.choosenBks.map((_) => _?.name).join(','));
    const dealDay = tradeDays[i].format('YYYYMMDD');
    const prevAction = actions.length > 0 ? actions[actions.length - 1] : null;
    if (prevAction) {
      // 更新相关信息
      action.holds = [...prevAction.holds];
      action.wins = prevAction.wins;
      action.loss = prevAction.loss;
      action.availableMoney = prevAction.availableMoney;
      action.totalProfit = prevAction.totalProfit;
    } else {
      action.holds = [];
      action.wins = 0;
      action.loss = 0;
      action.availableMoney = 100000;
      action.totalProfit = 0;
    }
    onMessage(`更新${tradeDays[i].format('YYYY-MM-DD')}候选标的`);
    for (let j = 0; j < action.choosenBks.length; j++) {
      const bk = action.choosenBks[j];
      const bsecid = bk.secid;
      if (!bkSts[bsecid]) {
        onMessage('获取板块所有股票信息');
        bkSts[bsecid] = (await Services.Stock.GetBankuaiStocksFromEastmoney(bsecid, 50)).stocks;
      }
      let ststats: Stock.KLineStatisticItem[] = [];
      const sts = bkSts[bsecid].filter((_) => _.name.indexOf('ST') == -1 && _.secid.indexOf('688') == -1);
      for (let k = 0; k < sts.length; k++) {
        const ssecid = sts[k].secid;
        if (!stKlines[ssecid] || !stKlines[ssecid].length) {
          onMessage('获取股票历史k线: ' + ssecid);
          stKlines[ssecid] = (await Services.Stock.GetKFromEastmoney(ssecid, Enums.KLineType.Day, kCount)).ks;
        }
        const ks = stKlines[ssecid];
        if (ks[0].date > daystr) {
          // 超过范围
          continue;
        }
        let endIdx = 0;
        for (let k = 0; k < ks.length; k++) {
          if (ks[k].date == daystr) {
            endIdx = k;
            break;
          }
        }
        const s = await StatisticiKline(ssecid, 0, stKlines[ssecid].slice(0, endIdx + 1));
        s.name = sts[k].name;
        s.lt = sts[k].lt;
        ststats.push(s);
      }
      // 找到人气龙头
      ststats.sort((a, b) => {
        const av = a.b1d_zdf || 0;
        const bv = b.b1d_zdf || 0;
        return bv - av;
      });
      ststats.forEach((a, i) => (a.b1d_rank = i + 1));
      ststats.sort((a, b) => {
        const av = a.b3d_zdf || 0;
        const bv = b.b3d_zdf || 0;
        return bv - av;
      });
      ststats.forEach((a, i) => (a.b3d_rank = i + 1));
      ststats.sort((a, b) => {
        const av = a.b5d_zdf || 0;
        const bv = b.b5d_zdf || 0;
        return bv - av;
      });
      ststats.forEach((a, i) => (a.b5d_rank = i + 1));
      ststats.sort((a, b) => {
        const av = a.b10d_zdf || 0;
        const bv = b.b10d_zdf || 0;
        return bv - av;
      });
      ststats.forEach((a, i) => (a.b10d_rank = i + 1));
      if (action.ststats) {
        action.ststats[bsecid] = ststats;
      } else {
        action.ststats = { [bsecid]: ststats };
      }
      ststats = ststats.filter(
        (st) => st.zt_5d > 0 && st.b3d_zdf > 0 && (st.b1d_rank <= 3 || st.b3d_rank <= 3 || st.b5d_rank <= 3 || st.b10d_rank <= 3)
      );
      ststats.sort((a, b) => b.b3d_hsl - b.b10d_hsl - (a.b3d_hsl - a.b10d_hsl));
      const choosenSTSecids = ststats.map((_) => _.secid).slice(0, stCount);
      if (!choosenSTSecids.length) {
        // 没有符合条件的标的
        onMessage('版块[' + bk.name + ']没有符合成交量放大标的！');
      } else {
        const choosenSts = choosenSTSecids.map((s) => bkSts[bsecid].find((st) => st.secid == s));
        if (action.choosenSts) {
          choosenSts.forEach((st) => {
            if (!action.choosenSts.find((_) => _.secid == st.secid)) {
              action.choosenSts.push(st);
            }
          });
        } else {
          action.choosenSts = choosenSts;
        }
      }
    }
    const choosenTrends: Record<string, Stock.TrendItem[]> = {};
    onMessage(`决定是否买入昨日候选标的`);
    if (
      action.holds.length < maxHolds && // 还可以买入
      prevAction?.choosenSts.length // 有候选标的
    ) {
      const sts = prevAction.choosenSts;
      if (!sts.length) {
        onMessage(`昨日${prevAction.day.format('YYYY-MM-DD')}没有候选标的`);
      } else {
        for (let k = 0; k < sts.length; k++) {
          const ssecid = sts[k].secid;
          const trends = await Services.Stock.requestDealDay(ssecid, dealDay);
          if (trends.length) {
            // 按分钟来取(EastMoney是按分钟定)
            const mints = [trends[0]];
            for (let n = 1; n < trends.length - 1; n++) {
              const m1 = trends[n].datetime.substring(3, 5);
              const m2 = trends[n + 1].datetime.substring(3, 5);
              if (m1 != m2) {
                mints.push(trends[n]);
              }
            }
            mints.push(trends[trends.length - 1]);
            choosenTrends[ssecid] = mints;
          }
        }
        // 低开
        const lowOpens = Object.entries(choosenTrends).filter(([_, trends]) => trends[0].current < trends[0].last * 0.99);
        // 5分钟没有跌破开盘价，按照幅度排序
        const goingUps = lowOpens
          .filter(([sid, trends]) => Math.min(...trends.slice(1, 6).map((_) => _.current)) > trends[0].current)
          .map(([_, trends]) => [_, (Math.max(...trends.slice(1, 6).map((_) => _.current)) - trends[0].current) / trends[0].current]);
        if (!goingUps.length) {
          onMessage(`昨日${prevAction.day.format('YYYY - MM - DD')}没有符合低开高走标的！`);
        } else {
          // 排序
          goingUps.sort((a, b) => b[1] - a[1]);
          let idx = 0;
          let availableMoney = action.availableMoney;
          while (action.holds.length < maxHolds && idx < goingUps.length) {
            // 执行买入
            const ssecid = goingUps[idx++][0];
            const st = sts.find((_) => _.secid == ssecid);
            const price = choosenTrends[ssecid][6].current;
            const money = availableMoney / (maxHolds - action.holds.length);
            const amount = Math.floor(money / price / 100) * 100;
            if (amount <= 0) {
              // 买不起
              continue;
            }
            availableMoney -= amount * price;
            const buy = {
              secid: ssecid,
              name: st?.name,
              price,
              amount,
            };
            if (action.makeBuys) {
              action.makeBuys.push(buy);
            } else {
              action.makeBuys = [buy];
            }
            const hold = {
              secid: ssecid,
              name: st?.name,
              price,
              amount,
              profit: 0,
              day: tradeDays[i],
            };
            if (action.holds) {
              action.holds.push(hold);
            } else {
              action.holds = [hold];
            }
          }
          action.availableMoney = availableMoney;
        }
      }
    }

    onMessage(`决定是否卖出持有标的`);
    if (action.holds.length) {
      // 获取持有标的分时
      for (let k = 0; k < action.holds.length; k++) {
        const ssecid = action.holds[k].secid;
        if (!choosenTrends[ssecid]) {
          const trends = await Services.Stock.requestDealDay(ssecid, dealDay);
          choosenTrends[ssecid] = trends;
          // 进行超大、大户、中户、散户分析
          const total = 0;
          const flows = [];
          trends.forEach((item, i) => {
            const am = item.vol * item.current;
            if (item.vol >= 500000 || am >= 1000000) {
              flows.push([-1]);
            }
          });
        }
      }
      // 检查卖出
      const doSell = (act: Stock.QuantActionItem, id: string, at: number) => {
        const h = act.holds.find((_) => _.secid == id);
        if (!h) {
          return;
        }
        onMessage('卖出: ' + h.name + ', 价格: ' + at);
        const sell = {
          secid: id,
          name: h.name,
          price: at,
          profit: at / h.price - 1,
        };
        if (act.makeSells) {
          act.makeSells.push(sell);
        } else {
          act.makeSells = [sell];
        }
        // 更新战绩
        if (sell.profit > 0) {
          act.wins += 1;
        } else {
          act.loss += 1;
        }
        act.totalProfit += sell.profit;
        // 回收资金
        const freeMoney = h.amount * at;
        act.availableMoney += freeMoney;
        // 更新持仓
        act.holds = act.holds.filter((_) => _ !== h);
      };
      const updateProfit = (h: any, sid: string) => {
        h.profit = choosenTrends[sid].slice(-1)[0].current / h.price - 1;
      };
      for (let k = 0; k < action.holds.length; k++) {
        const ssecid = action.holds[k].secid;
        if (action.holds[k].day.isSame(tradeDays[i], 'day')) {
          // 当天买入，第二天才能卖出
          updateProfit(action.holds[k], ssecid);
          continue;
        }
        if (!choosenTrends[ssecid]) {
          const trends = await Services.Stock.requestDealDay(ssecid, dealDay);
          choosenTrends[ssecid] = trends;
        }

        let willSell = false;
        for (let n = 1; n < choosenTrends[ssecid].length; n++) {
          if (choosenTrends[ssecid][n].current <= action.holds[k].price) {
            // 不亏钱最重要
            willSell = true;
          }
          if (!willSell) {
            // 天线宝宝卖出
            if (n > 10) {
              const vals = choosenTrends[ssecid].slice(n - 5, n + 1).map((_) => _.current);
              const kp = choosenTrends[ssecid][n - 5].current;
              const sp = choosenTrends[ssecid][n].current;
              const zg = Math.max(...vals);
              const zd = Math.min(...vals);
              const r = (zg - Math.max(kp, sp)) / (Math.max(kp, sp) - Math.min(kp, sp));
              willSell = r >= 0.49;
            }
          }
          if (willSell) {
            const sellPrice =
              n + 1 < choosenTrends[ssecid].length ? choosenTrends[ssecid][n + 1].current : choosenTrends[ssecid][n].current;
            doSell(action, ssecid, sellPrice);
            k--;
            break;
          }
        }

        if (!willSell) {
          // 更新收益
          updateProfit(action.holds[k], ssecid);
        }
      }
      if (action.holds.length == maxHolds) {
        // 必须要留出一份资金以便第二日买入
        const availableHolds = action.holds.filter((h) => !h.day.isSame(tradeDays[i], 'day'));
        if (availableHolds.length) {
          availableHolds.sort((a, b) => a.profit - b.profit);
          const sellPrice = choosenTrends[availableHolds[0].secid].slice(-1)[0].current;
          doSell(action, availableHolds[0].secid, sellPrice);
        }
      }
    }

    onMessage(`${tradeDays[i].format('YYYY-MM-DD')}交易日策略执行完毕`);
    actions.push(action);
    onProgress(actions);
  }
  onFinished();

  // 更新缓存
  QUANT_CACHE.indexKlines = indexKlines;
  QUANT_CACHE.bks = bks;
  QUANT_CACHE.bkKlines = bkKlines;
  QUANT_CACHE.bkSts = bkSts;
  QUANT_CACHE.stKlines = stKlines;
}

export async function downloadStockFFlows(accessToken: string, stsecid: string, day: string, onMessage: (msg: string) => void) {
  const bks = QUANT_CACHE.bks || (await Services.Stock.GetBanKuais(Enums.BKType.Industry, 100)).arr!;
  const bkSts: Record<string, any[]> = QUANT_CACHE.bkSts || {};
  let bk = undefined;
  for (let i = 0; i < bks.length; i++) {
    const bksecid = bks[i].secid;
    if (!bkSts[bksecid]) {
      bkSts[bksecid] = (await Services.Stock.GetBankuaiStocksFromEastmoney(bksecid, 100)).stocks;
    }
    if (bkSts[bksecid].find((_) => _.secid == stsecid)) {
      bk = bks[i];
      break;
    }
  }
  QUANT_CACHE.bks = bks;
  QUANT_CACHE.bkSts = bkSts;
  if (!bk) {
    onMessage('无法找到所属板块：' + stsecid);
    return [];
  }

  const bkFFlows: Record<string, Record<string, any[]>> = QUANT_CACHE.bkFFlows || {};
  const key = `${bk.secid}_${day}`;
  if (!bkFFlows[key]) {
    const fileName = `${bk.secid}.fflows.${day}.json`;
    const dir = `/apps/股事/fflows/${bk.secid}`;
    const res1 = await Services.Baidu.getFileList(accessToken, dir);
    if (!res1) {
      onMessage('尝试获取baidu文件列表失败：' + bk.secid);
      return [];
    }
    if (res1.errno != 0) {
      onMessage(Enums.BaiduErrors[res1.errno.toString()]);
      return [];
    }
    const fileRecord1 = res1.list.find((_) => _.server_filename == fileName);
    if (!fileRecord1) {
      onMessage('文件不存在：' + fileName);
      return [];
    }
    const res2 = await Services.Baidu.getFileDLink(accessToken, fileRecord1.fs_id);
    if (!res2) {
      onMessage('尝试获取baidu文件下载地址：' + fileName);
      return [];
    }
    if (res2.errno != 0) {
      onMessage(Enums.BaiduErrors[res2.errno.toString()]);
      return [];
    }
    const fileRecord2 = res2.list.find((_) => _.fs_id == fileRecord1.fs_id);
    if (!fileRecord2) {
      onMessage('文件下载地址获取失败：' + fileName);
      return [];
    }
    const content = await Services.Baidu.downloadFile(accessToken, fileRecord2.dlink);
    if (content) {
      bkFFlows[key] = content as Record<string, any>;
    }
  }
  QUANT_CACHE.bkFFlows = bkFFlows;
  return bkFFlows[key][stsecid] || [];
}

export async function cacheStockFFLows(accessToken: string, onMessage: (msg: string) => void) {
  const bks = QUANT_CACHE.bks || (await Services.Stock.GetBanKuais(Enums.BKType.Industry, 100)).arr!;
  const bkSts: Record<string, any[]> = QUANT_CACHE.bkSts || {};
  for (let i = 0; i < bks.length; i++) {
    const bksecid = bks[i].secid;
    if (!bkSts[bksecid]) {
      bkSts[bksecid] = (await Services.Stock.GetBankuaiStocksFromEastmoney(bksecid, 100)).stocks;
      const stFlows: Record<string, any[]> = {};
      onMessage('获取板块所有股票现金流 ' + bks[i].name);
      const collectors = bkSts[bksecid].map((st) => () => Services.Stock.GetFlowTrendFromEastmoney(st.secid));
      const data = await Adapter.ConCurrencyAllAdapter(collectors, 500);
      data.forEach((d) => {
        if (d?.ffTrends && d.ffTrends.length > 0) stFlows[d.secid] = d.ffTrends;
      });
      onMessage('获取板块所有股票现金流完毕 ' + bks[i].name);

      if (Object.keys(stFlows).length > 0) {
        const day = moment(new Date()).format('YYYY-MM-DD');
        const fileName = `${bksecid}.fflows.${day}.json`;
        const contents = JSON.stringify(stFlows);
        const dir = `/apps/股事/fflows/${bksecid}`;
        const res = (await Services.Baidu.uploadFile(accessToken, dir, fileName, contents)) as any;
        if (!res) {
          // 重试
          i--;
          continue;
        }
        if (res.res3) {
          // 走到了第三步
          if (res.res3.errno != 0) {
            onMessage(Enums.BaiduErrors[res.res3.errno.toString()]);
          } else {
            onMessage(`${bksecid}分时现金流备份成功，剩下：${bks.length - i - 1}`);
          }
        } else if (res.res2) {
          // 走到了第二步
          if (res.res2.errno != 0) {
            onMessage(Enums.BaiduErrors[res.res2.errno.toString()]);
          }
        } else if (res.res1) {
          if (res.res1.errno != 0) {
            onMessage(Enums.BaiduErrors[res.res1.errno.toString()]);
          }
        }
      }
    }
  }
  QUANT_CACHE.bks = bks;
  QUANT_CACHE.bkSts = bkSts;
}

export function LYTIndicator(klines: Stock.KLineItem[]) {
  const sps = klines.map(_ => _.sp);
  const zgs = klines.map(_ => _.zg);
  const MA5 = Indicators.calculateMA(sps, 5);
  const MA10 = Indicators.calculateMA(sps, 10);
  const MA20 = Indicators.calculateMA(sps, 20);
  // const MA40 = Indicators.calculateMA(sps, 40);
  const MA60 = Indicators.calculateMA(sps, 40);
  function dayIsLYT(_ma5: number[], _ma10: number[], _ma20: number[], _ma60: number[], _zgs: number[], _sps: number[]) {
    const day1 = Indicators.barlast(_ma5, _ma60, Indicators.cross); // 5日线上穿60日线
    if (day1 == -1) {
      return false;
    }
    const day2 = Indicators.barlast(_ma10, _ma60, Indicators.cross); // 10日线上穿60日线
    if (day2 == -1) {
      return false;
    }
    const hhv = Indicators.hhv(_zgs, day2); // day2周期最大值
    const day3 = Indicators.barlast(_zgs, hhv, (a, b, i) => a[i] == b[i]); // 从最高点回落的天数
    if (day3 == -1) {
      return false;
    }
    const day4 = Indicators.barlast(_ma10, _ma5, (a, b, i) => Indicators.cross(a, b, i) || (a[i - 1] < b[i - 1] && a[i] == b[i])); // 下跌后，5日均线和10日均线死叉
    if (day4 == -1) {
      return false;
    }
    // const day5 = Indicators.barlast(_ma5, _ma10, Indicators.cross); // 回落不久，5日线和10日线形成金叉
    const day5 = Indicators.barlast(_ma20, _ma5, Indicators.cross); // 5日线回踩20日线
    if (day5 == -1) {
      return false;
    }
    const a1 = day1 > day2 && day2 > day3 && day3 > day4 && day4 > day5 && day5 < 5;
    const a2 = Indicators.count(_ma10, _ma5, Indicators.cross, day2) == 1; // day2周期内有一次10日线和5日线金叉
    const a3 = _ma5[_ma5.length - 1] > _ma60[_ma60.length - 1] && _ma10[_ma10.length - 1] > _ma60[_ma60.length - 1];
    // const a4 = _sps[_sps.length - 1] > _sps[sps.length - day2 - 1]; // 不能跌破起涨点
    return a1 && a2 && a3;
  }
  const result = [];
  for (let i = 0; i < klines.length; i++) {
    if (i < 60) {
      result.push(false);
      continue;
    }
    if (i == 204) {
      console.log(204);
    }
    const lyt = dayIsLYT(MA5.slice(0, i + 1), MA10.slice(0, i + 1), MA20.slice(0, i + 1), MA60.slice(0, i + 1), zgs.slice(0, i + 1), sps.slice(0, i + 1));
    result.push(lyt);
    if (lyt) {
      // 跳过接下来的5天
      for(let j = 0; j < 5; j++) {
        result.push(false);
        i++;
      }
    }
  }
  return result;
}

