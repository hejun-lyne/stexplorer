import React, { useEffect, useMemo, useState } from 'react';
import { Empty, Spin, Table, Tooltip } from 'antd';
import { Stock } from '@/types/stock';
import * as Services from '@/services';
import * as Enums from '@/utils/enums';
import { GetStockCode } from '@/helpers/stock';
import { calculateMA, calculateRSI } from '@/helpers/tech';
import { loadScoreSeries, pickScoreRow, SHORT_SCORE_SOURCE } from '@/helpers/shortTermScoreList';
import { ReadReviewRecords } from '@/helpers/trainReview';
import styles from './index.scss';

/** 日线缓存（指标只与K线有关，复盘/评分每次展开都重新读） */
const klineCache = new Map<string, Stock.KLineItem[]>();

/** 逐日明细行 */
interface DayRow {
  date: string;
  close: number;
  zdf: number;
  /** 相对本轮持仓成本价的累计涨跌幅 */
  sinceBuy: number;
  score: number | null;
  rsi6: number | null;
  rsi12: number | null;
  rsi24: number | null;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
  /** 当天是否买入 / 卖出 */
  buys: { time?: string; price: number; amount?: number; reason?: string }[];
  sell?: { time?: string; price: number; reason?: string };
  notes: { time: string; text: string; kind: 'buy' | 'sell' | 'review' }[];
}

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

function fmt(v: number | null, digits = 2) {
  return v == null ? '--' : v.toFixed(digits);
}

/**
 * 训练记录逐日明细
 *
 * 展开一条「建仓 → 清仓」记录时，按买入日 ~ 卖出日逐日列出：
 * 收盘价、涨跌幅、短线评分、RSI(6/12/24)、均线(5/10/20/60)，以及当天的复盘/买卖理由。
 *
 * 指标口径：
 * - 均线 / RSI 用「取回的全部日线」计算，再按区间截取，保证买入日之前有足够预热数据；
 * - 短线评分直接读 Tushare 评分序列（与短线评分列表同一份缓存），没有当日行就显示 --。
 */
