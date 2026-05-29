import React, { useCallback, useLayoutEffect, useState } from 'react';
import { Row, Col, DatePicker, Select, Button, Slider, List } from 'antd';
import { useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import styles from '../index.scss';
import * as Services from '@/services';
import moment from 'moment';
import { useHomeContext } from '@/components/FullHome';

export interface BacktestProps {
  onOpenStock: (secid: string, name: string) => void;
  active: boolean;
}

const Backtest: React.FC<BacktestProps> = ({ onOpenStock, active }) => {
    const { darkMode } = useHomeContext();
    const [dates, setDates] = useState([moment(new Date()).format('YYYYMMDD')]);
    const onChangeDate = useCallback(
        (d: moment.Moment | null, isStart = true) => {
          if (!d) {
            return;
          }
          const nd = d.format('YYYYMMDD');
          if (dates.length) {
            if (isStart) {
              const ed = dates[dates.length - 1];
              if (nd > ed) {
                setDates([nd]);
                return;
              }
              const newDates = [nd];
              const edm = moment(ed, 'YYYYMMDD');
              let i = 1;
              while (true) {
                const next = d.add(i++, 'days');
                if (next.isBefore(edm)) {
                  newDates.push(next.format('YYYYMMDD'));
                } else {
                  break;
                }
              }
              setDates(newDates);
            } else {
              const sd = dates[0];
              if (nd < sd) {
                setDates([nd]);
                return;
              }
              const newDates = [sd];
              const sdm = moment(sd, 'YYYYMMDD');
              let i = 1;
              while (true) {
                const next = sdm.add(i++, 'days');
                if (next.isBefore(d)) {
                  newDates.push(next.format('YYYYMMDD'));
                } else {
                  break;
                }
              }
              newDates.push(nd);
              setDates(newDates);
            }
          } else {
            setDates([nd]);
          }
        },
        [dates]
      );
    const startStrongStockRSIBacktest = useCallback(() => {
        // Services.startStrongStockRSIBacktest(dates[0], dates[dates.length - 1]);
    }, [dates]);

    return (
        <div className={styles.content}>
          <div className={styles.toolbar}>
            <div className={styles.name}>
              <span>当前进度 </span>
            </div>
            <div className={styles.actions}>
                <DatePicker onChange={onChangeDate} value={moment(dates[0], 'YYYYMMDD')} style={{ marginRight: 10 }} />
                <DatePicker
                    onChange={(d) => onChangeDate(d, false)}
                    value={moment(dates[dates.length - 1], 'YYYYMMDD')}
                    style={{ marginRight: 10 }}
                />
              <a className={styles.abtn} onClick={startStrongStockRSIBacktest}>RSI策略回测强势股票</a>
            </div>
          </div>
          
          <div className={styles.chartwrapper}>
          </div>
        </div>
      );
}
export default Backtest;