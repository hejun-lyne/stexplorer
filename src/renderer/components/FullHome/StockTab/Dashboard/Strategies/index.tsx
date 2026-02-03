import React from 'react';
import GridLayout from 'react-grid-layout';
import RelayOnPhaseTwo from './RelayOnPhaseTwo';
import styles from '../index.scss';
import { KLineType, StrategyType, StrategyTypeNames } from '@/utils/enums';
import { useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import classnames from 'classnames';
import { List } from 'antd';
import MonitorRow from '../MonitorRow';
import { Stock } from '@/types/stock';
import { rmSync } from 'original-fs';

export interface StrategiesProps {
  onOpenStock: (secid: string, name: string, change?: number) => void;
}

// 策略，
interface SPanelProps {
  type: StrategyType;
  onOpenStock: (secid: string, name: string, change?: number) => void;
}

const SPanel: React.FC<SPanelProps> = React.memo(({ type, onOpenStock }) => {
  const configs = useSelector((state: StoreState) => state.stock.stockConfigs.filter((c) => c.strategy === type));
  const stocks = useSelector((state: StoreState) =>
    Object.values(state.stock.stocksMapping).filter((s) => configs.find((c) => c.secid == s.detail.secid))
  );
  const groups = configs.reduce((rv: any[], c) => {
    const v = c.hybk ? c.hybk.name : 'undefined';
    (rv[v] = rv[v] || []).push(c);
    return rv;
  }, []);
  const sortedStock = Object.values(groups).reduce((rs: any[], cs: Stock.SettingItem[]) => {
    const arr = stocks.filter((s) => cs.find((c) => c.secid === s.detail.secid));
    arr.sort((a, b) => (a.detail.zdf > b.detail.zdf ? -1 : 1));
    return rs.concat(arr);
  }, []);
  return (
    <div className={styles.panel}>
      <div className={classnames(styles.header, 'draggableHeader')}>
        <div className={styles.title}>{StrategyTypeNames[type]}</div>
      </div>
      <div className={styles.content} style={{ height: 'calc(100% - 30px)' }}>
        <List
          size="small"
          bordered={false}
          split={false}
          dataSource={sortedStock.map((s) => s.detail.secid)}
          renderItem={(item, i) => (
            <List.Item key={i} style={{ padding: 0 }}>
              <MonitorRow secid={item} types={[KLineType.Trend, KLineType.Day]} openDetail={onOpenStock} />
            </List.Item>
          )}
        />
      </div>
    </div>
  );
});
const Stragegies: React.FC<StrategiesProps> = React.memo(({ onOpenStock }) => {
  return (
    <GridLayout
      className="layout"
      cols={8}
      rowHeight={30}
      width={1200}
      margin={[10, 10]}
      resizeHandles={['se']}
      draggableHandle={'.draggableHeader'}
    >
      <div
        key="jl"
        data-grid={{
          x: 0,
          y: 0,
          w: 2,
          h: 6,
        }}
      >
        <SPanel type={StrategyType.PTTP} onOpenStock={onOpenStock} />
      </div>
      <div
        key="db"
        data-grid={{
          x: 2,
          y: 0,
          w: 2,
          h: 6,
        }}
      >
        <SPanel type={StrategyType.QSJL} onOpenStock={onOpenStock} />
      </div>
      <div
        key="qs"
        data-grid={{
          x: 4,
          y: 0,
          w: 2,
          h: 6,
        }}
      >
        <SPanel type={StrategyType.CDFT} onOpenStock={onOpenStock} />
      </div>
    </GridLayout>
  );
});
export default Stragegies;
