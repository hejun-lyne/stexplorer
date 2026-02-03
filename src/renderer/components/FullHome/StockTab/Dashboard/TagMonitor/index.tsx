import React from 'react';
import styles from '../index.scss';
import { useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { Button, List } from 'antd';
import { KLineType } from '@/utils/enums';
import MonitorRow from '../MonitorRow';
import { Stock } from '@/types/stock';
import classnames from 'classnames';
import * as Utils from '@/utils';
import { CloseOutlined } from '@ant-design/icons';

export interface TagMonitorProps {
  monitor: System.MonitorItem;
  onOpenStock: (secid: string, name: string, change?: number) => void;
  onRemoveMonitor: (monitor: System.MonitorItem) => void;
}

const TagMonitor: React.FC<TagMonitorProps> = React.memo(({ monitor, onOpenStock, onRemoveMonitor }) => {
  const { stockConfigs, stocksMapping } = useSelector((state: StoreState) => state.stock);
  const configs = stockConfigs.filter((_) => _.tags && _.tags.includes(monitor.tag));
  const bk = stockConfigs.find((_) => _.secid === monitor.bk);
  const stocks = configs.map((_) => stocksMapping[_.secid]).filter(Utils.NotEmpty);
  const upCount = stocks.filter((_) => _.detail.zdf > 0).length;
  const downCount = stocks.filter((_) => _.detail.zdf < 0).length;
  return (
    <div className={styles.panel}>
      <div className={classnames(styles.header, 'draggableHeader')}>
        <div className={styles.title}>
          <span>{monitor.tag}({monitor.bk})</span>
          <Button type={'text'} icon={<CloseOutlined />} onClick={() => onRemoveMonitor(monitor)}></Button>
        </div>
        <div className={styles.extra}>
          {monitor.bk && stocksMapping[monitor.bk] && (
            <div>
              <span className={Utils.GetValueColor(stocksMapping[monitor.bk].detail.zdf).textClass} style={{ marginRight: 5 }}>
                {stocksMapping[monitor.bk].detail.zx}
              </span>
              <span className={Utils.GetValueColor(stocksMapping[monitor.bk].detail.zdf).textClass} style={{ marginRight: 5 }}>
                {Utils.Yang(stocksMapping[monitor.bk].detail.zdf)} %
              </span>
            </div>
          )}
          <div>
            <span className="text-up" style={{ marginRight: 5 }}>
              上涨 {upCount}
            </span>
            <span className="text-down" style={{ marginRight: 5 }}>
              下跌 {downCount}
            </span>
          </div>
        </div>
      </div>
      <div className={styles.content} style={{ height: 'calc(100% - 55px)' }}>
        <List
          size="small"
          bordered={false}
          split={false}
          dataSource={configs.map((_) => _.secid)}
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
export default TagMonitor;
