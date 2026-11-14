import React, { useEffect, useMemo, useState } from 'react';
import { Button, Radio, Spin, Tooltip } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import * as Services from '@/services';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
import { KLineType } from '@/utils/enums';
import { Stock } from '@/types/stock';
import { StoreState } from '@/reducers/types';
import { useNativeThemeColor, useRenderEcharts, useResizeEchart } from '@/utils/hooks';

/**
 * 板块图表面板（BKList「交易模式」右侧栏）
 *
 * 板块不是可交易标的，这里只展示分时与K线两张图，不含下单、持仓、自选等交易相关操作。
 * 数据走与板块详情页相同的 service：GetTrendFromDataSource / GetKFromDataSource（secid 形如 90.BK0428）。
 */

/** K线取数条数 */
const KLINE_LIMIT = 160;

export interface BoardChartPanelProps {
  secid: string;
  name: string;
  onClose: () => void;
}

const K_TYPE_OPTIONS: { label: string; value: KLineType }[] = [
  { label: '日K', value: KLineType.Day },
  { label: '周K', value: KLineType.Week },
  { label: '月K', value: KLineType.Month },
];

const BoardChartPanel: React.FC<BoardChartPanelProps> = ({ secid, name, onClose }) => {
  const { kLineApiSourceSetting } = useSelector((state: StoreState) => state.setting.systemSetting);
  const { colors, darkMode } = useNativeThemeColor(CONST.VARIABLES);
  const [ktype, setKtype] = useState<KLineType>(KLineType.Day);
  const [trends, setTrends] = useState<Stock.TrendItem[]>([]);
  const [klines, setKlines] = useState<Stock.KLineItem[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [klineLoading, setKlineLoading] = useState(false);
  const [trendError, setTrendError] = useState('');
  const [klineError, setKlineError] = useState('');

  // 分时：只随板块切换取数
  useEffect(() => {
    if (!secid) return () => {};
    let cancelled = false;
    setTrends([]);
    setTrendError('');
    setTrendLoading(true);
    Services.Stock.GetTrendFromDataSource(kLineApiSourceSetting, secid)
      .then((r: any) => {
        if (!cancelled) setTrends(Array.isArray(r?.trends) ? r.trends : []);
      })
      .catch((e: any) => {
        if (!cancelled) setTrendError(String(e?.message || e || '分时取数失败'));
      })
      .finally(() => {
        if (!cancelled) setTrendLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [secid, kLineApiSourceSetting]);

  // K线：板块或周期切换时取数
  useEffect(() => {
    if (!secid) return () => {};
    let cancelled = false;
    setKlines([]);
    setKlineError('');
    setKlineLoading(true);
    Services.Stock.GetKFromDataSource(kLineApiSourceSetting, secid, ktype, KLINE_LIMIT)
      .then((r: any) => {
        if (!cancelled) setKlines(Array.isArray(r?.ks) ? r.ks : []);
      })
      .catch((e: any) => {
        if (!cancelled) setKlineError(String(e?.message || e || 'K线取数失败'));
      })
      .finally(() => {
        if (!cancelled) setKlineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [secid, ktype, kLineApiSourceSetting]);

  const upColor = colors['--increase-color'] || '#d32f2f';
  const downColor = colors['--reduce-color'] || '#388e3c';
  const textColor = colors['--main-text-color'] || '#888';
  const splitColor = colors['--border-color'] || 'rgba(128,128,128,0.25)';
  const axisBase = { axisLine: { lineStyle: { color: splitColor } }, axisLabel: { color: textColor } };

  /** 最新价 / 涨跌幅：优先用最后一根日K，分时作为兜底 */
  const quote = useMemo(() => {
    const last = klines[klines.length - 1];
    if (last) {
      return { price: Number(last.sp) || 0, zdf: Number(last.zdf) || 0 };
    }
    const t = trends[trends.length - 1];
    if (t) {
      const price = Number(t.current) || 0;
      const zs = Number(t.last) || 0;
      return { price, zdf: zs ? (price / zs - 1) * 100 : 0 };
    }
    return { price: 0, zdf: 0 };
  }, [klines, trends]);

  const trendOption = useMemo(() => {
    const times = trends.map((t) => String(t.datetime || '').slice(-5));
    const prices = trends.map((t) => Number(t.current) || 0);
    const avgs = trends.map((t) => Number(t.average) || 0);
    const zs = trends.length ? Number(trends[0].last) || 0 : 0;
    const lastPrice = prices[prices.length - 1] || 0;
    const lineColor = zs && lastPrice >= zs ? upColor : downColor;
    const interval = Math.max(0, Math.floor(times.length / 5));
    return {
      animation: false,
      grid: { top: 10, left: 8, right: 12, bottom: 6, containLabel: true },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any[]) => {
          if (!params?.length) return '';
          const p = params[0];
          const avg = params.find((x) => x.seriesName === '均价')?.data;
          const zdf = zs ? ((Number(p.data) / zs - 1) * 100).toFixed(2) : '--';
          return `${p.axisValue}<br/>价格 ${Number(p.data).toFixed(2)}（${zdf}%）<br/>均价 ${
            avg != null ? Number(avg).toFixed(2) : '--'
          }`;
        },
      },
      xAxis: {
        type: 'category',
        data: times,
        boundaryGap: false,
        ...axisBase,
        axisLabel: { ...axisBase.axisLabel, fontSize: 10, interval },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        ...axisBase,
        axisLabel: { ...axisBase.axisLabel, fontSize: 10, formatter: (v: number) => Number(v).toFixed(2) },
        splitLine: { lineStyle: { color: splitColor, opacity: 0.35 } },
      },
      series: [
        {
          name: '价格',
          type: 'line',
          data: prices,
          showSymbol: false,
          lineStyle: { width: 1.5, color: lineColor },
          areaStyle: { color: lineColor, opacity: 0.08 },
        },
        {
          name: '均价',
          type: 'line',
          data: avgs,
          showSymbol: false,
          lineStyle: { width: 1, color: '#e8a33d' },
        },
        {
          name: '昨收',
          type: 'line',
          data: trends.map(() => zs),
          showSymbol: false,
          lineStyle: { width: 1, type: 'dashed', opacity: 0.45 },
        },
      ],
    };
  }, [trends, upColor, downColor, textColor, splitColor]);

  const klineOption = useMemo(() => {
    const dates = klines.map((k) => String(k.date || ''));
    const ohlc = klines.map((k) => [Number(k.kp) || 0, Number(k.sp) || 0, Number(k.zd) || 0, Number(k.zg) || 0]);
    const ma = (n: number) =>
      klines.map((_, i) => {
        if (i < n - 1) return '-';
        let sum = 0;
        for (let j = i - n + 1; j <= i; j++) sum += Number(klines[j].sp) || 0;
        return Number((sum / n).toFixed(2));
      });
    const volumeColors = klines.map((k) => ((Number(k.sp) || 0) >= (Number(k.kp) || 0) ? upColor : downColor));
    const interval = Math.max(0, Math.floor(dates.length / 5));
    return {
      animation: false,
      grid: [
        { top: 8, left: 8, right: 12, height: '58%', containLabel: true },
        { top: '76%', left: 8, right: 12, height: '16%', containLabel: true },
      ],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: any[]) => {
          const k = params?.find((p) => p.seriesType === 'candlestick');
          if (!k) return '';
          const [, open, close, low, high] = k.data || [];
          return `${k.axisValue}<br/>开 ${Number(open).toFixed(2)}　收 ${Number(close).toFixed(
            2
          )}<br/>高 ${Number(high).toFixed(2)}　低 ${Number(low).toFixed(2)}`;
        },
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1], start: Math.max(0, 100 - Math.min(100, 8000 / Math.max(dates.length, 1))), end: 100 },
      ],
      xAxis: [
        {
          type: 'category',
          data: dates,
          gridIndex: 0,
          ...axisBase,
          axisLabel: { show: false },
          splitLine: { show: false },
        },
        {
          type: 'category',
          data: dates,
          gridIndex: 1,
          ...axisBase,
          axisLabel: { ...axisBase.axisLabel, fontSize: 10, interval },
          splitLine: { show: false },
        },
      ],
      yAxis: [
        {
          type: 'value',
          scale: true,
          gridIndex: 0,
          ...axisBase,
          axisLabel: { ...axisBase.axisLabel, fontSize: 10, formatter: (v: number) => Number(v).toFixed(0) },
          splitLine: { lineStyle: { color: splitColor, opacity: 0.35 } },
        },
        {
          type: 'value',
          gridIndex: 1,
          ...axisBase,
          axisLabel: { show: false },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'K线',
          type: 'candlestick',
          data: ohlc,
          itemStyle: { color: upColor, color0: downColor, borderColor: upColor, borderColor0: downColor },
        },
        { name: 'MA5', type: 'line', data: ma(5), showSymbol: false, lineStyle: { width: 1, color: '#00b4d8' } },
        { name: 'MA10', type: 'line', data: ma(10), showSymbol: false, lineStyle: { width: 1, color: '#e8a33d' } },
        { name: 'MA20', type: 'line', data: ma(20), showSymbol: false, lineStyle: { width: 1, color: '#b5179e' } },
        {
          name: '成交量',
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: klines.map((k) => Number(k.cjl) || 0),
          itemStyle: { color: (p: any) => volumeColors[p.dataIndex] || textColor },
        },
      ],
    };
  }, [klines, upColor, downColor, textColor, splitColor]);

  const { ref: trendRef, chartInstance: trendChart } = useResizeEchart(-1);
  const { ref: klineRef, chartInstance: klineChart } = useResizeEchart(-1);
  useRenderEcharts(() => trendChart?.setOption(trendOption, true), trendChart, [trendOption, darkMode]);
  useRenderEcharts(() => klineChart?.setOption(klineOption, true), klineChart, [klineOption, darkMode]);

  return (
    <div
      style={{
        flex: '1 1 50%',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: `1px solid ${splitColor}`,
        backgroundColor: 'var(--background-color)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
          borderBottom: `1px solid ${splitColor}`,
          flex: 'none',
          minWidth: 0,
        }}
      >
        <Tooltip title={`${name}（${secid}）`}>
          <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {name}
          </span>
        </Tooltip>
        {quote.price > 0 && (
          <span className={Utils.GetValueColor(quote.zdf).textClass} style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            {quote.price.toFixed(2)} {Utils.Yang(quote.zdf)}%
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Radio.Group
          size="small"
          value={ktype}
          onChange={(e) => setKtype(e.target.value as KLineType)}
        >
          {K_TYPE_OPTIONS.map((o) => (
            <Radio.Button key={o.value} value={o.value}>
              {o.label}
            </Radio.Button>
          ))}
        </Radio.Group>
        <Button size="small" type="text" icon={<CloseOutlined />} title="关闭图表面板" onClick={onClose} />
      </div>

      <div style={{ position: 'relative', flex: '1 1 42%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '2px 8px', fontSize: 11, color: textColor, flex: 'none' }}>分时</div>
        <div ref={trendRef} style={{ flex: '1 1 0%', minHeight: 0, width: '100%' }} />
        {(trendLoading || trendError || !trends.length) && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              color: textColor,
              backgroundColor: 'var(--background-color)',
              opacity: 0.9,
            }}
          >
            {trendLoading ? <Spin size="small" /> : trendError || '暂无分时数据'}
          </div>
        )}
      </div>

      <div
        style={{
          position: 'relative',
          flex: '1 1 58%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          borderTop: `1px solid ${splitColor}`,
        }}
      >
        <div style={{ padding: '2px 8px', fontSize: 11, color: textColor, flex: 'none' }}>
          K线（{K_TYPE_OPTIONS.find((o) => o.value === ktype)?.label}）
        </div>
        <div ref={klineRef} style={{ flex: '1 1 0%', minHeight: 0, width: '100%' }} />
        {(klineLoading || klineError || !klines.length) && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              color: textColor,
              backgroundColor: 'var(--background-color)',
              opacity: 0.9,
            }}
          >
            {klineLoading ? <Spin size="small" /> : klineError || '暂无K线数据'}
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(BoardChartPanel);
