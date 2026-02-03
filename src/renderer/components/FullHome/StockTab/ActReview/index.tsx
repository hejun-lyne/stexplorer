import React, { useCallback, useState } from 'react';
import styles from './index.scss';
import { Stock } from '@/types/stock';
import { useRenderEcharts, useResizeEchart } from '@/utils/hooks';
import { Col, Row, Tabs } from 'antd';
import { useHomeContext } from '@/components/FullHome';
import { batch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { KLineType } from '@/utils/enums';
import * as Utils from '@/utils';
import * as Services from '@/services';
import { useRequest, useThrottleFn } from 'ahooks';

export interface ActReviewProps {
  onOpenStock: (secid: string, name: string) => void;
}

function computWinLose(type: string, tradings: Stock.DoTradeItem[], dates: string[]) {
  const acts = tradings.filter((t) => t.type === type);
  const tdates = [...new Set(tradings.map((t) => t.time.split(' ')[0]))].sort((a, b) => (a > b ? 1 : -1));
  const index = dates.indexOf(tdates[0]);
  const rates_b = [];
  const rates_s = [];
  const count = [];
  const win = [0, 0, 0];
  const lose = [0, 0, 0];
  for (let i = index; i < dates.length; i++) {
    let c = 0;
    acts.forEach((t) => {
      if (t.time.split(' ')[0] === dates[i]) {
        c += 1;
        for (let i = 0; i < win.length; i++) {
          if (t.profits[i]) {
            if (t.profits[i] > 0) win[i] += 1;
            else lose[i] += 1;
          }
        }
      }
    });
    rates_b.push(win.map((w: number, i: number) => (w / (w + lose[i])).toFixed(2)));
    rates_s.push(lose.map((l: number, i: number) => (l / (l + win[i])).toFixed(2)));
    count.push(c);
  }
  return {
    dates: dates.slice(index),
    rates_b,
    rates_s,
    count,
  };
}

const ActReview: React.FC<ActReviewProps> = React.memo(({ onOpenStock }) => {
  const { ref: chartRef, chartInstance } = useResizeEchart(-1);
  const { tradings, stocksMapping, nowHolds } = useSelector((state: StoreState) => state.stock);

  const { darkMode } = useHomeContext();
  const [currentBuyRate, setCurrentBuyRate] = useState<string[]>([]);
  const [currentSellRate, setCurrentSellRate] = useState<string[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const { run: updateEcharts } = useThrottleFn(
    () => {
      if (!dates.length) {
        return;
      }
      const brates = computWinLose('buy', tradings, dates);
      const srates = computWinLose('sell', tradings, dates);
      // 设置到chart
      chartInstance?.setOption({
        darkMode: darkMode,
        grid: [
          {
            left: '4%',
            top: '2%',
            width: '40%',
            height: '80%',
          },
          {
            left: '55%',
            top: '2%',
            width: '40%',
            height: '80%',
          },
        ],
        tooltip: {
          trigger: 'axis',
          axisPointer: {
            type: 'cross',
          },
        },
        xAxis: [
          {
            type: 'category',
            gridIndex: 0,
            splitLine: {
              show: false,
            },
            data: brates.dates,
          },
          {
            type: 'category',
            gridIndex: 1,
            splitLine: {
              show: false,
            },
            data: srates.dates,
          },
        ],
        yAxis: [
          {
            type: 'value',
            gridIndex: 0,
            axisLine: {
              show: true,
            },
            axisLabel: {
              formatter: (value: number) => value * 100 + '%',
            },
          },
          {
            type: 'value',
            gridIndex: 1,
            axisLine: {
              show: true,
            },
            axisLabel: {
              formatter: (value: number) => value * 100 + '%',
            },
          },
          {
            type: 'value',
            gridIndex: 0,
            axisLine: {
              show: true,
            },
            position: 'right',
            splitLine: {
              show: false,
            },
            min: 0,
            max: 10,
          },
          {
            type: 'value',
            gridIndex: 1,
            axisLine: {
              show: true,
            },
            position: 'right',
            splitLine: {
              show: false,
            },
            min: 0,
            max: 10,
          },
        ],
        series: [
          {
            name: '当日(B)',
            type: 'line',
            xAxisIndex: 0,
            yAxisIndex: 0,
            data: brates.rates_b.map((b) => b[0]),
            lineStyle: {
              width: 1,
            },
          },
          {
            name: '次日(B)',
            type: 'line',
            xAxisIndex: 0,
            yAxisIndex: 0,
            data: brates.rates_b.map((b) => b[1]),
            lineStyle: {
              width: 1,
            },
          },
          {
            name: '5日(B)',
            type: 'line',
            xAxisIndex: 0,
            yAxisIndex: 0,
            data: brates.rates_b.map((b) => b[2]),
            lineStyle: {
              width: 1,
            },
          },
          {
            name: '操作次数',
            type: 'bar',
            xAxisIndex: 0,
            yAxisIndex: 2,
            data: brates.count,
          },
          {
            name: '当日(S)',
            type: 'line',
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: srates.rates_s.map((b) => b[0]),
            lineStyle: {
              width: 1,
            },
          },
          {
            name: '次日(S)',
            type: 'line',
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: srates.rates_s.map((b) => b[1]),
            lineStyle: {
              width: 1,
            },
          },
          {
            name: '5日(S)',
            type: 'line',
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: srates.rates_s.map((b) => b[2]),
            lineStyle: {
              width: 1,
            },
          },
          {
            name: '操作次数',
            type: 'bar',
            xAxisIndex: 1,
            yAxisIndex: 3,
            data: srates.count,
          },
        ],
      });
      batch(() => {
        setCurrentBuyRate(brates.rates_b.slice(-1)[0]);
        setCurrentSellRate(srates.rates_s.slice(-1)[0]);
      });
    },
    {
      wait: 500,
    }
  );
  const { run: runGetKLines } = useRequest(Services.Stock.GetKFromEastmoney, {
    throwOnError: true,
    manual: true,
    onSuccess: ({ ks }) => {
      setDates(ks.map((_) => _.date));
      updateEcharts();
    },
  });
  useRenderEcharts(
    () => {
      if (dates.length == 0) {
        runGetKLines('1.000001', KLineType.Day, 250);
      } else {
        updateEcharts();
      }
    },
    chartInstance,
    [tradings, darkMode, dates]
  );
  const HoldRow = useCallback((h: Stock.NowHoldItem, zx: number) => {
    return (
      <div className={styles.row}>
        <Row>
          <Col span={4}>
            <a onClick={() => onOpenStock(h.secid, h.name)}>{h.name}</a>
          </Col>
          <Col span={4} className={Utils.GetValueColor(zx - h.price).textClass}>
            {zx}
          </Col>
          <Col span={4}>{(+h.price).toFixed(2)}</Col>
          <Col span={4}>{h.count}</Col>
          <Col span={4}>{(zx * h.count).toFixed(2)}</Col>
          <Col span={4} className={Utils.GetValueColor(zx - h.price).textClass}>
            {((zx - h.price) * h.count).toFixed(2)}
          </Col>
        </Row>
      </div>
    );
  }, []);
  const BuyRow = useCallback((t: Stock.DoTradeItem, zx: number) => {
    return (
      <div className={styles.row}>
        <Row>
          <Col span={2} style={{ textAlign: 'center' }}>
            <a onClick={() => onOpenStock(t.secid, t.name)}>{t.name}</a>
          </Col>
          <Col span={4}>{t.time}</Col>
          <Col span={18}>
            <Row>
              <Col span={2}>{zx}</Col>
              <Col span={2} className={Utils.GetValueColor(zx - t.price).textClass}>
                {t.price}
              </Col>
              <Col span={2}>{t.count}</Col>
              <Col span={3}>{(t.price * t.count).toFixed(2)}</Col>
              <Col span={4} className={Utils.GetValueColor(zx - t.stoplossAt).textClass}>
                {(t.stoplossAt || t.price * 0.9).toFixed(2)}({'-' + ((t.price - (t.stoplossAt || t.price * 0.9)) * t.count).toFixed(2)})
              </Col>
              <Col span={2} className={Utils.GetValueColor(t.profits[0]).textClass}>
                {t.profits[0].toFixed(2)}%
              </Col>
              <Col span={3} className={Utils.GetValueColor(t.profits[1]).textClass}>
                {t.profits[1].toFixed(2)}%
              </Col>
              <Col span={3} className={Utils.GetValueColor(t.profits[2]).textClass}>
                {t.profits[2].toFixed(2)}%
              </Col>
              <Col span={3} className={Utils.GetValueColor(t.profits[3]).textClass}>
                {t.profits[t.profits.length - 1].toFixed(2)}%
              </Col>
            </Row>
          </Col>
        </Row>
        <Row>
          <Col span={2}></Col>
          <Col span={22}>{t.explain}</Col>
        </Row>
      </div>
    );
  }, []);
  const SellRow = useCallback((t: Stock.DoTradeItem, zx: number) => {
    return (
      <div className={styles.row}>
        <Row>
          <Col span={2} style={{ textAlign: 'center' }}>
            <a onClick={() => onOpenStock(t.secid, t.name)}>{t.name}</a>
          </Col>
          <Col span={4}>{t.time}</Col>
          <Col span={18}>
            <Row>
              <Col span={3}>{zx}</Col>
              <Col span={3} className={Utils.GetValueColor(zx - t.price).textClass}>
                {t.price}
              </Col>
              <Col span={3}>{t.count}</Col>
              <Col span={3}>{(t.price * t.count).toFixed(2)}</Col>
              <Col span={3} className={Utils.GetValueColor(t.profits[0]).textClass}>
                {t.profits[0].toFixed(2)}%
              </Col>
              <Col span={3} className={Utils.GetValueColor(t.profits[1]).textClass}>
                {t.profits[1].toFixed(2)}%
              </Col>
              <Col span={3} className={Utils.GetValueColor(t.profits[2]).textClass}>
                {t.profits[2].toFixed(2)}%
              </Col>
              <Col span={3} className={Utils.GetValueColor(t.profits[3]).textClass}>
                {t.profits[t.profits.length - 1].toFixed(2)}%
              </Col>
            </Row>
          </Col>
        </Row>
        <Row>
          <Col span={2}></Col>
          <Col span={22}>{t.explain}</Col>
        </Row>
      </div>
    );
  }, []);
  return (
    <div>
      <Row style={{ textAlign: 'center', lineHeight: 2 }}>
        <Col span={12}>
          <span>买入成功率&nbsp;</span>
          {currentBuyRate.map((r, i) => (
            <span key={i} className={Utils.GetValueColor(+r - 0.5).textClass}>
              {(+r * 100).toFixed(2) + '%'}&nbsp;
            </span>
          ))}
        </Col>
        <Col span={12}>
          <span>卖出成功率&nbsp;</span>
          {currentSellRate.map((r, i) => (
            <span key={i} className={Utils.GetValueColor(+r - 0.5).textClass}>
              {(+r * 100).toFixed(2) + '%'}&nbsp;
            </span>
          ))}
        </Col>
      </Row>
      <div ref={chartRef} className={styles.chart} />
      <Tabs defaultActiveKey={'holds'}>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>持有</span>} key={'holds'}>
          <div className={styles.rowheader}>
            <Row>
              <Col span={4}>持有</Col>
              <Col span={4}>最新价</Col>
              <Col span={4}>成本价</Col>
              <Col span={4}>数量</Col>
              <Col span={4}>金额</Col>
              <Col span={4}>盈利/亏损</Col>
            </Row>
          </div>
          <div className={styles.table}>{nowHolds.map((h) => HoldRow(h, stocksMapping[h.secid] ? stocksMapping[h.secid].detail.zx : 0))}</div>
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>买入记录</span>} key={'buys'}>
          <div className={styles.rowheader}>
            <Row>
              <Col span={2} style={{ textAlign: 'center' }}>
                <span>买入</span>
              </Col>
              <Col span={4}>时间</Col>
              <Col span={18}>
                <Row>
                  <Col span={2}>最新价</Col>
                  <Col span={2}>成交价</Col>
                  <Col span={2}>成交量</Col>
                  <Col span={3}>成交额</Col>
                  <Col span={4}>止损价(可损失)</Col>
                  <Col span={2}>当日</Col>
                  <Col span={3}>次日</Col>
                  <Col span={3}>5日</Col>
                  <Col span={3}>今日</Col>
                </Row>
              </Col>
            </Row>
          </div>
          <div className={styles.table}>
            {tradings
              .filter((t) => t.type === 'buy')
              .sort((a, b) => b.id - a.id)
              .map((t) => BuyRow(t, stocksMapping[t.secid] ? stocksMapping[t.secid].detail.zx : 0))}
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>卖出记录</span>} key={'sells'}>
          <div className={styles.rowheader}>
            <Row>
              <Col span={2} style={{ textAlign: 'center' }}>
                <span>卖出</span>
              </Col>
              <Col span={4}>时间</Col>
              <Col span={18}>
                <Row>
                  <Col span={3}>最新价</Col>
                  <Col span={3}>成交价</Col>
                  <Col span={3}>成交量</Col>
                  <Col span={3}>成交额</Col>
                  <Col span={3}>当日</Col>
                  <Col span={3}>次日</Col>
                  <Col span={3}>5日</Col>
                  <Col span={3}>今日</Col>
                </Row>
              </Col>
            </Row>
          </div>
          <div className={styles.table}>
            {tradings
              .filter((t) => t.type === 'sell')
              .sort((a, b) => b.id - a.id)
              .map((t) => SellRow(t, stocksMapping[t.secid] ? stocksMapping[t.secid].detail.zx : 0))}
          </div>
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
});
export default ActReview;
