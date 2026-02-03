import React from 'react';
import styles from '../index.scss';
import { useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { List } from 'antd';
import MonitorRow from '../MonitorRow';
import { KLineType } from '@/utils/enums';
import classnames from 'classnames';

export interface ConcernMonitorProps {
  onOpenStock: (secid: string, name: string, change?: number) => void;
}

/// 可以选择不同的均线，不同的K线
const ConcernMonitor: React.FC<ConcernMonitorProps> = React.memo(({ onOpenStock }) => {
  const concerns = useSelector((state: StoreState) => state.stock.stockConfigs.filter((s) => s.onConcerned));

  return (
    <div className={styles.panel}>
      <div className={classnames(styles.header, 'draggableHeader')}>
        <div className={styles.title}>特别关注</div>
      </div>
      <div className={styles.content}>
        <List
          size="small"
          bordered={false}
          split={false}
          dataSource={concerns || []}
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
export default ConcernMonitor;
