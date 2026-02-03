import React, { useState } from 'react';
import styles from '../index.scss';
import { addFavorSiteAction, deleteFavorSiteAction } from '@/actions/site';
import { useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { List, Select } from 'antd';
import { KLineType, KStateStrings, MAType, PriceMAState } from '@/utils/enums';
import { AlertTwoTone } from '@ant-design/icons';
import MonitorRow from '../MonitorRow';
import * as Utils from '@/utils';
import { Stock } from '@/types/stock';
import classnames from 'classnames';

export interface MAMonitorProps {
  onOpenStock: (secid: string, name: string, change?: number) => void;
}

/// 可以选择不同的均线，不同的K线
const MAMonitor: React.FC<MAMonitorProps> = React.memo(({ onOpenStock }) => {
  const { maMonitors } = useSelector((state: StoreState) => state.stock);
  const [ktype, setKType] = useState<KLineType>(KLineType.Day);
  const [matype, setMAType] = useState<number>(MAType.MA10);
  const [mastate, setMAState] = useState<number>(PriceMAState.CloseAboveMA);
  let secids: any[] = [];
  const candidates: string[][] = [];
  Object.entries(maMonitors[ktype] || {}).forEach(([key, d]) => {
    if (matype !== -1 && parseInt(key) !== matype) {
      return;
    }
    if (mastate === -1) {
      // 不判断状态
      Object.values(d).forEach((arr) => {
        candidates.push(arr);
      });
    } else {
      candidates.push(d[mastate]);
    }
  });
  if (mastate === -1) {
    secids = [...new Set([].concat.apply(candidates, []))];
  } else {
    // 只提取重复的
    let temps = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      temps = temps.filter((t) => candidates[i].indexOf(t) != -1);
    }
    secids = temps;
  }

  return (
    <div className={styles.panel}>
      <div className={classnames(styles.header, 'draggableHeader')}>
        <div className={styles.title}>均线监控</div>
        <div className={styles.extra}>
          <Select defaultValue={KLineType.Day} style={{ width: 75 }} onChange={setKType} size="small">
            <Select.Option value={KLineType.Mint1}>1分钟</Select.Option>
            <Select.Option value={KLineType.Mint5}>5分钟</Select.Option>
            <Select.Option value={KLineType.Mint15}>15分钟</Select.Option>
            <Select.Option value={KLineType.Mint30}>30分钟</Select.Option>
            <Select.Option value={KLineType.Mint60}>60分钟</Select.Option>
            <Select.Option value={KLineType.Day}>日K线</Select.Option>
            <Select.Option value={KLineType.Week}>周K线</Select.Option>
            <Select.Option value={KLineType.Month}>月K线</Select.Option>
          </Select>
          <Select defaultValue={MAType.MA10} style={{ width: 85, marginLeft: 5 }} onChange={setMAType} size="small">
            <Select.Option value={-1}>MA-ALL</Select.Option>
            <Select.Option value={MAType.MA5}>MA5</Select.Option>
            <Select.Option value={MAType.MA10}>MA10</Select.Option>
            <Select.Option value={MAType.MA20}>MA20</Select.Option>
            <Select.Option value={MAType.MA30}>MA30</Select.Option>
          </Select>
          <Select defaultValue={PriceMAState.CloseAboveMA} style={{ width: 65, marginLeft: 5 }} onChange={setMAState} size="small">
            <Select.Option value={-1}>ALL</Select.Option>
            <Select.Option value={PriceMAState.HighCrossMA}>{KStateStrings[PriceMAState.HighCrossMA]}</Select.Option>
            <Select.Option value={PriceMAState.LowCrossMA}>{KStateStrings[PriceMAState.LowCrossMA]}</Select.Option>
            <Select.Option value={PriceMAState.CloseAboveMA}>{KStateStrings[PriceMAState.CloseAboveMA]}</Select.Option>
            <Select.Option value={PriceMAState.CloseBelowMA}>{KStateStrings[PriceMAState.CloseBelowMA]}</Select.Option>
            <Select.Option value={PriceMAState.AllAboveMA}>{KStateStrings[PriceMAState.AllAboveMA]}</Select.Option>
            <Select.Option value={PriceMAState.AllBelowMA}>{KStateStrings[PriceMAState.AllBelowMA]}</Select.Option>
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
export default MAMonitor;
