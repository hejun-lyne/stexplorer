import React, { useCallback, useRef, useState } from 'react';
import { Button, Row, Select } from 'antd';
import SplitPane from 'react-split-pane';
import styles from './index.scss';
import { Stock } from '@/types/stock';
import { KLineType, KlineTypeNames, MAPeriodType } from '@/utils/enums';
import MonitorStocks from './MonitorStocks';
import CheckableTag from 'antd/lib/tag/CheckableTag';
import { ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import BKStockMonitor from '../../../BKDetail/BkStocksMonitor';

export interface STMonitorProps {
  details: Stock.DetailItem[];
  active: boolean;
  noMore: boolean;
  markdate?: string;
  onLoadMore: () => void;
  onOpenStock: (secid: string, name: string, change?: number) => void;
  stopStock?: (secid: string) => void;
}

const STMonitor: React.FC<STMonitorProps> = ({ details, active, markdate, noMore, onLoadMore, onOpenStock, stopStock }) => {
  const [monitors, setMonitors] = useState([] as string[]);
  const addAll = useCallback(() => {
    setMonitors(details.map((d) => d.secid));
  }, [details]);
  const removeAll = useCallback(() => {
    setMonitors([]);
  }, []);
  const addMonitor = useCallback(
    (s: string) => {
      if (monitors.indexOf(s) != -1) {
        return;
      }
      const ms = monitors.concat([s]);
      setMonitors(ms);
    },
    [monitors]
  );
  const moveMonitoToTop = useCallback(
    (s: string) => {
      monitors.sort(function (a, b) {
        return a == s ? -1 : b == s ? 1 : 0;
      });
      setMonitors([...monitors]);
    },
    [monitors]
  );
  const removeMonitor = useCallback(
    (s: string) => {
      const ms = monitors.filter((m) => m != s);
      setMonitors(ms);
      if (stopStock) {
        stopStock(s);
      }
    },
    [monitors]
  );

  const contentRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState<number>(0);
  const rightRef = useRef<HTMLDivElement>(null);
  const [ktype, setKtype] = useState(KLineType.Trend);
  const [mtype, setMtype] = useState(MAPeriodType.Short);
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
    <>
      <Row className={styles.container} ref={contentRef}>
        {details && (
          <SplitPane
            split="vertical"
            minSize={250}
            style={{ position: 'inherit' }}
            pane2Style={{
              height: chartWidth,
            }}
            onChange={(size) => {
              if (contentRef.current) {
                setChartWidth(contentRef.current.offsetWidth - size);
              }
            }}
          >
            <div className={styles.left}>
              <MonitorStocks
                details={details}
                noMore={noMore}
                openStock={onOpenStock}
                addStockMonitor={addMonitor}
                delStockMonitor={removeMonitor}
                loadMore={onLoadMore}
              />
            </div>
            <div className={styles.right} ref={rightRef}>
              <div className={styles.header}>
                {[KLineType.Trend, KLineType.Mint5, KLineType.Mint30, KLineType.Mint60, KLineType.Day].map((t) => (
                  <CheckableTag key={t} checked={ktype === t} onChange={(checked) => setKtype(t)}>
                    {KlineTypeNames[t]}
                  </CheckableTag>
                ))}
                <Select defaultValue={MAPeriodType.Medium} onChange={setMtype} size="small">
                  <Select.Option value={MAPeriodType.Short}>短期均线</Select.Option>
                  <Select.Option value={MAPeriodType.Medium}>中期均线</Select.Option>
                  <Select.Option value={MAPeriodType.Long}>长期均线</Select.Option>
                  <Select.Option value={MAPeriodType.JAX}>济安线</Select.Option>
                  <Select.Option value={MAPeriodType.DGWY}>登高望远</Select.Option>
                </Select>
                <Button type="link" onClick={addAll}>
                  全部添加
                </Button>
                <Button type="link" onClick={removeAll}>
                  全部移除
                </Button>
                <Button className={styles.zoomBtn} type="text" icon={<ZoomInOutlined />} onClick={zoomIn} />
                <Button className={styles.zoomBtn} type="text" icon={<ZoomOutOutlined />} onClick={zoomOut} />
              </div>
              <BKStockMonitor
                secids={monitors}
                active={active}
                markdate={markdate}
                ktype={ktype}
                mtype={mtype}
                moveTop={moveMonitoToTop}
                remove={removeMonitor}
                openStock={onOpenStock}
                range={range}
              />
            </div>
          </SplitPane>
        )}
      </Row>
    </>
  );
};

export default STMonitor;
