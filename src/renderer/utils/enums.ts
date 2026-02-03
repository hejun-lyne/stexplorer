import { number } from "echarts";

export enum FundApiType {
  Eastmoney, // 天天基金
  Dayfund, // 基金速查网
  Tencent, // 腾讯证券
  Sina, // 新浪基金
  Howbuy, // 好买基金
  Etf, // 易天富
  ZiZai, // 自在量化
  XTick, // XTick
}

export enum TrayContent {
  Sy,
  Syl,
  None,
}

export enum SystemThemeType {
  Auto,
  Light,
  Dark,
}

export enum StockSortType {
  Custom, // 自定义
  Zdd, // 涨跌点
  Zdf, // 涨跌幅
  Zx, // 指数值
}

export enum SortOrderType {
  Desc,
  Asc,
}

export enum PositionType {
  Top,
  Bottom,
  Up,
  Down,
}

export enum StockMarketType {
  AB = 1,
  Zindex = 2,
  Quotation = 3,
  HK = 4,
  US = 5,
  UK = 6,
  XSB = 7,
  Fund = 8,
  Bond = 9,
  USZindex = 10,
  Future = 11,
}

export enum KLineType {
  Trend = 100,
  Day = 101,
  Week = 102,
  Month = 103,
  Mint1 = 1,
  Mint5 = 5,
  Mint15 = 15,
  Mint30 = 30,
  Mint60 = 60,
}

export const allKlineTypes = [
  KLineType.Trend,
  KLineType.Mint1,
  KLineType.Mint5,
  KLineType.Mint15,
  KLineType.Mint30,
  KLineType.Mint60,
  KLineType.Day,
  KLineType.Week,
  KLineType.Month,
];

export const DefaultKTypes = [
  KLineType.Trend,
  KLineType.Mint5,
  KLineType.Mint30,
  KLineType.Mint60,
  KLineType.Day,
  KLineType.Week,
  KLineType.Month,
];

export enum ChanType {
  Unknow = 0,
  StepUp = 1,
  StepDown = 2,
  Child = 3,
  Bottom = 4,
  Top = 5,
}

export enum MAType {
  MA5 = 5,
  MA10 = 10,
  MA20 = 20,
  MA30 = 30,
  MA40 = 40,
  MA60 = 60,
  MA120 = 120,
}

export const DefaultMATypes = [MAType.MA5, MAType.MA10, MAType.MA20];

export enum PriceMAState {
  Unknown = 0,
  LowCrossMA = 1,
  CloseAboveMA = 2,
  AllAboveMA = 3,
  HighCrossMA = 4,
  CloseBelowMA = 5,
  AllBelowMA = 6,
}

export enum ChanTrendState {
  Unknow = 0,
  BottomUp = 1,
  TrendUp = 2,
  TopDown = 3,
  TrendDown = 4,
}

export enum ChanGSpotState {
  Unknow = 0,
  LowCrossGSpot = 1,
  CloseAboveGSpot = 2,
  AllBelowGSpot = 3,
  HighCrossGSpot = 4,
  CloseBelowGSpot = 5,
  AllAboveGSpot = 6,
}

export const KStateStrings: Record<number, string> = {
  0: '未知',
  1: '支撑',
  2: '突破',
  3: '多头',
  4: '冲刺',
  5: '破位',
  6: '空头',
};

export const CStateStrings: Record<number, string> = {
  0: '未知',
  1: '底反弹',
  2: '上升',
  3: '顶反转',
  4: '下降',
};

export const GStateStrings: Record<number, string> = {
  0: '未知',
  1: '支撑',
  2: '突破',
  3: '多头',
  4: '冲刺',
  5: '破位',
  6: '空头',
};

export const KlineTypeNames = {
  100: '分时',
  101: '日K线',
  102: '周K线',
  103: '月K线',
  1: '1分钟',
  5: '5分钟',
  15: '15分钟',
  30: '30分钟',
  60: '60分钟',
};

export enum MAPeriodType {
  Short = 0,
  Medium = 1,
  Long = 2,
  JAX = 3,
  DGWY = 4,
  LYT = 5,
}

