import dayjs from 'dayjs';
// import cheerio from 'cheerio';
import NP from 'number-precision';
import * as Utils from '@/utils';
import { BKType, ChanType, KLineType, StockMarketType } from '@/utils/enums';
import { Stock } from '@/types/stock';
// import { data } from 'cheerio/lib/api/attributes';
import { helper } from 'echarts';
import * as Helpers from '../helpers';
import * as Enums from '@/utils/enums';

const { got } = window.contextModules;

const defaultCompany: Stock.Company = {
  gsjs: '',
  sshy: '', // 所属行业
  dsz: '', // 董事长
  zcdz: '', // 注册地址
  clrq: '', // 成立日期
  ssrq: '', // 上市日期
};

export function RandomEastmoneyUrl() {
  const rnd = Math.floor(Math.random() * (99 - 1)) + 1;
  return 'https://' + rnd + '.push2.eastmoney.com/';
}

export function RandomEastmoneyHistUrl() {
  const rnd = Math.floor(Math.random() * (99 - 1)) + 1;
  return 'https://' + rnd + '.push2his.eastmoney.com/';
}

function parseJSONP<T = any>(jsonp: string): T {
  // 临时挂一个全局回调，名字跟 JSONP 一致
  const cbName = jsonp.slice(0, jsonp.indexOf('('));
  return new Function(
    'window',
    `${cbName} = function(o){ return o; };` +
    `return ${jsonp}`
  )(window);
}

export async function SearchFromEastmoney2(keyword: string) {
  try {
    const jquery = 'jQuery35108806656100479011_1670686196092';
    const { body } = await got<string>('https://search-api-web.eastmoney.com/search/jsonp', {
      searchParams: {
        cb: jquery,
        param: `{"uid":"","keyword":"${keyword}","type":["codetableLabelWeb"],"client":"web","clientType":"wap","clientVersion":"curr","param":{"codetableLabelWeb":{"pageIndex":1,"pageSize":30,"preTag":"","postTag":"","isHighlight":false,"label":"ALL"}}}`,
        _: new Date().getTime(),
      }
    });
    const rawStr = body.substring(jquery.length + 1, body.length - 1);
    const json = JSON.parse(rawStr);
    const typeMappings: Record<string, StockMarketType> = {
      'AB股': StockMarketType.AB,
      '指数': StockMarketType.Zindex,
      '板块': StockMarketType.Quotation,
      '港股': StockMarketType.HK,
      '美股': StockMarketType.US,
      '英股': StockMarketType.UK,
      '三板': StockMarketType.XSB,
      '基金': StockMarketType.Fund,
      '债券': StockMarketType.Bond,
      '期货期权': StockMarketType.Future,
    }
    const result:any[] = [];
    if (json?.result?.codetableLabelWeb?.labelList) {
      json.result.codetableLabelWeb.labelList.forEach((item: any) => {
        if (item.quoteList.length > 0) {
          const data = {
            Type: typeMappings[item.name as string], // 7,
            Name: item.name, // "三板",
            Count: item.quoteList.length, // 3;
            Datas: [] as any[],
          };
          item.quoteList.forEach((record: any) => {
            data.Datas.push({
              Code: record.code, // '839489';
              Name: record.shortName, // '同步天成';
              ID: record.id, // '839489_TB';
              MktNum: record.market, // '0';
              SecurityType: record.securityType, // '10';
              MarketType: record.marketType, // '_TB';
              JYS: record.jys, // '81';
              UnifiedCode: record.unifiedCode, // '839489';
            });
          });
          result.push(data);
        }
      });
    }

    console.log('搜索结果：', result);
    return result;
  } catch (error) {
    console.log('搜索股票失败', error);
    return [];
  }
}

