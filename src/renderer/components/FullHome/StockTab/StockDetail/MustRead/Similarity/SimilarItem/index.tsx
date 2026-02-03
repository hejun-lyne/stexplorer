import { StoreState } from '@/reducers/types';
import { Stock } from '@/types/stock';
import { DeleteColumnOutlined, DeleteOutlined, VerticalAlignTopOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import classnames from 'classnames';
import React, { useCallback, useLayoutEffect, useState } from 'react';
import { batch, useSelector } from 'react-redux';
import styles from './index.scss';
import * as Utils from '@/utils';
import * as Services from '@/services';
import * as CONST from '@/constants';
import { useRenderEcharts, useResizeEchart } from '@/utils/hooks';
import { useRequest, useThrottleFn } from 'ahooks';
import { DefaultKTypes, DefaultMATypes, KLineType, MAPeriodType } from '@/utils/enums';
import { useHomeContext } from '@/components/FullHome';

export interface SimilarItemProps {
    item: Stock.SimilarItem;
    ktype: KLineType;
    mtype: MAPeriodType;
    deleteItem?: (id: number) => void;
    openStock: (secid: string, name: string, change?: number) => void;
}
const reduceColor = '#388e3c';
const increaseColor = '#d32f2f';
const maColors = ['#00b4d8', '#06d6a0', '#e76f51', '#b5179e'];

function getKBaseChartOptions(darkMode: boolean, range?: { start: number; end: number }, zs?: number) {
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
                height: '80%',
            }, // 成交量
            {
                top: '88%',
                left: '2%',
                width: '96%',
                height: '12%',
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
                        color: reduceColor,
                    },
                    {
                        value: 1,
                        color: increaseColor,
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
            splitLine: { show: false },
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
            borderColor: variableColors['--increase-color'],
            borderColor0: variableColors['--reduce-color'],
        },
        markLine: {
            symbol: 'none',
            label: {
                show: false,
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
function getMASeries(ma1: any[], ma2: any[], ma3: any[], names: string[]) {
    const mas = [];
    if (ma1) {
        mas.push({
            name: names[0],
            type: 'line',
            silent: true,
            data: ma1,
            smooth: true,
            showSymbol: false,
            lineStyle: {
                width: 1,
                color: maColors[0],
            },
        });
    }
    if (ma2) {
        mas.push({
            name: names[1],
            type: 'line',
            silent: true,
            data: ma2,
            smooth: false,
            showSymbol: false,
            lineStyle: {
                width: 1,
                color: maColors[1],
            },
        });
    }
    if (ma3) {
        mas.push({
            name: names[2],
            type: 'line',
            silent: true,
            data: ma3,
            smooth: false,
            showSymbol: false,
            lineStyle: {
                width: 1,
                color: maColors[2],
            },
        });
    }
    return mas;
}
function setupKlineChart(
    darkMode: boolean,
    range: { start: number; end: number },
    markRange: { start: string; end: string},
    klines: Stock.KLineItem[],
    ma1: number[],
    ma2: number[],
    ma3: number[],
    manames: string[]
) {
    const dates = klines.map(({ date }) => date);
    const values = klines.map((_, i) => [_.kp, _.sp, _.zd, _.zg, _.chan, i == 0 ? 0 : klines[i - 1].sp, _.hsl, _.notes]);
    const zx = values[values.length - 1][1];
    const vols = klines.map(({ kp, sp, cjl }, i) => [i, cjl, i != 0 && sp <= klines[i - 1].sp ? -1 : 1]);

    const options = getKBaseChartOptions(darkMode, range);
    options.xAxis = getKxAxis(dates);
    options.yAxis = getKyAxis(darkMode);
    options.series = [getKSeries(values), getVolSeries(vols), ...getMASeries(ma1, ma2, ma3, manames)];
    options.series[0].markArea = {
        itemStyle: {
            color: 'rgba(255, 173, 177, 0.4)'
        },
        data: [
            [{
                name: '标记区域',
                xAxis: markRange.start,
            },
            {
                xAxis: markRange.end,
            }]
        ]
    };
    return options;
}
function updateKChart(opts: any, range: { start: number; end: number }, markRange: { start: string; end: string}, klines: Stock.KLineItem[], ma1: number[], ma2: number[], ma3: number[], manames: string[]) {
    const dates = klines.map(({ date }) => date);
    const values = klines.map((_, i) => [_.kp, _.sp, _.zd, _.zg, _.chan, i == 0 ? 0 : klines[i - 1].sp, _.hsl, _.notes]);
    // K线
    for (let i = 0; i < opts.xAxis.length - 1; i++) {
        opts.xAxis[i].data = dates;
    }
    opts.dataZoom.start = range ? range.start : 0;
    opts.dataZoom.end = range ? range.end : 100;
    opts.xAxis[0].data = dates;
    opts.series[0].data = values;
    const variableColors = Utils.getVariablesColor(CONST.VARIABLES);
    opts.series[0].itemStyle = {
        color: variableColors['--increase-color'],
        color0: variableColors['--reduce-color'],
        borderColor: variableColors['--increase-color'],
        borderColor0: variableColors['--reduce-color'],
    };
    opts.series[0].markArea = {
        itemStyle: {
            color: 'rgba(255, 173, 177, 0.4)'
        },
        data: [
            [{
                name: '标记区域',
                xAxis: markRange.start,
            },
            {
                xAxis: markRange.end,
            }]
        ]
    };
    // 资金流入
    const nextIndex = 1;
    // 成交量
    const vols = klines.map(({ kp, sp, cjl }, i) => [i, cjl, i != 0 && sp <= klines[i - 1].sp ? -1 : 1]);
    opts.series[nextIndex].data = vols;
    // 均线
    opts.series[nextIndex + 1].data = ma1;
    opts.series[nextIndex + 2].data = ma2;
    opts.series[nextIndex + 3].data = ma3;
    opts.series[nextIndex + 1].name = manames[0];
    opts.series[nextIndex + 2].name = manames[1];
    opts.series[nextIndex + 3].name = manames[2];
    return { ...opts };
}
function updateKMARChart(opts: any, darkMode: boolean, ma1: number[], ma2: number[], ma3: number[], manames: string[]) {
    opts.darkMode = darkMode;
    const maIndex = 1;
    // 均线
    opts.series[maIndex + 1].data = ma1;
    opts.series[maIndex + 2].data = ma2;
    if (opts.series[maIndex + 3]) {
        opts.series[maIndex + 3].data = ma3 || [];
        opts.series[maIndex + 3].name = manames[2] || '';
    }
    opts.series[maIndex + 1].name = manames[0];
    opts.series[maIndex + 2].name = manames[1];
    return { ...opts };
}

const SimilarItem: React.FC<SimilarItemProps> = React.memo(
    ({ item, ktype, mtype, deleteItem, openStock }) => {
        const {secid, name, startDate, endDate} = item;
        const { darkMode } = useHomeContext();
        const [klineData, setKLineData] = useState({
            klines: DefaultKTypes.map((_) => [] as Stock.KLineItem[]),
            shortMAS: DefaultKTypes.map((_) => DefaultMATypes.map((_) => [] as number[])),
            mediumMAS: DefaultKTypes.map((_) => DefaultMATypes.map((_) => [] as number[])),
            longMAS: DefaultKTypes.map((_) => DefaultMATypes.map((_) => [] as number[])),
            jax: DefaultKTypes.map((_) => [[], [], []]),
            dgwy: DefaultKTypes.map((_) => [[], [], []]),
        });
        const [klineCount, setKlineCount] = useState<number>(500);
        const [kchartOptions, setKChartOptions] = useState<any>({});
        const [range, setRange] = useState<any>();
        const { run: handeKline } = useThrottleFn(
            ({ ks, kt }) => {
                if (!ks || !ks.length) {
                    console.error('handeKline, ks is undefined');
                    return;
                }
                // 准备数据
                const sps = ks.map((_: any) => _.sp);
                const short = [Utils.calculateMA(5, sps), Utils.calculateMA(10, sps), Utils.calculateMA(20, sps)];
                const medium = [Utils.calculateMA(20, sps), Utils.calculateMA(40, sps), Utils.calculateMA(60, sps)];
                const long = [Utils.calculateMA(60, sps), Utils.calculateMA(120, sps), Utils.calculateMA(250, sps)];
                const jax = Utils.calculateJAX(ks, 10);
                const dgwy = Utils.calculateDGWY(ks, 15);
                const kIndex = DefaultKTypes.indexOf(kt);
                batch(() => {
                    const newKlineData = {
                        ...klineData,
                        klines: {
                            ...klineData.klines,
                            [kIndex]: ks,
                        },
                        shortMAS: {
                            ...klineData.shortMAS,
                            [kIndex]: short,
                        },
                        mediumMAS: {
                            ...klineData.mediumMAS,
                            [kIndex]: medium,
                        },
                        longMAS: {
                            ...klineData.longMAS,
                            [kIndex]: long,
                        },
                        jax: {
                            ...klineData.jax,
                            [kIndex]: jax,
                        },
                        dgwy: {
                            ...klineData.dgwy,
                            [kIndex]: dgwy,
                        },
                    };
                    setKLineData(newKlineData);
                    const _mas =
                        mtype === MAPeriodType.Short
                            ? short
                            : mtype === MAPeriodType.Medium
                                ? medium
                                : mtype === MAPeriodType.Long
                                    ? long
                                    : mtype === MAPeriodType.JAX
                                        ? jax
                                        : dgwy;
                    const _manames =
                        mtype === MAPeriodType.Short
                            ? ['MA5', 'MA10', 'MA20']
                            : mtype === MAPeriodType.Medium
                                ? ['MA20', 'MA40', 'MA60']
                                : mtype === MAPeriodType.Long
                                    ? ['MA60', 'MA120', 'MA250']
                                    : mtype === MAPeriodType.JAX
                                        ? ['JAX_L', 'JAX_S']
                                        : ['MID', 'UPPER', 'LOWER'];

                    // 计算显示区域
                    const allDates = ks.map((k: Stock.KLineItem) => k.date);
                    let [startIndex, endIndex] = [allDates.indexOf(startDate), allDates.indexOf(endDate)];
                    startIndex -= 20;
                    if (endIndex < ks.length - 21) {
                        endIndex += 20;
                    }
                    if (startIndex == -1 || endIndex == -1) {
                        // 需要往前加载
                        if (ks.length >= klineCount) {
                            setTimeout(() => {
                                const newKlineCount = klineCount + 250;
                                setKlineCount(newKlineCount);
                                runGetKline(secid, ktype, newKlineCount);
                            }, 100);
                        }
                    }
                    const rangeStartIndex = Math.max(0, Math.ceil((endIndex - 250) / allDates.length * 100);
                    const rangeEnd = endIndex == -1 ? 100 : Math.ceil((endIndex / allDates.length * 100));
                    const newRange = range || {
                        start: rangeStartIndex,
                        end: rangeEnd
                    };
                    const markRange = {
                        start: startDate,
                        end: endDate
                    }
                    if (!kchartOptions[kIndex]) {
                        kchartOptions[kIndex] = setupKlineChart(darkMode, range, markRange, ks, _mas[0], _mas[1], _mas[2], _manames);
                    } else {
                        kchartOptions[kIndex] = updateKChart(kchartOptions[kIndex], range, markRange, ks, _mas[0], _mas[1], _mas[2], _manames);
                    }
                    batch(() => {
                        if (!range) {
                            setRange(newRange);
                        }
                        setKChartOptions({
                            ...kchartOptions,
                        });
                    });
                });
            },
            {
                wait: 500,
            }
        );
        const { run: runGetKline } = useRequest(Services.Stock.GetKFromEastmoney, {
            throwOnError: true,
            manual: true,
            onSuccess: handeKline,
            cacheKey: `GetKFromEastmoney/${secid}`,
        });
        
        const { ref: kchartRef, chartInstance: kchart } = useResizeEchart(-1);
        useRenderEcharts(
            () => {
                const kIndex = DefaultKTypes.indexOf(ktype);
                if (kchartOptions[kIndex]) {
                    kchartOptions[kIndex].darkMode = darkMode;
                    kchartOptions[kIndex].dataZoom.start = range.start;
                    kchartOptions[kIndex].dataZoom.end = range.end;
                    kchart?.setOption(kchartOptions[kIndex], true);
                }
            },
            kchart,
            [darkMode, range, kchartOptions]
        );
        useLayoutEffect(() => {
            const kIndex = DefaultKTypes.indexOf(ktype);
            if (!klineData.klines[kIndex].length) {
                runGetKline(secid, ktype, klineCount);
            }
            const _mas =
                    mtype === MAPeriodType.Short
                        ? klineData.shortMAS[kIndex]
                        : mtype === MAPeriodType.Medium
                            ? klineData.mediumMAS[kIndex]
                            : mtype === MAPeriodType.Long
                                ? klineData.longMAS[kIndex]
                                : mtype === MAPeriodType.JAX
                                    ? klineData.jax[kIndex]
                                    : klineData.dgwy[kIndex];
                const _manames =
                    mtype === MAPeriodType.Short
                        ? ['MA5', 'MA10', 'MA20']
                        : mtype === MAPeriodType.Medium
                            ? ['MA20', 'MA40', 'MA60']
                            : mtype === MAPeriodType.Long
                                ? ['MA60', 'MA120', 'MA250']
                                : mtype === MAPeriodType.JAX
                                    ? ['JAX_L', 'JAX_S']
                                    : ['MID', 'UPPER', 'LOWER'];
                if (kchartOptions[kIndex]) {
                    kchartOptions[kIndex] = updateKMARChart(kchartOptions[kIndex], darkMode, _mas[0], _mas[1], _mas[2], _manames);
                    setKChartOptions({
                        ...kchartOptions,
                    });
                }
        }, [secid, mtype, ktype]);
        
        const onOpenStock = useCallback(() => openStock(secid, name), [secid]);
        const zoomOut = () => {
            if (range.start <= 5) {
              range.start = 0;
            } else {
              range.start -= 5;
            }
            setRange({
              ...range,
            });
          };
        const zoomIn = () => {
            if (range.end - range.start <= 10) {
              return;
            } else {
              range.start += 5;
            }
            setRange({
              ...range,
            });
          };
        return (
            <aside className={classnames(styles.content)}>
                <div className={styles.toolbar}>
                    <div className={styles.name}>
                        <a onClick={onOpenStock}>{name}</a>
                        &nbsp;
                        <span>{startDate}</span>
                        &nbsp;
                        -
                        &nbsp;
                        <span>{endDate}</span>
                    </div>
                    <div>
                        <Button type="text" icon={<ZoomInOutlined />} onClick={zoomIn} />
                        <Button type="text" icon={<ZoomOutOutlined />} onClick={zoomOut} />
                        {deleteItem && <Button type="text" icon={<DeleteOutlined />} onClick={() => deleteItem(item.id)} />}
                    </div>
                </div>
                <div
                    ref={kchartRef}
                    className={styles.echart}
                />
            </aside>
        );
    }
);

export default SimilarItem;
