import { Stock } from '@/types/stock';
import { Button, Select } from 'antd';
import React, { useEffect, useState } from 'react';
import styles from '../index.scss';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
import * as Services from '@/services';
import { useRenderEcharts, useResizeEchart, useWorkDayTimeToDo } from '@/utils/hooks';
import { useRequest, useThrottleFn } from 'ahooks';
import { useHomeContext } from '@/components/FullHome';
import moment from 'moment';
import { MAPeriodType } from '@/utils/enums';
import { batch } from 'react-redux';
import { ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';

export interface MarketPeriodProps { }
const reduceColor = '#388e3c';
const increaseColor = '#d32f2f';
const maColors = ['#00b4d8', '#06d6a0', '#e76f51', '#b5179e'];

function getKBaseChartOptions(darkMode: boolean, range?: { start: number; end: number }) {
  return {
    title: {
      show: false,
    },
    colors: ['#ec0000', '#00da3c'],
    darkMode,
    animation: false,
    grid: [
      {
        top: '2%',
        left: '2%',
        width: '96%',
        height: '84%',
      },
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
      },
    },
    dataZoom: {
      type: 'inside',
      zoomOnMouseWheel: false,
      start: range ? range.start : 0,
      end: range ? range.end : 100,
    },
    axisPointer: {
      link: [
        {
          xAxisIndex: [0],
        },
      ],
    },
    series: [{}],
  };
}
function getKxAxis(data: string[]) {
  return [
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
  ];
}
function getKSeries(data: any[]) {
  return {
    name: 'K线',
    type: 'candlestick',
    data,
    itemStyle: {
      color: increaseColor,
      color0: reduceColor,
    },
  };
}
function getMASeries(ma1: any[], ma2: any[], ma3: any[], names: string[]) {
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
  ma1: number[],
  ma2: number[],
  ma3: number[],
  manames: string[],
  colors: Record<string, string>
) {
  const dates = klines.map(({ date }) => date.substring(5));
  const values = klines.map((_, i) => {
    const isYin = _.kp > _.sp;
    const color = isYin ? colors['--reduce-color'] : colors['--increase-color'];
    const borderColor = isYin ? colors['--reduce-color'] : colors['--increase-color'];
    return {
      value: [_.kp, _.sp, _.zd, _.zg],
      itemStyle: {
        color,
        borderColor,
      },
    };
  });
  const options = getKBaseChartOptions(darkMode, range);
  options.xAxis = getKxAxis(dates);
  options.yAxis = getKyAxis(darkMode);
  options.series = [getKSeries(values), ...getMASeries(ma1, ma2, ma3, manames)];
  return options;
}

