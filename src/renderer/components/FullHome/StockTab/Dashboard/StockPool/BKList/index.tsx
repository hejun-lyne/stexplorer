import React, { useEffect } from 'react';
import { Button, List, Row, Col, Tooltip, Select } from 'antd';
import styles from '../index.scss';
import * as Services from '@/services';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
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
  return (
    <>
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
        <Col span={3}></Col>
      </Row>
      <div className={styles.table}>
        {bankuais.map((b) => (
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
