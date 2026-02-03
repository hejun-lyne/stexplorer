import React, { useCallback, useRef, useState } from 'react';
import styles from './index.scss';
import MAMonitor from './MAMonitor';
import ChanMonitor from './ChanMonitor';
import ConcernMonitor from './ConcernMonitor';
import { useDispatch } from 'react-redux';
import TagMonitor from './TagMonitor';
import GridLayout from 'react-grid-layout';
import { removeTagMonitor, updateMonitorLayouts } from '@/actions/setting';
import StockPool from './StockPool';
import Stragegies from './Strategies';
import OnMonitor from './OnMonitor';
import MarketMonitor from './MarketMonitor';
import { Button } from 'antd';
import { VerticalAlignBottomOutlined, VerticalAlignTopOutlined } from '@ant-design/icons';
import { syncRemoteStocksAction } from '@/actions/stock';

export interface DashboardProps {
  settings: System.MonitorSetting;
  onOpenStock: (secid: string, name: string, change?: number) => void;
}

const Dashboard: React.FC<DashboardProps> = React.memo(({ settings, onOpenStock }) => {
  const parent = useRef<HTMLDivElement>(null);
  const dispatch = useDispatch();
  const [fullList, setFullList] = useState(false);
  const isReady = useCallback(() => {
    dispatch(syncRemoteStocksAction());
  }, []);
  return (
    <div className={styles.container} ref={parent}>
      <div style={{padding: 10, color: 'yellow'}}>{'>>>>> 问问自己做好准备了吗？<<<<<'} <Button type="primary" onClick={isReady}>准备好了</Button></div>
      <div style={{ height: fullList ? '0' : '32%', overflowY: 'auto', overflowX: 'hidden' }}>
        <MarketMonitor />
        {/* <Stragegies onOpenStock={onOpenStock} /> */}
      </div>
      {/* <div style={{ height: '28%' }}>
        <OnMonitor onOpenStock={onOpenStock} />
      </div> */}
      <div style={{ height: fullList ? '100%' : '68%' }}>
        <Button
          icon={fullList ? <VerticalAlignBottomOutlined /> : <VerticalAlignTopOutlined />}
          type="text"
          onClick={() => setFullList(!fullList)}
          className={styles.toggleFull}
        />
        <StockPool onOpenStock={onOpenStock} />
      </div>
    </div>
  );
});
export default Dashboard;
