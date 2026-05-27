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

export interface DTListProps {
  industries: Stock.BanKuaiItem[];
  onOpenStock: (secid: string, name: string) => void;
  active: boolean;
}

const DTList: React.FC<DTListProps> = ({ industries, onOpenStock, active }) => {
  const [date, setDate] = useState(moment(new Date()).format('YYYYMMDD'));
  const [pageSize, setPageSize] = useState(20);
  const [noMore, setNoMore] = useState(false);
  const [stocks, setStocks] = useState<Stock.DTItem[]>([]);
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
  const [techProgress, setTechProgress] = useState(0);
  const isPausedRef = React.useRef(false);
  const currentIndexRef = React.useRef(0);
  const { run: runGetStocks } = useRequest(Services.Stock.GeDTStocks, {
    throwOnError: true,
    manual: true,
    onSuccess: (data) => {
      if (data.arr) {
        setNoMore(data.to == data.arr.length);
        setStocks(data.arr);
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
      currentIndexRef.current = 0;
      setTechProgress(0);
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
    if (techFilterLoading) {
      isPausedRef.current = true;
      return;
    }
    if (stocks.length === 0) return;
    const secids = stocks.map((s) => s.secid);

    if (currentIndexRef.current === 0 || currentIndexRef.current >= secids.length) {
      setMaResults({});
      setRsiResults({});
      currentIndexRef.current = 0;
    }

    isPausedRef.current = false;
    setTechFilterLoading(true);
    setTechProgress(Math.round((currentIndexRef.current / secids.length) * 100));

    const pendingInit: Record<string, boolean> = {};
    for (let j = currentIndexRef.current; j < secids.length; j++) {
      pendingInit[secids[j]] = true;
    }
    setTechPending(pendingInit);

    const batchSize = 5;
    for (let i = currentIndexRef.current; i < secids.length; i += batchSize) {
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
      currentIndexRef.current = i + batch.length;
      setTechProgress(Math.round((currentIndexRef.current / secids.length) * 100));

      if (isPausedRef.current) {
        break;
      }
    }

    if (!isPausedRef.current) {
      currentIndexRef.current = 0;
      setTechProgress(100);
    }
    setTechFilterLoading(false);
    if (!isPausedRef.current) {
      setTechPending({});
    }
  }, [stocks, maThreshold, techFilterLoading]);

  const doQuery = useCallback(() => {
    currentIndexRef.current = 0;
    setTechProgress(0);
    setPageSize(20);
    setMaResults({});
    setRsiResults({});
    setTechPending({});
    setFilterMA20(false);
    setFilterMA40(false);
    setFilterMA60(false);
    setFilterRSI(false);
    mayGetStocks(20, date);
  }, [date]);
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
        <Button type="primary" onClick={doQuery} style={{ marginRight: 8 }}>
          查询
        </Button>
        <Button
          size="small"
          onClick={onCalcTechIndicators}
          loading={techFilterLoading && techProgress === 0}
        >
          {techFilterLoading ? `分析中 ${techProgress}%` : '技术指标'}
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
        <Col span={2}>涨跌幅</Col>
        <Col span={3}>流通市值</Col>
        <Col span={2}>换手率</Col>
        <Col span={3}>封板时间</Col>
        <Col span={2}>开板次数</Col>
        <Col span={2}>板上成交额</Col>
        <Col span={1}>封单资金</Col>
        <Col span={1}>资金比例</Col>
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
                {s.zx.toFixed(2)}
              </Col>
              <Col span={2} className={Utils.GetValueColor(s.zdf).textClass}>
                {s.zdf.toFixed(2) + '%'}
              </Col>
              <Col span={3}>{(s.ltsz / 100000000).toFixed(2) + '亿'}</Col>
              <Col span={2}>{(s.hsl / 100).toFixed(2) + '%'}</Col>
              <Col span={3}>{s.lbt}</Col>
              <Col span={2}>{s.oc}</Col>
              <Col span={2}>
                {s.fba > 100000000
                  ? (s.fba / 100000000).toFixed(2) + '亿'
                  : s.fba > 10000000
                    ? (s.fba / 10000000).toFixed(2) + '千万'
                    : (s.fba / 10000).toFixed(2) + '万'}
              </Col>
              <Col span={1}>
                {s.fbf > 100000000
                  ? (s.fbf / 100000000).toFixed(2) + '亿'
                  : s.fbf > 10000000
                    ? (s.fbf / 10000000).toFixed(2) + '千万'
                    : (s.fbf / 10000).toFixed(2) + '万'}
              </Col>
              <Col span={1}>{((s.fbf / s.ltsz) * 100).toFixed(2) + '%'}</Col>
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

export default DTList;
