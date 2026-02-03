import React, { useEffect, useState } from 'react';
import styles from './index.scss';
import { Button, List, Row, Col } from 'antd';
import * as Utils from '@/utils';
import * as CONST from '@/constants';
import { useRenderEcharts, useResizeEchart } from '@/utils/hooks';
import { useHomeContext } from '@/components/FullHome';

export interface BackTestProps {
  result: Strategy.BackTestResult[];
  tradings: Strategy.BackTestTrading[];
  progress?: string;
  openStock: (secid: string, name: string) => void;
}

function getTBaseChartOptions(darkMode: boolean, range?: { start: number; end: number }) {
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
    series: [{}],
  };
}
function getTxAxis(data: string[]) {
  return {
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
  };
}
function getTyAxis(darkMode: boolean) {
  return {
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
  };
}
function getDataSeries(name: string, data: number[], color: string) {
  return {
    data,
    type: 'line',
    name,
    showSymbol: false,
    symbol: 'none',
    smooth: false,
    lineStyle: {
      width: 2,
      color,
    },
  };
}
function setupTrendChart(darkMode: boolean) {
  const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
  const increaseColor = variableColors['--increase-color'];
  const options = getTBaseChartOptions(darkMode, undefined);
  options.xAxis = getTxAxis([]);
  options.yAxis = getTyAxis(darkMode);
  options.series = [getDataSeries('净值', [], increaseColor), getDataSeries('指数', [], '#00b4d8')];
  return options;
}
function updateTrendChart(opts: any, darkMode: boolean, dates: string[], netVals: number[], indexVals: number[]) {
  opts.darkMode = darkMode;
  opts.xAxis.data = dates;
  opts.series[0].data = netVals;
  opts.series[1].data = indexVals;
  return { ...opts };
}

const BackTest: React.FC<BackTestProps> = React.memo(({ result, tradings, progress, openStock }) => {
  const { darkMode } = useHomeContext();
  const [trendOption] = useState<any>(setupTrendChart(darkMode));
  const { ref: tchartRef, chartInstance: tchart } = useResizeEchart(-1);
  useRenderEcharts(
    () => {
      const dates = [];
      const netVals = [];
      const indexVals = [];
      for (let i = 0; i < result.length; i++) {
        const r = result[i];
        dates.push(r.date);
        netVals.push((r.totalAmount / result[0].totalAmount).toFixed(4));
        indexVals.push((r.indexVal / result[0].indexVal).toFixed(4));
      }
      tchart?.setOption(updateTrendChart(trendOption, darkMode, dates, netVals, indexVals), true);
    },
    tchart,
    [result, darkMode]
  );
  return (
    <div className={styles.subcontainer}>
      <div className={styles.header}>{progress && <div style={{ marginLeft: 10, paddingTop: 3 }}>当前步骤：{progress}</div>}</div>
      <Row style={{ height: '100%' }}>
        <Col span={12} style={{ height: '100%' }}>
          <div ref={tchartRef} className={styles.echart} />
        </Col>
        <Col span={12} style={{ height: '100%' }}>
          <div className={styles.listContainer}>
            <List
              size="small"
              dataSource={tradings}
              renderItem={(t) => (
                <List.Item onClick={() => openStock(t.secid, t.name)}>
                  {[t.date, t.type == 'buy' ? '买入' : '卖出', `${t.name}(${t.secid})`, t.price.toFixed(2), t.count.toFixed(0)].join(' ')}
                </List.Item>
              )}
            />
          </div>
        </Col>
      </Row>
    </div>
  );
});
export default BackTest;
