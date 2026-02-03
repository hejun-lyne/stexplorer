import React, { useCallback, useState } from 'react';
import styles from './index.scss';
import classnames from 'classnames';
import * as Utils from '@/utils';
import * as Helpers from '@/helpers';
import { useRequest } from 'ahooks';
import { Stock } from '@/types/stock';
import { Checkbox } from 'antd';
import { MinusOutlined, PlusOutlined } from '@ant-design/icons';
import { KFilterType, KFilterTypeNames, StockMarketType } from '@/utils/enums';
import { batch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';

export interface MonitorStocksProps {
  details: Stock.DetailItem[];
  noMore: boolean;
  loadMore: () => void;
  openStock: (secid: string, name: string, change?: number) => void;
  addStockMonitor: (s: string) => void;
  delStockMonitor: (s: string) => void;
}

const MonitorStocks: React.FC<MonitorStocksProps> = React.memo(
  ({ details, noMore, loadMore, openStock, addStockMonitor, delStockMonitor }) => {
    const { stockConfigsMapping } = useSelector((state: StoreState) => state.stock);
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
        if (ts.length && details.length) {
          setFiltering(true);
          runFilterStocks(
            details.map((s) => s.secid),
            ts,
            10
          );
        }
      },
      [details]
    );

    const filterStocks = ftypes.length ? details.filter((s) => filterSecids.indexOf(s.secid) != -1) : details;
    filterStocks.sort((a, b) => b.zdf - a.zdf);
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
            ]}
            defaultValue={[]}
            onChange={updateFtypes}
          />
        </div>
        {filtering && <div>筛选中...</div>}
        {filterStocks.length ? (
          <>
            {filterStocks.map((stock) => (
              <div key={stock.code}>
                <a onClick={() => openStock(stock.secid, stock.name, stock.zdf)}>
                  <label style={{ marginRight: 0, cursor: 'pointer', display: 'inline-block', color: stockConfigsMapping[stock.secid].marktype == 1 ? '#FF9933' : stockConfigsMapping[stock.secid].marktype == 2 ? '#0099DD' : stockConfigsMapping[stock.secid].marktype == 3 ? '#B4CF66' : 'var(--text-color)' }}>{stock.name}</label>
                  &nbsp;
                  <span className={styles.hybk}>{(stockConfigsMapping[stock.secid]?.hybk?.name || [''])}&nbsp;</span>
                </a>
                {/* {Helpers.Stock.GetStockType(stock.secid) == StockMarketType.Zindex && <span>指数&nbsp;</span>}
                {Helpers.Stock.GetStockType(stock.secid) == StockMarketType.Quotation && <span>板块&nbsp;</span>}
                {Helpers.Stock.GetStockType(stock.secid) == StockMarketType.AB && (
                  <span>{(stockConfigsMapping[stock.secid]?.hybk?.name || [''])[0]}&nbsp;</span>
                )} */}
                
                <div style={{ display: 'inline-block', float: 'right' }} className={classnames(Utils.GetValueColor(stock.zdf ? stock.zdf : 0).textClass)}>
                  <span className={classnames(Utils.GetValueColor(stock.zdf ? stock.zdf : 0).textClass)}>{(0. + stock.zx ? stock.zx : 0).toFixed(2) + '  '}</span>
                  {Utils.Yang(stock.zdf)}% &nbsp;
                  {/* <a onClick={() => delStockMonitor(stock.secid)}>
                    <MinusOutlined />
                  </a> */}
                  <a onClick={() => addStockMonitor(stock.secid)}>
                    <PlusOutlined />
                  </a>
                </div>
              </div>
            ))}
            {!noMore && (
              <div className={styles.loadmore} onClick={loadMore}>
                <span>加载更多</span>
              </div>
            )}
          </>
        ) : (
          <div>无股票数据~</div>
        )}
      </div>
    );
  }
);
export default MonitorStocks;
