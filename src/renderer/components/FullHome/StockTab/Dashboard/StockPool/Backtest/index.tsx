import React, { useCallback, useState, useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { Row, Col, DatePicker, Table, Card, Statistic, Tag, Progress, Radio, InputNumber, Input, Modal, Button, List, Popconfirm, Space, Switch } from 'antd';
import { StoreState } from '@/reducers/types';
import styles from '../index.scss';
import * as Services from '@/services';
import moment from 'moment';
import { useHomeContext } from '@/components/FullHome';
import * as RSIStrategy from '@/helpers/rsistrategy';
import * as BacktestEngine from '@/helpers/backtestEngine';
import { Stock } from '@/types/stock';
import * as Helpers from '@/helpers';
import * as Enums from '@/utils/enums';
import { useRenderEcharts, useResizeEchart } from '@/utils/hooks';
import { setBacktestMarksAction } from '@/actions/stock';

const { ipcRenderer, makeWorkerExec } = window.contextModules.electron;

export interface BacktestProps {
  onOpenStock: (secid: string, name: string) => void;
  active: boolean;
}

// 统一的数据提供者，同时兼容 RSI 策略和优化策略
class UnifiedDataProvider implements RSIStrategy.DataProvider, BacktestEngine.StrategyDataProvider {
    private boardCache: Map<string, Stock.BoardItem | null> = new Map();
    private allBoardsCache: Map<string, Array<{ code: string; name: string; zf: number }>> = new Map();
    private boardStocksCache: Map<string, Array<{ secid: string; zf: number }>> = new Map();

    private getBoardCacheKey(name: string, endDate: string): string {
        return `${name}|${endDate}`;
    }

    private getAllBoardsCacheKey(associateBoardName: string, date: string): string {
        return `${associateBoardName}|${date}`;
    }

    private getBoardStocksCacheKey(boardCode: string, date: string): string {
        return `${boardCode}|${date}`;
    }

    async getStrongStocks(date: string): Promise<Stock.DetailItem[]> {
      try {
        const queryDate = date.replace(/-/g, '');
        console.log(`[DataProvider] 获取强势股票: ${date}`);

        // 使用 Tushare 生成强势股票（60日新高 + 涨停）
        const result = await Services.Tushare.GetStrongStocksFromTushare(date);
        
        if (!result.stocks || result.stocks.length === 0) {
          console.log(`[DataProvider] 强势股票 ${date} 为空`);
          return [];
        }

        console.log(`[DataProvider] 强势股票 ${date}: ${result.stocks.length} 只 (涨停${result.limit_up_count || 0}, 新高${result.new_high_count || 0})`);

        // 过滤并转换格式（兼容原有 LoadSingleDateQS 格式）
        const filteredStocks = result.stocks.filter((s: any) => {
          const code = s.secid?.split('.')[1] || '';
          if (code.startsWith('688') || code.startsWith('689')) return false;
          if (code.startsWith('8') || code.startsWith('9')) return false;
          if (s.zx < 10 || s.zx > 100) return false;
          return true;
        });

        return Promise.resolve(filteredStocks.map((s: any) => ({
          secid: s.secid,
          name: s.name,
          zdf: s.zdf,
          zx: s.zx,
          bk: s.hybk || '',
          lt: (s.ltsz || 0) / 100000000,
          strongType: s.strongType,
          sz: s.zsz,
        } as unknown as Stock.DetailItem)));
      } catch (e) {
        console.error(`[DataProvider] 获取强势股票失败 ${date}:`, e);
        return [];
      } 
    }

    async getKLines(secids: string[], endDate: string, days: number = 120): Promise<any> {
      try {
        const isSingle = typeof secids === 'string';
        const inputSecids: string[] = isSingle ? [secids as string] : (secids as string[]);

        // console.log(`[DataProvider] 批量获取K线: ${inputSecids.length} 只，截止${endDate}，${days}天`);
        const batchResult = await Services.Tushare.BatchGetKFromTushare(
          inputSecids,
          endDate,
          days,
          Enums.KLineType.Day
        );

        // 裁剪到 endDate 之前的 K 线（处理停牌情况）
        const sliceToDate = (klines: Stock.KLineItem[]): Stock.KLineItem[] => {
          if (!klines || klines.length === 0) return [];
          let index = klines.findIndex(k => k.date === endDate);
          if (index === -1) {
            for (let i = klines.length - 1; i >= 0; i--) {
              if (klines[i].date < endDate) {
                index = i;
                break;
              }
            }
          }
          if (index === -1) return [];
          const sliced = klines.slice(0, index + 1);
          if (sliced.length > days) {
            sliced.splice(0, sliced.length - days);
          }
          return sliced;
        };

        if (isSingle) {
          const secid = inputSecids[0];
          const klines = batchResult[secid] || [];
          const sliced = sliceToDate(klines);
          // console.log(`[DataProvider] ${secid} K线返回: ${sliced.length} 条 (截止${endDate})`);
          return sliced;
        }

        const result: Record<string, Stock.KLineItem[]> = {};
        inputSecids.forEach((secid) => {
          const klines = batchResult[secid] || [];
          result[secid] = sliceToDate(klines);
          if (klines.length === 0) {
            console.log(`[DataProvider] ${secid} 未获取到K线数据`);
          }
        });
        // console.log(`[DataProvider] 批量K线返回: ${inputSecids.length} 只`);
        return result;
      } catch (e) {
        console.error(`[DataProvider] 获取K线失败 ${secids}:`, e);
        if (typeof secids === 'string') return [];
        const fallback: Record<string, Stock.KLineItem[]> = {};
        (secids as string[]).forEach((secid) => { fallback[secid] = []; });
        return fallback;
      }
    }

    async getBoardData(name: string, endDate: string): Promise<Stock.BoardItem | null> {
      try {
        const cacheKey = this.getBoardCacheKey(name, endDate);
        const cached = this.boardCache.get(cacheKey);
        if (cached !== undefined) {
          console.log(`[DataProvider] 板块缓存命中: ${name} ${endDate}`);
          return cached;
        }

        console.log(`[DataProvider] 获取板块数据: ${name} ${endDate}`);
        const boardInfo = await Services.Tushare.GetBankuaiCodeByNameFromTushare(name);
        if (!boardInfo) {
          console.log(`[DataProvider] 未找到板块: ${name}`);
          this.boardCache.set(cacheKey, null);
          return null;
        }
        const queryDate = endDate.replace(/-/g, '');
        const bResult = await Services.Tushare.GetBoardDetailFromTushare(boardInfo.secid, queryDate);
        if (bResult) {
          console.log(`[DataProvider] 板块 ${boardInfo.secid} 返回:`, {
            name: bResult.name,
            zx: bResult.zx,
            zdf: bResult.zdf,
            moneyIn: bResult.moneyIn,
            moneyIn5d: bResult.moneyIn5d,
            moneyInRankInAll: bResult.moneyInRankInAll,
            mainIn: bResult.mainIn,
            mainIn5d: bResult.mainIn5d,
            cje: bResult.cje,
            cjl: bResult.cjl,
          });
        } else {
          console.log(`[DataProvider] 板块 ${boardInfo.secid} 返回: 无数据`);
        }
        this.boardCache.set(cacheKey, bResult || null);
        return bResult ? Promise.resolve(bResult) : Promise.reject('数据未准备好');
      } catch (e) {
        console.error(`[DataProvider] 获取板块数据失败 ${name}:`, e);
        return null;
      }
    }

    // 优化策略需要的接口：获取所有板块涨幅排名
    async getAllBoards(associateBoardName: string, date: string): Promise<Array<{ code: string; name: string; zf: number }>> {
      const cacheKey = this.getAllBoardsCacheKey(associateBoardName, date);
      const cached = this.allBoardsCache.get(cacheKey);
      if (cached !== undefined) {
        console.log(`[DataProvider] 全板块缓存命中: ${associateBoardName} ${date}`);
        return cached;
      }

      // 将 YYYY-MM-DD 转为 YYYYMMDD
      const queryDate = date.replace(/-/g, '');
      const boardInfo = await Services.Tushare.GetBankuaiCodeByNameFromTushare(associateBoardName);
      if (!boardInfo) {
        console.log(`[DataProvider] 未找到板块: ${associateBoardName}`);
        this.allBoardsCache.set(cacheKey, []);
        return [];
      }
      // 根据板块类型（行业/概念）调用不同接口获取当日所有板块的涨幅排名
      const result = await Services.Tushare.GetBoardsByDateFromTushare(boardInfo.type, queryDate);
      if (!result || !result.arr || result.arr.length === 0) {
        console.log(`[DataProvider] ${boardInfo.type} 板块数据为空: ${queryDate}`);
        this.allBoardsCache.set(cacheKey, []);
        return [];
      }
      console.log(`[DataProvider] 获取全板块数据: ${boardInfo.type} ${queryDate}, 共 ${result.arr.length} 个板块`);
      const mapped = result.arr.map((item: any) => ({
        code: item.code,
        name: item.name,
        zf: item.zdf || 0,
      }));
      this.allBoardsCache.set(cacheKey, mapped);
      return mapped;
    }

    async getBoardStocks(date: string, boardCode: string | null, boardName: string): Promise<Array<{ secid: string; zf: number }>> {
      try {
        // 将 YYYY-MM-DD 转为 YYYYMMDD
        const queryDate = date.replace(/-/g, '');
        let effectiveBoardCode = boardCode;
        if (!effectiveBoardCode) {
          const boardInfo = await Services.Tushare.GetBankuaiCodeByNameFromTushare(boardName);
          if (!boardInfo) {
            console.log(`[DataProvider] 无板块代码，无法获取成分股: ${boardName} ${date}`);
            return [];
          }
          effectiveBoardCode = boardInfo.secid;
        }
        // 构造板块 secid（你的板块代码如果是纯 BK 开头，需要加 90. 前缀）
        const boardSecid = effectiveBoardCode?.startsWith('90.') ? effectiveBoardCode : `90.${effectiveBoardCode}`;

        const cacheKey = this.getBoardStocksCacheKey(boardSecid, date);
        const cached = this.boardStocksCache.get(cacheKey);
        if (cached !== undefined) {
          console.log(`[DataProvider] 板块成分股缓存命中: ${boardSecid} ${date}`);
          return cached;
        }
        
        console.log(`[DataProvider] 获取板块成分股: ${boardSecid} ${queryDate}`);
        const stocks = await Services.Tushare.GetBoardStocksByDateFromTushare(boardSecid, queryDate);
        
        console.log(`[DataProvider] 板块成分股返回: ${stocks.length} 只`);
        this.boardStocksCache.set(cacheKey, stocks);
        return stocks;
      } catch (e) {
        console.error(`[DataProvider] 获取板块成分股失败 ${boardCode} ${date}:`, e);
        return [];
      }
    }

    async getAllBoardsBatch(dates: string[]): Promise<Record<string, Array<{ code: string; name: string; zf: number; }>>> {
      try {
        if (!dates || dates.length === 0) return {};
        console.log(`[DataProvider] 批量获取全板块: ${dates.length} 个日期`);
        const result = await Services.Tushare.GetBoardsByDateBatchFromTushare(dates, "industry");
        console.log(`[DataProvider] 批量全板块返回: ${Object.keys(result).length} 个日期`);
        return result;
      } catch (e) {
        console.error(`[DataProvider] 批量获取全板块失败:`, e);
        const emptyMap: Record<string, Array<{ code: string; name: string; zf: number }>> = {};
        dates.forEach((d) => { emptyMap[d] = []; });
        return emptyMap;
      }
    }

    async getBoardStocksBatch(requests: Array<{ date: string; boardCode: string | null; boardName: string; }>): Promise<Record<string, Array<{ secid: string; zf: number; }>>> {
      try {
        if (!requests || requests.length === 0) return {};
        console.log(`[DataProvider] 批量获取板块成分股: ${requests.length} 个请求`);
        const result = await Services.Tushare.GetBoardStocksBatchFromTushare(requests);
        console.log(`[DataProvider] 批量成分股返回: ${Object.keys(result).length} 个key`);
        return result;
      } catch (e) {
        console.error(`[DataProvider] 批量获取板块成分股失败:`, e);
        const emptyMap: Record<string, Array<{ secid: string; zf: number }>> = {};
        requests.forEach((req) => { emptyMap[`${req.date}_${req.boardCode}`] = []; });
        return emptyMap;
      }
    }

    async getUpRatio(dates: string[]): Promise<number[]> {
      try {
        if (!dates || dates.length === 0) return [];
        console.log(`[DataProvider] 批量获取涨跌比: ${dates.length} 天`);
        const result = await Services.Tushare.GetUpRatioFromTushare(dates);
        // 按输入日期顺序提取 up_down_ratio（Python 返回键为 YYYYMMDD）
        return dates.map((date) => {
          const ymd = date.replace(/-/g, '');
          // 兼容两种键格式：YYYYMMDD 和 YYYY-MM-DD
          const dayData = result[ymd] ?? result[date];
          if (dayData && typeof dayData.up_in_total === 'number') {
            return dayData.up_in_total;
          }
          console.warn(`[DataProvider] 涨跌比缺失: date=${date}, ymd=${ymd}, keys=${Object.keys(result).slice(0, 10)}`);
          return 0;
        });
      } catch (e) {
        console.error(`[DataProvider] 批量获取涨跌比失败:`, e);
        return dates.map(() => 0);
      }
    }

    async filterTradeDays(dates: string[]): Promise<string[]> {
      return Services.Tushare.FilterTradeDays(dates);
    }

}

// ==================== 净值曲线图表配置 ====================

function getNetValueBaseOptions(darkMode: boolean, initialCapital: number) {
  return {
    title: { show: false },
    animation: true,
    grid: {
      top: '10%',
      left: '3%',
      right: '4%',
      bottom: '10%',
      containLabel: true,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
        label: { backgroundColor: '#6a7985' },
      },
      formatter: (params: any[]) => {
        const date = params[0]?.axisValue || '';
        const netValue = params[0]?.value || 0;
        const returnPct = ((netValue - initialCapital) / initialCapital * 100).toFixed(2);
        const color = netValue >= initialCapital ? '#cf1322' : '#3f8600';
        return `${date}<br/>净值: <b>${Number(netValue).toFixed(2)}</b><br/>收益率: <span style="color:${color}">${returnPct}%</span>`;
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: [],
      axisLine: { lineStyle: { color: darkMode ? '#b1afb3' : '#666' } },
      axisLabel: { color: darkMode ? '#b1afb3' : '#666' },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLine: { lineStyle: { color: darkMode ? '#b1afb3' : '#666' } },
      axisLabel: {
        color: darkMode ? '#b1afb3' : '#666',
        formatter: (value: number) => value.toFixed(0),
      },
      splitLine: {
        lineStyle: {
          color: darkMode ? 'rgba(255,255,255, 0.15)' : 'rgba(0, 0, 0, 0.15)',
          type: 'dashed',
        },
      },
    },
    series: [
      {
        name: '每日净值',
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2, color: '#1890ff' },
        areaStyle: {
          opacity: 0.2,
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(24,144,255,0.4)' },
              { offset: 1, color: 'rgba(24,144,255,0.05)' },
            ],
          },
        },
        data: [],
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: '#999', width: 1 },
          data: [
            {
              yAxis: initialCapital,
              label: { formatter: '初始资金', position: 'end', color: '#999' },
            },
          ],
        },
        markPoint: {
          data: [],
          label: { color: '#fff', fontSize: 10 },
          itemStyle: { color: '#52c41a' },
        },
      },
    ],
  };
}

