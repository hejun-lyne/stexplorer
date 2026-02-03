import React, { useCallback, useEffect, useState } from 'react';
import * as Services from '@/services';
import PureCard from '@/components/Card/PureCard';
import styles from './index.scss';
import classnames from 'classnames';
import * as Utils from '@/utils';
import * as CONST from '@/constants';
import * as Helpers from '@/helpers';
import { useRequest } from 'ahooks';
import { Stock } from '@/types/stock';
import { useWorkDayTimeToDo } from '@/utils/hooks';
import { Button, Checkbox } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { KFilterType, KFilterTypeNames } from '@/utils/enums';
import { batch } from 'react-redux';

export interface BanKuaiStocksProps {
  secid: string;
  active: boolean;
  openStock: (secid: string, name: string, change?: number) => void;
  addStockMonitors: (items: Stock.DetailItem[]) => void;
  onStocksUpdated: (details: Stock.DetailItem[]) => void;
}

const BanKuaiStocks: React.FC<BanKuaiStocksProps> = React.memo(({ secid, active, openStock, addStockMonitors, onStocksUpdated }) => {
  const [count, setCount] = useState(40);
  const [noMore, setNoMore] = useState(false);
  const [stocks, setStocks] = useState<Stock.DetailItem[]>([]);
  const { run: runGetStocks } = useRequest(Services.Stock.GetBankuaiStocksFromEastmoney, {
    throwOnError: true,
    manual: true,
    defaultParams: [secid, count],
    onSuccess: (data) => {
      setNoMore(data.total == data.stocks.length);
      setStocks(data.stocks as Stock.DetailItem[]);
      onStocksUpdated(data.stocks);
      if (ftypes.length > 0) {
        setFiltering(true);
        runFilterStocks(
          data.stocks.map((s) => s.secid),
          ftypes,
          10
        );
      }
    },
    cacheKey: `GetBankuaiStockFromEastmoney/${secid}`,
  });
  useWorkDayTimeToDo(
    () => {
      runGetStocks(secid, count);
    },
    active ? CONST.DEFAULT.STOCK_TREND_DELAY : null
  );

  useEffect(() => {
    runGetStocks(secid, count);
  }, [secid]);

  const [filtering, setFiltering] = useState(false);
  const [ftypes, setFtypes] = useState<number[]>([]);
  const [filterSecids, setFilterSecids] = useState<string[]>([]);
  const { run: runFilterStocks } = useRequest(Helpers.Stock.FilterMultiKlines, {
    throwOnError: true,
    manual: true,
    onSuccess: (data: any[]) => {
      batch(() => {
        setFiltering(false);
        setFilterSecids(data.filter(Utils.NotEmpty));
      });
    },
  });

  const updateFtypes = useCallback(
    (ts: any[]) => {
      setFtypes(ts);
      if (ts.length && stocks.length) {
        setFiltering(true);
        runFilterStocks(
          stocks.map((s) => s.secid),
          ts,
          10
        );
      }
    },
    [stocks]
  );
  const filterStocks = ftypes.length ? stocks.filter((s) => filterSecids.indexOf(s.secid) != -1) : stocks;
  return (
    <div className={classnames(styles.content, 'scroll-enabled')}>
      <div>
        <Checkbox.Group
          options={[
            { label: KFilterTypeNames[KFilterType.ZJZT], value: KFilterType.ZJZT },
            { label: KFilterTypeNames[KFilterType.FLYX], value: KFilterType.FLYX },
            { label: KFilterTypeNames[KFilterType.XYJC], value: KFilterType.XYJC },
            { label: KFilterTypeNames[KFilterType.TPHP], value: KFilterType.TPHP },
            { label: KFilterTypeNames[KFilterType.FQFB], value: KFilterType.FQFB },
            { label: KFilterTypeNames[KFilterType.FYZS], value: KFilterType.FYZS },
            { label: KFilterTypeNames[KFilterType.NKCB], value: KFilterType.NKCB },
          ]}
          defaultValue={[]}
          onChange={updateFtypes}
        />
      </div>
      {filtering && <div>筛选中...</div>}
      <div>
        {/* <Checkbox onChange={toggleKCB}>不要科创板</Checkbox> */}
        <Button type="link" onClick={() => addStockMonitors(filterStocks)}>
          全部添加
        </Button>
      </div>
      {stocks.length ? (
        <>
          {filterStocks.map((stock) => (
            <div key={stock.code}>
              <a onClick={() => openStock(stock.secid, stock.name, stock.zdf)}>
                <label style={{ marginRight: 10, cursor: 'pointer', display: 'inline-block', width: 50 }}>{stock.name}</label>
              </a>
              <span className={classnames(Utils.GetValueColor(stock.zdf).textClass)}>{stock.zx + '  '}</span>
              <span>{(stock.lt / 100000000).toFixed(2) + '亿 '}</span>
              <div style={{ display: 'inline-block', float: 'right' }} className={classnames(Utils.GetValueColor(stock.zdf).textClass)}>
                {Utils.Yang(stock.zdf)}% &nbsp;
                <a onClick={() => addStockMonitors([stock])}>
                  <PlusOutlined />
                </a>
              </div>
            </div>
          ))}
          {!noMore && (
            <div
              className={styles.loadmore}
              onClick={() => {
                setCount(count + 40);
                runGetStocks(secid, count);
              }}
            >
              <span>加载更多</span>
            </div>
          )}
        </>
      ) : (
        <div>无板块数据~</div>
      )}
    </div>
  );
});
export default BanKuaiStocks;
