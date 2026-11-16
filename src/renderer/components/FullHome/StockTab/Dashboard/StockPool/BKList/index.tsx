import React, { useEffect, useMemo } from 'react';
import { Button, Row, Col, Tooltip, Select, InputNumber, Checkbox, Input } from 'antd';
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
import { CaretDownOutlined, CaretRightOutlined, CaretUpOutlined, FilterOutlined } from '@ant-design/icons';
import classNames from 'classnames';
import dayjs from 'dayjs';
import { isThemeBoard } from '@/helpers/boardFilter';
import BoardChartPanel from './BoardChartPanel';
import { ResizableSidePanel } from '../ResizablePanel';
import {
  BoardStrengthRow,
  computeBoardDailyStrength,
  strengthColor,
  strengthTooltip,
} from '@/helpers/boardDailyStrength';

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
  /** 概念板块「只看题材」：只保留行业/产业/技术题材，剔除风格/指数/持仓/事件/地域等伪概念（规则见 helpers/boardFilter） */
  const [onlyTheme, setOnlyTheme] = useState(false);
  /** 成份股数量阈值过滤：板块太大/太杂时用它收敛观察范围 */
  const [stockCountFilterEnabled, setStockCountFilterEnabled] = useState(false);
  const [stockCountOperator, setStockCountOperator] = useState<'gte' | 'lte'>('gte');
  const [stockCountThreshold, setStockCountThreshold] = useState(30);
  /** 交易模式右侧图表面板：选中的板块 secid（空 = 自动取结果列表第一行） */
  const [panelSecid, setPanelSecid] = useState('');
  const [panelClosed, setPanelClosed] = useState(false);
  /** 展开信号：面板已挂载时，重复进入交易模式 / 点结果行会自动展开收起的面板 */
  const [panelExpandSeq, setPanelExpandSeq] = useState(0);
  const [sortTypes, setSortTypes] = useState<Record<string, number>>({});
  const [currentPage, setCurrentPage] = useState(1);
  /** 当前展示的数据（板块列表 / 行业筛选结果 / 板块日K强势度评分结果 共用，按 displayMode 区分行结构） */
  const [showList, setShowList] = useState<any[]>([]);
  const [dataSource, setDataSource] = useState<'dc' | 'ths'>('dc');
  const [industryFilterLoading, setIndustryFilterLoading] = useState(false);
  const [industryAllData, setIndustryAllData] = useState<any[]>([]);
  const [industryDisplayCount, setIndustryDisplayCount] = useState(0);
  const [industryProgress, setIndustryProgress] = useState(0);
  const [displayMode, setDisplayMode] = useState<'boards' | 'industries' | 'boardScore'>('boards');
  const isIndustryPausedRef = React.useRef(false);
  const industryIndexRef = React.useRef(0);
  // ========== 板块日K强势度评分 ==========
  const [scoreLoading, setScoreLoading] = useState(false);
  /** 评分窗口：基准日往前 N 个交易日（与 Python 侧一致，限定 5~60，默认 20） */
  const [scoreWindowDays, setScoreWindowDays] = useState(20);
  const [strengthData, setStrengthData] = useState<BoardStrengthRow[]>([]);
  /** 评分批次号：切换板块类型/数据源时递增，旧批次的结果直接丢弃 */
  const scoreRunRef = React.useRef(0);
  /** 最近一次的板块评分函数（训练日切换时自动刷新用） */
  const boardScoreRefreshRef = React.useRef<() => void>();
  const scoreLoadingRef = React.useRef(false);
  const PAGE_SIZE = 50;
  const { kLineApiSourceSetting } = useSelector((state: StoreState) => state.setting.systemSetting);
  const { ontrain, trainDate } = useSelector((state: StoreState) => state.setting.systemSetting);

  /** 当前板块列表里有多少个板块带了成份股数字（数据源不支持时全部为 0） */
  const stockCountAvailable = useMemo(
    () => bankuais.filter((b) => (Number(b.stockCount) || 0) > 0).length,
    [bankuais]
  );
  /**
   * 成份股数量阈值过滤
   *
   * 数据源没给出成份股数字时（如 Akshare 源 / 旧缓存）整个过滤自动失效，避免把列表清空；
   * 单个板块缺数字时按「不满足阈值」处理，只在过滤开启时生效。
   */
  const passStockCount = useCallback(
    (b: Stock.BanKuaiItem) => {
      if (!stockCountFilterEnabled || !stockCountAvailable) return true;
      const n = Number(b.stockCount) || 0;
      if (n <= 0) return false;
      return stockCountOperator === 'gte' ? n >= stockCountThreshold : n <= stockCountThreshold;
    },
    [stockCountFilterEnabled, stockCountAvailable, stockCountOperator, stockCountThreshold]
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

  /** 结果列表表头的排序按钮（三态：升序 / 降序 / 取消） */
  const renderSortBtn = (key: string) => (
    <Button
      size="small"
      type="text"
      icon={
        sortTypes[key] == 1 ? <CaretUpOutlined /> : sortTypes[key] == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />
      }
      className={styles.sortbtn}
      onClick={() => updateSortType(key)}
    />
  );

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
      // 板块日K强势度评分：只保留名称 / 只看题材过滤；默认按绝对冷热倒序，无分数行沉底
      let list = strengthData.filter((s) => {
        if (nameFilter && !String(s.name || '').includes(nameFilter)) return false;
        if (onlyTheme && type === BKType.Gainian && !isThemeBoard(s.name)) return false;
        return true;
      });
      const keys = Object.keys(sortTypes);
      const key = keys.length === 1 ? keys[0] : '';
      const t = key ? sortTypes[key] : 2;
      if (t !== 0) {
        list = [...list].sort((a: any, b: any) => {
          const rawKey = key || 'scoreAbs';
          const av = Number(a[rawKey]);
          const bv = Number(b[rawKey]);
          const aOk = !a.error && Number.isFinite(av);
          const bOk = !b.error && Number.isFinite(bv);
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
      // 只看题材（仅概念板块 Tab 生效，切到行业 Tab 时不参与过滤）
      if (onlyTheme && type === BKType.Gainian && !isThemeBoard(b.name)) return false;
      if (!passStockCount(b)) return false;
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
  }, [bankuais, sortTypes, nameFilter, onlyTheme, type, filterMA20, filterMA40, filterMA60, filterRSI, maResults, rsiResults, displayMode, industryAllData, industryDisplayCount, strengthData, passStockCount]);

  /**
   * 交易模式右侧图表面板的板块：点行切换，未点过时默认取结果列表第一行（进入交易模式即出图）。
   * 板块不可执行交易，面板里只有分时与K线，不含下单/持仓/自选等控件。
   */
  const panelRow = useMemo<BoardStrengthRow | null>(() => {
    if (displayMode !== 'boardScore' || panelClosed) return null;
    if (!showList.length) return null;
    return (showList.find((row: any) => String(row.secid || '') === panelSecid) || showList[0]) as BoardStrengthRow;
  }, [displayMode, showList, panelSecid, panelClosed]);

  /** 首次进入交易模式时锁定第一行，避免结果刷新时右侧面板反复切换板块 */
  useEffect(() => {
    if (displayMode !== 'boardScore' || panelSecid) return;
    const first = showList[0] as BoardStrengthRow | undefined;
    if (first?.secid) setPanelSecid(String(first.secid));
  }, [displayMode, showList, panelSecid]);

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
    // 板块类型/数据源变化：上一轮评分结果已不属于当前列表，直接丢弃
    scoreRunRef.current += 1;
    setStrengthData([]);
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
   * 板块日K强势度评分（v1.1）
   *
   * 一次 IPC 在 Python 侧完成：成份股 qfq 日线 → 等权板块指数 + 广度聚合 → 全A等权基准中性化
   * → S1~S5 与修正项 → 双轨输出 score_alpha / score_abs。
   * 候选池跟随顶部「成份股数量阈值」过滤；窗口交易日数取界面「评分交易日」设置；
   * 训练模式以训练日为 as_of，避免读到训练日之后的行情。
   */
  const handleBoardScore = useCallback(async () => {
    if (scoreLoadingRef.current || scoreLoading || !bankuais.length) {
      return;
    }
    const items = bankuais
      .filter(passStockCount)
      .map((b) => ({ secid: b.secid, code: b.code, name: b.name }));
    if (!items.length) {
      return;
    }
    const run = scoreRunRef.current;
    scoreLoadingRef.current = true;
    setScoreLoading(true);
    setDisplayMode('boardScore');
    // displayMode 立即生效，但 showList 由 effect 异步重算：同步清空，
    // 否则这一帧会把上一视图的板块列表行当成评分行渲染（scoreAlpha.toFixed 抛错）
    setStrengthData([]);
    setShowList([]);
    // 进入交易模式即显示右侧图表面板（默认选中结果列表第一行）
    setPanelClosed(false);
    setPanelExpandSeq((n) => n + 1);
    // 评分列表的排序键与板块列表不同，进入时清空，默认按绝对冷热倒序
    setSortTypes({});
    setCurrentPage(1);

    try {
      const asOf = ontrain && trainDate ? trainDate : dayjs().format('YYYY-MM-DD');
      console.log(
        `[板块日K强势度] 开始评分：${items.length} 个板块，窗口 ${scoreWindowDays} 日，基准日 ${asOf}`
      );
      const res = await computeBoardDailyStrength(items, { asOf, window: scoreWindowDays });
      if (scoreRunRef.current !== run) {
        return;
      }
      setStrengthData(res.rows);
      if (res.error) {
        console.warn('[板块日K强势度]', res.error);
      }
      console.log(
        `[板块日K强势度] 完成（基准日 ${res.asOf || '-'}，窗口 ${res.window} 日，出分 ${res.scored}/${items.length}）`
      );
    } catch (e) {
      console.error('板块日K强势度评分失败:', e);
    } finally {
      scoreLoadingRef.current = false;
      setScoreLoading(false);
    }
  }, [scoreLoading, bankuais, ontrain, trainDate, passStockCount, scoreWindowDays]);

  // 训练日切换：已经进入评分视图时按新的 as_of 自动刷新
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', flex: 'none' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
          <Input
            size="small"
            placeholder="名字过滤"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            style={{ width: 100, marginRight: 8 }}
          />
          {type === BKType.Gainian && (
            <Checkbox
              checked={onlyTheme}
              onChange={(e) => {
                setOnlyTheme(e.target.checked);
                setCurrentPage(1);
              }}
              style={{ marginRight: 8, color: 'var(--main-text-color)' }}
              title="只保留行业/产业/技术题材（医疗、机器人、航天、电池、半导体、光伏…），剔除小盘股/价值股/高换手/周期股/破净股/次新股/沪深300/沪股通/基金重仓/举牌回购/预盈预增/长三角/国企改革等风格、指数、持仓、事件、地域类伪概念（规则见 helpers/boardFilter.ts：漏网伪概念加到 NON_THEME_PATTERNS，误杀真题材加到 INDUSTRY_THEME_KEYWORDS）"
            >
              只看题材
            </Checkbox>
          )}
          <span
            title="成份股数量阈值：只保留成份股数 ≥ / ≤ 阈值的板块。东财数据源取「上涨+下跌+平盘家数」，同花顺取 company_num；数据源未提供该字段时过滤自动失效。过滤同时作用于交易模式的板块日K强势度评分候选池"
            style={{ marginRight: 8, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
          >
            <Checkbox
              checked={stockCountFilterEnabled}
              disabled={!stockCountAvailable}
              onChange={(e) => {
                setStockCountFilterEnabled(e.target.checked);
                setCurrentPage(1);
              }}
            />
            <span>成份股数</span>
            <Select
              size="small"
              value={stockCountOperator}
              onChange={(v) => {
                setStockCountOperator(v as 'gte' | 'lte');
                setCurrentPage(1);
              }}
              style={{ width: 52 }}
            >
              <Select.Option value="gte">≥</Select.Option>
              <Select.Option value="lte">≤</Select.Option>
            </Select>
            <InputNumber
              size="small"
              min={1}
              max={5000}
              value={stockCountThreshold}
              onChange={(v) => {
                setStockCountThreshold(typeof v === 'number' ? v : 30);
                setCurrentPage(1);
              }}
              style={{ width: 62 }}
            />
            <span>只</span>
            {!stockCountAvailable && <span style={{ fontSize: 10, color: '#faad14' }}>数据源未提供</span>}
            {stockCountFilterEnabled && !!stockCountAvailable && (
              <span style={{ fontSize: 10, color: 'var(--hint-color)' }}>
                {showList.length}/{bankuais.length}
              </span>
            )}
          </span>
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
              <span
                title="板块日K强势度评分窗口：以基准日往前 N 个交易日计算（5~60 日，默认 20 日）；修改后点「交易模式 / 重新评分」生效"
                style={{ marginLeft: 4, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
              >
                <span>评分交易日</span>
                <InputNumber
                  size="small"
                  min={5}
                  max={60}
                  step={1}
                  value={scoreWindowDays}
                  onChange={(v) => setScoreWindowDays(typeof v === 'number' ? Math.min(60, Math.max(5, Math.round(v))) : 20)}
                  disabled={scoreLoading}
                  style={{ width: 62 }}
                />
                <span>天</span>
              </span>
              <Button
                size="small"
                onClick={handleBoardScore}
                loading={scoreLoading}
                style={{ marginLeft: 4 }}
                title={`进入交易模式：以 ${scoreWindowDays} 个交易日为窗口，按当前板块列表计算日K强势度评分（成份股等权指数 + 全A等权中性化 + S1~S5 与修正项），输出超额分 score_alpha（相对市场）与绝对分 score_abs（自身冷热，默认按此排序）；点击结果行可在右侧查看该板块分时与K线`}
              >
                {scoreLoading
                  ? "评分中…"
                  : displayMode === 'boardScore'
                  ? '重新评分'
                  : '交易模式'}
              </Button>
            </>
          )}
          {displayMode !== 'boards' && (
            <Button
              size="small"
              onClick={() => {
                setDisplayMode('boards');
                // 评分/行业结果的排序键不适用于板块列表，返回时清空
                setSortTypes({});
                setCurrentPage(1);
                setPanelClosed(false);
                setPanelSecid('');
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
      {/* 列表与板块图表面板左右平分（可拖动分隔线调整宽度 / 收起，类似 STList 的交易模式）；没有面板时列表占满 */}
      <div style={{ display: 'flex', flex: '1 1 0%', minHeight: 0, overflow: 'hidden' }}>
        <div
          style={{
            flex: panelRow ? '1 1 50%' : '1 1 100%',
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
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
          <Col span={2} title="超额强度 score_alpha：市场中性化后的板块相对强度，跌得比市场少也可能很高；点箭头可按此列排序">
            超额分
            {renderSortBtn('scoreAlpha')}
          </Col>
          <Col span={2} title="绝对冷热 score_abs：不看相对市场的板块自身冷热（默认按此列倒序）。超额分选相对强势，绝对分选自身真涨">
            绝对分
            {renderSortBtn('scoreAbs')}
          </Col>
          <Col span={1} title="按绝对冷热分档：极强 / 强 / 中性偏强 / 中性偏弱 / 弱">评级</Col>
          <Col span={2} title="S1 广度（权重 0.28）：上涨家数占比 / 末5日 / 扩散，全部减去全A等权基准">
            S1 广度
            {renderSortBtn('s1')}
          </Col>
          <Col span={2} title="S2 爆发（权重 0.14）：涨停占比 / 大阳占比 / 3连阳家数，大阳阈值按板块自身 1.5σ 自适应">
            S2 爆发
            {renderSortBtn('s2')}
          </Col>
          <Col span={2} title="S3 跳空（权重 0.10）：净高开广度 + 未补缺口占比">
            S3 跳空
            {renderSortBtn('s3')}
          </Col>
          <Col span={2} title="S4 趋势（权重 0.30）：超额趋势 × R² 调节 + 加速度 + 路径效率">
            S4 趋势
            {renderSortBtn('s4')}
          </Col>
          <Col span={2} title="S5 结构（权重 0.18）：一致性 / 离散度 / 集中度，区分普涨与少数龙头拉动">
            S5 结构
            {renderSortBtn('s5')}
          </Col>
          <Col span={2} title="修正项：位置透支 / 末端拉升 / 路径低效 / 广度背离 / 波动放大 / 高位回落">
            扣分·标记
            {renderSortBtn('penalty')}
          </Col>
          <Col span={2} title="窗口内板块指数累计涨幅 / 相对全A等权基准的超额收益">
            涨幅·超额
            {renderSortBtn('cumRet')}
          </Col>
          <Col span={2} title="参与评分的成份股数量（min_members=15）；# 为超额分排名 / 绝对分排名">
            成份·排名
            {renderSortBtn('members')}
          </Col>
        </Row>
      )}
      <div
        className={styles.table}
        style={panelRow ? { height: 'auto', flex: '1 1 0%', minHeight: 0 } : undefined}
      >
        <div className={styles.table} style={panelRow ? { height: '100%' } : undefined}>
        {displayMode === 'boards' ? (
          pageData.map((b, index) => (
            <Row key={`${b.code}-${index}`} className={styles.row}>
              <Col
                span={4}
                style={{ cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                title={`${b.name}｜成份股 ${b.stockCount || '--'} 只`}
                onClick={() => onOpenBKStocks(type, b.secid)}
              >
                {b.name}
                {!!b.stockCount && (
                  <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--hint-color)' }}>{b.stockCount}</span>
                )}
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
          pageData.map((s: BoardStrengthRow, index: number) => {
            // 非评分行 / 字段缺失的行统一按「无分」渲染，任何数值列都不会 toFixed 抛错
            const invalid = !!s.error || typeof s.scoreAlpha !== 'number' || !Number.isFinite(s.scoreAlpha);
            const toNum = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
            const detail = strengthTooltip(s);
            const pctText = (v: number) => `${(toNum(v) * 100).toFixed(2)}%`;
            const dash = <span style={{ color: 'var(--reverse-text-color)' }}>--</span>;
            const val = (v: number) => (invalid ? dash : toNum(v).toFixed(1));
            return (
              <Row key={`${s.code}-${index}`} className={styles.row}>
                <Col
                  span={3}
                  style={{ cursor: 'pointer', backgroundColor: panelRow?.secid === s.secid ? 'rgba(24, 144, 255, 0.12)' : undefined }}
                  onClick={() => { setPanelSecid(s.secid); setPanelClosed(false); setPanelExpandSeq((n) => n + 1); }}
                  title={`${detail}
点击在右侧查看该板块的分时与K线`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
                    <span title={s.name} style={{ color: '#1890ff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{s.name}</span>
                    <span title="打开板块详情" onClick={(e) => { e.stopPropagation(); onOpenBK(s.secid, s.name); }} style={{ flex: 'none', color: '#1890ff', fontSize: 11, lineHeight: 1, padding: '0 1px', cursor: 'pointer' }}>↗</span>
                    <span title="查看该板块的股票列表" onClick={(e) => { e.stopPropagation(); onOpenBKStocks(type, s.secid); }} style={{ flex: 'none', color: '#1890ff', fontSize: 13, lineHeight: 1, padding: '0 2px', cursor: 'pointer' }}>›</span>
                  </div>
                  {!!(s.error || s.flags) && (
                    <div title={s.error || s.flags} style={{ fontSize: 10, lineHeight: 1.1, color: s.error ? '#faad14' : 'var(--secondary-text-color)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.error || s.flags}
                    </div>
                  )}
                </Col>
                <Col span={2} title={detail}>
                  {invalid ? dash : <span style={{ color: strengthColor(s.scoreAlpha), fontWeight: 'bold' }}>{toNum(s.scoreAlpha).toFixed(1)}</span>}
                </Col>
                <Col span={2} title={detail}>{invalid ? dash : toNum(s.scoreAbs).toFixed(1)}</Col>
                <Col span={1} title={detail}>{invalid ? dash : s.grade}</Col>
                <Col span={2} title={`上涨广度 ${pctText(s.upShare)}｜超额 ${pctText(s.exUp)}｜末5日 ${pctText(s.upShare5)}｜扩散 ${pctText(s.diffusion)}`}>{val(s.s1)}</Col>
                <Col span={2} title={`涨停占比 ${pctText(s.limitShare)}｜大阳占比 ${pctText(s.bigShare)}｜σ ${pctText(s.sigma)}`}>{val(s.s2)}</Col>
                <Col span={2} title={`净高开 ${pctText(s.gapNet)}（超额 ${pctText(s.exGap)}）｜未补缺口 ${(toNum(s.gapUnfilled) * 100).toFixed(1)}%`}>{val(s.s3)}</Col>
                <Col span={2} title={`趋势收益 ${pctText(s.cumRet)}｜R² ${toNum(s.r2).toFixed(2)}｜路径效率 ${toNum(s.pathEr).toFixed(2)}`}>{val(s.s4)}</Col>
                <Col span={2} title={`一致性 ${toNum(s.consistency).toFixed(4)}｜离散度 ${toNum(s.dispersion).toFixed(4)}｜集中度 ${toNum(s.concentration).toFixed(2)}`}>{val(s.s5)}</Col>
                <Col span={2} title={s.flags || '无修正项'}>{invalid ? dash : toNum(s.penalty).toFixed(0)}</Col>
                <Col span={2} title={`累计涨幅 ${pctText(s.cumRet)}｜超额 ${pctText(s.exTrend)}`}>
                  {invalid ? dash : <span style={{ fontSize: 11 }}><span className={Utils.GetValueColor(toNum(s.cumRet)).textClass}>{pctText(s.cumRet)}</span><span style={{ color: 'var(--secondary-text-color)' }}> / {pctText(s.exTrend)}</span></span>}
                </Col>
                <Col span={2} title={`成份股 ${s.members} 只｜超额分第 ${s.rank}｜绝对分第 ${s.rankAbs}`}>
                  {invalid ? dash : <span style={{ fontSize: 11 }}>{s.members} · #{s.rank}/#{s.rankAbs}</span>}
                </Col>
              </Row>
            );
          })
        )}
        {/* ...分页按钮... */}
        </div>
      </div>
        </div>
        {panelRow && (
          <ResizableSidePanel storageKey="bkBoardChartPanel" expandSignal={panelExpandSeq}>
            <BoardChartPanel
              secid={panelRow.secid}
              name={panelRow.name}
              onClose={() => setPanelClosed(true)}
              fill
            />
          </ResizableSidePanel>
        )}
      </div>
    </div>
  );
};

export default BKList;