function updateNetValueOptions(
  opts: any,
  darkMode: boolean,
  dailyValues: Array<{ date: string; totalValue: number }>,
  initialCapital: number
) {
  const dates = dailyValues.map(d => d.date);
  const values = dailyValues.map(d => d.totalValue);

  let peak = initialCapital;
  let peakIndex = 0;
  let maxDrawdown = 0;
  let troughIndex = 0;

  for (let i = 0; i < values.length; i++) {
    if (values[i] > peak) {
      peak = values[i];
      peakIndex = i;
    }
    const dd = (peak - values[i]) / peak;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      troughIndex = i;
    }
  }

  opts.xAxis.data = dates;
  opts.series[0].data = values;
  opts.yAxis.axisLine.lineStyle.color = darkMode ? '#b1afb3' : '#666';
  opts.yAxis.axisLabel.color = darkMode ? '#b1afb3' : '#666';
  opts.yAxis.splitLine.lineStyle.color = darkMode ? 'rgba(255,255,255, 0.15)' : 'rgba(0, 0, 0, 0.15)';
  opts.xAxis.axisLine.lineStyle.color = darkMode ? '#b1afb3' : '#666';
  opts.xAxis.axisLabel.color = darkMode ? '#b1afb3' : '#666';

  const markPoints = [];
  if (peakIndex !== troughIndex && values[troughIndex] !== undefined) {
    markPoints.push({
      name: '最大回撤',
      coord: [dates[troughIndex], values[troughIndex]],
      value: `回撤 ${(maxDrawdown * 100).toFixed(1)}%`,
      itemStyle: { color: '#f5222d' },
    });
  }
  if (values.length > 0) {
    markPoints.push({
      name: '最终净值',
      coord: [dates[dates.length - 1], values[values.length - 1]],
      value: values[values.length - 1].toFixed(0),
      itemStyle: { color: '#1890ff' },
    });
  }
  opts.series[0].markPoint.data = markPoints;

  return { ...opts };
}

