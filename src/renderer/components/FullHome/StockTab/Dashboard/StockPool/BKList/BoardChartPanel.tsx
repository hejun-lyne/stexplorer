import React, { useEffect, useMemo, useState } from 'react';
import { Button, Radio, Select, Spin, Switch, Tooltip } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import * as Services from '@/services';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
import * as Tech from '@/helpers/tech';
import {
  DefaultTechIndicatorTypes,
  KLineType,
  TechIndicatorNames,
  TechIndicatorType,
} from '@/utils/enums';
import { Stock } from '@/types/stock';
import { StoreState } from '@/reducers/types';
import { useNativeThemeColor, useRenderEcharts, useResizeEchart } from '@/utils/hooks';

/**
 * 板块图表面板（BKList「交易模式」右侧栏）
 *
 * 板块不是可交易标的，这里只有图表、没有下单/持仓/自选等交易控件。
 * 图表与 STList 的 ScoreStockPanel 同口径：一张图用「分时 / 日K线」切换，
 * 日K 固定日线周期（板块没有周/月线的可靠数据源），可选技术指标与成交量开关。
 *
 * 分时取数走 GetTrendFromDataSource：板块（90.BKxxxx）在该函数里统一走 Tushare 链，
 * 因为腾讯 / 163 的个股分笔接口不认识板块代码。
 */

/** K线取数条数 */
const KLINE_LIMIT = 160;
/** 关闭技术指标时 Select 的取值 */
const TECH_NONE = -1;
type ChartMode = 'trend' | 'kline';
const MA_PERIODS = [5, 10, 20];
const MA_COLORS = ['#00b4d8', '#06d6a0', '#e76f51'];
const TECH_LINE_COLORS = ['#0099DD', '#FF9933', '#00ABBD'];
/** 板块没有个股短线评分曲线所需的成分数据，指标列表里去掉 SHORT_SCORE */
const BOARD_TECH_TYPES = DefaultTechIndicatorTypes.filter((v) => v !== TechIndicatorType.SHORT_SCORE);

interface ThemeColors {
  up: string;
  down: string;
  text: string;
  hint: string;
  split: string;
  tooltipBg: string;
  tooltipBorder: string;
  pointerBg: string;
}

/** 分时时间标签：兼容 "YYYY-MM-DD HH:MM[:SS]" 与 "HH:MM[:SS]" */
function trendTimeLabel(datetime: string) {
  return datetime && datetime.length >= 16 ? datetime.substring(11, 16) : String(datetime || '').substring(0, 5);
}

/** 图表通用的 tooltip 样式：显式指定底色，避免暗黑主题下白底灰字 */
function tooltipStyle(c: ThemeColors) {
  return {
    trigger: 'axis' as const,
    confine: true,
    axisPointer: {
      type: 'cross' as const,
      label: { backgroundColor: c.pointerBg, color: '#fff', fontSize: 10, borderWidth: 0 },
    },
    backgroundColor: c.tooltipBg,
    borderColor: c.tooltipBorder,
    borderWidth: 1,
    padding: [6, 8],
    textStyle: { fontSize: 11, color: c.text },
    extraCssText: 'box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2); border-radius: 4px;',
  };
}

