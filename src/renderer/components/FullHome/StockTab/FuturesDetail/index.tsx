import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Row, Tabs } from 'antd';
import * as CONST from '@/constants';
import SplitPane from 'react-split-pane';
import RealTime from '../StockDetail/RealTime';
import PriceTrend from '../StockDetail/PriceTrend';
import styles from '../StockDetail/index.scss';
import { useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { Stock } from '@/types/stock';
import { useInterval, useRequest } from 'ahooks';
import * as Services from '@/services';
import { addStockAction, deleteStockAction, updateStockAction, updateStockPriceAction } from '@/actions/stock';
import { StockMarketType } from '@/utils/enums';
import TrainBar from '../StockDetail/TrainBar';
import TrackingNote from '../StockDetail/MustRead/TrackingNote';

export interface FuturesDetailProps {
  secid: string;
  active: boolean;
  onChangeUpdate: (tid: string, change: number) => void;
  onOpenUrl: (url: string) => void;
}

const FuturesDetail: React.FC<FuturesDetailProps> = ({ secid, active, onChangeUpdate, onOpenUrl }) => {
  const config = useSelector((store: StoreState) => store.stock.stockConfigsMapping[secid]);
  const { ontrain } = useSelector((state: StoreState) => state.setting.systemSetting);
  const [detail, setDetails] = useState<Stock.DetailItem>({ secid });

  const { run: runGetDetail } = useRequest(Services.Stock.GetFutureDetailFromSina, {
    throwOnError: true,
    manual: true,
    onSuccess: (d) => {
      if (d) {
        setDetails(d);
        dispatch(updateStockPriceAction(secid, d.zx));
      }
    },
    cacheKey: `GetDetailFromEastmoney/${secid}`,
  });
  useInterval(
    async () => {
      runGetDetail(secid);
    },
    CONST.DEFAULT.STOCK_TREND_DELAY
  );

  useEffect(() => {
    if (!detail.zx || !detail.name) {
      runGetDetail(secid);
    }
  }, [secid, config, detail]);

  const dispatch = useDispatch();
  const addStock = useCallback(() => {
    if (detail) {
      dispatch(addStockAction(detail, StockMarketType.Future));
    }
  }, [secid, detail]);
  const removeStock = useCallback(() => {
    if (config) {
      dispatch(deleteStockAction(secid));
    }
  }, [secid]);

  const contentRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState<number>(0);
  const [chartHeight, setChartHeight] = useState<number>(0);
  const rightRef = useRef<HTMLDivElement>(null);

  const [timelineDate, setTimelineDate] = useState<string | undefined>();
  const [initWidth, setInitWidth] = useState(500);
  if (initWidth == 500 && rightRef.current) {
    setInitWidth(rightRef.current.offsetWidth);
  }
  const [noteChanged, setNoteChanged] = useState(false);
  return (
    // 训练条会换行、高度自适应：外层纵向 flex，内容区撑满剩余高度（不再按固定条高算高度）
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: '0 0 auto' }}>
        <TrainBar secid={secid} removeStock={removeStock} addStock={addStock} />
      </div>
      <Row
        className={styles.container}
        ref={contentRef}
        style={{ flex: '1 1 auto', minHeight: 0, height: 'auto' }}
      >
        {detail && (
          <SplitPane
            split="vertical"
            minSize={260}
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
              <RealTime stock={detail} />
            </div>
            <div className={styles.right} ref={rightRef}>
              <SplitPane
                split="horizontal"
                primary="second"
                minSize={220}
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
                  zs={detail.zs}
                  useZizai={true}
                  trainMode={ontrain}
                  onTimelineDate={timelineDate}
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
                  <Tabs.TabPane
                    tab={
                      <>
                        <span style={{ padding: '0 20px' }}>跟踪笔记</span>
                        {noteChanged && <Badge status="warning" offset={[0, 0]} />}
                      </>
                    }
                    key={'matches'}
                  >
                    <TrackingNote secid={secid} active={active} onNoteUpdated={setNoteChanged} />
                  </Tabs.TabPane>
                  <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>最新资讯</span>} key={'news'}>
                    {/* <StockNews secid={secid} active={active} openUrl={onOpenUrl} /> */}
                  </Tabs.TabPane>
                </Tabs>
              </SplitPane>
            </div>
          </SplitPane>
        )}
      </Row>
    </div>
  );
};

export default FuturesDetail;
