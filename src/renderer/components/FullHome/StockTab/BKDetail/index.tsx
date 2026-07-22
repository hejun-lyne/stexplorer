import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Col, Row, Spin, Tabs, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
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

  // 板块资金流向评分模型（基于已加载的资金流向数据，前端计算）
  const boardFlowScore = useMemo(() => {
    if (!moneyFlow || moneyFlow.error || !moneyFlow.detail_main || moneyFlow.detail_main.length === 0) {
      return null;
    }

    const f = (v: any): number => {
      const n = Number(v);
      return isNaN(n) ? 0 : n;
    };

    const main_1d = f(moneyFlow.main_1d);
    const main_3d = f(moneyFlow.main_3d);
    const main_5d = f(moneyFlow.main_5d);
    const main_10d = f(moneyFlow.main_10d);
    const main_20d = f(moneyFlow.main_20d);
    const retail_10d = f(moneyFlow.retail_10d);
    const retail_20d = f(moneyFlow.retail_20d);
    const main_rate = f(moneyFlow.main_rate);
    const total_amount_20d = f(moneyFlow.total_amount_20d);
    const detail_main: number[] = (moneyFlow.detail_main || []).map(f);
    const detail_retail: number[] = (moneyFlow.detail_retail || []).map(f);

    // ============ 维度1: 主力资金强度 (满分30) ============
    let dim1_score = 0;

    // 1a. 主力净流入率得分 (15分)
    if (main_rate >= 10) dim1_score += 15;
    else if (main_rate >= 5) dim1_score += 12;
    else if (main_rate >= 2) dim1_score += 8;
    else if (main_rate >= 1) dim1_score += 4;
    else if (main_rate > 0) dim1_score += 2;

    // 1b. 绝对金额得分 (15分)
    if (main_20d >= 50e8) dim1_score += 15;
    else if (main_20d >= 10e8) dim1_score += 12;
    else if (main_20d >= 5e8) dim1_score += 8;
    else if (main_20d >= 1e8) dim1_score += 5;
    else if (main_20d > 0) dim1_score += 2;

    // ============ 维度2: 主力/散户背离度 (满分25) ============
    let dim2_score = 0;

    // 2a. 20日背离程度 (15分)
    if (main_20d > 0 && retail_20d < 0) {
      const divergence_ratio = Math.abs(retail_20d) / main_20d;
      if (divergence_ratio >= 2) dim2_score += 15;
      else if (divergence_ratio >= 1) dim2_score += 12;
      else if (divergence_ratio >= 0.5) dim2_score += 8;
      else dim2_score += 5;
    } else if (main_20d > 0 && retail_20d > 0) {
      dim2_score += 2;
    }

    // 2b. 背离天数 (10分)
    const dm10 = detail_main.slice(-10);
    const dr10 = detail_retail.slice(-10);
    if (dm10.length > 0 && dr10.length > 0) {
      const divDays = dm10.filter((m, i) => m > 0 && dr10[i] < 0).length;
      if (divDays >= 7) dim2_score += 10;
      else if (divDays >= 5) dim2_score += 7;
      else if (divDays >= 3) dim2_score += 4;
      else if (divDays >= 1) dim2_score += 2;
    }

    // ============ 维度3: 资金趋势持续性 (满分20) ============
    let dim3_score = 0;

    if (main_10d > main_20d * 0.5 && main_10d > 0 && main_20d > 0) {
      dim3_score += 10;
    } else if (main_10d > 0) {
      dim3_score += 5;
    }

    if (main_5d > main_10d * 0.3 && main_5d > 0 && main_10d > 0) {
      dim3_score += 5;
    }

    if (dm10.length > 0) {
      const inflowDays = dm10.filter((m) => m > 0).length;
      if (inflowDays >= 8) dim3_score += 5;
      else if (inflowDays >= 6) dim3_score += 3;
      else if (inflowDays >= 4) dim3_score += 1;
    }

    // ============ 维度4: 流入连续性 (满分15) ============
    let dim4_score = 0;
    let consecutive = 0;
    for (let i = detail_main.length - 1; i >= 0; i--) {
      if (detail_main[i] > 0) consecutive++;
      else break;
    }
    if (consecutive >= 5) dim4_score = 15;
    else if (consecutive >= 3) dim4_score = 10;
    else if (consecutive >= 2) dim4_score = 6;
    else if (consecutive >= 1) dim4_score = 3;

    // ============ 维度5: 短期风险预警 (满分10) ============
    let dim5_score = 10;
    if (main_5d < 0) {
      const outflowRatio = Math.abs(main_5d) / (Math.abs(main_20d) || 1);
      if (outflowRatio > 0.5) dim5_score = 0;
      else if (outflowRatio > 0.3) dim5_score = 3;
      else dim5_score = 6;
    }
    if (main_3d < 0 && main_1d < 0) {
      dim5_score = Math.max(0, dim5_score - 3);
    }

    const totalScore = Math.round((dim1_score + dim2_score + dim3_score + dim4_score + dim5_score) * 10) / 10;
    let grade: string;
    if (totalScore >= 75) grade = 'A';
    else if (totalScore >= 55) grade = 'B';
    else if (totalScore >= 35) grade = 'C';
    else grade = 'D';

    let advice: string;
    if (grade === 'A') advice = '主力资金大幅流入，散户持续流出，资金面极强';
    else if (grade === 'B') advice = '主力资金流入明显，资金面偏多';
    else if (grade === 'C') advice = '主力资金流入一般，资金面中性';
    else advice = '主力资金流出或流入不足，资金面偏弱';

    return {
      score: totalScore,
      grade,
      advice,
      dims: [
        { label: '主力资金强度', score: dim1_score, max: 30, tooltip: '净流入率(15分) + 绝对金额(15分)，按档阶梯打分' },
        { label: '主力/散户背离', score: dim2_score, max: 25, tooltip: '20日背离程度(15分) + 近10日背离天数(10分)，主力买散户卖为背离加分' },
        { label: '资金趋势持续性', score: dim3_score, max: 20, tooltip: '10日趋势vs20日(10分) + 5日加速(5分) + 流入天数占比(5分)' },
        { label: '流入连续性', score: dim4_score, max: 15, tooltip: '最近连续主力净流入天数：≥5天→15分, ≥3天→10分, ≥2天→6分, ≥1天→3分' },
        { label: '短期风险预警', score: dim5_score, max: 10, tooltip: '5日主力流出超过20日的30%→扣分, 3日+1日双负→额外扣分' },
      ],
      main_rate,
      main_20d,
      retail_20d,
      main_10d,
      main_5d,
      total_amount_20d,
    };
  }, [moneyFlow]);

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
                          {/* ============ 板块资金流向评分模型 ============ */}
                          {boardFlowScore && (
                            <div style={{
                              marginBottom: 16, padding: '12px 16px', borderRadius: 8,
                              backgroundColor: 'var(--card-background-color)',
                              border: '1px solid var(--border-color)',
                            }}>
                              <Row className={styles.rowheader} style={{ marginBottom: 12 }}>
                                <Col span={24}>板块资金流向评分模型</Col>
                              </Row>
                              <Row style={{ marginBottom: 8, alignItems: 'center' }}>
                                <Col span={6} style={{ fontSize: 13 }}>综合评分</Col>
                                <Col span={6}>
                                  <span style={{
                                    fontSize: 24, fontWeight: 'bold',
                                    color: boardFlowScore.grade === 'A' ? '#52c41a'
                                      : boardFlowScore.grade === 'B' ? '#1890ff'
                                      : boardFlowScore.grade === 'C' ? '#faad14'
                                      : '#ff4d4f',
                                  }}>
                                    {boardFlowScore.score}
                                  </span>
                                </Col>
                                <Col span={6} style={{ fontSize: 13 }}>评级</Col>
                                <Col span={6}>
                                  <span style={{
                                    fontSize: 20, fontWeight: 'bold',
                                    color: boardFlowScore.grade === 'A' ? '#52c41a'
                                      : boardFlowScore.grade === 'B' ? '#1890ff'
                                      : boardFlowScore.grade === 'C' ? '#faad14'
                                      : '#ff4d4f',
                                  }}>
                                    {boardFlowScore.grade}
                                  </span>
                                </Col>
                              </Row>
                              <div style={{
                                marginTop: 8, padding: '8px 12px', borderRadius: 6,
                                backgroundColor: boardFlowScore.grade === 'A' ? '#52c41a15'
                                  : boardFlowScore.grade === 'B' ? '#1890ff15'
                                  : boardFlowScore.grade === 'C' ? '#faad1415'
                                  : '#ff4d4f15',
                                borderLeft: `3px solid ${
                                  boardFlowScore.grade === 'A' ? '#52c41a'
                                  : boardFlowScore.grade === 'B' ? '#1890ff'
                                  : boardFlowScore.grade === 'C' ? '#faad14'
                                  : '#ff4d4f'
                                }`,
                              }}>
                                <span style={{ fontSize: 13 }}>{boardFlowScore.advice}</span>
                              </div>
                              <div style={{ marginTop: 12 }}>
                                <Row className={styles.rowheader} style={{ marginBottom: 6 }}>
                                  <Col span={10} style={{ fontSize: 12 }}>评分维度</Col>
                                  <Col span={7} style={{ fontSize: 12 }}>得分</Col>
                                  <Col span={7} style={{ fontSize: 12 }}>占比</Col>
                                </Row>
                                {boardFlowScore.dims.map((dim) => (
                                  <Row key={dim.label} style={{ marginBottom: 4, fontSize: 12, alignItems: 'center' }}>
                                    <Col span={10}>
                                      {dim.label}
                                      <Tooltip
                                        title={<div style={{ whiteSpace: 'pre-line', fontSize: 12 }}>{dim.tooltip}</div>}
                                        placement="right"
                                      >
                                        <QuestionCircleOutlined
                                          style={{
                                            marginLeft: 4, color: 'var(--secondary-text-color)',
                                            fontSize: 12, cursor: 'help',
                                          }}
                                        />
                                      </Tooltip>
                                    </Col>
                                    <Col span={7} className={Utils.GetValueColor(dim.score).textClass}>
                                      {dim.score}/{dim.max}
                                    </Col>
                                    <Col span={7}>
                                      <div style={{
                                        width: '100%', height: 4, borderRadius: 2,
                                        backgroundColor: 'var(--border-color)', overflow: 'hidden',
                                      }}>
                                        <div style={{
                                          width: `${Math.min(100, (Math.max(0, dim.score) / dim.max) * 100)}%`,
                                          height: '100%', borderRadius: 2,
                                          backgroundColor:
                                            dim.score >= dim.max * 0.6 ? '#52c41a'
                                            : dim.score > 0 ? '#faad14'
                                            : dim.score < 0 ? '#ff4d4f'
                                            : 'var(--border-color)',
                                          transition: 'width 0.3s',
                                        }} />
                                      </div>
                                    </Col>
                                  </Row>
                                ))}
                              </div>
                              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--secondary-text-color)' }}>
                                <Row style={{ marginBottom: 2 }}>
                                  <Col span={12}>主力20日: {formatMoneyFlow(boardFlowScore.main_20d)}</Col>
                                  <Col span={12}>主力10日: {formatMoneyFlow(boardFlowScore.main_10d)}</Col>
                                </Row>
                                <Row style={{ marginBottom: 2 }}>
                                  <Col span={12}>散户20日: {formatMoneyFlow(boardFlowScore.retail_20d)}</Col>
                                  <Col span={12}>净流入率: {boardFlowScore.main_rate.toFixed(2)}%</Col>
                                </Row>
                              </div>
                            </div>
                          )}
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
