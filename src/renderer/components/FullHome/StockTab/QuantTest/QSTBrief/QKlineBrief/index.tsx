import { Stock } from '@/types/stock';
import React, { useCallback, useEffect, useState } from 'react';
import styles from '../index.scss';
import * as Helpers from '@/helpers';
import * as Services from '@/services';
import { useRenderEcharts, useResizeEchart } from '@/utils/hooks';
import { useRequest } from 'ahooks';
import { KLineType } from '@/utils/enums';
import * as Utils from '@/utils';
import * as CONST from '@/constants';
import { useHomeContext } from '@/components/FullHome';
import moment from 'moment';

export interface QKlineBriefProps {
  secid: string;
  tilDate: string;
  nexDate: string;
  range: { start: number; end: number };
  nexKline: Stock.KLineItem | undefined;
  onTilDate: (k: Stock.KLineItem) => void;
}

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
        height: '50%',
      }, // 成交量
      {
        top: '68%',
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
          text += `<div style="display: flex; justify-content: space-between;"><span>成交量:</span><span>${params[2].data[1] + '手'
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
            text += `<div style="display: flex; justify-content: space-between;"><span>涨跌:</span><span>${((params[0].data[2] / params[0].data[6]) * 100 - 100).toFixed(2) + '%'
              }</span></div>`;
          }
          if (params[0].data[7]) {
            text += `<div style="display: flex; justify-content: space-between;"><span>换手率:</span><span>${params[0].data[7].toFixed(2) + '%'
              }</span></div>`;
          }
          text += `<div style="display: flex; justify-content: space-between;"><span>成交量:</span><span>${(params[params.length - 1].data[1] / 10000).toFixed(2) + '万手'
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
      splitLine: { show: true },
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
    },
    markLine: {
      symbol: 'none',
      label: {
        show: true,
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
function setupKlineChart(darkMode: boolean, range: { start: number; end: number }, klines: Stock.KLineItem[]) {
  const dates = klines.map(({ date }) => date);
  const values = klines.map((_, i) => [_.kp, _.sp, _.zd, _.zg, _.chan, i == 0 ? 0 : klines[i - 1].sp, _.hsl, _.notes]);
  const vols = klines.map(({ kp, sp, cjl }, i) => [i, cjl, i != 0 && sp <= klines[i - 1].sp ? -1 : 1]);

  const options = getKBaseChartOptions(darkMode, range);
  options.xAxis = getKxAxis(dates);
  options.yAxis = getKyAxis(darkMode);
  options.series = [getKSeries(values), getVolSeries(vols)];
  return options;
}
function updateKChart(opts: any, klines: Stock.KLineItem[], range: { start: number; end: number }) {
  opts.dataZoom.start = range.start;
  opts.dataZoom.end = range.end;
  const dates = klines.map(({ date }) => date);
  const values = klines.map((_, i) => [_.kp, _.sp, _.zd, _.zg, _.chan, i == 0 ? 0 : klines[i - 1].sp, _.hsl, _.notes]);
  const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
  opts.visualMap[0].pieces[0].color = variableColors['--reduce-color'];
  opts.visualMap[0].pieces[1].color = variableColors['--increase-color'];
  opts.series[0].itemStyle = {
    color: variableColors['--increase-color'],
    color0: variableColors['--reduce-color'],
    borderColor: variableColors['--increase-color'],
    borderColor0: variableColors['--reduce-color'],
  };
  // K线
  opts.xAxis[0].data = dates;
  opts.series[0].data = values;
  const nextIndex = 1;
  // 成交量
  const vols = klines.map(({ kp, sp, cjl }, i) => [i, cjl, i != 0 && sp <= klines[i - 1].sp ? -1 : 1]);
  opts.xAxis[nextIndex].data = dates;
  opts.series[nextIndex].data = vols;
  return { ...opts };
}

const QKlineBrief: React.FC<QKlineBriefProps> = React.memo(({ secid, tilDate, nexKline, range, onTilDate }) => {
  const { darkMode } = useHomeContext();
  const [klines, setKlines] = useState<Stock.KLineItem[]>([]);
  const [kchartOptions] = useState(setupKlineChart(darkMode, range, []));
  const { ref: kchartRef, chartInstance: kchart } = useResizeEchart(-1);
  useRenderEcharts(
    () => {
      if (klines.length == 0) {
        return;
      }
      let endIdx = -1;
      for (let i = 0; i < klines.length; i++) {
        if (klines[i].date == tilDate) {
          endIdx = i;
          break;
        }
      }
      const tilKlines = endIdx > 0 ? klines.slice(0, endIdx + 1) : [];
      if (nexKline && nexKline.date != tilKlines[tilKlines.length - 1].date) {
        tilKlines.push(nexKline);
      }
      kchart?.setOption(updateKChart(kchartOptions, tilKlines, range), true);
    },
    kchart,
    [darkMode, kchartOptions, range, klines, nexKline]
  );
  const cb = useCallback(
    (ks: Stock.KLineItem[]) => {
      const isToday = tilDate == moment(new Date()).format('YYYY-MM-DD');
      let idx = 0;
      for (let i = 0; i < ks.length; i++) {
        if (ks[i].date == tilDate) {
          idx = i;
          break;
        }
      }
      const k = ks[isToday ? idx - 1 : idx];
      if (k) {
        onTilDate(k);
      }
    },
    [tilDate, onTilDate]
  );
  const { run: runGetkLines } = useRequest(Services.Stock.GetKFromEastmoney, {
    throwOnError: true,
    manual: true,
    onSuccess: (d) => {
      if (d.ks) {
        Helpers.Stock.QuantSetKlines(d.ks);
        setKlines(d.ks);
        cb(d.ks);
      }
    },
  });
  useEffect(() => {
    if (klines.length > 0) {
      cb(klines);
      return;
    }
    const saved = Helpers.Stock.QuantGetKline(secid);
    if (!saved.length) {
      runGetkLines(secid, KLineType.Day);
    } else {
      setKlines(saved);
      cb(saved);
    }
  }, [secid, tilDate]);
  return <div ref={kchartRef} className={styles.echart} />;
});

export default QKlineBrief;
