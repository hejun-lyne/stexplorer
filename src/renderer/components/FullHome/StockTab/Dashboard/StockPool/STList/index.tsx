import React, { useEffect } from 'react';
import { Button, List, Row, Col, Radio, Select, Checkbox, InputNumber } from 'antd';
import styles from '../index.scss';
import * as Services from '@/services';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
import * as Helpers from '@/helpers';
import { useState } from 'react';
import { Stock } from '@/types/stock';
import { useRequest, useThrottleFn } from 'ahooks';
import { useCallback } from 'react';
import { useWorkDayTimeToDo } from '@/utils/hooks';
import { BKType, KFilterType, KFilterTypeNames } from '@/utils/enums';
import classNames from 'classnames';
import { batch } from 'react-redux';

export interface STListProps {
  industries: Stock.BanKuaiItem[];
  gainians: Stock.BanKuaiItem[];
  bktype: BKType;
  secid: string;
  onChangeBK: (t: BKType, s: string) => void;
  onOpenStock: (secid: string, name: string) => void;
  active: boolean;
}

const STList: React.FC<STListProps> = ({ industries, gainians, bktype, secid, onChangeBK, onOpenStock, active }) => {
  const [pageSize, setPageSize] = useState(40);
  const [noMore, setNoMore] = useState(false);
  const [fdays, setFdays] = useState(8);
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
  const [stocks, setStocks] = useState<Stock.DetailItem[]>([]);
  const { run: runGetStocks } = useRequest(Services.Stock.GetBankuaiStocksFromEastmoney, {
    throwOnError: true,
    manual: true,
    onSuccess: (data) => {
      setNoMore(data.total == data.stocks.length);
      setStocks(data.stocks as Stock.DetailItem[]);
      if (ftypes.length > 0) {
        setFiltering(true);
        runFilterStocks(
          data.stocks.map((s) => s.secid),
          ftypes,
          fdays
        );
      }
    },
  });
  const { run: mayGetStocks } = useThrottleFn(
    (secid: string, ps: number) => {
      if (secid.length > 0) {
        runGetStocks(secid, ps);
      }
    },
    {
      wait: 2000,
    }
  );
  useWorkDayTimeToDo(
    () => {
      mayGetStocks(secid, pageSize);
    },
    active ? CONST.DEFAULT.STOCK_TREND_DELAY : null
  );
  const loadMore = useCallback(() => {
    const ps = pageSize + 40;
    setPageSize(ps);
    mayGetStocks(secid, ps);
  }, [pageSize, secid]);

  const changeSecid = useCallback(
    (t: BKType, s: string) => {
      if (s === secid) {
        return;
      }
      // 刷新数据
      setNoMore(false);
      setPageSize(20);
      // mayGetStocks(s, pageSize);
      onChangeBK(t, s);
    },
    [secid, pageSize]
  );

  useEffect(() => {
    mayGetStocks(secid, pageSize);
  }, [secid]);

  const updateFtypes = useCallback(
    (ts: any[]) => {
      setFtypes(ts);
      if (ts.length && stocks.length) {
        setFiltering(true);
        runFilterStocks(
          stocks.map((s) => s.secid),
          ts,
          fdays
        );
      }
    },
    [stocks]
  );
  const filterStocks = ftypes.length ? stocks.filter((s) => filterSecids.indexOf(s.secid) != -1) : stocks;
  return (
    <>
      <div className={classNames(styles.header, styles.actbar)}>
        <div>
          <Select
            value={bktype}
            onSelect={(v) => changeSecid(v, v === BKType.Industry ? industries[0].secid : gainians[0].secid)}
            style={{ marginRight: 10 }}
          >
            <Select.Option value={BKType.Industry}>行业板块</Select.Option>
            <Select.Option value={BKType.Gainian}>概念板块</Select.Option>
          </Select>
          {bktype === BKType.Industry && (
            <Select value={secid} onSelect={(v) => changeSecid(BKType.Industry, v)} style={{ width: 120 }}>
              <Select.Option value="">未选择</Select.Option>
              {industries.map((i) => (
                <Select.Option value={i.secid} key={i.code}>
                  {i.name}
                </Select.Option>
              ))}
            </Select>
          )}
          {bktype === BKType.Gainian && (
            <Select value={secid} onSelect={(v) => changeSecid(BKType.Gainian, v)}>
              <Select.Option value="">未选择</Select.Option>
              {gainians.map((i) => (
                <Select.Option value={i.secid} key={i.code}>
                  {i.name}
                </Select.Option>
              ))}
            </Select>
          )}
        </div>
        <div>
          <InputNumber step={1} onChange={setFdays} min={1} defaultValue={8} style={{ width: 60 }} />
          <span>天</span>&nbsp;
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
          &nbsp;
          {filtering && <span>筛选中...</span>}
        </div>
      </div>
      <Row className={styles.header}>
        <Col span={4}>名字</Col>
        <Col span={4}>最新价</Col>
        <Col span={4}>涨跌额</Col>
        <Col span={4}>涨跌幅</Col>
        <Col span={4}>流通市值</Col>
        <Col span={4}>换手率</Col>
      </Row>
      <div className={classNames(styles.table, styles.moreheader)}>
        {filterStocks.map((s) => (
          <Row key={s.code} className={styles.row}>
            <Col span={4} style={{ cursor: 'pointer' }} onClick={() => onOpenStock(s.secid, s.name)}>
              {s.name}
            </Col>
            <Col span={4} className={Utils.GetValueColor(s.zdd).textClass}>
              {s.zx.toFixed(2)}
            </Col>
            <Col span={4} className={Utils.GetValueColor(s.zdd).textClass}>
              {(s.zdd / 100).toFixed(2)}
            </Col>
            <Col span={4} className={Utils.GetValueColor(s.zdf).textClass}>
              {s.zdf.toFixed(2) + '%'}
            </Col>
            <Col span={4}>{(s.lt / 100000000).toFixed(2) + '亿'}</Col>
            <Col span={4}>{(s.hsl / 100).toFixed(2) + '%'}</Col>
          </Row>
        ))}
        {!noMore && (
          <div className={styles.loadmore} onClick={loadMore}>
            <span>加载更多</span>
          </div>
        )}
      </div>
    </>
  );
};

export default STList;
