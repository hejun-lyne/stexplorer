import React, { useCallback, useRef, useState, useEffect, useLayoutEffect, useMemo } from 'react';
import dayjs from 'dayjs';
import { StoreState } from '@/reducers/types';
import { useInterval, useRequest, useSize, useThrottleFn } from 'ahooks';
import ChartCard from '@/components/Card/ChartCard';
import {
  ChanType,
  DefaultKTypes,
  DefaultMATypes,
  DefaultTechIndicatorTypes,
  FundApiType,
  KLineType,
  KlineTypeNames,
  KStateStrings,
  MAPeriodType,
  MAPeriodTypeNames,
  MAType,
  PeriodMarkTypeNames,
  SingleKLineShapeNames,
  StockMarketType,
  StrategyType,
  StrategyTypeNames,
  TechIndicatorNames,
  TechIndicatorSeriesNames,
  TechIndicatorType,
} from '@/utils/enums';
import { useRenderEcharts, useResizeEchart, useUSWorkDayTimeToDo, useWorkDayTimeToDo } from '@/utils/hooks';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
import * as Helpers from '@/helpers';
import * as Services from '@/services';
import * as Tech from '@/helpers/tech';
import { computeShortTermScoreCurve, SHORT_SCORE_CURVE_MAX_DAYS } from '@/helpers/shortTermScoreList';
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
import { useHomeContext } from '@/components/FullHome';
import styles from './index.scss';
import { Tag, Switch, Input, Select, Slider, Form } from 'antd';
import { batch, useDispatch, useSelector } from 'react-redux';
import { GetKlinesAndFlows } from '@/helpers/stock';
import { getPreloadedDailyKline } from '@/helpers/klinePreload';
import * as TrainFilter from '@/utils/trainFilter';
import { Stock } from '@/types/stock';
import { Button } from 'antd';
const { makeWorkerExec } = window.contextModules.electron;

/**
 * 短线评分「自低点抬升」叠加线回看多少根
 *
 * 与买入规则里的「低位抬升」同口径：抬升幅度 = 当日评分 - 前 N 根内的最低分。
 * 日K时 N 就是 N 个交易日；周/月K 时是 N 根（即 N 周 / N 月）。
 * 默认 10 根，与信号规则 DEFAULT_SHORT_SCORE_BACKTEST.riseRefDays 一致。
 */
const SHORT_SCORE_RISE_DAYS = 10;
/** 「自低点抬升」买入阈值（与信号规则 minRise 一致）；单日跳升另有 20 分阈值 */
const SHORT_SCORE_RISE_THRESHOLD = 20;
import {
  DoubleLeftOutlined,
  DoubleRightOutlined,
  HeartFilled,
  HeartOutlined,
  LeftOutlined,
  PlusOutlined,
  RightOutlined,
  VerticalLeftOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  DownloadOutlined,
} from '@ant-design/icons';

export interface PriceTrendProps {
  active: boolean;
  secid: string;
  zs: number;
  useSina?: boolean;
  trainMode?: boolean;
  /** 忽略训练：当前标的不受训练模式影响，展示与更新走真实最新数据 */
  ignoreTrain?: boolean;
  activePeriod?: Stock.PeriodMarkItem;
  toDate?: string;
  onTimelineDate?: string;
  firstQSAppear?: string;
  backtestDate?: string;
  updateKLineData?: (ks: Stock.KLineItem[]) => void;
  updateTrendData?: (trends: Stock.TrendItem[]) => void;
  updateKType?: (ktype: KLineType) => void;
  updateMType?: (mtype: MAPeriodType) => void;
  outRange?: { start: number; end: number };
  onRangeUpdated?: (r: { start: number; end: number }) => void;
  onSelectedAreaUpdated?: (area: { start: string; end: string }) => void;
  addStock?: () => void;
  removeStock?: () => void;
}

const maColors = ['#00b4d8', '#06d6a0', '#e76f51', '#b5179e'];
const hintColor = '#E2C08C';
function getGridOption(showTech = true, showChouma = false) {
  const width = showChouma ? '76%' : '93%';
  const grids = [
    // 价格
    {
      top: '2%',
      left: '2%',
      width,
      height: showTech ? '50%' : '74%',
    },
    // 成交量
    {
      top: showTech ? '58%' : '82%',
      left: '2%',
      width,
      height: '13%',
    },
    // MACD
    {
      top: '72%',
      left: '2%',
      width,
      height: showTech ? '24%' : '0%',
    },
    // KDJ / RSI
    // {
    //   top: '84%',
    //   left: '2%',
    //   width,
    //   height: '12%',
    // },
  ] as any[];
  if (showChouma) {
    grids.push({
      top: '2%',
      left: '83%',
      width: '18%',
      height: '55%',
      next: '65%',
    });
  }
  return grids;
}
function getVisualMap(volIndex = 1) {
  const maps = [];
  // 成交量
  const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
  maps.push({
    show: false,
    seriesIndex: volIndex,
    dimension: 2,
    pieces: [
      {
        value: -1,
        color: variableColors['--reduce-color'],
      },
      {
        value: 1,
        color: variableColors['--increase-color'],
      },
      {
        value: 2,
        color: 'gray',
      },
    ],
  });
  return maps;
}
function getAxisPointer() {
  return {
    link: [
      {
        xAxisIndex: [0, 1, 2, 3],
      },
    ],
  };
}
/**
 * @param data 类目数据
 * @param showChouma 是否显示筹码轴
 * @param bandGap K线图设为 true：类目轴按「带宽」布局，首尾 K 线各内缩半个槽位，
 *                避免最后一根 K 线的影线压在右侧 y 轴上（分时图保持 false，折线要贴边）
 */
