import React from 'react';
import classnames from 'classnames';
import PureCard from '@/components/Card/PureCard';
import * as Utils from '@/utils';
import styles from './index.scss';
import { Stock } from '@/types/stock';
import { StoreState } from '@/reducers/types';
import { useSelector } from 'react-redux';

export interface RealTimeProps {
  stock: Stock.DetailItem;
}

const RealTime: React.FC<RealTimeProps> = React.memo(({ stock }) => {
  const stocks = useSelector((store: StoreState) => store.stock.stocksMapping[stock.secid]);
  const data = stock || stocks?.detail || {};
  if (!data.secid) {
    console.log('RealTime组件缺少secid', stock, stocks);
  }
  return (
    <PureCard>
      <div className={styles.container}>
        <div className={styles.titleRow}>
          <span className={classnames(Utils.GetValueColor(data.zdd).textClass)}>{!data.zx || typeof data.zx != 'number' ? '--' : data.zx.toFixed(2)}</span>
          <span className={classnames(Utils.GetValueColor(data.zdd).textClass)}>
            {!data.zdd ? '--' : Utils.Yang(data.zdd > 100 ? data.zdd.toFixed(0) : data.zdd)}
          </span>
          <div className={classnames(Utils.GetValueColor(data.zdf).textClass)}>{!data.zdf ? '--' : Utils.Yang(data.zdf)}%</div>
        </div>
        <div
          className={styles.detail}
          style={data.secid.startsWith('0.') || data.secid.startsWith('1.') ? {} : { fontSize: 'calc(8rem / var(--base-font-size))' }}
        >
          <div className={classnames(styles.detailItem, 'text-left')}>
            <div>{!data.zs ? '--' : data.zs}</div>
            <div className={styles.detailItemLabel}>昨收</div>
          </div>
          <div className={classnames(styles.detailItem, 'text-center')}>
            <div>{!data.hsl ? '--' : (data.hsl / 100).toFixed(2)}%</div>
            <div className={styles.detailItemLabel}>换手率</div>
          </div>
          <div className={classnames(styles.detailItem, 'text-right')}>
            <div>
              {isNaN(data.zss)
                ? '--'
                : (data.zss / (data.zss >= 10000000 ? 10000000 : 10000)).toFixed(2) + (data.zss >= 10000000 ? '千万' : '万')}
            </div>
            <div className={styles.detailItemLabel}>总手数</div>
          </div>
        </div>
        <div
          className={styles.detail}
          style={data.secid.startsWith('0.') || data.secid.startsWith('1.') ? {} : { fontSize: 'calc(8rem / var(--base-font-size))' }}
        >
          <div className={classnames(styles.detailItem, 'text-left')}>
            <div className={classnames(Utils.GetValueColor(data.jk - data.zs).textClass)}>{Utils.Yang(data.jk)}</div>
            <div className={styles.detailItemLabel}>今开</div>
          </div>
          <div className={classnames(styles.detailItem, 'text-center')}>
            <div className={classnames('text-up')}>{data.zg}</div>
            <div className={styles.detailItemLabel}>最高</div>
          </div>
          <div className={classnames(styles.detailItem, 'text-right')}>
            <div className={classnames('text-down')}>{data.zd}</div>
            <div className={styles.detailItemLabel}>最低</div>
          </div>
        </div>
        <div
          className={styles.detail}
          style={data.secid.startsWith('0.') || data.secid.startsWith('1.') ? {} : { fontSize: 'calc(8rem / var(--base-font-size))' }}
        >
          <div className={classnames(styles.detailItem, 'text-left')}>
            <div>{isNaN(data.wp) ? '--' : (data.wp / 10000).toFixed(2) + '万'}</div>
            <div className={styles.detailItemLabel}>外盘</div>
          </div>
          <div className={classnames(styles.detailItem, 'text-center')}>
            <div>{isNaN(data.np) ? '--' : (data.np / 10000).toFixed(2) + '万'}</div>
            <div className={styles.detailItemLabel}>内盘</div>
          </div>
          <div className={classnames(styles.detailItem, 'text-right')}>
            <div>{data.jj}</div>
            <div className={styles.detailItemLabel}>均价</div>
          </div>
        </div>
      </div>
    </PureCard>
  );
});
export default RealTime;
