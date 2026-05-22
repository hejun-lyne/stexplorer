import React from 'react';
import { Row, Col, DatePicker, Select, Button, InputNumber, Checkbox } from 'antd';
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
  const [techFilterLoading, setTechFilterLoading] = useState(false);
  const [maResults, setMaResults] = useState<Record<string, { ma20: boolean; ma40: boolean; ma60: boolean }>>({});
  const [rsiResults, setRsiResults] = useState<Record<string, { rsi6: number; isOversold: boolean }>>({});
  const [techPending, setTechPending] = useState<Record<string, boolean>>({});
  const [maThreshold, setMaThreshold] = useState<number>(5);
  const [filterMA20, setFilterMA20] = useState(false);
  const [filterMA40, setFilterMA40] = useState(false);
  const [filterMA60, setFilterMA60] = useState(false);
  const [filterRSI, setFilterRSI] = useState(false);
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
      setMaResults({});
      setRsiResults({});
      setTechPending({});
      setFilterMA20(false);
      setFilterMA40(false);
      setFilterMA60(false);
      setFilterRSI(false);
      mayGetStocks(20, nd);
    }
  }, []);
  const onCalcTechIndicators = useCallback(async () => {
    if (stocks.length === 0) {
      return;
    }
    setTechFilterLoading(true);
    const secids = stocks.map((s) => s.secid);
    const pendingInit: Record<string, boolean> = {};
    secids.forEach((id) => {
      pendingInit[id] = true;
    });
    setTechPending(pendingInit);
    setMaResults({});
    setRsiResults({});

    const batchSize = 5;
    for (let i = 0; i < secids.length; i += batchSize) {
      const batch = secids.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (secid) => {
          const res = await Helpers.Stock.CheckStockMAAndRSI(secid, maThreshold / 100, 30);
          console.log('MA+RSI check', secid, res);
          return { secid, res };
        })
      );
      setMaResults((prev) => {
        const next = { ...prev };
        setRsiResults((rPrev) => {
          const rNext = { ...rPrev };
          setTechPending((pPrev) => {
            const pNext = { ...pPrev };
            batchResults.forEach(({ secid, res }) => {
              delete pNext[secid];
              if (res) {
                next[secid] = { ma20: res.ma20, ma40: res.ma40, ma60: res.ma60 };
                rNext[secid] = { rsi6: res.rsi6, isOversold: res.isOversold };
              } else {
                next[secid] = { ma20: false, ma40: false, ma60: false };
                rNext[secid] = { rsi6: 0, isOversold: false };
              }
            });
            return pNext;
          });
          return rNext;
        });
        return next;
      });
    }
    setTechFilterLoading(false);
    setTechPending({});
  }, [stocks, maThreshold]);
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
        <Button
          size="small"
          onClick={onCalcTechIndicators}
          loading={techFilterLoading}
          style={{ marginLeft: 8 }}
        >
          技术指标
        </Button>
        <InputNumber
          size="small"
          min={0.1}
          max={50}
          step={0.1}
          value={maThreshold}
          onChange={(v) => setMaThreshold(v || 5)}
          formatter={(value) => `${value}%`}
          parser={(value) => parseFloat(value?.replace('%', '') || '5')}
          style={{ width: 60, marginLeft: 4 }}
        />
      </div>
      <Row className={styles.header}>
        <Col span={2}>名字</Col>
        <Col span={2}>板块</Col>
        <Col span={2}>最新价</Col>
        <Col span={3}>涨跌幅</Col>
        <Col span={3}>流通市值</Col>
        <Col span={3}>换手率</Col>
        <Col span={3}>上市日期</Col>
        <Col span={2}>开板几日</Col>
        <Col span={2}>连板统计</Col>
        <Col span={1}><Checkbox checked={filterMA20} onChange={(e) => setFilterMA20(e.target.checked)} style={{ color: '#fff' }}>MA20</Checkbox></Col>
        <Col span={1}><Checkbox checked={filterMA40} onChange={(e) => setFilterMA40(e.target.checked)} style={{ color: '#fff' }}>MA40</Checkbox></Col>
        <Col span={1}><Checkbox checked={filterMA60} onChange={(e) => setFilterMA60(e.target.checked)} style={{ color: '#fff' }}>MA60</Checkbox></Col>
        <Col span={1}><Checkbox checked={filterRSI} onChange={(e) => setFilterRSI(e.target.checked)} style={{ color: '#fff' }}>RSI6</Checkbox></Col>
      </Row>
      <div className={classNames(styles.table, styles.moreheader)}>
        {stocks
          .filter((s) => (filterIndustry == '' ? true : filterIndustry.indexOf(s.hybk) != -1))
          .filter((s) => {
            if (!filterMA20 && !filterMA40 && !filterMA60 && !filterRSI) return true;
            if (filterMA20 && maResults[s.secid] && !maResults[s.secid].ma20) return false;
            if (filterMA40 && maResults[s.secid] && !maResults[s.secid].ma40) return false;
            if (filterMA60 && maResults[s.secid] && !maResults[s.secid].ma60) return false;
            if (filterRSI && rsiResults[s.secid] && !rsiResults[s.secid].isOversold) return false;
            return true;
          })
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
              <Col span={2}>{s.ipod}</Col>
              <Col span={2}>{s.odays}</Col>
              <Col span={2}>{s.zttj.days + '天' + s.zttj.ct + '板'}</Col>
              <Col span={1}>{techPending[s.secid] ? '分析中' : maResults[s.secid] ? (maResults[s.secid].ma20 ? '✓' : '✗') : ''}</Col>
              <Col span={1}>{techPending[s.secid] ? '分析中' : maResults[s.secid] ? (maResults[s.secid].ma40 ? '✓' : '✗') : ''}</Col>
              <Col span={1}>{techPending[s.secid] ? '分析中' : maResults[s.secid] ? (maResults[s.secid].ma60 ? '✓' : '✗') : ''}</Col>
              <Col span={1}>{techPending[s.secid] ? '分析中' : rsiResults[s.secid] ? (rsiResults[s.secid].isOversold ? '✓' : '✗') : ''}</Col>
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
