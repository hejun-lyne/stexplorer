import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Row, Tabs } from 'antd';
import * as Helpers from '@/helpers';
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
  onOpenStock: (secid: string, name: string, change?: number) => void;
  onOpenUrl: (url: string) => void;
}

const BKDetail: React.FC<BKDetailProps> = ({ secid, active, onChangeUpdate, onOpenStock, onOpenUrl }) => {
  const config = useSelector((store: StoreState) => store.stock.stockConfigsMapping[secid]);
  const [detail, setDetail] = useState<Stock.DetailItem>({ secid });

  const { run: runGetDetail } = useRequest(Services.Stock.GetDetailFromEastmoney, {
    throwOnError: true,
    manual: true,
    onSuccess: (d) => {
      if (d && d.secid) {
        setDetail(d);
      }
    },
    cacheKey: `GetDetailFromEastmoney/${secid}`,
  });
  useEffect(() => {
    if (!detail || !detail.zx) {
      runGetDetail(secid);
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
                <Tabs defaultActiveKey={'review'} style={{ height: '100%', width: '100%' }}>
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
