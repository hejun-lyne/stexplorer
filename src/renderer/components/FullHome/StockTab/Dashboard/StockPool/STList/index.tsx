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
import { batch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { CaretDownOutlined, CaretRightOutlined, CaretUpOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

const kFilterOptions = [
  { label: KFilterTypeNames[KFilterType.ZJZT], value: KFilterType.ZJZT },
  { label: KFilterTypeNames[KFilterType.FLYX], value: KFilterType.FLYX },
  { label: KFilterTypeNames[KFilterType.XYJC], value: KFilterType.XYJC },
  { label: KFilterTypeNames[KFilterType.TPHP], value: KFilterType.TPHP },
  { label: KFilterTypeNames[KFilterType.FQFB], value: KFilterType.FQFB },
  { label: KFilterTypeNames[KFilterType.FYZS], value: KFilterType.FYZS },
];

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
  const [sortTypes, setSortTypes] = useState<Record<string, number>>({});

  // 选股流程状态
  const [displayMode, setDisplayMode] = useState<'stocks' | 'leaders' | 'risk' | 'signals' | 'mainIn'>('stocks');

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
  const { kLineApiSourceSetting } = useSelector((state: StoreState) => state.setting.systemSetting);
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
        runFilterStocks(
          data.stocks.map((s) => s.secid),
          ftypes,
          fdays
        );
      }
    },
  });

  const { run: runGetIndustryStocks } = useRequest(GetIndustryStocksFromTushare, {
    throwOnError: true,
    manual: true,
    onSuccess: (data) => {
      setStocks(data.stocks as Stock.DetailItem[]);
      if (ftypes.length > 0) {
        setFiltering(true);
        runFilterStocks(
          data.stocks.map((s: any) => s.secid),
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

      const allData = result.leaders;
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
  }, [leaderLoading, leaderData.length, secid]);

  // ========== 排雷过滤 ==========
  const handleRiskFilter = useCallback(async () => {
    if (riskLoading) {
      isRiskPausedRef.current = true;
      return;
    }
    // 获取当前显示的股票列表的 ts_code
    const currentStocks = displayMode === 'leaders'
      ? leaderData.slice(0, leaderDisplayCount).map((d: any) => d.ts_code)
      : stocks.map((s) => {
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
  }, [riskLoading, riskData.length, displayMode, leaderData, leaderDisplayCount, stocks]);

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
        : stocks.map((s) => {
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
  }, [signalLoading, signalData.length, displayMode, riskData, leaderData, leaderDisplayCount, stocks]);

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
          : stocks.map((s) => {
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
  }, [mainInLoading, mainInData.length, displayMode, signalData, riskData, leaderData, leaderDisplayCount, stocks]);

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

  const updateFtypes = useCallback(
    (ts: any[]) => {
      setFtypes(ts);
      setCurrentPage(1);
      if (ts.length && stocks.length) {
        setFiltering(true);
        runFilterStocks(
          stocks.map((s) => s.secid),
          ts,
          fdays
        );
      }
    },
    [stocks, fdays, runFilterStocks]
  );
  const filterStocks = React.useMemo(
    () => (ftypes.length ? stocks.filter((s) => filterSecids.indexOf(s.secid) != -1) : stocks),
    [ftypes, stocks, filterSecids]
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

    let list = filterStocks.filter((s) => {
      if (nameFilter && !s.name.includes(nameFilter)) return false;
      return true;
    });
    const keys = Object.keys(sortTypes);
    if (keys.length === 1) {
      list = sortItems(list, keys[0], sortTypes[keys[0]]);
    }
    return list;
  }, [filterStocks, sortTypes, nameFilter, sortItems, displayMode, leaderData, leaderDisplayCount, riskData, riskDisplayCount, signalData, signalDisplayCount, mainInData, mainInDisplayCount]);
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
            启动信号
            <Button size="small" type="text" icon={sortTypes.max_5d_return == 1 ? <CaretUpOutlined /> : sortTypes.max_5d_return == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />} className={styles.sortbtn} onClick={() => updateSortType('max_5d_return')} />
          </Col>
          <Col span={2}>买入信号</Col>
          <Col span={3}>卖出信号</Col>
        </Row>
      )}
      <div className={classNames(styles.table, styles.moreheader)}>
        {displayMode === 'stocks' ? (
          showList.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((s) => (
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
          showList.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((s: any) => (
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
          showList.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((s: any) => {
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
          showList.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((s: any) => {
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
                    <span style={{ color: '#999' }}>--</span>
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
        ) : (
          showList.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((s: any) => {
            const hasBuySignal = s.buy_signal !== null;
            const hasSellSignal = s.sell_signal !== null;
            const bgColor = hasSellSignal
              ? 'rgba(255, 77, 79, 0.08)'
              : hasBuySignal
                ? 'rgba(82, 196, 26, 0.08)'
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
                <Col span={2} className={Utils.GetValueColor(s.max_5d_return).textClass}>
                  {s.max_5d_return?.toFixed?.(1) ?? s.max_5d_return}%
                </Col>
                <Col span={2}>
                  {s.buy_signal === 'A' ? (
                    <span className="text-up" style={{ fontWeight: 'bold' }}>最强A</span>
                  ) : s.buy_signal === 'B' ? (
                    <span style={{ color: '#1890ff' }}>稳健B</span>
                  ) : (
                    <span style={{ color: '#999' }}>--</span>
                  )}
                </Col>
                <Col span={3}>
                  {hasSellSignal ? (
                    <span className="text-down" title={s.sell_reason}>回避</span>
                  ) : (
                    <span style={{ color: '#999' }}>--</span>
                  )}
                </Col>
              </Row>
            );
          })
        )}
        <Pagination
          current={currentPage}
          pageSize={pageSize}
          total={showList.length}
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