function buildTrendOption({
  trends,
  showVolume,
  prevClose,
  c,
}: {
  trends: Stock.TrendItem[];
  showVolume: boolean;
  /** 分时所属交易日的昨收（日K的 zs）；取不到才退回分时首根的 last */
  prevClose: number;
  c: ThemeColors;
}) {
  const dates = trends.map((t) => trendTimeLabel(String(t.datetime || '')));
  const prices = trends.map((t) => Number(t.current) || 0);
  const avgs = trends.map((t) => Number(t.average) || 0);
  const vols = trends.map((t) => Number(t.vol) || 0);
  // 东财实时分时首根的 last 是「前一笔价格」而非昨收，涨跌基准优先用日K的 zs
  const zs = prevClose > 0 ? prevClose : Number(trends[0]?.last) || 0;
  const lastPrice = prices[prices.length - 1] || 0;
  const priceColor = zs > 0 && lastPrice < zs ? c.down : c.up;

  // 百分比布局：图表面板高度可拖动，不用固定像素高度
  const grids: any[] = [
    { left: 8, right: 46, top: '4%', bottom: showVolume ? '26%' : '6%', containLabel: true },
  ];
  if (showVolume) {
    grids.push({ left: 8, right: 46, top: '78%', bottom: '6%', containLabel: true });
  }
  const lastGrid = grids.length - 1;
  const xAxis = grids.map((_, i) => ({
    type: 'category',
    data: dates,
    gridIndex: i,
    boundaryGap: false,
    axisTick: { show: false },
    axisLine: { lineStyle: { color: c.split } },
    axisLabel: { show: i === lastGrid, fontSize: 9, color: c.hint, hideOverlap: true },
    splitLine: { show: false },
  }));
  const yAxis: any[] = [
    {
      scale: true,
      gridIndex: 0,
      position: 'right',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 9, color: c.hint, formatter: (v: number) => Number(v).toFixed(2) },
      splitLine: { lineStyle: { color: c.split, type: 'dashed' } },
    },
  ];
  if (showVolume) {
    yAxis.push({
      scale: true,
      gridIndex: 1,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false },
    });
  }

  const series: any[] = [
    {
      name: '价格',
      type: 'line',
      data: prices,
      showSymbol: false,
      symbol: 'none',
      lineStyle: { width: 1.5, color: priceColor },
      areaStyle: { color: priceColor, opacity: 0.08 },
      markLine: zs
        ? {
            symbol: 'none',
            silent: true,
            label: { show: false },
            data: [{ yAxis: zs, lineStyle: { color: c.hint, type: 'dashed', width: 1 } }],
          }
        : undefined,
    },
    {
      name: '均价',
      type: 'line',
      data: avgs,
      showSymbol: false,
      symbol: 'none',
      lineStyle: { width: 1, color: MA_COLORS[0] },
    },
  ];
  if (showVolume) {
    series.push({
      name: '成交量',
      type: 'bar',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: vols,
      itemStyle: {
        color: (p: any) =>
          prices[p.dataIndex] >= (Number(trends[p.dataIndex]?.last) || 0) ? c.up : c.down,
      },
    });
  }

  return {
    animation: false,
    grid: grids,
    xAxis,
    yAxis,
    axisPointer: { link: [{ xAxisIndex: grids.map((_, i) => i) }] },
    tooltip: {
      ...tooltipStyle(c),
      formatter: (params: any) => {
        const list: any[] = params || [];
        if (!list.length) return '';
        const i = Number(list[0].dataIndex);
        const price = Number(prices[i]);
        const chg = zs > 0 ? (price / zs) * 100 - 100 : 0;
        const rows = [
          `<div style="font-weight:bold;margin-bottom:4px">${list[0].axisValue}</div>`,
          `现价 <b>${price.toFixed(2)}</b>`,
          `涨跌 <b>${chg.toFixed(2)}%</b>`,
        ];
        if (Number(avgs[i]) > 0) rows.push(`均价 <b>${Number(avgs[i]).toFixed(2)}</b>`);
        if (showVolume) rows.push(`成交量 <b>${(Number(vols[i]) / 10000).toFixed(2)}万手</b>`);
        return rows.join('<br/>');
      },
    },
    series,
  };
}

