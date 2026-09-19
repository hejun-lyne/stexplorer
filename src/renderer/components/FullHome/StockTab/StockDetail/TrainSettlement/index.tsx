import React, { useMemo } from 'react';
import classnames from 'classnames';
import { Table, Empty } from 'antd';
import { useRenderEcharts, useResizeEchart } from '@/utils/hooks';
import * as Utils from '@/utils';
import styles from './index.scss';

export interface TrainSettlementProps {
  record: Train.Settlement | Train.ArchiveRecord;
}

/** 千分位金额 */
function formatNumber(value: number, digits = 2) {
  const fixed = Number(value || 0).toFixed(digits);
  const [int, decimal] = fixed.split('.');
  const withComma = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimal ? `${withComma}.${decimal}` : withComma;
}

const TrainSettlement: React.FC<TrainSettlementProps> = React.memo(({ record }) => {
  const archive = record as Train.ArchiveRecord;
  const { ref: chartRef, chartInstance } = useResizeEchart(-1);

  const items = useMemo(() => {
    const totalClass = Utils.GetValueColor(record.totalReturn).textClass;
    return [
      { label: '总收益率', value: `${record.totalReturn >= 0 ? '+' : ''}${(record.totalReturn * 100).toFixed(2)}%`, className: totalClass },
      { label: '年化收益率', value: `${record.annualizedReturn >= 0 ? '+' : ''}${(record.annualizedReturn * 100).toFixed(2)}%`, className: Utils.GetValueColor(record.annualizedReturn).textClass },
      { label: '最大回撤', value: `${(record.maxDrawdown * 100).toFixed(2)}%`, className: '' },
      { label: '夏普比率', value: record.sharpeRatio.toFixed(2), className: Utils.GetValueColor(record.sharpeRatio).textClass },
      { label: '盈亏比', value: record.profitFactor === Number.POSITIVE_INFINITY ? '∞' : record.profitFactor.toFixed(2), className: Utils.GetValueColor(record.profitFactor - 1).textClass },
      { label: '胜率', value: `${(record.winRate * 100).toFixed(1)}%`, className: '' },
      { label: '交易次数', value: `${record.tradeCount} 次（${record.winCount}胜${record.loseCount}负）`, className: '' },
      { label: '期末总资产', value: formatNumber(record.finalValue, 2), className: Utils.GetValueColor(record.finalValue - record.initialCapital).textClass },
    ];
  }, [record]);

  useRenderEcharts(
    () => {
      if (!chartInstance) {
        return;
      }
      const dates = record.dailyValues.map((_) => _.date);
      const rates = record.dailyValues.map((_) => _.returnRate);
      chartInstance.setOption({
        animation: false,
        grid: { left: 55, right: 20, top: 30, bottom: 30 },
        tooltip: { trigger: 'axis', valueFormatter: (v: any) => `${Number(v).toFixed(2)}%` },
        xAxis: {
          type: 'category',
          data: dates,
          boundaryGap: false,
          axisLabel: { fontSize: 10, color: '#999' },
          axisLine: { lineStyle: { color: '#ccc' } },
        },
        yAxis: {
          type: 'value',
          name: '收益率(%)',
          nameTextStyle: { fontSize: 10, color: '#999' },
          axisLabel: { fontSize: 10, color: '#999', formatter: '{value}%' },
          splitLine: { lineStyle: { color: '#eee' } },
        },
        series: [
          {
            name: '累计收益率',
            type: 'line',
            smooth: true,
            symbol: 'none',
            data: rates,
            lineStyle: { width: 2, color: '#fa541c' },
            areaStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: 'rgba(250,84,28,0.35)' },
                  { offset: 1, color: 'rgba(250,84,28,0.02)' },
                ],
              },
            },
            markLine: {
              silent: true,
              symbol: 'none',
              data: [{ yAxis: 0 }],
              lineStyle: { color: '#999', type: 'dashed' },
              label: { show: false },
            },
          },
        ],
      });
    },
    chartInstance,
    [record]
  );

  const columns = [
    { title: '日期', dataIndex: 'date', width: 96 },
    {
      title: '操作',
      dataIndex: 'type',
      width: 60,
      render: (t: string) => <span className={t === 'buy' ? styles.buy : styles.sell}>{t === 'buy' ? '买入' : '卖出'}</span>,
    },
    { title: '成交价', dataIndex: 'price', width: 80, align: 'right' as const, render: (v: number) => v.toFixed(2) },
    { title: '数量', dataIndex: 'count', width: 80, align: 'right' as const, render: (v: number) => `${v}` },
    { title: '金额', dataIndex: 'amount', width: 100, align: 'right' as const, render: (v: number) => formatNumber(v, 0) },
    { title: '佣金', dataIndex: 'commission', width: 80, align: 'right' as const, render: (v: number) => v.toFixed(2) },
    { title: '持仓', dataIndex: 'shares', width: 80, align: 'right' as const, render: (v: number) => `${v}` },
    { title: '成本', dataIndex: 'costPrice', width: 80, align: 'right' as const, render: (v: number) => (v > 0 ? v.toFixed(2) : '--') },
    { title: '可用资金', dataIndex: 'cash', width: 110, align: 'right' as const, render: (v: number) => formatNumber(v, 0) },
    {
      title: '已实现盈亏',
      dataIndex: 'profit',
      width: 120,
      align: 'right' as const,
      render: (v: number, r: Train.TradeLog) =>
        r.type === 'sell' ? (
          <span className={Utils.GetValueColor(v).textClass}>
            {v >= 0 ? '+' : ''}
            {formatNumber(v, 0)}（{r.profitRatio >= 0 ? '+' : ''}
            {r.profitRatio.toFixed(2)}%）
          </span>
        ) : (
          '--'
        ),
    },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.stock}>
          {archive.name ? `${archive.name}（${archive.secid}）` : ''}
        </div>
        <div className={styles.sub}>
          训练区间：{record.startDate} ~ {record.endDate} ｜ 初始资金：{formatNumber(record.initialCapital, 0)} ｜ 佣金：
          {(record.commissionRate * 100).toFixed(4)}%
          {archive.createdAt ? ` ｜ 归档时间：${archive.createdAt}` : ''}
        </div>
      </div>
      <div className={styles.items}>
        {items.map((item) => (
          <div className={styles.item} key={item.label}>
            <div className={styles.itemLabel}>{item.label}</div>
            <div className={classnames(styles.itemValue, item.className)}>{item.value}</div>
          </div>
        ))}
      </div>
      <div className={styles.chartTitle}>收益率变化</div>
      <div className={styles.chart} ref={chartRef} />
      <div className={styles.chartTitle}>持仓变化（{record.trades.length} 笔）</div>
      {record.trades.length ? (
        <Table
          className={styles.table}
          size="small"
          rowKey={(r: Train.TradeLog) => `${r.date}_${r.type}_${r.price}_${r.count}`}
          columns={columns}
          dataSource={record.trades}
          pagination={false}
          scroll={{ y: 240, x: 900 }}
        />
      ) : (
        <Empty description="本次训练没有交易记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </div>
  );
});

export default TrainSettlement;
