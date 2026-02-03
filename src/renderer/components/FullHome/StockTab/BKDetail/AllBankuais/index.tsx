import React, { useCallback, useEffect, useState } from 'react';
import * as Services from '@/services';
import styles from './index.scss';
import classnames from 'classnames';
import * as Utils from '@/utils';
import * as CONST from '@/constants';
import * as Helpers from '@/helpers';
import { useRequest } from 'ahooks';
import { Stock } from '@/types/stock';
import { useWorkDayTimeToDo } from '@/utils/hooks';
import { Button, DatePicker, Input, InputNumber, Select, Tabs } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { BKType, KSortType, KSortTypeNames } from '@/utils/enums';
import { batch } from 'react-redux';
import moment from 'moment';

export interface AllBankuaisWrapperProps {
  secid: string;
  active: boolean;
  openStock: (secid: string, name: string, change?: number) => void;
  addStockMonitors: (items: Stock.BanKuaiItem[]) => void;
}

const AllBankuaisWrapper: React.FC<AllBankuaisWrapperProps> = React.memo(({ secid, active, openStock, addStockMonitors }) => {
  return (
    <Tabs defaultActiveKey="industry">
      <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>行业</span>} key={'industry'}>
        <AllBankuais secid={secid} active={active} bktype={BKType.Industry} openStock={openStock} addStockMonitors={addStockMonitors} />
      </Tabs.TabPane>
      <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>概念</span>} key={'gainian'}>
        <AllBankuais secid={secid} active={active} bktype={BKType.Gainian} openStock={openStock} addStockMonitors={addStockMonitors} />
      </Tabs.TabPane>
    </Tabs>
  );
});
export default AllBankuaisWrapper;

export interface AllBankuaisProps {
  secid: string;
  active: boolean;
  bktype: BKType;
  openStock: (secid: string, name: string, change?: number) => void;
  addStockMonitors: (items: Stock.BanKuaiItem[]) => void;
}

const AllBankuais: React.FC<AllBankuaisProps> = React.memo(({ active, bktype, openStock, addStockMonitors }) => {
  const [pageSize, setPageSize] = useState(100);
  const [noMore, setNoMore] = useState(false);
  const [bankuais, setBankuais] = useState<Stock.BanKuaiItem[]>([]);
  const [sortedBankuais, setSortedBankuais] = useState<Stock.BanKuaiItem[] | null>(null);
  const [sorting, setSorting] = useState(false);
  const [stype, setStype] = useState<number>(KSortType.None);
  const [slimit, setSLimit] = useState(30);
  const { run: runGetBankuais } = useRequest(Services.Stock.GetBanKuais, {
    throwOnError: true,
    manual: true,
    onSuccess: (d: { to: number; arr: Stock.BanKuaiItem[] }) => {
      setNoMore(d.to === d.arr.length);
      setBankuais(d.arr);
      if (stype != KSortType.None) {
        setSorting(true);
        runSortStocks(
          d.arr.map((s) => s.secid),
          stype,
          slimit
        );
      }
    },
  });
  const mayGetBankuais = useCallback((t: BKType, ps: number) => {
    runGetBankuais(t, ps);
  }, []);
  useWorkDayTimeToDo(() => mayGetBankuais(bktype, pageSize), active ? CONST.DEFAULT.STOCK_TREND_DELAY : null);
  useEffect(() => {
    runGetBankuais(bktype, pageSize);
  }, [bktype, pageSize]);
  const { run: runSortStocks } = useRequest(Helpers.Stock.SortMultiKlines, {
    throwOnError: true,
    manual: true,
    onSuccess: (data: any) => {
      const temp = [...bankuais];
      temp.sort((a, b) => (data[a.secid] > data[b.secid] ? -1 : 1));
      batch(() => {
        setSorting(false);
        setSortedBankuais(temp);
      });
    },
  });
  const updateStype = useCallback(
    (t) => {
      setStype(t);
      if (t != KSortType.None) {
        setSorting(true);
        runSortStocks(
          bankuais.map((s) => s.secid),
          t,
          slimit
        );
      } else {
        setSortedBankuais(null);
      }
    },
    [bankuais, slimit]
  );
  const updateSlimit = useCallback(
    (c) => {
      setSLimit(c);
      if (c >= 5) {
        setSorting(true);
        runSortStocks(
          bankuais.map((s) => s.secid),
          stype,
          c
        );
      } else {
        setSortedBankuais(null);
      }
    },
    [bankuais, stype]
  );

  const loadMore = useCallback(() => {
    setPageSize(pageSize + 20);
  }, [pageSize]);

  return (
    <>
      <div className={styles.header}>
        <Select defaultValue={KSortType.None} onChange={updateStype} size="small">
          <Select.Option value={KSortType.None}>{KSortTypeNames[KSortType.None]}</Select.Option>
          <Select.Option value={KSortType.ZDSJ}>{KSortTypeNames[KSortType.ZDSJ]}</Select.Option>
          <Select.Option value={KSortType.FTGD}>{KSortTypeNames[KSortType.FTGD]}</Select.Option>
          <Select.Option value={KSortType.WRZF}>{KSortTypeNames[KSortType.WRZF]}</Select.Option>
        </Select>
        &nbsp;
        <InputNumber min={5} step={1} size="small" onChange={updateSlimit} defaultValue={30} />
        <Button type="link" onClick={() => addStockMonitors(sortedBankuais || bankuais)}>
          全部添加
        </Button>
      </div>
      <div className={classnames(styles.content, 'scroll-enabled')}>
        {sorting && <div>排序中...</div>}
        {(sortedBankuais || bankuais).length ? (
          <>
            {(sortedBankuais || bankuais).map((stock) => (
              <div key={stock.code}>
                <a onClick={() => openStock(stock.secid, stock.name, stock.zdf)}>
                  <label style={{ marginRight: 10, cursor: 'pointer', display: 'inline-block', width: 50 }}>{stock.name}</label>
                </a>
                {/* <span className={classnames(Utils.GetValueColor(stock.zdf).textClass)}>{stock.zx + '  '}</span> */}
                <div style={{ display: 'inline-block', float: 'right' }} className={classnames(Utils.GetValueColor(stock.zdf).textClass)}>
                  {Utils.Yang(stock.zdf)}% &nbsp;
                  <a onClick={() => addStockMonitors([stock])}>
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
          <div>无板块数据~</div>
        )}
      </div>
    </>
  );
});
