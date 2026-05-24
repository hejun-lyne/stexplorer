import React, { useCallback, useMemo, useState } from 'react';
import { Row, Col, InputNumber, Button } from 'antd';
import styles from '../index.scss';
import { Stock } from '@/types/stock';
import { useSelector, useDispatch } from 'react-redux';
import { StoreState } from '@/reducers/types';
import * as Utils from '@/utils';
import { StrategyTypeNames } from '@/utils/enums';
import { setSystemSettingAction } from '@/actions/setting';

export interface HoldViewProps {
  onOpenStock: (secid: string, name: string) => void;
}

const HoldView: React.FC<HoldViewProps> = ({ onOpenStock }) => {
  const dispatch = useDispatch();
  const nowHolds = useSelector((state: StoreState) => state.stock.nowHolds);
  const stocksMapping = useSelector((state: StoreState) => state.stock.stocksMapping);
  const systemSetting = useSelector((state: StoreState) => state.setting.systemSetting);
  const initialCapital = systemSetting.initialCapital || 100000;

  const [editingCapital, setEditingCapital] = useState<number | null>(null);

  const holds = useMemo(() => {
    return [...nowHolds].sort((a, b) => (a.lastBuyDate > b.lastBuyDate ? -1 : 1));
  }, [nowHolds]);

  const totalCost = useMemo(() => {
    return holds.reduce((sum, h) => sum + Number(h.price) * Number(h.count), 0);
  }, [holds]);

  const totalMarketValue = useMemo(() => {
    return holds.reduce((sum, h) => {
      const zx = stocksMapping[h.secid]?.detail?.zx ?? NaN;
      return sum + (isNaN(zx) ? Number(h.price) * Number(h.count) : zx * Number(h.count));
    }, 0);
  }, [holds, stocksMapping]);

  const totalProfit = useMemo(() => {
    return holds.reduce((sum, h) => {
      const zx = stocksMapping[h.secid]?.detail?.zx ?? NaN;
      return sum + (isNaN(zx) ? 0 : (zx - Number(h.price)) * Number(h.count));
    }, 0);
  }, [holds, stocksMapping]);

  const totalProfitRatio = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
  const investedRatio = initialCapital > 0 ? (totalCost / initialCapital) * 100 : 0;

  const getPositionRatio = useCallback(
    (amount: number) => {
      if (totalCost === 0) return '0.00%';
      return ((amount / totalCost) * 100).toFixed(2) + '%';
    },
    [totalCost]
  );

  const handleSaveCapital = () => {
    if (editingCapital === null || editingCapital <= 0) return;
    dispatch(setSystemSettingAction({
      ...systemSetting,
      initialCapital: editingCapital,
    }));
    setEditingCapital(null);
  };

  return (
    <div className={styles.content}>
      {/* 汇总信息栏 */}
      <div style={{ padding: '10px', borderBottom: '1px solid var(--main-border-color)' }}>
        <Row gutter={20} align="middle">
          <Col>
            <span style={{ color: 'var(--hint-color)', marginRight: 8 }}>初始本金:</span>
            {editingCapital !== null ? (
              <>
                <InputNumber
                  value={editingCapital}
                  onChange={setEditingCapital}
                  min={0}
                  step={10000}
                  size="small"
                  style={{ width: 140 }}
                />
                <Button type="primary" size="small" style={{ marginLeft: 8 }} onClick={handleSaveCapital}>
                  保存
                </Button>
                <Button size="small" style={{ marginLeft: 4 }} onClick={() => setEditingCapital(null)}>
                  取消
                </Button>
              </>
            ) : (
              <>
                <span style={{ fontWeight: 'bold', color: 'var(--primary-text-color)' }}>
                  {initialCapital.toLocaleString()}
                </span>
                <Button type="link" size="small" onClick={() => setEditingCapital(initialCapital)}>
                  修改
                </Button>
              </>
            )}
          </Col>
          <Col>
            <span style={{ color: 'var(--hint-color)', marginRight: 8 }}>总成本:</span>
            <span style={{ fontWeight: 'bold', color: 'var(--primary-text-color)' }}>{totalCost.toFixed(2)}</span>
          </Col>
          <Col>
            <span style={{ color: 'var(--hint-color)', marginRight: 8 }}>总市值:</span>
            <span style={{ fontWeight: 'bold', color: 'var(--primary-text-color)' }}>{totalMarketValue.toFixed(2)}</span>
          </Col>
          <Col>
            <span style={{ color: 'var(--hint-color)', marginRight: 8 }}>已投入占比:</span>
            <span style={{ fontWeight: 'bold', color: 'var(--primary-text-color)' }}>{investedRatio.toFixed(2)}%</span>
          </Col>
          <Col>
            <span style={{ color: 'var(--hint-color)', marginRight: 8 }}>总盈亏:</span>
            <span className={Utils.GetValueColor(totalProfit).textClass} style={{ fontWeight: 'bold' }}>
              {totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)} ({totalProfitRatio >= 0 ? '+' : ''}{totalProfitRatio.toFixed(2)}%)
            </span>
          </Col>
        </Row>
      </div>

      <Row className={styles.rowheader}>
        <Col span={3}>股票名称</Col>
        <Col span={3}>最新价</Col>
        <Col span={3}>买入价</Col>
        <Col span={3}>持仓数量</Col>
        <Col span={3}>持仓金额</Col>
        <Col span={3}>仓位占比</Col>
        <Col span={3}>盈亏</Col>
        <Col span={3}>买入日期</Col>
        <Col span={3}>买入策略</Col>
      </Row>
      <div className={styles.table}>
        {holds.length === 0 && (
          <div className={styles.hint} style={{ padding: '20px', textAlign: 'center' }}>
            暂无持仓记录
          </div>
        )}
        {holds.map((h) => {
          const stockData = stocksMapping[h.secid];
          const zx = stockData?.detail?.zx ?? NaN;
          const price = Number(h.price);
          const count = Number(h.count);
          const amount = price * count;
          const profit = isNaN(zx) ? 0 : (zx - price) * count;
          const profitRatio = ((zx - price) / price) * 100;

          return (
            <Row key={h.secid} className={styles.row}>
              <Col span={3}>
                <a onClick={() => onOpenStock(h.secid, h.name)}>{h.name}</a>
              </Col>
              <Col span={3} className={Utils.GetValueColor(zx - price).textClass}>
                {!isNaN(zx) ? zx.toFixed(2) : '--'}
              </Col>
              <Col span={3}>{price.toFixed(2)}</Col>
              <Col span={3}>{count}</Col>
              <Col span={3}>{amount.toFixed(2)}</Col>
              <Col span={3}>{getPositionRatio(amount)}</Col>
              <Col span={3} className={Utils.GetValueColor(profit).textClass}>
                {!isNaN(zx)
                  ? `${profit >= 0 ? '+' : ''}${profit.toFixed(2)} (${profitRatio >= 0 ? '+' : ''}${profitRatio.toFixed(2)}%)`
                  : '--'}
              </Col>
              <Col span={3}>{h.lastBuyDate.substring(0, 10)}</Col>
              <Col span={3}>{StrategyTypeNames[h.lastBuyStrategy]}</Col>
            </Row>
          );
        })}
        {holds.length > 0 && (
          <Row className={styles.row} style={{ fontWeight: 'bold', borderTop: '1px solid var(--main-border-color)', marginTop: '10px' }}>
            <Col span={3}>合计</Col>
            <Col span={3}>--</Col>
            <Col span={3}>--</Col>
            <Col span={3}>
              {holds.reduce((sum, h) => sum + Number(h.count), 0)}
            </Col>
            <Col span={3}>{totalCost.toFixed(2)}</Col>
            <Col span={3}>100.00%</Col>
            <Col span={3} className={Utils.GetValueColor(totalProfit).textClass}>
              {`${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} (${totalProfitRatio >= 0 ? '+' : ''}${totalProfitRatio.toFixed(2)}%)`}
            </Col>
            <Col span={3}>--</Col>
            <Col span={3}>--</Col>
          </Row>
        )}
      </div>
    </div>
  );
};

export default HoldView;
