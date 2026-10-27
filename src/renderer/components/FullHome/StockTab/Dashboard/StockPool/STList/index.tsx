import React, { useEffect } from 'react';
import { Button, List, Row, Col, Radio, Select, Checkbox, InputNumber, Input, Pagination, Modal, message, Dropdown } from 'antd';
import styles from '../index.scss';
import * as Services from '@/services';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
import * as Helpers from '@/helpers';
import { useState } from 'react';
import { Stock } from '@/types/stock';
import { useRequest } from 'ahooks';
import { useCallback } from 'react';
import {
  GetIndustryStocksFromTushare,
  GetIndustryLeadersFromTushare,
  RiskFilterStocksFromTushare,
  CheckBuySignalsFromTushare,
  MainInFilterStocksFromTushare,
} from '@/services/tushare';
import { useWorkDayTimeToDo } from '@/utils/hooks';
import { BKType, KFilterType, KFilterTypeNames } from '@/utils/enums';
import classNames from 'classnames';
import { batch, useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { CaretDownOutlined, CaretRightOutlined, CaretUpOutlined, FilterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  computeShortTermScoreRows,
  computeTodayScoreRows,
  loadScoreSeries,
  resolveRecentTradingDays,
  ShortTermScoreItem,
  ShortTermScoreRow,
  ShortTermScoreSeries,
} from '@/helpers/shortTermScoreList';
import { precomputeShortTermScores } from '@/helpers/shortTermScorePrecompute';
import {
  compareKlineShape,
  KLINE_SHAPE_FILTER_OPTIONS,
  KLINE_SHAPE_SORT_KEY,
  normalizeKlineShape,
} from '@/helpers/klineShape';
import { RSI_SHAPE_FILTER_OPTIONS, normalizeRsiShape } from '@/helpers/rsiShape';
import { saveTrainDayAction } from '@/actions/train';

/** 短线评分列表「近 N 日评分」历史列展示的交易日数量（仅影响展示列数，过滤窗口另有其天数） */
const SHORT_SCORE_HISTORY_DAYS = 15;

/**
 * 执行「短线评分 / 预计算训练评分」时顺带补全的历史评分天数
 *
 * 点一次评分就把最近 20 个交易日的评分补齐（写回评分序列），历史列不再逐日出现 `--`；
 * 过滤窗口更宽时按窗口天数补（见 shortScoreHistoryDays）。
 */
const SHORT_SCORE_BACKFILL_DAYS = 20;

/** 「K线形态」后行标记的默认值：未定 = 未标记（不写入存储） */
const ROW_MARK_DEFAULT = '未定';

/** 「K线形态」后行标记可选项：人工给股票打标签（默认「未定」，按股票代码持久化） */
const ROW_MARK_OPTIONS = [ROW_MARK_DEFAULT, '趋势', '横排', '回调', '反弹'];

const kFilterOptions = [
  { label: KFilterTypeNames[KFilterType.ZJZT], value: KFilterType.ZJZT },
  { label: KFilterTypeNames[KFilterType.FLYX], value: KFilterType.FLYX },
  { label: KFilterTypeNames[KFilterType.XYJC], value: KFilterType.XYJC },
  { label: KFilterTypeNames[KFilterType.TPHP], value: KFilterType.TPHP },
  { label: KFilterTypeNames[KFilterType.FQFB], value: KFilterType.FQFB },
  { label: KFilterTypeNames[KFilterType.FYZS], value: KFilterType.FYZS },
];

/**
 * 是否为「科创板 / 北交所」标的（按 6 位代码判断）
 * - 科创板：688xxx / 689xxx（沪市）
 * - 北交所：43xxxx / 83xxxx / 87xxxx / 88xxxx / 920xxx
 */
const isStarOrBseCode = (code: string): boolean => {
  const c = String(code || '').trim();
  if (!c) {
    return false;
  }
  return (
    c.startsWith('688') ||
    c.startsWith('689') ||
    c.startsWith('43') ||
    c.startsWith('83') ||
    c.startsWith('87') ||
    c.startsWith('88') ||
    c.startsWith('920')
  );
};

/** 从列表行里取 6 位股票代码（列表行可能是 code / ts_code / secid 三种形态） */
const codeOfListItem = (item: any): string => {
  if (!item) {
    return '';
  }
  if (item.code) {
    return String(item.code).split('.')[0];
  }
  if (item.ts_code) {
    return String(item.ts_code).split('.')[0];
  }
  if (item.secid) {
    return String(item.secid).split('.').pop() || '';
  }
  return '';
};

/** 取列表行的名称：各展示模式的字段可能叫 name / stockName */
const nameOfListItem = (item: any): string => {
  if (!item) {
    return '';
  }
  return String(item.name ?? item.stockName ?? '');
};

export interface STListProps {
  industries: Stock.BanKuaiItem[];
  gainians: Stock.BanKuaiItem[];
  bktype: BKType;
  secid: string;
  onChangeBK: (t: BKType, s: string) => void;
  onOpenStock: (secid: string, name: string) => void;
  /** 打开股票并直接切换到详情页（持仓弹窗里点击股票时用；列表行仍用 onOpenStock 后台开标签页） */
  onOpenStockFocus?: (secid: string, name: string) => void;
  active: boolean;
}

const STList: React.FC<STListProps> = ({
  industries,
  gainians,
  bktype,
  secid,
  onChangeBK,
  onOpenStock,
  onOpenStockFocus,
  active,
}) => {
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [fdays, setFdays] = useState(8);
  const [filtering, setFiltering] = useState(false);
  const [ftypes, setFtypes] = useState<number[]>([]);
  const [filterSecids, setFilterSecids] = useState<string[]>([]);
  const [nameFilter, setNameFilter] = useState('');
  /** 排除科创板 + 北交所（默认勾选）：同时作用于列表展示与评分池（短线评分 / 训练周期预计算） */
  const [excludeStarBse, setExcludeStarBse] = useState(true);
  const [sortTypes, setSortTypes] = useState<Record<string, number>>({});

  // 选股流程状态
  const [displayMode, setDisplayMode] = useState<'stocks' | 'leaders' | 'risk' | 'signals' | 'mainIn' | 'shortScore'>('stocks');

  // 龙头股识别
  const [leaderLoading, setLeaderLoading] = useState(false);
  const [leaderData, setLeaderData] = useState<any[]>([]);
  const [leaderDisplayCount, setLeaderDisplayCount] = useState(0);
  const [leaderProgress, setLeaderProgress] = useState(0);
  const isLeaderPausedRef = React.useRef(false);
  const leaderIndexRef = React.useRef(0);

  // 排雷过滤
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskData, setRiskData] = useState<any[]>([]);
  const [riskDisplayCount, setRiskDisplayCount] = useState(0);
  const [riskProgress, setRiskProgress] = useState(0);
  const isRiskPausedRef = React.useRef(false);
  const riskIndexRef = React.useRef(0);

  // 择时信号
  const [signalLoading, setSignalLoading] = useState(false);
  const [signalData, setSignalData] = useState<any[]>([]);
  const [signalDisplayCount, setSignalDisplayCount] = useState(0);
  const [signalProgress, setSignalProgress] = useState(0);
  const isSignalPausedRef = React.useRef(false);
  const signalIndexRef = React.useRef(0);

  // 主力建仓过滤
  const [mainInLoading, setMainInLoading] = useState(false);
  const [mainInData, setMainInData] = useState<any[]>([]);
  const [mainInDisplayCount, setMainInDisplayCount] = useState(0);
  const [mainInProgress, setMainInProgress] = useState(0);
  const isMainInPausedRef = React.useRef(false);
  const mainInIndexRef = React.useRef(0);

  // 短线评分
  const [shortScoreLoading, setShortScoreLoading] = useState(false);
  const [shortScoreData, setShortScoreData] = useState<ShortTermScoreRow[]>([]);
  const [shortScoreProgress, setShortScoreProgress] = useState(0);
  const isShortScorePausedRef = React.useRef(false);
  const isShortScoreRunningRef = React.useRef(false);
  const shortScoreRemainingRef = React.useRef<ShortTermScoreItem[]>([]);
  const shortScoreTotalRef = React.useRef(0);
  const shortScoreCodesRef = React.useRef<string[]>([]);
  // 「近 N 日评分」历史列：交易日列表 + 每只股票的评分序列
  const [shortScoreDays, setShortScoreDays] = useState<string[]>([]);
  const [shortScoreSeries, setShortScoreSeries] = useState<ShortTermScoreSeries>({});
  /** 历史缺口补算进度：执行短线评分时顺带补齐近 N 个交易日缺的评分 */
  const [shortScoreBackfill, setShortScoreBackfill] = useState<{ done: number; total: number } | null>(null);
  // 过滤：仅保留「N 天前的近 M 个交易日出现过 ≥ 阈值分」的股票
  // （阈值分、天数都可填写，默认：3 天前 / 近 15 日 / ≥ 60 分）
  const [shortScoreFilterEnabled, setShortScoreFilterEnabled] = useState(false);
  const [shortScoreFilterScore, setShortScoreFilterScore] = useState(60);
  /** 过滤窗口的回溯起点：从「N 天前」开始往前数（即窗口不含最近 N 个交易日） */
  const [shortScoreFilterBeforeDays, setShortScoreFilterBeforeDays] = useState(5);
  /** 过滤窗口的长度：近 M 个交易日 */
  const [shortScoreFilterWindowDays, setShortScoreFilterWindowDays] = useState(15);
  // RSI 评分阈值过滤：仅显示 RSI 评分「大于」阈值的股票（RSI 满分 40）
  const [shortScoreRsiFilterEnabled, setShortScoreRsiFilterEnabled] = useState(false);
  const [shortScoreRsiFilterScore, setShortScoreRsiFilterScore] = useState(30);
  // 是否显示「评分基准日尚未上市」的股票：默认隐藏（训练回看历史日时，当前成分股里常含大量当时还没上市的新股，
  // 它们没有分数、又排在列表最前面，会把第一页占满）
  const [shortScoreShowNotListed, setShortScoreShowNotListed] = useState(false);
  // K线形态筛选：仅显示所选形态的股票（多选，空数组=不过滤；同一形态名不区分阴阳）
  const [shortScoreKlineShapes, setShortScoreKlineShapes] = useState<string[]>([]);
  // RSI形态筛选：仅显示所选形态的股票（多选，空数组=不过滤；按归一化后的形态 key 过滤）
  const [shortScoreRsiShapes, setShortScoreRsiShapes] = useState<string[]>([]);
  /**
   * 行标记（K线形态后的下拉选择）：股票代码 -> 趋势 / 横排 / 回调 / 反弹
   *
   * 人工给股票打的标签，与评分无关：默认「未定」（未标记，不写入存储）；
   * 选中其它值后按股票代码持久化到 localStorage，切换板块、重新评分、重启应用后仍然保留。
   */
  const [shortScoreRowMarks, setShortScoreRowMarks] = useState<Record<string, string>>(
    () => (Utils.GetStorage(CONST.STORAGE.SHORT_TERM_SCORE_ROW_MARKS, {}) as Record<string, string>) || {}
  );
  /**
   * 短线评分需要加载/补全的交易日数量
   *
   * 三者的最大值：
   * - SHORT_SCORE_HISTORY_DAYS：「近 N 日评分」历史列展示的天数；
   * - SHORT_SCORE_BACKFILL_DAYS：执行短线评分时顺带补全的历史评分天数（至少最近 20 个交易日）；
   * - 过滤窗口「N 天前的近 M 日」的最远回溯距离。
   * 这样点一次短线评分，历史列与过滤窗口用到的评分都会被补齐，不用再逐日手动补。
   */
  const shortScoreHistoryDays = React.useMemo(
    () =>
      Math.max(
        SHORT_SCORE_HISTORY_DAYS,
        SHORT_SCORE_BACKFILL_DAYS,
        Math.max(0, Number(shortScoreFilterBeforeDays) || 0) + Math.max(1, Number(shortScoreFilterWindowDays) || 0)
      ),
    [shortScoreFilterBeforeDays, shortScoreFilterWindowDays]
  );
  // 当日评分（用当日分时补全当日K线后重新评分）
  const [todayScoreLoading, setTodayScoreLoading] = useState(false);
  const [todayScoreProgress, setTodayScoreProgress] = useState(0);
  const isTodayScorePausedRef = React.useRef(false);
  const todayScoreRunningRef = React.useRef(false);
  const todayScoreDoneRef = React.useRef(0);
  // 多板块选择：短线评分可同时选择多个板块
  const [selectedSecids, setSelectedSecids] = useState<string[]>([]);
  const selectedSecidsRef = React.useRef<string[]>([]);
  selectedSecidsRef.current = selectedSecids;
  /** 已选板块的组合签名（排序后拼接）：作为「板块身份」，替代单板块的 secid */
  const boardsKey = React.useMemo(() => [...selectedSecids].sort().join(','), [selectedSecids]);
  const boardsKeyRef = React.useRef('');
  boardsKeyRef.current = boardsKey;
  /** 每个板块的成分股缓存：secid -> stocks（多板块合并前各自独立保存） */
  const boardStocksCacheRef = React.useRef<Record<string, Stock.DetailItem[]>>({});
  /** 每只股票所属的「已选板块」secid 列表（code -> secid[]），用于结果列表标记所属板块 */
  const [stockBoardSecidsMap, setStockBoardSecidsMap] = useState<Record<string, string[]>>({});
  /**
   * 已选板块 -> 评分用的「所属板块」（代码去掉市场前缀：90.BK0428 -> BK0428）
   *
   * 短线评分 / 预计算里「板块维度」占 20% 权重，板块K线必须取**当前选中的板块**：
   * 否则 resolveBoards 会退回东财返回的第一批所属板块（行业/风格板块），
   * 板块分就算到了与用户所选板块无关的地方。代码口径与 getBoardKlines 的 `90.${code}` 一致。
   */
  const selectedBoardMeta = React.useMemo(() => {
    const all = [...industries, ...gainians];
    const meta: Record<string, { code: string; name: string }> = {};
    selectedSecids.forEach((sid) => {
      const found = all.find((b) => b.secid === sid);
      const code = String(sid).includes('.') ? String(sid).split('.').pop() || '' : String(sid);
      if (code) {
        meta[sid] = { code, name: found?.name || code };
      }
    });
    return meta;
  }, [selectedSecids, industries, gainians]);
  // 板块身份：评分结果与股票池都绑定「已选板块组合」，切换板块后必须整体重来
  /** 上一次评分结果所属的板块组合（用于判断能否沿用上一次的股票池） */
  const shortScorePoolRef = React.useRef('');
  /** 当前 stocks 列表属于哪个板块（板块切换后立刻点评分时，stocks 可能还是上一板块的列表） */
  const stocksBoardRef = React.useRef('');
  /** 评分结果列表的来源：'score'=短线评分，'today'=当日评分（切板块后按同样方式自动重算） */
  const shortScoreSourceRef = React.useRef<'score' | 'today'>('score');
  /** displayMode 的最新值（切换板块的 effect 里要读「切换前」的模式，避免闭包过期） */
  const displayModeRef = React.useRef(displayMode);
  displayModeRef.current = displayMode;
  /** 「启动中」锁：从进入评分函数到真正开跑之间（在等板块股票列表）不允许被重复触发 */
  const scoreStartingRef = React.useRef(false);

  // 训练周期评分预计算（仅训练模式）：把训练窗口内每个交易日 × 每只股票的评分预先算好并落库
  const [precomputing, setPrecomputing] = useState(false);
  const [precomputeDone, setPrecomputeDone] = useState(0);
  const [precomputeTotal, setPrecomputeTotal] = useState(0);
  const [precomputeMsg, setPrecomputeMsg] = useState('');
  const isPrecomputePausedRef = React.useRef(false);

  const { kLineApiSourceSetting, ontrain, trainDate, trainStartDate, trainEndDate, initialCapital, commissionRate } =
    useSelector((state: StoreState) => state.setting.systemSetting);
  const { stockConfigsMapping } = useSelector((state: StoreState) => state.stock);
  // 训练工具栏维护的交易日列表 / 训练进度（训练模式下 STList 也要能按交易日推进）
  const { days: trainDays, progress: trainProgress } = useSelector((state: StoreState) => state.train);
  const dispatch = useDispatch();

  // ========== 训练日推进（训练模式下，短线评分结果列表里也能直接看当前交易日 / 下一天） ==========
  // 交易日列表优先用「按当前训练窗口现算」的结果（与训练工具栏同源：大盘日历、含训练日之后的交易日，
  // 因此能算出真正的「下一天」）；取不到时退回训练工具栏写入 store 的列表。
  const [trainWindowDays, setTrainWindowDays] = useState<string[]>([]);
  useEffect(() => {
    if (!ontrain || !trainStartDate || !trainEndDate) {
      setTrainWindowDays([]);
      return;
    }
    let mounted = true;
    Helpers.Stock.GetTrainTradingDays(trainProgress?.secid || '1.000001', trainStartDate, trainEndDate)
      .then((ds) => {
        if (mounted) {
          setTrainWindowDays(ds || []);
        }
      })
      .catch(() => {
        if (mounted) {
          setTrainWindowDays([]);
        }
      });
    return () => {
      mounted = false;
    };
  }, [ontrain, trainStartDate, trainEndDate, trainProgress?.secid]);

  const trainCalendarDays = trainWindowDays.length ? trainWindowDays : trainDays;
  const trainDayIdx = trainDate ? trainCalendarDays.indexOf(trainDate) : -1;
  const nextTrainDay =
    trainDayIdx >= 0 && trainDayIdx < trainCalendarDays.length - 1 ? trainCalendarDays[trainDayIdx + 1] : '';
  /** 上一个交易日：训练日不在列表里（trainDayIdx < 0）时为空 */
  const prevTrainDay = trainDayIdx > 0 ? trainCalendarDays[trainDayIdx - 1] : '';
  const trainFinished = trainCalendarDays.length > 0 && trainDayIdx >= trainCalendarDays.length - 1;

  /**
   * 跳到指定训练日并落盘（「上一天」/「下一天」共用）
   *
   * 与训练工具栏一致：切换一个交易日就落盘一次「训练日 + 训练进度」，
   * 关闭/重启应用后会从这一天继续（见 saveTrainDayAction / restoreTrainCursorAction）；
   * 列表侧监听 trainDate 变化后会清空旧结果并按新训练日重算，因此往回切同样能核对历史数据。
   */
  const handleGotoTrainDay = useCallback(
    (targetDay: string) => {
      if (!targetDay) {
        return;
      }
      // 进度里还没有标的时（第一次从列表切换），用当前选中的板块补上，便于「继续上一次训练」时识别
      const progressSecid = trainProgress?.secid || selectedSecids[0] || secid || '';
      const progressName =
        trainProgress?.name || [...industries, ...gainians].find((i) => i.secid === progressSecid)?.name || '';
      dispatch(
        saveTrainDayAction({
          date: targetDay,
          secid: progressSecid,
          name: progressName,
          startDate: trainStartDate || trainProgress?.startDate || '',
          endDate: trainEndDate || trainProgress?.endDate || '',
          days: trainCalendarDays,
          initialCapital: Number(initialCapital) || trainProgress?.initialCapital || 0,
          commissionRate:
            commissionRate != null && Number.isFinite(Number(commissionRate))
              ? Number(commissionRate)
              : trainProgress?.commissionRate,
        })
      );
      const idx = trainCalendarDays.indexOf(targetDay);
      message.success(
        `已保存训练进度：${targetDay}（${idx + 1}/${trainCalendarDays.length} 个交易日），下次启动从此日继续`
      );
    },
    [
      dispatch,
      trainProgress,
      trainStartDate,
      trainEndDate,
      trainCalendarDays,
      initialCapital,
      commissionRate,
      selectedSecids,
      secid,
      industries,
      gainians,
    ]
  );

  const handleNextTrainDay = useCallback(() => {
    handleGotoTrainDay(nextTrainDay);
  }, [handleGotoTrainDay, nextTrainDay]);

  const handlePrevTrainDay = useCallback(() => {
    handleGotoTrainDay(prevTrainDay);
  }, [handleGotoTrainDay, prevTrainDay]);

  // ========== 当前持仓（训练共享账户，仅训练模式） ==========
  // 持仓来自各标的的模拟买卖点（t='train'），与详情页训练工具栏用同一套回放口径，
  // 因此这里的持仓/可用资金与个股详情页看到的一致。
  const [holdingsOpen, setHoldingsOpen] = useState(false);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [holdingCloses, setHoldingCloses] = useState<Record<string, Record<string, number>>>({});

  const trainAccount = React.useMemo<Helpers.TrainAccount.TrainAccountResult>(() => {
    if (!ontrain) {
      return { cash: 0, realized: 0, positions: [] };
    }
    return Helpers.TrainAccount.ComputeTrainAccount({
      configs: Object.values(stockConfigsMapping || {}),
      startDate: trainStartDate || '',
      currentDay: trainDate || '',
      initialCapital: Number(initialCapital) || 0,
      commissionRate: commissionRate != null ? Number(commissionRate) : undefined,
    });
  }, [ontrain, stockConfigsMapping, trainStartDate, trainDate, initialCapital, commissionRate]);

  /** 持仓标的的 secid 列表（逗号拼接，作为取收盘价的依赖） */
  const holdingSecidsKey = React.useMemo(
    () => trainAccount.positions.map((p) => p.secid).join(','),
    [trainAccount]
  );

  // 打开持仓弹窗后按训练日取各标的的收盘价（数据层已按训练日期截断，不含未来数据）
  useEffect(() => {
    if (!holdingsOpen || !ontrain) {
      return;
    }
    const secids = holdingSecidsKey ? holdingSecidsKey.split(',') : [];
    if (!secids.length) {
      setHoldingCloses({});
      return;
    }
    let mounted = true;
    setHoldingsLoading(true);
    Promise.all(
      secids.map(async (sid) => {
        try {
          return [sid, await Helpers.Stock.GetTrainDayCloses(sid)] as [string, Record<string, number>];
        } catch {
          return [sid, {}] as [string, Record<string, number>];
        }
      })
    ).then((pairs) => {
      if (!mounted) {
        return;
      }
      const m: Record<string, Record<string, number>> = {};
      pairs.forEach(([sid, closes]) => {
        m[sid] = closes;
      });
      setHoldingCloses(m);
      setHoldingsLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [holdingsOpen, ontrain, holdingSecidsKey, trainDate]);

  /** 持仓明细行：训练日收盘价估值（当日停牌时退回最近一个交易日收盘价） */
  const holdingRows = React.useMemo(() => {
    const rows = trainAccount.positions.map((p) => {
      const { day, close } = Helpers.TrainAccount.LastCloseOnOrBefore(holdingCloses[p.secid], trainDate || '');
      const hasPrice = close > 0;
      const price = hasPrice ? close : p.costPrice;
      const marketValue = p.shares * price;
      const profit = hasPrice ? (price - p.costPrice) * p.shares : 0;
      const profitRatio = hasPrice && p.costPrice > 0 ? ((price - p.costPrice) / p.costPrice) * 100 : 0;
      return { ...p, close, closeDay: day, hasPrice, price, marketValue, profit, profitRatio };
    });
    rows.sort((a, b) => b.marketValue - a.marketValue);
    return rows;
  }, [trainAccount, holdingCloses, trainDate]);

  const holdingSummary = React.useMemo(() => {
    const marketValue = holdingRows.reduce((s, r) => s + r.marketValue, 0);
    const cost = holdingRows.reduce((s, r) => s + r.costAmount, 0);
    const profit = holdingRows.reduce((s, r) => s + r.profit, 0);
    return {
      marketValue,
      cost,
      profit,
      profitRatio: cost > 0 ? (profit / cost) * 100 : 0,
      totalAssets: trainAccount.cash + marketValue,
    };
  }, [holdingRows, trainAccount.cash]);

  /** 点击持仓行：关闭弹窗并打开对应股票详情（持仓入口是明确的「打开」动作，直接切到详情页） */
  const openHoldingStock = useCallback(
    (sid: string, name: string) => {
      setHoldingsOpen(false);
      (onOpenStockFocus || onOpenStock)(sid, name);
    },
    [onOpenStock, onOpenStockFocus]
  );

  const { run: runFilterStocks } = useRequest(Helpers.Stock.FilterMultiKlines, {
    throwOnError: true,
    manual: true,
    onSuccess: (data: any[]) => {
      batch(() => {
        setFiltering(false);
        setFilterSecids(data.filter(Utils.NotEmpty));
      });
    },
  });
  const [stocks, setStocks] = useState<Stock.DetailItem[]>([]);
  const { run: runGetStocks } = useRequest(Services.Stock.GetBankuaiStocksFromDataSource, {
    throwOnError: true,
    manual: true,
    onSuccess: (data, params) => {
      const requestedSecid = String((params as any)?.[1] || '');
      if (!requestedSecid) {
        return;
      }
      // 多板块：先把该板块的列表存入缓存（即便它已被取消勾选，也留作再次勾选时秒回）
      boardStocksCacheRef.current[requestedSecid] = data.stocks as Stock.DetailItem[];
      // 板块成分股接口按「涨跌幅」排序并且只取前 N 条（东财源），
      // 返回条数小于真实成分股数时，股票列表与评分池都只是「涨幅靠前的子集」，会随行情漂移。
      const total = Number((data as any)?.total) || 0;
      const got = (data?.stocks || []).length;
      if (total && got && got < total) {
        console.warn(
          `[板块] ${requestedSecid} 成分股被截断：本次只取到 ${got}/${total} 只` +
            `（按涨跌幅排序取前 N），列表成员可能随行情变化`
        );
      }
      if (selectedSecidsRef.current.indexOf(requestedSecid) === -1) {
        // 该板块已不在当前选择中：只缓存，不参与合并
        return;
      }
      const merged = rebuildStocksFromBoards();
      if (ftypes.length > 0) {
        setFiltering(true);
        const base = excludeStarBse ? merged.filter((s) => !isStarOrBseCode(s.code)) : merged;
        runFilterStocks(
          base.map((s) => s.secid),
          ftypes,
          fdays
        );
      }
    },
  });

  /**
   * 「排除科创板+北交所」后的板块股票池
   *
   * 选股漏斗各步（龙头识别 / 排雷 / 择时 / 主力建仓）、K线过滤、列表展示与评分池
   * 统一以它为准：被排除的标的既不进入后续分析请求，也不会出现在列表或评分结果里。
   */
  const poolStocks = React.useMemo(
    () => (excludeStarBse ? stocks.filter((s) => !isStarOrBseCode(s.code)) : stocks),
    [stocks, excludeStarBse]
  );

  const { run: runGetIndustryStocks } = useRequest(GetIndustryStocksFromTushare, {
    throwOnError: true,
    manual: true,
    onSuccess: (data, params) => {
      const requestedSecid = String((params as any)?.[0] || '');
      if (!requestedSecid) {
        return;
      }
      // 多板块：先把该板块的列表存入缓存
      boardStocksCacheRef.current[requestedSecid] = data.stocks as Stock.DetailItem[];
      if (selectedSecidsRef.current.indexOf(requestedSecid) === -1) {
        return;
      }
      const merged = rebuildStocksFromBoards();
      if (ftypes.length > 0) {
        setFiltering(true);
        const base = excludeStarBse ? merged.filter((s) => !isStarOrBseCode(s.code)) : merged;
        runFilterStocks(
          base.map((s) => s.secid),
          ftypes,
          fdays
        );
      }
    },
  });

  /** 拉取指定板块的成分股（多板块时逐板块各发一次请求，避免节流把中间板块吞掉） */
  const loadBoardsStocks = useCallback(
    (secids: string[]) => {
      secids.forEach((s) => {
        if (!s) {
          return;
        }
        if (isSWIndustryCode(s)) {
          // 申万二级行业代码，使用 Tushare index_member 接口
          runGetIndustryStocks(s);
        } else {
          // 东财/同花顺板块代码，走原有逻辑
          runGetStocks(kLineApiSourceSetting, s, 200);
        }
      });
    },
    [kLineApiSourceSetting, runGetIndustryStocks, runGetStocks]
  );

  /** 已选板块的成分股是否都已就绪（缓存里都有） */
  const boardsReady = useCallback(() => {
    const secids = selectedSecidsRef.current;
    return secids.length > 0 && secids.every((s) => boardStocksCacheRef.current[s] !== undefined);
  }, []);

  /** 用各板块缓存的成分股重建「合并股票列表」与「股票→所属板块」映射 */
  const rebuildStocksFromBoards = useCallback(() => {
    const secids = selectedSecidsRef.current;
    const merged: Stock.DetailItem[] = [];
    const seen = new Set<string>();
    const membership: Record<string, string[]> = {};
    secids.forEach((secid) => {
      const list = boardStocksCacheRef.current[secid];
      if (!list) {
        return;
      }
      list.forEach((s) => {
        const code = s.code;
        if (!membership[code]) {
          membership[code] = [];
        }
        if (membership[code].indexOf(secid) === -1) {
          membership[code].push(secid);
        }
        if (!seen.has(code)) {
          seen.add(code);
          merged.push(s);
        }
      });
    });
    setStockBoardSecidsMap(membership);
    setStocks(merged);
    stocksBoardRef.current = boardsKeyRef.current;
    return merged;
  }, []);

  useWorkDayTimeToDo(
    () => {
      loadBoardsStocks(selectedSecidsRef.current);
    },
    active ? CONST.DEFAULT.STOCK_TREND_DELAY : null
  );
  const onPageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  // ========== 龙头股识别 ==========
  const handleFilterLeaders = useCallback(async () => {
    if (leaderLoading) {
      isLeaderPausedRef.current = true;
      return;
    }
    // 龙头识别按「单个板块」进行：多板块时取第一个选中板块
    const primarySecid = selectedSecidsRef.current[0] || secid;
    if (!primarySecid) {
      console.log('[龙头股] 请先选择一个板块/行业');
      return;
    }

    if (leaderIndexRef.current === 0 || leaderIndexRef.current >= leaderData.length) {
      setLeaderData([]);
      setLeaderDisplayCount(0);
      leaderIndexRef.current = 0;
    }

    isLeaderPausedRef.current = false;
    setLeaderLoading(true);
    setLeaderProgress(0);
    setDisplayMode('leaders');
    setCurrentPage(1);

    try {
      const today = dayjs().format('YYYYMMDD');
      // 如果是申万行业代码，直接传入；否则需要查找映射（简化处理：先尝试直接传入）
      const industryCode = isSWIndustryCode(primarySecid) ? primarySecid.split('.').pop() || primarySecid : primarySecid;
      console.log(`[龙头股] 开始识别 ${industryCode} 的龙头...`);

      const result = await GetIndustryLeadersFromTushare(industryCode, today, 20);
      if (!result.leaders || result.leaders.length === 0) {
        console.log('[龙头股] 没有识别到龙头股票');
        setLeaderLoading(false);
        return;
      }

      // 排除科创板+北交所：后端返回的候选龙头里可能包含，这里统一过滤
      const allData = excludeStarBse
        ? result.leaders.filter((d: any) => !isStarOrBseCode(String(d?.ts_code || d?.code || '').split('.')[0]))
        : result.leaders;
      if (!allData.length) {
        console.log('[龙头股] 排除科创板/北交所后没有可显示的标的');
        return;
      }
      console.log(`[龙头股] 获取到 ${allData.length} 只候选龙头，开始显示...`);
      setLeaderData(allData);

      const batchSize = 2;
      const total = allData.length;
      for (let i = leaderIndexRef.current; i < total; i += batchSize) {
        if (isLeaderPausedRef.current) {
          leaderIndexRef.current = i;
          break;
        }
        const end = Math.min(i + batchSize, total);
        setLeaderDisplayCount(end);
        leaderIndexRef.current = end;
        setLeaderProgress(Math.round((end / total) * 100));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      if (!isLeaderPausedRef.current) {
        leaderIndexRef.current = 0;
        setLeaderProgress(100);
        console.log(`[龙头股] 完成，共 ${allData.length} 只候选龙头`);
      }
    } catch (e) {
      console.error('龙头股识别失败:', e);
    } finally {
      setLeaderLoading(false);
    }
  }, [leaderLoading, leaderData.length, secid, excludeStarBse]);

  // ========== 排雷过滤 ==========
  const handleRiskFilter = useCallback(async () => {
    if (riskLoading) {
      isRiskPausedRef.current = true;
      return;
    }
    // 获取当前显示的股票列表的 ts_code
    const currentStocks = displayMode === 'leaders'
      ? leaderData.slice(0, leaderDisplayCount).map((d: any) => d.ts_code)
      : poolStocks.map((s) => {
          const code = s.secid.split('.').pop() || s.secid;
          return code.startsWith('6') ? `${code}.SH` : `${code}.SZ`;
        });

    if (currentStocks.length === 0) {
      console.log('[排雷] 没有可排雷的股票');
      return;
    }

    if (riskIndexRef.current === 0 || riskIndexRef.current >= riskData.length) {
      setRiskData([]);
      setRiskDisplayCount(0);
      riskIndexRef.current = 0;
    }

    isRiskPausedRef.current = false;
    setRiskLoading(true);
    setRiskProgress(0);
    setDisplayMode('risk');
    setCurrentPage(1);

    try {
      const today = dayjs().format('YYYYMMDD');
      console.log(`[排雷] 开始对 ${currentStocks.length} 只股票排雷...`);

      const result = await RiskFilterStocksFromTushare(today, currentStocks, {
        min_circ_mv: 30,
        max_circ_mv: 600,
        max_decline_from_high: 12,
      });
      if (!result.results || result.results.length === 0) {
        console.log('[排雷] 排雷结果为空');
        setRiskLoading(false);
        return;
      }

      const allData = result.results;
      setRiskData(allData);

      const batchSize = 3;
      const total = allData.length;
      for (let i = riskIndexRef.current; i < total; i += batchSize) {
        if (isRiskPausedRef.current) {
          riskIndexRef.current = i;
          break;
        }
        const end = Math.min(i + batchSize, total);
        setRiskDisplayCount(end);
        riskIndexRef.current = end;
        setRiskProgress(Math.round((end / total) * 100));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      if (!isRiskPausedRef.current) {
        riskIndexRef.current = 0;
        setRiskProgress(100);
        console.log(`[排雷] 完成，通过: ${allData.filter((d: any) => d.passed).length}/${allData.length}`);
      }
    } catch (e) {
      console.error('排雷过滤失败:', e);
    } finally {
      setRiskLoading(false);
    }
  }, [riskLoading, riskData.length, displayMode, leaderData, leaderDisplayCount, poolStocks]);

  // ========== 择时信号 ==========
  const handleCheckSignals = useCallback(async () => {
    if (signalLoading) {
      isSignalPausedRef.current = true;
      return;
    }
    // 获取当前已通过排雷的股票，或当前显示的股票
    const currentStocks = displayMode === 'risk'
      ? riskData.filter((d: any) => d.passed).map((d: any) => d.ts_code)
      : displayMode === 'leaders'
        ? leaderData.slice(0, leaderDisplayCount).map((d: any) => d.ts_code)
        : poolStocks.map((s) => {
            const code = s.secid.split('.').pop() || s.secid;
            return code.startsWith('6') ? `${code}.SH` : `${code}.SZ`;
          });

    if (currentStocks.length === 0) {
      console.log('[择时] 没有可检查的股票');
      return;
    }

    if (signalIndexRef.current === 0 || signalIndexRef.current >= signalData.length) {
      setSignalData([]);
      setSignalDisplayCount(0);
      signalIndexRef.current = 0;
    }

    isSignalPausedRef.current = false;
    setSignalLoading(true);
    setSignalProgress(0);
    setDisplayMode('signals');
    setCurrentPage(1);

    try {
      const today = dayjs().format('YYYYMMDD');
      console.log(`[择时] 开始对 ${currentStocks.length} 只股票检查信号...`);

      const result = await CheckBuySignalsFromTushare(today, currentStocks, {
        strategy: 'both',
        breakout_volume_ratio: 1.5,
      });
      if (!result.results || result.results.length === 0) {
        console.log('[择时] 信号检查结果为空');
        setSignalLoading(false);
        return;
      }

      const allData = result.results;
      setSignalData(allData);

      const batchSize = 3;
      const total = allData.length;
      for (let i = signalIndexRef.current; i < total; i += batchSize) {
        if (isSignalPausedRef.current) {
          signalIndexRef.current = i;
          break;
        }
        const end = Math.min(i + batchSize, total);
        setSignalDisplayCount(end);
        signalIndexRef.current = end;
        setSignalProgress(Math.round((end / total) * 100));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      if (!isSignalPausedRef.current) {
        signalIndexRef.current = 0;
        setSignalProgress(100);
        console.log(`[择时] 完成，有信号: ${allData.filter((d: any) => d.has_signal).length}/${allData.length}`);
      }
    } catch (e) {
      console.error('择时信号检查失败:', e);
    } finally {
      setSignalLoading(false);
    }
  }, [signalLoading, signalData.length, displayMode, riskData, leaderData, leaderDisplayCount, poolStocks]);

  // ========== 主力建仓过滤 ==========
  const handleMainInFilter = useCallback(async () => {
    if (mainInLoading) {
      isMainInPausedRef.current = true;
      return;
    }
    // 获取当前显示的股票列表
    const currentStocks = displayMode === 'signals'
      ? signalData.filter((d: any) => d.has_signal).map((d: any) => d.ts_code)
      : displayMode === 'risk'
        ? riskData.filter((d: any) => d.passed).map((d: any) => d.ts_code)
        : displayMode === 'leaders'
          ? leaderData.slice(0, leaderDisplayCount).map((d: any) => d.ts_code)
          : poolStocks.map((s) => {
              const code = s.secid.split('.').pop() || s.secid;
              return code.startsWith('6') ? `${code}.SH` : `${code}.SZ`;
            });

    if (currentStocks.length === 0) {
      console.log('[主力建仓] 没有可分析的股票');
      return;
    }

    if (mainInIndexRef.current === 0 || mainInIndexRef.current >= mainInData.length) {
      setMainInData([]);
      setMainInDisplayCount(0);
      mainInIndexRef.current = 0;
    }

    isMainInPausedRef.current = false;
    setMainInLoading(true);
    setMainInProgress(0);
    setDisplayMode('mainIn');
    setCurrentPage(1);

    try {
      const today = dayjs().format('YYYYMMDD');
      console.log(`[主力建仓] 开始分析 ${currentStocks.length} 只股票...`);

      const result = await MainInFilterStocksFromTushare(today, currentStocks);
      if (!result.results || result.results.length === 0) {
        console.log('[主力建仓] 分析结果为空');
        setMainInLoading(false);
        return;
      }

      const allData = result.results;
      setMainInData(allData);

      const batchSize = 3;
      const total = allData.length;
      for (let i = mainInIndexRef.current; i < total; i += batchSize) {
        if (isMainInPausedRef.current) {
          mainInIndexRef.current = i;
          break;
        }
        const end = Math.min(i + batchSize, total);
        setMainInDisplayCount(end);
        mainInIndexRef.current = end;
        setMainInProgress(Math.round((end / total) * 100));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      if (!isMainInPausedRef.current) {
        mainInIndexRef.current = 0;
        setMainInProgress(100);
        const buyCount = allData.filter((d: any) => d.buy_signal).length;
        console.log(`[主力建仓] 完成，有买入信号: ${buyCount}/${allData.length}`);
      }
    } catch (e) {
      console.error('主力建仓分析失败:', e);
    } finally {
      setMainInLoading(false);
    }
  }, [mainInLoading, mainInData.length, displayMode, signalData, riskData, leaderData, leaderDisplayCount, poolStocks]);

  // ========== 当前股票池（沿用选股漏斗：优先取上一步的有效结果） ==========
  // 短线评分与「训练周期评分预计算」共用，保证预计算覆盖的正是当前要评分的这批股票
  const collectCurrentItemsRaw = useCallback((options?: { ignoreReuse?: boolean }): ShortTermScoreItem[] => {
    const lookupName = (code: string) => stocks.find((s) => s.code === code)?.name || '';
    /**
     * 板块维度用的「所属板块」：优先用当前选中的板块
     *
     * 短线评分是对所选板块的成分股打分，板块K线必须取自所选板块（见 selectedBoardMeta）；
     * 多个板块同时选中时取该股票命中的第一个（按选择顺序），不在任何已选板块里时退回个股手动设置的板块，
     * 两者都没有才交给 resolveBoards 用东财所属板块兜底。
     */
    const lookupHybk = (code: string) => {
      const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`;
      const manual = stockConfigsMapping[secid]?.hybk || null;
      const boardSecids = stockBoardSecidsMap[code] || [];
      const hitSecid = selectedSecids.find((sid) => boardSecids.indexOf(sid) >= 0) || boardSecids[0] || '';
      const selected = hitSecid ? selectedBoardMeta[hitSecid] : null;
      return selected || manual;
    };
    if (displayMode === 'mainIn') {
      return mainInData.filter((d: any) => d.buy_signal).map((d: any) => {
        const code = d.ts_code.split('.')[0];
        return { code, name: d.name || lookupName(code), circMv: Number(d.circ_mv) || undefined, hybk: lookupHybk(code) };
      });
    }
    if (displayMode === 'signals') {
      return signalData.filter((d: any) => d.has_signal).map((d: any) => {
        const code = d.ts_code.split('.')[0];
        return { code, name: lookupName(code), hybk: lookupHybk(code) };
      });
    }
    if (displayMode === 'risk') {
      return riskData.filter((d: any) => d.passed).map((d: any) => {
        const code = d.ts_code.split('.')[0];
        return { code, name: lookupName(code), hybk: lookupHybk(code) };
      });
    }
    if (displayMode === 'leaders') {
      return leaderData.slice(0, leaderDisplayCount).map((d: any) => {
        const code = d.ts_code.split('.')[0];
        return { code, name: lookupName(code), hybk: lookupHybk(code) };
      });
    }
    if (
      !options?.ignoreReuse &&
      displayMode === 'shortScore' &&
      shortScoreCodesRef.current.length &&
      shortScorePoolRef.current === boardsKeyRef.current
    ) {
      // 评分结果展示中再次评分：沿用上一次的股票池（仅限同一组板块）。
      // （不这样做会退回「当前板块全部股票」，与「预计算训练评分」覆盖的股票池不一致，
      //   多出来的股票只能现算，表现为「预计算过了、再点短线评分仍然很慢」。）
      // 板块组合已经变化时必须放弃沿用：否则会把上一组板块的股票当成当前板块再评一遍。
      return shortScoreCodesRef.current.map((code) => {
        const s = stocks.find((x) => x.code === code) as any;
        return {
          code,
          name: s?.name || lookupName(code),
          circMv: s?.lt ? s.lt * 1e8 : undefined,
          hybk: lookupHybk(code),
        };
      });
    }
    return poolStocks.map((s) => ({
      code: s.code,
      name: s.name,
      circMv: (s as any).lt ? (s as any).lt * 1e8 : undefined,
      hybk: lookupHybk(s.code),
    }));
  }, [
    stocks,
    poolStocks,
    stockConfigsMapping,
    displayMode,
    mainInData,
    signalData,
    riskData,
    leaderData,
    leaderDisplayCount,
    stockBoardSecidsMap,
    selectedSecids,
    selectedBoardMeta,
  ]);

  /**
   * 评分池：在「当前股票池」基础上按「排除科创板+北交所」过滤
   * （短线评分与训练周期预计算都用它，保证预计算覆盖的正是要评分的这批股票）
   */
  const collectCurrentItems = useCallback((options?: { ignoreReuse?: boolean }): ShortTermScoreItem[] => {
    const list = collectCurrentItemsRaw(options);
    if (!excludeStarBse) {
      return list;
    }
    return list.filter((i) => !isStarOrBseCode(i.code));
  }, [collectCurrentItemsRaw, excludeStarBse]);

  /**
   * 等「已选板块」的股票列表全部加载完成
   *
   * 板块切换 / 增删板块后立刻点「短线评分 / 当日评分」时，部分板块的列表还在请求中，
   * 直接用它就会漏评或评出上一组板块的股票；这里等到全部就绪再开跑。
   * @returns 是否已就绪（超时返回 false，调用方提示用户稍后再试）
   */
  const waitBoardStocks = useCallback(async (timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    if (!boardsReady()) {
      console.log('[板块] 板块股票列表仍在加载，等就绪后再开始评分...');
    }
    while (!boardsReady() && Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return boardsReady();
  }, [boardsReady]);

  // ========== 短线评分 ==========
  const handleShortScore = useCallback(async () => {
    if (shortScoreLoading || scoreStartingRef.current) {
      isShortScorePausedRef.current = true;
      return;
    }
    if (!selectedSecidsRef.current.length) {
      message.warning('请先选择板块');
      return;
    }
    // 板块切换/增删后立刻点击：先等已选板块的股票列表到位，否则会漏评或评出上一组板块的股票
    scoreStartingRef.current = true;
    const boardReady = await waitBoardStocks();
    scoreStartingRef.current = false;
    if (!boardReady) {
      message.warning('板块的股票列表还在加载，请稍后再点评分');
      return;
    }
    // 评分池永远取「当前板块池」（忽略沿用）：板块成分股列表每 6 秒会随行情刷新，
    // 沿用上一轮快照会把新出现在列表里的股票永久排除在评分结果之外（列表里有、评分结果里没有）。
    const currentItems = collectCurrentItems({ ignoreReuse: true });

    // 暂停后恢复：继续处理剩余未评分项；全新开始：重置
    if (shortScoreRemainingRef.current.length === 0) {
      if (currentItems.length === 0) {
        console.log('[短线评分] 没有可评分的股票');
        if (displayModeRef.current === 'shortScore') {
          // 切板块后自动重算、而新板块没有可评分的股票：退回股票列表，别停在空的评分列表上
          setDisplayMode('stocks');
        }
        return;
      }
      setShortScoreData([]);
      setShortScoreProgress(0);
      setShortScoreBackfill(null);
      shortScoreTotalRef.current = currentItems.length;
      shortScoreRemainingRef.current = [...currentItems];
      shortScoreCodesRef.current = currentItems.map((i) => i.code);
      // 记录这一轮结果属于哪组板块：切换板块后（onRow / 收尾里的判断）直接丢弃这一轮结果
      shortScorePoolRef.current = boardsKeyRef.current;
      shortScoreSourceRef.current = 'score';
      // 历史列：先取近 N 个交易日（口径与评分基准日一致），已有序列稍后一并刷新
      setShortScoreSeries({});
      try {
        setShortScoreDays(await resolveRecentTradingDays(kLineApiSourceSetting, shortScoreHistoryDays));
      } catch {
        setShortScoreDays([]);
      }
    }

    isShortScorePausedRef.current = false;
    isShortScoreRunningRef.current = true;
    setShortScoreLoading(true);
    setDisplayMode('shortScore');
    setCurrentPage(1);

    try {
      const computed = await computeShortTermScoreRows(shortScoreRemainingRef.current, {
        source: kLineApiSourceSetting,
        concurrency: 3,
        shouldStop: () => isShortScorePausedRef.current,
        // 近 N 个交易日的历史列有缺口时顺带补算（列表缺哪天补哪天）
        backfillDays: shortScoreHistoryDays,
        onBackfill: ({ done: bdone, total: btotal }) => {
          if (shortScorePoolRef.current !== boardsKeyRef.current) {
            return;
          }
          setShortScoreBackfill({ done: bdone, total: btotal });
        },
        onRow: (row, item) => {
          // 从剩余队列中移除已完成的（支持暂停后恢复）
          const idx = shortScoreRemainingRef.current.findIndex((x) => x.code === item.code);
          if (idx >= 0) {
            shortScoreRemainingRef.current.splice(idx, 1);
          }
          if (shortScorePoolRef.current !== boardsKeyRef.current) {
            // 板块已切换：这一轮是上一组板块的结果，不再写入列表
            return;
          }
          setShortScoreData((prev) => [...prev, row]);
          setShortScoreProgress(Math.round(((shortScoreTotalRef.current - shortScoreRemainingRef.current.length) / shortScoreTotalRef.current) * 100));
        },
      });
      // 板块已切换时，历史列/序列属于上一组板块，不再回写
      const sameBoard = shortScorePoolRef.current === boardsKeyRef.current;
      // 历史列交易日：优先用评分流程内部（已按训练日收敛）的交易日，避免单独取数失败导致历史列消失
      if (sameBoard && computed.recentDays.length) {
        setShortScoreDays(computed.recentDays.slice(-shortScoreHistoryDays));
      }
      // 计算完成（或暂停）后刷新评分序列，用于渲染「近 N 日评分」历史列与过滤窗口。
      // 只取历史列/过滤窗口需要的交易日：整套训练窗口的序列（股票数 × 交易日数）可能有几十 MB，
      // 全量传回渲染进程会明显拖慢点击。
      try {
        if (sameBoard) {
          const historyDays = (computed.recentDays.length ? computed.recentDays : shortScoreDays).slice(
            -shortScoreHistoryDays
          );
          setShortScoreSeries(
            await loadScoreSeries(shortScoreCodesRef.current, kLineApiSourceSetting, { dates: historyDays })
          );
        }
      } catch {
        // 读取失败不影响本次展示
      }
      if (!isShortScorePausedRef.current) {
        setShortScoreProgress(100);
        console.log(`[短线评分] 完成，共 ${shortScoreTotalRef.current} 只`);
      }
    } catch (e) {
      console.error('短线评分失败:', e);
    } finally {
      setShortScoreLoading(false);
      isShortScoreRunningRef.current = false;
    }
  }, [shortScoreLoading, collectCurrentItems, kLineApiSourceSetting, shortScoreDays, shortScoreHistoryDays, waitBoardStocks]);

  // ========== 当日评分（只更新「只依赖K线」的 K线形态 + RSI） ==========
  // 盘中（或收盘后数据源还没生成当日日K）时，短线评分拿不到基准日的日K，当日列只显示 --。
  // 只针对「当前过滤结果的全部股票」（不分页；K线形态表头勾选过滤只影响显示，不计入这里的候选池）逐只取当日分时合成一根当日K线，
  // 算「K线形态 / 阴阳 / 是否放量」与「RSI」，不跑完整评分流程（不取指数分时 / 板块 / 资金 / 涨跌比）；
  // 当前交易日的评分列显示 -- 。是否交易日直接查交易日历；当日日K生成后再点一次即可用官方口径覆盖。
  // 注意：这里刻意不用 useCallback —— 它要引用声明在后面的 visibleShowList，
  // 普通函数在「调用时」才求值，因此不会踩到 TDZ。
  const handleTodayScore = async () => {
    if (todayScoreLoading || scoreStartingRef.current) {
      // 再次点击视为暂停：当前股票算完后停止（已算完的结果保留在列表里）
      isTodayScorePausedRef.current = true;
      return;
    }
    if (!selectedSecidsRef.current.length) {
      message.warning('请先选择板块');
      return;
    }
    // 板块切换/增删后立刻点击：先等已选板块的股票列表到位，否则会处理上一组板块的股票
    scoreStartingRef.current = true;
    const boardReady = await waitBoardStocks();
    scoreStartingRef.current = false;
    if (!boardReady) {
      message.warning('板块的股票列表还在加载，请稍后再试');
      return;
    }
    // 评分池永远取「整个板块池」（忽略沿用）：被展示类过滤（RSI评分过滤 / 短线评分过滤）裁剪过的池子
    // 一旦写进 shortScoreCodesRef，后续「短线评分」也会沿用被裁剪的池子，列表就永久缩窄、取消勾选也恢复不了。
    const baseItems = collectCurrentItems({ ignoreReuse: true });
    const currentItems = collectVisibleItems();
    if (currentItems.length === 0) {
      console.log('[当日评分] 当前列表没有可评分的股票');
      if (displayModeRef.current === 'shortScore') {
        // 切板块后自动重算、而新板块没有可评分的股票：退回股票列表
        setDisplayMode('stocks');
      }
      return;
    }
    console.log(`[当日评分] 处理当前过滤结果共 ${currentItems.length} 只（全部页）`);

    isTodayScorePausedRef.current = false;
    todayScoreRunningRef.current = true;
    todayScoreDoneRef.current = 0;
    setShortScoreProgress(0);
    setTodayScoreProgress(0);
    setShortScoreBackfill(null);
    setTodayScoreLoading(true);
    shortScoreTotalRef.current = currentItems.length;
    shortScoreRemainingRef.current = [];
    shortScoreCodesRef.current = baseItems.map((i) => i.code);
    // 记录这一轮结果属于哪组板块：切换板块后丢弃这一轮结果
    shortScorePoolRef.current = boardsKeyRef.current;
    shortScoreSourceRef.current = 'today';
    setShortScoreSeries({});
    setDisplayMode('shortScore');
    setCurrentPage(1);
    try {
      setShortScoreDays(await resolveRecentTradingDays(kLineApiSourceSetting, shortScoreHistoryDays));
    } catch {
      setShortScoreDays([]);
    }

    try {
      const computed = await computeTodayScoreRows(currentItems, {
        source: kLineApiSourceSetting,
        concurrency: 6,
        historyDays: shortScoreHistoryDays,
        shouldStop: () => isTodayScorePausedRef.current,
        onRow: (row) => {
          if (shortScorePoolRef.current !== boardsKeyRef.current) {
            // 板块已切换：这一轮是上一组板块的结果，不再写入列表
            return;
          }
          todayScoreDoneRef.current += 1;
          // 按股票「覆盖更新」而不是整体替换列表：只改本次处理到的股票，
          // 被展示类过滤挡住的股票保留原有行，取消勾选过滤后能立刻恢复完整列表。
          setShortScoreData((prev) => {
            const idx = prev.findIndex((r) => r.code === row.code);
            if (idx === -1) {
              return [...prev, row];
            }
            const next = prev.slice();
            next[idx] = row;
            return next;
          });
          setTodayScoreProgress(Math.round((todayScoreDoneRef.current / currentItems.length) * 100));
        },
      });
      // 板块已切换时，历史列/序列属于上一组板块，不再回写
      const sameBoard = shortScorePoolRef.current === boardsKeyRef.current;
      // 历史列交易日：用交易日历给出的最近交易日（含当日），保证当日列一定在
      if (sameBoard && computed.recentDays.length) {
        setShortScoreDays(computed.recentDays.slice(-shortScoreHistoryDays));
      }
      // 刷新历史列（读本地评分序列，不重新计算）；当日不出分，列内固定显示 --
      if (!sameBoard) {
        return;
      }
      try {
        const historyDays = (computed.recentDays.length ? computed.recentDays : shortScoreDays).slice(
          -shortScoreHistoryDays
        );
        const series = await loadScoreSeries(shortScoreCodesRef.current, kLineApiSourceSetting, { dates: historyDays });
        // 把「当前交易日」从展示序列里摘掉（库里可能还留着旧版本写入的当日分时评分），保证当日列显示 --
        const k = computed.scoreDayKey;
        if (k && k.length === 8) {
          const dashed = `${k.substring(0, 4)}-${k.substring(4, 6)}-${k.substring(6, 8)}`;
          Object.keys(series).forEach((c) => {
            const byDay = series[c];
            if (byDay) {
              delete byDay[k];
              delete byDay[dashed];
            }
          });
        }
        setShortScoreSeries(series);
      } catch {
        // 读取失败不影响本次展示
      }
      if (!isTodayScorePausedRef.current) {
        setTodayScoreProgress(100);
        console.log(
          `[当日评分] 完成，共 ${currentItems.length} 只（更新K线形态/RSI ${computed.filled} 只、未取到 ${computed.skipped} 只）`
        );
      }
    } catch (e) {
      console.error('当日评分失败:', e);
    } finally {
      setTodayScoreLoading(false);
      todayScoreRunningRef.current = false;
      todayScoreDoneRef.current = 0;
    }
  };
  // 每次渲染都更新：切板块自动重算时读它（函数内部用到 visibleShowList，必须取最新闭包）
  const handleTodayScoreRef = React.useRef<() => void>(() => {});
  handleTodayScoreRef.current = handleTodayScore;

  // ========== 训练周期评分预计算（仅训练模式） ==========
  // 把「当前股票池 × 整段训练窗口（trainStartDate ~ trainEndDate）」的短线评分一次性算完并落库，
  // 之后每推进一个训练日，执行短线评分都会直接命中数据库缓存，无需再等待取数计算。
  const handlePrecompute = useCallback(async () => {
    if (precomputing) {
      // 再次点击视为暂停：当前交易日算完后停止
      isPrecomputePausedRef.current = true;
      return;
    }
    if (!ontrain || (!trainDate && !trainEndDate)) {
      console.log('[预计算] 仅训练模式下可用');
      return;
    }
    // 板块切换后立刻点击：先等当前板块的股票列表到位，否则会预计算上一个板块的股票池
    if (!(await waitBoardStocks())) {
      message.warning('当前板块的股票列表还在加载，请稍后再试');
      return;
    }
    // 同「短线评分」：预计算也要覆盖当前完整板块池，不能沿用旧快照
    const items = collectCurrentItems({ ignoreReuse: true });
    if (!items.length) {
      console.log('[预计算] 没有可预计算的股票');
      return;
    }
    isPrecomputePausedRef.current = false;
    setPrecomputing(true);
    setPrecomputeDone(0);
    setPrecomputeTotal(0);
    setPrecomputeMsg('准备中...');
    try {
      const res = await precomputeShortTermScores({
        items,
        startDate: trainStartDate || '',
        // 整段训练窗口：只有推进到最后一天才会用到窗口末日，提前算好避免每天等待
        endDate: trainEndDate || trainDate,
        // 列表「近 N 日评分」历史列/过滤窗口按「基准日往前 N 个交易日」读取，
        // 训练日刚到窗口开头时会跨到 trainStartDate 之前 —— 一并覆盖，避免点「短线评分」时补算。
        historyDays: shortScoreHistoryDays,
        source: kLineApiSourceSetting,
        // 点击「预计算训练评分」= 忽略已有评分缓存、整段窗口重新计算（暂停后再次点击同样重头算）
        ignoreCache: true,
        shouldStop: () => isPrecomputePausedRef.current,
        onProgress: (done, total, message) => {
          setPrecomputeDone(done);
          setPrecomputeTotal(total);
          setPrecomputeMsg(message);
        },
      });
      // 写后校验：真正需要关注的是「写入失败」与「校验调用失败」；
      // 个别股票在某天没有数据（停牌 / 日K不足 / 上市前）会按 (交易日 × 股票) 记为缺口，
      // 点「短线评分」时只会补算这些缺口，不影响整体速度，因此不按「异常」提示。
      const warnParts: string[] = [];
      if (res.writeErrors) {
        warnParts.push(`${res.writeErrors} 批写入失败`);
      }
      if (res.verifyFailed) {
        warnParts.push('覆盖校验调用失败');
      }
      const gapInfo = res.verifyFailed
        ? '；未能校验覆盖情况'
        : res.missingRows
          ? `；覆盖校验：${res.missingRows} 个「交易日×股票」未覆盖（涉及 ${res.missingDays.length} 天，多为停牌/日K不足，点「短线评分」只会补算这些）`
          : '；覆盖校验：整段窗口已全部覆盖，点「短线评分」直接命中缓存';
      const topInfo = res.topGapDays.length
        ? `；缺口最多：${res.topGapDays.map(([d, n]) => `${d}(${n}只)`).join('、')}`
        : '';
      console.log(
        `[预计算] 窗口共 ${res.totalDates} 个交易日：新算 ${res.dates} 个、复用缓存 ${res.reused} 个，` +
          `写入 ${res.rows} 条评分（其中 ${res.notListed} 条尚未上市已跳过取数、${res.skipped} 条数据未就绪未写入）` +
          gapInfo +
          topInfo +
          (warnParts.length ? `；异常：${warnParts.join('，')}` : '')
      );
      setPrecomputeMsg(
        isPrecomputePausedRef.current
          ? `已暂停：新算 ${res.dates} 个交易日`
          : warnParts.length
            ? `完成但有异常：${warnParts.join('，')}`
            : res.missingRows
              ? `完成：新算 ${res.dates} 个交易日；${res.missingRows} 条未覆盖（停牌/数据不足，点评分只补算这些）`
              : `完成：新算 ${res.dates} 个交易日，复用 ${res.reused} 个，共 ${res.rows} 条评分`
      );
    } catch (e) {
      console.error('训练周期评分预计算失败:', e);
      setPrecomputeMsg('预计算失败');
    } finally {
      setPrecomputing(false);
    }
  }, [
    precomputing,
    ontrain,
    trainDate,
    trainStartDate,
    trainEndDate,
    kLineApiSourceSetting,
    shortScoreHistoryDays,
    collectCurrentItems,
    waitBoardStocks,
  ]);

  // 外部（板块列表 / 行业入口）指定了单个板块 → 同步为「单选」；多选由下拉框直接维护
  useEffect(() => {
    if (!secid) {
      return;
    }
    setSelectedSecids([secid]);
  }, [secid]);

  // 评分基准日随训练日/数据源变化：旧结果是上一交易日（或上一数据源）算的，直接展示会误导，需清空重算
  useEffect(() => {
    if (isShortScoreRunningRef.current || todayScoreRunningRef.current) {
      return;
    }
    setShortScoreData([]);
    setShortScoreProgress(0);
    setTodayScoreProgress(0);
    setShortScoreBackfill(null);
    shortScoreRemainingRef.current = [];
    setShortScoreSeries({});
    setShortScoreDays([]);
  }, [trainDate, kLineApiSourceSetting]);

  // 板块选择变化（含增删板块）：列表展示、评分结果与选股漏斗结果都属于上一组板块，必须整体重置。
  // （从「板块列表/行业」进入新板块时 displayMode 可能停在 shortScore，
  //   而 collectCurrentItems 在 shortScore 模式下会沿用上一次的股票池 —— 就会把上一组板块的股票再评一遍。）
  // 若变化前正在看评分结果列表，则在新板块组合的股票列表就绪后自动按新组合重算一次，列表跟着板块走。
  useEffect(() => {
    const targetKey = boardsKey;
    const targetSecids = selectedSecidsRef.current;
    /** 变化前正在展示评分结果时，记录该列表是「短线评分」还是「当日评分」算出来的 */
    const rescoreMode = displayModeRef.current === 'shortScore' ? shortScoreSourceRef.current : '';
    setCurrentPage(1);
    if (!rescoreMode) {
      // 不在评分列表里：退回股票列表
      setDisplayMode('stocks');
    }
    // 正在跑的那一轮先停掉（结果不再写入列表，由下面的清理清空）
    isShortScorePausedRef.current = true;
    isTodayScorePausedRef.current = true;
    isLeaderPausedRef.current = true;
    isRiskPausedRef.current = true;
    isSignalPausedRef.current = true;
    isMainInPausedRef.current = true;
    setShortScoreData([]);
    setShortScoreProgress(0);
    setTodayScoreProgress(0);
    setShortScoreBackfill(null);
    shortScoreRemainingRef.current = [];
    shortScoreCodesRef.current = [];
    shortScorePoolRef.current = '';
    setShortScoreSeries({});
    setShortScoreDays([]);
    // 其余漏斗步骤的结果同样属于上一组板块（否则续跑会接着旧板块的进度往下显示）
    setLeaderData([]);
    setLeaderDisplayCount(0);
    setLeaderProgress(0);
    leaderIndexRef.current = 0;
    setRiskData([]);
    setRiskDisplayCount(0);
    setRiskProgress(0);
    riskIndexRef.current = 0;
    setSignalData([]);
    setSignalDisplayCount(0);
    setSignalProgress(0);
    signalIndexRef.current = 0;
    setMainInData([]);
    setMainInDisplayCount(0);
    setMainInProgress(0);
    mainInIndexRef.current = 0;

    // 清理已移除板块的成分股缓存，重建合并列表，并拉取尚未缓存的板块
    Object.keys(boardStocksCacheRef.current).forEach((k) => {
      if (targetSecids.indexOf(k) === -1) {
        delete boardStocksCacheRef.current[k];
      }
    });
    rebuildStocksFromBoards();
    const missing = targetSecids.filter((s) => boardStocksCacheRef.current[s] === undefined);
    if (missing.length) {
      loadBoardsStocks(missing);
    }
    if (!targetKey) {
      // 未选板块：清空合并列表与所属板块映射，并退回股票列表
      setStocks([]);
      setStockBoardSecidsMap({});
      stocksBoardRef.current = '';
      setDisplayMode('stocks');
      return;
    }

    if (!rescoreMode) {
      return;
    }
    // 自动重算：等「上一轮收尾」+「新板块组合的股票列表就绪」后再触发一次
    // （评分函数内部还会再等一次板块就绪，这里主要是避免上一轮还没结束时被当成「暂停」而空跑）
    let canceled = false;
    const startedAt = Date.now();
    const trigger = () => {
      if (canceled || boardsKeyRef.current !== targetKey) {
        return;
      }
      const busy = isShortScoreRunningRef.current || todayScoreRunningRef.current || scoreStartingRef.current;
      if (busy || !boardsReady()) {
        if (Date.now() - startedAt < 15000) {
          setTimeout(trigger, 200);
        } else {
          // 等不到就退回股票列表，避免停在空的评分列表上
          setDisplayMode('stocks');
        }
        return;
      }
      console.log(`[短线评分] 板块变化 → 自动按新板块组合重算（${rescoreMode === 'today' ? '当日评分' : '短线评分'}）`);
      if (rescoreMode === 'today') {
        handleTodayScoreRef.current();
      } else {
        handleShortScoreRef.current();
      }
    };
    setTimeout(trigger, 0);
    return () => {
      canceled = true;
    };
    // 依赖只保留 boardsKey：其余为 ref / 稳定 useCallback，加入依赖会导致无关重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardsKey]);

  // 训练日切换（训练工具栏或列表里的「下一天」）→ 若正在展示「短线评分」结果列表，自动按新训练日重算。
  // 用 ref 持有最新的 handleShortScore，避免把它写进依赖导致「评分状态变化 → effect 重跑」的循环。
  const handleShortScoreRef = React.useRef<() => void>(() => {});
  useEffect(() => {
    handleShortScoreRef.current = handleShortScore;
  }, [handleShortScore]);
  const prevTrainDateRef = React.useRef(trainDate);
  useEffect(() => {
    const prev = prevTrainDateRef.current;
    prevTrainDateRef.current = trainDate;
    if (!ontrain || !trainDate || prev === trainDate) {
      return;
    }
    if (displayMode !== 'shortScore' || isShortScoreRunningRef.current) {
      return;
    }
    // 上面「清空旧结果」的 effect 已先执行，这里按新训练日重新计算
    handleShortScoreRef.current();
  }, [ontrain, trainDate, displayMode]);

  const updateFtypes = useCallback(
    (ts: any[]) => {
      setFtypes(ts);
      setCurrentPage(1);
      if (ts.length && poolStocks.length) {
        setFiltering(true);
        runFilterStocks(
          poolStocks.map((s) => s.secid),
          ts,
          fdays
        );
      }
    },
    [poolStocks, fdays, runFilterStocks]
  );
  const filterStocks = React.useMemo(
    () => (ftypes.length ? poolStocks.filter((s) => filterSecids.indexOf(s.secid) != -1) : poolStocks),
    [ftypes, poolStocks, filterSecids]
  );

  // 格式化资金流向金额（元 -> 亿/万）
  /** 判断 secid 是否为申万二级行业代码 */
  const isSWIndustryCode = useCallback((s: string) => {
    const code = s.split('.').pop() || s;
    return code.startsWith('801') && code.length === 6;
  }, []);

  const formatMoneyFlow = (val: number) => {
    const v = Number(val) || 0;
    if (Math.abs(v) >= 1e8) {
      return (v / 1e8).toFixed(2) + '亿';
    }
    if (Math.abs(v) >= 1e4) {
      return (v / 1e4).toFixed(2) + '万';
    }
    return v.toFixed(0);
  };

  const sortItems = useCallback((items: Stock.DetailItem[], key: string, t: number) => {
    if (t == 0) {
      return items;
    }
    const arr = [...items];
    arr.sort((a, b) => {
      const left = Number((a as any)[key]) || 0;
      const right = Number((b as any)[key]) || 0;
      if (left === right) return 0;
      if (t == 1) {
        return left > right ? 1 : -1;
      } else {
        return left < right ? 1 : -1;
      }
    });
    return arr;
  }, []);

  const updateSortType = useCallback((key: string) => {
    setSortTypes((prev) => {
      const currentType = prev[key] || 0;
      // K线形态列：常用顺序是「阳线在前、形态优先级高的在前」，所以第一次点击直接给降序（2），
      // 再点一次给升序（1），第三次取消；其余列沿用「升序 → 降序 → 取消」
      const nextType =
        key === KLINE_SHAPE_SORT_KEY
          ? currentType === 0
            ? 2
            : currentType === 2
            ? 1
            : 0
          : currentType === 0
          ? 1
          : currentType === 1
          ? 2
          : 0;
      // 只保留当前点击列的排序状态，其他列重置
      if (nextType === 0) {
        return {};
      }
      return { [key]: nextType };
    });
  }, []);

  // 评分序列里可用的交易日（升序）：
  // 优先用评分流程返回的交易日（已按训练日收敛）；若为空则退回评分序列里已存在的交易日
  // （训练模式下以训练日为上限，避免读到预计算写入的未来交易日），保证有数据时历史列不消失。
  // 这些天既用于渲染历史列，也用于计算「N 天前的近 M 日」过滤窗口。
  const shortScoreFilterDays = React.useMemo(() => {
    if (shortScoreDays.length) {
      return shortScoreDays;
    }
    const cap = ontrain && trainDate ? String(trainDate).replace(/-/g, '') : '';
    const set = new Set<string>();
    Object.values(shortScoreSeries || {}).forEach((m) => {
      Object.keys(m || {}).forEach((k) => {
        const d = String(k).replace(/-/g, '');
        if (d && (!cap || d <= cap)) {
          set.add(d);
        }
      });
    });
    return [...set].sort().slice(-shortScoreHistoryDays);
  }, [shortScoreDays, shortScoreSeries, ontrain, trainDate, shortScoreHistoryDays]);

  // 「近 N 日评分」列实际展示的交易日：固定取最近的 SHORT_SCORE_HISTORY_DAYS 个交易日
  const shortScoreDisplayDays = React.useMemo(
    () => shortScoreFilterDays.slice(-SHORT_SCORE_HISTORY_DAYS),
    [shortScoreFilterDays]
  );

  /**
   * 「N 天前的近 M 日」过滤窗口内的交易日
   *
   * 语义：从「N 天前」这个交易日开始往前数 M 个交易日（即窗口不含最近 N 个交易日）。
   * 交易日列表按升序排列，所以先切掉末尾的 N 天，再取剩余的末尾 M 天。
   */
  const shortScoreFilterWindowDayList = React.useMemo(() => {
    const beforeDays = Math.max(0, Math.floor(Number(shortScoreFilterBeforeDays) || 0));
    const windowDays = Math.max(1, Math.floor(Number(shortScoreFilterWindowDays) || 0));
    return shortScoreFilterDays.slice(0, Math.max(0, shortScoreFilterDays.length - beforeDays)).slice(-windowDays);
  }, [shortScoreFilterDays, shortScoreFilterBeforeDays, shortScoreFilterWindowDays]);

  /** 「新出现」标记的达标分：复用「N 天前的近 M 日出现过≥X 分」里的阈值分（默认 60） */
  const newEntryScore = Math.max(0, Number(shortScoreFilterScore) || 0);

  /**
   * 「新出现」的股票代码集合（相对上一交易日）
   *
   * 口径：基准日综合分 ≥ 达标分（newEntryScore），而上一交易日（shortScoreFilterDays 里基准日的前一个交易日）
   * 没有评分行、或综合分不足达标分 —— 即今天新达标 / 新进榜。
   * 上一交易日取不到（数据未加载、已是窗口第一天）时一律不标记，避免整表都标成「新」。
   * 当日评分后基准日综合分为空（不计算综合分），此时也不会误标。
   */
  const newEntryCodes = React.useMemo(() => {
    const codes = new Set<string>();
    if (displayMode !== 'shortScore' || !shortScoreData.length) {
      return codes;
    }
    const baseDay = shortScoreFilterDays.length ? shortScoreFilterDays[shortScoreFilterDays.length - 1] : '';
    const baseIdx = baseDay ? shortScoreFilterDays.indexOf(baseDay) : -1;
    const prevDay = baseIdx > 0 ? shortScoreFilterDays[baseIdx - 1] : '';
    if (!prevDay) {
      return codes;
    }
    // 安全阀：上一交易日一条评分行都读不到（序列未加载 / 行结构版本升级后旧数据被过滤）时不做判断，
    // 否则会把整表都标成「新」。
    const prevDayHasData = Object.keys(shortScoreSeries || {}).some((code) => !!shortScoreSeries[code]?.[prevDay]);
    if (!prevDayHasData) {
      return codes;
    }
    (shortScoreData as any[]).forEach((row: any) => {
      const cur = row.total;
      if (row.notListed || cur == null || cur < newEntryScore) {
        return;
      }
      const prevTotal = shortScoreSeries?.[row.code]?.[prevDay]?.total;
      if (prevTotal == null || prevTotal < newEntryScore) {
        codes.add(row.code);
      }
    });
    return codes;
  }, [displayMode, shortScoreData, shortScoreFilterDays, shortScoreSeries, newEntryScore]);

  // 使用 useMemo 在 render 阶段计算 showList，避免 useLayoutEffect 中 setState 导致的无限循环
  const showList = React.useMemo(() => {
    if (displayMode === 'leaders') {
      let list = [...leaderData.slice(0, leaderDisplayCount)];
      const keys = Object.keys(sortTypes);
      if (keys.length === 1) {
        list.sort((a: any, b: any) => {
          const left = Number(a[keys[0]]) || 0;
          const right = Number(b[keys[0]]) || 0;
          const t = sortTypes[keys[0]];
          if (left === right) return 0;
          return t === 1 ? (left > right ? 1 : -1) : (left < right ? 1 : -1);
        });
      }
      return list as any;
    }

    if (displayMode === 'risk') {
      let list = [...riskData.slice(0, riskDisplayCount)];
      const keys = Object.keys(sortTypes);
      if (keys.length === 1) {
        list.sort((a: any, b: any) => {
          const left = Number(a[keys[0]]) || 0;
          const right = Number(b[keys[0]]) || 0;
          const t = sortTypes[keys[0]];
          if (left === right) return 0;
          return t === 1 ? (left > right ? 1 : -1) : (left < right ? 1 : -1);
        });
      }
      return list as any;
    }

    if (displayMode === 'signals') {
      let list = [...signalData.slice(0, signalDisplayCount)];
      const keys = Object.keys(sortTypes);
      if (keys.length === 1) {
        list.sort((a: any, b: any) => {
          const left = Number(a[keys[0]]) || 0;
          const right = Number(b[keys[0]]) || 0;
          const t = sortTypes[keys[0]];
          if (left === right) return 0;
          return t === 1 ? (left > right ? 1 : -1) : (left < right ? 1 : -1);
        });
      }
      return list as any;
    }

    if (displayMode === 'mainIn') {
      let list = [...mainInData.slice(0, mainInDisplayCount)];
      const keys = Object.keys(sortTypes);
      if (keys.length === 1) {
        list.sort((a: any, b: any) => {
          const left = Number(a[keys[0]]) || 0;
          const right = Number(b[keys[0]]) || 0;
          const t = sortTypes[keys[0]];
          if (left === right) return 0;
          return t === 1 ? (left > right ? 1 : -1) : (left < right ? 1 : -1);
        });
      }
      return list as any;
    }

    if (displayMode === 'shortScore') {
      let list = [...shortScoreData];
      // 默认隐藏「评分基准日尚未上市」的股票（可用「显示未上市」开关恢复）
      if (!shortScoreShowNotListed) {
        list = list.filter((s: any) => !s.notListed);
      }
      // 过滤：N 天前的近 M 个交易日出现过 ≥ 阈值分
      // 窗口只落在「N 天前」及其之前（不含最近 N 个交易日）；窗口内无可用交易日时不过滤，避免误清空列表
      if (shortScoreFilterEnabled && shortScoreFilterWindowDayList.length) {
        const threshold = Number(shortScoreFilterScore);
        // 回溯 0 天时窗口含基准日当天，额外认「当日综合分」，避免序列里缺当日行时漏掉
        const includeTodayScore = Math.max(0, Math.floor(Number(shortScoreFilterBeforeDays) || 0)) === 0;
        list = list.filter((s: any) => {
          if (includeTodayScore && s.total != null && s.total >= threshold) {
            return true;
          }
          const series = shortScoreSeries?.[s.code];
          if (!series) {
            return false;
          }
          return shortScoreFilterWindowDayList.some((d) => {
            const v = series[d]?.total;
            return v != null && v >= threshold;
          });
        });
      }
      // RSI 评分阈值过滤：仅保留 RSI 评分「大于」阈值的股票
      if (shortScoreRsiFilterEnabled) {
        const rsiThreshold = Number(shortScoreRsiFilterScore);
        list = list.filter((s: any) => s.rsiScore != null && s.rsiScore > rsiThreshold);
      }
      // 注意：K线形态筛选不在这里做（它是纯展示层过滤，见 displayList），
      // 否则会连带缩小「当日评分」的候选股票池。
      const keys = Object.keys(sortTypes);
      if (keys.length === 1) {
        if (keys[0] === KLINE_SHAPE_SORT_KEY) {
          // K线形态排序：先阳线后阴线、同阴阳内按形态优先级、再按（下影-上影）、实体大小兜底，
          // 与板块评分列表共用同一套比较逻辑（helpers/klineShape）。降序=阳线在前、形态优先级高的在前。
          const t = sortTypes[KLINE_SHAPE_SORT_KEY];
          list.sort((a: any, b: any) => compareKlineShape(a, b, t));
        } else {
          list.sort((a: any, b: any) => {
            const left = Number(a[keys[0]]) || 0;
            const right = Number(b[keys[0]]) || 0;
            if (left === right) return 0;
            const t = sortTypes[keys[0]];
            return t === 1 ? (left > right ? 1 : -1) : (left < right ? 1 : -1);
          });
        }
      }
      return list as any;
    }

    // 名字过滤统一在 visibleShowList 里做（对所有展示模式生效）
    let list = [...filterStocks];
    const keys = Object.keys(sortTypes);
    if (keys.length === 1) {
      list = sortItems(list, keys[0], sortTypes[keys[0]]);
    }
    return list;
  }, [filterStocks, sortTypes, nameFilter, sortItems, displayMode, leaderData, leaderDisplayCount, riskData, riskDisplayCount, signalData, signalDisplayCount, mainInData, mainInDisplayCount, shortScoreData, shortScoreFilterEnabled, shortScoreFilterScore, shortScoreFilterBeforeDays, shortScoreFilterWindowDayList, shortScoreRsiFilterEnabled, shortScoreRsiFilterScore, shortScoreShowNotListed, shortScoreSeries, shortScoreDisplayDays]);

  /**
   * 实际渲染的列表：按「排除科创板+北交所」和「名字过滤」过滤（对所有展示模式生效）
   * 分页 total 同样用它，保证页码与可见行数一致。
   */
  const visibleShowList = React.useMemo(() => {
    let list = showList as any[];
    if (excludeStarBse) {
      list = list.filter((item: any) => !isStarOrBseCode(codeOfListItem(item)));
    }
    // 名字过滤：对所有展示模式（含短线评分结果列表）统一生效
    const kw = nameFilter.trim();
    if (kw) {
      list = list.filter((item: any) => nameOfListItem(item).includes(kw));
    }
    return list;
  }, [showList, excludeStarBse, nameFilter]);

  /**
   * 「K线形态 / RSI形态」表头勾选过滤（仅短线评分列表）
   *
   * 这是纯展示层过滤：只决定列表显示哪些行，**不参与** visibleShowList，
   * 因此不会影响「当日评分」的候选股票（见下方 collectVisibleItems / todayScoreCount）。
   * 两列同时勾选时按「与」关系叠加（与 Excel 多列筛选一致）。
   * 分页 total 也用它，保证页码与可见行数一致。
   */
  const displayList = React.useMemo(() => {
    if (displayMode !== 'shortScore') {
      return visibleShowList as any[];
    }
    let list = visibleShowList as any[];
    if (shortScoreKlineShapes.length) {
      const shapeSet = new Set(shortScoreKlineShapes);
      list = list.filter((row: any) => shapeSet.has(normalizeKlineShape(row.klineShape)));
    }
    if (shortScoreRsiShapes.length) {
      const rsiSet = new Set(shortScoreRsiShapes);
      list = list.filter((row: any) => rsiSet.has(normalizeRsiShape(row.rsiPattern)));
    }
    return list;
  }, [visibleShowList, displayMode, shortScoreKlineShapes, shortScoreRsiShapes]);

  /**
   * 表头 K线形态筛选项（带当前列表的股票数）：统计基于 visibleShowList，
   * 因此勾选后各项数量不会互相影响（保持 Excel 式筛选的稳定计数）。
   */
  const klineShapeFilterItems = React.useMemo(() => {
    const counts: Record<string, number> = {};
    (visibleShowList as any[]).forEach((row: any) => {
      const key = normalizeKlineShape(row.klineShape);
      counts[key] = (counts[key] || 0) + 1;
    });
    return KLINE_SHAPE_FILTER_OPTIONS.map((o) => ({ ...o, count: counts[o.value] || 0 }));
  }, [visibleShowList]);

  /**
   * 表头 RSI形态筛选项（带当前列表的股票数）：统计口径与 K线形态一致，
   * 基于 visibleShowList（不含其它列的表头勾选），勾选后各项数量保持稳定。
   */
  const rsiShapeFilterItems = React.useMemo(() => {
    const counts: Record<string, number> = {};
    (visibleShowList as any[]).forEach((row: any) => {
      const key = normalizeRsiShape(row.rsiPattern);
      counts[key] = (counts[key] || 0) + 1;
    });
    return RSI_SHAPE_FILTER_OPTIONS.map((o) => ({ ...o, count: counts[o.value] || 0 }));
  }, [visibleShowList]);

  /** 表头勾选后统一回到第 1 页 */
  const handleKlineShapeFilterChange = useCallback((next: string[]) => {
    setShortScoreKlineShapes(next);
    setCurrentPage(1);
  }, []);

  /** RSI形态勾选后统一回到第 1 页 */
  const handleRsiShapeFilterChange = useCallback((next: string[]) => {
    setShortScoreRsiShapes(next);
    setCurrentPage(1);
  }, []);

  /** 行标记变更（空值 = 取消标记）：只改内存，持久化由下面的 effect 统一处理 */
  const handleRowMarkChange = useCallback((code: string, mark?: string) => {
    if (!code) {
      return;
    }
    setShortScoreRowMarks((prev) => {
      const next = { ...prev };
      if (mark) {
        next[code] = mark;
      } else {
        delete next[code];
      }
      return next;
    });
  }, []);

  // 行标记持久化：切换板块 / 重新评分 / 重启应用后仍然保留
  useEffect(() => {
    Utils.SetStorage(CONST.STORAGE.SHORT_TERM_SCORE_ROW_MARKS, shortScoreRowMarks);
  }, [shortScoreRowMarks]);

  /**
   * 列表诊断日志：点「短线评分」后仍找不到某只股票时，用它定位是哪一层把行过滤掉的
   * （评分池完整、结果行都在，但展示层又少了一半时，看这行日志即可）
   */
  useEffect(() => {
    if (displayMode !== 'shortScore' || shortScoreLoading || todayScoreLoading) {
      return;
    }
    const rows = shortScoreData as any[];
    const notListedRows = rows.filter((r) => r.notListed).length;
    const starBseRows = rows.filter((r) => isStarOrBseCode(codeOfListItem(r))).length;
    console.log(
      `[短线评分] 列表诊断：评分行 ${rows.length} 行（未上市 ${notListedRows}、科创/北交 ${starBseRows}），` +
        `当前展示 ${displayList.length} 行（形态过滤前 ${visibleShowList.length} 行）；排除科创北交=${excludeStarBse} 显示未上市=${shortScoreShowNotListed}` +
        ` 评分过滤=${shortScoreFilterEnabled} RSI过滤=${shortScoreRsiFilterEnabled}` +
        ` K线形态过滤=${shortScoreKlineShapes.length ? shortScoreKlineShapes.join('/') : '无'}` +
        ` RSI形态过滤=${shortScoreRsiShapes.length ? shortScoreRsiShapes.join('/') : '无'} 名字过滤="${nameFilter}"`
    );
  }, [
    displayMode,
    shortScoreData,
    displayList,
    visibleShowList,
    shortScoreKlineShapes,
    shortScoreRsiShapes,
    shortScoreLoading,
    todayScoreLoading,
    excludeStarBse,
    shortScoreShowNotListed,
    shortScoreFilterEnabled,
    shortScoreRsiFilterEnabled,
    nameFilter,
  ]);

  /**
   * 「当日评分」的股票池：当前列表的「过滤结果」全部股票（**不分页**）
   *
   * 即用户在列表上筛出来的那批：排除科创板/北交所、名字过滤、K线过滤（ftypes）、
   * 各选股模式（龙头 / 排雷 / 择时 / 主力建仓）的结果集，以及「N 天前的近 M 日出现过 ≥ 阈值分」这类评分侧过滤，
   * 全部计入；只是不再无条件把整个板块跑一遍。
   * **K线形态表头勾选过滤除外**：它只是展示层过滤（displayList），不缩小这里的候选池，
   * 所以用 visibleShowList 而不是 displayList。
   * 列表行可能是 code / ts_code / secid 三种形态，统一用 codeOfListItem 取回 6 位代码再与池子取交集。
   */
  const collectVisibleItems = useCallback((): ShortTermScoreItem[] => {
    const base = collectCurrentItems();
    const codes = new Set(
      (visibleShowList as any[]).map((row) => codeOfListItem(row)).filter(Boolean)
    );
    return base.filter((i) => codes.has(i.code));
  }, [collectCurrentItems, visibleShowList]);

  /** 当前过滤结果的股票数：即「当日评分」实际会处理的数量（全部页，不含K线形态表头勾选过滤），直接标在按钮上 */
  const todayScoreCount = visibleShowList.length;

  /** 板块 secid -> 名称（用于下拉展示与结果列表标记所属板块） */
  const boardNameMap = React.useMemo(() => {
    const m: Record<string, string> = {};
    [...industries, ...gainians].forEach((i) => {
      m[i.secid] = i.name;
    });
    return m;
  }, [industries, gainians]);
  const boardLabel = useCallback((s: string) => boardNameMap[s] || s, [boardNameMap]);

  return (
    <>
      <div className={classNames(styles.header, styles.actbar)}>
        <div>
          <Select
            value={bktype}
            onSelect={(v) => {
              if (v === bktype) {
                return;
              }
              // 切换板块类型：清空已选板块（行业与概念板块不通用）
              setSelectedSecids([]);
              onChangeBK(v, '');
            }}
            style={{ marginRight: 10 }}
          >
            <Select.Option value={BKType.Industry}>行业板块</Select.Option>
            <Select.Option value={BKType.Gainian}>概念板块</Select.Option>
          </Select>
          <Select
            className={styles.boardSelect}
            mode="multiple"
            value={selectedSecids}
            onChange={(v) => setSelectedSecids(v as string[])}
            style={{ minWidth: 220, maxWidth: 460 }}
            placeholder={bktype === BKType.Industry ? '选择行业板块（可多选）' : '选择概念板块（可多选）'}
            showSearch
            optionFilterProp="children"
            maxTagCount="responsive"
            allowClear
          >
            {(bktype === BKType.Industry ? industries : gainians).map((i) => (
              <Select.Option value={i.secid} key={i.code}>
                {i.name}
              </Select.Option>
            ))}
          </Select>
        </div>
        <div>
          <Input size="small" placeholder="名字过滤" value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} style={{ width: 100, marginRight: 8 }} />
          <InputNumber step={1} onChange={setFdays} min={1} defaultValue={8} style={{ width: 60 }} />
          <span>天</span>&nbsp;
          <Checkbox.Group
            options={kFilterOptions}
            value={ftypes}
            onChange={updateFtypes}
          />
          <Checkbox
            checked={excludeStarBse}
            onChange={(e) => {
              setExcludeStarBse(e.target.checked);
              setCurrentPage(1);
            }}
            style={{ marginLeft: 8 }}
          >
            排除科创板+北交所
          </Checkbox>
          &nbsp;
          {filtering && <span>筛选中...</span>}
          <Button
            size="small"
            onClick={handleFilterLeaders}
            loading={leaderLoading && leaderProgress === 0}
            style={{ marginLeft: 4 }}
          >
            龙头识别
          </Button>
          <Button
            size="small"
            onClick={handleRiskFilter}
            loading={riskLoading && riskProgress === 0}
            style={{ marginLeft: 4 }}
          >
            排雷
          </Button>
          <Button
            size="small"
            onClick={handleCheckSignals}
            loading={signalLoading && signalProgress === 0}
            style={{ marginLeft: 4 }}
          >
            择时
          </Button>
          <Button
            size="small"
            onClick={handleMainInFilter}
            loading={mainInLoading && mainInProgress === 0}
            style={{ marginLeft: 4 }}
          >
            主力建仓
          </Button>
          <Button
            size="small"
            onClick={handleShortScore}
            loading={shortScoreLoading}
            style={{ marginLeft: 4 }}
          >
            {shortScoreLoading
              ? shortScoreBackfill
                ? `补全历史 ${Math.round((shortScoreBackfill.done / Math.max(1, shortScoreBackfill.total)) * 100)}%`
                : `评分中 ${shortScoreProgress}%`
              : '短线评分'}
          </Button>
          <Button
            size="small"
            onClick={handleTodayScore}
            loading={todayScoreLoading}
            style={{ marginLeft: 4 }}
            title="处理当前过滤结果的全部股票（不分页）：更新只依赖K线的当日K线形态与 RSI（当日K线未生成时用分时补全）。K线形态表头勾选只影响显示，不影响这里的候选股票。当日不计算综合分，评分列显示 --"
          >
            {todayScoreLoading ? `当日评分中 ${todayScoreProgress}%` : `当日评分(${todayScoreCount})`}
          </Button>
          {displayMode === 'shortScore' && (
            <span style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Checkbox
                checked={shortScoreFilterEnabled}
                onChange={(e) => {
                  setShortScoreFilterEnabled(e.target.checked);
                  setCurrentPage(1);
                }}
              />
              <InputNumber
                size="small"
                min={0}
                max={250}
                value={shortScoreFilterBeforeDays}
                onChange={(v) => {
                  setShortScoreFilterBeforeDays(typeof v === 'number' ? v : 3);
                  setCurrentPage(1);
                }}
                style={{ width: 52 }}
                title="从多少个交易日前开始回溯（窗口不含最近这么多个交易日）"
              />
              <span>天前近</span>
              <InputNumber
                size="small"
                min={1}
                max={250}
                value={shortScoreFilterWindowDays}
                onChange={(v) => {
                  setShortScoreFilterWindowDays(typeof v === 'number' ? v : 15);
                  setCurrentPage(1);
                }}
                style={{ width: 52 }}
                title="过滤窗口长度（交易日数量）"
              />
              <span>日出现过≥</span>
              <InputNumber
                size="small"
                min={0}
                max={100}
                step={5}
                value={shortScoreFilterScore}
                onChange={(v) => {
                  setShortScoreFilterScore(typeof v === 'number' ? v : 60);
                  setCurrentPage(1);
                }}
                style={{ width: 56 }}
              />
              <span>分</span>
            </span>
          )}
          {displayMode === 'shortScore' && (
            <span style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Checkbox
                checked={shortScoreRsiFilterEnabled}
                onChange={(e) => {
                  setShortScoreRsiFilterEnabled(e.target.checked);
                  setCurrentPage(1);
                }}
              />
              <span>RSI评分&gt;</span>
              <InputNumber
                size="small"
                min={0}
                max={40}
                step={5}
                value={shortScoreRsiFilterScore}
                onChange={(v) => {
                  setShortScoreRsiFilterScore(typeof v === 'number' ? v : 30);
                  setCurrentPage(1);
                }}
                style={{ width: 56 }}
              />
              <span>分</span>
            </span>
          )}
          {displayMode === 'shortScore' && (
            <span style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Checkbox
                checked={shortScoreShowNotListed}
                onChange={(e) => {
                  setShortScoreShowNotListed(e.target.checked);
                  setCurrentPage(1);
                }}
                title="训练回看历史日时，当前成分股里包含当时还没上市的新股；默认隐藏它们，勾选后可查看"
              />
              <span>显示未上市</span>
            </span>
          )}
          {ontrain && (
            <span style={{ marginLeft: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--secondary-text-color)' }}>训练日</span>
              <span style={{ fontSize: 12, fontWeight: 'bold' }}>{trainDate || '--'}</span>
              <Button
                size="small"
                disabled={!prevTrainDay || shortScoreLoading || todayScoreLoading}
                onClick={handlePrevTrainDay}
                title="回退到上一个交易日，并把训练日与训练进度落盘；列表会按该日重新计算，便于核对历史数据"
              >
                上一天
              </Button>
              <Button
                size="small"
                disabled={!nextTrainDay || shortScoreLoading || todayScoreLoading}
                onClick={handleNextTrainDay}
                title="推进到下一个交易日，并把训练日与训练进度落盘（下次启动从此日继续）"
              >
                下一天
              </Button>
              {trainFinished && (
                <span style={{ fontSize: 12, color: 'var(--secondary-text-color)' }}>（已到窗口最后一天）</span>
              )}
            </span>
          )}
          {ontrain && (
            <Button
              size="small"
              onClick={() => setHoldingsOpen(true)}
              style={{ marginLeft: 4 }}
              title="查看当前训练持仓（共享账户，按训练日收盘价估值），点击股票名称可打开对应详情"
            >
              {`当前持仓(${holdingRows.length})`}
            </Button>
          )}
          {ontrain && (
            <Button
              size="small"
              onClick={handlePrecompute}
              loading={precomputing}
              style={{ marginLeft: 4 }}
            >
              {precomputing
                ? `预计算中 ${precomputeDone}/${precomputeTotal || '-'}`
                : '预计算训练评分'}
            </Button>
          )}
          {ontrain && precomputeMsg && (
            <span style={{ marginLeft: 6, fontSize: 12, color: 'var(--secondary-text-color)' }}>{precomputeMsg}</span>
          )}
          {displayMode !== 'stocks' && (
            <Button
              size="small"
              onClick={() => setDisplayMode('stocks')}
              style={{ marginLeft: 4 }}
            >
              返回股票
            </Button>
          )}
        </div>
      </div>
      {displayMode === 'stocks' ? (
        <Row className={styles.header}>
          <Col span={3}>名字</Col>
          <Col span={3}>最新价</Col>
          <Col span={3}>涨跌额</Col>
          <Col span={3}>
            涨跌幅
            <Button size="small" type="text" icon={sortTypes.zdf == 1 ? <CaretUpOutlined /> : sortTypes.zdf == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('zdf')} />
          </Col>
          <Col span={3}>
            流通市值
            <Button size="small" type="text" icon={sortTypes.lt == 1 ? <CaretUpOutlined /> : sortTypes.lt == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('lt')} />
          </Col>
          <Col span={3}>
            换手率
            <Button size="small" type="text" icon={sortTypes.hsl == 1 ? <CaretUpOutlined /> : sortTypes.hsl == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('hsl')} />
          </Col>
          <Col span={3}>
            当日主力净流入
            <Button size="small" type="text" icon={sortTypes.main_in == 1 ? <CaretUpOutlined /> : sortTypes.main_in == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('main_in')} />
          </Col>
          <Col span={3}>
            5日主力净流入
            <Button size="small" type="text" icon={sortTypes.main_in_5d == 1 ? <CaretUpOutlined /> : sortTypes.main_in_5d == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('main_in_5d')} />
          </Col>
        </Row>
      ) : displayMode === 'leaders' ? (
        <Row className={styles.header}>
          <Col span={4}>股票代码</Col>
          <Col span={3}>
            龙头得分
            <Button size="small" type="text" icon={sortTypes.leader_score == 1 ? <CaretUpOutlined /> : sortTypes.leader_score == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('leader_score')} />
          </Col>
          <Col span={3}>
            5日涨幅
            <Button size="small" type="text" icon={sortTypes.ret_5d == 1 ? <CaretUpOutlined /> : sortTypes.ret_5d == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('ret_5d')} />
          </Col>
          <Col span={3}>
            20日涨幅
            <Button size="small" type="text" icon={sortTypes.ret_20d == 1 ? <CaretUpOutlined /> : sortTypes.ret_20d == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('ret_20d')} />
          </Col>
          <Col span={3}>
            资金流入(百万)
            <Button size="small" type="text" icon={sortTypes.net_inflow == 1 ? <CaretUpOutlined /> : sortTypes.net_inflow == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('net_inflow')} />
          </Col>
          <Col span={2}>涨停次数</Col>
          <Col span={3}>
            换手率
            <Button size="small" type="text" icon={sortTypes.turnover == 1 ? <CaretUpOutlined /> : sortTypes.turnover == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('turnover')} />
          </Col>
          <Col span={3}>
            行业相关性
            <Button size="small" type="text" icon={sortTypes.industry_corr == 1 ? <CaretUpOutlined /> : sortTypes.industry_corr == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('industry_corr')} />
          </Col>
        </Row>
      ) : displayMode === 'risk' ? (
        <Row className={styles.header}>
          <Col span={5}>股票代码</Col>
          <Col span={3}>状态</Col>
          <Col span={4}>未通过原因</Col>
          <Col span={4}>
            流通市值
            <Button size="small" type="text" icon={sortTypes.circ_mv == 1 ? <CaretUpOutlined /> : sortTypes.circ_mv == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('circ_mv')} />
          </Col>
          <Col span={4}>
            日均成交额
            <Button size="small" type="text" icon={sortTypes.avg_amount == 1 ? <CaretUpOutlined /> : sortTypes.avg_amount == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('avg_amount')} />
          </Col>
          <Col span={4}>
            距高点回撤
            <Button size="small" type="text" icon={sortTypes.decline_from_high == 1 ? <CaretUpOutlined /> : sortTypes.decline_from_high == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('decline_from_high')} />
          </Col>
        </Row>
      ) : displayMode === 'signals' ? (
        <Row className={styles.header}>
          <Col span={5}>股票代码</Col>
          <Col span={3}>状态</Col>
          <Col span={4}>信号类型</Col>
          <Col span={4}>信号强度</Col>
          <Col span={4}>
            量比
            <Button size="small" type="text" icon={sortTypes.volume_ratio == 1 ? <CaretUpOutlined /> : sortTypes.volume_ratio == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('volume_ratio')} />
          </Col>
          <Col span={4}>
            回调深度
            <Button size="small" type="text" icon={sortTypes.callback_depth == 1 ? <CaretUpOutlined /> : sortTypes.callback_depth == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('callback_depth')} />
          </Col>
        </Row>
      ) : displayMode === 'shortScore' ? (
        <Row className={styles.header}>
          <Col span={2}>股票名称</Col>
          <Col span={1} title="RSI 仅计算与展示，不计入个股综合分（短线评分偏选股，不用于择时）">
            RSI
            <Button size="small" type="text" icon={sortTypes.rsiScore == 1 ? <CaretUpOutlined /> : sortTypes.rsiScore == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('rsiScore')} />
          </Col>
          <Col span={2} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span
              className={styles.klineShapeHeader}
              title="RSI 评分逻辑识别出的形态：金叉/死叉、超卖后金叉、超买后回踩、接近金叉、多头/空头排列等。点漏斗可勾选形态过滤（Excel 式，仅影响列表显示，不影响「当日评分」的候选股票）"
            >
              <span className={styles.klineShapeHeaderText}>RSI形态识别</span>
              <Dropdown
                trigger={['click']}
                placement="bottomLeft"
                overlayClassName={styles.shapeFilterOverlay}
                overlay={
                  <div className={styles.shapeFilterPanel} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.shapeFilterActions}>
                      <Checkbox
                        checked={
                          RSI_SHAPE_FILTER_OPTIONS.length > 0 &&
                          shortScoreRsiShapes.length === RSI_SHAPE_FILTER_OPTIONS.length
                        }
                        indeterminate={
                          shortScoreRsiShapes.length > 0 &&
                          shortScoreRsiShapes.length < RSI_SHAPE_FILTER_OPTIONS.length
                        }
                        onChange={(e) =>
                          handleRsiShapeFilterChange(
                            e.target.checked ? RSI_SHAPE_FILTER_OPTIONS.map((o) => o.value) : []
                          )
                        }
                      >
                        全选
                      </Checkbox>
                      <a onClick={() => handleRsiShapeFilterChange([])}>清空</a>
                    </div>
                    <Checkbox.Group
                      value={shortScoreRsiShapes}
                      onChange={(v) => handleRsiShapeFilterChange((v as string[]) || [])}
                      className={styles.shapeFilterList}
                    >
                      {rsiShapeFilterItems.map((o) => (
                        <Checkbox
                          key={o.value || '__unrecognized__'}
                          value={o.value}
                          disabled={!o.count && shortScoreRsiShapes.indexOf(o.value) < 0}
                        >
                          {o.label}
                          <span className={styles.shapeFilterCount}>({o.count})</span>
                        </Checkbox>
                      ))}
                    </Checkbox.Group>
                  </div>
                }
              >
                <Button
                  size="small"
                  type="text"
                  icon={<FilterOutlined />}
                  className={classNames(styles.filterbtn, { [styles.filterbtnActive]: shortScoreRsiShapes.length > 0 })}
                  title={
                    shortScoreRsiShapes.length
                      ? `已按 ${shortScoreRsiShapes.length} 种RSI形态过滤（点击修改）；不影响「当日评分」候选股票`
                      : '按RSI形态勾选过滤（Excel 式多选）；仅影响列表显示，不影响「当日评分」的候选股票'
                  }
                />
              </Dropdown>
            </span>
          </Col>
          <Col span={3} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span className={styles.klineShapeHeader} title="最新交易日的单根K线形态（复用技术形态识别：宝剑线/十字星/铁锤线/海绵宝宝…）。点漏斗可勾选形态过滤（Excel 式，仅影响列表显示，不影响「当日评分」的候选股票）。排序：先阳线后阴线；阳线按 铁锤线 > 倒宝剑线 > 十字星 > 螺旋桨 > 纺锤线 > 地线宝宝 > 中海绵宝宝 > 大海绵宝宝 > 天线宝宝 > 倒铁锤线 > 宝剑线，阴线按 倒宝剑线 > 十字星 > 铁锤线 > 螺旋桨 > 纺锤线 > 宝剑线 > 倒铁锤线 > 地线宝宝 > 天线宝宝 > 中海绵宝宝 > 大海绵宝宝；同一形态内再按（下影-上影）从小到大，仍相同按K线实体大小。行尾下拉可给该股票打标记：未定/趋势/横排/回调/反弹（未定=未标记，其余按股票代码保存，切板块/重新评分/重启后仍保留）">
              <span className={styles.klineShapeHeaderText}>K线形态</span>
              <Dropdown
                trigger={['click']}
                placement="bottomLeft"
                overlayClassName={styles.shapeFilterOverlay}
                overlay={
                  <div className={styles.shapeFilterPanel} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.shapeFilterActions}>
                      <Checkbox
                        checked={
                          KLINE_SHAPE_FILTER_OPTIONS.length > 0 &&
                          shortScoreKlineShapes.length === KLINE_SHAPE_FILTER_OPTIONS.length
                        }
                        indeterminate={
                          shortScoreKlineShapes.length > 0 &&
                          shortScoreKlineShapes.length < KLINE_SHAPE_FILTER_OPTIONS.length
                        }
                        onChange={(e) =>
                          handleKlineShapeFilterChange(
                            e.target.checked ? KLINE_SHAPE_FILTER_OPTIONS.map((o) => o.value) : []
                          )
                        }
                      >
                        全选
                      </Checkbox>
                      <a onClick={() => handleKlineShapeFilterChange([])}>清空</a>
                    </div>
                    <Checkbox.Group
                      value={shortScoreKlineShapes}
                      onChange={(v) => handleKlineShapeFilterChange((v as string[]) || [])}
                      className={styles.shapeFilterList}
                    >
                      {klineShapeFilterItems.map((o) => (
                        <Checkbox
                          key={o.value || '__unrecognized__'}
                          value={o.value}
                          disabled={!o.count && shortScoreKlineShapes.indexOf(o.value) < 0}
                        >
                          {o.label}
                          <span className={styles.shapeFilterCount}>({o.count})</span>
                        </Checkbox>
                      ))}
                    </Checkbox.Group>
                  </div>
                }
              >
                <Button
                  size="small"
                  type="text"
                  icon={<FilterOutlined />}
                  className={classNames(styles.filterbtn, { [styles.filterbtnActive]: shortScoreKlineShapes.length > 0 })}
                  title={
                    shortScoreKlineShapes.length
                      ? `已按 ${shortScoreKlineShapes.length} 种K线形态过滤（点击修改）；不影响「当日评分」候选股票`
                      : '按K线形态勾选过滤（Excel 式多选，不区分阳线/阴线）；仅影响列表显示，不影响「当日评分」的候选股票'
                  }
                />
              </Dropdown>
              <Button
                size="small"
                type="text"
                icon={
                  sortTypes[KLINE_SHAPE_SORT_KEY] == 1 ? (
                    <CaretUpOutlined />
                  ) : sortTypes[KLINE_SHAPE_SORT_KEY] == 2 ? (
                    <CaretDownOutlined />
                  ) : (
                    <CaretRightOutlined />
                  )
                }
                className={styles.sortbtn}
                onClick={() => updateSortType(KLINE_SHAPE_SORT_KEY)}
              />
            </span>
          </Col>
          <Col span={1} title="最新交易日是否放量">
            放量
            <Button size="small" type="text" icon={sortTypes.volumeExpanded == 1 ? <CaretUpOutlined /> : sortTypes.volumeExpanded == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('volumeExpanded')} />
          </Col>
          {shortScoreDisplayDays.map((d) => (
            <Col
              span={1}
              key={d}
              style={{ fontSize: 11, textAlign: 'center', padding: 0 }}
              title={`${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)} 短线评分`}
            >
              {d.substring(4, 6)}-{d.substring(6, 8)}
            </Col>
          ))}
        </Row>
      ) : (
        <Row className={styles.header}>
          <Col span={2}>股票名称</Col>
          <Col span={2}>
            评分
            <Button size="small" type="text" icon={sortTypes.score == 1 ? <CaretUpOutlined /> : sortTypes.score == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('score')} />
          </Col>
          <Col span={2}>评级</Col>
          <Col span={2}>基础过滤</Col>
          <Col span={2}>
            流通市值
            <Button size="small" type="text" icon={sortTypes.circ_mv == 1 ? <CaretUpOutlined /> : sortTypes.circ_mv == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('circ_mv')} />
          </Col>
          <Col span={2}>
            近10日涨幅
            <Button size="small" type="text" icon={sortTypes.chg_10d == 1 ? <CaretUpOutlined /> : sortTypes.chg_10d == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('chg_10d')} />
          </Col>
          <Col span={3}>
            主力10日
            <Button size="small" type="text" icon={sortTypes.main_10d == 1 ? <CaretUpOutlined /> : sortTypes.main_10d == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('main_10d')} />
          </Col>
          <Col span={2}>
            散户10日
            <Button size="small" type="text" icon={sortTypes.retail_10d == 1 ? <CaretUpOutlined /> : sortTypes.retail_10d == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('retail_10d')} />
          </Col>
          <Col span={2}>
            场景
            <Button size="small" type="text" icon={sortTypes.score == 1 ? <CaretUpOutlined /> : sortTypes.score == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('score')} />
          </Col>
          <Col span={2} title="20日主力/散户累计线金叉死叉：轴上=交叉点位于0轴上方（净流入区间），轴下=0轴下方（净流出区间）">
            20日变盘
            <Button size="small" type="text" icon={sortTypes.flow_cross_20d_days == 1 ? <CaretUpOutlined /> : sortTypes.flow_cross_20d_days == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('flow_cross_20d_days')} />
          </Col>
          <Col span={3}>操作建议</Col>
        </Row>
      )}
      <div className={classNames(styles.table, styles.moreheader)}>
        {displayMode === 'stocks' ? (
          displayList.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((s) => (
            <Row key={s.code} className={styles.row}>
              <Col span={3} style={{ cursor: 'pointer' }} onClick={() => onOpenStock(s.secid, s.name)}>
                {s.name}
              </Col>
              <Col span={3} className={Utils.GetValueColor(s.zdd).textClass}>
                {s.zx.toFixed(2)}
              </Col>
              <Col span={3} className={Utils.GetValueColor(s.zdd).textClass}>
                {(s.zdd).toFixed(2)}
              </Col>
              <Col span={3} className={Utils.GetValueColor(s.zdf).textClass}>
                {s.zdf.toFixed(2) + '%'}
              </Col>
              <Col span={3}>{(s.lt).toFixed(2) + '亿'}</Col>
              <Col span={3}>{(s.hsl).toFixed(2) + '%'}</Col>
              <Col span={3} className={Utils.GetValueColor((s as any).main_in).textClass}>
                {formatMoneyFlow((s as any).main_in)}
              </Col>
              <Col span={3} className={Utils.GetValueColor((s as any).main_in_5d).textClass}>
                {formatMoneyFlow((s as any).main_in_5d)}
              </Col>
            </Row>
          ))
        ) : displayMode === 'leaders' ? (
          displayList.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((s: any) => (
            <Row key={s.ts_code} className={styles.row}>
              <Col span={4}>
                <span>{s.ts_code}</span>
              </Col>
              <Col span={3} className={s.leader_score >= 70 ? 'text-up' : s.leader_score >= 50 ? '' : 'text-down'}>
                {s.leader_score?.toFixed?.(1) ?? s.leader_score}
              </Col>
              <Col span={3} className={Utils.GetValueColor(s.ret_5d).textClass}>
                {s.ret_5d?.toFixed?.(2) ?? s.ret_5d}%
              </Col>
              <Col span={3} className={Utils.GetValueColor(s.ret_20d).textClass}>
                {s.ret_20d?.toFixed?.(2) ?? s.ret_20d}%
              </Col>
              <Col span={3} className={Utils.GetValueColor(s.net_inflow).textClass}>
                {s.net_inflow?.toFixed?.(2) ?? s.net_inflow}M
              </Col>
              <Col span={2}>
                {s.limit_count}
              </Col>
              <Col span={3}>
                {s.turnover?.toFixed?.(2) ?? s.turnover}%
              </Col>
              <Col span={3}>
                {s.industry_corr?.toFixed?.(2) ?? s.industry_corr}
              </Col>
            </Row>
          ))
        ) : displayMode === 'risk' ? (
          displayList.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((s: any) => {
            const isPassed = s.passed === true;
            return (
              <Row
                key={s.ts_code}
                className={styles.row}
                style={{
                  backgroundColor: isPassed ? 'rgba(82, 196, 26, 0.08)' : 'rgba(255, 77, 79, 0.08)',
                }}
              >
                <Col span={5}>
                  <span>{s.ts_code}</span>
                </Col>
                <Col span={3}>
                  {isPassed ? (
                    <span className="text-up">✓ 通过</span>
                  ) : (
                    <span className="text-down">✗ 未通过</span>
                  )}
                </Col>
                <Col span={4} style={{ color: isPassed ? '#52c41a' : '#ff4d4f', fontSize: 12 }}>
                  {s.reason}
                </Col>
                <Col span={4}>
                  {s.circ_mv?.toFixed?.(2) ?? s.circ_mv}亿
                </Col>
                <Col span={4}>
                  {s.avg_amount?.toFixed?.(0) ?? s.avg_amount}万
                </Col>
                <Col span={4} className={Utils.GetValueColor(-(s.decline_from_high || 0)).textClass}>
                  {s.decline_from_high?.toFixed?.(2) ?? s.decline_from_high}%
                </Col>
              </Row>
            );
          })
        ) : displayMode === 'signals' ? (
          displayList.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((s: any) => {
            const hasSignal = s.has_signal === true;
            return (
              <Row
                key={s.ts_code}
                className={styles.row}
                style={{
                  backgroundColor: hasSignal ? 'rgba(82, 196, 26, 0.08)' : undefined,
                }}
              >
                <Col span={5}>
                  <span>{s.ts_code}</span>
                </Col>
                <Col span={3}>
                  {hasSignal ? (
                    <span className="text-up">✓ 有信号</span>
                  ) : (
                    <span>○ 无信号</span>
                  )}
                </Col>
                <Col span={4}>
                  {s.signal_type === 'breakout' ? (
                    <span className="text-up">突破</span>
                  ) : s.signal_type === 'callback' ? (
                    <span style={{ color: '#faad14' }}>回调</span>
                  ) : (
                    <span style={{ color: 'var(--reverse-text-color)' }}>--</span>
                  )}
                </Col>
                <Col span={4}>
                  {s.signal_detail?.strength || '--'}
                </Col>
                <Col span={4}>
                  {s.signal_detail?.volume_ratio?.toFixed?.(2) ?? s.signal_detail?.volume_ratio ?? '--'}
                </Col>
                <Col span={4}>
                  {s.signal_detail?.callback_depth?.toFixed?.(2) ?? s.signal_detail?.callback_depth ?? '--'}%
                </Col>
              </Row>
            );
          })
        ) : displayMode === 'shortScore' ? (
          displayList.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((s: any) => {
            // 不用红色表示低分：只保留 A/B 的淡色底，去掉 D（低分）的红色底
            const rowBg =
              s.grade === 'A' ? 'rgba(82, 196, 26, 0.08)'
                : s.grade === 'B' ? 'rgba(24, 144, 255, 0.06)'
                  : undefined;
            return (
              <Row
                key={s.code}
                className={styles.row}
                style={{ backgroundColor: rowBg }}
              >
                <Col span={2} style={{ cursor: 'pointer' }} onClick={() => {
                  const secid = s.code.startsWith('6') ? `1.${s.code}` : `0.${s.code}`;
                  onOpenStock(secid, s.name || s.code);
                }}>
                  <div
                    title={s.name || s.code}
                    style={{
                      color: '#1890ff',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name || s.code}</span>
                    {newEntryCodes.has(s.code) && (
                      <span
                        className={styles.newEntryTag}
                        title={`新出现：基准日综合分 ≥ ${newEntryScore} 分，上一交易日不足该分或没有评分（对比交易日 ${shortScoreFilterDays[
                          shortScoreFilterDays.length - 2
                        ] || '--'}）`}
                      >
                        新
                      </span>
                    )}
                  </div>
                  {(() => {
                    // 标记该股票所属的已选板块（可能同时属于多个）
                    const bs = (stockBoardSecidsMap[s.code] || []).map(boardLabel);
                    if (!bs.length) {
                      return null;
                    }
                    return (
                      <div
                        title={`所属板块：${bs.join('、')}`}
                        style={{
                          fontSize: 10,
                          lineHeight: 1.1,
                          color: 'var(--secondary-text-color)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {bs.join('、')}
                      </div>
                    );
                  })()}
                </Col>
                <Col
                  span={1}
                  title={s.error || undefined}
                  style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {/* RSI 列只展示 RSI 分值：数据未就绪的说明放到悬停提示，不再把「数据未覆盖到」占满 RSI 单元格 */}
                  <span style={{ fontSize: 12, color: s.pending ? '#faad14' : undefined }}>
                    {s.rsiScore == null ? '--' : `${s.rsiScore.toFixed(0)}/40`}
                  </span>
                </Col>
                <Col
                  span={2}
                  title={[s.rsiPattern, s.error].filter(Boolean).join('｜') || undefined}
                  style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {/* RSI 形态：来自 RSI 评分逻辑的形态识别结果（金叉/死叉/超卖后金叉/超买后回踩…），空值显示占位 */}
                  {s.rsiPattern ? (
                    s.rsiPattern
                  ) : s.notListed ? (
                    <span style={{ color: 'var(--reverse-text-color)' }}>未上市</span>
                  ) : (
                    <span style={{ color: 'var(--reverse-text-color)' }}>--</span>
                  )}
                </Col>
                <Col span={3} style={{ fontSize: 12 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span
                      style={{ flex: '1 1 auto', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      title={`最新交易日K线形态${s.klineShape ? `（${s.klineYin ? '阴线' : '阳线'}）` : ''}${
                        s.klineSize != null ? `｜实体 ${s.klineSize.toFixed(2)}倍平均` : ''
                      }${
                        s.klineUpperShadow != null && s.klineLowerShadow != null
                          ? `｜影线 上${s.klineUpperShadow.toFixed(2)}/下${s.klineLowerShadow.toFixed(2)}（差 ${(
                              s.klineLowerShadow - s.klineUpperShadow
                            ).toFixed(2)}）`
                          : ''
                      }${s.intraday ? '｜当日K线由分时补全' : ''}${s.error ? `｜${s.error}` : ''}`}
                    >
                      {s.klineShape ? (
                        <span className={Utils.GetValueColor(s.klineYin ? -1 : 1).textClass}>{s.klineShape}</span>
                      ) : s.notListed ? (
                        // 评分基准日尚未上市：不计分、不取数（悬停看上市日期）
                        <span style={{ color: 'var(--reverse-text-color)' }}>未上市</span>
                      ) : (
                        '--'
                      )}
                    </span>
                    {/* 行标记：默认「未定」（未标记），选中其它值后按股票代码持久化（切板块/重新评分/重启后仍保留） */}
                    <span
                      style={{ flex: '0 0 auto' }}
                      title="给该股票打标记（未定/趋势/横排/回调/反弹）；未定=未标记，其余按股票代码保存，切换板块、重新评分、重启应用后仍保留"
                    >
                      <Select
                        size="small"
                        value={shortScoreRowMarks[s.code] || ROW_MARK_DEFAULT}
                        style={{ width: 62 }}
                        dropdownMatchSelectWidth={false}
                        onChange={(v) =>
                          handleRowMarkChange(s.code, v === ROW_MARK_DEFAULT ? undefined : (v as string))
                        }
                        options={ROW_MARK_OPTIONS.map((m) => ({ label: m, value: m }))}
                      />
                    </span>
                  </span>
                </Col>
                <Col span={1} title={s.volumeExpanded == null ? '无数据' : s.volumeExpanded ? '最新交易日放量' : '最新交易日未放量'}>
                  {s.volumeExpanded == null ? (
                    <span style={{ color: 'var(--reverse-text-color)' }}>--</span>
                  ) : s.volumeExpanded ? (
                    <span className="text-up">是</span>
                  ) : (
                    <span style={{ color: 'var(--reverse-text-color)' }}>否</span>
                  )}
                </Col>
                {shortScoreDisplayDays.map((d) => {
                  const dayRow = shortScoreSeries?.[s.code]?.[d];
                  const v = dayRow ? dayRow.total : null;
                  const dayText = `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`;
                  // 不用红色表示低分：未开启阈值过滤时用默认色；开启后按阈值分 up/down 两色
                  const cellClass =
                    v == null || !shortScoreFilterEnabled
                      ? ''
                      : v >= Number(shortScoreFilterScore)
                        ? 'text-up'
                        : 'text-down';
                  return (
                    <Col
                      span={1}
                      key={d}
                      className={cellClass}
                      style={{ fontSize: 11, textAlign: 'center', padding: 0, color: v == null ? 'var(--reverse-text-color)' : undefined }}
                      title={dayRow ? `${dayText}：${v == null ? '--' : v.toFixed(1)}${dayRow.intraday ? '（当日K线由分时补全）' : ''}` : `${dayText}：无评分`}
                    >
                      {v == null ? '--' : v.toFixed(0)}
                    </Col>
                  );
                })}
              </Row>
            );
          })
        ) : (
          displayList.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((s: any) => {
            const sceneCode = s.advice_scene || '';
            const isActiveScene = /^A-/.test(sceneCode) || sceneCode === 'G-1';
            const isWatchScene = /^(B-|G-[23])/.test(sceneCode);
            const isWeakScene = /^(G-4|H-1)/.test(sceneCode);
            const isAvoidScene = /^(E|F|H-[23])/.test(sceneCode);
            const bgColor = isActiveScene
              ? 'rgba(82, 196, 26, 0.08)'
              : isWatchScene
                ? 'rgba(24, 144, 255, 0.06)'
                : isWeakScene
                  ? 'rgba(250, 173, 20, 0.06)'
                  : isAvoidScene
                    ? 'rgba(255, 77, 79, 0.06)'
                    : undefined;
            return (
              <Row
                key={s.ts_code}
                className={styles.row}
                style={{ backgroundColor: bgColor }}
              >
                <Col span={2} style={{ cursor: 'pointer' }} onClick={() => {
                  const code = s.ts_code.split('.').shift() || s.ts_code;
                  const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`;
                  onOpenStock(secid, s.name || s.ts_code);
                }}>
                  <span style={{ color: '#1890ff' }}>{s.name || s.ts_code}</span>
                </Col>
                <Col span={2} className={Utils.GetValueColor(s.score - 50).textClass}>
                  {s.score}
                </Col>
                <Col span={2}>
                  <span style={{
                    color: s.grade === 'A' ? '#52c41a' : s.grade === 'B' ? '#1890ff' : s.grade === 'C' ? '#faad14' : '#ff4d4f',
                    fontWeight: 'bold',
                  }}>
                    {s.grade}
                  </span>
                </Col>
                <Col span={2}>
                  {s.basic_passed ? (
                    <span className="text-up">✓</span>
                  ) : (
                    <span className="text-down" title={s.basic_reason}>✗</span>
                  )}
                </Col>
                <Col span={2}>
                  {(Number(s.circ_mv) / 1e8).toFixed(1)}亿
                </Col>
                <Col span={2} className={Utils.GetValueColor(s.chg_10d).textClass}>
                  {s.chg_10d?.toFixed?.(2) ?? s.chg_10d}%
                </Col>
                <Col span={3} className={Utils.GetValueColor(s.main_10d).textClass}>
                  {formatMoneyFlow(s.main_10d)}
                </Col>
                <Col span={2} className={Utils.GetValueColor(-s.retail_10d).textClass}>
                  {formatMoneyFlow(s.retail_10d)}
                </Col>
                <Col span={2} title={s.advice_meaning}>
                  <span style={{
                    color: isActiveScene ? '#52c41a' : isWatchScene ? '#1890ff' : isWeakScene ? '#faad14' : isAvoidScene ? '#ff4d4f' : 'var(--reverse-text-color)',
                    fontWeight: isActiveScene ? 'bold' : 'normal',
                  }}>
                    {sceneCode || '--'}
                  </span>
                </Col>
                <Col span={2} title={s.flow_cross_20d
                  ? `20日资金${s.flow_cross_20d}（交叉点位于0轴${s.flow_cross_20d_zone}，即${s.flow_cross_20d_zone === '之上' ? '净流入' : '净流出'}区间）：主力20日累计线${s.flow_cross_20d === '金叉' ? '上穿' : '下穿'}散户20日累计线${s.flow_cross_20d_days >= 0 ? `，距今${s.flow_cross_20d_days}个交易日` : ''}`
                  : '近20日主力/散户累计线无交叉'}>
                  {s.flow_cross_20d ? (
                    <span style={{ whiteSpace: 'nowrap' }}>
                      {s.flow_cross_20d_zone && (
                        <span style={{
                          color: s.flow_cross_20d_zone === '之上' ? '#fa8c16' : 'var(--reverse-text-color)',
                          fontSize: 11,
                          marginRight: 1,
                        }}>
                          {s.flow_cross_20d_zone === '之上' ? '轴上' : '轴下'}
                        </span>
                      )}
                      <span style={{ color: s.flow_cross_20d === '金叉' ? '#52c41a' : '#ff4d4f', fontWeight: 'bold' }}>
                        {s.flow_cross_20d}
                      </span>
                      {s.flow_cross_20d_days >= 0 && (
                        <span style={{ color: 'var(--reverse-text-color)', fontSize: 11, marginLeft: 2 }}>
                          {s.flow_cross_20d_days}日
                        </span>
                      )}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--reverse-text-color)' }}>--</span>
                  )}
                </Col>
                <Col span={3}>
                  {sceneCode ? (
                    <span title={`止损: ${s.stop_loss?.toFixed?.(2) ?? s.stop_loss ?? '--'} | 目标: ${s.target?.toFixed?.(2) ?? s.target ?? '--'} | ${s.hold_period || '--'}`}>
                      <span style={{ color: 'var(--main-text-color)' }}>{s.advice_action || '--'}</span>
                      {s.position_advice && <span style={{ color: 'var(--reverse-text-color)', marginLeft: 4, fontSize: 12 }}>({s.position_advice})</span>}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--reverse-text-color)' }}>--</span>
                  )}
                </Col>
              </Row>
            );
          })
        )}
        <Pagination
          current={currentPage}
          pageSize={pageSize}
          total={displayList.length}
          onChange={onPageChange}
          showSizeChanger={false}
          size="small"
          style={{ padding: '10px 0', textAlign: 'center' }}
        />
      </div>
      <Modal
        title={`当前持仓（训练日 ${trainDate || '--'}）`}
        visible={holdingsOpen}
        onCancel={() => setHoldingsOpen(false)}
        footer={null}
        width={880}
        destroyOnClose
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            fontSize: 12,
            padding: '2px 10px 10px',
            color: 'var(--hint-color)',
          }}
        >
          <span>
            可用资金：
            <span style={{ fontWeight: 'bold', color: 'var(--primary-text-color)' }}>{formatMoneyFlow(trainAccount.cash)}</span>
          </span>
          <span>
            持仓市值：
            <span style={{ fontWeight: 'bold', color: 'var(--primary-text-color)' }}>{formatMoneyFlow(holdingSummary.marketValue)}</span>
          </span>
          <span>
            总资产：
            <span style={{ fontWeight: 'bold', color: 'var(--primary-text-color)' }}>{formatMoneyFlow(holdingSummary.totalAssets)}</span>
          </span>
          <span>
            持仓盈亏：
            <span className={Utils.GetValueColor(holdingSummary.profit).textClass} style={{ fontWeight: 'bold' }}>
              {`${holdingSummary.profit >= 0 ? '+' : ''}${holdingSummary.profit.toFixed(2)}（${
                holdingSummary.profitRatio >= 0 ? '+' : ''
              }${holdingSummary.profitRatio.toFixed(2)}%）`}
            </span>
          </span>
          <span>
            已实现盈亏：
            <span className={Utils.GetValueColor(trainAccount.realized).textClass} style={{ fontWeight: 'bold' }}>
              {`${trainAccount.realized >= 0 ? '+' : ''}${trainAccount.realized.toFixed(2)}`}
            </span>
          </span>
          {holdingsLoading && <span>行情加载中...</span>}
        </div>
        <Row className={styles.rowheader}>
          <Col span={4}>股票名称</Col>
          <Col span={3}>持仓股数</Col>
          <Col span={3}>成本价</Col>
          <Col span={3}>现价</Col>
          <Col span={4}>浮动盈亏</Col>
          <Col span={3}>仓位占比</Col>
          <Col span={4}>最近买入</Col>
        </Row>
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {holdingRows.length === 0 && (
            <div className={styles.hint} style={{ padding: '20px', textAlign: 'center' }}>
              当前无持仓：在个股详情页用训练工具栏买入后，这里会显示持仓（训练账户为所有标的共享）
            </div>
          )}
          {holdingRows.map((r) => (
            <Row key={r.secid} className={styles.row}>
              <Col span={4} style={{ cursor: 'pointer' }} onClick={() => openHoldingStock(r.secid, r.name)}>
                <span style={{ color: '#1890ff' }}>{r.name || r.secid}</span>
              </Col>
              <Col span={3}>{r.shares}</Col>
              <Col span={3}>{r.costPrice.toFixed(2)}</Col>
              <Col span={3} title={r.closeDay && r.closeDay !== trainDate ? `按 ${r.closeDay} 收盘价估值（当日无行情）` : undefined}>
                {r.hasPrice ? r.close.toFixed(2) : '--'}
              </Col>
              <Col span={4} className={r.hasPrice ? Utils.GetValueColor(r.profit).textClass : undefined}>
                {r.hasPrice
                  ? `${r.profit >= 0 ? '+' : ''}${r.profit.toFixed(2)}（${r.profitRatio >= 0 ? '+' : ''}${r.profitRatio.toFixed(2)}%）`
                  : '--'}
              </Col>
              <Col span={3}>
                {holdingSummary.marketValue > 0
                  ? `${((r.marketValue / holdingSummary.marketValue) * 100).toFixed(2)}%`
                  : '--'}
              </Col>
              <Col span={4}>{r.lastBuyDate || '--'}</Col>
            </Row>
          ))}
          {holdingRows.length > 0 && (
            <Row className={styles.row} style={{ fontWeight: 'bold', borderTop: '1px solid var(--main-border-color)', marginTop: 10 }}>
              <Col span={4}>合计</Col>
              <Col span={3}>{holdingRows.reduce((s, r) => s + r.shares, 0)}</Col>
              <Col span={3}>--</Col>
              <Col span={3}>--</Col>
              <Col span={4} className={Utils.GetValueColor(holdingSummary.profit).textClass}>
                {`${holdingSummary.profit >= 0 ? '+' : ''}${holdingSummary.profit.toFixed(2)}（${
                  holdingSummary.profitRatio >= 0 ? '+' : ''
                }${holdingSummary.profitRatio.toFixed(2)}%）`}
              </Col>
              <Col span={3}>100.00%</Col>
              <Col span={4}>--</Col>
            </Row>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--hint-color)', padding: '8px 10px 0' }}>
          点击股票名称可打开对应详情；训练账户为所有标的共享（资金共用），持仓与个股详情页训练工具栏一致
        </div>
      </Modal>
    </>
  );
};

export default STList;