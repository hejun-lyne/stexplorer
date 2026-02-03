import React, { useCallback, useRef, useState, useEffect, useLayoutEffect } from 'react';
import { StoreState } from '@/reducers/types';
import { useInterval, useRequest, useSize, useThrottleFn } from 'ahooks';
import ChartCard from '@/components/Card/ChartCard';
import {
  ChanType,
  DefaultKTypes,
  DefaultMATypes,
  DefaultTechIndicatorTypes,
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
import { useHomeContext } from '@/components/FullHome';
import styles from './index.scss';
import { Tag, Switch, Input, Select, Slider, Form } from 'antd';
import { batch, useDispatch, useSelector } from 'react-redux';
import { GetKlinesAndFlows } from '@/helpers/stock';
import { Stock } from '@/types/stock';
import { Button } from 'antd';
const { makeWorkerExec } = window.contextModules.electron;
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
} from '@ant-design/icons';

export interface PriceTrendProps {
  active: boolean;
  secid: string;
  zs: number;
  useSina?: boolean;
  trainMode?: boolean;
  activePeriod?: Stock.PeriodMarkItem;
  toDate?: string;
  onTimelineDate?: string;
  updateKLineData: (ks: Stock.KLineItem[]) => void;
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
function getxAxis(data: string[], showChouma = false) {
  const axises = [
    // 价格时间轴
    {
      type: 'category',
      scale: true,
      boundaryGap: false,
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
      boundaryGap: false,
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
      boundaryGap: false,
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
function getKSeries(data: any[], markPoints: Record<string, any>, markLines: any[]) {
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
      data: markPoints,
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
            text += `<div style="display: flex; justify-content: space-between;"><span>筹码占比:</span><span>${p.value.toFixed(
              5
            )}</span></div>`;
          } else if (p.seriesName == 'K线') {
            const val = p.data.value;
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
            text += `<div style="display: flex; justify-content: space-between;"><span>${p.seriesName}:</span><span>${p.data.toFixed(
              2
            )}</span></div>`;
          } else if (p.seriesName == '成交量') {
            text += `<div style="display: flex; justify-content: space-between;"><span>成交量:</span><span>${
              (p.data[1] / 10000).toFixed(2) + '万手'
            }</span></div>`;
          } else if (!isNaN(p.data)) {
            text += `<div style="display: flex; justify-content: space-between;"><span>${p.seriesName}:</span><span>${p.data.toFixed(
              2
            )}</span></div>`;
          }
          
        });
        params.forEach((p) => {
          if (p.seriesName == 'K线') {
            const val = p.data.value;
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
function setupTrendChart(darkMode: boolean, trends: Stock.TrendItem[], zs: number) {
  const options = baseTChartOptions(darkMode);
  options.grid = getGridOption(false);
  options.visualMap = getVisualMap();
  options.axisPointer = getAxisPointer();
  options.tooltip.formatter = tChartTipFormatter(zs);
  const dates = trends.map(({ datetime }) => datetime.split(' ')[1]);
  options.xAxis = getxAxis(dates);
  const vals = trends.map((t) => t.current).concat(trends.map((t) => t.average));
  const yMin = Math.min(...vals) * 0.999;
  const yMax = Math.max(...vals) * 1.001;
  options.yAxis = getyAxis(darkMode, [yMin, yMax]);
  // const macds = Tech.calculateMACD(trends.map((_) => _.current), 89, 25, 13); // macd(trends.map((_) => _.current));
  const { color } = Utils.GetValueColor(Number(trends[trends.length - 1]?.current) - zs);
  const markLines = getMarkLineData(darkMode, Number(trends[trends.length - 1]?.current), undefined);
  options.series = [
    getTrendSeries(trends, color, markLines),
    getVolSeries(trends.map(({ vol, up }, i) => [i, vol, up])),
    getAvgSeries(trends),
    // ...getMACDSeries(macds),
  ];
  return options;
}
function updateTrendChart(opts: any, darkMode: boolean, trends: Stock.TrendItem[], zs: number) {
  opts.darkMode = darkMode;
  opts.tooltip.formatter = tChartTipFormatter(zs);
  const dates = trends.map(({ datetime }) => datetime.split(' ')[1]);
  for (let i = 0; i < opts.xAxis.length; i++) {
    opts.xAxis[i].data = dates;
  }
  const vals = trends.map((t) => t.current).concat(trends.map((t) => t.average));
  const yMin = Math.min(...vals) * 0.999;
  const yMax = Math.max(...vals) * 1.001;
  opts.yAxis[0].min = yMin;
  opts.yAxis[0].max = yMax;
  opts.series[0].lineStyle.color = Utils.GetValueColor(Number(trends[trends.length - 1]?.current) - zs).color;
  opts.series[0].data = trends.map(({ current }) => current); // 价格
  opts.series[1].data = trends.map(({ current, vol, last }, i) => [i, vol, current > last ? 1 : -1]); // 成交量
  opts.series[2].data = trends.map(({ average }) => average); // 平均价格
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
  options.xAxis = getxAxis(dates);
  options.yAxis = getyAxis(darkMode);
  options.series = [
    getKSeries(values, {}, []), 
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
  let _klines = klines;
  if (toDate) {
    let idx = -1;
    const day = toDate.substring(0, 10);
    klines.find((k, i) => {
      if (k.date.length == toDate.length) {
        if (k.date == toDate) {
          idx = i;
          return true;
        }
      } else if (k.date.startsWith(day)) {
        idx = i;
        return true;
      }
      return false;
    });
    _klines = klines.slice(0, idx + 1);
  }
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
  const zx = values[values.length - 1].value[1] as number;
  const vols = _klines.map(({ kp, sp, cjl }, i) => [i, cjl, i != 0 && sp <= _klines[i - 1].sp ? -1 : 1]);
  const options = baseKChartOptions(darkMode, range);
  options.maType = maType;
  options.techType = techType;
  options.grid = getGridOption(true, showChouma);
  options.axisPointer = getAxisPointer();
  options.visualMap = getVisualMap(2);
  options.xAxis = getxAxis(dates, showChouma);
  const showBK = bkks && bkks.length > 0;
  options.yAxis = getyAxis(darkMode, chouma ? chouma.steps : undefined, showChouma);
  if (!showChouma) {
    const startI = Math.floor(((_klines.length - 1) * range.start) / 100);
    const endI = Math.ceil(((_klines.length - 1) * range.end) / 100);
    const showed = _klines.slice(startI, endI);
    options.yAxis[0].min = Math.min(...showed.map((_) => _.zd));
    options.yAxis[0].max = Math.max(...showed.map((_) => _.zg));
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
  if (opts.grid.length < 4) {
    return;
  }
  const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
  opts.visualMap[0].pieces[0].color = variableColors['--reduce-color'];
  opts.visualMap[0].pieces[1].color = variableColors['--increase-color'];
  opts.series[0].itemStyle = {
    color: variableColors['--increase-color'],
    color0: variableColors['--reduce-color'],
    borderColor: variableColors['--increase-color'],
    borderColor0: variableColors['--reduce-color'],
  };
  if (!showChouma) {
    const startI = Math.floor((opts.series[0].data.length * range.start) / 100);
    const endI = Math.ceil((opts.series[0].data.length * range.end) / 100);
    const showed = opts.series[0].data.slice(startI, endI);
    opts.yAxis[0].min = Math.min(...showed.map((_: any[]) => _[2]));
    opts.yAxis[0].max = Math.max(...showed.map((_: any[]) => _[3]));
  } else if (chouma) {
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
  for (let i = 0; i < opts.xAxis.length - 1; i++) {
    opts.xAxis[i].data = dates;
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
  let _klines = klines;
  if (toDate) {
    let idx = -1;
    const day = toDate.substring(0, 10);
    klines.find((k, i) => {
      if (k.date.length == toDate.length) {
        if (k.date == toDate) {
          idx = i;
          return true;
        }
      } else if (k.date.startsWith(day)) {
        idx = i;
        return true;
      }
      return false;
    });
    _klines = klines.slice(0, idx + 1);
  }
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
  for (let i = 0; i < opts.xAxis.length - 1; i++) {
    opts.xAxis[i].data = dates;
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
    activePeriod,
    toDate,
    onTimelineDate,
    updateKLineData,
    updateKType,
    updateMType,
    outRange,
    onRangeUpdated,
    onSelectedAreaUpdated,
    addStock,
    removeStock,
  }) => {
    const stock = useSelector((state: StoreState) => state.stock.stocksMapping[secid]);
    const config = useSelector((state: StoreState) => state.stock.stockConfigsMapping[secid]);
    const { ontrain, trainDate } = useSelector((state: StoreState) => state.setting.systemSetting);
    const isStock = Helpers.Stock.GetStockType(secid) == StockMarketType.AB;
    const [typeIndex, setTypeIndex] = useState(0);
    const { darkMode } = useHomeContext();
    const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
    const increaseColor = variableColors['--increase-color'];
    const reduceColor = variableColors['--reduce-color'];
    const [trendDates, setTrendDates] = useState<string[]>([]);
    const [currentTrendDate, setCurrentTrendDate] = useState('选择日期');
    const [trendData, setTrendData] = useState({
      trends: stock ? stock.trends : [],
    });
    const [currentActivePeriod, setCurrentActivePeriod] = useState<Stock.PeriodMarkItem | null | undefined>(null);
    const [chartOptions, setChartOptions] = useState<any>({});
    const { run: handleTrends } = useThrottleFn(
      (trendd?: Stock.TrendItem[]) => {
        if (!trendd) {
          return;
        }
        let trends: Stock.TrendItem[] = [];
        if (trendData.trends.length > 0) {
          // 已有数据
          if (trendDates.length > 1 && currentTrendDate != trendDates[trendDates.length - 1]) {
            // 正在展示历史数据
            return;
          }
          // 新数据，拼接到最后
          let found = false;
          for (let i = 0; i < trendData.trends.length; i++) {
            if (trendData.trends[i].datetime == trendd[0].datetime) {
              trends = trendData.trends.slice(0, i).concat(trendd);
              found = true;
              break;
            }
          }
          if (!found) {
            trends = trendData.trends.concat(trendd);
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
            const td = trends[0].datetime.substring(0, 10);
            setCurrentTrendDate(td);
            setTrendDates([td]);
          }
          updateTrendsOption(newTrendData);
        });
      },
      {
        wait: 500,
      }
    );

    const [requestTrends, setRequestTrends] = useState(false);
    const [requestKLines, setRequestKLines] = useState(false);
    const { run: updateTrendsOption } = useThrottleFn(
      (data: any) => {
        // 需要更新zs
        let tzs = zs;
        if (trendDates.length > 1 && currentTrendDate != trendDates[trendDates.length - 1]) {
          const idx = trendDates.indexOf(currentTrendDate);
          const prevK = klineData.klines[DefaultKTypes.indexOf(KLineType.Day)][idx - 1];
          if (prevK) tzs = prevK.sp;
        }
        if (chartOptions[0]) {
          updateTrendChart(chartOptions[0], darkMode, data.trends, tzs);
        } else {
          chartOptions[0] = setupTrendChart(darkMode, data.trends || [], tzs);
        }
        setChartOptions({
          ...chartOptions,
        });
      },
      {
        wait: 500,
      }
    );
    const { run: runGetTrends } = useRequest(Services.Stock.GetTrendFromEastmoney, {
      throwOnError: true,
      manual: true,
      onSuccess: (data) => {
        const trends = data.trends || [];
        handleTrends(trends);
        setRequestTrends(false);
      },
      cacheKey: `GetStockTrendsAndFlows/${secid}`,
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
        if (!requestTrends) {
          setRequestTrends(true);
          runGetTrends(secid);
        }
        // if (!useSina) {
          runGetBankuais(secid);
        // }
      }
      if (active && Utils.JudgeWorkDayTime(new Date().getTime())) {
        const es = Helpers.Stock.SingleStockTrendPush(secid, (data) => {
          if (!data.length) {
            return;
          }
          // 如果数据一致无需更新
          if (trendData.trends.length) {
            const lastTick = trendData.trends.slice(-1)[0].datetime;
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
    const [klineData, setKLineData] = useState({
      count: DefaultKTypes.map((_) => 250),
      bkklines: {},
      klines: DefaultKTypes.map((_) => [] as Stock.KLineItem[]),
      chans: DefaultKTypes.map((_) => [] as Stock.ChanItem[]),
      clines: DefaultKTypes.map((_) => [] as Stock.ChanStokeItem[]),
      shortMAS: DefaultKTypes.map((_) => DefaultMATypes.map((_) => [] as number[])),
      mediumMAS: DefaultKTypes.map((_) => DefaultMATypes.map((_) => [] as number[])),
      longMAS: DefaultKTypes.map((_) => DefaultMATypes.map((_) => [] as number[])),
      jax: DefaultKTypes.map((_) => [[], []]),
      dgwy: DefaultKTypes.map((_) => [[], [], []]),
      choumas: DefaultKTypes.map((_) => [] as Stock.ChouMaItem[]),
    });
    const [linePoints, setLinePoints] = useState([] as { x: any; y: any }[]);
    const { run: runCalculateTech } = useRequest((ks: Stock.KLineItem[], kIndex:number, tt:TechIndicatorType) => makeWorkerExec('calculateIndicators', [ks, tt, kIndex,]), {
      throwOnError: true,
      manual: true,
      onSuccess: (data) => {
        const {names, values, techType, opaque} = data;
        const opts = chartOptions[opaque][0];
        const techSeries = getTechSeriesWithResult(opts.techType, values, names);
        opts.series = opts.series.filter((_:any) => _.stype !== 'tech');
        opts.series.push(...techSeries);
        setChartOptions({
          ...chartOptions,
        });
      },
    });
    const { run: handeKline } = useThrottleFn(
      ({ ks, kt }) => {
        if (!ks?.length) {
          console.error('handeKline, ks is undefined');
          return;
        }
        // if (ontrain && trainDate.length > 0) {
        //   // 截断数据
        //   let stopIndex = -1;
        //   for (let i = ks.length - 1; i >= 0; i--) {
        //     if (ks[i].date == trainDate) {
        //       stopIndex = i;
        //       break;
        //     }
        //   }
        //   if (stopIndex > 0) {
        //     ks = ks.slice(0, stopIndex + 1);
        //   }
        // }
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
            }
            updateKLineData(ks);
            updateKLineOption(kIndex, newKlineData);
          });
        });
        setRequestKLines(false);
      },
      {
        wait: 500,
      }
    );

    const { run: updateKLineOption } = useThrottleFn(
      (kIndex: number, data: any) => {
        let bkks = [];
        if (currentBK && data.bkklines[currentBK] && data.bkklines[currentBK][kIndex]) {
          bkks = data.bkklines[currentBK][kIndex];
        }
        if (chartOptions[kIndex]) {
          updateKChart(chartOptions[kIndex][0], data.klines[kIndex], toDate, bkks);
          updateCChart(chartOptions[kIndex][1], data.chans[kIndex], data.clines[kIndex]);
          runCalculateTech(data.klines[kIndex], kIndex, techType);
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
              toDate,
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
    const { kLineApiSourceSetting } = useSelector((state: StoreState) => state.setting.systemSetting);
    const { run: runGetKline } = useRequest(Services.Stock.GetKFromDataSource, {
      throwOnError: true,
      manual: true,
      onSuccess: handeKline,
      cacheKey: `GetKFromEastmoney/${secid}`,
    });
    const changeTypeIndex = useCallback(
      (i) => {
        setTypeIndex(i);
        if (i === 0) {
          if (!trendData.trends.length) {
            if (!requestTrends) {
              setRequestTrends(true);
              runGetTrends(secid);
            }
          }
          // updateTrendsOption(trendData);
        } else {
          if (klineData.klines[i] && klineData.klines[i].length) {
            // updateKLineOption(klineData);
          } else {
            if (!requestKLines) {
              setRequestKLines(true);
              runGetKline(kLineApiSourceSetting, secid, DefaultKTypes[i], klineData.count[i]);
            }
          }
          if (currentBK) {
            if (klineData.bkklines[currentBK] && klineData.bkklines[currentBK][i]?.length) {
              // updateKLineOption(klineData);
            } else {
              runGetBKKline(currentBK, DefaultKTypes[i], klineData.count[i]);
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
      if (trainMode) {
        if (!requestKLines) {
          setRequestKLines(true);
          runGetKline(kLineApiSourceSetting, secid, KLineType.Mint30, 100000);
        }
      }
    }, [trainMode]);

    // 定时更新
    useInterval(
      () => {
        if (!Utils.JudgeWorkDayTime(new Date().getTime())) {
          // 非交易时间
          return;
        }
        if (typeIndex === 0) {
          if (!requestTrends) {
            setRequestTrends(true);
            runGetTrends(secid);
          }
          
        } else {
          if (!requestKLines) {
            setRequestKLines(true);
            runGetKline(kLineApiSourceSetting, secid, DefaultKTypes[typeIndex], klineData.count[typeIndex]);
          }
        }
      },
      active ? CONST.DEFAULT.STOCK_TREND_DELAY : null
    );
    // if (!useSina) {
      const stype = Helpers.Stock.GetStockType(secid);
      const func = stype == StockMarketType.US || stype == StockMarketType.USZindex ? useUSWorkDayTimeToDo : useWorkDayTimeToDo;
      func(() => {
        if (typeIndex === 0) {
          // runGetTrends(secid);
        } else {
          if (!requestKLines) {
            setRequestKLines(true);
            runGetKline(kLineApiSourceSetting, secid, DefaultKTypes[typeIndex], klineData.count[typeIndex]);
          }
        }
      }, CONST.DEFAULT.STOCK_TREND_DELAY);
    // }

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
        const ks = klineData.klines[typeIndex];
        runCalculateTech(ks, typeIndex, value);
        // updateTechSeries(chartOptions[typeIndex][0], ks);
        // setChartOptions({
        //   ...chartOptions,
        // });
        
        setTechType(value);
      }
    }, [typeIndex, chartOptions]);

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
    const { run: runGetHistTrends } = useRequest(Services.Stock.requestDealDay, {
      throwOnError: true,
      manual: true,
      onSuccess: (data) => {
        // 只保留分钟
        const processed = [] as Stock.TrendItem[];
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
        // const trends = data.filter(
        //   (t, i) => i == data.length - 1 || data[i + 1].datetime.substring(3, 5) != data[i].datetime.substring(3, 5)
        // );
        processed.forEach((_) => {
          _.datetime = currentTrendDate + ' ' + _.datetime.substring(0, 5);
        });
        handleTrends(processed);
      },
      cacheKey: `requestDealDay/${secid}`,
    });
    const onTrendDateChange = useCallback(
      (date: string) => {
        setCurrentTrendDate(date);
        if (date == trendDates[trendDates.length - 1]) {
          // 重新获取趋势
          runGetTrends(secid);
        } else {
          runGetHistTrends(secid, date);
        }
      },
      [secid, trendDates]
    );
    const { run: runGetBKKline } = useRequest(Services.Stock.GetKFromEastmoney, {
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
      cacheKey: `GetKlinesAndFlows/${secid}`,
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
            runGetBKKline(bksecid, DefaultKTypes[typeIndex], klineData.count[typeIndex]);
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
            chartInstance?.setOption(opts, true);
          }
        } else {
          if (chartOptions[typeIndex]) {
            const optIndex = fractal ? 1 : 0;
            const zx = klineData.klines[typeIndex].slice(-1)[0].sp;
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
            let pData =
              config && config.buyPoints
                ? config.buyPoints.map((p) => {
                    const x = typeIndex == 1 ? p.x : p.x.substring(0, 10);
                    return {
                      value: '买',
                      coord: [x, p.y],
                      itemStyle: {
                        color: increaseColor,
                      },
                    };
                  })
                : [];
            if (config && config.sellPoints) {
              pData = pData.concat(
                config.sellPoints.map((p) => {
                  const x = typeIndex == 1 ? p.x : p.x.substring(0, 10);
                  return {
                    value: '卖',
                    coord: [x, p.y],
                    itemStyle: {
                      color: reduceColor,
                      symbolRotate: -180,
                    },
                  };
                })
              );
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
              if (opt.series[0].markPoint && pData.length > 0) {
                opt.series[0].markPoint.data = opt.series[0].markPoint.data.concat(pData);
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
        selectedArea,
        config?.markLines,
        config?.buyPoints,
        config?.sellPoints,
        activePeriod,
      ]
    );

    useEffect(() => {
      console.log(toDate);
      for (let i = 1; i < DefaultKTypes.length; i++) {
        if (chartOptions[i]) {
          updateKChart(chartOptions[i][0], klineData.klines[i], toDate);
          // handeKline({ ks: klineData.klines[i], kt: DefaultKTypes[i] });
        }
      }
      setChartOptions({
        ...chartOptions,
      });
    }, [toDate]);

    const chartWrapperRef = useRef<HTMLDivElement>(null);
    const { CheckableTag } = Tag;

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
        runGetKline(kLineApiSourceSetting, secid, DefaultKTypes[typeIndex], newCount);
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
          {typeIndex === 0 && (
            <>
              {trendDates.length > 0 && (
                <Select size="small" defaultValue={currentTrendDate} onChange={onTrendDateChange}>
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
                  <span
                    className={Utils.GetValueColor(klineData.klines[typeIndex][klineData.klines[typeIndex].length - 1].sp - zs).textClass}
                    style={{ marginRight: 10 }}
                  >
                    最新:{klineData.klines[typeIndex][klineData.klines[typeIndex].length - 1].sp}
                  </span>
                  
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
                    Utils.GetValueColor(klineData.klines[typeIndex].slice(-1)[0].sp - klineData.choumas[typeIndex][0]?.avgCost || 0)
                      .textClass
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
