import React, { useEffect, useMemo, useState } from 'react';
import { Spin } from 'antd';
import * as Services from '@/services';
import * as Utils from '@/utils';
import * as CONST from '@/constants';
import { KLineType } from '@/utils/enums';
import { useNativeThemeColor, useRenderEcharts, useResizeEchart } from '@/utils/hooks';
import { Stock } from '@/types/stock';
import { SHORT_SCORE_SOURCE } from '@/helpers/shortTermScoreList';
import { GetCompanyFromTushare } from '@/services/tushare';

/** 面板日K线取数条数（约半年） */
const PANEL_KLINE_LIMIT = 120;
/** 涨/跌颜色兜底（主题变量取不到时使用） */
const UP_COLOR_FALLBACK = '#d32f2f';
const DOWN_COLOR_FALLBACK = '#388e3c';
const MA_COLORS = ['#00b4d8', '#06d6a0', '#e76f51'];
const MA_PERIODS = [5, 10, 20];

/** 公司简介内存缓存（secid -> 简介），来回切换股票时不重复取数 */
const introCache = new Map<string, string>();

/** 迷你日K线 option（K线 + 均线 + 成交量，单屏不可缩放滚动） */
function buildKlineOption(klines: Stock.KLineItem[]) {
  const colors = Utils.getVariablesColor(CONST.VARIABLES);
  const upColor = colors['--increase-color'] || UP_COLOR_FALLBACK;
  const downColor = colors['--reduce-color'] || DOWN_COLOR_FALLBACK;
  const textColor = colors['--main-text-color'] || '#666';
  const secondaryColor = colors['--hint-color'] || '#999';
  const splitColor = 'rgba(128, 128, 128, 0.25)';
  // tooltip 必须显式指定底色/边框：默认是白底，暗黑模式下用主题主文字色（浅色）会变成「白底灰字」看不清
  const tooltipBg = colors['--inner-color'] || colors['--background-color'] || '#fff';
  const tooltipBorder = colors['--border-color'] || 'rgba(128, 128, 128, 0.35)';
  const pointerLabelBg = colors['--primary-color'] || '#888';

  const dates = klines.map((k) => k.date);
  // candlestick 数据顺序：[开盘, 收盘, 最低, 最高]
  const values = klines.map((k) => [k.kp, k.sp, k.zd, k.zg]);
  const closes = klines.map((k) => k.sp);
  const vols = klines.map((k, i) => [i, k.cjl, i > 0 && k.sp < klines[i - 1].sp ? -1 : 1]);

  return {
    animation: false,
    grid: [
      { left: 6, right: 48, top: 20, height: '56%' },
      { left: 6, right: 48, top: '75%', height: '18%' },
    ],
    xAxis: [
      {
        type: 'category',
        data: dates,
        gridIndex: 0,
        boundaryGap: true,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: splitColor } },
        axisLabel: { fontSize: 10, color: secondaryColor, hideOverlap: true },
        splitLine: { show: false },
      },
      {
        type: 'category',
        data: dates,
        gridIndex: 1,
        boundaryGap: true,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: splitColor } },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
    ],
    yAxis: [
      {
        scale: true,
        gridIndex: 0,
        position: 'right',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 10, color: secondaryColor, formatter: (v: number) => Number(v).toFixed(2) },
        splitLine: { lineStyle: { color: splitColor, type: 'dashed' } },
      },
      {
        scale: true,
        gridIndex: 1,
        position: 'right',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
    ],
    axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
        label: {
          // 十字准星的日期/数值标签：跟随主题主色 + 白字，暗黑模式下也看得清
          backgroundColor: pointerLabelBg,
          color: '#fff',
          fontSize: 10,
          borderWidth: 0,
        },
      },
      confine: true,
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      borderWidth: 1,
      padding: [6, 8],
      textStyle: { fontSize: 11, color: textColor },
      extraCssText: 'box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2); border-radius: 4px;',
      formatter: (params: any) => {
        const bar: any = (params || []).find((p: any) => p.seriesType === 'candlestick');
        if (!bar) {
          return '';
        }
        const [open, close, low, high] = bar.data;
        const rows: string[] = [
          `<div style="font-weight:bold;margin-bottom:4px">${bar.axisValue}</div>`,
          `开 <b>${Number(open).toFixed(2)}</b>　收 <b>${Number(close).toFixed(2)}</b>`,
          `高 <b>${Number(high).toFixed(2)}</b>　低 <b>${Number(low).toFixed(2)}</b>`,
        ];
        (params || [])
          .filter((p: any) => p.seriesType === 'line' && !Number.isNaN(Number(p.data)))
          .forEach((p: any) => {
            rows.push(`${p.seriesName} <b>${Number(p.data).toFixed(2)}</b>`);
          });
        return rows.join('<br/>');
      },
    },
    series: [
      {
        name: 'K线',
        type: 'candlestick',
        data: values,
        itemStyle: {
          color: upColor,
          color0: downColor,
          borderColor: upColor,
          borderColor0: downColor,
        },
      },
      ...MA_PERIODS.map((period, i) => ({
        name: `MA${period}`,
        type: 'line',
        data: Utils.calculateMA(period, closes),
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1, color: MA_COLORS[i] },
      })),
      {
        name: '成交量',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: vols,
        itemStyle: {
          color: (p: any) => (p.data?.[2] === -1 ? downColor : upColor),
        },
      },
    ],
  };
}