function getxAxis(data: string[], showChouma = false, bandGap = false) {
  const axises = [
    // 价格时间轴
    {
      type: 'category',
      scale: true,
      boundaryGap: bandGap,
      splitLine: {
        show: false,
      },
      splitNumber: 20,
      axisPointer: {
        z: 100,
      },
      axisLabel: {
        fontSize: 10,
      },
      gridIndex: 0,
      data,
    },
    // 成交量
    {
      type: 'category',
      scale: true,
      boundaryGap: bandGap,
      axisLine: {
        onZero: false,
        show: false,
      },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      gridIndex: 1,
      splitNumber: 20,
      data,
    },
    // macd
    {
      type: 'category',
      scale: true,
      boundaryGap: bandGap,
      axisLine: {
        onZero: false,
        show: false,
      },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      gridIndex: 2,
      splitNumber: 20,
      data,
    },
    // kdj
    // {
    //   type: 'category',
    //   scale: true,
    //   boundaryGap: false,
    //   axisLine: {
    //     onZero: false,
    //     show: false,
    //   },
    //   axisTick: { show: false },
    //   splitLine: { show: false },
    //   axisLabel: { show: false },
    //   gridIndex: 3,
    //   splitNumber: 20,
    //   data,
    // },
  ] as any[];

  if (showChouma) {
    // 筹码
    axises.push({
      type: 'value',
      boundaryGap: false,
      gridIndex: 4,
      scale: true,
      splitLine: {
        show: false,
      },
      axisLine: {
        show: true,
      },
      axisLabel: {
        show: false,
      },
      min: 0,
      max: 3,
    });
  }
  return axises;
}
function getyAxis(darkMode: boolean, steps = [] as any[], showChouma = false) {
  const axises = [
    // 价格
    {
      // type: 'value',
      axisLabel: {
        show: true,
        formatter: (value: string) => String(Number(value).toFixed(2)),
        fontSize: 10,
      },
      axisLine: {
        show: true,
      },
      splitLine: {
        show: false,
        lineStyle: {
          color: darkMode ? 'rgba(255,255,255, 0.15)' : 'rgba(0, 0, 0, 0.15)',
          type: 'dashed',
        },
      },
      scale: true,
      position: 'right',
      gridIndex: 0,
    },
    // 成交量
    {
      type: 'value',
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      scale: true,
      gridIndex: 1,
    },
    // tech left
    {
      type: 'value',
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      scale: true,
      gridIndex: 2,
    },
    
    {
      // type: 'value',
      axisLabel: {
        show: true,
        formatter: (value: string) => String(Number(value).toFixed(2)),
        fontSize: 10,
      },
      axisLine: {
        show: true,
      },
      splitLine: {
        show: false,
        lineStyle: {
          color: darkMode ? 'rgba(255,255,255, 0.15)' : 'rgba(0, 0, 0, 0.15)',
          type: 'dashed',
        },
      },
      scale: true,
      position: 'left',
      gridIndex: 0,
    },
    // tech right
    {
      type: 'value',
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      scale: true,
      position: 'right',
      gridIndex: 2,
    },
  ] as any[];
  if (showChouma) {
    axises.push({
      type: 'category',
      data: steps,
      gridIndex: 4,
      axisLabel: {
        interval: 25,
        showMaxLabel: true,
        showMinLabel: true,
        fontSize: 10,
      },
    });
    if (steps.length) {
      axises[0].max = Math.max(...steps.map((s) => parseFloat(s)));
      axises[0].min = Math.min(...steps.map((s) => parseFloat(s)));
    }
  }
  return axises;
}
function getTrendSeries(trends: Stock.TrendItem[], color: string, markLines: any[]) {
  return {
    data: trends.map(({ current }) => current),
    type: 'line',
    name: '价格',
    showSymbol: false,
    symbol: 'none',
    smooth: false,
    lineStyle: {
      width: 2,
      color,
    },
    markLine: {
      symbol: 'none',
      label: {
        show: true,
        position: 'insideStartTop',
        formatter: '{b},{c}',
      },
      data: markLines,
    },
  };
}
function getAvgSeries(trends: Stock.TrendItem[]) {
  return {
    data: trends.map(({ average }) => average),
    type: 'line',
    name: '均价',
    showSymbol: false,
    symbol: 'none',
    smooth: false,
    lineStyle: {
      width: 1,
      color: maColors[0],
    },
  };
}
function getVolSeries(data: any[]) {
  return {
    name: '成交量',
    type: 'bar',
    xAxisIndex: 1,
    yAxisIndex: 1,
    data,
  };
}
function getTechSeriesWithResult(techType: TechIndicatorType, values: number[][], names: string[]) {
  const axisIndex = 2;
  if (techType == TechIndicatorType.MACD) {
    const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
    return [
      {
        name: names[0],
        type: 'bar',
        stype: 'tech',
        xAxisIndex: axisIndex,
        yAxisIndex: axisIndex,
        data: values[0],
        itemStyle: {
          color: (item: { data: number }) => (item.data >= 0 ? variableColors['--increase-color'] : variableColors['--reduce-color']),
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
        lineStyle: {
          color: '#da6ee8',
          width: 1,
        },
      },
      {
        name: names[2],
        type: 'line',
        stype: 'tech',
        symbol: 'none',
        xAxisIndex: axisIndex,
        yAxisIndex: axisIndex,
        data: values[2],
        lineStyle: {
          opacity: 0.8,
          color: '#39afe6',
          width: 1,
        },
      },
    ];
  }
  const result = [];
  if (names.length > 0) {
    result.push({
      name: names[0],
      type: 'line',
      stype: 'tech',
      symbol: 'none',
      xAxisIndex: axisIndex,
      yAxisIndex: axisIndex,
      data: values[0],
      lineStyle: {
        color: '#0099DD',
        width: 1,
      },
      markLine: {
        symbol: 'none',
        label: {
          show: false,
        },
        data: [] as any[],
      }
    });
  }
  if (names.length > 1) {
    result.push({
      name: names[1],
      type: 'line',
      stype: 'tech',
      symbol: 'none',
      xAxisIndex: axisIndex,
      yAxisIndex: axisIndex + (techType === TechIndicatorType.ADV ? 2 : 0),
      data: values[1],
      lineStyle: {
        opacity: 0.8 + (techType === TechIndicatorType.ADV ? -0.3 : 0),
        color: '#FF9933',
        width: 1,
      },
    });
  }
  if (names.length > 2) {
    result.push({
      name: names[2],
      type: 'line',
      stype: 'tech',
      symbol: 'none',
      xAxisIndex: axisIndex,
      yAxisIndex: axisIndex + (techType === TechIndicatorType.ADV ? 2 : 0),
      data: values[2],
      lineStyle: {
        opacity: 0.8 + (techType === TechIndicatorType.ADV ? -0.3 : 0),
        color: '#00ABBD',
        width: 1,
      },
    });
  }
  if (techType === TechIndicatorType.RSI || techType == TechIndicatorType.KDJ) {
    const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
    result[0].markLine?.data.push({
      name: 'oversell',
      yAxis: 30,
      lineStyle: {
        color: variableColors['--hint-color'],
        opacity: 0.65,
      },
    });
    result[0].markLine?.data.push({
      name: 'overbuy',
      yAxis: 70,
      lineStyle: {
        color: variableColors['--hint-color'],
        opacity: 0.65,
      },
    });
  } else if (techType === TechIndicatorType.ADV) {
    const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
    result[0].markLine?.data.push({
      name: 'weak',
      yAxis: 20,
      lineStyle: {
        color: variableColors['--hint-color'],
        opacity: 0.65,
      },
    });
    result[0].markLine?.data.push({
      name: 'strong',
      yAxis: 40,
      lineStyle: {
        color: variableColors['--hint-color'],
        opacity: 0.65,
      },
    });
  }
  return result;
}
function updateTechSeries(options:any, ks: Stock.KLineItem[], seriesIndex = 3) {
  // remove previous
  options.series = options.series.filter((_:any) => _.stype !== 'tech');
  const techSeries = getTechSeries(options.techType, ks);
  options.series.splice(seriesIndex, 0, ...techSeries);
}
function getTechSeries(techType: TechIndicatorType, ks: Stock.KLineItem[]) {
  const {names, values} = Tech.calculateIndicators(ks, techType);
  return getTechSeriesWithResult(techType, values, names);
}
/**
 * 按截止日期截断K线（按天比较）
 * 日线与30分钟线都适用：截止日期当天的数据全部保留
 */
function filterKlinesByToDate(klines: Stock.KLineItem[], toDate?: string) {
  if (!toDate || !klines?.length) {
    return klines;
  }
  const day = toDate.substring(0, 10);
  let idx = -1;
  for (let i = 0; i < klines.length; i++) {
    if (klines[i].date.substring(0, 10) <= day) {
      idx = i;
    } else {
      break;
    }
  }
  if (idx < 0) {
    return [];
  }
  return idx === klines.length - 1 ? klines : klines.slice(0, idx + 1);
}
function calcDisplayToDate(trainMode: boolean, toDate: string | undefined, backtestDate: string | undefined, dayKlines: Stock.KLineItem[]) {
  if (trainMode) return toDate;
  if (backtestDate && dayKlines.length > 0) {
    for (let i = dayKlines.length - 1; i >= 0; i--) {
      if (dayKlines[i].date < backtestDate) {
        return dayKlines[i].date;
      }
    }
  }
  return undefined;
}
function getKSeries(data: any[], markPoints: any[], markLines: any[]) {
  const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
  return {
    name: 'K线',
    type: 'candlestick',
    data,
    itemStyle: {
      color: variableColors['--increase-color'],
      color0: variableColors['--reduce-color'],
      borderColor: variableColors['--increase-color'],
      borderColor0: variableColors['--reduce-color'],
    },
    markPoint: {
      symbol: 'pin',
      symbolSize: 20,
      // symbolRotate: 180,
      symbolOffset: [0, 2],
      label: {
        fontSize: 8,
        // offset: [0, 5],
      },
      data: Array.isArray(markPoints) ? markPoints : [],
    },
    markLine: {
      symbol: 'none',
      label: {
        show: true,
        position: 'insideStartTop',
        formatter: '{b},{c}',
      },
      data: markLines,
    },
  };
}
function updateMASeries(options:any, ks: Stock.KLineItem[], seriesIndex = 3) {

  options.series = options.series.filter((_:any) => _.stype !== 'ma');
  const maSeries = getMASeries(options.maType, ks);
  options.series.splice(seriesIndex, 0, ...maSeries);
}
function getMASeries(maType: MAPeriodType, ks: Stock.KLineItem[]) {
  var values: number[][] = [];
  var names: string[] = [];
  const sps = ks.map((_: { sp: any; }) => _.sp);
  switch(maType) {
    case MAPeriodType.Short:
      values = [Utils.calculateMA(5, sps), Utils.calculateMA(10, sps), Utils.calculateMA(20, sps)];
      names = ['MA5', 'MA10', 'MA20'];
      break;
    case MAPeriodType.Medium:
      values = [Utils.calculateMA(20, sps), Utils.calculateMA(40, sps), Utils.calculateMA(60, sps)];
      names = ['MA20', 'MA40', 'MA60'];
      break;
    case MAPeriodType.Long:
      values = [Utils.calculateMA(60, sps), Utils.calculateMA(120, sps), Utils.calculateMA(250, sps)];
      names = ['MA60', 'MA120', 'MA250'];
      break;
    case MAPeriodType.JAX:
      values = Utils.calculateJAX(ks, 10);
      names = ['JAX_L', 'JAX_S'];
      break;
    case MAPeriodType.DGWY:
      values = Utils.calculateDGWY(ks, 15);
      names = ['MID', 'UPPER', 'LOWER'];
    default:
      break;
  }

  const mas = [
    {
      name: names[0],
      type: 'line',
      stype: 'ma',
      silent: true,
      data: values[0],
      smooth: true,
      showSymbol: false,
      lineStyle: {
        width: 1,
        color: maColors[0],
      },
    },
    {
      name: names[1],
      type: 'line',
      stype: 'ma',
      silent: true,
      data: values[1],
      smooth: false,
      showSymbol: false,
      lineStyle: {
        width: 1,
        color: maColors[1],
      },
    },
    {
      name: names.length > 2 ? names[2] : '',
      type: 'line',
      stype: 'ma',
      silent: true,
      data: values[2] || [],
      smooth: false,
      showSymbol: false,
      lineStyle: {
        width: 1,
        color: maColors[2],
      },
    },
  ];
  return mas;
}
function getKDrawLineSeries(data: any[]) {
  return {
    name: '标记线',
    type: 'line',
    symbol: 'none',
    xAxisIndex: 0,
    yAxisIndex: 0,
    data,
    lineStyle: {
      color: '#fca311',
      width: 2,
      join: 'round',
    },
  };
}
function getMarkLineData(darkMode: boolean, zs?: number, chansGSpot?: number) {
  const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
  const markLineData = [] as any[];
  if (zs) {
    markLineData.push({
      name: '昨收',
      yAxis: zs,
      label: {
        color: variableColors['--hint-color'],
      },
      lineStyle: {
        color: variableColors['--hint-color'],
      },
    });
  }
  if (chansGSpot) {
    markLineData.push({
      name: 'GSpot',
      yAxis: chansGSpot,
      label: {
        color: variableColors['--warn-color'],
        backgroundColor: darkMode ? 'rgba(255,255,255,0.75)' : 'rgba(0, 0, 0, 0.75)',
        padding: 4,
        borderRadius: 3,
      },
      lineStyle: {
        color: variableColors['--hint-color'],
      },
    });
  }
  return markLineData;
}
function getMarkPointData(klineValues: any[]) {
  const markPoints: any[] = [];
  const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
  klineValues.forEach((k, i) => {
    if (k[4] !== ChanType.Top && k[4] !== ChanType.Bottom) {
      return;
    }
    if (i === klineValues.length || i === 0) {
      return;
    }
    if (k[4] === ChanType.Bottom) {
      // 缩量，放量
      let valid = klineValues[i + 1][5] > 1 * k[5] && 1.2 * k[5] > klineValues[i - 1][5];
      let buyIndex = i;
      // 成交量放大
      if (!valid && i + 1 < klineValues.length && klineValues[i + 1][4] === ChanType.StepUp) {
        valid = k[5] < klineValues[i][5] && klineValues[i][5] < klineValues[i + 1][5];
        buyIndex += 1;
      }
      if (valid) {
        markPoints.push({
          value: 'Buy',
          coord: [buyIndex, String(klineValues[buyIndex][2])],
          itemStyle: {
            color: variableColors['--primary-color'],
          },
        });
      }
    } else if (k[4] === ChanType.Top) {
      // 顶部放量
      if (k[5] > 2 * klineValues[i - 1][5]) {
        const sellIndex = i + 1;
        markPoints.push({
          value: 'Sell',
          coord: [sellIndex, String(klineValues[sellIndex][2])],
          itemStyle: {
            color: variableColors['--primary-color'],
          },
        });
      }
    }
  });
  return markPoints;
}
function getChanSeries(chans: Stock.ChanItem[]) {
  let result: any;
  if (chans) {
    const lineData: any[] = [];
    chans
      .filter((c) => c.type == ChanType.Top || c.type == ChanType.Bottom)
      .forEach((s, i) => {
        lineData.push([s.date, s.sp]);
      });
    result = {
      name: '缠线',
      type: 'line',
      symbol: 'none',
      data: lineData,
      lineStyle: {
        color: '#b5838d',
        width: 2,
      },
      xAxisIndex: 0,
      yAxisIndex: 0,
    };
  }
  return result;
}
function getChouMaSeries(zx: number, avg: number, steps: string[], values: number[]) {
  const index = 4;
  const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
  return {
    name: '筹码分布',
    type: 'bar',
    data: values.map((v, i) => {
      const s = parseFloat(steps[i]);
      return {
        value: v,
        itemStyle: {
          color: s > zx ? variableColors['--reduce-color'] : s == avg ? hintColor : variableColors['--increase-color'],
        },
      };
    }),
    xAxisIndex: index,
    yAxisIndex: index,
  };
}
function tChartTipFormatter(zs: number) {
  return (params: any[]) => {
    let text = `<div style="width: 200px"><div style="font-weight:bold;">${params[0].axisValue}</div>`; // 时间
    params.forEach((p: any) => {
      if (p.seriesName == '价格') {
        text += `<div style="display: flex; justify-content: space-between;" class="${
          p.data > zs ? 'text-up' : 'text-down'
        }"><span>现价:</span><span>${p.data.toFixed(2)}</span></div>`;
        text += `<div style="display: flex; justify-content: space-between;" class="${
          p.data > zs ? 'text-up' : 'text-down'
        }"><span>涨跌:</span><span>${((p.data / zs) * 100 - 100).toFixed(2) + '%'}</span></div>`;
      } else if (p.seriesName == '均价') {
        text += `<div style="display: flex; justify-content: space-between;"><span>均价:</span><span>${p.data.toFixed(2)}</span></div>`;
      } else if (p.seriesName == '成交量') {
        text += `<div style="display: flex; justify-content: space-between;"><span>成交量:</span><span>${
          (p.data[1] / 10000).toFixed(2) + '万手'
        }</span></div>`;
      }
    });
    text += '</div>';
    return text;
  };
}
function baseTChartOptions(darkMode: boolean) {
  return {
    title: {
      show: false,
    },
    colors: ['#ec0000', '#00da3c'],
    darkMode,
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
      },
      position: function (pos: number[], params: any, el: any, elRect: any, size: { viewSize: number[]; }) {
        const obj:{
          [key: string]: number
        } = {
          top: 10,
        };
        obj[['left', 'right'][+(pos[0] < size.viewSize[0] / 2)]] = 30;
        return obj;
      },
      formatter: function (params: any[]) {
        return 'not inited';
      },
    },
    series: [{}],
  } as {
    [key: string]: any
  };
}
function baseKChartOptions(darkMode: boolean, range?: { start: number; end: number }) {
  return {
    title: {
      show: false,
    },
    colors: ['#ec0000', '#00da3c'],
    darkMode,
    animation: false,
    maType: MAPeriodType.Medium,
    techType: TechIndicatorType.RSI,
    xAxis: [] as any[],
    yAxis: [] as any[],
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
      },
      position: function (pos: number[], params: any, el: any, elRect: any, size: { viewSize: number[]; }) {
        const obj:{
          [key: string]: number | undefined
        } = {
          top: 10,
        };
        obj[['left', 'right'][+(pos[0] < size.viewSize[0] / 2)]] = 30;
        return obj;
      },
      formatter: function (params: any[]) {
        let text = `<div style="width: 200px"><div style="font-weight:bold;">${params[0].axisValue}</div>`; // 时间
        params.forEach((p) => {
          if (p.seriesName == '筹码') {
            // 筹码分布
            text += `<div style="display: flex; justify-content: space-between;"><span>价格:</span><span>${p.axisValue}</span></div>`;
            const cmVal = typeof p.value === 'number' && Number.isFinite(p.value) ? p.value.toFixed(5) : '--';
            text += `<div style="display: flex; justify-content: space-between;"><span>筹码占比:</span><span>${cmVal}</span></div>`;
          } else if (p.seriesName == 'K线') {
            const val = p.data && p.data.value;
            if (!val || !val.length) {
              return;
            }
            const zs = val[6] || 0;
            text += `<div style="display: flex; justify-content: space-between;" class="${
              zs > 0 ? (val[1] > zs ? 'text-up' : 'text-down') : ''
            }"><span>开盘:</span><span>${val[1].toFixed(2)}</span></div>`;
            text += `<div style="display: flex; justify-content: space-between;" class="${
              zs > 0 ? (val[4] > zs ? 'text-up' : 'text-down') : ''
            }"><span>最高:</span><span>${val[4].toFixed(2)}</span></div>`;
            text += `<div style="display: flex; justify-content: space-between;" class="${
              zs > 0 ? (val[3] > zs ? 'text-up' : 'text-down') : ''
            }"><span>最低:</span><span>${val[3].toFixed(2)}</span></div>`;
            text += `<div style="display: flex; justify-content: space-between;" class="${
              zs > 0 ? (val[2] > zs ? 'text-up' : 'text-down') : ''
            }"><span>收盘:</span><span>${val[2].toFixed(2)}</span></div>`;
            if (val.length > 6) {
              text += `<div style="display: flex; justify-content: space-between;" class="${
                zs > 0 ? (val[2] > zs ? 'text-up' : 'text-down') : ''
              }"><span>涨跌:</span><span>${((val[2] / val[6]) * 100 - 100).toFixed(2) + '%'}</span></div>`;
              text += `<div style="display: flex; justify-content: space-between;"><span>换手率:</span><span>${val[7] + '%'}
              </span></div>`;
              text += `<div style="display: flex; justify-content: space-between;"><span>成交额:</span><span>${
                (val[8] / 100000000).toFixed(2) + '亿'
              }
              </span></div>`;
            }
          } else if (p.seriesName != 'MACD' && p.seriesName.indexOf('MA') != -1) {
            // 均线在某些交易日没有值（null），直接 toFixed 会抛异常
            const maVal = typeof p.data === 'number' && Number.isFinite(p.data) ? p.data.toFixed(2) : '--';
            text += `<div style="display: flex; justify-content: space-between;"><span>${p.seriesName}:</span><span>${maVal}</span></div>`;
          } else if (p.seriesName == '成交量') {
            text += `<div style="display: flex; justify-content: space-between;"><span>成交量:</span><span>${
              (p.data[1] / 10000).toFixed(2) + '万手'
            }</span></div>`;
          } else if (p.seriesName == '短线评分' && p.data && typeof p.data === 'object') {
            // 短线评分：带出当日变化值（红绿柱）与突变程度（见 helpers/shortTermScoreJump）
            const d: any = p.data;
            const delta = typeof d.delta === 'number' ? d.delta : null;
            const cls = delta === null ? '' : delta > 0 ? 'text-up' : 'text-down';
            text += `<div style="display: flex; justify-content: space-between;" class="${cls}"><span>短线评分:</span><span>${Number(
              d.value
            ).toFixed(1)}</span></div>`;
            if (delta !== null) {
              text += `<div style="display: flex; justify-content: space-between;" class="${cls}"><span>较前一日:</span><span>${formatScoreDelta(
                delta
              )}</span></div>`;
            }
            if (d.jumpDesc) {
              text += `<div style="display: flex; justify-content: space-between;" class="${cls}"><span>突变:</span><span>${d.jumpDesc}</span></div>`;
            }
            if (d.signalKind) {
              const sigCls = isBuySignalKind(d.signalKind) ? 'text-up' : 'text-down';
              text += `<div style="display: flex; justify-content: space-between;" class="${sigCls}"><span>信号:</span><span>${d.signalKind}</span></div>`;
              if (d.signalReason) {
                text += `<div style="opacity:.72;font-size:11px;margin-top:2px;max-width:420px;white-space:normal">${d.signalReason}</div>`;
              }
            }
          } else if (p.seriesName == '自低点抬升' && p.data && typeof p.data === 'object') {
            // 自近 N 根低点抬升：低位横盘后启动时，这个值会比单日柱高更早给出方向
            const r: any = p.data;
            const lowTxt = typeof r.low === 'number' ? `（低点 ${r.low.toFixed(1)}）` : '';
            text += `<div style="display: flex; justify-content: space-between;"><span>自近${SHORT_SCORE_RISE_DAYS}根低点${lowTxt}抬升:</span><span>+${Number(
              r.value
            ).toFixed(1)}</span></div>`;
          } else if (typeof p.data === 'number' && Number.isFinite(p.data)) {
            // 注意别用 !isNaN(p.data)：isNaN(null) === false，会让 null 通过判断后 .toFixed 崩溃
            text += `<div style="display: flex; justify-content: space-between;"><span>${p.seriesName}:</span><span>${p.data.toFixed(
              2
            )}</span></div>`;
          }
          
        });
        params.forEach((p) => {
          if (p.seriesName == 'K线') {
            const val = p.data && p.data.value;
            if (!val || !val.length) {
              return;
            }
            if (val[9]) {
              // K线形状标识
              let st = val[9].sshapeType as number;
              let kname = SingleKLineShapeNames[st];
              text += `<div style="display: flex; justify-content: space-between;"><span>K线形态:</span><span>${
                kname
              }</span></div>`;
              text += `<div style="display: flex; justify-content: space-between;"><span>K线数据:</span><span>s: ${val[9].size.toFixed(
                1
              )}, t: ${val[9].top.toFixed(1)}, d: ${val[9].down.toFixed(1)}</span></div>`;
            }
            if (val[10]) {
              if (val[10].doBuy) {
                text += `<div style="display: flex; justify-content: space-between;"><span>买:</span><span>${val[10].buyReason}</span></div>`;
              } else if (val[10].buyReason) {
                text += `<div style="display: flex; justify-content: space-between;"><span>不买:</span><span>${val[10].buyReason}</span></div>`;
              }
              if (val[10].canSell) {
                text += `<div style="display: flex; justify-content: space-between;"><span>卖:</span><span>${val[10].sellReason}</span></div>`;
              } else if (val[10].sellReason) {
                text += `<div style="display: flex; justify-content: space-between;"><span>不卖:</span><span>${val[10].sellReason}</span></div>`;
              }
            }
            if (val[11]) {
              val[11].forEach((t: any) => {
                text += `<div style="margin-top:10px;word-wrap:break-word; white-space:pre-wrap;">${t}</div>`;
              });
            }
          }
        });
        text += '</div>';
        return text;
      },
    },
    dataZoom: {
      type: 'inside',
      zoomOnMouseWheel: false,
      moveOnMouseMove: true,
      start: range ? range.start : 0,
      end: range ? range.end : 100,
    },
    brush: {
      toolbox: ['lineX', 'clear'],
      xAxisIndex: [0, 1],
      brushLink: [0, 1],
      outOfBrush: {
        colorAlpha: 0.1,
      },
    },
    toolbox: {
      feature: {
        dataZoom: {
          yAxisIndex: false,
        },
        brush: {
          type: ['lineX', 'clear'],
        },
      },
    },
    series: [{}],
  } as {
    [key: string] : any
  };
}
function alignChouma(ks: { zg: number; zd: number }[], cm: Stock.ChouMaItem, range: { start: number; end: number }) {
  const showData = ks.slice(Math.floor((ks.length * range.start) / 100), Math.ceil((ks.length * range.end) / 100));
  const yMax = parseFloat((Math.max(...showData.map((a) => a.zg)) * 1.1).toFixed(2));
  const yMin = parseFloat((Math.min(...showData.map((a) => a.zd)) * 0.9).toFixed(2));
  const step = +cm.steps[1] - +cm.steps[0];
  if (+cm.steps[0] > yMin) {
    // 往下加数据
    let v = +cm.steps[0] - step;
    while (v >= yMin) {
      cm.steps.splice(0, 0, v.toFixed(2));
      cm?.values.splice(0, 0, 0);
      v -= step;
    }
  }
  if (+cm.steps[0] > yMin) {
    cm.steps.splice(0, 0, yMin.toFixed(2));
    cm.values.splice(0, 0, 0);
  }
  if (+cm.steps[cm.steps.length - 1] < yMax) {
    // 往上加数据
    let v = +cm.steps[cm.steps.length - 1] + step;
    while (v <= yMax) {
      cm.steps.push(v.toFixed(2));
      cm?.values.push(0);
      v += step;
    }
  }
  if (+cm.steps[cm.steps.length - 1] < yMax) {
    cm.steps.push(yMax.toFixed(2));
    cm.values.push(0);
  }
  let from = 0;
  let to = cm.values.length;
  for (let i = 0; i < cm.steps.length; i++) {
    if (from == 0 && +cm.steps[i] >= yMin) {
      from = i;
    }
    if (to == cm.values.length && +cm.steps[i] > yMax) {
      to = i - 1;
    }
  }
  return {
    ...cm,
    values: cm.values.slice(from, to),
    steps: cm.steps.slice(from, to),
    avgCost: cm.avgCost,
  };
}
function setupTrendChart(darkMode: boolean, trends: Stock.TrendItem[], zs: number, stockMarkLines?: number[]) {
  const options = baseTChartOptions(darkMode);
  options.grid = getGridOption(false);
  options.visualMap = getVisualMap();
  options.axisPointer = getAxisPointer();
  options.tooltip.formatter = tChartTipFormatter(zs);
  const dates = trends.map(({ datetime }) => datetime.length >= 10 ? datetime.split(' ')[1] : datetime);
  options.xAxis = getxAxis(dates);
  // 停牌 / 训练日尚未推进时可能拿到空分时：不能对空数组取 trends[0]，用昨收撑开一个默认区间
  const hasAverage = trends.some((t) => !!t.average);
  const vals = trends.length
    ? trends.map((t) => t.current).concat(hasAverage ? trends.map((t) => t.average) : [])
    : [zs > 0 ? zs : 1];
  const yMin = Math.min(...vals) * 0.999;
  const yMax = Math.max(...vals) * 1.001;
  options.yAxis = getyAxis(darkMode, [yMin, yMax]);
  // const macds = Tech.calculateMACD(trends.map((_) => _.current), 89, 25, 13); // macd(trends.map((_) => _.current));
  const { color } = Utils.GetValueColor(Number(trends[trends.length - 1]?.current) - zs);
  const currentPrice = Number(trends[trends.length - 1]?.current);
  const markLines = getMarkLineData(darkMode, zs, undefined);
  // 添加 stockMarkLines（日K线上的用户自定义markline），只显示在分时图价格范围内的
  if (stockMarkLines && stockMarkLines.length > 0) {
    stockMarkLines.forEach((m) => {
      if (m >= yMin && m <= yMax) {
        markLines.push({
          name: m < currentPrice ? '支撑' : '压力',
          yAxis: m,
          label: {
            color: Utils.getVariablesColor(CONST.VARIABLES)['--hint-color'],
          },
          lineStyle: {
            color: Utils.getVariablesColor(CONST.VARIABLES)['--hint-color'],
            type: 'dashed',
          },
        });
      }
    });
  }
  options.series = [
    getTrendSeries(trends, color, markLines),
    getVolSeries(trends.map(({ vol, up }, i) => [i, vol, up])),
    // ...getMACDSeries(macds),
  ];
  if (hasAverage) {
    options.series.push(getAvgSeries(trends));
  }
  return options;
}
function updateTrendChart(opts: any, darkMode: boolean, trends: Stock.TrendItem[], zs: number, stockMarkLines?: number[]) {
  opts.darkMode = darkMode;
  opts.tooltip.formatter = tChartTipFormatter(zs);
  const dates = trends.map(({ datetime }) => datetime.length >= 10 ? datetime.split(' ')[1] : datetime);
  for (let i = 0; i < opts.xAxis.length; i++) {
    opts.xAxis[i].data = dates;
  }
  // 该交易日没有分时数据时清空图形（历史分时取不到 / 停牌），不能保留上一天的分时
  if (!trends.length) {
    opts.series[0].data = [];
    opts.series[1].data = [];
    if (opts.series.length > 2) {
      opts.series[2].data = [];
    }
    opts.series[0].markLine.data = getMarkLineData(darkMode, zs, undefined);
    return;
  }
  const hasAverage = trends.some((t) => !!t.average);
  const vals = trends.map((t) => t.current).concat(hasAverage ? trends.map((t) => t.average) : []);
  const yMin = Math.min(...vals) * 0.999;
  const yMax = Math.max(...vals) * 1.001;
  opts.yAxis[0].min = yMin;
  opts.yAxis[0].max = yMax;
  opts.series[0].lineStyle.color = Utils.GetValueColor(Number(trends[trends.length - 1]?.current) - zs).color;
  opts.series[0].data = trends.map(({ current }) => current); // 价格
  opts.series[1].data = trends.map(({ current, vol, last }, i) => [i, vol, current > last ? 1 : -1]); // 成交量
  if (hasAverage) {
    // 首次拿到空分时时没建均价序列（见 setupTrendChart），这里补上后再填数据
    if (opts.series.length > 2) {
      opts.series[2].data = trends.map(({ average }) => average); // 平均价格
    } else {
      opts.series.push(getAvgSeries(trends));
    }
  } else if (opts.series.length > 2) {
    opts.series[2].data = [];
  }
  // 更新 markLine：保留昨收和 GSpot，替换 stockMarkLines
  const currentPrice = Number(trends[trends.length - 1]?.current);
  const baseMarkLines = getMarkLineData(darkMode, zs, undefined);
  if (stockMarkLines && stockMarkLines.length > 0) {
    stockMarkLines.forEach((m) => {
      if (m >= yMin && m <= yMax) {
        baseMarkLines.push({
          name: m < currentPrice ? '支撑' : '压力',
          yAxis: m,
          label: {
            color: Utils.getVariablesColor(CONST.VARIABLES)['--hint-color'],
          },
          lineStyle: {
            color: Utils.getVariablesColor(CONST.VARIABLES)['--hint-color'],
            type: 'dashed',
          },
        });
      }
    });
  }
  opts.series[0].markLine.data = baseMarkLines;
  // macd
  // const macds = Tech.calculateMACD(trends.map((_) => _.current), 89, 25, 13); //macd(trends.map((_) => _.current));
  // opts.series[3].data = macds.histogram;
  // opts.series[4].data = macds.MACD;
  // opts.series[5].data = macds.signal;
}
function setupClineChart(
  darkMode: boolean,
  maType: MAPeriodType,
  techType: TechIndicatorType,
  range: { start: number; end: number },
  chans: Stock.ChanItem[],
  chansLines: Stock.ChanStokeItem[]
) {
  const dates = chans.map(({ date }) => date);
  const values = chans.map((_, i) => [_.kp, _.sp, _.zd, _.zg, _.type, i == 0 ? 0 : chans[i - 1].sp, _.hsl, _.cje]);
  const macds = Tech.calculateMACD(values.map((_) => _[1]), 89, 25, 13);//macd(values.map((_) => _[1]));
  const vols = chans.map(({ zdf, cjl }, i) => [i, cjl, zdf > 0 ? 1 : -1]);

  const options = baseKChartOptions(darkMode, range);
  options.maType = maType;
  options.techType = techType;
  options.grid = getGridOption();
  options.axisPointer = getAxisPointer();
  options.visualMap = getVisualMap(2);
  // 缠论K线同理：右侧留出半个槽位，避免最后一根K线影线压到右侧 y 轴
  options.xAxis = getxAxis(dates, false, true);
  options.yAxis = getyAxis(darkMode);
  options.series = [
    getKSeries(values, [], []), 
    getChanSeries(chans), 
    getVolSeries(vols), 
    // ...getMACDSeries(macds)
  ];
  options.dataZoom.xAxisIndex = options.xAxis.map((e, i) => i).slice(0, options.xAxis.length - 1);
  return options;
}
function setupKlineChart(
  darkMode: boolean,
  maType: MAPeriodType,
  techType: TechIndicatorType,
  range: { start: number; end: number },
  chouma: Stock.ChouMaItem | null,
  klines: Stock.KLineItem[],
  markLineData = [] as { x: any; y: any }[],
  markPointData = [] as any[],
  showChouma = true,
  toDate?: string,
  bkks?: Stock.KLineItem[]
) {
  // 取数失败时 klines 可能为 undefined，这里兜底成空数组，避免后续 .map / 取最后一条抛错
  const _klines = filterKlinesByToDate(klines, toDate) || [];
  const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
  const dates = _klines.map(({ date }) => date);
  const values = _klines.map((_, i) => {
    const bos = _.buyorsell;
    const isYin = _.kp > _.sp;
    let color = isYin ? variableColors['--reduce-color'] : variableColors['--increase-color'];
    let borderColor = isYin ? variableColors['--reduce-color'] : variableColors['--increase-color'];
    if (bos?.canSell) {
      color = '#66BFBF';
      borderColor = '#66BFBF';
    } else if (bos?.doBuy) {
      color = '#FF8B8B';
      borderColor = '#FF8B8B';
    }
    return {
      value: [_.kp, _.sp, _.zd, _.zg, _.chan, i == 0 ? 0 : _klines[i - 1].sp, _.hsl, _.cje, _.describe, _.buyorsell, _.notes],
      itemStyle: {
        color,
        borderColor,
      },
    };
  });
  // K线可能为空（数据源取数失败、训练模式下该区间无数据等），此时不能取最后一条，否则会抛错导致白屏
  const zx = values.length ? (values[values.length - 1].value[1] as number) : NaN;
  const vols = _klines.map(({ kp, sp, cjl }, i) => [i, cjl, i != 0 && sp <= _klines[i - 1].sp ? -1 : 1]);
  const options = baseKChartOptions(darkMode, range);
  options.maType = maType;
  options.techType = techType;
  options.grid = getGridOption(true, showChouma);
  options.axisPointer = getAxisPointer();
  options.visualMap = getVisualMap(2);
  // K线图：首尾各留半个类目槽位，最后一日的上下影线不再压到右侧 y 轴
  options.xAxis = getxAxis(dates, showChouma, true);
  const showBK = bkks && bkks.length > 0;
  options.yAxis = getyAxis(darkMode, chouma ? chouma.steps : undefined, showChouma);
  if (!showChouma) {
    const startI = Math.floor((_klines.length * range.start) / 100);
    const endI = Math.ceil((_klines.length * range.end) / 100);
    const showed = _klines.slice(startI, endI);
    // 空数组会让 Math.min/max 得到 ±Infinity，这里仅在有空数据时设置
    if (showed.length) {
      options.yAxis[0].min = Math.min(...showed.map((_) => _.zd));
      options.yAxis[0].max = Math.max(...showed.map((_) => _.zg));
    }
  }
  
  options.series = [
    getKSeries(values, markPointData, []),
    getKDrawLineSeries(markLineData),
    getVolSeries(vols),
    ...getMASeries(options.maType, _klines),
    ...getTechSeries(options.techType, _klines),
  ];
  if (showBK) {
    const bkvalues = bkks.map((_, i) => {
      const isYin = _.kp > _.sp;
      const color = 'rgba(255, 255, 255, 0)'; //isYin ? variableColors['--second-reduce-color'] : variableColors['--second-increase-color'];
      const borderColor = isYin ? variableColors['--second-reduce-color'] : variableColors['--second-increase-color'];
      return {
        value: [_.kp, _.sp, _.zd, _.zg, _.chan, i == 0 ? 0 : bkks[i - 1].sp, _.hsl, _.cje],
        itemStyle: {
          color,
          borderColor,
        },
      };
    });
    options.series.push({
      name: 'BKK线',
      type: 'candlestick',
      data: bkvalues,
      xAxisIndex: 0,
      yAxisIndex: 0, //options.yAxis.length - 1,
    });
  }
  if (showChouma) {
    options.series.push(getChouMaSeries(zx, parseFloat(chouma.avgCost), chouma.steps, chouma.values));
    options.dataZoom.xAxisIndex = options.xAxis.map((e, i) => i).slice(0, options.xAxis.length - 1);
  } else {
    options.dataZoom.xAxisIndex = options.xAxis.map((e, i) => i);
  }
  return options;
}
function updateCKChart(
  opts: any,
  darkMode: boolean,
  range: { start: number; end: number },
  zx: number,
  showChouma = true,
  chouma?: Stock.ChouMaItem
) {
  opts.darkMode = darkMode;
  opts.dataZoom.start = range.start;
  opts.dataZoom.end = range.end;

  const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
  opts.visualMap[0].pieces[0].color = variableColors['--reduce-color'];
  opts.visualMap[0].pieces[1].color = variableColors['--increase-color'];
  opts.series[0].itemStyle = {
    color: variableColors['--increase-color'],
    color0: variableColors['--reduce-color'],
    borderColor: variableColors['--increase-color'],
    borderColor0: variableColors['--reduce-color'],
  };

  // 无论 grid 数量多少，都需要更新 yAxis min/max
  if (!showChouma) {
    const startI = Math.floor((opts.series[0].data.length * range.start) / 100);
    const endI = Math.ceil((opts.series[0].data.length * range.end) / 100);
    const showed = opts.series[0].data.slice(startI, endI);
    if (showed.length) {
      opts.yAxis[0].min = Math.min(...showed.map((d: any) => d[2]));
      opts.yAxis[0].max = Math.max(...showed.map((d: any) => d[3]));
    }
  } else if (chouma && opts.grid.length >= 4) {
    // 只有存在筹码 grid 时才处理筹码相关逻辑
    const cm = alignChouma(
      opts.series[0].data.map((d: any[]) => {
        return {
          zd: d[2],
          zg: d[3],
        };
      }),
      chouma,
      range
    );
    const yMax = Math.max(...cm.steps.map((s) => parseFloat(s)));
    const yMin = Math.min(...cm.steps.map((s) => parseFloat(s)));
    opts.yAxis[0].max = yMax.toFixed(2);
    opts.yAxis[0].min = yMin.toFixed(2);
    opts.series.slice(-1)[0].data = cm.values.map((v, i) => {
      const s = parseFloat(cm.steps[i]);
      return {
        value: v,
        itemStyle: {
          color: s > zx ? variableColors['--reduce-color'] : s == +cm.avgCost ? hintColor : variableColors['--increase-color'],
        },
      };
    });
    opts.yAxis[opts.yAxis.length - 1].data = cm.steps;
    const lineData = opts.series[0].markLine.data;
    if (opts.xAxis[0].data.slice(-1)[0] !== chouma.date) {
      const prev = lineData.find((l: any) => l.name === '筹码');
      if (prev) {
        prev.xAxis = cm.date;
      } else {
        lineData.push({
          name: '筹码',
          xAxis: cm.date,
          lineStyle: {
            hintColor,
          },
        });
      }
    } else {
      opts.series[0].markLine.data = lineData.filter((l: any) => l.name !== '筹码');
    }
  }
}
function updateCChart(opts: any, chans: Stock.ChanItem[], chansLines: Stock.ChanStokeItem[]) {
  const dates = chans.map(({ date }) => date);
  const values = chans.map((_, i) => [_.kp, _.sp, _.zd, _.zg, _.type, i == 0 ? 0 : chans[i - 1].sp, _.hsl, _.cje]);
  // K线
  for (let i = 0; i < opts.xAxis.length; i++) {
    if (opts.xAxis[i].type === 'category') {
      opts.xAxis[i].data = dates;
    }
  }
  opts.xAxis[0].data = dates;
  opts.series[0].data = values;
  // opts.series[0].markPoint.data = getMarkPointData(values);

  // 趋势线
  const lineData: any[] = [];
  chans
    .filter((c) => c.type == ChanType.Top || c.type == ChanType.Bottom)
    .forEach((s, i) => {
      lineData.push([s.date, s.type == ChanType.Bottom ? s.zd : s.zg]);
    });
  opts.series[1].data = lineData;

  // 成交量
  const vols = chans.map(({ type, cjl }, i) => [i, cjl, type === ChanType.StepDown || type === ChanType.Top ? -1 : 1]);
  opts.series[2].data = vols;
  // 更新技术指标
  // updateTechSeries(opts, chans as unknown as Stock.KLineItem[]);
}
function clearKChartBk(opts: any) {
  if (opts.series[opts.series.length - 1].name == 'BKK线') {
    opts.series = opts.series.slice(0, opts.series.length - 1);
  }
}
function updateKChart(
  opts: any,
  klines: Stock.KLineItem[],
  toDate?: string,
  bkks?: Stock.KLineItem[]
) {
  // opts 可能为 undefined（分时图对象被误当成 K 线图传入等），直接返回避免抛错导致白屏
  if (!opts || !opts.visualMap) {
    return;
  }
  // 取数失败时 klines 可能为 undefined，这里兜底成空数组，避免后续 .map / 取最后一条抛错
  const _klines = filterKlinesByToDate(klines, toDate) || [];
  const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
  opts.visualMap[0].pieces[0].color = variableColors['--reduce-color'];
  opts.visualMap[0].pieces[1].color = variableColors['--increase-color'];
  opts.series[0].itemStyle = {
    color: variableColors['--increase-color'],
    color0: variableColors['--reduce-color'],
    borderColor: variableColors['--increase-color'],
    borderColor0: variableColors['--reduce-color'],
  };
  const dates = _klines.map(({ date }) => date);
  const values = _klines.map((_, i) => {
    const bos = _.buyorsell;
    const isYin = _.kp > _.sp;
    let color = isYin ? variableColors['--reduce-color'] : variableColors['--increase-color'];
    let borderColor = isYin ? variableColors['--reduce-color'] : variableColors['--increase-color'];
    if (bos?.canSell) {
      color = '#66BFBF';
      borderColor = '#66BFBF';
    } else if (bos?.doBuy) {
      color = '#FF8B8B';
      borderColor = '#FF8B8B';
    }
    return {
      value: [_.kp, _.sp, _.zd, _.zg, _.chan, i == 0 ? 0 : _klines[i - 1].sp, _.hsl, _.cje, _.describe, _.buyorsell, _.notes],
      itemStyle: {
        color,
        borderColor,
      },
    };
  });
  // K线
  for (let i = 0; i < opts.xAxis.length; i++) {
    if (opts.xAxis[i].type === 'category') {
      opts.xAxis[i].data = dates;
    }
  }
  opts.xAxis[0].data = dates;
  opts.series[0].data = values;
  // 成交量
  const nextIndex = 2;
  const vols = _klines.map(({ kp, sp, cjl }, i) => [i, cjl, i != 0 && sp <= _klines[i - 1].sp ? -1 : 1]);
  opts.series[nextIndex].data = vols;
  // macd
  // updateTechSeries(opts, _klines, nextIndex + 1);
  // 均线
  updateMASeries(opts, _klines, nextIndex + 4);

  if (bkks && bkks.length > 0) {
    let bkvalues = bkks.map((_, i) => {
      const isYin = _.kp > _.sp;
      const color = 'rgba(255, 255, 255, 0)'; //isYin ? variableColors['--second-reduce-color'] : variableColors['--second-increase-color'];
      const borderColor = isYin ? variableColors['--second-reduce-color'] : variableColors['--second-increase-color'];
      return {
        value: [_.kp, _.sp, _.zd, _.zg, _.chan, i == 0 ? 0 : bkks[i - 1].sp, _.hsl, _.cje],
        itemStyle: {
          color,
          borderColor,
        },
      };
    });
    if (bkvalues.length < values.length) {
      // 需要填充数据
      const paddings = [];
      for (let i = 0; i < values.length - bkvalues.length; i++) {
        paddings.push({ value: [0, 0, 0, 0], itemStyle: {color: 'rgba(255, 255, 255, 0)', borderColor: variableColors['--second-reduce-color']} });
      }
      bkvalues = paddings.concat(bkvalues);
    } else if (bkvalues.length > values.length) {
      bkvalues = bkvalues.slice(bkvalues.length - values.length);
    }
    if (opts.series[opts.series.length - 1].stype === 'bbk') {
      opts.series[opts.series.length - 1].data = bkvalues;
    } else {
      opts.series.push({
        name: 'BKK线',
        type: 'candlestick',
        stype: 'bkk',
        data: bkvalues,
        xAxisIndex: 0,
        yAxisIndex: 0,//opts.yAxis.length - 1,
      });
    }
  }
}
function updateKMAChart(opts: any, ma1: number[], ma2: number[], ma3: number[], manames: string[]) {
  const volIndex = 2;
  // 均线
  opts.series[volIndex + 4].data = ma1;
  opts.series[volIndex + 5].data = ma2;
  if (ma3) opts.series[volIndex + 6].data = ma3;
  opts.series[volIndex + 4].name = manames[0];
  opts.series[volIndex + 5].name = manames[1];
  if (ma3) opts.series[volIndex + 6].name = manames[2];
}

