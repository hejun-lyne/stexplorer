import React, { useEffect } from 'react';
import { Button, List, Row, Col, Radio, Select, Checkbox, InputNumber, Input, Pagination } from 'antd';
import styles from '../index.scss';
import * as Services from '@/services';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
import * as Helpers from '@/helpers';
import { useState } from 'react';
import { Stock } from '@/types/stock';
import { useRequest, useThrottleFn } from 'ahooks';
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
import { CaretDownOutlined, CaretRightOutlined, CaretUpOutlined } from '@ant-design/icons';
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
import { setTrainCurrentDateAction, writeTrainProgressAction } from '@/actions/train';

/** 短线评分列表「近 N 日评分」历史列展示的交易日数量 */
const SHORT_SCORE_HISTORY_DAYS = 15;

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

export interface STListProps {
  industries: Stock.BanKuaiItem[];
  gainians: Stock.BanKuaiItem[];
  bktype: BKType;
  secid: string;
  onChangeBK: (t: BKType, s: string) => void;
  onOpenStock: (secid: string, name: string) => void;
  active: boolean;
}

const STList: React.FC<STListProps> = ({ industries, gainians, bktype, secid, onChangeBK, onOpenStock, active }) => {
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
  // 过滤：仅保留「近 N 个交易日出现过 ≥ 阈值分」的股票（阈值可填写，默认 60）
  const [shortScoreFilterEnabled, setShortScoreFilterEnabled] = useState(false);
  const [shortScoreFilterScore, setShortScoreFilterScore] = useState(60);
  // 当日评分（用当日分时补全当日K线后重新评分）
  const [todayScoreLoading, setTodayScoreLoading] = useState(false);
  const [todayScoreProgress, setTodayScoreProgress] = useState(0);
  const isTodayScorePausedRef = React.useRef(false);
  const todayScoreRunningRef = React.useRef(false);
  const todayScoreDoneRef = React.useRef(0);

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
  const trainFinished = trainCalendarDays.length > 0 && trainDayIdx >= trainCalendarDays.length - 1;

  const handleNextTrainDay = useCallback(() => {
    if (!nextTrainDay) {
      return;
    }
    dispatch(setTrainCurrentDateAction(nextTrainDay));
    // 与训练工具栏一致：每推进一个交易日落盘一次进度（刷新/重启后可继续）
    dispatch(
      writeTrainProgressAction({
        ...(trainProgress || ({} as Train.Progress)),
        secid: trainProgress?.secid || '',
        name: trainProgress?.name || '',
        startDate: trainStartDate || trainProgress?.startDate || '',
        endDate: trainEndDate || trainProgress?.endDate || '',
        currentDate: nextTrainDay,
        total: trainCalendarDays.length,
        days: trainCalendarDays,
        initialCapital: Number(initialCapital) || trainProgress?.initialCapital || 0,
        commissionRate: Number(commissionRate) || trainProgress?.commissionRate || 0,
        savedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      })
    );
  }, [
    nextTrainDay,
    dispatch,
    trainProgress,
    trainStartDate,
    trainEndDate,
    trainCalendarDays,
    initialCapital,
    commissionRate,
  ]);

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
    onSuccess: (data) => {
      setStocks(data.stocks as Stock.DetailItem[]);
      if (ftypes.length > 0) {
        setFiltering(true);
        const base = excludeStarBse
          ? (data.stocks as Stock.DetailItem[]).filter((s) => !isStarOrBseCode(s.code))
          : (data.stocks as Stock.DetailItem[]);
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
    onSuccess: (data) => {
      setStocks(data.stocks as Stock.DetailItem[]);
      if (ftypes.length > 0) {
        setFiltering(true);
        const base = excludeStarBse
          ? (data.stocks as any[]).filter((s: any) => !isStarOrBseCode(String(s?.code || s?.secid || '').split('.').pop() || ''))
          : (data.stocks as any[]);
        runFilterStocks(
          base.map((s: any) => s.secid),
          ftypes,
          fdays
        );
      }
    },
  });
  const { run: mayGetStocks } = useThrottleFn(
    (source: number, secid: string, ps: number) => {
      if (secid.length > 0) {
        if (isSWIndustryCode(secid)) {
          // 申万二级行业代码，使用 Tushare index_member 接口
          runGetIndustryStocks(secid);
        } else {
          // 东财/同花顺板块代码，走原有逻辑
          runGetStocks(source, secid, ps);
        }
      }
    },
    {
      wait: 2000,
    }
  );
  useWorkDayTimeToDo(
    () => {
      mayGetStocks(kLineApiSourceSetting, secid, 200);
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
    if (!secid) {
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
      const industryCode = isSWIndustryCode(secid) ? secid.split('.').pop() || secid : secid;
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
  const collectCurrentItemsRaw = useCallback((): ShortTermScoreItem[] => {
    const lookupName = (code: string) => stocks.find((s) => s.code === code)?.name || '';
    const lookupHybk = (code: string) => {
      const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`;
      return stockConfigsMapping[secid]?.hybk || null;
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
    if (displayMode === 'shortScore' && shortScoreCodesRef.current.length) {
      // 评分结果展示中再次评分：沿用上一次的股票池。
      // （不这样做会退回「当前板块全部股票」，与「预计算训练评分」覆盖的股票池不一致，
      //   多出来的股票只能现算，表现为「预计算过了、再点短线评分仍然很慢」。）
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
  }, [stocks, poolStocks, stockConfigsMapping, displayMode, mainInData, signalData, riskData, leaderData, leaderDisplayCount]);

  /**
   * 评分池：在「当前股票池」基础上按「排除科创板+北交所」过滤
   * （短线评分与训练周期预计算都用它，保证预计算覆盖的正是要评分的这批股票）
   */
  const collectCurrentItems = useCallback((): ShortTermScoreItem[] => {
    const list = collectCurrentItemsRaw();
    if (!excludeStarBse) {
      return list;
    }
    return list.filter((i) => !isStarOrBseCode(i.code));
  }, [collectCurrentItemsRaw, excludeStarBse]);

  // ========== 短线评分 ==========
  const handleShortScore = useCallback(async () => {
    if (shortScoreLoading) {
      isShortScorePausedRef.current = true;
      return;
    }
    const currentItems = collectCurrentItems();

    // 暂停后恢复：继续处理剩余未评分项；全新开始：重置
    if (shortScoreRemainingRef.current.length === 0) {
      if (currentItems.length === 0) {
        console.log('[短线评分] 没有可评分的股票');
        return;
      }
      setShortScoreData([]);
      setShortScoreProgress(0);
      shortScoreTotalRef.current = currentItems.length;
      shortScoreRemainingRef.current = [...currentItems];
      shortScoreCodesRef.current = currentItems.map((i) => i.code);
      // 历史列：先取近 N 个交易日（口径与评分基准日一致），已有序列稍后一并刷新
      setShortScoreSeries({});
      try {
        setShortScoreDays(await resolveRecentTradingDays(kLineApiSourceSetting, SHORT_SCORE_HISTORY_DAYS));
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
        onRow: (row, item) => {
          // 从剩余队列中移除已完成的（支持暂停后恢复）
          const idx = shortScoreRemainingRef.current.findIndex((x) => x.code === item.code);
          if (idx >= 0) {
            shortScoreRemainingRef.current.splice(idx, 1);
          }
          setShortScoreData((prev) => [...prev, row]);
          setShortScoreProgress(Math.round(((shortScoreTotalRef.current - shortScoreRemainingRef.current.length) / shortScoreTotalRef.current) * 100));
        },
      });
      // 历史列交易日：优先用评分流程内部（已按训练日收敛）的交易日，避免单独取数失败导致历史列消失
      if (computed.recentDays.length) {
        setShortScoreDays(computed.recentDays.slice(-SHORT_SCORE_HISTORY_DAYS));
      }
      // 计算完成（或暂停）后刷新评分序列，用于渲染「近 N 日评分」历史列。
      // 只取历史列需要的交易日：整套训练窗口的序列（股票数 × 交易日数）可能有几十 MB，
      // 全量传回渲染进程会明显拖慢点击。
      try {
        const historyDays = (computed.recentDays.length ? computed.recentDays : shortScoreDays).slice(
          -SHORT_SCORE_HISTORY_DAYS
        );
        setShortScoreSeries(
          await loadScoreSeries(shortScoreCodesRef.current, kLineApiSourceSetting, { dates: historyDays })
        );
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
  }, [shortScoreLoading, collectCurrentItems, kLineApiSourceSetting, shortScoreDays]);

  // ========== 当日评分（只更新「只依赖K线」的 K线形态 + RSI） ==========
  // 盘中（或收盘后数据源还没生成当日日K）时，短线评分拿不到基准日的日K，当日列只显示 --。
  // 只针对「当前过滤结果的全部股票」（不分页）逐只取当日分时合成一根当日K线，
  // 算「K线形态 / 阴阳 / 是否放量」与「RSI」，不跑完整评分流程（不取指数分时 / 板块 / 资金 / 涨跌比）；
  // 当前交易日的评分列显示 -- 。是否交易日直接查交易日历；当日日K生成后再点一次即可用官方口径覆盖。
  // 注意：这里刻意不用 useCallback —— 它要引用声明在后面的 visibleShowList，
  // 普通函数在「调用时」才求值，因此不会踩到 TDZ。
  const handleTodayScore = async () => {
    if (todayScoreLoading) {
      // 再次点击视为暂停：当前股票算完后停止（已算完的结果保留在列表里）
      isTodayScorePausedRef.current = true;
      return;
    }
    const currentItems = collectVisibleItems();
    if (currentItems.length === 0) {
      console.log('[当日评分] 当前列表没有可评分的股票');
      return;
    }
    console.log(`[当日评分] 处理当前过滤结果共 ${currentItems.length} 只（全部页）`);

    isTodayScorePausedRef.current = false;
    todayScoreRunningRef.current = true;
    todayScoreDoneRef.current = 0;
    setShortScoreData([]);
    setShortScoreProgress(0);
    setTodayScoreProgress(0);
    setTodayScoreLoading(true);
    shortScoreTotalRef.current = currentItems.length;
    shortScoreRemainingRef.current = [];
    shortScoreCodesRef.current = currentItems.map((i) => i.code);
    setShortScoreSeries({});
    setDisplayMode('shortScore');
    setCurrentPage(1);
    try {
      setShortScoreDays(await resolveRecentTradingDays(kLineApiSourceSetting, SHORT_SCORE_HISTORY_DAYS));
    } catch {
      setShortScoreDays([]);
    }

    try {
      const computed = await computeTodayScoreRows(currentItems, {
        source: kLineApiSourceSetting,
        concurrency: 6,
        historyDays: SHORT_SCORE_HISTORY_DAYS,
        shouldStop: () => isTodayScorePausedRef.current,
        onRow: (row) => {
          todayScoreDoneRef.current += 1;
          setShortScoreData((prev) => [...prev, row]);
          setTodayScoreProgress(Math.round((todayScoreDoneRef.current / currentItems.length) * 100));
        },
      });
      // 历史列交易日：用交易日历给出的最近交易日（含当日），保证当日列一定在
      if (computed.recentDays.length) {
        setShortScoreDays(computed.recentDays.slice(-SHORT_SCORE_HISTORY_DAYS));
      }
      // 刷新历史列（读本地评分序列，不重新计算）；当日不出分，列内固定显示 --
      try {
        const historyDays = (computed.recentDays.length ? computed.recentDays : shortScoreDays).slice(
          -SHORT_SCORE_HISTORY_DAYS
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
    const items = collectCurrentItems();
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
  }, [precomputing, ontrain, trainDate, trainStartDate, trainEndDate, kLineApiSourceSetting, collectCurrentItems]);

  const changeSecid = useCallback(
    (t: BKType, s: string) => {
      if (!s) return;
      setCurrentPage(1);
      setDisplayMode('stocks');
      onChangeBK(t, s);
      setTimeout(() => {
        mayGetStocks(kLineApiSourceSetting, s, 200);
      }, 0);
    },
    [secid, kLineApiSourceSetting, mayGetStocks]
  );

  useEffect(() => {
    if (secid) {
      mayGetStocks(kLineApiSourceSetting, secid, 200);
    }
  }, [secid, kLineApiSourceSetting]);

  // 评分基准日随训练日/数据源变化：旧结果是上一交易日（或上一数据源）算的，直接展示会误导，需清空重算
  useEffect(() => {
    if (isShortScoreRunningRef.current || todayScoreRunningRef.current) {
      return;
    }
    setShortScoreData([]);
    setShortScoreProgress(0);
    setTodayScoreProgress(0);
    shortScoreRemainingRef.current = [];
    setShortScoreSeries({});
    setShortScoreDays([]);
  }, [trainDate, kLineApiSourceSetting]);

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
      const nextType = currentType === 0 ? 1 : currentType === 1 ? 2 : 0;
      // 只保留当前点击列的排序状态，其他列重置
      if (nextType === 0) {
        return {};
      }
      return { [key]: nextType };
    });
  }, []);

  // 「近 N 日评分」列实际展示的交易日：
  // 优先用评分流程返回的交易日（已按训练日收敛）；若为空则退回评分序列里已存在的交易日
  // （训练模式下以训练日为上限，避免读到预计算写入的未来交易日），保证有数据时历史列不消失。
  const shortScoreDisplayDays = React.useMemo(() => {
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
    return [...set].sort().slice(-SHORT_SCORE_HISTORY_DAYS);
  }, [shortScoreDays, shortScoreSeries, ontrain, trainDate]);

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
      // 过滤：近 N 个交易日出现过 ≥ 阈值分（当日分 + 历史列序列任一命中即可）
      if (shortScoreFilterEnabled) {
        const threshold = Number(shortScoreFilterScore);
        list = list.filter((s: any) => {
          if (s.total != null && s.total >= threshold) {
            return true;
          }
          const series = shortScoreSeries?.[s.code];
          if (!series) {
            return false;
          }
          return shortScoreDisplayDays.some((d) => {
            const v = series[d]?.total;
            return v != null && v >= threshold;
          });
        });
      }
      const keys = Object.keys(sortTypes);
      if (keys.length === 1) {
        list.sort((a: any, b: any) => {
          const left = Number(a[keys[0]]) || 0;
          const right = Number(b[keys[0]]) || 0;
          if (left === right) return 0;
          const t = sortTypes[keys[0]];
          return t === 1 ? (left > right ? 1 : -1) : (left < right ? 1 : -1);
        });
      }
      return list as any;
    }

    let list = filterStocks.filter((s) => {
      if (nameFilter && !s.name.includes(nameFilter)) return false;
      return true;
    });
    const keys = Object.keys(sortTypes);
    if (keys.length === 1) {
      list = sortItems(list, keys[0], sortTypes[keys[0]]);
    }
    return list;
  }, [filterStocks, sortTypes, nameFilter, sortItems, displayMode, leaderData, leaderDisplayCount, riskData, riskDisplayCount, signalData, signalDisplayCount, mainInData, mainInDisplayCount, shortScoreData, shortScoreFilterEnabled, shortScoreFilterScore, shortScoreSeries, shortScoreDisplayDays]);

  /**
   * 实际渲染的列表：按「排除科创板+北交所」过滤（对所有展示模式生效）
   * 分页 total 同样用它，保证页码与可见行数一致。
   */
  const visibleShowList = React.useMemo(() => {
    if (!excludeStarBse) {
      return showList as any[];
    }
    return (showList as any[]).filter((item: any) => !isStarOrBseCode(codeOfListItem(item)));
  }, [showList, excludeStarBse]);

  /**
   * 「当日评分」的股票池：当前列表的「过滤结果」全部股票（**不分页**）
   *
   * 即用户在列表上筛出来的那批：排除科创板/北交所、名字过滤、K线过滤（ftypes）、
   * 各选股模式（龙头 / 排雷 / 择时 / 主力建仓）的结果集，以及「近 N 日出现过 ≥ 阈值分」这类评分侧过滤，
   * 全部计入；只是不再无条件把整个板块跑一遍。
   * 列表行可能是 code / ts_code / secid 三种形态，统一用 codeOfListItem 取回 6 位代码再与池子取交集。
   */
  const collectVisibleItems = useCallback((): ShortTermScoreItem[] => {
    const base = collectCurrentItems();
    const codes = new Set(
      (visibleShowList as any[]).map((row) => codeOfListItem(row)).filter(Boolean)
    );
    return base.filter((i) => codes.has(i.code));
  }, [collectCurrentItems, visibleShowList]);

  /** 当前过滤结果的股票数：即「当日评分」实际会处理的数量（全部页），直接标在按钮上 */
  const todayScoreCount = visibleShowList.length;

  return (
    <>
      <div className={classNames(styles.header, styles.actbar)}>
        <div>
          <Select
            value={bktype}
            onSelect={(v) => changeSecid(v, v === BKType.Industry ? industries[0].secid : gainians[0].secid)}
            style={{ marginRight: 10 }}
          >
            <Select.Option value={BKType.Industry}>行业板块</Select.Option>
            <Select.Option value={BKType.Gainian}>概念板块</Select.Option>
          </Select>
          {bktype === BKType.Industry && (
            <Select value={secid} onSelect={(v) => changeSecid(BKType.Industry, v)} style={{ width: 120 }}>
              <Select.Option value="">未选择</Select.Option>
              {industries.map((i) => (
                <Select.Option value={i.secid} key={i.code}>
                  {i.name}
                </Select.Option>
              ))}
            </Select>
          )}
          {bktype === BKType.Gainian && (
            <Select value={secid} onSelect={(v) => changeSecid(BKType.Gainian, v)}>
              <Select.Option value="">未选择</Select.Option>
              {gainians.map((i) => (
                <Select.Option value={i.secid} key={i.code}>
                  {i.name}
                </Select.Option>
              ))}
            </Select>
          )}
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
            {shortScoreLoading ? `评分中 ${shortScoreProgress}%` : '短线评分'}
          </Button>
          <Button
            size="small"
            onClick={handleTodayScore}
            loading={todayScoreLoading}
            style={{ marginLeft: 4 }}
            title="处理当前过滤结果的全部股票（不分页）：更新只依赖K线的当日K线形态与 RSI（当日K线未生成时用分时补全）。当日不计算综合分，评分列显示 --"
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
              <span>近{SHORT_SCORE_HISTORY_DAYS}日出现过≥</span>
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
          {ontrain && displayMode === 'shortScore' && (
            <span style={{ marginLeft: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--secondary-text-color)' }}>训练日</span>
              <span style={{ fontSize: 12, fontWeight: 'bold' }}>{trainDate || '--'}</span>
              <Button size="small" disabled={!nextTrainDay || shortScoreLoading} onClick={handleNextTrainDay}>
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
          <Col span={2} title="RSI 仅计算与展示，不计入个股综合分（短线评分偏选股，不用于择时）">
            RSI
            <Button size="small" type="text" icon={sortTypes.rsiScore == 1 ? <CaretUpOutlined /> : sortTypes.rsiScore == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('rsiScore')} />
          </Col>
          <Col span={3} title="最新交易日的单根K线形态（复用技术形态识别：宝剑线/十字星/铁锤线/海绵宝宝…）">
            K线形态
          </Col>
          <Col span={2}>
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
          visibleShowList.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((s) => (
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
          visibleShowList.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((s: any) => (
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
          visibleShowList.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((s: any) => {
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
          visibleShowList.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((s: any) => {
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
          visibleShowList.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((s: any) => {
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
                  <span style={{ color: '#1890ff' }}>{s.name || s.code}</span>
                </Col>
                <Col
                  span={2}
                  title={[s.rsiPattern, s.error].filter(Boolean).join('｜') || undefined}
                  style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {/* RSI 列只展示 RSI 分值：数据未就绪的说明放到悬停提示，不再把「数据未覆盖到」占满 RSI 单元格 */}
                  <span style={{ fontSize: 12, color: s.pending ? '#faad14' : undefined }}>
                    {s.rsiScore == null ? '--' : `${s.rsiScore.toFixed(0)}/40`}
                  </span>
                </Col>
                <Col
                  span={3}
                  style={{ fontSize: 12 }}
                  title={`最新交易日K线形态${s.klineShape ? `（${s.klineYin ? '阴线' : '阳线'}）` : ''}${s.intraday ? '｜当日K线由分时补全' : ''}${s.error ? `｜${s.error}` : ''}`}
                >
                  {s.klineShape ? (
                    <span className={Utils.GetValueColor(s.klineYin ? -1 : 1).textClass}>{s.klineShape}</span>
                  ) : s.notListed ? (
                    // 评分基准日尚未上市：不计分、不取数（悬停看上市日期）
                    <span style={{ color: 'var(--reverse-text-color)' }}>未上市</span>
                  ) : (
                    '--'
                  )}
                </Col>
                <Col span={2} title={s.volumeExpanded == null ? '无数据' : s.volumeExpanded ? '最新交易日放量' : '最新交易日未放量'}>
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
          visibleShowList.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((s: any) => {
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
          total={visibleShowList.length}
          onChange={onPageChange}
          showSizeChanger={false}
          size="small"
          style={{ padding: '10px 0', textAlign: 'center' }}
        />
      </div>
    </>
  );
};

export default STList;