export const MAPeriodTypeNames = {
  0: ['MA5', 'MA10', 'MA20'],
  1: ['MA20', 'MA40', 'MA60'],
  2: ['MA60', 'MA120', 'MA250'],
  3: ['JAX_L', 'JAX_S'],
  4: ['MID', 'UPPER', 'LOWER'],
  5: ['LYT'],
}

export enum TechIndicatorType {
  MACD = 0,
  KDJ = 1,
  RSI = 2,
  OBV = 3,
  ADV = 4,
  STOCH = 5,
  CG = 6
}

export const DefaultTechIndicatorTypes = [
  TechIndicatorType.MACD,
  TechIndicatorType.KDJ,
  TechIndicatorType.RSI,
  TechIndicatorType.OBV,
  TechIndicatorType.ADV,
  TechIndicatorType.STOCH,
  TechIndicatorType.CG
]

export const TechIndicatorNames = {
  0: 'MACD',
  1: 'KDJ',
  2: 'RSI',
  3: 'OBV',
  4: 'ADV',
  5: 'STOCH',
  6: 'CG'
}

export const TechIndicatorSeriesNames = {
  0: ['slow', 'fast', 'signal'],
  1: ['k', 'd', 'j'],
  2: ['RSI6', 'RSI12', 'RSI24'],
  3: ['OBV'],
  4: ['ADV', 'DI+', 'DI-'],
  5: ['D', 'K'],
  6: ['CG', 'signal']
}

export enum PeriodMarkType {
  Unknown = 0,
  DuoChongDing = 1, // 多重顶
  QingXingZhengLi = 2, // 旗形整理
  LiSanLaXingLaSheng = 3, // 离散型拉升
}

export const PeriodMarkTypeNames = {
  0: '未知形态',
  1: '多重顶',
  2: '旗形整理',
  3: '离散型拉升',
}

export const PeriodMarkTypeDescribes = {
  0: '',
  1: '属于长期底部，主力通过连续多次的拉高回落形成多个三角走势，最后通过跌破底部形成挖坑，然后逐步拉高，伴随成交量的放大和大阳线的出现，突破新高，走出加速上涨趋势',
  2: '属于突破回调，主力通过涨停或者大阳线突破前期压力位，为了避免抛压过大，从而出现的回调，伴随成交缩量和小k线出现，回调到关键位置再通过大阳线走出反弹趋势',
  3: '属于拉升形态，第一阶段表现为旗形整理，第二阶段多大阴大阳线，多跳空缺口，往往是突然涨停，又突然跌停，一般形成双顶之后就结束行情'
}

export enum BKType {
  Industry = 0,
  Gainian = 1,
}

export enum MarkType {
  Default = 0,
  WillBuy = 1,
  WillHold = 2,
  WillSell = 3,
}

export enum StrategyType {
  None = 0,
  PTTP = 1,
  QSJL = 2,
  SYJC = 3,
  TPQG = 4,
  XYJC = 5,
}

export const StrategyTypeNames = {
  0: '暂无策略',
  1: '平台突破',
  2: '换手接力',
  3: '首阳建仓',
  4: '突破前高',
  5: '小阳建仓',
};

export enum KNoteType {
  None = 0,
  BUY = 1,
  SELL = 2,
  HOLD = 3,
  WAIT = 4,
}

export enum KSortType {
  None = 0,
  ZDSJ = 1, // 最低点时间
  FTGD = 2, // 反弹高度
  WRZF = 3, // 5日涨幅
}

export const KSortTypeNames = {
  0: '排序类型',
  1: '最低时间',
  2: '反弹高度',
  3: '5日涨幅',
};

export const KNoteTypeNames = {
  0: '计划',
  1: '买入',
  2: '卖出',
  3: '持有',
  4: '等待',
};

export const KNoteTypeColors = {
  0: 'rgba(0, 0, 0, 0.1)',
  1: '#e85d04',
  2: '#0096c7',
  3: '#f94144',
  4: 'var(--reduce-color)',
};

