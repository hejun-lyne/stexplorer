import { ChanTrendState, ChanType, KNoteType, MAType, PriceMAState, DayTrendType, StrategyType, ZLType, MRType, SingleKLineShape, MultiKlineShape, KLineEntitySize, KLineHatchType, MarkType, PeriodMarkType } from '@/utils/enums';

declare namespace Stock {
  export interface SettingItem {
    market: number;
    code: string;
    secid: string;
    name: string;
    type: number;
    pos: number;
    tags?: string[];
    expanded?: boolean;
    onDetailed?: boolean;
    onConcerned?: boolean;
    onHolded?: boolean;
    strategy?: StrategyType;
    marktype?: MarkType;
    holdings: HoldingItem[];
    knotes?: KNoteItem[];
    hybk?: {
      code: string;
      name: string;
    };
    monitors?: string[];
    character?: {
      zlcb: number; // 主力成本
      zltype: ZLType; // 主力类型
      qstype: DayTrendType; // 趋势类型
    };
    markLines?: number[]; // 标记线
    buyPoints?: { x: string; y: number; t: boolean }[]; // 买入标记
    sellPoints?: { x: string; y: number; t: boolean }[]; // 买入标记
    similars?: SimilarItem[];
    periodMarks: PeriodMarkItem[];
  }
  export interface PeriodMarkItem {
    id: number;
    secid: string;
    name: string;
    type: PeriodMarkType;
    startDate: string;
    endDate: string;
  }
  export interface SimilarItem {
    id: number;
    secid: string;
    name: string;
    startDate: string;
    endDate: string;
  }
  export interface HoldingItem {
    price: number;
    count: number;
    time: string;
    sold: boolean;
    profit: number;
  }
  export interface TrendItem {
    datetime: string; // 时间
    last: number; // 前一价格
    current: number; // 当前价格
    vol: number; // 成交量
    average: number; // 均价
    up: number; // 是否主买
    holdPosition: number; // 来自期货，持仓量
  }
  export interface FlowTrendItem {
    main: number; /// 主力 = 大单+超大单
    mainDiff: number; /// 主力变化
    small: number; /// 小单
    medium: number; /// 中单
    big: number; /// 大单
    superbig: number; // 超大单
    time: string; /// 时间
  }
  export interface DetailItem {
    secid: string;
    code: string;
    name: string;
    color?: string;
    market: number;
    bk: string;
    zg: number; // 最高
    zd: number; // 最低
    jk: number; // 今开
    zss: number; // 总手数
    zt: number; // 涨停
    dt: number; // 跌停
    zx: number; // 最新
    cjl: number; // 成交量
    lb: number; // 量比
    cje: number; // 成交额
    wp: number; // 外盘
    zs: number; // 昨收
    jj: number; // 均价
    np: number; // 内盘
    hsl: number; // 换手率
    zdd: number; // 涨跌点
    zdf: number; /// 涨跌幅
    s1: number; /// 卖1手数
    s1p: number; /// 卖1价格
    s2: number; /// 卖2手数
    s2p: number; /// 卖2价格
    s3: number; /// 卖3手数
    s3p: number; /// 卖3价格
    s4: number; /// 卖4手数
    s4p: number; /// 卖4价格
    s5: number; /// 卖5手数
    s5p: number; // 卖5价格
    b1: number; /// 买1手数
    b1p: number; /// 买1价格
    b2: number; /// 买2手数
    b2p: number; /// 买2价格
    b3: number; /// 买3手数
    b3p: number; /// 买3价格
    b4: number; /// 买4手数
    b4p: number; /// 买4价格
    b5: number; /// 买5手数
    b5p: number; /// 买5价格
    syl: number; /// 市盈率
    sjl: number; /// 市净率
    sz: number; /// 总市值
    lt: number; /// 流通市值
    ltg: number; // 流通股数
    cm5: number; /// 5分钟涨跌
    cd60: number; /// 60日涨跌
    cy1: number; /// 年内涨跌
    cs: number; /// 涨速
    time: string; /// 时间
    hybk?: {
      code: string;
      name: string;
    };
  }
  export interface PartDetailItem {
    secid: string;
    code: string;
    name: string;
    market: number;
    zg: number; // 最高
    zd: number; // 最低
    jk: number; // 今开
    zss: number; // 总手数
    zx: number; // 最新
    lb: number; // 量比
    cjl: number;
    cje: number; // 成交额
    zs: number; // 昨收
    cs: number; /// 涨速
    zdf: number;
    zdd: number;
    hsl: number;
    syl: number;
  }
  export interface TradeItem {
    time: string; // 时间
    price: number; // 价格
    vol: number; // 成交手数
    tickets: number; // 单数
    up: number; // 方向
  }
  export interface KLineItem {
    secid: string;
    type: number;
    date: string; // 时间
    kp: number; // 开盘价
    sp: number; // 收盘价
    zg: number; // 最高价
    zd: number; // 最低价
    zs: number; // 昨收
    cjl: number; // 成交量
    cje: number; // 成交额
    zf: number; // 振幅
    zdf: number; // 涨跌幅
    zde: number; // 涨跌额
    hsl: number; // 换手率
    chan: ChanType;
    notes?: string[]; // 标注
    describe?: {
      yin: boolean; // 是否阴线
      size: number; // 实体大小
      top: number; // 上影线
      down: number; // 下影线
      sizeType: KLineEntitySize;
      hatchType: KLineHatchType;
      sshapeType: SingleKLineShape; // k线形态
      mshapeType: MultiKlineShape; // 多根k线形态
    };
    buyorsell?: {
      canBuy: boolean;
      doBuy: boolean;
      canSell: boolean;
      buyReason: string;
      sellReason: string;
    };
  }
  export interface FlowDLineItem {
    secid: string;
    date: string; // 时间
    main: number; /// 主力 = 大单+超大单
    small: number; /// 小单
    medium: number; /// 中单
    big: number; /// 大单
    superbig: number; // 超大单
    mainZdf: number;
    smallZdf: number;
    mediumZdf: number;
    bigZdf: number;
    superbigZdf: number;
    netMain: number;
    netSmall: number;
    netMedium: number;
    netBig: number;
    netSuperBig: number;
  }
  export interface MACDItem {
    dif: number;
    dea: number;
    bar: number;
  }
  export interface SearchResult {
    Type: number; // 7,
    Name: string; // "三板",
    Count: number; // 3;
    Datas: SearchItem[];
  }
  export interface SearchItem {
    Code: string; // '839489';
    Name: string; // '同步天成';
    ID: string; // '839489_TB';
    MktNum: string; // '0';
    SecurityType: string; // '10';
    MarketType: string; // '_TB';
    JYS: string; // '81';
    GubaCode: string; // '839489';
    UnifiedCode: string; // '839489';
  }
  export interface Company {
    gsjs: string; // 公司介绍
    sshy: string; // 所属行业
    dsz: string; // 董事长
    zcdz: string; // 注册地址
    clrq: string; // 成立日期
    ssrq: string; // 上市日期
  }
  export interface BanKuai {
    secid: string;
    name: string; // 板块名字
    code: string; // 板块代码
    zdf: number; // 涨跌幅
  }
  export interface ExtraRow {
    collapse?: boolean;
    position: number; // 排序位置
  }
  export interface ChanItem {
    date: string; // 时间
    kp: number; // 最高价
    sp: number; // 最低价
    zg: number;
    zd: number;
    zdf: number; // 涨跌幅
    cjl: number; // 成交量
    cje: number; // 成交额
    hsl: number; // 换手率
    days: number; // 持续天数
    type: number; // 缠类型
  }
  export interface ChanStokeItem {
    start: ChanItem;
    end: ChanItem;
    startIndex: number;
    endIndex: number;
    days: number;
    direction: string; // down, up
  }
  export interface ChanLineItem {
    stokes: ChanStokeItem[];
    gspot: number;
    direction: string; // down, up
    days: number; // 周期
  }
  export interface ChanPlatformItem {
    lines: ChanLineItem[];
    start: number;
    end: number;
    startDate: string;
    endDate: string;
    pivot: number;
  }
  export interface ChanTrendItem {
    steps: (ChanPlatformItem | ChanLineItem)[];
    direction: string; // down, up
  }
  export interface AllData {
    detail: Stock.DetailItem;
    bankuais: Stock.BanKuai[];
    trendspic: string;
    trends: TrendItem[]; /// 分时趋势
    tflows: FlowTrendItem[]; /// 资金流入趋势
    klines: Record<number, Stock.KLineItem[]>;
    kstates: Record<number, Record<string, PriceMAState>>;
    dflows: Stock.FlowDLineItem[];
    chans: Record<number, Stock.ChanItem[]>;
    chanStokes: Record<number, Stock.ChanStokeItem[]>;
    chanLines: Record<number, Stock.ChanLineItem[]>;
    chanPlatforms: Record<number, Stock.ChanPlatformItem[]>;
    chanState: number[];
    extra: Stock.ExtraRow;
  }

