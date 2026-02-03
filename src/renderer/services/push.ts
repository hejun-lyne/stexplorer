import { NativeEventSource, EventSourcePolyfill } from '@/lib/eventsource.js';
import { allKlineTypes, KLineType } from '@/utils/enums';
import * as Helper from '@/helpers';
import { RandomEastmoneyUrl } from './stock';

const EventSource = NativeEventSource || EventSourcePolyfill;

export class EastmoneySingleTrendsPush {
  es: EventSource;

  constructor(options: { secid: string; success: (data: any) => void; error: (message: string) => void }) {
    const fields1 = 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13';
    const fields2 = 'f51,f52,f53,f54,f55,f56,f57,f58';
    const url =
      RandomEastmoneyUrl() +
      'api/qt/stock/trends2/sse?ndays=1&iscr=0&iscca=0&secid=' +
      options.secid +
      '&ut=fa5fd1943c7b386f172d6893dbfba10b&fields1=' +
      fields1 +
      '&fields2=' +
      fields2;
    this.es = new EventSource(url);
    this.es.onmessage = function (e: { data: string }) {
      const response = JSON.parse(e.data);
      if (!response || response.rc !== 0) {
        options.error(response.message);
      } else if (!response.data) {
        console.error('EastmoneySingleTrendsPush no data');
      } else {
        options.success(response.data);
      }
    };
  }

  close() {
    this.es.close();
  }
}
export class EastmoneySingleStockPush {
  es: EventSource;

  constructor(options: { secid: string; success: (data: any) => void; error: (message: string) => void }) {
    const fields =
      'f43,f57,f58,f169,f170,f46,f44,f51,f168,f47,f164,f163,f116,f60,f45,f52,f50,f48,f167,f117,f71,f161,f49,f530,f135,f136,f137,f138,f139,f141,f142,f144,f145,f147,f148,f140,f143,f146,f149,f55,f62,f162,f92,f173,f104,f105,f84,f85,f183,f184,f185,f186,f187,f188,f189,f190,f191,f192,f107,f111,f86,f177,f78,f110,f262,f263,f264,f267,f268,f250,f251,f252,f253,f254,f255,f256,f257,f258,f266,f269,f270,f271,f273,f274,f275,f127,f199,f128,f193,f196,f194,f195,f197,f80,f280,f281,f282,f284,f285,f286,f287,f292';
    const url =
      RandomEastmoneyUrl() + 'api/qt/stock/sse?secid=' + options.secid + '&fltt=1&forcect=1&&ut=f057cbcbce2a86e2866ab8877db1d059&fields=' + fields;
    this.es = new EventSource(url);
    this.es.onmessage = function (e: { data: string }) {
      const response = JSON.parse(e.data);
      if (!response || response.rc !== 0) {
        options.error(response.message);
      } else if (!response.data) {
        console.error('EastmoneySingleStockPush no data');
      } else {
        options.success(response.data);
      }
    };
  }

  close() {
    this.es.close();
  }
}

export class EastmoneyStockDetailsPush {
  es: EventSource;

  constructor(options: { secids: string[]; success: (data: any) => void; error: (message: string) => void }) {
    const fields = 'f12,f13,f19,f14,f139,f148,f2,f4,f1,f125,f18,f3,f152,f5,f30,f31,f32,f6,f8,f7,f10,f22,f9,f112,f100';
    const url =
      RandomEastmoneyUrl() +
      'api/qt/ulist/sse?invt=3&pi=0&po=1&pz=' +
      options.secids.length +
      '&mpi=30&secids=' +
      options.secids.join(',') +
      '&ut=6d2ffaa6a585d612eda28417681d58fb&fields=' +
      fields;
    this.es = new EventSource(url);
    this.es.onmessage = function (e: { data: string }) {
      const response = JSON.parse(e.data);
      if (!response || response.rc !== 0) {
        options.error(response.message);
      } else if (!response.data) {
        console.error('EastmoneyStocksPush no data');
      } else {
        options.success(response.data);
      }
    };
  }

  close() {
    this.es.close();
  }
}

export class EastmoneyStockKlinesPush {
  counters: number[];

  timers: Record<number, any>;

  constructor() {
    this.timers = {};
    this.counters = allKlineTypes.map((t) => 0);
  }

  subscribe(type: KLineType) {
    const kIndex = allKlineTypes.indexOf(type);
    this.counters[kIndex] += 1;
    if (this.counters[kIndex] == 1) {
      // 启动
      this.timers[type] = setInterval(() => {
        Helper.Stock.UpdateStocksKline(type);
      }, 2000);
    }
  }

  unsubscribe(type: KLineType) {
    const kIndex = allKlineTypes.indexOf(type);
    this.counters[kIndex] -= 1;
    if (this.counters[kIndex] == 0) {
      clearInterval(this.timers[type]);
    } else if (this.counters[kIndex] < 0) {
      this.counters[kIndex] = 0;
    }
  }
}

