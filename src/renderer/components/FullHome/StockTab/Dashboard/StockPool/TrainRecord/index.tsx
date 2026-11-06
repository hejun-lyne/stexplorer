import React, { useMemo, useState } from 'react';
import { Empty, Popconfirm, Table, Tabs, Tooltip } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { removeTrainTradeRecordAction, setTrainTradeRecordsAction } from '@/actions/train';
import { BuildStockAttribution } from '@/helpers/trainAccount';
import * as Utils from '@/utils';
import TrainRecordDetail from './Detail';
import styles from './index.scss';

export interface TrainRecordProps {
  onOpenStock: (secid: string, name: string) => void;
}

/** 千分位金额（带 ¥） */
function formatMoney(value: number) {
  return `¥${Math.abs(Math.round(Number(value) || 0)).toLocaleString('zh-CN')}`;
}

/** 带符号的盈亏金额 */
function formatSignedMoney(value: number) {
  const v = Number(value) || 0;
  return `${v >= 0 ? '+' : '-'}${formatMoney(v)}`;
}

/** 带符号的百分比 */
function formatSignedPct(value: number) {
  const v = Number(value) || 0;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/**
 * 训练记录
 *
 * 训练模式下每次「清仓」某只股票，都会把本轮（上一次清仓 → 本次清仓）的完整交易归档一条，
 * 数据落在 `state.train.tradeRecords`（store/train_trade_records.json），所以换训练日、
 * 重启应用后仍然保留。
 *
 * 展开行按「买入日 ~ 卖出日」逐日展示：收盘、涨跌幅、短线评分、RSI、均线，
 * 以及当天的买卖理由 / 复盘记录（见 ./Detail）。
 */
const TrainRecord: React.FC<TrainRecordProps> = React.memo(({ onOpenStock }) => {
  const dispatch = useDispatch();
  const records = useSelector((state: StoreState) => state.train.tradeRecords);

  // 卖出的日期越新越靠前；同一天按归档时间倒序
  const list = useMemo(
    () =>
      [...(records || [])].sort((a, b) => {
        if (a.sellDate !== b.sellDate) {
          return a.sellDate < b.sellDate ? 1 : -1;
        }
        return a.createdAt < b.createdAt ? 1 : -1;
      }),
    [records]
  );

  const summary = useMemo(() => {
    const total = list.reduce((sum, r) => sum + (Number(r.profit) || 0), 0);
    const win = list.filter((r) => Number(r.profit) > 0).length;
    const lose = list.filter((r) => Number(r.profit) < 0).length;
    const winRate = list.length ? win / list.length : 0;
    const avgRatio = list.length ? list.reduce((sum, r) => sum + (Number(r.profitRatio) || 0), 0) / list.length : 0;
    return { total, win, lose, winRate, avgRatio };
  }, [list]);

  const [tab, setTab] = useState<'detail' | 'attribution'>('detail');

  // 归因分析：由训练记录汇总个股 / 持仓周期 / 月度三维度
  const attribution = useMemo(() => BuildStockAttribution(list), [list]);

  const stockAttrColumns = [
    { title: '股票', dataIndex: 'name', render: (v: string, r: Train.StockAttribution) => v || r.secid || '--' },
    { title: '笔数', dataIndex: 'roundTrips', width: 70, align: 'right' as const },
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
      render: (v: number) => <span className={Utils.GetValueColor(v).textClass}>{formatSignedMoney(v)}</span>,
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
  ];

  const holdingAttrColumns = [
    { title: '持仓周期', dataIndex: 'label', width: 110 },
    { title: '笔数', dataIndex: 'count', width: 70, align: 'right' as const },
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
      render: (v: number) => <span className={Utils.GetValueColor(v).textClass}>{formatSignedMoney(v)}</span>,
    },
  ];

  const monthAttrColumns = [
    { title: '月份', dataIndex: 'month', width: 90 },
    { title: '笔数', dataIndex: 'count', width: 70, align: 'right' as const },
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
      render: (v: number) => <span className={Utils.GetValueColor(v).textClass}>{formatSignedMoney(v)}</span>,
    },
  ];

  const columns = useMemo(
    () => [
      {
        title: '股票',
        dataIndex: 'name',
        width: 150,
        fixed: 'left' as const,
        render: (v: string, r: Train.StockTradeRecord) => (
          <a onClick={() => onOpenStock(r.secid, r.name || r.secid)} title={`打开 ${r.name || r.secid} 详情`}>
            {r.name || r.secid}
          </a>
        ),
      },
      {
        title: '买入',
        dataIndex: 'buyDate',
        width: 108,
        render: (v: string, r: Train.StockTradeRecord) => (
          <span className={styles.tradeCell}>
            <span>{v}</span>
            {r.buyTime ? <span className={styles.tradeTime}>{r.buyTime}</span> : null}
          </span>
        ),
      },
      {
        title: '卖出',
        dataIndex: 'sellDate',
        width: 108,
        render: (v: string, r: Train.StockTradeRecord) => (
          <span className={styles.tradeCell}>
            <span>{v}</span>
            {r.sellTime ? <span className={styles.tradeTime}>{r.sellTime}</span> : null}
          </span>
        ),
      },
      {
        title: '成本价',
        dataIndex: 'buyPrice',
        width: 88,
        align: 'right' as const,
        render: (v: number) => (Number(v) > 0 ? Number(v).toFixed(2) : '--'),
      },
      {
        title: '卖出价',
        dataIndex: 'sellPrice',
        width: 88,
        align: 'right' as const,
        render: (v: number) => (Number(v) > 0 ? Number(v).toFixed(2) : '--'),
      },
      {
        title: '股数',
        dataIndex: 'count',
        width: 88,
        align: 'right' as const,
        render: (v: number) => Number(v || 0).toLocaleString('zh-CN'),
      },
      {
        title: '盈亏',
        dataIndex: 'profit',
        width: 110,
        align: 'right' as const,
        sorter: (a: Train.StockTradeRecord, b: Train.StockTradeRecord) => a.profit - b.profit,
        render: (v: number) => <span className={Utils.GetValueColor(v).textClass}>{formatSignedMoney(v)}</span>,
      },
      {
        title: '收益率',
        dataIndex: 'profitRatio',
        width: 92,
        align: 'right' as const,
        sorter: (a: Train.StockTradeRecord, b: Train.StockTradeRecord) => a.profitRatio - b.profitRatio,
        render: (v: number) => <span className={Utils.GetValueColor(v).textClass}>{formatSignedPct(v)}</span>,
      },
      {
        title: '持有',
        dataIndex: 'holdDays',
        width: 76,
        align: 'right' as const,
        sorter: (a: Train.StockTradeRecord, b: Train.StockTradeRecord) => a.holdDays - b.holdDays,
        render: (v: number) => `${Number(v) || 0} 天`,
      },
      {
        title: '清仓理由',
        dataIndex: 'reason',
        ellipsis: true,
        render: (v: string) => (v ? <Tooltip title={v}>{v}</Tooltip> : '--'),
      },
      {
        title: '操作',
        key: 'op',
        width: 56,
        align: 'center' as const,
        render: (_: any, r: Train.StockTradeRecord) => (
          <Popconfirm
            title="删除这条训练记录？"
            description="只删除记录，不影响持仓与买卖点"
            okText="删除"
            cancelText="取消"
            onConfirm={() => dispatch(removeTrainTradeRecordAction(r.id))}
          >
            <DeleteOutlined className={styles.del} title="删除记录" />
          </Popconfirm>
        ),
      },
    ],
    [dispatch, onOpenStock]
  );

  return (
    <div className={styles.container}>
      <div className={styles.summary}>
        <span>
          共 <b>{list.length}</b> 笔
        </span>
        <span>
          合计盈亏{' '}
          <b className={Utils.GetValueColor(summary.total).textClass}>{formatSignedMoney(summary.total)}</b>
        </span>
        <span>
          胜率 <b>{(summary.winRate * 100).toFixed(1)}%</b>
          <span className={styles.sub}>
            （{summary.win}胜{summary.lose}负）
          </span>
        </span>
        <span>
          平均收益率{' '}
          <b className={Utils.GetValueColor(summary.avgRatio).textClass}>{formatSignedPct(summary.avgRatio)}</b>
        </span>
        {list.length > 0 && (
          <Popconfirm
            title="清空全部训练记录？"
            description="只清空记录，不影响持仓与买卖点"
            okText="清空"
            cancelText="取消"
            onConfirm={() => dispatch(setTrainTradeRecordsAction([]))}
          >
            <a>清空记录</a>
          </Popconfirm>
        )}
      </div>
      <Tabs className={styles.tabs} activeKey={tab} onChange={setTab}>
        <Tabs.TabPane tab="交易明细" key="detail">
          <div className={styles.tableWrap}>
            <Table
              className={styles.table}
              size="small"
              rowKey="id"
              dataSource={list}
              columns={columns}
              scroll={{ x: 1220, y: 'max(240px, calc(100vh - 390px))' }}
              pagination={{ pageSize: 20, showSizeChanger: false, size: 'small' }}
              locale={{
                emptyText: (
                  <Empty
                    description="暂无训练记录：训练模式下清仓某只股票后，会自动把本轮交易归档到这里"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                ),
              }}
              expandable={{
                // 逐日明细：买入日 ~ 卖出日的涨跌幅 / 短线评分 / RSI / 均线 / 复盘记录
                expandedRowRender: (r: Train.StockTradeRecord) => <TrainRecordDetail record={r} />,
              }}
            />
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane tab="归因分析" key="attribution">
          <div className={styles.attrWrap}>
            {attribution.byStock.length > 0 && (
              <>
                <div className={styles.attrTitle}>个股盈亏</div>
                <Table
                  className={styles.table}
                  size="small"
                  rowKey={(r: Train.StockAttribution) => r.secid || 'all'}
                  dataSource={attribution.byStock}
                  columns={stockAttrColumns}
                  pagination={false}
                  scroll={{ x: 620 }}
                />
              </>
            )}
            {attribution.byHolding.some((b) => b.count > 0) && (
              <>
                <div className={styles.attrTitle}>持仓周期</div>
                <Table
                  className={styles.table}
                  size="small"
                  rowKey="label"
                  dataSource={attribution.byHolding.filter((b) => b.count > 0)}
                  columns={holdingAttrColumns}
                  pagination={false}
                  scroll={{ x: 520 }}
                />
              </>
            )}
            {attribution.byMonth.length > 0 && (
              <>
                <div className={styles.attrTitle}>月度盈亏</div>
                <Table
                  className={styles.table}
                  size="small"
                  rowKey="month"
                  dataSource={attribution.byMonth}
                  columns={monthAttrColumns}
                  pagination={false}
                  scroll={{ x: 410 }}
                />
              </>
            )}
            {!attribution.byStock.length && !attribution.byMonth.length && (
              <Empty
                description="暂无归因数据：清仓归档后这里会汇总个股 / 持仓周期 / 月度的盈亏归因"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )}
          </div>
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
});

export default TrainRecord;
