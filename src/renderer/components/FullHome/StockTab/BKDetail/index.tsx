import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Col, Row, Spin, Tabs } from 'antd';
import * as Helpers from '@/helpers';
import * as Utils from '@/utils';
import SplitPane from 'react-split-pane';
import RealTime from '../StockDetail/RealTime';
import PriceTrend from '../StockDetail/PriceTrend';
import styles from './index.scss';
import { batch, useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { Stock } from '@/types/stock';
import { useRequest } from 'ahooks';
import * as Services from '@/services';
import { addStockAction, deleteStockAction, updateMonitors } from '@/actions/stock';
import BKStockMonitor from './BkStocksMonitor';
import BanKuaiStocks from './BanKuaiStocks';
import StockNews from '../StockDetail/MustRead/News';
import MoneyFlowChart from '../StockDetail/MustRead/CoreTrade/MoneyFlowChart';
import { KLineType, MAPeriodType, StockMarketType } from '@/utils/enums';
import AllBankuaisWrapper from './AllBankuais';
import BStrategy from './BStrategy';
import TrainBar from '../StockDetail/TrainBar';
import BKRanking from './BKRanking';
import STRanking from '../StockDetail/STRanking';

export interface BKDetailProps {
  secid: string;
  active: boolean;
  onChangeUpdate: (tid: string, change: number) => void;
  onOpenStock: (secid: string, name: string, firstQSAppear?: string, change?: number) => void;
  onOpenUrl: (url: string) => void;
}

const BKDetail: React.FC<BKDetailProps> = ({ secid, active, onChangeUpdate, onOpenStock, onOpenUrl }) => {
  const config = useSelector((store: StoreState) => store.stock.stockConfigsMapping[secid]);
  const { kLineApiSourceSetting } = useSelector((state: StoreState) => state.setting.systemSetting);
  const [detail, setDetail] = useState<Stock.DetailItem>({ secid });

  const { run: runGetDetail } = useRequest(() => Helpers.Stock.GetStockDetail(kLineApiSourceSetting, secid), {
    throwOnError: true,
    manual: true,
    onSuccess: (d) => (d ? setDetail(d) : undefined),
    cacheKey: `GetStockDetail/${secid}`,
  });
  useEffect(() => {
    if (!detail || !detail.zx) {
      runGetDetail();
    }
    if (!config) {
      Helpers.Stock.AppendStockDetailPush(secid, (data) => {
        if (data) {
          let changed = false;
          if (!isNaN(data.zx) && detail.zx != data.zx) {
            detail.zx = data.zx;
            changed = true;
          }
          if (!isNaN(data.zdf) && detail.zx != data.zx) {
            detail.zdf = data.zdf;
            changed = true;
          }
          if (!isNaN(data.zdd) && detail.zdd != data.zdd) {
            detail.zdd = data.zdd;
            changed = true;
          }
          if (!isNaN(data.hsl) && detail.hsl != data.hsl) {
            detail.hsl = data.hsl;
            changed = true;
          }
          if (!isNaN(data.zss) && detail.zss != data.zss) {
            detail.zss = data.zss;
            changed = true;
          }
          if (!isNaN(data.np) && detail.np != data.np) {
            detail.np = data.np;
            changed = true;
          }
          if (!isNaN(data.wp) && detail.wp != data.wp) {
            detail.wp = data.wp;
            changed = true;
          }
          if (!isNaN(data.jj) && detail.jj != data.jj) {
            detail.jj = data.jj;
            changed = true;
          }
          if (changed) {
            setDetail({ ...detail });
          }
          onChangeUpdate(secid, detail.zdf);
        }
      });
      return () => {
        Helpers.Stock.RemoveStockDetailPush(secid);
      };
    }
  }, [secid, detail]);

  const [monitors, setMonitors] = useState([] as string[]);
  const onBKStocksUpdated = useCallback(
    (stocks: Stock.DetailItem[]) => {
      const ds: string[] = [];
      if (!monitors.length && config && config.monitors && config.monitors.length) {
        config.monitors.forEach((m) => {
          const d = stocks.find((st) => st.secid == m);
          if (d) {
            ds.push(m);
          }
        });
      } else {
        monitors.forEach((mo) => {
          const d = stocks.find((st) => st.secid == mo);
          if (d) {
            ds.push(mo);
          }
        });
      }
      setMonitors(ds);
    },
    [monitors]
  );

  const dispatch = useDispatch();
  const addBK = useCallback(() => {
    if (detail) {
      dispatch(addStockAction(detail, Helpers.Stock.GetStockType(secid), undefined, undefined, monitors));
    }
  }, [secid, detail]);
  const removeBK = useCallback(() => {
    if (config) {
      dispatch(deleteStockAction(secid));
    }
  }, [secid]);

  const [listData, setListData] = useState();
  const addMonitors = useCallback(
    (ss: Record<string, any>[]) => {
      ss.forEach((s) => {
        if (monitors.indexOf(s.secid) == -1) {
          monitors.push(s.secid);
        }
      });
      batch(() => {
        setListData(ss.filter((_) => _.name.indexOf('连板') == -1 && _.name.indexOf('涨停') == -1 && _.name.indexOf('次新') == -1));
        setMonitors([...monitors]);
      });
      dispatch(updateMonitors(secid, monitors));
    },
    [monitors, secid]
  );
  const moveMonitoToTop = useCallback(
    (s: string) => {
      monitors.sort(function (a, b) {
        return a == s ? -1 : b == s ? 1 : 0;
      });
      setMonitors([...monitors]);
      dispatch(updateMonitors(secid, monitors));
    },
    [monitors, secid]
  );
  const removeMonitor = useCallback(
    (s: string) => {
      const ms = monitors.filter((m) => m != s);
      setMonitors(ms);
      dispatch(updateMonitors(secid, ms));
    },
    [monitors, secid]
  );

  const contentRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState<number>(0);
  const [chartHeight, setChartHeight] = useState<number>(0);
  const rightRef = useRef<HTMLDivElement>(null);
  const [ktype, setKtype] = useState(KLineType.Trend);
  const [mtype, setMtype] = useState(MAPeriodType.Short);
  const [range, setRange] = useState({ start: 50, end: 100 });
  const [selectedArea, setSelectedArea] = useState<{ start: string; end: string } | null>(null);
  const isIndex = Helpers.Stock.GetStockType(secid) == StockMarketType.Zindex;

  /** 格式化资金流向金额（元 -> 亿/万） */
  const formatMoneyFlow = (val: number) => {
    const v = Number(val) || 0;
    if (Math.abs(v) >= 1e8) {
      return (v / 1e8).toFixed(2) + '亿';
    }
    if (Math.abs(v) >= 1e4) {
      return (v / 1e4).toFixed(2) + '万';
    }
    return v.toFixed(0) + '元';
  };

  // 资金流向数据
  const [moneyFlow, setMoneyFlow] = useState<any>(null);
  const { run: runGetMoneyFlow, loading: moneyFlowLoading } = useRequest(Services.Tushare.GetMoneyFlowFromTushare, {
    throwOnError: true,
    manual: true,
    onSuccess: setMoneyFlow,
    cacheKey: `GetMoneyFlowFromTushare/${secid}`,
  });

  useEffect(() => {
    runGetMoneyFlow(secid, 60);
  }, [secid]);

  const handleExportMoneyFlow = useCallback(async () => {
    if (!moneyFlow || !moneyFlow.detail_dates || moneyFlow.detail_dates.length === 0) {
      const { dialog } = window.contextModules.electron;
      await dialog.showMessageBox({
        title: '提示',
        type: 'info',
        message: '暂无资金流向数据可导出',
      });
      return;
    }
    try {
      const { dialog } = window.contextModules.electron;
      const defaultPath = `moneyflow_${secid.replace('.', '_')}_${moneyFlow.detail_dates[moneyFlow.detail_dates.length - 1]}.json`;
      const { filePath } = await dialog.showSaveDialog({
        title: '导出资金流向数据',
        defaultPath,
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
      });
      if (!filePath) return;

      const exportData = {
        secid,
        source: moneyFlow.source === 'dc' ? '东方财富' : 'Tushare',
        summary: {
          main_1d: moneyFlow.main_1d,
          main_3d: moneyFlow.main_3d,
          main_5d: moneyFlow.main_5d,
          main_10d: moneyFlow.main_10d,
          main_20d: moneyFlow.main_20d,
          retail_1d: moneyFlow.retail_1d,
          retail_3d: moneyFlow.retail_3d,
          retail_5d: moneyFlow.retail_5d,
          retail_10d: moneyFlow.retail_10d,
          retail_20d: moneyFlow.retail_20d,
          medium_1d: moneyFlow.medium_1d,
          medium_3d: moneyFlow.medium_3d,
          medium_5d: moneyFlow.medium_5d,
          medium_10d: moneyFlow.medium_10d,
          medium_20d: moneyFlow.medium_20d,
        },
        dailyDetails: moneyFlow.detail_dates.map((date: string, i: number) => ({
          date,
          main: moneyFlow.detail_main[i],
          retail: moneyFlow.detail_retail[i],
          medium: moneyFlow.detail_medium[i],
        })),
      };

      const { ipcRenderer } = window.contextModules.electron;
      const content = JSON.stringify(exportData, null, 2);
      await ipcRenderer.invoke('save-string-silently', { filePath, content });

      await dialog.showMessageBox({
        title: '导出成功',
        type: 'info',
        message: `资金流向数据已保存到 ${filePath}`,
      });
    } catch (error) {
      console.error('导出资金流向失败:', error);
      const { dialog } = window.contextModules.electron;
      await dialog.showMessageBox({
        title: '导出失败',
        type: 'error',
        message: '导出资金流向数据时出现错误',
      });
    }
  }, [secid, moneyFlow]);

  const [trainMode, setTrainMode] = useState(false);
  const [all30Mints, setAll30Mints] = useState([]);
  const [toDate, setToDate] = useState<string | undefined>();
  const updateKlines = useCallback(
    (ks) => {
      if (ks[0].type == KLineType.Mint30) {
        setAll30Mints(ks);
        setToDate(ks[0].date);
      }
    },
    [trainMode]
  );
  return (
    <>
      <TrainBar
        secid={secid}
        all30Mints={all30Mints}
        onToggleTrainMode={setTrainMode}
        onTrainDateChanged={setToDate}
        removeStock={removeBK}
        addStock={addBK}
      />
      <Row className={styles.container} ref={contentRef}>
        {detail && (
          <SplitPane
            split="vertical"
            minSize={300}
            style={{ position: 'inherit' }}
            pane2Style={{
              width: chartWidth,
            }}
            onChange={(size) => {
              if (contentRef.current) {
                setChartWidth(contentRef.current.offsetWidth - size);
              }
            }}
          >
            <div className={styles.left}>
              {detail && <RealTime stock={detail} />}
              {isIndex ? (
                <AllBankuaisWrapper secid={detail.secid} active={active} openStock={onOpenStock} addStockMonitors={addMonitors} />
              ) : (
                <BanKuaiStocks
                  secid={detail.secid}
                  active={active}
                  openStock={onOpenStock}
                  addStockMonitors={addMonitors}
                  onStocksUpdated={onBKStocksUpdated}
                />
              )}
            </div>
            <div className={styles.right} ref={rightRef}>
              <SplitPane
                split="horizontal"
                primary="second"
                minSize={360}
                style={{ position: 'inherit', width: 'calc(100% - 190px)' }}
                pane1Style={{
                  height: chartHeight,
                }}
                onChange={(size) => {
                  if (rightRef.current) {
                    setChartHeight(rightRef.current.offsetHeight - size);
                  }
                }}
              >
                <PriceTrend
                  secid={secid}
                  active={active}
                  zs={detail.zs}
                  addStock={addBK}
                  removeStock={removeBK}
                  updateKLineData={updateKlines}
                  updateKType={setKtype}
                  updateMType={setMtype}
                  onRangeUpdated={setRange}
                  onSelectedAreaUpdated={setSelectedArea}
                  toDate={trainMode ? toDate : undefined}
                />
                <Tabs defaultActiveKey={'review'} className={styles.rightTab} style={{ width: '100%' }}>
                  <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>复盘策略</span>} key={'review'}>
                    <BStrategy secid={secid} zx={detail.zx} />
                  </Tabs.TabPane>
                  <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>竞赛排名</span>} key={'ranking'}>
                    {isIndex ? (
                      <BKRanking bks={listData} active={active} openStock={onOpenStock} />
                    ) : (
                      <STRanking details={listData} active={active} openStock={onOpenStock} />
                    )}
                  </Tabs.TabPane>
                  <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>{isIndex ? '寻找主线' : '板块寻龙'}</span>} key={'monitor'}>
                    <BKStockMonitor
                      secids={monitors}
                      active={active}
                      ktype={ktype}
                      mtype={mtype}
                      moveTop={moveMonitoToTop}
                      remove={removeMonitor}
                      openStock={onOpenStock}
                      range={range}
                      area={selectedArea}
                    />
                  </Tabs.TabPane>
                  <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>行情信息</span>} key={'detail'}>
                    <StockNews secid={secid} active={active} openUrl={onOpenUrl} />
                  </Tabs.TabPane>
                  <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>资金流向</span>} key={'moneyflow'}>
                    <div style={{ height: '100%', overflowY: 'auto', padding: 10, backgroundColor: 'var(--background-color)' }}>
                      {moneyFlowLoading ? (
                        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                      ) : moneyFlow ? (
                        <div style={{ lineHeight: 1.8 }}>
                          {/* 主力资金流向汇总 */}
                          <Row style={{ marginBottom: 8, color: 'var(--secondary-text-color)' }}>
                            <Col span={6}>周期</Col>
                            <Col span={6}>主力</Col>
                            <Col span={6}>中户</Col>
                            <Col span={6}>散户</Col>
                          </Row>
                          {[
                            { label: '今日', main: moneyFlow.main_1d, medium: moneyFlow.medium_1d, retail: moneyFlow.retail_1d },
                            { label: '3日', main: moneyFlow.main_3d, medium: moneyFlow.medium_3d, retail: moneyFlow.retail_3d },
                            { label: '5日', main: moneyFlow.main_5d, medium: moneyFlow.medium_5d, retail: moneyFlow.retail_5d },
                            { label: '10日', main: moneyFlow.main_10d, medium: moneyFlow.medium_10d, retail: moneyFlow.retail_10d },
                            { label: '20日', main: moneyFlow.main_20d, medium: moneyFlow.medium_20d, retail: moneyFlow.retail_20d },
                          ].map((item) => (
                            <Row key={item.label} style={{ marginBottom: 6 }}>
                              <Col span={6}>{item.label}</Col>
                              <Col span={6} className={Utils.GetValueColor(item.main).textClass}>
                                {formatMoneyFlow(item.main)}
                              </Col>
                              <Col span={6} className={Utils.GetValueColor(item.medium).textClass}>
                                {formatMoneyFlow(item.medium)}
                              </Col>
                              <Col span={6} className={Utils.GetValueColor(item.retail).textClass}>
                                {formatMoneyFlow(item.retail)}
                              </Col>
                            </Row>
                          ))}

                          {/* 最新一日详细分档 */}
                          <div style={{ marginTop: 16 }}>
                            <Row style={{ marginBottom: 8, color: 'var(--secondary-text-color)' }}>
                              <Col span={24}>最新交易日资金分档明细</Col>
                            </Row>
                            <Row style={{ marginBottom: 4 }}>
                              <Col span={8}>小单(散户)</Col>
                              <Col span={16} className={Utils.GetValueColor(moneyFlow.small_in).textClass}>
                                {formatMoneyFlow(moneyFlow.small_in)}
                              </Col>
                            </Row>
                            <Row style={{ marginBottom: 4 }}>
                              <Col span={8}>中单</Col>
                              <Col span={16} className={Utils.GetValueColor(moneyFlow.medium_in).textClass}>
                                {formatMoneyFlow(moneyFlow.medium_in)}
                              </Col>
                            </Row>
                            <Row style={{ marginBottom: 4 }}>
                              <Col span={8}>大单</Col>
                              <Col span={16} className={Utils.GetValueColor(moneyFlow.big_in).textClass}>
                                {formatMoneyFlow(moneyFlow.big_in)}
                              </Col>
                            </Row>
                            <Row style={{ marginBottom: 4 }}>
                              <Col span={8}>超大单</Col>
                              <Col span={16} className={Utils.GetValueColor(moneyFlow.super_big_in).textClass}>
                                {formatMoneyFlow(moneyFlow.super_big_in)}
                              </Col>
                            </Row>
                            {moneyFlow.main_rate !== undefined && moneyFlow.main_rate !== null && (
                              <Row style={{ marginBottom: 4 }}>
                                <Col span={8}>主力净流入占比</Col>
                                <Col span={16} className={Utils.GetValueColor(moneyFlow.main_rate).textClass}>
                                  {moneyFlow.main_rate.toFixed(2)}%
                                </Col>
                              </Row>
                            )}
                          </div>

                          {/* 每日主力/散户走势 */}
                          {moneyFlow.detail_dates && moneyFlow.detail_dates.length > 0 && (
                            <div style={{ marginTop: 16 }}>
                              <Row style={{ marginBottom: 8, color: 'var(--secondary-text-color)' }} align="middle">
                                <Col flex="auto">近60日逐日资金流向</Col>
                                <Col>
                                  <Button size="small" onClick={handleExportMoneyFlow}>导出JSON</Button>
                                </Col>
                              </Row>
                              <Row style={{ marginBottom: 4, color: 'var(--secondary-text-color)' }}>
                                <Col span={6}>日期</Col>
                                <Col span={6}>主力</Col>
                                <Col span={6}>中户</Col>
                                <Col span={6}>散户</Col>
                              </Row>
                              {[...moneyFlow.detail_dates].reverse().map((date: string, i: number) => {
                                const origIndex = moneyFlow.detail_dates.length - 1 - i;
                                return (
                                  <Row key={date} style={{ marginBottom: 3, fontSize: 12 }}>
                                    <Col span={6}>{date.substring(5)}</Col>
                                    <Col span={6} className={Utils.GetValueColor(moneyFlow.detail_main[origIndex]).textClass}>
                                      {formatMoneyFlow(moneyFlow.detail_main[origIndex])}
                                    </Col>
                                    <Col span={6} className={Utils.GetValueColor(moneyFlow.detail_medium[origIndex]).textClass}>
                                      {formatMoneyFlow(moneyFlow.detail_medium[origIndex])}
                                    </Col>
                                    <Col span={6} className={Utils.GetValueColor(moneyFlow.detail_retail[origIndex]).textClass}>
                                      {formatMoneyFlow(moneyFlow.detail_retail[origIndex])}
                                    </Col>
                                  </Row>
                                );
                              })}
                            </div>
                          )}

                          {/* 数据来源 */}
                          {moneyFlow.source && (
                            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--secondary-text-color)', textAlign: 'right' }}>
                              数据来源：{moneyFlow.source === 'dc' ? '东方财富' : 'Tushare'}
                            </div>
                          )}

                          {/* 资金流向曲线图 */}
                          {moneyFlow.detail_dates && moneyFlow.detail_dates.length > 0 && (
                            <MoneyFlowChart
                              detailMain={moneyFlow.detail_main}
                              detailRetail={moneyFlow.detail_retail}
                              detailMedium={moneyFlow.detail_medium}
                              detailDates={moneyFlow.detail_dates}
                            />
                          )}
                        </div>
                      ) : (
                        <div style={{ textAlign: 'center', padding: 40, color: 'var(--secondary-text-color)' }}>
                          暂无资金流向数据
                        </div>
                      )}
                    </div>
                  </Tabs.TabPane>
                </Tabs>
              </SplitPane>
            </div>
          </SplitPane>
        )}
      </Row>
    </>
  );
};

export default BKDetail;
