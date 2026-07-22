import React, { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import styles from '../index.scss';
import * as Services from '@/services';
import * as Utils from '@/utils';
import { Stock } from '@/types/stock';
import { useRequest } from 'ahooks';
import { Col, Collapse, Row, Tabs, Spin, Button, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import DeptTradeBack from './DeptTradeBack';
import MoneyFlowChart from './MoneyFlowChart';
import { batch } from 'react-redux';

export interface CoreTradeProps {
  code: string;
  klines?: Stock.KLineItem[];
}

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

const CoreTrade: React.FC<CoreTradeProps> = React.memo(({ code, klines }) => {
  const [lhbangs, setLHBangs] = useState<any[]>();
  const { run: runGetLongHuBang } = useRequest(Services.Stock.GetLongHuBang, {
    throwOnError: true,
    manual: true,
    onSuccess: setLHBangs,
    cacheKey: `GetLongHuBang/${code}`,
  });
  const [blockTrades, setBlockTrades] = useState<any[]>();
  const { run: runGetBlockTrade } = useRequest(Services.Stock.GetBlockTrades, {
    throwOnError: true,
    manual: true,
    onSuccess: setBlockTrades,
    cacheKey: `GetBlockTrades/${code}`,
  });
  const [holderChanges, setHolderChanges] = useState<any[]>();
  const { run: runGetHolderChange } = useRequest(Services.Stock.GetHolderChanges, {
    throwOnError: true,
    manual: true,
    onSuccess: setHolderChanges,
    cacheKey: `GetHolderChanges/${code}`,
  });
  const [exchangeChanges, setExchangeChanges] = useState<any[]>();
  const { run: runGetExchangeChange } = useRequest(Services.Stock.GetExchangeChanges, {
    throwOnError: true,
    manual: true,
    onSuccess: setExchangeChanges,
    cacheKey: `GetExchangeChanges/${code}`,
  });
  const [zhiyaSum, setZhiyaSum] = useState<any[]>();
  const { run: runGetZhiyaSum } = useRequest(Services.Stock.GetStockZhiYaSum, {
    throwOnError: true,
    manual: true,
    onSuccess: setZhiyaSum,
    cacheKey: `GetStockZhiYaSum/${code}`,
  });
  const [nomoreZhiya, setnomoreZhiya] = useState(false);
  const [zhiyaPage, setZhiyaPage] = useState(1);
  const [zhiyaDetail, setZhiyaDetail] = useState<any[]>();
  const { run: runGetZhiyaDetail } = useRequest(Services.Stock.GetStockZhiYaDetail, {
    throwOnError: true,
    manual: true,
    onSuccess: (d) => {
      if (!zhiyaDetail) {
        setZhiyaDetail(d);
      } else {
        setZhiyaDetail(zhiyaDetail.concat(d));
      }
      if (d && d.length == 0) {
        setnomoreZhiya(true);
      }
    },
    cacheKey: `GetStockZhiYaSum/${code}`,
  });

  // 资金流向数据
  const [moneyFlow, setMoneyFlow] = useState<any>(null);
  const { run: runGetMoneyFlow, loading: moneyFlowLoading } = useRequest(Services.Tushare.GetMoneyFlowFromTushare, {
    throwOnError: true,
    manual: true,
    onSuccess: setMoneyFlow,
    cacheKey: `GetMoneyFlowFromTushare/${code}`,
  });

  // 主力建仓评分所需额外数据
  const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`;
  const [stockDetail, setStockDetail] = useState<any>(null);
  const { run: runGetDetail } = useRequest(Services.Tushare.GetDetailFromTushare, {
    throwOnError: true,
    manual: true,
    onSuccess: setStockDetail,
    cacheKey: `GetDetailFromTushare/${secid}`,
  });

  // 主力建仓分析（调用后端 main_in_filter）
  const [mainInResult, setMainInResult] = useState<any>(null);
  const { run: runMainInFilter, loading: mainInLoading } = useRequest(
    async () => {
      const ts_code = code.startsWith('6') ? `${code}.SH` : `${code}.SZ`;
      const today = dayjs().format('YYYYMMDD');
      const result = await Services.Tushare.MainInFilterStocksFromTushare(today, [ts_code]);
      if (result.results && result.results.length > 0) {
        return result.results[0];
      }
      return null;
    },
    {
      throwOnError: false,
      manual: true,
      onSuccess: setMainInResult,
    },
  );

  // 主力建仓评分 + 操作建议（使用后端 main_in_filter 结果）
  const mainInScore = React.useMemo(() => {
    if (!mainInResult) return null;

    const r = mainInResult;
    const scene = r.advice_scene || '';
    const isPositive = scene.startsWith('A') || scene.startsWith('B') || scene === 'G-1' || scene === 'G-2' || scene === 'H-1';
    const isNegative = scene === 'E' || scene === '前置过滤' || scene === 'H-3';
    const actionColor = isPositive ? '#52c41a' : isNegative ? '#ff4d4f' : '#faad14';

    return {
      score: r.score,
      grade: r.grade,
      dims: {
        mainDepth: r.dim_main_depth ?? 0,
        retailPanic: r.dim_retail_panic ?? 0,
        trend: r.dim_trend_verify ?? 0,
        risk: r.dim_risk_warning ?? 0,
        bounceQuality: r.dim_bounce_quality ?? 0,
      },
      main_in_rate: 0, // 由资金流向数据补充
      advice: scene ? {
        scene: `场景${scene}`,
        meaning: r.advice_meaning || '',
        action: r.advice_action || '',
        actionColor,
        stop_loss: r.stop_loss,
        target: r.target,
        position_advice: r.position_advice || '',
        hold_period: r.hold_period || '',
        add_point: r.add_point || '',
        breakout_confirm: r.breakout_confirm || '',
      } : null,
      // 后端返回的完整数据，供UI直接使用
      main_20d: r.main_20d,
      retail_20d: r.retail_20d,
      main_10d: r.main_10d,
      retail_10d: r.retail_10d,
      main_5d: r.main_5d,
      retail_5d: r.retail_5d,
      circ_mv: r.circ_mv,
      chg_10d: r.chg_10d,
      buy_signal: r.buy_signal,
      buy_reason: r.buy_reason || '',
      sell_signal: r.sell_signal,
      sell_reason: r.sell_reason,
      basic_passed: r.basic_passed,
      basic_reason: r.basic_reason || '',
      bounce_valid: r.bounce_valid,
      bounce_reason: r.bounce_reason || '',
      market_pattern: r.market_pattern || '不明',
      consolidation_score: r.consolidation_score ?? 0,
      consolidation_metrics: r.consolidation_metrics || {},
      is_pullback: r.is_pullback ?? false,
      condition_a: r.condition_a,
      condition_b: r.condition_b,
      condition_c: r.condition_c,
      condition_d: r.condition_d,
      condition_e: r.condition_e,
      condition_f: r.condition_f,
      condition_g: r.condition_g,
      condition_h: r.condition_h,
    };
  }, [mainInResult]);

  useEffect(() => {
    runGetLongHuBang(code);
    runGetBlockTrade(code);
    runGetHolderChange(code);
    runGetExchangeChange(code);
    runGetZhiyaSum(code);
    runGetZhiyaDetail(code);
    runGetMoneyFlow(code, 60);
    runGetDetail(secid);
    runMainInFilter();
  }, [code]);

  const [deptCodes, setDeptCodes] = useState([]);
  const [modelVisible, setModelVisible] = useState(false);
  const showDeptTradeBacks = useCallback((list) => {
    batch(() => {
      setDeptCodes(list.map((l) => l.OPERATEDEPT_CODE));
      setModelVisible(true);
    });
  }, []);

  const loadMoreZhiya = useCallback(() => {
    const p = zhiyaPage + 1;
    runGetZhiyaDetail(code, p);
    setZhiyaPage(p);
  }, [code, zhiyaPage]);

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
      const { dialog, ipcRenderer } = window.contextModules.electron;
      const defaultPath = `moneyflow_${code}_${moneyFlow.detail_dates[moneyFlow.detail_dates.length - 1]}.json`;
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: '导出资金流向数据',
        defaultPath,
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
      });
      if (canceled || !filePath) return;

      // 构建导出数据：逐日资金流向明细
      const exportData = {
        code,
        exportTime: new Date().toISOString(),
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
  }, [code, moneyFlow]);

  return (
    <div className={styles.coretrade}>
      <DeptTradeBack codes={deptCodes} visible={modelVisible} close={() => setModelVisible(false)} />
      <Tabs tabPosition="left" defaultActiveKey={'moneyflow'} style={{ height: '100%' }}>
        <Tabs.TabPane tab={<span>资金流向</span>} key={'moneyflow'}>
          <div className={styles.cardcontent}>
            {moneyFlowLoading ? (
              <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
            ) : moneyFlow ? (
              <div className={styles.gdzj}>
                {/* 主力资金流向汇总 */}
                <Row className={styles.rowheader} style={{ marginBottom: 8 }}>
                  <Col span={6}>周期</Col>
                  <Col span={6}>主力</Col>
                  <Col span={6}>中户</Col>
                  <Col span={6}>散户</Col>
                </Row>
                {[
                  { label: '今日', main: moneyFlow.main_1d, medium: moneyFlow.medium_1d, retail: moneyFlow.retail_1d, cost: moneyFlow.avg_cost_1d },
                  { label: '3日', main: moneyFlow.main_3d, medium: moneyFlow.medium_3d, retail: moneyFlow.retail_3d, cost: moneyFlow.avg_cost_3d },
                  { label: '5日', main: moneyFlow.main_5d, medium: moneyFlow.medium_5d, retail: moneyFlow.retail_5d, cost: moneyFlow.avg_cost_5d },
                  { label: '10日', main: moneyFlow.main_10d, medium: moneyFlow.medium_10d, retail: moneyFlow.retail_10d, cost: moneyFlow.avg_cost_10d },
                  { label: '20日', main: moneyFlow.main_20d, medium: moneyFlow.medium_20d, retail: moneyFlow.retail_20d, cost: moneyFlow.avg_cost_20d },
                ].map((item) => (
                  <Row key={item.label} style={{ marginBottom: 6 }}>
                    <Col span={6}>{item.label}</Col>
                    <Col span={6} className={Utils.GetValueColor(item.main).textClass}>
                      {formatMoneyFlow(item.main)}{item.cost > 0 ? `（${item.cost}）` : ''}
                    </Col>
                    <Col span={6} className={Utils.GetValueColor(item.medium).textClass}>
                      {formatMoneyFlow(item.medium)}{item.cost > 0 ? `（${item.cost}）` : ''}
                    </Col>
                    <Col span={6} className={Utils.GetValueColor(item.retail).textClass}>
                      {formatMoneyFlow(item.retail)}{item.cost > 0 ? `（${item.cost}）` : ''}
                    </Col>
                  </Row>
                ))}

                {/* 最新一日详细分档 */}
                <div style={{ marginTop: 16 }}>
                  <Row className={styles.rowheader} style={{ marginBottom: 8 }}>
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
                    <Row className={styles.rowheader} style={{ marginBottom: 8 }} align="middle">
                      <Col flex="auto">近60日逐日资金流向</Col>
                      <Col>
                        <Button size="small" onClick={handleExportMoneyFlow}>导出JSON</Button>
                      </Col>
                    </Row>
                    <Row className={styles.rowheader} style={{ marginBottom: 4 }}>
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

                {/* 主力建仓评分 */}
                {mainInScore ? (
                  <div style={{ marginTop: 20, padding: '12px 16px', borderRadius: 8, backgroundColor: 'var(--card-background-color)', border: '1px solid var(--border-color)' }}>
                    <Row className={styles.rowheader} style={{ marginBottom: 12 }}>
                      <Col span={24}>主力建仓评分模型</Col>
                    </Row>
                    <Row style={{ marginBottom: 8, alignItems: 'center' }}>
                      <Col span={6}>综合评分</Col>
                      <Col span={6}>
                        <span style={{ fontSize: 24, fontWeight: 'bold', color: mainInScore.grade === 'A' ? '#52c41a' : mainInScore.grade === 'B' ? '#1890ff' : mainInScore.grade === 'C' ? '#faad14' : '#ff4d4f' }}>
                          {mainInScore.score}
                        </span>
                      </Col>
                      <Col span={6}>评级</Col>
                      <Col span={6}>
                        <span style={{
                          fontSize: 20, fontWeight: 'bold',
                          color: mainInScore.grade === 'A' ? '#52c41a' : mainInScore.grade === 'B' ? '#1890ff' : mainInScore.grade === 'C' ? '#faad14' : '#ff4d4f',
                        }}>
                          {mainInScore.grade}
                        </span>
                      </Col>
                    </Row>
                    <div style={{ marginTop: 12 }}>
                      <Row className={styles.rowheader} style={{ marginBottom: 6 }}>
                        <Col span={10}>评分维度</Col>
                        <Col span={7}>得分</Col>
                        <Col span={7}>占比</Col>
                      </Row>
                      {[
                        {
                          label: '主力建仓深度(20日)',
                          score: mainInScore.dims.mainDepth,
                          max: 40,
                          tooltip: '双轨制评分（绝对金额20分 + 净流入率20分）：\n\n【绝对金额】按流通市值分档：\n大盘(>200亿): >10亿→20分, >5亿→15分, >1亿→10分, >0→5分\n中盘(50~200亿): >5亿→20分, >2亿→15分, >0.5亿→10分, >0→5分\n小盘(<50亿): >2亿→20分, >1亿→15分, >0.2亿→10分, >0→5分\n\n【净流入率】主力20日 / 近20日成交额：\n> 5% → 20分\n> 3% → 12分\n> 1% → 6分\n> 0% → 2分',
                        },
                        {
                          label: '散户割肉力度(20日)',
                          score: mainInScore.dims.retailPanic,
                          max: 20,
                          tooltip: '双轨制评分（仅散户净流出时给分）：\n\n【绝对金额(10分)】按流通市值分档：\n大盘(>200亿): |流出|>5亿→10分, >3亿→7分, >1亿→4分\n中盘(50~200亿): |流出|>3亿→10分, >1亿→7分, >0.5亿→4分\n小盘(<50亿): |流出|>1亿→10分, >0.5亿→7分, >0.2亿→4分\n\n【净流出率(10分)】|散户20日| / 近20日成交额：\n> 5% → 10分\n> 3% → 6分\n> 1% → 3分\n\n散户净流入时 → 0分',
                        },
                        {
                          label: '近期趋势验证(10日)',
                          score: mainInScore.dims.trend,
                          max: 20,
                          tooltip: '10日主力净流入 > 20日主力净流入 × 50% 且为正 → 20分\n10日主力净流入 > 0 → 10分\n10日主力净流入 ≤ 0 → 0分',
                        },
                        {
                          label: '短期风险预警(5日)',
                          score: mainInScore.dims.risk,
                          max: 20,
                          tooltip: '5日主力净流出 > |20日主力净流入| × 30% → 扣20分（出货风险）\n5日主力净流出 但未达上述阈值 → 扣10分（警惕）\n其他 → 0分',
                        },
                        {
                          label: '低位反弹质量(10日)',
                          score: mainInScore.dims.bounceQuality,
                          max: 25,
                          tooltip: '用收盘价判断有效反弹，避免日内脉冲误导：\n\n【有效反弹】按反弹幅度阶梯：\n> 20% → 15分\n> 15% → 12分\n> 12% → 8分\n≥ 10% → 4分\n\n【回调深度加分】反弹后充分回调是健康信号：\n> 30% 回调占比 → +10分\n> 15% 回调占比 → +6分\n> 0% → +3分\n\n【震荡筑底/下跌中继】非有效反弹但低位横盘+主力吸筹：\n当前价 < 20日最高 × 85% 且当前价 > 20日最低 × 105% → 15分',
                        },
                      ].map((dim) => (
                        <Row key={dim.label} style={{ marginBottom: 4, fontSize: 13, alignItems: 'center' }}>
                          <Col span={10}>
                            {dim.label}
                            <Tooltip
                              title={<div style={{ whiteSpace: 'pre-line', fontSize: 12 }}>{dim.tooltip}</div>}
                              placement="right"
                            >
                              <QuestionCircleOutlined style={{ marginLeft: 4, color: 'var(--secondary-text-color)', fontSize: 12, cursor: 'help' }} />
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
                                backgroundColor: dim.score >= dim.max * 0.6 ? '#52c41a' : dim.score > 0 ? '#faad14' : dim.score < 0 ? '#ff4d4f' : 'var(--border-color)',
                                transition: 'width 0.3s',
                              }} />
                            </div>
                          </Col>
                        </Row>
                      ))}
                    </div>
                    {/* 操作建议 */}
                    {mainInScore.advice && (
                      <div style={{
                        marginTop: 12, padding: '10px 12px', borderRadius: 6,
                        backgroundColor: mainInScore.advice.actionColor + '15',
                        borderLeft: `3px solid ${mainInScore.advice.actionColor}`,
                      }}>
                        <Row align="middle">
                          <Col span={4} style={{ fontSize: 13, fontWeight: 'bold', color: mainInScore.advice.actionColor }}>
                            {mainInScore.advice.scene}
                            <Tooltip
                              title={<div style={{ whiteSpace: 'pre-line', fontSize: 12 }}>
                                A-1 黄金买点：低位反弹后缩量回调，主力逆势吸筹，散户恐慌割肉{'\n'}
                                A-2 优质买点：回调较深但主力未撤退，洗盘尾声即将二次拉升{'\n'}
                                B-1 观察等待：反弹但主力吸筹偏弱{'\n'}
                                B-2 谨慎观察：反弹后主力未跟进，可能散户或游资推动{'\n'}
                                B-3 回调过深：回调接近反弹低点，若跌破则趋势破坏{'\n'}
                                E 反弹高位：接近反弹高点，反弹末期{'\n'}
                                F 信号不明：指标矛盾，无法明确判断{'\n'}
                                {'\n'}
                                G-1 筑底突破：低位横盘，主力吸筹充分，接近突破位{'\n'}
                                G-2 筑底吸筹：低位横盘，主力悄悄吸筹，尚未完成{'\n'}
                                G-3 筑底观察：有横盘迹象，主力吸筹力度不够{'\n'}
                                G-4 弱势横盘：价格横盘但主力未介入{'\n'}
                                {'\n'}
                                H-1 寻底完成：主力流入，缩量寻底，可试探建仓{'\n'}
                                H-2 仍在寻底：缩量但主力未明确流入{'\n'}
                                H-3 下跌途中：尚未出现寻底信号，回避
                              </div>}
                              placement="top"
                            >
                              <QuestionCircleOutlined style={{ marginLeft: 4, color: mainInScore.advice.actionColor, fontSize: 11, cursor: 'help', opacity: 0.7 }} />
                            </Tooltip>
                          </Col>
                          <Col span={8} style={{ fontSize: 12, color: 'var(--text-color)' }}>
                            {mainInScore.advice.meaning}
                            {mainInScore.basic_passed === false && mainInScore.basic_reason && mainInScore.basic_reason !== '通过' && (
                              <div style={{ fontSize: 11, color: 'var(--secondary-text-color)', marginTop: 4 }}>
                                {mainInScore.basic_reason}
                              </div>
                            )}
                            {mainInScore.bounce_valid === false && mainInScore.bounce_reason && (
                              <div style={{ fontSize: 11, color: '#faad14', marginTop: 2 }}>
                                反弹: {mainInScore.bounce_reason}
                              </div>
                            )}
                            {mainInScore.market_pattern && mainInScore.market_pattern !== '不明' && (
                              <div style={{ fontSize: 11, color: '#1890ff', marginTop: 2 }}>
                                形态: {mainInScore.market_pattern}
                                {mainInScore.consolidation_score > 0 && (
                                  <span>（震荡评分{mainInScore.consolidation_score}分）</span>
                                )}
                              </div>
                            )}
                          </Col>
                          <Col span={5}>
                            <span style={{
                              fontSize: 14, fontWeight: 'bold', color: mainInScore.advice.actionColor,
                              padding: '2px 8px', borderRadius: 4,
                              backgroundColor: mainInScore.advice.actionColor + '20',
                            }}>
                              {mainInScore.advice.action}
                            </span>
                          </Col>
                          <Col span={7} style={{ fontSize: 11, color: 'var(--secondary-text-color)', textAlign: 'right' }}>
                          </Col>
                        </Row>
                        {(mainInScore.advice.stop_loss || mainInScore.advice.target || mainInScore.advice.position_advice) && (
                          <Row align="middle" style={{ marginTop: 8, fontSize: 12, color: 'var(--secondary-text-color)' }}>
                            {mainInScore.advice.stop_loss > 0 ? (
                              <Col span={6}>
                                止损：<span style={{ color: '#ff4d4f', fontWeight: 'bold' }}>{mainInScore.advice.stop_loss.toFixed(2)}</span>
                              </Col>
                            ) : <Col span={6} />}
                            {mainInScore.advice.target > 0 ? (
                              <Col span={6}>
                                目标：<span style={{ color: '#52c41a', fontWeight: 'bold' }}>{mainInScore.advice.target.toFixed(2)}</span>
                              </Col>
                            ) : <Col span={6} />}
                            {mainInScore.advice.position_advice ? (
                              <Col span={6}>
                                仓位：<span style={{ fontWeight: 'bold' }}>{mainInScore.advice.position_advice}</span>
                              </Col>
                            ) : <Col span={6} />}
                            {mainInScore.advice.hold_period ? (
                              <Col span={6}>
                                周期：<span style={{ fontWeight: 'bold' }}>{mainInScore.advice.hold_period}</span>
                              </Col>
                            ) : <Col span={6} />}
                          </Row>
                        )}
                        {(mainInScore.advice.add_point || mainInScore.advice.breakout_confirm) && (
                          <Row align="middle" style={{ marginTop: 4, fontSize: 11, color: 'var(--secondary-text-color)' }}>
                            {mainInScore.advice.breakout_confirm ? (
                              <Col span={12} style={{ color: '#1890ff' }}>
                                突破确认：{mainInScore.advice.breakout_confirm}
                              </Col>
                            ) : <Col span={12} />}
                            {mainInScore.advice.add_point ? (
                              <Col span={12} style={{ color: '#faad14' }}>
                                加仓点：{mainInScore.advice.add_point}
                              </Col>
                            ) : <Col span={12} />}
                          </Row>
                        )}
                      </div>
                    )}
                    {/* 买卖信号 */}
                    {(mainInScore.buy_signal || mainInScore.sell_signal) && (
                      <div style={{
                        marginTop: 12, padding: '8px 12px', borderRadius: 6,
                        backgroundColor: mainInScore.buy_signal ? '#52c41a15' : '#ff4d4f15',
                        borderLeft: `3px solid ${mainInScore.buy_signal ? '#52c41a' : '#ff4d4f'}`,
                      }}>
                        <Row align="middle">
                          <Col span={4} style={{ fontSize: 13, fontWeight: 'bold', color: mainInScore.buy_signal ? '#52c41a' : '#ff4d4f' }}>
                            交易信号
                          </Col>
                          <Col span={12}>
                            {mainInScore.buy_signal === 'A' && (
                              <span style={{ fontSize: 14, fontWeight: 'bold', color: '#52c41a' }}>强烈买入</span>
                            )}
                            {mainInScore.buy_signal === 'B' && (
                              <span style={{ fontSize: 14, fontWeight: 'bold', color: '#389e0d' }}>可买入</span>
                            )}
                            {mainInScore.sell_signal === 'SELL' && (
                              <Tooltip title={mainInScore.sell_reason}>
                                <span style={{ fontSize: 14, fontWeight: 'bold', color: '#ff4d4f', cursor: 'help', borderBottom: '1px dashed #ff4d4f' }}>卖出信号</span>
                              </Tooltip>
                            )}
                          </Col>
                          <Col span={8} style={{ fontSize: 11, color: 'var(--secondary-text-color)', textAlign: 'right' }}>
                            {mainInScore.buy_reason && <span title={mainInScore.buy_reason}>{mainInScore.buy_reason.length > 20 ? mainInScore.buy_reason.slice(0, 20) + '...' : mainInScore.buy_reason}</span>}
                            {mainInScore.sell_reason && <span title={mainInScore.sell_reason}>{mainInScore.sell_reason.length > 20 ? mainInScore.sell_reason.slice(0, 20) + '...' : mainInScore.sell_reason}</span>}
                          </Col>
                        </Row>
                      </div>
                    )}
                    <div style={{ marginTop: 12, fontSize: 12, color: 'var(--secondary-text-color)' }}>
                      <Row style={{ marginBottom: 2 }}>
                        <Col span={12}>主力10日: {formatMoneyFlow(mainInScore.main_10d)}</Col>
                        <Col span={12}>散户5日: {formatMoneyFlow(mainInScore.retail_5d)}</Col>
                      </Row>
                      <Row style={{ marginBottom: 2 }}>
                        <Col span={12}>近10日涨幅: {mainInScore.chg_10d?.toFixed?.(2) ?? '--'}%</Col>
                        <Col span={12}>流通市值: {(mainInScore.circ_mv / 1e8).toFixed(1)}亿</Col>
                      </Row>
                    </div>
                  </div>
                ) : mainInLoading ? (
                  <div style={{ marginTop: 20, textAlign: 'center', padding: 20 }}>
                    <Spin /> 主力建仓分析中...
                  </div>
                ) : null}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--secondary-text-color)' }}>
                暂无资金流向数据
              </div>
            )}
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span>龙虎榜</span>} key={'lhb'}>
          <div className={styles.cardcontent}>
            <Collapse expandIconPosition="right">
              {lhbangs?.map((d) => (
                <Collapse.Panel
                  header={
                    <>
                      <div>{d.TRADE_DATE.substring(0, 10)}</div>
                      <div>{d.EXPLANATION}</div>
                      <div style={{ display: 'flex' }}>
                        <div style={{ marginRight: 15 }}>
                          <span>成交额</span>
                          <span className={Utils.GetValueColor(d.ACCUM_AMOUNT).textClass}>
                            {(d.ACCUM_AMOUNT / 100000000.0).toFixed(2)}亿
                          </span>
                        </div>
                        <div style={{ marginRight: 15 }}>
                          <span>涨跌幅</span>
                          <span className={Utils.GetValueColor(d.CHANGE_RATE).textClass}>{d.CHANGE_RATE.toFixed(2)}%</span>
                        </div>
                        <div>
                          <span>净买入</span>
                          <span className={Utils.GetValueColor(d.NET_BUY).textClass}>{(d.NET_BUY / 10000.0).toFixed(2)}万</span>
                        </div>
                      </div>
                    </>
                  }
                  key={d.TRADE_ID}
                >
                  <div className={styles.lhb}>
                    <Row gutter={10} style={{ marginBottom: 5 }} className={styles.rowheader}>
                      <Col span={9}>
                        <a onClick={() => showDeptTradeBacks(d.LIST.filter((l) => parseInt(l.TRADE_DIRECTION) === 0))}>买入营业部</a>
                      </Col>
                      <Col span={5}>买入金额(元)</Col>
                      <Col span={5}>卖出金额(元)</Col>
                      <Col span={5}>买入占比(元)</Col>
                    </Row>
                    {d.LIST.filter((l) => parseInt(l.TRADE_DIRECTION) === 0).map((l) => (
                      <Row gutter={10} key={l.OPERATEDEPT_NAME}>
                        <Col span={9}>{l.OPERATEDEPT_NAME}</Col>
                        <Col span={5} className={Utils.GetValueColor(1).textClass}>
                          {!l.BUY_AMT_REAL ? '--' : (l.BUY_AMT_REAL / 10000.0).toFixed(2)}万
                        </Col>
                        <Col span={5} className={Utils.GetValueColor(-1).textClass}>
                          {!l.SELL_AMT_REAL ? '--' : (l.SELL_AMT_REAL / 10000.0).toFixed(2)}万
                        </Col>
                        <Col span={5}>{!l.BUY_RATIO ? '--' : l.BUY_RATIO.toFixed(2)}%</Col>
                      </Row>
                    ))}
                    <Row gutter={10} style={{ marginBottom: 5, marginTop: 5 }} className={styles.rowheader}>
                      <Col span={9}>卖出营业部</Col>
                      <Col span={5}>卖出金额(元)</Col>
                      <Col span={5}>买入金额(元)</Col>
                      <Col span={5}>卖出占比(元)</Col>
                    </Row>
                    {d.LIST.filter((l) => parseInt(l.TRADE_DIRECTION) === 1).map((l) => (
                      <Row gutter={10} key={l.OPERATEDEPT_NAME}>
                        <Col span={9}>{l.OPERATEDEPT_NAME}</Col>
                        <Col span={5} className={Utils.GetValueColor(-1).textClass}>
                          {!l.SELL_AMT_REAL ? '--' : (l.SELL_AMT_REAL / 10000.0).toFixed(2)}万
                        </Col>
                        <Col span={5} className={Utils.GetValueColor(1).textClass}>
                          {!l.BUY_AMT_REAL ? '--' : (l.BUY_AMT_REAL / 10000.0).toFixed(2)}万
                        </Col>
                        <Col span={5}>{!l.SELL_RATIO ? '--' : l.SELL_RATIO.toFixed(2)}%</Col>
                      </Row>
                    ))}
                  </div>
                </Collapse.Panel>
              ))}
            </Collapse>
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span>大宗交易</span>} key={'dzjy'}>
          <div className={styles.cardcontent}>
            {blockTrades?.map((b) => (
              <div className={styles.blocktrade} key={b.DEAL_AMT}>
                <Row>
                  <Col span={4}>交易日期</Col>
                  <Col span={4}>{!b.TRADE_DATE ? '--' : b.TRADE_DATE.substring(0, 10)}</Col>
                  <Col span={3}>成交价(元)</Col>
                  <Col span={4}>{b.DEAL_PRICE}</Col>
                </Row>
                <Row>
                  <Col span={4}>成交额</Col>
                  <Col span={4}>{(b.DEAL_AMT / 10000.0).toFixed(2)}万</Col>
                  <Col span={3}>折/溢价率</Col>
                  <Col span={4} className={Utils.GetValueColor(b.PREMIUM_RATIO).textClass}>
                    {(b.PREMIUM_RATIO * 100).toFixed(2)}%
                  </Col>
                </Row>
                <Row>
                  <Col span={4}>买入营业部</Col>
                  <Col span={20}>{b.BUYER_NAME}</Col>
                </Row>
                <Row>
                  <Col span={4}>卖出营业部</Col>
                  <Col span={20}>{b.SELLER_NAME}</Col>
                </Row>
              </div>
            ))}
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span>股东增减</span>} key={'gdzj'}>
          <div className={styles.cardcontent}>
            <div className={styles.gdzj}>
              <Row className={styles.rowheader}>
                <Col span={4}>截止日期</Col>
                <Col span={4}>起始日期</Col>
                <Col span={6}>股东名称</Col>
                <Col span={6}>变动数量(股)(变动比例)</Col>
                <Col span={4}>变动后持股比例</Col>
              </Row>
              {holderChanges?.map((h) => (
                <Row key={h.CHANGE_NUM}>
                  <Col span={4}>{!h.END_DATE ? '--' : h.END_DATE.substring(0, 10)}</Col>
                  <Col span={4}>{!h.START_DATE ? '--' : h.START_DATE.substring(0, 10)}</Col>
                  <Col span={6}>{h.HOLDER_NAME}</Col>
                  <Col span={6} className={Utils.GetValueColor(h.CHANGE_NUM).textClass}>
                    {(h.CHANGE_NUM / 10000.0).toFixed(2)}万 ({!h.CHANGE_RATIO ? '--' : h.CHANGE_RATIO.toFixed(2) + '%'})
                  </Col>
                  <Col span={4}>{!h.HOLD_RATIO ? '--' : h.HOLD_RATIO.toFixed(2)}%</Col>
                </Row>
              ))}
            </div>
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span>高管增减</span>} key={'ggzj'}>
          <div className={styles.cardcontent}>
            <div className={styles.ggzj}>
              <Row>
                <Col span={3}>变动日期</Col>
                <Col span={2}>变动人</Col>
                <Col span={3}>变动数量(股)</Col>
                <Col span={3}>交易均价(元)</Col>
                <Col span={3}>结存股票(股)</Col>
                <Col span={3}>交易方式</Col>
                <Col span={2}>董监高管</Col>
                <Col span={3}>高管职位</Col>
                <Col span={2}>关系</Col>
              </Row>
              {exchangeChanges?.map((e, i) => (
                <Row key={i}>
                  <Col span={3}>{!e.END_DATE ? '--' : e.END_DATE.substring(0, 10)}</Col>
                  <Col span={2}>{e.HOLDER_NAME}</Col>
                  <Col span={3} className={Utils.GetValueColor(e.CHANGE_NUM).textClass}>
                    {(e.CHANGE_NUM / 10000.0).toFixed(2)}万
                  </Col>
                  <Col span={3}>{!e.AVERAGE_PRICE ? '--' : e.AVERAGE_PRICE.toFixed(2)}</Col>
                  <Col span={3}>{!e.CHANGE_AFTER_HOLDNUM ? '--' : (e.CHANGE_AFTER_HOLDNUM / 10000.0).toFixed(2)}万</Col>
                  <Col span={3}>{e.TRADE_WAY}</Col>
                  <Col span={2}>{e.EXECUTIVE_NAME}</Col>
                  <Col span={3}>{e.POSITION}</Col>
                  <Col span={2}>{e.EXECUTIVE_RELATION}</Col>
                </Row>
              ))}
            </div>
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span>股权质押</span>} key={'gqzy'}>
          <div className={styles.cardcontent}>
            <div className={styles.gqzy}>
                {zhiyaSum && <>
                  <Row>
                    <Col span={12}>股东名称</Col>
                    <Col span={4}>质押股数</Col>
                    <Col span={4}>占持股比</Col>
                    <Col span={4}>占总股本比</Col>
                  </Row>
                  {zhiyaSum?.map((e, i) => (
                    <Row key={i}>
                      <Col span={12}>{e.HOLDER_NAME}</Col>
                      <Col span={4}>{(e.ACCUM_PLEDGE_NUM / 10000.0).toFixed(2)}万</Col>
                      <Col span={4}>{e.ACCUM_PLEDGE_HR}%</Col>
                      <Col span={4}>{e.ACCUM_PLEDGE_TSR}%</Col>
                    </Row>
                  ))}
                </>}
                <br />
                {zhiyaDetail && <>
                  <Row>
                    <Col span={4}>质押日期</Col>
                    <Col span={3}>股东名称</Col>
                    <Col span={3}>质押股数</Col>
                    <Col span={2}>质押价</Col>
                    <Col span={2}>预警线</Col>
                    <Col span={3}>平仓线</Col>
                    <Col span={3}>市值</Col>
                    <Col span={4}>状态</Col>
                  </Row>
                  {zhiyaDetail?.map((e, i) => (
                    <>
                    <Row key={i}>
                      <Col span={4}>{!e.PF_START_DATE ? '--' : e.PF_START_DATE.substring(0, 10)}</Col>
                      <Col span={3}>{e.HOLDER_NAME}</Col>
                      <Col span={3}>{(e.PF_NUM / 10000.0).toFixed(2)}万</Col>
                      <Col span={2}>{!e.CLOSE_FORWARD_ADJPRICE ? '--' : e.CLOSE_FORWARD_ADJPRICE.toFixed(2)}</Col>
                      <Col span={2}>{!e.WARNING_LINE ? '--' : e.WARNING_LINE.toFixed(2)}</Col>
                      <Col span={3}>{!e.OPENLINE ? '--' : e.OPENLINE.toFixed(2)}</Col>
                      <Col span={3}>{(e.MARKET_CAP / 100000000.0).toFixed(2)}亿</Col>
                      <Col span={4}>{e.WARNING_STATE}</Col>
                    </Row>
                    </>
                  ))}
                  {!nomoreZhiya && (
                      <div className={styles.loadmore} onClick={loadMoreZhiya}>
                      <span>加载更多</span>
                    </div>
                    )}
                </>}
            </div>
          </div>
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
});
export default CoreTrade;
