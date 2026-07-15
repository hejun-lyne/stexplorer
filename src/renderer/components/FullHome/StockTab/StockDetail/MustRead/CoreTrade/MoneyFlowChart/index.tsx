import React, { useMemo, useState } from 'react';
import { useRenderEcharts, useResizeEchart } from '@/utils/hooks';
import { useHomeContext } from '@/components/FullHome';
import { Button, Checkbox } from 'antd';
import { BarChartOutlined } from '@ant-design/icons';

export interface MoneyFlowChartProps {
  /** 每日主力净流入数组（元），按时间正序 */
  detailMain: number[];
  /** 每日散户净流入数组（元），按时间正序 */
  detailRetail: number[];
  /** 每日中户净流入数组（元），按时间正序 */
  detailMedium: number[];
  /** 日期数组，按时间正序 */
  detailDates: string[];
}

interface CurveConfig {
  key: string;
  label: string;
  color: string;
}

/** 主力曲线配置 */
const MAIN_CURVES: CurveConfig[] = [
  { key: 'main_1d', label: '主力(当日)', color: '#e8393b' },
  { key: 'main_3d', label: '主力(3日)', color: '#f57c00' },
  { key: 'main_5d', label: '主力(5日)', color: '#f5a623' },
  { key: 'main_10d', label: '主力(10日)', color: '#e8b339' },
  { key: 'main_20d', label: '主力(20日)', color: '#d4c239' },
  { key: 'main_60d', label: '主力(60日)', color: '#b8a83a' },
];

/** 散户曲线配置 */
const RETAIL_CURVES: CurveConfig[] = [
  { key: 'retail_1d', label: '散户(当日)', color: '#2ecc71' },
  { key: 'retail_3d', label: '散户(3日)', color: '#1abc9c' },
  { key: 'retail_5d', label: '散户(5日)', color: '#16a085' },
  { key: 'retail_10d', label: '散户(10日)', color: '#27ae60' },
  { key: 'retail_20d', label: '散户(20日)', color: '#229954' },
  { key: 'retail_60d', label: '散户(60日)', color: '#1e8449' },
];

/** 中户曲线配置 */
const MEDIUM_CURVES: CurveConfig[] = [
  { key: 'medium_1d', label: '中户(当日)', color: '#3498db' },
  { key: 'medium_3d', label: '中户(3日)', color: '#2980b9' },
  { key: 'medium_5d', label: '中户(5日)', color: '#5b6abf' },
  { key: 'medium_10d', label: '中户(10日)', color: '#7c6ff7' },
  { key: 'medium_20d', label: '中户(20日)', color: '#6c5ce7' },
  { key: 'medium_60d', label: '中户(60日)', color: '#4a3cdb' },
];

const ALL_CURVES = [...MAIN_CURVES, ...RETAIL_CURVES, ...MEDIUM_CURVES];

/** 计算滚动N日净流入和 */
function rollingSum(arr: number[], windowSize: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < windowSize - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - windowSize + 1; j <= i; j++) {
        sum += arr[j] || 0;
      }
      result.push(sum);
    }
  }
  return result;
}

/** 格式化金额（用于 tooltip） */
function formatAmount(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1e8) return (val / 1e8).toFixed(2) + '亿';
  if (abs >= 1e4) return (val / 1e4).toFixed(2) + '万';
  return val.toFixed(0) + '元';
}

