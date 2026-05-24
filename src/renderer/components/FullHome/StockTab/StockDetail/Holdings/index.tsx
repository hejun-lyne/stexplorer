import React, { useState, useMemo } from 'react';
import classnames from 'classnames';
import * as Utils from '@/utils';
import styles from './index.scss';
import { InputNumber, Button, Input, Row, Col, Tag } from 'antd';
import { useDispatch, useSelector } from 'react-redux';
import { appendTrade, removeTrade } from '@/actions/stock';
import { StoreState } from '@/reducers/types';
import { Stock } from '@/types/stock';
import moment from 'moment';

export interface HoldingsProps {
  secid: string;
}

const Holdings: React.FC<HoldingsProps> = React.memo(({ secid }) => {
  const dispatch = useDispatch();
  const nowHolds = useSelector((state: StoreState) => state.stock.nowHolds);
  const tradingsMapping = useSelector((state: StoreState) => state.stock.tradingsMapping);
  const stocksMapping = useSelector((state: StoreState) => state.stock.stocksMapping);
  const config = useSelector((state: StoreState) => state.stock.stockConfigsMapping[secid]);

  const stockName = config?.name || stocksMapping[secid]?.detail?.name || '';
  const zx = stocksMapping[secid]?.detail?.zx ?? NaN;

  const hold = useMemo(() => {
    return nowHolds.find((h) => h.secid === secid);
  }, [nowHolds, secid]);

  const trades = useMemo(() => {
    const list = tradingsMapping[secid] || [];
    return [...list].sort((a, b) => b.id - a.id);
  }, [tradingsMapping, secid]);

  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState<number | null>(null);
  const [count, setCount] = useState<number | null>(100);
  const [explain, setExplain] = useState('');

  const handleSubmit = () => {
    if (!price || !count || price <= 0 || count <= 0) return;
    const trade: Stock.DoTradeItem = {
      id: 0,
      type: tradeType,
      secid,
      name: stockName,
      price: parseFloat('' + price),
      count: parseInt('' + count),
      time: moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
      stoplossAt: 0,
      latestNewsAs: 'positive',
      explain,
      profits: [0, 0, 0, 0, 0],
    };
    dispatch(appendTrade(trade));
    setPrice(null);
    setCount(100);
    setExplain('');
  };

  const handleRemove = (id: number) => {
    dispatch(removeTrade(id));
  };

  const holdPrice = hold ? Number(hold.price) : 0;
  const holdCount = hold ? Number(hold.count) : 0;
  const holdAmount = holdPrice * holdCount;
  const holdProfit = !isNaN(zx) && hold ? (zx - holdPrice) * holdCount : 0;
  const holdProfitRatio = holdPrice > 0 ? ((zx - holdPrice) / holdPrice) * 100 : 0;

  return (
    <div className={styles.container}>
        {/* 当前持仓 */}
        {hold && (
          <>
            <Row style={{ marginBottom: 10, fontWeight: 'bold', color: 'var(--main-text-color)' }}>
              <Col span={24}>当前持仓</Col>
            </Row>
            <Row style={{ marginBottom: 10, color: 'var(--main-text-color)' }}>
              <Col span={6}>成本价: {holdPrice.toFixed(2)}</Col>
              <Col span={6}>持仓数量: {holdCount}</Col>
              <Col span={6}>持仓金额: {holdAmount.toFixed(2)}</Col>
              <Col span={6}>
                最新价: {' '}
                <span className={Utils.GetValueColor(zx - holdPrice).textClass}>
                  {!isNaN(zx) ? zx.toFixed(2) : '--'}
                </span>
              </Col>
            </Row>
            <Row style={{ marginBottom: 15, color: 'var(--main-text-color)' }}>
              <Col span={12}>
                盈亏: {' '}
                <span className={Utils.GetValueColor(holdProfit).textClass}>
                  {!isNaN(zx)
                    ? `${holdProfit >= 0 ? '+' : ''}${holdProfit.toFixed(2)} (${holdProfitRatio >= 0 ? '+' : ''}${holdProfitRatio.toFixed(2)}%)`
                    : '--'}
                </span>
              </Col>
              <Col span={12}>买入日期: {hold.lastBuyDate.substring(0, 10)}</Col>
            </Row>
            <div className={styles.seperator} style={{ marginBottom: 15 }} />
          </>
        )}

        {/* 买入/卖出操作 */}
        <Row style={{ marginBottom: 10, fontWeight: 'bold', color: 'var(--main-text-color)' }}>
          <Col span={24}>交易操作</Col>
        </Row>
        <Row gutter={10} style={{ marginBottom: 10 }}>
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
        </Row>
        <Row gutter={10} style={{ marginBottom: 10 }} align="middle">
          <Col span={5}>
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
          <Col span={5}>
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
          <Col span={10}>
            <Input
              placeholder="操作理由（可选）"
              value={explain}
              onChange={(e) => setExplain(e.target.value)}
              size="small"
            />
          </Col>
          <Col span={4}>
            <Button type="primary" size="small" block onClick={handleSubmit}>
              确认{tradeType === 'buy' ? '买入' : '卖出'}
            </Button>
          </Col>
        </Row>
        <div className={styles.seperator} style={{ marginBottom: 15 }} />

        {/* 交易记录 */}
        <Row style={{ marginBottom: 10, fontWeight: 'bold', color: 'var(--main-text-color)' }}>
          <Col span={24}>交易记录 ({trades.length})</Col>
        </Row>
        <div className={styles.header} style={{ padding: '5px 0' }}>
          <span className={styles.a}>时间</span>
          <span className={styles.b}>类型</span>
          <span className={styles.b}>价格</span>
          <span className={styles.b}>数量</span>
          <span className={styles.a}>理由</span>
          <span className={styles.c}>操作</span>
        </div>
        {trades.map((item) => (
          <div key={item.id} className={styles.row} style={{ padding: '5px 0' }}>
            <span className={styles.a}>{item.time}</span>
            <span className={styles.b}>
              <Tag color={item.type === 'buy' ? 'green' : 'red'}>
                {item.type === 'buy' ? '买入' : '卖出'}
              </Tag>
            </span>
            <span className={styles.b}>{Number(item.price).toFixed(2)}</span>
            <span className={styles.b}>{Number(item.count)}</span>
            <span className={classnames(styles.a, 'ellipsis')} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.explain || '--'}
            </span>
            <span className={styles.c}>
              <Button size="small" type="text" danger onClick={() => handleRemove(item.id)} className={styles.act}>
                删除
              </Button>
            </span>
          </div>
        ))}
    </div>
  );
});
export default Holdings;
