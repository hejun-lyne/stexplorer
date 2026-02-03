import React, { useEffect, useState } from 'react';
import * as Services from '@/services';
import * as Utils from '@/utils';
import { useRequest } from 'ahooks';
import styles from './index.scss';
import classnames from 'classnames';
import { List } from 'antd';
import * as CONST from '@/constants';
import { useUSWorkDayTimeToDo, useWorkDayTimeToDo } from '@/utils/hooks';
import { Stock } from '@/types/stock';
import { useDispatch, useSelector } from 'react-redux';
import * as Helpers from '@/helpers';
import { StockMarketType } from '@/utils/enums';
import { StoreState } from '@/reducers/types';

export interface TradeRecordProps {
  active: boolean;
  showSeats: boolean;
  stock: Stock.DetailItem | Record<string, any>;
}

const TradeRecord: React.FC<TradeRecordProps> = React.memo(({ active, showSeats, stock }) => {
  const stocks = useSelector((store: StoreState) => store.stock.stocksMapping[stock.secid]);
  const [detail, setDetail] = useState(stock || stocks?.detail || {});
  const [noMore, setNoMore] = useState(false);
  const [trades, setTrades] = useState<Stock.TradeItem[]>([]);
  const dispatch = useDispatch();
  const mergeTrades = (values: Stock.TradeItem[], refresh: boolean) => {
    // 合并数据
    if (!trades || !trades.length) {
      setTrades(values.reverse());
    } else {
      const vals = values.reverse();
      let toIndex = -1;
      let fromIndex = -1;
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i];
        if (toIndex === -1) {
          if (trades.find((t) => t.time === v.time)) {
            toIndex = i;
            if (refresh) {
              break;
            }
          }
          continue;
        }
        if (fromIndex == -1 && !trades.find((t) => t.time === v.time)) {
          fromIndex = i;
          break;
        }
      }
      const temps = vals.slice(0, toIndex).concat(trades);
      if (refresh) {
        setTrades(temps);
      } else {
        if (fromIndex == -1) {
          setNoMore(true);
        } else {
          setTrades(temps.concat(vals.slice(fromIndex)));
        }
      }
    }
  };

  const {run: runGetStockDetailFromEastmoney} = useRequest(Services.Stock.GetDetailFromEastmoney, {
    throwOnError: true,
    manual: true,
    onSuccess: (d) => {
      if (d) {
        setDetail(d);
      }
    },
    pollingWhenHidden: false,
    cacheKey: `GetDetailFromEastmoney/${detail.secid}`,
  })
  const { run: runGetStockTradesFromEastmoney } = useRequest(Services.Stock.GetStockTradesFromEastmoney, {
    throwOnError: true,
    manual: true,
    onSuccess: (values) => mergeTrades(values, true),
    pollingWhenHidden: false,
    cacheKey: `GetStockTradesFromEastmoney/${detail.secid}`,
  });

  const stype = Helpers.Stock.GetStockType(detail.secid);
  const func = stype == StockMarketType.US || stype == StockMarketType.USZindex ? useUSWorkDayTimeToDo : useWorkDayTimeToDo;
  func(
    () => {
      runGetStockDetailFromEastmoney(detail.secid);
      runGetStockTradesFromEastmoney(detail.secid, 14);
    },
    active ? CONST.DEFAULT.STOCK_TREND_DELAY : null
  );

  useEffect(() => {
    runGetStockTradesFromEastmoney(detail.secid, 14);
  }, []);

  const loadMore = () => {
    if (detail.secid) {
      runGetStockTradesFromEastmoney(detail.secid, trades.length + 30);
    }
  };
  const seatsClassNames = (p: number) => classnames(styles.seats, Utils.GetValueColor(p - detail.zs).textClass);
  return (
    <div className={styles.container}>
      {showSeats && (
        <>
          <div className={styles.sells}>
            <div className={seatsClassNames(detail.s5p)}>
              <span className={styles.a}>卖5</span>
              <span className={styles.b}>{typeof detail.s5p == 'number' ? detail.s5p.toFixed(2) : '--'}</span>
              <span className={styles.c}>{detail.s5}</span>
            </div>
            <div className={seatsClassNames(detail.s4p)}>
              <span className={styles.a}>卖4</span>
              <span className={styles.b}>{typeof detail.s4p == 'number' ? detail.s4p.toFixed(2) : '--'}</span>
              <span className={styles.c}>{detail.s4}</span>
            </div>
            <div className={seatsClassNames(detail.s3p)}>
              <span className={styles.a}>卖3</span>
              <span className={styles.b}>{typeof detail.s3p == 'number' ? detail.s3p.toFixed(2) : '--'}</span>
              <span className={styles.c}>{detail.s3}</span>
            </div>
            <div className={seatsClassNames(detail.s2p)}>
              <span className={styles.a}>卖2</span>
              <span className={styles.b}>{typeof detail.s2p == 'number' ? detail.s2p.toFixed(2) : '--'}</span>
              <span className={styles.c}>{detail.s2}</span>
            </div>
            <div className={seatsClassNames(detail.s1p)}>
              <span className={styles.a}>卖1</span>
              <span className={styles.b}>{typeof detail.s1p == 'number' ? detail.s1p.toFixed(2) : '--'}</span>
              <span className={styles.c}>{detail.s1}</span>
            </div>
          </div>
          <div className={styles.seperator}></div>
          <div className={styles.buys}>
            <div className={seatsClassNames(detail.b1p)}>
              <span className={styles.a}>买1</span>
              <span className={styles.b}>{typeof detail.b1p == 'number' ? detail.b1p.toFixed(2) : '--'}</span>
              <span className={styles.c}>{detail.b1}</span>
            </div>
            <div className={seatsClassNames(detail.b2p)}>
              <span className={styles.a}>买2</span>
              <span className={styles.b}>{typeof detail.b2p == 'number' ? detail.b2p.toFixed(2) : '--'}</span>
              <span className={styles.c}>{detail.b2}</span>
            </div>
            <div className={seatsClassNames(detail.b3p)}>
              <span className={styles.a}>买3</span>
              <span className={styles.b}>{typeof detail.b3p == 'number' ? detail.b3p.toFixed(2) : ''}</span>
              <span className={styles.c}>{detail.b3}</span>
            </div>
            <div className={seatsClassNames(detail.b4p)}>
              <span className={styles.a}>买4</span>
              <span className={styles.b}>{typeof detail.b4p == 'number' ? detail.b4p.toFixed(2) : '--'}</span>
              <span className={styles.c}>{detail.b4}</span>
            </div>
            <div className={seatsClassNames(detail.b5p)}>
              <span className={styles.a}>买5</span>
              <span className={styles.b}>{typeof detail.b5p == 'number' ? detail.b5p.toFixed(2) : '--'}</span>
              <span className={styles.c}>{detail.b5}</span>
            </div>
          </div>
          <div className={styles.seperator}></div>
        </>
      )}
      <div className={styles.trades}>
        <List
          size="small"
          bordered={false}
          split={false}
          dataSource={trades}
          renderItem={(item, i) => (
            <List.Item key={i} style={{ padding: 0 }}>
              <div className={styles.row}>
                <span className={classnames(styles.b, Utils.GetValueColor(item.up).textClass)}>{item.time}</span>
                <span className={classnames(styles.b, Utils.GetValueColor(item.up).textClass)}>{item.price.toFixed(2)}</span>
                <span className={classnames(styles.c, Utils.GetValueColor(item.up).textClass)}>{item.vol}</span>
              </div>
            </List.Item>
          )}
        >
          {!noMore && (
            <div className={styles.loadmore} onClick={loadMore}>
              <span>加载更多</span>
            </div>
          )}
        </List>
      </div>
    </div>
  );
});
export default TradeRecord;
