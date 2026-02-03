import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Row, Tabs } from 'antd';
import * as Helpers from '@/helpers';
import SplitPane from 'react-split-pane';
import RealTime from './RealTime';
import BanKuai from './BanKuai';
import PriceTrend from './PriceTrend';
import TradeRecord from './TradeRecord';
import styles from './index.scss';
import { useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { Stock } from '@/types/stock';
import { useRequest } from 'ahooks';
import * as Services from '@/services';
import StockNews from './MustRead/News';
import KeyFinance from './MustRead/KeyFinance';
import CoreTheme from './MustRead/CoreTheme';
import CoreTrade from './MustRead/CoreTrade';
import HolderNum from './MustRead/HolderNum';
import BigEvent from './MustRead/BigEvent';
import { addStockAction, deleteStockAction, syncStockStrategyAction } from '@/actions/stock';
import SStrategy from './SStrategy';
import { KLineType, StrategyType } from '@/utils/enums';
import TrainBar from './TrainBar';
import BriefStatics from './MustRead/BriefStatics';
import StockOverview from './MustRead/Overview';
import StockResearches from './MustRead/Researches';
import MatchList from './MustRead/Matches';
import TrackingNote from './MustRead/TrackingNote';
import Similarity from './MustRead/Similarity';
import PeriodMark from './MustRead/PeriodMark';
import Guba from './MustRead/GuBa';
import * as Utils from '@/utils';

export interface StockDetailProps {
  secid: string;
  active: boolean;
  name: string;
  onChangeUpdate: (tid: string, change: number) => void;
  onOpenStock: (secid: string, name: string, change?: number) => void;
  onOpenUrl: (url: string) => void;
}

const StockDetail: React.FC<StockDetailProps> = ({ secid, active, name, onChangeUpdate, onOpenStock, onOpenUrl }) => {
  const config = useSelector((store: StoreState) => store.stock.stockConfigsMapping[secid]);
  const stock = useSelector((store: StoreState) => store.stock.stocksMapping[secid]);
  const [tDetail, setDetails] = useState<Stock.DetailItem>({ secid, code:Helpers.Stock.GetStockCode(secid), name, market:Helpers.Stock.GetStockType(secid) } as Stock.DetailItem);
  const [stype, setSType] = useState<StrategyType>(config ? config.strategy || StrategyType.None : StrategyType.None);
  const [klines, setKLines] = useState<Stock.KLineItem[] | null>(null);

  const { run: runGetDetail } = useRequest(Services.Stock.GetDetailFromEastmoney, {
    throwOnError: true,
    manual: true,
    onSuccess: (d) => (d ? setDetails(d) : undefined),
    cacheKey: `GetDetailFromEastmoney/${secid}`,
  });
  useEffect(() => {
    if (!tDetail.zx || !tDetail.name) {
      runGetDetail(secid);
    }
    if (!config) {
      Helpers.Stock.AppendStockDetailPush(secid, (data) => {
        if (data) {
          let changed = false;
          if (!isNaN(data.zx) && tDetail.zx != data.zx) {
            tDetail.zx = data.zx;
            changed = true;
          }
          if (!isNaN(data.zdf) && tDetail.zx != data.zx) {
            tDetail.zdf = data.zdf;
            changed = true;
          }
          if (!isNaN(data.zdd) && tDetail.zdd != data.zdd) {
            tDetail.zdd = data.zdd;
            changed = true;
          }
          if (!isNaN(data.hsl) && tDetail.hsl != data.hsl) {
            tDetail.hsl = data.hsl;
            changed = true;
          }
          if (!isNaN(data.zss) && tDetail.zss != data.zss) {
            tDetail.zss = data.zss;
            changed = true;
          }
          if (!isNaN(data.np) && tDetail.np != data.np) {
            tDetail.np = data.np;
            changed = true;
          }
          if (!isNaN(data.wp) && tDetail.wp != data.wp) {
            tDetail.wp = data.wp;
            changed = true;
          }
          if (!isNaN(data.jj) && tDetail.jj != data.jj) {
            tDetail.jj = data.jj;
            changed = true;
          }
          if (changed) {
            setDetails({ ...tDetail });
          }
          onChangeUpdate(secid, tDetail.zdf);
        }
      });
      return () => {
        Helpers.Stock.RemoveStockDetailPush(secid);
      };
    }
  }, [secid, config, tDetail]);

  const dispatch = useDispatch();
  const addStock = useCallback(() => {
    dispatch(addStockAction(tDetail, Helpers.Stock.GetStockType(secid)));
  }, [secid, tDetail]);
  const removeStock = useCallback(() => {
    if (config) {
      dispatch(deleteStockAction(secid));
    }
  }, [secid]);
  // const updateSType = useCallback(
  //   (st: StrategyType) => {
  //     setSType(st);
  //     if (config) {
  //       dispatch(syncStockStrategyAction(secid, st));
  //     }
  //   },
  //   [secid, config]
  // );
  const contentRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState<number>(0);
  const [chartHeight, setChartHeight] = useState<number>(0);
  const rightRef = useRef<HTMLDivElement>(null);

  const [trainMode, setTrainMode] = useState(false);
  const [all30Mints, setAll30Mints] = useState([]);
  const [toDate, setToDate] = useState<string | undefined>();
  const updateKlines = useCallback(
    (ks) => {
      setKLines(ks);
      if (ks[0].type == KLineType.Mint30) {
        setAll30Mints(ks);
        setToDate(ks[0].date);
      }
    },
    [trainMode]
  );
  const [timelineDate, setTimelineDate] = useState<string | undefined>();
  const [initWidth, setInitWidth] = useState(500);
  if (initWidth == 500 && rightRef.current) {
    setInitWidth(rightRef.current.offsetWidth);
  }
  const nDetails = stock?.detail || tDetail;
  const [noteChanged, setNoteChanged] = useState<boolean|undefined>(false);
  const [activePeriod, setActivePeriond] = useState<Stock.PeriodMarkItem | null>(null);
  return (
    <>
      <TrainBar
        secid={secid}
        all30Mints={all30Mints}
        onToggleTrainMode={setTrainMode}
        onTrainDateChanged={setToDate}
        removeStock={removeStock}
        addStock={addStock}
      />
      <Row className={styles.container} ref={contentRef}>
        {nDetails && (
          <SplitPane
            split="vertical"
            minSize={180}
            style={{ position: 'inherit' }}
            pane2Style={{
              height: '100%',
            }}
            onChange={(size) => {
              if (contentRef.current) {
                setChartWidth(contentRef.current.offsetWidth - size);
              }
            }}
          >
            <div className={styles.left}>
              <RealTime stock={nDetails} />
              <BanKuai secid={nDetails.secid} active={active} openBankuai={onOpenStock} />
              <TradeRecord showSeats={true} stock={nDetails} active={active} />
            </div>
            <div className={styles.right} ref={rightRef}>
              <SplitPane
                split="horizontal"
                primary="second"
                minSize={360}
                style={{ position: 'inherit' }}
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
                  zs={nDetails.zs}
                  trainMode={trainMode}
                  activePeriod={activePeriod}
                  toDate={trainMode ? toDate : undefined}
                  onTimelineDate={timelineDate}
                  updateKLineData={updateKlines}
                />
                <Tabs defaultActiveKey={'news'} className={styles.rightTab} style={{ width: initWidth }}>
                  {/* <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>交易策略</span>} key={'strategy'}>
                    <SStrategy
                      stype={stype}
                      detail={sDetail || tDetail}
                      trainMode={trainMode}
                      toDate={toDate}
                      onTimelineClicked={setTimelineDate}
                    />
                  </Tabs.TabPane> */}
                  <Tabs.TabPane tab={<>
                    <span style={{ padding: '0 20px' }}>跟踪笔记</span>
                    {noteChanged && <Badge status="warning" offset={[0, 0]} />}
                  </>} key={'matches'}>
                    <TrackingNote secid={secid} active={active} onNoteUpdated={setNoteChanged} />
                  </Tabs.TabPane>
                  {/* <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>区间标记</span>} key={'similar'}>
                    <PeriodMark secid={secid} showPeriod={setActivePeriond} />
                  </Tabs.TabPane> */}
                  <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>股吧评论</span>} key={'guba'}>
                    <Guba secid={secid} active={active} openUrl={onOpenUrl} />
                  </Tabs.TabPane>
                  <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>最新资讯</span>} key={'news'}>
                    <StockNews secid={secid} active={active} openUrl={onOpenUrl} />
                  </Tabs.TabPane>
                  <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>公司概况</span>} key={'overview'}>
                    <StockOverview code={nDetails.code} />
                  </Tabs.TabPane>
                  <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>最新指标</span>} key={'indicators'}>
                    <BriefStatics code={nDetails.code} />
                  </Tabs.TabPane>
                  <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>重大事件</span>} key={'event'}>
                    <BigEvent code={nDetails.code} />
                  </Tabs.TabPane>
                  <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>核心题材</span>} key={'theme'}>
                    <CoreTheme code={nDetails.code} secid={secid} active={active} onOpenStock={onOpenStock} />
                  </Tabs.TabPane>
                  <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>财务数据</span>} key={'finance'}>
                    <KeyFinance code={nDetails.code} />
                  </Tabs.TabPane>
                  <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>交易数据</span>} key={'coretrade'}>
                    <CoreTrade code={nDetails.code} />
                  </Tabs.TabPane>
                  <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>机构研报</span>} key={'researches'}>
                    <StockResearches secid={secid} active={active} openUrl={onOpenUrl} />
                  </Tabs.TabPane>
                  <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>股东变化</span>} key={'holder'}>
                    <HolderNum code={nDetails.code} />
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

export default StockDetail;
