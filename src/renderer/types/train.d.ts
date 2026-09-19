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
    shares: number; // 成交后持仓股数
    costPrice: number; // 成交后持仓成本
    profit: number; // 已实现盈亏（仅卖出）
    profitRatio: number; // 已实现收益率%（仅卖出）
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
  }

  /** 归档记录 */
  export interface ArchiveRecord extends Settlement {
    id: string;
    secid: string;
    name: string;
    createdAt: string;
  }
}
