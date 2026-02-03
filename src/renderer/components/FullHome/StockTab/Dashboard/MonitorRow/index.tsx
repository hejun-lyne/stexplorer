import { StoreState } from '@/reducers/types';
import classnames from 'classnames';
import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import styles from './index.scss';
import * as Utils from '@/utils';
import * as CONST from '@/constants';
import { Stock } from '@/types/stock';
import { useRenderEcharts, useResizeEchart } from '@/utils/hooks';
import { useHomeContext } from '@/components/FullHome';
import { ChanType, KLineType, KlineTypeNames, KStateStrings, MAType } from '@/utils/enums';
import { Button, Switch, Tag } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';

export interface MonitorRowProps {
  secid: string;
  types: KLineType[];
  openDetail: (secid: string, name: string, change?: number) => void;
}
// 显示趋势缩略图
export const TrendChart: React.FC<{
  trends: Stock.TrendItem[];
  flows: Stock.FlowTrendItem[];
  zs: number;
}> = React.memo(({ trends = [], flows = [], zs = 0 }) => {
  const { ref: chartRef, chartInstance } = useResizeEchart(0.5);
  const { darkMode } = useHomeContext();
  const { lowKeySetting } = useSelector((state: StoreState) => state.setting.systemSetting);
  const variableColors = Utils.getVariablesColor(CONST.VARIABLES);

  useRenderEcharts(
    () => {
      const { color } = Utils.GetValueColor(Number(trends[trends.length - 1]?.current) - zs);
      chartInstance?.setOption({
        darkMode: darkMode,
        title: {
          text: '',
        },
        tooltip: {
          show: false,
        },
        grid: [
          {
            left: 0,
            right: 0,
            top: 2,
            height: '50%',
          },
          {
            left: 0,
            right: 0,
            height: '30%',
            top: '60%',
          },
        ],
        xAxis: [
          {
            type: 'category',
            data: trends.map(({ datetime }) => datetime),
            boundaryGap: false,
            show: false,
          },
          {
            gridIndex: 1,
            type: 'category',
            data: flows.map(({ time }) => time),
            boundaryGap: false,
            show: false,
          },
          {
            gridIndex: 1,
            type: 'category',
            data: flows.map(({ time }) => time),
            boundaryGap: false,
            show: false,
          },
        ],
        yAxis: [
          {
            type: 'value',
            show: false,
            scale: true,
            min: (value: any) => Math.min(value.min, zs),
            max: (value: any) => Math.max(value.max, zs),
          },
          {
            type: 'value',
            show: false,
            scale: true,
            gridIndex: 1,
            min: (value: any) => Math.min(value.min, 0),
            max: (value: any) => Math.max(value.max, 0),
          },
          {
            type: 'value',
            show: false,
            scale: true,
            gridIndex: 1,
            position: 'right',
            min: 'dataMin',
            max: 'dataMax',
          },
        ],
        series: [
          {
            data: trends.map(({ datetime, current }) => [datetime, current]),
            type: 'line',
            name: '价格',
            showSymbol: false,
            symbol: 'none',
            smooth: false,
            silent: true,
            lineStyle: { width: 1, color },
            markLine: {
              symbol: 'none',
              label: {
                show: false,
              },
              data: [
                {
                  name: '昨收',
                  yAxis: zs,
                  itemStyle: { color },
                },
              ],
            },
          },
          {
            name: '主力流入',
            type: 'line',
            showSymbol: true,
            symbol: 'none',
            smooth: false,
            lineStyle: {
              width: 1,
              opacity: 0.8,
            },
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: flows.map(({ main }) => main),
            markLine: {
              symbol: 'none',
              label: {
                show: false,
              },
              data: [
                {
                  name: '零值',
                  yAxis: 0,
                  itemStyle: {
                    color: color,
                  },
                },
              ],
            },
          },
          {
            name: '主力变化',
            type: 'bar',
            xAxisIndex: 2,
            yAxisIndex: 2,
            data: flows.map(({ mainDiff }) => mainDiff),
            itemStyle: {
              color: (item: { data: number }) => (item.data >= 0 ? variableColors['--increase-color'] : variableColors['--reduce-color']),
              opacity: 0.8,
            },
          },
        ],
        visualMap: {
          // top: 10,
          // right: 10,
          type: 'piecewise',
          show: false,
          seriesIndex: 1,
          dimension: 1,
          pieces: [
            { lt: 0, color: variableColors['--increase-color'] },
            { gt: 0, color: variableColors['--reduce-color'] },
            { value: 0, color: 'gray' },
          ],
        },
      });
    },
    chartInstance,
    [darkMode, zs, trends, flows, lowKeySetting]
  );
  return <div ref={chartRef} style={{ width: '100%' }} />;
});
const maColors = ['#00b4d8', '#06d6a0', '#e76f51', '#b5179e'];

