import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Row, Col, DatePicker, Select, Button, InputNumber, Checkbox, Modal, Tag, Tooltip, message } from 'antd';
import styles from '../index.scss';
import * as Utils from '@/utils';
import * as Helpers from '@/helpers';
import * as Services from '@/services';
import { Stock } from '@/types/stock';
import type { WindVaneResult } from '@/helpers/stock';
import moment from 'moment';
import classNames from 'classnames';
import { SlidersOutlined, UnorderedListOutlined } from '@ant-design/icons';
import CheckableTag from 'antd/lib/tag/CheckableTag';
import STMonitor from '../STMonitor';

export interface QSListProps {
  industries: Stock.BanKuaiItem[];
  onOpenStock: (secid: string, name: string, firstQSAppear?: string) => void;
  active: boolean;
}

const QSList: React.FC<QSListProps> = ({ industries, onOpenStock, active }) => {
  const [dates, setDates] = useState([moment(new Date()).format('YYYYMMDD')]);
  const [stocks, setStocks] = useState<Stock.QSItem[]>([]);
  const [filterIndustry, setFilterIndustry] = useState<string>('');
  const [hybks, setHybks] = useState<Record<string, number>>({});
  const [sBks, setSBks] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [noMore, setNoMore] = useState(false);
  const [firstAppearMap, setFirstAppearMap] = useState<Record<string, string>>({});
  /** 各交易日的「情绪风向标」（重建强势股池时预计算并写进备份），用于列表标记与置顶 */
  const [windVaneMap, setWindVaneMap] = useState<Record<string, WindVaneResult>>({});
  const [techFilterLoading, setTechFilterLoading] = useState(false);
  const [maResults, setMaResults] = useState<
    Record<string, { ma: boolean; macd: boolean; rsi: boolean; maScore?: number; macdScore?: number; rsiScore?: number }>
  >({});
  const [techPending, setTechPending] = useState<Record<string, boolean>>({});
  const [filterMA, setFilterMA] = useState(false);
  const [filterMACD, setFilterMACD] = useState(false);
  const [filterRSI, setFilterRSI] = useState(false);
  const [techProgress, setTechProgress] = useState(0);
  const [fixedStopLossPct, setFixedStopLossPct] = useState(5);
  const [trailingStopLossPct, setTrailingStopLossPct] = useState(5);
  const [autoBackup, setAutoBackup] = useState(() => Utils.GetStorage('QSList_AUTO_BACKUP', false));
  const [kview, setKView] = useState(false);

  const isPausedRef = useRef(false);
  const currentIndexRef = useRef(0);

  // 自动备份持久化
  useEffect(() => {
    Utils.SetStorage('QSList_AUTO_BACKUP', autoBackup);
  }, [autoBackup]);

  // 计算入选天数
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

  /** secid → 该股在所选区间内最近一次成为「情绪风向标」的日期与结果 */
  const vaneBySecid = useMemo(() => {
    const map: Record<string, { date: string; vane: WindVaneResult }> = {};
    Object.keys(windVaneMap)
      .sort()
      .forEach((date) => {
        const v = windVaneMap[date];
        if (v?.secid) {
          // 日期升序遍历，后写入的即最近一次
          map[String(v.secid)] = { date, vane: v };
        }
      });
    return map;
  }, [windVaneMap]);

  /** 区间内最近一天的风向标（页头提示用） */
  const latestVane = useMemo(() => {
    const keys = Object.keys(windVaneMap).sort();
    return keys.length ? windVaneMap[keys[keys.length - 1]] : null;
  }, [windVaneMap]);

  // 核心查询：使用抽离的接口加载数据
  const startQuery = useCallback(async () => {
    if (!dates.length) return;

    // 重置状态
    setLoading(true);
    setNoMore(false);
    setStocks([]);
    setHybks({});
    setFirstAppearMap({});
    setTechProgress(0);
    currentIndexRef.current = 0;
    setMaResults({});
    setTechPending({});
    setWindVaneMap({});
    setFilterMA(false);
    setFilterMACD(false);
    setFilterRSI(false);

    try {
      const result = await Helpers.Stock.LoadQSStocks({
        dates,
        loadAll: true,
        filterRepeat: true,
        autoBackup,
        onDateLoaded: (date, dateStocks, source) => {
          console.log(`[QSList] ${date} 加载完成，来源: ${source}, 数量: ${dateStocks.length}`);
        },
      });

      const filteredStocks = result.stocks['merged']?.filter((s: any) => {
          const code = s.secid?.split('.')[1] || '';
          // 排除科创板 (688/689 开头)
          if (code.startsWith('688') || code.startsWith('689')) return false;
          // 排除北交所 (8/9 开头)
          if (code.startsWith('8') || code.startsWith('9')) return false;
          return true;
        });//.slice(0, 20); // 取前20只，避免数据过多导致后续处理缓慢
      const vaneMap = result.windVaneMap || {};
      setWindVaneMap(vaneMap);
      const list = (filteredStocks || []) as Stock.QSItem[];
      // 情绪风向标置顶：命中的股票排到最前面，组内保持原有顺序
      const vaneSecids = new Set(
        Object.keys(vaneMap)
          .map((dt) => String(vaneMap[dt]?.secid || ''))
          .filter(Boolean)
      );
      list.sort((a, b) => (vaneSecids.has(a.secid) ? 0 : 1) - (vaneSecids.has(b.secid) ? 0 : 1));
      setStocks(list);
      setHybks(result.hybks);
      setFirstAppearMap(result.firstAppearMap);
      setNoMore(true);

      if (result.fromCache.size === result.loadedDates.length) {
        message.success(`已从本地备份加载 ${result.loadedDates.length} 天数据`);
      } else if (result.fromCache.size > 0) {
        message.success(`已从本地备份加载 ${result.fromCache.size} 天数据，剩余从网络获取`);
      }
    } catch (error) {
      console.error('[QSList] 加载失败', error);
      message.error('数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [dates, autoBackup]);

  // 日期选择
  const onChangeDate = useCallback(
    (d: moment.Moment | null, isStart = true) => {
      if (!d) return;
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

  // ===== 强势股池：重建历史（Tushare 精确口径，写库后查询直接命中） =====
  const [rebuildLoading, setRebuildLoading] = useState(false);
  const [rebuildDone, setRebuildDone] = useState(0);
  const [rebuildTotal, setRebuildTotal] = useState(0);
  const [rebuildLast, setRebuildLast] = useState('');
  /** 近 T 日至少几次涨停算「多次涨停」（东财强势股池口径≈2） */
  const [minLimitTimes, setMinLimitTimes] = useState(2);
  const isRebuildPausedRef = useRef(false);
  const rebuildRunningRef = useRef(false);
  /** 重建历史使用的区间：与「查询区间」解耦，默认近 30 天，并记住上次选择 */
  const [rebuildRange, setRebuildRange] = useState<[moment.Moment, moment.Moment]>(() => {
    const saved = Utils.GetStorage<string[]>('QSList_REBUILD_RANGE', []);
    const start = saved?.[0] ? moment(saved[0], 'YYYYMMDD') : moment().subtract(30, 'day');
    const end = saved?.[1] ? moment(saved[1], 'YYYYMMDD') : moment();
    return [start, end];
  });
  /** 弹窗里的草稿区间：点「开始重建」才生效 */
  const [rebuildDraftRange, setRebuildDraftRange] = useState<[moment.Moment | null, moment.Moment | null]>([
    null,
    null,
  ]);
  const [rebuildModalOpen, setRebuildModalOpen] = useState(false);

  /** 把所选日历区间换成交易日列表（交易日历取不到时退回「去掉周末」） */
  const buildRebuildDates = useCallback(async (start: string, end: string) => {
    const days: string[] = [];
    let d = moment(start, 'YYYYMMDD');
    const e = moment(end, 'YYYYMMDD');
    while (d.isSameOrBefore(e, 'day')) {
      days.push(d.format('YYYYMMDD'));
      d = d.add(1, 'day');
    }
    try {
      const norm = (v: any) => String(v || '').replace(/-/g, '').substring(0, 8);
      const years = Array.from(new Set(days.map((x) => x.substring(0, 4))));
      const lists = await Promise.all(years.map((y) => Services.Tushare.GetTradeDatesFromTushare(y)));
      const set = new Set<string>();
      lists.forEach((arr) => (arr || []).forEach((x) => set.add(norm(x))));
      const hit = days.filter((x) => set.has(x));
      if (hit.length) {
        return hit;
      }
    } catch (e) {
      console.warn('[强势股池] 交易日历获取失败，按周末过滤:', e);
    }
    return days.filter((x) => {
      const w = moment(x, 'YYYYMMDD').day();
      return w !== 0 && w !== 6;
    });
  }, []);

  /**
   * 重建「指定区间」的历史强势股池（区间由弹窗单独指定，与查询日期无关）
   *
   * 逐日调用 Tushare 精确重建（60日新高 ∪ up_stat≥N 次涨停）并写入数据库缓存，
   * 之后 QSList 查询、STList 的「强势股」板块、回测都直接命中，不再实时计算。
   */
  const runRebuild = useCallback(
    async (start: string, end: string) => {
      if (!start || !end) {
        message.warning('请选择重建区间');
        return;
      }
      if (start > end) {
        message.warning('重建开始日期不能晚于结束日期');
        return;
      }
      rebuildRunningRef.current = true;
      setRebuildLoading(true);
      const days = await buildRebuildDates(start, end);
      if (!days.length) {
        rebuildRunningRef.current = false;
        setRebuildLoading(false);
        message.warning('所选区间没有交易日');
        return;
      }
      isRebuildPausedRef.current = false;
      setRebuildDone(0);
      setRebuildTotal(days.length);
      setRebuildLast('');
      const failed: string[] = [];
      let fallbackDays = 0;
      try {
        for (let i = 0; i < days.length; i += 1) {
          if (isRebuildPausedRef.current) {
            break;
          }
          const day = days[i];
          // 串行：每日都要拉 60 个交易日的日线（走 daily_all 缓存），并发容易被限流
          // eslint-disable-next-line no-await-in-loop
          const res = await Helpers.Stock.RebuildStrongPoolDay(day, { minLimitTimes });
          if (res.error) {
            failed.push(day);
            console.warn(`[强势股池] ${day} 重建失败：${res.error}`);
          } else if (res.limitSource && res.limitSource !== 'limit_list_d') {
            // 积分不足时退化成了「当日涨停」，口径会偏窄
            fallbackDays += 1;
          }
          setRebuildDone(i + 1);
          setRebuildLast(
            `${day}：${res.count} 只（多次涨停 ${res.multiLimitCount} / 60日新高 ${res.newHighCount}）` +
              (res.windVane?.secid
                ? ` · 风向标 ${res.windVane.name}（${res.windVane.level}）`
                : ' · 无风向标')
          );
        }
      } finally {
        rebuildRunningRef.current = false;
        setRebuildLoading(false);
      }
      if (failed.length) {
        message.warning(
          `重建结束，失败 ${failed.length} 天（${failed.slice(0, 5).join('、')}${failed.length > 5 ? '…' : ''}）`
        );
      } else if (fallbackDays > 0) {
        message.warning(
          `重建完成，但有 ${fallbackDays} 天取不到 limit_list_d（已退化为「当日涨停」口径），请检查 Tushare 积分是否 ≥5000`
        );
      } else {
        message.success(`已重建 ${start} ~ ${end} 的强势股池（含每日情绪风向标），点「查询」查看标记`);
      }
    },
    [minLimitTimes, buildRebuildDates]
  );

  /** 点「重建历史」：运行中则暂停；否则打开弹窗指定区间 */
  const onRebuildHistory = useCallback(() => {
    if (rebuildRunningRef.current) {
      isRebuildPausedRef.current = true;
      return;
    }
    setRebuildDraftRange([rebuildRange[0], rebuildRange[1]]);
    setRebuildModalOpen(true);
  }, [rebuildRange]);

  const prevDate = useCallback(() => {
    setDates([moment(dates[0], 'YYYYMMDD').add(-1, 'd').format('YYYYMMDD')]);
  }, [dates]);

  const nextDate = useCallback(() => {
    setDates([moment(dates[0], 'YYYYMMDD').add(1, 'd').format('YYYYMMDD')]);
  }, [dates]);

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

  // 技术指标计算（逻辑不变）
  const onCalcTechIndicators = useCallback(async () => {
    if (techFilterLoading) {
      isPausedRef.current = true;
      return;
    }
    if (stocks.length === 0) return;
    const secids = stocks.map((s) => s.secid);

    if (currentIndexRef.current === 0 || currentIndexRef.current >= secids.length) {
      setMaResults({});
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

    const batchSize = 10;
    for (let i = currentIndexRef.current; i < secids.length; i += batchSize) {
      const batch = secids.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (secid) => {
          const res = await Helpers.Stock.CheckStockBacktestSignals(
            secid,
            120,
            fixedStopLossPct / 100,
            trailingStopLossPct / 100
          );
          console.log('Backtest signals', secid, res);
          return { secid, res };
        })
      );
      setMaResults((prev) => {
        const next = { ...prev };
        setTechPending((pPrev) => {
          const pNext = { ...pPrev };
          batchResults.forEach(({ secid, res }) => {
            delete pNext[secid];
            if (res) {
              next[secid] = {
                ma: res.ma,
                macd: res.macd,
                rsi: res.rsi,
                maScore: res.maScore,
                macdScore: res.macdScore,
                rsiScore: res.rsiScore,
              };
            } else {
              next[secid] = { ma: false, macd: false, rsi: false };
            }
          });
          return pNext;
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
  }, [stocks, fixedStopLossPct, trailingStopLossPct, techFilterLoading]);

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
        <Button
          size="small"
          onClick={onRebuildHistory}
          loading={rebuildLoading && rebuildDone === 0}
          style={{ marginLeft: 6 }}
          title="弹窗指定一段区间，用 Tushare 精确重建该区间的强势股池（60日新高 ∪ 近 T 日 ≥N 次涨停），写入数据库缓存；之后查询、板块「强势股」、回测都直接命中，不再实时计算。重建中再次点击可暂停（当前这天算完后停止）"
        >
          {rebuildLoading ? `重建 ${rebuildDone}/${rebuildTotal}` : '重建历史'}
        </Button>
        <span style={{ marginLeft: 6 }} title="近 T 日涨停次数阈值：≥N 次算「近期多次涨停」（东财口径约 2 次）">
          涨停≥
        </span>
        <InputNumber
          size="small"
          min={2}
          max={10}
          value={minLimitTimes}
          onChange={(v) => setMinLimitTimes(Number(v) || 2)}
          style={{ width: 52 }}
        />
        <span>次</span>
        {rebuildLast && (
          <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--secondary-text-color)' }}>{rebuildLast}</span>
        )}
        {latestVane && (
          <span
            style={{ marginLeft: 8, fontSize: 12, color: 'var(--secondary-text-color)' }}
            title={
              `情绪闸门：涨停 ${latestVane.gate?.zt ?? '--'} 家 / 炸板 ${
                latestVane.gate?.zb ?? '--'
              } 家（${latestVane.gate ? (latestVane.gate.zbl * 100).toFixed(1) : '--'}%）/ 最高 ${
                latestVane.gate?.height ?? '--'
              } 板` + (latestVane.reason ? ` · ${latestVane.reason}` : '')
            }
          >
            风向标 {latestVane.date}：{latestVane.secid ? `${latestVane.name}（${latestVane.level}）` : '无'}
          </span>
        )}
        <Button
          size="small"
          onClick={onCalcTechIndicators}
          loading={techFilterLoading && techProgress === 0}
        >
          {techFilterLoading ? `分析中 ${techProgress}%` : '技术指标'}
        </Button>
        <InputNumber
          size="small"
          min={1}
          max={20}
          value={fixedStopLossPct}
          onChange={(v) => setFixedStopLossPct(v || 5)}
          formatter={(v) => `止损${v}%`}
          style={{ width: 72, marginLeft: 6 }}
        />
        <InputNumber
          size="small"
          min={1}
          max={20}
          value={trailingStopLossPct}
          onChange={(v) => setTrailingStopLossPct(v || 5)}
          formatter={(v) => `移动${v}%`}
          style={{ width: 72, marginLeft: 2 }}
        />
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
          details={
            stocks.filter((s) => (sBks.length == 0 ? true : sBks.indexOf(s.hybk) != -1)) as Stock.DetailItem[]
          }
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
            <Col span={2}>流通市值</Col>
            <Col span={2}>入选天数</Col>
            <Col span={2}>
              <Checkbox checked={filterMA} onChange={(e) => setFilterMA(e.target.checked)} style={{ color: '#fff' }}>
                MA
              </Checkbox>
            </Col>
            <Col span={2}>
              <Checkbox checked={filterMACD} onChange={(e) => setFilterMACD(e.target.checked)} style={{ color: '#fff' }}>
                MACD
              </Checkbox>
            </Col>
            <Col span={2}>
              <Checkbox checked={filterRSI} onChange={(e) => setFilterRSI(e.target.checked)} style={{ color: '#fff' }}>
                RSI
              </Checkbox>
            </Col>
            <Col span={8}>理由</Col>
          </Row>
          <div className={classNames(styles.table, styles.qsmoreheader)}>
            {stocks
              .filter((s) => (filterIndustry == '' ? true : filterIndustry.indexOf(s.hybk) != -1))
              .filter((s) => (sBks.length == 0 ? true : sBks.indexOf(s.hybk) != -1))
              .filter((s) => {
                if (!filterMA && !filterMACD && !filterRSI) return true;
                if (filterMA && maResults[s.secid] && !maResults[s.secid].ma) return false;
                if (filterMACD && maResults[s.secid] && !maResults[s.secid].macd) return false;
                if (filterRSI && maResults[s.secid] && !maResults[s.secid].rsi) return false;
                return true;
              })
              .map((s) => (
                <Row key={s.code} className={styles.row}>
                  <Col
                    span={2}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onOpenStock(s.secid, s.name, firstAppearMap[s.secid])}
                  >
                    {vaneBySecid[s.secid] && (
                      <Tooltip
                        title={`${vaneBySecid[s.secid].date} 情绪风向标 · ${vaneBySecid[s.secid].vane.level}${
                          typeof vaneBySecid[s.secid].vane.score === 'number'
                            ? ` · 得分 ${vaneBySecid[s.secid].vane.score.toFixed(3)}`
                            : ''
                        }`}
                      >
                        <Tag color="gold" style={{ marginRight: 4, transform: 'scale(0.85)' }}>
                          风向标
                        </Tag>
                      </Tooltip>
                    )}
                    {s.name}
                  </Col>
                  <Col span={2}>{s.hybk}</Col>
                  <Col span={2} className={Utils.GetValueColor(s.zdf).textClass}>
                    {/* 东财池：价格 ×1000、市值单位元；Tushare 重建（带 strongType）：原始价、市值亿元 */}
                    {((s as any).strongType ? s.zx : s.zx / 1000).toFixed(2)}
                  </Col>
                  <Col span={2}>
                    {((s as any).strongType ? s.ltsz : s.ltsz / 100000000).toFixed(2) + '亿'}
                  </Col>
                  <Col span={2}>
                    {firstAppearMap[s.secid]
                      ? getTradingDays(firstAppearMap[s.secid], moment().format('YYYYMMDD')) + '天'
                      : '-'}
                  </Col>
                  <Col span={2}>
                    {techPending[s.secid]
                      ? '分析中'
                      : maResults[s.secid]
                      ? maResults[s.secid].ma
                        ? (
                          <span>
                            ✓
                            {typeof maResults[s.secid].maScore === 'number' ? (
                              <span style={{ fontSize: 10, color: '#52c41a' }}> {maResults[s.secid].maScore!.toFixed(1)}</span>
                            ) : (
                              ''
                            )}
                          </span>
                        )
                        : '✗'
                      : ''}
                  </Col>
                  <Col span={2}>
                    {techPending[s.secid]
                      ? '分析中'
                      : maResults[s.secid]
                      ? maResults[s.secid].macd
                        ? (
                          <span>
                            ✓
                            {typeof maResults[s.secid].macdScore === 'number' ? (
                              <span style={{ fontSize: 10, color: '#52c41a' }}> {maResults[s.secid].macdScore!.toFixed(1)}</span>
                            ) : (
                              ''
                            )}
                          </span>
                        )
                        : '✗'
                      : ''}
                  </Col>
                  <Col span={2}>
                    {techPending[s.secid]
                      ? '分析中'
                      : maResults[s.secid]
                      ? maResults[s.secid].rsi
                        ? (
                          <span>
                            ✓
                            {typeof maResults[s.secid].rsiScore === 'number' ? (
                              <span style={{ fontSize: 10, color: '#52c41a' }}> {maResults[s.secid].rsiScore!.toFixed(1)}</span>
                            ) : (
                              ''
                            )}
                          </span>
                        )
                        : '✗'
                      : ''}
                  </Col>
                  <Col span={8}>
                    {(s.reason === 1 || s.strongType === 'new_high_60') ? '60日新高' : (s.reason === 2 || s.strongType === 'limit_up') ? '多次涨停' : '新高且多次涨停'}
                  </Col>
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
      <Modal
        title="重建历史强势股池"
        open={rebuildModalOpen}
        okText="开始重建"
        cancelText="取消"
        onCancel={() => setRebuildModalOpen(false)}
        onOk={() => {
          const [s, e] = rebuildDraftRange;
          if (!s || !e) {
            message.warning('请选择重建区间');
            return;
          }
          const start = s.format('YYYYMMDD');
          const end = e.format('YYYYMMDD');
          if (start > end) {
            message.warning('重建开始日期不能晚于结束日期');
            return;
          }
          setRebuildModalOpen(false);
          setRebuildRange([s, e]);
          Utils.SetStorage('QSList_REBUILD_RANGE', [start, end]);
          runRebuild(start, end);
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span>重建区间</span>
          <DatePicker.RangePicker
            value={rebuildDraftRange}
            allowClear={false}
            onChange={(v) => setRebuildDraftRange(v && v[0] && v[1] ? [v[0], v[1]] : [null, null])}
          />
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--secondary-text-color)', lineHeight: 1.7 }}>
          逐日调用 Tushare 精确重建（60日新高 ∪ 近 T 日 ≥{minLimitTimes} 次涨停），结果写入数据库缓存，
          区间内交易日越多耗时越长；重建中可再次点击「重建历史」暂停（当前这天算完后停止，已完成的天已落库）。
        </div>
      </Modal>
    </>
  );
};

export default QSList;