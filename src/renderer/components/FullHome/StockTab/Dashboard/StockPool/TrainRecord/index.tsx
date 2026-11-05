import React, { useMemo } from 'react';
import { Empty, Popconfirm, Table, Tag, Tooltip } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { removeTrainTradeRecordAction, setTrainTradeRecordsAction } from '@/actions/train';
import * as Utils from '@/utils';
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
 * 重启应用后仍然保留。展开行可以看到本轮的全部买入明细（交易全过程）。
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
      { title: '买入日', dataIndex: 'buyDate', width: 100 },
      { title: '卖出日', dataIndex: 'sellDate', width: 100 },
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
      <div className={styles.tableWrap}>
        <Table
          className={styles.table}
          size="small"
          rowKey="id"
          dataSource={list}
          columns={columns}
          scroll={{ x: 1080, y: 'max(240px, calc(100vh - 340px))' }}
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
            expandedRowRender: (r: Train.StockTradeRecord) => (
              <div className={styles.buys}>
                <span className={styles.buysLabel}>本轮买入（{r.buys?.length || 0} 笔）：</span>
                {(r.buys || []).map((b, i) => (
                  <Tag key={`${b.date}_${i}`}>
                    {b.date} @ {Number(b.price).toFixed(2)}
                    {b.amount ? ` · ${formatMoney(b.amount)}` : ''}
                  </Tag>
                ))}
                {!(r.buys || []).length && <span className={styles.buysLabel}>无买入明细</span>}
                <span className={styles.buysLabel}>
                  持仓成本 {formatMoney(r.buyPrice * r.count)} ｜ 卖出佣金 {formatMoney(r.commission)}
                </span>
              </div>
            ),
          }}
        />
      </div>
    </div>
  );
});

export default TrainRecord;