export enum KFilterType {
  None = 0,
  ZJZT = 1, // 最近涨停
  FLYX = 2, // 放量阳线
  CXFB = 3, // 出现反包
  XYJC = 4, // 小阳建仓
  TPHP = 5, // 突破横盘，60日新高，并且未跌破起涨点
  FQFB = 6, // 回调反包，-3天涨停或者大阳线，-2天收放量小阳线，-1天涨停
  FYZS = 7, // 扶摇直上
  JDXH = 8, // 见底信号，低开高走，有下杀有拉升，放量阳线
  NKCB = 9, // 不要科创板
}

export const KFilterTypeNames = {
  0: '未知条件',
  1: '最近涨停',
  2: '放量阳线',
  3: '出现反包',
  4: '小阳建仓',
  5: '突破横盘',
  6: '分歧反包',
  7: '扶摇直上',
  8: '见底信号',
  9: '无科创板',
};

export enum ZLType {
  None = 0, // 无主力
  MJG = 1, // 多机构
  SJG = 2, // 单机构
  YZ = 3, // 游资
  ZJ = 4, // 庄家
}

export const ZLTypeNames = {
  0: '无主力',
  1: '多机构',
  2: '单机构',
  3: '游资',
  4: '庄家',
};

export const ZLTypeHints = {
  0: '无主力，说明交易比较清淡，不要仓与',
  1: '多机构主力，交易者多，适合技术指标分析（认知差）',
  2: '单机构主力，控盘强，不适合技术指标分析（认知差）',
  3: '游资，快进快出，只适合短线（情绪差）',
  4: '庄家，高度控盘，不能参与（消息差）',
};

export enum DayTrendType {
  None = 0, // 横盘震荡
  SZJQ = 1, // 上涨动能加强
  SZJR = 2, // 上涨动能减弱
  XDJQ = 3, // 下跌动能加强
  XDJR = 4, // 下跌动能减弱
  ZDJA = 5, // 震荡加强
  ZDJR = 6, // 震荡减弱
}

export enum InDayTrendType {
  None = 0, // 横盘震荡
  DBXT = 1, // 顶部形态-∩
  SSXT = 2, // 上升形态-↗
  SSZJ = 3, // 上升中继-↱
  DiBXT = 4, // 底部形态-∪
  XDXT = 5, // 下降形态-↘
  XDZJ = 6, // 下跌中继-↳
}

export const DayTrendTypeNames = {
  0: '没有趋势',
  1: '上涨加速',
  2: '上涨减弱',
  3: '下跌加强',
  4: '下跌减弱',
  5: '震荡加强',
  6: '震荡减弱',
};

export const InDayTrendTypeNames = {
  0: '没有趋势',
  1: '顶部形态-∩',
  2: '上升形态-↗',
  3: '上升中继-↱',
  4: '底部形态-∪',
  5: '下降形态-↘',
  6: '下跌中继-↳',
};

export enum MRType {
  None = 0, // 不确定
  JDXH = 1, // 见底信号（光头阳线、金针探底）
  SYJC = 2, // 首阳建仓（缩量洗盘过程出现首个放量阳线）
  LFCX = 3, // 龙凤呈祥（KD指标喝MACD指标共振）
  DGWY = 4, // 登高望远（上升趋势K线穿越下轨并且企稳拉回）
}

export const MRTypeNames = {
  0: '不参与',
  1: '见底信号',
  2: '首阳建仓',
  3: '龙凤呈祥',
  4: '登高望远',
};

export const MRTypeHints = {
  0: '',
  1: 'K线形态，需要放量配合',
  2: '龙头，趋势股，充分缩量回调，出现首个放量阳线',
  3: '60分钟周期，KD指标（上涨趋势：K<=60，金叉买入; K>=78，死叉卖出；下跌趋势：K<=30，金叉买入；K>=40，死叉卖出）+ MACD金叉死叉；',
  4: '龙头，趋势股，简单调整情况下适用，上轨卖出，下轨买入',
};

