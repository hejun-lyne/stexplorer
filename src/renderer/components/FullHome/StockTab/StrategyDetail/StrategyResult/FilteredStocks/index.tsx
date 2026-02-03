import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../index.scss';
import BKStockMonitor from '../../../BKDetail/BkStocksMonitor';
import { KLineType, MAPeriodType } from '@/utils/enums';
import { Button, Radio, Select } from 'antd';
import { ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';

export interface FilteredStocksProps {
  secids: string[];
  active: boolean;
  onOpenStock: (secid: string, name: string, change?: number) => void;
}

const FilteredStocks: React.FC<FilteredStocksProps> = React.memo(({ secids, active, onOpenStock }) => {
  const [ktype, setKtype] = useState(KLineType.Trend);
  const [mtype, setMtype] = useState(MAPeriodType.Medium);
  const [range, setRange] = useState({
    start: 50,
    end: 100,
  });
  const zoomOut = () => {
    if (range.start <= 5) {
      range.start = 0;
    } else {
      range.start -= 5;
    }
    setRange({
      ...range,
    });
  };

  const zoomIn = () => {
    if (range.end - range.start <= 10) {
      return;
    } else {
      range.start += 5;
    }
    setRange({
      ...range,
    });
  };
  return (
    <div className={styles.subcontainer}>
      <div className={styles.header}>
        <Radio.Group onChange={(e) => setKtype(e.target.value)} value={ktype} buttonStyle="solid" size='small'>
          <Radio.Button value={KLineType.Trend}>分时</Radio.Button>
          <Radio.Button value={KLineType.Day}>日线</Radio.Button>
        </Radio.Group>
        &nbsp;
        <Select value={mtype} onChange={setMtype} size="small">
          <Select.Option value={MAPeriodType.Short}>短期均线</Select.Option>
          <Select.Option value={MAPeriodType.Medium}>中期均线</Select.Option>
          <Select.Option value={MAPeriodType.Long}>长期均线</Select.Option>
          <Select.Option value={MAPeriodType.JAX}>济安线</Select.Option>
          <Select.Option value={MAPeriodType.DGWY}>登高望远</Select.Option>
        </Select>
        &nbsp;
        <Button className={styles.btn} type="text" icon={<ZoomInOutlined />} onClick={zoomIn} />
        <Button className={styles.btn} type="text" icon={<ZoomOutOutlined />} onClick={zoomOut} />
        <span style={{ display: 'block', float: 'right' }}>总计({secids.length})</span>
      </div>
      <div className={styles.listContainer}>
        <BKStockMonitor secids={secids} active={active} ktype={ktype} mtype={mtype} openStock={onOpenStock} range={range} />
      </div>
    </div>
  );
});
export default FilteredStocks;