  export interface NewsItem {
    newsid: string;
    postid: string;
    title: string;
    url: string;
    time: string;
    abstract: string;
    content: string;
  }

  export interface CommentReply {
    userNick: string;
    userAge: string;
    userArea: string;
    isAuthor: boolean;
    time: string;
    text: string;
  }
  export interface Comment {
    url: string;
    content: string;
    time: string;
    userNick: string;
    userAge: string;
    replies: CommentReply[];
  }

  export interface DayRecordItem {
    date: string;
    maStates: Record<number, Record<number, string[]>>;
    chanStates: Record<number, string[]>;
    gStates: Record<number, string[]>;
  }

  export interface DoTradeItem {
    id: number;
    type: string; // buy | sell
    secid: string;
    name: string;
    price: number; // 买入价
    count: number; // 买入数量
    time: string;
    stoplossAt: number; // 止损价
    latestNewsAs: string; // positive | negative
    explain: string;
    profits: number[];
    strategy?: MRType;
  }

  export interface NowHoldItem {
    secid: string;
    name: string;
    price: number; // 买入价
    count: number; // 买入数量
    lastBuyDate: string; // 最后买入时间
    lastBuyStrategy: MRType; // 买入策略
    lastBuyReason: string; // 买入理由
  }

  export interface ChouMaItem {
    date: string; // 当前时间
    values: number[]; // 每一分位的筹码占比
    steps: string[]; // 分位价格
    benefitRatio: number; // 获利比例
    avgCost: string; // 平均成本
    percentChips: {
      percentile: number; // .50 | .70 | .90 // 分位
      priceRange: {
        start: string;
        end: string;
      };
      concentration: number; // 集中度
    }[];
  }

