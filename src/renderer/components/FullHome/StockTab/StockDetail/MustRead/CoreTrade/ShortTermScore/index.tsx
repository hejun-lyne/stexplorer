import React, { useEffect, useMemo, useState } from 'react';
import { Button, Col, Collapse, Row, Spin, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { useRequest } from 'ahooks';
import * as Services from '@/services';
import * as Utils from '@/utils';
import { StoreState } from '@/reducers/types';
import { Stock } from '@/types/stock';
import * as Enums from '@/utils/enums';
import { KLineType } from '@/utils/enums';
import styles from '../../index.scss';
import * as Score from '@/helpers/shortTermScore';
import MoneyFlowChart from '../MoneyFlowChart';

export interface ShortTermScoreProps {
  code: string;
  /** CoreTrade 已获取的资金流向数据（含 60 日明细） */
  moneyFlow?: {
    detail_main?: number[];
    detail_retail?: number[];
    detail_medium?: number[];
    detail_dates?: string[];
    [key: string]: any;
  } | null;
  /** 流通市值（元），来自主力建仓分析结果 */
  circMv?: number;
}

/** 格式化金额（元 -> 亿/万） */
const formatAmount = (val: number) => {
  const v = Number(val) || 0;
  if (Math.abs(v) >= 1e8) {
    return (v / 1e8).toFixed(2) + '亿';
  }
  if (Math.abs(v) >= 1e4) {
    return (v / 1e4).toFixed(2) + '万';
  }
  return v.toFixed(0) + '元';
};

/** 评分进度条 */
const ScoreBar = ({ value, max }: { value: number; max: number }) => (
  <div style={{ width: '100%', height: 4, borderRadius: 2, backgroundColor: 'var(--border-color)', overflow: 'hidden' }}>
    <div
      style={{
        width: `${Math.min(100, (Math.max(0, value) / max) * 100)}%`,
        height: '100%',
        borderRadius: 2,
        backgroundColor: Score.scoreColor((value / max) * 100),
        transition: 'width 0.3s',
      }}
    />
  </div>
);

/** 市值风格板块（大盘评分的对比基准） */
const SIZE_BOARD_NAMES = ['微盘股', '小盘股', '中盘股', '大盘股'];

const ShortTermScore: React.FC<ShortTermScoreProps> = React.memo(({ code, moneyFlow, circMv }) => {
  const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`;
  const indexSecid = code.startsWith('6') ? '1.000001' : code.startsWith('3') ? '0.399006' : '0.399001';
  const indexName = code.startsWith('6') ? '上证指数' : code.startsWith('3') ? '创业板指' : '深证成指';

  // 用户在板块页手动设置的活跃板块（优先）
  const hybk = useSelector((store: StoreState) => store.stock.stockConfigsMapping[secid]?.hybk);
  // K线数据源设置（与主图同源，走多源兜底 + sqlite 缓存）
  const { kLineApiSourceSetting } = useSelector((state: StoreState) => state.setting.systemSetting);

  // ---- 个股日K（自取250日，保证RSI历史分位足够；数据源失败时回退东财直连） ----
  const [dklines, setDklines] = useState<Stock.KLineItem[] | null>(null);
  const [dkError, setDkError] = useState<string | null>(null);
  const { run: runGetDK, loading: dkLoading } = useRequest(
    async () => {
      const r = await Services.Stock.GetKFromDataSource(kLineApiSourceSetting, secid, KLineType.Day, 250);
      if (r?.ks?.length) {
        return r.ks;
      }
      if (kLineApiSourceSetting !== Enums.FundApiType.Eastmoney) {
        const fallback = await Services.Stock.GetKFromEastmoney(secid, KLineType.Day, 250);
        if (fallback?.ks?.length) {
          return fallback.ks;
        }
      }
      // 抛错而不是返回空数组，避免空结果被 cacheKey 缓存导致重试失效
      throw new Error('未获取到日K数据');
    },
    {
      manual: true,
      cacheKey: `ShortTermK/${secid}/${kLineApiSourceSetting}`,
      onSuccess: (ks) => {
        setDkError(null);
        setDklines(ks);
      },
      onError: (e) => setDkError(e?.message || '请求失败'),
      throwOnError: false,
    },
  );

  // ---- 所属指数日K（数据源失败时回退东财直连） ----
  const [indexKlines, setIndexKlines] = useState<Stock.KLineItem[] | null>(null);
  const { run: runGetIndexK } = useRequest(
    async () => {
      const r = await Services.Stock.GetKFromDataSource(kLineApiSourceSetting, indexSecid, KLineType.Day, 60);
      if (r?.ks?.length) {
        return r.ks;
      }
      const fallback = await Services.Stock.GetKFromEastmoney(indexSecid, KLineType.Day, 60);
      return fallback?.ks || [];
    },
    {
      manual: true,
      cacheKey: `ShortTermIndex/${indexSecid}/${kLineApiSourceSetting}`,
      onSuccess: setIndexKlines,
      throwOnError: false,
    },
  );

  // ---- 所属板块 / 市值风格板块 ----
  const [board, setBoard] = useState<{ code: string; name: string } | null>(null);
  const [sizeBoard, setSizeBoard] = useState<{ code: string; name: string } | null>(null);
  useEffect(() => {
    setBoard(null);
    setSizeBoard(null);
    if (hybk) {
      setBoard({ code: hybk.code, name: hybk.name });
    }
    // 板块列表：未手动设置时取第一个作板块评分基准；同时识别市值风格板块（大盘/中盘/小盘/微盘）作大盘评分对比基准
    Services.Stock.GetStockBankuaisFromEastmoney(secid)
      .then((list: any[]) => {
        if (list && list.length) {
          if (!hybk) {
            setBoard({ code: list[0].code, name: list[0].name });
          }
          const size = list.find((b: any) => SIZE_BOARD_NAMES.includes(b.name));
          if (size) {
            setSizeBoard({ code: size.code, name: size.name });
          }
        }
      })
      .catch(() => undefined);
  }, [secid, hybk]);

  // ---- 板块日K（数据源失败时回退东财直连） ----
  const fetchBoardKlines = async (boardCode: string): Promise<Stock.KLineItem[]> => {
    const r = await Services.Stock.GetKFromDataSource(kLineApiSourceSetting, `90.${boardCode}`, KLineType.Day, 60);
    if (r?.ks?.length) {
      return r.ks;
    }
    const fallback = await Services.Stock.GetKFromEastmoney(`90.${boardCode}`, KLineType.Day, 60);
    return fallback?.ks || [];
  };
  const [boardKlines, setBoardKlines] = useState<Stock.KLineItem[] | null>(null);
  useEffect(() => {
    setBoardKlines(null);
    if (board) {
      fetchBoardKlines(board.code).then(setBoardKlines).catch(() => setBoardKlines([]));
    }
  }, [board, kLineApiSourceSetting]);

  // ---- 市值风格板块日K（大盘评分对比基准，失败时回退所属指数） ----
  const [sizeBoardKlines, setSizeBoardKlines] = useState<Stock.KLineItem[] | null>(null);
  useEffect(() => {
    setSizeBoardKlines(null);
    if (sizeBoard) {
      fetchBoardKlines(sizeBoard.code).then(setSizeBoardKlines).catch(() => setSizeBoardKlines([]));
    }
  }, [sizeBoard, kLineApiSourceSetting]);

  // ---- 近10日涨跌比 ----
  const [upRatioMap, setUpRatioMap] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    if (!dklines || dklines.length === 0) {
      return;
    }
    const dates = dklines
      .slice(-Score.SHORT_TERM_SCORE_CONFIG.marketDays)
      .map((k) => k.date.replace(/-/g, ''));
    Services.Tushare.GetUpRatioFromTushare(dates)
      .then(setUpRatioMap)
      .catch(() => setUpRatioMap({}));
  }, [dklines]);

  // ---- 同类市值成交统计 ----
  const [marketStats, setMarketStats] = useState<any>(null);
  useEffect(() => {
    if (!dklines || dklines.length === 0) {
      return;
    }
    const lastDate = dklines[dklines.length - 1].date.replace(/-/g, '');
    Services.Tushare.GetMarketActivityStatsFromTushare(lastDate)
      .then(setMarketStats)
      .catch(() => setMarketStats(null));
  }, [dklines]);

  useEffect(() => {
    setDklines(null);
    setDkError(null);
    setIndexKlines(null);
    runGetDK();
    runGetIndexK();
  }, [secid, kLineApiSourceSetting]);

  // ---- 评分计算 ----
  // 大盘评分对比基准：优先市值风格板块（大盘/中盘/小盘/微盘股），无数据时回退所属指数
  const marketBaselineKlines = sizeBoardKlines && sizeBoardKlines.length ? sizeBoardKlines : indexKlines;
  const marketBaselineName = sizeBoardKlines && sizeBoardKlines.length ? sizeBoard?.name || indexName : indexName;
  const result = useMemo(() => {
    if (!dklines || dklines.length < 30) {
      return null;
    }
    const market = Score.scoreMarket(dklines, marketBaselineKlines || [], upRatioMap);
    const sector = Score.scoreSector(dklines, boardKlines, board?.name || '');
    const volume = Score.scoreStockVolume(dklines, marketStats, circMv);
    const rsi = Score.scoreStockRsi(dklines);
    const money = Score.scoreStockMoney(moneyFlow?.detail_main, moneyFlow?.detail_retail);
    const stockScore = Score.scoreStock(volume, rsi, money);
    const overall = Score.composeShortTermScore(market, sector, stockScore);
    return { overall, market, sector, stock: stockScore, volume, rsi, money };
  }, [dklines, indexKlines, upRatioMap, boardKlines, board, marketStats, circMv, moneyFlow, marketBaselineKlines]);

  if (dkLoading && !dklines) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin /> 短线评分数据加载中...
      </div>
    );
  }
  if (!result) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--secondary-text-color)' }}>
        <div style={{ marginBottom: 12 }}>
          {dkError
            ? `日K数据获取失败（${dkError}），请检查K线数据源设置或稍后重试`
            : dklines && dklines.length < 30
              ? `日K数据不足（${dklines.length}条，至少需要30条），无法计算短线评分`
              : '暂无日K数据，无法计算短线评分'}
        </div>
        <Button size="small" onClick={() => runGetDK()}>
          重试
        </Button>
      </div>
    );
  }

  const { overall, market, sector, stock, volume, rsi, money } = result;

  return (
    <div>
      {/* ==================== 综合评分卡 ==================== */}
      <div
        style={{
          padding: '12px 16px',
          borderRadius: 8,
          backgroundColor: 'var(--card-background-color)',
          border: '1px solid var(--border-color)',
        }}
      >
        <Row className={styles.rowheader} style={{ marginBottom: 12 }}>
          <Col span={20}>短线综合评分（参考周期：近期交易日，侧重短线交易）</Col>
          <Col span={4} style={{ textAlign: 'right' }}>
            <Tooltip
              title={
                <div style={{ whiteSpace: 'pre-line', fontSize: 12 }}>
                  {`综合评分 = 个股(50%) + 板块(30%) + 大盘(20%)，缺失维度按剩余权重归一化。
个股得分过低时触发一票否决（总分封顶${Score.SHORT_TERM_SCORE_CONFIG.vetoCap}）。
等级：A(≥80) / B(≥65) / C(≥50) / D(<50)`}
                </div>
              }
              placement="left"
            >
              <QuestionCircleOutlined style={{ color: 'var(--secondary-text-color)', cursor: 'help' }} />
            </Tooltip>
          </Col>
        </Row>
        <Row style={{ marginBottom: 8, alignItems: 'center' }}>
          <Col span={6}>综合评分</Col>
          <Col span={6}>
            <span style={{ fontSize: 28, fontWeight: 'bold', color: Score.scoreColor(overall.total) }}>
              {overall.total.toFixed(1)}
            </span>
            <span style={{ fontSize: 12, color: 'var(--secondary-text-color)' }}> / 100</span>
          </Col>
          <Col span={6}>评级 / 建议</Col>
          <Col span={6}>
            <span
              style={{
                fontSize: 20,
                fontWeight: 'bold',
                marginRight: 8,
                color: Score.scoreColor(overall.total),
              }}
            >
              {overall.grade}
            </span>
            <span style={{ fontSize: 12 }}>{overall.advice}</span>
          </Col>
        </Row>
        {[
          { label: '个股表现', weight: '权重50%', r: stock.score, available: stock.available, reason: stock.reason },
          { label: '板块表现', weight: '权重30%', r: sector.score, available: sector.available, reason: sector.reason },
          { label: '大盘表现', weight: '权重20%', r: market.score, available: market.available, reason: market.reason },
        ].map((dim) => (
          <Row key={dim.label} style={{ marginBottom: 6, fontSize: 13, alignItems: 'center' }}>
            <Col span={6}>
              {dim.label}
              <span style={{ fontSize: 11, color: 'var(--secondary-text-color)', marginLeft: 4 }}>{dim.weight}</span>
            </Col>
            <Col span={4} className={Utils.GetValueColor(dim.r).textClass}>
              {dim.available ? dim.r.toFixed(1) : '--'}
            </Col>
            <Col span={14}>
              {dim.available ? <ScoreBar value={dim.r} max={100} /> : <span style={{ fontSize: 11, color: 'var(--secondary-text-color)' }}>{dim.reason || '数据不足'}</span>}
            </Col>
          </Row>
        ))}
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--secondary-text-color)' }}>
          {overall.summary}
          {overall.degraded.length > 0 && <span style={{ marginLeft: 8 }}>（{overall.degraded.join('；')}）</span>}
        </div>
      </div>

      {/* ==================== 大盘表现明细 ==================== */}
      <div
        style={{
          marginTop: 12,
          padding: '12px 16px',
          borderRadius: 8,
          backgroundColor: 'var(--card-background-color)',
          border: '1px solid var(--border-color)',
        }}
      >
        <Row className={styles.rowheader} style={{ marginBottom: 8 }}>
          <Col span={20}>大盘表现评分（涨跌比 + 相对{marketBaselineName}表现，时间衰减加权）</Col>
          <Col span={4} style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 16, fontWeight: 'bold', color: Score.scoreColor(market.score) }}>
              {market.available ? market.score.toFixed(1) : '--'}
            </span>
          </Col>
        </Row>
        <Tooltip
          title={
            <div style={{ whiteSpace: 'pre-line', fontSize: 12 }}>
              {`按每日上涨家数占比判断市场强弱：
上涨占比≥${(Score.SHORT_TERM_SCORE_CONFIG.marketUpRatioThreshold * 100).toFixed(0)}%（偏强日）：
  个股收跌 → 低分(15~30)；个股上涨 → 与对比基准比较，跑赢加分
上涨占比<${(Score.SHORT_TERM_SCORE_CONFIG.marketUpRatioThreshold * 100).toFixed(0)}%（偏弱日）：
  个股上涨 → 超预期(80~88)；个股下跌 → 与对比基准比较，抗跌加分
对比基准为同类市值风格板块（${marketBaselineName}），缺失时回退所属指数。
最后按时间衰减加权平均（越近权重越高）。`}
            </div>
          }
          placement="right"
        >
          <span style={{ fontSize: 11, color: 'var(--secondary-text-color)', cursor: 'help' }}>
            评分规则 <QuestionCircleOutlined />
          </span>
        </Tooltip>
        {market.daily.length > 0 && (
          <Collapse ghost style={{ marginTop: 4 }}>
            <Collapse.Panel header={`近${market.daily.length}日逐日评分明细`} key="market">
              <Row className={styles.rowheader} style={{ marginBottom: 4 }}>
                <Col span={5}>日期</Col>
                <Col span={4}>上涨占比</Col>
                <Col span={5}>{marketBaselineName}</Col>
                <Col span={5}>个股涨幅</Col>
                <Col span={5}>当日得分</Col>
              </Row>
              {[...market.daily].reverse().map((d) => (
                <Row key={d.date} style={{ marginBottom: 3, fontSize: 12 }}>
                  <Col span={5}>{d.date.substring(5)}</Col>
                  <Col span={4} className={Utils.GetValueColor((d.upRatio ?? 0.5) - 0.5).textClass}>
                    {d.upRatio === null ? '--' : `${(d.upRatio * 100).toFixed(0)}%`}
                  </Col>
                  <Col span={5} className={Utils.GetValueColor(d.indexZdf ?? 0).textClass}>
                    {d.indexZdf === null ? '--' : `${d.indexZdf.toFixed(2)}%`}
                  </Col>
                  <Col span={5} className={Utils.GetValueColor(d.stockZdf).textClass}>
                    {d.stockZdf.toFixed(2)}%
                  </Col>
                  <Col span={5} style={{ color: d.score === null ? 'var(--secondary-text-color)' : Score.scoreColor(d.score) }}>
                    {d.score === null ? '--' : d.score.toFixed(0)}
                    {d.score !== null && <span style={{ fontSize: 10, color: 'var(--secondary-text-color)', marginLeft: 4 }}>{d.note}</span>}
                  </Col>
                </Row>
              ))}
            </Collapse.Panel>
          </Collapse>
        )}
      </div>

      {/* ==================== 板块表现明细 ==================== */}
      <div
        style={{
          marginTop: 12,
          padding: '12px 16px',
          borderRadius: 8,
          backgroundColor: 'var(--card-background-color)',
          border: '1px solid var(--border-color)',
        }}
      >
        <Row className={styles.rowheader} style={{ marginBottom: 8 }}>
          <Col span={20}>板块表现评分（{sector.boardName || '未识别板块'}）</Col>
          <Col span={4} style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 16, fontWeight: 'bold', color: Score.scoreColor(sector.score) }}>
              {sector.available ? sector.score.toFixed(1) : '--'}
            </span>
          </Col>
        </Row>
        {sector.available ? (
          <>
            <Row style={{ marginBottom: 4, fontSize: 12 }}>
              <Col span={6}>板块短期趋势</Col>
              <Col span={18}>{sector.trendDesc}</Col>
            </Row>
            <Row style={{ marginBottom: 4, fontSize: 12 }}>
              <Col span={6}>个股与板块关系</Col>
              <Col span={18}>{sector.relationDesc}</Col>
            </Row>
            <Row style={{ marginBottom: 4, fontSize: 12 }}>
              <Col span={6}>近10日涨幅对比</Col>
              <Col span={18}>
                <span className={Utils.GetValueColor(sector.stockZdf).textClass}>
                  个股 {sector.stockZdf.toFixed(2)}%
                </span>
                <span style={{ margin: '0 6px', color: 'var(--secondary-text-color)' }}>vs</span>
                <span className={Utils.GetValueColor(sector.boardZdf).textClass}>
                  板块 {sector.boardZdf.toFixed(2)}%
                </span>
                <span style={{ marginLeft: 8, color: 'var(--secondary-text-color)' }}>
                  （差值 {sector.diff >= 0 ? '+' : ''}{sector.diff.toFixed(2)}%）
                </span>
              </Col>
            </Row>
            <div style={{ fontSize: 11, color: 'var(--secondary-text-color)', marginTop: 4 }}>
              板块取自"核心交易-板块"页设置的活跃板块（未设置时自动取所属板块第一个）；趋同按涨幅差评分，正向背离（板块弱个股强）加分，负向背离减分
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--secondary-text-color)' }}>{sector.reason || '板块数据不足'}</div>
        )}
      </div>

      {/* ==================== 个股表现明细 ==================== */}
      <div
        style={{
          marginTop: 12,
          padding: '12px 16px',
          borderRadius: 8,
          backgroundColor: 'var(--card-background-color)',
          border: '1px solid var(--border-color)',
        }}
      >
        <Row className={styles.rowheader} style={{ marginBottom: 8 }}>
          <Col span={20}>个股表现评分（量能35 + RSI30 + 资金35）</Col>
          <Col span={4} style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 16, fontWeight: 'bold', color: Score.scoreColor(stock.score) }}>
              {stock.available ? stock.score.toFixed(1) : '--'}
            </span>
          </Col>
        </Row>
        {/* 量能 */}
        <Row style={{ marginBottom: 6, fontSize: 13, alignItems: 'center' }}>
          <Col span={10}>
            <Tooltip
              title={
                <div style={{ whiteSpace: 'pre-line', fontSize: 12 }}>
                  {`横向(60%)：个股5日日均成交额 / 同市值档（小盘<50亿/中盘50~200亿/大盘>200亿）平均成交额：
  ≥2倍满分，≥1.2倍80%，0.5倍以下0分
纵向(40%)：5日均量/20日均量，≥1.2倍视为放量：
  放量上涨+5分，缩量下跌-5分
无同类数据时降级为仅按自身量能趋势评分。`}
                </div>
              }
              placement="right"
            >
              <span>
                量能活跃度 <QuestionCircleOutlined style={{ color: 'var(--secondary-text-color)', fontSize: 12, cursor: 'help' }} />
              </span>
            </Tooltip>
          </Col>
          <Col span={6} className={Utils.GetValueColor(volume.score).textClass}>
            {volume.available ? `${volume.score.toFixed(1)}/${volume.max}` : '--'}
          </Col>
          <Col span={8}>
            {volume.available && <ScoreBar value={volume.score} max={volume.max} />}
          </Col>
        </Row>
        {volume.available && (
          <div style={{ fontSize: 11, color: 'var(--secondary-text-color)', marginBottom: 6 }}>
            {volume.note}
            {volume.degraded ? `（${volume.degraded}）` : ''}
          </div>
        )}
        {/* RSI */}
        <Row style={{ marginBottom: 6, fontSize: 13, alignItems: 'center' }}>
          <Col span={10}>
            <Tooltip
              title={
                <div style={{ whiteSpace: 'pre-line', fontSize: 12 }}>
                  {`先判定“格局”，再识别形态：
格局 = 回看60日内，最近一次【真实超买】(RSI6≥80，或≥72且处95%以上历史分位，且与24日线差值≥10) 与最近一次【真实超卖】(RSI6≤30且差值≤-10) 谁更靠后。
· 最近一次是超买 → 才可能判定“超买后回踩”
· 最近一次是超卖 → 之后的走势一律归为“超卖后反抽”（即使中途冲高再回落），不会被误判成超买回踩

评分（高→低）：
1. 超买后回踩24日线企稳 → 30分（最佳）
2. 超买后回落、临近24日线（回踩中）→ 26分
3. 超卖后6日线上穿24日线（金叉）→ 26分
4. 超卖上穿后回落至24日线附近整理 → 22分
5. 超卖反弹后回抽24日线（接近金叉）→ 20分
6. RSI多头排列强势区 → 20分
7. 超卖后反弹修复中（尚未金叉）→ 18分
8. 超卖上穿后跌回24日线下方（含刚下穿震荡）→ 16分
9. 超卖反弹后再度跌回24日线下方，结构转弱 → 12分
10. RSI空头排列弱势区 → 10分
11. 持续超买钝化 → 8分（追高风险）
12. 近期6日线下穿24日线（死叉）→ 6分`}
                </div>
              }
              placement="right"
            >
              <span>
                RSI指标(6/24) <QuestionCircleOutlined style={{ color: 'var(--secondary-text-color)', fontSize: 12, cursor: 'help' }} />
              </span>
            </Tooltip>
          </Col>
          <Col span={6} className={Utils.GetValueColor(rsi.score).textClass}>
            {rsi.available ? `${rsi.score.toFixed(1)}/${rsi.max}` : '--'}
          </Col>
          <Col span={8}>
            {rsi.available && <ScoreBar value={rsi.score} max={rsi.max} />}
          </Col>
        </Row>
        {rsi.available && (
          <div style={{ fontSize: 11, color: 'var(--secondary-text-color)', marginBottom: 6 }}>
            RSI6: {rsi.rsi6.toFixed(1)}（历史分位{(rsi.rsi6Percentile * 100).toFixed(0)}%），RSI24: {rsi.rsi24.toFixed(1)}；{rsi.pattern}
          </div>
        )}
        {/* 资金 */}
        <Row style={{ marginBottom: 6, fontSize: 13, alignItems: 'center' }}>
          <Col span={10}>
            <Tooltip
              title={
                <div style={{ whiteSpace: 'pre-line', fontSize: 12 }}>
                  {`基于主力/散户20日累计净流入曲线（与资金流向图同源）：
微笑曲线(U型)上穿散户线且0轴上方 → 30分（最佳）
主力20日净流入为正且强于散户 → 24分
微笑曲线尚未上穿 → 18~22分
方向不明 → 12~18分
悲伤曲线(倒U型) → 8分
悲伤曲线下穿散户线且0轴下方 → 3分（最差）`}
                </div>
              }
              placement="right"
            >
              <span>
                资金指标(20日) <QuestionCircleOutlined style={{ color: 'var(--secondary-text-color)', fontSize: 12, cursor: 'help' }} />
              </span>
            </Tooltip>
          </Col>
          <Col span={6} className={Utils.GetValueColor(money.score).textClass}>
            {money.available ? `${money.score.toFixed(1)}/${money.max}` : '--'}
          </Col>
          <Col span={8}>
            {money.available && <ScoreBar value={money.score} max={money.max} />}
          </Col>
        </Row>
        {money.available && (
          <div style={{ fontSize: 11, color: 'var(--secondary-text-color)' }}>
            主力20日: <span className={Utils.GetValueColor(money.main20).textClass}>{formatAmount(money.main20)}</span>
            <span style={{ margin: '0 6px' }}>|</span>
            散户20日: <span className={Utils.GetValueColor(money.retail20).textClass}>{formatAmount(money.retail20)}</span>
            <span style={{ margin: '0 6px' }}>|</span>
            {money.note}
          </div>
        )}
        {/* 资金流向趋势图（与资金流向 Tab 同源数据） */}
        {moneyFlow?.detail_dates?.length ? (
          <MoneyFlowChart
            detailMain={moneyFlow.detail_main || []}
            detailRetail={moneyFlow.detail_retail || []}
            detailMedium={moneyFlow.detail_medium || []}
            detailDates={moneyFlow.detail_dates}
          />
        ) : null}
      </div>
    </div>
  );
});

export default ShortTermScore;
