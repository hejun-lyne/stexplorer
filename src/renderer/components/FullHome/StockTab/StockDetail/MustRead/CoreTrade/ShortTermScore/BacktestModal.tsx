import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Col,
  Descriptions,
  InputNumber,
  Modal,
  Radio,
  Row,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tag,
} from 'antd';
import * as ScoreList from '@/helpers/shortTermScoreList';
import {
  DEFAULT_SHORT_SCORE_BACKTEST,
  runShortScoreBacktest,
  ShortScoreBacktestParams,
  ShortScoreBacktestResult,
} from '@/helpers/shortTermScoreBacktest';

const { dialog, ipcRenderer } = window.contextModules.electron;

export interface BacktestModalProps {
  open: boolean;
  onClose: () => void;
  code: string;
  name?: string;
  circMv?: number;
}

const pct = (v: number, digits = 2) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`;
const numText = (v: number, digits = 2) => {
  if (v === Infinity) {
    return '∞';
  }
  return Number.isFinite(v) ? v.toFixed(digits) : '—';
};

/**
 * 短线评分「突变」策略回测面板
 *
 * 评分序列来自 computeShortTermScoreCurve（现取数逐日重算，与详情页曲线同口径），
 * 不读评分缓存，避免旧版本行（v9/v10/v11）造成的口径差异。
 * 结果可导出 JSON，便于外部复核/分析。
 */
const BacktestModal: React.FC<BacktestModalProps> = ({ open, onClose, code, name, circMv }) => {
  // 默认用「自低点抬升」口径：低位启动常分几天完成，单日 Δ 到不了 20 分
  const [params, setParams] = useState<ShortScoreBacktestParams>({
    ...DEFAULT_SHORT_SCORE_BACKTEST,
    buyMode: 'rise',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ShortScoreBacktestResult | null>(null);
  /** 评分基准日（回测窗口右端由它决定） */
  const [scoreDayKey, setScoreDayKey] = useState('');
  /** 忽略训练日：训练模式下曲线会停在训练日，回测默认算到最新交易日 */
  const [ignoreTrain, setIgnoreTrain] = useState(true);
  /** 现取数算好的评分序列：改参数重跑时不必重新取数 */
  const curveRef = useRef<{ scores: Record<string, number>; klines: any[]; scoreDayKey: string } | null>(null);
  const reqIdRef = useRef(0);

  const run = useCallback(
    async (p: ShortScoreBacktestParams, refetch: boolean, ignore = ignoreTrain) => {
      if (!/^\d{6}$/.test(String(code || ''))) {
        return;
      }
      const reqId = reqIdRef.current + 1;
      reqIdRef.current = reqId;
      setLoading(true);
      setError('');
      try {
        let curve = curveRef.current;
        if (refetch || !curve) {
          const c = await ScoreList.computeShortTermScoreCurve({
            code,
            name,
            circMv,
            limit: Math.max(20, Math.min(240, p.limitDays)),
            ignoreTrain: ignore,
          });
          setScoreDayKey(c.scoreDayKey || '');
          curve = { scores: c.scores || {}, klines: c.klines || [], scoreDayKey: c.scoreDayKey || '' };
          curveRef.current = curve;
        }
        if (reqId !== reqIdRef.current) {
          return;
        }
        if (!Object.keys(curve.scores).length) {
          setResult(null);
          setError('取数为空：日K/板块/资金数据不足，无法计算评分序列');
          return;
        }
        setResult(
          runShortScoreBacktest({ code, scores: curve.scores, klines: curve.klines as any, params: p })
        );
      } catch (e: any) {
        if (reqId === reqIdRef.current) {
          setError(e?.message || '回测失败');
        }
      } finally {
        if (reqId === reqIdRef.current) {
          setLoading(false);
        }
      }
    },
    [code, name, circMv, ignoreTrain]
  );

  // 每次打开都重新取数（K线/板块数据可能已刷新）
  useEffect(() => {
    if (!open) {
      return;
    }
    curveRef.current = null;
    setResult(null);
    void run(params, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, code]);

  const stats = result?.stats;
  const columns = useMemo(
    () => [
      { title: '买入日', dataIndex: 'entryDate', width: 100, fixed: 'left' as const },
      {
        title: '买入价',
        dataIndex: 'entryPrice',
        width: 80,
        align: 'right' as const,
        render: (v: number) => v.toFixed(2),
      },
      {
        title: '买点评分/Δ',
        width: 110,
        align: 'right' as const,
        render: (_: any, r: any) => `${r.scoreIn.toFixed(1)} / ${r.deltaIn > 0 ? '+' : ''}${r.deltaIn}`,
      },
      {
        title: '买入跳空',
        dataIndex: 'gapIn',
        width: 80,
        align: 'right' as const,
        render: (v: number) => `${v > 0 ? '+' : ''}${Number(v || 0).toFixed(2)}%`,
      },
      { title: '卖出信号日', dataIndex: 'signalOut', width: 100, render: (v: string) => v || '—' },
      { title: '卖出日', dataIndex: 'exitDate', width: 100 },
      {
        title: '卖出价',
        dataIndex: 'exitPrice',
        width: 80,
        align: 'right' as const,
        render: (v: number) => v.toFixed(2),
      },
      {
        title: '卖点评分/Δ',
        width: 110,
        align: 'right' as const,
        render: (_: any, r: any) =>
          r.scoreOut == null ? '—' : `${r.scoreOut.toFixed(1)} / ${r.deltaOut > 0 ? '+' : ''}${r.deltaOut}`,
      },
      { title: '持仓', dataIndex: 'bars', width: 60, align: 'right' as const, render: (v: number) => `${v}日` },
      {
        title: '收益',
        dataIndex: 'ret',
        width: 90,
        align: 'right' as const,
        render: (v: number) => (
          <span style={{ color: v > 0 ? 'var(--increase-color)' : 'var(--reduce-color)' }}>{pct(v)}</span>
        ),
      },
      {
        title: '卖出原因',
        dataIndex: 'exitReason',
        width: 90,
        render: (v: string) => (
          <Tag color={v === '绿柱卖出' ? 'green' : v === '回撤止盈' ? 'blue' : 'default'}>{v}</Tag>
        ),
      },
    ],
    []
  );

  const handleExport = useCallback(async () => {
    if (!result) {
      return;
    }
    const payload = {
      kind: 'short-term-score-jump-backtest',
      exportedAt: new Date().toISOString(),
      code,
      name: name || '',
      scoreSource: 'computeShortTermScoreCurve（逐日现算，非缓存）',
      params: result.params,
      scoreDayKey,
      window: {
        start: result.windowStart,
        end: result.windowEnd,
        bars: result.windowBars,
        scoreDays: result.scoreDays,
      },
      stats: result.stats,
      trades: result.trades,
      // 被低位启动 / 冷却期 / 跳空过滤拦下的信号，便于核对过滤是否误伤
      skips: result.skips,
      // 供外部核对口径：完整评分序列与窗口内日K
      scores: result.scores,
      bars: result.bars,
    };
    const content = JSON.stringify(payload, null, 2);
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: '导出回测结果',
      defaultPath: `score_backtest_${code}_${result.windowEnd.replace(/-/g, '')}.json`,
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    });
    if (canceled || !filePath) {
      return;
    }
    await ipcRenderer.invoke('save-string-silently', { filePath, content });
    await dialog.showMessageBox({ title: '导出成功', type: 'info', message: `已保存到 ${filePath}` });
  }, [result, code, name]);

  const setParam = (key: keyof ShortScoreBacktestParams) => (v: number | null) =>
    setParams((prev) => ({ ...prev, [key]: typeof v === 'number' ? v : prev[key] }));

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={1080}
      title={`短线评分突变策略回测 · ${code}${name ? ` ${name}` : ''}`}
      footer={
        <Space>
          <Button onClick={handleExport} disabled={!result}>
            导出JSON
          </Button>
          <Button type="primary" onClick={onClose}>
            关闭
          </Button>
        </Space>
      }
    >
      <Space wrap size={12} style={{ marginBottom: 12 }}>
        <span title="自低点抬升：不看单日跳升，只看评分自近 N 个评分日最低点抬了多少（适合分几天完成的低位启动）">
          买入口径
          <Radio.Group
            size="small"
            style={{ marginLeft: 6 }}
            value={params.buyMode}
            onChange={(e) => setParams((prev) => ({ ...prev, buyMode: e.target.value }))}
            optionType="button"
            options={[
              { label: '自低点抬升', value: 'rise' },
              { label: '单日跳升', value: 'jump' },
            ]}
          />
        </span>
        {params.buyMode === 'rise' ? (
          <>
            <span title="评分自近 N 个评分日最低点抬升达到该分数即算启动">
              自低点抬升 ≥
              <InputNumber size="small" value={params.minRise} step={5} onChange={setParam('minRise')} style={{ width: 70 }} />
            </span>
            <span>
              回看
              <InputNumber
                size="small"
                value={params.riseRefDays}
                min={1}
                max={60}
                step={1}
                onChange={setParam('riseRefDays')}
                style={{ width: 60 }}
              />
              个评分日
            </span>
            <span title="评分绝对地板：当日评分低于该值不算启动">
              启动地板 ≥
              <InputNumber size="small" value={params.riseMinScore} step={5} onChange={setParam('riseMinScore')} style={{ width: 70 }} />
            </span>
          </>
        ) : (
          <>
            <span>
              买入 Δ≥
              <InputNumber size="small" value={params.buyDelta} step={1} onChange={setParam('buyDelta')} style={{ width: 70 }} />
            </span>
            <span>
              评分≥
              <InputNumber size="small" value={params.minScore} step={5} onChange={setParam('minScore')} style={{ width: 70 }} />
            </span>
          </>
        )}
        <span>
          卖出 Δ≤
          <InputNumber size="small" value={params.sellDelta} step={1} onChange={setParam('sellDelta')} style={{ width: 70 }} />
        </span>
        <span title="单日跳升口径：突变前 N 个评分日必须都 ≤ 该上限；自低点抬升口径：近 N 日最低分（抬升起点）要 ≤ 该上限，排除高位反抽的伪信号；天数填 0 关闭">
          低位 ≤
          <InputNumber size="small" value={params.lowBaseMax} step={5} onChange={setParam('lowBaseMax')} style={{ width: 70 }} />
          持续
          <InputNumber
            size="small"
            value={params.lowBaseDays}
            min={0}
            max={20}
            step={1}
            onChange={setParam('lowBaseDays')}
            style={{ width: 60 }}
          />
          日
        </span>
        <span title="评分自持仓期最高点回撤达到该分数即卖出，避免评分阴跌时一直不止盈；填 0 关闭">
          回撤 ≥
          <InputNumber
            size="small"
            value={params.trailDrop}
            min={0}
            max={60}
            step={1}
            onChange={setParam('trailDrop')}
            style={{ width: 60 }}
          />
          分止盈
        </span>
        <span>
          卖出后冷却
          <InputNumber
            size="small"
            value={params.cooldownDays}
            min={0}
            max={20}
            step={1}
            onChange={setParam('cooldownDays')}
            style={{ width: 60 }}
          />
          日
        </span>
        <span>
          跳空过滤 ±
          <InputNumber
            size="small"
            value={params.maxGapPct}
            min={0}
            max={20}
            step={0.5}
            onChange={setParam('maxGapPct')}
            style={{ width: 70 }}
          />
          %
        </span>
        <span>
          成本%
          <InputNumber
            size="small"
            value={Number((params.fee * 100).toFixed(3))}
            step={0.02}
            onChange={(v) => setParams((prev) => ({ ...prev, fee: (Number(v) || 0) / 100 }))}
            style={{ width: 80 }}
          />
        </span>
        <span>
          窗口
          <InputNumber
            size="small"
            value={params.limitDays}
            min={20}
            max={240}
            step={20}
            onChange={setParam('limitDays')}
            style={{ width: 80 }}
          />
          日
        </span>
        <span>
          忽略训练日
          <Switch
            size="small"
            style={{ marginLeft: 6 }}
            checked={ignoreTrain}
            onChange={(v) => {
              setIgnoreTrain(v);
              void run(params, true, v);
            }}
          />
        </span>
        <Button size="small" type="primary" loading={loading} onClick={() => void run(params, true)}>
          重新取数回测
        </Button>
        <Button size="small" disabled={loading || !curveRef.current} onClick={() => void run(params, false)}>
          仅改参数重算
        </Button>
      </Space>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin /> 正在逐日现算评分（窗口内每个交易日都要取板块/资金/涨跌比数据）...
        </div>
      ) : error ? (
        <Alert type="error" message={error} showIcon />
      ) : result && stats ? (
        <>
          <div style={{ fontSize: 12, color: 'var(--secondary-text-color)', marginBottom: 8 }}>
            窗口 {result.windowStart} ~ {result.windowEnd}（{result.windowBars} 个交易日，其中
            {result.scoreDays} 天有评分；评分基准日 {scoreDayKey || '—'}，现算口径、非缓存）
          </div>
          <Row gutter={[12, 12]} style={{ marginBottom: 8 }}>
            <Col span={4}>
              <Statistic title="交易次数" value={stats.trades} />
            </Col>
            <Col span={4}>
              <Statistic title="胜率" value={(stats.winRate * 100).toFixed(1)} suffix="%" />
            </Col>
            <Col span={4}>
              <Statistic
                title="期望/笔"
                value={(stats.avgRet * 100).toFixed(2)}
                suffix="%"
                valueStyle={{ color: stats.avgRet >= 0 ? 'var(--increase-color)' : 'var(--reduce-color)' }}
              />
            </Col>
            <Col span={4}>
              <Statistic title="盈亏比" value={numText(stats.payoff)} />
            </Col>
            <Col span={4}>
              <Statistic title="夏普(按笔年化)" value={numText(stats.sharpe)} />
            </Col>
            <Col span={4}>
              <Statistic title="累计(顺序复利)" value={(stats.cumulative * 100).toFixed(2)} suffix="%" />
            </Col>
          </Row>
          <Descriptions size="small" column={4} style={{ marginBottom: 8 }}>
            <Descriptions.Item label="平均盈利">{pct(stats.avgWin)}</Descriptions.Item>
            <Descriptions.Item label="平均亏损">{pct(stats.avgLoss)}</Descriptions.Item>
            <Descriptions.Item label="盈利因子">{numText(stats.profitFactor)}</Descriptions.Item>
            <Descriptions.Item label="平均持仓">{stats.avgBars.toFixed(1)} 日</Descriptions.Item>
            <Descriptions.Item label="交易频率">{stats.tradesPerYear.toFixed(2)} 次/年</Descriptions.Item>
            <Descriptions.Item label="持仓占比">{(stats.exposure * 100).toFixed(0)}%</Descriptions.Item>
            <Descriptions.Item label="最大回撤">{(stats.maxDrawdown * 100).toFixed(1)}%</Descriptions.Item>
            <Descriptions.Item label="最好/最差">{`${pct(stats.best)} / ${pct(stats.worst)}`}</Descriptions.Item>
          </Descriptions>
          {result.skips.length ? (
            <div style={{ fontSize: 12, color: 'var(--secondary-text-color)', marginBottom: 8 }}>
              已过滤 {result.skips.length} 个信号：
              {result.skips
                .map(
                  (s) =>
                    `${s.date} ${s.reason}${
                      typeof s.prevHigh === 'number' ? `（此前最高 ${s.prevHigh}）` : ''
                    }（评分${s.score} / Δ${s.delta > 0 ? '+' : ''}${s.delta} / 跳空${
                      s.gap > 0 ? '+' : ''
                    }${s.gap}%）`
                )
                .join('；')}
            </div>
          ) : null}
          <Table
            size="small"
            rowKey={(r: any) => `${r.entryDate}-${r.exitDate}`}
            columns={columns as any}
            dataSource={result.trades}
            pagination={false}
            scroll={{ y: 300, x: 1020 }}
            locale={{ emptyText: '该窗口内没有满足条件的成交' }}
          />
        </>
      ) : null}
    </Modal>
  );
};

export default BacktestModal;