export const BaiduErrors: Record<string, string> = {
  '2': '参数错误。检查必填字段；get/post 参数位置',
  '-6': '身份验证失败。access_token 是否有效；部分接口需要申请对应的网盘权限',
  '-7': '文件或目录名错误或无权访问',
  '-8': '文件或目录已存在',
  '-10': '云端容量已满',
  '10': '创建文件失败',
  '31024': '没有申请上传权限',
  '31299': '第一个分片的大小小于4MB',
  '31364': '超出分片大小限制',
  '31363': '分片缺失',
  '31190': '文件不存在',
  '31034': '命中接口频控。核对频控规则;稍后再试;申请单独频控规则',
  '42000': '访问过于频繁',
  '42001': 'rand校验失败',
  '42999': '功能下线',
  '9100': '一级封禁',
  '9200': '二级封禁',
  '9300': '三级封禁',
  '9400': '四级封禁',
  '9500': '五级封禁',
};

export enum StrategyPhaseType {
  Unknown = 0,
  Candidates = 1,
  BaseFilter = 2,
  TechFilter = 3,
  FundFilter = 4,
  BKFilter = 5,
  BTTradeDay = 6,
  Finished = 7,
}

export enum KLineEntitySize {
  Unknow = 0,
  Small = 2,
  Medium = 3,
  Big = 4,
}

export enum KLineHatchType {
  Unknow = 0,
  MoreTop = 1, // 上边更长
  SuperTop = 2, // 上边非常长
  MoreDown = 3, // 下边更长
  SuperDown = 4, // 下边非常长
  EqualTiny = 5, // 上下差不多小
  EqualMedium = 6, // 上下中等
  EqualSuper = 7, // 上下都非常长
}

export enum SingleKLineShape {
  Unknown = 0,
  // 宝剑线，小实体，长上影线，短下影线
  BJX = 1,
  // 倒宝剑线，小实体，长下影线，短上影线
  DBJX = 2,
  // 十字星，小实体，中长上下影线
  SZX = 3,
  // 螺旋桨，小实体，小上下影线
  LXJ = 4,
  // 铁锤线，中大实体，长下影线，短上影线
  TCX = 5,
  // 倒铁锤线，中大实体，长上影线，短下影线
  DTCX = 6,
  // 纺锤线，中大实体，等中长上下影线
  FCX = 7,
  // 海绵宝宝，大实体，equal上下影线
  DHMBB = 8,
  // 小海绵宝宝，小实体，短上下影线
  XHMBB = 9,
  // 中海绵宝宝，中实体，短上下影线
  ZHMBB = 10,
  // 天线宝宝，大实体，中长上影线
  TXBB = 11,
  // 地线宝宝，大实体，中长下影线
  DXBB = 12,
}

export const SingleKLineShapeNames: {
  [key: number]: string
} = {
  0: '未知',
  1: '宝剑线',
  2: '倒宝剑线',
  3: '十字星',
  4: '螺旋桨',
  5: '铁锤线',
  6: '倒铁锤线',
  7: '纺锤线',
  8: '大海绵宝宝',
  9: '小海绵宝宝',
  10: '中海绵宝宝',
  11: '天线宝宝',
  12: '地线宝宝',
};

export enum MultiKlineShape {
  Unknown = 0,
  // 平顶，相邻K线最高价相同
  PD = 1,
  // 淡友反攻，上升途中，第一根K线为大阳线或中阳线，第二根K线为跳空高开低收，收出一根大阴线或中阴线
  // 第二根K线阴线的实体没有深入到阳线的实体内
  // 如果伴随成交量急剧放大，它的领跌作用甚至要超过“乌云盖顶”
  DYFG = 2,
  // 乌云盖顶，阴线的实体必须深入到阳线实体的二分之一以下，深入的越多转势信号越强烈，如果没有深入到二分之一以下，通常是洗盘的K线形态。
  WYGD = 3,
  // 倾盘大雨， 第一根K线为中阳线或大阳线，第二根为低开低收的中阴线或大阴线，收盘价比前一天阳线开盘价要低。
  QPDY = 4,
  // 穿头破脚，第二根阴线的实体把第一根K线实体完全包容
  CTPJ = 5,
  // 三只乌鸦，每一根阴线的最低价均比前一根阴线低
  SZWY = 6,
}

export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
}
