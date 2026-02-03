declare namespace Strategy {
  export interface ContentItem {
    id: number;
    source: string; // 源代码
    modifiedTime: string; /// 修改时间
  }
  export interface BriefItem {
    id: number;
    groupId: number;
    createTime: string;
    modifiedTime: string;
    firstLine: string;
  }
  export interface GroupItem {
    id: number;
    name: string;
    strategies: BriefItem[];
  }
  export interface RunResult {
    candidates?: string[]; // 候选标的
    baseFiltered?: string[]; // 基本面过滤
    techFiltered?: string[]; // 技术面过滤
    fundFiltered?: string[]; // 资金面过滤
    bkFiltered?: string[]; // 板块过滤
    wbuyFiltered?: string[]; // 买点择时
    sellFiltered?: string[]; // 卖点择时
  }
  export interface BackTestHold {
    secid: string; // 标的ID
    name: string; // 标的名字
    avgPrice: number; // 平均价格
    lastSp: number; // 最后收盘价
    count: number; // 数量
    amount: number; // 金额
    lastDate: string; // 最后交易日期
  }
  export interface BackTestTrading {
    date: string; // 交易日
    secid: string; // 标的id
    name: string; // 标的名字
    price: number; // 价格
    count: number; // 数量
    amount: number; // 价值
    type: string; // 类型：buy || sell
  }
  export interface BackTestResult {
    date: string; // 日期
    availableAmount: number; // 可用资金
    totalAmount: number; // 总资金
    indexVal: number; // 指数
    shares: BackTestHold[]; // 当前持有
    trading: BackTestTrading[]; // 交易记录
  }
}
