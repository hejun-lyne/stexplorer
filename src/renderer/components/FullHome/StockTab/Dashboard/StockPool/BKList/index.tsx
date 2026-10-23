import React, { useEffect, useMemo } from 'react';
import { Button, List, Row, Col, Tooltip, Select, InputNumber, Checkbox, Input } from 'antd';
import styles from '../index.scss';
import * as Services from '@/services';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
import * as Helpers from '@/helpers';
import { useState } from 'react';
import { BKType } from '@/utils/enums';
import { Stock } from '@/types/stock';
import { useRequest } from 'ahooks';
import { useCallback } from 'react';
// import { useWorkDayTimeToDo } from '@/utils/hooks';
import { useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { CaretDownOutlined, CaretRightOutlined, CaretUpOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  BOARD_SCORE_HISTORY_DAYS,
  BoardScoreItem,
  BoardScoreRow,
  BoardScoreSeries,
  computeBoardShortTermScoreRows,
  formatBoardMoney,
  loadBoardScoreSeries,
  precomputeBoardScores,
} from '@/helpers/boardShortTermScore';
import { scoreColor } from '@/helpers/shortTermScore';
import { resolveRecentTradingDays } from '@/helpers/shortTermScoreList';

export interface BKListProps {
  type: BKType;
  onBankuaisUpdate: (t: BKType, bks: Stock.BanKuaiItem[]) => void;
  onOpenBKStocks: (t: BKType, s: string) => void;
  onOpenBK: (s: string, name: string) => void;
  /** 点击行业筛选结果中的行业名称，跳转到该行业的股票列表 */
  onOpenIndustry: (industryCode: string, industryName: string) => void;
  active: boolean;
}

const BKList: React.FC<BKListProps> = ({ type, onBankuaisUpdate, onOpenBKStocks, onOpenBK,onOpenIndustry, active }) => {
  const [pageSize, setPageSize] = useState(100);
  const [noMore, setNoMore] = useState(false);
  const [bankuais, setBankuais] = useState<Stock.BanKuaiItem[]>([]);
  const [techFilterLoading, setTechFilterLoading] = useState(false);
  const [maResults, setMaResults] = useState<Record<string, { ma20: boolean; ma40: boolean; ma60: boolean }>>({});
  const [rsiResults, setRsiResults] = useState<Record<string, { rsi6: number; isOversold: boolean }>>({});
  const [techPending, setTechPending] = useState<Record<string, boolean>>({});
  const [maThreshold, setMaThreshold] = useState<number>(5);
  const [filterMA20, setFilterMA20] = useState(false);
  const [filterMA40, setFilterMA40] = useState(false);
  const [filterMA60, setFilterMA60] = useState(false);
  const [filterRSI, setFilterRSI] = useState(false);
  const [techProgress, setTechProgress] = useState(0);
  const isPausedRef = React.useRef(false);
  const currentIndexRef = React.useRef(0);
  const [nameFilter, setNameFilter] = useState('');
  const [sortTypes, setSortTypes] = useState<Record<string, number>>({});
  const [currentPage, setCurrentPage] = useState(1);
  /** 当前展示的数据（板块列表 / 行业筛选结果 / 板块短线评分结果 共用，按 displayMode 区分行结构） */
  const [showList, setShowList] = useState<any[]>([]);
  const [dataSource, setDataSource] = useState<'dc' | 'ths'>('dc');
  const [industryFilterLoading, setIndustryFilterLoading] = useState(false);
  const [industryAllData, setIndustryAllData] = useState<any[]>([]);
  const [industryDisplayCount, setIndustryDisplayCount] = useState(0);
  const [industryProgress, setIndustryProgress] = useState(0);
  const [displayMode, setDisplayMode] = useState<'boards' | 'industries' | 'boardScore'>('boards');
  const isIndustryPausedRef = React.useRef(false);
  const industryIndexRef = React.useRef(0);
  // ========== 板块短线评分 ==========
  const [scoreLoading, setScoreLoading] = useState(false);
  const [scoreProgress, setScoreProgress] = useState(0);
  const [scoreData, setScoreData] = useState<BoardScoreRow[]>([]);
  /** 最小评分过滤（0 = 不过滤） */
  const [scoreMinScore, setScoreMinScore] = useState(0);
  const isScorePausedRef = React.useRef(false);
  /** 本轮待评分的板块（暂停后恢复时继续处理剩余项） */
  const scoreRemainingRef = React.useRef<BoardScoreItem[]>([]);
  const scoreTotalRef = React.useRef(0);
  /** 评分批次号：切换板块类型/数据源时递增，旧批次的回调结果直接丢弃 */
  const scoreRunRef = React.useRef(0);
  /** 「近 N 日评分」列对应的交易日（升序，最后一个为评分基准日） */
  const [scoreDays, setScoreDays] = useState<string[]>([]);
  /** 评分序列：{ 板块代码: { 交易日: 评分行 } }，历史列从这里取值 */
  const [scoreSeries, setScoreSeries] = useState<BoardScoreSeries>({});
  /** 历史列补算进度（null = 无补算） */
  const [historyProgress, setHistoryProgress] = useState<{ done: number; total: number } | null>(null);
  // ========== 训练周期预计算 ==========
  const [precomputing, setPrecomputing] = useState(false);
  const [precomputeProgress, setPrecomputeProgress] = useState(0);
  const [precomputeMessage, setPrecomputeMessage] = useState('');
  const isPrecomputePausedRef = React.useRef(false);
  /** 最近一次的板块评分函数（训练日切换 / 预计算完成后自动刷新用） */
  const boardScoreRefreshRef = React.useRef<() => void>();
  const scoreLoadingRef = React.useRef(false);
  const PAGE_SIZE = 50;
  const { kLineApiSourceSetting } = useSelector((state: StoreState) => state.setting.systemSetting);
  const { ontrain, trainDate, trainStartDate, trainEndDate } = useSelector(
    (state: StoreState) => state.setting.systemSetting
  );
  const { run: runGetBankuais } = useRequest(Services.Stock.GetBanKuaisFromDataSource, {
    throwOnError: true,
    manual: true,
    onSuccess: (d: { to: number; arr: Stock.BanKuaiItem[] }) => {
      setNoMore(d.to === d.arr.length);
      setBankuais(d.arr);
      onBankuaisUpdate(type, d.arr);
    },
  });
  const mayGetBankuais = useCallback((source: number, t: BKType, ps: number, ds: string) => {
    runGetBankuais(source, t, ps, ds);
  }, []);

  // 1. 修复 updateSortType：使用函数式更新消除闭包陷阱，并切排序时回到第1页
  // 格式化资金流向金额（元 -> 亿/万）
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

  const updateSortType = useCallback((key: string) => {
    setSortTypes((prev) => {
      const current = prev[key] || 0;
      const nextType = current === 0 ? 1 : current === 1 ? 2 : 0;
      // 如果切回0（取消排序），直接清空对象，避免残留旧key干扰
      return nextType === 0 ? {} : { [key]: nextType };
    });
    setCurrentPage(1);
  }, []);

  useEffect(() => {
    if (displayMode === 'industries') {
      // 只显示已计算的行业（分批显示效果）
      let list = industryAllData.slice(0, industryDisplayCount);
      const keys = Object.keys(sortTypes);
      if (keys.length === 1) {
        const key = keys[0];
        const t = sortTypes[key];
        if (t !== 0) {
          list = list.sort((a: any, b: any) => {
            const left = Number(a[key]) || 0;
            const right = Number(b[key]) || 0;
            if (left === right) return 0;
            return t === 1 ? (left > right ? 1 : -1) : (left < right ? 1 : -1);
          });
        }
      }
      setShowList(list as any);
      return;
    }

    if (displayMode === 'boardScore') {
      // 板块短线评分结果：名称 / 最低分过滤 + 排序（未指定排序时按评分从高到低）
      let list = scoreData.filter((s) => {
        if (nameFilter && !String(s.name || '').includes(nameFilter)) return false;
        if (scoreMinScore > 0 && s.total != null && s.total < scoreMinScore) return false;
        return true;
      });
      const keys = Object.keys(sortTypes);
      const key = keys.length === 1 ? keys[0] : '';
      const t = key ? sortTypes[key] : 2;
      if (t !== 0) {
        list = [...list].sort((a: any, b: any) => {
          // 未算出分的行（数据不足/待评分）始终排在最后
          const av = Number(a[key || 'total']);
          const bv = Number(b[key || 'total']);
          const aOk = Number.isFinite(av) && a[key || 'total'] != null;
          const bOk = Number.isFinite(bv) && b[key || 'total'] != null;
          if (!aOk && !bOk) return 0;
          if (!aOk) return 1;
          if (!bOk) return -1;
          if (av === bv) return 0;
          return t === 1 ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
        });
      }
      setShowList(list);
      return;
    }

    let list = bankuais.filter((b) => {
      if (nameFilter && !b.name.includes(nameFilter)) return false;
      if (!filterMA20 && !filterMA40 && !filterMA60 && !filterRSI) return true;
      if (filterMA20 && maResults[b.secid] && !maResults[b.secid].ma20) return false;
      if (filterMA40 && maResults[b.secid] && !maResults[b.secid].ma40) return false;
      if (filterMA60 && maResults[b.secid] && !maResults[b.secid].ma60) return false;
      if (filterRSI && rsiResults[b.secid] && !rsiResults[b.secid].isOversold) return false;
      return true;
    });
    const keys = Object.keys(sortTypes);
    if (keys.length === 1) {
      const key = keys[0];
      const t = sortTypes[key];
      if (t !== 0) {
        list = [...list].sort((a, b) => {
          let left = 0, right = 0;
          if (key === 'szbl') {
            const totalA = (Number(a.szs) || 0) + (Number(a.xds) || 0);
            const totalB = (Number(b.szs) || 0) + (Number(b.xds) || 0);
            left = totalA > 0 ? (Number(a.szs) || 0) / totalA : 0;
            right = totalB > 0 ? (Number(b.szs) || 0) / totalB : 0;
          } else {
            left = Number((a as any)[key]) || 0;
            right = Number((b as any)[key]) || 0;
          }
          if (left === right) return 0;
          if (t == 1) {
            return left > right ? 1 : -1;
          } else {
            return left < right ? 1 : -1;
          }
        });
      }
    }
    setShowList(list);
  }, [bankuais, sortTypes, nameFilter, filterMA20, filterMA40, filterMA60, filterRSI, maResults, rsiResults, displayMode, industryAllData, industryDisplayCount, scoreData, scoreMinScore]);

  const totalPage = Math.max(1, Math.ceil(showList.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPage);
  const pageData = showList.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    if (currentPage > totalPage) {
      setCurrentPage(totalPage);
    }
  }, [totalPage, currentPage]);

  // useWorkDayTimeToDo(() => mayGetBankuais(kLineApiSourceSetting, type, pageSize), active ? CONST.DEFAULT.STOCK_TREND_DELAY : null);
  useEffect(() => {
    setCurrentPage(1);
    currentIndexRef.current = 0;
    setTechProgress(0);
    setDisplayMode('boards');
    // 板块类型/数据源变化：上一轮评分结果已经不属于当前列表，直接丢弃
    isScorePausedRef.current = true;
    scoreRunRef.current += 1;
    scoreRemainingRef.current = [];
    scoreTotalRef.current = 0;
    setScoreData([]);
    setScoreProgress(0);
    setScoreDays([]);
    setScoreSeries({});
    setHistoryProgress(null);
    setPrecomputeMessage('');
    setPrecomputeProgress(0);
    runGetBankuais(kLineApiSourceSetting, type, pageSize, dataSource);
  }, [kLineApiSourceSetting, type, dataSource]);
  const loadMore = useCallback(() => {
    const ps = pageSize + 40;
    setPageSize(ps);
    mayGetBankuais(kLineApiSourceSetting, type, ps, dataSource);
  }, [kLineApiSourceSetting, type, pageSize, dataSource]);

  const handleFilterIndustries = useCallback(async () => {
    if (industryFilterLoading) {
      // 暂停
      isIndustryPausedRef.current = true;
      return;
    }

    // 重置状态
    if (industryIndexRef.current === 0 || industryIndexRef.current >= industryAllData.length) {
      setIndustryAllData([]);
      setIndustryDisplayCount(0);
      industryIndexRef.current = 0;
    }

    isIndustryPausedRef.current = false;
    setIndustryFilterLoading(true);
    setIndustryProgress(0);
    setDisplayMode('industries');
    setCurrentPage(1);

    try {
      const today = dayjs().format('YYYYMMDD');
      console.log('[行业筛选] 开始获取所有行业数据...');

      // 一次性获取所有行业数据（不过滤）
      const result = await Services.Tushare.FilterIndustriesFromTushare(today, {
        fund_flow_rank_pct: 0.3,
        require_ma_bull: true,
        min_return_5d: 1.0,
      }, true); // return_all = true

      if (!result.industries || result.industries.length === 0) {
        console.log('[行业筛选] 没有获取到行业数据');
        setIndustryFilterLoading(false);
        return;
      }

      const allData = result.industries;
      console.log(`[行业筛选] 获取到 ${allData.length} 个行业，开始分批显示...`);
      setIndustryAllData(allData);

      // 分批显示动画：每 50ms 更新一批，模拟逐个计算效果
      const batchSize = 3;
      const total = allData.length;

      for (let i = industryIndexRef.current; i < total; i += batchSize) {
        if (isIndustryPausedRef.current) {
          industryIndexRef.current = i;
          break;
        }

        const end = Math.min(i + batchSize, total);
        setIndustryDisplayCount(end);
        industryIndexRef.current = end;
        setIndustryProgress(Math.round((end / total) * 100));

        // 让出主线程，更新 UI
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      if (!isIndustryPausedRef.current) {
        industryIndexRef.current = 0;
        setIndustryProgress(100);
        console.log(`[行业筛选] 完成，共 ${allData.length} 个行业，通过过滤: ${allData.filter((d: any) => d.passed).length} 个`);
      }
    } catch (e) {
      console.error('行业筛选失败:', e);
    } finally {
      setIndustryFilterLoading(false);
    }
  }, [industryFilterLoading, industryAllData.length]);

  const onCalcTechIndicators = useCallback(async () => {
    if (techFilterLoading) {
      isPausedRef.current = true;
      return;
    }
    if (bankuais.length === 0) return;
    const secids = bankuais.map((s) => s.secid);

    if (currentIndexRef.current === 0 || currentIndexRef.current >= secids.length) {
      setMaResults({});
      setRsiResults({});
      currentIndexRef.current = 0;
    }

    isPausedRef.current = false;
    setTechFilterLoading(true);
    setTechProgress(Math.round((currentIndexRef.current / secids.length) * 100));

    const pendingInit: Record<string, boolean> = {};
    for (let j = currentIndexRef.current; j < secids.length; j++) {
      pendingInit[secids[j]] = true;
    }
    setTechPending(pendingInit);

    const batchSize = 5;
    for (let i = currentIndexRef.current; i < secids.length; i += batchSize) {
      const batch = secids.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (secid) => {
          const res = await Helpers.Stock.CheckStockMAAndRSI(secid, maThreshold / 100, 30);
          console.log('MA+RSI check', secid, res);
          return { secid, res };
        })
      );
      setMaResults((prev) => {
        const next = { ...prev };
        setRsiResults((rPrev) => {
          const rNext = { ...rPrev };
          setTechPending((pPrev) => {
            const pNext = { ...pPrev };
            batchResults.forEach(({ secid, res }) => {
              delete pNext[secid];
              if (res) {
                next[secid] = { ma20: res.ma20, ma40: res.ma40, ma60: res.ma60 };
                rNext[secid] = { rsi6: res.rsi6, isOversold: res.isOversold };
              } else {
                next[secid] = { ma20: false, ma40: false, ma60: false };
                rNext[secid] = { rsi6: 0, isOversold: false };
              }
            });
            return pNext;
          });
          return rNext;
        });
        return next;
      });
      currentIndexRef.current = i + batch.length;
      setTechProgress(Math.round((currentIndexRef.current / secids.length) * 100));

      if (isPausedRef.current) {
        break;
      }
    }

    if (!isPausedRef.current) {
      currentIndexRef.current = 0;
      setTechProgress(100);
    }
    setTechFilterLoading(false);
    if (!isPausedRef.current) {
      setTechPending({});
    }
  }, [bankuais, maThreshold, techFilterLoading]);

  /**
   * 板块短线评分
   *
   * 对当前列表的全部板块逐只评分（趋势位置 + 主力资金 + 量能 + RSI，见 helpers/boardShortTermScore），
   * 同时补算「近 N 日评分」历史列并落库：当天命中缓存 + 历史列已齐的板块零取数，
   * 所以预计算过的训练日切过来基本是瞬时的。
   * 再次点击视为暂停：当前板块算完后停止，已出分的结果保留；继续点击从剩余板块接着评。
   */
  const handleBoardScore = useCallback(async () => {
    if (scoreLoading) {
      isScorePausedRef.current = true;
      return;
    }
    if (!bankuais.length) {
      return;
    }
    const items: BoardScoreItem[] = bankuais.map((b) => ({ secid: b.secid, code: b.code, name: b.name }));
    // 新的一轮（队列已空 / 上一轮已跑完）：重置结果与进度
    if (!scoreRemainingRef.current.length) {
      setScoreData([]);
      setScoreProgress(0);
      scoreTotalRef.current = items.length;
      scoreRemainingRef.current = [...items];
    }

    const run = scoreRunRef.current;
    isScorePausedRef.current = false;
    setScoreLoading(true);
    setHistoryProgress(null);
    setDisplayMode('boardScore');
    // 先把历史列的交易日定下来（交易日历有缓存），免得评分过程中表头是空的
    if (!scoreDays.length) {
      try {
        const days = await resolveRecentTradingDays(kLineApiSourceSetting, BOARD_SCORE_HISTORY_DAYS);
        if (days.length && scoreRunRef.current === run) {
          setScoreDays(days);
        }
      } catch {
        // 交易日历取不到时，历史列表头先留空，评分结束后会由结果补上
      }
    }
    // 评分列表的排序键与板块列表不同，进入时清空，默认按评分倒序
    setSortTypes({});
    setCurrentPage(1);

    try {
      const res = await computeBoardShortTermScoreRows(scoreRemainingRef.current, {
        source: kLineApiSourceSetting,
        concurrency: 3,
        historyDays: BOARD_SCORE_HISTORY_DAYS,
        shouldStop: () => isScorePausedRef.current || scoreRunRef.current !== run,
        onRow: (row, item) => {
          // 从剩余队列中移除已完成项（暂停后恢复时接着评剩余的）
          const idx = scoreRemainingRef.current.findIndex((x) => x.secid === item.secid);
          if (idx >= 0) {
            scoreRemainingRef.current.splice(idx, 1);
          }
          if (scoreRunRef.current !== run) {
            // 板块类型/数据源已切换：这一轮属于上一批板块，不再写入列表
            return;
          }
          setScoreData((prev) => [...prev, row]);
          setScoreProgress(
            Math.round(
              ((scoreTotalRef.current - scoreRemainingRef.current.length) / Math.max(1, scoreTotalRef.current)) * 100
            )
          );
        },
        onHistoryProgress: (info) => {
          if (scoreRunRef.current === run) {
            setHistoryProgress(info.done >= info.total ? null : info);
          }
        },
        onSeries: (partial) => {
          if (scoreRunRef.current !== run) {
            return;
          }
          setScoreSeries((prev) => {
            const next: BoardScoreSeries = { ...prev };
            Object.keys(partial).forEach((code) => {
              next[code] = { ...(prev[code] || {}), ...partial[code] };
            });
            return next;
          });
        },
      });
      if (scoreRunRef.current !== run) {
        return;
      }
      // 历史列的交易日与序列：以本轮结果为准（本轮没算的日子已在 helper 里用缓存补齐）
      setScoreDays(res.recentDays);
      if (res.recentDays.length) {
        const series: BoardScoreSeries = { ...res.series };
        // 缓存里没参与本轮评分的板块也一并读出来，避免「只评了部分板块」时历史列空着
        const unloaded = bankuais.map((b) => b.code).filter((code) => !Object.keys(series[code] || {}).length);
        if (unloaded.length) {
          const fromCache = await loadBoardScoreSeries(unloaded, kLineApiSourceSetting, {
            dates: res.recentDays,
          });
          Object.keys(fromCache).forEach((code) => {
            series[code] = { ...(fromCache[code] || {}), ...(series[code] || {}) };
          });
        }
        if (scoreRunRef.current === run) {
          setScoreSeries(series);
        }
      }
      if (!isScorePausedRef.current) {
        scoreRemainingRef.current = [];
        setScoreProgress(100);
        setHistoryProgress(null);
        console.log(`[板块短线评分] 完成（基准日 ${res.scoreDayKey || '-'}，历史 ${res.recentDays.length} 日）`);
      }
    } catch (e) {
      console.error('板块短线评分失败:', e);
    } finally {
      setScoreLoading(false);
    }
  }, [scoreLoading, bankuais, kLineApiSourceSetting, scoreDays]);

  /**
   * 训练周期预计算（板块）
   *
   * 把训练窗口（含起始日之前 N 个交易日）每个交易日 × 每个板块的评分一次性算好并落库，
   * 之后在任一训练日点「短线评分」都直接命中序列。再次点击视为暂停。
   */
  const handlePrecomputeBoardScores = useCallback(async () => {
    if (precomputing) {
      isPrecomputePausedRef.current = true;
      return;
    }
    if (!ontrain || !trainStartDate || !trainEndDate) {
      return;
    }
    if (!bankuais.length) {
      return;
    }
    const items: BoardScoreItem[] = bankuais.map((b) => ({ secid: b.secid, code: b.code, name: b.name }));
    isPrecomputePausedRef.current = false;
    setPrecomputing(true);
    setPrecomputeProgress(0);
    setPrecomputeMessage('准备数据...');
    try {
      const res = await precomputeBoardScores({
        items,
        startDate: trainStartDate,
        endDate: trainEndDate,
        source: kLineApiSourceSetting,
        historyDays: BOARD_SCORE_HISTORY_DAYS,
        ignoreCache: true,
        shouldStop: () => isPrecomputePausedRef.current,
        onProgress: (done, total, message) => {
          setPrecomputeProgress(Math.round((done / Math.max(1, total)) * 100));
          setPrecomputeMessage(`${done}/${total} ${message}`);
        },
      });
      console.log(
        `[板块预计算] ${res.dates.length} 个交易日、${res.rows} 行` +
          `${res.reusedDays ? `（跳过已覆盖 ${res.reusedDays} 天）` : ''}` +
          `${res.writeErrors ? `，写库失败 ${res.writeErrors} 次` : ''}`
      );
      if (!isPrecomputePausedRef.current) {
        setPrecomputeMessage(
          `完成：${res.dates.length} 个交易日、${res.rows} 行${res.writeErrors ? `（写库失败 ${res.writeErrors} 次）` : ''}`
        );
        // 预计算完把当前评分视图刷新一遍（此时整段窗口都已落库，基本零取数）
        if (displayMode === 'boardScore') {
          boardScoreRefreshRef.current?.();
        }
      }
    } catch (e) {
      console.error('板块评分预计算失败:', e);
      setPrecomputeMessage('预计算失败，详见控制台');
    } finally {
      setPrecomputing(false);
    }
  }, [precomputing, bankuais, ontrain, trainStartDate, trainEndDate, kLineApiSourceSetting, displayMode]);

  // 训练日切换：已经进入板块评分视图时自动刷新（预计算过的训练日会直接命中缓存）
  boardScoreRefreshRef.current = handleBoardScore;
  scoreLoadingRef.current = scoreLoading;
  useEffect(() => {
    if (!ontrain || !trainDate) {
      return;
    }
    if (displayMode !== 'boardScore' || scoreLoadingRef.current) {
      return;
    }
    boardScoreRefreshRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainDate]);

  return (
    <>
      <div className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Input
            size="small"
            placeholder="名字过滤"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            style={{ width: 100, marginRight: 8 }}
          />
          <Select
            size="small"
            value={dataSource}
            onChange={(v) => setDataSource(v as 'dc' | 'ths')}
            style={{ width: 100, marginRight: 8 }}
          >
            <Select.Option value="dc">东财数据</Select.Option>
            <Select.Option value="ths">同花顺数据</Select.Option>
          </Select>
          <Button
            size="small"
            type="primary"
            onClick={() => runGetBankuais(kLineApiSourceSetting, type, pageSize, dataSource, true)}
          >
            刷新
          </Button>
          {displayMode !== 'industries' && (
            <Button
              size="small"
              onClick={handleFilterIndustries}
              loading={industryFilterLoading && industryProgress === 0}
              style={{ marginLeft: 4 }}
            >
              行业筛选
            </Button>
          )}
          {displayMode === 'industries' && (
            <Button
              size="small"
              onClick={handleFilterIndustries}
              loading={industryFilterLoading}
              style={{ marginLeft: 4 }}
            >
              {industryFilterLoading ? `分析中 ${industryProgress}%` : '重新筛选'}
            </Button>
          )}
          {displayMode !== 'industries' && (
            <>
              <Button
                size="small"
                onClick={onCalcTechIndicators}
                loading={techFilterLoading && techProgress === 0}
                style={{ marginLeft: 4 }}
              >
                {techFilterLoading ? `分析中 ${techProgress}%` : '技术指标'}
              </Button>
              <InputNumber
                size="small"
                min={0.1}
                max={50}
                step={0.1}
                value={maThreshold}
                onChange={(v) => setMaThreshold(v || 5)}
                formatter={(value) => `${value}%`}
                parser={(value) => parseFloat(value?.replace('%', '') || '5')}
                style={{ width: 60, marginLeft: 4 }}
              />
              <Button
                size="small"
                onClick={handleBoardScore}
                loading={scoreLoading && scoreProgress === 0}
                style={{ marginLeft: 4 }}
                title={`对当前列表的全部板块做短线评分：板块趋势位置 + 主力资金 + 量能活跃度 + RSI，并补算近 ${BOARD_SCORE_HISTORY_DAYS} 个交易日的历史评分（再次点击可暂停，已出分的结果保留）`}
              >
                {scoreLoading
                  ? `评分中 ${scoreProgress}%`
                  : scoreRemainingRef.current.length
                  ? '继续评分'
                  : displayMode === 'boardScore'
                  ? '重新评分'
                  : '短线评分'}
              </Button>
              {ontrain && (
                <Button
                  size="small"
                  onClick={handlePrecomputeBoardScores}
                  loading={precomputing && precomputeProgress === 0}
                  style={{ marginLeft: 4 }}
                  title={`把训练窗口（含起始日前 ${BOARD_SCORE_HISTORY_DAYS} 个交易日）每个交易日 × 当前板块列表的评分一次性算好并落库，之后切训练日直接命中缓存（再次点击可暂停）`}
                >
                  {precomputing ? `预计算 ${precomputeProgress}%` : '预计算训练评分'}
                </Button>
              )}
            </>
          )}
          {displayMode === 'boardScore' && (
            <span style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span>最低分</span>
              <InputNumber
                size="small"
                min={0}
                max={100}
                step={5}
                value={scoreMinScore}
                onChange={(v) => {
                  setScoreMinScore(typeof v === 'number' ? v : 0);
                  setCurrentPage(1);
                }}
                style={{ width: 56 }}
              />
            </span>
          )}
          {displayMode === 'boardScore' && historyProgress && (
            <span style={{ marginLeft: 8, fontSize: 12, color: '#faad14' }}>
              历史补算 {historyProgress.done}/{historyProgress.total}
            </span>
          )}
          {(precomputing || precomputeMessage) && (
            <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--reverse-text-color)' }}>{precomputeMessage}</span>
          )}
          {displayMode !== 'boards' && (
            <Button
              size="small"
              onClick={() => {
                setDisplayMode('boards');
                // 评分/行业结果的排序键不适用于板块列表，返回时清空
                setSortTypes({});
                setCurrentPage(1);
              }}
              style={{ marginLeft: 4 }}
            >
              返回板块
            </Button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Button size="small" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>上一页</Button>
          <span style={{ margin: '0 8px', color: 'var(--main-text-color)' }}>{safePage} / {totalPage}</span>
          <Button size="small" onClick={() => setCurrentPage((p) => Math.min(totalPage, p + 1))} disabled={safePage >= totalPage}>下一页</Button>
          {!noMore && (
            <Button size="small" onClick={loadMore} style={{ marginLeft: 8 }}>加载更多</Button>
          )}
        </div>
      </div>
      {displayMode === 'boards' ? (
        <Row className={styles.header}>
          <Col span={4}>名字</Col>
          <Col span={2}>
            涨跌幅
            <Button size="small" type="text" icon={sortTypes.zdf == 1 ? <CaretUpOutlined /> : sortTypes.zdf == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('zdf')} />
          </Col>
          <Col span={2}>
            换手率
            <Button size="small" type="text" icon={sortTypes.hsl == 1 ? <CaretUpOutlined /> : sortTypes.hsl == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('hsl')} />
          </Col>
          <Col span={2}>
            上涨家数
            <Button size="small" type="text" icon={sortTypes.szs == 1 ? <CaretUpOutlined /> : sortTypes.szs == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('szs')} />
          </Col>
          <Col span={2}>
            下跌家数
            <Button size="small" type="text" icon={sortTypes.xds == 1 ? <CaretUpOutlined /> : sortTypes.xds == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('xds')} />
          </Col>
          <Col span={2}>
            上涨比例
            <Button size="small" type="text" icon={sortTypes.szbl == 1 ? <CaretUpOutlined /> : sortTypes.szbl == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('szbl')} />
          </Col>
          <Col span={3}>
            今日主力净流入
            <Button size="small" type="text" icon={sortTypes.mainIn == 1 ? <CaretUpOutlined /> : sortTypes.mainIn == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('mainIn')} />
          </Col>
          <Col span={3}>
            5日主力净流入
            <Button size="small" type="text" icon={sortTypes.mainIn5d == 1 ? <CaretUpOutlined /> : sortTypes.mainIn5d == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('mainIn5d')} />
          </Col>
          <Col span={1}><Checkbox checked={filterMA20} onChange={(e) => setFilterMA20(e.target.checked)} style={{ color: '#fff' }}>MA20</Checkbox></Col>
          <Col span={1}><Checkbox checked={filterMA40} onChange={(e) => setFilterMA40(e.target.checked)} style={{ color: '#fff' }}>MA40</Checkbox></Col>
          <Col span={1}><Checkbox checked={filterMA60} onChange={(e) => setFilterMA60(e.target.checked)} style={{ color: '#fff' }}>MA60</Checkbox></Col>
          <Col span={1}><Checkbox checked={filterRSI} onChange={(e) => setFilterRSI(e.target.checked)} style={{ color: '#fff' }}>RSI6</Checkbox></Col>
        </Row>
      ) : displayMode === 'industries' ? (
        <Row className={styles.header}>
          <Col span={4}>行业名称</Col>
          <Col span={2}>状态</Col>
          <Col span={3}>
            趋势得分
            <Button size="small" type="text" icon={sortTypes.trend_score == 1 ? <CaretUpOutlined /> : sortTypes.trend_score == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('trend_score')} />
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
            资金净流入
            <Button size="small" type="text" icon={sortTypes.fund_flow == 1 ? <CaretUpOutlined /> : sortTypes.fund_flow == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('fund_flow')} />
          </Col>
          <Col span={3}>均线多头</Col>
          <Col span={3}>
            综合得分
            <Button size="small" type="text" icon={sortTypes.composite_score == 1 ? <CaretUpOutlined /> : sortTypes.composite_score == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('composite_score')} />
          </Col>
        </Row>
      ) : (
        <Row className={styles.header}>
          <Col span={3}>板块名称</Col>
          <Col span={2}>
            评分/评级
            <Button size="small" type="text" icon={sortTypes.total == 1 ? <CaretUpOutlined /> : sortTypes.total == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('total')} />
          </Col>
          <Col span={1}>
            趋势
            <Button size="small" type="text" icon={sortTypes.trendScore == 1 ? <CaretUpOutlined /> : sortTypes.trendScore == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('trendScore')} />
          </Col>
          <Col span={1}>
            量能
            <Button size="small" type="text" icon={sortTypes.volumeScore == 1 ? <CaretUpOutlined /> : sortTypes.volumeScore == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('volumeScore')} />
          </Col>
          <Col span={1}>
            资金
            <Button size="small" type="text" icon={sortTypes.moneyScore == 1 ? <CaretUpOutlined /> : sortTypes.moneyScore == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('moneyScore')} />
          </Col>
          <Col span={1}>
            RSI
            <Button size="small" type="text" icon={sortTypes.rsiScore == 1 ? <CaretUpOutlined /> : sortTypes.rsiScore == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('rsiScore')} />
          </Col>
          {Array.from({ length: BOARD_SCORE_HISTORY_DAYS }).map((_, i) => {
            const day = scoreDays[i] || '';
            return (
              <Col
                key={`h-${i}`}
                span={1}
                style={{ fontSize: 11, textAlign: 'center' }}
                title={
                  i === 0
                    ? `近 ${BOARD_SCORE_HISTORY_DAYS} 个交易日的板块短线评分（每日独立评分，口径与当日评分一致）`
                    : day || undefined
                }
              >
                {day ? day.substring(4, 6) + '/' + day.substring(6, 8) : '--'}
              </Col>
            );
          })}
        </Row>
      )}
      <div className={styles.table}>
        <div className={styles.table}>
        {displayMode === 'boards' ? (
          pageData.map((b, index) => (
            <Row key={`${b.code}-${index}`} className={styles.row}>
              <Col span={4} style={{ cursor: 'pointer' }} onClick={() => onOpenBKStocks(type, b.secid)}>
                {b.name}
              </Col>
              <Col span={2} style={{ cursor: 'pointer' }} className={Utils.GetValueColor(b.zdf).textClass} onClick={() => onOpenBK(b.secid, b.name)}>
                {!isNaN(b.zdf) ? b.zdf.toFixed(2) + '%' : '--'}
              </Col>
              <Col span={2}>{isNaN(b.hsl) ? '--' : parseFloat(b.hsl).toFixed(2) + '%'}</Col>
              <Col span={2} className="text-up">{b.szs}</Col>
              <Col span={2} className="text-down">{b.xds}</Col>
              <Col span={2} className={Utils.GetValueColor(b.szs - b.xds).textClass}>
                {((b.szs / (b.szs + b.xds)) * 100).toFixed(2) + '%'}
              </Col>
              <Col span={3} className={Utils.GetValueColor(b.mainIn).textClass}>
                {formatMoneyFlow(b.mainIn)}
              </Col>
              <Col span={3} className={Utils.GetValueColor(b.mainIn5d).textClass}>
                {formatMoneyFlow(b.mainIn5d)}
              </Col>
              <Col span={1}>{techPending[b.secid] ? '分析中' : maResults[b.secid] ? (maResults[b.secid].ma20 ? '✓' : '✗') : ''}</Col>
              <Col span={1}>{techPending[b.secid] ? '分析中' : maResults[b.secid] ? (maResults[b.secid].ma40 ? '✓' : '✗') : ''}</Col>
              <Col span={1}>{techPending[b.secid] ? '分析中' : maResults[b.secid] ? (maResults[b.secid].ma60 ? '✓' : '✗') : ''}</Col>
              <Col span={1}>{techPending[b.secid] ? '分析中' : rsiResults[b.secid] ? (rsiResults[b.secid].isOversold ? '✓' : '✗') : ''}</Col>
            </Row>
          ))
        ) : displayMode === 'industries' ? (
          pageData.map((b: any, index: number) => {
            const isCalculated = b.calculated !== false;
            const isPassed = b.passed === true;
            return (
              <Row
                key={`${b.industry_code}-${index}`}
                className={styles.row}
                style={{
                  backgroundColor: isPassed ? 'rgba(82, 196, 26, 0.08)' : undefined,
                  opacity: isCalculated ? 1 : 0.5,
                }}
              >
                <Col span={5}>
                  <Tooltip title={b.industry_code}>
                    <span style={{ cursor: 'pointer' }} onClick={() => onOpenIndustry(b.industry_code, b.industry_name)}>
                      {b.industry_name}
                      {isPassed && <span style={{ color: '#52c41a', marginLeft: 4 }}>✓</span>}
                      {!isCalculated && <span style={{ color: '#999', marginLeft: 4 }}>(计算中...)</span>}
                    </span>
                  </Tooltip>
                </Col>
                <Col span={3} className={!isCalculated ? '' : b.trend_score >= 60 ? 'text-up' : b.trend_score >= 40 ? '' : 'text-down'}>
                  {isCalculated ? (b.trend_score?.toFixed?.(1) ?? b.trend_score) : '--'}
                </Col>
                <Col span={3} className={!isCalculated ? '' : Utils.GetValueColor(b.ret_5d).textClass}>
                  {isCalculated ? `${b.ret_5d?.toFixed?.(2) ?? b.ret_5d}%` : '--'}
                </Col>
                <Col span={3} className={!isCalculated ? '' : Utils.GetValueColor(b.ret_20d).textClass}>
                  {isCalculated ? `${b.ret_20d?.toFixed?.(2) ?? b.ret_20d}%` : '--'}
                </Col>
                <Col span={4} className={!isCalculated ? '' : Utils.GetValueColor(b.fund_flow).textClass}>
                  {isCalculated ? formatMoneyFlow(b.fund_flow * 1e8) : '--'}
                </Col>
                <Col span={3}>
                  {!isCalculated ? (
                    <span style={{ color: '#999' }}>--</span>
                  ) : b.ma_bull ? (
                    <span className="text-up">✓ 多头排列</span>
                  ) : (
                    <span className="text-down">✗ 非多头</span>
                  )}
                </Col>
                <Col span={3}>
                  {isCalculated ? (b.composite_score?.toFixed?.(1) ?? b.composite_score) : '--'}
                </Col>
              </Row>
            );
          })
        ) : (
          pageData.map((s: BoardScoreRow, index: number) => {
            const rowBg =
              s.grade === 'A'
                ? 'rgba(82, 196, 26, 0.08)'
                : s.grade === 'B'
                ? 'rgba(24, 144, 255, 0.06)'
                : undefined;
            const detail = [
              s.advice && `建议：${s.advice}`,
              s.summary && `分项：${s.summary}`,
              s.trendDesc && `趋势：${s.trendDesc}`,
              s.positionDesc && `位置：${s.positionDesc}`,
              s.moneyNote && `资金：${s.moneyNote}`,
              `主力净流入 5日 ${formatBoardMoney(s.main5)}｜10日 ${formatBoardMoney(s.main10)}｜20日 ${formatBoardMoney(
                s.main20
              )}`,
              s.volumeNote && `量能：${s.volumeNote}`,
              s.rsiPattern && `RSI：${s.rsiPattern}`,
              s.error && `未就绪：${s.error}`,
            ]
              .filter(Boolean)
              .join('\n');
            const hist = scoreSeries[s.code] || {};
            return (
              <Row key={`${s.code}-${index}`} className={styles.row} style={{ backgroundColor: rowBg }}>
                <Col
                  span={3}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onOpenBK(s.secid, s.name)}
                  title={detail || s.name}
                >
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                </Col>
                <Col span={2} title={detail || undefined}>
                  {s.total == null ? (
                    // 数据不足/未就绪：不显示分数，悬停可看原因
                    <span style={{ color: '#faad14' }}>待评分</span>
                  ) : (
                    <>
                      <span style={{ color: scoreColor(s.total), fontWeight: 'bold' }}>{s.total.toFixed(1)}</span>
                      <span style={{ color: scoreColor(s.total), marginLeft: 4, fontWeight: 'bold' }}>{s.grade}</span>
                    </>
                  )}
                </Col>
                <Col span={1} title={[s.trendDesc, s.positionDesc].filter(Boolean).join('｜') || undefined}>
                  {s.trendScore == null ? '--' : s.trendScore.toFixed(0)}
                </Col>
                <Col span={1} title={s.volumeNote || undefined}>
                  {s.volumeScore == null ? '--' : s.volumeScore.toFixed(0)}
                </Col>
                <Col span={1} title={s.moneyNote || undefined}>
                  {s.moneyScore == null ? '--' : s.moneyScore.toFixed(0)}
                </Col>
                <Col span={1} title={s.rsiPattern || undefined}>
                  {s.rsiScore == null ? '--' : s.rsiScore.toFixed(0)}
                </Col>
                {Array.from({ length: BOARD_SCORE_HISTORY_DAYS }).map((_, i) => {
                  const day = scoreDays[i] || '';
                  const h = day ? hist[day] : null;
                  const isLast = !!day && i === scoreDays.length - 1;
                  return (
                    <Col
                      key={`h-${i}`}
                      span={1}
                      style={{ fontSize: 11, textAlign: 'center', fontWeight: isLast ? 'bold' : 'normal' }}
                      title={h ? `${day} 评分 ${h.total?.toFixed(1) ?? '--'} ${h.grade || ''}｜${h.summary || ''}` : day}
                    >
                      {h && h.total != null ? (
                        <span style={{ color: scoreColor(h.total) }}>{h.total.toFixed(0)}</span>
                      ) : (
                        <span style={{ color: '#999' }}>-</span>
                      )}
                    </Col>
                  );
                })}
              </Row>
            );
          })
        )}
        {/* ...分页按钮... */}
        </div>
      </div>
    </>
  );
};

export default BKList;