// ==================== 主组件 ====================

type StrategyType = 'rsi' | 'optimized';
type OptimizedSubStrategy = 'macd' | 'rsi' | 'both';

const Backtest: React.FC<BacktestProps> = ({ onOpenStock, active }) => {
    const dispatch = useDispatch();
    const { darkMode, lowKey } = useHomeContext();
    const [dates, setDates] = useState([moment(new Date()).format('YYYY-MM-DD')]);
    const [running, setRunning] = useState(false);
    const [paused, setPaused] = useState(false);
    const [dataProvider] = useState<UnifiedDataProvider>(new UnifiedDataProvider());
    const [strategyType, setStrategyType] = useState<StrategyType>('rsi');
    const [optimizedSubStrategy, setOptimizedSubStrategy] = useState<OptimizedSubStrategy>('both');
    const [progress, setProgress] = useState("正在准备数据...");
    const [progressPercent, setProgressPercent] = useState(0);
    const [result, setResult] = useState<any>(null);
    const [preloading, setPreloading] = useState(false);
    const [preloadProgress, setPreloadProgress] = useState('');

    // 历史记录
    const [historyVisible, setHistoryVisible] = useState(false);
    const [historyList, setHistoryList] = useState<Array<{
      id: string;
      timestamp: number;
      label: string;
      result: any;
      dates: string[];
      strategyType: StrategyType;
      optimizedSubStrategy: OptimizedSubStrategy;
      params: any;
    }>>([]);

    // 优化策略参数
    const [initialCapital, setInitialCapital] = useState(1000000);
    const [maxPositions, setMaxPositions] = useState(5);
    const [positionRatio, setPositionRatio] = useState(0.2);
    // 止损/移动止损参数（存储为价格比例，如 0.95=下跌5%，和引擎内部一致）
    const [stopLossInitPct, setStopLossInitPct] = useState(0.95);
    const [trailingStopPct, setTrailingStopPct] = useState(0.90);
    const [takeProfitPct, setTakeProfitPct] = useState(1.15);
    const [minStrategyScore, setMinStrategyScore] = useState(90);
    const [strongLookbackStart, setStrongLookbackStart] = useState(10);
    const [strongLookbackEnd, setStrongLookbackEnd] = useState(5);
    const [boardRankPct, setBoardRankPct] = useState(0.3);
    const [stockRankPct, setStockRankPct] = useState(0.3);
    const [structureBreakDays, setStructureBreakDays] = useState(3);
    const [rangeBoundDays, setRangeBoundDays] = useState(5);

    const [pullbackPct, setPullbackPct] = useState(0.3);
    const [sellAtOpen, setSellAtOpen] = useState(false);
    const [timeExitMaxDays, setTimeExitMaxDays] = useState(5);
    const [timeExitMinReturn, setTimeExitMinReturn] = useState(0.05);
    const [profitIgnoreSignalPct, setProfitIgnoreSignalPct] = useState(0.10);
    const [buyThresholdsInput, setBuyThresholdsInput] = useState('35,40,45');
    const [sellThresholdsInput, setSellThresholdsInput] = useState('65,70,75,80,85');
    const [filterStrongType, setFilterStrongType] = useState<'limit_up' | 'new_high_60' | 'both'>('both');
    const [steepness, setSteepness] = useState(20);

    const parseThresholds = (s: string) => s.split(',').map(v => parseInt(v.trim(), 10)).filter(v => !isNaN(v));

    const cancelledRef = useRef(false);
    const pausedRef = useRef(false);

    const { ref: chartRef, chartInstance: chart } = useResizeEchart(-1);
    const [chartOption, setChartOption] = useState<any>(undefined);

    // 缓存 key
    const CACHE_KEY = 'backtest_last_result';
    const HISTORY_CACHE_KEY = 'backtest_history';
    const MAX_HISTORY_COUNT = 30;
    const { electron } = window.contextModules;

    // 从缓存恢复上一次的回测结果和参数
    useEffect(() => {
      (async () => {
        try {
          const cached = await electron.readCache(CACHE_KEY);
          // IPC 返回结构: { success: true, data: { data: 真实缓存, cachedAt: '...' } }
          const payload = cached?.data?.data;
          if (payload) {
            const { result: cachedResult, dates: cachedDates, strategyType: cachedStrategyType, optimizedSubStrategy: cachedOptimizedSubStrategy, params } = payload;
            if (cachedResult) {
              setResult(cachedResult);
              const baseOpts = getNetValueBaseOptions(darkMode, params?.initialCapital || 1000000);
              const finalOpts = updateNetValueOptions(baseOpts, darkMode, cachedResult.dailyValues, params?.initialCapital || 1000000);
              setChartOption(finalOpts);
              console.log('[Backtest] 已从缓存恢复上一次的回测结果');
            }
            if (cachedDates && cachedDates.length > 0) {
              setDates(cachedDates);
            }
            if (cachedStrategyType) {
              setStrategyType(cachedStrategyType);
            }
            if (cachedOptimizedSubStrategy) {
              setOptimizedSubStrategy(cachedOptimizedSubStrategy);
            }
            if (params) {
              setInitialCapital(params.initialCapital ?? 1000000);
              setMaxPositions(params.maxPositions ?? 5);
              setPositionRatio(params.positionRatio ?? 0.2);
              setStopLossInitPct(params.stopLossInitPct ?? params.stopLossInitPctMid ?? 0.95);
              setTrailingStopPct(params.trailingStopPct ?? params.trailingStopPctMid ?? 0.90);
              setTakeProfitPct(params.takeProfitPct ?? 1.15);
              setMinStrategyScore(params.minStrategyScore ?? 90);
              setStrongLookbackStart(params.strongLookbackStart ?? 10);
              setStrongLookbackEnd(params.strongLookbackEnd ?? 5);
              setBoardRankPct(params.boardRankPct ?? 0.3);
              setStockRankPct(params.stockRankPct ?? 0.3);
              setStructureBreakDays(params.structureBreakDays ?? 3);
              setRangeBoundDays(params.rangeBoundDays ?? 5);

              setPullbackPct(params.pullbackPct ?? params.pullbackPctMid ?? 0.3);
              setSellAtOpen(params.sellAtOpen ?? false);
              setTimeExitMaxDays(params.timeExitMaxDays ?? 5);
              setTimeExitMinReturn(params.timeExitMinReturn ?? 0.05);
              setProfitIgnoreSignalPct(params.profitIgnoreSignalPct ?? 0.10);
              setBuyThresholdsInput((params.buyThresholds ?? [35, 40, 45]).join(','));
              setSellThresholdsInput((params.sellThresholds ?? [65, 70, 75, 80, 85]).join(','));
              setFilterStrongType(params.filterStrongType ?? 'both');
              setSteepness(params.steepness ?? 20);
            }
          }
        } catch (e) {
          console.error('[Backtest] 读取缓存失败:', e);
        }
      })();
    }, []);

    // 加载历史记录列表
    const loadHistory = useCallback(async () => {
      try {
        const cached = await electron.readCache(HISTORY_CACHE_KEY);
        const list = cached?.data?.data || [];
        setHistoryList(Array.isArray(list) ? list : []);
      } catch (e) {
        console.error('[Backtest] 读取历史记录失败:', e);
        setHistoryList([]);
      }
    }, []);

    // 组件挂载时加载历史记录
    useEffect(() => {
      loadHistory();
    }, [loadHistory]);

    // 保存到历史记录
    const saveToHistory = useCallback(async (
      backtestResult: any,
      backtestDates: string[],
      st: StrategyType,
      oss: OptimizedSubStrategy,
      backtestParams: any
    ) => {
      try {
        const cached = await electron.readCache(HISTORY_CACHE_KEY);
        let list: any[] = cached?.data?.data || [];
        if (!Array.isArray(list)) list = [];

        const totalReturnPct = ((backtestResult?.totalReturn || 0) * 100).toFixed(2);
        const tradeCount = backtestResult?.totalTrades || 0;
        const dateRange = backtestDates.length > 0
          ? `${backtestDates[0]} ~ ${backtestDates[backtestDates.length - 1]}`
          : '';
        const strategyLabel = st === 'rsi' ? 'RSI' : (oss === 'both' ? 'MACD+RSI' : oss.toUpperCase());
        const label = `${dateRange} | ${strategyLabel} | 收益${totalReturnPct}% | ${tradeCount}笔`;

        const newItem = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          label,
          result: backtestResult,
          dates: backtestDates,
          strategyType: st,
          optimizedSubStrategy: oss,
          params: backtestParams,
        };

        list = [newItem, ...list];
        if (list.length > MAX_HISTORY_COUNT) {
          list = list.slice(0, MAX_HISTORY_COUNT);
        }

        await electron.writeCache(HISTORY_CACHE_KEY, list);
        setHistoryList(list);
        console.log('[Backtest] 已保存到历史记录');
      } catch (e) {
        console.error('[Backtest] 保存历史记录失败:', e);
      }
    }, []);

    // 加载某条历史记录
    const loadHistoryItem = useCallback((item: typeof historyList[0]) => {
      setResult(item.result);
      setDates(item.dates);
      setStrategyType(item.strategyType);
      setOptimizedSubStrategy(item.optimizedSubStrategy);

      const p = item.params;
      if (p) {
        setInitialCapital(p.initialCapital ?? 1000000);
        setMaxPositions(p.maxPositions ?? 5);
        setPositionRatio(p.positionRatio ?? 0.2);
        setStopLossInitPct(p.stopLossInitPct ?? p.stopLossInitPctMid ?? 0.95);
        setTrailingStopPct(p.trailingStopPct ?? p.trailingStopPctMid ?? 0.90);
        setTakeProfitPct(p.takeProfitPct ?? 1.15);
        setMinStrategyScore(p.minStrategyScore ?? 90);
        setStrongLookbackStart(p.strongLookbackStart ?? 10);
        setStrongLookbackEnd(p.strongLookbackEnd ?? 5);
        setBoardRankPct(p.boardRankPct ?? 0.3);
        setStockRankPct(p.stockRankPct ?? 0.3);
        setStructureBreakDays(p.structureBreakDays ?? 3);
        setRangeBoundDays(p.rangeBoundDays ?? 5);

        setPullbackPct(p.pullbackPct ?? p.pullbackPctMid ?? 0.3);
        setSellAtOpen(p.sellAtOpen ?? false);
        setTimeExitMaxDays(p.timeExitMaxDays ?? 5);
        setTimeExitMinReturn(p.timeExitMinReturn ?? 0.05);
        setProfitIgnoreSignalPct(p.profitIgnoreSignalPct ?? 0.10);
        setBuyThresholdsInput((p.buyThresholds ?? [35, 40, 45]).join(','));
        setSellThresholdsInput((p.sellThresholds ?? [65, 70, 75, 80, 85]).join(','));
        setFilterStrongType(p.filterStrongType ?? 'both');
        setSteepness(p.steepness ?? 20);
      }

      const baseOpts = getNetValueBaseOptions(darkMode, p?.initialCapital || 1000000);
      const finalOpts = updateNetValueOptions(baseOpts, darkMode, item.result.dailyValues, p?.initialCapital || 1000000);
      setChartOption(finalOpts);

      setHistoryVisible(false);
      console.log('[Backtest] 已恢复历史记录:', item.label);
    }, [darkMode]);

    // 删除某条历史记录
    const deleteHistoryItem = useCallback(async (id: string) => {
      try {
        const newList = historyList.filter(item => item.id !== id);
        await electron.writeCache(HISTORY_CACHE_KEY, newList);
        setHistoryList(newList);
        console.log('[Backtest] 已删除历史记录:', id);
      } catch (e) {
        console.error('[Backtest] 删除历史记录失败:', e);
      }
    }, [historyList]);

    const onChangeDate = useCallback(
        (d: moment.Moment | null, isStart = true) => {
          if (!d) return;
          const nd = d.format('YYYY-MM-DD');
          if (dates.length) {
            if (isStart) {
              const ed = dates[dates.length - 1];
              if (nd > ed) {
                setDates([nd]);
                return;
              }
              const newDates = [nd];
              const edm = moment(ed, 'YYYY-MM-DD');
              let i = 1;
              while (true) {
                const next = d.add(i++, 'days');
                if (next.isBefore(edm)) {
                  newDates.push(next.format('YYYY-MM-DD'));
                } else {
                  break;
                }
              }
              setDates(newDates);
            } else {
              const sd = dates[0];
              if (nd < sd) {
                setDates([nd]);
                return;
              }
              const newDates = [sd];
              const sdm = moment(sd, 'YYYY-MM-DD');
              let i = 1;
              while (true) {
                const next = sdm.add(i++, 'days');
                if (next.isBefore(d)) {
                  newDates.push(next.format('YYYY-MM-DD'));
                } else {
                  break;
                }
              }
              newDates.push(nd);
              setDates(newDates);
            }
          } else {
            setDates([nd]);
          }
        },
        [dates]
      );

    const handlePreload = useCallback(async () => {
      if (!dates.length) {
        console.warn('[UI] 未选择日期，无法预生成');
        return;
      }
      const start = dates[0];
      const end = dates[dates.length - 1];
      console.log(`[UI] ====== 开始预生成强势股票: ${start} ~ ${end} ======`);

      setPreloading(true);
      setPreloadProgress('正在获取交易日历...');

      try {
        // 先过滤出交易日（避免对非交易日发起无效请求）
        const tradeDays = await dataProvider.filterTradeDays(dates);
        if (tradeDays.length === 0) {
          setPreloadProgress('所选范围内无交易日');
          setPreloading(false);
          return;
        }

        setPreloadProgress(`共 ${tradeDays.length} 个交易日，开始批量生成...`);

        // 逐日生成（批量接口可能一次请求太大，拆成逐日更稳定）
        let completed = 0;
        for (const day of tradeDays) {
          const result = await Services.Tushare.GetStrongStocksFromTushare(day);
          completed++;
          setPreloadProgress(`已生成 ${completed}/${tradeDays.length} 天 (${day}: ${result.count || 0}只)`);
          // 每生成一天让出一次，避免UI卡顿
          await new Promise(r => setTimeout(r, 10));
        }

        setPreloadProgress(`预生成完成！共 ${tradeDays.length} 天`);
        console.log(`[UI] 预生成完成: ${tradeDays.length} 天`);
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        setPreloadProgress(`预生成失败: ${errorMsg}`);
        console.error('[UI] 预生成异常:', e);
      } finally {
        setPreloading(false);
      }
    }, [dates]);
    
    const startBacktest = useCallback(async () => {
      if (!dates.length) {
        console.warn('[UI] 未选择日期，无法启动回测');
        return;
      }

      const strategyName = strategyType === 'rsi' ? 'RSI策略' : '优化策略';
      console.log(`[UI] ====== 启动${strategyName}回测 ======`);
      console.log(`[UI] 日期范围: ${dates[0]} ~ ${dates[dates.length - 1]} (${dates.length} 天)`);

      setProgress("开始执行回测...");
      setProgressPercent(0);
      setResult(null);
      setChartOption(undefined);
      setRunning(true);
      setPaused(false);
      cancelledRef.current = false;
      pausedRef.current = false;

      try {
        let backtestResult: any;

        if (strategyType === 'rsi') {
          const strategy = new RSIStrategy.StrongStockBacktest(dates);
          backtestResult = await strategy.run(
            dataProvider,
            (msg, pct) => {
              setProgress(msg);
              if (pct !== undefined) setProgressPercent(pct);
            },
            {
              onShouldCancel: () => cancelledRef.current,
              onShouldPause: () => pausedRef.current,
            }
          );
        } else {
          // 并行Worker执行器：自动分发到空闲Worker窗口
          const parallelWorkerExecutor = (method: string, args?: any[]) =>  ipcRenderer.invoke('worker-pool-execute', method, args);

          // 传入回测引擎（替换原来的单workerExecutor）
          const { workerCount } = await ipcRenderer.invoke('get-worker-info');
          const strategy = new BacktestEngine.OptimizedStrategyBacktest(dates, initialCapital, parallelWorkerExecutor, {
            stopLossInitPct,
            trailingStopPct,
            takeProfitPct,
            minStrategyScore,
            strongLookback: strongLookbackStart,
            maxPositions,
            positionRatio,
            workerCount,
            maxWatchDays: strongLookbackEnd,
            boardRankPct,
            stockRankPct,
            strategyMode: optimizedSubStrategy,
            structureBreakDays,
            rangeBoundDays,
            pullbackPct,
            sellAtOpen,
            timeExitMaxDays,
            timeExitMinReturn,
            profitIgnoreSignalPct,
            buyThresholds: parseThresholds(buyThresholdsInput),
            sellThresholds: parseThresholds(sellThresholdsInput),
            filterStrongType,
            steepness,
          });
          backtestResult = await strategy.run(
            dataProvider,
            (msg, pct) => {
              setProgress(msg);
              if (pct !== undefined) setProgressPercent(pct);
            },
            {
              onShouldCancel: () => cancelledRef.current,
              onShouldPause: () => pausedRef.current,
            }
          );
        }

        setResult(backtestResult);
        if (cancelledRef.current) {
          setProgress("回测已取消");
        } else {
          setProgress("回测完成！");
        }

        const baseOpts = getNetValueBaseOptions(darkMode, initialCapital);
        const finalOpts = updateNetValueOptions(baseOpts, darkMode, backtestResult.dailyValues, initialCapital);
        setChartOption(finalOpts);

        // 缓存回测结果和参数到磁盘
        try {
          await electron.writeCache(CACHE_KEY, {
            result: backtestResult,
            dates,
            strategyType,
            optimizedSubStrategy,
            params: {
              initialCapital,
              maxPositions,
              positionRatio,
              stopLossInitPct,
              trailingStopPct,
              takeProfitPct,
              minStrategyScore,
              strongLookbackStart,
              strongLookbackEnd,
              boardRankPct,
              stockRankPct,
              structureBreakDays,
              rangeBoundDays,
              pullbackPct,
              sellAtOpen,
              timeExitMaxDays,
              timeExitMinReturn,
              profitIgnoreSignalPct,
              buyThresholds: parseThresholds(buyThresholdsInput),
              sellThresholds: parseThresholds(sellThresholdsInput),
              filterStrongType,
              steepness,
            },
          });
          console.log('[Backtest] 回测结果已缓存到磁盘');
        } catch (e) {
          console.error('[Backtest] 缓存回测结果失败:', e);
        }

        // 保存到历史记录（未取消时才保存）
        if (!cancelledRef.current) {
          await saveToHistory(
            backtestResult,
            dates,
            strategyType,
            optimizedSubStrategy,
            {
              initialCapital,
              maxPositions,
              positionRatio,
              stopLossInitPct,
              trailingStopPct,
              takeProfitPct,
              minStrategyScore,
              strongLookbackStart,
              strongLookbackEnd,
              boardRankPct,
              stockRankPct,
              structureBreakDays,
              rangeBoundDays,
              pullbackPct,
              sellAtOpen,
              timeExitMaxDays,
              timeExitMinReturn,
              profitIgnoreSignalPct,
              buyThresholds: parseThresholds(buyThresholdsInput),
              sellThresholds: parseThresholds(sellThresholdsInput),
              filterStrongType,
              steepness,
            }
          );
        }

        console.log(`[UI] ${strategyName}回测结果已接收，图表已生成`);
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        setProgress(`回测出错: ${errorMsg}`);
        console.error(`[UI] 回测异常:`, e);
      } finally {
        setRunning(false);
        setPaused(false);
        cancelledRef.current = false;
        pausedRef.current = false;
        console.log(`[UI] ====== 回测流程结束 ======`);
      }
    }, [dates, dataProvider, darkMode, strategyType, optimizedSubStrategy, stopLossInitPct, trailingStopPct, takeProfitPct, minStrategyScore, strongLookbackStart, strongLookbackEnd, initialCapital, maxPositions, positionRatio, boardRankPct, stockRankPct, structureBreakDays, rangeBoundDays, pullbackPct, sellAtOpen, timeExitMaxDays, timeExitMinReturn, profitIgnoreSignalPct, buyThresholdsInput, sellThresholdsInput, filterStrongType, steepness]);

    const togglePause = useCallback(() => {
      const next = !paused;
      setPaused(next);
      pausedRef.current = next;
      console.log(`[UI] 回测${next ? '暂停' : '继续'}`);
    }, [paused]);

    const cancelBacktest = useCallback(() => {
      cancelledRef.current = true;
      pausedRef.current = false;
      setPaused(false);
      setProgress("正在取消回测...");
      console.log(`[UI] 用户请求取消回测`);
    }, []);

    useRenderEcharts(
      () => {
        if (chartOption) {
          chartOption.darkMode = darkMode;
          chart?.setOption(chartOption, true);
        }
      },
      chart,
      [darkMode, lowKey, chartOption]
    );

    useEffect(() => {
      if (!running && result && chart) {
        requestAnimationFrame(() => {
          chart.resize();
        });
      }
    }, [running, result, chart]);

    const chartOptionRef = useRef(chartOption);
    chartOptionRef.current = chartOption;

    useEffect(() => {
      if (chartOptionRef.current && result) {
        const initialCapital = 1000000;
        const updated = updateNetValueOptions(chartOptionRef.current, darkMode, result.dailyValues, initialCapital);
        setChartOption({ ...updated });
      }
    }, [darkMode, result]);

    const tradeColumns = [
        { title: '日期', dataIndex: 'date', key: 'date', width: 100 },
        { title: '股票', dataIndex: 'secid', key: 'secid', width: 100 },
        { 
            title: '方向', 
            dataIndex: 'type', 
            key: 'type', 
            width: 80,
            render: (type: string) => (
                <Tag color={type === 'buy' ? '#f5222d' : '#52c41a'}>
                    {type === 'buy' ? '买入' : '卖出'}
                </Tag>
            )
        },
        { title: '价格', dataIndex: 'price', key: 'price', width: 100, render: (v: number) => v.toFixed(2) },
        { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 100 },
        { title: '金额', dataIndex: 'amount', key: 'amount', width: 120, render: (v: number) => v.toFixed(2) },
        { title: '原因', dataIndex: 'reason', key: 'reason', minWidth: 200 },
        { 
            title: '盈亏', 
            dataIndex: 'pnl', 
            key: 'pnl', 
            width: 120,
            render: (pnl: number | undefined) => {
                if (pnl === undefined) return '-';
                return <span style={{ color: pnl >= 0 ? '#cf1322' : '#3f8600' }}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}</span>;
            }
        },
    ];

    const stockStatsColumns = [
        { title: '股票', dataIndex: 'secid', key: 'secid', width: 110, fixed: 'left' as const, render: (secid: string) => (
            <a onClick={() => {
              if (result?.trades) {
                const buyPoints = result.trades
                  .filter((t: any) => t.secid === secid && t.type === 'buy')
                  .map((t: any) => ({ x: t.date, y: t.price, t: 'bt' }));
                const sellPoints = result.trades
                  .filter((t: any) => t.secid === secid && t.type === 'sell')
                  .map((t: any) => ({ x: t.date, y: t.price, t: 'bt' }));
                dispatch(setBacktestMarksAction(secid, buyPoints, sellPoints));
              }
              onOpenStock(secid, secid);
            }}>{secid}</a>
        ) },
        { title: '所属板块', dataIndex: 'boardCode', key: 'boardCode', width: 100, render: (v?: string) => v || '-' },
        { title: '策略', dataIndex: 'strategyType', key: 'strategyType', width: 80, render: (v: string) => v?.toUpperCase() || '-' },
        { title: '策略得分', dataIndex: 'score', key: 'score', width: 90, render: (v: number) => (v || 0).toFixed(1) },
        { title: '策略参数', dataIndex: 'strategyParamsStr', key: 'strategyParamsStr', width: 240, render: (v?: string) => v || '-', ellipsis: true },
        { title: '强势原因', dataIndex: 'strongType', key: 'strongType', width: 100, render: (v?: string) => v === 'limit_up' ? '涨停' : v === 'new_high_60' ? '60日新高' : '-', ellipsis: true },
        { title: '交易次数', dataIndex: 'totalTrades', key: 'totalTrades', width: 90 },
        { title: '盈利', dataIndex: 'winTrades', key: 'winTrades', width: 80 },
        { title: '亏损', dataIndex: 'lossTrades', key: 'lossTrades', width: 80 },
        { title: '胜率', dataIndex: 'winRate', key: 'winRate', width: 90, render: (v: number) => `${(v * 100).toFixed(1)}%` },
        { title: '总盈亏', dataIndex: 'totalPnl', key: 'totalPnl', width: 120, render: (v: number) => (
            <span style={{ color: (v || 0) >= 0 ? '#cf1322' : '#3f8600' }}>{(v || 0) >= 0 ? '+' : ''}{(v || 0).toFixed(2)}</span>
        )},
        { title: '平均收益', dataIndex: 'avgReturnPct', key: 'avgReturnPct', width: 100, render: (v: number) => (
            <span style={{ color: (v || 0) >= 0 ? '#cf1322' : '#3f8600' }}>{(v || 0) >= 0 ? '+' : ''}{(v || 0).toFixed(2)}%</span>
        )},
    ];

    const tradeDetailColumns = [
        { title: '买入日期', dataIndex: 'buyDate', key: 'buyDate', width: 100 },
        { title: '买入价', dataIndex: 'buyPrice', key: 'buyPrice', width: 90, render: (v: number) => v?.toFixed(2) },
        { title: '卖出日期', dataIndex: 'sellDate', key: 'sellDate', width: 100, render: (v?: string) => v || '持仓中' },
        { title: '卖出价', dataIndex: 'sellPrice', key: 'sellPrice', width: 90, render: (v?: number) => v !== undefined ? v.toFixed(2) : '-' },
        { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 90 },
        { title: '收益率', dataIndex: 'returnPct', key: 'returnPct', width: 100, render: (v?: number) => v !== undefined ? (
            <span style={{ color: v >= 0 ? '#cf1322' : '#3f8600' }}>{v >= 0 ? '+' : ''}{v.toFixed(2)}%</span>
        ) : '-' },
        { title: '盈亏', dataIndex: 'pnl', key: 'pnl', width: 120, render: (v?: number) => v !== undefined ? (
            <span style={{ color: v >= 0 ? '#cf1322' : '#3f8600' }}>{v >= 0 ? '+' : ''}{v.toFixed(2)}</span>
        ) : '-' },
        { title: '持仓天数', dataIndex: 'holdDays', key: 'holdDays', width: 90, render: (v?: number) => v !== undefined ? `${v}天` : '-' },
        { title: '卖出原因', dataIndex: 'sellReason', key: 'sellReason', width: 200, render: (v?: string) => v || '-' },
    ];

    const scoreDistributionColumns = [
        { title: '得分区间', dataIndex: 'scoreRange', key: 'scoreRange', width: 100 },
        { title: '股票数', dataIndex: 'count', key: 'count', width: 90 },
        { title: '交易次数', key: 'totalTrades', width: 90, render: (_: any, r: any) => (r.winTrades || 0) + (r.lossTrades || 0) },
        { title: '盈利次数', dataIndex: 'winTrades', key: 'winTrades', width: 90 },
        { title: '亏损次数', dataIndex: 'lossTrades', key: 'lossTrades', width: 90 },
        { title: '胜率', dataIndex: 'winRate', key: 'winRate', width: 100, render: (v: number) => `${(v * 100).toFixed(1)}%` },
        { title: '平均收益率', dataIndex: 'avgReturnPct', key: 'avgReturnPct', width: 120, render: (v: number) => (
            <span style={{ color: (v || 0) >= 0 ? '#cf1322' : '#3f8600' }}>{(v || 0) >= 0 ? '+' : ''}{(v || 0).toFixed(2)}%</span>
        )},
    ];

    const rankDistributionColumns = [
        { title: '排名区间', dataIndex: 'rankRange', key: 'rankRange', width: 100 },
        { title: '交易次数', dataIndex: 'count', key: 'count', width: 90 },
        { title: '涉及股票数', dataIndex: 'uniqueCount', key: 'uniqueCount', width: 100 },
        { title: '盈利次数', dataIndex: 'winTrades', key: 'winTrades', width: 90 },
        { title: '亏损次数', dataIndex: 'lossTrades', key: 'lossTrades', width: 90 },
        { title: '胜率', dataIndex: 'winRate', key: 'winRate', width: 100, render: (v: number) => `${(v * 100).toFixed(1)}%` },
        { title: '平均收益率', dataIndex: 'avgReturnPct', key: 'avgReturnPct', width: 120, render: (v: number) => (
            <span style={{ color: (v || 0) >= 0 ? '#cf1322' : '#3f8600' }}>{(v || 0) >= 0 ? '+' : ''}{(v || 0).toFixed(2)}%</span>
        )},
    ];

    const pullBackDistributionColumns = [
        { title: '深度回调区间', dataIndex: 'pullBackRange', key: 'pullBackRange', width: 120 },
        { title: '交易次数', dataIndex: 'count', key: 'count', width: 90 },
        { title: '涉及股票数', dataIndex: 'uniqueCount', key: 'uniqueCount', width: 100 },
        { title: '盈利次数', dataIndex: 'winTrades', key: 'winTrades', width: 90 },
        { title: '亏损次数', dataIndex: 'lossTrades', key: 'lossTrades', width: 90 },
        { title: '胜率', dataIndex: 'winRate', key: 'winRate', width: 100, render: (v: number) => `${(v * 100).toFixed(1)}%` },
        { title: '平均收益率', dataIndex: 'avgReturnPct', key: 'avgReturnPct', width: 120, render: (v: number) => (
            <span style={{ color: (v || 0) >= 0 ? '#cf1322' : '#3f8600' }}>{(v || 0) >= 0 ? '+' : ''}{(v || 0).toFixed(2)}%</span>
        )},
    ];

    return (
        <div className={styles.content}>
          <div className={styles.toolbar}>
            <div className={styles.name}>
              <span>当前进度 </span>
            </div>
            <div className={styles.actions}>
                <DatePicker onChange={onChangeDate} value={moment(dates[0], 'YYYY-MM-DD')} style={{ marginRight: 10 }} />
                <DatePicker
                    onChange={(d) => onChangeDate(d, false)}
                    value={moment(dates[dates.length - 1], 'YYYY-MM-DD')}
                    style={{ marginRight: 10 }}
                />
                {/* [新增] 预生成按钮 */}
                {!running && !preloading && (
                  <a 
                    className={styles.abtn} 
                    onClick={handlePreload}
                    style={{ marginRight: 10, color: '#1890ff' }}
                  >
                    预生成强势数据
                  </a>
                )}
                {preloading && (
                  <span style={{ marginRight: 10, color: '#1890ff', fontSize: 12 }}>
                    {preloadProgress}
                  </span>
                )}
                <Radio.Group
                    value={strategyType}
                    onChange={(e) => setStrategyType(e.target.value)}
                    style={{ marginRight: 10 }}
                    disabled={running}
                >
                    <Radio.Button value="rsi">RSI策略</Radio.Button>
                    <Radio.Button value="optimized">优化策略</Radio.Button>
                </Radio.Group>
                {strategyType === 'optimized' && (
                  <Radio.Group
                    value={optimizedSubStrategy}
                    onChange={(e) => setOptimizedSubStrategy(e.target.value)}
                    style={{ marginRight: 10 }}
                    disabled={running}
                  >
                    <Radio.Button value="macd">MACD</Radio.Button>
                    <Radio.Button value="rsi">RSI</Radio.Button>
                    <Radio.Button value="both">MACD+RSI</Radio.Button>
                  </Radio.Group>
                )}
                {strategyType === 'optimized' && (
                  <Radio.Group
                    value={filterStrongType}
                    onChange={(e) => setFilterStrongType(e.target.value)}
                    style={{ marginRight: 10 }}
                    disabled={running}
                  >
                    <Radio.Button value="both">全部强势</Radio.Button>
                    <Radio.Button value="limit_up">涨停</Radio.Button>
                    <Radio.Button value="new_high_60">60日新高</Radio.Button>
                  </Radio.Group>
                )}
                {strategyType === 'optimized' && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginRight: 10, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>资金:</span>
                      <InputNumber size="small" min={100000} max={10000000} step={100000} value={initialCapital} onChange={(v) => setInitialCapital(v ?? 1000000)} disabled={running} style={{ width: 80 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>仓位:</span>
                      <InputNumber size="small" min={1} max={20} step={1} value={maxPositions} onChange={(v) => setMaxPositions(v ?? 8)} disabled={running} style={{ width: 45 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>比例:</span>
                      <InputNumber size="small" min={0.01} max={0.5} step={0.01} value={positionRatio} onChange={(v) => setPositionRatio(v ?? 0.125)} disabled={running} style={{ width: 55 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>止损:</span>
                      <InputNumber size="small" min={0.8} max={0.99} step={0.01} value={stopLossInitPct} onChange={(v) => setStopLossInitPct(v ?? 0.95)} disabled={running} style={{ width: 55 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>追踪:</span>
                      <InputNumber size="small" min={0.8} max={0.99} step={0.01} value={trailingStopPct} onChange={(v) => setTrailingStopPct(v ?? 0.90)} disabled={running} style={{ width: 55 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>止盈:</span>
                      <InputNumber size="small" min={1.01} max={2.0} step={0.01} value={takeProfitPct} onChange={(v) => setTakeProfitPct(v ?? 1.15)} disabled={running} style={{ width: 55 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>忽略:</span>
                      <InputNumber size="small" min={0} max={0.5} step={0.01} value={profitIgnoreSignalPct} onChange={(v) => setProfitIgnoreSignalPct(v ?? 0.10)} disabled={running} style={{ width: 55 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>效率天:</span>
                      <InputNumber size="small" min={1} max={30} step={1} value={timeExitMaxDays} onChange={(v) => setTimeExitMaxDays(v ?? 5)} disabled={running} style={{ width: 50 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>效率收:</span>
                      <InputNumber size="small" min={0} max={0.5} step={0.01} value={timeExitMinReturn} onChange={(v) => setTimeExitMinReturn(v ?? 0.05)} disabled={running} style={{ width: 55 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>分数:</span>
                      <InputNumber size="small" min={0} max={500} step={1} value={minStrategyScore} onChange={(v) => setMinStrategyScore(v ?? 100)} disabled={running} style={{ width: 55 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>RSI买:</span>
                      <Input size="small" value={buyThresholdsInput} onChange={(e) => setBuyThresholdsInput(e.target.value)} disabled={running} style={{ width: 80 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>RSI卖:</span>
                      <Input size="small" value={sellThresholdsInput} onChange={(e) => setSellThresholdsInput(e.target.value)} disabled={running} style={{ width: 100 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>回看:</span>
                      <InputNumber size="small" min={2} max={30} step={1} value={strongLookbackStart} onChange={(v) => setStrongLookbackStart(v ?? 10)} disabled={running} style={{ width: 50 }} />
                      <span style={{ fontSize: 12 }}>-</span>
                      <InputNumber size="small" min={1} max={29} step={1} value={strongLookbackEnd} onChange={(v) => setStrongLookbackEnd(v ?? 5)} disabled={running} style={{ width: 50 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>板块排名:</span>
                      <InputNumber size="small" min={0.01} max={1} step={0.05} value={boardRankPct} onChange={(v) => setBoardRankPct(v ?? 0.3)} disabled={running} style={{ width: 55 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>股票排名:</span>
                      <InputNumber size="small" min={0.01} max={1} step={0.05} value={stockRankPct} onChange={(v) => setStockRankPct(v ?? 0.3)} disabled={running} style={{ width: 55 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>结构破坏:</span>
                      <InputNumber size="small" min={1} max={30} step={1} value={structureBreakDays} onChange={(v) => setStructureBreakDays(v ?? 3)} disabled={running} style={{ width: 50 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>横盘震荡:</span>
                      <InputNumber size="small" min={1} max={30} step={1} value={rangeBoundDays} onChange={(v) => setRangeBoundDays(v ?? 5)} disabled={running} style={{ width: 50 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>回撤:</span>
                      <InputNumber size="small" min={0.05} max={1} step={0.05} value={pullbackPct} onChange={(v) => setPullbackPct(v ?? 0.3)} disabled={running} style={{ width: 55 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>次日开盘卖:</span>
                      <Switch size="small" checked={sellAtOpen} onChange={(v) => setSellAtOpen(v)} disabled={running} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>陡度:</span>
                      <InputNumber size="small" min={5} max={50} step={1} value={steepness} onChange={(v) => setSteepness(v ?? 20)} disabled={running} style={{ width: 55 }} />
                    </div>
                  </div>
                )}
              {!running && (
                <>
                  <a className={styles.abtn} onClick={startBacktest}>
                    {strategyType === 'rsi' ? 'RSI策略回测强势股票' : `${optimizedSubStrategy === 'both' ? 'MACD+RSI' : optimizedSubStrategy.toUpperCase()}优化策略回测强势股票`}
                  </a>
                  <Button
                    size="small"
                    onClick={() => { loadHistory(); setHistoryVisible(true); }}
                    style={{ marginLeft: 10 }}
                  >
                    历史 ({historyList.length})
                  </Button>
                </>
              )}
              {running && (
                <>
                  <a className={styles.abtn} onClick={togglePause} style={{ marginRight: 10 }}>
                    {paused ? '继续回测' : '暂停回测'}
                  </a>
                  <a className={styles.abtn} onClick={cancelBacktest} style={{ color: '#ff4d4f' }}>
                    取消回测
                  </a>
                </>
              )}
            </div>
          </div>
          
          <div className={styles.chartwrapper} style={{ flexDirection: 'column' }}>
            {/* [修复] 净值曲线始终保留DOM，避免echarts init报getAttribute null */}
            <div style={{ display: (!running && result) ? 'block' : 'none' }}>
              <Card title="📈 每日净值曲线" size="small" style={{ margin: '0 16px 16px' }}>
                <div ref={chartRef} style={{ width: '100%', height: 320, position: 'relative' }} />
              </Card>
            </div>

            {running && (
              <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                <Progress 
                  percent={progressPercent} 
                  status={paused ? 'normal' : 'active'} 
                  strokeColor={{ from: '#108ee9', to: '#87d068' }} 
                />
                <div style={{ marginTop: 12, color: '#666', fontSize: 14 }}>
                  {progress}{paused ? ' (已暂停)' : ''}
                </div>
              </div>
            )}

            {!running && result && (
              <div style={{ padding: 16 }}>
                <Card title="📊 回测结果汇总" size="small" style={{ marginBottom: 16 }}>
                  <Row gutter={[16, 16]}>
                    <Col span={6}>
                      <Statistic 
                        title="总收益率" 
                        value={result.totalReturn * 100} 
                        precision={2} 
                        suffix="%" 
                        valueStyle={{ color: result.totalReturn >= 0 ? '#cf1322' : '#3f8600' }} 
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic 
                        title="年化收益率" 
                        value={result.annualizedReturn * 100} 
                        precision={2} 
                        suffix="%" 
                        valueStyle={{ color: result.annualizedReturn >= 0 ? '#cf1322' : '#3f8600' }} 
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic 
                        title="最大回撤" 
                        value={result.maxDrawdown * 100} 
                        precision={2} 
                        suffix="%" 
                        valueStyle={{ color: '#3f8600' }} 
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic 
                        title="胜率" 
                        value={result.winRate * 100} 
                        precision={2} 
                        suffix="%" 
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic 
                        title="盈亏比" 
                        value={result.profitFactor} 
                        precision={2} 
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic 
                        title="夏普比率" 
                        value={result.sharpeRatio} 
                        precision={2} 
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic 
                        title="总交易次数" 
                        value={result.totalTrades} 
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic 
                        title="平均持仓天数" 
                        value={result.avgHoldingDays} 
                        precision={1} 
                        suffix="天" 
                      />
                    </Col>
                  </Row>
                </Card>
                
                <Card title="📝 交易明细" size="small" style={{ marginBottom: 16 }}>
                  <Table 
                    columns={tradeColumns} 
                    dataSource={result.trades.map((t: any, i: number) => ({ ...t, key: i }))}
                    pagination={{ pageSize: 20, showSizeChanger: true }}
                    scroll={{ x: 800 }}
                    size="small"
                  />
                </Card>

                {result.stockStats && result.stockStats.length > 0 && (
                  <Card title="📊 股票交易统计" size="small" style={{ marginBottom: 16 }}>
                    <Table 
                      columns={stockStatsColumns}
                      dataSource={result.stockStats.map((s: any, i: number) => ({ ...s, key: i }))}
                      pagination={{ pageSize: 20, showSizeChanger: true }}
                      scroll={{ x: 1160 }}
                      size="small"
                      expandable={{
                        expandedRowRender: (record: any) => (
                          <Table
                            columns={tradeDetailColumns}
                            dataSource={record.trades.map((t: any, i: number) => ({ ...t, key: i }))}
                            pagination={false}
                            size="small"
                            rowKey="buyDate"
                          />
                        ),
                        rowExpandable: (record: any) => record.trades && record.trades.length > 0,
                      }}
                    />
                  </Card>
                )}

                {result.scoreDistribution && result.scoreDistribution.length > 0 && (
                  <Card title="📈 策略得分与胜率关系" size="small" style={{ marginBottom: 16 }}>
                    <Table 
                      columns={scoreDistributionColumns}
                      dataSource={result.scoreDistribution.map((d: any, i: number) => ({ ...d, key: i }))}
                      pagination={false}
                      size="small"
                    />
                  </Card>
                )}

                {result.boardRankDistribution && result.boardRankDistribution.length > 0 && (
                  <Card title="📊 板块排名与胜率关系" size="small" style={{ marginBottom: 16 }}>
                    <Table 
                      columns={rankDistributionColumns}
                      dataSource={result.boardRankDistribution.map((d: any, i: number) => ({ ...d, key: i }))}
                      pagination={false}
                      size="small"
                    />
                  </Card>
                )}

                {result.stockRankDistribution && result.stockRankDistribution.length > 0 && (
                  <Card title="📊 个股排名与胜率关系" size="small" style={{ marginBottom: 16 }}>
                    <Table 
                      columns={rankDistributionColumns}
                      dataSource={result.stockRankDistribution.map((d: any, i: number) => ({ ...d, key: i }))}
                      pagination={false}
                      size="small"
                    />
                  </Card>
                )}

                {result.pullBackDistribution && result.pullBackDistribution.length > 0 && (
                  <Card title="📊 深度回调与胜率关系" size="small" style={{ marginBottom: 16 }}>
                    <Table 
                      columns={pullBackDistributionColumns}
                      dataSource={result.pullBackDistribution.map((d: any, i: number) => ({ ...d, key: i }))}
                      pagination={false}
                      size="small"
                    />
                  </Card>
                )}

              </div>
            )}

            {!running && !result && (
              <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
                选择日期范围后点击回测按钮开始
              </div>
            )}
          </div>

          {/* 历史记录弹窗 */}
          <Modal
            title="📚 回测历史记录"
            open={historyVisible}
            onCancel={() => setHistoryVisible(false)}
            footer={null}
            width={720}
          >
            {historyList.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
                暂无历史记录，完成一次回测后将自动保存
              </div>
            ) : (
              <List
                dataSource={historyList}
                renderItem={(item) => (
                  <List.Item
                    actions={[
                      <Button size="small" type="primary" onClick={() => loadHistoryItem(item)}>
                        加载
                      </Button>,
                      <Popconfirm
                        title="确认删除？"
                        onConfirm={() => deleteHistoryItem(item.id)}
                        okText="删除"
                        cancelText="取消"
                      >
                        <Button size="small" danger>
                          删除
                        </Button>
                      </Popconfirm>,
                    ]}
                  >
                    <List.Item.Meta
                      title={
                        <Space>
                          <span>{new Date(item.timestamp).toLocaleString()}</span>
                          <Tag color={item.strategyType === 'rsi' ? 'blue' : 'purple'}>
                            {item.strategyType === 'rsi' ? 'RSI' : (item.optimizedSubStrategy === 'both' ? 'MACD+RSI' : item.optimizedSubStrategy.toUpperCase())}
                          </Tag>
                          <Tag color={(item.result?.totalReturn || 0) >= 0 ? 'red' : 'green'}>
                            收益 {((item.result?.totalReturn || 0) * 100).toFixed(2)}%
                          </Tag>
                          <Tag>{item.result?.totalTrades || 0} 笔交易</Tag>
                        </Space>
                      }
                      description={
                        <div style={{ fontSize: 12, color: '#666' }}>
                          <div>日期: {item.dates[0]} ~ {item.dates[item.dates.length - 1]} ({item.dates.length}天)</div>
                          <div style={{ marginTop: 4 }}>
                            资金{item.params?.initialCapital?.toLocaleString() || 1000000} | 
                            仓位{item.params?.maxPositions || 5}只 | 
                            止损{((item.params?.stopLossInitPct ?? item.params?.stopLossInitPctMid ?? 0.95) * 100).toFixed(0)}% | 
                            追踪{((item.params?.trailingStopPct ?? item.params?.trailingStopPctMid ?? 0.90) * 100).toFixed(0)}% | 
                            止盈{((item.params?.takeProfitPct || 1.15) * 100).toFixed(0)}% | 
                            分数{item.params?.minStrategyScore || 100} | 
                            回看{item.params?.strongLookbackStart || 10}-{item.params?.strongLookbackEnd || 5} | 
                            结构破坏{item.params?.structureBreakDays || 3}天 | 
                            横盘{item.params?.rangeBoundDays || 5}天 | 
                            回撤{((item.params?.pullbackPct ?? item.params?.pullbackPctMid ?? 0.3) * 100).toFixed(0)}% | 开盘卖{item.params?.sellAtOpen ? '是' : '否'} | 
                            效率{item.params?.timeExitMaxDays || 5}天/{(item.params?.timeExitMinReturn || 0.05) * 100}% | 
                            忽略{(item.params?.profitIgnoreSignalPct || 0.10) * 100}% | 
                            陡度{item.params?.steepness || 20} | 
                            RSI买[{(item.params?.buyThresholds ?? [35,40,45]).join(',')}] | 
                            RSI卖[{(item.params?.sellThresholds ?? [65,70,75,80,85]).join(',')}]
                          </div>
                        </div>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </Modal>
        </div>
      );
}
export default Backtest;