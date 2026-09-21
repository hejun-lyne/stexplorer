import React, { useEffect, useMemo, useState } from 'react';
import { Button, Col, Collapse, Row, Spin, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { useRequest } from 'ahooks';
import dayjs from 'dayjs';
import * as Services from '@/services';
import * as Utils from '@/utils';
import { StoreState } from '@/reducers/types';
import { Stock } from '@/types/stock';
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
  const { kLineApiSourceSetting, ontrain, trainDate } = useSelector((state: StoreState) => state.setting.systemSetting);
  // 训练模式：按训练日期区分请求缓存，并在训练日期变化时重新取数（评分必须基于训练日期为止的数据）
  const trainKey = ontrain && trainDate ? trainDate : 'live';

  // ---- 个股日K（自取250日，保证RSI历史分位足够；统一走数据源设置） ----
  const [dklines, setDklines] = useState<Stock.KLineItem[] | null>(null);
  const [dkError, setDkError] = useState<string | null>(null);
  const { run: runGetDK, loading: dkLoading } = useRequest(
    async () => {
      const r = await Services.Stock.GetKFromSetting(secid, KLineType.Day, 250);
      if (r?.ks?.length) {
        return r.ks;
      }
      // 抛错而不是返回空数组，避免空结果被 cacheKey 缓存导致重试失效
      throw new Error('未获取到日K数据');
    },
    {
      manual: true,
      cacheKey: `ShortTermK/${secid}/${kLineApiSourceSetting}/${trainKey}`,
      onSuccess: (ks) => {
        setDkError(null);
        setDklines(ks);
      },
      onError: (e) => setDkError(e?.message || '请求失败'),
      throwOnError: false,
    },
  );

  // ---- 所属指数日K（统一走数据源设置） ----
  const [indexKlines, setIndexKlines] = useState<Stock.KLineItem[] | null>(null);
  const { run: runGetIndexK } = useRequest(
    async () => {
      const r = await Services.Stock.GetKFromSetting(indexSecid, KLineType.Day, 60);
      return r?.ks || [];
    },
    {
      manual: true,
      cacheKey: `ShortTermIndex/${indexSecid}/${kLineApiSourceSetting}/${trainKey}`,
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

    // 板块 BK 代码在不同数据源命名空间并不一致（例：「轻工制造」在 tushare 是 BK1212，
    // 而 BK1643 在 tushare 是「小盘股」）。统一按「名称」在当前数据源的板块列表里解析代码，
    // 避免出现「名称与代码错配」而取不到数据。
    const cleanBoardName = (name: string) => String(name || '').replace(/[，,]\s*BK\d+\s*$/i, '').trim();
    const resolveBoardCode = (name: string): Promise<string> =>
      Services.Stock.ResolveBoardCodeByName(name, kLineApiSourceSetting);
    // 训练模式：探测板块在训练日期附近是否仍有真实行情（不使用成分股合成值）
    const hasRealDataNear = async (code: string): Promise<boolean> => {
      if (!code) {
        return false;
      }
      try {
        const r = await Services.Stock.GetKFromSetting(`90.${code}`, KLineType.Day, 30, { allowSynthesis: false });
        const ks = r && r.ks ? r.ks : [];
        const lastDate = ks.length ? String(ks[ks.length - 1].date).substring(0, 10) : '';
        return !!lastDate && Math.abs(dayjs(trainDate).diff(dayjs(lastDate), 'day')) <= 15;
      } catch (e) {
        return false;
      }
    };

    // 非训练模式：已配置板块优先（显示时去掉名字里附带的代码）
    if (hybk && !(ontrain && trainDate)) {
      setBoard({ code: hybk.code, name: cleanBoardName(hybk.name) });
    }

    Services.Stock.GetStockBankuaisFromEastmoney(secid)
      .then(async (list: any[]) => {
        const boards: any[] = Array.isArray(list) ? list : [];

        if (ontrain && trainDate) {
          // 候选：已配置板块优先，其次所属板块；逐个按名称解析代码并探测训练日附近是否有真实数据
          const candidates: { code: string; name: string }[] = [];
          if (hybk) {
            candidates.push({ code: hybk.code, name: hybk.name });
          }
          boards.forEach((b) => {
            if (b && b.code && !candidates.some((c) => c.code === b.code)) {
              candidates.push({ code: b.code, name: b.name });
            }
          });

          let picked: { code: string; name: string } | null = null;
          for (const c of candidates.slice(0, 10)) {
            const resolved = (await resolveBoardCode(c.name)) || c.code;
            if (await hasRealDataNear(resolved)) {
              picked = { code: resolved, name: cleanBoardName(c.name) || c.name };
              break;
            }
          }

          if (picked) {
            const configuredCode = hybk ? (await resolveBoardCode(hybk.name)) || hybk.code : '';
            if (configuredCode && picked.code !== configuredCode) {
              console.warn(
                `[短线评分] 已配置板块「${cleanBoardName(hybk?.name || '')}」(${configuredCode}) 在训练日 ${trainDate} 无数据，改用「${picked.name}」(${picked.code})`
              );
            }
            setBoard(picked);
          } else {
            console.warn(`[短线评分] ${secid} 在训练日 ${trainDate} 附近没有可用历史的板块，板块相对强度不参与评分`);
            if (hybk) {
              setBoard({ code: hybk.code, name: cleanBoardName(hybk.name) });
            } else if (boards.length) {
              setBoard({ code: boards[0].code, name: boards[0].name });
            }
          }
        } else if (!hybk && boards.length) {
          setBoard({ code: boards[0].code, name: boards[0].name });
        }

        // 市值风格板块（大盘/中盘/小盘/微盘）：代码同样按名称解析，避免命名空间不一致
        const size = boards.find((b: any) => SIZE_BOARD_NAMES.includes(b.name));
        if (size) {
          const sizeCode = (await resolveBoardCode(size.name)) || size.code;
          setSizeBoard({ code: sizeCode, name: size.name });
        }
      })
      .catch(() => undefined);
  }, [secid, hybk, trainKey, kLineApiSourceSetting]);

  // ---- 板块日K（统一走数据源设置；评分基准只用真实板块数据，不用成分股合成的近似值） ----
  const fetchBoardKlines = async (boardCode: string): Promise<Stock.KLineItem[]> => {
    const r = await Services.Stock.GetKFromSetting(`90.${boardCode}`, KLineType.Day, 60, { allowSynthesis: false });
    return r?.ks || [];
  };
  const [boardKlines, setBoardKlines] = useState<Stock.KLineItem[] | null>(null);
  useEffect(() => {
    setBoardKlines(null);
    if (board) {
      fetchBoardKlines(board.code).then(setBoardKlines).catch(() => setBoardKlines([]));
    }
  }, [board, kLineApiSourceSetting, trainKey]);

  // ---- 市值风格板块日K（大盘评分对比基准，失败时回退所属指数） ----
  const [sizeBoardKlines, setSizeBoardKlines] = useState<Stock.KLineItem[] | null>(null);
  useEffect(() => {
    setSizeBoardKlines(null);
    if (sizeBoard) {
      fetchBoardKlines(sizeBoard.code).then(setSizeBoardKlines).catch(() => setSizeBoardKlines([]));
    }
  }, [sizeBoard, kLineApiSourceSetting, trainKey]);

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
  }, [secid, kLineApiSourceSetting, trainKey]);

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
                  {`综合评分 = 个股(${(Score.SHORT_TERM_SCORE_CONFIG.weights.stock * 100).toFixed(0)}%) + 板块(${(
                    Score.SHORT_TERM_SCORE_CONFIG.weights.sector * 100
                  ).toFixed(0)}%) + 大盘(${(Score.SHORT_TERM_SCORE_CONFIG.weights.market * 100).toFixed(0)}%)，缺失维度按剩余权重归一化。
板块维度以"个股相对板块的相对强度"为主（板块自身强弱只作窄区间背景），避免高分股票集中在当前最强板块。
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
        {/* 评分数据截止：训练模式下即为训练日期，便于一眼核对评分是否使用了未来数据 */}
        {dklines && dklines.length > 0 && (
          <Row style={{ marginBottom: 8, fontSize: 12, color: 'var(--secondary-text-color)' }}>
            <Col span={6}>数据截止</Col>
            <Col span={18}>
              {dklines[dklines.length - 1].date}
              {ontrain && trainDate ? `（训练日 ${trainDate}）` : ''}
            </Col>
          </Row>
        )}
        {[
          { label: '个股表现', weight: `权重${(Score.SHORT_TERM_SCORE_CONFIG.weights.stock * 100).toFixed(0)}%`, r: stock.score, available: stock.available, reason: stock.reason },
          { label: '板块表现', weight: `权重${(Score.SHORT_TERM_SCORE_CONFIG.weights.sector * 100).toFixed(0)}%`, r: sector.score, available: sector.available, reason: sector.reason },
          { label: '大盘表现', weight: `权重${(Score.SHORT_TERM_SCORE_CONFIG.weights.market * 100).toFixed(0)}%`, r: market.score, available: market.available, reason: market.reason },
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
          <Col span={20}>板块/相对强度评分（{sector.boardName || '未识别板块'}）</Col>
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
            {sector.relScore != null && (
              <Row style={{ marginBottom: 4, fontSize: 12 }}>
                <Col span={6}>个股相对强度</Col>
                <Col span={18}>
                  {sector.relScore.toFixed(1)}
                  <span style={{ marginLeft: 6, color: 'var(--secondary-text-color)' }}>
                    （10日超额 {sector.diff >= 0 ? '+' : ''}{sector.diff.toFixed(2)}%）
                  </span>
                </Col>
              </Row>
            )}
            {sector.envScore != null && (
              <Row style={{ marginBottom: 4, fontSize: 12 }}>
                <Col span={6}>板块环境分（背景）</Col>
                <Col span={18}>
                  {sector.envScore.toFixed(1)}
                  {sector.positionDesc ? (
                    <span style={{ marginLeft: 6, color: 'var(--secondary-text-color)' }}>{sector.positionDesc}</span>
                  ) : null}
                  {sector.trendPenalty ? (
                    <span style={{ marginLeft: 6, color: '#faad14' }}>已偏离反转点，追高下调 {sector.trendPenalty.toFixed(0)} 分</span>
                  ) : null}
                </Col>
              </Row>
            )}
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
              板块取自"核心交易-板块"页设置的活跃板块（未设置时自动取所属板块第一个）。
              本维度 = 相对强度(
              {(Score.SHORT_TERM_SCORE_CONFIG.sectorRelWeight * 100).toFixed(0)}%
              ，个股10日涨幅相对板块的超额 + 是否站上自身20日线) + 板块环境(
              {((1 - Score.SHORT_TERM_SCORE_CONFIG.sectorRelWeight) * 100).toFixed(0)}%
              ，板块趋势按"离反转点位置"择时后压缩到窄区间作背景)。
              这样同一板块的股票不会被板块整体强弱一起抬分，只有相对板块更强（且自身在20日线上方）的个股才加分
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
          <Col span={20}>个股表现评分（量能30 + RSI40 + 资金30）</Col>
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
                  {`横向(60%)：个股5日平均【换手率】/ 同市值档（小盘<50亿/中盘50~200亿/大盘>200亿）平均换手率：
  ≥2倍满分，≥1.2倍80%，0.5倍以下0分
  （换手率比成交额更能反映同市值档内的活跃度：成交额会被股价高低与流通盘大小干扰；
    个别数据源换手率缺失时回退成交额口径）
纵向(40%)：5日均量/20日均量，≥1.2倍视为放量：
  放量上涨+5分，缩量下跌-5分

择时位置修正（找买点，与板块同逻辑）：量能刚由萎缩转为温和放量分最高，以下情况下调——
 · 成交额/同类均值 > 2倍（过热）：每超1倍扣6分
 · 自放量启动日涨幅 > 8%（已走远）：每超1%扣1.5分（无启动日时退化为近5日涨幅）
 · 距放量启动日 > 5日且放量仍在持续：每多1日扣1分
  放量启动日 = 近20日内首个「5日均量/20日均量 ≥ 1.3」的交易日
衰减下限5分。无同类数据时降级为仅按自身量能趋势评分。`}
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

交叉时效（两条都要满足）：
① 交叉本身须在 3 个交易日内（形态会标注“当日/1日前/2日前/3日前”），过期后按当前均线排列判定；
② “超卖后金叉”还要求：从上穿日往回倒推 5 个交易日内出现过真实超卖状态——超卖早已过去（区间内 6/24 线
   反复缠绕）的上穿只是普通交叉，不加分（形态标注“非超卖反转，不加分”）。

评分（高→低，满分40，为个股权重最高的择时项）：
1. 超买后回踩24日线企稳 → 40分（最佳）
2. 超买后回落、临近24日线（回踩中）→ 35分
3. 超卖后3日内6日线上穿24日线（金叉）→ 35分
4. 上穿后回落至24日线附近整理（金叉待确认）→ 29分
5. 6日线回抽24日线（接近金叉，尚未穿越）/ RSI多头排列强势区 / 非超卖反转的普通上穿 → 27分
6. 超卖后反弹修复中（尚未金叉）→ 24分
7. 上穿后跌回24日线下方（金叉失效）/ 反弹结构中死叉贴线震荡 → 21分
8. 反弹结构中6日线再度跌回24日线下方，结构转弱 → 16分
9. RSI空头排列弱势区 → 13分
10. 持续超买钝化 → 11分（追高风险）
11. 3日内6日线下穿24日线（死叉）→ 8分

超买追高衰减（避免买在高点）：以上第1~6项等"偏多形态"成立时，若 RSI6 已偏高/超买，
按超出点数下调：RSI6 > 72 起每高 1 点扣 1 分（RSI6=80 扣 8 分，85 扣 13 分），下限 10 分。
死叉/空头排列/持续超买钝化本就低分，不再叠加。`}
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
                  {`基于主力/散户20日累计净流入曲线（与资金流向图同源），满分30：
微笑曲线(U型)上穿散户线且0轴上方 → 最高25分（最佳）
主力20日净流入为正且强于散户 → 21~24分
微笑曲线尚未上穿 → 15分
方向不明 → 10~15分
悲伤曲线(倒U型) → 7分
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