function updateKChart(
  opts: any,
  klines: Stock.KLineItem[],
  ma1: number[],
  ma2: number[],
  ma3: number[],
  manames: string[],
  colors: Record<string, string>
) {
  const dates = klines.map(({ date }) => date.substring(5));
  const values = klines.map((_, i) => {
    const isYin = _.kp > _.sp;
    const color = isYin ? colors['--reduce-color'] : colors['--increase-color'];
    const borderColor = isYin ? colors['--reduce-color'] : colors['--increase-color'];
    return {
      value: [_.kp, _.sp, _.zd, _.zg],
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
  // 资金流入
  const nextIndex = 0;
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
  const maIndex = 0;
  // 均线
  opts.series[maIndex + 1].data = ma1;
  opts.series[maIndex + 2].data = ma2;
  opts.series[maIndex + 3].data = ma3;
  opts.series[maIndex + 1].name = manames[0];
  opts.series[maIndex + 2].name = manames[1];
  opts.series[maIndex + 3].name = manames[2];
  return { ...opts };
}
function updateKRChart(opts: any, range: { start: number; end: number }) {
  opts.dataZoom.start = range.start;
  opts.dataZoom.end = range.end;
  return { ...opts };
}

const MarketPeriod: React.FC<MarketPeriodProps> = React.memo(() => {
  const { darkMode, variableColors, lowKey } = useHomeContext();
  const [date, setDate] = useState(moment(new Date()).subtract(1, 'year').format('YYYY-MM-DD'));
  const [mtype, setMtype] = useState(MAPeriodType.Short);
  const [stype, setStype] = useState(0);
  const [klineData, setKLineData] = useState({
    ztks: [] as Stock.KLineItem[],
    rqks: [] as Stock.KLineItem[],
    shortMAS: [[], [], []] as string[][],
    mediumMAS: [[], [], []] as string[][],
    longMAS: [[], [], []] as string[][],
    jax: [[], []],
  });
  const [klineOption, setKLineOption] = useState<any>(undefined);
  const [krange, setKRange] = useState({
    start: 80,
    end: 100,
  });
  const { run: handleKlines } = useThrottleFn(
    ({ type, ks }) => {
      if (!ks || !ks.length) {
        console.error('handeKline, ks is undefined');
        return;
      }
      // 准备数据
      const sps = ks.map((_) => _.sp);
      const short = [Utils.calculateMA(5, sps), Utils.calculateMA(10, sps), Utils.calculateMA(20, sps)];
      const medium = [Utils.calculateMA(20, sps), Utils.calculateMA(40, sps), Utils.calculateMA(60, sps)];
      const long = [Utils.calculateMA(60, sps), Utils.calculateMA(120, sps), Utils.calculateMA(250, sps)];
      const jax = Utils.calculateJAX(ks, 5);
      const _mas = mtype === MAPeriodType.Short ? short : mtype === MAPeriodType.Medium ? medium : mtype === MAPeriodType.Long ? long : jax;
      const _manames =
        mtype === MAPeriodType.Short
          ? ['MA5', 'MA10', 'MA20']
          : mtype === MAPeriodType.Medium
            ? ['MA20', 'MA40', 'MA60']
            : mtype === MAPeriodType.Long
              ? ['MA60', 'MA120', 'MA250']
              : ['JAX_L', 'JAX_S'];
      batch(() => {
        const newKlineData = {
          ...klineData,
          shortMAS: short,
          mediumMAS: medium,
          longMAS: long,
          jax,
        };
        if (type == 0) {
          newKlineData.ztks = ks;
        } else {
          newKlineData.rqks = ks;
        }
        setKLineData(newKlineData);
        if (!klineOption) {
          setKLineOption(setupKlineChart(darkMode, krange, ks, _mas[0], _mas[1], _mas[2], _manames, variableColors));
        } else {
          setKLineOption(updateKChart(klineOption, ks, _mas[0], _mas[1], _mas[2], _manames, variableColors));
        }
      });
    },
    {
      wait: 500,
    }
  );
  const { run: runGetPeriods } = useRequest(Services.Stock.requestTopPerfKline, {
    throwOnError: true,
    manual: true,
    onSuccess: handleKlines,
    cacheKey: 'requestTopPerfKline',
  });
  const { ref: chartRef, chartInstance: chart } = useResizeEchart(-1, (e: any) => {
    const m = e.batch[0];
    setKRange({
      start: m.start,
      end: m.end,
    });
  });
  useRenderEcharts(
    () => {
      if (klineOption) {
        klineOption.darkMode = darkMode;
        klineOption.series[0].data.forEach((_) => {
          const isYin = _.value[0] > _.value[1];
          const color = isYin ? variableColors['--reduce-color'] : variableColors['--increase-color'];
          const borderColor = isYin ? variableColors['--reduce-color'] : variableColors['--increase-color'];
          _.itemStyle.color = color;
          _.itemStyle.borderColor = borderColor;
        });
        chart?.setOption(klineOption, true);
      }
    },
    chart,
    [darkMode, lowKey, klineOption]
  );
  useEffect(() => {
    const ks = stype == 0 ? klineData.ztks : klineData.rqks;
    if (!ks.length) {
      runGetPeriods(date, stype);
    }
    const _mas =
      mtype === MAPeriodType.Short
        ? klineData.shortMAS
        : mtype === MAPeriodType.Medium
          ? klineData.mediumMAS
          : mtype === MAPeriodType.Long
            ? klineData.longMAS
            : klineData.jax;
    const _manames =
      mtype === MAPeriodType.Short
        ? ['MA5', 'MA10', 'MA20']
        : mtype === MAPeriodType.Medium
          ? ['MA20', 'MA40', 'MA60']
          : mtype === MAPeriodType.Long
            ? ['MA60', 'MA120', 'MA250']
            : ['JAX_L', 'JAX_S'];
    if (klineOption) {
      setKLineOption(updateKMARChart(klineOption, darkMode, _mas[0], _mas[1], _mas[2], _manames));
    }
  }, [darkMode, mtype, stype]);
  useWorkDayTimeToDo(() => {
    runGetPeriods(date, 0);
  }, CONST.DEFAULT.STOCK_TREND_DELAY);
  const zoomOut = () => {
    if (krange.start == 0 || !klineOption) {
      return;
    }
    if (krange.start <= 5) {
      krange.start = 0;
    } else {
      krange.start -= 5;
    }
    batch(() => {
      setKRange({ ...krange });
      setKLineOption(updateKRChart(klineOption, krange));
    });
  };
  const zoomIn = () => {
    if (krange.end - krange.start <= 10 || !klineOption) {
      return;
    } else {
      krange.start += 5;
    }
    batch(() => {
      setKRange({ ...krange });
      setKLineOption(updateKRChart(klineOption, krange));
    });
  };

  return (
    <aside className={styles.content}>
      <div className={styles.toolbar}>
        <div className={styles.name}>市场周期&nbsp;</div>
        <div>
          <Select defaultValue={0} onChange={setStype} size="small">
            <Select.Option value={0}>情绪</Select.Option>
            <Select.Option value={20}>人气</Select.Option>
          </Select>
          &nbsp;
          <Select defaultValue={MAPeriodType.Short} onChange={setMtype} size="small">
            <Select.Option value={MAPeriodType.Short}>短期均线</Select.Option>
            <Select.Option value={MAPeriodType.Medium}>中期均线</Select.Option>
            <Select.Option value={MAPeriodType.Long}>长期均线</Select.Option>
            <Select.Option value={MAPeriodType.JAX}>济安线</Select.Option>
          </Select>
          &nbsp;
          <Button type="text" icon={<ZoomInOutlined />} onClick={zoomIn} />
          <Button type="text" icon={<ZoomOutOutlined />} onClick={zoomOut} />
        </div>
      </div>
      <div ref={chartRef} className={styles.echart} />
    </aside>
  );
});

export default MarketPeriod;
