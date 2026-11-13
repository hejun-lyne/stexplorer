import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Radio, Select, Slider, Spin, Switch, Tag, Tooltip } from 'antd';
import {
  LeftOutlined,
  RightOutlined,
  UnorderedListOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
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
import {
  computeScoreJumps,
  describeScoreJump,
  formatScoreDelta,
  SCORE_JUMP_CONFIG,
} from '@/helpers/shortTermScoreJump';
import type { ScoreJumpPoint } from '@/helpers/shortTermScoreJump';
import {
  computeShortScoreSignalSeries,
  DEFAULT_SHORT_SCORE_SIGNAL_PARAMS,
  isBuySignalKind,
  shortScoreSignalColor,
  SHORT_SCORE_JUMP_BUY_MARK_COLOR,
  SHORT_SCORE_RISE_BUY_MARK_COLOR,
  SHORT_SCORE_SELL_MARK_COLOR,
} from '@/helpers/shortTermScoreBacktest';
import type { ShortScoreSignal } from '@/helpers/shortTermScoreBacktest';
import { BuildDailyKFromTrends } from '@/helpers/stock';
import {
  ComputeEarly30Prediction,
  ComputeIntradayPattern,
  Early30VolSignatureNames,
  IntradayPatternFeatures,
  Early30Features,
} from '@/helpers/intradayPattern';
import { GetCompanyFromTushare } from '@/services/tushare';
import { ComputeTrainAccount } from '@/helpers/trainAccount';
import ScoreStockTrade, { POSITION_RATIOS } from './ScoreStockTrade';

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
  /** 图表总高度（列表模式会压缩，便于同时观察多只股票） */
  height?: number;
  /** 紧凑模式（列表模式）：隐藏时间 / 价格轴标签 */
  compact?: boolean;
}

interface KlineOptionParams {
  klines: Stock.KLineItem[];
  range: RangeArea;
  showVolume: boolean;
  /** TECH_NONE 表示不显示技术指标 */
  techType: number;
  /** 短线评分曲线（YYYYMMDD -> 综合评分），仅 techType = SHORT_SCORE 时使用 */
  shortScoreScores?: Record<string, number>;
  /** 图表总高度（列表模式会压缩，便于同时观察多只股票） */
  height?: number;
  /** 紧凑模式（列表模式）：隐藏时间 / 价格轴标签 */
  compact?: boolean;
}

/** 列表模式的图表高度：压缩为原来的 60%，一屏能同时看更多股票 */
const LIST_TREND_HEIGHT = Math.round(230 * 0.6);
const LIST_KLINE_HEIGHT = Math.round(300 * 0.6);

/** 短线评分曲线的线色（与评分等级色区分，保持中性金色） */
const SHORT_SCORE_LINE_COLOR = '#faad14';
/**
 * 短线评分「自低点抬升」叠加线回看多少根
 *
 * 与详情页 PriceTrend、买入规则里的「低位抬升」同口径：
 * 抬升幅度 = 当日评分 - 前 N 根内的最低分。
 * 取 10 根，与信号规则的 riseRefDays 一致（否则图上「抬升已过线」与「信号列没反应」会打架）。
 */
const SHORT_SCORE_RISE_DAYS = 10;
/** 「自低点抬升」达到该值即视为启动（= 信号规则的 minRise；单日跳升另有 20 分阈值） */
const SHORT_SCORE_RISE_THRESHOLD = 20;

/** 公司简介内存缓存（secid -> 简介），来回切换股票时不重复取数 */
const introCache = new Map<string, string>();

/** 短线评分的三条叠加序列（与详情页 PriceTrend 同口径） */
interface ShortScoreLines {
  /** 评分曲线：点带单日变化/突变描述，供 tooltip 展示 */
  scoreData: any[];
  /** 逐点单日变化（正=跳升，负=跳降；null=缺失或首点） */
  deltas: (number | null)[];
  /** 与 deltas 对齐：该点是否达到突变阈值 */
  jumpFlags: boolean[];
  /** 自近 N 根低点的累计抬升（恒 >= 0） */
  riseData: any[];
  /** 与 deltas 对齐：该点是买入 / 卖出信号日（图表上给柱子换色并做标记） */
  signals: (ShortScoreSignal | null)[];
  /** 突变柱 / 抬升线共用的隐藏轴上限 */
  deltaAxisMax: number;
}

/**
 * 短线评分的三条序列（评分曲线 + 评分突变柱 + 自低点抬升）
 *
 * 口径与详情页 PriceTrend 完全一致：
 * - 突变在「图上实际显示的逐点序列」上按单日变化识别，缺失日断开比较，不会把跨多日的变化当成单日突变；
 * - 抬升 = 当日评分 - 前 N 根内的最低分，低位横盘后启动时它比单日柱更早给出方向。
 */
function buildShortScoreLines(
  klines: Stock.KLineItem[],
  shortScoreScores?: Record<string, number>
): ShortScoreLines {
  const xs = klines.map((k) => String(k?.date || ''));
  const values: (number | null)[] = klines.map((k) => {
    const key = String(k?.date || '').replace(/-/g, '').substring(0, 8);
    const v = shortScoreScores?.[key];
    return typeof v === 'number' ? Number(v.toFixed(1)) : null;
  });

  const jumps = computeScoreJumps(values, xs);
  const jumpByIdx: Record<number, ScoreJumpPoint> = {};
  jumps.forEach((j) => {
    jumpByIdx[j.index] = j;
  });

  const deltas = values.map((v, i) => {
    const prev = i > 0 ? values[i - 1] : null;
    if (typeof v !== 'number' || typeof prev !== 'number') {
      return null;
    }
    return Number((v - prev).toFixed(1));
  });

  // 逐日信号（买入 / 卖出 / 观察）：图表上给买卖点当天的柱子换色标记，与列表「信号」列同一套规则
  const signalMap = computeShortScoreSignalSeries({
    scores: shortScoreScores || {},
    params: DEFAULT_SHORT_SCORE_SIGNAL_PARAMS,
  });
  const signals: (ShortScoreSignal | null)[] = xs.map((x) => {
    const key = String(x || '').replace(/-/g, '').substring(0, 8);
    return (key && signalMap[key]) || null;
  });

  const scoreData = values.map((v, i) => {
    if (typeof v !== 'number') {
      return null;
    }
    const sig = signals[i];
    const sigKind = sig && sig.kind !== '观察' ? sig.kind : '';
    const delta = deltas[i];
    if (typeof delta !== 'number') {
      // 前一日没有评分时变化值算不出来，但当天仍可能是信号日（tooltip 照样要能显示）
      return { value: v, signalKind: sigKind, signalReason: sig?.reason || '' };
    }
    const j = jumpByIdx[i];
    return {
      value: v,
      delta,
      jumpDesc: j ? describeScoreJump(j) : '',
      signalKind: sigKind,
      signalReason: sig?.reason || '',
    };
  });

  const riseData = values.map((v, i) => {
    if (typeof v !== 'number') {
      return null;
    }
    let low: number | null = null;
    for (let k = Math.max(0, i - SHORT_SCORE_RISE_DAYS); k < i; k += 1) {
      const p = values[k];
      if (typeof p === 'number' && (low === null || p < low)) {
        low = p;
      }
    }
    if (low === null) {
      return null;
    }
    return { value: Number((v - low).toFixed(1)), low: Number(low.toFixed(1)) };
  });

  const maxAbsDelta = deltas.reduce((m: number, d) => (typeof d === 'number' ? Math.max(m, Math.abs(d)) : m), 0);
  const maxRise = riseData.reduce(
    (m: number, r: any) => (r && typeof r.value === 'number' ? Math.max(m, r.value) : m),
    0
  );
  // 最高柱/最高抬升约占技术指标区一半高度，给上方曲线留出可读空间
  const axisTop = Math.max(maxAbsDelta, maxRise);

  return {
    scoreData,
    deltas,
    jumpFlags: deltas.map((_, i) => !!jumpByIdx[i]),
    riseData,
    signals,
    deltaAxisMax: axisTop > 0 ? Number((axisTop * 1.9).toFixed(1)) : 1,
  };
}

