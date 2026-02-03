import React, { useEffect, useState } from 'react';
import styles from '../index.scss';
import * as Services from '@/services';
import { useRequest } from 'ahooks';
import { useRenderEcharts, useResizeEchart } from '@/utils/hooks';
import { useHomeContext } from '@/components/FullHome';
import { Col, Row } from 'antd';

export interface HolderNumProps {
  code: string;
}

const HolderNum: React.FC<HolderNumProps> = React.memo(({ code }) => {
  const [holderNums, setHolderNums] = useState<any>([]);
  const { run: runGetHolderNum } = useRequest(Services.Stock.GetHolderNumChanges, {
    throwOnError: true,
    manual: true,
    onSuccess: setHolderNums,
  });

  useEffect(() => {
    runGetHolderNum(code);
  }, []);

  const { darkMode } = useHomeContext();
  const { ref: chartRef, chartInstance } = useResizeEchart(0.2);
  useRenderEcharts(
    () => {
      chartInstance?.setOption({
        darkMode: darkMode,
        title: {
          text: '',
        },
        tooltip: {
          trigger: 'axis',
          position: 'inside',
          axisPointer: {
            type: 'cross',
          },
          textStyle: {
            color: darkMode ? 'rgba(50, 50, 50, 1)' : 'rgba(255,255,255,1)',
          },
          borderColor: darkMode ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)',
          backgroundColor: darkMode ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.75)',
        },
        grid: {
          left: 60,
          right: 60,
          bottom: 20,
          top: 20,
        },
        legend: {
          show: true,
        },
        xAxis: [
          {
            type: 'category',
            data: holderNums.map(({ END_DATE }) => END_DATE.substring(0, 10)),
            boundaryGap: false,
            scale: true,
          },
        ],
        yAxis: [
          {
            type: 'value',
            position: 'left',
            show: false,
          },
          {
            type: 'value',
            position: 'right',
            show: false,
          },
        ],
        series: [
          {
            name: '股东人数(万户)',
            type: 'bar',
            yAxisIndex: 0,
            barWidth: 50,
            data: holderNums.map(({ HOLDER_TOTAL_NUM }) => HOLDER_TOTAL_NUM / 10000.0),
          },
          {
            name: '股价(元)',
            type: 'line',
            yAxisIndex: 1,
            data: holderNums.map(({ PRICE }) => PRICE),
          },
        ],
      });
    },
    chartInstance,
    [darkMode, holderNums]
  );
  return (
    <div className={styles.holdernumWrapper}>
      <div ref={chartRef} style={{ width: '100%', height: 150 }} />
      <div className={styles.holdernumtable}>
        <Row gutter={5} style={{ marginBottom: 5, marginTop: 5 }} className={styles.rowheader}>
          <Col span={4}>变动时间</Col>
          <Col span={20}>
            <div className={styles.rowdata}>
              {holderNums && holderNums.map((h) => <div key={h.END_DATE}>{h.END_DATE.substring(0, 10)}</div>)}
            </div>
          </Col>
        </Row>
        <Row gutter={5}>
          <Col span={4}>股东总人数(户)</Col>
          <Col span={20}>
            <div className={styles.rowdata}>
              {holderNums && holderNums.map((h) => <div key={h.END_DATE}>{(h.HOLDER_TOTAL_NUM / 10000.0).toFixed(2)}万</div>)}
            </div>
          </Col>
        </Row>
        <Row gutter={5}>
          <Col span={4}>A股股东总人数(户)</Col>
          <Col span={20}>
            <div className={styles.rowdata}>
              {holderNums && holderNums.map((h) => <div key={h.END_DATE}>{(h.HOLDER_A_NUM / 10000.0).toFixed(2)}万</div>)}
            </div>
          </Col>
        </Row>
        <Row gutter={5}>
          <Col span={4}>股价(元)</Col>
          <Col span={20}>
            <div className={styles.rowdata}>{holderNums && holderNums.map((h) => <div key={h.END_DATE}>{(h.PRICE || 0).toFixed(2)}</div>)}</div>
          </Col>
        </Row>
        <Row gutter={5}>
          <Col span={4}>人均流通股(股)</Col>
          <Col span={20}>
            <div className={styles.rowdata}>
              {holderNums && holderNums.map((h) => <div key={h.END_DATE}>{(h.AVG_FREE_SHARES / 10000.0).toFixed(2)}万</div>)}
            </div>
          </Col>
        </Row>
        <Row gutter={5}>
          <Col span={4}>人均持股金额(元)</Col>
          <Col span={20}>
            <div className={styles.rowdata}>
              {holderNums && holderNums.map((h) => <div key={h.END_DATE}>{(h.AVG_HOLD_AMT / 10000.0).toFixed(2)}万</div>)}
            </div>
          </Col>
        </Row>
        <Row gutter={5}>
          <Col span={4}>筹码集中度</Col>
          <Col span={20}>
            <div className={styles.rowdata}>{holderNums && holderNums.map((h) => <div key={h.END_DATE}>{h.HOLD_FOCUS}</div>)}</div>
          </Col>
        </Row>
        <Row gutter={5}>
          <Col span={4}>十大股东合计</Col>
          <Col span={20}>
            <div className={styles.rowdata}>
              {holderNums &&
                holderNums.map((h) => <div key={h.END_DATE}>{!h.HOLD_RATIO_TOTAL ? '--' : h.HOLD_RATIO_TOTAL.toFixed(2) + '%'}</div>)}
            </div>
          </Col>
        </Row>
        <Row gutter={5}>
          <Col span={4}>十大流通股东合计</Col>
          <Col span={20}>
            <div className={styles.rowdata}>
              {holderNums &&
                holderNums.map((h) => (
                  <div key={h.END_DATE}>{!h.FREEHOLD_RATIO_TOTAL ? '--' : h.FREEHOLD_RATIO_TOTAL.toFixed(2) + '%'}</div>
                ))}
            </div>
          </Col>
        </Row>
      </div>
    </div>
  );
});
export default HolderNum;
