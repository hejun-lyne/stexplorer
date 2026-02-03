import React from 'react';
import { Row, Col, DatePicker, Select } from 'antd';
import styles from '../index.scss';
import * as Services from '@/services';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
import { useState } from 'react';
import { Stock } from '@/types/stock';
import { useRequest, useThrottleFn } from 'ahooks';
import { useCallback } from 'react';
import { useWorkDayTimeToDo } from '@/utils/hooks';
import moment from 'moment';
import classNames from 'classnames';

export interface CXListProps {
  industries: Stock.BanKuaiItem[];
  onOpenStock: (secid: string, name: string) => void;
  active: boolean;
}

const CXList: React.FC<CXListProps> = ({ industries, onOpenStock, active }) => {
  const [date, setDate] = useState(moment(new Date()).format('YYYYMMDD'));
  const [pageSize, setPageSize] = useState(20);
  const [noMore, setNoMore] = useState(false);
  const [stocks, setStocks] = useState<Stock.CXItem[]>([]);
  const [filterIndustry, setFilterIndustry] = useState<string>('');
  const { run: runGetStocks } = useRequest(Services.Stock.GeCXStocks, {
    throwOnError: true,
    manual: true,
    onSuccess: (data) => {
      if (data.arr) {
        setNoMore(data.to == data.arr.length);
        setStocks(data.arr.filter((_) => !_.secid.startsWith('688')));
      }
    },
  });
  const { run: mayGetStocks } = useThrottleFn(
    (ps: number, da: string) => {
      runGetStocks(ps, da);
    },
    {
      wait: 2000,
    }
  );
  useWorkDayTimeToDo(
    () => {
      mayGetStocks(pageSize, date);
    },
    active ? CONST.DEFAULT.STOCK_TREND_DELAY : null
  );
  const loadMore = useCallback(() => {
    const ps = pageSize + 20;
    setPageSize(ps);
    mayGetStocks(ps, date);
  }, [pageSize, date]);
  const onChangeDate = useCallback((d: moment.Moment | null) => {
    if (d) {
      const nd = d.format('YYYYMMDD');
      setDate(nd);
      // 重新请求数据
      setNoMore(false);
      setPageSize(20);
      mayGetStocks(20, nd);
    }
  }, []);
  return (
    <>
      <div className={styles.header}>
        <span>选择日期&nbsp;</span>
        <DatePicker onChange={onChangeDate} defaultValue={moment(new Date())} style={{ marginRight: 10 }} />
        <span>选择板块&nbsp;</span>
        <Select value={filterIndustry} onSelect={setFilterIndustry} style={{ width: 120 }}>
          <Select.Option value="">未选择</Select.Option>
          {industries.map((i) => (
            <Select.Option value={i.name} key={i.code}>
              {i.name}
            </Select.Option>
          ))}
        </Select>
      </div>
      <Row className={styles.header}>
        <Col span={2}>名字</Col>
        <Col span={2}>板块</Col>
        <Col span={2}>最新价</Col>
        <Col span={3}>涨跌幅</Col>
        <Col span={3}>流通市值</Col>
        <Col span={3}>换手率</Col>
        <Col span={3}>上市日期</Col>
        <Col span={3}>开板几日</Col>
        <Col span={3}>连板统计</Col>
      </Row>
      <div className={classNames(styles.table, styles.moreheader)}>
        {stocks
          .filter((s) => (filterIndustry == '' ? true : filterIndustry.indexOf(s.hybk) != -1))
          .map((s) => (
            <Row key={s.code} className={styles.row}>
              <Col span={2} style={{ cursor: 'pointer' }} onClick={() => onOpenStock(s.secid, s.name)}>
                {s.name}
              </Col>
              <Col span={2}>{s.hybk}</Col>
              <Col span={2} className={Utils.GetValueColor(s.zdf).textClass}>
                {(s.zx/1000).toFixed(2)}
              </Col>
              <Col span={3} className={Utils.GetValueColor(s.zdf).textClass}>
                {s.zdf.toFixed(2) + '%'}
              </Col>
              <Col span={3}>{(s.ltsz / 100000000).toFixed(2) + '亿'}</Col>
              <Col span={3}>{(s.hsl / 100).toFixed(2) + '%'}</Col>
              <Col span={3}>{s.ipod}</Col>
              <Col span={3}>{s.odays}</Col>
              <Col span={3}>{s.zttj.days + '天' + s.zttj.ct + '板'}</Col>
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

export default CXList;
