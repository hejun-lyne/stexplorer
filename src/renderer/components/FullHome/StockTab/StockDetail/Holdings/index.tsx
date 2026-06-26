import React, { useState, useMemo, useCallback, useEffect } from 'react';
import classnames from 'classnames';
import * as Utils from '@/utils';
import styles from './index.scss';
import { InputNumber, Button, Input, Row, Col, Tag, Slider } from 'antd';
import { DollarOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { appendTrade, removeTrade } from '@/actions/stock';
import { StoreState } from '@/reducers/types';
import { Stock } from '@/types/stock';
import moment from 'moment';

export interface HoldingsProps {
  secid: string;
}

const FUNDS_STORAGE_KEY = 'kimi_sim_funds';

const loadFunds = (): number => {
  try {
    const v = localStorage.getItem(FUNDS_STORAGE_KEY);
    return v ? parseFloat(v) : 100000;
  } catch {
    return 100000;
  }
};

const saveFunds = (v: number) => {
  try {
    localStorage.setItem(FUNDS_STORAGE_KEY, String(v));
  } catch { /* ignore */ }
};

const Holdings: React.FC<HoldingsProps> = React.memo(({ secid }) => {
  const dispatch = useDispatch();
  const nowHolds = useSelector((state: StoreState) => state.stock.nowHolds);
  const allTradings = useSelector((state: StoreState) => state.stock.tradings);
  const stocksMapping = useSelector((state: StoreState) => state.stock.stocksMapping);
  const config = useSelector((state: StoreState) => state.stock.stockConfigsMapping[secid]);

  const stockName = config?.name || stocksMapping[secid]?.detail?.name || '';

  const hold = useMemo(() => {
    return nowHolds.find((h) => h.secid === secid);
  }, [nowHolds, secid]);

  // 全部股票的交易记录（用于列表展示）
  const allTrades = useMemo(() => {
    return [...allTradings].sort((a, b) => b.id - a.id);
  }, [allTradings]);

  // ===== 模拟资金 =====
  const [funds, setFunds] = useState<number>(loadFunds);
  const [fundsInput, setFundsInput] = useState<number | null>(null);
  const [showFundsEdit, setShowFundsEdit] = useState(false);

  useEffect(() => {
    saveFunds(funds);
  }, [funds]);

  const handleFundsConfirm = useCallback(() => {
    if (fundsInput != null && fundsInput >= 0) {
      setFunds(fundsInput);
    }
    setShowFundsEdit(false);
    setFundsInput(null);
  }, [fundsInput]);

  const handleFundsAdd = useCallback((delta: number) => {
    setFunds((prev) => Math.max(0, prev + delta));
  }, []);

  // ===== 交易表单 =====
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState<number | null>(null);
  const [count, setCount] = useState<number | null>(100);
  const [explain, setExplain] = useState('');

  // 比例模式
  const [useRatio, setUseRatio] = useState(false);
  const [buyRatio, setBuyRatio] = useState(25);    // 可用资金百分比
  const [sellRatio, setSellRatio] = useState(25);   // 持仓百分比

  // 根据比例自动计算数量
  const computedCount = useMemo(() => {
    if (!useRatio || !price || price <= 0) return count;
    if (tradeType === 'buy') {
      return Math.floor((funds * buyRatio / 100) / price / 100) * 100;
    } else {
      if (!hold || hold.count <= 0) return 0;
      return Math.floor(hold.count * sellRatio / 100 / 100) * 100;
    }
  }, [useRatio, price, tradeType, buyRatio, sellRatio, funds, hold, count]);

  const displayCount = useRatio ? (computedCount || 0) : count;

  // 交易金额
  const tradeAmount = useMemo(() => {
    if (!price || !displayCount) return 0;
    return price * displayCount;
  }, [price, displayCount]);

  const handleSubmit = () => {
    if (!price || !displayCount || price <= 0 || displayCount <= 0) return;

    // 买入时检查资金
    if (tradeType === 'buy' && tradeAmount > funds) {
      return;
    }
    // 卖出时检查持仓
    if (tradeType === 'sell' && hold && displayCount > hold.count) {
      return;
    }

    const trade: Stock.DoTradeItem = {
      id: 0,
      type: tradeType,
      secid,
      name: stockName,
      price: parseFloat('' + price),
      count: displayCount,
      time: moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
      stoplossAt: 0,
      latestNewsAs: 'positive',
      explain,
      profits: [0, 0, 0, 0, 0],
    };
    dispatch(appendTrade(trade));

    // 更新资金
    if (tradeType === 'buy') {
      setFunds((prev) => Math.max(0, prev - tradeAmount));
    } else {
      setFunds((prev) => prev + tradeAmount);
    }

    setPrice(null);
    setCount(100);
    setExplain('');
  };

  const handleRemove = (id: number) => {
    dispatch(removeTrade(id));
  };

  // ===== 模拟交易统计（基于所有股票的全部交易记录） =====
  const simStats = useMemo(() => {
    // 按股票分组，分别 FIFO 配对计算
    const tradesByStock: Record<string, Stock.DoTradeItem[]> = {};
    allTradings.forEach((t) => {
      if (!tradesByStock[t.secid]) tradesByStock[t.secid] = [];
      tradesByStock[t.secid].push(t);
    });

    const closedTrades: { buyPrice: number; sellPrice: number; count: number; profit: number; profitRatio: number }[] = [];

    Object.values(tradesByStock).forEach((stockTrades) => {
      const sorted = [...stockTrades].sort((a, b) => a.id - b.id); // 按时间正序
      const buyStack: Stock.DoTradeItem[] = [];

      sorted.forEach((t) => {
        if (t.type === 'buy') {
          buyStack.push({ ...t }); // 浅拷贝避免修改原数据
        } else if (t.type === 'sell') {
          let remainingSell = t.count;
          while (remainingSell > 0 && buyStack.length > 0) {
            const buy = buyStack[buyStack.length - 1];
            const matchedCount = Math.min(remainingSell, buy.count);
            const profit = (t.price - buy.price) * matchedCount;
            const profitRatio = buy.price > 0 ? ((t.price - buy.price) / buy.price) * 100 : 0;
            closedTrades.push({ buyPrice: buy.price, sellPrice: t.price, count: matchedCount, profit, profitRatio });
            remainingSell -= matchedCount;
            buy.count -= matchedCount;
            if (buy.count <= 0) buyStack.pop();
          }
        }
      });
    });

    const totalTrades = closedTrades.length;
    const winTrades = closedTrades.filter((t) => t.profit > 0).length;
    const loseTrades = closedTrades.filter((t) => t.profit < 0).length;
    const winRate = totalTrades > 0 ? (winTrades / totalTrades) * 100 : 0;

    const totalProfit = closedTrades.reduce((s, t) => s + t.profit, 0);
    const avgWin = winTrades > 0
      ? closedTrades.filter((t) => t.profit > 0).reduce((s, t) => s + t.profit, 0) / winTrades
      : 0;
    const avgLoss = loseTrades > 0
      ? Math.abs(closedTrades.filter((t) => t.profit < 0).reduce((s, t) => s + t.profit, 0)) / loseTrades
      : 0;
    const profitLossRatio = avgLoss > 0 ? avgWin / avgLoss : 0;

    // 累计收益率（基于所有已平仓交易）
    const totalInvested = closedTrades.reduce((s, t) => s + t.buyPrice * t.count, 0);
    const cumulativeReturn = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

    // 所有股票当前持仓市值
    const allHoldingValue = nowHolds.reduce((sum, h) => {
      const zxVal = stocksMapping[h.secid]?.detail?.zx ?? NaN;
      const price = isNaN(zxVal) ? Number(h.price) : zxVal;
      return sum + price * Number(h.count);
    }, 0);
    const totalAssets = funds + allHoldingValue;

    return {
      totalTrades,
      winTrades,
      loseTrades,
      winRate,
      totalProfit,
      avgWin,
      avgLoss,
      profitLossRatio,
      cumulativeReturn,
      allHoldingValue,
      totalAssets,
    };
  }, [allTradings, nowHolds, stocksMapping, funds]);

  return (
    <div className={styles.container}>
      {/* ===== 资金 + 统计（紧凑一行） ===== */}
      <div className={styles.topBar}>
        <div className={styles.topBarItem}>
          <DollarOutlined style={{ fontSize: 12, color: 'var(--primary-color)' }} />
          {showFundsEdit ? (
            <span className={styles.fundsEditInline}>
              <InputNumber
                size="small"
                value={fundsInput ?? funds}
                onChange={(v) => setFundsInput(v)}
                min={0}
                step={1000}
                style={{ width: 100 }}
                onPressEnter={handleFundsConfirm}
              />
              <Button type="primary" size="small" onClick={handleFundsConfirm}>确定</Button>
            </span>
          ) : (
            <span
              className={styles.topBarValue}
              onClick={() => { setFundsInput(funds); setShowFundsEdit(true); }}
            >
              ¥{funds.toLocaleString('zh-CN', { minimumFractionDigits: 0 })}
            </span>
          )}
          <span className={styles.topBarBtns}>
            <Button size="small" onClick={() => handleFundsAdd(10000)}>+1万</Button>
            <Button size="small" onClick={() => handleFundsAdd(50000)}>+5万</Button>
            <Button size="small" danger onClick={() => handleFundsAdd(-10000)}>-1万</Button>
          </span>
        </div>
        <div className={styles.topBarDivider} />
        <div className={styles.topBarItem}>
          <span className={styles.topBarLabel}>总资产</span>
          <span className={styles.topBarValue}>¥{simStats.totalAssets.toLocaleString('zh-CN', { minimumFractionDigits: 0 })}</span>
        </div>
        <div className={styles.topBarItem}>
          <span className={styles.topBarLabel}>胜率</span>
          <span className={styles.topBarValue} style={{ color: simStats.winRate >= 50 ? '#52c41a' : '#ff4d4f' }}>
            {simStats.winRate.toFixed(1)}%
          </span>
        </div>
        <div className={styles.topBarItem}>
          <span className={styles.topBarLabel}>盈亏比</span>
          <span className={styles.topBarValue} style={{ color: simStats.profitLossRatio >= 1 ? '#52c41a' : '#ff4d4f' }}>
            {simStats.profitLossRatio.toFixed(2)}
          </span>
        </div>
        <div className={styles.topBarItem}>
          <span className={styles.topBarLabel}>收益</span>
          <span className={styles.topBarValue} style={{ color: simStats.totalProfit >= 0 ? '#cf1322' : '#3f8600' }}>
            ¥{simStats.totalProfit.toLocaleString('zh-CN', { minimumFractionDigits: 0, signDisplay: 'always' })} ({simStats.cumulativeReturn >= 0 ? '+' : ''}{simStats.cumulativeReturn.toFixed(1)}%)
          </span>
        </div>
        <div className={styles.topBarItem}>
          <span className={styles.topBarLabel}>交易</span>
          <span className={styles.topBarValue}>{simStats.winTrades}W / {simStats.loseTrades}L</span>
        </div>
      </div>

      {/* 全部持仓 */}
      {nowHolds.length > 0 && (
        <>
          <Row style={{ marginBottom: 10, fontWeight: 'bold', color: 'var(--main-text-color)' }}>
            <Col span={24}>全部持仓 ({nowHolds.length})</Col>
          </Row>
          <div className={styles.header} style={{ padding: '5px 0', marginBottom: 5 }}>
            <span className={styles.b}>股票</span>
            <span className={styles.b}>成本价</span>
            <span className={styles.b}>数量</span>
            <span className={styles.b}>最新价</span>
            <span className={styles.b}>盈亏</span>
          </div>
          {nowHolds.map((h) => {
            const hPrice = Number(h.price);
            const hCount = Number(h.count);
            const zxVal = stocksMapping[h.secid]?.detail?.zx ?? NaN;
            const zxDisplay = !isNaN(zxVal) ? zxVal : 0;
            const profit = !isNaN(zxVal) ? (zxDisplay - hPrice) * hCount : 0;
            const profitRatio = hPrice > 0 ? ((zxDisplay - hPrice) / hPrice) * 100 : 0;
            const name = stocksMapping[h.secid]?.detail?.name || h.name || h.secid;
            const isCurrent = h.secid === secid;
            return (
              <div
                key={h.secid}
                className={styles.row}
                style={{
                  padding: '6px 0',
                  borderBottom: '1px solid var(--border-color)',
                  backgroundColor: isCurrent ? 'var(--card-background-color)' : undefined,
                }}
              >
                <span className={styles.b} style={{ fontWeight: isCurrent ? 'bold' : 'normal' }}>
                  {name}
                </span>
                <span className={styles.b}>{hPrice.toFixed(2)}</span>
                <span className={styles.b}>{hCount}</span>
                <span className={classnames(styles.b, Utils.GetValueColor(zxDisplay - hPrice).textClass)}>
                  {!isNaN(zxVal) ? zxDisplay.toFixed(2) : '--'}
                </span>
                <span className={classnames(styles.b, Utils.GetValueColor(profit).textClass)}>
                  {!isNaN(zxVal)
                    ? `${profit >= 0 ? '+' : ''}${profit.toFixed(0)} (${profitRatio >= 0 ? '+' : ''}${profitRatio.toFixed(1)}%)`
                    : '--'}
                </span>
              </div>
            );
          })}
          <div className={styles.seperator} style={{ marginBottom: 15 }} />
        </>
      )}

      {/* 买入/卖出操作 */}
      <Row style={{ marginBottom: 10, fontWeight: 'bold', color: 'var(--main-text-color)' }}>
        <Col span={24}>交易操作</Col>
      </Row>
      <Row gutter={10} style={{ marginBottom: 8 }}>
        <Col span={4}>
          <Button
            type={tradeType === 'buy' ? 'primary' : 'default'}
            block
            size="small"
            onClick={() => setTradeType('buy')}
          >
            买入
          </Button>
        </Col>
        <Col span={4}>
          <Button
            type={tradeType === 'sell' ? 'primary' : 'default'}
            block
            size="small"
            danger={tradeType === 'sell'}
            onClick={() => setTradeType('sell')}
          >
            卖出
          </Button>
        </Col>
        <Col span={8}>
          <Button
            type={useRatio ? 'primary' : 'default'}
            size="small"
            block
            onClick={() => setUseRatio(!useRatio)}
          >
            {useRatio ? '比例模式' : '手动模式'}
          </Button>
        </Col>
        <Col span={8}>
          <span className={styles.fundsHint}>
            可用: ¥{funds.toLocaleString('zh-CN', { minimumFractionDigits: 0 })}
          </span>
        </Col>
      </Row>

      {/* 比例选择滑块 */}
      {useRatio && (
        <div style={{ marginBottom: 10, padding: '8px 12px', background: 'var(--card-background-color)', borderRadius: 6 }}>
          {tradeType === 'buy' ? (
            <>
              <Row align="middle" style={{ marginBottom: 4 }}>
                <Col span={20}>
                  <Slider
                    min={5}
                    max={100}
                    step={5}
                    value={buyRatio}
                    onChange={setBuyRatio}
                    marks={{ 25: '25%', 50: '50%', 75: '75%', 100: '全仓' }}
                  />
                </Col>
                <Col span={4} style={{ textAlign: 'center', fontWeight: 'bold' }}>
                  {buyRatio}%
                </Col>
              </Row>
              <div className={styles.ratioInfo}>
                买入金额: ¥{((funds * buyRatio) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}，
                约 {computedCount} 股
              </div>
            </>
          ) : (
            <>
              <Row align="middle" style={{ marginBottom: 4 }}>
                <Col span={20}>
                  <Slider
                    min={5}
                    max={100}
                    step={5}
                    value={sellRatio}
                    onChange={setSellRatio}
                    marks={{ 25: '25%', 50: '50%', 75: '75%', 100: '清仓' }}
                    disabled={!hold || hold.count <= 0}
                  />
                </Col>
                <Col span={4} style={{ textAlign: 'center', fontWeight: 'bold' }}>
                  {sellRatio}%
                </Col>
              </Row>
              <div className={styles.ratioInfo}>
                卖出数量: {computedCount} 股，
                约 ¥{tradeAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
              </div>
            </>
          )}
        </div>
      )}

      <Row gutter={10} style={{ marginBottom: 10 }} align="middle">
        <Col span={5}>
          <InputNumber
            style={{ width: '100%' }}
            placeholder="价格"
            value={price}
            onChange={setPrice}
            step={0.01}
            min={0}
            size="small"
          />
        </Col>
        <Col span={5}>
          <InputNumber
            style={{ width: '100%' }}
            placeholder="数量"
            value={displayCount}
            onChange={setCount}
            step={100}
            min={100}
            size="small"
            disabled={useRatio}
          />
        </Col>
        <Col span={10}>
          <Input
            placeholder="操作理由（可选）"
            value={explain}
            onChange={(e) => setExplain(e.target.value)}
            size="small"
          />
        </Col>
        <Col span={4}>
          <Button
            type="primary"
            size="small"
            block
            onClick={handleSubmit}
            disabled={
              !price || !displayCount || displayCount <= 0 ||
              (tradeType === 'buy' && tradeAmount > funds) ||
              (tradeType === 'sell' && hold && displayCount > hold.count)
            }
          >
            确认{tradeType === 'buy' ? '买入' : '卖出'}
          </Button>
        </Col>
      </Row>
      <div className={styles.seperator} style={{ marginBottom: 15 }} />

      {/* 交易记录（全部股票） */}
      <Row style={{ marginBottom: 10, fontWeight: 'bold', color: 'var(--main-text-color)' }}>
        <Col span={24}>全部交易记录 ({allTrades.length})</Col>
      </Row>
      <div className={styles.header} style={{ padding: '5px 0' }}>
        <span className={styles.b}>时间</span>
        <span className={styles.b}>股票</span>
        <span className={styles.b}>类型</span>
        <span className={styles.b}>价格</span>
        <span className={styles.b}>数量</span>
        <span className={styles.b}>理由</span>
        <span className={styles.c}>操作</span>
      </div>
      {allTrades.map((item) => {
        const tradeStockName = stocksMapping[item.secid]?.detail?.name || item.name || item.secid;
        const isCurrent = item.secid === secid;
        return (
          <div
            key={item.id}
            className={styles.row}
            style={{
              padding: '5px 0',
              backgroundColor: isCurrent ? 'var(--card-background-color)' : undefined,
            }}
          >
            <span className={styles.b} style={{ fontSize: 12 }}>{item.time}</span>
            <span className={styles.b} style={{ fontWeight: isCurrent ? 'bold' : 'normal', fontSize: 12 }}>
              {tradeStockName}
            </span>
            <span className={styles.b}>
              <Tag color={item.type === 'buy' ? 'green' : 'red'}>
                {item.type === 'buy' ? '买入' : '卖出'}
              </Tag>
            </span>
            <span className={styles.b}>{Number(item.price).toFixed(2)}</span>
            <span className={styles.b}>{Number(item.count)}</span>
            <span
              className={classnames(styles.b, 'ellipsis')}
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}
            >
              {item.explain || '--'}
            </span>
            <span className={styles.c}>
              <Button size="small" type="text" danger onClick={() => handleRemove(item.id)} className={styles.act}>
                删除
              </Button>
            </span>
          </div>
        );
      })}
    </div>
  );
});
export default Holdings;