/**
 * 技术指标 series（与详情页 PriceTrend 的指标画法保持一致）
 *
 * MACD 为柱状 + 两条线；其余指标为多条线，超买/超卖线用 markLine 标注。
 * 短线评分为「评分突变柱 + 自低点抬升 + 评分曲线」三层，口径见 buildShortScoreLines。
 */
function buildTechSeries(
  techType: TechIndicatorType,
  klines: Stock.KLineItem[],
  axisIndex: number,
  altAxisIndex = -1,
  shortScoreLines?: ShortScoreLines | null,
  shortScoreDeltaAxisIndex = -1
) {
  const colors = Utils.getVariablesColor(CONST.VARIABLES);
  const upColor = colors['--increase-color'] || UP_COLOR_FALLBACK;
  const downColor = colors['--reduce-color'] || DOWN_COLOR_FALLBACK;
  const hintColor = colors['--hint-color'] || '#999';
  const linkColor = colors['--link-color'] || '#1677ff';

  // 短线评分：分数由外部现取数算好后传进来（不走评分缓存），这里按交易日对齐成
  // 「突变柱 + 自低点抬升 + 评分曲线」三层，画法与详情页 PriceTrend 保持一致
  if (techType === TechIndicatorType.SHORT_SCORE) {
    const lines = shortScoreLines || buildShortScoreLines(klines, {});
    // 买卖点柱子至少要有这点高度，否则当日变化很小（或前一日没评分）时看不出标记
    const signalBarMinHeight = Math.max(0.5, lines.deltaAxisMax * 0.06);
    const deltaBars = lines.deltas.map((delta, i) => {
      const sigKind = lines.signals[i]?.kind;
      const sigColor = shortScoreSignalColor(sigKind);
      const isSignal = !!sigColor;
      const signalStyle = {
        color: sigColor,
        borderColor: 'rgba(255,255,255,0.9)',
        borderWidth: 1,
        opacity: 1,
      };
      if (typeof delta !== 'number') {
        // 前一日评分缺失时柱高算不出来：仍然画一根标记柱，保证买卖点不会被漏标
        return isSignal ? { value: signalBarMinHeight, itemStyle: signalStyle } : null;
      }
      if (isSignal) {
        // 买卖点当天的柱子换色标记（橙=买入、亮绿=卖出），并用描边压过普通红绿柱
        return { value: Math.max(Math.abs(delta), signalBarMinHeight), itemStyle: signalStyle };
      }
      return {
        value: Math.abs(delta),
        // 达到突变阈值的柱子加重显示，普通波动只作淡淡的背景
        itemStyle: { color: delta > 0 ? upColor : downColor, opacity: lines.jumpFlags[i] ? 0.9 : 0.28 },
      };
    });

    return [
      {
        // 柱子先入列（画在曲线下方）
        name: '评分突变',
        type: 'bar',
        stype: 'tech',
        xAxisIndex: axisIndex,
        yAxisIndex: shortScoreDeltaAxisIndex >= 0 ? shortScoreDeltaAxisIndex : axisIndex,
        barWidth: '55%',
        silent: true,
        z: 1,
        data: deltaBars,
      },
      {
        // 低位横盘后启动：柱高可能一直很小，但「自低点抬升」会持续走高
        name: '自低点抬升',
        type: 'line',
        stype: 'tech',
        xAxisIndex: axisIndex,
        yAxisIndex: shortScoreDeltaAxisIndex >= 0 ? shortScoreDeltaAxisIndex : axisIndex,
        symbol: 'none',
        z: 2,
        data: lines.riseData,
        connectNulls: false,
        lineStyle: { color: linkColor, width: 1, type: 'dashed' },
        itemStyle: { color: linkColor },
        markLine: {
          symbol: 'none',
          silent: true,
          label: { show: false },
          // minRise（20 分）是「自近 N 根低点抬升」的买入阈值，作为参考线
          data: [{ yAxis: SHORT_SCORE_RISE_THRESHOLD, lineStyle: { color: hintColor, opacity: 0.5, type: 'dotted' } }],
        },
      },
      {
        name: TechIndicatorSeriesNames[TechIndicatorType.SHORT_SCORE][0],
        type: 'line',
        stype: 'tech',
        symbol: 'none',
        xAxisIndex: axisIndex,
        yAxisIndex: axisIndex,
        z: 3,
        data: lines.scoreData,
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
function buildKlineOption({ klines, range, showVolume, techType, shortScoreScores, height, compact = false }: KlineOptionParams) {
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
  // 短线评分：曲线 + 突变柱 + 自低点抬升三条序列一次算好（突变轴上限要用）
  const shortScoreLines =
    showTech && techType === TechIndicatorType.SHORT_SCORE
      ? buildShortScoreLines(klines, shortScoreScores)
      : null;
  const dates = klines.map((k) => k.date);
  // candlestick 数据顺序：[开盘, 收盘, 最低, 最高]
  const values = klines.map((k) => [k.kp, k.sp, k.zd, k.zg]);
  const closes = klines.map((k) => k.sp);
  const vols = klines.map((k, i) => [i, k.cjl, i > 0 && k.sp < klines[i - 1].sp ? -1 : 1]);

  const chartHeight = Number(height) > 0 ? Number(height) : showTech ? 480 : 400;
  // 紧凑布局既可由列表模式强制开启，也可由较矮的图表自动开启（原先按高度判断）
  const compactLayout = compact || chartHeight < 360;
  const TOP = 6;
  const BOTTOM = compact ? 8 : 20;
  const GAP = compact ? 4 : 6;
  // 列表模式总高只有 180px：成交量 / 指标区同比压缩，避免主图被挤成一条线
  const VOL_H = compact ? 28 : compactLayout ? 40 : 54;
  const TECH_H = compact ? 48 : compactLayout ? 64 : 96;
  const priceH =
    chartHeight - TOP - BOTTOM - (showVolume ? VOL_H + GAP : 0) - (showTech ? TECH_H + GAP : 0);
  // 紧凑模式隐藏了价格轴刻度，右侧不必再留 46px 给刻度文字
  const gridWidth = { left: 6, right: compact ? 8 : 46 };

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
    axisLabel: { show: !compact && i === lastGridIndex, fontSize: 9, color: secondaryColor, hideOverlap: true },
    splitLine: { show: false },
  }));

  const yAxis: any[] = [
    {
      scale: true,
      gridIndex: 0,
      position: 'right',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: !compact, fontSize: 9, color: secondaryColor, formatter: (v: number) => Number(v).toFixed(2) },
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
      axisLabel: { show: !compact, fontSize: 9, color: secondaryColor, formatter: (v: number) => Number(v).toFixed(2) },
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
  // 短线评分的突变柱 / 抬升线挂在技术指标区的隐藏轴上：0 基线在区域底部，高度只表达幅度
  let shortScoreDeltaAxisIndex = -1;
  if (showTech && techType === TechIndicatorType.SHORT_SCORE) {
    shortScoreDeltaAxisIndex = yAxis.length;
    yAxis.push({
      scale: false,
      min: 0,
      max: shortScoreLines?.deltaAxisMax || 1,
      gridIndex: techGridIndex,
      position: 'right',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false },
    });
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
      ...buildTechSeries(
        techType as TechIndicatorType,
        klines,
        techGridIndex,
        techAltAxisIndex,
        shortScoreLines,
        shortScoreDeltaAxisIndex
      )
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
            // 短线评分：带出当日变化值（红绿柱）与突变程度（与详情页 PriceTrend 同口径）
            if (p.seriesName === '短线评分' && p.data && typeof p.data === 'object') {
              const d: any = p.data;
              const delta = typeof d.delta === 'number' ? d.delta : null;
              const cls = delta === null ? '' : delta > 0 ? 'text-up' : 'text-down';
              rows.push(
                `<span class="${cls}">短线评分 <b>${Number(d.value).toFixed(1)}</b></span>`
              );
              if (delta !== null) {
                rows.push(`<span class="${cls}">较前一日 <b>${formatScoreDelta(delta)}</b></span>`);
              }
              if (d.jumpDesc) {
                rows.push(`<span class="${cls}">突变 <b>${d.jumpDesc}</b></span>`);
              }
              if (d.signalKind) {
                const sigCls = isBuySignalKind(d.signalKind) ? 'text-up' : 'text-down';
                rows.push(`<span class="${sigCls}">信号 <b>${d.signalKind}</b></span>`);
                if (d.signalReason) {
                  rows.push(
                    `<span style="opacity:.72;font-size:11px;display:inline-block;max-width:240px;white-space:normal">${d.signalReason}</span>`
                  );
                }
              }
              return;
            }
            // 自近 N 根低点抬升：低位横盘后启动时，它比单日柱更早给出方向
            if (p.seriesName === '自低点抬升' && p.data && typeof p.data === 'object') {
              const r: any = p.data;
              const lowTxt = typeof r.low === 'number' ? `（低点 ${r.low.toFixed(1)}）` : '';
              rows.push(
                `自近${SHORT_SCORE_RISE_DAYS}根低点${lowTxt}抬升 <b>+${Number(r.value).toFixed(1)}</b>`
              );
              return;
            }
            // 突变柱只表达幅度，细节看「短线评分 / 较前一日」两行
            if (p.seriesName === '评分突变') {
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

/** C5a 特征明细（悬浮提示） */
function patternFeatureText(f: IntradayPatternFeatures) {
  return [
    `f1 均价线上方占比 ${(f.f1 * 100).toFixed(0)}%`,
    `f2 收盘位置 ${f.f2.toFixed(2)}`,
    `f3 穿越均价线 ${f.f3} 次`,
    `f4 分段斜率 ${f.f4.map((v) => v.toFixed(2)).join(' / ')}%`,
    `f5 量价比 ${f.f5.toFixed(2)}`,
    `f6 日内振幅 ${(f.f6 * 100).toFixed(2)}%`,
    `f7 最大回撤 ${(f.f7 * 100).toFixed(2)}%`,
    `f8 尾盘涨幅占比 ${(f.f8 * 100).toFixed(0)}%`,
    `f9 分时独立性 ${f.f9 == null ? '无指数分钟数据' : f.f9.toFixed(2)}`,
  ].join('\n');
}

/** C5b 特征明细（悬浮提示） */
function early30FeatureText(f: Early30Features) {
  return [
    `f1 开盘5分钟 ${(f.f1 * 100).toFixed(2)}%`,
    `f2 窗口量/昨量 ${(f.f2 * 100).toFixed(1)}%`,
    `f3 均价线上方占比 ${(f.f3 * 100).toFixed(0)}%`,
    `f4 前后半段波动率比 ${f.f4.toFixed(2)}`,
    `f5 窗口内回撤 ${(f.f5 * 100).toFixed(2)}%`,
    `f6 上影线比例 ${f.f6.toFixed(2)}`,
    `f7 分钟收益自相关 ${f.f7.toFixed(2)}`,
    `f8 分时独立性 ${f.f8 == null ? '无指数分钟数据' : f.f8.toFixed(2)}`,
  ].join('\n');
}

/**
 * 分时走势 option：价格 + 均价 + 成交量，支持「回放」（只画到第 visibleCount 根）
 *
 * 训练模式下分时是逐分钟推进的：坐标轴始终是整日长度，未推进到的时间点用 null 占位，
 * 曲线随时间一点点「长出来」；价格轴固定为整日区间（含昨收），避免回放时反复缩放。
 *
 * 参考线：昨收（虚横线）+ 昨日K线的最低价 / 开盘价，方便对照今天有没有跌破昨低、高开还是低开。
 */
function buildTrendOption({ trends, visibleCount, showVolume, zs, prevBar, height, compact = false }: TrendOptionParams) {
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

  const chartHeight = Number(height) > 0 ? Number(height) : 400;
  const TOP = 6;
  const BOTTOM = compact ? 8 : 20;
  const GAP = compact ? 4 : 6;
  const VOL_H = compact ? 28 : chartHeight < 300 ? 40 : 54;
  const priceH = chartHeight - TOP - BOTTOM - (showVolume ? VOL_H + GAP : 0);
  // 紧凑模式隐藏了时间 / 价格轴标签，把留白还给曲线
  const gridWidth = { left: 6, right: compact ? 8 : 46 };

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
    axisLabel: { show: !compact && i === lastGridIndex, fontSize: 9, color: secondaryColor, hideOverlap: true },
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
      axisLabel: { show: !compact, fontSize: 9, color: secondaryColor, formatter: (v: number) => Number(v).toFixed(2) },
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
  // 昨日K线的最低价 / 开盘价：参考线常驻，文字标签仅在非紧凑模式显示
  if (prevLow > 0) {
    markLines.push({
      name: '昨低',
      yAxis: prevLow,
      label: {
        show: !compact,
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
        show: !compact,
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
  /**
   * 列表模式要展示的已收藏股票（按收藏顺序）
   *
   * 名称由外部解析好传进来：收藏只存 6 位代码，面板内部拿不到板块列表里的名字缓存。
   */
  favoriteStocks?: Array<{ code: string; name: string }>;
}

/** 面板展示模式：单股详情 / 列表模式（同时看多只收藏股） */
type PanelMode = 'single' | 'list';

/** 模式与仓位的本地存储键（记住上次的选择） */
const PANEL_MODE_KEY = 'scoreStockPanelMode';
const PANEL_RATIO_KEY = 'scoreStockPanelPositionRatio';
/** 面板宽度 / 是否收起的本地存储键（展开位置以最后停留的位置为准） */
const PANEL_WIDTH_KEY = 'scoreStockPanelWidth';
const PANEL_COLLAPSED_KEY = 'scoreStockPanelCollapsed';
/** 收起后的窄条宽度（只剩分隔线与展开按钮） */
const PANEL_RAIL_WIDTH = 18;
/** 分隔线拖动区宽度（覆盖在分隔线上，含收起/展开按钮） */
const PANEL_HANDLE_WIDTH = 18;
/** 面板可拖到的最小宽度 */
const PANEL_MIN_WIDTH = 320;
/** 拖动到该宽度以下即视为收起（相当于把分隔线拖到最右侧） */
const PANEL_COLLAPSE_THRESHOLD = 120;
/** 左侧结果列表至少保留的宽度，面板最大宽度据此计算 */
const PANEL_MIN_LIST_WIDTH = 360;

/** 6 位代码 -> secid（与列表里的面板股票口径一致） */
const secidOfCode = (code: string) => `${String(code || '').startsWith('6') ? '1' : '0'}.${String(code || '')}`;

/** 金额展示（元 -> 带千分位） */
function formatMoney(v: number) {
  const n = Math.abs(Math.round(Number(v) || 0));
  return `¥${n.toLocaleString('zh-CN')}`;
}

/**
 * 顶部固定的「资金情况」：训练模式取共享训练账户，非训练模式按手工交易记录估算。
 *
 * 不取行情：列表模式会同时展示多只股票，再给每只持仓拉收盘价请求量太大；
 * 这里展示可用资金 / 持仓成本 / 已实现盈亏，口径与个股详情页训练工具栏一致。
 */
const PanelFundsSummary: React.FC = () => {
  const { ontrain, trainDate, trainStartDate, initialCapital, commissionRate } = useSelector(
    (state: StoreState) => state.setting.systemSetting
  );
  const { stockConfigsMapping, nowHolds } = useSelector((state: StoreState) => state.stock);

  const summary = useMemo(() => {
    if (ontrain) {
      const account = ComputeTrainAccount({
        configs: Object.values(stockConfigsMapping || {}),
        startDate: trainStartDate || '',
        currentDay: trainDate || '',
        initialCapital: Number(initialCapital) || 0,
        commissionRate,
      });
      return {
        cash: account.cash,
        cost: account.positions.reduce((s, p) => s + p.costAmount, 0),
        count: account.positions.length,
        realized: account.realized,
      };
    }
    const holds = nowHolds || [];
    const cost = holds.reduce((s, h) => s + Number(h.price) * Number(h.count), 0);
    return {
      cash: Math.max(0, (Number(initialCapital) || 100000) - cost),
      cost,
      count: holds.length,
      realized: 0,
    };
  }, [ontrain, stockConfigsMapping, trainStartDate, trainDate, initialCapital, commissionRate, nowHolds]);

  const realizedCls = summary.realized >= 0 ? 'text-up' : 'text-down';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        gap: '2px 12px',
        flex: '1 1 auto',
        minWidth: 0,
        fontSize: 12,
        color: 'var(--hint-color)',
      }}
    >
      <span style={{ fontWeight: 600, color: 'var(--main-text-color)' }}>
        {ontrain ? '训练账户' : '手工交易'}
      </span>
      <span>
        可用资金 <b style={{ color: 'var(--main-text-color)' }}>{formatMoney(summary.cash)}</b>
      </span>
      <span>
        持仓成本 <b style={{ color: 'var(--main-text-color)' }}>{formatMoney(summary.cost)}</b>
      </span>
      <span>
        持仓 <b style={{ color: 'var(--main-text-color)' }}>{summary.count}</b> 只
      </span>
      {ontrain ? (
        <span>
          已实现 <b className={realizedCls}>{`${summary.realized >= 0 ? '+' : ''}${summary.realized.toFixed(2)}`}</b>
        </span>
      ) : null}
    </div>
  );
};

export interface ScoreStockDetailProps extends ScoreStockPanelProps {
  /** 列表模式：不显示公司简介、不自己滚动，作为可滚容器里的一段 */
  layout?: 'single' | 'list';
  /** 是否展示公司简介（列表模式下省略） */
  showIntro?: boolean;
  /** 默认图表类型（列表模式默认看分时） */
  defaultChartMode?: PanelChartMode;
  /** 受控仓位（列表模式顶部统一选择） */
  ratio?: number;
  onRatioChange?: (ratio: number) => void;
  /** 单股模式下的「切换到列表模式」入口 */
  onSwitchToList?: () => void;
  /**
   * 由外层容器决定宽度（面板可拖动调整宽度 / 收起）
   *
   * 为 true 时本组件不再自带 flex 宽度与左边框，而是撑满容器，
   * 分隔线与拖动条由 `ScoreStockPanel` 统一维护。
   */
  fill?: boolean;
}

/**
 * 个股信息区域（单股详情 / 列表模式共用）
 *
 * 从上往下：名字+代码（点击打开详情）→ 公司简介 → 分时形态 → 图表（分时/日K）→ 买入卖出操作。
 * 日K线与短线评分同源（Tushare），训练模式下由取数层自动截断到训练日。
 */
const ScoreStockDetail: React.FC<ScoreStockDetailProps> = ({
  code,
  secid,
  name,
  trainDate,
  trainTime,
  onOpenStock,
  layout = 'single',
  showIntro = true,
  defaultChartMode,
  ratio,
  onRatioChange,
  onSwitchToList,
  fill = false,
}) => {
  const isList = layout === 'list';
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
  // 图表默认看日K线（分时需要时手动切换；训练模式下日K的当日那根仍按「训练时间」用分时重建）；
  // 列表模式默认看分时：多只股票对照时，分时走势比日K更直观
  const [chartMode, setChartMode] = useState<PanelChartMode>(defaultChartMode || 'kline');

  // ===== 图表控制（与详情页 PriceTrend 对齐）=====
  const [range, setRange] = useState<RangeArea>(DEFAULT_RANGE);
  // 列表模式默认不显示成交量（也不提供开关），单股模式保留原来的开关与默认值
  const [showVolume, setShowVolume] = useState(!isList);
  // 与详情页 PriceTrend 一致：技术指标默认显示 RSI
  const [techType, setTechType] = useState<number>(TechIndicatorType.RSI);

  // 公司简介：Tushare 优先，取不到时回退东财（内容更全）
  // 列表模式不展示简介，也就不取：收藏多了会白白多出一串请求
  useEffect(() => {
    if (!showIntro) {
      return () => {};
    }
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
  }, [secid, showIntro]);

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
  /** 本次评分曲线实际覆盖的交易日数（0=还在等 K 线，用于 loading 文案） */
  const [shortScoreCurveDaysUsed, setShortScoreCurveDaysUsed] = useState(0);
  /** 评分曲线覆盖天数跟随日K长度（与详情页 PriceTrend 一致，不再固定 120 个交易日） */
  const shortScoreCurveDays = useMemo(() => Math.max(20, klines.length), [klines.length]);
  useEffect(() => {
    if (techType !== TechIndicatorType.SHORT_SCORE) {
      return () => {};
    }
    let canceled = false;
    setShortScoreScores({});
    // 日K还没到就先不算：否则会先用默认窗口跑一遍，界面上看起来仍是固定天数
    if (!klines.length) {
      setShortScoreCurveDaysUsed(0);
      setShortScoreCurveLoading(true);
      return () => {
        canceled = true;
      };
    }
    setShortScoreCurveDaysUsed(shortScoreCurveDays);
    setShortScoreCurveLoading(true);
    computeShortTermScoreCurve({ code, name, limit: shortScoreCurveDays })
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
  }, [techType, code, name, shortScoreCurveDays, klines.length]);

  // 默认看日K线：只在「进入/退出训练」时回到默认图表，训练日推进不打断用户当前选择
  const wasTrainingRef = useRef(inTraining);
  useEffect(() => {
    if (wasTrainingRef.current !== inTraining) {
      wasTrainingRef.current = inTraining;
      setChartMode(defaultChartMode || 'kline');
    }
  }, [inTraining, defaultChartMode]);

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

  /** 列表模式信息行的现价 / 涨跌幅：与交易区、分时图同一份价格口径 */
  const listQuote = useMemo(() => {
    const price = Number(trendPrice) || 0;
    const chg = price > 0 && trendZs > 0 ? (price / trendZs) * 100 - 100 : null;
    return {
      price: price > 0 ? price.toFixed(2) : '--',
      chg: chg == null ? '--' : `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`,
      color:
        chg == null
          ? 'var(--secondary-text-color)'
          : chg >= 0
            ? 'var(--increase-color)'
            : 'var(--reduce-color)',
    };
  }, [trendPrice, trendZs]);

  /**
   * 日K的「当日那根」始终由分时重建，让日K图随行情更新
   *
   * - 训练模式：训练日的官方日K是收盘口径（对盘中时点属于未来数据），用「已推进到」的
   *   分时合成一根截至当前时刻的K线；还没开盘（无分时）时当日K直接不显示。
   * - 实时模式：数据源的当日日K是静态快照，盘中往往根本没有当日柱，且 klines 只在挂载时
   *   取一次；这里用最新分时合成/替换当日柱，分时每 60 秒刷新，日K的当日柱就跟着更新。
   *
   * 开盘价优先取当日日K的 kp（09:25 集合竞价已定，不属于未来数据）：分时首根是 09:30 的成交价，
   * 秒板/跳空时会明显偏离真实开盘价（曾出现 34.61 vs 真实开盘 33.96 的偏差）。
   */
  const displayKlines = useMemo(() => {
    if (!trends.length || (inTraining && !trainTime)) {
      return klines;
    }
    const day = inTraining
      ? String(trainDate || '').substring(0, 10)
      : trendDayKey.length === 8
        ? `${trendDayKey.substring(0, 4)}-${trendDayKey.substring(4, 6)}-${trendDayKey.substring(6, 8)}`
        : dayjs().format('YYYY-MM-DD');
    if (!inTraining) {
      // 非交易日 / 盘前：实时分时接口给的仍是上一交易日数据，拿「今天」当日期会凭空多一根K
      const now = dayjs();
      if (now.day() === 0 || now.day() === 6 || now.hour() * 60 + now.minute() < 9 * 60 + 20) {
        return klines;
      }
    }
    const key = dateKey(day);
    const base = klines.filter((k) => dateKey(k?.date) !== key);
    const dayBar = klines.find((k) => dateKey(k?.date) === key);
    const src = inTraining ? visibleTrends : trends;
    if (!src.length) {
      // 训练模式未开盘：隐藏当日K；实时模式暂无分时：保留数据源原样
      return inTraining ? base : klines;
    }
    const bar = BuildDailyKFromTrends({
      secid,
      trends: src,
      date: day,
      prevClose: trendZs,
      openPrice: Number(dayBar?.kp) || 0,
    });
    return bar ? [...base, bar] : inTraining ? base : klines;
  }, [inTraining, trainTime, trainDate, trendDayKey, trends, visibleTrends, klines, trendZs, secid]);

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

  /** C5a/C5b 的输入分时：训练回放取「已走到」的分时，实时取全部分时 */
  const patternTrends = inTraining ? visibleTrends : trends;
  /** 昨日全天成交量（手，C5b 的 f2 分母） */
  const prevDayVol = Number(prevDayBar?.cjl) || 0;

  /**
   * C5a 分时形态：随分时推进动态计算
   *
   * 盘中就用「截至当前时刻」的分时判形态，每来一根新分时重算一次；
   * 没走完当天时结果标为盘中临时结论（收盘后可能变化）。
   */
  const c5a = useMemo(
    () => ComputeIntradayPattern({ trends: patternTrends, prevClose: trendZs }),
    [patternTrends, trendZs]
  );

  /** C5b 开盘预测（窗口随分时推进动态变长：5 分钟起，30 分钟封顶） */
  const c5b = useMemo(
    () => ComputeEarly30Prediction({ trends: patternTrends, prevDayVol }),
    [patternTrends, prevDayVol]
  );

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
    // 列表模式压缩图表高度：一屏能同时看到多只股票的分时走势
    const trendHeight = isList ? LIST_TREND_HEIGHT : 400;
    const klineHeight = isList ? LIST_KLINE_HEIGHT : techType === TECH_NONE ? 400 : 480;
    if (chartMode === 'trend') {
      return trends.length
        ? buildTrendOption({ trends, visibleCount, showVolume, zs: trendZs, prevBar: prevDayBar, height: trendHeight, compact: isList })
        : { option: null, chartHeight: trendHeight };
    }
    return displayKlines.length
      ? buildKlineOption({
          klines: displayKlines,
          range,
          showVolume,
          techType,
          shortScoreScores,
          height: klineHeight,
          compact: isList,
        })
      : { option: null, chartHeight: klineHeight };
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
    isList,
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
      style={
        fill
          ? {
              // 由外层容器决定宽度（可拖动 / 可收起）：撑满容器，自己负责纵向滚动
              flex: '1 1 auto',
              minWidth: 0,
              height: '100%',
              overflowY: 'auto',
              boxSizing: 'border-box',
              padding: isList ? '8px 12px 14px' : '4px 12px 12px',
            }
          : isList
            ? {
                // 列表模式：本身是一段内容，滚动交给外层容器（顶部头部用 sticky 固定）
                flex: '0 0 auto',
                minWidth: 0,
                boxSizing: 'border-box',
                padding: '8px 12px 14px',
                borderBottom: '1px dashed var(--border-color)',
              }
            : {
                // 与左侧结果列表平分宽度
                flex: '1 1 50%',
                minWidth: 0,
                height: '100%',
                overflowY: 'auto',
                boxSizing: 'border-box',
                padding: '4px 12px 12px',
                borderLeft: '1px solid var(--border-color)',
              }
      }
    >
      {/* 列表模式：名字+代码、分时/日K切换、买入按钮挤在同一行；单股模式保持原布局 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: isList ? 6 : 8,
          lineHeight: isList ? 1.8 : 2,
          minWidth: 0,
          flexWrap: isList ? 'nowrap' : undefined,
          overflow: isList ? 'hidden' : undefined,
          // 给右上角绝对定位的「仓位 + 单股」浮层留出空位，滚动时也不会压住内容
          paddingRight: isList ? 150 : undefined,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: isList ? 6 : 8,
            minWidth: 0,
            flex: isList ? '0 1 auto' : '0 0 auto',
            overflow: isList ? 'hidden' : undefined,
            cursor: 'pointer',
          }}
          title="点击打开股票详情"
          onClick={() => onOpenStock(secid, name)}
        >
          <span
            style={{
              fontSize: isList ? 13 : 16,
              fontWeight: 'bold',
              color: '#1890ff',
              whiteSpace: 'nowrap',
              overflow: isList ? 'hidden' : undefined,
              textOverflow: isList ? 'ellipsis' : undefined,
            }}
          >
            {name || code}
          </span>
          <span style={{ fontSize: isList ? 11 : 12, color: 'var(--secondary-text-color)', flexShrink: 0 }}>{code}</span>
        </div>
        {isList ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: 4,
              flex: '0 0 auto',
              whiteSpace: 'nowrap',
              color: listQuote.color,
            }}
            title="当前价与涨跌幅（与分时图、买入价格同一口径）"
          >
            <b style={{ fontSize: 12 }}>{listQuote.price}</b>
            <span style={{ fontSize: 11 }}>{listQuote.chg}</span>
          </span>
        ) : null}
        {isList ? (
          <>
            <Radio.Group
              size="small"
              value={chartMode}
              onChange={(e) => setChartMode(e.target.value as PanelChartMode)}
            >
              <Radio.Button value="trend">分时</Radio.Button>
              <Radio.Button value="kline">日K</Radio.Button>
            </Radio.Group>
            <ScoreStockTrade
              secid={secid}
              code={code}
              name={name}
              klines={klines}
              currentPrice={trendPrice}
              intradayReady={!trendLoading}
              ratio={ratio}
              onRatioChange={onRatioChange}
              compact
              inline
            />
          </>
        ) : null}
        {!isList && onSwitchToList ? (
          <Tooltip title="列表模式：同时查看多只已收藏股票的分时走势">
            <Button
              size="small"
              type="text"
              icon={<UnorderedListOutlined />}
              style={{ marginLeft: 'auto' }}
              onClick={onSwitchToList}
            >
              列表模式
            </Button>
          </Tooltip>
        ) : null}
      </div>

      {showIntro ? (
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
      ) : null}

      {/* C5a 全天分时形态 + C5b 开盘 30 分钟预测：单股详情展示，列表模式为紧凑省略 */}
      {!isList && (
      <div
        style={{
          marginTop: 12,
          border: '1px solid var(--border-color)',
          borderRadius: 4,
          padding: '4px 6px',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 6,
          fontSize: 11,
        }}
      >
        <span style={{ fontWeight: 600 }}>分时形态</span>
        {c5a ? (
          <Tooltip
            title={
              <div style={{ fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-line' }}>
                {`${patternFeatureText(c5a.features)}\n判据：${c5a.reason}\n${
                  c5a.complete
                    ? '口径：全天分时（收盘）'
                    : `口径：盘中临时（已走 ${visibleCount}/${trendTotal} 分钟，收盘后可能变化）`
                }`}
              </div>
            }
          >
            <Tag
              style={{ marginInlineEnd: 0, cursor: 'help' }}
              color={c5a.pattern === '无明显形态' ? undefined : c5a.confidence >= 0.7 ? 'success' : 'processing'}
            >
              {c5a.pattern} {(c5a.confidence * 100).toFixed(0)}%
              {c5a.complete ? '' : ' · 盘中'}
            </Tag>
          </Tooltip>
        ) : (
          <span style={{ color: 'var(--hint-color)' }}>
            {!patternTrends.length
              ? '暂无分时数据'
              : patternTrends.length < 30
              ? `分时不足 30 分钟（${patternTrends.length} 分钟）`
              : '缺少昨收，无法判定形态'}
          </span>
        )}
        <span style={{ fontWeight: 600, marginLeft: 8 }}>开盘预测</span>
        {!c5b ? (
          <span style={{ color: 'var(--hint-color)' }}>暂无分时数据</span>
        ) : !c5b.ready ? (
          <span style={{ color: 'var(--hint-color)' }}>开盘满 5 分钟才出结果</span>
        ) : (
          <Tooltip
            title={
              <div style={{ fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-line' }}>
                {`${early30FeatureText(c5b.features)}\n量能签名 ${Early30VolSignatureNames[c5b.volSignature]}\n评估窗口 ${
                  c5b.windowMinutes
                } 分钟（随分时动态变长，30 分钟封顶）\n窗口涨幅 ${(c5b.ret30 * 100).toFixed(
                  2
                )}%\n最小规则版 ${c5b.ruleHit ? '命中（早盘强势）' : '未命中'}`}
              </div>
            }
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'help' }}>
              <span style={{ color: 'var(--hint-color)' }}>前{c5b.windowMinutes}′</span>
              <Tag style={{ marginInlineEnd: 0 }} color={c5b.probs.T1 >= 0.5 ? 'success' : undefined}>
                T1 {(c5b.probs.T1 * 100).toFixed(0)}%
              </Tag>
              <Tag style={{ marginInlineEnd: 0 }} color={c5b.probs.T2 >= 0.5 ? 'warning' : undefined}>
                T2 {(c5b.probs.T2 * 100).toFixed(0)}%
              </Tag>
              <Tag style={{ marginInlineEnd: 0 }} color={c5b.probs.T3 >= 0.5 ? 'processing' : undefined}>
                T3 {(c5b.probs.T3 * 100).toFixed(0)}%
              </Tag>
              <span style={{ color: 'var(--secondary-text-color)' }}>
                量能 {Early30VolSignatureNames[c5b.volSignature]}
              </span>
              {c5b.ruleHit ? (
                <Tag style={{ marginInlineEnd: 0 }} color="success">
                  早盘强势
                </Tag>
              ) : null}
            </span>
          </Tooltip>
        )}
        <span style={{ marginLeft: 'auto', color: 'var(--hint-color)' }}>C5a 随分时动态 · C5b 每分钟更新</span>
      </div>
      )}

      <div style={{ marginTop: isList ? 4 : 12 }}>
        {/* 图表工具栏：列表模式的分时/日K切换已移到上方信息行，这里只保留必要控件 */}
        <div
          style={{
            // 列表模式的分时图已无工具栏控件（切换在信息行、成交量开关不显示），不再留空行
            display: isList && chartMode === 'trend' ? 'none' : 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 6,
            marginBottom: isList ? 2 : 4,
          }}
        >
          {/* 列表模式的切换已在上方信息行，这里不再重复 */}
          {!isList ? (
            <Radio.Group
              size="small"
              value={chartMode}
              onChange={(e) => setChartMode(e.target.value as PanelChartMode)}
            >
              <Radio.Button value="trend">分时</Radio.Button>
              <Radio.Button value="kline">日K线</Radio.Button>
            </Radio.Group>
          ) : null}
          {chartMode === 'kline' ? (
            <>
              {!isList ? (
                <span style={{ fontSize: 12, fontWeight: 600 }}>
                  日K线{displayKlines.length ? `（${displayKlines.length}个交易日）` : ''}
                </span>
              ) : null}
              <Select size="small" style={{ width: 100 }} value={techType} onChange={(v) => setTechType(Number(v))}>
                <Select.Option value={TECH_NONE}>无指标</Select.Option>
                {DefaultTechIndicatorTypes.map((v) => (
                  <Select.Option value={v} key={`tit_${v}`}>
                    {(TechIndicatorNames as Record<number, string>)[v]}
                  </Select.Option>
                ))}
              </Select>
              {!isList && techType === TechIndicatorType.SHORT_SCORE && !shortScoreCurveLoading ? (
                <span
                  style={{ fontSize: 11, color: 'var(--secondary-text-color)' }}
                  title={`柱高=评分单日变化幅度：红柱=跳升、绿柱=跳降；变化 ≥${SCORE_JUMP_CONFIG.minDelta} 分的柱子加重显示（突变），其余为淡色日常波动。橙柱=抬升观察、粉柱=跳升买入、亮绿柱=卖出（与列表「信号」列同一套规则，悬停曲线上可看判定依据）。蓝色虚线=自近${SHORT_SCORE_RISE_DAYS}根低点的累计抬升（买入阈值 ${SHORT_SCORE_RISE_THRESHOLD} 分；单日跳升 ≥20 分也算启动）`}
                >
                  红绿柱=评分突变（红升绿降，≥{SCORE_JUMP_CONFIG.minDelta}分加重）
                  <span style={{ marginLeft: 4 }}>
                    <span style={{ color: SHORT_SCORE_RISE_BUY_MARK_COLOR, fontWeight: 600 }}>橙柱=抬升观察</span>
                    {'、'}
                    <span style={{ color: SHORT_SCORE_JUMP_BUY_MARK_COLOR, fontWeight: 600 }}>粉柱=跳升买入</span>
                    {'、'}
                    <span style={{ color: SHORT_SCORE_SELL_MARK_COLOR, fontWeight: 600 }}>亮绿柱=卖出</span>
                  </span>
                  <span style={{ marginLeft: 4 }}>蓝虚线=自近{SHORT_SCORE_RISE_DAYS}根低点抬升</span>
                </span>
              ) : null}
              {!isList ? (
                <Tooltip title="成交量">
                  <Switch size="small" checked={showVolume} onChange={setShowVolume} />
                </Tooltip>
              ) : null}
              {!isList ? (
                <>
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
              ) : null}
            </>
          ) : (
            <>
              {!isList ? (
                <Tooltip title="成交量">
                  <Switch size="small" checked={showVolume} onChange={setShowVolume} />
                </Tooltip>
              ) : null}
              {!isList ? (
                <span style={{ fontSize: 12, color: 'var(--secondary-text-color)' }}>{trendStatus}</span>
              ) : null}
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
                <Spin size="small" /> 短线评分计算中（
                {shortScoreCurveDaysUsed > 0 ? `最近 ${shortScoreCurveDaysUsed} 个交易日` : '等待 K 线加载'}
                ）...
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

      {/* 买入卖出区域：列表模式的买入按钮已合并到上方信息行，单股模式保留完整下单区 */}
      {!isList ? (
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
            ratio={ratio}
            onRatioChange={onRatioChange}
          />
        </div>
      ) : null}
    </aside>
  );
};

/**
 * 评分结果列表右侧面板
 *
 * 两种模式互相切换：
 * - 单股详情：原来的一只股票完整信息（简介 / 图表 / 买卖）；
 * - 列表模式：顶部固定（sticky）资金情况 + 仓位选择 + 切换按钮，下方按收藏顺序
 *   依次展示每只收藏股的分时形态 → 图表 → 买入卖出操作。
 *
 * 模式与仓位选择存在本地，重启后保持上次的选择。
 */
const ScoreStockPanel: React.FC<ScoreStockPanelProps> = ({
  code,
  secid,
  name,
  trainDate,
  trainTime,
  onOpenStock,
  favoriteStocks,
}) => {
  const [mode, setMode] = useState<PanelMode>(() =>
    Utils.GetStorage<string>(PANEL_MODE_KEY, 'single') === 'list' ? 'list' : 'single'
  );
  const [ratio, setRatio] = useState<number>(() => {
    const saved = Number(Utils.GetStorage(PANEL_RATIO_KEY, POSITION_RATIOS[0].value));
    return POSITION_RATIOS.some((r) => r.value === saved) ? saved : POSITION_RATIOS[0].value;
  });

  const switchMode = useCallback((next: PanelMode) => {
    setMode(next);
    Utils.SetStorage(PANEL_MODE_KEY, next);
  }, []);

  const changeRatio = useCallback((v: number) => {
    setRatio(v);
    Utils.SetStorage(PANEL_RATIO_KEY, v);
  }, []);

  // ===== 可拖动 / 可收起：宽度与收起状态 =====
  const rootRef = useRef<HTMLDivElement>(null);
  /** 展开宽度（null = 默认与左侧列表平分） */
  const [width, setWidth] = useState<number | null>(() => {
    const saved = Number(Utils.GetStorage(PANEL_WIDTH_KEY, 0));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  });
  const [collapsed, setCollapsed] = useState<boolean>(
    () => Utils.GetStorage<boolean>(PANEL_COLLAPSED_KEY, false) === true
  );
  /** 最近一次拖动到的展开宽度（收起时保留它，展开就回到这个位置） */
  const lastWidthRef = useRef<number | null>(width);
  /** 本次按下是否发生了拖动：拖动后松开产生的 click 不再当成「切换收起」 */
  const dragMovedRef = useRef(false);
  /** 拖动中挂载的全局监听清理函数（组件卸载时兜底） */
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    []
  );

  const applyCollapsed = useCallback((next: boolean) => {
    setCollapsed(next);
    Utils.SetStorage(PANEL_COLLAPSED_KEY, next);
  }, []);

  /** 面板最大宽度：给左侧结果列表留出可读空间（容器还没布局时返回 0，避免误夹紧） */
  const maxPanelWidth = useCallback(() => {
    const parent = rootRef.current?.parentElement;
    const total = parent ? parent.getBoundingClientRect().width : 0;
    if (!total) {
      return 0;
    }
    return Math.max(PANEL_MIN_WIDTH, total - PANEL_MIN_LIST_WIDTH);
  }, []);

  // 记住的宽度超过当前可用空间时（窗口变小 / 换屏幕）拉回来，避免把左侧列表挤没
  useEffect(() => {
    if (width == null) {
      return;
    }
    const max = maxPanelWidth();
    if (max > 0 && width > max) {
      setWidth(max);
    }
  }, [width, maxPanelWidth]);

  useEffect(() => {
    const onResize = () => {
      const max = maxPanelWidth();
      if (!max) {
        return;
      }
      setWidth((w) => (w == null ? w : Math.min(Math.max(w, PANEL_MIN_WIDTH), max)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [maxPanelWidth]);

  /**
   * 拖动分隔线调整宽度
   *
   * 向左拖变宽、向右拖变窄；宽度小于阈值（相当于拖到最右侧）直接收起。
   * 收起后仍可继续向左拖，一离开阈值就重新展开。
   */
  const startResize = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) {
        return;
      }
      // 阻止拖拽时选中文字；按钮自己的 click 仍会正常触发
      e.preventDefault();
      dragMovedRef.current = false;
      const startX = e.clientX;
      const startWidth = collapsed ? PANEL_RAIL_WIDTH : rootRef.current?.getBoundingClientRect().width || 0;
      /** 拖动前的展开宽度：拖到最右侧收起时，展开仍回到这个位置 */
      const preDragWidth = collapsed ? 0 : Math.round(startWidth);
      const maxW = maxPanelWidth() || Math.max(PANEL_MIN_WIDTH, window.innerWidth - PANEL_MIN_LIST_WIDTH);
      let isCollapsedNow = collapsed;
      const prevUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        const dx = startX - ev.clientX;
        if (Math.abs(dx) > 2) {
          dragMovedRef.current = true;
        }
        const next = startWidth + dx;
        if (next < PANEL_COLLAPSE_THRESHOLD) {
          // 拖到最右侧：收起（不动 lastWidthRef，展开时回到最后停留的位置）
          if (!isCollapsedNow) {
            isCollapsedNow = true;
            applyCollapsed(true);
          }
          return;
        }
        const clamped = Math.min(Math.max(next, PANEL_MIN_WIDTH), maxW);
        lastWidthRef.current = clamped;
        if (isCollapsedNow) {
          isCollapsedNow = false;
          applyCollapsed(false);
        }
        setWidth(clamped);
      };

      const cleanup = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = prevUserSelect;
        dragCleanupRef.current = null;
      };

      const onUp = () => {
        cleanup();
        // 记住最后停留的位置：下次展开就是这里（纯点击不落盘）。
        // 若这次拖动最终停在收起状态，则保留拖动前的展开宽度（拖动过程里的最小值不算「停留」）。
        if (dragMovedRef.current) {
          const restore = (isCollapsedNow ? preDragWidth : lastWidthRef.current) || 0;
          if (restore > 0) {
            lastWidthRef.current = restore;
            Utils.SetStorage(PANEL_WIDTH_KEY, restore);
          }
        }
        // click 事件在本轮事件循环里紧跟着触发，用定时器复位让这次的 click 被忽略
        window.setTimeout(() => {
          dragMovedRef.current = false;
        }, 0);
      };

      dragCleanupRef.current = cleanup;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [collapsed, maxPanelWidth, applyCollapsed]
  );

  /** 分隔线中间的收起 / 展开按钮 */
  const handleToggleClick = useCallback(() => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    applyCollapsed(!collapsed);
  }, [collapsed, applyCollapsed]);

  /** 收藏列表：按 6 位代码去重（名称由外部解析） */
  const favorites = useMemo(() => {
    const seen = new Set<string>();
    return (favoriteStocks || [])
      .map((s) => ({ code: String(s?.code || '').trim(), name: String(s?.name || '') }))
      .filter((s) => {
        if (!s.code || seen.has(s.code)) {
          return false;
        }
        seen.add(s.code);
        return true;
      });
  }, [favoriteStocks]);

  // 收起时不构建内容：列表模式有很多图表，没必要在看不见时还挂在那里
  const panelContent = collapsed ? null : mode === 'single' ? (
      <ScoreStockDetail
        code={code}
        secid={secid}
        name={name}
        trainDate={trainDate}
        trainTime={trainTime}
        onOpenStock={onOpenStock}
        layout="single"
        showIntro
        fill
        ratio={ratio}
        onRatioChange={changeRatio}
        onSwitchToList={() => switchMode('list')}
      />
    ) : (
      <aside
        style={{
          // 外层容器决定宽度（可拖动 / 可收起），这里只负责内容与纵向滚动
          flex: '1 1 auto',
          minWidth: 0,
          height: '100%',
          overflowY: 'auto',
          boxSizing: 'border-box',
          padding: '0 12px 12px',
        }}
      >
      {favorites.length ? (
        favorites.map((s) => (
          <ScoreStockDetail
            key={s.code}
            code={s.code}
            secid={secidOfCode(s.code)}
            name={s.name || s.code}
            trainDate={trainDate}
            trainTime={trainTime}
            onOpenStock={onOpenStock}
            layout="list"
            showIntro={false}
            defaultChartMode="trend"
            ratio={ratio}
            onRatioChange={changeRatio}
          />
        ))
      ) : (
        <div style={{ fontSize: 12, color: 'var(--hint-color)', padding: '12px 0' }}>
          暂无收藏股票：在列表里点击星标收藏后，这里会按顺序显示它们的分时走势与买卖操作。
        </div>
      )}
      </aside>
    );

  return (
    <div
      ref={rootRef}
      style={{
        position: 'relative',
        display: 'flex',
        height: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        borderLeft: '1px solid var(--border-color)',
        // 收起 = 只剩最右侧一条窄边；展开 = 用户最后拖动的位置（没拖过则与列表平分）
        flex: collapsed
          ? `0 0 ${PANEL_RAIL_WIDTH}px`
          : width != null
            ? `0 0 ${width}px`
            : '1 1 50%',
      }}
    >
      {/* 中间分隔线：竖直拖动调整宽度；中间的按钮负责收起 / 展开 */}
      <div
        onMouseDown={startResize}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: PANEL_HANDLE_WIDTH,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: collapsed ? 'pointer' : 'col-resize',
        }}
        title={collapsed ? '点击展开面板，或按住向左拖动展开' : '拖动调整面板宽度；拖到最右侧即收起'}
      >
        <div
          onClick={handleToggleClick}
          title={collapsed ? '展开面板' : '收起面板'}
          style={{
            width: 16,
            height: 46,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--inner-color)',
            border: '1px solid var(--border-color)',
            borderRadius: 4,
            cursor: 'pointer',
            color: 'var(--secondary-text-color)',
            fontSize: 10,
            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.18)',
            userSelect: 'none',
          }}
        >
          {collapsed ? <LeftOutlined /> : <RightOutlined />}
        </div>
      </div>

      {/* 列表模式头部：只保留仓位选择与模式切换，绝对定位在右上角，不占用内容高度 */}
      {!collapsed && mode === 'list' ? (
        <div
          style={{
            position: 'absolute',
            top: 4,
            right: 8,
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 4px',
            borderRadius: 4,
            background: 'var(--background-color)',
            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.12)',
          }}
        >
          <Tooltip
            title={`买入仓位：对所有收藏股票的买入区生效；本模式已收藏 ${favorites.length} 只，训练与非训练模式互不串台`}
          >
            <Select size="small" style={{ width: 76 }} value={ratio} onChange={(v) => changeRatio(Number(v))}>
              {POSITION_RATIOS.map((r) => (
                <Select.Option key={r.value} value={r.value}>
                  {r.label}
                </Select.Option>
              ))}
            </Select>
          </Tooltip>
          <Button size="small" onClick={() => switchMode('single')} title="切回单股详情">
            单股
          </Button>
        </div>
      ) : null}

      <div
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          height: '100%',
          display: 'flex',
          // 给分隔线/按钮留出位置，内容不会被它压住
          paddingLeft: PANEL_HANDLE_WIDTH,
          boxSizing: 'border-box',
        }}
      >
        {panelContent}
      </div>
    </div>
  );
};

export default ScoreStockPanel;
