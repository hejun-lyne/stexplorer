declare namespace System {
  export interface Setting {
    fundApiTypeSetting: number; // 基金源

    conciseSetting: boolean; // 简洁模式
    lowKeySetting: boolean; // 低调模式
    baseFontSizeSetting: number; // 全局基础字体大小
    systemThemeSetting: number; // 系统主题 "dark" | "light" | "auto"

    adjustmentNotificationSetting: boolean; // 调仓提醒
    adjustmentNotificationTimeSetting: string; // 调仓时间
    trayContentSetting: number; // 托盘内容

    autoStartSetting: boolean; // 自动启动
    autoFreshSetting: boolean; // 自动刷新
    freshDelaySetting: number; // 刷新时间间隔

    ontrain: boolean; // 训练模式
    trainDate: string; // 训练日期

    kLineApiSourceSetting: number; // K线加载的数据源
  }

  export interface GridSetting {
    // A string corresponding to the component key
    i: string;
    // These are all in grid units, not pixels
    x: number;
    y: number;
    w: number;
    h: number;
    minW?: number;
    maxW?: number;
    minH?: number;
    maxH?: number;
  }
  export interface MonitorItem {
    id: number;
    tag: string;
    bk?: string;
    grid: GridSetting;
  }

  export interface MonitorSetting {
    hPanel: {
      grid: GridSetting;
    };
    maPanel: {
      defaults: number[];
      grid: GridSetting;
    };
    gPanel: {
      defaults: number[];
      grid: GridSetting;
    };
    tagPanels: MonitorItem[];
  }
}
