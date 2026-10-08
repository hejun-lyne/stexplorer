import React, { useState, useMemo } from 'react';
import classnames from 'classnames';
import * as Utils from '@/utils';
import styles from './index.scss';
import { InputNumber, Button, Row, Col, Tag } from 'antd';
import { useDispatch, useSelector } from 'react-redux';
import { appendTrade, removeTrade } from '@/actions/stock';
import { StoreState } from '@/reducers/types';
import { Stock } from '@/types/stock';
import moment from 'moment';

export interface HoldingsProps {
  secid: string;
  onOpenStock?: (secid: string, name: string) => void;
}

const Holdings: React.FC<HoldingsProps> = React.memo(({ secid, onOpenStock }) => {
  const dispatch = useDispatch();
  const nowHolds = useSelector((state: StoreState) => state.stock.nowHolds);
  const allTradings = useSelector((state: StoreState) => state.stock.tradings);
  const stocksMapping = useSelector((state: StoreState) => state.stock.stocksMapping);
  const config = useSelector((state: StoreState) => state.stock.stockConfigsMapping[secid]);

  const stockName = config?.name || stocksMapping[secid]?.detail?.name || '';

  const hold = useMemo(() => {
    return nowHolds.find((h) => h.secid === secid);
  }, [nowHolds, secid]);

  // 全部股票的交易记录（用于列表展示）
  const allTrades = useMemo(() => {
    return [...allTradings].sort((a, b) => b.id - a.id);
  }, [allTradings]);

  // ===== 交易表单 =====
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState<number | null>(null);
  const [count, setCount] = useState<number | null>(100);

  const handleSubmit = () => {
    if (!price || !count || price <= 0 || count <= 0) return;
    // 卖出时检查持仓，避免超卖
    if (tradeType === 'sell' && hold && count > Number(hold.count)) {
      return;
    }

    const trade: Stock.DoTradeItem = {
      id: 0,
      type: tradeType,
      secid,
      name: stockName,
      price: parseFloat('' + price),
      count,
      time: moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
      stoplossAt: 0,
      latestNewsAs: 'positive',
      explain: '',
      profits: [0, 0, 0, 0, 0],
    };
    dispatch(appendTrade(trade));

    setPrice(null);
    setCount(100);
  };

  const handleRemove = (id: number) => {
    dispatch(removeTrade(id));
  };

  // ===== 卖出收益（FIFO 配对买入成本计算） =====
  const sellProfits = useMemo(() => {
    const tradesByStock: Record<string, Stock.DoTradeItem[]> = {};
    [...allTradings].sort((a, b) => a.id - b.id).forEach((t) => {
      if (!tradesByStock[t.secid]) tradesByStock[t.secid] = [];
      tradesByStock[t.secid].push(t);
    });

    const map: Record<number, { profit: number; profitRatio: number; matched: number }> = {};

    Object.values(tradesByStock).forEach((stockTrades) => {
      const buyStack: Stock.DoTradeItem[] = [];
      stockTrades.forEach((t) => {
        if (t.type === 'buy') {
          buyStack.push({ ...t }); // 浅拷贝避免修改原数据
        } else if (t.type === 'sell') {
          let remaining = Number(t.count);
          let cost = 0;
          let matched = 0;
          while (remaining > 0 && buyStack.length > 0) {
            const buy = buyStack[buyStack.length - 1];
            const matchedCount = Math.min(remaining, Number(buy.count));
            cost += buy.price * matchedCount;
            matched += matchedCount;
            remaining -= matchedCount;
            buy.count -= matchedCount;
            if (buy.count <= 0) buyStack.pop();
          }
          const profit = t.price * matched - cost;
          const profitRatio = cost > 0 ? (profit / cost) * 100 : 0;
          map[t.id] = { profit, profitRatio, matched };
        }
      });
    });

    return map;
  }, [allTradings]);

  return (
    <div className={styles.container}>
      {/* 全部持仓 */}
      {nowHolds.length > 0 && (
        <>
          <Row style={{ marginBottom: 10, fontWeight: 'bold', color: 'var(--main-text-color)' }}>
            <Col span={24}>全部持仓 ({nowHolds.length})</Col>
          </Row>
          <div className={styles.header} style={{ padding: '5px 0', marginBottom: 5 }}>
            <span className={styles.b}>股票</span>
            <span className={styles.b}>成本价</span>
            <span className={styles.b}>数量</span>
            <span className={styles.b}>最新价</span>
            <span className={styles.b}>盈亏</span>
          </div>
          {nowHolds.map((h) => {
            const hPrice = Number(h.price);
            const hCount = Number(h.count);
            const zxVal = stocksMapping[h.secid]?.detail?.zx ?? NaN;
            const zxDisplay = !isNaN(zxVal) ? zxVal : 0;
            const profit = !isNaN(zxVal) ? (zxDisplay - hPrice) * hCount : 0;
            const profitRatio = hPrice > 0 ? ((zxDisplay - hPrice) / hPrice) * 100 : 0;
            const name = stocksMapping[h.secid]?.detail?.name || h.name || h.secid;
            const isCurrent = h.secid === secid;
            return (
              <div
                key={h.secid}
                className={styles.row}
                style={{
                  padding: '6px 0',
                  borderBottom: '1px solid var(--border-color)',
                  backgroundColor: isCurrent ? 'var(--card-background-color)' : undefined,
                }}
              >
                <span
                  className={classnames(styles.b, styles.stockName)}
                  style={{ fontWeight: isCurrent ? 'bold' : 'normal' }}
                  onClick={() => onOpenStock?.(h.secid, name)}
                >
                  {name}
                </span>
                <span className={styles.b}>{hPrice.toFixed(2)}</span>
                <span className={styles.b}>{hCount}</span>
                <span className={classnames(styles.b, Utils.GetValueColor(zxDisplay - hPrice).textClass)}>
                  {!isNaN(zxVal) ? zxDisplay.toFixed(2) : '--'}
                </span>
                <span className={classnames(styles.b, Utils.GetValueColor(profit).textClass)}>
                  {!isNaN(zxVal)
                    ? `${profit >= 0 ? '+' : ''}${profit.toFixed(0)} (${profitRatio >= 0 ? '+' : ''}${profitRatio.toFixed(1)}%)`
                    : '--'}
                </span>
              </div>
            );
          })}
          <div className={styles.seperator} style={{ marginBottom: 15 }} />
        </>
      )}

      {/* 买入/卖出操作 */}
      <Row style={{ marginBottom: 10, fontWeight: 'bold', color: 'var(--main-text-color)' }}>
        <Col span={24}>交易操作</Col>
      </Row>
      <Row gutter={10} style={{ marginBottom: 10 }} align="middle">
        <Col span={4}>
          <Button
            type={tradeType === 'buy' ? 'primary' : 'default'}
            block
            size="small"
            onClick={() => setTradeType('buy')}
          >
            买入
          </Button>
        </Col>
        <Col span={4}>
          <Button
            type={tradeType === 'sell' ? 'primary' : 'default'}
            block
            size="small"
            danger={tradeType === 'sell'}
            onClick={() => setTradeType('sell')}
          >
            卖出
          </Button>
        </Col>
        <Col span={6}>
          <InputNumber
            style={{ width: '100%' }}
            placeholder="价格"
            value={price}
            onChange={setPrice}
            step={0.01}
            min={0}
            size="small"
          />
        </Col>
        <Col span={6}>
          <InputNumber
            style={{ width: '100%' }}
            placeholder="数量"
            value={count}
            onChange={setCount}
            step={100}
            min={100}
            size="small"
          />
        </Col>
        <Col span={4}>
          <Button
            type="primary"
            size="small"
            block
            onClick={handleSubmit}
            disabled={
              !price || !count || price <= 0 || count <= 0 ||
              (tradeType === 'sell' && !!hold && count > Number(hold.count))
            }
          >
            确认{tradeType === 'buy' ? '买入' : '卖出'}
          </Button>
        </Col>
      </Row>
      <div className={styles.seperator} style={{ marginBottom: 15 }} />

      {/* 交易记录（全部股票） */}
      <Row style={{ marginBottom: 10, fontWeight: 'bold', color: 'var(--main-text-color)' }}>
        <Col span={24}>全部交易记录 ({allTrades.length})</Col>
      </Row>
      <div className={styles.header} style={{ padding: '5px 0' }}>
        <span className={styles.b}>时间</span>
        <span className={styles.b}>股票</span>
        <span className={styles.b}>类型</span>
        <span className={styles.b}>价格</span>
        <span className={styles.b}>数量</span>
        <span className={styles.b}>收益</span>
        <span className={styles.c}>操作</span>
      </div>
      {allTrades.map((item) => {
        const tradeStockName = stocksMapping[item.secid]?.detail?.name || item.name || item.secid;
        const isCurrent = item.secid === secid;
        const sellInfo = item.type === 'sell' && sellProfits[item.id] && sellProfits[item.id].matched > 0
          ? sellProfits[item.id]
          : undefined;
        return (
          <div
            key={item.id}
            className={styles.row}
            style={{
              padding: '5px 0',
              backgroundColor: isCurrent ? 'var(--card-background-color)' : undefined,
            }}
          >
            <span className={styles.b} style={{ fontSize: 12 }}>{item.time}</span>
            <span
              className={classnames(styles.b, styles.stockName)}
              style={{ fontWeight: isCurrent ? 'bold' : 'normal', fontSize: 12 }}
              onClick={() => onOpenStock?.(item.secid, tradeStockName)}
            >
              {tradeStockName}
            </span>
            <span className={styles.b}>
              <Tag color={item.type === 'buy' ? 'green' : 'red'}>
                {item.type === 'buy' ? '买入' : '卖出'}
              </Tag>
            </span>
            <span className={styles.b}>{Number(item.price).toFixed(2)}</span>
            <span className={styles.b}>{Number(item.count)}</span>
            <span className={classnames(styles.b, sellInfo ? Utils.GetValueColor(sellInfo.profit).textClass : '')}>
              {sellInfo
                ? `${sellInfo.profit >= 0 ? '+' : ''}${sellInfo.profit.toFixed(0)} (${sellInfo.profitRatio >= 0 ? '+' : ''}${sellInfo.profitRatio.toFixed(1)}%)`
                : '--'}
            </span>
            <span className={styles.c}>
              <Button size="small" type="text" danger onClick={() => handleRemove(item.id)} className={styles.act}>
                删除
              </Button>
            </span>
          </div>
        );
      })}
    </div>
  );
});
export default Holdings;