export interface ScoreStockPanelProps {
  code: string;
  secid: string;
  name: string;
  /** 点击名字/代码打开股票详情 */
  onOpenStock: (secid: string, name: string) => void;
}

/**
 * 评分结果列表右侧的个股信息面板
 *
 * 从上往下：名字+代码（点击打开详情）→ 公司简介 → 日K线。
 * 日K线与短线评分同源（Tushare），训练模式下由取数层自动截断到训练日。
 */
const ScoreStockPanel: React.FC<ScoreStockPanelProps> = ({ code, secid, name, onOpenStock }) => {
  const [intro, setIntro] = useState('');
  const [introLoading, setIntroLoading] = useState(false);
  const [klines, setKlines] = useState<Stock.KLineItem[]>([]);
  const [klineLoading, setKlineLoading] = useState(false);
  const [klineError, setKlineError] = useState('');

  // 公司简介：Tushare 优先，取不到时回退东财（内容更全）
  useEffect(() => {
    let canceled = false;
    const cached = introCache.get(secid);
    if (cached != null) {
      setIntro(cached);
      setIntroLoading(false);
      return () => {
        canceled = true;
      };
    }
    setIntro('');
    setIntroLoading(true);
    (async () => {
      let text = '';
      try {
        const company = await GetCompanyFromTushare(secid);
        text = company?.gsjs || '';
      } catch {
        text = '';
      }
      if (!text) {
        try {
          const company = await Services.Stock.GetABCompany(secid);
          text = company?.gsjs || '';
        } catch {
          text = '';
        }
      }
      if (text) {
        // 只缓存取到的内容：空结果（接口异常/无数据）留待下次重试
        introCache.set(secid, text);
      }
      if (canceled) {
        return;
      }
      setIntro(text);
      setIntroLoading(false);
    })();
    return () => {
      canceled = true;
    };
  }, [secid]);

  // 日K线（与评分同源）
  useEffect(() => {
    let canceled = false;
    setKlines([]);
    setKlineError('');
    setKlineLoading(true);
    Services.Stock.GetKFromDataSource(SHORT_SCORE_SOURCE, secid, KLineType.Day, PANEL_KLINE_LIMIT)
      .then((r) => {
        if (canceled) {
          return;
        }
        if (r?.error) {
          setKlineError(String(r.error));
          return;
        }
        setKlines(r?.ks || []);
      })
      .catch((e: any) => {
        if (!canceled) {
          setKlineError(e?.message || '日K取数失败');
        }
      })
      .finally(() => {
        if (!canceled) {
          setKlineLoading(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, [secid]);

  // 图表配色取自 CSS 变量：切主题（深/浅、低饱和度）后必须重算 option，否则 tooltip 底色会停在旧主题
  const { darkMode, lowKey } = useNativeThemeColor([]);
  const option = useMemo(
    () => (klines.length ? buildKlineOption(klines) : null),
    [klines, darkMode, lowKey]
  );
  const { ref: chartRef, chartInstance } = useResizeEchart(-1);
  useRenderEcharts(
    () => {
      if (!chartInstance) {
        return;
      }
      if (option) {
        chartInstance.setOption(option, true);
      } else {
        chartInstance.clear();
      }
    },
    chartInstance,
    [option]
  );

  return (
    <aside
      style={{
        // 与左侧结果列表平分宽度
        flex: '1 1 50%',
        minWidth: 0,
        height: '100%',
        overflowY: 'auto',
        boxSizing: 'border-box',
        padding: '4px 12px 12px',
        borderLeft: '1px solid var(--border-color)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          lineHeight: 2,
          cursor: 'pointer',
        }}
        title="点击打开股票详情"
        onClick={() => onOpenStock(secid, name)}
      >
        <span style={{ fontSize: 16, fontWeight: 'bold', color: '#1890ff' }}>{name || code}</span>
        <span style={{ fontSize: 12, color: 'var(--secondary-text-color)' }}>{code}</span>
      </div>

      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>公司简介</div>
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.7,
            color: 'var(--secondary-text-color)',
            whiteSpace: 'pre-wrap',
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          {introLoading ? <Spin size="small" /> : intro || '暂无公司简介'}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          日K线{klines.length ? `（最近 ${klines.length} 个交易日）` : ''}
        </div>
        <div ref={chartRef} style={{ width: '100%', height: 400 }} />
        {klineLoading ? (
          <div style={{ fontSize: 12, color: 'var(--secondary-text-color)' }}>
            <Spin size="small" /> 日K加载中...
          </div>
        ) : null}
        {!klineLoading && klineError ? (
          <div style={{ fontSize: 12, color: '#ff4d4f' }}>{klineError}</div>
        ) : null}
        {!klineLoading && !klineError && !klines.length ? (
          <div style={{ fontSize: 12, color: 'var(--secondary-text-color)' }}>暂无日K数据</div>
        ) : null}
      </div>
    </aside>
  );
};

export default ScoreStockPanel;