const TrainRecordDetail: React.FC<{ record: Train.StockTradeRecord }> = ({ record }) => {
  const { secid, buyDate, sellDate } = record;
  const code = useMemo(() => GetStockCode(secid), [secid]);
  const [loading, setLoading] = useState(true);
  const [bars, setBars] = useState<Stock.KLineItem[]>([]);
  const [scoreSeries, setScoreSeries] = useState<Record<string, any>>({});

  const cacheKey = `${secid}_${buyDate}_${record.sellDate}_${record.buyTime || ''}_${record.sellTime || ''}`;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        let ks = klineCache.get(cacheKey);
        if (!ks) {
          // 多取一些用于 MA60 / RSI 预热：记录可能已经归档很久，limit 太小会取不到买入日之前的数据
          const res = await Services.Stock.GetKFromSetting(secid, Enums.KLineType.Day, 900);
          ks = ((res && res.ks) || []).filter((k) => Number(k.sp) > 0);
          klineCache.set(cacheKey, ks);
        }
        if (cancelled) {
          return;
        }
        setBars(ks);

        const dates = ks
          .map((k) => String(k.date).substring(0, 10))
          .filter((d) => d >= buyDate && d <= sellDate)
          .map((d) => d.replace(/-/g, ''));
        const series = await loadScoreSeries([code], SHORT_SCORE_SOURCE, { dates });
        if (!cancelled) {
          setScoreSeries(series?.[code] || {});
        }
      } catch (e) {
        console.log('加载训练记录逐日明细失败', e);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, secid, code, buyDate, sellDate]);

  /** 复盘记录（按日期归并到逐日明细里） */
  const reviews = useMemo(() => ReadReviewRecords(secid), [secid]);

  const rows = useMemo<DayRow[]>(() => {
    if (!bars.length) {
      return [];
    }
    const closes = bars.map((k) => Number(k.sp));
    const ma5 = calculateMA(closes, 5);
    const ma10 = calculateMA(closes, 10);
    const ma20 = calculateMA(closes, 20);
    const ma60 = calculateMA(closes, 60);
    const rsi6 = calculateRSI(closes, 6);
    const rsi12 = calculateRSI(closes, 12);
    const rsi24 = calculateRSI(closes, 24);

    return bars
      .map((k, i) => {
        const date = String(k.date).substring(0, 10);
        const hits = (record.buys || []).filter((b) => b.date === date);
        const sell = date === sellDate ? { time: record.sellTime, price: record.sellPrice, reason: record.reason } : undefined;
        const dayReviews = reviews.filter((r) => r.date === date);
        const notes: DayRow['notes'] = [
          ...hits.map((b) => ({
            time: b.time || '',
            text: b.reason || '',
            kind: 'buy' as const,
          })),
          ...(sell ? [{ time: sell.time || '', text: sell.reason || '', kind: 'sell' as const }] : []),
          ...dayReviews.map((r) => ({ time: r.time || '', text: r.reason || '', kind: 'review' as const })),
        ].filter((n) => !!n.text || n.kind !== 'review');

        const scoreHit = pickScoreRow(scoreSeries, date);
        return {
          date,
          close: closes[i],
          zdf: Number(k.zdf) || 0,
          sinceBuy: Number(record.buyPrice) > 0 ? (closes[i] / Number(record.buyPrice) - 1) * 100 : 0,
          score: scoreHit && scoreHit.row.total != null ? Number(scoreHit.row.total) : null,
          // 预热期 FasterRSI 返回 0，按 -- 处理（真正的 RSI=0 几乎不会出现）
          rsi6: i >= 6 ? Number(rsi6[i]) : null,
          rsi12: i >= 12 ? Number(rsi12[i]) : null,
          rsi24: i >= 24 ? Number(rsi24[i]) : null,
          ma5: num(ma5[i]),
          ma10: num(ma10[i]),
          ma20: num(ma20[i]),
          ma60: num(ma60[i]),
          buys: hits,
          sell,
          notes,
        };
      })
      .filter((r) => r.date >= buyDate && r.date <= sellDate);
  }, [
    bars,
    buyDate,
    sellDate,
    scoreSeries,
    reviews,
    record.buys,
    record.buyPrice,
    record.sellTime,
    record.sellPrice,
    record.reason,
  ]);

  // 复用全局涨跌色（text-up / text-down / text-none），与列表其它数值保持一致
  const colorOf = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-none');

  const columns = [
    {
      title: '日期',
      dataIndex: 'date',
      width: 150,
      fixed: 'left' as const,
      render: (v: string, r: DayRow) => (
        <span className={styles.dayCell}>
          <span className={styles.dayText}>{v}</span>
          {r.buys.length > 0 && (
            <span className={`${styles.chip} ${styles.chipBuy}`}>
              买{r.buys[0].time ? ` ${r.buys[0].time}` : ''}
            </span>
          )}
          {r.sell && (
            <span className={`${styles.chip} ${styles.chipSell}`}>
              卖{r.sell.time ? ` ${r.sell.time}` : ''}
            </span>
          )}
        </span>
      ),
    },
    {
      title: '收盘',
      dataIndex: 'close',
      width: 72,
      align: 'right' as const,
      render: (v: number) => (Number(v) > 0 ? Number(v).toFixed(2) : '--'),
    },
    {
      title: '涨跌幅',
      dataIndex: 'zdf',
      width: 78,
      align: 'right' as const,
      render: (v: number) => <span className={colorOf(v)}>{`${v > 0 ? '+' : ''}${(Number(v) || 0).toFixed(2)}%`}</span>,
    },
    {
      title: '较买入',
      dataIndex: 'sinceBuy',
      width: 82,
      align: 'right' as const,
      render: (v: number) => (
        <span className={colorOf(v)}>{`${v > 0 ? '+' : ''}${(Number(v) || 0).toFixed(2)}%`}</span>
      ),
    },
    {
      title: '短线评分',
      dataIndex: 'score',
      width: 82,
      align: 'right' as const,
      render: (v: number | null) => (v == null ? '--' : <b>{v.toFixed(1)}</b>),
    },
    {
      title: 'RSI',
      align: 'center' as const,
      children: [
        { title: '6', dataIndex: 'rsi6', width: 62, align: 'right' as const, render: (v: number | null) => fmt(v) },
        { title: '12', dataIndex: 'rsi12', width: 62, align: 'right' as const, render: (v: number | null) => fmt(v) },
        { title: '24', dataIndex: 'rsi24', width: 62, align: 'right' as const, render: (v: number | null) => fmt(v) },
      ],
    },
    {
      title: '均线',
      align: 'center' as const,
      children: [
        { title: '5', dataIndex: 'ma5', width: 62, align: 'right' as const, render: (v: number | null) => fmt(v) },
        { title: '10', dataIndex: 'ma10', width: 66, align: 'right' as const, render: (v: number | null) => fmt(v) },
        { title: '20', dataIndex: 'ma20', width: 66, align: 'right' as const, render: (v: number | null) => fmt(v) },
        { title: '60', dataIndex: 'ma60', width: 66, align: 'right' as const, render: (v: number | null) => fmt(v) },
      ],
    },
    {
      title: '复盘记录',
      dataIndex: 'notes',
      render: (notes: DayRow['notes']) => {
        if (!notes.length) {
          return '--';
        }
        return (
          <span className={styles.notes}>
            {notes.map((n, i) => (
              <span key={`${n.kind}_${n.time}_${i}`} className={styles.note}>
                <span
                  className={`${styles.chip} ${
                    n.kind === 'buy' ? styles.chipBuy : n.kind === 'sell' ? styles.chipSell : styles.chipReview
                  }`}
                >
                  {n.kind === 'buy' ? '买' : n.kind === 'sell' ? '卖' : '复盘'}
                  {n.time ? ` ${n.time}` : ''}
                </span>
                {n.text ? (
                  <Tooltip title={n.text}>
                    <span className={styles.noteText}>{n.text}</span>
                  </Tooltip>
                ) : null}
              </span>
            ))}
          </span>
        );
      },
    },
  ];

  if (loading) {
    return (
      <div className={styles.detailLoading}>
        <Spin size="small" /> 正在加载逐日明细...
      </div>
    );
  }

  if (!rows.length) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={`没有取到 ${buyDate} ~ ${sellDate} 的日线数据`}
        className={styles.detailEmpty}
      />
    );
  }

  return (
    <div className={styles.detailWrap}>
      <div className={styles.detailHead}>
        <span className={styles.detailTitle}>逐日明细</span>
        <span className={styles.detailRange}>
          <b>{buyDate}</b>
          {record.buyTime ? ` ${record.buyTime}` : ''}
          <span className={styles.arrow}>→</span>
          <b>{sellDate}</b>
          {record.sellTime ? ` ${record.sellTime}` : ''}
        </span>
        <span className={styles.detailCount}>{rows.length} 个交易日</span>
      </div>
      <div className={styles.detailBuys}>
        <span className={styles.buysLabel}>买入明细</span>
        {(record.buys || []).length ? (
          (record.buys || []).map((b, i) => (
            <span key={`${b.date}_${i}`} className={`${styles.chip} ${styles.chipBuy}`}>
              {b.date}
              {b.time ? ` ${b.time}` : ''} · {Number(b.price).toFixed(2)}
              {b.amount ? ` · ¥${Math.round(Number(b.amount)).toLocaleString('zh-CN')}` : ''}
            </span>
          ))
        ) : (
          <span className={styles.detailEmptyText}>--</span>
        )}
        <span className={styles.detailCost}>
          持仓成本 ¥{Math.round(Number(record.buyPrice * record.count) || 0).toLocaleString('zh-CN')}
          <span className={styles.dot}>·</span>
          卖出佣金 ¥{Math.round(Number(record.commission) || 0).toLocaleString('zh-CN')}
        </span>
      </div>
      <Table
        className={styles.detailTable}
        size="small"
        rowKey="date"
        dataSource={rows}
        columns={columns}
        pagination={false}
        tableLayout="fixed"
        scroll={{ x: 1160, y: 320 }}
        rowClassName={(r: DayRow) => (r.sell ? styles.sellRow : r.buys.length ? styles.buyRow : '')}
      />
    </div>
  );
};

export default React.memo(TrainRecordDetail);
