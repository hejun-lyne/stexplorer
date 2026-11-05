import React, { useMemo } from 'react';
import classnames from 'classnames';
import { Table, Empty } from 'antd';
import { useRenderEcharts, useResizeEchart } from '@/utils/hooks';
import * as Utils from '@/utils';
import { BuildAttribution } from '@/helpers/trainSettle';
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

  // 归因分析：新归档直接用结算时算好的结果；旧归档（无归因字段）用卖出明细兜底算「个股 / 月度」两维，
  // 持仓周期需要往返的买入日，旧数据还原不出来，此时该维度为空、界面自动隐藏。
  const attribution = useMemo<Train.Attribution>(() => {
    if (record.attribution && record.attribution.roundTrips) {
      return record.attribution;
    }
    const sells = (record.trades || []).filter((t) => t.type === 'sell');
    return BuildAttribution(
      sells.map((t) => ({
        secid: t.secid || '',
        name: t.name,
        buyDate: t.date,
        sellDate: t.date,
        buyPrice: 0,
        sellPrice: t.price,
        count: t.count,
        profit: t.profit,
        profitRatio: t.profitRatio,
        holdDays: 0,
      }))
    );
  }, [record]);

  /** 有往返时展示持仓周期归因；个股 / 月度只要有卖出就展示 */
  const hasHoldingAttr = attribution.byHolding.some((b) => b.count > 0);

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

  /** 组合结算（一次训练跨多只标的）时，成交明细需要标明标的 */
  const showSecidColumn = record.trades.some((t) => !!t.secid);

  const columns = [
    ...(showSecidColumn
      ? [
          {
            title: '标的',
            dataIndex: 'name',
            width: 90,
            render: (v: string, r: Train.TradeLog) => v || r.secid || '--',
          },
        ]
      : []),
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
          {archive.name ? `${archive.name}${archive.secid && archive.secid !== 'ALL' ? `（${archive.secid}）` : ''}` : ''}
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
          rowKey={(r: Train.TradeLog) => `${r.secid || ''}_${r.date}_${r.type}_${r.price}_${r.count}`}
          columns={columns}
          dataSource={record.trades}
          pagination={false}
          scroll={{ y: 240, x: 900 }}
        />
      ) : (
        <Empty description="本次训练没有交易记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}

      {attribution.byStock.length > 0 && (
        <>
          <div className={styles.chartTitle}>归因分析 · 个股盈亏</div>
          <Table
            className={styles.table}
            size="small"
            rowKey={(r: Train.StockAttribution) => r.secid || r.name || 'all'}
            dataSource={attribution.byStock}
            pagination={false}
            scroll={{ y: 200, x: 620 }}
            columns={[
              {
                title: '标的',
                dataIndex: 'name',
                width: 110,
                render: (v: string, r: Train.StockAttribution) => v || r.secid || '--',
              },
              { title: '往返', dataIndex: 'roundTrips', width: 60, align: 'right' as const },
              {
                title: '胜/负',
                width: 70,
                align: 'right' as const,
                render: (_: unknown, r: Train.StockAttribution) => `${r.wins}/${r.losses}`,
              },
              {
                title: '胜率',
                dataIndex: 'winRate',
                width: 70,
                align: 'right' as const,
                render: (v: number) => `${(v * 100).toFixed(1)}%`,
              },
              {
                title: '累计盈亏',
                dataIndex: 'profit',
                width: 110,
                align: 'right' as const,
                render: (v: number) => (
                  <span className={Utils.GetValueColor(v).textClass}>
                    {v >= 0 ? '+' : ''}
                    {formatNumber(v, 0)}
                  </span>
                ),
              },
              {
                title: '盈亏占比',
                dataIndex: 'contribution',
                width: 90,
                align: 'right' as const,
                render: (v: number) => (
                  <span className={Utils.GetValueColor(v).textClass}>
                    {v >= 0 ? '+' : ''}
                    {(v * 100).toFixed(1)}%
                  </span>
                ),
              },
            ]}
          />
        </>
      )}

      {hasHoldingAttr && (
        <>
          <div className={styles.chartTitle}>归因分析 · 持仓周期</div>
          <Table
            className={styles.table}
            size="small"
            rowKey="label"
            dataSource={attribution.byHolding.filter((b) => b.count > 0)}
            pagination={false}
            scroll={{ y: 200, x: 560 }}
            columns={[
              { title: '持仓周期', dataIndex: 'label', width: 110 },
              { title: '次数', dataIndex: 'count', width: 60, align: 'right' as const },
              {
                title: '胜/负',
                width: 70,
                align: 'right' as const,
                render: (_: unknown, r: Train.HoldingAttribution) => `${r.wins}/${r.losses}`,
              },
              {
                title: '胜率',
                dataIndex: 'winRate',
                width: 70,
                align: 'right' as const,
                render: (v: number) => `${(v * 100).toFixed(1)}%`,
              },
              {
                title: '平均收益',
                dataIndex: 'avgReturn',
                width: 90,
                align: 'right' as const,
                render: (v: number) => (
                  <span className={Utils.GetValueColor(v).textClass}>
                    {v >= 0 ? '+' : ''}
                    {v.toFixed(2)}%
                  </span>
                ),
              },
              {
                title: '累计盈亏',
                dataIndex: 'profit',
                width: 110,
                align: 'right' as const,
                render: (v: number) => (
                  <span className={Utils.GetValueColor(v).textClass}>
                    {v >= 0 ? '+' : ''}
                    {formatNumber(v, 0)}
                  </span>
                ),
              },
            ]}
          />
        </>
      )}

      {attribution.byMonth.length > 0 && (
        <>
          <div className={styles.chartTitle}>归因分析 · 月度盈亏</div>
          <Table
            className={styles.table}
            size="small"
            rowKey="month"
            dataSource={attribution.byMonth}
            pagination={false}
            scroll={{ y: 200, x: 460 }}
            columns={[
              { title: '月份', dataIndex: 'month', width: 90 },
              { title: '次数', dataIndex: 'count', width: 60, align: 'right' as const },
              {
                title: '胜/负',
                width: 70,
                align: 'right' as const,
                render: (_: unknown, r: Train.MonthAttribution) => `${r.wins}/${r.losses}`,
              },
              {
                title: '胜率',
                dataIndex: 'winRate',
                width: 70,
                align: 'right' as const,
                render: (v: number) => `${(v * 100).toFixed(1)}%`,
              },
              {
                title: '累计盈亏',
                dataIndex: 'profit',
                width: 110,
                align: 'right' as const,
                render: (v: number) => (
                  <span className={Utils.GetValueColor(v).textClass}>
                    {v >= 0 ? '+' : ''}
                    {formatNumber(v, 0)}
                  </span>
                ),
              },
            ]}
          />
        </>
      )}
    </div>
  );
});

export default TrainSettlement;
