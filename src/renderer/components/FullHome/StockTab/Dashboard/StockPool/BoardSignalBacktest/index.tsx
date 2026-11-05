import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Col,
  DatePicker,
  Descriptions,
  InputNumber,
  message,
  Modal,
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
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import * as Services from '@/services';
import { BKType, FundApiType } from '@/utils/enums';
import { Stock } from '@/types/stock';
import { StoreState } from '@/reducers/types';
import { BoardBacktestStock, BoardScoreBacktestResult, runBoardScoreBacktest } from '@/helpers/boardScoreBacktest';
import { DEFAULT_SHORT_SCORE_BACKTEST, ShortScoreBacktestParams } from '@/helpers/shortTermScoreBacktest';
import { MA_BAND_OPTIONS, maBandKey, parseMaBand } from '@/helpers/maBand';
import { precomputeShortTermScores, PrecomputeResult } from '@/helpers/shortTermScorePrecompute';
import { SHORT_SCORE_SOURCE, ShortTermScoreItem } from '@/helpers/shortTermScoreList';
import { filterThemeBoards } from '@/helpers/boardFilter';

export interface BoardSignalBacktestProps {
  active?: boolean;
  onOpenStock?: (secid: string, name: string) => void;
}

/**
 * 板块下拉里的伪选项（与 STList 同口径）
 *
 * 不是真实板块：选中后展开成「当前概念板块列表里满足条件的一批板块」，
 * 回测/缓存用这些板块成分股去重合并后的股票池。
 *  - 只看题材：helpers/boardFilter 的题材过滤（剔除风格/指数/持仓/事件/地域等伪概念）
 *  - 只看风格：名称以「风格」结尾的板块（科技风格 / 消费风格 / 医药医疗风格…）
 */
const THEME_ONLY_SECID = '__THEME_ONLY__';
const STYLE_ONLY_SECID = '__STYLE_ONLY__';
const PSEUDO_BOARD_NAMES: Record<string, string> = {
  [THEME_ONLY_SECID]: '只看题材',
  [STYLE_ONLY_SECID]: '只看风格',
};
const isPseudoBoardSecid = (sid: string): boolean =>
  sid === THEME_ONLY_SECID || sid === STYLE_ONLY_SECID;

/**
 * 科创板 / 北交所股票代码过滤（与离线脚本 --exclude-boards 同口径）
 *
 * 科创板 68x（688/689）；北交所 4/8/920（含历史 43/83/87 及 920 新代码）。
 */
const isStarOrBseCode = (code: string): boolean => /^(68|4|8|920)/.test(String(code || ''));

