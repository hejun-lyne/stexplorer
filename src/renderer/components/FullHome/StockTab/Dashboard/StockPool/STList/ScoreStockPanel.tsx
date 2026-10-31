import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Select, Slider, Spin, Switch, Tooltip } from 'antd';
import { ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import * as Services from '@/services';
import * as Utils from '@/utils';
import * as CONST from '@/constants';
import * as Tech from '@/helpers/tech';
import { DefaultTechIndicatorTypes, KLineType, TechIndicatorNames, TechIndicatorType } from '@/utils/enums';
import { useNativeThemeColor, useRenderEcharts, useResizeEchart } from '@/utils/hooks';
import { Stock } from '@/types/stock';
import { SHORT_SCORE_SOURCE } from '@/helpers/shortTermScoreList';
import { GetCompanyFromTushare } from '@/services/tushare';
import ScoreStockTrade from './ScoreStockTrade';

/** 面板日K线取数条数（约半年） */
const PANEL_KLINE_LIMIT = 120;
/** 涨/跌颜色兜底（主题变量取不到时使用） */
const UP_COLOR_FALLBACK = '#d32f2f';
const DOWN_COLOR_FALLBACK = '#388e3c';
const MA_COLORS = ['#00b4d8', '#06d6a0', '#e76f51'];
const TECH_LINE_COLORS = ['#0099DD', '#FF9933', '#00ABBD'];
const MA_PERIODS = [5, 10, 20];
/** 图表默认显示区间（与详情页 PriceTrend 一致：默认看最近一半） */
const DEFAULT_RANGE = { start: 50, end: 100 };
/** 缩放步长（%） */
const ZOOM_STEP = 5;
/** 关闭技术指标时 Select 的取值 */
const TECH_NONE = -1;

interface RangeArea {
  start: number;
  end: number;
}

interface KlineOptionParams {
  klines: Stock.KLineItem[];
  range: RangeArea;
  showVolume: boolean;
  /** TECH_NONE 表示不显示技术指标 */
  techType: number;
}

/** 公司简介内存缓存（secid -> 简介），来回切换股票时不重复取数 */
const introCache = new Map<string, string>();

/**
 * 技术指标 series（与详情页 PriceTrend 的指标画法保持一致）
 *
 * MACD 为柱状 + 两条线；其余指标为多条线，超买/超卖线用 markLine 标注。
 */
function buildTechSeries(
  techType: TechIndicatorType,
  klines: Stock.KLineItem[],
  axisIndex: number,
  altAxisIndex = -1
) {
  const colors = Utils.getVariablesColor(CONST.VARIABLES);
  const upColor = colors['--increase-color'] || UP_COLOR_FALLBACK;
  const downColor = colors['--reduce-color'] || DOWN_COLOR_FALLBACK;
  const hintColor = colors['--hint-color'] || '#999';
  const { names, values } = Tech.calculateIndicators(klines, techType);

  if (techType === TechIndicatorType.MACD) {
    return [
      {
        name: names[0],
        type: 'bar',
        stype: 'tech',
        xAxisIndex: axisIndex,
        yAxisIndex: axisIndex,
        data: values[0],
        itemStyle: {
          color: (p: any) => (Number(p?.data) >= 0 ? upColor : downColor),
        },
      },
      {
        name: names[1],
        type: 'line',
        stype: 'tech',
        symbol: 'none',
        xAxisIndex: axisIndex,
        yAxisIndex: axisIndex,
        data: values[1],
        lineStyle: { color: '#da6ee8', width: 1 },
      },
      {
        name: names[2],
        type: 'line',
        stype: 'tech',
        symbol: 'none',
        xAxisIndex: axisIndex,
        yAxisIndex: axisIndex,
        data: values[2],
        lineStyle: { color: '#39afe6', width: 1, opacity: 0.8 },
      },
    ];
  }

  const guideLines =
    techType === TechIndicatorType.RSI || techType === TechIndicatorType.KDJ
      ? [30, 70]
      : techType === TechIndicatorType.ADV
      ? [20, 40]
      : [];

  return names.map((name, i) => ({
    name,
    type: 'line',
    stype: 'tech',
    symbol: 'none',
    xAxisIndex: axisIndex,
    // ADV 的 DI+/DI- 与 ADV 量纲差异大，走同 grid 的第二条 y 轴，避免被压成直线
    yAxisIndex: i > 0 && altAxisIndex >= 0 ? altAxisIndex : axisIndex,
    data: values[i],
    lineStyle: { color: TECH_LINE_COLORS[i] || TECH_LINE_COLORS[0], width: 1, opacity: 0.9 },
    markLine:
      i === 0 && guideLines.length
        ? {
            symbol: 'none',
            silent: true,
            label: { show: false },
            data: guideLines.map((y) => ({ yAxis: y, lineStyle: { color: hintColor, opacity: 0.65 } })),
          }
        : undefined,
  }));
}

/**
 * 日K线 option：K线 + 均线 + 成交量 + 技术指标，支持按区间缩放
 *
 * 布局（价格 / 成交量 / 技术指标）按开关动态排布，高度用像素计算，
 * 保证在较矮的面板里各 grid 也能等分得比较均匀。
 */
function buildKlineOption({ klines, range, showVolume, techType }: KlineOptionParams) {
  const colors = Utils.getVariablesColor(CONST.VARIABLES);
  const upColor = colors['--increase-color'] || UP_COLOR_FALLBACK;
  const downColor = colors['--reduce-color'] || DOWN_COLOR_FALLBACK;
  const textColor = colors['--main-text-color'] || '#666';
  const secondaryColor = colors['--hint-color'] || '#999';
  const splitColor = 'rgba(128, 128, 128, 0.25)';
  // tooltip 必须显式指定底色/边框：默认是白底，暗黑模式下用主题主文字色（浅色）会变成「白底灰字」看不清
  const tooltipBg = colors['--inner-color'] || colors['--background-color'] || '#fff';
  const tooltipBorder = colors['--border-color'] || 'rgba(128, 128, 128, 0.35)';
  const pointerLabelBg = colors['--primary-color'] || '#888';

  const showTech = techType !== TECH_NONE;
  const dates = klines.map((k) => k.date);
  // candlestick 数据顺序：[开盘, 收盘, 最低, 最高]
  const values = klines.map((k) => [k.kp, k.sp, k.zd, k.zg]);
  const closes = klines.map((k) => k.sp);
  const vols = klines.map((k, i) => [i, k.cjl, i > 0 && k.sp < klines[i - 1].sp ? -1 : 1]);

  const chartHeight = showTech ? 480 : 400;
  const TOP = 6;
  const BOTTOM = 20;
  const GAP = 6;
  const VOL_H = 54;
  const TECH_H = 96;
  const priceH =
    chartHeight - TOP - BOTTOM - (showVolume ? VOL_H + GAP : 0) - (showTech ? TECH_H + GAP : 0);
  const gridWidth = { left: 6, right: 46 };

  const grids: any[] = [{ ...gridWidth, top: TOP, height: priceH }];
  let volGridIndex = -1;
  let techGridIndex = -1;
  if (showVolume) {
    volGridIndex = grids.length;
    grids.push({ ...gridWidth, top: TOP + priceH + GAP, height: VOL_H });
  }
  if (showTech) {
    techGridIndex = grids.length;
    grids.push({
      ...gridWidth,
      top: TOP + priceH + GAP + (showVolume ? VOL_H + GAP : 0),
      height: TECH_H,
    });
  }
  const lastGridIndex = grids.length - 1;

  const xAxis = grids.map((_, i) => ({
    type: 'category',
    data: dates,
    gridIndex: i,
    boundaryGap: true,
    axisTick: { show: false },
    axisLine: { lineStyle: { color: splitColor } },
    // 只有最下面一个 grid 显示日期，避免多条坐标轴叠在一起
    axisLabel: { show: i === lastGridIndex, fontSize: 9, color: secondaryColor, hideOverlap: true },
    splitLine: { show: false },
  }));

  const yAxis: any[] = [
    {
      scale: true,
      gridIndex: 0,
      position: 'right',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 9, color: secondaryColor, formatter: (v: number) => Number(v).toFixed(2) },
      splitLine: { lineStyle: { color: splitColor, type: 'dashed' } },
    },
  ];
  if (showVolume) {
    yAxis.push({
      scale: true,
      gridIndex: volGridIndex,
      position: 'right',
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
      axisLabel: { fontSize: 9, color: secondaryColor, formatter: (v: number) => Number(v).toFixed(2) },
      splitLine: { show: false },
    });
    if (techType === TechIndicatorType.ADV) {
      // ADV 的 DI+/DI- 与 ADV 量纲差异大，额外挂一条同 grid 的隐藏 y 轴
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

  // 价格轴按「当前显示区间」定 min/max：放大后 K 线不会被压成一条直线
  const total = klines.length;
  const startIndex = Math.max(0, Math.floor((total * range.start) / 100));
  const endIndex = Math.min(total, Math.ceil((total * range.end) / 100));
  const showed = klines.slice(startIndex, endIndex);
  if (showed.length) {
    yAxis[0].min = Math.min(...showed.map((k) => k.zd));
    yAxis[0].max = Math.max(...showed.map((k) => k.zg));
  }

  const series: any[] = [
    {
      name: 'K线',
      type: 'candlestick',
      data: values,
      itemStyle: {
        color: upColor,
        color0: downColor,
        borderColor: upColor,
        borderColor0: downColor,
      },
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
      itemStyle: {
        color: (p: any) => (p.data?.[2] === -1 ? downColor : upColor),
      },
    });
  }
  if (showTech) {
    series.push(...buildTechSeries(techType as TechIndicatorType, klines, techGridIndex, techAltAxisIndex));
  }

  return {
    chartHeight,
    option: {
      animation: false,
      grid: grids,
      xAxis,
      yAxis,
      axisPointer: { link: [{ xAxisIndex: grids.map((_, i) => i) }] },
      // 缩放窗口由外部 range 控制（滑杆 + 放大/缩小按钮），与详情页 PriceTrend 的交互一致
      dataZoom: {
        type: 'inside',
        zoomOnMouseWheel: false,
        moveOnMouseMove: false,
        start: range.start,
        end: range.end,
        xAxisIndex: grids.map((_, i) => i),
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          label: {
            // 十字准星的日期/数值标签：跟随主题主色 + 白字，暗黑模式下也看得清
            backgroundColor: pointerLabelBg,
            color: '#fff',
            fontSize: 10,
            borderWidth: 0,
          },
        },
        confine: true,
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        borderWidth: 1,
        padding: [6, 8],
        textStyle: { fontSize: 11, color: textColor },
        extraCssText: 'box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2); border-radius: 4px;',
        formatter: (params: any) => {
          const list: any[] = params || [];
          const bar = list.find((p) => p.seriesName === 'K线');
          if (!bar) {
            return '';
          }
          const [open, close, low, high] = bar.data;
          const rows: string[] = [
            `<div style="font-weight:bold;margin-bottom:4px">${bar.axisValue}</div>`,
            `开 <b>${Number(open).toFixed(2)}</b>　收 <b>${Number(close).toFixed(2)}</b>`,
            `高 <b>${Number(high).toFixed(2)}</b>　低 <b>${Number(low).toFixed(2)}</b>`,
          ];
          list.forEach((p) => {
            if (p.seriesName === '成交量') {
              const vol = Number(p.data?.[1]);
              if (!Number.isNaN(vol)) {
                rows.push(`${p.seriesName} <b>${(vol / 10000).toFixed(2)}万手</b>`);
              }
              return;
            }
            const value = Number(p.data);
            if (!Number.isNaN(value)) {
              rows.push(`${p.seriesName} <b>${value.toFixed(2)}</b>`);
            }
          });
          return rows.join('<br/>');
        },
      },
      series,
    },
  };
}