  export interface BanKuaiItem {
    code: string;
    name: string;
    market: number;
    secid: string;
    zx: number;
    zdd: number;
    zdf: number;
    zsz: number; // 总市值
    hsl: number;
    szs: number; // 上涨数
    xds: number; // 下跌数
  }

  export interface ZTItem {
    code: string;
    name: string;
    market: number;
    secid: string;
    zx: number;
    zdf: number;
    hsl: number; // 换手率
    fbt: string; // 封板时间
    lbt: string; // 最后封板时间
    zbc: number; // 炸板数
    fbf: number; // 封板资金
    hybk: string; // 活跃板块
    lbc: number; // 连板次数
    ltsz: number; // 流通市值
    zsz: number; // 总市值
    zttj: {
      ct: number; // 数
      days: number; // 天
    };
  }

  export interface QSItem {
    code: string;
    name: string;
    market: number;
    secid: string;
    reason: number; // 推荐理由//次值&1 = 1；//60日新高 //次值 & 2 = 2；//近期多次涨停
    zx: number;
    zdf: number;
    hsl: number;
    lb: number;
    nh: boolean; // 是否新高
    ltsz: number;
    hybk: string;
    zttj: {
      ct: number; // 数
      days: number; // 天
    };
  }

  export interface CXItem {
    code: string;
    name: string;
    market: number;
    secid: string;
    hybk: string;
    ltsz: number;
    zx: number;
    zdf: number;
    hsl: number;
    nh: boolean; // 是否新高
    ipod: string; // 上市日期
    open: boolean; // 是否开板
    odays: number; // 开板几日
    zttj: {
      ct: number; // 数
      days: number; // 天
    };
  }

  export interface ZBItem {
    code: string;
    name: string;
    market: number;
    secid: string;
    hybk: string;
    ltsz: number;
    zx: number;
    zdf: number;
    hsl: number;
    fbt: string; // 封板时间
    zbc: number; // 炸板次数
    zf: number; // 振幅
    zttj: {
      ct: number; // 数
      days: number; // 天
    };
  }

  export interface DTItem {
    code: string;
    name: string;
    market: number;
    secid: string;
    hybk: string;
    ltsz: number;
    zx: number;
    zdf: number;
    hsl: number;
    fba: number; // 板上成交额
    fbf: number; // 封单资金
    dtdays: number; // 连续跌停天数
    lbt: string; // 最后封板时间
    oc: number; // 开板次数
  }

  export interface JLStrategyItem {
    ask: KLineItem; // 底部平台起点
    alk: KLineItem; // 底部平台低点
    ahk: KLineItem; // 底部平台高点
    adays: number; // 底部平台周期
    bk: KLineItem; // 突破k线
    blb: number; // 突破量比（突破k线成交量/底部平台平均成交量）
    chk: KLineItem; // 盘整平台高点
    clk: KLineItem; // 盘整平台低点
    clb: number; // 盘整最新量比（最新成交量/盘整平台平均成交量）
    cdays: number; // 已盘整周期
  }

