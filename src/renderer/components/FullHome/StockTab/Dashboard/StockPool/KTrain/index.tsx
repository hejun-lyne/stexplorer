import React, { useLayoutEffect } from 'react';
import { Row, Col, DatePicker, Select, Button, Slider, List } from 'antd';
import { useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import styles from '../index.scss';
import * as Services from '@/services';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
import { useState } from 'react';
import { Stock } from '@/types/stock';
import { useRequest, useThrottleFn } from 'ahooks';
import { useCallback } from 'react';
import { useRenderEcharts, useResizeEchart, useWorkDayTimeToDo } from '@/utils/hooks';
import { batch } from 'react-redux';
import { SlidersOutlined, UnorderedListOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import { DefaultKTypes, DefaultMATypes, KLineType, MAPeriodType,  MAPeriodTypeNames, KlineTypeNames} from '@/utils/enums';
import { useHomeContext } from '@/components/FullHome';
import CheckableTag from 'antd/lib/tag/CheckableTag';
import { addTradeAction } from '@/actions/training';
const { ipcRenderer, makeWorkerExec } = window.contextModules.electron;

export interface KTrainProps {
  onOpenStock: (secid: string, name: string) => void;
  active: boolean;
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
        height: '70%',
      }, // 成交量
      {
        top: '78%',
        left: '2%',
        width: '96%',
        height: '22%',
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
  ma1: string[] | number[],
  ma2: string[] | number[],
  ma3: string[] | number[],
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
function updateKChart(opts: any, 
  klines: Stock.KLineItem[], 
  ma1: string[] | number[], 
  ma2: string[] | number[], 
  ma3: string[] | number[], 
  manames: string[],
  markLines: any[],
  replaceMarkLines = false) {
  const dates = klines.map(({ date }) => date);
  const values = klines.map((_, i) => [_.kp, _.sp, _.zd, _.zg, _.chan, i == 0 ? 0 : klines[i - 1].sp, _.hsl, _.notes]);
  // K线
  for (let i = 0; i < opts.xAxis.length; i++) {
    opts.xAxis[i].data = dates;
  }
  opts.xAxis[0].data = dates;
  opts.series[0].data = values;
  opts.series[0].markLine.data = replaceMarkLines ? markLines : opts.series[0].markLine.data.concat(markLines);
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
function updateKMAChart(opts: any, ma1: number[], ma2: number[], ma3: number[], manames: string[]) {
  const volIndex = 1;
  // 均线
  opts.series[volIndex + 1].data = ma1;
  opts.series[volIndex + 2].data = ma2;
  if (ma3) opts.series[volIndex + 3].data = ma3;
  opts.series[volIndex + 1].name = manames[0];
  opts.series[volIndex + 2].name = manames[1];
  if (ma3) opts.series[volIndex + 3].name = manames[2];
}
function updateKMARChart(opts: any, 
  darkMode: boolean, 
  range: { start: number; end: number },
  ma1: string[] | number[], 
  ma2: string[] | number[], 
  ma3: string[] | number[],
  manames: string[]) {
  opts.darkMode = darkMode;
  opts.dataZoom.start = range.start;
  opts.dataZoom.end = range.end;
  const startI = Math.floor((opts.series[0].data.length * range.start) / 100);
  const endI = Math.ceil((opts.series[0].data.length * range.end) / 100);
  const showed = opts.series[0].data.slice(startI, endI);
  opts.yAxis[0].min = Math.min(...showed.map((_) => _.zd)) * 0.99;
  opts.yAxis[0].max = Math.max(...showed.map((_) => _.zg)) * 1.01;

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

const KTrain: React.FC<KTrainProps> = ({ onOpenStock, active }) => {
    const { darkMode } = useHomeContext();
    const [loading, setLoading] = useState(false);
    const [current, setCurrent] = useState<Stock.DetailItem | null>(null);
    const [stocks, setStocks] = useState<Stock.DetailItem[]>([]);
    const [mtype, setMType] = useState<MAPeriodType>(MAPeriodType.Medium);
    const [typeIndex, setTypeIndex] = useState(4);
    const [klineData, setKLineData] = useState({
      klines: DefaultKTypes.map((_) => [] as Stock.KLineItem[]),
      shortMAS: DefaultKTypes.map((_) => DefaultMATypes.map((_) => [] as number[])),
      mediumMAS: DefaultKTypes.map((_) => DefaultMATypes.map((_) => [] as number[])),
      longMAS: DefaultKTypes.map((_) => DefaultMATypes.map((_) => [] as number[])),
      jax: DefaultKTypes.map((_) => [[] as number[], [] as number[], [] as number[]]),
      dgwy: DefaultKTypes.map((_) => [[] as number[], [] as number[], [] as number[]]),
    });
    const [kchartOptions, setKChartOptions] = useState<any>({});
    const [range, setRange] = useState({
      start: 50,
      end: 100,
    });
    const [tradings, setTradings] = useState<{date: string; price: number; type: string; count: number}[]>([]);
    const [done, setDone] = useState(false);
    const [krandIdx, setKrandIdx] = useState(0);
    const [krandDate, setKrandDate] = useState('');
    const [gettingSts, setGettingSts] = useState(false);
    const { run: runGetStocks } = useRequest(() => makeWorkerExec('getAllStocks', []), {
        throwOnError: true,
        manual: true,
        onSuccess: (data) => {
          setStocks(data);
          setGettingSts(false);
        },
    });
    const doGetStocks = () => {
      setGettingSts(true);
      runGetStocks();
    };
    const renderKline = useCallback((kIndex: number, klIndex: number, klDate: string, ks: Stock.KLineItem[], isDone = false, markLines:any[] = [], replaceMarkLines = false) => {
      let fks = ks;
      const mas =
                mtype === MAPeriodType.Short
                  ? klineData.shortMAS[kIndex]
                  : mtype === MAPeriodType.Medium
                  ? klineData.mediumMAS[kIndex]
                  : mtype === MAPeriodType.Long
                  ? klineData.longMAS[kIndex]
                  : mtype === MAPeriodType.JAX
                  ? klineData.jax[kIndex]
                  : klineData.dgwy[kIndex];
        const manames =
          mtype === MAPeriodType.Short
            ? ['MA5', 'MA10', 'MA20']
            : mtype === MAPeriodType.Medium
            ? ['MA20', 'MA40', 'MA60']
            : mtype === MAPeriodType.Long
            ? ['MA60', 'MA120', 'MA250']
            : mtype === MAPeriodType.JAX
            ? ['JAX_L', 'JAX_S']
            : ['MID', 'UPPER', 'LOWER'];

      let mas0 = mas[0];
      let mas1 = mas[1];
      let mas2 = mas[2];
      if (!isDone) {
        let randIdx = klIndex;
        if (kIndex == DefaultKTypes.indexOf(KLineType.Day)) {
          if (randIdx == 0) {
            randIdx = Math.floor(ks.length / 2 + Math.floor(Math.random() * (ks.length / 2 - 5)));
            setKrandIdx(randIdx);
            setKrandDate(ks[randIdx].date);
          }
          
        } else {
          // according by date
          for (let i = 0; i < ks.length; i++) {
            if (ks[i].date > klDate) {
              randIdx = i - 1;
              break;
            }
          }
        }
        fks = ks.slice(0, randIdx);
        mas0 = mas[0].slice(0, randIdx);
        mas1 = mas[1].slice(0, randIdx);
        mas2 = mas[2].slice(0, randIdx);
      }
      if (!kchartOptions[kIndex]) {
        kchartOptions[kIndex] = setupKlineChart(darkMode, range, fks, mas0, mas1, mas2, manames);
      } else {
        kchartOptions[kIndex] = updateKChart(kchartOptions[kIndex], fks, mas0, mas1, mas2, manames, markLines, replaceMarkLines);
      }
      setKChartOptions({
        ...kchartOptions,
      });
    }, [darkMode, range, kchartOptions, mtype]);

    const handleKline = useCallback(({ks, kt}) => {
      if (!ks?.length) {
        console.error('ks is undefined');
        return;
      }
      const sps = ks.map((_) => _.sp);
      const short = [Utils.calculateMA(5, sps), Utils.calculateMA(10, sps), Utils.calculateMA(20, sps)];
      const medium = [Utils.calculateMA(20, sps), Utils.calculateMA(40, sps), Utils.calculateMA(60, sps)];
      const long = [Utils.calculateMA(60, sps), Utils.calculateMA(120, sps), Utils.calculateMA(250, sps)];
      const jax = Utils.calculateJAX(ks as Stock.KLineItem[], 10);
      const dgwy = Utils.calculateDGWY(ks as Stock.KLineItem[], 15);
      const kIndex = DefaultKTypes.indexOf(kt);
      batch(() => {
        const newKlineData = {
          ...klineData,
          klines: {
            ...klineData.klines,
            [kIndex]: ks as Stock.KLineItem[],
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
        renderKline(kIndex, krandIdx, krandDate, ks);
        setLoading(false);
      });
    }, [krandIdx, krandDate]);
    const { run: runGetKline } = useRequest(Services.Stock.GetKFromEastmoney, {
        throwOnError: true,
        manual: true,
        onSuccess: handleKline,
    });
    const nextStock = useCallback(() => {
      if (loading) {
        return;
      }
      // 随机选择一个标的
      let len = stocks.length;
      if (len == 0) {
          console.error('stocks is empty');
          return;
      }
      const randIdx = Math.floor(Math.random() * len);
      const st = stocks[randIdx];
      batch(() => {
        setKLineData({
          klines: DefaultKTypes.map((_) => [] as Stock.KLineItem[]),
          shortMAS: DefaultKTypes.map((_) => DefaultMATypes.map((_) => [] as number[])),
          mediumMAS: DefaultKTypes.map((_) => DefaultMATypes.map((_) => [] as number[])),
          longMAS: DefaultKTypes.map((_) => DefaultMATypes.map((_) => [] as number[])),
          jax: DefaultKTypes.map((_) => [[] as number[], [] as number[], [] as number[]]),
          dgwy: DefaultKTypes.map((_) => [[] as number[], [] as number[], [] as number[]]),
        });
        setKChartOptions({});
        // setRange({
        //   start: 50,
        //   end: 100
        // });
        setTypeIndex(DefaultKTypes.indexOf(KLineType.Day));
        setKrandIdx(0);
        setTradings([]);
        setDone(false);
        setLoading(true);
      });
      setCurrent(st); // will trigger re-render, an re-render will trigger get klines
      
    }, [stocks, loading]);
    const nextDate = useCallback(() => {
      const ks = klineData.klines[typeIndex];
      if (krandIdx > 0 && krandIdx < ks.length - 1) {
        const idx = krandIdx + 1;
        const date = ks[krandIdx + 1].date;
        setKrandIdx(idx);
        setKrandDate(date);
        renderKline(typeIndex, idx, date, klineData.klines[typeIndex]);
      }
    }, [klineData, krandIdx, typeIndex]);
    
    const dispatch = useDispatch();
    const sellStock = useCallback((all: boolean) => {
      if (!current) {
        return;
      }
      let tds = tradings;
      const ks = klineData.klines[typeIndex];
      const sell_sp = ks[krandIdx - 1].sp;
      let total = tradings.reduce((h, t) => h += t.type == 'sell' ? -t.count : t.count, 0);
      if (total > 0) {
        const t = {
          date: ks[krandIdx - 1].date,
          price: sell_sp,
          type: 'sell',
          count: all ? total : 100
        };
        tds = tradings.concat([t]);
        setTradings(tds);
        total -= t.count;
      }
      const gain = tds.reduce((g, t) => {
        if (t.type == 'buy') {
          g.cost += t.price * t.count;
          g.count += t.count;
        } else {
          g.amount += t.price * t.count;
          g.count -= t.count;
        }
        return g;
      }, {cost: 0, amount: 0, count: 0});

      if (total <= 0) {
        dispatch(addTradeAction({
          secid: current.secid,
          name: current.name,
          buy_sp: tradings[0].price,
          buy_date: tradings[0].date,
          sell_sp,
          gain: gain.amount / gain.cost - 1,
        } as Training.Trade));
        setDone(true);
        setTradings([]);
      }

      const mls = [{
        name: '卖出',
        yAxis: sell_sp,
        lineStyle: {
          color: '#4caf50'
        }
      }];
      if (total > 0) {
        mls.push({
          name: '成本',
          yAxis: ((gain.cost - gain.amount) / gain.count),
          lineStyle: {
            color: '#f44336'
          }
        });
      }
      renderKline(typeIndex, krandIdx, '', klineData.klines[typeIndex], total <= 0, mls, total > 0);
    }, [typeIndex, krandIdx, klineData, tradings]);

    const buyStock = useCallback(() => {
      if (!current) {
        return;
      }
      const ks = klineData.klines[typeIndex];
      const buy_sp = ks[krandIdx - 1].sp;
      const trs = tradings.concat([{
        date: ks[krandIdx - 1].date,
        price: buy_sp,
        type: 'buy',
        count: 100
      }]);
      setTradings(trs);
      const gain = trs.reduce((g, t) => {
        if (t.type == 'buy') {
          g.cost += t.price * t.count;
          g.count += t.count;
        } else {
          g.amount += t.price * t.count;
          g.count -= t.count;
        }
        return g;
      }, {cost: 0, amount: 0, count: 0});
      renderKline(typeIndex, krandIdx, '', klineData.klines[typeIndex], false, [{
        name: '成本',
        yAxis: ((gain.cost - gain.amount) / gain.count).toFixed(2),
        lineStyle: {
          color: '#f44336', //#4caf50
        }
      }], true);
    }, [typeIndex, krandIdx, klineData, tradings]);

    const viewLatest = useCallback(() => {
      setDone(true);
      renderKline(typeIndex, krandIdx, '', klineData.klines[typeIndex], true);
    }, [typeIndex, krandIdx, klineData]);

    const onMAPeriodTypeChange = useCallback(
      (value: MAPeriodType) => {
        if (kchartOptions[typeIndex]) {
          let _mas =
            value === MAPeriodType.Short
              ? klineData.shortMAS[typeIndex]
              : value === MAPeriodType.Medium
              ? klineData.mediumMAS[typeIndex]
              : value === MAPeriodType.Long
              ? klineData.longMAS[typeIndex]
              : undefined;
          let _manames = MAPeriodTypeNames[value];
          const ks = klineData.klines[typeIndex];
          if (!_mas && value == MAPeriodType.JAX) {
            _mas = Utils.calculateJAX(ks, 10);
          }
          if (!_mas && value == MAPeriodType.DGWY) {
            _mas = Utils.calculateDGWY(ks, 15);
          }
          
          if (_mas) {
            const _manames = MAPeriodTypeNames[value];
            updateKMAChart(kchartOptions[typeIndex], _mas[0], _mas[1], _mas[2], _manames);
            setKChartOptions({
              ...kchartOptions,
            });
          }
          
          setMType(value);
        }
      },
      [typeIndex, kchartOptions]
    );
    const zoomOut = () => {
      if (range.start <= 5) {
        range.start = 0;
      } else {
        range.start -= 5;
      }
      setRange({
        ...range,
      });
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
    };
    const updateRange = ([s, e]) => {
      setRange({
        start: s,
        end: e,
      });
    };
    const changeTypeIndex = useCallback(
      (i) => {
        setTypeIndex(i);
        if (current) {
          if (i === 0) {
            // updateTrendsOption(trendData);
          } else {
            if (klineData.klines[i] && klineData.klines[i].length) {
              // updateKLineOption(klineData);
            } else {
              runGetKline(current.secid, DefaultKTypes[i], 500);
            }
          }
        }
      },
      [current, klineData]
    );
    const { ref: kchartRef, chartInstance: kchart } = useResizeEchart(-1);
    useRenderEcharts(
      () => {
        if (kchartOptions[typeIndex]) {
          const _mas =
          mtype === MAPeriodType.Short
            ? klineData.shortMAS[typeIndex]
            : mtype === MAPeriodType.Medium
            ? klineData.mediumMAS[typeIndex]
            : mtype === MAPeriodType.Long
            ? klineData.longMAS[typeIndex]
            : mtype === MAPeriodType.JAX
            ? klineData.jax[typeIndex]
            : klineData.dgwy[typeIndex];
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
          kchart?.setOption(updateKMARChart(kchartOptions[typeIndex], darkMode, range, _mas[0], _mas[1], _mas[2], _manames), true);
        }
      },
      kchart,
      [darkMode, kchartOptions, range, mtype, typeIndex]
    );
    useLayoutEffect(() => {
      if (active && current) {
        if (!klineData.klines[typeIndex].length) {
          runGetKline(current.secid, DefaultKTypes[typeIndex], 500);
        }
      }
    }, [active, typeIndex, current]);

    const ktrainings = useSelector((state: StoreState) => state.training.records);
    const alltrainings = ktrainings.reduce((s, curr) => {
      const arr: any[] = [];
      arr.push({ 
        date: curr.date,
        wins: curr.wins,
        lose: curr.lose,
        even: curr.even
      });
      return s.concat(arr.concat(curr.records));
    }, [] as any[]);
    return (
        <div className={styles.content}>
          <div className={styles.toolbar}>
            <div className={styles.name}>
              {current && <>
                <a onClick={()=> onOpenStock(current.secid, current.name)}>{current.name}</a>
              &nbsp;
              {current.lt && <span>{(current.lt / 100000000).toFixed(2)}亿</span>}
              </>}
              {!current && <>
              <span>Total Stocks({stocks.length}), </span>{gettingSts ? <span>正在请求...</span> :<a onClick={doGetStocks}>点击开始请求数据</a>}
              </>}
            </div>
            <div className={styles.actions}>
              <a className={styles.abtn} onClick={nextStock}>{loading ? '请求中...' : '下一标的'}</a>
              <a className={styles.abtn} onClick={nextDate}>下一日</a>
              &nbsp;
              <a className={styles.abtn} onClick={buyStock}>买入标的</a>
              &nbsp;
              <a className={styles.abtn} onClick={() => sellStock(false)}>卖出标的</a>
              &nbsp;
              <a className={styles.abtn} onClick={() => sellStock(true)}>清仓标的</a>
              &nbsp;
              <a className={styles.abtn} onClick={viewLatest}>最新走势</a>
              {/* <span>胜{wins}平{even}负{lose}，胜率: {(wins / (wins + lose + even)).toFixed(2)}</span> */}
            </div>
          </div>
          
          <div className={styles.chartwrapper}>
            <div
              style={{flex: 1, height: '100%'}}
            >
              <div className={styles.toolbar}>
            <div>
              {DefaultKTypes.slice(4).map((t, i) => (
                <CheckableTag key={t} checked={DefaultKTypes[typeIndex] === t} onChange={(checked) => changeTypeIndex(i + 4)}>
                  {KlineTypeNames[t]}
                </CheckableTag>
              ))}
              &nbsp;&nbsp;
            <Select defaultValue={MAPeriodType.Medium} onChange={onMAPeriodTypeChange} size="small">
              <Select.Option value={MAPeriodType.Short}>短期均线</Select.Option>
              <Select.Option value={MAPeriodType.Medium}>中期均线</Select.Option>
              <Select.Option value={MAPeriodType.Long}>长期均线</Select.Option>
              <Select.Option value={MAPeriodType.JAX}>济安线</Select.Option>
              <Select.Option value={MAPeriodType.DGWY}>登高望远</Select.Option>
            </Select>
            </div>
            <div style={{ display: 'flex' }}>
              <Slider
                range
                defaultValue={[20, 50]}
                style={{ width: 150, marginTop: 8, marginRight: 10 }}
                value={[range.start, range.end]}
                onChange={updateRange}
              />
              <Button type="text" icon={<ZoomInOutlined />} onClick={zoomIn} />
              <Button type="text" icon={<ZoomOutOutlined />} onClick={zoomOut} />
            </div>
          </div>
              <div ref={kchartRef} className={styles.chart}></div>
            </div>
            <div className={styles.trades} style={{width: 200, height: '100%'}}>
                <List 
                  size="small"
                  bordered={false}
                  split={false}
                  dataSource={alltrainings}
                  renderItem={(item, i) => (
                    <List.Item key={i} style={{ padding: 0 }}>
                      {item.date != undefined ? (
                      <div className={styles.tdate}>
                        <span>{item.date}</span>
                        &nbsp;&nbsp;
                        <span>{(100 * item.wins / (item.wins + item.lose + item.even)).toFixed(2)}%</span>
                      </div>
                      ) : (<div className={styles.trecord}>
                      <a onClick={()=> onOpenStock(item.secid, item.name)}>{item.name}</a><br />
                      <span>{item.buy_sp}</span>
                      &nbsp;&nbsp;
                      <span>{item.sell_sp}</span>
                      &nbsp;&nbsp;
                      <span>{(item.gain * 100).toFixed(2)}%</span>
                      </div>)}
                      
                    </List.Item>
                  )} />
            </div>
          </div>
        
        </div>
      );
}
export default KTrain;