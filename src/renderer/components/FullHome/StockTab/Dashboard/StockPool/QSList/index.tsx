import React from 'react';
import { Row, Col, DatePicker, Select, Button, InputNumber, Checkbox, message } from 'antd';
import styles from '../index.scss';
import * as Services from '@/services';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
import * as Helpers from '@/helpers';
import { useState } from 'react';
import { Stock } from '@/types/stock';
import { useRequest, useThrottleFn } from 'ahooks';
import { useCallback } from 'react';
import { useWorkDayTimeToDo } from '@/utils/hooks';
import moment from 'moment';
import classNames from 'classnames';
import { batch } from 'react-redux';
import { SlidersOutlined, UnorderedListOutlined } from '@ant-design/icons';
import CheckableTag from 'antd/lib/tag/CheckableTag';
import STMonitor from '../STMonitor';

export interface QSListProps {
  industries: Stock.BanKuaiItem[];
  onOpenStock: (secid: string, name: string) => void;
  active: boolean;
}

const QSList: React.FC<QSListProps> = ({ industries, onOpenStock, active }) => {
  const [date, setDate] = useState(moment(new Date()).format('YYYYMMDD'));
  const [dates, setDates] = useState([moment(new Date()).format('YYYYMMDD')]);
  const [pageSize, setPageSize] = useState(100);
  const [noMore, setNoMore] = useState(false);
  const [stocks, setStocks] = useState<Stock.QSItem[]>([]);
  const [filterIndustry, setFilterIndustry] = useState<string>('');
  const [hybks, setHybks] = useState<Record<string, number>>({});
  const [sBks, setSBks] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [firstAppearMap, setFirstAppearMap] = useState<Record<string, string>>({});
  const [maFilterSecids, setMaFilterSecids] = useState<string[]>([]);
  const [maFilterLoading, setMaFilterLoading] = useState(false);
  const [maResults, setMaResults] = useState<Record<string, { ma40: boolean; ma60: boolean }>>({});
  const [maPending, setMaPending] = useState<Record<string, boolean>>({});
  const [maThreshold, setMaThreshold] = useState<number>(5);
  const [trendFilterSecids, setTrendFilterSecids] = useState<string[]>([]);
  const [trendFilterLoading, setTrendFilterLoading] = useState(false);
  const [trendResults, setTrendResults] = useState<Record<string, { trendOK: boolean; ma40OK: boolean; isUp: boolean; isFlat: boolean; ma40Deviation: number }>>({});
  const [trendPending, setTrendPending] = useState<Record<string, boolean>>({});
  const [autoBackup, setAutoBackup] = useState(() => Utils.GetStorage('QSList_AUTO_BACKUP', false));
  const autoBackupRef = React.useRef(autoBackup);
  const stocksRef = React.useRef<Stock.QSItem[]>([]);
  const loadedBackupDates = React.useRef(new Set<string>());

  React.useEffect(() => {
    autoBackupRef.current = autoBackup;
    Utils.SetStorage('QSList_AUTO_BACKUP', autoBackup);
  }, [autoBackup]);

  React.useEffect(() => {
    stocksRef.current = stocks;
  }, [stocks]);

  const getTradingDays = useCallback((start: string, end: string) => {
    let count = 0;
    let d = moment(start, 'YYYYMMDD');
    const e = moment(end, 'YYYYMMDD');
    while (d && d.isBefore(e, 'day')) {
      const day = d.day();
      if (day !== 0 && day !== 6) {
        count++;
      }
      d = d.add(1, 'day');
    }
    return count;
  }, []);

  // 自动获取下一个日期的数据
  const fetchNext = useCallback(
    (nextDate: string, nextPageSize: number) => {
      setTimeout(() => {
        runGetStocks(nextPageSize, nextDate);
      }, 200);
    },
    []
  );

  const { run: runGetStocks } = useRequest(Services.Stock.GeQSStocks, {
    throwOnError: true,
    manual: true,
    onSuccess: (data, params) => {
      const currentPageSize = params[0] as number;
      const currentDate = params[1] as string;
      
      if (data.arr) {
        const isComplete = data.to == data.arr.length;
        const dateIdx = dates.indexOf(currentDate);
        
        // 合并数据（去重：同一股票保留最新数据）
        let mergedStocks = data.arr;
        if (stocksRef.current.length > 0) {
          mergedStocks = [...stocksRef.current];
          const secids = mergedStocks.map((s) => s.secid);
          data.arr.forEach((s) => {
            const existIdx = secids.indexOf(s.secid);
            if (existIdx != -1) {
              // 替换为最新数据
              mergedStocks.splice(existIdx, 1, s);
            } else {
              mergedStocks.push(s);
            }
          });
        }
        
        // 重新计算板块统计
        const bks = {} as Record<string, number>;
        mergedStocks.forEach((s) => {
          if (bks[s.hybk]) {
            bks[s.hybk] = bks[s.hybk] + 1;
          } else {
            bks[s.hybk] = 1;
          }
        });
        const nsBks = sBks.filter((s) => Object.keys(bks).indexOf(s) != -1);
        
        // 更新首次出现日期
        setFirstAppearMap((prev) => {
          const next = { ...prev };
          data.arr.forEach((s) => {
            if (!next[s.secid]) {
              next[s.secid] = currentDate;
            }
          });
          return next;
        });

        batch(() => {
          setHybks({ ...bks });
          setSBks(nsBks);
          setStocks(mergedStocks);
        });
        stocksRef.current = mergedStocks;

        // 判断是否继续获取
        if (isComplete) {
          // 自动备份：保存当前日期的完整数据
          if (autoBackupRef.current) {
            Helpers.Storage.StorageHelper.WriteQSListBackup(currentDate, { stocks: data.arr });
          }

          if (dateIdx == dates.length - 1) {
            // 所有日期都已获取完成
            setNoMore(true);
            setLoading(false);
          } else {
            // 当前日期获取完成，继续处理后续日期（检查备份）
            proceedFromIndex(dateIdx + 1);
          }
        } else {
          // 当前日期还有更多数据，增加 pageSize 继续获取
          const nextPageSize = currentPageSize + 20;
          setPageSize(nextPageSize);
          fetchNext(currentDate, nextPageSize);
        }
      }
    },
  });

  // 合并股票数据（去重：同一股票保留最新数据）
  const mergeStocks = useCallback((existing: Stock.QSItem[], incoming: Stock.QSItem[]): Stock.QSItem[] => {
    const result = [...existing];
    const secids = result.map((s) => s.secid);
    incoming.forEach((s) => {
      const existIdx = secids.indexOf(s.secid);
      if (existIdx != -1) {
        result.splice(existIdx, 1, s);
      } else {
        result.push(s);
      }
    });
    return result;
  }, []);

  // 计算板块统计
  const calcHybks = useCallback((stockList: Stock.QSItem[]): Record<string, number> => {
    const bks = {} as Record<string, number>;
    stockList.forEach((s) => {
      if (bks[s.hybk]) {
        bks[s.hybk] = bks[s.hybk] + 1;
      } else {
        bks[s.hybk] = 1;
      }
    });
    return bks;
  }, []);

  // 应用备份数据到当前状态
  const applyBackupData = useCallback((backupStocks: Stock.QSItem[], backupDate: string) => {
    if (loadedBackupDates.current.has(backupDate)) {
      return;
    }
    loadedBackupDates.current.add(backupDate);
    stocksRef.current = mergeStocks(stocksRef.current, backupStocks);
    const bks = calcHybks(stocksRef.current);
    setFirstAppearMap((prev) => {
      const next = { ...prev };
      backupStocks.forEach((s) => {
        if (!next[s.secid]) {
          next[s.secid] = backupDate;
        }
      });
      return next;
    });
    batch(() => {
      setStocks(stocksRef.current);
      setHybks(bks);
    });
  }, [mergeStocks, calcHybks]);

  // 从指定索引开始，加载连续有备份的日期，遇到没有备份的则走网络请求
  const proceedFromIndex = useCallback(async (fromIdx: number) => {
    for (let i = fromIdx; i < dates.length; i++) {
      console.log(`[QSList] proceedFromIndex: 检查日期 ${dates[i]} (${i + 1}/${dates.length})`);
      try {
        const backup = await Helpers.Storage.StorageHelper.ReadQSListBackup(dates[i]);
        console.log(`[QSList] proceedFromIndex: 日期 ${dates[i]} 读取结果`, {
          hasBackup: !!backup,
          hasData: backup && backup.data,
          stocksLength: backup && backup.data ? backup.data.stocks?.length : undefined,
          isAlreadyLoaded: loadedBackupDates.current.has(dates[i]),
        });
        if (backup && backup.data && backup.data.stocks !== undefined) {
          console.log(`[QSList] proceedFromIndex: 日期 ${dates[i]} 从缓存加载 (stocks.length=${backup.data.stocks.length})`);
          applyBackupData(backup.data.stocks as Stock.QSItem[], dates[i]);
        } else {
          console.log(`[QSList] proceedFromIndex: 日期 ${dates[i]} 无缓存，走网络请求`);
          // 遇到没有备份的日期，网络请求
          setDate(dates[i]);
          setPageSize(60);
          setTimeout(() => {
            runGetStocks(60, dates[i]);
          }, 100);
          return;
        }
      } catch (error) {
        console.error(`[QSList] proceedFromIndex: 日期 ${dates[i]} 加载备份失败`, error);
        // 出错时网络请求
        setDate(dates[i]);
        setPageSize(60);
        setTimeout(() => {
          runGetStocks(60, dates[i]);
        }, 100);
        return;
      }
    }
    // 所有日期都处理完了
    console.log('[QSList] proceedFromIndex: 所有日期处理完毕');
    batch(() => {
      setNoMore(true);
      setLoading(false);
    });
  }, [dates, runGetStocks, applyBackupData]);

  const startQuery = useCallback(async () => {
    if (dates.length) {
      stocksRef.current = [];

      batch(() => {
        setNoMore(false);
        setStocks([]);
        setDate(dates[0]);
        setPageSize(60);
        setLoading(true);
        setFirstAppearMap({});
        setMaFilterSecids([]);
        setMaResults({});
        setMaPending({});
        setMaThreshold(5);
        setTrendFilterSecids([]);
        setTrendResults({});
        setTrendPending({});
      });

      // 如果启用了自动备份，逐日尝试从备份加载（只要有缓存就加载，不连续的也加载）
      if (autoBackupRef.current) {
        loadedBackupDates.current.clear();
        console.log('[QSList] startQuery: 开始加载备份，日期列表', dates);

        for (let i = 0; i < dates.length; i++) {
          console.log(`[QSList] startQuery: 检查日期 ${dates[i]} (${i + 1}/${dates.length})`);
          try {
            const backup = await Helpers.Storage.StorageHelper.ReadQSListBackup(dates[i]);
            console.log(`[QSList] startQuery: 日期 ${dates[i]} 读取结果`, {
              hasBackup: !!backup,
              hasData: backup && backup.data,
              stocksLength: backup && backup.data ? backup.data.stocks?.length : undefined,
            });
            if (backup && backup.data && backup.data.stocks !== undefined) {
              console.log(`[QSList] startQuery: 日期 ${dates[i]} 从缓存加载 (stocks.length=${backup.data.stocks.length})`);
              applyBackupData(backup.data.stocks as Stock.QSItem[], dates[i]);
            } else {
              console.log(`[QSList] startQuery: 日期 ${dates[i]} 无缓存`);
            }
          } catch (error) {
            console.error(`[QSList] startQuery: 日期 ${dates[i]} 加载备份失败`, error);
          }
        }

        const loadedCount = loadedBackupDates.current.size;
        console.log('[QSList] startQuery: 备份加载完成', { loadedCount, totalDates: dates.length, loadedDates: Array.from(loadedBackupDates.current) });
        if (loadedCount > 0) {
          if (loadedCount === dates.length) {
            // 所有日期都有备份
            batch(() => {
              setNoMore(true);
              setLoading(false);
            });
            message.success(`已从本地备份加载 ${dates.length} 天数据`);
            return;
          } else {
            // 部分有备份，从第一个没有备份的日期开始处理
            const firstMissingIdx = dates.findIndex((d) => !loadedBackupDates.current.has(d));
            message.success(`已从本地备份加载 ${loadedCount} 天数据，继续获取剩余数据`);
            console.log('[QSList] startQuery: 从第一个无缓存日期继续', { firstMissingIdx, missingDate: dates[firstMissingIdx] });
            proceedFromIndex(firstMissingIdx >= 0 ? firstMissingIdx : loadedCount);
            return;
          }
        }
      }

      // 延迟执行，确保 state 更新完成
      setTimeout(() => {
        runGetStocks(60, dates[0]);
      }, 100);
    }
  }, [dates, runGetStocks, applyBackupData, proceedFromIndex]);

  const onChangeDate = useCallback(
    (d: moment.Moment | null, isStart = true) => {
      if (!d) {
        return;
      }
      const nd = d.format('YYYYMMDD');
      if (dates.length) {
        if (isStart) {
          const ed = dates[dates.length - 1];
          if (nd > ed) {
            setDates([nd]);
            return;
          }
          const newDates = [nd];
          const edm = moment(ed, 'YYYYMMDD');
          let i = 1;
          while (true) {
            const next = d.add(i++, 'days');
            if (next.isBefore(edm)) {
              newDates.push(next.format('YYYYMMDD'));
            } else {
              break;
            }
          }
          setDates(newDates);
        } else {
          const sd = dates[0];
          if (nd < sd) {
            setDates([nd]);
            return;
          }
          const newDates = [sd];
          const sdm = moment(sd, 'YYYYMMDD');
          let i = 1;
          while (true) {
            const next = sdm.add(i++, 'days');
            if (next.isBefore(d)) {
              newDates.push(next.format('YYYYMMDD'));
            } else {
              break;
            }
          }
          newDates.push(nd);
          setDates(newDates);
        }
      } else {
        setDates([nd]);
      }
    },
    [dates]
  );

  const [kview, setKView] = useState(false);
  const toggleBK = useCallback(
    (c, b) => {
      const idx = sBks.indexOf(b);
      if (idx != -1) {
        sBks.splice(idx, 1);
      } else {
        sBks.push(b);
      }
      setSBks([...sBks]);
    },
    [sBks]
  );
  const prevDate = useCallback(() => {
    setDates([moment(dates[0], 'YYYYMMDD').add(-1, 'd').format('YYYYMMDD')]);
  }, [dates]);
  const nextDate = useCallback(() => {
    setDates([moment(dates[0], 'YYYYMMDD').add(1, 'd').format('YYYYMMDD')]);
  }, [dates]);
  const onFilterMA = useCallback(async (checked: boolean) => {
    if (!checked) {
      setMaFilterSecids([]);
      return;
    }
    if (stocks.length === 0) {
      return;
    }
    setMaFilterLoading(true);
    const secids = stocks.map((s) => s.secid);
    const pendingInit: Record<string, boolean> = {};
    secids.forEach((id) => {
      pendingInit[id] = true;
    });
    setMaPending(pendingInit);
    setMaResults({});

    const batchSize = 5;
    const filtered: string[] = [];
    for (let i = 0; i < secids.length; i += batchSize) {
      const batch = secids.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (secid) => {
          const res = await Helpers.Stock.CheckStockMA(secid, maThreshold / 100);
          console.log('MA check', secid, res);
          return { secid, res };
        })
      );
      setMaResults((prev) => {
        const next = { ...prev };
        setMaPending((pPrev) => {
          const pNext = { ...pPrev };
          batchResults.forEach(({ secid, res }) => {
            delete pNext[secid];
            if (res) {
              next[secid] = { ma40: res.ma40, ma60: res.ma60 };
              if (res.ma40 || res.ma60) {
                filtered.push(secid);
              }
            } else {
              next[secid] = { ma40: false, ma60: false };
            }
          });
          return pNext;
        });
        return next;
      });
    }
    setMaFilterSecids(filtered);
    setMaFilterLoading(false);
    setMaPending({});
  }, [stocks]);

  const onFilterTrend = useCallback(async (checked: boolean) => {
    if (!checked) {
      setTrendFilterSecids([]);
      return;
    }
    if (stocks.length === 0) {
      return;
    }
    setTrendFilterLoading(true);
    const secids = stocks.map((s) => s.secid);
    const pendingInit: Record<string, boolean> = {};
    secids.forEach((id) => {
      pendingInit[id] = true;
    });
    setTrendPending(pendingInit);
    setTrendResults({});

    const batchSize = 5;
    const filtered: string[] = [];
    for (let i = 0; i < secids.length; i += batchSize) {
      const batch = secids.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (secid) => {
          const res = await Helpers.Stock.CheckStockRecentTrend(secid, 0.03, 0.02);
          console.log('Trend check', secid, res);
          return { secid, res };
        })
      );
      setTrendResults((prev) => {
        const next = { ...prev };
        setTrendPending((pPrev) => {
          const pNext = { ...pPrev };
          batchResults.forEach(({ secid, res }) => {
            delete pNext[secid];
            if (res) {
              next[secid] = { trendOK: res.trendOK, ma40OK: res.ma40OK, isUp: res.isUp, isFlat: res.isFlat, ma40Deviation: res.ma40Deviation };
              if (res.trendOK && res.ma40OK) {
                filtered.push(secid);
              }
            } else {
              next[secid] = { trendOK: false, ma40OK: false, isUp: false, isFlat: false, ma40Deviation: 0 };
            }
          });
          return pNext;
        });
        return next;
      });
    }
    setTrendFilterSecids(filtered);
    setTrendFilterLoading(false);
    setTrendPending({});
  }, [stocks]);
  
  return (
    <>
      <div className={styles.header}>
        <Select value={filterIndustry} onSelect={setFilterIndustry} style={{ width: 120 }}>
          <Select.Option value="">未选择</Select.Option>
          {industries.map((i) => (
            <Select.Option value={i.name} key={i.code}>
              {i.name}
            </Select.Option>
          ))}
        </Select>
        &nbsp;
        <DatePicker onChange={onChangeDate} value={moment(dates[0], 'YYYYMMDD')} style={{ marginRight: 10 }} />
        <DatePicker
          onChange={(d) => onChangeDate(d, false)}
          value={moment(dates[dates.length - 1], 'YYYYMMDD')}
          style={{ marginRight: 10 }}
        />
        <Button type="primary" onClick={prevDate}>
          前一天
        </Button>
        &nbsp;
        <Button type="primary" onClick={nextDate}>
          后一天
        </Button>
        &nbsp;
        <Button
          icon={kview ? <UnorderedListOutlined /> : <SlidersOutlined />}
          type="text"
          onClick={() => setKView(!kview)}
          className={styles.toggleK}
        />
        <Button type="primary" onClick={startQuery} loading={loading}>
          查询
        </Button>
        &nbsp;
        <CheckableTag
          className="edit-tag"
          checked={maFilterSecids.length > 0}
          onChange={onFilterMA}
          style={{ marginTop: 0 }}
          disabled={maFilterLoading}
        >
          {maFilterLoading ? 'MA筛选中...' : 'MA筛选'}
        </CheckableTag>
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
        <CheckableTag
          className="edit-tag"
          checked={trendFilterSecids.length > 0}
          onChange={onFilterTrend}
          style={{ marginTop: 0, marginLeft: 8 }}
          disabled={trendFilterLoading}
        >
          {trendFilterLoading ? '趋势筛选中...' : '趋势筛选'}
        </CheckableTag>
        <Checkbox
          checked={autoBackup}
          onChange={(e) => setAutoBackup(e.target.checked)}
          style={{ marginLeft: 8 }}
        >
          自动备份
        </Checkbox>
      </div>
      {Object.keys(hybks).length > 1 && (
        <div className={styles.tagbar}>
          {Object.keys(hybks)
            .sort((a, b) => hybks[b] - hybks[a])
            .map((b) => (
              <CheckableTag
                className="edit-tag"
                key={b}
                checked={sBks.indexOf(b) > -1}
                onChange={(c) => toggleBK(c, b)}
                style={{ marginTop: 5 }}
              >
                <span>
                  {b}({hybks[b]})
                </span>
              </CheckableTag>
            ))}
        </div>
      )}
      {kview ? (
        <STMonitor
          details={stocks.filter((s) => (sBks.length == 0 ? true : sBks.indexOf(s.hybk) != -1)) as Stock.DetailItem[]}
          active={active}
          noMore={noMore}
          onLoadMore={() => {}}
          onOpenStock={onOpenStock}
        />
      ) : (
        <>
          <Row className={styles.rowheader}>
            <Col span={2}>名字</Col>
            <Col span={2}>板块</Col>
            <Col span={2}>最新价</Col>
            {/* <Col span={2}>涨跌幅</Col> */}
            <Col span={2}>流通市值</Col>
            {/* <Col span={2}>换手率</Col> */}
            {/* <Col span={2}>量比</Col> */}
            {/* <Col span={2}>是否新高</Col> */}
            {/* <Col span={2}>连板统计</Col> */}
            <Col span={2}>入选天数</Col>
            <Col span={2}>MA40</Col>
            <Col span={2}>MA60</Col>
            <Col span={3}>趋势</Col>
            <Col span={3}>MA40偏</Col>
            <Col span={4}>理由</Col>
          </Row>
          <div className={classNames(styles.table, styles.qsmoreheader)}>
            {stocks
              .filter((s) => (filterIndustry == '' ? true : filterIndustry.indexOf(s.hybk) != -1))
              .filter((s) => (sBks.length == 0 ? true : sBks.indexOf(s.hybk) != -1))
              .filter((s) => (maFilterSecids.length === 0 ? true : maFilterSecids.indexOf(s.secid) !== -1))
              .filter((s) => (trendFilterSecids.length === 0 ? true : trendFilterSecids.indexOf(s.secid) !== -1))
              .map((s) => (
                <Row key={s.code} className={styles.row}>
                  <Col span={2} style={{ cursor: 'pointer' }} onClick={() => onOpenStock(s.secid, s.name)}>
                    {s.name}
                  </Col>
                  <Col span={2}>{s.hybk}</Col>
                  <Col span={2} className={Utils.GetValueColor(s.zdf).textClass}>
                    {(s.zx / 1000).toFixed(2)}
                  </Col>
                  {/* <Col span={2} className={Utils.GetValueColor(s.zdf).textClass}>
                    {s.zdf.toFixed(2) + '%'}
                  </Col> */}
                  <Col span={2}>{(s.ltsz / 100000000).toFixed(2) + '亿'}</Col>
                  {/* <Col span={2}>{(s.hsl / 100).toFixed(2) + '%'}</Col>
                  <Col span={2}>{s.lb.toFixed(2)}</Col>
                  <Col span={2}>{s.nh ? '是' : '否'}</Col>
                  <Col span={2}>{s.zttj.days + '天' + s.zttj.ct + '板'}</Col> */}
                  <Col span={2}>{firstAppearMap[s.secid] ? getTradingDays(firstAppearMap[s.secid], moment().format('YYYYMMDD')) + '天' : '-'}</Col>
                  <Col span={2}>{maPending[s.secid] ? '分析中' : maResults[s.secid] ? (maResults[s.secid].ma40 ? '✓' : '✗') : ''}</Col>
                  <Col span={2}>{maPending[s.secid] ? '分析中' : maResults[s.secid] ? (maResults[s.secid].ma60 ? '✓' : '✗') : ''}</Col>
                  <Col span={3}>{trendPending[s.secid] ? '分析中' : trendResults[s.secid] ? (trendResults[s.secid].trendOK ? '✓' : '✗') : ''}</Col>
                  <Col span={3}>{trendPending[s.secid] ? '分析中' : trendResults[s.secid] ? (trendResults[s.secid].ma40OK ? '✓' : '✗') : ''}</Col>
                  <Col span={4}>{s.reason === 1 ? '60日新高' : s.reason === 2 ? '多次涨停' : '新高且多次涨停'}</Col>
                </Row>
              ))}
            {!noMore && !loading && (
              <div className={styles.loadmore}>
                <span>数据加载中...</span>
              </div>
            )}
            {noMore && (
              <div className={styles.loadmore}>
                <span>已加载全部数据</span>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
};

export default QSList;
