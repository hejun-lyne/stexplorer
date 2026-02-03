import classnames from 'classnames';
import React, { useCallback, useEffect, useState } from 'react';
import styles from './index.scss';
import { KLineType } from '@/utils/enums';
import { Button, Radio } from 'antd';
import QSTBrief from '../QSTBrief';
import * as Helpers from '@/helpers';
import {
  ClockCircleOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  VerticalLeftOutlined,
  VerticalRightOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import { useInterval } from 'ahooks';
import { Stock } from '@/types/stock';
import { batch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';

export interface BKStockMonitorProps {
  secids: string[];
  active: boolean;
  tilDate: string;
  nexDate: string;
  choosenBks: string[];
  choosenSts: string[];
  fullWidth: boolean;
  holds: any[];
  moveTop: (secid: string) => void;
  remove: (secids: string[]) => void;
  openStock: (secid: string, name: string, change?: number) => void;
  toggleSelected: (secid: string) => void;
  doBuy: (secid: string, price: number) => void;
  doSell: (secid: string, price: number) => void;
  analyzeBK: (secid: string) => void;
  toggleFullWidth: () => void;
}

const BKStockMonitor: React.FC<BKStockMonitorProps> = React.memo(
  ({
    secids,
    active,
    tilDate,
    nexDate,
    choosenBks,
    choosenSts,
    fullWidth,
    holds,
    moveTop,
    remove,
    openStock,
    toggleSelected,
    doBuy,
    doSell,
    analyzeBK,
    toggleFullWidth,
  }) => {
    const [ktype, setKType] = useState(KLineType.Day);
    const [tick, setTick] = useState('09:25:00');
    const [ticking, setTicking] = useState(false);
    const [range, setRange] = useState({ start: 50, end: 100 });
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
    useInterval(
      () => {
        let hours = parseInt(tick.substring(0, 2));
        if (hours >= 15) {
          return;
        }
        let minutes = parseInt(tick.substring(3));
        let seconds = parseInt(tick.substring(6));
        seconds += hours > 9 || minutes < 30 || minutes >= 50 ? 60 : 3;
        if (hours > 12 && hours < 13) {
          hours = 13;
          minutes = 0;
          seconds = 0;
        }
        if (seconds >= 60) {
          minutes += 1;
          seconds = 0;
        }
        if (minutes >= 60) {
          hours += 1;
          minutes = 0;
        }
        setTick(`${hours < 10 ? '0' + hours : hours}:${minutes < 10 ? '0' + minutes : minutes}:${seconds < 10 ? '0' + seconds : seconds}`);
        if (hours >= 15) {
          setTicking(false);
        }
      },
      ticking ? 1000 : null
    );
    useEffect(() => {
      setTicking(false);
      setTick('09:25:00');
    }, [tilDate]);

    const { accessToken } = useSelector((state: StoreState) => state.baidu);
    const [fflows, setFFlows] = useState<Record<string, Stock.FlowTrendItem[]>>({});
    const downloadFFlows = useCallback(() => {
      if (!accessToken) {
        console.log(`需要先登录百度账号进行授权`);
      } else {
        // 保存现金流变化到百度云盘
        setTimeout(async () => {
          const flows: Record<string, Stock.FlowTrendItem[]> = {};
          for (let i = 0; i < secids.length; i++) {
            const fs = await Helpers.Stock.downloadStockFFlows(accessToken, secids[i], nexDate, (msg) => {
              console.log(msg);
            });
            flows[secids[i]] = fs as Stock.FlowTrendItem[];
          }
          setFFlows(flows);
        });
      }
    }, [secids, accessToken, nexDate]);

    const [zdfMappings, setZDFMappings] = useState<Record<string, number[]>>({});
    const [sortedTime, setSortedTime] = useState(0);
    const onTick = useCallback(
      (secid: string, zdf: number, main: number) => {
        // 决定排序
        zdfMappings[secid] = [zdf, main];
        batch(() => {
          setSortedTime(sortedTime + 1);
          setZDFMappings({ ...zdfMappings });
        });
      },
      [zdfMappings, sortedTime]
    );
    if (secids.length > 0 && Object.keys(zdfMappings).length > 0 && sortedTime % (2 * secids.length) == 0) {
      secids.sort((a, b) => {
        const avs = zdfMappings[a];
        const bvs = zdfMappings[b];
        const am = avs ? avs[1] : 0;
        const bm = bvs ? bvs[1] : 0;
        return am > bm ? -1 : 1;
        // const azdf = avs ? avs[0] : 0;
        // const bzdf = bvs ? bvs[0] : 0;
        // if (Math.abs(azdf - bzdf) > Math.abs(azdf)) {
        //   // 符号不同
        //   return azdf > bzdf ? 1 : -1;
        // } else {
        //   // 符号相同
        //   const am = avs ? avs[1] : 0;
        //   const bm = bvs ? bvs[1] : 0;
        //   return am > bm ? -1 : 1;
        // }
      });
    }

    return (
      <>
        <div className={styles.header}>
          <Button
            icon={fullWidth ? <VerticalLeftOutlined /> : <VerticalRightOutlined />}
            type="text"
            className={styles.btn}
            onClick={toggleFullWidth}
          />
          <Radio.Group onChange={(e) => setKType(e.target.value)} value={ktype}>
            <Radio.Button value={KLineType.Trend}>分时</Radio.Button>
            <Radio.Button value={KLineType.Day}>日线</Radio.Button>
          </Radio.Group>
          &nbsp;
          <Button className={styles.btn} type="text" icon={<ZoomInOutlined />} onClick={zoomIn} />
          <Button className={styles.btn} type="text" icon={<ZoomOutOutlined />} onClick={zoomOut} />
          &nbsp;
          <span>
            {nexDate}&nbsp;{tick}
          </span>
          <Button type="text" className={styles.btn} icon={<CloudDownloadOutlined />} onClick={downloadFFlows} />
          <Button className={styles.btn} type="text" shape="circle" icon={<ClockCircleOutlined />} onClick={() => setTick('09:25:00')} />
          <Button
            className={styles.btn}
            type="text"
            shape="circle"
            icon={ticking ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            onClick={() => setTicking(!ticking)}
          />
          <Button className={styles.btn} type="text" shape="circle" icon={<DeleteOutlined />} onClick={() => remove(secids)} />
        </div>
        <div className={styles.content}>
          {secids.map((s) => (
            <div key={s}>
              <QSTBrief
                ktype={ktype}
                secid={s}
                tick={tick}
                tilDate={tilDate}
                nexDate={nexDate}
                hold={holds.find((_) => _.secid == s)}
                active={active}
                moveTop={moveTop}
                remove={() => remove([s])}
                openStock={openStock}
                range={range}
                selected={choosenBks.indexOf(s) != -1 || choosenSts.indexOf(s) != -1}
                toggleSelected={toggleSelected}
                doBuy={doBuy}
                doSell={doSell}
                analyzeBK={analyzeBK}
                onTick={onTick}
              />
              <div style={{ height: 5, background: 'var(--top-background-color)' }}></div>
            </div>
          ))}
        </div>
      </>
    );
  }
);

export default BKStockMonitor;
