/**
 * 训练模式（模拟交易训练营）相关类型
 */
declare namespace Train {
  /** 模拟交易明细（同时也是持仓变化记录） */
  export interface TradeLog {
    date: string; // 交易日
    type: 'buy' | 'sell';
    price: number; // 成交价（收盘价）
    count: number; // 成交股数
    amount: number; // 成交金额
    commission: number; // 交易佣金
    cash: number; // 成交后可用资金
    shares: number; // 成交后该标的持仓股数
    costPrice: number; // 成交后该标的持仓成本
    profit: number; // 已实现盈亏（仅卖出）
    profitRatio: number; // 已实现收益率%（仅卖出）
    secid?: string; // 标的代码（组合结算时用于区分成交属于哪只标的）
    name?: string; // 标的名称（仅用于展示）
  }

  /** 每日净值点 */
  export interface DailyValue {
    date: string;
    totalValue: number; // 总资产
    cash: number;
    shares: number;
    close: number; // 当日收盘价
    returnRate: number; // 累计收益率%
  }

  /** 一次训练的结算结果 */
  export interface Settlement {
    startDate: string; // 开始日期
    endDate: string; // 结束日期（实际）
    initialCapital: number; // 初始资金
    commissionRate: number; // 佣金比例
    finalValue: number; // 期末总资产
    totalReturn: number; // 总收益率
    annualizedReturn: number; // 年化收益率
    maxDrawdown: number; // 最大回撤
    sharpeRatio: number; // 夏普比率
    winRate: number; // 胜率
    profitFactor: number; // 盈亏比
    tradeCount: number; // 交易次数
    winCount: number; // 盈利次数
    loseCount: number; // 亏损次数
    dailyValues: DailyValue[]; // 收益率变化
    trades: TradeLog[]; // 持仓变化
    attribution?: Attribution; // 归因分析（个股 / 持仓周期 / 月度）
  }

  /** 一笔完整往返（建仓 → 清仓）的归因明细 */
  export interface RoundTrip {
    secid: string; // 标的代码（单标的结算时可能为空）
    name?: string; // 标的名称
    buyDate: string; // 首次买入日（YYYY-MM-DD）
    sellDate: string; // 卖出日（YYYY-MM-DD）
    buyPrice: number; // 平均持仓成本价（含买入佣金）
    sellPrice: number; // 卖出价
    count: number; // 卖出股数
    profit: number; // 已实现盈亏
    profitRatio: number; // 已实现收益率%
    holdDays: number; // 持仓交易日数（买入日 → 卖出日）
  }

  /** 个股归因：某只标的的往返汇总 */
  export interface StockAttribution {
    secid: string;
    name?: string;
    roundTrips: number; // 完成的往返次数
    wins: number; // 盈利次数
    losses: number; // 亏损次数
    winRate: number; // 胜率
    profit: number; // 累计已实现盈亏
    contribution: number; // 占总已实现盈亏的比例（带符号）
  }

  /** 持仓周期归因桶 */
  export interface HoldingAttribution {
    label: string; // 如「1日（T+1）」
    minDays: number;
    maxDays: number;
    count: number; // 该周期完成的往返次数
    wins: number;
    losses: number;
    winRate: number;
    profit: number; // 累计已实现盈亏
    avgReturn: number; // 平均收益率%
  }

  /** 月度归因 */
  export interface MonthAttribution {
    month: string; // YYYY-MM
    count: number;
    wins: number;
    losses: number;
    winRate: number;
    profit: number; // 累计已实现盈亏
  }

  /** 归因分析结果 */
  export interface Attribution {
    roundTrips: RoundTrip[]; // 往返明细
    byStock: StockAttribution[]; // 按个股
    byHolding: HoldingAttribution[]; // 按持仓周期
    byMonth: MonthAttribution[]; // 按卖出月份
  }

  /** 归档记录 */
  export interface ArchiveRecord extends Settlement {
    id: string;
    secid: string;
    name: string;
    createdAt: string;
  }

  /**
   * 一次「建仓 → 清仓」的完整交易记录（训练模式，清仓时逐股归档）
   *
   * 与 ArchiveRecord（整段训练的组合结算）不同：这里只记录单只股票的一轮交易，
   * 包含本轮全部买入明细（交易全过程），用于「训练记录」列表展示与复盘。
   */
  export interface StockTradeRecord {
    id: string;
    secid: string;
    name: string;
    /** 本轮首次买入日 */
    buyDate: string;
    /** 平均持仓成本价（含买入佣金） */
    buyPrice: number;
    /** 清仓日 */
    sellDate: string;
    /** 清仓成交价 */
    sellPrice: number;
    /** 清仓股数 */
    count: number;
    /** 卖出成交额 */
    amount: number;
    /** 卖出佣金 */
    commission: number;
    /** 已实现盈亏 */
    profit: number;
    /** 已实现收益率%（相对持仓成本） */
    profitRatio: number;
    /** 持仓天数（有训练交易日列表时按交易日数，否则按自然日） */
    holdDays: number;
    /** 清仓理由 */
    reason: string;
    /** 本轮全部买入明细（交易全过程） */
    buys: { date: string; price: number; amount?: number }[];
    /** 训练开始日（用于按训练会话筛选） */
    trainStartDate: string;
    createdAt: string;
  }

  /**
   * 未完成训练的进度（关闭训练模式时保存，下次开启训练时可选择继续）
   */
  export interface Progress {
    secid: string; // 训练标的
    name: string; // 标的名称
    startDate: string; // 训练开始日期
    endDate: string; // 配置的训练结束日期
    currentDate: string; // 上次进行到的交易日
    total: number; // 训练窗口内交易日总数
    days: string[]; // 训练窗口内交易日列表
    initialCapital: number; // 初始资金
    commissionRate: number; // 佣金比例
    savedAt: string; // 保存时间
  }
}
