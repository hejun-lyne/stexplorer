import { addStockAction, deleteStockAction } from '@/actions/stock';
import { StoreState } from '@/reducers/types';
import { Stock } from '@/types/stock';
import { HeartFilled, HeartOutlined, MinusOutlined, VerticalAlignTopOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import classnames from 'classnames';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { batch, useDispatch, useSelector } from 'react-redux';
import styles from './index.scss';
import * as Helpers from '@/helpers';
import * as Utils from '@/utils';
import * as Services from '@/services';
import * as CONST from '@/constants';
import { useRenderEcharts, useResizeEchart, useWorkDayTimeToDo } from '@/utils/hooks';
import { useRequest, useThrottleFn } from 'ahooks';
import { DefaultKTypes, DefaultMATypes, KLineType, MAPeriodType } from '@/utils/enums';
import { useHomeContext } from '@/components/FullHome';

export interface BKStockBriefProps {
  ktype: KLineType;
  mtype: MAPeriodType;
  secid: string;
  active: boolean;
  markdate?: string;
  moveTop?: (secid: string) => void;
  remove?: (secid: string) => void;
  openStock: (secid: string, name: string, change?: number) => void;
  outRange: { start: number; end: number };
  outArea: { start: string; end: string } | null | undefined;
}
const reduceColor = '#388e3c';
const increaseColor = '#d32f2f';
const maColors = ['#00b4d8', '#06d6a0', '#e76f51', '#b5179e'];

function getKBaseChartOptions(darkMode: boolean, range?: { start: number; end: number }, zs?: number) {
  const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
  return {
    title: {
      show: false,
    },
    colors: ['#ec0000', '#00da3c'],
    darkMode,
    animation: false,
    grid: [
      // 价格
      {
        top: '2%',
        left: '2%',
        width: '96%',
        height: '80%',
      }, // 成交量
      {
        top: '88%',
        left: '2%',
        width: '96%',
        height: '12%',
      },
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
      },
      position: function (pos, params, el, elRect, size) {
        const obj = {
          top: 10,
        };
        obj[['left', 'right'][+(pos[0] < size.viewSize[0] / 2)]] = 30;
        return obj;
      },
      formatter: function (params) {
        let text = `<div style="width: 200px"><div style="font-weight:bold;">${params[0].axisValue}</div>`; // 时间
        if (params[0].seriesName == '价格') {
          if (params[0].data.length) {
            return;
          }
          text += `<div style="display: flex; justify-content: space-between;"><span>现价:</span><span>${params[0].data.toFixed(
            2
          )}</span></div>`;
          text += `<div style="display: flex; justify-content: space-between;"><span>涨跌:</span><span>${
            ((params[0].data / zs) * 100 - 100).toFixed(2) + '%'
          }</span></div>`;
          text += `<div style="display: flex; justify-content: space-between;"><span>均价:</span><span>${params[1].data.toFixed(
            2
          )}</span></div>`;
          text += `<div style="display: flex; justify-content: space-between;"><span>成交量:</span><span>${
            params[2].data[1] + '手'
          }</span></div>`;
        } else {
          if (params[0].seriesName != 'K线') {
            return;
          }
          text += `<div style="display: flex; justify-content: space-between;"><span>开盘:</span><span>${params[0].data[1].toFixed(
            2
          )}</span></div>`;
          text += `<div style="display: flex; justify-content: space-between;"><span>最高:</span><span>${params[0].data[4].toFixed(
            2
          )}</span></div>`;
          text += `<div style="display: flex; justify-content: space-between;"><span>最低:</span><span>${params[0].data[3].toFixed(
            2
          )}</span></div>`;
          text += `<div style="display: flex; justify-content: space-between;"><span>收盘:</span><span>${params[0].data[2].toFixed(
            2
          )}</span></div>`;
          if (params[0].data[6]) {
            text += `<div style="display: flex; justify-content: space-between;"><span>涨跌:</span><span>${
              ((params[0].data[2] / params[0].data[6]) * 100 - 100).toFixed(2) + '%'
            }</span></div>`;
          }
          if (params[0].data[7]) {
            text += `<div style="display: flex; justify-content: space-between;"><span>换手率:</span><span>${
              params[0].data[7].toFixed(2) + '%'
            }</span></div>`;
          }
          text += `<div style="display: flex; justify-content: space-between;"><span>成交量:</span><span>${
            (params[params.length - 1].data[1] / 10000).toFixed(2) + '万手'
          }</span></div>`;

          if (params[0].data[8]) {
            params[0].data[8].forEach((t) => {
              text += `<div style="margin-top:10px;word-wrap:break-word; white-space:pre-wrap;">${t}</div>`;
            });
          }
        }
        text += '</div>';
        return text;
      },
    },
    dataZoom: {
      type: 'inside',
      zoomOnMouseWheel: false,
      start: range ? range.start : 0,
      end: range ? range.end : 100,
      xAxisIndex: [0, 1],
    },
    axisPointer: {
      link: [
        {
          xAxisIndex: [0, 1],
        },
      ],
    },
    visualMap: [
      {
        show: false,
        seriesIndex: 1,
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
      },
    ],
    series: [{}],
  };
}
function getKxAxis(data: string[]) {
  return [
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
      data,
    },
    // 成交量时间轴
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
  ];
}
function getKyAxis(darkMode: boolean) {
  return [
    // 价格
    {
      type: 'value',
      axisLabel: {
        show: false,
        // formatter: (value: string) => String(Number(value).toFixed(2)),
        // fontSize: 10,
      },
      axisLine: {
        show: false,
      },
      splitLine: {
        lineStyle: {
          color: darkMode ? 'rgba(255,255,255, 0.15)' : 'rgba(0, 0, 0, 0.15)',
          type: 'dashed',
        },
      },
      scale: true,
      position: 'right',
      min: (value: any) => value.min * 0.9,
      max: (value: any) => value.max * 1.1,
    },
    {
      type: 'value',
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      scale: true,
      gridIndex: 1,
      min: (value: any) => value.min,
      max: (value: any) => value.max,
    },
  ];
}
function getKSeries(data: any[]) {
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
    markLine: {
      symbol: 'none',
      label: {
        show: false,
        position: 'insideStartTop',
        formatter: '{b},{c}',
      },
      data: [],
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
function getMASeries(ma1?: any[], ma2?: any[], ma3?: any[], names: string[]) {
  const mas = [];
  if (ma1) {
    mas.push({
      name: names[0],
      type: 'line',
      silent: true,
      data: ma1,
      smooth: true,
      showSymbol: false,
      lineStyle: {
        width: 1,
        color: maColors[0],
      },
    });
  }
  if (ma2) {
    mas.push({
      name: names[1],
      type: 'line',
      silent: true,
      data: ma2,
      smooth: false,
      showSymbol: false,
      lineStyle: {
        width: 1,
        color: maColors[1],
      },
    });
  }
  if (ma3) {
    mas.push({
      name: names[2],
      type: 'line',
      silent: true,
      data: ma3,
      smooth: false,
      showSymbol: false,
      lineStyle: {
        width: 1,
        color: maColors[2],
      },
    });
  }
  return mas;
}
function setupKlineChart(
  darkMode: boolean,
  range: { start: number; end: number },
  klines: Stock.KLineItem[],
  ma1: string[],
  ma2: string[],
  ma3: string[],
  manames: string[]
) {
  const dates = klines.map(({ date }) => date);
  const values = klines.map((_, i) => [_.kp, _.sp, _.zd, _.zg, _.chan, i == 0 ? 0 : klines[i - 1].sp, _.hsl, _.notes]);
  const zx = values[values.length - 1][1];
  const vols = klines.map(({ kp, sp, cjl }, i) => [i, cjl, i != 0 && sp <= klines[i - 1].sp ? -1 : 1]);

  const options = getKBaseChartOptions(darkMode, range);
  options.xAxis = getKxAxis(dates);
  options.yAxis = getKyAxis(darkMode);
  options.series = [getKSeries(values), getVolSeries(vols), ...getMASeries(ma1, ma2, ma3, manames)];
  return options;
}
function updateKChart(opts: any, klines: Stock.KLineItem[], ma1: string[], ma2: string[], ma3: string[], manames: string[]) {
  const dates = klines.map(({ date }) => date);
  const values = klines.map((_, i) => [_.kp, _.sp, _.zd, _.zg, _.chan, i == 0 ? 0 : klines[i - 1].sp, _.hsl, _.notes]);
  // K线
  for (let i = 0; i < opts.xAxis.length - 1; i++) {
    opts.xAxis[i].data = dates;
  }
  opts.xAxis[0].data = dates;
  opts.series[0].data = values;
  const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
  opts.series[0].itemStyle = {
    color: variableColors['--increase-color'],
    color0: variableColors['--reduce-color'],
    borderColor: variableColors['--increase-color'],
    borderColor0: variableColors['--reduce-color'],
  };
  // 资金流入
  const nextIndex = 1;
  // 成交量
  const vols = klines.map(({ kp, sp, cjl }, i) => [i, cjl, i != 0 && sp <= klines[i - 1].sp ? -1 : 1]);
  opts.series[nextIndex].data = vols;
  // 均线
  opts.series[nextIndex + 1].data = ma1;
  opts.series[nextIndex + 2].data = ma2;
  opts.series[nextIndex + 3].data = ma3;
  opts.series[nextIndex + 1].name = manames[0];
  opts.series[nextIndex + 2].name = manames[1];
  opts.series[nextIndex + 3].name = manames[2];
  return { ...opts };
}
function updateKMARChart(opts: any, darkMode: boolean, ma1: string[], ma2: string[], ma3: string[], manames: string[]) {
  opts.darkMode = darkMode;
  const maIndex = 1;
  // 均线
  opts.series[maIndex + 1].data = ma1;
  opts.series[maIndex + 2].data = ma2;
  if (opts.series[maIndex + 3]) {
    opts.series[maIndex + 3].data = ma3 || [];
    opts.series[maIndex + 3].name = manames[2] || '';
  }
  opts.series[maIndex + 1].name = manames[0];
  opts.series[maIndex + 2].name = manames[1];
  return { ...opts };
}
function updateKRChart(opts: any, darkMode: boolean, range: { start: number; end: number }, avgCost?: number) {
  opts.darkMode = darkMode;
  opts.dataZoom.start = range.start;
  opts.dataZoom.end = range.end;
  const startI = Math.floor((opts.series[0].data.length * range.start) / 100);
  const endI = Math.ceil((opts.series[0].data.length * range.end) / 100);
  const showed = opts.series[0].data.slice(startI, endI);
  opts.yAxis[0].min = Math.min(...showed.map((_) => _.zd)) * 0.99;
  opts.yAxis[0].max = Math.max(...showed.map((_) => _.zg)) * 1.01;
  if (avgCost) {
    opts.series[0].markLine.data = [
      {
        name: '平均成本',
        yAxis: avgCost,
      },
    ];
  } else {
    // opts.series[0].markLine.data = [];
  }
  return { ...opts };
}

function getTBaseChartOptions(darkMode: boolean, range?: { start: number; end: number }, zs?: number) {
  const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
  return {
    title: {
      show: false,
    },
    colors: ['#ec0000', '#00da3c'],
    darkMode,
    animation: false,
    grid: [
      // 价格
      {
        top: '2%',
        left: '2%',
        width: '96%',
        height: '70%',
      }, // 成交量
      {
        top: '80%',
        left: '2%',
        width: '96%',
        height: '20%',
      },
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
      },
      position: function (pos, params, el, elRect, size) {
        const obj = {
          top: 10,
        };
        obj[['left', 'right'][+(pos[0] < size.viewSize[0] / 2)]] = 30;
        return obj;
      },
      formatter: function (params) {
        let text = `<div style="width: 200px"><div style="font-weight:bold;">${params[0].axisValue}</div>`; // 时间
        if (params[0].seriesName == '价格') {
          if (params[0].data.length) {
            return;
          }
          text += `<div style="display: flex; justify-content: space-between;"><span>现价:</span><span>${params[0].data.toFixed(
            2
          )}</span></div>`;
          text += `<div style="display: flex; justify-content: space-between;"><span>涨跌:</span><span>${
            ((params[0].data / zs) * 100 - 100).toFixed(2) + '%'
          }</span></div>`;
          text += `<div style="display: flex; justify-content: space-between;"><span>均价:</span><span>${params[1].data.toFixed(
            2
          )}</span></div>`;
          text += `<div style="display: flex; justify-content: space-between;"><span>成交量:</span><span>${
            params[2].data[1] + '手'
          }</span></div>`;
        }
        text += '</div>';
        return text;
      },
    },
    dataZoom: {
      type: 'inside',
      zoomOnMouseWheel: false,
      start: range ? range.start : 0,
      end: range ? range.end : 100,
      xAxisIndex: [0, 1],
    },
    axisPointer: {
      link: [
        {
          xAxisIndex: [0, 1],
        },
      ],
    },
    visualMap: [
      // 成交量
      {
        show: false,
        seriesIndex: 2,
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
      },
    ],
    series: [{}],
  };
}
function getTxAxis(data: string[]) {
  return [
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
      data,
    },
    // 成交量时间轴
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
  ];
}
function getTyAxis(darkMode: boolean, yMin: number, yMax: number) {
  return [
    // 价格
    {
      type: 'value',
      axisLabel: {
        show: false,
        // formatter: (value: string) => String(Number(value).toFixed(2)),
        // fontSize: 10,
      },
      axisLine: {
        show: false,
      },
      splitLine: {
        lineStyle: {
          color: darkMode ? 'rgba(255,255,255, 0.15)' : 'rgba(0, 0, 0, 0.15)',
          type: 'dashed',
        },
      },
      scale: true,
      position: 'right',
      min: yMin,
      max: yMax,
    },
    {
      type: 'value',
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      scale: true,
      gridIndex: 1,
      min: (value: any) => value.min,
      max: (value: any) => value.max,
    },
  ];
}
function getTMarkLineData(zs: number) {
  const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
  return [
    {
      name: '昨收',
      yAxis: zs,
      label: {
        color: variableColors['--hint-color'],
      },
      lineStyle: {
        color: variableColors['--hint-color'],
      },
    },
  ];
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
function getTrendFlows(fflows: Stock.FlowTrendItem[], color: string) {
  return [
    {
      name: '主力变化',
      type: 'bar',
      xAxisIndex: 2,
      yAxisIndex: 2,
      scale: true,
      data: fflows.map(({ mainDiff }) => mainDiff),
      itemStyle: {
        color: (item: { data: number }) => (item.data >= 0 ? increaseColor : reduceColor),
      },
    },
  ];
}
function setupTrendChart(darkMode: boolean, trends: Stock.TrendItem[], zs: number) {
  const options = getTBaseChartOptions(darkMode, undefined, zs);
  const dates = trends.map(({ datetime }) => datetime.split(' ')[1]);
  options.xAxis = getTxAxis(dates);
  const yMin = Math.min(...trends.map((t) => t.current)) * 0.999;
  const yMax = Math.max(...trends.map((t) => t.current)) * 1.001;
  options.yAxis = getTyAxis(darkMode, yMin, yMax);
  const { color } = Utils.GetValueColor(Number(trends[trends.length - 1]?.current) - zs);
  const markLines = getTMarkLineData(zs);
  options.series = [
    getTrendSeries(trends, color, markLines),
    getAvgSeries(trends),
    getVolSeries(trends.map(({ vol, up }, i) => [i, vol, up])),
  ];
  return options;
}
function updateTrendChart(opts: any, darkMode: boolean, trends: Stock.TrendItem[], zs: number) {
  opts.darkMode = darkMode;
  const dates = trends.map(({ datetime }) => datetime.split(' ')[1]);
  for (let i = 0; i < opts.xAxis.length; i++) {
    opts.xAxis[i].data = dates;
  }
  const yMin = Math.min(...trends.map((t) => t.current)) * 0.999;
  const yMax = Math.max(...trends.map((t) => t.current)) * 1.001;
  opts.yAxis[0].min = yMin;
  opts.yAxis[0].max = yMax;
  opts.series[0].data = trends.map(({ current }) => current); // 价格
  opts.series[1].data = trends.map(({ average }) => average); // 平均价格
  opts.series[2].data = trends.map(({ vol, up }, i) => [i, vol, up]); // 成交量
  return { ...opts };
}

const BKStockBrief: React.FC<BKStockBriefProps> = React.memo(
  ({ ktype, mtype, secid, markdate, active, moveTop, remove, openStock, outRange, outArea }) => {
    const config = useSelector((state: StoreState) => state.stock.stockConfigsMapping[secid]);
    const { ontrain, trainDate } = useSelector((state: StoreState) => state.setting.systemSetting);
    const { darkMode } = useHomeContext();
    const [detail, setDetail] = useState<Stock.DetailItem>({ secid });
    const { run: runGetDetail } = useRequest(Services.Stock.GetDetailFromEastmoney, {
      throwOnError: true,
      manual: true,
      onSuccess: (d) => {
        if (d) setDetail(d);
      },
      cacheKey: `GetDetailFromEastmoney/${secid}`,
    });
    useLayoutEffect(() => {
      runGetDetail(secid);
      Helpers.Stock.AppendStockDetailPush(secid, (data) => {
        if (data) {
          let changed = false;
          if (!isNaN(data.zx) && detail.zx != data.zx) {
            detail.zx = data.zx;
            changed = true;
          }
          if (!isNaN(data.zdf) && detail.zx != data.zx) {
            detail.zdf = data.zdf;
            changed = true;
          }
          if (!isNaN(data.zdd) && detail.zdd != data.zdd) {
            detail.zdd = data.zdd;
            changed = true;
          }
          if (!isNaN(data.hsl) && detail.hsl != data.hsl) {
            detail.hsl = data.hsl;
            changed = true;
          }
          if (!isNaN(data.zss) && detail.zss != data.zss) {
            detail.zss = data.zss;
            changed = true;
          }
          if (!isNaN(data.np) && detail.np != data.np) {
            detail.np = data.np;
            changed = true;
          }
          if (!isNaN(data.wp) && detail.wp != data.wp) {
            detail.wp = data.wp;
            changed = true;
          }
          if (!isNaN(data.jj) && detail.jj != data.jj) {
            detail.jj = data.jj;
            changed = true;
          }
          if (changed) {
            setDetail({ ...detail });
          }
        }
      });
      return () => {
        Helpers.Stock.RemoveStockDetailPush(secid);
      };
    }, [secid, detail]);
    const dispatch = useDispatch();
    const addStock = useCallback(() => {
      dispatch(addStockAction(detail, Helpers.Stock.GetStockType(secid)));
    }, [secid, detail]);
    const removeStock = useCallback(() => {
      if (config) {
        dispatch(deleteStockAction(secid));
      }
    }, [secid, detail]);
    const [klineData, setKLineData] = useState({
      klines: DefaultKTypes.map((_) => [] as Stock.KLineItem[]),
      shortMAS: DefaultKTypes.map((_) => DefaultMATypes.map((_) => [] as number[])),
      mediumMAS: DefaultKTypes.map((_) => DefaultMATypes.map((_) => [] as number[])),
      longMAS: DefaultKTypes.map((_) => DefaultMATypes.map((_) => [] as number[])),
      jax: DefaultKTypes.map((_) => [[], [], []]),
      dgwy: DefaultKTypes.map((_) => [[], [], []]),
    });
    const [klineCount, setKlineCount] = useState<number>(250);
    const [hasMoreK, setHasMoreK] = useState(true);
    const [kchartOptions, setKChartOptions] = useState<any>({});
    const { run: handeKline } = useThrottleFn(
      ({ ks, kt }) => {
        if (!ks || !ks.length) {
          console.error('handeKline, ks is undefined');
          return;
        }
        if (ontrain && trainDate.length > 0) {
          // 截断数据
          let stopIndex = -1;
          for (let i = ks.length - 1; i >= 0; i--) {
            if (ks[i].date == trainDate) {
              stopIndex = i;
              break;
            }
          }
          if (stopIndex > 0) {
            ks = ks.slice(0, stopIndex + 1);
          }
        }
        // 准备数据
        const sps = ks.map((_) => _.sp);
        const short = [Utils.calculateMA(5, sps), Utils.calculateMA(10, sps), Utils.calculateMA(20, sps)];
        const medium = [Utils.calculateMA(20, sps), Utils.calculateMA(40, sps), Utils.calculateMA(60, sps)];
        const long = [Utils.calculateMA(60, sps), Utils.calculateMA(120, sps), Utils.calculateMA(250, sps)];
        const jax = Utils.calculateJAX(ks, 10);
        const dgwy = Utils.calculateDGWY(ks, 15);
        const kIndex = DefaultKTypes.indexOf(kt);
        batch(() => {
          setHasMoreK(ks.length < klineCount);
          const newKlineData = {
            ...klineData,
            klines: {
              ...klineData.klines,
              [kIndex]: ks,
            },
            shortMAS: {
              ...klineData.shortMAS,
              [kIndex]: short,
            },
            mediumMAS: {
              ...klineData.mediumMAS,
              [kIndex]: medium,
            },
            longMAS: {
              ...klineData.longMAS,
              [kIndex]: long,
            },
            jax: {
              ...klineData.jax,
              [kIndex]: jax,
            },
            dgwy: {
              ...klineData.dgwy,
              [kIndex]: dgwy,
            },
          };
          setKLineData(newKlineData);
          const _mas =
            mtype === MAPeriodType.Short
              ? short
              : mtype === MAPeriodType.Medium
              ? medium
              : mtype === MAPeriodType.Long
              ? long
              : mtype === MAPeriodType.JAX
              ? jax
              : dgwy;
          const _manames =
            mtype === MAPeriodType.Short
              ? ['MA5', 'MA10', 'MA20']
              : mtype === MAPeriodType.Medium
              ? ['MA20', 'MA40', 'MA60']
              : mtype === MAPeriodType.Long
              ? ['MA60', 'MA120', 'MA250']
              : mtype === MAPeriodType.JAX
              ? ['JAX_L', 'JAX_S']
              : ['MID', 'UPPER', 'LOWER'];
          if (!kchartOptions[kIndex]) {
            kchartOptions[kIndex] = setupKlineChart(darkMode, outRange, ks, _mas[0], _mas[1], _mas[2], _manames);
          } else {
            kchartOptions[kIndex] = updateKChart(kchartOptions[kIndex], ks, _mas[0], _mas[1], _mas[2], _manames);
          }
          if (markdate && kt == KLineType.Day) {
            kchartOptions[kIndex].series[0].markLine.data = [{
              xAxis: markdate,
              lineStyle: {
                type: 'dashed',
                dashOffset: 20,
                color: '#FF9933',
                opacity: 0.5,
              },
            }];
          }
          setKChartOptions({
            ...kchartOptions,
          });
        });
      },
      {
        wait: 500,
      }
    );
    const { run: runGetKline } = useRequest(Services.Stock.GetKFromEastmoney, {
      throwOnError: true,
      manual: true,
      onSuccess: handeKline,
      cacheKey: `GetKFromEastmoney/${secid}`,
    });
    let areaStatic: Stock.KLineAreaItem | null = null;
    const kIndex = DefaultKTypes.indexOf(ktype);
    if (outArea && klineData.klines[kIndex].length) {
      const rs = [0, 0];
      klineData.klines[kIndex].forEach((k, i) => {
        if (k.date == outArea.start) {
          rs[0] = i;
        } else if (k.date == outArea.end) {
          rs[1] = i;
        }
      });
      if (rs[0] * rs[1] != 0) {
        const ks = klineData.klines[kIndex].slice(rs[0], rs[1] + 1);
        areaStatic = {
          start: outArea.start,
          end: outArea.end,
          kp: ks[0].kp,
          sp: ks[ks.length - 1].sp,
          zdf: (ks[ks.length - 1].sp - ks[0].kp) / ks[0].kp,
          days: ks.length,
          zghsl: Math.max(...ks.map((k) => k.hsl)),
          zdhsl: Math.min(...ks.map((k) => k.hsl)),
          avghsl: ks.reduce((s, a) => s + a.hsl, 0) / ks.length,
          avgcost: ks.map((k) => ((2 * k.sp + k.zg + k.zd) / 4) * k.cjl).reduce((s, a) => s + a, 0) / ks.reduce((s, k) => s + k.cjl, 0),
        } as Stock.KLineAreaItem;
      }
    }
    const { ref: kchartRef, chartInstance: kchart } = useResizeEchart(-1);
    useRenderEcharts(
      () => {
        const kIndex = DefaultKTypes.indexOf(ktype);
        if (kchartOptions[kIndex]) {
          kchart?.setOption(updateKRChart(kchartOptions[kIndex], darkMode, outRange, areaStatic?.avgcost), true);
        }
      },
      kchart,
      [darkMode, kchartOptions, outRange, outArea]
    );
    useLayoutEffect(() => {
      const kIndex = DefaultKTypes.indexOf(ktype);
      runGetKline(secid, ktype, klineCount);
      if (active) {
        const _mas =
          mtype === MAPeriodType.Short
            ? klineData.shortMAS[kIndex]
            : mtype === MAPeriodType.Medium
            ? klineData.mediumMAS[kIndex]
            : mtype === MAPeriodType.Long
            ? klineData.longMAS[kIndex]
            : mtype === MAPeriodType.JAX
            ? klineData.jax[kIndex]
            : klineData.dgwy[kIndex];
        const _manames =
          mtype === MAPeriodType.Short
            ? ['MA5', 'MA10', 'MA20']
            : mtype === MAPeriodType.Medium
            ? ['MA20', 'MA40', 'MA60']
            : mtype === MAPeriodType.Long
            ? ['MA60', 'MA120', 'MA250']
            : mtype === MAPeriodType.JAX
            ? ['JAX_L', 'JAX_S']
            : ['MID', 'UPPER', 'LOWER'];
        if (kchartOptions[kIndex]) {
          kchartOptions[kIndex] = updateKMARChart(kchartOptions[kIndex], darkMode, _mas[0], _mas[1], _mas[2], _manames);
          setKChartOptions({
            ...kchartOptions,
          });
        }
      }
    }, [secid, active, mtype, ktype]);
    useWorkDayTimeToDo(
      () => {
        runGetKline(secid, KLineType.Day, klineCount);
      },
      active ? CONST.DEFAULT.STOCK_TREND_DELAY : null
    );

    const [trendData, setTrendData] = useState({
      trends: [] as Stock.TrendItem[],
    });
    const [trendOption, setTrendOption] = useState<any>(undefined);
    const { run: handleTrends } = useThrottleFn(
      (trendd?: Stock.TrendItem[]) => {
        if (!trendd) {
          return;
        }
        let trends: Stock.TrendItem[] = [];
        if (trendData.trends.length > 0) {
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
        setTrendData(newTrendData);
        if (!trendOption) {
          setTrendOption(setupTrendChart(darkMode, trends || [], detail.zs / 100));
        } else {
          setTrendOption(updateTrendChart(trendOption, darkMode, trends, detail.zs / 100));
        }
      },
      {
        wait: 500,
      }
    );
    const { run: runGetTrends } = useRequest(Services.Stock.GetTrendFromEastmoney, {
      throwOnError: true,
      manual: true,
      onSuccess: (data) => {
        handleTrends(data.trends);
      },
      cacheKey: `GetStockTrendsAndFlows/${secid}`,
    });
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
          _.datetime = trainDate + ' ' + _.datetime.substring(0, 5);
        });
        handleTrends(processed);
      },
      cacheKey: `requestDealDay/${secid}`,
    });
    useLayoutEffect(() => {
      if (ontrain) {
        runGetHistTrends(secid, trainDate);
      } else {
        runGetTrends(secid);
        if (active) {
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
            handleTrends(data);
          });
          return () => {
            es.close();
          };
        }
      }
    }, [secid, active]);
    const { ref: tchartRef, chartInstance: tchart } = useResizeEchart(-1);
    useRenderEcharts(
      () => {
        if (trendOption) {
          trendOption.darkMode = darkMode;
          tchart?.setOption(trendOption, true);
        }
      },
      tchart,
      [trendOption, darkMode]
    );
    const onOpenStock = useCallback(() => openStock(secid, detail.name, detail.zdf), [secid, detail]);
    return (
      <aside className={classnames(styles.content)}>
        <div className={styles.toolbar}>
          <div className={styles.name}>
            <a onClick={onOpenStock}>{detail.name}</a>
            &nbsp;
            <span className={Utils.GetValueColor(detail.zdf).textClass}>{detail.zx}</span>
            &nbsp;
            <span className={Utils.GetValueColor(detail.zdf).textClass}>{Utils.Yang(detail.zdf)}%</span>
            &nbsp;
            {detail.lt && <span>{(detail.lt / 100000000).toFixed(2)}亿</span>}
            &nbsp;
            {areaStatic && (
              <>
                <span>
                  [{areaStatic.start.substring(5)},{areaStatic.end.substring(5)}]
                </span>
                &nbsp;
                <span>
                  [{areaStatic.kp},{areaStatic.sp},{(areaStatic.zdf * 100).toFixed(2)}%]
                </span>
                &nbsp;
                <span>
                  [{areaStatic.avghsl.toFixed(2)}, {areaStatic.zghsl}, {areaStatic.zdhsl}]
                </span>
                &nbsp;
                <span style={{ fontWeight: 'bold' }}>{areaStatic.avgcost.toFixed(2)}</span>
              </>
            )}
            &nbsp;
            <span style={{ fontWeight: 'bold', color: 'red'}}>不给亏损加仓！！</span>
          </div>
          <div>
            {config ? (
              <>
                <Button type="text" icon={<HeartFilled />} onClick={removeStock} />
              </>
            ) : (
              <Button type="text" icon={<HeartOutlined />} onClick={addStock} />
            )}
            &nbsp;
            {moveTop && <Button type="text" icon={<VerticalAlignTopOutlined />} onClick={() => moveTop(secid)} />}
            {remove && <Button type="text" icon={<MinusOutlined />} onClick={() => remove(secid)} />}
          </div>
        </div>
        <div
          ref={kchartRef}
          className={classnames(styles.echart, {
            [styles.hidden]: ktype == KLineType.Trend,
          })}
        />
        <div
          ref={tchartRef}
          className={classnames(styles.echart, {
            [styles.hidden]: ktype != KLineType.Trend,
          })}
        />
      </aside>
    );
  }
);

export default BKStockBrief;