const ylyc_year = 2020;
//盈利基准年 https://quote.eastmoney.com/zixuan/api/ylyc?codes=[%270.300025%27]
const fieldsMapping = {
  f12: {
    name: '代码',
  },
  f14: {
    name: '名称',
  },
  f2: {
    name: '最新价',
  },
  f3: {
    name: '涨跌幅',
  },
  f4: {
    name: '涨跌额',
  },
  f5: {
    name: '总手',
  },
  f30: {
    name: '现手',
  },
  f31: {
    name: '买入价',
  },
  f32: {
    name: '卖出价',
  },
  f18: {
    name: '昨收',
  },
  f6: {
    name: '成交额',
  },
  f8: {
    name: '换手率',
  },
  f7: {
    name: '振幅',
  },
  f10: {
    name: '量比',
  },
  f15: {
    name: '最高价',
  },
  f16: {
    name: '最低价',
  },
  f17: {
    name: '开盘价',
  },
  f22: {
    name: '涨速',
  },
  f9: {
    name: '市盈率',
  },
  f62: {
    name: '主力净流入',
  },
  f63: {
    name: '集合竞价',
  },
  f64: {
    name: '超大单流入',
  },
  f65: {
    name: '超大单流出',
  },
  f66: {
    name: '超大单净额',
  },
  f69: {
    name: '超大单净占比',
  },
  f70: {
    name: '大单流入',
  },
  f71: {
    name: '大单流出',
  },
  f72: {
    name: '大单净额',
  },
  f75: {
    name: '大单净占比',
  },
  f76: {
    name: '中单流入',
  },
  f77: {
    name: '中单流出',
  },
  f78: {
    name: '中单净额',
  },
  f81: {
    name: '中单净占比',
  },
  f82: {
    name: '小单流入',
  },
  f83: {
    name: '小单流出',
  },
  f84: {
    name: '小单净额',
  },
  f87: {
    name: '小单净占比',
  },
  f88: {
    name: '当日DDX',
  },
  f89: {
    name: '当日DDY',
  },
  f90: {
    name: '当日DDZ',
  },
  f91: {
    name: '5日DDX',
  },
  f92: {
    name: '5日DDY',
  },
  f93: {
    name: '5日DDZ',
  },
  f94: {
    name: '10日DDX',
  },
  f95: {
    name: '10日DDY',
  },
  f96: {
    name: '10日DDZ',
  },
  f97: {
    name: 'DDX飘红天数(连续)',
  },
  f98: {
    name: 'DDX飘红天数(5日)',
  },
  f99: {
    name: 'DDX飘红天数(10日)',
  },
  f38: {
    name: '总股本',
  },
  f39: {
    name: '流通股',
  },
  f36: {
    name: '人均持股数',
  },
  f112: {
    name: '每股收益',
  },
  f221: {
    name: '更新日期',
  },
  f113: {
    name: '每股净资产',
  },
  f37: {
    name: '净资产收益率(加权)',
  },
  f40: {
    name: '营业收入',
  },
  f41: {
    name: '营业收入同比',
  },
  f42: {
    name: '营业利润',
  },
  f43: {
    name: '投资收益',
  },
  f44: {
    name: '利润总额',
  },
  f45: {
    name: '净利润',
  },
  f46: {
    name: '净利润同比',
  },
  f47: {
    name: '未分配利润',
  },
  f48: {
    name: '每股未分配利润',
  },
  f49: {
    name: '毛利率',
  },
  f50: {
    name: '总资产',
  },
  f51: {
    name: '流动资产',
  },
  f52: {
    name: '固定资产',
  },
  f53: {
    name: '无形资产',
  },
  f54: {
    name: '总负债',
  },
  f55: {
    name: '流动负债',
  },
  f56: {
    name: '长期负债',
  },
  f57: {
    name: '资产负债比率',
  },
  f58: {
    name: '股东权益',
  },
  f59: {
    name: '股东权益比',
  },
  f60: {
    name: '公积金',
  },
  f61: {
    name: '每股公积金',
  },
  f26: {
    name: '上市日期',
  },
  f100: {
    name: '所属行业板块',
  },
  f102: {
    name: '所属地区板块',
  },
  f103: {
    name: '所属概念板块',
  },
  //盈利预测字段
  y1: {
    name: '研报数',
  },
  y2: {
    name: '评级统计(六个月)买入',
  },
  y3: {
    name: '评级统计(六个月)增持',
  },
  y4: {
    name: '评级统计(六个月)中性',
  },
  y5: {
    name: '评级统计(六个月)减持',
  },
  y6: {
    name: '评级统计(六个月)卖出',
  },
  y7: {
    name: ylyc_year + '实际收益',
  },
  y8: {
    name: ylyc_year + 1 + '预测收益',
  },
  y9: {
    name: ylyc_year + 1 + '预测市盈率',
  },
  y10: {
    name: ylyc_year + 2 + '预测收益',
  },
  y11: {
    name: ylyc_year + 2 + '预测市盈率',
  },
  y12: {
    name: ylyc_year + 3 + '预测收益',
  },
  y13: {
    name: ylyc_year + 3 + '预测市盈率',
  },
};
