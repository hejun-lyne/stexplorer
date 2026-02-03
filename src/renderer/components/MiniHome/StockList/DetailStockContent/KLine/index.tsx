import React, { useState, useCallback } from 'react';
import { useRequest } from 'ahooks';
import NP from 'number-precision';

import ChartCard from '@/components/Card/ChartCard';
import { useHomeContext } from '@/components/MiniHome';
import TypeSelection from '@/components/TypeSelection';
import { useResizeEchart, useRenderEcharts } from '@/utils/hooks';

import * as CONST from '@/constants';
import * as Services from '@/services';
import styles from './index.scss';
import { Utils } from 'react-sortablejs';

export interface PerformanceProps {
  secid: string;
}

const KLineTypeList = [
  { name: '日K', type: 101, code: 101 },
  { name: '周K', type: 102, code: 102 },
  { name: '月K', type: 103, code: 103 },
  { name: '5分钟', type: 5, code: 5 },
  { name: '15分钟', type: 15, code: 15 },
  { name: '30分钟', type: 30, code: 30 },
  { name: '60分钟', type: 60, code: 60 },
];

const KLine: React.FC<PerformanceProps> = ({ secid = '' }) => {
  const { ref: chartRef, chartInstance } = useResizeEchart(CONST.DEFAULT.ECHARTS_SCALE);
  const [kline, setKType] = useState(KLineTypeList[0]);
  const { variableColors, darkMode } = useHomeContext();
  const { run: runGetKFromEastmoney } = useRequest(Services.Stock.GetKFromEastmoney, {
    manual: true,
    throwOnError: true,
    cacheKey: `GetKFromEastmoney/${secid}/${kline.code}`,
    onSuccess: ({ ks }) => {
      const values = ks.map((_) => [_.kp, _.sp, _.zd, _.zg]);
      chartInstance?.setOption({
        title: {
          text: '',
          left: 0,
        },
        tooltip: {
          trigger: 'axis',
          axisPointer: {
            type: 'cross',
          },
        },
        legend: {
          data: ['日K', 'MA5', 'MA10', 'MA20', 'MA30'],
          textStyle: {
            color: variableColors['--main-text-color'],
            fontSize: 10,
          },
        },
        grid: {
          left: 0,
          right: 5,
          bottom: 0,
          containLabel: true,
        },
        xAxis: {
          type: 'category',
          data: result.map(({ date }) => date),
        },
        yAxis: {
          scale: true,
        },
        dataZoom: [
          {
            type: 'inside',
            start: 80,
            end: 100,
          },
        ],
        series: [
          {
            name: '日K',
            type: 'candlestick',
            data: values,
            itemStyle: {
              color: variableColors['--increase-color'],
              color0: variableColors['--reduce-color'],
            },
            markPoint: {
              data: [
                {
                  name: '最高值',
                  type: 'max',
                  valueDim: 'highest',
                },
                {
                  name: '最低值',
                  type: 'min',
                  valueDim: 'lowest',
                },
                {
                  name: '平均值',
                  type: 'average',
                  valueDim: 'close',
                },
              ],
            },
          },
          {
            name: 'MA5',
            type: 'line',
            data: Utils.calculateMA(5, values),
            smooth: true,
            showSymbol: false,
            symbol: 'none',
            lineStyle: {
              opacity: 0.5,
            },
          },
          {
            name: 'MA10',
            type: 'line',
            data: Utils.calculateMA(10, values),
            smooth: true,
            showSymbol: false,
            symbol: 'none',
            lineStyle: {
              opacity: 0.5,
            },
          },
          {
            name: 'MA20',
            type: 'line',
            data: Utils.calculateMA(20, values),
            smooth: true,
            showSymbol: false,
            symbol: 'none',
            lineStyle: {
              opacity: 0.5,
            },
          },
          {
            name: 'MA30',
            type: 'line',
            data: Utils.calculateMA(30, values),
            smooth: true,
            showSymbol: false,
            symbol: 'none',
            lineStyle: {
              opacity: 0.5,
            },
          },
        ],
      });
    },
  });

  useRenderEcharts(
    () => {
      runGetKFromEastmoney(secid, kline.code);
    },
    chartInstance,
    [darkMode, secid, kline.code]
  );

  const freshChart = useCallback(() => {
    runGetKFromEastmoney(secid, kline.code);
  }, [secid, kline.code]);

  return (
    <ChartCard onFresh={freshChart}>
      <div className={styles.content}>
        <div ref={chartRef} style={{ width: '100%' }} />
        <TypeSelection types={KLineTypeList} activeType={kline.type} onSelected={setKType} colspan={6} />
      </div>
    </ChartCard>
  );
};

export default KLine;
