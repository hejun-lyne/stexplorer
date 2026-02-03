import { Stock } from '@/types/stock';
import { DatePicker } from 'antd';
import React, { useCallback, useEffect, useState } from 'react';
import styles from '../index.scss';
import * as Helpers from '@/helpers';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
import { useRenderEcharts, useResizeEchart, useWorkDayTimeToDo } from '@/utils/hooks';
import { useRequest, useThrottleFn } from 'ahooks';
import { useHomeContext } from '@/components/FullHome';
import moment from 'moment';

export interface MarketMoodProps { }
const upColor = '#f44336';
const upBorderColor = '#8A0000';
const downColor = '#4caf50';
const downBorderColor = '#008F28';
function getTBaseChartOptions(darkMode: boolean, variableColors: Record<string, string>) {
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
        left: '10%',
        width: '80%',
        height: '84%',
      },
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
      },
    },
    visualMap: [
      // 主要情绪
      {
        type: 'piecewise',
        show: false,
        seriesIndex: [0],
        dimension: 1,
        pieces: [
          {
            min: 0.0,
            max: 1,
            color: variableColors['--increase-color'],
          },
          {
            min: 1.01,
            max: 10,
            color: variableColors['--strong-increase-color'],
          },
          {
            min: -2,
            max: 0,
            color: variableColors['--reduce-color'],
          },
          {
            min: -10,
            max: -2,
            color: variableColors['--strong-reduce-color'],
          },
        ],
        outOfRange: {
          symbol: 'rect',
          symbolSize: [1, 1],
          color: variableColors['--strong-increase-color'],
        },
      },
      // 敏感情绪
      {
        type: 'piecewise',
        show: false,
        seriesIndex: [1],
        dimension: 1,
        pieces: [
          {
            min: 0,
            max: 5,
            color: variableColors['--increase-color'],
          },
          {
            min: 5,
            max: 10,
            color: variableColors['--strong-increase-color'],
          },
          {
            min: -4,
            max: 0,
            color: variableColors['--reduce-color'],
          },
          {
            min: -10,
            max: -4,
            color: variableColors['--strong-reduce-color'],
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
      splitNumber: 10,
      axisPointer: {
        z: 100,
      },
      data,
    },
  ];
}
function getTyAxis(darkMode: boolean) {
  return [
    {
      type: 'value',
      scale: true,
      position: 'left',
      axisLabel: {
        interval: 0,
        formatter: '{value}%',
      },
      axisLine: {
        lineStyle: {
          color: '#b1afb3',
          width: 1,
        },
      },
      splitLine: {
        lineStyle: {
          color: darkMode ? 'rgba(255,255,255, 0.15)' : 'rgba(0, 0, 0, 0.15)',
          type: 'dashed',
        },
      },
      min: (value: any) => {
        return value.min > -4 ? -4 : value.min;
      },
      max: (value: any) => {
        return value.max < 6 ? 6 : value.max;
      },
    },
  ];
}
function getTMarkLineData() {
  return [
    {
      // silent: false,
      lineStyle: {
        //警戒线的样式  ，虚实  颜色
        width: 1,
        type: 'solid',
        symbol: 'circle',
        color: upBorderColor,
      },
      label: {
        position: 'end',
        formatter: '沸腾',
      },
      yAxis: 3,
    },
    {
      // silent: false,
      lineStyle: {
        //警戒线的样式  ，虚实  颜色
        width: 1,
        type: 'dotted',
        symbol: 'circle',
        color: upColor,
      },
      label: {
        position: 'end',
        formatter: '活跃',
      },
      yAxis: 1,
    },
    {
      // silent: false,
      lineStyle: {
        //警戒线的样式  ，虚实  颜色
        type: 'dashed',
        color: '#AAA',
      },
      label: {
        position: 'end',
        formatter: '及格',
      },
      yAxis: 0,
    },
    {
      // silent: false,
      lineStyle: {
        //警戒线的样式  ，虚实  颜色
        type: 'dashed',
        symbol: 'circle',
        color: downBorderColor,
      },
      label: {
        position: 'end',
        formatter: '冰凉',
      },
      yAxis: -2,
    },
    {
      // silent: false,
      lineStyle: {
        //警戒线的样式  ，虚实  颜色
        width: 1,
        type: 'solid',
        color: downBorderColor,
      },
      label: {
        position: 'end',
        formatter: '冰点',
      },
      yAxis: -4,
    },
  ];
}
function getTrendSeries(normal: Stock.MarketMoodItem[], sensitive: Stock.MarketMoodItem[], markLines: any[]) {
  return [
    {
      data: normal.map(({ value }) => value),
      type: 'line',
      name: '主要情绪',
      showSymbol: false,
      symbol: 'circle',
      smooth: false,
      lineStyle: {
        width: 2,
        opacity: 0.5,
      },
      markLine: {
        data: markLines,
      },
    },
    {
      data: sensitive.map(({ value }) => value),
      type: 'line',
      name: '敏感情绪',
      showSymbol: false,
      symbol: 'circle',
      smooth: false,
      lineStyle: {
        width: 2,
      },
    },
  ];
}
function setupTrendChart(
  darkMode: boolean,
  moods: { normal: Stock.MarketMoodItem[]; sensitive: Stock.MarketMoodItem[] },
  colors: Record<string, string>
) {
  const options = getTBaseChartOptions(darkMode, colors);
  const times = moods.normal.map(({ time }) => time);
  options.xAxis = getTxAxis(times);
  options.yAxis = getTyAxis(darkMode);
  const markLines = getTMarkLineData();
  options.series = getTrendSeries(moods.normal, moods.sensitive, markLines);
  return options;
}
function updateTrendChart(opts: any, darkMode: boolean, moods: { normal: Stock.MarketMoodItem[]; sensitive: Stock.MarketMoodItem[] }) {
  opts.darkMode = darkMode;
  const times = moods.normal.map(({ time }) => time);
  for (let i = 0; i < opts.xAxis.length; i++) {
    opts.xAxis[i].data = times;
  }
  opts.series[0].data = moods.normal.map(({ value }) => value);
  opts.series[1].data = moods.sensitive.map(({ value }) => value);
  return { ...opts };
}
function updateTDarkChart(opts: any, darkMode: boolean) {
  opts.darkMode = darkMode;
  return { ...opts };
}

const MarketMood: React.FC<MarketMoodProps> = React.memo(() => {
  const { darkMode, lowKey, variableColors } = useHomeContext();
  const [date, setDate] = useState(moment(new Date()).format('YYYY-MM-DD'));
  const [moods, setMoods] = useState({
    normal: [] as Stock.MarketMoodItem[],
    sensitive: [] as Stock.MarketMoodItem[],
  });
  const [trendOption, setTrendOption] = useState<any>(undefined);
  const { run: handleMoods } = useThrottleFn(
    (data) => {
      const newMoodData = {
        normal: data[0],
        sensitive: data[1],
      };
      setMoods(newMoodData);
      if (!trendOption) {
        setTrendOption(setupTrendChart(darkMode, newMoodData, variableColors));
      } else {
        setTrendOption(updateTrendChart(trendOption, darkMode, newMoodData));
      }
    },
    {
      wait: 500,
    }
  );
  const { run: runGetMoods } = useRequest(Helpers.Stock.GetMarketMood, {
    throwOnError: true,
    manual: true,
    onSuccess: handleMoods,
    cacheKey: 'GetMarketMood',
  });
  const { ref: chartRef, chartInstance: chart } = useResizeEchart(-1);
  useRenderEcharts(
    () => {
      if (trendOption) {
        trendOption.visualMap.forEach((m) =>
          m.pieces.forEach((_, i) => {
            if (i == 0) {
              _.color = variableColors['--increase-color'];
            } else if (i == 1) {
              _.color = variableColors['--strong-increase-color'];
            } else if (i == 2) {
              _.color = variableColors['--reduce-color'];
            } else if (i == 3) {
              _.color = variableColors['--strong-reduce-color'];
            }
          })
        );
        trendOption.darkMode = darkMode;
        chart?.setOption(trendOption, true);
      }
    },
    chart,
    [darkMode, lowKey, trendOption]
  );
  useEffect(() => {
    if (!moods.normal.length) {
      runGetMoods(date);
    }
    if (trendOption) {
      setTrendOption(updateTDarkChart(trendOption, darkMode));
    }
  }, [darkMode]);
  useWorkDayTimeToDo(() => {
    runGetMoods(date);
  }, CONST.DEFAULT.STOCK_TREND_DELAY);
  const onChangeDate = useCallback((d: moment.Moment | null) => {
    if (d) {
      const nd = d.format('YYYY-MM-DD');
      setDate(nd);
      runGetMoods(nd);
    }
  }, []);
  return (
    <aside className={styles.content}>
      <div className={styles.toolbar}>
        <div className={styles.name}>市场情绪&nbsp;</div>
        <div>
          <span>选择日期&nbsp;</span>
          <DatePicker onChange={onChangeDate} defaultValue={moment(new Date())} style={{ marginRight: 10 }} />
        </div>
      </div>
      <div ref={chartRef} className={styles.echart} />
    </aside>
  );
});

export default MarketMood;
