import { Stock } from '@/types/stock';
import React, { useEffect, useState } from 'react';
import styles from '../index.scss';
import * as Helpers from '@/helpers';
import * as Utils from '@/utils';
import * as Services from '@/services';
import * as CONST from '@/constants';
import { useRenderEcharts, useResizeEchart } from '@/utils/hooks';
import { useRequest } from 'ahooks';
import { KLineType, StockMarketType } from '@/utils/enums';
import { useHomeContext } from '@/components/FullHome';
import moment from 'moment';
import { batch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';

export interface QHistTrendBriefProps {
  secid: string;
  tick: string;
  nexDate: string;
  zs: number;
  onTick: (secid: string, nk: Stock.KLineItem, flows: Stock.FlowTrendItem | null) => void;
}
const maColors = ['#00b4d8', '#06d6a0', '#e76f51', '#b5179e'];

function getTBaseChartOptions(darkMode: boolean, range?: { start: number; end: number }, zs?: number) {
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
        height: '50%',
      },
      // 成交量
      // {
      //   top: '70%',
      //   left: '2%',
      //   width: '96%',
      //   height: '30%',
      // },
      // 现金流
      {
        top: '70%',
        left: '2%',
        width: '96%',
        height: '30%',
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
          text += `<div style="display: flex; justify-content: space-between;"><span>涨跌:</span><span>${((params[0].data / zs) * 100 - 100).toFixed(2) + '%'
            }</span></div>`;
          text += `<div style="display: flex; justify-content: space-between;"><span>均价:</span><span>${params[1].data.toFixed(
            2
          )}</span></div>`;
          // text += `<div style="display: flex; justify-content: space-between;"><span>成交量:</span><span>${params[2].data[1] + '手'
          //   }</span></div>`;
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
    // visualMap: [
    //   // 成交量
    //   {
    //     show: false,
    //     seriesIndex: 2,
    //     dimension: 2,
    //     pieces: [
    //       {
    //         value: -1,
    //         color: reduceColor,
    //       },
    //       {
    //         value: 1,
    //         color: increaseColor,
    //       },
    //       {
    //         value: 2,
    //         color: 'gray',
    //       },
    //     ],
    //   },
    // ],
    series: [{}],
  };
}
function getTxAxis() {
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
        // fontSize: 10,
        show: false,
      },
    },
    // 成交量时间轴
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
    //   gridIndex: 1,
    //   splitNumber: 20,
    // },
    // 现金流时间轴
    {
      type: 'category',
      scale: true,
      boundaryGap: false,
      axisLine: {
        onZero: true,
        show: true,
      },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      gridIndex: 1,
      splitNumber: 20,
    },
  ];
}
function getTyAxis(darkMode: boolean) {
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
      min: (value: any) => value.min * 0.99,
      max: (value: any) => value.max * 1.01,
    },
    // {
    //   type: 'value',
    //   axisLabel: { show: false },
    //   axisLine: { show: false },
    //   axisTick: { show: false },
    //   splitLine: { show: false },
    //   scale: true,
    //   gridIndex: 1,
    //   min: (value: any) => value.min,
    //   max: (value: any) => value.max,
    // },
    {
      type: 'value',
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      scale: true,
      gridIndex: 1,
      min: -1,
      max: 1,
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
function getTrendSeries(markLines: any[]) {
  return {
    type: 'line',
    name: '价格',
    showSymbol: false,
    symbol: 'none',
    smooth: false,
    lineStyle: {
      width: 2,
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
function getAvgSeries() {
  return {
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
function getTrendFlows() {
  return [
    {
      name: '小单',
      type: 'line',
      xAxisIndex: 1,
      yAxisIndex: 1,
      scale: true,
      showSymbol: false,
      symbol: 'none',
      data: [],
      lineStyle: {
        width: 1,
        color: '#3B9925',
      },
    },
    {
      name: '中单',
      type: 'line',
      xAxisIndex: 1,
      yAxisIndex: 1,
      scale: true,
      showSymbol: false,
      symbol: 'none',
      data: [],
      lineStyle: {
        width: 1,
        color: '#5298DF',
      },
    },
    {
      name: '大单',
      type: 'line',
      xAxisIndex: 1,
      yAxisIndex: 1,
      scale: true,
      showSymbol: false,
      symbol: 'none',
      data: [],
      lineStyle: {
        width: 1,
        color: '#FEA800',
      },
    },
    {
      name: '超大单',
      type: 'line',
      xAxisIndex: 1,
      yAxisIndex: 1,
      scale: true,
      showSymbol: false,
      symbol: 'none',
      data: [],
      lineStyle: {
        width: 1,
        color: '#DF2B2D',
      },
    },
  ];
}
function setupTrendChart(darkMode: boolean) {
  const options = getTBaseChartOptions(darkMode, undefined);
  options.xAxis = getTxAxis();
  options.yAxis = getTyAxis(darkMode);
  options.series = [getTrendSeries([]), getAvgSeries(), /*getVolSeries([]),*/ ...getTrendFlows()];
  return options;
}
function updateTrendChart(
  opts: any,
  darkMode: boolean,
  trends: Stock.TrendItem[],
  fflows: Stock.FlowTrendItem[],
  vols: number[],
  zs: number
) {
  opts.darkMode = darkMode;
  const dates = trends.map(({ datetime }) => datetime);
  for (let i = 0; i < opts.xAxis.length; i++) {
    opts.xAxis[i].data = dates;
  }
  const yMin = Math.min(...trends.map((t) => t.current)) * 0.999;
  const yMax = Math.max(...trends.map((t) => t.current)) * 1.001;
  opts.yAxis[0].min = yMin;
  opts.yAxis[0].max = yMax;
  opts.series[0].lineStyle.color = Utils.GetValueColor(Number(trends[trends.length - 1]?.current) - zs).color;
  opts.series[0].data = trends.map(({ current }) => current); // 价格
  opts.series[1].data = trends.map(({ average }) => average); // 平均价格
  // opts.series[2].data = trends.map(({ vol, up }, i) => [i, vol, up]); // 成交量
  opts.series[2].data = [0].concat(fflows.map(({ small }, i) => (small / vols[i]).toFixed(2))); // 小单
  opts.series[3].data = [0].concat(fflows.map(({ medium }, i) => (medium / vols[i]).toFixed(2))); // 中单
  opts.series[4].data = [0].concat(fflows.map(({ big }, i) => (big / vols[i]).toFixed(2))); // 大单
  opts.series[5].data = [0].concat(fflows.map(({ superbig }, i) => (superbig / vols[i]).toFixed(2))); // 超大单
  return { ...opts };
}

const QHistTrendBrief: React.FC<QHistTrendBriefProps> = React.memo(({ secid, tick, nexDate, zs, onTick }) => {
  const { darkMode } = useHomeContext();
  const [trendData, setTrendData] = useState<Stock.TrendItem[]>([]);
  const [flowsData, setFlowsData] = useState<Stock.FlowTrendItem[]>([]);
  const { run: runGetTrends } = useRequest(Services.Stock.requestDealDay, {
    throwOnError: true,
    manual: true,
    onSuccess: setTrendData,
    cacheKey: `requestDealDay/${secid}`,
  });
  const { run: runDownloadFlows } = useRequest(Helpers.Stock.downloadStockFFlows, {
    throwOnError: true,
    manual: true,
    onSuccess: setFlowsData,
    cacheKey: `downloadStockFFlows/${secid}`,
  });
  const { accessToken } = useSelector((state: StoreState) => state.baidu);
  useEffect(() => {
    if (nexDate && nexDate != 'none' && Helpers.Stock.GetStockType(secid) == StockMarketType.AB) {
      console.log('请求dealDay: ' + secid + ' ' + nexDate);
      runGetTrends(secid, nexDate.replaceAll('-', ''));
      if (accessToken) {
        runDownloadFlows(accessToken, secid, nexDate, (msg) => {
          console.log(msg);
        });
      }
    }
  }, [secid, nexDate, accessToken]);
  const { ref: tchartRef, chartInstance: tchart } = useResizeEchart(-1);
  const [trendOptions] = useState<Record<string, any>>(setupTrendChart(darkMode));
  useRenderEcharts(
    () => {
      if (trendData.length > 0) {
        let tIdx = 0;
        const tickDatetime = moment(nexDate + ' ' + tick);
        for (let i = 0; i < trendData.length; i++) {
          const nDatetime = moment(nexDate + ' ' + trendData[i].datetime);
          if (nDatetime.isAfter(tickDatetime)) {
            tIdx = i == 0 ? i : i - 1;
            break;
          }
        }
        let trends = trendData.slice(0, tIdx + 1);
        const cjl = trends.reduce((a, s) => a + s.vol / 100, 0);
        // 只保留分钟
        trends = trends.filter(
          (t, i) => i == trends.length - 1 || trends[i + 1].datetime.substring(3, 5) != trends[i].datetime.substring(3, 5)
        );

        for (let i = 0; i < flowsData.length; i++) {
          const nDatetime = moment(flowsData[i].time);
          if (nDatetime.isAfter(tickDatetime)) {
            tIdx = i - 1;
            break;
          }
        }
        const fflows = flowsData.slice(0, tIdx + 1);
        const vols = fflows.map(
          ({ small, medium, big, superbig }) => (Math.abs(small) + Math.abs(medium) + Math.abs(big) + Math.abs(superbig)) / 2
        );
        const opts = updateTrendChart(trendOptions, darkMode, trends, fflows, vols, zs);
        tchart?.setOption(opts, true);
        batch(() => {
          if (trends.length > 0) {
            setTimeout(() => {
              // 生成新的k线
              const lf = fflows.slice(-1)[0];
              const v = vols.slice(-1)[0];
              const mf = lf
                ? {
                  time: lf.time,
                  main: (lf.superbig + lf.big) / v,
                  mainDiff: Math.abs(lf.superbig - lf.big) / v,
                  small: lf.small / v,
                  medium: lf.medium / v,
                  big: lf.big / v,
                  superbig: lf.superbig / v,
                }
                : null;
              const sp = trends[trends.length - 1].current;
              const k = {
                secid,
                type: KLineType.Day,
                date: nexDate,
                kp: trends[0].current,
                sp,
                zg: Math.max(...trends.map((_) => _.current)),
                zd: Math.min(...trends.map((_) => _.current)),
                zs,
                cjl,
                zdf: ((sp - zs) / zs) * 100,
                zde: sp - zs,
              } as Stock.KLineItem;
              onTick(secid, k, mf);
            }, 0);
          }
        });
      }
    },
    tchart,
    [darkMode, tick, trendData, nexDate]
  );
  return <div ref={tchartRef} className={styles.echart} />;
});

export default QHistTrendBrief;
