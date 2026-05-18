import React, { useEffect } from 'react';
import { Button, List, Row, Col, Tooltip, Select, InputNumber, Checkbox } from 'antd';
import styles from '../index.scss';
import * as Services from '@/services';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
import * as Helpers from '@/helpers';
import { useState } from 'react';
import { BKType } from '@/utils/enums';
import { Stock } from '@/types/stock';
import { useRequest } from 'ahooks';
import { useCallback } from 'react';
import { useWorkDayTimeToDo } from '@/utils/hooks';

export interface BKListProps {
  type: BKType;
  onBankuaisUpdate: (t: BKType, bks: Stock.BanKuaiItem[]) => void;
  onOpenBKStocks: (t: BKType, s: string) => void;
  onOpenBK: (s: string, name: string) => void;
  active: boolean;
}

const BKList: React.FC<BKListProps> = ({ type, onBankuaisUpdate, onOpenBKStocks, onOpenBK, active }) => {
  const [pageSize, setPageSize] = useState(100);
  const [noMore, setNoMore] = useState(false);
  const [bankuais, setBankuais] = useState<Stock.BanKuaiItem[]>([]);
  const [techFilterLoading, setTechFilterLoading] = useState(false);
  const [maResults, setMaResults] = useState<Record<string, { ma20: boolean; ma40: boolean; ma60: boolean }>>({});
  const [rsiResults, setRsiResults] = useState<Record<string, { rsi6: number; isOversold: boolean }>>({});
  const [techPending, setTechPending] = useState<Record<string, boolean>>({});
  const [maThreshold, setMaThreshold] = useState<number>(5);
  const [filterMA20, setFilterMA20] = useState(false);
  const [filterMA40, setFilterMA40] = useState(false);
  const [filterMA60, setFilterMA60] = useState(false);
  const [filterRSI, setFilterRSI] = useState(false);
  const { run: runGetBankuais } = useRequest(Services.Stock.GetBanKuais, {
    throwOnError: true,
    manual: true,
    onSuccess: (d: { to: number; arr: Stock.BanKuaiItem[] }) => {
      setNoMore(d.to === d.arr.length);
      setBankuais(d.arr);
      onBankuaisUpdate(type, d.arr);
    },
  });
  const mayGetBankuais = useCallback((t: BKType, ps: number) => {
    runGetBankuais(t, ps);
  }, []);
  useWorkDayTimeToDo(() => mayGetBankuais(type, pageSize), active ? CONST.DEFAULT.STOCK_TREND_DELAY : null);
  useEffect(() => {
    runGetBankuais(type, pageSize);
  }, []);
  const loadMore = useCallback(() => {
    const ps = pageSize + 40;
    setPageSize(ps);
    mayGetBankuais(type, ps);
  }, [type, pageSize]);

  const onCalcTechIndicators = useCallback(async () => {
    if (bankuais.length === 0) {
      return;
    }
    setTechFilterLoading(true);
    const secids = bankuais.map((s) => s.secid);
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
  }, [bankuais, maThreshold]);

  return (
    <>
      <div className={styles.header}>
        <Button
          size="small"
          onClick={onCalcTechIndicators}
          loading={techFilterLoading}
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
        <Col span={3}>名字</Col>
        <Col span={3}>最新价</Col>
        <Col span={2}>涨跌额</Col>
        <Col span={2}>涨跌幅</Col>
        <Col span={3}>总市值</Col>
        <Col span={2}>换手率</Col>
        <Col span={2}>上涨家数</Col>
        <Col span={2}>下跌家数</Col>
        <Col span={2}>上涨比例</Col>
        <Col span={1}><Checkbox checked={filterMA20} onChange={(e) => setFilterMA20(e.target.checked)} style={{ color: '#fff' }}>MA20</Checkbox></Col>
        <Col span={1}><Checkbox checked={filterMA40} onChange={(e) => setFilterMA40(e.target.checked)} style={{ color: '#fff' }}>MA40</Checkbox></Col>
        <Col span={1}><Checkbox checked={filterMA60} onChange={(e) => setFilterMA60(e.target.checked)} style={{ color: '#fff' }}>MA60</Checkbox></Col>
        <Col span={1}><Checkbox checked={filterRSI} onChange={(e) => setFilterRSI(e.target.checked)} style={{ color: '#fff' }}>RSI6</Checkbox></Col>
      </Row>
      <div className={styles.table}>
        {bankuais
          .filter((b) => {
            if (!filterMA20 && !filterMA40 && !filterMA60 && !filterRSI) return true;
            if (filterMA20 && maResults[b.secid] && !maResults[b.secid].ma20) return false;
            if (filterMA40 && maResults[b.secid] && !maResults[b.secid].ma40) return false;
            if (filterMA60 && maResults[b.secid] && !maResults[b.secid].ma60) return false;
            if (filterRSI && rsiResults[b.secid] && !rsiResults[b.secid].isOversold) return false;
            return true;
          })
          .map((b) => (
          <Row key={b.code} className={styles.row}>
            <Col span={3} style={{ cursor: 'pointer' }} onClick={() => onOpenBK(b.secid, b.name)}>
              {b.name}
            </Col>
            <Col span={3} className={Utils.GetValueColor(b.zdd).textClass}>
              {!isNaN(b.zx) ? b.zx.toFixed(2) : '--'}
            </Col>
            <Col span={2} className={Utils.GetValueColor(b.zdd).textClass}>
              {!isNaN(b.zdd) ? b.zdd.toFixed(2) : '--'}
            </Col>
            <Col span={2} className={Utils.GetValueColor(b.zdd).textClass}>
              {!isNaN(b.zdf) ? b.zdf.toFixed(2) + '%' : '--'}
            </Col>
            <Col span={3}>{!isNaN(b.zsz) ? (b.zsz / 100000000).toFixed(2) + ' 亿' : '--'}</Col>
            <Col span={2}>{isNaN(b.hsl) ? '--' : parseFloat(b.hsl).toFixed(2) + '%'}</Col>
            <Col span={2} className="text-up">
              {b.szs}
            </Col>
            <Col span={2} className="text-down">
              {b.xds}
            </Col>
            <Col span={2} className={Utils.GetValueColor(b.szs - b.xds).textClass}>
              {((b.szs / (b.szs + b.xds)) * 100).toFixed(2) + '%'}
            </Col>
            <Col span={3} style={{ cursor: 'pointer' }} onClick={() => onOpenBKStocks(type, b.secid)}>
              <a>列表</a>
            </Col>
            <Col span={1}>{techPending[b.secid] ? '分析中' : maResults[b.secid] ? (maResults[b.secid].ma20 ? '✓' : '✗') : ''}</Col>
            <Col span={1}>{techPending[b.secid] ? '分析中' : maResults[b.secid] ? (maResults[b.secid].ma40 ? '✓' : '✗') : ''}</Col>
            <Col span={1}>{techPending[b.secid] ? '分析中' : maResults[b.secid] ? (maResults[b.secid].ma60 ? '✓' : '✗') : ''}</Col>
            <Col span={1}>{techPending[b.secid] ? '分析中' : rsiResults[b.secid] ? (rsiResults[b.secid].isOversold ? '✓' : '✗') : ''}</Col>
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

export default BKList;