export interface ScoreStockPanelProps {
  code: string;
  secid: string;
  name: string;
  /** 点击名字/代码打开股票详情 */
  onOpenStock: (secid: string, name: string) => void;
}

/**
 * 评分结果列表右侧的个股信息面板
 *
 * 从上往下：名字+代码（点击打开详情）→ 公司简介 → 日K线（可缩放/成交量/技术指标）→ 买入卖出操作。
 * 日K线与短线评分同源（Tushare），训练模式下由取数层自动截断到训练日。
 */
const ScoreStockPanel: React.FC<ScoreStockPanelProps> = ({ code, secid, name, onOpenStock }) => {
  const [intro, setIntro] = useState('');
  const [introLoading, setIntroLoading] = useState(false);
  const [klines, setKlines] = useState<Stock.KLineItem[]>([]);
  const [klineLoading, setKlineLoading] = useState(false);
  const [klineError, setKlineError] = useState('');

  // ===== 图表控制（与详情页 PriceTrend 对齐）=====
  const [range, setRange] = useState<RangeArea>(DEFAULT_RANGE);
  const [showVolume, setShowVolume] = useState(true);
  // 与详情页 PriceTrend 一致：技术指标默认显示 RSI
  const [techType, setTechType] = useState<number>(TechIndicatorType.RSI);

  // 公司简介：Tushare 优先，取不到时回退东财（内容更全）
  useEffect(() => {
    let canceled = false;
    const cached = introCache.get(secid);
    if (cached != null) {
      setIntro(cached);
      setIntroLoading(false);
      return () => {
        canceled = true;
      };
    }
    setIntro('');
    setIntroLoading(true);
    (async () => {
      let text = '';
      try {
        const company = await GetCompanyFromTushare(secid);
        text = company?.gsjs || '';
      } catch {
        text = '';
      }
      if (!text) {
        try {
          const company = await Services.Stock.GetABCompany(secid);
          text = company?.gsjs || '';
        } catch {
          text = '';
        }
      }
      if (text) {
        // 只缓存取到的内容：空结果（接口异常/无数据）留待下次重试
        introCache.set(secid, text);
      }
      if (canceled) {
        return;
      }
      setIntro(text);
      setIntroLoading(false);
    })();
    return () => {
      canceled = true;
    };
  }, [secid]);

  // 日K线（与评分同源）
  useEffect(() => {
    let canceled = false;
    setKlines([]);
    setKlineError('');
    setKlineLoading(true);
    Services.Stock.GetKFromDataSource(SHORT_SCORE_SOURCE, secid, KLineType.Day, PANEL_KLINE_LIMIT)
      .then((r) => {
        if (canceled) {
          return;
        }
        if (r?.error) {
          setKlineError(String(r.error));
          return;
        }
        setKlines(r?.ks || []);
      })
      .catch((e: any) => {
        if (!canceled) {
          setKlineError(e?.message || '日K取数失败');
        }
      })
      .finally(() => {
        if (!canceled) {
          setKlineLoading(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, [secid]);

  // 切换股票：重置缩放区间
  useEffect(() => {
    setRange(DEFAULT_RANGE);
  }, [secid]);

  const zoomIn = useCallback(() => {
    setRange((r) => (r.end - r.start <= ZOOM_STEP * 2 ? r : { start: r.start + ZOOM_STEP, end: r.end }));
  }, []);

  const zoomOut = useCallback(() => {
    setRange((r) => ({ start: Math.max(0, r.start - ZOOM_STEP), end: r.end }));
  }, []);

  const updateRange = useCallback((value: any) => {
    const [start, end] = (value || DEFAULT_RANGE) as [number, number];
    setRange({ start, end });
  }, []);

  // 图表配色取自 CSS 变量：切主题（深/浅、低饱和度）后必须重算 option，否则 tooltip 底色会停在旧主题
  const { darkMode, lowKey } = useNativeThemeColor([]);
  const { option, chartHeight } = useMemo(
    () =>
      klines.length
        ? buildKlineOption({ klines, range, showVolume, techType })
        : { option: null, chartHeight: techType === TECH_NONE ? 400 : 480 },
    [klines, range, showVolume, techType, darkMode, lowKey]
  );
  const { ref: chartRef, chartInstance } = useResizeEchart(-1);
  useRenderEcharts(
    () => {
      if (!chartInstance) {
        return;
      }
      if (option) {
        chartInstance.setOption(option, true);
      } else {
        chartInstance.clear();
      }
    },
    chartInstance,
    [option]
  );

  return (
    <aside
      style={{
        // 与左侧结果列表平分宽度
        flex: '1 1 50%',
        minWidth: 0,
        height: '100%',
        overflowY: 'auto',
        boxSizing: 'border-box',
        padding: '4px 12px 12px',
        borderLeft: '1px solid var(--border-color)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          lineHeight: 2,
          cursor: 'pointer',
        }}
        title="点击打开股票详情"
        onClick={() => onOpenStock(secid, name)}
      >
        <span style={{ fontSize: 16, fontWeight: 'bold', color: '#1890ff' }}>{name || code}</span>
        <span style={{ fontSize: 12, color: 'var(--secondary-text-color)' }}>{code}</span>
      </div>

      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>公司简介</div>
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.7,
            color: 'var(--secondary-text-color)',
            whiteSpace: 'pre-wrap',
            maxHeight: 120,
            overflowY: 'auto',
          }}
        >
          {introLoading ? <Spin size="small" /> : intro || '暂无公司简介'}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        {/* 图表工具栏：技术指标 / 成交量 / 缩放（与详情页 PriceTrend 一致） */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 6,
            marginBottom: 4,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            日K线{klines.length ? `（${klines.length}个交易日）` : ''}
          </span>
          <Select size="small" style={{ width: 100 }} value={techType} onChange={(v) => setTechType(Number(v))}>
            <Select.Option value={TECH_NONE}>无指标</Select.Option>
            {DefaultTechIndicatorTypes.map((v) => (
              <Select.Option value={v} key={`tit_${v}`}>
                {(TechIndicatorNames as Record<number, string>)[v]}
              </Select.Option>
            ))}
          </Select>
          <Tooltip title="成交量">
            <Switch size="small" checked={showVolume} onChange={setShowVolume} />
          </Tooltip>
          <Slider
            range
            min={0}
            max={100}
            style={{ width: 110, margin: '0 2px' }}
            value={[range.start, range.end]}
            onChange={updateRange}
            tipFormatter={null}
          />
          <Button size="small" type="text" icon={<ZoomInOutlined />} onClick={zoomIn} title="放大" />
          <Button size="small" type="text" icon={<ZoomOutOutlined />} onClick={zoomOut} title="缩小" />
        </div>
        <div ref={chartRef} style={{ width: '100%', height: chartHeight }} />
        {klineLoading ? (
          <div style={{ fontSize: 12, color: 'var(--secondary-text-color)' }}>
            <Spin size="small" /> 日K加载中...
          </div>
        ) : null}
        {!klineLoading && klineError ? (
          <div style={{ fontSize: 12, color: '#ff4d4f' }}>{klineError}</div>
        ) : null}
        {!klineLoading && !klineError && !klines.length ? (
          <div style={{ fontSize: 12, color: 'var(--secondary-text-color)' }}>暂无日K数据</div>
        ) : null}
      </div>

      {/* 买入卖出区域：训练模式与详情页共用同一个训练账户 */}
      <div style={{ marginTop: 12 }}>
        <p>
          <span>人不渡我，唯有自渡</span>
        </p>
        <ScoreStockTrade secid={secid} code={code} name={name} klines={klines} />
      </div>
    </aside>
  );
};

export default ScoreStockPanel;
