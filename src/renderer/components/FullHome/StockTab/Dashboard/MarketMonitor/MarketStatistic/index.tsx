import { Stock } from '@/types/stock';
import { DatePicker } from 'antd';
import React, { useCallback, useEffect, useState } from 'react';
import styles from '../index.scss';
import * as CONST from '@/constants';
import * as Services from '@/services';
import { useRenderEcharts, useResizeEchart, useWorkDayTimeToDo } from '@/utils/hooks';
import { useRequest, useThrottleFn } from 'ahooks';
import { useHomeContext } from '@/components/FullHome';
import moment from 'moment';

export interface MarketStatisticProps { }
// const upColor = '#f44336';
// const downColor = '#4caf50';
function getTBaseChartOptions(darkMode: boolean) {
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
        top: '6%',
        left: '8%',
        width: '90%',
        height: '64%',
      },
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
      },
    },
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

function getTrendSeries(zts: number[], zbs: number[], colors: Record<string, string>) {
  return [
    {
      data: zts,
      type: 'line',
      name: '自然涨停',
      showSymbol: false,
      symbol: 'circle',
      smooth: false,
      lineStyle: {
        width: 2,
        opacity: 0.5,
        color: colors['--increase-color'],
      },
    },
    {
      data: zbs,
      type: 'line',
      name: '炸板',
      showSymbol: false,
      symbol: 'circle',
      smooth: false,
      lineStyle: {
        width: 2,
        color: colors['--reduce-color'],
      },
    },
  ];
}
function setupTrendChart(darkMode: boolean, times: string[], zts: number[], zbs: number[], colors: Record<string, string>) {
  const options = getTBaseChartOptions(darkMode);
  options.xAxis = getTxAxis(times);
  options.yAxis = getTyAxis(darkMode);
  options.series = getTrendSeries(zts, zbs, colors);
  return options;
}
function updateTrendChart(opts: any, darkMode: boolean, times: string[], zts: number[], zbs: number[], colors: Record<string, string>) {
  opts.darkMode = darkMode;
  for (let i = 0; i < opts.xAxis.length; i++) {
    opts.xAxis[i].data = times;
  }
  opts.series[0].data = zts;
  opts.series[1].data = zbs;
  opts.series[0].lineStyle.color = colors['--increase-color'];
  opts.series[1].lineStyle.color = colors['--reduce-color'];
  return { ...opts };
}
function updateTDarkChart(opts: any, darkMode: boolean) {
  opts.darkMode = darkMode;
  return { ...opts };
}

const MarketStatistic: React.FC<MarketStatisticProps> = React.memo(() => {
  const { darkMode, variableColors, lowKey } = useHomeContext();
  const [date, setDate] = useState(moment(new Date()).format('YYYY-MM-DD'));
  const [data, setData] = useState({
    nums: {
      DT: 0, // 跌停
      SZJS: 0, // 上涨家数
      XDJS: 0, // 下跌家数
      ZBL: 0.0, // 炸板率
      ZRZT: 0, // 自然涨停
      ZT: 0, // 涨停
      ZTZB: 0, // 炸板
    },
    times: [] as string[],
    zbs: [] as number[],
    zts: [] as number[],
  });
  const [trendOption, setTrendOption] = useState<any>(undefined);
  const { run: handleData } = useThrottleFn(
    (data: { nums: any; trend: any[] }) => {
      const times = [] as string[];
      const zts = [] as number[];
      const zbs = [] as number[];
      data.trend?.forEach((d: any[]) => {
        times.push(d[0]);
        zbs.push(d[1]);
        zts.push(d[2]);
      });
      setData({
        nums: data.nums,
        times,
        zbs,
        zts,
      });
      if (!trendOption) {
        setTrendOption(setupTrendChart(darkMode, times, zts, zbs, variableColors));
      } else {
        setTrendOption(updateTrendChart(trendOption, darkMode, times, zts, zbs, variableColors));
      }
    },
    {
      wait: 500,
    }
  );
  const { run: runGetData } = useRequest(Services.Stock.requestZTTrend, {
    throwOnError: true,
    manual: true,
    onSuccess: handleData,
    cacheKey: 'requestZTTrend',
  });
  const { ref: chartRef, chartInstance: chart } = useResizeEchart(-1);
  useRenderEcharts(
    () => {
      if (trendOption) {
        trendOption.darkMode = darkMode;
        trendOption.series[0].lineStyle.color = variableColors['--increase-color'];
        trendOption.series[1].lineStyle.color = variableColors['--reduce-color'];
        chart?.setOption(trendOption, true);
      }
    },
    chart,
    [darkMode, lowKey, trendOption]
  );
  useEffect(() => {
    if (!data.times.length) {
      runGetData(date);
    }
    if (trendOption) {
      setTrendOption(updateTDarkChart(trendOption, darkMode));
    }
  }, [darkMode]);
  useWorkDayTimeToDo(() => {
    runGetData(date);
  }, CONST.DEFAULT.STOCK_TREND_DELAY);
  const onChangeDate = useCallback((d: moment.Moment | null) => {
    if (d) {
      const nd = d.format('YYYY-MM-DD');
      setDate(nd);
      runGetData(nd);
    }
  }, []);
  return (
    <aside className={styles.content}>
      <div className={styles.toolbar}>
        <div className={styles.name}>赚钱效应&nbsp;</div>
        <div>
          <span>选择日期&nbsp;</span>
          <DatePicker onChange={onChangeDate} defaultValue={moment(new Date())} style={{ marginRight: 10 }} />
        </div>
      </div>
      {data.nums && (
        <div>
          <span>上涨家数:&nbsp;</span>
          <span className="text-up">{data.nums.SZJS}</span>
          &nbsp; &nbsp;
          <span>下跌家数:&nbsp;</span>
          <span className="text-down">{data.nums.XDJS}</span>
          <br />
          <span>涨停:&nbsp;</span>
          <span className="text-up">{data.nums.ZT}</span>
          &nbsp; &nbsp;
          <span>跌停:&nbsp;</span>
          <span className="text-down">{data.nums.DT}</span>
          &nbsp; &nbsp;
          <span>炸板:&nbsp;</span>
          <span className="text-down">{data.nums.ZTZB}</span>
        </div>
      )}
      <div ref={chartRef} className={styles.echart} />
    </aside>
  );
});

export default MarketStatistic;
