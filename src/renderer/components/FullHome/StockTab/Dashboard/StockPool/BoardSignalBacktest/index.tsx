import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Col,
  Descriptions,
  InputNumber,
  Progress,
  Radio,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
} from 'antd';
import { useSelector } from 'react-redux';
import * as Services from '@/services';
import { BKType } from '@/utils/enums';
import { Stock } from '@/types/stock';
import { StoreState } from '@/reducers/types';
import { BoardBacktestStock, BoardScoreBacktestResult, runBoardScoreBacktest } from '@/helpers/boardScoreBacktest';
import { DEFAULT_SHORT_SCORE_BACKTEST, ShortScoreBacktestParams } from '@/helpers/shortTermScoreBacktest';

export interface BoardSignalBacktestProps {
  active?: boolean;
  onOpenStock?: (secid: string, name: string) => void;
}

const pct = (v?: number, digits = 2) => {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return '—';
  }
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(digits)}%`;
};

const gradeColor = (grade?: string) => {
  switch (grade) {
    case 'A':
      return 'red';
    case 'B':
      return 'orange';
    case 'C':
      return 'blue';
    default:
      return 'default';
  }
};

/**
 * 板块信号回测
 *
 * 选定东财行业/概念板块 → 对板块内成分股逐只跑「短线评分突变」回测，
 * 并把窗口最后一根 K 线的突变识别为「今日信号」（次日开盘买入），
 * 按信号质量分从高到低排序：多只股票同时出信号时，分数高的优先。
 */
const BoardSignalBacktest: React.FC<BoardSignalBacktestProps> = ({ active = true, onOpenStock }) => {
  const { kLineApiSourceSetting } = useSelector((state: StoreState) => state.setting.systemSetting);
  const [boardType, setBoardType] = useState<BKType>(BKType.Gainian);
  const [boards, setBoards] = useState<Stock.BanKuaiItem[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [secid, setSecid] = useState('');
  const [params, setParams] = useState<ShortScoreBacktestParams>(DEFAULT_SHORT_SCORE_BACKTEST);
  const [limit, setLimit] = useState(120);
  const [maxStocks, setMaxStocks] = useState(60);
  const [concurrency, setConcurrency] = useState(2);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [result, setResult] = useState<BoardScoreBacktestResult | null>(null);
  const [error, setError] = useState('');
  const stopRef = useRef(false);

  const loadBoards = useCallback(
    async (t: BKType) => {
      setBoardLoading(true);
      try {
        const d = await Services.Stock.GetBanKuaisFromDataSource(kLineApiSourceSetting, t, 300, 'dc');
        setBoards(d?.arr || []);
      } catch {
        setBoards([]);
      } finally {
        setBoardLoading(false);
      }
    },
    [kLineApiSourceSetting]
  );

  useEffect(() => {
    if (!active) {
      return;
    }
    setSecid('');
    setResult(null);
    void loadBoards(boardType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, boardType, kLineApiSourceSetting]);

  const setParam = (key: keyof ShortScoreBacktestParams) => (v: number | null) =>
    setParams((prev) => ({ ...prev, [key]: typeof v === 'number' ? v : prev[key] }));

  const handleRun = useCallback(async () => {
    const board = boards.find((b) => b.secid === secid);
    if (!board) {
      setError('请先选择板块');
      return;
    }
    setRunning(true);
    setError('');
    setResult(null);
    setProgress({ done: 0, total: 0, name: '' });
    stopRef.current = false;
    try {
      const res = await Services.Stock.GetBankuaiStocksFromDataSource(kLineApiSourceSetting, board.secid, 200);
      const stocks = (res?.stocks || []) as Stock.DetailItem[];
      if (!stocks.length) {
        setError('该板块没有取到成分股');
        return;
      }
      const r = await runBoardScoreBacktest({
        board: { secid: board.secid, name: board.name, type: boardType },
        stocks: stocks.map((s) => ({ code: s.code, name: s.name })),
        params,
        source: kLineApiSourceSetting,
        limit,
        maxStocks,
        concurrency,
        shouldStop: () => stopRef.current,
        onProgress: (p) => setProgress({ done: p.done, total: p.total, name: p.name }),
      });
      setResult(r);
    } catch (e: any) {
      setError(e?.message || '回测失败');
    } finally {
      setRunning(false);
    }
  }, [boards, secid, kLineApiSourceSetting, boardType, params, limit, maxStocks, concurrency]);

  const openStock = useCallback(
    (r: BoardBacktestStock) => {
      const secidOf = /^6/.test(r.code) ? `1.${r.code}` : `0.${r.code}`;
      onOpenStock?.(secidOf, r.name);
    },
    [onOpenStock]
  );

  const signalColumns = [
    {
      title: '质量分',
      dataIndex: ['quality', 'total'],
      width: 90,
      fixed: 'left' as const,
      sorter: (a: BoardBacktestStock, b: BoardBacktestStock) =>
        (a.quality?.total || 0) - (b.quality?.total || 0),
      render: (_: any, r: BoardBacktestStock) => (
        <Tag color={gradeColor(r.quality?.grade)}>
          {r.quality?.total ?? '—'} {r.quality?.grade || ''}
        </Tag>
      ),
    },
    {
      title: '名称',
      dataIndex: 'name',
      width: 110,
      fixed: 'left' as const,
      render: (v: string, r: BoardBacktestStock) => <a onClick={() => openStock(r)}>{v || r.code}</a>,
    },
    { title: '信号日', dataIndex: ['live', 'date'], width: 100 },
    {
      title: '评分',
      width: 70,
      align: 'right' as const,
      render: (_: any, r: BoardBacktestStock) => (r.live ? r.live.score.toFixed(1) : '—'),
    },
    {
      title: 'Δ',
      width: 80,
      align: 'right' as const,
      render: (_: any, r: BoardBacktestStock) => (r.live ? `+${r.live.delta.toFixed(1)}` : '—'),
    },
    {
      title: '收盘(参考买价)',
      width: 120,
      align: 'right' as const,
      render: (_: any, r: BoardBacktestStock) => (r.live ? r.live.close.toFixed(2) : '—'),
    },
    {
      title: '距60日高点',
      width: 100,
      align: 'right' as const,
      render: (_: any, r: BoardBacktestStock) =>
        r.live ? `${(-r.live.drawdownFromHigh * 100).toFixed(1)}%` : '—',
    },
    {
      title: '量比',
      width: 70,
      align: 'right' as const,
      render: (_: any, r: BoardBacktestStock) => (r.live ? r.live.volumeRatio.toFixed(2) : '—'),
    },
    {
      title: '历史胜率',
      width: 100,
      align: 'right' as const,
      render: (_: any, r: BoardBacktestStock) =>
        r.stats?.trades ? `${(r.stats.winRate * 100).toFixed(0)}%（${r.stats.trades}笔）` : '无样本',
    },
    {
      title: '期望/笔',
      width: 90,
      align: 'right' as const,
      render: (_: any, r: BoardBacktestStock) => (
        <span style={{ color: (r.stats?.avgRet || 0) >= 0 ? 'var(--increase-color)' : 'var(--reduce-color)' }}>
          {r.stats?.trades ? pct(r.stats.avgRet) : '—'}
        </span>
      ),
    },
    {
      title: '明细',
      width: 60,
      render: (_: any, r: BoardBacktestStock) =>
        r.quality ? (
          <Tooltip
            title={
              <div>
                {r.quality.dims.map((d) => (
                  <div key={d.key}>
                    {d.label}：{d.score}/{d.max}（{d.detail}）
                  </div>
                ))}
              </div>
            }
          >
            <a>8维</a>
          </Tooltip>
        ) : (
          '—'
        ),
    },
  ];

  const stockColumns = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 110,
      fixed: 'left' as const,
      render: (v: string, r: BoardBacktestStock) => <a onClick={() => openStock(r)}>{v || r.code}</a>,
    },
    {
      title: '今日信号',
      width: 90,
      render: (_: any, r: BoardBacktestStock) => {
        if (r.live) {
          return <Tag color={gradeColor(r.quality?.grade)}>{r.quality?.total ?? '信号'}</Tag>;
        }
        if (r.holding) {
          return <Tag color={r.exitSignal ? 'green' : 'gold'}>{r.exitSignal ? '持仓·卖出' : '持仓中'}</Tag>;
        }
        return '—';
      },
    },
    {
      title: '笔数',
      width: 70,
      align: 'right' as const,
      render: (_: any, r: BoardBacktestStock) => r.stats?.trades ?? '—',
    },
    {
      title: '胜率',
      width: 80,
      align: 'right' as const,
      render: (_: any, r: BoardBacktestStock) =>
        r.stats?.trades ? `${(r.stats.winRate * 100).toFixed(0)}%` : '—',
    },
    {
      title: '期望/笔',
      width: 90,
      align: 'right' as const,
      render: (_: any, r: BoardBacktestStock) => (
        <span style={{ color: (r.stats?.avgRet || 0) >= 0 ? 'var(--increase-color)' : 'var(--reduce-color)' }}>
          {r.stats?.trades ? pct(r.stats.avgRet) : '—'}
        </span>
      ),
    },
    {
      title: '累计',
      width: 90,
      align: 'right' as const,
      render: (_: any, r: BoardBacktestStock) => pct(r.stats?.cumulative),
    },
    {
      title: '最大回撤',
      width: 90,
      align: 'right' as const,
      render: (_: any, r: BoardBacktestStock) =>
        r.stats?.trades ? `${((r.stats.maxDrawdown || 0) * 100).toFixed(1)}%` : '—',
    },
    {
      title: '窗口K线',
      width: 80,
      align: 'right' as const,
      render: (_: any, r: BoardBacktestStock) => r.bars || '—',
    },
    {
      title: '状态',
      width: 160,
      render: (_: any, r: BoardBacktestStock) =>
        r.status === 'error' ? <Tooltip title={r.message}><Tag color="error">失败</Tag></Tooltip> : <Tag color="green">完成</Tag>,
    },
  ];

  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div style={{ padding: 12, height: '100%', overflow: 'auto' }}>
      <Space wrap size={12} style={{ marginBottom: 12 }}>
        <span>
          板块类型
          <Radio.Group
            size="small"
            value={boardType}
            style={{ marginLeft: 6 }}
            onChange={(e) => setBoardType(e.target.value as BKType)}
          >
            <Radio.Button value={BKType.Industry}>行业</Radio.Button>
            <Radio.Button value={BKType.Gainian}>概念</Radio.Button>
          </Radio.Group>
        </span>
        <span>
          板块
          <Select
            size="small"
            showSearch
            value={secid || undefined}
            loading={boardLoading}
            placeholder="选择东财行业/概念板块"
            style={{ width: 220, marginLeft: 6 }}
            optionFilterProp="children"
            onChange={(v) => setSecid(String(v))}
          >
            {boards.map((b) => (
              <Select.Option key={b.secid} value={b.secid}>
                {b.name}
              </Select.Option>
            ))}
          </Select>
        </span>
        <span>
          买入 Δ≥
          <InputNumber size="small" value={params.buyDelta} step={1} onChange={setParam('buyDelta')} style={{ width: 70 }} />
        </span>
        <span>
          评分≥
          <InputNumber size="small" value={params.minScore} step={5} onChange={setParam('minScore')} style={{ width: 70 }} />
        </span>
        <span>
          卖出 Δ≤
          <InputNumber size="small" value={params.sellDelta} step={1} onChange={setParam('sellDelta')} style={{ width: 70 }} />
        </span>
        <span>
          冷却
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
          跳空 ±
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
          窗口
          <InputNumber
            size="small"
            value={limit}
            min={20}
            max={120}
            step={20}
            onChange={(v) => setLimit(Number(v) || 120)}
            style={{ width: 70 }}
          />
          日
        </span>
        <span>
          回测只数
          <InputNumber
            size="small"
            value={maxStocks}
            min={0}
            max={300}
            step={20}
            onChange={(v) => setMaxStocks(Number(v) || 0)}
            style={{ width: 70 }}
            title="0 = 板块全部成分股"
          />
        </span>
        <span>
          并发
          <InputNumber
            size="small"
            value={concurrency}
            min={1}
            max={4}
            step={1}
            onChange={(v) => setConcurrency(Number(v) || 1)}
            style={{ width: 55 }}
          />
        </span>
        <Button type="primary" size="small" loading={running} disabled={!secid} onClick={() => void handleRun()}>
          开始回测
        </Button>
        {running ? (
          <Button size="small" onClick={() => { stopRef.current = true; }}>
            停止
          </Button>
        ) : null}
      </Space>

      <div style={{ fontSize: 12, color: 'var(--secondary-text-color)', marginBottom: 8 }}>
        逐只现算评分曲线（与个股回测同口径），耗时≈成分股只数 × 取数时间；「回测只数」限制本次参与计算的股票数（0=全部），
        信号日为窗口最后一根K线，按次日开盘买入评估。
      </div>

      {progress && progress.total > 0 ? (
        <Progress
          percent={percent}
          size="small"
          status={running ? 'active' : 'normal'}
          format={() => `${progress.done}/${progress.total}`}
          style={{ marginBottom: 8 }}
        />
      ) : null}

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 8 }} /> : null}

      {result ? (
        <>
          <Row gutter={[12, 12]} style={{ marginBottom: 8 }}>
            <Col span={4}>
              <Statistic title="板块" value={result.board.name} valueStyle={{ fontSize: 16 }} />
            </Col>
            <Col span={4}>
              <Statistic title="回测只数" value={`${result.succeeded}/${result.total}`} valueStyle={{ fontSize: 16 }} />
            </Col>
            <Col span={4}>
              <Statistic
                title="今日信号"
                value={result.liveCount}
                suffix={`只（${result.total ? ((result.liveCount / result.total) * 100).toFixed(1) : 0}%）`}
                valueStyle={{ fontSize: 16, color: 'var(--increase-color)' }}
              />
            </Col>
            <Col span={4}>
              <Statistic title="失败" value={result.failed} valueStyle={{ fontSize: 16 }} />
            </Col>
            <Col span={8}>
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="参数">
                  {`Δ≥${result.params.buyDelta} / 评分≥${result.params.minScore} / 卖出Δ≤${result.params.sellDelta} / 冷却${result.params.cooldownDays}日 / 跳空±${result.params.maxGapPct}%`}
                </Descriptions.Item>
                <Descriptions.Item label="生成时间">{result.generatedAt.replace('T', ' ').substring(0, 19)}</Descriptions.Item>
              </Descriptions>
            </Col>
          </Row>
          <Tabs size="small" defaultActiveKey="signals">
            <Tabs.TabPane tab={`今日信号（${result.signals.length}）`} key="signals">
              <Table
                size="small"
                rowKey="code"
                columns={signalColumns as any}
                dataSource={result.signals}
                pagination={{ pageSize: 20, size: 'small', showSizeChanger: false }}
                scroll={{ x: 1000 }}
                locale={{ emptyText: '该板块今日没有触发买入信号的股票' }}
              />
            </Tabs.TabPane>
            <Tabs.TabPane tab={`全部成分股（${result.total}）`} key="stocks">
              <Table
                size="small"
                rowKey="code"
                columns={stockColumns as any}
                dataSource={result.stocks}
                pagination={{ pageSize: 30, size: 'small', showSizeChanger: false }}
                scroll={{ x: 900 }}
                locale={{ emptyText: '没有可展示的回测结果' }}
              />
            </Tabs.TabPane>
          </Tabs>
        </>
      ) : null}
    </div>
  );
};

export default BoardSignalBacktest;
