import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button, Table, Tag, Row, Col, Alert, Checkbox, Spin } from 'antd';
import { useDispatch } from 'react-redux';
import { setStockTradePointsAction } from '@/actions/stock';
import { useRequest } from 'ahooks';
import { calculateMA, calculateMACD, calculateRSI } from '@/helpers/tech';
import { InputNumber } from 'antd';
import { Stock } from '@/types/stock';
import styles from './index.scss';

// 引入 electron worker 执行器（与 PriceTrend 保持一致）
const { makeWorkerExec } = window.contextModules.electron;

export interface BacktestAnalysisProps {
  secid: string;
  klines?: Stock.KLineItem[];
}

// 回测结果类型（若 @/helpers/stock 已导出，可直接 import）
interface MABacktestResult {
  maPeriod: number;
  holdDays: number;
  trendDays: number;
  threshold: number;
  tradeCount: number;
  totalReturn: number;
  winRate: number;
  avgReturn: number;
  maxDrawdown: number;
  profitFactor: number;
  score: number;
  trades: { buyIndex: number; sellIndex: number }[];
}

interface MACDStrategyResult {
  fast: number;
  slow: number;
  signal: number;
  requireAboveZero: boolean;
  requirePriorNegative: boolean;
  tradeCount: number;
  totalReturn: number;
  winRate: number;
  avgReturn: number;
  avgHoldDays: number;
  maxDrawdown: number;
  profitFactor: number;
  fixedStopLossPct: number;
  trailingStopLossPct: number;
  score: number;
  trades: { buyIndex: number; sellIndex: number; exitReason?: string }[];
}

interface RSIBacktestResult {
  rsiPeriod: number;
  buyThreshold: number;
  sellThreshold: number;
  tradeCount: number;
  totalReturn: number;
  winRate: number;
  avgReturn: number;
  maxDrawdown: number;
  profitFactor: number;
  score: number;
  trades: { buyIndex: number; sellIndex: number }[];
}