const KLineChart: React.FC<{
  klines: Stock.KLineItem[];
  zs: number;
  ma5?: string[];
  ma10?: string[];
  ma20?: string[];
  ma30?: string[];
  chans?: Stock.ChanItem[];
  clines?: Stock.ChanLineItem[];
  cplatforms?: Stock.ChanPlatformItem[];
  cgspot?: number;
}> = React.memo(({ klines = [], zs = 0, ma5, ma10, ma20, ma30, chans, clines, cplatforms, cgspot }) => {
  const { ref: chartRef, chartInstance } = useResizeEchart(0.5);
  const { darkMode } = useHomeContext();
  const { lowKeySetting } = useSelector((state: StoreState) => state.setting.systemSetting);
  const { color } = Utils.GetValueColor(Number(klines[klines.length - 1]?.sp) - zs);
  const series = [
    {
      data: chans
        ? chans.map((_) => [
          _.type === ChanType.StepUp || _.type === ChanType.Bottom ? _.zd : _.zg,
          _.type === ChanType.StepUp || _.type === ChanType.Bottom ? _.zg : _.zd,
          _.zd,
          _.zg,
          _.type,
        ])
        : klines.map((_) => [_.kp, _.sp, _.zd, _.zg, _.chan]),
      type: 'candlestick',
      name: 'K线',
      showSymbol: false,
      symbol: 'none',
      smooth: false,
      silent: true,
      markLine: {
        symbol: 'none',
        label: {
          show: false,
        },
        data: [
          {
            name: '昨收',
            yAxis: zs,
            itemStyle: { color },
          },
        ],
      },
    },
  ];
  if (ma5) {
    series.push({
      name: 'MA5',
      type: 'line',
      data: ma5,
      smooth: true,
      showSymbol: false,
      lineStyle: {
        width: 1,
        color: maColors[0],
      },
    });
  }
  const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
  if (cgspot) {
    series[0].markLine.data.push({
      name: 'gspot',
      yAxis: cgspot,
      label: {
        color: variableColors['--warn-color'],
        backgroundColor: darkMode ? 'rgba(255,255,255,0.75)' : 'rgba(0, 0, 0, 0.75)',
        padding: 4,
        borderRadius: 3,
      },
      lineStyle: {
        color: variableColors['--hint-color'],
      },
    });
  }
  if (clines) {
    const lineData: any[] = [];
    clines.forEach((s, i) => {
      lineData.push([s.stokes[0].start.date, s.direction === 'up' ? s.stokes[0].start.zd : s.stokes[0].start.zg]);
      lineData.push([
        s.stokes[s.stokes.length - 1].end.date,
        s.direction === 'up' ? s.stokes[s.stokes.length - 1].end.zg : s.stokes[s.stokes.length - 1].end.zd,
      ]);
    });
    series.push({
      name: '缠线',
      type: 'line',
      symbol: 'none',
      data: lineData,
      lineStyle: {
        color: '#b5838d',
        width: 2,
      },
    });
  }
  if (cplatforms) {
    const areaData: any[] = [];
    const color = '#b5838d';
    cplatforms.forEach((p, i) => {
      areaData.push([
        {
          coord: [p.startDate, p.start],
          itemStyle: {
            color,
            opacity: 0.5,
          },
        },
        {
          coord: [p.endDate, p.end],
          itemStyle: {
            color,
            opacity: 0.5,
          },
        },
      ]);
    });
    series[0].markArea = {
      silent: true,
      data: areaData,
    };
  }
  if (ma10) {
    series.push({
      name: 'MA5',
      type: 'line',
      data: ma10,
      smooth: true,
      showSymbol: false,
      lineStyle: {
        width: 1,
        color: maColors[1],
      },
    });
  }
  if (ma20) {
    series.push({
      name: 'MA5',
      type: 'line',
      data: ma20,
      smooth: true,
      showSymbol: false,
      lineStyle: {
        width: 1,
        color: maColors[2],
      },
    });
  }
  if (ma30) {
    series.push({
      name: 'MA5',
      type: 'line',
      data: ma30,
      smooth: true,
      showSymbol: false,
      lineStyle: {
        width: 1,
        color: maColors[3],
      },
    });
  }
  useRenderEcharts(
    () => {
      const { color } = Utils.GetValueColor(Number(klines[klines.length - 1]?.sp) - zs);
      chartInstance?.setOption({
        darkMode: darkMode,
        title: {
          text: '',
        },
        tooltip: {
          show: false,
        },
        grid: {
          left: 2,
          right: 2,
          bottom: 0,
          top: 0,
        },
        xAxis: [
          {
            type: 'category',
            data: klines.map(({ date }) => date),
            boundaryGap: false,
            show: false,
          },
        ],
        yAxis: [
          {
            type: 'value',
            show: false,
            scale: true,
            min: (value: any) => Math.min(value.min, zs),
            max: (value: any) => Math.max(value.max, zs),
          },
        ],
        series,
      });
    },
    chartInstance,
    [darkMode, zs, klines, lowKeySetting]
  );
  return <div ref={chartRef} style={{ width: '100%' }} />;
});