function buildKlineOption({
  klines,
  showVolume,
  techType,
  c,
}: {
  klines: Stock.KLineItem[];
  showVolume: boolean;
  techType: number;
  c: ThemeColors;
}) {
  const showTech = techType !== TECH_NONE;
  const dates = klines.map((k) => String(k.date || ''));
  // candlestick 数据顺序：[开盘, 收盘, 最低, 最高]
  const values = klines.map((k) => [Number(k.kp) || 0, Number(k.sp) || 0, Number(k.zd) || 0, Number(k.zg) || 0]);
  const closes = klines.map((k) => Number(k.sp) || 0);
  const vols = klines.map((k, i) => [i, Number(k.cjl) || 0, i > 0 && closes[i] < closes[i - 1] ? -1 : 1]);

  // 主图 / 成交量 / 技术指标三段，按开关用百分比排布
  const mainBottom = showTech ? (showVolume ? '42%' : '28%') : showVolume ? '26%' : '6%';
  const grids: any[] = [{ left: 8, right: 46, top: '4%', bottom: mainBottom, containLabel: true }];
  let volGridIndex = -1;
  let techGridIndex = -1;
  if (showVolume) {
    volGridIndex = grids.length;
    grids.push({
      left: 8,
      right: 46,
      top: showTech ? '62%' : '78%',
      bottom: showTech ? '26%' : '6%',
      containLabel: true,
    });
  }
  if (showTech) {
    techGridIndex = grids.length;
    grids.push({ left: 8, right: 46, top: showVolume ? '78%' : '76%', bottom: '6%', containLabel: true });
  }
  const lastGrid = grids.length - 1;
  const xAxis = grids.map((_, i) => ({
    type: 'category',
    data: dates,
    gridIndex: i,
    boundaryGap: true,
    axisTick: { show: false },
    axisLine: { lineStyle: { color: c.split } },
    axisLabel: { show: i === lastGrid, fontSize: 9, color: c.hint, hideOverlap: true },
    splitLine: { show: false },
  }));
  const yAxis: any[] = [
    {
      scale: true,
      gridIndex: 0,
      position: 'right',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 9, color: c.hint, formatter: (v: number) => Number(v).toFixed(2) },
      splitLine: { lineStyle: { color: c.split, type: 'dashed' } },
    },
  ];
  if (showVolume) {
    yAxis.push({
      scale: true,
      gridIndex: volGridIndex,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false },
    });
  }
  let techAltAxisIndex = -1;
  if (showTech) {
    yAxis.push({
      scale: true,
      gridIndex: techGridIndex,
      position: 'right',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 9, color: c.hint, formatter: (v: number) => Number(v).toFixed(2) },
      splitLine: { show: false },
    });
    // ADV 的 DI+/DI- 与 ADV 量纲差异大，挂一条同 grid 的隐藏 y 轴
    if (techType === TechIndicatorType.ADV) {
      techAltAxisIndex = yAxis.length;
      yAxis.push({
        scale: true,
        gridIndex: techGridIndex,
        position: 'left',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
      });
    }
  }

  const series: any[] = [
    {
      name: 'K线',
      type: 'candlestick',
      data: values,
      itemStyle: { color: c.up, color0: c.down, borderColor: c.up, borderColor0: c.down },
    },
    ...MA_PERIODS.map((period, i) => ({
      name: `MA${period}`,
      type: 'line',
      data: Utils.calculateMA(period, closes),
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 1, color: MA_COLORS[i] },
    })),
  ];
  if (showVolume) {
    series.push({
      name: '成交量',
      type: 'bar',
      xAxisIndex: volGridIndex,
      yAxisIndex: volGridIndex,
      data: vols,
      itemStyle: { color: (p: any) => (p.data?.[2] === -1 ? c.down : c.up) },
    });
  }
  if (showTech) {
    // 指标算法直接复用 STList / 详情页同一套 helper
    const { names, values: techValues } = Tech.calculateIndicators(klines, techType as TechIndicatorType);
    if (techType === TechIndicatorType.MACD) {
      series.push({
        name: names[0],
        type: 'bar',
        xAxisIndex: techGridIndex,
        yAxisIndex: techGridIndex,
        data: techValues[0],
        itemStyle: { color: (p: any) => (Number(p?.data) >= 0 ? c.up : c.down) },
      });
      series.push({
        name: names[1],
        type: 'line',
        xAxisIndex: techGridIndex,
        yAxisIndex: techGridIndex,
        data: techValues[1],
        symbol: 'none',
        lineStyle: { width: 1, color: '#da6ee8' },
      });
      series.push({
        name: names[2],
        type: 'line',
        xAxisIndex: techGridIndex,
        yAxisIndex: techGridIndex,
        data: techValues[2],
        symbol: 'none',
        lineStyle: { width: 1, color: '#39afe6' },
      });
    } else {
      const guideLines =
        techType === TechIndicatorType.RSI || techType === TechIndicatorType.KDJ
          ? [30, 70]
          : techType === TechIndicatorType.ADV
            ? [20, 40]
            : [];
      techValues.forEach((vals, i) =>
        series.push({
          name: names[i],
          type: 'line',
          xAxisIndex: techGridIndex,
          yAxisIndex: i > 0 && techAltAxisIndex >= 0 ? techAltAxisIndex : techGridIndex,
          data: vals,
          symbol: 'none',
          lineStyle: { width: 1, color: TECH_LINE_COLORS[i] || TECH_LINE_COLORS[0], opacity: 0.9 },
          markLine:
            i === 0 && guideLines.length
              ? {
                  symbol: 'none',
                  silent: true,
                  label: { show: false },
                  data: guideLines.map((y) => ({ yAxis: y, lineStyle: { color: c.hint, opacity: 0.65 } })),
                }
              : undefined,
        })
      );
    }
  }

  return {
    animation: false,
    grid: grids,
    xAxis,
    yAxis,
    axisPointer: { link: [{ xAxisIndex: grids.map((_, i) => i) }] },
    dataZoom: [
      { type: 'inside', xAxisIndex: grids.map((_, i) => i), start: 50, end: 100 },
    ],
    tooltip: {
      ...tooltipStyle(c),
      formatter: (params: any) => {
        const list: any[] = params || [];
        const bar = list.find((p: any) => p.seriesName === 'K线');
        if (!bar) return '';
        const k = klines[Number(bar.dataIndex)];
        const open = k ? Number(k.kp) : Number(bar.data?.[1]);
        const close = k ? Number(k.sp) : Number(bar.data?.[2]);
        const low = k ? Number(k.zd) : Number(bar.data?.[3]);
        const high = k ? Number(k.zg) : Number(bar.data?.[4]);
        const rows = [
          `<div style="font-weight:bold;margin-bottom:4px">${bar.axisValue}</div>`,
          `开 <b>${open.toFixed(2)}</b>　收 <b>${close.toFixed(2)}</b>`,
          `高 <b>${high.toFixed(2)}</b>　低 <b>${low.toFixed(2)}</b>`,
        ];
        list.forEach((p: any) => {
          if (p.seriesName === 'K线' || p.seriesName.startsWith('MA')) return;
          if (p.seriesName === '成交量') {
            const vol = Number(k?.cjl ?? p.data?.[1]);
            if (!Number.isNaN(vol)) rows.push(`成交量 <b>${(vol / 10000).toFixed(2)}万手</b>`);
            return;
          }
          const v = Number(p.data);
          if (!Number.isNaN(v)) rows.push(`${p.seriesName} <b>${v.toFixed(2)}</b>`);
        });
        return rows.join('<br/>');
      },
    },
    series,
  };
}