const pct = (v?: number, digits = 2) => {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return '—';
  }
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(digits)}%`;
};

const fmtDay = (d?: string) => {
  const s = String(d || '').replace(/-/g, '');
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : d || '—';
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
  /** 历史回测区间（null = 用「窗口 N 日」） */
  const [range, setRange] = useState<any>(null);
  const [maxStocks, setMaxStocks] = useState(60);
  const [concurrency, setConcurrency] = useState(2);
  /** 排除科创板(68x)与北交所(4/8/920)股票，只对成分股股票池过滤 */
  const [excludeStarBse, setExcludeStarBse] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [result, setResult] = useState<BoardScoreBacktestResult | null>(null);
  const [error, setError] = useState('');
  const stopRef = useRef(false);

  // ---- 评分缓存生成（离线脚本 / 回测面板都要读 meta.db 里的评分序列）----
  const [cacheOpen, setCacheOpen] = useState(false);
  const [cacheRange, setCacheRange] = useState<any>([
    dayjs().startOf('year'),
    dayjs().subtract(1, 'day'),
  ]);
  const [cacheForce, setCacheForce] = useState(false);
  const [cacheRunning, setCacheRunning] = useState(false);
  const [cacheDone, setCacheDone] = useState(0);
  const [cacheTotal, setCacheTotal] = useState(0);
  const [cacheMsg, setCacheMsg] = useState('');
  const [cacheResult, setCacheResult] = useState<PrecomputeResult | null>(null);
  const cachePauseRef = useRef(false);

  const loadBoards = useCallback(
    async (t: BKType) => {
      setBoardLoading(true);
      try {
        // 板块列表固定走 Tushare（dc_index 全量快照），不走东财 REST
        const d = await Services.Stock.GetBanKuaisFromDataSourceAll(t, 'dc');
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

  /** 选中项展开成真实板块：伪选项「只看题材 / 只看风格」与 STList 同口径 */
  const expandBoards = useCallback(
    (sid: string): Stock.BanKuaiItem[] => {
      if (sid === STYLE_ONLY_SECID) {
        return boards.filter((b) => String(b?.name || '').trim().endsWith('风格'));
      }
      if (sid === THEME_ONLY_SECID) {
        return filterThemeBoards(boards);
      }
      const one = boards.find((b) => b.secid === sid);
      return one ? [one] : [];
    },
    [boards]
  );

  /** 下拉当前显示名（伪选项不是真实板块，但回测结果里要能显示它） */
  const selectedBoardName = isPseudoBoardSecid(secid)
    ? PSEUDO_BOARD_NAMES[secid]
    : boards.find((b) => b.secid === secid)?.name || '';

  /**
   * 批量取板块成分股并去重合并（不截断，全量参与回测/缓存预计算）
   *
   * 「只看题材」会展开成上百个板块，串行请求太慢，这里按 6 个一批并发；
   * 同一只股票可能属于多个板块，按代码去重。Tushare 的板块成分股接口不接受数量上限，
   * 传进去的 200 只是给其它数据源用的，Tushare 分支会返回全量。
   */
  const loadStocksOfBoards = useCallback(
    async (
      list: Stock.BanKuaiItem[],
      onTick?: (done: number, total: number, stockCount: number) => void,
      shouldStop?: () => boolean,
      excludeStarBse = false
    ): Promise<Stock.DetailItem[] | null> => {
      const map = new Map<string, Stock.DetailItem>();
      const batch = 6;
      for (let i = 0; i < list.length; i += batch) {
        if (shouldStop?.()) {
          return null;
        }
        const part = list.slice(i, i + batch);
        // 分批并发，避免一次打满板块成分股接口
        // eslint-disable-next-line no-await-in-loop
        const results = await Promise.all(
          part.map((b) =>
            Services.Stock.GetBankuaiStocksFromDataSource(FundApiType.Tushare, b.secid, 200)
          )
        );
        results.forEach((r) => {
          (r?.stocks || []).forEach((s) => {
            if (!map.has(s.code)) {
              map.set(s.code, s as Stock.DetailItem);
            }
          });
        });
        onTick?.(Math.min(i + part.length, list.length), list.length, map.size);
      }
      let out = [...map.values()];
      if (excludeStarBse) {
        out = out.filter((s) => !isStarOrBseCode(s.code));
      }
      onTick?.(list.length, list.length, out.length);
      return out;
    },
    []
  );

  const setParam = (key: keyof ShortScoreBacktestParams) => (v: number | null) =>
    setParams((prev) => ({ ...prev, [key]: typeof v === 'number' ? v : prev[key] }));

  /** 均线区间下拉的当前值（'5:20'；关闭时为空串） */
  const maBandValue =
    params.maBandLow > 0 && params.maBandHigh > params.maBandLow
      ? maBandKey({ low: params.maBandLow, high: params.maBandHigh })
      : '';
  const setMaBand = (v?: string | null) => {
    const band = parseMaBand(v);
    setParams((prev) => ({ ...prev, maBandLow: band ? band.low : 0, maBandHigh: band ? band.high : 0 }));
  };

  // 区间 → 需要的K线根数（自然日 × 0.72 ≈ 交易日，再留 40 根给低位/均线回看）
  const effLimit = useMemo(() => {
    if (!range || !range[0] || !range[1]) {
      return limit;
    }
    const days = Math.abs(dayjs(range[1]).diff(dayjs(range[0]), 'day'));
    return Math.min(600, Math.max(60, Math.ceil(days * 0.72) + 40));
  }, [range, limit]);

  const handleRun = useCallback(async () => {
    // 伪选项（只看题材/只看风格）先展开成一批真实板块，再合并成分股
    const targets = expandBoards(secid);
    if (!targets.length) {
      setError(isPseudoBoardSecid(secid) ? '当前概念板块里没有匹配的板块' : '请先选择板块');
      return;
    }
    setRunning(true);
    setError('');
    setResult(null);
    setProgress({ done: 0, total: 0, name: '' });
    stopRef.current = false;
    try {
      const stocks = await loadStocksOfBoards(
        targets,
        (done, total, count) =>
          setProgress({ done: 0, total: 0, name: `读取板块成分股 ${done}/${total}（已合并 ${count} 只）` }),
        () => stopRef.current,
        excludeStarBse
      );
      if (!stocks) {
        return;
      }
      if (!stocks.length) {
        setError('该板块没有取到成分股');
        return;
      }
      const r = await runBoardScoreBacktest({
        board: { secid, name: selectedBoardName || `${targets.length} 个板块`, type: boardType },
        stocks: stocks.map((s) => ({ code: s.code, name: s.name })),
        params,
        source: kLineApiSourceSetting,
        limit: effLimit,
        startDate: range?.[0] ? dayjs(range[0]).format('YYYY-MM-DD') : undefined,
        endDate: range?.[1] ? dayjs(range[1]).format('YYYY-MM-DD') : undefined,
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
  }, [
    expandBoards,
    loadStocksOfBoards,
    selectedBoardName,
    secid,
    boardType,
    params,
    effLimit,
    range,
    maxStocks,
    concurrency,
    excludeStarBse,
  ]);

  const openStock = useCallback(
    (r: BoardBacktestStock) => {
      const secidOf = /^6/.test(r.code) ? `1.${r.code}` : `0.${r.code}`;
      onOpenStock?.(secidOf, r.name);
    },
    [onOpenStock]
  );

  const openTradeStock = useCallback(
    (r: { code: string; name: string }) => {
      const secidOf = /^6/.test(r.code) ? `1.${r.code}` : `0.${r.code}`;
      onOpenStock?.(secidOf, r.name);
    },
    [onOpenStock]
  );

  const openCacheModal = useCallback(() => {
    if (!secid) {
      message.warning('请先选择板块');
      return;
    }
    setCacheResult(null);
    setCacheMsg('');
    setCacheDone(0);
    setCacheTotal(0);
    cachePauseRef.current = false;
    setCacheOpen(true);
  }, [secid]);

  /**
   * 生成板块成分股的评分缓存
   *
   * 评分序列缓存（meta.db / api_cache 的 short_term_score_series_*）目前只有应用会写：
   * 板块回测面板、个股回测、离线脚本 backtest_short_score_jump.py 都读同一份。
   * 这里按「板块成分股 × 交易日区间」批量预计算，口径与 STList「短线评分 / 历史补全」完全一致
   * （同一个 precomputeShortTermScores + SHORT_SCORE_SOURCE），算完即可被脚本按 --version current 读取。
   *
   * 默认增量：已覆盖的「交易日 × 股票」直接跳过；勾选「重算」才会覆盖旧行
   * （改了评分公式时用，注意同时 bump SCORE_ROW_VERSION）。
   */
  const handleGenerateCache = useCallback(async () => {
    if (cacheRunning) {
      cachePauseRef.current = true;
      setCacheMsg('正在停止（当前交易日算完后结束，已算完的已落盘）...');
      return;
    }
    const targets = expandBoards(secid);
    if (!targets.length) {
      message.warning(isPseudoBoardSecid(secid) ? '当前概念板块里没有匹配的板块' : '请先选择板块');
      return;
    }
    const [start, end] = cacheRange || [];
    if (!start || !end) {
      message.warning('请选择起止日期');
      return;
    }
    const startDate = start.format('YYYY-MM-DD');
    const endDate = end.format('YYYY-MM-DD');
    if (startDate > endDate) {
      message.warning('开始日期不能晚于结束日期');
      return;
    }
    cachePauseRef.current = false;
    setCacheRunning(true);
    setCacheResult(null);
    setCacheDone(0);
    setCacheTotal(0);
    setCacheMsg('准备中：读取板块成分股...');
    try {
      const stocks = await loadStocksOfBoards(
        targets,
        (done, total, count) =>
          setCacheMsg(`准备中：读取板块成分股 ${done}/${total}（已合并 ${count} 只）`),
        () => cachePauseRef.current,
        excludeStarBse
      );
      if (stocks === null) {
        setCacheMsg('已停止');
        return;
      }
      if (!stocks.length) {
        setCacheMsg('该板块没有取到成分股');
        return;
      }
      const items: ShortTermScoreItem[] = stocks.map((s) => ({ code: s.code, name: s.name }));
      setCacheMsg(`准备中...（${items.length} 只，${startDate} ~ ${endDate}）`);
      const r = await precomputeShortTermScores({
        items,
        startDate,
        endDate,
        source: SHORT_SCORE_SOURCE,
        // 列表侧「近 N 日评分」需要往前多覆盖几天；回测窗口由这里的起止日期决定
        historyDays: 20,
        ignoreCache: cacheForce,
        shouldStop: () => cachePauseRef.current,
        onProgress: (done, total, msg) => {
          setCacheDone(done);
          setCacheTotal(total);
          setCacheMsg(msg);
        },
      });
      setCacheResult(r);
      const head = cachePauseRef.current ? '已停止' : '完成';
      const tail = r.missingRows
        ? `；${r.missingRows} 条「交易日×股票」未覆盖（停牌/日K不足，再跑一次会增量补）`
        : '；整段窗口已全部覆盖';
      setCacheMsg(
        `${head}：新算 ${r.dates} 天 / 复用 ${r.reused} 天（共 ${r.totalDates} 天），写入 ${r.rows} 行${tail}`
      );
      message.success(`评分缓存${head}：写入 ${r.rows} 行（${items.length} 只股票）`);
    } catch (e: any) {
      setCacheMsg(`生成失败：${e?.message || e}`);
    } finally {
      setCacheRunning(false);
    }
  }, [cacheRunning, expandBoards, loadStocksOfBoards, secid, cacheRange, cacheForce, excludeStarBse]);

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

  // 交易明细：默认按收益升序（先看亏得最惨的，方便找策略缺陷）
  const tradeColumns = [
    {
      title: '买入日',
      dataIndex: 'entryDate',
      width: 100,
      sorter: (a: any, b: any) => String(a.entryDate).localeCompare(String(b.entryDate)),
    },
    {
      title: '卖出日',
      dataIndex: 'exitDate',
      width: 100,
      sorter: (a: any, b: any) => String(a.exitDate).localeCompare(String(b.exitDate)),
    },
    {
      title: '持有',
      dataIndex: 'bars',
      width: 62,
      sorter: (a: any, b: any) => a.bars - b.bars,
      render: (v: number) => `${v}日`,
    },
    { title: '代码', dataIndex: 'code', width: 78 },
    {
      title: '名称',
      dataIndex: 'name',
      width: 100,
      render: (v: string, r: any) => (
        <a onClick={() => openTradeStock(r)} title="打开个股详情">
          {v || r.code}
        </a>
      ),
    },
    {
      title: '买入价',
      dataIndex: 'entryPrice',
      width: 76,
      render: (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—'),
    },
    {
      title: '卖出价',
      dataIndex: 'exitPrice',
      width: 76,
      render: (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—'),
    },
    {
      title: '收益',
      dataIndex: 'ret',
      width: 88,
      defaultSortOrder: 'ascend' as const,
      sorter: (a: any, b: any) => a.ret - b.ret,
      render: (v: number) => (
        <span style={{ color: v >= 0 ? 'var(--increase-color)' : 'var(--reduce-color)' }}>{pct(v)}</span>
      ),
    },
    {
      title: '信号Δ',
      dataIndex: 'deltaIn',
      width: 76,
      sorter: (a: any, b: any) => a.deltaIn - b.deltaIn,
      render: (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '—'),
    },
    {
      title: '跳空',
      dataIndex: 'gapIn',
      width: 76,
      sorter: (a: any, b: any) => a.gapIn - b.gapIn,
      render: (v: number) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}%` : '—'),
    },
    {
      title: '卖出原因',
      dataIndex: 'exitReason',
      width: 100,
      render: (v: string) => (
        <Tag color={v === '绿柱卖出' ? 'blue' : v === '回撤止盈' ? 'orange' : 'default'}>
          {v === '窗口结束' ? '持仓中' : v}
        </Tag>
      ),
    },
  ];

  const exportTrades = useCallback(() => {
    const rows = result?.trades || [];
    if (!rows.length) {
      message.warning('当前没有可导出的交易');
      return;
    }
    const head = [
      '买入日', '卖出日', '持有天数', '代码', '名称', '买入价', '卖出价',
      '收益%', '信号Δ', '跳空%', '卖出原因',
    ];
    const body = rows.map((t) =>
      [
        t.entryDate, t.exitDate, t.bars, t.code, t.name,
        Number(t.entryPrice).toFixed(2), Number(t.exitPrice).toFixed(2),
        (t.ret * 100).toFixed(2), Number(t.deltaIn).toFixed(2), Number(t.gapIn).toFixed(2),
        t.open ? '持仓中' : t.exitReason,
      ].join(',')
    );
    const csv = `\ufeff${[head.join(','), ...body].join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `板块回测交易明细_${result?.board.name || ''}_${dayjs().format('YYYYMMDD_HHmm')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    // 显式指定文字色：面板里有大量裸文本（工具栏标签、提示语），
    // 不指定的话会继承 body 的浏览器默认黑色，暗黑模式下就是黑字压深色底
    <div style={{ padding: 12, height: '100%', overflow: 'auto', color: 'var(--main-text-color)' }}>
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
            placeholder={boardType === BKType.Industry ? '选择行业板块' : '选择概念板块（含只看题材/风格）'}
            style={{ width: 240, marginLeft: 6 }}
            optionFilterProp="children"
            onChange={(v) => setSecid(String(v))}
          >
            {boardType === BKType.Gainian && (
              <Select.Option value={THEME_ONLY_SECID} key={THEME_ONLY_SECID}>
                只看题材
              </Select.Option>
            )}
            {boardType === BKType.Gainian && (
              <Select.Option value={STYLE_ONLY_SECID} key={STYLE_ONLY_SECID}>
                只看风格
              </Select.Option>
            )}
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
        <span title="均线区间：信号日收盘价必须在短均线之上、长均线之下（上升中继回调）；与离线脚本 --ma-band 同口径">
          均线区间
          <Select
            size="small"
            allowClear
            value={maBandValue || undefined}
            placeholder="不过滤"
            style={{ width: 150, marginLeft: 6 }}
            onChange={(v) => setMaBand(v as string)}
            options={MA_BAND_OPTIONS.filter((o) => o.value)}
          />
        </span>
        <span>
          卖出 Δ≤
          <InputNumber size="small" value={params.sellDelta} step={1} onChange={setParam('sellDelta')} style={{ width: 70 }} />
        </span>
        <span title="突变前 N 个评分日必须都 ≤ 该上限；天数填 0 关闭">
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
        <span title="评分自持仓期最高点回撤达到该分数即卖出；填 0 关闭">
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
          回测区间
          <DatePicker.RangePicker
            size="small"
            value={range}
            allowClear
            placeholder={['历史起点', '历史终点']}
            onChange={(v) => setRange(v)}
            style={{ width: 215 }}
            disabledDate={(d: any) => !!d && d.isAfter(dayjs(), 'day')}
          />
        </span>
        <span title={range ? '已按所选区间自动换算所需K线根数' : '未选区间时回测最近 N 个交易日'}>
          窗口
          <InputNumber
            size="small"
            value={range ? effLimit : limit}
            min={20}
            max={600}
            step={20}
            disabled={!!range}
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
        <Checkbox
          checked={excludeStarBse}
          onChange={(e) => setExcludeStarBse(e.target.checked)}
          disabled={running}
          style={{ marginLeft: 4 }}
        >
          排除科创/北交
        </Checkbox>
        <Button type="primary" size="small" loading={running} disabled={!secid} onClick={() => void handleRun()}>
          开始回测
        </Button>
        <Button
          size="small"
          disabled={!secid || running}
          title="按板块成分股批量预计算短线评分并写入评分序列缓存（离线脚本 / 回测面板都读这份缓存）"
          onClick={openCacheModal}
        >
          生成评分缓存
        </Button>
        {running ? (
          <Button size="small" onClick={() => { stopRef.current = true; }}>
            停止
          </Button>
        ) : null}
      </Space>

      <div style={{ fontSize: 12, color: 'var(--secondary-text-color)', marginBottom: 8 }}>
        逐只现算评分曲线（与个股回测同口径），耗时≈成分股只数 × 取数时间；「回测只数」限制本次参与计算的股票数（0=全部）。
        选了「区间」就只统计买入日落在区间内的交易，区间越长需要算的K线越多、越慢；
        「今日信号」仍是窗口最后一根K线的突变，按次日开盘买入评估。
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
                  {`Δ≥${result.params.buyDelta} / 评分≥${result.params.minScore} / 卖出Δ≤${result.params.sellDelta} / 低位≤${result.params.lowBaseMax}持续${result.params.lowBaseDays}日 / 回撤${result.params.trailDrop}分止盈 / 冷却${result.params.cooldownDays}日 / 跳空±${result.params.maxGapPct}%` +
                    (result.params.maBandLow > 0 && result.params.maBandHigh > result.params.maBandLow
                      ? ` / 区间 MA${result.params.maBandLow}<价<MA${result.params.maBandHigh}`
                      : ' / 区间 关闭')}
                </Descriptions.Item>
                <Descriptions.Item label="生成时间">{result.generatedAt.replace('T', ' ').substring(0, 19)}</Descriptions.Item>
              </Descriptions>
            </Col>
          </Row>
          {result.trades.length ? (
            <Descriptions size="small" column={4} bordered style={{ marginBottom: 8 }}>
              <Descriptions.Item label="成交区间">
                {fmtDay(result.rangeStart)} ~ {fmtDay(result.rangeEnd)}
              </Descriptions.Item>
              <Descriptions.Item label="交易">
                {result.summary.trades} 笔
                {result.trades.some((t) => t.open)
                  ? `（另有 ${result.trades.filter((t) => t.open).length} 笔持仓中，未计入）`
                  : ''}
              </Descriptions.Item>
              <Descriptions.Item label="胜率">{(result.summary.winRate * 100).toFixed(1)}%</Descriptions.Item>
              <Descriptions.Item label="期望/笔">
                {pct(result.summary.avgRet)}（中位 {pct(result.summary.medianRet)}）
              </Descriptions.Item>
              <Descriptions.Item label="盈亏比">
                {Number.isFinite(result.summary.payoff) ? result.summary.payoff.toFixed(2) : '∞'}
              </Descriptions.Item>
              <Descriptions.Item label="盈利因子">
                {Number.isFinite(result.summary.profitFactor) ? result.summary.profitFactor.toFixed(2) : '∞'}
              </Descriptions.Item>
              <Descriptions.Item label="平均持仓">{result.summary.avgBars.toFixed(1)} 日</Descriptions.Item>
              <Descriptions.Item label="最好/最差">
                {pct(result.summary.best)} / {pct(result.summary.worst)}
              </Descriptions.Item>
            </Descriptions>
          ) : null}
          <Tabs size="small" defaultActiveKey="trades">
            <Tabs.TabPane tab={`交易明细（${result.trades.length}）`} key="trades">
              <Space style={{ marginBottom: 8 }} wrap size={8}>
                <Button size="small" onClick={exportTrades} disabled={!result.trades.length}>
                  导出 CSV
                </Button>
                <span style={{ fontSize: 12, color: 'var(--secondary-text-color)' }}>
                  默认按收益升序（亏损最多的在最前），点表头可换排序；「持仓中」= 窗口末未平仓，不计入汇总
                </span>
              </Space>
              <Table
                size="small"
                rowKey="key"
                columns={tradeColumns as any}
                dataSource={result.trades}
                pagination={{ pageSize: 30, size: 'small', showSizeChanger: false }}
                scroll={{ x: 1000 }}
                locale={{ emptyText: '区间内没有成交：可放宽阈值、取消均线区间过滤，或换更长的区间' }}
              />
            </Tabs.TabPane>
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

      <Modal
        title={`生成评分缓存 · ${selectedBoardName || '未选板块'}`}
        open={cacheOpen}
        width={640}
        footer={null}
        maskClosable={!cacheRunning}
        onCancel={() => {
          if (cacheRunning) {
            // 运行中先不发关闭：只标记停止，等当前交易日算完后结果可见
            cachePauseRef.current = true;
            setCacheMsg('正在停止（当前交易日算完后结束，已算完的已落盘）...');
            return;
          }
          setCacheOpen(false);
        }}
      >
        <div
          style={{ fontSize: 12, color: 'var(--secondary-text-color)', lineHeight: 1.7, marginBottom: 12 }}
        >
          对「该板块全部成分股」逐日计算短线评分，写入评分序列缓存
          （<code>short_term_score_series_*</code>）。离线脚本
          <code> backtest_short_score_jump.py</code> 与板块回测读的是同一份缓存，生成后即可直接回测。
          <br />
          默认<b>增量</b>：已覆盖的「交易日 × 股票」自动跳过；中断后再次点击可续算。
          <br />
          想让脚本能按默认 <code>--min-days 120</code> 回测，区间至少要覆盖 120 个交易日
          （约半年），窗口越长、单股历史信号越多，个股层面的统计才越有意义。
        </div>
        <Row gutter={8} align="middle" style={{ marginBottom: 10 }}>
          <Col span={5}>区间</Col>
          <Col span={19}>
            <DatePicker.RangePicker
              style={{ width: '100%' }}
              value={cacheRange}
              onChange={(v: any) => setCacheRange(v)}
              allowClear={false}
              disabled={cacheRunning}
            />
          </Col>
        </Row>
        <Row gutter={8} align="middle" style={{ marginBottom: 10 }}>
          <Col span={5}>重算口径</Col>
          <Col span={19}>
            <Checkbox
              checked={cacheForce}
              disabled={cacheRunning}
              onChange={(e) => setCacheForce(e.target.checked)}
            >
              重算已有评分（覆盖旧缓存行，会明显更慢；改了评分公式时才需要）
            </Checkbox>
          </Col>
        </Row>
        {cacheMsg ? (
          <div style={{ fontSize: 12, marginBottom: 8, wordBreak: 'break-all' }}>{cacheMsg}</div>
        ) : null}
        {cacheRunning || cacheTotal > 0 ? (
          <Progress
            percent={cacheTotal > 0 ? Math.round((cacheDone / cacheTotal) * 100) : 0}
            size="small"
            status={cacheRunning ? 'active' : 'normal'}
            format={() => (cacheTotal > 0 ? `${cacheDone}/${cacheTotal} 天` : '准备中')}
            style={{ marginBottom: 10 }}
          />
        ) : null}
        {cacheResult ? (
          <Descriptions size="small" column={2} style={{ marginBottom: 10 }}>
            <Descriptions.Item label="新算">{cacheResult.dates} 天</Descriptions.Item>
            <Descriptions.Item label="复用">{cacheResult.reused} 天</Descriptions.Item>
            <Descriptions.Item label="写入">{cacheResult.rows} 行</Descriptions.Item>
            <Descriptions.Item label="未覆盖">
              {cacheResult.missingRows} 条
              {cacheResult.verifyFailed ? '（校验调用失败）' : ''}
            </Descriptions.Item>
            <Descriptions.Item label="写失败">{cacheResult.writeErrors} 批</Descriptions.Item>
            <Descriptions.Item label="跳过">
              {cacheResult.skipped} 行（数据不足）
            </Descriptions.Item>
          </Descriptions>
        ) : null}
        <Space>
          <Button
            type="primary"
            danger={cacheRunning}
            size="small"
            loading={cacheRunning && cachePauseRef.current}
            onClick={() => void handleGenerateCache()}
          >
            {cacheRunning ? (cachePauseRef.current ? '正在停止' : '停止') : '开始生成'}
          </Button>
          <Button size="small" disabled={cacheRunning} onClick={() => setCacheOpen(false)}>
            关闭
          </Button>
        </Space>
      </Modal>
    </div>
  );
};

export default BoardSignalBacktest;
