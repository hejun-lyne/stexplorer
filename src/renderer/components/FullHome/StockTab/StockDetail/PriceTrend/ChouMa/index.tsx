import React, { useRef, useState } from 'react';
import * as Helpers from '@/helpers';
import styles from '../index.scss';
import { Stock } from '@/types/stock';
import { useRenderEcharts, useResizeEchart } from '@/utils/hooks';
import { Col, DatePicker, Row } from 'antd';
import { useHomeContext } from '@/components/FullHome';

export interface ChouMaProps {
  klines: Stock.KLineItem[];
  chooseIndex: number;
  chartHeight: number;
  priceRage: {
    start: number;
    end: number;
  };
}

const ChouMa: React.FC<ChouMaProps> = React.memo(({ klines, chooseIndex, chartHeight, priceRage }) => {
  console.log('chooseIndex', chooseIndex);
  const { ref: chartRef, chartInstance } = useResizeEchart(-1);
  const [startDate, setStartDate] = useState(klines.length ? klines[0].date : '');
  const [chouma, setChouma] = useState<Record<string, Stock.ChouMaItem>>({});
  const { darkMode } = useHomeContext();
  if (klines.length) {
    for (let i = 0; i < klines.length; i++) {
      if (!klines[i].date) {
        const cm = Helpers.Stock.ComputeChouMa(klines.slice(0, i + 1));
        if (cm) chouma[klines[i].date] = cm;
      }
    }
  }
  const showIndex = chooseIndex >= 0 ? chooseIndex : klines.length - 1;
  if (chooseIndex > klines.length - 1) {
    console.error('outofrange', chooseIndex, klines.length);
  }
  useRenderEcharts(
    () => {
      // 计算筹码分布，并设置展示
      let startIndex = 0;
      if (startDate) {
        for (let i = 0; i < klines.length; i++) {
          if (klines[i].date === startDate) {
            startIndex = i;
            break;
          }
        }
      }
      const cm = chouma[klines[showIndex].date];
      if (!cm) {
        return;
      }
      const showData = klines.slice(Math.floor((klines.length * priceRage.start) / 100), Math.ceil((klines.length * priceRage.end) / 100));
      const min = Math.min(...showData.map((d) => d.zd));
      const max = Math.max(...showData.map((d) => d.zg));
      const step = +cm.steps[1] - +cm.steps[0];
      if (+cm.steps[0] > min) {
        // 往下加数据
        let v = +cm.steps[0] - step;
        while (v >= min) {
          cm.steps.splice(0, 0, v.toFixed(2));
          v -= step;
        }
      }
      if (+cm.steps[cm.steps.length - 1] < max) {
        // 往上加数据
        let v = +cm.steps[cm.steps.length - 1] + step;
        while (v <= max) {
          cm.steps.push(v.toFixed(2));
          v += step;
        }
      }
      // 设置到chart
      chartInstance?.setOption({
        darkMode: darkMode,
        grid: {
          left: 35,
          right: 0,
          bottom: 3,
          top: 4,
        },
        xAxis: {
          type: 'value',
          boundaryGap: false,
          scale: true,
          splitLine: {
            show: false,
          },
          axisLine: {
            show: true,
          },
          axisLabel: {
            show: false,
          },
          min: 0,
          max: 3,
        },
        yAxis: {
          type: 'category',
          position: 'left',
          data: cm?.steps.filter((v) => +v >= min && +v <= max),
          axisLabel: {
            interval: 25,
            showMaxLabel: true,
            showMinLabel: true,
            fontSize: 10,
          },
        },
        series: {
          name: '筹码分布',
          type: 'bar',
          data: cm?.values,
        },
      });
      const newChouma = { ...chouma };
      newChouma[klines[showIndex].date] = cm;
      setChouma(newChouma);
    },
    chartInstance,
    [klines, startDate, chooseIndex, priceRage]
  );
  const cm = klines.length ? chouma[klines[showIndex].date] : undefined;
  return (
    <div style={{ height: '100%' }}>
      <div ref={chartRef} style={{ width: '100%', height: chartHeight + 12 }} />
      <div className={styles.chouma}>
        <div>
          <span>开始日期(计算起点)</span>
          <DatePicker onChange={(_, date) => setStartDate(date)} />
        </div>
        <div className={styles.row}>
          <div>{klines.length ? klines[showIndex].date : '--'}</div>
          {cm && (
            <div>
              {cm?.benefitRatio || 0 * 100}%({cm?.avgCost})
            </div>
          )}
        </div>
        {cm &&
          cm.percentChips.map((p, i) => (
            <div key={i}>
              <div className={styles.row}>
                <div>{p.percentile * 10}分位成本</div>
                <div>{p.priceRange.start + '-' + p.priceRange.end}</div>
              </div>
              <div className={styles.row}>
                <div>{p.percentile * 10}分位集中度</div>
                <div>{p.concentration}</div>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
});
export default ChouMa;