const MonitorRow: React.FC<MonitorRowProps> = React.memo(({ secid, types, openDetail }) => {
  const [expanded, setExpanded] = useState(false);
  const [fractal, setFractal] = useState(false);
  const [type, setType] = useState(types[0]);
  const stock = useSelector((state: StoreState) => state.stock.stocksMapping[secid]);
  const config = useSelector((state: StoreState) => state.stock.stockConfigsMapping[secid]);
  let mas;
  if (type !== KLineType.Trend) {
    const values = stock && stock.klines[type] ? stock.klines[type].map((_) => _.sp) : [];
    mas = [Utils.calculateMA(5, values), Utils.calculateMA(10, values), Utils.calculateMA(20, values), Utils.calculateMA(30, values)];
  }

  return (
    <div className={styles.row}>
      {config && stock && (
        <>
          <div className={styles.zd}>
            <div
              style={{ display: 'flex', cursor: 'pointer' }}
              onClick={() => openDetail(stock.detail.secid, stock.detail.name, stock.detail.zdf)}
            >
              <div className={styles.zindexName}>{config.name}</div>
              {config.hybk && (
                <div className={styles.code}>{config.hybk.name.length > 5 ? config.hybk.name.substring(0, 4) : config.hybk.name}</div>
              )}
            </div>
            <div style={{ display: 'flex' }}>
              <div className={classnames(styles.zdd, Utils.GetValueColor(stock.detail.zdf).textClass)}>{stock.detail.zx}</div>
              <div className={classnames(styles.zdf, Utils.GetValueColor(stock.detail.zdf).textClass)}>
                {Utils.Yang(stock.detail.zdf)} %
              </div>
              <div className={styles.act}>
                <Button type="text" icon={!expanded ? <RightOutlined /> : <DownOutlined />} onClick={() => setExpanded(!expanded)} />
              </div>
            </div>
          </div>
          {expanded && (
            <>
              <div>
                {types.map((t) => (
                  <Tag.CheckableTag
                    key={t}
                    checked={type === t}
                    onChange={(checked) => setType(t)}
                    className={classnames({ [styles.unselected]: type !== t })}
                    style={{ marginRight: 5 }}
                  >
                    {KlineTypeNames[t]}
                  </Tag.CheckableTag>
                ))}
                <Switch checkedChildren="缠开" unCheckedChildren="缠关" onChange={setFractal} />
              </div>

              {stock.kstates && stock.kstates[type] && (
                <>
                  {stock.kstates[type] &&
                    stock.kstates[type][MAType.MA5] != undefined &&
                    KStateStrings[stock.kstates[type][MAType.MA5]] && (
                      <span style={{ marginRight: 5, color: maColors[0] }}>MA5:{KStateStrings[stock.kstates[type][MAType.MA5]]}</span>
                    )}

                  {stock.kstates[type] &&
                    stock.kstates[type][MAType.MA10] != undefined &&
                    KStateStrings[stock.kstates[type][MAType.MA10]] && (
                      <span style={{ marginRight: 5, color: maColors[1] }}>MA10:{KStateStrings[stock.kstates[type][MAType.MA10]]}</span>
                    )}

                  {stock.kstates[type] &&
                    stock.kstates[type][MAType.MA20] != undefined &&
                    KStateStrings[stock.kstates[type][MAType.MA20]] && (
                      <span style={{ marginRight: 5, color: maColors[2] }}>MA20:{KStateStrings[stock.kstates[type][MAType.MA20]]}</span>
                    )}

                  {stock.kstates[type] &&
                    stock.kstates[type][MAType.MA30] != undefined &&
                    KStateStrings[stock.kstates[type][MAType.MA30]] && (
                      <span style={{ color: maColors[3] }}>MA30:{KStateStrings[stock.kstates[type][MAType.MA30]]}</span>
                    )}
                </>
              )}
              <div>
                <div className={classnames(styles.value)}>
                  <div className={classnames(styles.zx, Utils.GetValueColor(stock.detail.zdf).textClass)}>
                    {type === KLineType.Trend && <TrendChart trends={stock.trends || []} flows={stock.tflows || []} zs={stock.detail.zs} />}
                    {type !== KLineType.Trend && (
                      <KLineChart
                        klines={fractal ? [] : stock.klines[type] || []}
                        ma5={mas[0]}
                        ma10={mas[1]}
                        ma20={mas[2]}
                        ma30={mas[3]}
                        zs={stock.detail.zs}
                        chans={fractal ? stock.chans[type] : undefined}
                        clines={stock.chanLines[type]}
                        cplatforms={stock.chanPlatforms[type]}
                        cgspot={stock.chanState[2]}
                      />
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
});
export default MonitorRow;
