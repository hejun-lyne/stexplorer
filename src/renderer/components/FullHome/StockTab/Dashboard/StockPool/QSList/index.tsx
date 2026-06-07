import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Row, Col, DatePicker, Select, Button, InputNumber, Checkbox, message } from 'antd';
import styles from '../index.scss';
import * as Utils from '@/utils';
import * as Helpers from '@/helpers';
import { Stock } from '@/types/stock';
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
      setStocks(filteredStocks || []);
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
                    {s.name}
                  </Col>
                  <Col span={2}>{s.hybk}</Col>
                  <Col span={2} className={Utils.GetValueColor(s.zdf).textClass}>
                    {(s.zx / 1000).toFixed(2)}
                  </Col>
                  <Col span={2}>{(s.ltsz / 100000000).toFixed(2) + '亿'}</Col>
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
                    {(s.reason === 1 || s.strongType === 'new_high_60') ? '60日新高' : (s.reason === 2 || s.strongType === 'new_high_60') ? '多次涨停' : '新高且多次涨停'}
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
    </>
  );
};

export default QSList;