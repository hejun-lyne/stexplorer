import React, { useEffect, useState } from 'react';
import { Button, Col, Collapse, Row, Spin, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { useRequest } from 'ahooks';
import * as Utils from '@/utils';
import { StoreState } from '@/reducers/types';
import styles from '../../index.scss';
import * as Score from '@/helpers/shortTermScore';
import * as ScoreList from '@/helpers/shortTermScoreList';
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

const ShortTermScore: React.FC<ShortTermScoreProps> = React.memo(({ code, moneyFlow, circMv }) => {
  const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`;
  const indexName = code.startsWith('6') ? '上证指数' : code.startsWith('3') ? '创业板指' : '深证成指';

  // 用户在板块页手动设置的活跃板块（优先）
  const hybk = useSelector((store: StoreState) => store.stock.stockConfigsMapping[secid]?.hybk);
  // K线数据源设置（与主图同源，走多源兜底 + sqlite 缓存）
  const { kLineApiSourceSetting, ontrain, trainDate } = useSelector((state: StoreState) => state.setting.systemSetting);
  // 训练模式：按训练日期区分请求缓存，并在训练日期变化时重新取数（评分必须基于训练日期为止的数据）
  const trainKey = ontrain && trainDate ? trainDate : 'live';

  // ---- 评分（与 STList 批量评分 / 训练周期预计算共用同一套取数与评分逻辑，口径必然一致）----
  // 取数、板块选择、大盘对比基准（市值风格板块优先）全部在评分内核里完成，
  // 算完还会把该交易日的结果写回这只股票的评分序列，列表下次评分直接命中同一份数据。
  const [scoreData, setScoreData] = useState<Awaited<ReturnType<typeof ScoreList.computeStockScoreForCode>> | null>(
    null
  );
  const [scoreError, setScoreError] = useState<string | null>(null);
  const { run: runScore, loading: scoreLoading } = useRequest(
    async () => {
      const r = await ScoreList.computeStockScoreForCode({
        code,
        source: kLineApiSourceSetting,
        // 训练模式下按训练日期取数（评分必须基于训练日期为止的数据）
        date: ontrain && trainDate ? trainDate : undefined,
        circMv,
        moneyFlow,
        hybk: hybk || null,
      });
      if (!r || !r.detail) {
        // 抛错而不是返回空结果，避免空结果被 cacheKey 缓存导致重试失效
        throw new Error(r?.row?.error || '未获取到日K数据');
      }
      return r;
    },
    {
      manual: true,
      cacheKey: `ShortTermScore/${code}/${kLineApiSourceSetting}/${trainKey}`,
      onSuccess: (r) => {
        setScoreError(null);
        setScoreData(r);
      },
      onError: (e) => setScoreError(e?.message || '请求失败'),
      throwOnError: false,
    }
  );

  useEffect(() => {
    setScoreData(null);
    setScoreError(null);
    runScore();
  }, [code, kLineApiSourceSetting, trainKey, circMv, moneyFlow]);

  const dklines = scoreData?.klines || null;
  const result = scoreData?.detail || null;
  // 大盘评分对比基准名称：市值风格板块优先，缺失时回退所属指数（由评分内核决定）
  const marketBaselineName = scoreData?.baselineName || indexName;

  if (scoreLoading && !dklines) {
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
          {scoreError
            ? `评分失败（${scoreError}），请检查K线数据源设置或稍后重试`
            : dklines && dklines.length < 30
              ? `日K数据不足（${dklines.length}条，至少需要30条），无法计算短线评分`
              : '暂无日K数据，无法计算短线评分'}
        </div>
        <Button size="small" onClick={() => runScore()}>
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
          <Col span={20}>个股表现评分（量能20 + 资金60；RSI 仅计算与展示，不计入加权）</Col>
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
                  {`权重 0：短线评分定位是「选股」而非「择时」，RSI 仍照常计算与展示，但不参与个股综合分。

先判定“格局”，再识别形态：
格局 = 回看60日内，最近一次【真实超买】(RSI6≥80，或≥72且处95%以上历史分位，且与24日线差值≥10) 与最近一次【真实超卖】(RSI6≤30且差值≤-10) 谁更靠后。
· 最近一次是超买 → 才可能判定“超买后回踩”
· 最近一次是超卖 → 之后的走势一律归为“超卖后反抽”（即使中途冲高再回落），不会被误判成超买回踩

交叉时效（两条都要满足）：
① 交叉本身须在 3 个交易日内（形态会标注“当日/1日前/2日前/3日前”），过期后按当前均线排列判定；
② “超卖后金叉”还要求：从上穿日往回倒推 5 个交易日内出现过真实超卖状态——超卖早已过去（区间内 6/24 线
   反复缠绕）的上穿只是普通交叉，不加分（形态标注“非超卖反转，不加分”）。

评分（高→低，满分40，仅作参考展示，不计入个股综合分）：
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

超买追高衰减（避免买在高点，两段式）：以上第1~6项等"偏多形态"成立时——
 · 偏高区：RSI6 > 68 起每高 1 点扣 1.5 分（到 80 累计扣 18 分）
 · 超买区：RSI6 ≥ 80 后每高 1 点再扣 2.5 分
 · 下限 10 分
例（金叉，形态分35）：RSI6=72 → 29；75 → 24.5；78 → 20；80 → 17；82 → 12；≥85 → 10。
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
            <span style={{ marginLeft: 6 }}>（该分值仅展示，不计入个股综合分）</span>
          </div>
        )}
        {/* 资金 */}
        <Row style={{ marginBottom: 6, fontSize: 13, alignItems: 'center' }}>
          <Col span={10}>
            <Tooltip
              title={
                <div style={{ whiteSpace: 'pre-line', fontSize: 12 }}>
                  {`基于主力/散户20日累计净流入曲线（与资金流向图同源），满分30；按「是否处在趋势转折点」排队：
完美微笑曲线(U型)上穿散户线且站上0轴 → 20~30分 ★（当日金叉最高，随天数衰减）
近期上穿散户线（形态未识别为U型）→ 12~22分（站上0轴更高）
微笑曲线（资金回流）但尚未上穿 → 15分（转折前夜，等待确认）
主力净流入为正且强于散户、但近期无金叉 → 13分；若资金已在区间高位(≥72%) → 7分（已过转折点，谨防追高）
主力净流入为正但弱于散户（资金分歧）→ 9分
方向不明 → 11分
倒U型 → 6分；倒U型下穿散户线且在0轴下方 → 最低分（最差）`}
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
