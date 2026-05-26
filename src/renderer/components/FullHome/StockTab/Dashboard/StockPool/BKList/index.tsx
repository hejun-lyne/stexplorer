import React, { useEffect, useMemo } from 'react';
import { Button, List, Row, Col, Tooltip, Select, InputNumber, Checkbox, Input } from 'antd';
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
// import { useWorkDayTimeToDo } from '@/utils/hooks';
import { useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { CaretDownOutlined, CaretRightOutlined, CaretUpOutlined } from '@ant-design/icons';

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
  const [nameFilter, setNameFilter] = useState('');
  const [sortTypes, setSortTypes] = useState<Record<string, number>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [showList, setShowList] = useState<Stock.BanKuaiItem[]>([]);
  const PAGE_SIZE = 50;
  const { kLineApiSourceSetting } = useSelector((state: StoreState) => state.setting.systemSetting);
  const { run: runGetBankuais } = useRequest(Services.Stock.GetBanKuaisFromDataSource, {
    throwOnError: true,
    manual: true,
    onSuccess: (d: { to: number; arr: Stock.BanKuaiItem[] }) => {
      setNoMore(d.to === d.arr.length);
      setBankuais(d.arr);
      onBankuaisUpdate(type, d.arr);
    },
  });
  const mayGetBankuais = useCallback((source: number, t: BKType, ps: number) => {
    runGetBankuais(source, t, ps);
  }, []);

  // 1. 修复 updateSortType：使用函数式更新消除闭包陷阱，并切排序时回到第1页
  // 格式化资金流向金额（元 -> 亿/万）
  const formatMoneyFlow = (val: number) => {
    const v = Number(val) || 0;
    if (Math.abs(v) >= 1e8) {
      return (v / 1e8).toFixed(2) + '亿';
    }
    if (Math.abs(v) >= 1e4) {
      return (v / 1e4).toFixed(2) + '万';
    }
    return v.toFixed(0);
  };

  const updateSortType = useCallback((key: string) => {
    setSortTypes((prev) => {
      const current = prev[key] || 0;
      const nextType = current === 0 ? 1 : current === 1 ? 2 : 0;
      // 如果切回0（取消排序），直接清空对象，避免残留旧key干扰
      return nextType === 0 ? {} : { [key]: nextType };
    });
    setCurrentPage(1);
  }, []);

  useEffect(() => {
    let list = bankuais.filter((b) => {
      if (nameFilter && !b.name.includes(nameFilter)) return false;
      if (!filterMA20 && !filterMA40 && !filterMA60 && !filterRSI) return true;
      if (filterMA20 && maResults[b.secid] && !maResults[b.secid].ma20) return false;
      if (filterMA40 && maResults[b.secid] && !maResults[b.secid].ma40) return false;
      if (filterMA60 && maResults[b.secid] && !maResults[b.secid].ma60) return false;
      if (filterRSI && rsiResults[b.secid] && !rsiResults[b.secid].isOversold) return false;
      return true;
    });
    const keys = Object.keys(sortTypes);
    if (keys.length === 1) {
      const key = keys[0];
      const t = sortTypes[key];
      if (t !== 0) {
        list = [...list].sort((a, b) => {
          let left = 0, right = 0;
          if (key === 'szbl') {
            const totalA = (Number(a.szs) || 0) + (Number(a.xds) || 0);
            const totalB = (Number(b.szs) || 0) + (Number(b.xds) || 0);
            left = totalA > 0 ? (Number(a.szs) || 0) / totalA : 0;
            right = totalB > 0 ? (Number(b.szs) || 0) / totalB : 0;
          } else {
            left = Number((a as any)[key]) || 0;
            right = Number((b as any)[key]) || 0;
          }
          if (left === right) return 0;
          if (t == 1) {
            return left > right ? 1 : -1;
          } else {
            return left < right ? 1 : -1;
          }
        });
      }
    }
    setShowList(list);
  }, [bankuais, sortTypes, nameFilter, filterMA20, filterMA40, filterMA60, filterRSI, maResults, rsiResults]);

  const totalPage = Math.max(1, Math.ceil(showList.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPage);
  const pageData = showList.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    if (currentPage > totalPage) {
      setCurrentPage(totalPage);
    }
  }, [totalPage, currentPage]);

  // useWorkDayTimeToDo(() => mayGetBankuais(kLineApiSourceSetting, type, pageSize), active ? CONST.DEFAULT.STOCK_TREND_DELAY : null);
  useEffect(() => {
    setCurrentPage(1);
    runGetBankuais(kLineApiSourceSetting, type, pageSize);
  }, [kLineApiSourceSetting, type]);
  const loadMore = useCallback(() => {
    const ps = pageSize + 40;
    setPageSize(ps);
    mayGetBankuais(kLineApiSourceSetting, type, ps);
  }, [kLineApiSourceSetting, type, pageSize]);

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
      <div className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Input
            size="small"
            placeholder="名字过滤"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            style={{ width: 100, marginRight: 8 }}
          />
          <Button
            size="small"
            type="primary"
            onClick={() => runGetBankuais(kLineApiSourceSetting, type, pageSize)}
          >
            刷新
          </Button>
          <Button
            size="small"
            onClick={onCalcTechIndicators}
            loading={techFilterLoading}
            style={{ marginLeft: 4 }}
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
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Button size="small" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>上一页</Button>
          <span style={{ margin: '0 8px', color: 'var(--main-text-color)' }}>{safePage} / {totalPage}</span>
          <Button size="small" onClick={() => setCurrentPage((p) => Math.min(totalPage, p + 1))} disabled={safePage >= totalPage}>下一页</Button>
          {!noMore && (
            <Button size="small" onClick={loadMore} style={{ marginLeft: 8 }}>加载更多</Button>
          )}
        </div>
      </div>
      <Row className={styles.header}>
        <Col span={3}>名字</Col>
        <Col span={3}>
          涨跌幅
          <Button size="small" type="text" icon={sortTypes.zdf == 1 ? <CaretUpOutlined /> : sortTypes.zdf == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('zdf')} />
        </Col>
        <Col span={3}>
          换手率
          <Button size="small" type="text" icon={sortTypes.hsl == 1 ? <CaretUpOutlined /> : sortTypes.hsl == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('hsl')} />
        </Col>
        <Col span={3}>
          上涨家数
          <Button size="small" type="text" icon={sortTypes.szs == 1 ? <CaretUpOutlined /> : sortTypes.szs == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('szs')} />
        </Col>
        <Col span={3}>
          下跌家数
          <Button size="small" type="text" icon={sortTypes.xds == 1 ? <CaretUpOutlined /> : sortTypes.xds == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('xds')} />
        </Col>
        <Col span={3}>
          上涨比例
          <Button size="small" type="text" icon={sortTypes.szbl == 1 ? <CaretUpOutlined /> : sortTypes.szbl == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('szbl')} />
        </Col>
        <Col span={3}>
          今日主力净流入
          <Button size="small" type="text" icon={sortTypes.mainIn == 1 ? <CaretUpOutlined /> : sortTypes.mainIn == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('mainIn')} />
        </Col>
        <Col span={3}>
          5日主力净流入
          <Button size="small" type="text" icon={sortTypes.mainIn5d == 1 ? <CaretUpOutlined /> : sortTypes.mainIn5d == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('mainIn5d')} />
        </Col>
        <Col span={2}><Checkbox checked={filterMA20} onChange={(e) => setFilterMA20(e.target.checked)} style={{ color: '#fff' }}>MA20</Checkbox></Col>
        <Col span={2}><Checkbox checked={filterMA40} onChange={(e) => setFilterMA40(e.target.checked)} style={{ color: '#fff' }}>MA40</Checkbox></Col>
        <Col span={2}><Checkbox checked={filterMA60} onChange={(e) => setFilterMA60(e.target.checked)} style={{ color: '#fff' }}>MA60</Checkbox></Col>
        <Col span={2}><Checkbox checked={filterRSI} onChange={(e) => setFilterRSI(e.target.checked)} style={{ color: '#fff' }}>RSI6</Checkbox></Col>
      </Row>
      <div className={styles.table}>
        <div className={styles.table}>
        {pageData.map((b, index) => (
          <Row key={`${b.code}-${index}`} className={styles.row}>
            <Col span={3} style={{ cursor: 'pointer' }} onClick={() => onOpenBKStocks(type, b.secid)}>
              {b.name}
            </Col>
            <Col span={3} className={Utils.GetValueColor(b.zdf).textClass} onClick={() => onOpenBK(b.secid, b.name)}>
              {!isNaN(b.zdf) ? b.zdf.toFixed(2) + '%' : '--'}
            </Col>
            <Col span={3}>{isNaN(b.hsl) ? '--' : parseFloat(b.hsl).toFixed(2) + '%'}</Col>
            <Col span={3} className="text-up">{b.szs}</Col>
            <Col span={3} className="text-down">{b.xds}</Col>
            <Col span={3} className={Utils.GetValueColor(b.szs - b.xds).textClass}>
              {((b.szs / (b.szs + b.xds)) * 100).toFixed(2) + '%'}
            </Col>
            <Col span={3} className={Utils.GetValueColor(b.mainIn).textClass}>
              {formatMoneyFlow(b.mainIn)}
            </Col>
            <Col span={3} className={Utils.GetValueColor(b.mainIn5d).textClass}>
              {formatMoneyFlow(b.mainIn5d)}
            </Col>
            <Col span={2}>{techPending[b.secid] ? '分析中' : maResults[b.secid] ? (maResults[b.secid].ma20 ? '✓' : '✗') : ''}</Col>
            <Col span={2}>{techPending[b.secid] ? '分析中' : maResults[b.secid] ? (maResults[b.secid].ma40 ? '✓' : '✗') : ''}</Col>
            <Col span={2}>{techPending[b.secid] ? '分析中' : maResults[b.secid] ? (maResults[b.secid].ma60 ? '✓' : '✗') : ''}</Col>
            <Col span={2}>{techPending[b.secid] ? '分析中' : rsiResults[b.secid] ? (rsiResults[b.secid].isOversold ? '✓' : '✗') : ''}</Col>
          </Row>
        ))}
        {/* ...分页按钮... */}
        </div>
      </div>
    </>
  );
};

export default BKList;