function updateKMarkPoints(opts: any, markPoints: any[]) {
  opts.series[0].markPoint.data = markPoints;
}

function updateKMarkLines(opts: any, linePoints: any[]) {
  // 趋势线
  opts.series?.forEach((s: any) => {
    if (s.name == '标记线') {
      s.data = linePoints.map((_) => [_.x, _.y]);
    }
  });
}

const PriceTrend: React.FC<PriceTrendProps> = React.memo(
  ({
    active,
    secid,
    zs,
    trainMode,
    ignoreTrain = false,
    activePeriod,
    toDate,
    firstQSAppear,
    backtestDate,
    onTimelineDate,
    updateKLineData,
    updateKType,
    updateMType,
    outRange,
    onRangeUpdated,
    onSelectedAreaUpdated,
    addStock,
    removeStock,
    updateTrendData,
  }) => {
    const stock = useSelector((state: StoreState) => state.stock.stocksMapping[secid]);
    const config = useSelector((state: StoreState) => state.stock.stockConfigsMapping[secid]);
    const backtestMarks = useSelector((state: StoreState) => state.stock.backtestMarks[secid]);
    const { ontrain, trainDate, trainTime } = useSelector((state: StoreState) => state.setting.systemSetting);
    // 忽略训练（详情页开关，按 secid 生效）：当前标的按「非训练」口径取数与展示真实最新数据
    const trainView = trainMode && !ignoreTrain;
    const trainActive = ontrain && !ignoreTrain;
    /**
     * 共享训练时钟（HH:mm）
     *
     * 由 STList 的时间推进写入系统设置，详情页与列表共用同一个时刻：
     * 训练日的分时只展示到这一刻，日K也要按这一刻重建（否则展示的是训练日收盘，属于未来数据）。
     */
    const trainClock = trainActive && trainDate ? TrainFilter.NormalizeTrainClock(trainTime) : '';
    /**
     * 训练时钟是否已「开始推进」（09:30 及之前算未开始）
     *
     * 未开始时训练日当天还属于未来：分时与当日日K都不展示，推进后才按当前时刻逐步出现。
     */
    const trainClockStarted = trainActive && !!trainDate && TrainFilter.IsTrainClockStarted(trainTime);
    /** 供节流回调读取最新训练状态（handleTrends 是 useThrottleFn，闭包不会随渲染更新） */
    const trainActiveRef = useRef(trainActive);
    trainActiveRef.current = trainActive;
    // 训练模式：时序类请求的缓存按训练日期区分（ahooks 的 cacheKey 缓存不含日期会返回旧数据）
    // 忽略训练时用 '/live' 缓存键，即真实最新数据那份缓存
    const trainCacheSuffix = trainActive && trainDate ? `/${trainDate}` : '/live';
    const isStock = Helpers.Stock.GetStockType(secid) == StockMarketType.AB;
    // 回测 / 训练模式下默认展示日K线（分时属于未来数据，训练模式下需要额外请求训练日历史分时）
    const [typeIndex, setTypeIndex] = useState(backtestDate || (trainActive && trainDate) ? DefaultKTypes.indexOf(KLineType.Day) : 0);
    const { darkMode } = useHomeContext();
    const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
    const increaseColor = variableColors['--increase-color'];
    const reduceColor = variableColors['--reduce-color'];
    const [trendDates, setTrendDates] = useState<string[]>([]);
    const [currentTrendDate, setCurrentTrendDate] = useState(dayjs().format('YYYY-MM-DD'));
    const [trendData, setTrendData] = useState({
      trends: stock ? stock.trends : [],
    });
    // 使用 ref 保存最新的 trendData，避免 useThrottleFn 闭包过期问题
    const trendDataRef = useRef(trendData);
    trendDataRef.current = trendData;
    /**
     * 训练日「完整」分时（未按时刻截断）
     *
     * 只在训练日变化时取一次数；训练时钟推进时在本地重新截断即可，不用每分钟重新请求。
     */
    const [trainTrendsRaw, setTrainTrendsRaw] = useState<Stock.TrendItem[]>([]);
    /** 按共享训练时钟截断后的训练日分时（分时图 / 当日K重建都用它；未开始推进时为空） */
    const trainTrendsCut = useMemo(
      () => (trainClockStarted ? TrainFilter.CutTrendsByClock(trainTrendsRaw, trainClock) : []),
      [trainTrendsRaw, trainClock, trainClockStarted]
    );
    const trainTrendsCutRef = useRef(trainTrendsCut);
    trainTrendsCutRef.current = trainTrendsCut;
    /** 训练日真实的日K（分时重建前的那一根）：时钟走到收盘 / 关闭训练时用它还原 */
    const trainDayBarRef = useRef<Stock.KLineItem | null>(null);
    const { kLineApiSourceSetting } = useSelector((state: StoreState) => state.setting.systemSetting);
    const [currentActivePeriod, setCurrentActivePeriod] = useState<Stock.PeriodMarkItem | null | undefined>(null);
    const [chartOptions, setChartOptions] = useState<any>({});

    // 今日是否交易日（按数据源查交易日历）。异步未返回前为 null，此时用「工作日」兜底，
    // 避免非交易时段（午休/盘后）因判定未就绪而漏掉当日K的合成。
    const [isTradeDayToday, setIsTradeDayToday] = useState<boolean | null>(null);
    const isTradeDayTodayRef = useRef<boolean | null>(null);
    isTradeDayTodayRef.current = isTradeDayToday;
    useEffect(() => {
      let alive = true;
      (async () => {
        try {
          const day = dayjs().format('YYYY-MM-DD');
          const ok =
            kLineApiSourceSetting === FundApiType.Tushare
              ? await Services.Tushare.IsTradeDay(day)
              : await Services.Akshare.IsTradeDay(day);
          if (alive) setIsTradeDayToday(ok);
        } catch {
          if (alive) setIsTradeDayToday(null);
        }
      })();
      return () => {
        alive = false;
      };
    }, [kLineApiSourceSetting]);

    /**
     * 是否允许用分时合成/更新「当日K」。
     * 交易日且已开盘（09:20 起，含午间休市与收盘后到当日结束）即允许：
     * 只要数据源还没生成当日日K，就用分时补出/更新当日K。
     * 盘前（<09:20）不合成：此时分时仍是上一交易日的，会造出错误的当日K。
     */
    const canBuildTodayKFromTrends = useCallback((): boolean => {
      const now = new Date();
      if (now.getHours() * 60 + now.getMinutes() < 9 * 60 + 20) {
        return false;
      }
      const flag = isTradeDayTodayRef.current;
      if (flag !== null) {
        return flag;
      }
      const day = now.getDay();
      return day >= 1 && day <= 5;
    }, []);

    /**
     * 根据分时数据合成当日K线
     *
     * @param dateOverride 指定K线所属交易日（训练模式重建训练日当日K时传入），默认取真实今天
     */
    const buildDailyKFromTrends = (
      trends: Stock.TrendItem[],
      stockSecid: string,
      zsValue: number,
      dateOverride?: string
    ): Stock.KLineItem | null => {
      if (!trends || trends.length === 0) return null;
      const today = new Date();
      const dateStr =
        dateOverride ||
        `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      // 只聚合「当日」分时：分时序列可能残留/拼接了别的交易日（上一交易日、多来源拼接），
      // 否则合成K线的成交量/成交额会把其它交易日的量一起累加，表现为异常大。
      const dayTrends = trends.filter((t) => String(t?.datetime || '').substring(0, 10) === dateStr);
      const src = dayTrends.length ? dayTrends : trends;
      let kp = src[0].current;
      let sp = src[src.length - 1].current;
      let zg = src[0].current;
      let zd = src[0].current;
      let cjl = 0;
      for (const t of src) {
        if (t.current > zg) zg = t.current;
        if (t.current < zd) zd = t.current;
        cjl += t.vol || 0;
      }
      const zde = sp - zsValue;
      const zdf = zsValue !== 0 ? (zde / zsValue) * 100 : 0;
      const zf = zsValue !== 0 ? ((zg - zd) / zsValue) * 100 : 0;
      return {
        secid: stockSecid,
        type: KLineType.Day,
        date: dateStr,
        kp,
        sp,
        zg,
        zd,
        zs: zsValue,
        cjl,
        cje: cjl * 100 * sp,
        zf,
        zdf,
        zde,
        hsl: 0,
        chan: 0,
      } as Stock.KLineItem;
    };
    
    const { run: handleTrends } = useThrottleFn(
      (trendd?: Stock.TrendItem[]) => {
        if (!trendd || trendd.length == 0) {
          return;
        }
        // 训练模式：分时只由「按训练时钟截断后的训练日分时」驱动（见 trainTrendsCut 的 effect）。
        // 这里拿到的是实时/整日分时，会越过训练时刻（未推进时甚至直接画出一整天），必须丢弃。
        if (trainActiveRef.current) {
          return;
        }
        // 使用 ref 获取最新分时数据，避免 useThrottleFn 闭包过期导致重复拼接
        const currentTrends = trendDataRef.current.trends;
        let trends: Stock.TrendItem[] = [];
        if (currentTrends.length > 0) {
          // 已有数据
          if (trendDates.length > 1 && currentTrendDate != trendDates[trendDates.length - 1]) {
            // 正在展示历史数据
            return;
          }
          // 新数据，找重叠点拼接
          let found = false;
          for (let i = 0; i < currentTrends.length; i++) {
            if (currentTrends[i].datetime == trendd[0].datetime) {
              trends = currentTrends.slice(0, i).concat(trendd);
              found = true;
              break;
            }
          }
          if (!found) {
            const lastExistingTime = currentTrends[currentTrends.length - 1]?.datetime || '';
            const lastNewTime = trendd[trendd.length - 1]?.datetime || '';
            const existingDay = lastExistingTime.substring(0, 10);
            const newDay = (trendd[0]?.datetime || '').substring(0, 10);
            if (existingDay && newDay && existingDay !== newDay) {
              // 跨交易日：直接以新一天的分时替换，避免把上一交易日（如节前）的分时也画进来
              trends = trendd;
            } else if (lastExistingTime && lastNewTime && lastNewTime <= lastExistingTime) {
              // 新数据的时间范围不超出已有数据，无需更新
              return;
            } else {
              trends = currentTrends.concat(trendd);
            }
          }
        } else {
          trends = trendd;
        }

        const newTrendData = {
          trends,
        };
        batch(() => {
          setTrendData(newTrendData);
          if (trendDates.length == 0 && trends.length > 0) {
            let td = dayjs().format('YYYY-MM-DD');
            if (trends[0].datetime.length >= 10) {
              td = trends[0].datetime.substring(0, 10);
            } 
            setCurrentTrendDate(td);
            setTrendDates([td]);
          }
          updateTrendsOption(newTrendData);
        });

        if (updateTrendData) {
          updateTrendData(trends);
        }

        // 同步更新日线K线：交易日的任意非交易时段（午休、收盘后）也用分时补/更新当日K线
        // 训练模式下不能拿训练日的分时去合成「真实今天」的K线（训练日当日K由训练时钟重建）
        if (!trainActive && canBuildTodayKFromTrends()) {
          const dayIndex = DefaultKTypes.indexOf(KLineType.Day);
          const currentDayKlines = klineDataRef.current.klines[dayIndex];
          if (currentDayKlines && currentDayKlines.length > 0) {
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const lastDayK = currentDayKlines[currentDayKlines.length - 1];
            if (lastDayK.date === todayStr) {
              // 检查原本K线是否来自真实数据（非分时合成）：hsl > 0 表示是API返回的真实K线
              // 分时合成的日K线 hsl 始终为 0，需要持续用最新分时更新
              if (lastDayK.kp && lastDayK.sp && lastDayK.zg && lastDayK.zd && lastDayK.hsl > 0) {
                // 已有来自API的完整K线数据，不需要从分时重新生成
                return;
              }
              // 日K线有今日日期但来自分时合成或数据不完整，用最新分时更新它
              const zsValue = currentDayKlines.length > 1 ? currentDayKlines[currentDayKlines.length - 2].sp : (trends[0]?.last || 0);
              const dailyK = buildDailyKFromTrends(trends, secid, zsValue);
              if (dailyK) {
                const newDayKlines = [...currentDayKlines];
                newDayKlines[newDayKlines.length - 1] = dailyK;
                handeKline({ ks: newDayKlines, kt: KLineType.Day });
              }
            } else {
              // 日K线缺少今日数据（先加载了K线，后加载分时），附加合成今日K线
              const zsValue = lastDayK?.sp || (trends[0]?.last || 0);
              const dailyK = buildDailyKFromTrends(trends, secid, zsValue);
              if (dailyK) {
                const newDayKlines = [...currentDayKlines, dailyK];
                handeKline({ ks: newDayKlines, kt: KLineType.Day });
              }
            }
          }
        }
      },
      {
        wait: 500,
      }
    );

    const [requestTrends, setRequestTrends] = useState(false);
    const [requestKLines, setRequestKLines] = useState(DefaultKTypes.map(() => false));
    const { run: updateTrendsOption } = useThrottleFn(
      (data: any, viewDate?: string) => {
        // 需要更新zs（训练模式用当日分时自带的昨收，避免用未来数据的昨收）
        // viewDate：正在展示的历史交易日（异步回调里 state 可能还没更新，由调用方显式传入）
        const date = viewDate || currentTrendDate;
        let tzs = calcTrendZs(data.trends || []);
        if (trendDates.length > 1 && date != trendDates[trendDates.length - 1]) {
          // 展示历史交易日时，昨收取该交易日前一根日K的收盘价
          const idx = trendDates.indexOf(date);
          const prevK = idx > 0 ? klineData.klines[DefaultKTypes.indexOf(KLineType.Day)][idx - 1] : undefined;
          if (prevK) tzs = prevK.sp;
        }
        if (chartOptions[0]) {
          updateTrendChart(chartOptions[0], darkMode, data.trends, tzs, config?.markLines);
        } else {
          chartOptions[0] = setupTrendChart(darkMode, data.trends || [], tzs, config?.markLines);
        }
        setChartOptions({
          ...chartOptions,
        });
      },
      {
        wait: 500,
      }
    );
    const { run: runGetTrends } = useRequest(Services.Stock.GetTrendFromDataSource, {
      throwOnError: true,
      manual: true,
      onSuccess: (data) => {
        const trends = data.trends || [];
        handleTrends(trends);
        setRequestTrends(false);
      },
      cacheKey: `GetStockTrendsAndFlows/${secid}${trainCacheSuffix}`,
    });
    const [bankuais, setBankuais] = useState<Stock.BanKuai[]>([]);
    const [currentBK, setCurrentBK] = useState<string | null>(null);
    const { run: runGetBankuais } = useRequest(Services.Stock.GetStockBankuaisFromEastmoney, {
      throwOnError: true,
      manual: true,
      defaultParams: [secid],
      onSuccess: setBankuais,
      cacheKey: `GetStockBankuaisFromEastmoney/${secid}`,
    });
    useEffect(() => {
      if (!trendData.trends.length) {
        // 训练模式的分时来自训练日历史分时（runGetTrainTrends），这里不再请求实时分时：
        // 实时分时整日都会返回，绕开训练时钟就等于提前看到未来
        if (!backtestDate && !trainActive && !requestTrends) {
          setRequestTrends(true);
          runGetTrends(kLineApiSourceSetting, secid);
        }
        // if (!useSina) {
          runGetBankuais(secid);
        // }
      }
      if (!backtestDate && active && Utils.JudgeWorkDayTime(new Date().getTime())) {
        const es = Helpers.Stock.SingleStockTrendPush(secid, (data) => {
          if (!data.length) {
            return;
          }
          // 使用 ref 避免闭包过期: useEffect 依赖 [active]，回调中 trendData 始终为初始空值
          const currentTrends = trendDataRef.current.trends;
          // 如果数据一致无需更新
          if (currentTrends.length) {
            const lastTick = currentTrends.slice(-1)[0].datetime;
            if (lastTick === data.slice(-1)[0].datetime) {
              return;
            }
          }
          if (trendDates.length <= 1 || currentTrendDate == trendDates[trendDates.length - 1]) {
            handleTrends(data);
          }
        });
        return () => {
          es.close();
        };
      }
    }, [active]);

    const [cmTop, setCMTop] = useState('70%');
    const [range, setRange] = useState({
      start: 50,
      end: 100,
    });
    const [maPeriodType, setMAPeriodType] = useState(MAPeriodType.Medium);
    const [techType, setTechType] = useState(TechIndicatorType.RSI);
    const [fractal, setFractal] = useState(false);
    const [klineData, setKLineData] = useState(() => {
      const klines = DefaultKTypes.map((_) => [] as Stock.KLineItem[]);
      // 默认展示日K（训练 / 回测模式）时，直接用打开股票时后台预取好的日K，
      // 挂载即可画图，不用再等一次取数往返。
      const dayIndex = DefaultKTypes.indexOf(KLineType.Day);
      if (typeIndex === dayIndex) {
        const preloaded = getPreloadedDailyKline(secid);
        if (preloaded && preloaded.length) {
          klines[dayIndex] = preloaded;
        }
      }
      return {
        count: DefaultKTypes.map((_) => 250),
        bkklines: {},
        klines,
        chans: DefaultKTypes.map((_) => [] as Stock.ChanItem[]),
        clines: DefaultKTypes.map((_) => [] as Stock.ChanStokeItem[]),
        shortMAS: DefaultKTypes.map((_) => DefaultMATypes.map((_) => [] as number[])),
        mediumMAS: DefaultKTypes.map((_) => DefaultMATypes.map((_) => [] as number[])),
        longMAS: DefaultKTypes.map((_) => DefaultMATypes.map((_) => [] as number[])),
        jax: DefaultKTypes.map((_) => [[], []]),
        dgwy: DefaultKTypes.map((_) => [[], [], []]),
        choumas: DefaultKTypes.map((_) => [] as Stock.ChouMaItem[]),
      };
    });
    // 使用 ref 保存最新的 klineData，避免 useThrottleFn 闭包过期问题
    const klineDataRef = useRef(klineData);
    klineDataRef.current = klineData;
    // [新增] 根据回测日期计算应该展示到哪一个交易日（前一个交易日）
    const dayKlines = klineData.klines[DefaultKTypes.indexOf(KLineType.Day)];
    // 训练模式：显示层再兜底截断一次，避免上层缓存/已加载数据中残留训练日期之后的K线
    //（忽略训练时不截断，直接展示到真实最新）
    const effectiveToDate = trainView ? toDate || trainDate || undefined : toDate;
    const displayToDate = useMemo(
      () => calcDisplayToDate(trainView, effectiveToDate, backtestDate, dayKlines),
      [trainView, effectiveToDate, backtestDate, dayKlines]
    );
    // 图表实际展示的K线（训练/回测模式下按截止日期截断），供图上的「最新」等信息使用
    const displayKlines = useMemo(
      () => filterKlinesByToDate(klineData.klines[typeIndex], displayToDate) || [],
      [klineData.klines, typeIndex, displayToDate]
    );
    /**
     * 短线评分曲线覆盖天数：跟随 K 线长度（不再固定最近 120 个交易日）
     *
     * 用「日K展示根数」而不是当前周期根数：评分本身是日频的，切到周/月线时若按
     * 250 根周K 换算成 1200 个交易日，逐日现算会明显变慢。
     */
    const shortScoreCurveDays = useMemo(() => {
      const dayIdx = DefaultKTypes.indexOf(KLineType.Day);
      const all = klineData.klines[dayIdx] || [];
      // 按展示区间截断后的根数；训练/回测日期把区间切空时退回全量日K根数，
      // 不要退回固定 120（那会让「按 K 线长度算」失效）
      const shown = (filterKlinesByToDate(all, displayToDate) || []).length;
      return Math.max(20, shown || all.length || SHORT_SCORE_CURVE_MAX_DAYS);
    }, [klineData.klines, klineData.klines[DefaultKTypes.indexOf(KLineType.Day)]?.length, displayToDate]);
    /** 训练日「昨收」兜底：图表展示到的最后一个交易日的前一交易日收盘价（日K补齐前先用它） */
    const trendZsFromKlines = useMemo(() => {
      const ks = filterKlinesByToDate(dayKlines, displayToDate) || [];
      if (!ks.length) {
        return zs;
      }
      const bar = ks[ks.length - 1];
      const prev = ks.length > 1 ? ks[ks.length - 2] : undefined;
      const value = Number(bar.zs || (prev ? prev.sp : 0));
      return value > 0 ? value : zs;
    }, [dayKlines, displayToDate, zs]);
    /**
     * 分时图的「昨收」基准。
     *
     * 训练模式下不能直接用详情里的 zs：那是真实最新交易的昨收（属于未来数据），
     * 会让分时图的涨跌幅、涨跌配色、昨收基准线全部错位。
     * 优先取分时数据自带的昨收（首根的 last，与分时价格同口径——后端已统一换算成
     * 与日K一致的前复权价），取不到时退回日K推算值。
     */
    const calcTrendZs = (trends: Stock.TrendItem[]) => {
      if (!trainView) {
        return zs;
      }
      const first = trends && trends[0];
      const base = first ? Number(first.last) : 0;
      return base > 0 ? base : trendZsFromKlines;
    };
    const trendZs = calcTrendZs(trendData.trends);
    // 昨收基准变化（训练日切换 / 日K补齐）后重画分时图：涨跌幅、涨跌配色、昨收基准线都依赖它
    useEffect(() => {
      const trends = trendDataRef.current.trends;
      if (!trends.length) {
        return;
      }
      updateTrendsOption({ trends });
    }, [trendZs]);
    const [linePoints, setLinePoints] = useState([] as { x: any; y: any }[]);
    const { run: runCalculateTech } = useRequest((ks: Stock.KLineItem[], kIndex:number, tt:TechIndicatorType) => makeWorkerExec('calculateIndicators', [ks, tt, kIndex,]), {
      throwOnError: true,
      manual: true,
      onSuccess: (data) => {
        const {names, values, techType, opaque} = data;
        // 短线评分指标的数据要现取数计算（见下方 SHORT_SCORE 的 effect），
        // 同步指标函数只返回空序列：这里不能覆盖图表上的技术指标序列。
        if (techType === TechIndicatorType.SHORT_SCORE) {
          return;
        }
        const opts = chartOptions[opaque][0];
        const techSeries = getTechSeriesWithResult(opts.techType, values, names);
        opts.series = opts.series.filter((_:any) => _.stype !== 'tech');
        opts.series.push(...techSeries);
        setChartOptions({
          ...chartOptions,
        });
      },
    });
    const { run: handeKline, flush: flushHandeKline } = useThrottleFn(
      ({ ks, kt }) => {
        if (!ks?.length) {
          console.error('handeKline, ks is undefined');
          return;
        }
        // 训练模式：训练日当天的日K按共享训练时刻重建
        // - 未开始推进（09:30 及之前）：当天日K整体不展示（数据源给的是收盘价，属于未来数据）
        // - 推进中：用「截至当前时刻」的分时合成当日K
        // - 走到收盘（15:00）：不再重建，直接用真实日K
        if (trainActive && trainDate && kt == KLineType.Day) {
          const cut = trainTrendsCutRef.current;
          const lastK = ks[ks.length - 1];
          const trainDayStr = String(trainDate).substring(0, 10);
          const isTrainDayBar = !!lastK && String(lastK.date || '').substring(0, 10) === trainDayStr;
          if (!trainClockStarted) {
            if (isTrainDayBar) {
              // 记住真实日K：推进后再放回/按分时重建
              if (!trainDayBarRef.current) {
                trainDayBarRef.current = { ...lastK };
              }
              ks = ks.slice(0, -1);
            }
          } else if (trainClock < TrainFilter.TRAIN_CLOCK_CLOSE && isTrainDayBar) {
            if (cut.length) {
              const zsValue = ks.length > 1 ? ks[ks.length - 2].sp : cut[0].last || cut[0].current || 0;
              const dailyK = buildDailyKFromTrends(cut, secid, zsValue, trainDayStr);
              if (dailyK) {
                ks = [...ks.slice(0, -1), dailyK];
              }
            } else {
              // 已开始推进但训练日分时还没到：先不展示当天日K（收盘价仍属未来数据），等分时到达再合成
              if (!trainDayBarRef.current) {
                trainDayBarRef.current = { ...lastK };
              }
              ks = ks.slice(0, -1);
            }
          }
          if (!ks.length) {
            // 极端情况（只有训练日一根K）：藏起来后没有可画的K线，别把请求中的标记留着
            const resetRequestKLines = [...requestKLines];
            resetRequestKLines[DefaultKTypes.indexOf(kt)] = false;
            setRequestKLines(resetRequestKLines);
            return;
          }
        }
        // 交易日的任意非交易时段（午休、收盘后）也可用分时补当日K；非交易日则不用分时填K
        // 训练模式下训练日的分时只用于重建训练日当日K，不能拼出「真实今天」的K线
        if (!trainActive && canBuildTodayKFromTrends()) {
          const latestTrends = trendDataRef.current.trends;
          if (kt == KLineType.Day) {
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const lastK = ks[ks.length - 1];
            if (lastK?.date !== todayStr) {
              // K线中不包含今日数据
              if (latestTrends.length > 0) {
                // 已有分时数据，直接从分时合成
                const zsValue = lastK?.sp || latestTrends[0].last || 0;
                const dailyK = buildDailyKFromTrends(latestTrends, secid, zsValue);
                if (dailyK) {
                  ks = [...ks, dailyK];
                }
              } else {
                // 无分时数据，自动触发分时请求，请求成功后再合成今日K线
                if (!requestTrends) {
                  setRequestTrends(true);
                  runGetTrends(kLineApiSourceSetting, secid);
                }
              }
            } else if (!lastK.kp || !lastK.sp || !lastK.zg || !lastK.zd || lastK.hsl === 0) {
              // K线有今日日期但数据不完整或是分时合成的（hsl=0），用分时数据补充/更新
              if (latestTrends.length > 0) {
                const zsValue = ks.length > 1 ? ks[ks.length - 2].sp : (latestTrends[0]?.last || 0);
                const dailyK = buildDailyKFromTrends(latestTrends, secid, zsValue);
                if (dailyK) {
                  ks[ks.length - 1] = dailyK;
                }
              } else {
                // 无分时数据，自动触发分时请求
                if (!requestTrends) {
                  setRequestTrends(true);
                  runGetTrends(kLineApiSourceSetting, secid);
                }
              }
            }
            // 如果已有完整的今日K线数据（来自API，hsl>0），不做任何处理
          }
        }
        // 更新k线描述信息
        Helpers.Tech.DescribeKlines(ks);
        Helpers.Tech.DetermineKlines(ks);
        // 更新k线标注
        if (kt == KLineType.Day && config && config.knotes && config.knotes.length > 0) {
          // 更新标注信息
          ks.forEach((k: Stock.KLineItem) => {
            const mathNotes = config.knotes!.filter((kn) => kn.startDate <= k.date && kn.endDate >= k.date);
            k.notes = mathNotes.map((_) => _.text);
          });
        }
        // 准备数据
        const sps = ks.map((_: { sp: any; }) => _.sp);
        const { chansData, chansStokes } = Helpers.Stock.ComputeChans(ks);
        const dates = ks.map((_: { date: any; }) => _.date);
        let currentCMDate = cmDateRef.current?.state.value;
        if (!currentCMDate || !dates.find((_: any) => _ === currentCMDate)) {
          currentCMDate = dates[dates.length - 1];
          cmDateRef.current?.setValue(currentCMDate);
        }
        const index = currentCMDate.length ? dates.indexOf(currentCMDate) : ks.length - 1;
        // const choumas = [Helpers.Stock.ComputeChouMa(ks.slice(0, index + 1)), Helpers.Stock.ComputeChouMa(chansData.slice(0, index + 1))];
        const kIndex = DefaultKTypes.indexOf(kt);
        batch(() => {
          const newKlineData = {
            ...klineData,
            klines: {
              ...klineData.klines,
              [kIndex]: ks,
            },
            chans: {
              ...klineData.chans,
              [kIndex]: chansData,
            },
            clines: {
              ...klineData.clines,
              [kIndex]: chansStokes,
            },
            // choumas: {
            //   ...klineData.choumas,
            //   [kIndex]: choumas,
            // },
          };
          batch(() => {
            setKLineData(newKlineData);
            if (kt == KLineType.Day) {
              setTrendDates(ks.map((_: { date: any; }) => _.date));
              // 只有日K回写到详情页：训练时钟重建的当日K必须带上，其它周期不能覆盖它
              updateKLineData?.(ks);
            }
            updateKLineOption(kIndex, newKlineData);
            // 立即执行被节流窗口挂起的图表更新：多周期同时返回时，
            // 否则只有最后一次会落到图表上（训练模式下表现为「推进一天后日K不刷新」）
            flushKLineOption();
          });
        });
        const resetRequestKLines = [...requestKLines];
        resetRequestKLines[kIndex] = false;
        setRequestKLines(resetRequestKLines);
      },
      {
        wait: 500,
      }
    );

    const { run: updateKLineOption, flush: flushKLineOption } = useThrottleFn(
      (kIndex: number, data: any) => {
        const dayIndex = DefaultKTypes.indexOf(KLineType.Day);
        const _displayToDate = calcDisplayToDate(trainView, effectiveToDate, backtestDate, data.klines[dayIndex]);
        let bkks = [];
        if (currentBK && data.bkklines[currentBK] && data.bkklines[currentBK][kIndex]) {
          bkks = data.bkklines[currentBK][kIndex];
        }
        // 分时图（索引 0）存的是分时图「对象」，只有 K 线图才是 [K线opts, 缠论opts] 数组
        if (Array.isArray(chartOptions[kIndex])) {
          updateKChart(chartOptions[kIndex][0], data.klines[kIndex], _displayToDate, bkks);
          updateCChart(chartOptions[kIndex][1], data.chans[kIndex], data.clines[kIndex]);
          runCalculateTech(filterKlinesByToDate(data.klines[kIndex], _displayToDate), kIndex, techType);
          // 🔧 关键修复：K线数据变了必须触发 React 重渲染，
          // 否则 useRenderEcharts 不会执行，markPoint 不会被重新附加
          setChartOptions({ ...chartOptions });
        } else {
          // const kcm = alignChouma(data.klines[typeIndex], data.choumas[typeIndex][0], outRange || range);
          chartOptions[kIndex] = [
            setupKlineChart(
              darkMode,
              maPeriodType,
              techType,
              outRange || range,
              null,
              data.klines[kIndex],
              linePoints,
              [],
              false,
              _displayToDate,
              bkks
            ),
            setupClineChart(
              darkMode, 
              maPeriodType, 
              techType, 
              outRange || range, 
              data.chans[kIndex], 
              data.clines[kIndex]
            ),
          ];
          setChartOptions({
            ...chartOptions,
          });
        }
      },
      {
        wait: 500,
      }
    );
    // K线取数：每次调用都是独立请求，不用 useRequest 的共享实例——
    // ahooks v2 的 useRequest 在同一实例上用自增 count 做时序保护，并发取多个周期时
    // 只有「最后发起」的那次会回调 onSuccess，先返回的周期数据会被静默丢弃
    // （训练模式推进一天会同时刷新日/周/月，日K因此永远刷不出来）
    const fetchKline = useCallback(
      async (source: FundApiType, sid: string, kt: KLineType, count?: number) => {
        const kIndex = DefaultKTypes.indexOf(kt);
        try {
          const r = await Services.Stock.GetKFromDataSource(source, sid, kt, count);
          if (r && r.ks && r.ks.length) {
            handeKline(r);
            // 立即执行被节流窗口挂起的调用，保证每个周期的返回都写进 klineData
            flushHandeKline();
          }
        } catch (error) {
          console.error('获取K线失败', error);
        } finally {
          if (kIndex >= 0) {
            // 无论成功失败都要复位，否则该周期后续再也不会重新取数
            setRequestKLines((prev) => {
              if (!prev[kIndex]) {
                return prev;
              }
              const next = [...prev];
              next[kIndex] = false;
              return next;
            });
          }
        }
      },
      [handeKline, flushHandeKline]
    );
    const changeTypeIndex = useCallback(
      (i) => {
        setTypeIndex(i);
        if (i === 0) {
          if (!trendData.trends.length) {
            if (!requestTrends) {
              setRequestTrends(true);
              runGetTrends(kLineApiSourceSetting, secid);
            }
          }
          // updateTrendsOption(trendData);
        } else {
          if (klineData.klines[i] && klineData.klines[i].length) {
            // updateKLineOption(klineData);
          } else {
            if (!requestKLines[i]) {
              const newRequestKLines = [...requestKLines];
              newRequestKLines[i] = true;
              setRequestKLines(newRequestKLines);
              fetchKline(kLineApiSourceSetting, secid, DefaultKTypes[i], klineData.count[i]);
            }
          }
          if (currentBK) {
            if (klineData.bkklines[currentBK] && klineData.bkklines[currentBK][i]?.length) {
              // updateKLineOption(klineData);
            } else {
              runGetBKKline(kLineApiSourceSetting, currentBK, DefaultKTypes[i], klineData.count[i]);
            }
          }
        }
        if (updateKType) {
          updateKType(DefaultKTypes[i]);
        }
      },
      [secid, trendData, klineData]
    );

    useEffect(() => {
      if (trainView) {
        // 训练模式默认展示日K线（分时是训练日当天的数据，需额外请求历史分时且信息量不如日K）
        // 注：这里不再预取 30 分钟K线——分钟级数据源已不可用，且它只服务于旧版模拟盘取价
        const dayIndex = DefaultKTypes.indexOf(KLineType.Day);
        if (typeIndex === 0 && dayIndex > 0) {
          changeTypeIndex(dayIndex);
        }
      }
    }, [trainView]);

    // 打开股票时后台预取的日K：默认展示日K（训练 / 回测模式）时，挂载即用预取数据画图。
    // 随后的正常取数流程仍会再跑一遍，保证数据是最新的；这里只是让首帧就有日K。
    const preloadAppliedRef = useRef(false);
    useEffect(() => {
      if (preloadAppliedRef.current) {
        return;
      }
      preloadAppliedRef.current = true;
      const dayIndex = DefaultKTypes.indexOf(KLineType.Day);
      const ks = klineDataRef.current.klines[dayIndex];
      if (!ks || !ks.length) {
        return;
      }
      handeKline({ ks, kt: KLineType.Day });
      flushHandeKline();
    }, [handeKline, flushHandeKline]);

    // 训练模式：分时图展示训练日期的历史分时（当日分时属于未来数据，已被数据层过滤掉）
    // 数据来源：Tushare 1 分钟线合成（requestHistTrends），不再依赖已下线的历史分时缓存源
    const { run: runGetTrainTrends } = useRequest(Services.Stock.requestHistTrends, {
      manual: true,
      onSuccess: (data: Stock.TrendItem[]) => {
        if (!data || !data.length) {
          return;
        }
        // 与历史分时保持一致：按分钟合并（1 分钟线本身就是每分钟一根，这里只是兼容更细的数据源）
        const processed = [] as Stock.TrendItem[];
        if (data.length === 1) {
          processed.push(data[0]);
        } else {
          let item = data[0];
          for (let i = 1; i < data.length; i++) {
            const pMin = item.datetime.substring(3, 5);
            const nMin = data[i].datetime.substring(3, 5);
            if (pMin == nMin) {
              data[i].vol += item.vol;
              data[i].last = item.last;
            } else {
              processed.push(item);
            }
            item = data[i];
            if (i == data.length - 1) {
              processed.push(data[i]);
            }
          }
        }
        processed.forEach((_) => {
          _.datetime = `${trainDate} ${_.datetime.substring(0, 5)}`;
        });
        // 只保存完整序列：上图 / 重建当日K 之前统一按共享训练时钟截断（见下方 effect），
        // 分钟级推进时只在本地重新过滤，不需要重复取数
        setTrainTrendsRaw(processed);
      },
      cacheKey: `requestHistTrends/train/${secid}/${trainDate || 'live'}`,
    });

    // 训练时钟推进 / 训练日分时到达：按时刻截断后同步到分时图与详情页
    //（分时图的昨收基准——涨跌幅 / 涨跌配色 / 昨收线——从首根的 last 取）
    useEffect(() => {
      if (!trainActive || !trainDate) {
        return;
      }
      if (!trainTrendsCut.length) {
        // 未开始推进 / 该训练日没有分时：分时图留空，
        // 既不展示整日分时，也不残留上一交易日或上一只股票的数据
        setTrendData({ trends: [] });
        updateTrendsOption({ trends: [] });
        if (updateTrendData) {
          updateTrendData([]);
        }
        return;
      }
      setTrendData({ trends: trainTrendsCut });
      updateTrendsOption({ trends: trainTrendsCut });
      if (updateTrendData) {
        updateTrendData(trainTrendsCut);
      }
    }, [trainTrendsCut, trainClockStarted, trainActive, trainDate]);

    // 训练日切换 / 退出训练 / 忽略训练：清空上一训练日的分时（真实日K的还原见下一个 effect）
    useEffect(() => {
      setTrainTrendsRaw([]);
    }, [trainDate, ontrain, ignoreTrain]);

    /**
     * 训练时钟推进后重建训练日当日K
     *
     * - 未开始推进（09:30 及之前）：训练日当天的日K直接不展示；
     * - 推进中：训练日收盘价属于未来数据，用「截至当前时刻」的分时合成当日K；
     * - 走到收盘（15:00）/ 关闭训练：用真实日K还原。
     */
    useEffect(() => {
      const dayIndex = DefaultKTypes.indexOf(KLineType.Day);
      const ks = klineDataRef.current.klines[dayIndex];
      if (!ks || !ks.length) {
        return;
      }
      const last = ks[ks.length - 1];
      const lastDay = String(last?.date || '').substring(0, 10);
      const trainDayStr = trainDate ? String(trainDate).substring(0, 10) : '';
      const closed = !trainClock || trainClock >= TrainFilter.TRAIN_CLOCK_CLOSE;
      const origin = trainDayBarRef.current;
      const originDay = origin ? String(origin.date).substring(0, 10) : '';

      // A. 当天日K曾被藏起来（记住的 origin 是训练日的，但图上最后一根不是）：按当前时刻决定是否放回
      if (trainActive && originDay && originDay === trainDayStr && lastDay !== trainDayStr) {
        if (closed || (trainClockStarted && trainTrendsCut.length)) {
          handeKline({ ks: [...ks, origin], kt: KLineType.Day });
          flushHandeKline();
          if (closed) {
            trainDayBarRef.current = null;
          }
        }
        return;
      }

      // B. 未开始推进：当天日K整体隐藏（含数据源已给出的真实收盘K）
      if (trainActive && !trainClockStarted) {
        if (lastDay === trainDayStr && ks.length > 1) {
          if (!trainDayBarRef.current) {
            trainDayBarRef.current = { ...last };
          }
          handeKline({ ks: ks.slice(0, -1), kt: KLineType.Day });
          flushHandeKline();
        }
        return;
      }

      // C. 收盘 / 图上最后一根不是训练日：用真实日K还原
      if (closed || lastDay !== trainDayStr) {
        if (!origin) {
          return;
        }
        if (lastDay === originDay && last.sp !== origin.sp) {
          handeKline({ ks: [...ks.slice(0, -1), origin], kt: KLineType.Day });
          flushHandeKline();
        }
        trainDayBarRef.current = null;
        return;
      }

      // D. 推进中：记住真实日K，再按当前时刻用分时重建
      if (!trainTrendsCut.length) {
        return;
      }
      if (!trainDayBarRef.current || originDay !== lastDay) {
        trainDayBarRef.current = { ...last };
      }
      handeKline({ ks, kt: KLineType.Day });
      flushHandeKline();
    }, [trainClock, trainClockStarted, trainActive, trainTrendsCut, trainDate, handeKline, flushHandeKline]);

    // 训练模式：进入训练 / 训练日期推进 / 「忽略训练」开关切换后重新取数
    // 数据层已按当前训练日期截断（忽略训练时按真实最新取），只有重新请求才能换掉本地已加载的数据
    const trainRefreshRef = useRef({ mode: false, date: '', ignore: false });
    useEffect(() => {
      const on = trainActive && !!trainDate;
      const prev = trainRefreshRef.current;
      const needRefresh = prev.mode !== on || prev.ignore !== ignoreTrain || (on && prev.date !== trainDate);
      trainRefreshRef.current = { mode: on, date: trainDate || '', ignore: ignoreTrain };
      if (!needRefresh) {
        return;
      }
      // 不再刷新 30 分钟K线：分钟级数据源已不可用，且旧版模拟盘取价已改为日收盘价
      const refreshTypes = [KLineType.Day, KLineType.Week, KLineType.Month];
      if (typeIndex > 0) {
        refreshTypes.push(DefaultKTypes[typeIndex]);
      }
      Array.from(new Set(refreshTypes)).forEach((t) => {
        const i = DefaultKTypes.indexOf(t);
        if (i < 0) {
          return;
        }
        fetchKline(kLineApiSourceSetting, secid, t, klineData.count[i]);
      });
      // 无论当前是否停在分时图，训练日都要取一次历史分时：日K也要按训练时钟重建
      if (on) {
        runGetTrainTrends(secid, (trainDate as string).replace(/-/g, ''));
      }
    }, [trainActive, trainDate, ignoreTrain]);

    // 训练模式：加载训练日期的历史分时（切到分时图时同样复用）；「忽略训练」时改为真实当日分时
    useEffect(() => {
      if (trainActive && trainDate) {
        runGetTrainTrends(secid, trainDate.replace(/-/g, ''));
        return;
      }
      if (typeIndex !== 0) {
        return;
      }
      if (ignoreTrain && !requestTrends) {
        setRequestTrends(true);
        runGetTrends(kLineApiSourceSetting, secid);
      }
    }, [typeIndex, trainActive, ignoreTrain]);

    useEffect(() => {
      // [回测] 需要日线数据来计算 displayToDate（回测日期的前一个交易日）
      if (backtestDate) {
        const dayIndex = DefaultKTypes.indexOf(KLineType.Day);
        if (!requestKLines[dayIndex] && !klineData.klines[dayIndex].length) {
          const newRequestKLines = [...requestKLines];
          newRequestKLines[dayIndex] = true;
          setRequestKLines(newRequestKLines);
          fetchKline(kLineApiSourceSetting, secid, KLineType.Day, klineData.count[dayIndex]);
        }
      }
    }, [backtestDate]);

    useEffect(() => {
      // [回测] 从非回测切换到回测时，自动切到日K线
      if (backtestDate && typeIndex === 0) {
        setTypeIndex(DefaultKTypes.indexOf(KLineType.Day));
      }
    }, [backtestDate]);

    // 定时更新
    // useInterval(
    //   () => {
    //     if (!Utils.JudgeWorkDayTime(new Date().getTime())) {
    //       // 非交易时间
    //       return;
    //     }
    //     if (typeIndex === 0) {
    //       if (!requestTrends) {
    //         setRequestTrends(true);
    //         runGetTrends(kLineApiSourceSetting, secid);
    //       }
          
    //     } else {
    //       if (!requestKLines) {
    //         setRequestKLines(true);
    //         runGetKline(kLineApiSourceSetting, secid, DefaultKTypes[typeIndex], klineData.count[typeIndex]);
    //       }
    //     }
    //   },
    //   active ? CONST.DEFAULT.STOCK_TREND_DELAY : null
    // );
    const stype = Helpers.Stock.GetStockType(secid);
    const isUSStock = stype === StockMarketType.US || stype === StockMarketType.USZindex;
    // 交易时段自动刷新分时数据（K线不需要刷新，由分时数据合成）
    const trendRefreshCallback = useCallback(() => {
      if (!requestTrends) {
        setRequestTrends(true);
        runGetTrends(kLineApiSourceSetting, secid);
      }
    }, [requestTrends, kLineApiSourceSetting, secid, runGetTrends]);
    
    // 两个 Hook 都调用，但根据股票类型只启用其中一个
    useWorkDayTimeToDo(isUSStock ? () => {} : trendRefreshCallback, isUSStock ? null : CONST.DEFAULT.STOCK_TREND_DELAY);
    useUSWorkDayTimeToDo(isUSStock ? trendRefreshCallback : () => {}, isUSStock ? CONST.DEFAULT.STOCK_TREND_DELAY : null);

    const [lineEnabled, setLineEnabled] = useState(false);
    const changeLineEnabled = useCallback(
      (on) => {
        const points = on ? linePoints : [];
        updateKMarkLines(chartOptions[typeIndex][0], points);
        batch(() => {
          setLineEnabled(on);
          setChartOptions({
            ...chartOptions,
          });
        });
      },
      [linePoints, typeIndex, chartOptions]
    );
    const onMouseClick = useCallback(
      (e: any) => {
        if (!lineEnabled) {
          return;
        }
        if (e.seriesName == 'K线') {
          if (linePoints.length && linePoints[linePoints.length - 1].x > e.name) {
            return;
          }
          let data: any;
          if (linePoints.find((_) => _.x == e.name)) {
            data = linePoints.filter((p) => p.x != e.name);
          } else {
            const lastp = linePoints.length ? linePoints[linePoints.length - 1] : null;
            const p = {
              x: e.name,
              y: (e.data[3] + e.data[4]) / 2,
            };
            data = linePoints.concat([p]);
          }
          updateKMarkLines(chartOptions[typeIndex][0], data);
          batch(() => {
            setLinePoints(data);
            setChartOptions({
              ...chartOptions,
            });
          });
        }
      },
      [lineEnabled, linePoints, chartOptions, typeIndex]
    );
    const [selectedArea, setSelectedArea] = useState<Stock.KLineAreaItem | null>(null);
    const onBrushEnd = useCallback(
      (e: any) => {
        if (e.areas) {
          if (!e.areas.length) {
            setSelectedArea(null);
          } else {
            const rs = e.areas[0].coordRange;
            const ks = klineData.klines[typeIndex].slice(rs[0], rs[1] + 1);
            const ds = [ks[0].date, ks[ks.length - 1].date];
            if (selectedArea && selectedArea.start == ds[0] && selectedArea.start == ds[1]) {
              // 重复回调
              return;
            } else {
              const sa = {
                start: ds[0],
                end: ds[1],
                kp: ks[0].kp,
                sp: ks[ks.length - 1].sp,
                zdf: (ks[ks.length - 1].sp - ks[0].kp) / ks[0].kp,
                days: ks.length,
                zghsl: Math.max(...ks.map((k) => k.hsl)),
                zdhsl: Math.min(...ks.map((k) => k.hsl)),
                zhhsl: ks.reduce((s, k) => s + k.hsl, 0),
                avghsl: ks.reduce((s, a) => s + a.hsl, 0) / ks.length,
                avgcost:
                  ks.map((k) => ((2 * k.sp + k.zg + k.zd) / 4) * k.cjl).reduce((s, a) => s + a, 0) / ks.reduce((s, k) => s + k.cjl, 0),
              } as Stock.KLineAreaItem;
              setSelectedArea(sa);
              if (onSelectedAreaUpdated) {
                onSelectedAreaUpdated({ start: sa.start, end: sa.end });
              }
            }
          }
        }
      },
      [typeIndex, klineData, selectedArea]
    );
    const onBrushSelected = useCallback(
      (e: any) => {
        const m = e.batch[0];
        if (m && (!m.areas || !m.areas.length) && selectedArea) {
          setSelectedArea(null);
          if (onSelectedAreaUpdated) {
            onSelectedAreaUpdated(null);
          }
        }
      },
      [selectedArea]
    );
    const { ref: chartRef, chartInstance } = useResizeEchart(
      -1,
      (e: any) => {
        const m = e.batch[0];
        setRange({
          start: m.start,
          end: m.end,
        });
      },
      onMouseClick,
      onBrushEnd,
      onBrushSelected
    );
    const cmDateRef = useRef<Input>(null);
    const onCMDateChange = (value: string) => {
      const prevcms = klineData.choumas[typeIndex];
      const ks = klineData.klines[typeIndex];
      let dates = ks.map((k) => k.date);
      let endIndex = dates.indexOf(value);
      if (endIndex != -1) {
        prevcms[0] = Helpers.Stock.ComputeChouMa(ks.slice(0, endIndex + 1));
      }
      const cs = klineData.chans[typeIndex];
      dates = cs.map((k) => k.date);
      endIndex = dates.indexOf(value);
      if (endIndex != -1) {
        prevcms[1] = Helpers.Stock.ComputeChouMa(cs.slice(0, endIndex + 1));
      }
      // 更新筹码
      setKLineData({
        ...klineData,
      });
      // 更新Options
      const zx = ks.slice(-1)[0].sp;
      chartOptions[typeIndex].forEach((opt: any, i: number) => {
        updateCKChart(opt, darkMode, outRange || range, zx, false, prevcms[i]);
      });
      setChartOptions({
        ...chartOptions,
      });
    };
    const onPrevCMDate = (step = 1) => {
      const current = cmDateRef.current!.state.value;
      const dates = klineData.klines[typeIndex].map((k) => k.date);
      let currentIndex = dates.indexOf(current);
      currentIndex -= step;
      if (currentIndex < 1) {
        currentIndex = 1;
      }
      cmDateRef.current?.setValue(dates[currentIndex]);
      onCMDateChange(dates[currentIndex]);
    };
    const onNextCMDate = (step = 1) => {
      const current = cmDateRef.current!.state.value;
      const dates = klineData.klines[typeIndex].map((k) => k.date);
      if (step == -1) {
        cmDateRef.current?.setValue(dates[dates.length - 1]);
        onCMDateChange(dates[dates.length - 1]);
        return;
      }
      let currentIndex = dates.indexOf(current);
      currentIndex += step;
      if (currentIndex >= dates.length) {
        currentIndex = dates.length - 1;
      }
      cmDateRef.current?.setValue(dates[currentIndex]);
      onCMDateChange(dates[currentIndex]);
    };

    const onTechIndicatorTypeChange = useCallback((value: TechIndicatorType) => {
      if (chartOptions[typeIndex]) {
        chartOptions[typeIndex][0].techType = value;
        // 短线评分的红绿柱占用了技术指标区的右侧隐藏轴（yAxis 4），并把它固定成 [0, maxAbs]：
        // 切到别的指标时要还原自适应，否则 ADV 的 DI+/DI- 等会沿用被压扁的固定刻度。
        const techAxis = chartOptions[typeIndex][0].yAxis?.[4];
        if (techAxis) {
          delete techAxis.min;
          delete techAxis.max;
          techAxis.scale = true;
        }
        if (value === TechIndicatorType.SHORT_SCORE) {
          // 短线评分曲线要现取数逐日计算（见下方 effect）：
          // 先把旧指标序列清掉，避免算完之前还显示上一个指标的线；worker 侧对该指标只返回空序列
          chartOptions[typeIndex][0].series = (chartOptions[typeIndex][0].series || []).filter(
            (_: any) => _.stype !== 'tech'
          );
          setChartOptions({ ...chartOptions });
        } else {
          const ks = filterKlinesByToDate(klineData.klines[typeIndex], displayToDate);
          runCalculateTech(ks, typeIndex, value);
        }
        setTechType(value);
      }
    }, [typeIndex, chartOptions, displayToDate, klineData]);

    /**
     * 技术指标「短线评分」曲线：现取数逐日重算（不读评分缓存），算完写入技术指标序列
     *
     * 与其它指标不同，它的数据不能同步算出来（要取日K/板块/资金/涨跌比/市值档），
     * 所以单独异步计算；不跟随 K 线定时刷新（分数本身只在收盘后才有意义）。
     */
    const [shortScoreCurveLoading, setShortScoreCurveLoading] = useState(false);
    /** 本次评分曲线实际覆盖的交易日数（0=还在等 K 线，用于 loading 文案） */
    const [shortScoreCurveDaysUsed, setShortScoreCurveDaysUsed] = useState(0);
    /** 异步回调里要读最新的 chartOptions（状态对象会被原地修改，不能依赖闭包里的旧值） */
    const chartOptionsRef = useRef(chartOptions);
    chartOptionsRef.current = chartOptions;
    useEffect(() => {
      if (techType !== TechIndicatorType.SHORT_SCORE) {
        return () => {};
      }
      const code = String(secid).split('.').pop() || '';
      if (!/^\d{6}$/.test(code)) {
        return () => {};
      }
      let canceled = false;
      let retryTimer: any = null;

      /** 把算好的分数按图表 x 轴的交易日对齐后挂到技术指标序列 */
      const applyToChart = (scores: Record<string, number>, attempt: number) => {
        if (canceled) {
          return;
        }
        const target = chartOptionsRef.current[typeIndex]?.[0];
        // K线/图表还没就绪（切换周期的第一帧很常见）：稍后重试，否则曲线会丢
        if (!target) {
          if (attempt < 20) {
            retryTimer = setTimeout(() => applyToChart(scores, attempt + 1), 300);
          }
          return;
        }
        // 没有分数的交易日留空（曲线断开而不是连成直线）：
        // 日K按当日精确取分；周/月K取「该 bar 日期之前最后一个评分日」的分。
        const xs = ((target.xAxis?.[0]?.data || []) as string[]) || [];
        const isDaily = DefaultKTypes[typeIndex] === KLineType.Day;
        const scoreDays = Object.keys(scores).sort();
        /** 与 values 对齐：该 bar 用的评分日（买卖点标记按这一天去查信号） */
        const usedDays: string[] = [];
        const values = xs.map((x) => {
          const key = String(x || '').replace(/-/g, '').substring(0, 8);
          let day = '';
          if (isDaily) {
            day = scores[key] !== undefined ? key : '';
          } else {
            for (let i = scoreDays.length - 1; i >= 0; i -= 1) {
              if (scoreDays[i] <= key) {
                day = scoreDays[i];
                break;
              }
            }
          }
          usedDays.push(day);
          const v = day ? scores[day] : undefined;
          return typeof v === 'number' ? Number(v.toFixed(1)) : null;
        });
        // 逐日信号（买入 / 卖出 / 观察）：与列表「信号」列、回测同一套规则，
        // 卖点/买点当天的柱子换色标记，便于在指标区直接看到信号落在哪一根
        const signalMap = computeShortScoreSignalSeries({ scores, params: DEFAULT_SHORT_SCORE_SIGNAL_PARAMS });
        const signals: (ShortScoreSignal | null)[] = usedDays.map((d) => (d ? signalMap[d] || null : null));
        // ---- 突变识别：在「图上实际显示的逐点序列」上算单日变化 ----
        // 这样柱子一定落在看得见的点上（周/月K 的相邻 bar 就是相邻比较对象），
        // 且缺失日会断开比较，不会把跨多日的累计变化当成单日突变。
        const jumps = computeScoreJumps(values, xs);
        const jumpByIdx: Record<number, ScoreJumpPoint> = {};
        jumps.forEach((j) => {
          jumpByIdx[j.index] = j;
        });
        /** 逐日变化（正=跳升，负=跳降）；缺失日 / 首日 / 前一日无分数时为 null */
        const deltas = values.map((v, i) => {
          const prev = i > 0 ? values[i - 1] : null;
          if (typeof v !== 'number' || typeof prev !== 'number') {
            return null;
          }
          return Number((v - prev).toFixed(1));
        });
        // 曲线点带出变化信息（提示框展示变化值与突变程度），其余点保持纯数值
        const data = values.map((v, i) => {
          if (typeof v !== 'number') {
            return null;
          }
          const delta = deltas[i];
          const sig = signals[i];
          const sigKind = sig && sig.kind !== '观察' ? sig.kind : '';
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
        // ---- 突变用红绿柱表示：红=跳升、绿=跳降，柱越高变化越大 ----
        // 柱子挂在技术指标区的右侧隐藏轴上（yAxisIndex 4），0 基线落在区域底部，
        // 因此高度只表达「变化幅度」的相对大小，不与左侧评分刻度混用。
        const jumpUpColor = variableColors['--increase-color'] || '#f5222d';
        const jumpDownColor = variableColors['--reduce-color'] || '#52c41a';
        // 买卖点柱子至少要有这点高度，否则当日变化很小（或前一日没评分）时看不出标记
        const signalBarMinHeight = Math.max(
          0.5,
          deltas.reduce((m: number, d) => (typeof d === 'number' ? Math.max(m, Math.abs(d)) : m), 0) * 0.06
        );
        const deltaBars = deltas.map((delta, i) => {
          const isJump = !!jumpByIdx[i];
          const sigKind = signals[i]?.kind;
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
            // 买卖点当天的柱子换色标记（橙=买入、亮绿=卖出），描边让它在红绿柱里跳出来
            return { value: Math.max(Math.abs(delta), signalBarMinHeight), itemStyle: signalStyle };
          }
          return {
            value: Math.abs(delta),
            // 达到突变阈值的柱子加重显示，普通波动只作淡淡的背景
            itemStyle: { color: delta > 0 ? jumpUpColor : jumpDownColor, opacity: isJump ? 0.9 : 0.28 },
          };
        });
        const maxAbsDelta = deltas.reduce((m: number, d) => (typeof d === 'number' ? Math.max(m, Math.abs(d)) : m), 0);
        // ---- 自近 N 根低点抬升：单日柱看不出「低位横盘后启动」，这条线才是启动幅度 ----
        // 口径与买入规则一致：value = 当日评分 - 前 N 根内的最低分（恒 >= 0）
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
        const maxRise = riseData.reduce(
          (m: number, r) => (r && typeof r.value === 'number' ? Math.max(m, r.value) : m),
          0
        );
        // 最高柱/最高抬升约占技术指标区一半高度，给上方曲线留出可读空间
        const axisTop = Math.max(maxAbsDelta, maxRise);
        const deltaAxisMax = axisTop > 0 ? Number((axisTop * 1.9).toFixed(1)) : 1;
        const deltaAxis = target.yAxis?.[4];
        if (deltaAxis) {
          deltaAxis.min = 0;
          deltaAxis.max = deltaAxisMax;
          deltaAxis.scale = false;
        }
        target.series = (target.series || []).filter((_: any) => _.stype !== 'tech');
        // 柱子先入列（画在曲线下方），曲线后入列保证压在最上层
        target.series.push({
          name: '评分突变',
          type: 'bar',
          stype: 'tech',
          xAxisIndex: 2,
          yAxisIndex: 4,
          barWidth: '55%',
          silent: true,
          z: 1,
          data: deltaBars,
        });
        target.series.push({
          // 低位横盘后启动：柱高可能一直很小，但「自低点抬升」会持续走高，
          // 抬升到 SHORT_SCORE_RISE_THRESHOLD（20 分）就是买入规则里的启动阈值（rise 口径）
          name: '自低点抬升',
          type: 'line',
          stype: 'tech',
          xAxisIndex: 2,
          yAxisIndex: 4,
          symbol: 'none',
          z: 2,
          data: riseData,
          connectNulls: false,
          lineStyle: { color: variableColors['--link-color'] || '#1677ff', width: 1, type: 'dashed' },
          itemStyle: { color: variableColors['--link-color'] || '#1677ff' },
          markLine: {
            symbol: 'none',
            silent: true,
            label: { show: false },
            // 20 分是「自近 N 根低点抬升」的买入阈值（minRise），作为参考线
            data: [
              {
                yAxis: SHORT_SCORE_RISE_THRESHOLD,
                lineStyle: { color: variableColors['--hint-color'] || '#999', opacity: 0.5, type: 'dotted' },
              },
            ],
          },
        });
        target.series.push({
          name: TechIndicatorSeriesNames[TechIndicatorType.SHORT_SCORE][0],
          type: 'line',
          stype: 'tech',
          symbol: 'none',
          xAxisIndex: 2,
          yAxisIndex: 2,
          z: 3,
          data,
          connectNulls: false,
          lineStyle: { color: '#faad14', width: 1.2 },
          itemStyle: { color: '#faad14' },
          // 60 分是 B 级门槛，作为参考线
          markLine: {
            symbol: 'none',
            silent: true,
            label: { show: false },
            data: [{ yAxis: 60, lineStyle: { color: variableColors['--hint-color'] || '#999', opacity: 0.65 } }],
          },
        });
        setChartOptions({ ...chartOptionsRef.current });
      };

      // 日K还没到就不要开算：否则会先用回退窗口（120）跑一遍，
      // 界面上看起来仍是「只算最近 120 个交易日」。等 K 线就绪后由依赖触发重算。
      const dayIdx = DefaultKTypes.indexOf(KLineType.Day);
      const dayLen = (filterKlinesByToDate(klineData.klines[dayIdx], displayToDate) || []).length;
      if (dayLen <= 0) {
        setShortScoreCurveDaysUsed(0);
        setShortScoreCurveLoading(true);
        return undefined;
      }
      setShortScoreCurveDaysUsed(dayLen);
      console.log(`[短线评分] 曲线窗口 = 日K根数 ${dayLen}（shortScoreCurveDays=${shortScoreCurveDays}）`);

      setShortScoreCurveLoading(true);
      computeShortTermScoreCurve({
        code,
        name: stock?.name,
        hybk: config?.hybk || null,
        // 列表里取到的流通市值（亿元）用来选市值档，和列表评分口径对齐
        circMv: stock?.lt ? Number(stock.lt) * 1e8 : undefined,
        // 窗口跟 K 线长度走：K 线加载/滚动越多，评分曲线覆盖越多交易日
        limit: shortScoreCurveDays,
      })
        .then((curve) => {
          if (canceled) {
            return;
          }
          applyToChart(curve.scores, 0);
          console.log(
            `[短线评分] 技术指标曲线：${code} 基准日 ${curve.scoreDayKey}，共 ${Object.keys(curve.scores).length} 个交易日`
          );
        })
        .catch((e: any) => {
          console.warn('[短线评分] 技术指标曲线计算失败:', e?.message || e);
        })
        .finally(() => {
          if (!canceled) {
            setShortScoreCurveLoading(false);
          }
        });
      return () => {
        canceled = true;
        if (retryTimer) {
          clearTimeout(retryTimer);
        }
      };
      // chartOptions / klineData 是原地修改的状态对象，不作为依赖；用长度判断图表是否已就绪
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [techType, typeIndex, displayToDate, secid, stock?.name, config?.hybk, klineData.klines[typeIndex]?.length, shortScoreCurveDays]);

    const onMAPeriodTypeChange = useCallback(
      (value: MAPeriodType) => {
        if (chartOptions[typeIndex]) {
          chartOptions[typeIndex][0].maType = value;
          const ks = klineData.klines[typeIndex];
          if (value == MAPeriodType.LYT) {
            const lyts = Helpers.Stock.LYTIndicator(ks);
            const markPoints = [];
            for (let i = 0; i < lyts.length; i++) {
              if (lyts[i]) {
                markPoints.push({
                  value: '鸭',
                  coord: [ks[i].date, String(ks[i].zg)],
                  itemStyle: {
                    color: variableColors['--primary-color'],
                  },
                });
              }
            }
            updateKMarkPoints(chartOptions[typeIndex][0], markPoints);
          }
          updateMASeries(chartOptions[typeIndex][0], ks);
          setChartOptions({
            ...chartOptions,
          });
          
          setMAPeriodType(value);
        }
        if (updateMType) {
          updateMType(value);
        }
      },
      [typeIndex, chartOptions]
    );
    // 历史交易日的分时：与 ScoreStockPanel 一致，由 Tushare 1 分钟线合成
    // （requestHistTrends → get_stock_trend_by_date，本地分钟库命中时零请求）。
    // 原 opensourcecache 历史分时缓存源已下线，不能再作为数据来源。
    const { run: runGetHistTrends } = useRequest(Services.Stock.requestHistTrends, {
      manual: true,
      onSuccess: (data: Stock.TrendItem[], params: any[]) => {
        // 用发起请求时选中的交易日做时间前缀（异步回调里 currentTrendDate 可能还没更新）
        const digits = String(params?.[1] ?? currentTrendDate ?? '').replace(/\D/g, '');
        const day =
          digits.length >= 8
            ? `${digits.substring(0, 4)}-${digits.substring(4, 6)}-${digits.substring(6, 8)}`
            : dayjs().format('YYYY-MM-DD');
        // 1 分钟线本身每分钟一根；数据源更细时按分钟合并（成交量累加，价格取最后一根）
        const byMinute = new Map<string, Stock.TrendItem>();
        (data || []).forEach((t) => {
          if (!t || !(Number(t.current) > 0)) {
            return;
          }
          const raw = String(t.datetime || '');
          const hhmm = raw.length >= 16 ? raw.substring(11, 16) : raw.substring(0, 5);
          if (!hhmm) {
            return;
          }
          const prev = byMinute.get(hhmm);
          if (prev) {
            prev.vol += t.vol || 0;
            prev.current = t.current;
            prev.up = t.up;
            prev.average = t.average || prev.average;
          } else {
            byMinute.set(hhmm, { ...t, datetime: `${day} ${hhmm}` });
          }
        });
        const trends = Array.from(byMinute.values()).sort((a, b) =>
          a.datetime < b.datetime ? -1 : a.datetime > b.datetime ? 1 : 0
        );
        // 直接整段替换（不能走 handleTrends 的实时拼接：它会把上一交易日的分时串进来）
        setTrendData({ trends });
        updateTrendsOption({ trends }, day);
        if (updateTrendData) {
          updateTrendData(trends);
        }
      },
    });
    const onTrendDateChange = useCallback(
      (date: string) => {
        setCurrentTrendDate(date);
        if (date == trendDates[trendDates.length - 1]) {
          // 最新交易日：回到实时分时
          runGetTrends(kLineApiSourceSetting, secid);
        } else {
          // 历史交易日：Tushare 1 分钟线合成
          runGetHistTrends(secid, date);
        }
      },
      [secid, trendDates, kLineApiSourceSetting]
    );
    const { run: runGetBKKline } = useRequest(Services.Stock.GetKFromDataSource, {
      throwOnError: true,
      manual: true,
      onSuccess: ({ ks, kt }) => {
        if (!ks.length) {
          console.error('handeBKKline, ks is undefined');
          return;
        }
        // 更新k线描述信息
        const kIndex = DefaultKTypes.indexOf(kt);
        const stKlines = klineData.klines[kIndex];

        var startI = 0;
        const firstStKline = stKlines[0];
        const firstBkKline = ks[0];
        if (firstStKline) {
          if (firstBkKline.date == firstStKline.date) {
            // matched
          } else if (firstBkKline.date < firstStKline.date) {
            // find to
            for (var i = 0; i < ks.length; i++) {
              if (ks[i].date == firstStKline.date) {
                startI = i;
                break;
              }
            }
            // remove to startII
          ks.splice(0, i);
          } else {
            for (var i = 0; i < stKlines.length; i++) {
              if (stKlines[i].date == firstBkKline.date) {
                startI = i;
                break;
              }
            }
          }
  
          // 更新为差价
          if (true) {
            for(var i = ks.length - 1; i > 0; i--) {
              const bkKline = ks[i] as Stock.KLineItem;
              const bkPrev = ks[i -1];
              // 先变成比例
              bkKline.kp = bkKline.kp/bkPrev.kp;
              bkKline.sp = bkKline.sp/bkPrev.sp;
              bkKline.zg = bkKline.zg/bkPrev.zg;
              bkKline.zd = bkKline.zd/bkPrev.zd;
            }
  
            // 让第一个k的取值空间和st一致
            for (var j = startI; j < stKlines.length - 1; j++) {
              const stKline = stKlines[j];
              if (stKline.date == ks[0].date) {
                ks[0].kp = stKline.kp;
                ks[0].sp = stKline.sp;
                ks[0].zg = stKline.zg;
                ks[0].zd = stKline.zd;
                break;
              }
            }
  
            // 更新值
            for(var i = 1; i < ks.length; i++) {
              // find the data
              if (i == 0) {
                // 将初始值设为一样
  
                continue;
              }
              const bkKline = ks[i] as Stock.KLineItem;
              const bkPrev = ks[i -1];
              // 把比例变成值
              bkKline.kp = bkKline.kp * bkPrev.kp;
              bkKline.sp = bkKline.sp * bkPrev.sp;
              bkKline.zg = bkKline.zg * bkPrev.zg;
              bkKline.zd = bkKline.zd * bkPrev.zd;
            }
          }
        }
        
        const cbkklines = klineData.bkklines[currentBK!] || ({} as Record<number, Stock.KLineItem[]>);
        cbkklines[kIndex] = ks;
        batch(() => {
          const newKlineData = {
            ...klineData,
            bkklines: {
              ...klineData.bkklines,
              [currentBK]: cbkklines,
            },
          };
          batch(() => {
            setKLineData(newKlineData);
            if (newKlineData.klines[typeIndex].length) {
              updateKLineOption(kIndex, newKlineData);
            }
          });
        });
      },
      cacheKey: `GetKlinesAndFlows/${secid}${trainCacheSuffix}`,
    });
    const onBKChange = useCallback(
      (bksecid: string) => {
        // 获取板块K线并且添加到K线图
        batch(() => {
          setCurrentBK(bksecid);
          if (bksecid == null) {
            if (chartOptions[typeIndex]) {
              clearKChartBk(chartOptions[typeIndex][0]);
            }
            setChartOptions({
              ...chartOptions,
            });
          } else {
            updateKLineOption(typeIndex, klineData);
            runGetBKKline(kLineApiSourceSetting, bksecid, DefaultKTypes[typeIndex], klineData.count[typeIndex]);
          }
        });
      },
      [chartOptions, klineData, typeIndex]
    );
    useRenderEcharts(
      () => {
        if (typeIndex === 0) {
          if (chartOptions[0]) {
            const opts = chartOptions[0];
            opts.darkMode = darkMode;
            // 更新分时图上的 stockMarkLines
            if (opts.series[0].markLine) {
              const trendData = opts.series[0].data as number[];
              const yMin = opts.yAxis[0].min ?? (trendData.length > 0 ? Math.min(...trendData) * 0.999 : 0);
              const yMax = opts.yAxis[0].max ?? (trendData.length > 0 ? Math.max(...trendData) * 1.001 : 0);
              const currentPrice = trendData.length > 0 ? trendData[trendData.length - 1] : 0;
              const baseMarkLines = getMarkLineData(darkMode, trendZs, undefined);
              if (config?.markLines && config.markLines.length > 0) {
                config.markLines.forEach((m) => {
                  if (m >= yMin && m <= yMax) {
                    baseMarkLines.push({
                      name: m < currentPrice ? '支撑' : '压力',
                      yAxis: m,
                      label: {
                        color: Utils.getVariablesColor(CONST.VARIABLES)['--hint-color'],
                      },
                      lineStyle: {
                        color: Utils.getVariablesColor(CONST.VARIABLES)['--hint-color'],
                        type: 'dashed',
                      },
                    });
                  }
                });
              }
              opts.series[0].markLine.data = baseMarkLines;
            }
            chartInstance?.setOption(opts, true);
          }
        } else {
          if (chartOptions[typeIndex]) {
            const optIndex = fractal ? 1 : 0;
            // 以图表实际展示的最后一根K线为基准（训练模式下不会用未来价格）
            const zx = (displayKlines.length ? displayKlines[displayKlines.length - 1] : klineData.klines[typeIndex].slice(-1)[0]).sp;
            const cms = klineData.choumas[typeIndex];
            chartOptions[typeIndex].forEach((opt: any, i: number) => updateCKChart(opt, darkMode, outRange || range, zx, false, cms[i]));
            const mData =
              config && config.markLines
                ? config.markLines.map((m) => {
                    return {
                      name: m < zx ? '支撑' : '压力',
                      yAxis: m,
                    };
                  })
                : [];
            if (selectedArea) {
              mData.push({
                name: '选区成本',
                yAxis: selectedArea.avgcost,
              });
            }
            // 买入委托未成交前（模拟训练：y=0 的次日委托）不画到图上
            const allBuyPoints = [
              ...(config?.buyPoints || []),
              ...(backtestMarks?.buyPoints || []),
            ].filter((p) => Number(p.y) > 0);
            const allSellPoints = [
              ...(config?.sellPoints || []),
              ...(backtestMarks?.sellPoints || []),
            ].filter((p) => Number(p.y) > 0);
            let pData = allBuyPoints.map((p) => {
              const x = typeIndex == 1 ? p.x : p.x.substring(0, 10);
              return {
                value: p.t ? 'T买' : '买',
                coord: [x, p.y],
                itemStyle: {
                  color: increaseColor,
                },
              };
            });
            pData = pData.concat(
              allSellPoints.map((p) => {
                const x = typeIndex == 1 ? p.x : p.x.substring(0, 10);
                return {
                  value: p.t ? 'T卖' : '卖',
                  coord: [x, p.y],
                  itemStyle: {
                    color: reduceColor,
                    symbolRotate: -180,
                  },
                };
              })
            );
            // firstQSAppear 黄色标记
            if (firstQSAppear && typeof firstQSAppear === 'string' && typeIndex !== 0 && klineData.klines[typeIndex]?.length > 0) {
              const day = firstQSAppear.substring(0, 10);
              const ks = klineData.klines[typeIndex];
              let idx = -1;
              for (let i = 0; i < ks.length; i++) {
                if (ks[i].date.length === firstQSAppear.length) {
                  if (ks[i].date === firstQSAppear) {
                    idx = i;
                    break;
                  }
                } else if (ks[i].date.startsWith(day)) {
                  idx = i;
                  break;
                }
              }
              if (idx !== -1) {
                const k = ks[idx];
                pData.push({
                  value: '首板',
                  coord: [k.date, String(k.zg)],
                  itemStyle: {
                    color: '#FFD700', // 金黄色标记
                  },
                });
              }
            }
            chartOptions[typeIndex].forEach((opt: any) => {
              if (typeIndex != 0 && typeIndex <= DefaultKTypes.indexOf(KLineType.Mint60)) {
                // 标记一下交易日
                const xs = opt.xAxis[0].data as Array<string>;
                if (xs && xs.length > 0) {
                  const dayBegins = xs.filter((x, i) => {
                    if (i == 0) {
                      return false;
                    }
                    return x.substring(0, 10) != xs[i - 1].substring(0, 10);
                  });
                  dayBegins.forEach((d) => {
                    mData.push({
                      xAxis: d,
                      label: {
                        show: false,
                      },
                      lineStyle: {
                        type: 'dashed',
                        dashOffset: 20,
                        color: '#FF9933',
                        opacity: 0.5,
                      },
                    });
                  });
                }
              }
              if (opt.series[0].markLine) {
                opt.series[0].markLine.data = mData;
              }
              if (opt.series[0].markPoint) {
                opt.series[0].markPoint.data = pData;
              }
            });
            const sopt = chartOptions[typeIndex][optIndex];
            // 标记区域
            if (DefaultKTypes[typeIndex] === KLineType.Day) {
              if (activePeriod !== currentActivePeriod) {
                setCurrentActivePeriod(activePeriod);
                if (activePeriod) {
                sopt.series[0].markArea = {
                  itemStyle: {
                      color: 'rgba(255, 173, 177, 0.15)'
                  },
                  label: {
                    offset: [0, -40],
                  },
                  data: [
                      [{
                          name: PeriodMarkTypeNames[activePeriod.type],
                          xAxis: activePeriod.startDate,
                      },
                      {
                          xAxis:activePeriod.endDate,
                      }]
                  ]
                };
                // 移动区域
                const index = sopt.xAxis[0].data.indexOf(activePeriod.startDate);
                let rangeStart = Math.max(0, Math.ceil(index / sopt.xAxis[0].data.length * 100));
                if (rangeStart > 5) {
                  rangeStart -= 5;
                } else {
                  rangeStart = 0;
                }
                const diff = sopt.dataZoom.start - rangeStart;
                if (diff > 0) {
                  sopt.dataZoom.start -= diff;
                  sopt.dataZoom.end -= diff;
                  if (sopt.dataZoom.end > 100) {
                    sopt.dataZoom.end = 100;
                  }
                }
              } else {
                sopt.series[0].markArea = undefined;
              }
            }
            }
            
            chartInstance?.setOption(sopt, true);
            setCMTop(sopt.grid.slice(-1)[0].next);
            cmDateRef.current?.setValue(cms[optIndex].date);
          }
        }
      },
      chartInstance,
      [
        darkMode,
        typeIndex,
        chartOptions,
        range,
        outRange,
        fractal,
        zs,
        trendZs,
        selectedArea,
        config?.markLines,
        config?.buyPoints,
        config?.sellPoints,
        activePeriod,
        firstQSAppear,
      ]
    );

    useEffect(() => {
      for (let i = 0; i < DefaultKTypes.length; i++) {
        // chartOptions[0] 是分时图对象（非数组），只有 K 线图才是 [K线opts, 缠论opts] 数组。
        // 训练模式点「下一天」会改变 displayToDate 触发本 effect，若用 undefined 调 updateKChart 会抛
        // "Cannot read property 'visualMap' of undefined"。
        if (Array.isArray(chartOptions[i])) {
          updateKChart(chartOptions[i][0], klineData.klines[i], displayToDate);
          runCalculateTech(filterKlinesByToDate(klineData.klines[i], displayToDate), i, chartOptions[i][0].techType);
          // handeKline({ ks: klineData.klines[i], kt: DefaultKTypes[i] });
        }
      }
      setChartOptions({
        ...chartOptions,
      });
    }, [displayToDate]);

    const chartWrapperRef = useRef<HTMLDivElement>(null);
    const { CheckableTag } = Tag;

    const exportDayKlineAsJson = useCallback(() => {
      const dayIndex = DefaultKTypes.indexOf(KLineType.Day);
      // 训练/回测模式下导出展示范围内（不含未来）的日K
      const dayKlines = filterKlinesByToDate(klineData.klines[dayIndex], displayToDate);
      if (!dayKlines || dayKlines.length === 0) {
        return;
      }
      const latest30 = dayKlines.slice(-30);
      const jsonStr = JSON.stringify(latest30, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const stockName = stock?.name || secid;
      link.download = `${stockName}_日K线_${dayjs().format('YYYYMMDD_HHmmss')}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, [klineData, secid, stock, displayToDate]);

    const titleBar = (
      <>
        {DefaultKTypes.map((t, i) => (
          <CheckableTag key={t} checked={DefaultKTypes[typeIndex] === t} onChange={(checked) => changeTypeIndex(i)}>
            {KlineTypeNames[t]}
          </CheckableTag>
        ))}
        <Switch style={{ marginLeft: 5 }} checkedChildren="缠开" unCheckedChildren="缠关" onChange={(on) => setFractal(on)} />
        <Switch style={{ marginLeft: 5 }} checkedChildren="画线" unCheckedChildren="画线" onChange={changeLineEnabled} />
      </>
    );

    const zoomOut = () => {
      if (range.start <= 5) {
        range.start = 0;
      } else {
        range.start -= 5;
      }
      if (range.start === 0) {
        // try load more
        const newCount = klineData.count[typeIndex] + 100;
        setKLineData({
          ...klineData,
          count: {
            ...klineData.count,
            [typeIndex]: newCount,
          },
        });
        fetchKline(kLineApiSourceSetting, secid, DefaultKTypes[typeIndex], newCount);
      }
      setRange({
        ...range,
      });
      if (onRangeUpdated) {
        onRangeUpdated(range);
      }
    };

    const zoomIn = () => {
      if (range.end - range.start <= 10) {
        return;
      } else {
        range.start += 5;
      }
      setRange({
        ...range,
      });
      if (onRangeUpdated) {
        onRangeUpdated(range);
      }
    };
    const updateRange = ([s, e]) => {
      setRange({
        start: s,
        end: e,
      });
      if (onRangeUpdated) {
        onRangeUpdated(range);
      }
    };

    useEffect(() => {
      if (onTimelineDate && typeIndex != 0) {
        // 显示到指定日期范围
        const day = onTimelineDate.substring(0, 10);
        // 找到范围
        const ks = klineData.klines[typeIndex];
        for (let i = 0; i < ks.length; i++) {
          if (ks[i].date.startsWith(day)) {
            // 计算范围
            const p = Math.round((i / ks.length) * 100);
            const slen = 10;
            let start = p - slen;
            if (start < 0) {
              start = 0;
            }
            const end = start + 2 * slen;
            setRange({
              start,
              end,
            });
            if (onRangeUpdated) {
              onRangeUpdated(range);
            }
            break;
          }
        }
      }
    }, [onTimelineDate]);

    return (
      <ChartCard TitleBar={titleBar} auto={false}>
        <div className={styles.indicators}>
          {trainActive && !!trainDate && !trainClockStarted && (
            <span
              style={{ fontSize: 12, color: 'var(--secondary-text-color)', marginRight: 8 }}
              title="训练日当天的分时与日K要等训练时钟推进后才出现（上方训练条：+1分 / 推进 / 到收盘）"
            >
              未开始推进（{trainClock}）：当天分时 / 日K暂不展示
            </span>
          )}
          {typeIndex === 0 && (
            <>
              {trendDates.length > 0 && (
                <Select size="small" value={currentTrendDate} onChange={onTrendDateChange}>
                  {trendDates.map((_, i) => (
                    <Select.Option value={_} key={i}>
                      {_}
                    </Select.Option>
                  ))}
                </Select>
              )}
              {trendData.trends.length > 1 && (
                <>
                  <span
                    className={Utils.GetValueColor(trendData.trends[trendData.trends.length - 1].current - zs).textClass}
                    style={{ marginRight: 5 }}
                  >
                    最新:{trendData.trends[trendData.trends.length - 1].current}
                  </span>
                  <span style={{ color: maColors[0] }}>均价:{trendData.trends[trendData.trends.length - 1].average}</span>
                </>
              )}
            </>
          )}
          {typeIndex !== 0 && klineData.klines[typeIndex].length && (
            <>
              <div className={styles.chartBar}>
                <div>
                  <Select defaultValue={MAPeriodType.Medium} value={maPeriodType} onChange={onMAPeriodTypeChange} size="small">
                    <Select.Option value={MAPeriodType.Short}>短期均线</Select.Option>
                    <Select.Option value={MAPeriodType.Medium}>中期均线</Select.Option>
                    <Select.Option value={MAPeriodType.Long}>长期均线</Select.Option>
                    <Select.Option value={MAPeriodType.JAX}>济安线</Select.Option>
                    <Select.Option value={MAPeriodType.DGWY}>登高望远</Select.Option>
                    <Select.Option value={MAPeriodType.LYT}>老鸭头</Select.Option>
                  </Select>
                  &nbsp;
                  <Select defaultValue={DefaultTechIndicatorTypes[0]} value={techType} onChange={onTechIndicatorTypeChange} size="small">
                    {DefaultTechIndicatorTypes.map((v, i) =>(
                      <Select.Option value={v} key={"tit_" + v}>{TechIndicatorNames[v]}</Select.Option>
                    ))}
                  </Select>
                  {techType === TechIndicatorType.SHORT_SCORE ? (
                    shortScoreCurveLoading ? (
                      <span style={{ fontSize: 11, color: 'var(--secondary-text-color)', marginLeft: 4 }}>
                        短线评分计算中（
                        {shortScoreCurveDaysUsed > 0 ? `最近 ${shortScoreCurveDaysUsed} 个交易日` : '等待 K 线加载'}
                        ）...
                      </span>
                    ) : (
                      <span
                        style={{ fontSize: 11, color: 'var(--secondary-text-color)', marginLeft: 4 }}
                        title={`柱高=评分单日变化幅度：红柱=跳升、绿柱=跳降；变化 ≥${SCORE_JUMP_CONFIG.minDelta} 分的柱子加重显示（突变），其余为淡色日常波动。橙柱=抬升观察、粉柱=跳升买入、亮绿柱=卖出（与列表「信号」列/回测同一套规则，悬停曲线可看判定依据）。蓝色虚线=自近${SHORT_SCORE_RISE_DAYS}根低点的累计抬升（买入阈值 ${SHORT_SCORE_RISE_THRESHOLD} 分；单日跳升 ≥20 分也算启动）`}
                      >
                        红绿柱=评分突变（红升绿降，≥{SCORE_JUMP_CONFIG.minDelta}分加重）
                        <span style={{ marginLeft: 4, color: SHORT_SCORE_RISE_BUY_MARK_COLOR, fontWeight: 600 }}>橙柱=抬升观察</span>
                        <span style={{ marginLeft: 4, color: SHORT_SCORE_JUMP_BUY_MARK_COLOR, fontWeight: 600 }}>粉柱=跳升买入</span>
                        <span style={{ marginLeft: 4, color: SHORT_SCORE_SELL_MARK_COLOR, fontWeight: 600 }}>亮绿柱=卖出</span>
                        <span style={{ color: 'var(--secondary-text-color)' }}>
                          　蓝虚线=自近{SHORT_SCORE_RISE_DAYS}根低点抬升
                        </span>
                      </span>
                    )
                  ) : null}
                  &nbsp;
                  <Select value={currentBK || ''} onChange={onBKChange} size="small">
                    <Select.Option value={''}>选择板块</Select.Option>
                    {bankuais.map((_, i) => (
                      <Select.Option value={_.secid} key={_.code}>
                        {_.name}
                      </Select.Option>
                    ))}
                  </Select>
                  &nbsp;
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={exportDayKlineAsJson}
                    title="导出日K线数据为JSON"
                  >
                    导出日K
                  </Button>
                  &nbsp;
                  {displayKlines.length > 0 && (
                    <span
                      className={Utils.GetValueColor(displayKlines[displayKlines.length - 1].sp - zs).textClass}
                      style={{ marginRight: 10 }}
                    >
                      最新:{displayKlines[displayKlines.length - 1].sp}
                    </span>
                  )}
                  
                  {selectedArea && (
                    <>
                    &nbsp;
                      <span>
                        [{selectedArea.start.substring(5)},{selectedArea.end.substring(5)}]
                      </span>
                      &nbsp;
                      <span>
                        [{selectedArea.kp},{selectedArea.sp},{(selectedArea.zdf * 100).toFixed(2)}%]
                      </span>
                      &nbsp;
                      <span>
                        [{selectedArea.avghsl.toFixed(2)}, {selectedArea.zghsl}, {selectedArea.zdhsl}, {selectedArea.zhhsl}]
                      </span>
                      &nbsp;
                      <span style={{ fontWeight: 'bold' }}>{selectedArea.avgcost.toFixed(2)}</span>
                    </>
                  )}
                </div>
                {!outRange && (
                  <div style={{ display: 'flex' }}>
                    <Slider
                      range
                      defaultValue={[20, 50]}
                      style={{ width: 150, marginTop: 8, marginRight: 10 }}
                      value={[range.start, range.end]}
                      onChange={updateRange}
                    />
                    <Button className={styles.holding} type="text" icon={<ZoomInOutlined />} onClick={zoomIn} />
                    <Button className={styles.holding} type="text" icon={<ZoomOutOutlined />} onClick={zoomOut} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className={styles.content} ref={chartWrapperRef}>
          <div ref={chartRef} className={styles.echart}>
            {/* {DefaultKTypes[typeIndex] == KLineType.Day && (
              <KNoteBar secid={secid} dates={klineData.klines[typeIndex].map((k) => k.date)} range={range} />
            )} */}
          </div>
          {typeIndex !== 0 && isStock && klineData.choumas[typeIndex].length > 0 && (
            <div className={styles.choumawrapper} style={{ top: cmTop }}>
              <div>
                <Input
                  ref={cmDateRef}
                  style={{ width: '100%', textAlign: 'center' }}
                  size="small"
                  onChange={(e) => onCMDateChange(e.target)}
                />
              </div>
              <div className={styles.row} style={{ marginTop: 5 }}>
                <Input.Group compact>
                  <Button icon={<DoubleLeftOutlined />} style={{ width: '20%' }} size="small" onClick={() => onPrevCMDate(5)} ghost />
                  <Button icon={<LeftOutlined />} style={{ width: '20%' }} size="small" onClick={() => onPrevCMDate()} ghost />
                  <Button icon={<RightOutlined />} style={{ width: '20%' }} size="small" onClick={() => onNextCMDate()} ghost />
                  <Button icon={<DoubleRightOutlined />} style={{ width: '20%' }} size="small" onClick={() => onNextCMDate(5)} ghost />
                  <Button icon={<VerticalLeftOutlined />} style={{ width: '20%' }} size="small" onClick={() => onNextCMDate(-1)} ghost />
                </Input.Group>
              </div>
              <div className={styles.row}>
                <div>获利比例</div>
                <div>{(klineData.choumas[typeIndex][0]?.benefitRatio * 100).toFixed(2)}%</div>
              </div>
              <div className={styles.row}>
                <div>平均成本</div>
                <div
                  className={
                    Utils.GetValueColor(
                      (displayKlines.length ? displayKlines[displayKlines.length - 1].sp : klineData.klines[typeIndex].slice(-1)[0].sp) -
                        klineData.choumas[typeIndex][0]?.avgCost || 0
                    ).textClass
                  }
                >
                  {klineData.choumas[typeIndex][0]?.avgCost}
                </div>
              </div>
              {klineData.choumas[typeIndex][0].percentChips.map((p, i) => (
                <div key={i}>
                  <div className={styles.row}>
                    <div>{p.percentile * 100}%区间</div>
                    <div>{p.priceRange.start + '-' + p.priceRange.end}</div>
                  </div>
                  <div className={styles.row}>
                    <div>&nbsp;&nbsp;&nbsp;&nbsp;集中度</div>
                    <div>{(p.concentration * 100).toFixed(2)}%</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ChartCard>
    );
  }
);
export default PriceTrend;
