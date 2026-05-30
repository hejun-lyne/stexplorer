import React, { useCallback, useState, useEffect } from 'react';
import { Row, Col, DatePicker, Table, Card, Statistic, Tag, Progress } from 'antd';
import { StoreState } from '@/reducers/types';
import styles from '../index.scss';
import * as Services from '@/services';
import moment from 'moment';
import { useHomeContext } from '@/components/FullHome';
import * as RSIStrategy from '@/helpers/rsistrategy';
import { Stock } from '@/types/stock';
import * as Helpers from '@/helpers';
import * as Enums from '@/utils/enums';
import { useRenderEcharts, useResizeEchart } from '@/utils/hooks';

export interface BacktestProps {
  onOpenStock: (secid: string, name: string) => void;
  active: boolean;
}

class StrongStocksDataProvider implements RSIStrategy.DataProvider {
    
    async getStrongStocks(date: string): Promise<Stock.DetailItem[]> {
      try {
        console.log(`[DataProvider] 获取强势股票: ${date}`);
        const result = await Helpers.Stock.LoadSingleDateQS(date, undefined,-1);
        console.log(`[DataProvider] 强势股票 ${date} 返回: ${result.stocks?.length || 0} 只`);
        return result.stocks ? Promise.resolve(result.stocks as Stock.DetailItem[]) : Promise.reject('数据未准备好');
      } catch (e) {
        console.error(`[DataProvider] 获取强势股票失败 ${date}:`, e);
        return [];
      } 
    }

    async getKLines(secid: string, endDate: string, days: number = 120): Promise<Stock.KLineItem[] | null> {
      try {
        console.log(`[DataProvider] 获取K线: ${secid} 截止${endDate} ${days}天`);
        const kResult = await Services.Stock.GetKFromDataSource(Enums.FundApiType.Tushare, secid, Enums.KLineType.Day);
        const index = kResult.ks.findIndex(k => k.date === endDate);
        if (index === -1) {
          console.log(`[DataProvider] ${secid} 未找到日期 ${endDate} 的K线，数据范围: ${kResult.ks[0]?.date} ~ ${kResult.ks[kResult.ks.length - 1]?.date}`);
          return null;
        }
        const sliced = kResult.ks.slice(0, index + 1);
        console.log(`[DataProvider] ${secid} K线返回: ${sliced.length} 条 (截止${endDate})`);
        return kResult.ks ? Promise.resolve(sliced) : Promise.reject('数据未准备好');
      } catch (e) {
        console.error(`[DataProvider] 获取K线失败 ${secid}:`, e);
        return null;
      }
    }

