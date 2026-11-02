import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Radio, Select, Slider, Spin, Switch, Tooltip } from 'antd';
import { ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import * as Services from '@/services';
import * as Utils from '@/utils';
import * as CONST from '@/constants';
import * as Tech from '@/helpers/tech';
import {
  DefaultTechIndicatorTypes,
  KLineType,
  TechIndicatorNames,
  TechIndicatorSeriesNames,
  TechIndicatorType,
} from '@/utils/enums';
import { useNativeThemeColor, useRenderEcharts, useResizeEchart } from '@/utils/hooks';
import { Stock } from '@/types/stock';
import { computeShortTermScoreCurve, SHORT_SCORE_SOURCE } from '@/helpers/shortTermScoreList';
import { BuildDailyKFromTrends } from '@/helpers/stock';
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
/** 分时上「昨日最低价」参考线颜色 */
const PREV_LOW_COLOR = '#13c2c2';
/** 分时上「昨日开盘价」参考线颜色 */
const PREV_OPEN_COLOR = '#faad14';
/** 图表默认显示区间（与详情页 PriceTrend 一致：默认看最近一半） */
const DEFAULT_RANGE = { start: 50, end: 100 };
/** 缩放步长（%） */
const ZOOM_STEP = 5;
/** 关闭技术指标时 Select 的取值 */
const TECH_NONE = -1;
/** 面板图表类型：分时走势 / 日K线 */
type PanelChartMode = 'trend' | 'kline';

interface RangeArea {
  start: number;
  end: number;
}

interface TrendOptionParams {
  /** 当天完整分时 */
  trends: Stock.TrendItem[];
  /** 可见的分钟数（训练模式回放：未推进到的时间点不画） */
  visibleCount: number;
  showVolume: boolean;
  /** 昨收（涨跌基准），<=0 表示未知 */
  zs: number;
  /** 昨日的日K（用于标出昨日最低价、昨日开盘价），为空表示取不到 */
  prevBar?: Stock.KLineItem | null;
}

interface KlineOptionParams {
  klines: Stock.KLineItem[];
  range: RangeArea;
  showVolume: boolean;
  /** TECH_NONE 表示不显示技术指标 */
  techType: number;
  /** 短线评分曲线（YYYYMMDD -> 综合评分），仅 techType = SHORT_SCORE 时使用 */
  shortScoreScores?: Record<string, number>;
}

/** 短线评分曲线的线色（与评分等级色区分，保持中性金色） */
const SHORT_SCORE_LINE_COLOR = '#faad14';

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
  altAxisIndex = -1,
  shortScoreScores?: Record<string, number>
) {
  const colors = Utils.getVariablesColor(CONST.VARIABLES);
  const upColor = colors['--increase-color'] || UP_COLOR_FALLBACK;
  const downColor = colors['--reduce-color'] || DOWN_COLOR_FALLBACK;
  const hintColor = colors['--hint-color'] || '#999';

  // 短线评分：分数由外部现取数算好后传进来（不走评分缓存），这里只按交易日对齐成曲线
  if (techType === TechIndicatorType.SHORT_SCORE) {
    const data = klines.map((k) => {
      const key = String(k?.date || '').replace(/-/g, '').substring(0, 8);
      const v = shortScoreScores?.[key];
      return typeof v === 'number' ? Number(v.toFixed(1)) : null;
    });
    return [
      {
        name: TechIndicatorSeriesNames[TechIndicatorType.SHORT_SCORE][0],
        type: 'line',
        stype: 'tech',
        symbol: 'none',
        xAxisIndex: axisIndex,
        yAxisIndex: axisIndex,
        data,
        connectNulls: false,
        lineStyle: { color: SHORT_SCORE_LINE_COLOR, width: 1.2 },
        itemStyle: { color: SHORT_SCORE_LINE_COLOR },
        // 60 分是 B 级门槛，作为参考线
        markLine: {
          symbol: 'none',
          silent: true,
          label: { show: false },
          data: [{ yAxis: 60, lineStyle: { color: hintColor, opacity: 0.65 } }],
        },
      },
    ];
  }

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
function buildKlineOption({ klines, range, showVolume, techType, shortScoreScores }: KlineOptionParams) {
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
      // 短线评分是 0~100 的固定量纲：固定坐标轴范围，曲线高低不会随区间缩放而失真
      ...(techType === TechIndicatorType.SHORT_SCORE ? { min: 0, max: 100 } : {}),
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
    series.push(
      ...buildTechSeries(techType as TechIndicatorType, klines, techGridIndex, techAltAxisIndex, shortScoreScores)
    );
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
          // 开/收/高/低一律按 dataIndex 从日K数组取：candlestick 的维度是 [x, 开, 收, 低, 高]，
          // echarts 会在数据项前面补一个下标，直接解构 bar.data 会整体错位（开=下标、收=开盘…）
          const k = klines[Number(bar.dataIndex)];
          const open = k ? Number(k.kp) : Number(bar.data?.[0]);
          const close = k ? Number(k.sp) : Number(bar.data?.[1]);
          const low = k ? Number(k.zd) : Number(bar.data?.[2]);
          const high = k ? Number(k.zg) : Number(bar.data?.[3]);
          const rows: string[] = [
            `<div style="font-weight:bold;margin-bottom:4px">${bar.axisValue}</div>`,
            `开 <b>${open.toFixed(2)}</b>　收 <b>${close.toFixed(2)}</b>`,
            `高 <b>${high.toFixed(2)}</b>　低 <b>${low.toFixed(2)}</b>`,
          ];
          list.forEach((p) => {
            if (p.seriesName === '成交量') {
              const vol = Number(klines[Number(p.dataIndex)]?.cjl ?? p.data?.[1]);
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

/** 分时时间标签：兼容 "YYYY-MM-DD HH:MM[:SS]" 与 "HH:MM[:SS]" 两种格式 */
function trendTimeLabel(datetime: string) {
  return datetime && datetime.length >= 16 ? datetime.substring(11, 16) : String(datetime || '').substring(0, 5);
}

/**
 * 日期归一成 YYYYMMDD
 *
 * 分时（"HH:MM:SS"）与日K（"YYYY-MM-DD" / "YYYYMMDD"）的格式不一致，
 * 直接做字符串比较会全部判成「未来日期」，导致找不到前一日K线。
 */
function dateKey(d: any) {
  return String(d || '').replace(/[^0-9]/g, '').substring(0, 8);
}

/**
 * 分时走势 option：价格 + 均价 + 成交量，支持「回放」（只画到第 visibleCount 根）
 *
 * 训练模式下分时是逐分钟推进的：坐标轴始终是整日长度，未推进到的时间点用 null 占位，
 * 曲线随时间一点点「长出来」；价格轴固定为整日区间（含昨收），避免回放时反复缩放。
 *
 * 参考线：昨收（虚横线）+ 昨日K线的最低价 / 开盘价，方便对照今天有没有跌破昨低、高开还是低开。
 */
function buildTrendOption({ trends, visibleCount, showVolume, zs, prevBar }: TrendOptionParams) {
  const colors = Utils.getVariablesColor(CONST.VARIABLES);
  const upColor = colors['--increase-color'] || UP_COLOR_FALLBACK;
  const downColor = colors['--reduce-color'] || DOWN_COLOR_FALLBACK;
  const textColor = colors['--main-text-color'] || '#666';
  const secondaryColor = colors['--hint-color'] || '#999';
  const splitColor = 'rgba(128, 128, 128, 0.25)';
  const tooltipBg = colors['--inner-color'] || colors['--background-color'] || '#fff';
  const tooltipBorder = colors['--border-color'] || 'rgba(128, 128, 128, 0.35)';
  const pointerLabelBg = colors['--primary-color'] || '#888';

  const visible = Math.max(0, Math.min(visibleCount, trends.length));
  const dates = trends.map((t) => trendTimeLabel(t.datetime));
  const hasAverage = trends.some((t) => !!t.average);
  const prices = trends.map((t, i) => (i < visible ? t.current : null));
  const averages = trends.map((t, i) => (i < visible ? t.average : null));
  const vols = trends.map((t, i) =>
    i < visible ? [i, t.vol, t.current >= t.last ? 1 : -1] : null
  );

  const chartHeight = 400;
  const TOP = 6;
  const BOTTOM = 20;
  const GAP = 6;
  const VOL_H = 54;
  const priceH = chartHeight - TOP - BOTTOM - (showVolume ? VOL_H + GAP : 0);
  const gridWidth = { left: 6, right: 46 };

  const grids: any[] = [{ ...gridWidth, top: TOP, height: priceH }];
  if (showVolume) {
    grids.push({ ...gridWidth, top: TOP + priceH + GAP, height: VOL_H });
  }
  const lastGridIndex = grids.length - 1;

  const xAxis = grids.map((_, i) => ({
    type: 'category',
    data: dates,
    gridIndex: i,
    boundaryGap: false,
    axisTick: { show: false },
    axisLine: { lineStyle: { color: splitColor } },
    axisLabel: { show: i === lastGridIndex, fontSize: 9, color: secondaryColor, hideOverlap: true },
    splitLine: { show: false },
  }));

  // 价格轴固定到整日区间（含昨收 / 昨低 / 昨开）：回放过程中不会因数据变多而反复缩放，
  // 跳空开盘时也能保证昨日最低价、开盘价的参考线落在可视范围内
  const prevOpen = Number(prevBar?.kp) || 0;
  const prevLow = Number(prevBar?.zd) || 0;
  const rangeValues = trends.map((t) => t.current).concat(hasAverage ? trends.map((t) => t.average) : []);
  if (zs > 0) {
    rangeValues.push(zs);
  }
  if (prevLow > 0) {
    rangeValues.push(prevLow);
  }
  if (prevOpen > 0) {
    rangeValues.push(prevOpen);
  }
  const minVal = Math.min(...rangeValues);
  const maxVal = Math.max(...rangeValues);
  const yAxis: any[] = [
    {
      scale: true,
      gridIndex: 0,
      position: 'right',
      min: minVal * 0.999,
      max: maxVal * 1.001,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 9, color: secondaryColor, formatter: (v: number) => Number(v).toFixed(2) },
      splitLine: { lineStyle: { color: splitColor, type: 'dashed' } },
    },
  ];
  if (showVolume) {
    yAxis.push({
      scale: true,
      gridIndex: 1,
      position: 'right',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false },
    });
  }

  const currentIdx = Math.max(0, visible - 1);
  const lastVisible = trends[currentIdx];
  const lastPrice = Number(lastVisible?.current ?? trends[0].current);
  const priceColor = zs > 0 && lastPrice < zs ? downColor : upColor;
  // 回放中：标记「当前推进到的位置」，并说明这不是完整分时
  const replaying = visible > 0 && visible < trends.length;
  const markLines: any[] = [];
  if (zs > 0) {
    markLines.push({ yAxis: zs, lineStyle: { color: secondaryColor, type: 'dashed', width: 1 } });
  }
  // 昨日K线的最低价 / 开盘价：带文字标签，方便一眼看出今天是否跌破昨低、高开还是低开
  if (prevLow > 0) {
    markLines.push({
      name: '昨低',
      yAxis: prevLow,
      label: {
        show: true,
        position: 'insideStartTop',
        formatter: `昨低 ${prevLow.toFixed(2)}`,
        color: PREV_LOW_COLOR,
        fontSize: 9,
      },
      lineStyle: { color: PREV_LOW_COLOR, type: 'dotted', width: 1, opacity: 0.9 },
    });
  }
  if (prevOpen > 0) {
    markLines.push({
      name: '昨开',
      yAxis: prevOpen,
      label: {
        show: true,
        position: 'insideStartBottom',
        formatter: `昨开 ${prevOpen.toFixed(2)}`,
        color: PREV_OPEN_COLOR,
        fontSize: 9,
      },
      lineStyle: { color: PREV_OPEN_COLOR, type: 'dotted', width: 1, opacity: 0.9 },
    });
  }
  if (replaying && dates[currentIdx]) {
    markLines.push({ xAxis: dates[currentIdx], lineStyle: { color: secondaryColor, opacity: 0.5, width: 1 } });
  }

  const series: any[] = [
    {
      name: '价格',
      type: 'line',
      data: prices,
      showSymbol: false,
      symbol: 'none',
      connectNulls: false,
      lineStyle: { width: 1.5, color: priceColor },
      // 昨收基准线（涨跌都对照它）+ 回放进度线
      markLine: markLines.length ? { symbol: 'none', silent: true, label: { show: false }, data: markLines } : undefined,
    },
    {
      // 回放不到一整根时也要有可见的「当前价」点
      name: '当前价',
      type: 'scatter',
      data: visible > 0 ? [[currentIdx, lastPrice]] : [],
      symbolSize: 4,
      itemStyle: { color: priceColor },
      silent: true,
      z: 3,
    },
  ];
  if (hasAverage) {
    series.push({
      name: '均价',
      type: 'line',
      data: averages,
      showSymbol: false,
      symbol: 'none',
      connectNulls: false,
      lineStyle: { width: 1, color: MA_COLORS[0] },
    });
  }
  if (showVolume) {
    series.push({
      name: '成交量',
      type: 'bar',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: vols,
      itemStyle: { color: (p: any) => (p.data?.[2] === -1 ? downColor : upColor) },
    });
  }

  return {
    chartHeight,
    option: {
      animation: false,
      grid: grids,
      xAxis,
      yAxis,
      axisPointer: { link: [{ xAxisIndex: grids.map((_, i) => i) }] },
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: {
          type: 'cross',
          label: { backgroundColor: pointerLabelBg, color: '#fff', fontSize: 10, borderWidth: 0 },
        },
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        borderWidth: 1,
        padding: [6, 8],
        textStyle: { fontSize: 11, color: textColor },
        extraCssText: 'box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2); border-radius: 4px;',
        formatter: (params: any) => {
          // 未推进到的时间点 data 为 null，直接跳过
          const list: any[] = (params || []).filter((p: any) => p && p.data !== null && p.data !== undefined);
          if (!list.length) {
            return '';
          }
          const price = list.find((p) => p.seriesName === '价格');
          const avg = list.find((p) => p.seriesName === '均价');
          const vol = list.find((p) => p.seriesName === '成交量');
          const rows: string[] = [`<div style="font-weight:bold;margin-bottom:4px">${list[0].axisValue}</div>`];
          if (price) {
            const value = Number(price.data);
            const chg = zs > 0 ? (value / zs) * 100 - 100 : 0;
            rows.push(`现价 <b>${value.toFixed(2)}</b>`);
            rows.push(`涨跌 <b>${chg.toFixed(2)}%</b>`);
          }
          if (avg) {
            rows.push(`均价 <b>${Number(avg.data).toFixed(2)}</b>`);
          }
          if (vol && Array.isArray(vol.data)) {
            rows.push(`成交量 <b>${(Number(vol.data[1]) / 10000).toFixed(2)}万手</b>`);
          }
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
  /**
   * 训练日（YYYY-MM-DD）；非训练模式为空
   *
   * 取数层按训练日截断日K，训练日推进后必须重取，否则面板会停在上一交易日：
   * 交易区表现为「训练日当天停牌 / 预计成交 0 股」，涨停挂单也不会回填成交。
   */
  trainDate?: string;
  /**
   * 训练日内的「推进时刻」（HH:MM，09:25 ~ 15:00）；非训练模式为空
   *
   * 由顶部操作区的时间推进统一驱动：分时只画到这个时刻，日K的当日那根也按分时重建，
   * 保证面板看到的和当时的盘面一致（不会提前看到收盘后的数据）。
   */
  trainTime?: string;
  /** 点击名字/代码打开股票详情 */
  onOpenStock: (secid: string, name: string) => void;
}

/**
 * 评分结果列表右侧的个股信息面板
 *
 * 从上往下：名字+代码（点击打开详情）→ 公司简介 → 日K线（可缩放/成交量/技术指标）→ 买入卖出操作。
 * 日K线与短线评分同源（Tushare），训练模式下由取数层自动截断到训练日。
 */
const ScoreStockPanel: React.FC<ScoreStockPanelProps> = ({ code, secid, name, trainDate, trainTime, onOpenStock }) => {
  const [intro, setIntro] = useState('');
  const [introLoading, setIntroLoading] = useState(false);
  const [klines, setKlines] = useState<Stock.KLineItem[]>([]);
  const [klineLoading, setKlineLoading] = useState(false);
  const [klineError, setKlineError] = useState('');

  const inTraining = !!trainDate;

  // ===== 分时走势 =====
  const [trends, setTrends] = useState<Stock.TrendItem[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState('');
  // 图表默认看日K线（分时需要时手动切换；训练模式下日K的当日那根仍按「训练时间」用分时重建）
  const [chartMode, setChartMode] = useState<PanelChartMode>('kline');

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
    // 训练日推进也要重取：日K在取数层按训练日截断，不重取会一直停在上一交易日
  }, [secid, trainDate]);

  // 短线评分曲线：选中该技术指标时现取数逐日计算（不读评分缓存），算完再画线
  const [shortScoreScores, setShortScoreScores] = useState<Record<string, number>>({});
  const [shortScoreCurveLoading, setShortScoreCurveLoading] = useState(false);
  useEffect(() => {
    if (techType !== TechIndicatorType.SHORT_SCORE) {
      return () => {};
    }
    let canceled = false;
    setShortScoreScores({});
    setShortScoreCurveLoading(true);
    computeShortTermScoreCurve({ code, name, limit: PANEL_KLINE_LIMIT })
      .then((curve) => {
        if (!canceled) {
          setShortScoreScores(curve.scores);
        }
      })
      .catch(() => {
        if (!canceled) {
          setShortScoreScores({});
        }
      })
      .finally(() => {
        if (!canceled) {
          setShortScoreCurveLoading(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, [techType, code, name]);

  // 默认看日K线：只在「进入/退出训练」时回到日K，训练日推进不打断用户当前选择
  const wasTrainingRef = useRef(inTraining);
  useEffect(() => {
    if (wasTrainingRef.current !== inTraining) {
      wasTrainingRef.current = inTraining;
      setChartMode('kline');
    }
  }, [inTraining]);

  // 分时取数：训练模式取训练日的历史分时（Tushare 1 分钟线），非训练模式取实时分时。
  // 训练模式下即使当前看的是日K也要取：当日那根K线要按分时重建（见 displayKlines）；
  // 非训练模式同样始终取一次：交易区按「当前分时价」成交，不能只看日K收盘价。
  useEffect(() => {
    let canceled = false;
    setTrends([]);
    setTrendError('');
    setTrendLoading(true);
    const loader: Promise<Stock.TrendItem[]> = trainDate
      ? Services.Stock.requestHistTrends(secid, trainDate.replace(/-/g, ''))
      : Services.Stock.GetTrendFromDataSource(SHORT_SCORE_SOURCE, secid).then(
          (r: any) => (r?.trends || []) as Stock.TrendItem[]
        );
    Promise.resolve(loader)
      .then((list) => {
        if (!canceled) {
          setTrends(list || []);
        }
      })
      .catch((e: any) => {
        if (!canceled) {
          setTrendError(e?.message || '分时取数失败');
        }
      })
      .finally(() => {
        if (!canceled) {
          setTrendLoading(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, [secid, trainDate, inTraining]);

  /** 训练时间内已经走出来的分时（<= 当前时刻）；非训练模式/未推进时用全部分时 */
  const visibleTrends = useMemo(() => {
    if (!inTraining || !trainTime) {
      return trends;
    }
    return trends.filter((t) => trendTimeLabel(t.datetime) <= trainTime);
  }, [trends, trainTime, inTraining]);

  /**
   * 当前分时价：训练模式取训练时刻之前最后一根分钟线，非训练模式取实时分时最新一根。
   * 交易区（ScoreStockTrade）的买入、卖出都按这个价格成交，0 表示当前还没有分时数据。
   *
   * 集合竞价阶段（09:30 前）还没有分钟线：训练模式退回当日开盘价（09:25 竞价已定开盘价），
   * 不能退回收盘价 —— 那是收盘后的未来数据。
   */
  const trendPrice = useMemo(() => {
    const price = Number(visibleTrends[visibleTrends.length - 1]?.current) || 0;
    if (price > 0 || !inTraining || !trends.length) {
      return price;
    }
    const day = String(trainDate || '').substring(0, 10);
    const dayK = klines.find((k) => String(k?.date || '').substring(0, 10) === day);
    return Number(dayK?.kp) || 0;
  }, [visibleTrends, inTraining, trends.length, klines, trainDate]);

  // 非训练模式定时刷新分时：交易区按现价成交，价格不能停在打开面板那一刻的快照
  useEffect(() => {
    if (inTraining) {
      return () => {};
    }
    let canceled = false;
    const timer = window.setInterval(() => {
      Services.Stock.GetTrendFromDataSource(SHORT_SCORE_SOURCE, secid)
        .then((r: any) => {
          const list = (r?.trends || []) as Stock.TrendItem[];
          if (!canceled && list.length) {
            setTrends(list);
          }
        })
        .catch(() => {});
    }, 60000);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [secid, inTraining]);

  const trendTotal = trends.length;
  // 训练模式只画到「训练时间」为止，不显示完整分时；非训练模式直接看完整分时
  const visibleCount = inTraining ? Math.min(visibleTrends.length, trendTotal) : trendTotal;

  /**
   * 分时所属交易日（YYYYMMDD）
   *
   * 分时的 `datetime` 只有 "HH:MM:SS"（实时与历史分时都一样），取不到日期，
   * 所以训练模式取训练日，非训练模式取今天。
   */
  const trendDayKey = useMemo(() => {
    const day = dateKey(trainDate);
    return day.length === 8 ? day : dateKey(dayjs().format('YYYY-MM-DD'));
  }, [trainDate]);

  /** 分时昨收：训练模式取历史分时首根的 last（该交易日 pre_close，后端已换算成与日K一致的前复权口径） */
  const trendZs = useMemo(() => {
    if (!trends.length) {
      return 0;
    }
    const first = trends[0];
    const firstLast = Number(first.last) || 0;
    if (inTraining && firstLast > 0) {
      return firstLast;
    }
    // 实时分时的首根 last 就是现价（接口不给昨收），退化用日K推算：最后一根若是分时当天，取它前一根收盘
    if (klines.length) {
      const lastK = klines[klines.length - 1];
      const isSameDay = dateKey(lastK.date) === trendDayKey;
      if (isSameDay && klines.length > 1) {
        return Number(klines[klines.length - 2].sp) || 0;
      }
      if (!isSameDay) {
        return Number(lastK.sp) || 0;
      }
    }
    return firstLast && firstLast !== Number(first.current) ? firstLast : 0;
  }, [trends, klines, inTraining, trendDayKey]);

  /** 分时状态文字：当前训练时刻 / 现价 / 涨跌幅 */
  const trendStatus = useMemo(() => {
    if (!trends.length) {
      return '';
    }
    if (inTraining && visibleCount <= 0) {
      // 集合竞价阶段（09:30 之前）还没有分钟数据
      return `${trainTime || ''} 未开盘`;
    }
    const bar = trends[Math.max(0, visibleCount - 1)];
    const price = Number(bar?.current) || 0;
    const chg = trendZs > 0 ? (price / trendZs) * 100 - 100 : 0;
    const progress = inTraining && visibleCount < trendTotal ? ` · ${visibleCount}/${trendTotal}分钟` : '';
    return `${trendTimeLabel(bar?.datetime)} 现价 ${price.toFixed(2)}（${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%）${progress}`;
  }, [trends, visibleCount, trendZs, inTraining, trendTotal, trainTime]);

  /**
   * 训练模式下日K的「当日那根」按分时重建
   *
   * 训练日的官方日K是收盘口径（对盘中时点属于未来数据）；时间推进时用分时合成一根
   * 「截至当前时刻」的K线替换掉它，还没开盘（无分时）时当日的K直接不显示。
   *
   * 开盘价取当日日K的 kp（09:25 集合竞价已定，不属于未来数据）：分时首根是 09:30 的成交价，
   * 秒板/跳空时会明显偏离真实开盘价（曾出现 34.61 vs 真实开盘 33.96 的偏差）。
   */
  const displayKlines = useMemo(() => {
    if (!inTraining || !trainTime || !trainDate || !trends.length) {
      return klines;
    }
    const day = String(trainDate).substring(0, 10);
    const base = klines.filter((k) => String(k?.date || '').substring(0, 10) !== day);
    if (!visibleTrends.length) {
      return base;
    }
    const dayBar = klines.find((k) => String(k?.date || '').substring(0, 10) === day);
    const bar = BuildDailyKFromTrends({
      secid,
      trends: visibleTrends,
      date: day,
      prevClose: trendZs,
      openPrice: Number(dayBar?.kp) || 0,
    });
    return bar ? [...base, bar] : base;
  }, [inTraining, trainTime, trainDate, trends, visibleTrends, klines, trendZs, secid]);

  /**
   * 昨日K线：分时所属交易日之前（含训练日口径）的最后一根日K
   *
   * 日K是按训练日截断的，训练模式取到的最后一根往往就是训练日自己，需要往前退一根才是昨天，
   * 所以统一按「日期 < 分时所属日」筛，而不是直接取最后两根。
   */
  const prevDayBar = useMemo(() => {
    if (trendDayKey.length !== 8 || !klines.length) {
      return null;
    }
    const before = klines.filter((k) => {
      const key = dateKey(k?.date);
      return key.length === 8 && key < trendDayKey;
    });
    return before.length ? before[before.length - 1] : null;
  }, [klines, trendDayKey]);

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
  const { option, chartHeight } = useMemo(() => {
    if (chartMode === 'trend') {
      return trends.length
        ? buildTrendOption({ trends, visibleCount, showVolume, zs: trendZs, prevBar: prevDayBar })
        : { option: null, chartHeight: 400 };
    }
    return displayKlines.length
      ? buildKlineOption({ klines: displayKlines, range, showVolume, techType, shortScoreScores })
      : { option: null, chartHeight: techType === TECH_NONE ? 400 : 480 };
  }, [
    chartMode,
    trends,
    visibleCount,
    trendZs,
    prevDayBar,
    showVolume,
    displayKlines,
    range,
    techType,
    shortScoreScores,
    darkMode,
    lowKey,
  ]);
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
        {/* 图表工具栏：分时/日K切换；日K下为技术指标 / 成交量 / 缩放；训练模式分时另带回放操作 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 6,
            marginBottom: 4,
          }}
        >
          <Radio.Group
            size="small"
            value={chartMode}
            onChange={(e) => setChartMode(e.target.value as PanelChartMode)}
          >
            <Radio.Button value="trend">分时</Radio.Button>
            <Radio.Button value="kline">日K线</Radio.Button>
          </Radio.Group>
          {chartMode === 'kline' ? (
            <>
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                日K线{displayKlines.length ? `（${displayKlines.length}个交易日）` : ''}
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
            </>
          ) : (
            <>
              <Tooltip title="成交量">
                <Switch size="small" checked={showVolume} onChange={setShowVolume} />
              </Tooltip>
              <span style={{ fontSize: 12, color: 'var(--secondary-text-color)' }}>{trendStatus}</span>
            </>
          )}
        </div>
        <div ref={chartRef} style={{ width: '100%', height: chartHeight }} />
        {chartMode === 'trend' ? (
          <>
            {trendLoading ? (
              <div style={{ fontSize: 12, color: 'var(--secondary-text-color)' }}>
                <Spin size="small" /> 分时加载中...
              </div>
            ) : null}
            {!trendLoading && trendError ? (
              <div style={{ fontSize: 12, color: '#ff4d4f' }}>{trendError}</div>
            ) : null}
            {!trendLoading && !trendError && !trends.length ? (
              <div style={{ fontSize: 12, color: 'var(--secondary-text-color)' }}>暂无分时数据</div>
            ) : null}
          </>
        ) : (
          <>
            {klineLoading ? (
              <div style={{ fontSize: 12, color: 'var(--secondary-text-color)' }}>
                <Spin size="small" /> 日K加载中...
              </div>
            ) : null}
            {shortScoreCurveLoading ? (
              <div style={{ fontSize: 12, color: 'var(--secondary-text-color)' }}>
                <Spin size="small" /> 短线评分曲线现取数计算中（最近 {PANEL_KLINE_LIMIT} 个交易日）...
              </div>
            ) : null}
            {!klineLoading && klineError ? (
              <div style={{ fontSize: 12, color: '#ff4d4f' }}>{klineError}</div>
            ) : null}
            {!klineLoading && !klineError && !displayKlines.length ? (
              <div style={{ fontSize: 12, color: 'var(--secondary-text-color)' }}>暂无日K数据</div>
            ) : null}
          </>
        )}
      </div>

      {/* 买入卖出区域：训练模式与详情页共用同一个训练账户 */}
      <div style={{ marginTop: 12 }}>
        <p>
          <span>人不渡我，唯有自渡</span>
        </p>
        <ScoreStockTrade
          secid={secid}
          code={code}
          name={name}
          klines={klines}
          currentPrice={trendPrice}
          intradayReady={!trendLoading}
        />
      </div>
    </aside>
  );
};

export default ScoreStockPanel;
