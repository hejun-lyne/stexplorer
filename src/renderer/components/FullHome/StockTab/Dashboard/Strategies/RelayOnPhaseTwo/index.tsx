import React from 'react';
import styles from '../index.scss';
import { useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { List } from 'antd';
import { KLineType, StrategyType } from '@/utils/enums';
import MonitorRow from '../../MonitorRow';
import classnames from 'classnames';

export interface RelayOnPhaseTwoProps {
  onOpenStock: (secid: string, name: string, change?: number) => void;
}

// 策略，
const RelayOnPhaseTwo: React.FC<RelayOnPhaseTwoProps> = React.memo(({ onOpenStock }) => {
  const configs = useSelector((state: StoreState) => state.stock.stockConfigs.filter((c) => c.strategy === StrategyType.JL));
  return (
    <div className={styles.panel}>
      <div className={classnames(styles.header, 'draggableHeader')}>
        <div className={styles.title}>上升中继接力</div>
      </div>
      <div className={styles.content} style={{ height: 'calc(100% - 60px)' }}>
        <List
          size="small"
          bordered={false}
          split={false}
          dataSource={configs}
          renderItem={(item, i) => (
            <List.Item key={i} style={{ padding: 0 }}>
              <MonitorRow secid={item.secid} types={[KLineType.Trend, KLineType.Day]} openDetail={onOpenStock} />
            </List.Item>
          )}
        />
      </div>
    </div>
  );
});
export default RelayOnPhaseTwo;