    async getBoardData(boardCode: string, endDate: string): Promise<Stock.BoardItem | null> {
      try {
        console.log(`[DataProvider] 获取板块数据: ${boardCode} ${endDate}`);
        const bResult = await Services.Tushare.GetBoardDetailFromTushare(boardCode, endDate);
        console.log(`[DataProvider] 板块 ${boardCode} 返回:`, bResult ? '有数据' : '无数据');
        return bResult ? Promise.resolve(bResult) : Promise.reject('数据未准备好');
      } catch (e) {
        console.error(`[DataProvider] 获取板块数据失败 ${boardCode}:`, e);
        return null;
      }
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
  dailyValues: RSIStrategy.DailyValue[],
  initialCapital: number
) {
  const dates = dailyValues.map(d => d.date);
  const values = dailyValues.map(d => d.totalValue);

  // 计算最大回撤点
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

const Backtest: React.FC<BacktestProps> = ({ onOpenStock, active }) => {
    const { darkMode, lowKey } = useHomeContext();
    const [dates, setDates] = useState([moment(new Date()).format('YYYYMMDD')]);
    const [running, setRunning] = useState(false);
    const [strongStocksProvider] = useState<StrongStocksDataProvider>(new StrongStocksDataProvider());
    const [progress, setProgress] = useState("正在准备数据...");
    const [progressPercent, setProgressPercent] = useState(0);
    const [result, setResult] = useState<RSIStrategy.BacktestResult | null>(null);

    // 图表相关：参照 MarketMood，chartRef 必须始终绑定到 DOM
    const { ref: chartRef, chartInstance: chart } = useResizeEchart(-1);
    const [chartOption, setChartOption] = useState<any>(undefined);

    const onChangeDate = useCallback(
        (d: moment.Moment | null, isStart = true) => {
          if (!d) return;
          const nd = d.format('YYYYMMDD');
          if (dates.length) {
            if (isStart) {
              const ed = dates[dates.length - 1];
              if (nd > ed) {
                setDates([nd]);
                return;
              }
              const newDates = [nd];
              const edm = moment(ed, 'YYYYMMDD');
              let i = 1;
              while (true) {
                const next = d.add(i++, 'days');
                if (next.isBefore(edm)) {
                  newDates.push(next.format('YYYYMMDD'));
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
              const sdm = moment(sd, 'YYYYMMDD');
              let i = 1;
              while (true) {
                const next = sdm.add(i++, 'days');
                if (next.isBefore(d)) {
                  newDates.push(next.format('YYYYMMDD'));
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
    
    const startStrongStockRSIBacktest = useCallback(async () => {
      if (!dates.length) {
        console.warn('[UI] 未选择日期，无法启动回测');
        return;
      }

      console.log(`[UI] ====== 启动回测 ======`);
      console.log(`[UI] 日期范围: ${dates[0]} ~ ${dates[dates.length - 1]} (${dates.length} 天)`);

      setProgress("开始执行回测...");
      setProgressPercent(0);
      setResult(null);
      setChartOption(undefined);
      setRunning(true);

      try {
        const strategy = new RSIStrategy.StrongStockBacktest(dates);
        const backtestResult = await strategy.run(strongStocksProvider, (msg, pct) => {
            setProgress(msg);
            if (pct !== undefined) setProgressPercent(pct);
        });
        setResult(backtestResult);
        setProgress("回测完成！");

        // 初始化图表
        const initialCapital = 1000000;
        const baseOpts = getNetValueBaseOptions(darkMode, initialCapital);
        const finalOpts = updateNetValueOptions(baseOpts, darkMode, backtestResult.dailyValues, initialCapital);
        setChartOption(finalOpts);

        console.log(`[UI] 回测结果已接收，图表已生成`);
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        setProgress(`回测出错: ${errorMsg}`);
        console.error(`[UI] 回测异常:`, e);
      } finally {
        setRunning(false);
        console.log(`[UI] ====== 回测流程结束 ======`);
      }
    }, [dates, strongStocksProvider, darkMode]);

    // 渲染图表
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

    // 暗黑模式切换时更新图表
    useEffect(() => {
      if (chartOption && result) {
        const initialCapital = 1000000;
        const updated = updateNetValueOptions(chartOption, darkMode, result.dailyValues, initialCapital);
        setChartOption({ ...updated });
      }
    }, [darkMode]);

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
                <DatePicker onChange={onChangeDate} value={moment(dates[0], 'YYYYMMDD')} style={{ marginRight: 10 }} />
                <DatePicker
                    onChange={(d) => onChangeDate(d, false)}
                    value={moment(dates[dates.length - 1], 'YYYYMMDD')}
                    style={{ marginRight: 10 }}
                />
              <a className={styles.abtn} onClick={startStrongStockRSIBacktest}>RSI策略回测强势股票</a>
            </div>
          </div>
          
          <div className={styles.chartwrapper}>
            {running && (
                <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                    <Progress 
                        percent={progressPercent} 
                        status="active" 
                        strokeColor={{ from: '#108ee9', to: '#87d068' }} 
                    />
                    <div style={{ marginTop: 12, color: '#666', fontSize: 14 }}>{progress}</div>
                </div>
            )}

            {/* 
              关键修复：chartRef 必须始终绑定到真实 DOM，不能放在条件渲染中。
              参照 MarketMood 的做法，通过 style 控制显隐，而不是条件渲染。
            */}
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
                            dataSource={result.trades.map((t, i) => ({ ...t, key: i }))}
                            pagination={{ pageSize: 20, showSizeChanger: true }}
                            scroll={{ x: 800 }}
                            size="small"
                        />
                    </Card>
                    
                    <Card title="📋 每日净值" size="small">
                        <Table 
                            columns={dailyColumns} 
                            dataSource={result.dailyValues.map((d, i) => ({ ...d, key: i }))}
                            pagination={{ pageSize: 20, showSizeChanger: true }}
                            size="small"
                        />
                    </Card>
                </div>
            )}

            {!running && !result && (
                <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
                    选择日期范围后点击"RSI策略回测强势股票"开始回测
                </div>
            )}
          </div>
        </div>
      );
}
export default Backtest;