import React from 'react';
import { batch, useSelector } from 'react-redux';
import { Col, Row, Tabs } from 'antd';
import styles from './index.scss';
import { BKType, StrategyType, StrategyTypeNames } from '@/utils/enums';
import BKList from './BKList';
import { useCallback } from 'react';
import { useState } from 'react';
import ZTList from './ZTList';
import QSList from './QSList';
import CXList from './CXList';
import ZBList from './ZBList';
import DTList from './DTList';
import STList from './STList';
import { Stock } from '@/types/stock';
import { StoreState } from '@/reducers/types';
import * as Utils from '@/utils';
import CLList from './CLList';
import ZZList from './ZZList';
import KTrain from './KTrain';

export interface StockPoolProps {
  onOpenStock: (secid: string, name: string) => void;
}
const StockPool: React.FC<StockPoolProps> = ({ onOpenStock }) => {
  const [activeKey, setActiveKey] = useState('stocks');
  const openBK = useCallback((t: BKType, s: string) => {
    batch(() => {
      setBKType(t);
      setBKSecid(s);
      setActiveKey('stlist');
    });
  }, []);
  const [industries, setIndustries] = useState<Stock.BanKuaiItem[]>([]);
  const [gainians, setGainians] = useState<Stock.BanKuaiItem[]>([]);
  const [bktype, setBKType] = useState(BKType.Industry);
  const [bksecid, setBKSecid] = useState('');
  const updateBKs = useCallback((t: BKType, a: Stock.BanKuaiItem[]) => {
    if (t === BKType.Industry) {
      setIndustries(a);
    } else {
      setGainians(a);
    }
  }, []);
  const changeBK = useCallback((t: BKType, s: string) => {
    batch(() => {
      setBKType(t);
      setBKSecid(s);
    });
  }, []);
  const stockConfigs = useSelector((state: StoreState) => state.stock.stockConfigs);
  const stocksMapping = useSelector((state: StoreState) => state.stock.stocksMapping);
  const nowHolds = useSelector((state: StoreState) => state.stock.nowHolds);
  const holds = [...nowHolds].sort((a, b) => (a.lastBuyDate > b.lastBuyDate ? -1 : 1));
  const HoldRow = useCallback((h: Stock.NowHoldItem, zx: number) => {
    return (
      <div className={styles.row} key={h.secid}>
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
  const groups = configs.reduce((rv: any[], c) => {
    const v = c.hybk ? c.hybk.name : 'undefined';
    (rv[v] = rv[v] || []).push(c);
    return rv;
  }, []);
  const sortedConfigs = Object.values(groups).reduce((rs: any[], cs: Stock.SettingItem[]) => {
    cs.sort((a, b) => {
      const ad = stocksMapping[a.secid];
      const bd = stocksMapping[b.secid];
      if (!ad || !ad.detail || !bd || !bd.detail) {
        return 0;
      }
      return ad.detail.zdf > bd.detail.zdf ? -1 : 1;
    });
    return rs.concat(cs);
  }, []);

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
              <Col span={2} className={Utils.GetValueColor(d.zdf).textClass}>
                {!isNaN(d.zx) ? d.zx.toFixed(2) : '--'}
              </Col>
              <Col span={3} className={Utils.GetValueColor(d.zdf).textClass}>
                {!isNaN(d.zdf) ? d.zdf.toFixed(2) + '%' : '--'}
              </Col>
              <Col span={3}>{!isNaN(d.hsl) ? (d.hsl / 100).toFixed(2) + '%' : '--'}</Col>
              <Col span={3}>{!isNaN(d.cje) ? (d.cje / 100000000).toFixed(2) + '亿' : '--'}</Col>
              <Col span={3}>{!isNaN(d.lt) ? (d.lt / 100000000).toFixed(2) + '亿' : '--'}</Col>
              <Col span={4}>
                <a onClick={() => onOpenStock('90.' + c.hybk?.code, c.hybk?.name || '')}>{c.hybk?.name}</a>
              </Col>
              <Col span={3}>{StrategyTypeNames[c.strategy || 0]}</Col>
            </Row>
          </Col>
          <Col span={11}>{c.knotes?.length ? c.knotes[0].text : ''}</Col>
        </Row>
      </div>
    );
  }, []);
  return (
    <div className={styles.container}>
      <Tabs activeKey={activeKey} onChange={setActiveKey} style={{ height: '100%' }}>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>优选股票</span>} key={'stocks'}>
          <CLList onOpenStock={onOpenStock} active={activeKey === 'stocks'} />
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>K线训练</span>} key={'ktrain'}>
          <KTrain onOpenStock={onOpenStock} active={activeKey === 'ktrain'} />
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>持有股票</span>} key={'holds'}>
          <div className={styles.hint}>动态仓位管理，跟环境匹配</div>
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
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>概念板块</span>} key={'gainians'}>
          <BKList
            type={BKType.Gainian}
            onBankuaisUpdate={updateBKs}
            onOpenBKStocks={openBK}
            onOpenBK={onOpenStock}
            active={activeKey === 'gainians'}
          />
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>行业板块</span>} key={'industries'}>
          <BKList
            onBankuaisUpdate={updateBKs}
            type={BKType.Industry}
            onOpenBKStocks={openBK}
            onOpenBK={onOpenStock}
            active={activeKey === 'industries'}
          />
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>板块股票</span>} key={'stlist'}>
          <STList
            bktype={bktype}
            secid={bksecid}
            industries={industries}
            gainians={gainians}
            onChangeBK={changeBK}
            onOpenStock={onOpenStock}
            active={activeKey === 'stocks'}
          />
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>涨停股票</span>} key={'ztlist'}>
          <ZTList onOpenStock={onOpenStock} active={activeKey === 'ztlist'} industries={industries} />
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>强势股票</span>} key={'qslist'}>
          <QSList onOpenStock={onOpenStock} active={activeKey === 'qslist'} industries={industries} />
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>次新股票</span>} key={'cxlist'}>
          <CXList onOpenStock={onOpenStock} active={activeKey === 'cxlist'} industries={industries} />
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>炸板股票</span>} key={'zblist'}>
          <ZBList onOpenStock={onOpenStock} active={activeKey === 'zblist'} industries={industries} />
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>跌停股票</span>} key={'dtlist'}>
          <DTList onOpenStock={onOpenStock} active={activeKey === 'dtlist'} industries={industries} />
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
};

export default StockPool;