export async function SearchFromEastmoney(keyword: string) {
  try {
    const {
      body: { Data },
    } = await got<{
      Data: {
        Type: number; // 7,
        Name: string; // "三板",
        Count: number; // 3;
        Datas: {
          Code: string; // '839489';
          Name: string; // '同步天成';
          ID: string; // '839489_TB';
          MktNum: string; // '0';
          SecurityType: string; // '10';
          MarketType: string; // '_TB';
          JYS: string; // '81';
          GubaCode: string; // '839489';
          UnifiedCode: string; // '839489';
        }[];
      }[];
    }>('https://searchapi.eastmoney.com/bussiness/web/QuotationLabelSearch', {
      searchParams: {
        keyword,
        type: 0,
        ps: 1000,
        pi: 1,
        token: Utils.MakeHash(),
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
    console.log('搜索结果：', Data);
    return Data || [];
  } catch (error) {
    console.log('搜索股票失败', error);
    return [];
  }
}

export async function GetTrendFromEastmoney(secid: string, zs?: number) {
  try {
    const {
      body: { data },
    } = await got<{
      rc: 0;
      rt: 10;
      svr: 182482649;
      lt: 1;
      full: 1;
      data: {
        code: '600519';
        market: 1;
        type: 2;
        status: 0;
        name: '贵州茅台';
        decimal: 2;
        preSettlement: 0.0;
        preClose: 2012.9;
        beticks: '33300|34200|54000|34200|41400|46800|54000';
        trendsTotal: 241;
        time: 1625620887;
        kind: 1;
        prePrice: 2012.9;
        trends: ['2021-07-07 09:30,2012.90,2012.90,2013.00,2012.00,0,0.00,2012.900'];
      };
    }>('http://push2his.eastmoney.com/api/qt/stock/trends2/get', {
      searchParams: {
        secid,
        fields1: 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13',
        fields2: 'f51,f52,f53,f54,f55,f56,f57,f58',
        ndays: 1,
        iscr: 0,
        iscca: 0,
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
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
    return {
      secid,
      trends: trends,
    };
  } catch (error) {
    return {
      secid,
      trends: [],
    };
  }
}

export async function GetPicTrendFromEastmoney(secid: string) {
  try {
    const { rawBody }: any = await got('http://webquotepic.eastmoney.com/GetPic.aspx', {
      searchParams: {
        nid: secid,
        imageType: 'RJY', //'GNR',
        UnitWidth: 50,
        token: Utils.MakeHash(),
      },
    });
    //http://webquoteklinepic.eastmoney.com/GetPic.aspx?nid=0.002060&UnitWidth=-6&imageType=KXL&EF=&Formula=RSI&AT=0&&type=&token=44c9d251add88e27b65ed86506f6e5da&_=0.32755695407936614
    //webquotepic.eastmoney.com/GetPic.aspx?nid=1.601601&imageType=RJY&token=44c9d251add88e27b65ed86506f6e5da
    const b64encoded = btoa(String.fromCharCode.apply(null, rawBody));
    return { secid, pic: `data:image/png;base64,${b64encoded}` };
  } catch (error) {
    console.log(error);
    return null;
  }
}

export async function GetFlowTrendFromEastmoney(secid: string) {
  try {
    const {
      body: { data },
    } = await got<{
      full: 0;
      lt: 1;
      rc: 0;
      rt: 21;
      svr: 182994978;
      data: {
        code: 'BK0481';
        market: 90;
        name: '汽车行业';
        klines: ['2021-10-22 09:31,30436522.0,-7442452.0,-22994071.0,13941236.0,16495286.0'];
      };
    }>('https://push2.eastmoney.com/api/qt/stock/fflow/kline/get', {
      searchParams: {
        secid,
        fields1: 'f1,f2,f3,f7',
        fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65',
        ndays: 1,
        klt: 1,
        lmt: 0,
        ut: Utils.MakeHash(),
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
    let prevMain = 0;
    const trends = data.klines.map((item) => {
      const [time, main, small, medium, big, superbig] = item.split(',');
      const mainNow = Number(main);
      const mainDiff = mainNow - prevMain;
      prevMain = mainNow;
      return {
        time,
        main: mainNow,
        mainDiff: mainDiff,
        small: Number(small),
        medium: Number(medium),
        big: Number(big),
        superbig: Number(superbig),
      };
    });
    return {
      secid,
      ffTrends: trends,
    };
  } catch (error) {
    return {
      secid,
      ffTrends: [],
    };
  }
}

export async function BatchGetBriefsFromEastmoney(secids: string[]) {
  try {
    const {
      body: { data },
    } = await got<{
      rc: 0;
      rt: 11;
      svr: 2887256420;
      lt: 1;
      full: 1;
      data: {
        total: 11;
        diff: [
          {
            f1: 2;
            f2: 2837;
            f3: 60;
            f4: 17;
            f6: 478828368;
            f12: '601601';
            f13: 1;
            f14: '中国太保';
            f18: 2820;
            f19: 2;
            f104: '-';
            f105: '-';
            f106: '-';
            f152: 2;
          }
        ];
      };
    }>('http://push2.eastmoney.com/api/qt/ulist.np/get', {
      searchParams: {
        secids: secids.join(','),
        invt: 2,
        fields: 'f1,f2,f3,f4,f6,f14,f12,f13,f18,f19,f104,f105,f106,f152',
        ut: Utils.MakeHash(),
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
    const w = 10 ** 2;
    return data.diff.map((_) => {
      return {
        secid: `${_.f13}.${_.f12}`,
        zx: _.f2 / w,
        zs: _.f18 / w,
        zdf: _.f3 / w,
        zdd: _.f4 / w,
        cje: _.f6,
      };
    });
  } catch (error) {
    return {};
  }
}

export async function GetDetailFromEastmoney(secid: string) {
  try {
    const {
      body: { data },
    } = await got<{
      rc: 0;
      rt: 4;
      svr: 182481210;
      lt: 1;
      full: 1;
      data: {
        f43: 14.34;
        f44: 14.66;
        f45: 14.25;
        f46: 14.45;
        f47: 82787;
        f48: 119677563.0;
        f49: 44706;
        f50: 1.1;
        f51: 15.58;
        f52: 12.74;
        f55: 0.037979672;
        f57: '601808';
        f58: '中海油服';
        f60: 14.16;
        f62: 1;
        f71: 14.46;
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
      };
    }>(RandomEastmoneyUrl() + 'api/qt/stock/get', {
      searchParams: {
        secid,
        ut: "f057cbcbce2a86e2866ab8877db1d059",
        invt: 2,
        fltt: 1,
        mpi: 1000,
        fields:
          'f43,f57,f58,f169,f170,f46,f44,f47,f85,f51,f168,f164,f163,f116,f60,f45,f52,f50,f47,f48,f167,f117,f71,f161,f49,f530,f135,f136,f137,f138,f139,f141,f142,f144,f145,f147,f148,f140,f143,f146,f149,f55,f62,f162,f92,f173,f104,f105,f84,f85,f183,f184,f185,f186,f187,f188,f189,f190,f191,f192,f107,f111,f86,f177,f78,f110,f262,f263,f264,f267,f268,f250,f251,f252,f253,f254,f255,f256,f257,f258,f266,f269,f270,f271,f273,f274,f275,f127,f199,f128,f193,f196,f194,f195,f197,f80,f280,f281,f282,f284,f285,f286,f287,f292',
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
    const w = 10 ** 4;
    return {
      secid,
      zg: data.f44, // 最高
      zd: data.f45, // 最低
      jk: data.f46, // 今开
      zss: typeof data.f47 === 'string' ? data.f47 : Number(data.f47), // 总手数
      zt: data.f51, // 涨停
      dt: data.f52, // 跌停
      zx: data.f43, // 最新
      cjl: data.f47, // 成交量
      lb: data.f50, // 量比
      cje: data.f48, // 成交额
      lt: data.f117, // 流通市值
      ltg: data.f85, // 流通股
      wp: typeof data.f49 === 'string' ? data.f49 : Number(data.f49), // 外盘
      code: data.f57,
      name: data.f58,
      market: data.f62,
      bk: data.f127,
      zs: data.f60, // 昨收
      jj: data.f71, // 均价
      np: typeof data.f161 === 'string' ? data.f161 : Number(data.f161), // 内盘
      hsl: data.f168 * 100, // 换手
      zdd: data.f169, // 涨跌点
      zdf: data.f170, /// 涨跌幅
      s1: data.f40, /// 卖1手数
      s1p: data.f39, /// 卖1价格
      s2: data.f38, /// 卖2手数
      s2p: data.f37, /// 卖2价格
      s3: data.f36, /// 卖3手数
      s3p: data.f35, /// 卖3价格
      s4: data.f34, /// 卖4手数
      s4p: data.f33, /// 卖4价格
      s5: data.f32, /// 卖5手数
      s5p: data.f31, // 卖5价格
      b1: data.f20, /// 买1手数
      b1p: data.f19, /// 买1价格
      b2: data.f18, /// 买2手数
      b2p: data.f17, /// 买2价格
      b3: data.f16, /// 买3手数
      b3p: data.f15, /// 买3价格
      b4: data.f14, /// 买4手数
      b4p: data.f13, /// 买4价格
      b5: data.f12, /// 买5手数
      b5p: data.f11, /// 买5价格
      time: dayjs.unix(data.f86).format('MM-DD HH:mm'),
    } as Stock.DetailItem;
  } catch (error) {
    return {} as Stock.DetailItem;
  }
}

export async function FromEastmoney(secid: string) {
  try {
    const responseTrends = await GetTrendFromEastmoney(secid);
    const responseDetail = await GetDetailFromEastmoney(secid);
    const responseFlowTrends = await GetFlowTrendFromEastmoney(secid);

    if (!responseTrends || !Object.keys(responseDetail).length) {
      return null;
    }

    const { trends } = responseTrends;
    const { ffTrends } = responseFlowTrends;
    const { secid: _secid, ...detailRest } = responseDetail as any;
    return { secid, ...detailRest, trends, ffTrends };
  } catch (error) {
    return null;
  }
}

export async function GetKFromDataSource(source:Enums.FundApiType, secid: string, code: number, limit?: number) {
  if (source == Enums.FundApiType.Eastmoney) {
    return GetKFromEastmoney(secid, code, limit);
  } else if (source == Enums.FundApiType.ZiZai) {
    return GetKFromZizai(secid, code);
  } else if (source == Enums.FundApiType.XTick) {
    return GetKFromXTick(secid, code);
  }
}

export async function GetKFromXTick(secid: string, code: number) {
  let period = '1d';
  if (code == KLineType.Week) {
    period = '1w';
  } else if (code == KLineType.Month) {
    period = '1mon';
  } else if (code == KLineType.Mint60) {
    period = '1h';
  } else if (code == KLineType.Mint30) {
    period = '30m';
  } else if (code == KLineType.Mint15) {
    period = '15m';
  } else if (code == KLineType.Mint5) {
    period = '5m';
  } else if (code == KLineType.Mint1) {
    period = '1m';
  }
  let type = 1;
  let etype = Helpers.Stock.GetStockType(secid) as Enums.StockMarketType;
  if (etype == Enums.StockMarketType.Zindex) {
    type = 10;
  } else if (etype == Enums.StockMarketType.AB) {
    type = 1;
  } else if (etype == Enums.StockMarketType.HK) {
    type = 3;
  } else {
    type = 20;
  }
  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  today.setFullYear(today.getFullYear() - 1);   // 减 1 年
  const startDate = today.toISOString().slice(0, 10);
  const searchParams = {
    type,
    code: Helpers.Stock.GetStockCode(secid),
    period,
    fq: 'front',
    startDate,
    endDate,
    token: 'eff4c43ccac76517e11953ba973760e5'
  };
  try {
    const { body } = await got<[{
      type:1,
      code:"000001",
      time:1742832000000,
      open:11.38,
      close:11.43,
      high:11.43,
      low:11.36,
      volume:735609.0,
      amount:8.3914202E8}]>('http://api.xtick.top/doc/market', {
      responseType: 'json',
      searchParams
    });
    let prevSp = 0;
    const ks = (body || []).map((s, idx) => {
      const date = new Date(s.time).toISOString().slice(0, 10);;
      const vol = s.volume;
      const hsl = 0;
      const zf = prevSp == 0 ? 0 : (Math.abs(s.high / prevSp - 1) + Math.abs(s.low / prevSp - 1));
      const zdf = prevSp == 0 ? 0 : (s.close /prevSp - 1);
      const zde = prevSp == 0 ? 0 : (s.close - prevSp);
      const k = {
        secid: secid,
        type: code,
        date,
        kp: Number(s.open),
        sp: Number(s.close),
        zg: Number(s.high),
        zd: Number(s.low),
        cjl: Number(vol),
        cje: Number(vol),
        zf: Number(zf), // 震幅
        zdf: Number(zdf),
        zde: Number(zde),
        hsl: Number(hsl),
        chan: ChanType.Unknow,
      };
      prevSp = k.sp;
      return k;
    });

    return {
      ks,
      kt: code,
    };
  } catch (error) {
    console.log(error);
    return {
      ks: [],
      kt: code,
    };
  }
}


export async function GetKFromZizai(secid: string, code: number) {
  if (code != KLineType.Day) {
    // 目前只支持日线
    return [];
  }
  try {
    const { body } = await got<{
      code: 2000;
      data: {
        CQ: [""];
        StockID: '600519';
        Time: 1760949564;
        bal: [599842520];
        errcode: 0;
        firstPre: 5.92;
        name: "";
        state: [0];
        state1: [0];
        stateZT: [0];
        ttag: 0.003852000000000022;
        turnover: [7.77]; // 换手率
        vol: [122389]; // 成交量
        x: ["20250224"]; // 日期
        y: [[
                49, // open
                48.91, // close
                50.48, // low
                47.82 // high
            ]];
      };
    }>('https://api.zizizaizai.com/kline/d/' + secid.substring(2), {
      responseType: 'json',
    });
    let prevSp = 0;
    const ks = (body?.data?.x || []).map((s, idx) => {
      const date = s.substring(0,4) + '-' + s.substring(4, 6) + '-' + s.substring(6);
      const kdata = body.data.y[idx]; 
      const vol = body.data.vol[idx];
      const hsl = body.data.turnover[idx];
      const zf = prevSp == 0 ? 0 : (Math.abs(kdata[3] / prevSp - 1) + Math.abs(kdata[2] / prevSp - 1));
      const zdf = prevSp == 0 ? 0 : (kdata[1] /prevSp - 1);
      const zde = prevSp == 0 ? 0 : (kdata[1] - prevSp);
      const k = {
        secid: secid,
        type: code,
        date,
        kp: Number(kdata[0]),
        sp: Number(kdata[1]),
        zg: Number(kdata[2]),
        zd: Number(kdata[3]),
        cjl: Number(vol),
        cje: Number(vol),
        zf: Number(zf), // 震幅
        zdf: Number(zdf),
        zde: Number(zde),
        hsl: Number(hsl),
        chan: ChanType.Unknow,
      };
      prevSp = k.sp;
      return k;
    });

    return {
      ks,
      kt: code,
    };
  } catch (error) {
    console.log(error);
    return {
      ks: [],
      kt: code,
    };
  }
}

export async function GetKFromEastmoney(secid: string, code: number, limit?: number) {
  try {
    const searchParams =
      limit == -1
        ? {
          secid,
          fields1: 'f1,f2,f3,f4,f5,f6',
          fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
          klt: code,
          fqt: 1,
          beg: 0,
          end: 20500101,
          _: new Date().getTime(),
        }
        : {
          cb: 'jQuery35109995919145397818_1763449851442',
          secid,
          ut: 'fa5fd1943c7b386f172d6893dbfba10b', 
          fields1: 'f1,f2,f3,f4,f5,f6',
          fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
          klt: code,
          fqt: 1,
          end: 20500101,
          lmt: limit || 120,
          _: new Date().getTime(),
        };
    // const rnd = Math.floor(Math.random() * (99 - 1)) + 1;
    const stcode = Helpers.Stock.GetStockCode(secid);
    const emcode = (stcode.startsWith('6') ? 'sh' : 'sz') + stcode;
    const stringBody = await got<string>(RandomEastmoneyHistUrl() + 'api/qt/stock/kline/get', {
      searchParams,
      // responseType: 'string',
      // headers: {
      //   "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      //   "Referer": "https://quote.eastmoney.com/" + emcode + ".html"
      // }
    });
    const body = parseJSONP(stringBody.body);
    const ks = (body?.data?.klines || []).map((_) => {
      const [date, kp, sp, zg, zd, cjl, cje, zf, zdf, zde, hsl] = _.split(',');
      return {
        secid: secid,
        type: code,
        date,
        kp: Number(kp),
        sp: Number(sp),
        zg: Number(zg),
        zd: Number(zd),
        cjl: Number(cjl),
        cje: Number(cje),
        zf: Number(zf),
        zdf: Number(zdf),
        zde: Number(zde),
        hsl: Number(hsl),
        chan: ChanType.Unknow,
      };
    });
    return {
      ks,
      kt: code,
    };
  } catch (error) {
    console.log(error);
    return {
      ks: [],
      kt: code,
    };
  }
}

export async function GetFlowKFromEastmoney(secid: string, limit?: number) {
  try {
    const { body } = await got<{
      rc: 0;
      rt: 17;
      svr: 182481222;
      lt: 1;
      full: 0;
      data: {
        code: '600519';
        market: 1;
        name: '汽车行业';
        klines: [
          '2021-10-22,905167104.0,-273173760.0,-631993088.0,21241856.0,883925248.0,2.19,-0.66,-1.53,0.05,2.14,23431.00,-0.73,0.00,0.00'
        ];
      };
    }>('https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get', {
      searchParams: {
        secid,
        fields1: 'f1,f2,f3,f7',
        fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65',
        klt: 101,
        fqt: 0,
        lmt: limit || 0,
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
    const klines: Stock.FlowDLineItem[] = [];
    let prev: Stock.FlowDLineItem | null = null;
    (body?.data?.klines || []).forEach((_) => {
      const [date, main, small, medium, big, superbig, mainZdf, smallZdf, mediumZdf, bigZdf, superbigZdf, zx1, zdf1, zx2, zdf2] =
        _.split(',');
      const cur = {
        secid: secid,
        date,
        main: Number(main),
        small: Number(small),
        medium: Number(medium),
        big: Number(big),
        superbig: Number(superbig),
        mainZdf: Number(mainZdf),
        smallZdf: Number(smallZdf),
        mediumZdf: Number(mediumZdf),
        bigZdf: Number(bigZdf),
        superbigZdf: Number(superbigZdf),
        netMain: prev ? prev.netMain + Number(main) : Number(main),
        netSmall: prev ? prev.netSmall + Number(small) : Number(small),
        netMedium: prev ? prev.netMedium + Number(medium) : Number(medium),
        netBig: prev ? prev.netBig + Number(big) : Number(big),
        netSuperBig: prev ? prev.netSuperBig + Number(superbig) : Number(superbig),
      };
      klines.push(cur);
      prev = cur;
    });
    return klines;
  } catch (error) {
    console.log(error);
    return [];
  }
}

export async function GetStockBankuaisFromEastmoney(secid: string) {
  const { body } = await got<{
    data: {
      diff: {
        0: {
          f3: 2.1;
          f14: '有色金属';
          f12: 'BK0478';
          f13: 90;
        };
      };
    };
  }>('https://push2.eastmoney.com/api/qt/slist/get', {
    searchParams: {
      secid,
      fields: 'f1,f12,f13,f152,f3,f14,f128,f136',
      forcect: 1,
      spt: 3,
      pi: 0,
      pz: 30,
      po: 1,
      fid: 'f3',
      fid0: 'f4003',
      invt: 2,
      _: new Date().getTime(),
    },
    responseType: 'json',
  });
  try {
    return Object.values(body?.data?.diff || {}).map((_) => ({
      code: _.f12,
      name: _.f14,
      secid: `${_.f13}.${_.f12}`,
      zdf: Number(_.f3 / 100.0),
    }));
  } catch (error) {
    console.log(error);
    return [];
  }
}

export async function GetStockTradesFromEastmoney(secid: string, count: number) {
  try {
    const { body } = await got<{
      rc: 0;
      rt: 12;
      svr: 182994651;
      lt: 1;
      full: 1;
      data: {
        code: '002248';
        market: 0;
        decimal: 2;
        prePrice: 11.75;
        details: [
          '14:56:18,12.93,49,6,1',
          '14:56:21,12.93,8,2,1',
          '14:56:24,12.93,44,4,1',
          '14:56:27,12.93,22,5,1',
          '14:56:30,12.93,16,3,1',
          '14:56:33,12.93,1,1,1',
          '14:56:36,12.93,9,3,1',
          '14:56:39,12.93,59,1,1',
          '14:56:42,12.93,30,5,1',
          '14:56:45,12.93,7,2,1',
          '14:56:51,12.93,36,8,1',
          '14:56:54,12.93,34,3,1',
          '14:57:00,12.93,29,4,1',
          '15:00:59,12.93,734,94,1'
        ];
      };
    }>(RandomEastmoneyUrl() + 'api/qt/stock/details/get', {
      searchParams: {
        secid,
        fields1: 'f1,f2,f3,f4',
        fields2: 'f51,f52,f53,f54,f55',
        forcect: 1,
        pos: -count,
        iscca: 1,
        invt: 2,
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
    return Object.values(body?.data?.details || {}).map((_) => {
      const [time, price, vol, tickets, up] = _.split(',');
      return {
        time,
        price: Number(price),
        vol: Number(vol),
        tickets: Number(tickets),
        up: Number(up) === 2 ? -1 : 1,
      };
    });
  } catch (error) {
    console.log(error);
    return [];
  }
}

export async function GetSelfRankFromEastmoney(code: string) {
  try {
    const { body } = await got<{
      rc: 0;
      rt: 6;
      svr: 182482210;
      lt: 1;
      full: 1;
      data: {
        total: 4512;
        diff: {
          f1: 2;
          f2: 29.7;
          f12: '600111';
          f13: 1;
          f14: '北方稀土';
          f109: 44.03;
          f124: 1625817579;
          f164: 3063965600.0;
          f165: 7.33;
          f166: 3728985920.0;
          f167: 8.92;
          f168: -665020320.0;
          f169: -1.59;
          f170: -1794846528.0;
          f171: -4.29;
          f172: -1269119136.0;
          f173: -3.04;
          f257: '-';
          f258: '-';
          f259: '-';
          [index: string]: any;
        }[];
      };
    }>('https://push2.eastmoney.com/api/qt/clist/get', {
      searchParams: {
        fields: 'f2,f3,f12,f13,f14,f62,f184,f225,f165,f263,f109,f175,f264,f160,f100,f124,f265,f1,f267,f164,f174',
        fid: code,
        po: 1,
        pz: 200,
        pn: 1,
        np: 1,
        fltt: 2,
        invt: 2,
        fs: 'm:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2,m:0+t:7+f:!2,m:1+t:3+f:!2',
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
    const billion = 10 ** 8;
    return (body?.data?.diff || []).map((_) => ({
      market: _.f13,
      code: _.f12,
      name: _.f14,
      secid: `${_.f13}.${_.f12}`,
      zllr: NP.divide(_[code], billion).toFixed(2),
      zdf: _.f3,
    }));
  } catch (error) {
    console.log(error);
    return [];
  }
}

export async function GetMainRankFromEastmoney(code: string) {
  try {
    const { body } = await got<{
      rc: 0;
      rt: 6;
      svr: 182482210;
      lt: 1;
      full: 1;
      data: {
        total: 4512;
        diff: {
          f1: 2;
          f2: 29.7;
          f12: '600111';
          f13: 1;
          f14: '北方稀土';
          f109: 44.03;
          f124: 1625817579;
          f164: 3063965600.0;
          f165: 7.33;
          f166: 3728985920.0;
          f167: 8.92;
          f168: -665020320.0;
          f169: -1.59;
          f170: -1794846528.0;
          f171: -4.29;
          f172: -1269119136.0;
          f173: -3.04;
          f257: '-';
          f258: '-';
          f259: '-';
          [index: string]: any;
        }[];
      };
    }>(RandomEastmoneyUrl() + 'api/qt/clist/get', {
      searchParams: {
        fields: 'f2,f3,f12,f13,f14,f62,f184,f225,f165,f263,f109,f175,f176,f264,f160,f100,f124,f265,f1',
        fid: code,
        po: 1,
        pz: 200,
        pn: 1,
        np: 1,
        fltt: 2,
        invt: 2,
        fs: 'm:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2,m:0+t:7+f:!2,m:1+t:3+f:!2',
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
    return (body?.data?.diff || []).map((_) => ({
      market: _.f13,
      code: _.f12,
      name: _.f14,
      secid: `${_.f13}.${_.f12}`,
      zljzb: _[code],
      zdf: _.f3,
    }));
  } catch (error) {
    console.log(error);
    return [];
  }
}

export async function GetABCompany(secid: string) {
  try {
    const [mk, code] = secid.split('.');
    const { body } = await got<{
      jbzl: {
        gsmc: '贵州茅台酒股份有限公司';
        ywmc: 'Kweichow Moutai Co.,Ltd.';
        cym: '贵州茅台->G茅台';
        agdm: '600519';
        agjc: '贵州茅台';
        bgdm: '--';
        bgjc: '--';
        hgdm: '--';
        hgjc: '--';
        zqlb: '上交所主板A股';
        sshy: '酿酒行业';
        ssjys: '上海证券交易所';
        sszjhhy: '制造业-酒、饮料和精制茶制造业';
        zjl: '李静仁(代)';
        frdb: '高卫东';
        dm: '刘刚';
        dsz: '高卫东';
        zqswdb: '蔡聪应';
        dlds: '章靖忠,许定波,陆金海';
        lxdh: '0851-22386002';
        dzxx: 'mtdm@moutaichina.com';
        cz: '0851-22386193';
        gswz: 'www.moutaichina.com';
        bgdz: '贵州省仁怀市茅台镇';
        zcdz: '贵州省仁怀市茅台镇';
        qy: '贵州';
        yzbm: '564501';
        zczb: '12.56亿';
        gsdj: '9152000071430580XT';
        gyrs: '29031';
        glryrs: '14';
        lssws: '北京市金杜律师事务所';
        kjssws: '天职国际会计师事务所(特殊普通合伙)';
        gsjj: '    贵州茅台酒股份有限公司是由中国贵州茅台酒厂有限责任公司、贵州茅台酒厂技术开发公司、贵州省轻纺集体工业联社、深圳清华大学研究院、中国食品发酵工业研究所、北京糖业烟酒公司、江苏省糖烟酒总公司、上海捷强烟草糖酒(集团)有限公司等八家公司共同发起,并经过贵州省人民政府黔府函字(1999)291号文件批准设立的股份有限公司。目前,贵州茅台酒股份有限公司茅台酒年生产量四万吨;43°、38°、33°茅台酒拓展了茅台酒家族低度酒的发展空间;茅台王子酒、茅台迎宾酒满足了中低档消费者的需求;15年、30年、50年、80年陈年茅台酒填补了我国极品酒、年份酒、陈年老窖的空白;在国内独创年代梯级式的产品开发模式。形成了低度、高中低档、极品三大系列200多个规格品种,全方位跻身市场,从而占据了白酒市场制高点,称雄于中国极品酒市场。';
        jyfw: '茅台酒系列产品的生产与销售;饮料、食品、包装材料的生产、销售;防伪技术开发、信息产业相关产品的研制、开发;酒店经营管理、住宿、餐饮、娱乐、洗浴及停车场管理服务(具体内容以工商核定登记为准)';
      };
      fxxg: {
        clrq: '1999-11-20';
        ssrq: '2001-08-27';
        fxsyl: '23.93';
        wsfxrq: '2001-07-31';
        fxfs: '网下定价发行';
        mgmz: '1.00';
        fxl: '7150万';
        mgfxj: '31.39';
        fxfy: '4842万';
        fxzsz: '22.44亿';
        mjzjje: '22.02亿';
        srkpj: '34.51';
        srspj: '35.55';
        srhsl: '56.83%';
        srzgj: '37.78';
        wxpszql: '--';
        djzql: '1.13%';
      };
      Code: 'SH600519';
      CodeType: 'ABStock';
      SecuCode: '600519.SH';
      SecurityCode: '600519';
      SecurityShortName: '贵州茅台';
      MarketCode: '01';
      Market: 'SH';
      SecurityType: null;
      ExpireTime: '/Date(-62135596800000)/';
    }>(`http://f10.eastmoney.com/CompanySurvey/CompanySurveyAjax?code=${mk === '0' ? 'sz' : 'sh'}${code}`, {
      responseType: 'json',
    });
    return {
      gsjs: body.jbzl.gsjj, // 公司介绍
      sshy: body.jbzl.sshy, // 所属行业
      dsz: body.jbzl.dsz, // 董事长
      zcdz: body.jbzl.zcdz, // 注册地址
      clrq: body.fxxg.clrq, // 成立日期
      ssrq: body.fxxg.ssrq, // 上市日期
    };
  } catch (error) {
    console.log(error);
    return defaultCompany;
  }
}

export async function GetHKCompany(secid: string) {
  try {
    const [mk, code] = secid.split('.');
    const { body } = await got<{
      zqzl: {
        zqdm: '01810.HK';
        zqjc: '小米集团-W';
        ssrq: '2018/7/9 0:00:00';
        zqlx: '非H股';
        jys: '香港交易所';
        bk: '主板';
        mgmz: '0.0000025 USD';
        zxjydw: '200';
        zxspj: '26.35';
        isin: 'KYG9830T1067';
        sfhgtbd: '是';
        sfsgtbd: '是';
      };
      gszl: {
        gsmc: '小米集团';
        ywmc: 'XIAOMI CORPORATION';
        zcd: 'Cayman Islands 开曼群岛（英属）';
        zcdz: 'PO Box 309, Ugland House, Grand Cayman, Cayman Islands';
        gsclrq: '2010-01-05';
        bgdz: '中国北京市海淀区清河中街68号华润五彩城写字楼,香港皇后大道东183号合和中心54楼';
        dsz: '雷军';
        gswz: 'www.mi.com';
        zczb: '675,000 USD';
        gsms: '苏嘉敏';
        njr: '12-31';
        email: 'xiaomi@hkstrategies.com';
        ygrs: '22,074';
        lxdh: '--';
        hss: '罗兵咸永道会计师事务所';
        cz: '+86 (10) 6060-6666';
        gsjs: '    小米集团是一家以手机、智能硬件和IoT平台为核心的互联网公司。公司的产品按照产品功能、形态及模式,大体上可以划分为智能手机、IoT和生活消费产品、互联网服务产品。作为一家由工程师和设计师创建的公司,小米集团崇尚大胆创新的互联网文化,并不断探索前沿科技。创新精神在小米蓬勃发展并渗透到每个角落,并引导小米集团所做的一切。同时,小米集团不懈追求效率的持续提升。小米集团致力於降低运营成本,并同时把效率提升产生的价值回馈给小米集团的用户。小米集团独特且强大的铁人三项商业模式由三个相互协作的支柱组成(1)创新、高质量、精心设计且专注於卓越用户体验的硬件,(2)使小米集团能以厚道的价格销售产品的高效新零售和(3)丰富的互联网服务。';
        sshy: '资讯科技器材';
      };
    }>(`http://emweb.securities.eastmoney.com/PC_HKF10/CompanyProfile/PageAjax?code=${code}`, {
      responseType: 'json',
    });
    return {
      gsjs: body.gszl.gsjs,
      sshy: body.gszl.sshy, // 所属行业
      dsz: body.gszl.dsz, // 董事长
      zcdz: body.gszl.zcdz, // 注册地址
      clrq: body.gszl.gsclrq, // 成立日期
      ssrq: body.zqzl.ssrq, // 上市日期
    };
  } catch (error) {
    console.log(error);
    return defaultCompany;
  }
}

export async function GetUSCompany(secid: string) {
  try {
    const [mk, code] = secid.split('.');
    const { body } = await got<{
      data: {
        zqzl: [
          {
            SECURITYCODE: 'TSLA.O';
            SECURITYSHORTNAME: '特斯拉';
            ISINCODE: 'US88160R1014';
            SECURITYTYPE: '美股';
            TRADEMARKET: 'NASDAQ';
            LISTEDDATE: '2010-06-29';
            FISCALDATE: '12-31';
            PARVALUE: '0.001 USD';
            ADSZS: '--';
          }
        ];
        gszl: [
          {
            SECURITYCODE: 'TSLA.O';
            SECURITYSHORTNAME: '特斯拉';
            COMPNAME: 'Tesla, Inc.';
            COMPNAMECN: '特斯拉公司';
            INDUSTRY: '汽车制造商';
            SHAREH: '--';
            CAPITAL: '--';
            CHAIRMAN: 'Robyn M. Denholm';
            SECY: '--';
            FOUNDDATE: '2003-07-01';
            EMPLOYNUM: '70757';
            MAINBUSIN: '--';
            ADDRESS: '美国特拉华州';
            OFFICEADDRESS: '3500 Deer Creek Road, Palo Alto, California, USA';
            WEBSITE: 'www.tesla.com';
            EMAIL: 'NASales@tesla.com';
            PHONE: '+1 (650) 681-5000';
            FAX: '+1 (650) 681-5101';
            COMPPROFILE: '    特斯拉公司是一家美国电动汽车及能源公司,2003年7月1日,由马丁·艾伯哈德和马克·塔彭宁共同创立。特斯拉设计、开发、制造、销售和租赁高性能全电动汽车和能源发电和存储系统,并提供与其产品相关的服务。特斯拉是全球首家垂直整合的可持续能源公司,提供端到端的清洁能源产品,包括发电、存储和消费。\n    特斯拉目前或正计划推出电动汽车,以满足广泛的消费和商用车市场,包括Model 3、Model Y、Model S、Model X、Cybertruck、Tesla Semi和一款新的Tesla Roadster。结合其动力系统、自动驾驶和全自动驾驶(“FSD”)硬件和神经网络的技术进步,其电动汽车拥有领先里程和充电灵活性等优势;优越的加速、操控和安全特性;一套独特的方便用户和信息娱乐功能;通过无线更新启用额外功能的能力;以及节省充电、维护和其他拥有成本。';
          }
        ];
        zygc_bgq: [
          {
            SECURITYCODE: 'TSLA.O';
            REPORTDATE: '2021-06-30';
          }
        ];
        zygc_cp: [
          {
            SECURITYCODE: 'TSLA.O';
            SECURITYSHORTNAME: '特斯拉';
            REPORTDATE: '2021-06-30';
            STARTDATE: '2021-01-01';
            CURRENCY: 'USD';
            CLASS: '1';
            RANK: '1';
            PRODUCTNAME: 'Automotive sales without resale value guarantee';
            MBREVENUE: '17345000000';
            RATIO: '77.6166823287242';
          }
        ];
        zygc_dq: [
          {
            SECURITYCODE: 'TSLA.O';
            SECURITYSHORTNAME: '特斯拉';
            REPORTDATE: '2021-06-30';
            STARTDATE: '2021-01-01';
            CURRENCY: 'USD';
            CLASS: '1';
            RANK: '1';
            REGIONNAME: 'United States';
            MBREVENUE: '9629000000';
            RATIO: '43.0885577482436';
          }
        ];
        ggyj: [
          {
            SECURITYCODE: 'TSLA.O';
            SECURITYSHORTNAME: '特斯拉';
            NAMEEN: 'Robyn M. Denholm';
            SEX: '女';
            EDUCATION: '博士';
            BIRTHDATE: '1964';
            OCCUPATION: 'Independent Director，Chairman of the Board';
            RESUME: '--';
            RESUMEEN: 'Robyn Denholm has been a member of the Board since August 2014 and its Chair since November 2018. Since January 2021, Ms. Denholm has been an operating partner of Blackbird Ventures, a venture capital firm. From January 2017 through June 2019, Ms. Denholm was with Telstra Corporation Limited, a telecommunications company (“Telstra”), where she served as Chief Financial Officer and Head of Strategy from October 2018 through June 2019, and Chief Operations Officer from January 2017 to October 2018. Prior to Telstra, from August 2007 to July 2016, Ms. Denholm was with Juniper Networks, Inc., a manufacturer of networking equipment, serving in executive roles including Executive Vice President, Chief Financial Officer and Chief Operations Officer. Prior to joining Juniper Networks, Ms. Denholm served in various executive roles at Sun Microsystems, Inc. from January 1996 to August 2007. Ms. Denholm also served at Toyota Motor Corporation Australia for seven years and at Arthur Andersen & Company for five years in various finance assignments. Ms. Denholm previously served as a director of ABB Ltd. from 2016 to 2017. Ms. Denholm is a Fellow of the Institute of Chartered Accountants of Australia/New Zealand, a member of the Australian Institute of Company Directors, and holds a Bachelor’s degree in Economics from the University of Sydney, and a Master’s degree in Commerce and a Doctor of Business Administration (honoris causa) from the University of New South Wales.';
            TOTALCOUNT: '12';
          }
        ];
      };
    }>(`http://emweb.eastmoney.com/pc_usf10/CompanyInfo/PageAjax?fullCode=${code}.O`, {
      responseType: 'json',
    });
    return {
      gsjs: body.data.gszl[0].COMPPROFILE,
      sshy: body.data.gszl[0].INDUSTRY, // 所属行业
      dsz: body.data.gszl[0].CHAIRMAN, // 董事长
      zcdz: body.data.gszl[0].ADDRESS, // 注册地址
      clrq: body.data.gszl[0].FOUNDDATE, // 成立日期
      ssrq: body.data.zqzl[0].LISTEDDATE, // 上市日期
    };
  } catch (error) {
    console.log(error);
    return defaultCompany;
  }
}

export async function GetXSBCompany(secid: string) {
  try {
    const [mk, code] = secid.split('.');
    const { body: html } = await got(`http://xinsanban.eastmoney.com/F10/CompanyInfo/Introduction/${code}.html`);
    const $ = cheerio.load(html);
    const gsjs = $("span:contains('公司简介')").next().text();
    const sshy = $("span:contains('行业分类')").next().text();
    const dsz = $("span:contains('法人代表')").next().text();
    const zcdz = $("span:contains('注册地址')").next().text();
    const clrq = $("span:contains('成立日期')").next().text();
    const ssrq = $("span:contains('挂牌日期')").next().text();

    return {
      gsjs,
      sshy,
      dsz,
      zcdz,
      clrq,
      ssrq,
    };
  } catch (error) {
    console.log(error);
    return defaultCompany;
  }
}

export async function GetBankuaiStocksFromEastmoney(secid: string, count = 20) {
  const { body } = await got<{
    data: {
      total: 17;
      diff: {
        0: {
          f1: 2;
          f2: 21.07;
          f3: 24.82;
          f4: 4.19;
          f5: 216240;
          f6: 418828272;
          f7: 32.58;
          f8: 57.7;
          f9: 60.4;
          f10: 1.75;
          f11: -0.61;
          f12: '301083';
          f13: 0;
          f14: 'C百胜';
          f15: 22.87;
          f16: 17.37;
          f17: 17.68;
          f18: 16.88;
          f20: 3747650674;
          f21: 789594942;
          f22: -2.45;
          f23: 5.25;
          f24: 132.05;
          f25: 132.05;
          f45: 46538124.31;
          f62: 26481287;
          f115: 55.82;
          f128: '-';
          f136: '-';
          f140: '-';
          f141: '-';
          f152: 2;
        };
      };
    };
  }>(RandomEastmoneyUrl() + 'api/qt/clist/get', {
    searchParams: {
      fs: `b:${secid.substr(3)}`,
      pn: 1, // 页索引
      pz: count, // 页大小
      po: 1, // 排序方向
      fid: 'f3', // 排序字段
      invt: 2,
      forcect: 1,
      fields: 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f24,f25,f22,f11,f62,f128,f136,f115,f152,f45',
      ut: Utils.MakeHash(),
      _: new Date().getTime(),
    },
    responseType: 'json',
  });
  try {
    const stocks = Object.values(body?.data?.diff || {}).map((_) => ({
      code: _.f12,
      name: _.f14,
      secid: `${_.f13}.${_.f12}`,
      zx: _.f2 / 100.0,
      zdf: _.f3 / 100.0,
      zdd: _.f4,
      cjl: _.f5,
      cje: _.f6,
      zf: _.f7,
      zg: _.f15,
      zd: _.f16,
      jk: _.f17,
      zs: _.f18,
      lb: _.f10,
      hsl: _.f8,
      syl: _.f9,
      sjl: _.f23,
      sz: _.f20,
      lt: _.f21,
      cm5: _.f11,
      cd60: _.f24,
      cy1: _.f25,
      cs: _.f22,
    }));
    return { total: body.data.total, stocks: stocks };
  } catch (error) {
    console.log(error);
    return { total: 0, stocks: [] };
  }
}


export async function GetGubaCode(secid: string) {
  try {
    const jquery = 'codecenterget';
    const { body } = await got<
      // {
      //   innerCode: 33699679157578;
      //   market: 0;
      //   smallType: 6;
      //   code: "002941";
      //   shortName: "新疆交建";
      //   pinYin: "XJJJ";
      //   status: 10;
      //   flag: 0;
      // }
    string
    >('https://quote.eastmoney.com/unify/codecenter/' + secid + '.js', {
      searchParams: {
        callback: jquery,
        _: new Date().getTime(),
      },
      // responseType: 'json',
    });
    const rawStr = body.substring(jquery.length + 1, body.length - 1);
    const json = JSON.parse(rawStr) as {
      innerCode: number;
    };
    return json.innerCode;
  } catch (error) {
    console.log(error);
    return 0;
  }
}

export async function GetWebArticleList(code: number, pageIndex: number, pageSize = 20) {
  try {
    const jquery = 'qa_wap_jsonpCB1688007189688';
    const { body } = await got<
    // {
    //   "bar_info": {
    //     "InnerCode": "gs80329323",
    //     "SpeedCode": ["a17195", "gs80329323", "002941", "33699679157578"],
    //     "TopicCode": "",
    //     "StockCode": "002941",
    //     "CompanyCode": "80329323",
    //     "Division": 1,
    //     "Category": 100,
    //     "Market": 101,
    //     "Type": [200],
    //     "ShortName": "新疆交建",
    //     "BarType": 0,
    //     "QuoteCode": "0029412",
    //     "SearchType": 1,
    //     "ShowCode": "002941",
    //     "RelatedInnerCode": "002941",
    //     "RelatedName": "",
    //     "RelatedCode": "",
    //     "CodeWithMarket": "002941.sz",
    //     "RelatedCode2": "002941",
    //     "QuoteInnerCode": 33699679157578,
    //     "QMarket": 0,
    //     "QCode": "002941",
    //     "Status": 10,
    //     "BkCode": null,
    //     "OuterCode": "002941",
    //     "OType": 0,
    //     "MC": "002941.sz",
    //     "GT": "2"
    // },
    // "re": [{
    //   "post_is_like": false,
    //   "post_is_collected": false,
    //   "post_status": 0,
    //   "source_post_id": 0,
    //   "source_post_state": 0,
    //   "source_post_user_id": "",
    //   "source_post_user_nickname": "",
    //   "source_post_user_type": 0,
    //   "source_post_user_is_majia": false,
    //   "source_post_user_extendinfos": {},
    //   "source_post_pic_url": [],
    //   "source_post_title": "",
    //   "source_post_content": "",
    //   "source_post_ip": "",
    //   "source_post_type": 0,
    //   "source_post_guba": {
    //       "stockbar_type": 0,
    //       "stockbar_code": "",
    //       "stockbar_inner_code": "",
    //       "stockbar_name": "",
    //       "stockbar_market": "",
    //       "stockbar_quote": 0,
    //       "stockbar_exchange": 0,
    //       "stockbar_external_code": ""
    //   },
    //   "source_post_from": "股吧网页版",
    //   "source_post_like_count": 0,
    //   "source_comment_count": "",
    //   "selected_post_code": "",
    //   "selected_post_name": "",
    //   "selected_relate_guba": [],
    //   "source_extend": {},
    //   "source_post_source_id": "",
    //   "zwpage_flag": 0,
    //   "source_post_comment_count": 0,
    //   "post_from_num": 31,
    //   "content_type": 0,
    //   "media_type": 0,
    //   "post_content": "$新疆交建(SZ002941)$今天很猛，估计要涨停，拿好，十倍大牛股！",
    //   "post_abstract": "",
    //   "post_publish_time": "2023-06-29 09:33:52",
    //   "post_display_time": "2023-06-29 09:33:52",
    //   "post_ip": "",
    //   "post_state": 0,
    //   "post_checkState": 0,
    //   "post_forward_count": 0,
    //   "post_comment_authority": 0,
    //   "post_like_count": 2,
    //   "post_type": 0,
    //   "post_source_id": "",
    //   "post_top_status": 0,
    //   "post_from": "东方财富iPhone版",
    //   "post_has_pic": false,
    //   "post_pic_url": [],
    //   "ask_question": "",
    //   "ask_answer": "",
    //   "qa": null,
    //   "extend": null,
    //   "post_pic_url2": [],
    //   "relate_topic": {
    //       "id": "",
    //       "name": "",
    //       "h5_url": "",
    //       "guide": "",
    //       "version": 0
    //   },
    //   "post_atuser": [],
    //   "reply_list": [{
    //     "reply_id": 9399198820,
    //     "reply_user": {
    //         "user_id": "3988645203018656",
    //         "user_nickname": "对不住",
    //         "user_name": "f3988645203018656",
    //         "user_v": 0,
    //         "user_type": 0,
    //         "user_is_majia": false,
    //         "user_level": 0,
    //         "user_first_en_name": "对不住",
    //         "user_age": "5.4年",
    //         "user_influ_level": 6,
    //         "user_black_type": 0,
    //         "user_third_intro": null,
    //         "user_bizflag": "2",
    //         "user_bizsubflag": "001001",
    //         "passport_medal_details": {
    //             "medal_list": [],
    //             "medal_count": 0
    //         },
    //         "user_extendinfos": {
    //             "user_accreditinfos": null,
    //             "deactive": "0",
    //             "user_v_hide": null,
    //             "user_column": "0",
    //             "is_enterprise": "false"
    //         }
    //     },
    //     "reply_ar": "上海网友",
    //     "reply_time": "2023-06-29 10:49:28",
    //     "reply_text": "怎么一个赞都没有，开盘给的建议，有几个人听了 ",
    //     "source_reply": [],
    //     "reply_picture": "",
    //     "reply_is_author": true
    //   }],
    //   "repost_state": 0,
    //   "modules": [],
    //   "spec_column": "",
    //   "post_mod_time": null,
    //   "reptile_state": 0,
    //   "allow_likes_state": 0,
    //   "post_id": 1325600801,
    //   "post_user": {
    //       "user_id": "5294426842937618",
    //       "user_nickname": "股友K12239388L",
    //       "user_name": "c5294426842937618",
    //       "user_v": 0,
    //       "user_type": 0,
    //       "user_is_majia": false,
    //       "user_level": 0,
    //       "user_first_en_name": "股友K12239388L",
    //       "user_age": "1个月",
    //       "user_influ_level": 0,
    //       "user_black_type": 0,
    //       "user_third_intro": null,
    //       "user_bizflag": "",
    //       "user_bizsubflag": "",
    //       "passport_medal_details": {
    //           "medal_list": [],
    //           "medal_count": 0
    //       },
    //       "user_extendinfos": {
    //           "user_accreditinfos": null,
    //           "deactive": "0",
    //           "user_v_hide": null,
    //           "user_column": "0",
    //           "is_enterprise": "false"
    //       }
    //   },
    //   "post_guba": {
    //       "stockbar_type": 100,
    //       "stockbar_code": "002941",
    //       "stockbar_inner_code": "gs80329323",
    //       "stockbar_name": "新疆交建吧",
    //       "stockbar_market": "002941.sz",
    //       "stockbar_quote": 1,
    //       "stockbar_exchange": 101,
    //       "stockbar_external_code": "002941"
    //   },
    //   "post_title": "",
    //   "post_last_time": "2023-06-29 10:37:36",
    //   "post_click_count": 16,
    //   "post_comment_count": 0,
    //   "post_address": null
    // }],
    // "hot_articles": [],
    // "apis": 0,
    // "bar_rank": 972,
    // "stockbar_fans_count": 0,
    // "popularity": null,
    // "ret": [],
    // "ret_ad": [],
    // "ret_ad_type": [],
    // "count": 109377,
    // "bar_name": null,
    // "bar_code": null,
    // "bar_quot_code": null,
    // "stockbar_desc": null,
    // "intelligent_reply": 3,
    // "classic_reply": 2,
    // "cachetag": null,
    // "rc": 1,
    // "me": "操作成功",
    // "time": "2023-06-29T10:53:05.20228+08:00"
    // }
    string
    >('https://gbapi.eastmoney.com/webarticlelist/api/Article/WebArticleList', {
      searchParams: {
        code,
        p: pageIndex,
        ps: pageSize,
        sorttype: 1,
        plat: 'wap',
        version: 300,
        product: 'guba',
        deviceid: 1,
        h: '1f138c53de0f2bfa460b5f45e5a5703f',
        callback: jquery,
        ctoken: '',
        utoken: ''
      },
      // responseType: 'json',
    });
    const rawStr = body.substring(jquery.length + 1, body.length - 1);
    const json = JSON.parse(rawStr) as {
      re: [
        {
          post_content: string;
          post_publish_time: string;
          post_user: {
            user_nickname: string;
            user_age: string;
          },
          reply_list: [
            {
              reply_user: {
                user_nickname: string;
                user_age: string;
              },
              reply_ar: string;
              reply_time: string;
              reply_text: string;
              reply_is_author: boolean;
            }
          ],
          post_id: number;
        }
      ];
    };
    const list = json.re.map((c) => {
      const replies = c.reply_list.map((r) => {
          return {
            userNick: r.reply_user.user_nickname,
            userAge: r.reply_user.user_age,
            userArea: r.reply_ar,
            isAuthor: r.reply_is_author,
            time: r.reply_time,
            text: r.reply_text
          } as Stock.CommentReply;
      });
      return {
        url: 'https://mguba.eastmoney.com/mguba/article/0/' + c.post_id,
        content: c.post_content,
        time: c.post_publish_time,
        userNick: c.post_user.user_nickname,
        userAge: c.post_user.user_age,
        replies
      } as Stock.Comment;
    });
    return {p: pageIndex, list};
  } catch (error) {
    console.log(error);
    return {p: pageIndex, list: []};
  }
}

export async function GetNews(secid: string, pageIndex: number, pageSize = 20) {
  try {
    const { body } = await got<{
      code: 1;
      data: {
        list: [
          {
            Art_Code: '202111262195007460';
            Art_Image: '';
            Art_MediaName: '每日经济新闻';
            Art_OriginUrl: 'http://finance.eastmoney.com/news/1354,202111262195007460.html';
            Art_ShowTime: '2021-11-26 17:37:59';
            Art_SortStart: '1637919479007460';
            Art_Title: '美锦能源：董监高经综合考虑 决定提前终止本次减持计划';
            Art_Url: 'http://finance.eastmoney.com/a/202111262195007460.html';
            Art_VideoCount: 0;
          }
        ];
        page_index: 1;
        page_size: 20;
        totle_hits: 552;
      };
    }>('https://np-listapi.eastmoney.com/comm/wap/getListInfo', {
      searchParams: {
        client: 'wap',
        type: 1,
        mTypeAndCode: secid,
        pageIndex,
        pageSize,
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
    return body.data.list.map((_) => {
      return {
        newsid: _.Art_Code,
        title: _.Art_Title,
        url: _.Art_Url,
        time: _.Art_ShowTime,
      };
    });
  } catch (error) {
    console.log(error);
    return [];
  }
}

export async function GetNewsBrief(newsid: string) {
  try {
    const { body } = await got<{
      me: '操作成功';
      rc: 1;
      re: [
        {
          collect_state: 0;
          like_state: 0;
          post_click_count: 3558;
          post_comment_count: 76;
          post_forward_count: 39;
          post_id: 1112106131;
          post_like_count: 0;
          post_sourceid_id: '202111262195007460';
          post_state: 0;
          post_type: 0;
          post_uid: '5604113638188434';
          post_yuan_id: 0;
          repost_state: 0;
          stockbar_code: '000723';
          user_follow: 0;
        }
      ];
    }>('https://gbapi.eastmoney.com/abstract/api/PostShort/ArticleBriefInfo', {
      searchParams: {
        plat: 'wap',
        product: 'eastmoney',
        type: 1,
        version: 2,
        postid: newsid,
        deviceid: Utils.MakeHash(),
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
    return {
      postid: body.re[0].post_id,
    };
  } catch (error) {
    console.log(error);
    return {};
  }
}

export async function GetNewsContent(postid: string, newsid: string) {
  try {
    const { body } = await got<{
      me: '操作成功';
      rc: 1;
      post: {
        post_abstract: '美锦能源(SZ000723，收盘价：13.56元)11月26日晚间发布公告称，2021';
        post_content: '<div data-type="abstract" data-abstract="美锦能源(SZ000723"';
        post_publish_time: '2021-11-26 17:37:59';
      };
    }>('https://gbapi.eastmoney.com/content/api/Post/ArticleContent', {
      searchParams: {
        product: 'eastmoney',
        plat: 'wap',
        version: 2,
        postid,
        newsid,
        deviceid: Utils.MakeHash(),
        _: '07779',
      },
      responseType: 'json',
    });
    return {
      abstract: body.post.post_abstract,
      content: body.post.post_content,
    };
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 获取必读指标
export async function GetStockStatics(code: string, page = 1) {
  try {
    const { body } = await got<{
      code: 0;
      message: 'ok';
      success: true;
      result: {
        pages: 1;
        count: 1;
        data: [
          [
            {
              ALLOWANCE_NPL: null;
              ALLOWANCE_NPL_SOURCE: '暂未披露';
              ASE_SOURCE: '暂未披露';
              A_SHARES_EQUITY: null;
              BSE_SOURCE: '暂未披露';
              BVPS: 6.502441202751;
              BVPS_SOURCE: '2022-4-15公告股东权益/总股本';
              B_SHARES_EQUITY: null;
              B_UNIT: null;
              CAPITAL_ADEQUACY_RATIO: null;
              CAR_SOURCE: '暂未披露';
              CCR_SOURCE: '暂未披露';
              CDR_CONVERT_RATIO: null;
              CDR_SHARE: null;
              CDR_SHARE_SOURCE: '暂未披露';
              COMMNREVE: null;
              COMMNREVE_SOURCE: '暂未披露';
              COMMNREVE_YOY: null;
              COMMNREVE_YOY_SOURCE: '暂未披露';
              COMPENSATE_EXPENSE: null;
              COMPENSATE_EXPENSE_SOURCE: '暂未披露';
              DATE_TYPE: '2022一季报';
              DEBT: 75.3859358396;
              DEBT_SOURCE: '2022一季报';
              EARNED_PREMIUM: null;
              EARNED_PREMIUM_SOURCE: '暂未披露';
              EPS: 0.89633408079;
              EPS_SOURCE: '2022一季报净利润/总股本';
              EQUITY_NEW_REPORT: 11937787854.13;
              FAS_SOURCE: '2022-1-12公告';
              FBS_SOURCE: '暂未披露';
              FREE_A_SHARES: 1714558117;
              FREE_B_SHARES: null;
              GOODWILL: 86713377.25;
              GOODWILL_SOURCE: '2022一季报';
              GPR_SOURCE: '2022一季报';
              GROSS_PROFIT_RATIO: 19.5308991758;
              IS_PROFIT: '0';
              IS_VOTE_DIFF: '0';
              LISTING_STATE: '0';
              MARKETCAP_A: null;
              MARKETCAP_B: null;
              MARKETCAP_FREE_A: 61809820118;
              MARKETCAP_FREE_B: 61809820118;
              MCA_SOURCE: '最新股价x最新A股股本';
              MCB_SOURCE: '最新股价x最新B股股本';
              MCFA_SOURCE: '最新股价x最新流通A股';
              MCFB_SOURCE: '最新股价x最新流通B股';
              NETPROFIT: 1645573680.6;
              NETPROFIT_RATIO: 186.152004645072;
              NETPROFIT_RATIO_SOURCE: '2022一季报';
              NETPROFIT_SOURCE: '2022一季报';
              NPL: null;
              NPL_SOURCE: '暂未披露';
              NPR: 12.7035293962;
              NPR_SOURCE: '2022一季报';
              OIR_SOURCE: '2022一季报';
              OPERATE_INCOME_RATIO: 13.280783757;
              ORG_CODE: '10002320';
              ORG_TYPE: '4';
              PB_MRQ_REALTIME: 5.54;
              PB_NEW_NOTICE: 5.54;
              PB_NOTICE_SOURCE: '总市值/2022-4-15公告股东权益';
              PE_DYNAMIC: 10.05;
              PE_DYNAMIC_SOURCE: '总市值/预估2022全年净利润';
              PE_STATIC: 18.17;
              PE_TTM: 14.04;
              PLEDGE_RATIO: 8.44;
              PLEDGE_RATIO_SOURCE: '2022-7-1中登数据';
              RESEARCH_EXPENSE: null;
              RESEARCH_EXPENSE_SOURCE: '暂未披露';
              RESEARCH_NUM: null;
              RESEARCH_NUM_RATIO: null;
              RESEARCH_NUM_SOURCE: '暂未披露';
              RNR_SOURCE: '暂未披露';
              ROE: 14.86;
              ROE_SOURCE: '2022一季报';
              RSEXPENSE_RATIO: null;
              RSEXPENSE_RATIO_SOURCE: '暂未披露';
              SECUCODE: '600096.SH';
              SECURITYTYPE: '058001001';
              SECURITY_CODE: '600096';
              SECURITY_NAME_ABBR: '云天化';
              SOLVENCY_AR: null;
              SOLVENCY_AR_SOURCE: '暂未披露';
              SRL_SOURCE: '暂未披露';
              SURRENDER_RATE_LIFE: null;
              TMC_SOURCE: '最新股价x最新总股本';
              TOI_SOURCE: '2022一季报';
              TOTAL_MARKET_CAP: 66183951338;
              TOTAL_OPERATE_INCOME: 14961960200.98;
              TOTAL_SHARES: 1835893241;
              TOTAL_SHARES_SOURCE: '2022-1-12公告';
              TRADEMARKET: '069001001001';
              f2: 36.05;
              f18: 33.42;
            }
          ]
        ];
      };
      hasNext: 1;
    }>('https://datacenter.eastmoney.com/securities/api/data/v1/get', {
      searchParams: {
        reportName: 'RPT_DMSK_NEWINDICATOR',
        columns:
          'SECUCODE,SECURITY_CODE,ORG_CODE,SECURITY_NAME_ABBR,EPS,BVPS,TOTAL_OPERATE_INCOME,OPERATE_INCOME_RATIO,NETPROFIT,NETPROFIT_RATIO,GROSS_PROFIT_RATIO,NPR,ROE,DEBT,CAPITAL_ADEQUACY_RATIO,NPL,ALLOWANCE_NPL,COMMNREVE,COMMNREVE_YOY,EARNED_PREMIUM,COMPENSATE_EXPENSE,SURRENDER_RATE_LIFE,SOLVENCY_AR,RESEARCH_EXPENSE,RSEXPENSE_RATIO,RESEARCH_NUM,RESEARCH_NUM_RATIO,TOTAL_SHARES,A_SHARES_EQUITY,FREE_A_SHARES,PLEDGE_RATIO,GOODWILL,CDR_SHARE,CDR_CONVERT_RATIO,MARKETCAP_A,B_SHARES_EQUITY,MARKETCAP_B,FREE_B_SHARES,B_UNIT,SECURITYTYPE,TRADEMARKET,DATE_TYPE,IS_PROFIT,ORG_TYPE,IS_VOTE_DIFF,LISTING_STATE,PE_DYNAMIC_SOURCE,PB_NOTICE_SOURCE,EPS_SOURCE,BVPS_SOURCE,TOI_SOURCE,OIR_SOURCE,NETPROFIT_SOURCE,NETPROFIT_RATIO_SOURCE,GPR_SOURCE,NPR_SOURCE,ROE_SOURCE,DEBT_SOURCE,NPL_SOURCE,ALLOWANCE_NPL_SOURCE,CAR_SOURCE,COMMNREVE_SOURCE,COMMNREVE_YOY_SOURCE,EARNED_PREMIUM_SOURCE,COMPENSATE_EXPENSE_SOURCE,SRL_SOURCE,SOLVENCY_AR_SOURCE,RESEARCH_EXPENSE_SOURCE,RSEXPENSE_RATIO_SOURCE,RESEARCH_NUM_SOURCE,RNR_SOURCE,TOTAL_SHARES_SOURCE,TMC_SOURCE,CDR_SHARE_SOURCE,CCR_SOURCE,ASE_SOURCE,FAS_SOURCE,MCFA_SOURCE,PLEDGE_RATIO_SOURCE,MCA_SOURCE,GOODWILL_SOURCE,BSE_SOURCE,MCB_SOURCE,FBS_SOURCE,MCFB_SOURCE,EQUITY_NEW_REPORT',
        quoteColumns:
          'f9~01~SECURITY_CODE~PE_DYNAMIC,f23~01~SECURITY_CODE~PB_NEW_NOTICE,f20~01~SECURITY_CODE~TOTAL_MARKET_CAP,f21~01~SECURITY_CODE~MARKETCAP_FREE_B,f114~01~SECURITY_CODE~PE_STATIC,f115~01~SECURITY_CODE~PE_TTM,f21~01~SECURITY_CODE~MARKETCAP_FREE_A,f2~01~SECURITY_CODE~f2,f18~01~SECURITY_CODE~f18',
        filter: `(SECUCODE = "${code}.${code.startsWith('6') ? 'SH' : 'SZ'}")`,
        pageNumber: 1,
        pageSize: 200,
        v: '0719832498022196',
      },
      responseType: 'json',
    });
    return body.result.count > 0 ? body.result.data[0] : {};
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 获取公司概况
export async function GetStockOverview(code: string, page = 1) {
  try {
    const { body } = await got<{
      code: 0;
      message: 'ok';
      result: {
        pages: 1;
        count: 1;
        data: [
          {
            ACCOUNT_FIRM: '信永中和会计师事务所(特殊普通合伙)';
            ADDRESS: '云南省昆明市滇池路1417号';
            BLGAINIAN: '煤化工,化工原料,新材料,机构重仓,预盈预增,锂电池,上证180_,氟化工,中证500,沪股通,一带一路,MSCI中国,碳交易,磷化工';
            CHAIRMAN: '段文瀚';
            CURRENCY: 'CNY';
            EM2016: '基础化工-化肥农药-磷肥';
            EXPAND_NAME_ABBR: null;
            FORMERNAME: '云天化→G云天化';
            FOUND_DATE: '1997-07-02 00:00:00';
            LEGAL_ADVISER: '北京德恒(昆明)律师事务所';
            LEGAL_PERSON: '段文瀚';
            MAIN_BUSINESS: '化肥、化工原料及产品的生产、销售。';
            ORG_EMAIL: 'zqb@yth.cn';
            ORG_NAME: '云南云天化股份有限公司';
            ORG_PROFIE: '    云南云天化股份有限公司(简称云天化股份),是全球优秀的化肥、玻璃纤维、聚甲醛等产品的生产商,也是中国的磷矿采选企业。1997年,云天化股份由云天化集团有限责任公司独家发起组建并在上海证券交易所挂牌上市(证券代码600096)。利用上市后有利的发展机遇,云天化股份由原来单一的氮肥产业拓展到有机化工、玻纤新材料等领域,生产企业分布国内外,初步实现了产业多元化。2013年5月,云天化集团将集团内的磷矿、磷肥、磷化工、商贸物流以及公用工程等优良资产重组装入云天化股份,实现了集团主营业务整体上市。资产重组完成后,云天化股份拥有了化肥、有机化工、玻纤新材料、磷矿采选和磷化工五大产业以及商贸物流业务板块,成为云天化集团旗下最具竞争力的控股公司。随即,云天化股份本部由水富县迁至昆明市滇池路1417号。云天化股份拥有13户主要的成员企业,在云南、重庆、青海等10余个省市及南美洲巴西地区建有生产基地,在欧洲、美洲、中东、东南亚等地区设立了销售公司。';
            ORG_TEL: '0871-64327127,0871-64327128';
            ORG_WEB: 'www.yyth.com.cn';
            PRESIDENT: '崔周全';
            REGIONBK: '云南省';
            REG_ADDRESS: '云南省昆明市滇池路1417号';
            REG_CAPITAL: 183589.3241;
            SECRETARY: '钟德红';
            SECUCODE: '600096.SH';
            SECURITY_CODE: '600096';
            SECURITY_NAME_ABBR: '云天化';
            SECURITY_TYPE_CODE: '058001001';
            STR_CODEA: '600096.SH';
            STR_CODEB: null;
            STR_CODEH: null;
            STR_NAMEA: '云天化';
            STR_NAMEB: null;
            STR_NAMEH: null;
            TATOLNUMBER: 22;
            TOTAL_NUM: 11379;
          }
        ];
      };
      hasNext: 1;
    }>('https://datacenter.eastmoney.com/securities/api/data/get', {
      searchParams: {
        type: 'RPT_F10_ORG_BASICINFO',
        sty: 'SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,ORG_NAME,FORMERNAME,STR_CODEH,STR_NAMEH,STR_CODEA,STR_NAMEA,STR_CODEB,STR_NAMEB,REGIONBK,EM2016,BLGAINIAN,CHAIRMAN,LEGAL_PERSON,PRESIDENT,SECRETARY,FOUND_DATE,REG_CAPITAL,TOTAL_NUM,TATOLNUMBER,ORG_TEL,ORG_EMAIL,ORG_WEB,ADDRESS,REG_ADDRESS,ORG_PROFIE,MAIN_BUSINESS,SECURITY_TYPE_CODE,CURRENCY,ACCOUNT_FIRM,LEGAL_ADVISER,EXPAND_NAME_ABBR',
        filter: `(SECUCODE = "${code}.${code.startsWith('6') ? 'SH' : 'SZ'}")`,
        source: 'SECURITIES',
        client: 'APP',
        v: '0719832498022196',
      },
      responseType: 'json',
    });
    return body.result.count > 0 ? body.result.data[0] : {};
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 经营分析: https://emh5.eastmoney.com/html/?fc=60009601&color=w#/gsgk
export async function GetStockMainOp(code: string, page = 1) {
  try {
    const { body } = await got<{
      code: 0;
      message: 'ok';
      result: {
        pages: 1;
        count: 26;
        data: [
          {
            GROSS_RPOFIT_RATIO: 0.014127;
            ITEM_NAME: '商贸物流行业';
            MAINOP_TYPE: '1';
            MAIN_BUSINESS_INCOME: 36859714894.95;
            MBI_RATIO: 0.582769;
            ORG_CODE: '10002320';
            REPORT_DATE: '2021-12-31 00:00:00';
            REPORT_NAME: '2021年报';
            SECUCODE: '600096.SH';
            SECURITY_CODE: '600096';
            SECURITY_NAME_ABBR: '云天化';
          }
        ];
      };
      hasNext: 1;
    }>('https://datacenter.eastmoney.com/securities/api/data/get', {
      searchParams: {
        type: 'RPT_F10_FN_MAINOP',
        sty: 'SECURITY_CODE,SECUCODE,SECURITY_NAME_ABBR,ORG_CODE,MAINOP_TYPE,REPORT_DATE,REPORT_NAME,ITEM_NAME,MAIN_BUSINESS_INCOME,MBI_RATIO,GROSS_RPOFIT_RATIO',
        filter: `(SECUCODE="${code}.${code.startsWith('6') ? 'SH' : 'SZ'}")(REPORT_DATE = '2021-12-31')`,
        source: 'SECURITIES',
        client: 'APP',
        p: page,
        ps: 200,
        sr: '1,-1',
        st: 'MAINOP_TYPE,MAIN_BUSINESS_INCOME',
        v: '0719832498022196',
      },
      responseType: 'json',
    });
    return body.result.data || [];
  } catch (error) {
    console.log(error);
    return [];
  }
}

export async function GetStockZhiYaSum(code: string, page = 1) {
  try {
    const { body } = await got<{
      code: 0;
      message: 'ok';
      result: {
        pages: 1;
        count: 2;
        data: [
          {
            "SECUCODE":"002812.SZ",
            "HOLDER_NAME":"玉溪合益投资有限公司",
            "NOTICE_DATE":"2023-09-02 00:00:00",
            "ACCUM_PLEDGE_NUM":59590000, // 质押股数
            "ACCUM_PLEDGE_HR":49.89, // 质押占持股比例
            "ACCUM_PLEDGE_TSR":6.09 // 质押占总股本比例
          }
        ];
      };
      hasNext: 1;
    }>('https://datacenter.eastmoney.com/securities/api/data/get', {
      searchParams: {
        type: 'RPTA_APP_ACCUMREPO',
        sty: 'SECUCODE,HOLDER_NAME,NOTICE_DATE,ACCUM_PLEDGE_NUM,ACCUM_PLEDGE_HR,ACCUM_PLEDGE_TSR',
        filter: `(SECUCODE="${code}.${code.startsWith('6') ? 'SH' : 'SZ'}")")`,
        source: 'SECURITIES',
        client: 'APP',
        v: '0719832498022196',
      },
      responseType: 'json',
    });
    return body.result.data || [];
  } catch (error) {
    console.log(error);
    return [];
  }
}

export async function GetStockZhiYaDetail(code: string, page = 1) {
  try {
    const { body } = await got<{
      code: 0;
      message: 'ok';
      result: {
        pages: 1;
        count: 26;
        data: [
          {
            "SECURITY_NAME_ABBR":"恩捷股份",
            "SECUCODE":"002812.SZ",
            "SECURITY_CODE":"002812",
            "HOLDER_NAME":"李晓华",
            "IS_CONTROL_SHAREHOLDER":"0",
            "ACCUM_PLEDGE_TSR":3.47, // 质押比例合计
            "PRE_ACCUM_PLEDGE_TSR":2.91, // 上期质押比例合计
            "NOTICE_DATE":"2023-07-08 00:00:00",
            "PF_ORG":"海通证券股份有限公司",
            "PF_NUM":5460000, // 质押股数
            "PF_HOLD_RATIO":8.16, // 占持股比例
            "PF_TSR":0.56, // 占总股本比例
            "CLOSE_FORWARD_ADJPRICE":92.8314456694, // 质押日收盘价
            "PF_START_DATE":"2023-07-06 00:00:00", // 质押日期
            "ACTUAL_UNFREEZE_DATE":"2024-07-05 00:00:00", // 解押日期
            "UNFREEZE_STATE":"未解押",
            "HOLDER_CODE":null,
            "PF_ORG_CODE":"10004281",
            "ORG_CODE":"10192787",
            "HOLD_NUM":6691.9389, // 总持有股数（万）
            "WARNING_LINE":74.26515653552, // 告警线
            "OPENLINE":64.98201196858, // 平仓线
            "PFORG_TYPE":"证券公司",
            "PF_PURPOSE_CODE":"001",
            "PF_REASON":"李晓华质押股份给海通证券股份有限公司用于自身资金需求",
            "BOARD_CODE":"016074",
            "BOARD_NAME":"电池",
            "PF_SECURITY_NAME_ABBR":"海通证券",
            "PF_SECURITY_CODE":"600837",
            "PF_ORG_CODE_PARENT":null,
            "PF_ORG_NAME_PARENT":null,
            "CLOSE_FORWARD_ADJPRICE_TODAY":65.68,
            "CLOSE_PRICE":65.68,
            "TRADE_DATE":"2023-09-05 00:00:00",
            "PF_PURPOSE":"贷款",
            "WARNING_STATE":"达到预警线",
            "MARKET_CAP":506859693.354924, // 市值
            "MXID":"73d2a4fc0c84f6f90e4bead7f03541ca",
            "IS_PFTYPE":"否",
            "UNFREEZE_DATE":"2024-07-05 00:00:00"
          }
        ];
      };
      hasNext: 1;
    }>('https://datacenter.eastmoney.com/securities/api/data/get', {
      searchParams: {
        type: 'RPTA_APP_ACCUMDETAILS',
        sty: 'ALL',
        filter: `(SECUCODE="${code}.${code.startsWith('6') ? 'SH' : 'SZ'}")")`,
        source: 'SECURITIES',
        client: 'APP',
        p: page,
        ps: 10,
        sr: '-1,1',
        st: 'NOTICE_DATE,PF_START_DATE',
        v: '0719832498022196',
      },
      responseType: 'json',
    });
    return body.result.data || [];
  } catch (error) {
    console.log(error);
    return [];
  }
}

// 获取研报数据
export async function GetStockResearches(secid: string, page = 1) {
  try {
    const { body } = await got<{
      success: 1;
      error: '';
      data: {
        page_index: 1;
        page_size: 20;
        total_hits: 29;
        list: [
          {
            aim_price: '';
            art_code: 'AP202206151572300881';
            eiTime: '2022-06-15 14:49:26.0';
            author_items: [
              {
                author_id: '11000177906';
                author_name: '刘章明';
              }
            ];
            codes: [
              {
                inner_code: '30444988206837';
                market_code: '1';
                short_name: '中体产业';
                stock_code: '600158';
                type: 'A';
              }
            ];
            em_rating_code: '007';
            em_rating_name: '买入';
            indu_old_industry_code: '';
            indu_old_industry_name: '';
            language: '0';
            publish_time: '2022-04-30 00:00:00';
            rating: 'A';
            rating_change: '3';
            report_type: '0';
            s_rating_name: '买入';
            source: '天风证券';
            title: '21年地产结转节奏放缓，丰厚体育资源+创新业务延伸驱动持续发展';
            title_ch: '21年地产结转节奏放缓，丰厚体育资源+创新业务延伸驱动持续发展';
            title_en: 'The pace of real estate carry over slowed down in 21 years, and the sustainable development was driven by rich sports resources + innovative business extension';
          }
        ];
      };
      hasNext: 1;
    }>('https://np-areport-wap.eastmoney.com/api/security/rep', {
      searchParams: {
        client_source: 'wap',
        page_index: page,
        page_size: 20,
        stock_list: secid,
      },
      responseType: 'json',
    });
    return body.data.list || [];
  } catch (error) {
    console.log(error);
    return [];
  }
}

// 事件
export async function GetStockEvents(code: string, page = 1) {
  try {
    const { body } = await got<{
      code: 0;
      message: 'ok';
      data: [
        [
          {
            EVENT_TYPE: '股东大会';
            LEVEL1_CONTENT: '于2021-11-19召开2021年第六次临时股东大会';
            LEVEL2_CONTENT: ['违规类型：资金占用，处罚对象(关系)', '违规类型：资金占用，处罚对象(关系)'];
            NOTICE_DATE: '2021-11-19';
            SPECIFIC_EVENTTYPE: '股东大会';
          }
        ]
      ];
      hasNext: 1;
    }>('https://datacenter.eastmoney.com/securities/api/data/get', {
      searchParams: {
        type: 'RTP_F10_DETAIL',
        params: `${code}.${code.startsWith('6') ? 'SH' : 'SZ'}`,
        source: 'SECURITIES',
        client: 'APP',
        p: page,
        v: '0719832498022196',
      },
      responseType: 'json',
    });
    return body.data;
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 核心题材
export async function GetStockThemes(code: string, page = 1) {
  try {
    const { body } = await got<{
      code: 0;
      message: 'ok';
      result: {
        pages: 1;
        count: 6;
        data: [
          {
            BOARD_NAME: '电子竞技';
            BOARD_RANK: 4;
            BOARD_YIELD: -0.39;
            DERIVE_BOARD_CODE: 'BI0853';
            IS_PRECISE: '1';
            NEW_BOARD_CODE: 'BK0853';
            SECUCODE: '300336.SZ';
            SECURITY_CODE: '300336';
            SECURITY_NAME_ABBR: '新文化';
            SELECTED_BOARD_REASON: '2016年5月18日晚间公告,拟以自有资金5000万元认购上海七煌信...';
          }
        ];
      };
    }>('https://datacenter.eastmoney.com/securities/api/data/v1/get', {
      searchParams: {
        reportName: 'RPT_F10_CORETHEME_BOARDTYPE',
        quoteColumns: 'f3~05~NEW_BOARD_CODE~BOARD_YIELD',
        columns:
          'SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,NEW_BOARD_CODE,BOARD_NAME,SELECTED_BOARD_REASON,IS_PRECISE,BOARD_RANK,BOARD_YIELD,DERIVE_BOARD_CODE',
        filter: `(SECUCODE = "${code}.${code.startsWith('6') ? 'SH' : 'SZ'}")(IS_PRECISE = "1")`,
        client: 'APP',
        source: 'SECURITIES',
        pageNumber: page,
        pageSize: 200,
        sortTypes: 1,
        sortColumns: 'BOARD_RANK',
      },
      responseType: 'json',
    });
    return body.result.data;
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 题材龙头
export async function GetThemeLeadings(bk: string, page = 1) {
  try {
    const { body } = await got<{
      code: 0;
      message: 'ok';
      result: [
        {
          NEWEST_PRICE: 6.03;
          SECUCODE: '600880.SH';
          SECURITY_CODE: '600880';
          SECURITY_NAME_ABBR: '博瑞传播';
          YIELD: 10.04;
        }
      ];
    }>('https://datacenter.eastmoney.com/securities/api/data/get', {
      searchParams: {
        type: 'RTP_F10_POPULAR_LEADING',
        sty: 'SECUCODE,SECURITY_NAME_ABBR,SECURITY_CODE',
        extraCols: 'f2~01~SECURITY_CODE~NEWEST_PRICE,f3~01~SECURITY_CODE~YIELD',
        quoteColumns: 'f3~01~SECURITY_CODE~YIELD,f2~01~SECURITY_CODE~NEWEST_PRICE',
        params: bk,
        source: 'SECURITIES',
        client: 'APP',
      },
      responseType: 'json',
    });
    return { bk, data: body.result };
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 题材内容
export async function GetStockThemeContents(code: string, page = 1) {
  try {
    const { body } = await got<{
      code: 0;
      message: 'ok';
      result: {
        pages: 1;
        count: 4;
        data: [
          {
            IS_POINT: '1';
            KEYWORD: '出品电影获得巨大票房';
            KEY_CLASSIF: '核心竞争力';
            KEY_CLASSIF_CODE: '005';
            SECUCODE: '300336.SZ';
            SECURITY_CODE: '300336';
            SECURITY_NAME_ABBR: '新文化';
          }
        ];
      };
    }>('https://datacenter.eastmoney.com/securities/api/data/get', {
      searchParams: {
        reportName: 'RPT_F10_CORETHEME_CONTENT',
        columns: 'SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,KEYWORD,KEY_CLASSIF,KEY_CLASSIF_CODE,IS_POINT',
        filter: `(SECUCODE = "${code}.${code.startsWith('6') ? 'SH' : 'SZ'}")(IS_POINT = "1")`,
        source: 'SECURITIES',
        client: 'APP',
        P: page,
        ps: 5,
        sortColumns: 'BOARD_RANK',
        st: 'KEY_CLASSIF_CODE,MAINPOINT',
        sr: '1, 1',
        v: '0719832498022196',
      },
      responseType: 'json',
    });
    return body.result.data;
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 龙虎榜
export async function GetLongHuBang(code: string, page = 1) {
  try {
    const { body } = await got<{
      code: 0;
      message: 'ok';
      result: {
        pages: 18;
        count: 54;
        data: [
          {
            ACCUM_AMOUNT: 462121661;
            BUY_BUY_TOTAL: 53949391.94;
            BUY_RATIO_TOTAL: 14.806191467402;
            BUY_SELL_TOTAL: 503087;
            CHANGE_RATE: 20;
            EXPLANATION: '日涨幅达到15%的前5只证券';
            NET_BUY: 48784667.44;
            LIST: [
              {
                BUY_AMT_REAL: 6912550;
                BUY_RATIO: 1.495829038838;
                OPERATEDEPT_NAME: '海通证券股份有限公司上海建国西路证券营业部';
                OPERATEDEPT_CODE: 10495103;
                RANK: 1;
                SELL_AMT_REAL: 6984891.5;
                SELL_RATIO: 1.511483249862;
                TRADE_DIRECTION: '1';
              }
            ];
            SECUCODE: '300336.SZ';
            SECURITY_CODE: '300336';
            SECURITY_NAME_ABBR: '新文化';
            SELL_BUY_TOTAL: 14473226;
            SELL_RATIO_TOTAL: 4.249519587008;
            SELL_SELL_TOTAL: 19134863.5;
            TRADE_DATE: '2021-10-28 00:00:00';
            TRADE_ID: '4169987';
          }
        ];
      };
    }>('https://datacenter.eastmoney.com/securities/api/data/get?st=TRADE_DATE%2CRANK&sr=-1%2C1', {
      searchParams: {
        type: 'RPT_OPERATEDEPT_TRADE',
        sty: 'TRADE_ID,TRADE_DATE,EXPLANATION,SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,ACCUM_AMOUNT,CHANGE_RATE,NET_BUY,BUY_BUY_TOTAL,BUY_SELL_TOTAL,BUY_RATIO_TOTAL,SELL_BUY_TOTAL,SELL_SELL_TOTAL,SELL_RATIO_TOTAL,TRADE_DIRECTION,RANK,OPERATEDEPT_NAME,OPERATEDEPT_CODE,BUY_AMT_REAL,SELL_AMT_REAL,BUY_RATIO,SELL_RATIO',
        filter: `(SECUCODE="${code}.${code.startsWith('6') ? 'SH' : 'SZ'}")`,
        params:
          '(groupField=TRADE_ID)(groupedFields=TRADE_DIRECTION,RANK,OPERATEDEPT_CODE,OPERATEDEPT_NAME,BUY_AMT_REAL,SELL_AMT_REAL,BUY_RATIO,SELL_RATIO")(groupListName="LIST")',
        source: 'SECURITIES',
        client: 'APP',
        p: page,
        ps: 3,
        // st: 'TRADE_DATE',
        // sr: '-1, 1',
      },
      responseType: 'json',
    });
    if (body.code != 0) {
      console.log('GetLongHuBang' + body.message);
      return [];
    }
    return body.result.data;
  } catch (error) {
    console.log(error);
    return [];
  }
}

// 大宗交易
export async function GetBlockTrades(code: string, page = 1) {
  try {
    const { body } = await got<{
      code: 0;
      message: 'ok';
      result: {
        pages: 8;
        count: 78;
        data: [
          {
            BUYER_NAME: '华泰证券股份有限公司上海分公司';
            DEAL_AMT: 9860400;
            DEAL_PRICE: 3.93;
            PREMIUM_RATIO: 0;
            SECUCODE: '300336.SZ';
            SECURITY_CODE: '300336';
            SECURITY_NAME_ABBR: '新文化';
            SELLER_NAME: '海通证券股份有限公司嵊州西前街证券营业部';
            TRADE_DATE: '2020-12-04 00:00:00';
          }
        ];
      };
    }>('https://datacenter.eastmoney.com/securities/api/data/get', {
      searchParams: {
        type: 'RPT_DATA_BLOCKTRADE',
        sty: 'SECURITY_CODE,SECUCODE,SECURITY_NAME_ABBR,TRADE_DATE,DEAL_PRICE,DEAL_AMT,PREMIUM_RATIO,BUYER_NAME,SELLER_NAME',
        filter: `(SECUCODE = "${code}.${code.startsWith('6') ? 'SH' : 'SZ'}")`,
        source: 'SECURITIES',
        client: 'APP',
        p: page,
        ps: 10,
        st: 'TRADE_DATE',
        sr: '-1',
      },
      responseType: 'json',
    });
    if (body.code != 0) {
      console.error('GetLongHuBang' + body.message);
      return null;
    }
    return body.result.data;
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 股东增减
export async function GetHolderChanges(code: string, page = 1) {
  try {
    const { body } = await got<{
      code: 0;
      message: 'ok';
      result: {
        pages: 8;
        count: 78;
        data: [
          {
            CHANGE_NUM: -708000;
            CHANGE_RATIO: -5.064269007103;
            END_DATE: '2021-09-30 00:00:00';
            HOLDER_NAME: '陈能依';
            HOLD_RATIO: 1.646217188552;
            SECUCODE: '300336.SZ';
            SECURITY_CODE: '300336';
            SECURITY_NAME_ABBR: '新文化';
            START_DATE: '2021-06-30 00:00:00';
          }
        ];
      };
    }>('https://datacenter.eastmoney.com/securities/api/data/get', {
      searchParams: {
        type: 'RPT_F10_TRADE_HOLDERCHANGE',
        sty: 'SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,END_DATE,START_DATE,HOLDER_NAME,CHANGE_NUM,CHANGE_RATIO,HOLD_RATIO',
        filter: `(SECUCODE = "${code}.${code.startsWith('6') ? 'SH' : 'SZ'}")`,
        source: 'SECURITIES',
        client: 'APP',
        p: page,
        ps: 10,
        st: 'END_DATE,HOLDER_NAME',
        sr: '-1,2',
      },
      responseType: 'json',
    });
    if (body.code != 0) {
      console.error('GetLongHuBang' + body.message);
      return {};
    }
    console.log('GetHolderChanges', body);
    return body.result.data;
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 高管增减
export async function GetExchangeChanges(code: string, page = 1) {
  try {
    const { body } = await got<{
      code: 0;
      message: 'ok';
      result: {
        pages: 8;
        count: 78;
        data: [
          {
            AVERAGE_PRICE: 2.9;
            CHANGE_AFTER_HOLDNUM: 600000;
            CHANGE_NUM: -60000;
            END_DATE: '2021-06-22 00:00:00';
            EXECUTIVE_NAME: '余厉';
            EXECUTIVE_RELATION: '本人';
            HOLDER_NAME: '余厉';
            POSITION: '监事';
            SECUCODE: '300336.SZ';
            SECURITY_CODE: '300336';
            SECURITY_NAME_ABBR: '新文化';
            TRADE_WAY: '竞价交易';
          }
        ];
      };
    }>('https://datacenter.eastmoney.com/securities/api/data/get', {
      searchParams: {
        type: 'RPT_F10_TRADE_EXCHANGEHOLD',
        sty: 'SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,END_DATE,HOLDER_NAME,CHANGE_NUM,AVERAGE_PRICE,CHANGE_AFTER_HOLDNUM,TRADE_WAY,EXECUTIVE_NAME,POSITION,EXECUTIVE_RELATION',
        filter: `(SECUCODE = "${code}.${code.startsWith('6') ? 'SH' : 'SZ'}")`,
        source: 'SECURITIES',
        client: 'APP',
        p: page,
        ps: 10,
        st: 'END_DATE,HOLDER_NAME,CHANGE_NUM,AVERAGE_PRICE',
        sr: '-1,2,-1,-1',
      },
      responseType: 'json',
    });
    if (body.code != 0) {
      console.error('GetExchangeChanges' + body.message);
      return [];
    }
    console.log('GetExchangeChanges', body);
    return body.result.data;
  } catch (error) {
    console.log(error);
    return [];
  }
}

// 股东人数
export async function GetHolderNumChanges(code: string, page = 1) {
  try {
    const { body } = await got<{
      code: 0;
      message: 'ok';
      result: {
        pages: 1;
        count: 40;
        data: [
          {
            AVG_FREESHARES_RATIO: -0.291594235406;
            AVG_FREE_SHARES: 20680;
            AVG_HOLD_AMT: 54183.9805960859;
            A_MARK: '1';
            B_MARK: '0';
            END_DATE: '2021-09-30 00:00:00';
            FREEHOLD_RATIO_TOTAL: 28.56612482;
            HOLDER_ANUM_RATIO: 0.2924;
            HOLDER_A_NUM: 35666;
            HOLDER_BNUM_RATIO: null;
            HOLDER_B_NUM: null;
            HOLDER_HNUM_RATIO: null;
            HOLDER_H_NUM: null;
            HOLDER_TOTAL_NUM: 35666;
            HOLD_FOCUS: '较分散';
            HOLD_RATIO_TOTAL: 33.86357379;
            H_MARK: '0';
            ORG_CODE: '10206656';
            PRICE: 2.62;
            SECUCODE: '300336.SZ';
            SECURITY_CODE: '300336';
            TOTAL_NUM_RATIO: 0.2924;
          }
        ];
      };
    }>('https://datacenter.eastmoney.com/securities/api/data/v1/get', {
      searchParams: {
        reportName: 'RPT_F10_EH_HOLDERNUM',
        columns:
          'A_MARK,B_MARK,H_MARK,SECUCODE,SECURITY_CODE,ORG_CODE,END_DATE,HOLDER_TOTAL_NUM,TOTAL_NUM_RATIO,HOLDER_A_NUM,HOLDER_ANUM_RATIO,AVG_FREE_SHARES,AVG_FREESHARES_RATIO,PRICE,AVG_HOLD_AMT,HOLD_FOCUS,HOLD_RATIO_TOTAL,FREEHOLD_RATIO_TOTAL,HOLDER_B_NUM,HOLDER_H_NUM,HOLDER_BNUM_RATIO,HOLDER_HNUM_RATIO',
        filter: `(SECUCODE="${code}.${code.startsWith('6') ? 'SH' : 'SZ'}")`,
        source: 'SECURITIES',
        client: 'APP',
        pageNumber: page,
        pageSize: 5,
        st: 'END_DATE,MAINPOINT',
        sr: '-1',
        v: '0719832498022196',
      },
      responseType: 'json',
    });
    return body.result.data;
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 报告列表
export async function GetReportList(code: string, page = 1) {
  try {
    const { body } = await got<{
      code: 0;
      message: 'ok';
      result: {
        pages: 1;
        count: 45;
        data: [
          {
            REPORT_DATE: '2021-09-30 00:00:00';
            REPORT_DATE_NAME: '2021三季报';
            REPORT_TYPE: '三季报';
            SECURITY_CODE: '300336';
          }
        ];
      };
    }>('https://datacenter.eastmoney.com/securities/api/data/get', {
      searchParams: {
        filter: `(SECUCODE = "${code}.${code.startsWith('6') ? 'SH' : 'SZ'}")`,
        sty: 'SECURITY_CODE,REPORT_DATE,REPORT_TYPE,REPORT_DATE_NAME',
        type: 'RPT_F10_FINANCE_MAINFINADATA',
        source: 'HSF10',
        client: 'APP',
        p: page,
        ps: 200,
        st: 'REPORT_DATE',
        sr: -1,
      },
      responseType: 'json',
    });
    return body.result;
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 报告内容
export async function GetReportData(code: string, page = 1) {
  try {
    const { body } = await got<{
      code: 0;
      message: 'ok';
      result: {
        pages: 9;
        count: 45;
        data: [
          {
            BLDKBBL: null;
            BPS: 0.200756941598; // 每股净资产
            BPSTZ: -91.2093002664; //
            CHZZL: 1.343558740625; // 存货周转率（次）
            CHZZTS: 200.958835543283; // 存货周转天数
            COMPENSATE_EXPENSE: null;
            CQBL: 6.898948408835; // 产权比率
            CURRENCY: 'CNY';
            EARNED_PREMIUM: null;
            EPSJB: -0.2075; // 基本每股收益
            EPSJBTZ: 4.2012927054;
            EPSKCJB: null; // 扣非每股收益
            EPSXS: -0.2075; // 稀释每股收益
            GROSSLOANS: null;
            HXYJBCZL: null;
            JJYWFXZB: null;
            JYXJLYYSR: 0.88955356013; // 经营净现金流/营业收入
            JZB: null;
            JZBJZC: null;
            JZC: null;
            KCFJCXSYJLR: -170379613.89; // 扣非净利润
            KCFJCXSYJLRTZ: 4.5715000747; // 扣非净利润同比增长
            KFJLRGDHBZC: -2.842210668381; // 扣非净利润滚动环比增长
            LD: 0.365892808033; // 流动比率
            LTDRR: null;
            MGJYXJJE: 0.141551045312; // 每股经营现金流
            MGJYXJJETZ: 163.6285272933;
            MGWFPLR: -2.426211671356; // 每股未分配利润
            MGWFPLRTZ: -600.6743172458;
            MGZBGJ: 1.514514946223; // 每股资本公积
            MGZBGJTZ: 0;
            MLR: -79789921.99; // 毛利润
            NBV_LIFE: null;
            NBV_RATE: null;
            NETPROFITRPHBZC: 0.136302938054; // 归属净利润滚动环比增长
            NET_ROI: null;
            NEWCAPITALADER: null;
            NHJZ_CURRENT_AMT: null;
            NONPERLOAN: null;
            NOTICE_DATE: '2021-10-28 00:00:00';
            NZBJE: null;
            ORG_CODE: '10206656';
            ORG_TYPE: '通用';
            PARENTNETPROFIT: -167304490.51; // 归属净利润
            PARENTNETPROFITTZ: 4.1838945917; // 归属净利润环比增长
            QYCS: 9.654138516838; // 权益乘数
            REPORT_DATE: '2021-09-30 00:00:00';
            REPORT_DATE_NAME: '2021三季报';
            REPORT_TYPE: '三季报';
            REPORT_YEAR: '2021';
            ROEJQ: -67.78; // 净资产收益率（加权）
            ROEJQTZ: -654.7884187082;
            ROEKCJQ: null; // 净资产收益率（扣非/加权）
            ROIC: -13.453028634504; // 投入资本回报率
            ROICTZ: -187.2312749393;
            RZRQYWFXZB: null;
            SD: 0.209358043623; // 速动比率
            SECUCODE: '300336.SZ';
            SECURITY_CODE: '300336';
            SECURITY_NAME_ABBR: '新文化';
            SECURITY_TYPE_CODE: '058001001';
            SOLVENCY_AR: null;
            SURRENDER_RATE_LIFE: null;
            TAXRATE: null;
            TOAZZL: 0.096051779289;
            TOTALDEPOSITS: null;
            TOTALOPERATEREVE: 128292136.14; // 营业总收入
            TOTALOPERATEREVETZ: -49.664535531; // 营业总收入同比增长
            TOTAL_ROI: null;
            UPDATE_DATE: '2021-10-28 00:00:00';
            XJLLB: 0.14503039253; // 现金流量比率
            XSJLL: -133.6308078173; // 净利率
            XSJXLYYSR: 1.71275661651; /// 销售净现金流/营业收入
            XSMLL: -62.193930501655; // 毛利率
            YSZKYYSR: null;
            YSZKZZL: 1.182506439056; // 应收账款周转率（次）
            YSZKZZTS: 228.328566409788; // 应收帐款周转天数（天）
            YYFXZB: null;
            YYZSRGDHBZC: -0.058342987642; // 营业总收入滚动环比增长
            ZCFZL: 89.6417479586; // 资产负债率
            ZCFZLTZ: 130.0991642004;
            ZQCXYWFXZB: null;
            ZQZYYWFXZB: null;
            ZYGDSYLZQJZB: null;
            ZYGPGMJZC: null;
            ZZCJLL: -12.8354768587; // 总资产收益率（加权）
            ZZCJLLTZ: -122.4564896305;
            ZZCZZTS: 2810.98384640669; // 总资产周转天数
          }
        ];
      };
    }>('https://datacenter.eastmoney.com/securities/api/data/get', {
      searchParams: {
        filter: `(SECUCODE = "${code}.${code.startsWith('6') ? 'SH' : 'SZ'}")`,
        sty: 'APP_F10_MAINFINADATA',
        type: 'RPT_F10_FINANCE_MAINFINADATA',
        source: 'HSF10',
        client: 'APP',
        ps: 5,
        st: 'REPORT_DATE',
        sr: -1,
      },
      responseType: 'json',
    });
    if (body.code != 0) {
      console.log('GetReportData: ' + body.message);
      return [];
    }
    return body.result.data;
  } catch (error) {
    console.log(error);
    return [];
  }
}

export async function GetLHBReview(code: string, page = 1) {
  try {
    const { body } = await got<{
      code: 0;
      message: 'ok';
      result: {
        pages: 1;
        count: 4;
        data: [
          {
            AVERAGE_INCREASE_1DAY: -0.23154107625; // 1天后平均涨跌
            AVERAGE_INCREASE_2DAY: -4.06319534625; // 2天后平均涨跌
            AVERAGE_INCREASE_3DAY: -6.618464944286; // 3天后平均涨跌
            AVERAGE_INCREASE_5DAY: -8.537375373889; // 5天后平均涨跌
            AVERAGE_INCREASE_10DAY: -12.26610953; // 10天后平均涨跌
            OPERATEDEPT_CODE: '10000055316';
            OPERATEDEPT_CODE_OLD: '81034491';
            OPERATEDEPT_NAME: '华鑫证券上海陆家嘴证券营业部';
            ORG_NAME_ABBR: '华鑫证券上海陆家嘴证券营业部';
            RISE_PROBABILITY_1DAY: 50; // 1天后上涨概率
            RISE_PROBABILITY_2DAY: 29.166666666667; // 2天后上涨概率
            RISE_PROBABILITY_3DAY: 19.047619047619; // 3天后上涨概率
            RISE_PROBABILITY_5DAY: 22.222222222222; // 5天后上涨概率
            RISE_PROBABILITY_10DAY: 15.384615384615; // 10天后上涨概率
            STATISTICSCYCLE: '01';
            STATISTICSCYCLENAME: '近一月';
            // 买入次数即营业部近期买入个股的次数，平均涨幅、上涨概率即所买个股随后几天的涨幅和上涨比例
            TOTAL_BUYER_SALESTIMES_1DAY: 24;
            TOTAL_BUYER_SALESTIMES_2DAY: 24;
            TOTAL_BUYER_SALESTIMES_3DAY: 21;
            TOTAL_BUYER_SALESTIMES_5DAY: 18;
            TOTAL_BUYER_SALESTIMES_10DAY: 13;
          }
        ];
      };
    }>('https://datacenter-web.eastmoney.com/api/data/v1/get', {
      searchParams: {
        sortTypes: '-1',
        pageSize: '50',
        pageNumber: '1',
        reportName: 'RPT_TRADE_BACK_PROFILE',
        columns: 'ALL',
        filter: `(OPERATEDEPT_CODE="${code}")`,
        source: 'WEB',
        client: 'WEB',
      },
      responseType: 'json',
    });
    if (body.code != 0) {
      console.log('GetLHBReview: ' + body.message);
      return [];
    }
    return body.result.data;
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 报告链接
export async function GetReportPDF(code: string, page = 1) {
  try {
    const { body } = await got<{
      code: 0;
      message: 'ok';
      data: {
        count: 12;
        items: [
          {
            endDate: '2021-09-30';
            infoCode: 'AN202110271525385052';
            message: '';
            messageType: '01';
            url: 'https://pdf.dfcfw.com/pdf/H2_AN202110271525385052_1.pdf';
          }
        ];
      };
    }>('https://emfront.eastmoney.com/APP_HSF10/CWFX/GetReportPDF', {
      body: `{fc: "${code}", color: "w"}`,
      method: 'POST',
      responseType: 'json',
    });
    return body.data;
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 获取行业板块
export async function GetBanKuais(type: BKType, pageSize = 20) {
  try {
    const { body } = await got<{
      data: {
        total: 86;
        diff: [
          {
            f1: 2;
            f2: 995.03;
            f3: 2.79;
            f4: 27.02;
            f5: 4440755;
            f6: 12421307904;
            f7: 3.13;
            f8: 0.57;
            f9: 9.87;
            f10: 2.31;
            f11: 0.05;
            f12: 'BK0474';
            f13: 90;
            f14: '保险';
            f15: 998.74;
            f16: 968.46;
            f17: 968.82;
            f18: 968.01;
            f20: 2446669936000; // 总市值
            f21: 1649085216000; // 流通市值
            f22: 0.07;
            f23: '-';
            f24: -2.01;
            f25: 3.33;
            f26: '-';
            f33: 0;
            f62: 2120360320;
            f104: 6; // 上涨数
            f105: 0; // 下跌数
            f107: 5;
            f115: '-';
            f124: 1642664402;
            f128: '新华保险';
            f136: 4.51;
            f140: '601336';
            f141: 1;
            f152: 2;
            f207: '天茂集团';
            f208: '000627';
            f209: 0;
            f222: 1.47;
          }
        ];
      };
    }>(RandomEastmoneyUrl() + 'api/qt/clist/get', {
      searchParams: {
        pn: 1,
        pz: pageSize,
        po: 1,
        np: 1,
        fltt: 2,
        invt: 2,
        fid: 'f3',
        fs: type === BKType.Industry ? 'm:90 t:2 f:!50' : 'm:90 t:3 f:!50',
        fields:
          'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f24,f25,f26,f22,f33,f11,f62,f128,f136,f115,f152,f124,f107,f104,f105,f140,f141,f207,f208,f209,f222',
        ut: Utils.MakeHash(),
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
    if (!body.data) {
      console.error('GeIndustries error: ', body);
    }
    return {
      to: body.data.total,
      arr: body.data.diff.map((d) => {
        return {
          code: d.f12,
          name: d.f14,
          market: d.f13,
          secid: `${d.f13}.${d.f12}`,
          zx: d.f2,
          zdd: d.f4,
          zdf: d.f3,
          hsl: d.f8,
          zsz: d.f20,
          szs: d.f104,
          xds: d.f105,
        } as Stock.BanKuaiItem;
      }),
    };
  } catch (error) {
    console.log(error);
    return {};
  }
}

function formatIntTime(t: number, isDate = false) {
  const h = Math.floor(t / 10000);
  const m = Math.floor((t - h * 10000) / 100);
  const s = t - h * 10000 - m * 100;
  const sp = isDate ? '-' : ':';
  return h.toString().padStart(2, '0') + sp + m.toString().padStart(2, '0') + sp + s.toString().padStart(2, '0');
}

// 涨停股票
export async function GeZTStocks(pageSize = 20, date = '20220120') {
  try {
    const { body } = await got<{
      data: {
        tc: 37;
        pool: [
          {
            amount: 49269868; // 成交量
            c: '002235'; // 代码
            fbt: 92500; // 首次封板时间
            fund: 163660905; // 封板资金
            hs: 1.3657044172286987; // 换手率
            hybk: '文化传媒'; // 活跃板块
            lbc: 2; // 连板次数
            lbt: 92500; // 最后封板时间
            ltsz: 3607652303.08; // 流通市值
            m: 0; // 市场类型
            n: '安妮股份';
            p: 6580; // 最新价
            tshare: 3813585655.04; // 总市值
            zbc: 0; //炸板次数
            zdp: 10.033445358276367; // 涨跌幅
            zttj: {
              ct: 2; // 数
              days: 2; // 天
            };
          }
        ];
      };
    }>('https://push2ex.eastmoney.com/getTopicZTPool', {
      searchParams: {
        dpt: 'wz.ztzt',
        Pageindex: 0,
        pagesize: pageSize,
        sort: 'fbt:asc',
        date: date,
        ut: '7eea3edcaed734bea9cbfc24409ed989',
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
    if (!body.data) {
      console.error('GeZTStocks error: ', body);
    }
    return {
      to: body.data.tc,
      arr: body.data.pool.map((d) => {
        return {
          code: d.c,
          name: d.n,
          market: d.m,
          secid: `${d.m}.${d.c}`,
          zx: d.p,
          zdf: d.zdp,
          hsl: d.hs,
          fbt: formatIntTime(d.fbt),
          lbt: formatIntTime(d.lbt),
          zbc: d.zbc,
          fbf: d.fund,
          hybk: d.hybk,
          lbc: d.lbc,
          zsz: d.tshare,
          ltsz: d.ltsz,
          zttj: d.zttj,
        } as Stock.ZTItem;
      }),
    };
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 强势股票
export async function GeQSStocks(pageSize = 20, date = '20220120') {
  try {
    const { body } = await got<{
      data: {
        tc: 37;
        pool: [
          {
            amount: 826727488;
            c: '300584';
            cc: 2; // 推荐理由//次值&1 = 1；//60日新高 //次值 & 2 = 2；//近期多次涨停
            hs: 33.94397735595703;
            hybk: '化学制药';
            lb: 1.1927025318145752; // 量比
            ltsz: 2546439179.7599998; // 流通市值
            m: 0;
            n: '海辰药业';
            nh: 0; // 是否新高
            p: 39760;
            tshare: 4771200000;
            zdp: 20.012073516845703;
            zs: 0; // 涨速
            ztf: '1';
            ztp: 39760; // 涨停价
            zttj: { days: 8; ct: 4 };
          }
        ];
      };
    }>('http://push2ex.eastmoney.com/getTopicQSPool', {
      searchParams: {
        dpt: 'wz.ztzt',
        Pageindex: 0,
        pagesize: pageSize,
        sort: 'zdp:desc',
        date,
        ut: '7eea3edcaed734bea9cbfc24409ed989',
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
    if (!body.data) {
      console.error('GeQSStocks error: ', body);
    }
    return {
      to: body.data.tc,
      arr: body.data.pool.map((d) => {
        return {
          code: d.c,
          name: d.n,
          market: d.m,
          secid: `${d.m}.${d.c}`,
          zx: d.p,
          zdf: d.zdp,
          hsl: d.hs,
          lb: d.lb,
          nh: d.nh === 0 ? false : true,
          reason: d.cc,
          hybk: d.hybk,
          ltsz: d.ltsz,
          zttj: d.zttj,
        } as Stock.QSItem;
      }),
    };
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 次新股
export async function GeCXStocks(pageSize = 20, date = '20220120') {
  try {
    const { body } = await got<{
      data: {
        tc: 37;
        pool: [
          {
            amount: 1807584688;
            c: '301201';
            hs: 78.76605987548828;
            hybk: '医疗服务';
            ipod: 20220120; //上市日期
            ltsz: 2830502470.9500003;
            m: 0;
            n: 'N诚达';
            nh: 0;
            o: 1; // 是否开板
            od: 20220120; // 开板日期
            ods: 1; // 开板几日
            p: 128550;
            tshare: 12430288797.000002;
            zdp: 76.84688568115234;
            ztf: '0';
            ztp: 1000000000;
            zttj: { days: 8; ct: 4 };
          }
        ];
      };
    }>('http://push2ex.eastmoney.com/getTopicCXPooll', {
      searchParams: {
        dpt: 'wz.ztzt',
        Pageindex: 0,
        pagesize: pageSize,
        sort: 'ods:asc',
        date,
        ut: '7eea3edcaed734bea9cbfc24409ed989',
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
    if (!body.data) {
      console.error('GeCXStocks error: ', body);
    }
    return {
      to: body.data.tc,
      arr: body.data.pool.map((d) => {
        return {
          code: d.c,
          name: d.n,
          market: d.m,
          secid: `${d.m}.${d.c}`,
          hybk: d.hybk,
          ltsz: d.ltsz,
          zx: d.p,
          zdf: d.zdp,
          hsl: d.hs,
          nh: d.nh === 0 ? false : true,
          ipod: formatIntTime(d.ipod, true),
          open: d.o === 1 ? true : false,
          odays: d.ods,
          zttj: d.zttj,
        } as Stock.CXItem;
      }),
    };
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 炸板股
export async function GeZBStocks(pageSize = 20, date = '20220120') {
  try {
    const { body } = await got<{
      data: {
        tc: 37;
        pool: [
          {
            amount: 5004494336;
            c: '300497';
            fbt: 92503; // 封板时间
            hs: 42.59239959716797;
            hybk: '化学制药';
            ltsz: 10117661138.220001;
            m: 0;
            n: '富祥药业';
            p: 22710;
            tshare: 12490609734.720001;
            zbc: 1; // 炸板次数
            zdp: -7.306122779846191;
            zf: 28.4489803314209; // 振幅
            zs: 0;
            ztp: 29400; // 涨停价
            zttj: { days: 8; ct: 4 };
          }
        ];
      };
    }>('http://push2ex.eastmoney.com/getTopicZBPool', {
      searchParams: {
        dpt: 'wz.ztzt',
        Pageindex: 0,
        pagesize: pageSize,
        sort: 'fbt:asc',
        date,
        ut: '7eea3edcaed734bea9cbfc24409ed989',
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
    if (!body.data) {
      console.error('GeZBStocks error: ', body);
    }
    return {
      to: body.data.tc,
      arr: body.data.pool.map((d) => {
        return {
          code: d.c,
          name: d.n,
          market: d.m,
          secid: `${d.m}.${d.c}`,
          hybk: d.hybk,
          ltsz: d.ltsz,
          zx: d.p,
          zdf: d.zdp,
          hsl: d.hs,
          fbt: formatIntTime(d.fbt),
          zf: d.zf,
          zbc: d.zbc,
          zttj: d.zttj,
        } as Stock.ZBItem;
      }),
    };
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 跌停股票
export async function GeDTStocks(pageSize = 20, date = '20220120') {
  try {
    const { body } = await got<{
      data: {
        tc: 37;
        pool: [
          {
            amount: 168238573;
            c: '002782';
            days: 1; // 连续跌停
            fba: 15248048; // 板上成交额
            fund: 97350; // 封单资金
            hs: 2.331928253173828;
            hybk: '消费电子';
            lbt: 150000; // 最后封板时间
            ltsz: 6960097648.25; // 流通市值
            m: 0;
            n: '可立克';
            oc: 3; // 开板次数
            p: 14750;
            pe: 77.07284545898438; // 动态市盈率
            tshare: 7033260672; // 总市值
            zdp: -10.006101608276367; // 涨跌幅
          }
        ];
      };
    }>('http://push2ex.eastmoney.com/getTopicDTPool', {
      searchParams: {
        dpt: 'wz.ztzt',
        Pageindex: 0,
        pagesize: pageSize,
        sort: 'fund:asc',
        date,
        ut: '7eea3edcaed734bea9cbfc24409ed989',
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
    if (!body.data) {
      console.error('GeDTStocks error: ', body);
    }
    return {
      to: body.data.tc,
      arr: body.data.pool.map((d) => {
        return {
          code: d.c,
          name: d.n,
          market: d.m,
          secid: `${d.m}.${d.c}`,
          hybk: d.hybk,
          ltsz: d.ltsz,
          zx: d.p,
          zdf: d.zdp,
          hsl: d.hs,
          fba: d.fba,
          fbf: d.fund,
          lbt: formatIntTime(d.lbt),
          dtdays: d.days,
          oc: d.oc,
        } as Stock.DTItem;
      }),
    };
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 涨跌分布
export async function GeZDFenbu() {
  try {
    const { body } = await got<{
      data: {
        fenbu: [
          { '-1': 349 },
          { '-10': 22 },
          { '-11': 13 },
          { '-2': 560 },
          { '-3': 709 },
          { '-4': 828 },
          { '-5': 620 },
          { '-6': 327 },
          { '-7': 143 },
          { '-8': 73 },
          { '-9': 40 },
          { '0': 30 },
          { '1': 265 },
          { '10': 14 },
          { '11': 43 },
          { '2': 182 },
          { '3': 97 },
          { '4': 48 },
          { '5': 20 },
          { '6': 23 },
          { '7': 10 },
          { '8': 11 },
          { '9': 3 }
        ];
      };
    }>('http://push2ex.eastmoney.com/getTopicZDFenBu', {
      searchParams: {
        dpt: 'wz.ztzt',
        ut: '7eea3edcaed734bea9cbfc24409ed989',
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
    if (!body.data) {
      console.error('GeZDFenbu error: ', body);
    }
    return body.data.fenbu;
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 涨跌停数
export async function GeZDTCount() {
  try {
    const { body } = await got<{
      data: {
        zdtcount: [
          {
            t: 930; // 时间
            ztc: 13; // 涨停数
            dtc: 2; // 跌停数
          }
        ];
      };
    }>('http://push2ex.eastmoney.com/getTopicZDFenBu', {
      searchParams: {
        dpt: 'wz.ztzt',
        time: 0,
        ut: '7eea3edcaed734bea9cbfc24409ed989',
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
    if (!body.data) {
      console.error('GeZDFenbu error: ', body);
    }
    return body.data.zdtcount;
  } catch (error) {
    console.log(error);
    return {};
  }
}

// 炸板率
export async function GeFBFailed() {
  try {
    const { body } = await got<{
      data: {
        fbfailed: [
          {
            t: 930; // 时间
            c: 0; // 炸板数
            zbp: 0; // 炸板率
          }
        ];
      };
    }>('http://push2ex.eastmoney.com/getTopicFBFailed', {
      searchParams: {
        dpt: 'wz.ztzt',
        time: 0,
        ut: '7eea3edcaed734bea9cbfc24409ed989',
        _: new Date().getTime(),
      },
      responseType: 'json',
    });
    if (!body.data) {
      console.error('GeZDFenbu error: ', body);
    }
    return body.data.fbfailed;
  } catch (error) {
    console.log(error);
    return {};
  }
}

export async function requestMoodTrend(date: string, type: number) {
  try {
    const {
      body: { code, data },
    } = await got<{
      code: 20000;
      data: [['09:30', 0.55]];
    }>(`http://stock.zizizaizai.com:9001/v2/api/sentiment/trend/${type}`, {
      searchParams: {
        date1: date,
      },
      responseType: 'json',
    });
    if (code != 20000) {
      console.error('获取市场情绪失败:' + date);
    }
    return (
      data.map((_) => {
        return {
          time: _[0],
          value: _[1],
        } as Stock.MarketMoodItem;
      }) || []
    );
  } catch (error) {
    console.log('获取市场情绪失败', error);
    return [];
  }
}

export async function requestZTTrend(date: string) {
  try {
    const {
      body: { code, data },
    } = await got<{
      code: 20000;
      data: {
        day: '2022-02-17';
        errcode: '0';
        max: 59;
        min: 0;
        nums: { DT: 15; SZJS: 1580; XDJS: 2946; ZBL: 45.6311; ZRZT: 51; ZT: 58; ZTZB: 47; yestRase: 0.166 };
        time: 0;
        trend: [['09:30', 0, 0], ['09:31', 1, 7]];
        ttag: 0.001367;
      };
    }>('http://stock.zizizaizai.com:9001/open/sentiment/uplimit/trend', {
      searchParams: {
        date1: date,
      },
      responseType: 'json',
    });
    if (code != 20000) {
      console.error('获取涨停板数据失败:' + date);
    }
    return data || {};
  } catch (error) {
    console.log('获取涨停板数据失败', error);
    return {};
  }
}

/// type: 0-昨日涨停；20-昨日人气
export async function requestTopPerfKline(date: string, type: number) {
  try {
    const {
      body: { code, data },
    } = await got<{
      code: 20000;
      data: [
        {
          date: '2021-02-18';
          id: 533;
          modal_id: 0;
          p_close: 323.35;
          p_close_pre1d: 321.02;
          p_high: 324.44;
          p_low: 320.39;
          p_open: 321.7;
        }
      ];
    }>(`http://stock.zizizaizai.com:9001/v2/api/sentiment/kline/day/${type}`, {
      searchParams: {
        date1: date,
      },
      responseType: 'json',
    });
    if (code != 20000) {
      console.error('获取昨日表现数据失败:' + date);
    }
    const ks =
      data.map((d) => {
        return {
          date: d.date,
          kp: d.p_open,
          sp: d.p_close,
          zg: d.p_high,
          zd: d.p_low,
          zs: d.p_close_pre1d,
        } as Stock.KLineItem;
      }) || [];
    return { type, ks };
  } catch (error) {
    console.log('获取昨日表现数据失败', error);
    return { type, ks: [] };
  }
}

export async function requestTradeDays(date: string, type: number) {
  try {
    const {
      body: { status, data },
    } = await got<{
      status: 0;
      data: ['2022-02-07', '2022-02-08', '2022-02-09', '2022-02-10', '2022-02-11', '2022-02-14', '2022-02-15', '2022-02-16', '2022-02-17'];
    }>('http://stock.ziruxing.com/open/tradedays', {
      searchParams: {
        date1: date,
      },
      responseType: 'json',
    });
    if (status != 0) {
      console.error('获取交易日数据失败:' + date);
    }
    return data;
  } catch (error) {
    console.log('获取交易日数据失败', error);
    return { type, ks: [] };
  }
}

/**
 * 获取历史分时数据（https://opensourcecache.zealink.com/cache/dealday/day/20220426/002305.sz.json）
 * @param secid 标的ID
 * @param date 交易日，yyyyMMdd
 * @returns
 */
export async function requestDealDay(secid: string, date: string) {
  try {
    const {
      body: { day, deal },
    } = await got<{
      date: 20220426;
      day: {
        open: 2.5600000000000001;
        price: 2.8199999999999998;
        yclose: 2.5600000000000001;
      };
      deal: {
        amount: [28829184, 15142996];
        flag: [1, 0];
        price: [2.5600000000000001, 2.6099999999999999];
        time: [92500, 93000];
        vol: [11261400, 5846200];
      };
      decnum: 2;
      name: '南国置业';
      symbol: '002305.sz';
      update: 20220426160425;
    }>(
      `https://opensourcecache.zealink.com/cache/dealday/day/${date.replaceAll('-', '')}/${secid.substring(2)}.${secid.startsWith('0') ? 'sz' : 'sh'
      }.json`,
      {
        responseType: 'json',
      }
    );
    if (!day) {
      console.error('获取历史分时数据失败:' + date);
    }
    const data = [] as Stock.TrendItem[];
    const formatTime = (tint: number) => {
      const seconds = tint % 100;
      const minutes = parseInt('' + tint / 100) % 100;
      const hours = parseInt('' + tint / 10000);
      return `${hours}:${minutes}:${seconds}`;
    };
    let all_vol = 0;
    let all_money = 0;
    for (let i = 0; i < deal.time.length; i++) {
      all_vol += deal.vol[i];
      all_money += deal.vol[i] * deal.price[i];
      data.push({
        datetime: formatIntTime(deal.time[i]),
        last: i == 0 ? day.yclose : deal.price[i - 1],
        current: deal.price[i],
        vol: deal.vol[i],
        up: deal.flag[i],
        average: all_money / all_vol,
        holdPosition: 0,
      });
    }
    return data;
  } catch (error) {
    console.log('获取历史分时数据失败', error);
    return [];
  }
}

export async function GetFutureDetailFromSina(symbol: string) {
  try {
    const { body } =
      await got<'11162.725,,11159.250,11160.250,11185.000,11021.750,14:28:59,11083.750,11064.750,277112.000,1,2,2022-10-14,纳斯达克指数期货,66555'>(
        `https://hq.sinajs.cn/?_=1665728939853/&list=hf_${symbol}`,
        {
          headers: {
            referer: `https://finance.sina.com.cn/futures/quotes/${symbol}.shtml`,
          },
        }
      );
    const str = body.split('=')[1].replaceAll('"', '');
    const arr = str.split(',');
    const detail = {} as Stock.DetailItem;
    detail.secid = symbol;
    detail.code = symbol;
    detail.market = StockMarketType.Future;
    detail.zx = Number(arr[0]);
    detail.zs = Number(arr[7]);
    detail.zg = Number(arr[4]);
    detail.zd = Number(arr[5]);
    detail.cje = Number(arr[9]);
    detail.zdd = detail.zx - detail.zs;
    detail.zdf = (detail.zx / detail.zs - 1.0) * 100;
    detail.b1p = Number(arr[2]);
    detail.s1p = Number(arr[3]);
    detail.b1 = Number(arr[10]);
    detail.s1 = Number(arr[11]);
    return detail;
  } catch (error) {
    return null;
  }
}

export async function GetFutureTrendFromSina(symbol: string) {
  try {
    const {
      body: { minLine_1d },
    } = await got<{
      minLine_1d: [['2022-10-12', '10845.000', 'cme', '', '06:00', '10872.875', '211', '278252', '10872.082', '2022-10-12 06:00:00']];
    }>(`http://stock2.finance.sina.com.cn/futures/api/json.php/GlobalFuturesService.getGlobalFuturesMinLine?symbol=${symbol}`, {
      responseType: 'json',
    });
    const trends = minLine_1d.map((item, i) => {
      const t = {} as Stock.TrendItem;
      t.datetime = item.slice(-1)[0];
      t.current = Number(item[i == 0 ? 5 : 1]);
      t.vol = Number(item[6]);
      t.average = Number(item[8]);
      t.holdPosition = Number(item[7]);
      t.last = Number(item[1]);
      t.up = t.current < t.last ? -1 : 1;
      return t;
    });
    const processed = [] as Stock.TrendItem[];
    let item = trends[0];
    for (let i = 1; i < trends.length; i++) {
      const pMin = item.datetime.substr(14, 2);
      const nMin = trends[i].datetime.substr(14, 2);
      if (pMin == nMin) {
        trends[i].vol += item.vol;
        trends[i].last = item.last;
      } else {
        processed.push(item);
      }
      item = trends[i];
      if (i == trends.length - 1) {
        processed.push(trends[i]);
      }
    }
    return {
      secid: symbol,
      trends: processed,
    };
  } catch (error) {
    return {
      secid: symbol,
      trends: [],
    };
  }
}

function stringToDate(str: string) {
  const [dateValues, timeValues] = str.split(' ');
  if (!timeValues) {
    return new Date(dateValues);
  }
  const [year, month, day] = dateValues.split('-');
  const [hours, minutes, seconds] = timeValues.split(':');
  return new Date(+year, +month - 1, +day, +hours, +minutes, +seconds);
}

export async function GetFutureKFromSina(symbol: string, type: KLineType, limit?: number) {
  if (type >= KLineType.Day) {
    const data = await GetFutureDayKFromSina(symbol);
    if (data.ks && data.ks.length > 0) {
      // 根据类型进行封装
      if (type == KLineType.Week) {
        const wks = [];
        const isSameWeek = (t: string, e: string) => {
          // 前一日，后一日
          const i = 6048e5,
            n = 2592e5,
            r = (stringToDate(t).getTime() - n) / i,
            a = (stringToDate(e).getTime() - n) / i;
          return Math.floor(r) == Math.floor(a);
        };
        let newK = {} as Stock.KLineItem;
        for (let i = 0; i < data.ks.length; i++) {
          const currentK = data.ks[i];
          if (i == 0) {
            newK = currentK;
          } else {
            const prevK = data.ks[i - 1];
            if (isSameWeek(prevK.date, currentK.date)) {
              newK.cjl += currentK.cjl;
              if (newK.cje) newK.cje += currentK.cje;
              newK.zg = Math.max(newK.zg, currentK.zg);
              newK.zd = Math.min(newK.zd, currentK.zd);
              newK.date = currentK.date;
              if (i == data.ks.length - 1) {
                wks.push(newK);
              }
            } else {
              // new record
              wks.push(newK);
              newK = currentK;
            }
          }
        }
        data.ks = wks;
      } else if (type == KLineType.Month) {
        const mks = [];
        const isSameMonth = (t: string, e: string) => {
          // 前一日，后一日
          const td = stringToDate(t);
          const ed = stringToDate(e);
          return td.getFullYear() == ed.getFullYear() ? td.getMonth() == ed.getMonth() : !1;
        };
        let newK = {} as Stock.KLineItem;
        for (let i = 0; i < data.ks.length; i++) {
          const currentK = data.ks[i];
          if (i == 0) {
            newK = currentK;
          } else {
            const prevK = data.ks[i - 1];
            if (isSameMonth(prevK.date, currentK.date)) {
              newK.cjl += currentK.cjl;
              if (newK.cje) newK.cje += currentK.cje;
              newK.zg = Math.max(newK.zg, currentK.zg);
              newK.zd = Math.min(newK.zd, currentK.zd);
              newK.date = currentK.date;
              if (i == data.ks.length - 1) {
                mks.push(newK);
              }
            } else {
              // new record
              mks.push(newK);
              newK = currentK;
            }
          }
        }
        data.ks = mks;
      }
    }
    return data;
  } else {
    return GetFutureMintKFromSina(symbol, type);
  }
}

// https://gu.sina.cn/ft/api/jsonp.php/var%20DATA=/GlobalService.getMink?symbol=NQ&type=15
export async function GetFutureDayKFromSina(symbol: string) {
  try {
    const { body } = await got<
      [
        {
          date: '2018-04-24';
          open: '6660.750';
          high: '6717.750';
          low: '6467.250';
          close: '6526.750';
          volume: '626789';
          position: '0';
          s: '0.000';
        }
      ]
    >(`https://stock2.finance.sina.com.cn/futures/api/json.php/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=${symbol}`, {
      responseType: 'json',
    });
    const ks = body.map((item, i) => {
      const k = {} as Stock.KLineItem;
      k.secid = symbol;
      k.date = item.date;
      k.kp = Number(item.open);
      k.sp = Number(item.close);
      k.zg = Number(item.high);
      k.zd = Number(item.low);
      k.cjl = Number(item.volume);
      return k;
    });
    return {
      ks,
      kt: KLineType.Day,
    };
  } catch (error) {
    console.log(error);
    return {
      ks: [],
      kt: KLineType.Day,
    };
  }
}

export async function GetFutureMintKFromSina(symbol: string, type: KLineType) {
  let t = 5;
  switch (type) {
    case KLineType.Mint1:
      t = 1;
      break;
    case KLineType.Mint5:
      t = 5;
      break;
    case KLineType.Mint15:
      t = 15;
    case KLineType.Mint30:
      t = 30;
    case KLineType.Mint60:
      t = 60;
  }
  try {
    const { body } = await got<string>(`https://gu.sina.cn/ft/api/jsonp.php/var%20DATA=/GlobalService.getMink?symbol=${symbol}&type=${t}`);
    const startIdx = body.indexOf('=(');
    const rawStr = body.substring(startIdx + 2, body.length - 2);
    const arr = JSON.parse(rawStr);
    const ks = arr.map((item: any) => {
      const k = {} as Stock.KLineItem;
      k.secid = symbol;
      k.date = item.d;
      k.kp = Number(item.o);
      k.sp = Number(item.c);
      k.zg = Number(item.h);
      k.zd = Number(item.l);
      k.cjl = Number(item.v);
      return k;
    });
    return {
      ks,
      kt: type,
    };
  } catch (error) {
    console.log(error);
    return {
      ks: [],
      kt: type,
    };
  }
}
