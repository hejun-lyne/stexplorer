import React, { useEffect, useLayoutEffect } from 'react';
import { Button, List, Row, Col, Radio, Select, Checkbox, InputNumber, Input, Pagination } from 'antd';
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
import { batch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { CaretDownOutlined, CaretRightOutlined, CaretUpOutlined } from '@ant-design/icons';

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
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [fdays, setFdays] = useState(8);
  const [filtering, setFiltering] = useState(false);
  const [ftypes, setFtypes] = useState<number[]>([]);
  const [filterSecids, setFilterSecids] = useState<string[]>([]);
  const [nameFilter, setNameFilter] = useState('');
  const [sortTypes, setSortTypes] = useState<Record<string, number>>({});
  const [showList, setShowList] = useState<Stock.DetailItem[]>([]);
  const { kLineApiSourceSetting } = useSelector((state: StoreState) => state.setting.systemSetting);
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
  const { run: runGetStocks } = useRequest(Services.Stock.GetBankuaiStocksFromDataSource, {
    throwOnError: true,
    manual: true,
    onSuccess: (data) => {
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
    (source: number, secid: string, ps: number) => {
      if (secid.length > 0) {
        runGetStocks(source, secid, ps);
      }
    },
    {
      wait: 2000,
    }
  );
  useWorkDayTimeToDo(
    () => {
      mayGetStocks(kLineApiSourceSetting, secid, 200);
    },
    active ? CONST.DEFAULT.STOCK_TREND_DELAY : null
  );
  const onPageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const changeSecid = useCallback(
    (t: BKType, s: string) => {
      if (s === secid) {
        return;
      }
      // 刷新数据
      setCurrentPage(1);
      // mayGetStocks(s, pageSize);
      onChangeBK(t, s);
    },
    [secid]
  );

  useEffect(() => {
    mayGetStocks(kLineApiSourceSetting, secid, 200);
  }, [secid, kLineApiSourceSetting]);

  const updateFtypes = useCallback(
    (ts: any[]) => {
      setFtypes(ts);
      setCurrentPage(1);
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

  const sortItems = useCallback((items: Stock.DetailItem[], key: string, t: number) => {
    if (t == 0) {
      return items;
    }
    const arr = [...items];
    arr.sort((a, b) => {
      const left = (a as any)[key];
      const right = (b as any)[key];
      if (t == 1) {
        return left - right;
      } else {
        return right - left;
      }
    });
    return arr;
  }, []);

  const updateSortType = useCallback((key: string) => {
    let type = sortTypes[key] || 0;
    type = type == 0 ? 1 : type == 1 ? 2 : 0;
    setSortTypes({ [key]: type });
  }, [sortTypes]);

  useLayoutEffect(() => {
    let list = filterStocks.filter((s) => {
      if (nameFilter && !s.name.includes(nameFilter)) return false;
      return true;
    });
    const keys = Object.keys(sortTypes);
    if (keys.length === 1) {
      list = sortItems(list, keys[0], sortTypes[keys[0]]);
    }
    setShowList(list);
    setCurrentPage(1);
  }, [filterStocks, sortTypes, nameFilter, sortItems]);
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
          <Input size="small" placeholder="名字过滤" value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} style={{ width: 100, marginRight: 8 }} />
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
        <Col span={4}>
          涨跌幅
          <Button size="small" type="text" icon={sortTypes.zdf == 1 ? <CaretUpOutlined /> : sortTypes.zdf == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('zdf')} />
        </Col>
        <Col span={4}>
          流通市值
          <Button size="small" type="text" icon={sortTypes.lt == 1 ? <CaretUpOutlined /> : sortTypes.lt == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('lt')} />
        </Col>
        <Col span={4}>
          换手率
          <Button size="small" type="text" icon={sortTypes.hsl == 1 ? <CaretUpOutlined /> : sortTypes.hsl == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('hsl')} />
        </Col>
      </Row>
      <div className={classNames(styles.table, styles.moreheader)}>
        {showList.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((s) => (
          <Row key={s.code} className={styles.row}>
            <Col span={4} style={{ cursor: 'pointer' }} onClick={() => onOpenStock(s.secid, s.name)}>
              {s.name}
            </Col>
            <Col span={4} className={Utils.GetValueColor(s.zdd).textClass}>
              {s.zx.toFixed(2)}
            </Col>
            <Col span={4} className={Utils.GetValueColor(s.zdd).textClass}>
              {(s.zdd).toFixed(2)}
            </Col>
            <Col span={4} className={Utils.GetValueColor(s.zdf).textClass}>
              {s.zdf.toFixed(2) + '%'}
            </Col>
            <Col span={4}>{(s.lt).toFixed(2) + '亿'}</Col>
            <Col span={4}>{(s.hsl).toFixed(2) + '%'}</Col>
          </Row>
        ))}
        <Pagination
          current={currentPage}
          pageSize={pageSize}
          total={showList.length}
          onChange={onPageChange}
          showSizeChanger={false}
          size="small"
          style={{ padding: '10px 0', textAlign: 'center' }}
        />
      </div>
    </>
  );
};

export default STList;