const MoneyFlowChart: React.FC<MoneyFlowChartProps> = React.memo(
  ({ detailMain, detailRetail, detailMedium, detailDates }) => {
    const [loaded, setLoaded] = useState(false);
    const [selectedCurves, setSelectedCurves] = useState<Set<string>>(
      new Set(['main_5d', 'retail_5d'])
    );
    const { darkMode } = useHomeContext();
    // chartRef 容器始终渲染，保证 useResizeEchart 能正常初始化
    const { ref: chartRef, chartInstance } = useResizeEchart(0.3);

    // 计算所有滚动数据（只在 loaded 后计算，避免不必要的开销）
    const computedData = useMemo(() => {
      if (!loaded) return null;
      return {
        dates: detailDates.map((d) => d.substring(5)),
        main_1d: detailMain,
        main_3d: rollingSum(detailMain, 3),
        main_5d: rollingSum(detailMain, 5),
        main_10d: rollingSum(detailMain, 10),
        main_20d: rollingSum(detailMain, 20),
        main_60d: rollingSum(detailMain, 60),
        retail_1d: detailRetail,
        retail_3d: rollingSum(detailRetail, 3),
        retail_5d: rollingSum(detailRetail, 5),
        retail_10d: rollingSum(detailRetail, 10),
        retail_20d: rollingSum(detailRetail, 20),
        retail_60d: rollingSum(detailRetail, 60),
        medium_1d: detailMedium,
        medium_3d: rollingSum(detailMedium, 3),
        medium_5d: rollingSum(detailMedium, 5),
        medium_10d: rollingSum(detailMedium, 10),
        medium_20d: rollingSum(detailMedium, 20),
        medium_60d: rollingSum(detailMedium, 60),
      };
    }, [loaded, detailMain, detailRetail, detailMedium, detailDates]);

    const toggleCurve = (key: string) => {
      setSelectedCurves((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    };

    const toggleAllMain = (checked: boolean) => {
      setSelectedCurves((prev) => {
        const next = new Set(prev);
        MAIN_CURVES.forEach((c) => {
          if (checked) next.add(c.key);
          else next.delete(c.key);
        });
        return next;
      });
    };

    const toggleAllRetail = (checked: boolean) => {
      setSelectedCurves((prev) => {
        const next = new Set(prev);
        RETAIL_CURVES.forEach((c) => {
          if (checked) next.add(c.key);
          else next.delete(c.key);
        });
        return next;
      });
    };

    const toggleAllMedium = (checked: boolean) => {
      setSelectedCurves((prev) => {
        const next = new Set(prev);
        MEDIUM_CURVES.forEach((c) => {
          if (checked) next.add(c.key);
          else next.delete(c.key);
        });
        return next;
      });
    };

    // 渲染图表
    useRenderEcharts(
      () => {
        if (!chartInstance || !computedData) return;

        const series = ALL_CURVES.filter((c) => selectedCurves.has(c.key)).map(
          (c) => ({
            name: c.label,
            type: 'line' as const,
            data: (computedData as any)[c.key],
            smooth: true,
            symbol: 'none',
            lineStyle: { color: c.color, width: 1.5 },
            itemStyle: { color: c.color },
            connectNulls: false,
          })
        );

        chartInstance.setOption(
          {
            darkMode,
            tooltip: {
              trigger: 'axis',
              formatter: (params: any) => {
                if (!params || params.length === 0) return '';
                const dateIdx = params[0].dataIndex;
                const fullDate = detailDates[dateIdx] || '';
                let html = `<div style="font-weight:bold;margin-bottom:4px">${fullDate}</div>`;
                params.forEach((p: any) => {
                  if (p.value != null) {
                    html += `<div style="display:flex;justify-content:space-between;gap:20px">
                      <span>${p.marker}${p.seriesName}</span>
                      <span style="font-weight:bold">${formatAmount(p.value)}</span>
                    </div>`;
                  }
                });
                return html;
              },
            },
            legend: { show: false },
            grid: {
              left: 50,
              right: 16,
              top: 10,
              bottom: 30,
            },
            xAxis: {
              type: 'category',
              data: computedData.dates,
              boundaryGap: false,
              axisLabel: {
                fontSize: 10,
                rotate: 45,
                interval: Math.max(1, Math.floor(computedData.dates.length / 10)),
              },
            },
            yAxis: {
              type: 'value',
              axisLabel: {
                fontSize: 10,
                formatter: (val: number) => {
                  if (Math.abs(val) >= 1e8) return (val / 1e8).toFixed(0) + '亿';
                  if (Math.abs(val) >= 1e4) return (val / 1e4).toFixed(0) + '万';
                  return val.toFixed(0);
                },
              },
              splitLine: {
                lineStyle: { color: darkMode ? '#333' : '#eee' },
              },
            },
            series,
          },
          true
        );
      },
      chartInstance,
      [computedData, selectedCurves, darkMode]
    );

    return (
      <div style={{ marginTop: 16 }}>
        {!loaded ? (
          <div style={{ textAlign: 'center' }}>
            <Button
              type="primary"
              icon={<BarChartOutlined />}
              onClick={() => setLoaded(true)}
            >
              加载资金流向曲线图
            </Button>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <span style={{ fontWeight: 500, fontSize: 13 }}>资金流向趋势图</span>
              <Button size="small" onClick={() => setLoaded(false)}>
                隐藏图表
              </Button>
            </div>

            {/* 主力曲线勾选 */}
            <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Checkbox
                checked={MAIN_CURVES.every((c) => selectedCurves.has(c.key))}
                indeterminate={
                  MAIN_CURVES.some((c) => selectedCurves.has(c.key)) &&
                  !MAIN_CURVES.every((c) => selectedCurves.has(c.key))
                }
                onChange={(e) => toggleAllMain(e.target.checked)}
                style={{ fontWeight: 'bold', color: '#e8393b' }}
              >
                主力
              </Checkbox>
              {MAIN_CURVES.map((c) => (
                <Checkbox
                  key={c.key}
                  checked={selectedCurves.has(c.key)}
                  onChange={() => toggleCurve(c.key)}
                  style={{ fontSize: 11 }}
                >
                  <span style={{ color: c.color }}>{c.label.replace('主力(', '').replace(')', '')}</span>
                </Checkbox>
              ))}
            </div>

            {/* 散户曲线勾选 */}
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Checkbox
                checked={RETAIL_CURVES.every((c) => selectedCurves.has(c.key))}
                indeterminate={
                  RETAIL_CURVES.some((c) => selectedCurves.has(c.key)) &&
                  !RETAIL_CURVES.every((c) => selectedCurves.has(c.key))
                }
                onChange={(e) => toggleAllRetail(e.target.checked)}
                style={{ fontWeight: 'bold', color: '#2ecc71' }}
              >
                散户
              </Checkbox>
              {RETAIL_CURVES.map((c) => (
                <Checkbox
                  key={c.key}
                  checked={selectedCurves.has(c.key)}
                  onChange={() => toggleCurve(c.key)}
                  style={{ fontSize: 11 }}
                >
                  <span style={{ color: c.color }}>{c.label.replace('散户(', '').replace(')', '')}</span>
                </Checkbox>
              ))}
            </div>

            {/* 中户曲线勾选 */}
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Checkbox
                checked={MEDIUM_CURVES.every((c) => selectedCurves.has(c.key))}
                indeterminate={
                  MEDIUM_CURVES.some((c) => selectedCurves.has(c.key)) &&
                  !MEDIUM_CURVES.every((c) => selectedCurves.has(c.key))
                }
                onChange={(e) => toggleAllMedium(e.target.checked)}
                style={{ fontWeight: 'bold', color: '#3498db' }}
              >
                中户
              </Checkbox>
              {MEDIUM_CURVES.map((c) => (
                <Checkbox
                  key={c.key}
                  checked={selectedCurves.has(c.key)}
                  onChange={() => toggleCurve(c.key)}
                  style={{ fontSize: 11 }}
                >
                  <span style={{ color: c.color }}>{c.label.replace('中户(', '').replace(')', '')}</span>
                </Checkbox>
              ))}
            </div>
          </>
        )}

        {/* chartRef 容器始终渲染，避免 useResizeEchart 初始化失败 */}
        <div
          ref={chartRef}
          style={{ width: '100%', height: loaded ? 280 : 0, overflow: 'hidden' }}
        />
      </div>
    );
  }
);

export default MoneyFlowChart;
