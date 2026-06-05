import React, { useCallback, useState, useEffect, useRef } from 'react';
import { Row, Col, DatePicker, Table, Card, Statistic, Tag, Progress, Radio, InputNumber } from 'antd';
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
        console.log(`[DataProvider] 获取强势股票: ${date} -> ${queryDate}`);
        const result = await Helpers.Stock.LoadSingleDateQS(queryDate, undefined, -1);
        console.log(`[DataProvider] 强势股票 ${date} 返回: ${result.stocks?.length || 0} 只`);
        if (!result.stocks) {
          return Promise.reject('数据未准备好');
        }
        const filteredStocks = result.stocks.filter((s: any) => {
          const code = s.secid?.split('.')[1] || '';
          if (code.startsWith('688') || code.startsWith('689')) return false;
          if (code.startsWith('8') || code.startsWith('9')) return false;
          if (s.zx < 10000 || s.zx > 100000) return false;
          return true;
        });
        console.log(`[DataProvider] 强势股票 ${date} 过滤后: ${filteredStocks.length} 只`);
        return Promise.resolve(filteredStocks.map((s: any) => ({ 
          secid: s.secid, 
          name: s.name,
          zdf: s.zdf,
          zx: s.zx,
          bk: s.hybk, 
          lt: (s.ltsz / 100000000) 
        } as Stock.DetailItem)));
      } catch (e) {
        console.error(`[DataProvider] 获取强势股票失败 ${date}:`, e);
        return [];
      } 
    }

    async getKLines(secid: string, endDate: string, days: number = 120): Promise<Stock.KLineItem[] | null> {
      try {
        // console.log(`[DataProvider] 获取K线: ${secid} 截止${endDate} ${days}天`);
        const kResult = await Services.Stock.GetKFromDataSource(Enums.FundApiType.Tushare, secid, Enums.KLineType.Day);
        const index = kResult.ks.findIndex(k => k.date === endDate);
        if (index === -1) {
          console.log(`[DataProvider] ${secid} 未找到日期 ${endDate} 的K线，数据范围: ${kResult.ks[0]?.date} ~ ${kResult.ks[kResult.ks.length - 1]?.date}`);
          return null;
        }
        const sliced = kResult.ks.slice(0, index + 1);
        if (sliced.length > days) {
          sliced.splice(0, sliced.length - days);
        }
        // console.log(`[DataProvider] ${secid} K线返回: ${sliced.length} 条 (截止${endDate})`);
        return kResult.ks ? Promise.resolve(sliced) : Promise.reject('数据未准备好');
      } catch (e) {
        console.error(`[DataProvider] 获取K线失败 ${secid}:`, e);
        return null;
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

const Backtest: React.FC<BacktestProps> = ({ onOpenStock, active }) => {
    const { darkMode, lowKey } = useHomeContext();
    const [dates, setDates] = useState([moment(new Date()).format('YYYY-MM-DD')]);
    const [running, setRunning] = useState(false);
    const [paused, setPaused] = useState(false);
    const [dataProvider] = useState<UnifiedDataProvider>(new UnifiedDataProvider());
    const [strategyType, setStrategyType] = useState<StrategyType>('rsi');
    const [progress, setProgress] = useState("正在准备数据...");
    const [progressPercent, setProgressPercent] = useState(0);
    const [result, setResult] = useState<any>(null);

    // 优化策略参数
    const [initialCapital, setInitialCapital] = useState(1000000);
    const [maxPositions, setMaxPositions] = useState(5);
    const [positionRatio, setPositionRatio] = useState(0.2);
    const [stopLossInitPct, setStopLossInitPct] = useState(0.95);
    const [trailingStopPct, setTrailingStopPct] = useState(0.95);
    const [minStrategyScore, setMinStrategyScore] = useState(90);
    const [strongLookbackStart, setStrongLookbackStart] = useState(10);
    const [strongLookbackEnd, setStrongLookbackEnd] = useState(5);

    const cancelledRef = useRef(false);
    const pausedRef = useRef(false);

    const { ref: chartRef, chartInstance: chart } = useResizeEchart(-1);
    const [chartOption, setChartOption] = useState<any>(undefined);

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
            minStrategyScore,
            strongLookbackStart,
            strongLookbackEnd,
            maxPositions,
            positionRatio,
            workerCount,
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
    }, [dates, dataProvider, darkMode, strategyType, stopLossInitPct, trailingStopPct, minStrategyScore, strongLookbackStart, strongLookbackEnd, initialCapital, maxPositions, positionRatio]);

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
      if (chartOption && result) {
        const initialCapital = 1000000;
        const updated = updateNetValueOptions(chartOption, darkMode, result.dailyValues, initialCapital);
        setChartOption({ ...updated });
      }
    }, [darkMode, result, chartOption]);

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

    const dailyColumns = [
        { title: '日期', dataIndex: 'date', key: 'date', width: 120 },
        { title: '总市值', dataIndex: 'totalValue', key: 'totalValue', render: (v: number) => v.toFixed(2) },
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
                      <InputNumber size="small" min={0.5} max={0.99} step={0.01} value={stopLossInitPct} onChange={(v) => setStopLossInitPct(v ?? 0.95)} disabled={running} style={{ width: 55 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>追踪:</span>
                      <InputNumber size="small" min={0.5} max={0.99} step={0.01} value={trailingStopPct} onChange={(v) => setTrailingStopPct(v ?? 0.90)} disabled={running} style={{ width: 55 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>分数:</span>
                      <InputNumber size="small" min={0} max={500} step={1} value={minStrategyScore} onChange={(v) => setMinStrategyScore(v ?? 100)} disabled={running} style={{ width: 55 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>回看:</span>
                      <InputNumber size="small" min={2} max={30} step={1} value={strongLookbackStart} onChange={(v) => setStrongLookbackStart(v ?? 10)} disabled={running} style={{ width: 50 }} />
                      <span style={{ fontSize: 12 }}>-</span>
                      <InputNumber size="small" min={1} max={29} step={1} value={strongLookbackEnd} onChange={(v) => setStrongLookbackEnd(v ?? 5)} disabled={running} style={{ width: 50 }} />
                    </div>
                  </div>
                )}
              {!running && (
                <a className={styles.abtn} onClick={startBacktest}>
                  {strategyType === 'rsi' ? 'RSI策略回测强势股票' : '优化策略回测强势股票'}
                </a>
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
          
          <div className={styles.chartwrapper}>
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

            <div style={{ 
              visibility: (!running && result) ? 'visible' : 'hidden',
              height: (!running && result) ? 'auto' : 0,
              overflow: 'hidden',
              padding: (!running && result) ? '0 16px' : 0,
              marginBottom: (!running && result) ? 16 : 0
            }}>
              <Card title="📈 每日净值曲线" size="small">
                <div ref={chartRef} style={{ width: '100%', height: 320 }} />
              </Card>
            </div>

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
                    
                    <Card title="📋 每日净值" size="small">
                        <Table 
                            columns={dailyColumns} 
                            dataSource={result.dailyValues.map((d: any, i: number) => ({ ...d, key: i }))}
                            pagination={{ pageSize: 20, showSizeChanger: true }}
                            size="small"
                        />
                    </Card>
                </div>
            )}

            {!running && !result && (
                <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
                    选择日期范围后点击回测按钮开始
                </div>
            )}
          </div>
        </div>
      );
}
export default Backtest;