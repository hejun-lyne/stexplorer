import React, { useEffect, useMemo, useState } from 'react';
import classnames from 'classnames';
import PureCard from '@/components/Card/PureCard';
import * as Utils from '@/utils';
import * as Services from '@/services';
import { KLineType } from '@/utils/enums';
import styles from './index.scss';
import { Stock } from '@/types/stock';
import { StoreState } from '@/reducers/types';
import { useSelector } from 'react-redux';

export interface RealTimeProps {
  stock: Stock.DetailItem;
}

/**
 * 训练模式：用训练日的日K推导「实时行情」
 * 训练模式下不允许出现未来数据，因此最新价/涨跌幅/今开/最高/最低/成交量等全部取训练日K线
 */
function buildTrainDetail(stock: Stock.DetailItem, klines: Stock.KLineItem[], trainDate: string): Stock.DetailItem {
  const ks = (klines || []).filter((k) => k && k.date && k.date.substring(0, 10) <= trainDate);
  if (!ks.length) {
    return stock;
  }
  const bar = ks[ks.length - 1];
  const prevBar = ks.length > 1 ? ks[ks.length - 2] : undefined;
  const zx = bar.sp;
  const zs = bar.zs || (prevBar ? prevBar.sp : bar.kp);
  const zde = typeof bar.zde === 'number' && !isNaN(bar.zde) ? bar.zde : Number((zx - zs).toFixed(4));
  const zdf = typeof bar.zdf === 'number' && !isNaN(bar.zdf) ? bar.zdf : zs ? Number(((zde / zs) * 100).toFixed(4)) : 0;
  return {
    ...stock,
    zx,
    zs,
    zdd: Number(zde.toFixed(4)),
    zdf: Number(zdf.toFixed(4)),
    jk: bar.kp,
    zg: bar.zg,
    zd: bar.zd,
    zss: bar.cjl,
    cjl: bar.cjl,
    cje: bar.cje,
    // 明细接口中的换手率是「百分数 × 100」（组件展示时会 /100），K线里是百分数
    hsl: bar.hsl ? bar.hsl * 100 : NaN,
    // 日K没有的字段置为 NaN，模板里会展示为「--」
    wp: NaN,
    np: NaN,
    jj: NaN,
    lb: NaN,
  };
}

const RealTime: React.FC<RealTimeProps> = React.memo(({ stock }) => {
  const stocks = useSelector((store: StoreState) => store.stock.stocksMapping[stock.secid]);
  const { ontrain, trainDate } = useSelector((state: StoreState) => state.setting.systemSetting);
  /** 训练日的日K（优先取 redux，缺失时自行取一次，走磁盘缓存代价很低） */
  const [trainKlines, setTrainKlines] = useState<Stock.KLineItem[]>(
    () => (stocks?.klines && stocks.klines[KLineType.Day]) || []
  );
  const reduxDayKlines = (stocks?.klines && stocks.klines[KLineType.Day]) || [];
  const reduxDayCount = reduxDayKlines.length;

  useEffect(() => {
    if (!ontrain || !trainDate || !stock.secid) {
      setTrainKlines([]);
      return;
    }
    if (reduxDayCount) {
      setTrainKlines(reduxDayKlines);
      return;
    }
    let mounted = true;
    Services.Stock.GetKFromSetting(stock.secid, KLineType.Day, 350)
      .then((r) => {
        if (mounted && r && r.ks && r.ks.length) {
          setTrainKlines(r.ks);
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [ontrain, trainDate, stock.secid, reduxDayCount]);

  const data = useMemo(() => {
    if (ontrain && trainDate) {
      return buildTrainDetail(stock, trainKlines, trainDate);
    }
    return stock || stocks?.detail || {};
  }, [ontrain, trainDate, stock, trainKlines, stocks]);

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
            <div>{!data.hsl || isNaN(data.hsl) ? '--' : (data.hsl / 100).toFixed(2) + '%'}</div>
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
            <div>{isNaN(data.jj) ? '--' : data.jj}</div>
            <div className={styles.detailItemLabel}>均价</div>
          </div>
        </div>
      </div>
    </PureCard>
  );
});
export default RealTime;
