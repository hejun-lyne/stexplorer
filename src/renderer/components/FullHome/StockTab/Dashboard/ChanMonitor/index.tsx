import React, { useEffect, useLayoutEffect, useState } from 'react';
import styles from '../index.scss';
import { useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { List, Select } from 'antd';
import { ChanGSpotState, ChanTrendState, KLineType } from '@/utils/enums';
import MonitorRow from '../MonitorRow';
import * as Utils from '@/utils';
import * as Helpers from '@/helpers';
import { Stock } from '@/types/stock';
import classnames from 'classnames';
import { useCallback } from 'react';

export interface ChanMonitorProps {
  onOpenStock: (secid: string, name: string, change?: number) => void;
}

const ChanMonitor: React.FC<ChanMonitorProps> = React.memo(({ onOpenStock }) => {
  const { chanMonitors, gMonitors } = useSelector((state: StoreState) => state.stock);
  const [ktype, setKType] = useState<KLineType>(KLineType.Day);
  const [cstate, setCState] = useState<number>(ChanTrendState.BottomUp);
  const [gstate, setGState] = useState<number>(-1);
  let c_secids: any[] = [];
  if (chanMonitors[ktype]) {
    if (cstate === -1) {
      Object.values(chanMonitors[ktype]).forEach((arr) => {
        c_secids = c_secids.concat(arr);
      });
    } else {
      if (chanMonitors[ktype] && chanMonitors[ktype][cstate]) {
        c_secids = c_secids.concat(chanMonitors[ktype][cstate]);
      }
    }
  }
  let g_secids: any[] = [];
  if (gMonitors[ktype]) {
    if (gstate === -1) {
      Object.values(gMonitors[ktype]).forEach((arr) => {
        arr.forEach((a) => {
          if (!g_secids.includes(a)) {
            g_secids.push(a);
          }
        });
      });
    } else {
      if (gMonitors[ktype] && gMonitors[ktype][gstate]) {
        g_secids = g_secids.concat(gMonitors[ktype][gstate]);
      }
    }
  } else {
    if (gMonitors[ktype] && gMonitors[ktype][gstate]) {
      gMonitors[ktype][gstate].forEach((a) => {
        if (!g_secids.includes(a)) {
          g_secids.push(a);
        }
      });
    }
  }
  const secids = [];
  for (let i = 0; i < c_secids.length; i++) {
    if (g_secids.includes(c_secids[i])) {
      secids.push(c_secids[i]);
    }
  }

  // const onKTypeChange = useCallback(
  //   (v: KLineType) => {
  //     Helpers.Stock.UnsubscribeKlinePush(ktype);
  //     setKType(v);
  //   },
  //   [ktype]
  // );
  useLayoutEffect(() => {
    Helpers.Stock.SubscribeKlinePush(ktype);
    return () => {
      Helpers.Stock.UnsubscribeKlinePush(ktype);
    };
  }, [ktype]);
  return (
    <div className={styles.panel}>
      <div className={classnames(styles.header, 'draggableHeader')}>
        <div className={styles.title}>G点监控</div>
        <div className={styles.extra}>
          <Select defaultValue={KLineType.Day} style={{ width: 75 }} onChange={setKType}>
            <Select.Option value={KLineType.Mint1}>1分钟</Select.Option>
            <Select.Option value={KLineType.Mint5}>5分钟</Select.Option>
            <Select.Option value={KLineType.Mint15}>15分钟</Select.Option>
            <Select.Option value={KLineType.Mint30}>30分钟</Select.Option>
            <Select.Option value={KLineType.Mint60}>60分钟</Select.Option>
            <Select.Option value={KLineType.Day}>日K线</Select.Option>
            <Select.Option value={KLineType.Week}>周K线</Select.Option>
            <Select.Option value={KLineType.Month}>月K线</Select.Option>
          </Select>
          <Select defaultValue={ChanTrendState.BottomUp} style={{ width: 75 }} onChange={setCState}>
            <Select.Option value={-1}>C-ALL</Select.Option>
            <Select.Option value={ChanTrendState.BottomUp}>底反弹</Select.Option>
            <Select.Option value={ChanTrendState.TopDown}>顶反转</Select.Option>
            <Select.Option value={ChanTrendState.TrendUp}>上升</Select.Option>
            <Select.Option value={ChanTrendState.TrendDown}>下降</Select.Option>
          </Select>
          <Select defaultValue={-1} style={{ width: 75 }} onChange={setGState}>
            <Select.Option value={-1}>G-ALL</Select.Option>
            <Select.Option value={ChanGSpotState.CloseAboveGSpot}>突破</Select.Option>
            <Select.Option value={ChanGSpotState.CloseBelowGSpot}>破位</Select.Option>
            <Select.Option value={ChanGSpotState.HighCrossGSpot}>冲刺</Select.Option>
            <Select.Option value={ChanGSpotState.LowCrossGSpot}>支撑</Select.Option>
            <Select.Option value={ChanGSpotState.AllAboveGSpot}>空头</Select.Option>
            <Select.Option value={ChanGSpotState.AllBelowGSpot}>多头</Select.Option>
          </Select>
        </div>
      </div>
      <div className={styles.content} style={{ height: 'calc(100% - 60px)' }}>
        <List
          size="small"
          bordered={false}
          split={false}
          dataSource={[...new Set(secids)].filter(Utils.NotEmpty)}
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
export default ChanMonitor;