  export interface QSStrategyItem {
    mtype: MAType; // 均线类型
    segs: {
      si: number; // 开始索引
      hi: number; // 最高位置索引
      ei: number; // 结束位置索引
    }[];
    touchMa: boolean; // 当前是否触碰均线
  }

  export interface KNoteItem {
    id: number;
    startDate: string;
    endDate: string;
    type: KNoteType;
    text: string;
    createTime: string;
    modifiedTime: string;
    stoplossAt?: number;
    isTrain: boolean;
  }

  export interface MarketMoodItem {
    time: string;
    value: number;
  }

  export interface MarketZTSItem {
    time: string;
    zrzt: number;
    zb: number;
  }

  export interface KLineAreaItem {
    start: string;
    end: string;
    kp: number;
    sp: number;
    zdf: number; // 涨跌幅
    days: number; // 交易日
    zghsl: number; // 最高换手率
    zdhsl: number; // 最低换手率
    zhhsl: number; // 总和换手率
    avghsl: number; // 平均换手率
    avgcost: number; // 平均成本
    gvalues: number[]; // 黄金分割位置
  }

  export interface KLineStatisticItem {
    secid: string;
    name: string;
    bksecid: string;
    bkname: string;
    zx: number; // 价格
    lt: number; // 流通
    zdf: number; // 涨跌幅
    lhb_date: string; // 最近上榜时间
    b1d_zdf: number; // 昨日涨跌幅
    b1d_hsl: number; // 昨日换手
    b1d_rank: number; // 昨日排名
    b3d_zdf: number; // 3日涨跌幅
    b3d_hsl: number; // 3日换手
    b3d_rank: number; // 3日排名
    b5d_zdf: number; // 5日涨跌幅
    b5d_hsl: number; // 5日换手率
    b5d_rank: number; // 5日排名
    b10d_zdf: number; // 10日涨跌幅
    b10d_hsl: number; // 10日换手率
    b10d_rank: number; // 10日排名
    b20d_zdf: number; // 20日涨跌幅
    b20d_hsl: number; // 20日换手率
    b20d_rank: number; // 20日排名
    zdays_5d: number; // 5日上涨天数
    zdays_10d: number; // 10日上涨天数
    lb: number; // 连板数
    zt_5d: number; // 5日涨停数
    zt_10d: number; // 10日涨停数
  }

  export interface QuantActionItem {
    choosenBks: Stock.BanKuaiItem[];
    choosenSts: { secid: string; name: string }[];
    makeBuys: { secid: string; name: string; price: number; amount: number }[];
    makeSells: { secid: string; name: string; price: number; profit: number }[];
    holds: { secid: string; name: string; price: number; amount: number; profit: number; day: moment.Moment }[];
    wins: number;
    loss: number;
    totalProfit: number;
    availableMoney: number;
    day: moment.Moment;
    bkstats: KLineStatisticItem[];
    ststats: Record<string, KLineStatisticItem[]>;
  }

  export interface QuantTestDataItem {
    secid: string;
    res: 0 | 1; // 涨跌结果
    bk_b1d_hsl_zs: number;
    bk_b3d_hsl_zs: number;
    bk_b5d_hsl_zs: number;
    bk_b10d_hsl_zs: number;
    bk_zdays_5d: number;
    bk_zdays_10d: number;
    bk_b1d_rank: number;
    bk_b3d_rank: number;
    bk_b5d_rank: number;
    bk_b10d_rank: number;
    b1d_hsl_zs: number;
    b3d_hsl_zs: number;
    b5d_hsl_zs: number;
    b10d_hsl_zs: number;
    zdays_5d: number;
    zdays_10d: number;
    b1d_rank: number;
    b3d_rank: number;
    b5d_rank: number;
    b10d_rank: number;
  }

  export interface CLItem {
    secid: string;
    name: string;
    lt: number;
    zx: number;
    zdf: number;
    hsl: number;
    hybk: {
      code: string;
      name: string;
    };
    finance: {
      TOTALOPERATEREVETZ: number; // 营收同比增长
      KCFJCXSYJLRTZ: number; // 扣非利润同比增长
      YYZSRGDHBZC: number; // 营收环比增长
      KFJLRGDHBZC: number; // 扣非利润环比增长
    };
    latestK: Stock.KLineItem;
  }

  export interface MatchItem {
    secid: string;
    name: string;
    lt: number;
    zx: number;
    zdf: number;
    hsl: number;
    hybk: {
      code: string;
      name: string;
    };
    match: {
      diff: number;
      date: string;
    };
  }
}
