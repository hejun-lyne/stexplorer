import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Button, Table, Tag, Row, Col, Alert, Checkbox } from 'antd';
import { useDispatch } from 'react-redux';
import { setStockTradePointsAction } from '@/actions/stock';
import { backtestMABounce, optimizeRSIStrategy, MABacktestResult, RSIBacktestResult } from '@/helpers/stock';
import { calculateMA, calculateRSI } from '@/helpers/tech';
import { Stock } from '@/types/stock';
import styles from './index.scss';

export interface BacktestAnalysisProps {
  secid: string;
  klines?: Stock.KLineItem[];
}

const BacktestAnalysis: React.FC<BacktestAnalysisProps> = React.memo(({ secid, klines }) => {
  const dispatch = useDispatch();
  const [testResult, setTestResult] = useState<string>('');
  const [showMAPoints, setShowMAPoints] = useState(false);
  const [showRSIPoints, setShowRSIPoints] = useState(false);

  const maResults = useMemo<MABacktestResult[]>(() => {
    if (!klines || klines.length < 60) return [];
    return backtestMABounce(klines); // 仅测试最近200根，提升速度
  }, [klines]);

  const rsiResults = useMemo<RSIBacktestResult[]>(() => {
    if (!klines || klines.length < 60) return [];
    return optimizeRSIStrategy(klines); // 仅测试最近200根，提升速度
  }, [klines]);

  const topMAResult = maResults[0];
  const topRSIResult = rsiResults[0];

  // 应用标记：根据勾选状态重新设置买卖点
  const applyMarks = useCallback(
    (showMA: boolean, showRSI: boolean) => {
      if (!klines) return;
      const buyPoints: { x: string; y: number; t: string }[] = [];
      const sellPoints: { x: string; y: number; t: string }[] = [];

      if (showMA && topMAResult) {
        topMAResult.trades.forEach((t) => {
          const buyK = klines[t.buyIndex];
          const sellK = klines[t.sellIndex];
          if (buyK) buyPoints.push({ x: buyK.date, y: buyK.sp, t: 'ma' });
          if (sellK) sellPoints.push({ x: sellK.date, y: sellK.sp, t: 'ma' });
        });
      }

      if (showRSI && topRSIResult) {
        topRSIResult.trades.forEach((t) => {
          const buyK = klines[t.buyIndex];
          const sellK = klines[t.sellIndex];
          if (buyK) buyPoints.push({ x: buyK.date, y: buyK.sp, t: 'rsi' });
          if (sellK) sellPoints.push({ x: sellK.date, y: sellK.sp, t: 'rsi' });
        });
      }

      dispatch(setStockTradePointsAction(secid, buyPoints, sellPoints, ['ma', 'rsi']));
    },
    [topMAResult, topRSIResult, klines, secid, dispatch]
  );

  const onMAChange = useCallback(
    (e: any) => {
      const checked = e.target.checked;
      setShowMAPoints(checked);
      applyMarks(checked, showRSIPoints);
      setTestResult(checked ? `已显示MA策略 ${topMAResult?.tradeCount || 0} 笔买卖点` : '已隐藏MA策略买卖点');
    },
    [applyMarks, showRSIPoints, topMAResult]
  );

  const onRSIChange = useCallback(
    (e: any) => {
      const checked = e.target.checked;
      setShowRSIPoints(checked);
      applyMarks(showMAPoints, checked);
      setTestResult(checked ? `已显示RSI策略 ${topRSIResult?.tradeCount || 0} 笔买卖点` : '已隐藏RSI策略买卖点');
    },
    [applyMarks, showMAPoints, topRSIResult]
  );

  // 测试最近20根K线 - MA回踩策略
  const testMARecent = useCallback(() => {
    if (!topMAResult || !klines || klines.length < topMAResult.maPeriod + topMAResult.trendDays + 1) {
      setTestResult('K线数据不足，无法测试');
      return;
    }
    const closes = klines.map((k) => k.sp);
    const ma = calculateMA(closes, topMAResult.maPeriod);
    const recentStart = Math.max(topMAResult.maPeriod + topMAResult.trendDays, klines.length - 20);

    let foundBuy: { index: number; price: number } | null = null;

    for (let i = recentStart; i < klines.length - topMAResult.holdDays; i++) {
      if (isNaN(ma[i]) || ma[i] === 0) continue;

      let trendValid = true;
      for (let j = i - topMAResult.trendDays; j < i; j++) {
        if (j < 1 || isNaN(ma[j]) || isNaN(ma[j - 1])) {
          trendValid = false;
          break;
        }
        if (closes[j] <= ma[j] || ma[j] <= ma[j - 1]) {
          trendValid = false;
          break;
        }
      }
      if (!trendValid) continue;

      const maVal = ma[i];
      const close = closes[i];
      const low = klines[i].zd;
      const open = klines[i].kp;

      const touchedMA = low <= maVal * 1.005;
      const recovered = close >= maVal * 0.98;
      const nearMA = Math.abs(close - maVal) / maVal <= topMAResult.threshold;

      if (touchedMA && recovered && nearMA) {
        const todayUp = close > open;
        const nextDayUp = i + 1 < closes.length && closes[i + 1] > close;
        if (todayUp || nextDayUp) {
          foundBuy = { index: i, price: close };
          break;
        }
      }
    }

    if (foundBuy) {
      const sellIdx = Math.min(foundBuy.index + topMAResult.holdDays, klines.length - 1);
      const buyK = klines[foundBuy.index];
      const sellK = klines[sellIdx];
      dispatch(
        setStockTradePointsAction(
          secid,
          [{ x: buyK.date, y: buyK.sp, t: 'ma' }],
          [{ x: sellK.date, y: sellK.sp, t: 'ma' }],
          ['ma']
        )
      );
      setTestResult(
        `MA策略：最近20根发现买入信号！日期 ${buyK.date}，价格 ${buyK.sp.toFixed(2)}，预期持有${topMAResult.holdDays}天至 ${sellK.date}`
      );
      // 勾选MA显示
      if (!showMAPoints) {
        setShowMAPoints(true);
      }
    } else {
      setTestResult('MA策略：最近20根K线未找到符合条件的买入信号');
    }
  }, [topMAResult, klines, secid, dispatch, showMAPoints]);

  // 测试最近20根K线 - RSI策略
  const testRSIRecent = useCallback(() => {
    if (!topRSIResult || !klines || klines.length < topRSIResult.rsiPeriod + 1) {
      setTestResult('K线数据不足，无法测试');
      return;
    }
    const closes = klines.map((k) => k.sp);
    const rsi = calculateRSI(closes, topRSIResult.rsiPeriod);
    const recentStart = Math.max(topRSIResult.rsiPeriod + 1, klines.length - 20);

    let inOversold = false;
    let foundBuy: { index: number; price: number } | null = null;
    let foundSell: { index: number; price: number } | null = null;

    for (let i = recentStart; i < rsi.length; i++) {
      if (rsi[i] <= topRSIResult.buyThreshold) inOversold = true;

      if (!foundBuy) {
        if (inOversold && rsi[i - 1] <= topRSIResult.buyThreshold && rsi[i] > topRSIResult.buyThreshold) {
          foundBuy = { index: i, price: closes[i] };
          inOversold = false;
        }
      } else {
        if (rsi[i] >= topRSIResult.sellThreshold) {
          foundSell = { index: i, price: closes[i] };
          break;
        }
      }
    }

    if (foundBuy) {
      const buyK = klines[foundBuy.index];
      const sellPoints: { x: string; y: number; t: string }[] = [];
      let msg = `RSI策略：最近20根发现买入信号！日期 ${buyK.date}，价格 ${buyK.sp.toFixed(2)}`;
      if (foundSell) {
        const sellK = klines[foundSell.index];
        sellPoints.push({ x: sellK.date, y: sellK.sp, t: 'rsi' });
        msg += `，卖出日期 ${sellK.date}，价格 ${sellK.sp.toFixed(2)}`;
      } else {
        msg += '，尚未出现RSI超买卖出信号';
      }
      dispatch(
        setStockTradePointsAction(
          secid,
          [{ x: buyK.date, y: buyK.sp, t: 'rsi' }],
          sellPoints,
          ['rsi']
        )
      );
      setTestResult(msg);
      if (!showRSIPoints) {
        setShowRSIPoints(true);
      }
    } else {
      setTestResult('RSI策略：最近20根K线未找到符合条件的买入信号');
    }
  }, [topRSIResult, klines, secid, dispatch, showRSIPoints]);

  const maColumns = [
    { title: '参数', dataIndex: 'param', key: 'param' },
    { title: '值', dataIndex: 'value', key: 'value' },
  ];

  const rsiColumns = [
    { title: '参数', dataIndex: 'param', key: 'param' },
    { title: '值', dataIndex: 'value', key: 'value' },
  ];

  const maData = topMAResult
    ? [
        { key: '1', param: 'MA周期', value: topMAResult.maPeriod },
        { key: '2', param: '持有天数', value: topMAResult.holdDays },
        { key: '3', param: '趋势确认天数', value: topMAResult.trendDays },
        { key: '4', param: '回踩阈值', value: `${(topMAResult.threshold * 100).toFixed(1)}%` },
        { key: '5', param: '交易次数', value: topMAResult.tradeCount },
        { key: '6', param: '总收益', value: `${topMAResult.totalReturn.toFixed(2)}%` },
        { key: '7', param: '胜率', value: `${topMAResult.winRate.toFixed(1)}%` },
        { key: '8', param: '平均收益', value: `${topMAResult.avgReturn.toFixed(2)}%` },
        { key: '9', param: '最大回撤', value: `${topMAResult.maxDrawdown.toFixed(2)}%` },
        { key: '10', param: '盈亏比', value: topMAResult.profitFactor.toFixed(2) },
        { key: '11', param: '综合评分', value: topMAResult.score.toFixed(1) },
      ]
    : [];

  const rsiData = topRSIResult
    ? [
        { key: '1', param: 'RSI周期', value: topRSIResult.rsiPeriod },
        { key: '2', param: '买入阈值', value: topRSIResult.buyThreshold },
        { key: '3', param: '卖出阈值', value: topRSIResult.sellThreshold },
        { key: '4', param: '交易次数', value: topRSIResult.tradeCount },
        { key: '5', param: '总收益', value: `${topRSIResult.totalReturn.toFixed(2)}%` },
        { key: '6', param: '胜率', value: `${topRSIResult.winRate.toFixed(1)}%` },
        { key: '7', param: '平均收益', value: `${topRSIResult.avgReturn.toFixed(2)}%` },
        { key: '8', param: '最大回撤', value: `${topRSIResult.maxDrawdown.toFixed(2)}%` },
        { key: '9', param: '盈亏比', value: topRSIResult.profitFactor.toFixed(2) },
        { key: '10', param: '综合评分', value: topRSIResult.score.toFixed(1) },
      ]
    : [];

  if (!klines || klines.length < 60) {
    return (
      <div className={styles.container}>
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--inner-text-color)' }}>
          K线数据不足（需至少60根），请先在K线图页面加载数据
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <Row gutter={16}>
        {/* MA回踩策略 */}
        <Col span={12}>
          <div className={styles.section}>
            <div className={styles.title}>
              <Tag color="blue">MA均线回踩策略</Tag>
              {topMAResult && (
                <span style={{ marginLeft: 8, fontSize: 12 }}>
                  最优: MA{topMAResult.maPeriod} / 持有{topMAResult.holdDays}天
                </span>
              )}
            </div>
            <Table
              size="small"
              bordered={false}
              pagination={false}
              columns={maColumns}
              dataSource={maData}
              rowKey="key"
            />
            {topMAResult && (
              <div className={styles.btnGroup}>
                <Checkbox checked={showMAPoints} onChange={onMAChange}>
                  显示MA买卖点
                </Checkbox>
                <Button size="small" onClick={testMARecent}>
                  测试最近20根
                </Button>
              </div>
            )}
          </div>
        </Col>

        {/* RSI策略 */}
        <Col span={12}>
          <div className={styles.section}>
            <div className={styles.title}>
              <Tag color="purple">RSI超卖反弹策略</Tag>
              {topRSIResult && (
                <span style={{ marginLeft: 8, fontSize: 12 }}>
                  最优: RSI{topRSIResult.rsiPeriod} / 买≤{topRSIResult.buyThreshold} 卖≥{topRSIResult.sellThreshold}
                </span>
              )}
            </div>
            <Table
              size="small"
              bordered={false}
              pagination={false}
              columns={rsiColumns}
              dataSource={rsiData}
              rowKey="key"
            />
            {topRSIResult && (
              <div className={styles.btnGroup}>
                <Checkbox checked={showRSIPoints} onChange={onRSIChange}>
                  显示RSI买卖点
                </Checkbox>
                <Button size="small" onClick={testRSIRecent}>
                  测试最近20根
                </Button>
              </div>
            )}
          </div>
        </Col>
      </Row>

      {/* 测试结果提示 */}
      {testResult && (
        <div className={styles.section}>
          <Alert
            message={testResult}
            type={testResult.includes('发现') ? 'success' : 'info'}
            size="small"
            banner
            style={{ padding: '4px 8px' }}
          />
        </div>
      )}

      {/* 策略对比 */}
      {topMAResult && topRSIResult && (
        <div className={styles.section}>
          <div className={styles.title}>策略对比</div>
          <Row gutter={16}>
            <Col span={8}>
              <div className={styles.resultCard}>
                <div className={styles.row}>
                  <span className={styles.label}>维度</span>
                  <span className={styles.value}>MA回踩</span>
                  <span className={styles.value}>RSI反弹</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.label}>交易次数</span>
                  <span className={styles.value}>{topMAResult.tradeCount}</span>
                  <span className={styles.value}>{topRSIResult.tradeCount}</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.label}>总收益</span>
                  <span className={styles.value}>{topMAResult.totalReturn.toFixed(2)}%</span>
                  <span className={styles.value}>{topRSIResult.totalReturn.toFixed(2)}%</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.label}>胜率</span>
                  <span className={styles.value}>{topMAResult.winRate.toFixed(1)}%</span>
                  <span className={styles.value}>{topRSIResult.winRate.toFixed(1)}%</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.label}>盈亏比</span>
                  <span className={styles.value}>{topMAResult.profitFactor.toFixed(2)}</span>
                  <span className={styles.value}>{topRSIResult.profitFactor.toFixed(2)}</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.label}>综合评分</span>
                  <span className={styles.value}>{topMAResult.score.toFixed(1)}</span>
                  <span className={styles.value}>{topRSIResult.score.toFixed(1)}</span>
                </div>
              </div>
            </Col>
            <Col span={16}>
              <div className={styles.hint}>
                说明：回测基于历史K线数据进行参数网格搜索，评分最高的参数组合被选为"最优策略"。
                勾选"显示买卖点"可将回测产生的交易信号写入股票配置并在K线图上显示，取消勾选则隐藏。
                点击"测试最近20根"会基于最优参数对最近20根K线进行实时验证，有信号则自动标记到K线图。
              </div>
            </Col>
          </Row>
        </div>
      )}
    </div>
  );
});

export default BacktestAnalysis;