const BacktestAnalysis: React.FC<BacktestAnalysisProps> = React.memo(({ secid, klines }) => {
  const dispatch = useDispatch();
  const [testResult, setTestResult] = useState<string>('');
  const [showMAPoints, setShowMAPoints] = useState(false);
  const [showMACDPoints, setShowMACDPoints] = useState(false);
  const [showRSIPoints, setShowRSIPoints] = useState(false);
  // 止损参数
  const [fixedStopLossPct, setFixedStopLossPct] = useState(5);
  const [trailingStopLossPct, setTrailingStopLossPct] = useState(5);

  // 回测结果
  const [maResults, setMaResults] = useState<MABacktestResult[]>([]);
  const [macdResults, setMacdResults] = useState<MACDStrategyResult[]>([]);
  const [rsiResults, setRsiResults] = useState<RSIBacktestResult[]>([]);

  // klines 变化时清空旧结果（内容指纹判断，避免引用变化误触发）
  const prevSecidRef = useRef(secid);
  const prevKlinesKeyRef = useRef('');

  useEffect(() => {
    const klinesKey = klines && klines.length > 0
      ? `${klines.length}_${klines[klines.length - 1].date}`
      : 'empty';

    if (prevSecidRef.current !== secid || prevKlinesKeyRef.current !== klinesKey) {
      prevSecidRef.current = secid;
      prevKlinesKeyRef.current = klinesKey;

      setMaResults([]);
      setMacdResults([]);
      setRsiResults([]);
      setTestResult('');
      setShowMAPoints(false);
      setShowMACDPoints(false);
      setShowRSIPoints(false);
    }
  }, [secid, klines]);

  // 使用 Worker 执行回测，避免阻塞主线程
  const { run: runBacktestWorker, loading } = useRequest(
    async () => {
      if (!klines || klines.length < 60) {
        throw new Error('K线数据不足（需至少60根）');
      }

      console.log('[BacktestAnalysis] dispatching worker backtest...');

      // 并行执行三个策略回测
      const [maRes, macdRes, rsiRes] = await Promise.all([
        makeWorkerExec('backtestMABounce', [
          klines,
          [5, 10, 20, 40, 60],
          [5, 10, 20],
          fixedStopLossPct / 100,
          trailingStopLossPct / 100,
        ]),
        makeWorkerExec('optimizeMACDStrategy', [
          klines,
          fixedStopLossPct / 100,
          trailingStopLossPct / 100,
        ]),
        makeWorkerExec('optimizeRSIStrategy', [
          klines,
          [6, 12, 24],
          fixedStopLossPct / 100,
          trailingStopLossPct / 100,
        ]),
      ]);

      return {
        maResults: maRes as MABacktestResult[],
        macdResults: macdRes as MACDStrategyResult[],
        rsiResults: rsiRes as RSIBacktestResult[],
      };
    },
    {
      manual: true,
      onBefore: () => {
        setTestResult('正在执行回测计算...');
      },
      onSuccess: (data) => {
        console.log('[BacktestAnalysis] worker backtest success', {
          ma: data.maResults.length,
          macd: data.macdResults.length,
          rsi: data.rsiResults.length,
        });
        setMaResults(data.maResults);
        setMacdResults(data.macdResults);
        setRsiResults(data.rsiResults);
        setTestResult('回测计算完成');
      },
      onError: (error: any) => {
        console.error('[BacktestAnalysis] backtest error', error);
        setTestResult('回测计算失败：' + (error?.message || String(error)));
      },
    }
  );

  const runBacktest = useCallback(() => {
    if (loading) {
      console.warn('[BacktestAnalysis] already loading, ignore click');
      return;
    }
    runBacktestWorker();
  }, [loading, runBacktestWorker]);

  const topMAResult = maResults[0];
  const topMACDResult = macdResults[0];
  const topRSIResult = rsiResults[0];

  // 应用标记：根据勾选状态重新设置买卖点
  const applyMarks = useCallback(
    (showMA: boolean, showMACD: boolean, showRSI: boolean) => {
      if (!klines) return;
      const buyPoints: { x: string; y: number; t: string }[] = [];
      const sellPoints: { x: string; y: number; t: string }[] = [];
      const tags: string[] = [];

      if (showMA && topMAResult) {
        topMAResult.trades.forEach((t) => {
          const buyK = klines[t.buyIndex];
          const sellK = klines[t.sellIndex];
          if (buyK) buyPoints.push({ x: buyK.date, y: buyK.sp, t: 'ma' });
          if (sellK) sellPoints.push({ x: sellK.date, y: sellK.sp, t: 'ma' });
        });
        tags.push('ma');
      }

      if (showMACD && topMACDResult) {
        topMACDResult.trades.forEach((t) => {
          const buyK = klines[t.buyIndex];
          const sellK = klines[t.sellIndex];
          if (buyK) buyPoints.push({ x: buyK.date, y: buyK.sp, t: 'macd' });
          if (sellK) sellPoints.push({ x: sellK.date, y: sellK.sp, t: 'macd' });
        });
        tags.push('macd');
      }

      if (showRSI && topRSIResult) {
        topRSIResult.trades.forEach((t) => {
          const buyK = klines[t.buyIndex];
          const sellK = klines[t.sellIndex];
          if (buyK) buyPoints.push({ x: buyK.date, y: buyK.sp, t: 'rsi' });
          if (sellK) sellPoints.push({ x: sellK.date, y: sellK.sp, t: 'rsi' });
        });
        tags.push('rsi');
      }

      dispatch(setStockTradePointsAction(secid, buyPoints, sellPoints, tags));
    },
    [topMAResult, topMACDResult, topRSIResult, klines, secid, dispatch]
  );

  const onMAChange = useCallback(
    (e: any) => {
      const checked = e.target.checked;
      setShowMAPoints(checked);
      applyMarks(checked, showMACDPoints, showRSIPoints);
      setTestResult(checked ? `已显示MA策略 ${topMAResult?.tradeCount || 0} 笔买卖点` : '已隐藏MA策略买卖点');
    },
    [applyMarks, showMACDPoints, showRSIPoints, topMAResult]
  );

  const onMACDChange = useCallback(
    (e: any) => {
      const checked = e.target.checked;
      setShowMACDPoints(checked);
      applyMarks(showMAPoints, checked, showRSIPoints);
      setTestResult(checked ? `已显示MACD策略 ${topMACDResult?.tradeCount || 0} 笔买卖点` : '已隐藏MACD策略买卖点');
    },
    [applyMarks, showMAPoints, showRSIPoints, topMACDResult]
  );

  const onRSIChange = useCallback(
    (e: any) => {
      const checked = e.target.checked;
      setShowRSIPoints(checked);
      applyMarks(showMAPoints, showMACDPoints, checked);
      setTestResult(checked ? `已显示RSI策略 ${topRSIResult?.tradeCount || 0} 笔买卖点` : '已隐藏RSI策略买卖点');
    },
    [applyMarks, showMAPoints, showMACDPoints, topRSIResult]
  );

  // 测试最近3根K线 - MA回踩策略（数据量小，保留主线程执行）
  const testMARecent = useCallback(() => {
    if (!topMAResult || !klines || klines.length < topMAResult.maPeriod + topMAResult.trendDays + 1) {
      setTestResult('K线数据不足，无法测试');
      return;
    }
    const closes = klines.map((k) => k.sp);
    const ma = calculateMA(closes, topMAResult.maPeriod);
    const recentStart = Math.max(topMAResult.maPeriod + topMAResult.trendDays, klines.length - 3);

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
        `MA策略：最近3根发现买入信号！日期 ${buyK.date}，价格 ${buyK.sp.toFixed(2)}，预期持有${topMAResult.holdDays}天至 ${sellK.date}`
      );
      if (!showMAPoints) {
        setShowMAPoints(true);
      }
    } else {
      setTestResult('MA策略：最近3根K线未找到符合条件的买入信号');
    }
  }, [topMAResult, klines, secid, dispatch, showMAPoints]);

  // 测试最近3根K线 - MACD策略
  const testMACDRecent = useCallback(() => {
    if (!topMACDResult || !klines || klines.length < 30) {
      setTestResult('K线数据不足，无法测试');
      return;
    }
    const closes = klines.map((k) => k.sp);
    const macd = calculateMACD(closes, topMACDResult.slow, topMACDResult.fast, topMACDResult.signal);
    const dif = macd.MACD;
    const dea = macd.signal;
    const hist = macd.histogram;

    let foundBuy: { index: number; price: number } | null = null;

    for (let i = Math.max(2, klines.length - 3); i < klines.length; i++) {
      const goldenCross = dif[i] > dea[i] && dif[i - 1] <= dea[i - 1];
      if (!goldenCross) continue;

      if (topMACDResult.requireAboveZero && (dif[i] <= 0 || dea[i] <= 0)) continue;

      if (topMACDResult.requirePriorNegative) {
        let hadNegative = false;
        for (let j = Math.max(0, i - 3); j < i; j++) {
          if (hist[j] < 0) { hadNegative = true; break; }
        }
        if (!hadNegative) continue;
      }

      if (hist[i] <= 0 || hist[i] <= hist[i - 1]) continue;

      foundBuy = { index: i, price: closes[i] };
      break;
    }

    if (foundBuy) {
      const buyK = klines[foundBuy.index];
      const stopLoss = (buyK.sp * (1 - (topMACDResult.fixedStopLossPct || 0.05))).toFixed(2);
      dispatch(
        setStockTradePointsAction(
          secid,
          [{ x: buyK.date, y: buyK.sp, t: 'macd' }],
          [],
          ['macd']
        )
      );
      setTestResult(
        `MACD策略：最近3根发现买入信号！日期 ${buyK.date}，价格 ${buyK.sp.toFixed(2)}，止损 ${stopLoss}`
      );
      if (!showMACDPoints) {
        setShowMACDPoints(true);
      }
    } else {
      setTestResult('MACD策略：最近3根K线未找到符合条件的买入信号');
    }
  }, [topMACDResult, klines, secid, dispatch, showMACDPoints]);

  // 测试最近3根K线 - RSI策略
  const testRSIRecent = useCallback(() => {
    if (!topRSIResult || !klines || klines.length < topRSIResult.rsiPeriod + 1) {
      setTestResult('K线数据不足，无法测试');
      return;
    }
    const closes = klines.map((k) => k.sp);
    const rsi = calculateRSI(closes, topRSIResult.rsiPeriod);
    const recentStart = Math.max(topRSIResult.rsiPeriod + 1, klines.length - 3);

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
      let msg = `RSI策略：最近3根发现买入信号！日期 ${buyK.date}，价格 ${buyK.sp.toFixed(2)}`;
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
      setTestResult('RSI策略：最近3根K线未找到符合条件的买入信号');
    }
  }, [topRSIResult, klines, secid, dispatch, showRSIPoints]);

  const maColumns = [
    { title: '参数', dataIndex: 'param', key: 'param' },
    { title: '值', dataIndex: 'value', key: 'value' },
  ];

  const macdColumns = [
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

  const macdData = topMACDResult
    ? [
        { key: '1', param: '快线周期', value: topMACDResult.fast },
        { key: '2', param: '慢线周期', value: topMACDResult.slow },
        { key: '3', param: '信号周期', value: topMACDResult.signal },
        { key: '4', param: '零轴上方', value: topMACDResult.requireAboveZero ? '是' : '否' },
        { key: '5', param: '前负确认', value: topMACDResult.requirePriorNegative ? '是' : '否' },
        { key: '6', param: '交易次数', value: topMACDResult.tradeCount },
        { key: '7', param: '总收益', value: `${topMACDResult.totalReturn.toFixed(2)}%` },
        { key: '8', param: '胜率', value: `${topMACDResult.winRate.toFixed(1)}%` },
        { key: '9', param: '平均收益', value: `${topMACDResult.avgReturn.toFixed(2)}%` },
        { key: '10', param: '平均持仓', value: `${topMACDResult.avgHoldDays.toFixed(1)}天` },
        { key: '11', param: '最大回撤', value: `${topMACDResult.maxDrawdown.toFixed(2)}%` },
        { key: '12', param: '盈亏比', value: topMACDResult.profitFactor.toFixed(2) },
        { key: '13', param: '固定止损', value: `${((topMACDResult.fixedStopLossPct || 0.05) * 100).toFixed(0)}%` },
        { key: '14', param: '移动止损', value: `${((topMACDResult.trailingStopLossPct || 0.06) * 100).toFixed(0)}%` },
        { key: '15', param: '综合评分', value: topMACDResult.score.toFixed(1) },
      ]
    : [];

  // 退出原因统计
  const macdExitStats = topMACDResult
    ? (() => {
        const stats: Record<string, number> = {};
        topMACDResult.trades.forEach((t) => {
          const r = t.exitReason || 'macd_exit';
          stats[r] = (stats[r] || 0) + 1;
        });
        return stats;
      })()
    : {};

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
      {/* 止损参数设置 */}
      <div className={styles.section} style={{ marginBottom: 12 }}>
        <Row gutter={16} align="middle">
          <Col>
            <span style={{ fontSize: 12, color: 'var(--inner-text-color)' }}>止损参数：</span>
          </Col>
          <Col>
            <InputNumber
              size="small"
              min={1}
              max={20}
              value={fixedStopLossPct}
              onChange={(v) => setFixedStopLossPct(v || 5)}
              formatter={(v) => `固定${v}%`}
              parser={(v) => (v ? parseFloat(v.replace(/[^0-9]/g, '')) : 5)}
              style={{ width: 75 }}
              disabled={loading}
            />
          </Col>
          <Col>
            <InputNumber
              size="small"
              min={1}
              max={20}
              value={trailingStopLossPct}
              onChange={(v) => setTrailingStopLossPct(v || 5)}
              formatter={(v) => `移动${v}%`}
              parser={(v) => (v ? parseFloat(v.replace(/[^0-9]/g, '')) : 5)}
              style={{ width: 75 }}
              disabled={loading}
            />
          </Col>
          <Col>
            <Button
              size="small"
              type="primary"
              onClick={runBacktest}
              loading={loading}
              disabled={loading}
            >
              {loading ? '计算中...' : '执行回测'}
            </Button>
          </Col>
          <Col>
            <span style={{ fontSize: 11, color: 'var(--sec-text-color)' }}>
              {loading ? '已在后台计算，请勿重复点击' : '修改参数后需重新执行回测'}
            </span>
          </Col>
        </Row>
      </div>

      <Spin spinning={loading} tip="回测计算中..." size="small">
        <Row gutter={16}>
          {/* MA回踩策略 */}
          <Col span={8}>
            <div className={styles.section}>
              <div className={styles.title}>
                <Tag color="blue">MA均线回踩</Tag>
                {topMAResult && (
                  <span style={{ marginLeft: 8, fontSize: 11 }}>
                    MA{topMAResult.maPeriod} / {topMAResult.holdDays}天
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
                  <Checkbox checked={showMAPoints} onChange={onMAChange} size="small" disabled={loading}>
                    显示买卖点
                  </Checkbox>
                  <Button size="small" onClick={testMARecent} disabled={loading}>
                    测最近3根
                  </Button>
                </div>
              )}
            </div>
          </Col>

          {/* MACD策略 */}
          <Col span={8}>
            <div className={styles.section}>
              <div className={styles.title}>
                <Tag color="green">MACD金叉策略</Tag>
                {topMACDResult && (
                  <span style={{ marginLeft: 8, fontSize: 11 }}>
                    {topMACDResult.fast}/{topMACDResult.slow}/{topMACDResult.signal}
                  </span>
                )}
              </div>
              <Table
                size="small"
                bordered={false}
                pagination={false}
                columns={macdColumns}
                dataSource={macdData}
                rowKey="key"
              />
              {topMACDResult && Object.keys(macdExitStats).length > 0 && (
                <div style={{ fontSize: 10, color: 'var(--sec-text-color)', marginTop: 4, padding: '0 4px' }}>
                  退出统计:{' '}
                  {Object.entries(macdExitStats).map(([reason, count]) => (
                    <span key={reason} style={{ marginRight: 8 }}>
                      {reason === 'macd_exit' ? '死叉' : reason === 'hist_shrink' ? '柱缩' : reason === 'stop_loss_fixed' ? '固损' : reason === 'stop_loss_trailing' ? '移损' : reason}
                      :{count}
                    </span>
                  ))}
                </div>
              )}
              {topMACDResult && (
                <div className={styles.btnGroup}>
                  <Checkbox checked={showMACDPoints} onChange={onMACDChange} size="small" disabled={loading}>
                    显示买卖点
                  </Checkbox>
                  <Button size="small" onClick={testMACDRecent} disabled={loading}>
                    测最近3根
                  </Button>
                </div>
              )}
            </div>
          </Col>

          {/* RSI策略 */}
          <Col span={8}>
            <div className={styles.section}>
              <div className={styles.title}>
                <Tag color="purple">RSI超卖反弹</Tag>
                {topRSIResult && (
                  <span style={{ marginLeft: 8, fontSize: 11 }}>
                    RSI{topRSIResult.rsiPeriod} / 买≤{topRSIResult.buyThreshold}
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
                  <Checkbox checked={showRSIPoints} onChange={onRSIChange} size="small" disabled={loading}>
                    显示买卖点
                  </Checkbox>
                  <Button size="small" onClick={testRSIRecent} disabled={loading}>
                    测最近3根
                  </Button>
                </div>
              )}
            </div>
          </Col>
        </Row>
      </Spin>

      {/* 测试结果提示 */}
      {testResult && (
        <div className={styles.section}>
          <Alert
            message={testResult}
            type={testResult.includes('发现') || testResult.includes('完成') ? 'success' : 'info'}
            size="small"
            banner
            style={{ padding: '4px 8px' }}
          />
        </div>
      )}

      {/* 策略对比 */}
      {topMAResult && topMACDResult && topRSIResult && (
        <div className={styles.section}>
          <div className={styles.title}>策略对比</div>
          <Row gutter={16}>
            <Col span={10}>
              <div className={styles.resultCard}>
                <div className={styles.row}>
                  <span className={styles.label}>维度</span>
                  <span className={styles.value}>MA回踩</span>
                  <span className={styles.value}>MACD</span>
                  <span className={styles.value}>RSI反弹</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.label}>交易次数</span>
                  <span className={styles.value}>{topMAResult.tradeCount}</span>
                  <span className={styles.value}>{topMACDResult.tradeCount}</span>
                  <span className={styles.value}>{topRSIResult.tradeCount}</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.label}>总收益</span>
                  <span className={styles.value}>{topMAResult.totalReturn.toFixed(2)}%</span>
                  <span className={styles.value}>{topMACDResult.totalReturn.toFixed(2)}%</span>
                  <span className={styles.value}>{topRSIResult.totalReturn.toFixed(2)}%</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.label}>胜率</span>
                  <span className={styles.value}>{topMAResult.winRate.toFixed(1)}%</span>
                  <span className={styles.value}>{topMACDResult.winRate.toFixed(1)}%</span>
                  <span className={styles.value}>{topRSIResult.winRate.toFixed(1)}%</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.label}>盈亏比</span>
                  <span className={styles.value}>{topMAResult.profitFactor.toFixed(2)}</span>
                  <span className={styles.value}>{topMACDResult.profitFactor.toFixed(2)}</span>
                  <span className={styles.value}>{topRSIResult.profitFactor.toFixed(2)}</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.label}>最大回撤</span>
                  <span className={styles.value}>{topMAResult.maxDrawdown.toFixed(2)}%</span>
                  <span className={styles.value}>{topMACDResult.maxDrawdown.toFixed(2)}%</span>
                  <span className={styles.value}>{topRSIResult.maxDrawdown.toFixed(2)}%</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.label}>综合评分</span>
                  <span className={styles.value}>{topMAResult.score.toFixed(1)}</span>
                  <span className={styles.value}>{topMACDResult.score.toFixed(1)}</span>
                  <span className={styles.value}>{topRSIResult.score.toFixed(1)}</span>
                </div>
              </div>
            </Col>
            <Col span={14}>
              <div className={styles.hint}>
                说明：回测基于历史K线数据进行参数网格搜索，评分最高的参数组合被选为"最优策略"。
                止损参数（固定止损 + 移动止损）可在上方调整，修改后需重新执行回测。
                勾选"显示买卖点"可将回测产生的交易信号写入股票配置并在K线图上显示。
                点击"测最近5根"会基于最优参数对最近5根K线进行实时验证，有信号则自动标记到K线图并显示建议止损位。
                <br /><br />
                <b>退出原因说明：</b><br />
                死叉 — MACD死叉卖出 &nbsp;|&nbsp;
                柱缩 — 柱状线连续缩短卖出 &nbsp;|&nbsp;
                固损 — 触发固定止损 &nbsp;|&nbsp;
                移损 — 触发移动止损（从最高点回落）
              </div>
            </Col>
          </Row>
        </div>
      )}
    </div>
  );
});

export default BacktestAnalysis;