export interface BoardChartPanelProps {
  secid: string;
  name: string;
  onClose: () => void;
  /** 由外层可拖动/可收起容器决定宽度（不再自带 50% 宽度与左边框） */
  fill?: boolean;
}

const BoardChartPanel: React.FC<BoardChartPanelProps> = ({ secid, name, onClose, fill = false }) => {
  const { kLineApiSourceSetting } = useSelector((state: StoreState) => state.setting.systemSetting);
  const { colors, darkMode } = useNativeThemeColor(CONST.VARIABLES);
  const [chartMode, setChartMode] = useState<ChartMode>('trend');
  const [techType, setTechType] = useState<number>(TechIndicatorType.RSI);
  const [showVolume, setShowVolume] = useState(true);
  const [trends, setTrends] = useState<Stock.TrendItem[]>([]);
  const [klines, setKlines] = useState<Stock.KLineItem[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [klineLoading, setKlineLoading] = useState(false);
  const [trendError, setTrendError] = useState('');
  const [klineError, setKlineError] = useState('');

  // 分时：板块 secid 在 GetTrendFromDataSource 里统一走 Tushare 链
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

  // 日K：与 ScoreStockPanel 一样固定日线周期
  useEffect(() => {
    if (!secid) return () => {};
    let cancelled = false;
    setKlines([]);
    setKlineError('');
    setKlineLoading(true);
    Services.Stock.GetKFromDataSource(kLineApiSourceSetting, secid, KLineType.Day, KLINE_LIMIT)
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
  }, [secid, kLineApiSourceSetting]);

  const c = useMemo<ThemeColors>(
    () => ({
      up: colors['--increase-color'] || '#d32f2f',
      down: colors['--reduce-color'] || '#388e3c',
      text: colors['--main-text-color'] || '#888',
      hint: colors['--hint-color'] || '#999',
      split: colors['--border-color'] || 'rgba(128,128,128,0.25)',
      tooltipBg: colors['--inner-color'] || colors['--background-color'] || '#fff',
      tooltipBorder: colors['--border-color'] || 'rgba(128,128,128,0.35)',
      pointerBg: colors['--primary-color'] || '#888',
    }),
    [colors]
  );

  /** 分时所属交易日的昨收：日K最后一根通常与分时同属一日，其 zs 就是该日昨收 */
  const prevClose = useMemo(() => Number(klines[klines.length - 1]?.zs) || 0, [klines]);

  /** 最新价 / 涨跌幅：分时更实时，优先用；取不到才退回日K */
  const quote = useMemo(() => {
    const t = trends[trends.length - 1];
    if (t) {
      const price = Number(t.current) || 0;
      const base = prevClose > 0 ? prevClose : Number(t.last) || 0;
      return { price, zdf: base > 0 ? (price / base - 1) * 100 : 0 };
    }
    const last = klines[klines.length - 1];
    if (last) return { price: Number(last.sp) || 0, zdf: Number(last.zdf) || 0 };
    return { price: 0, zdf: 0 };
  }, [klines, trends, prevClose]);

  const option = useMemo(() => {
    if (chartMode === 'trend') {
      return trends.length ? buildTrendOption({ trends, showVolume, prevClose, c }) : null;
    }
    return klines.length ? buildKlineOption({ klines, showVolume, techType, c }) : null;
  }, [chartMode, trends, klines, showVolume, prevClose, techType, c]);

  const { ref: chartRef, chartInstance } = useResizeEchart(-1);
  useRenderEcharts(
    () => {
      if (!chartInstance) return;
      if (option) chartInstance.setOption(option, true);
      else chartInstance.clear();
    },
    chartInstance,
    [option, darkMode]
  );

  const activeLoading = chartMode === 'trend' ? trendLoading : klineLoading;
  const activeError = chartMode === 'trend' ? trendError : klineError;
  const hasData = chartMode === 'trend' ? trends.length > 0 : klines.length > 0;
  const emptyText = chartMode === 'trend' ? '暂无分时数据' : '暂无日K数据';

  return (
    <div
      style={{
        // fill = 撑满外层可拖动容器；否则退回原来与列表平分宽度
        flex: fill ? '1 1 0%' : '1 1 50%',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: fill ? 'none' : `1px solid ${c.split}`,
        backgroundColor: 'var(--background-color)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          padding: '4px 8px',
          borderBottom: `1px solid ${c.split}`,
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
        <Radio.Group size="small" value={chartMode} onChange={(e) => setChartMode(e.target.value as ChartMode)}>
          <Radio.Button value="trend">分时</Radio.Button>
          <Radio.Button value="kline">日K线</Radio.Button>
        </Radio.Group>
        {chartMode === 'kline' ? (
          <Select size="small" style={{ width: 100 }} value={techType} onChange={(v) => setTechType(Number(v))}>
            <Select.Option value={TECH_NONE}>无指标</Select.Option>
            {BOARD_TECH_TYPES.map((v) => (
              <Select.Option key={v} value={v}>
                {(TechIndicatorNames as Record<number, string>)[v]}
              </Select.Option>
            ))}
          </Select>
        ) : null}
        <Tooltip title="成交量">
          <Switch size="small" checked={showVolume} onChange={setShowVolume} />
        </Tooltip>
        <Button
          size="small"
          type="text"
          icon={<CloseOutlined />}
          title="关闭图表面板（收起 / 展开请用左侧分隔条上的箭头）"
          onClick={onClose}
        />
      </div>

      <div style={{ position: 'relative', flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div ref={chartRef} style={{ flex: '1 1 0%', minHeight: 0, width: '100%' }} />
        {(activeLoading || activeError || !hasData) && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              color: c.text,
              backgroundColor: 'var(--background-color)',
              opacity: 0.9,
            }}
          >
            {activeLoading ? <Spin size="small" /> : activeError || emptyText}
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(BoardChartPanel);
