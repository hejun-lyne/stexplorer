import React, { useState } from 'react';
import { Row, Col, Tabs } from 'antd';
import styles from './index.scss';
import * as Utils from '@/utils';
import { Stock } from '@/types/stock';
import { useCallback } from 'react';
import { StrategyType, StrategyTypeNames } from '@/utils/enums';
import { useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';

export interface OnMonitorProps {
  onOpenStock: (secid: string, name: string) => void;
}

const OnMonitor: React.FC<OnMonitorProps> = ({ onOpenStock }) => {
  const stockConfigs = useSelector((state: StoreState) => state.stock.stockConfigs);
  const stocksMapping = useSelector((state: StoreState) => state.stock.stocksMapping);
  const nowHolds = useSelector((state: StoreState) => state.stock.nowHolds);
  const holds = [...nowHolds].sort((a, b) => (a.lastBuyDate > b.lastBuyDate ? -1 : 1));
  const HoldRow = useCallback((h: Stock.NowHoldItem, zx: number) => {
    return (
      <div className={styles.row}>
        <Row>
          <Col span={12}>
            <Row>
              <Col span={4}>
                <a onClick={() => onOpenStock(h.secid, h.name)}>{h.name}</a>
              </Col>
              <Col span={3} className={Utils.GetValueColor(zx - h.price).textClass}>
                {!isNaN(zx) ? zx.toFixed(2) : '--'}
              </Col>
              <Col span={5}>{h.lastBuyDate.substring(0, 10)}</Col>
              <Col span={3}>{parseFloat(h.price).toFixed(2)}</Col>
              <Col span={5}>{StrategyTypeNames[h.lastBuyStrategy]}</Col>
              <Col span={4} className={Utils.GetValueColor(zx - h.price).textClass}>
                {(((zx - h.price) / h.price) * 100).toFixed(2) + '%'}
              </Col>
            </Row>
          </Col>
          <Col span={12}>{h.lastBuyReason}</Col>
        </Row>
      </div>
    );
  }, []);

  const configs = stockConfigs.filter((c) => c.strategy != undefined && c.strategy != StrategyType.None);
  configs.sort((a, b) => {
    const ad = stocksMapping[a.secid];
    const bd = stocksMapping[b.secid];
    if (!ad || !ad.detail || !bd || !bd.detail) {
      return 0;
    }
    return ad.detail.zdf > bd.detail.zdf ? -1 : 1;
  });
  const StockRow = useCallback((c: Stock.SettingItem, d: Stock.DetailItem | undefined) => {
    if (!d) {
      return <div className={styles.row} key={c.secid}></div>;
    }
    return (
      <div className={styles.row} key={c.secid}>
        <Row>
          <Col span={13}>
            <Row>
              <Col span={3}>
                <a onClick={() => onOpenStock(c.secid, c.name)}>{c.name}</a>
              </Col>
              <Col span={3} className={Utils.GetValueColor(d.zdf).textClass}>
                {!isNaN(d.zx) ? d.zx.toFixed(2) : '--'}
              </Col>
              <Col span={3} className={Utils.GetValueColor(d.zdf).textClass}>
                {!isNaN(d.zdf) ? d.zdf.toFixed(2) + '%' : '--'}
              </Col>
              <Col span={3}>{!isNaN(d.hsl) ? d.hsl.toFixed(2) + '%' : '--'}</Col>
              <Col span={3}>{!isNaN(d.cje) ? (d.cje / 100000000).toFixed(2) + '亿' : '--'}</Col>
              <Col span={3}>{!isNaN(d.lt) ? (d.lt / 100000000).toFixed(2) + '亿' : '--'}</Col>
              <Col span={3}>{c.hybk?.name}</Col>
              <Col span={3}>{StrategyTypeNames[c.strategy || 0]}</Col>
            </Row>
          </Col>
          <Col span={11}>{c.knotes?.slice(-1)[0].text}</Col>
        </Row>
      </div>
    );
  }, []);
  const [activeKey, setActiveKey] = useState('stocks');
  return (
    <div className={styles.container}>
      <Tabs activeKey={activeKey} onChange={setActiveKey} style={{ height: '100%' }}>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>我的策略</span>} key={'stocks'}>
          <div className={styles.header}>
            <Row>
              <Col span={13}>
                <Row>
                  <Col span={3}>名字</Col>
                  <Col span={3}>最新</Col>
                  <Col span={3}>涨幅</Col>
                  <Col span={3}>换手</Col>
                  <Col span={3}>成交</Col>
                  <Col span={3}>市值</Col>
                  <Col span={3}>板块</Col>
                  <Col span={3}>策略</Col>
                </Row>
              </Col>
              <Col span={11}>复盘</Col>
            </Row>
          </div>
          <div className={styles.table}>{configs.map((c) => StockRow(c, stocksMapping[c.secid]?.detail))}</div>
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>持有股票</span>} key={'holds'}>
          <div className={styles.header}>
            <Row>
              <Col span={12}>
                <Row>
                  <Col span={4}>名字</Col>
                  <Col span={3}>最新</Col>
                  <Col span={5}>日期</Col>
                  <Col span={3}>价格</Col>
                  <Col span={5}>策略</Col>
                  <Col span={4}>盈亏</Col>
                </Row>
              </Col>
              <Col span={12}>理由</Col>
            </Row>
          </div>
          <div className={styles.table}>
            {holds.map((t) => HoldRow(t, stocksMapping[t.secid] ? stocksMapping[t.secid].detail.zx || 0 : 0))}
          </div>
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
};

export default OnMonitor;
