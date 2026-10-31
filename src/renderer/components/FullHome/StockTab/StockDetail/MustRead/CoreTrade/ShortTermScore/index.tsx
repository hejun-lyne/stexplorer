import React, { useEffect, useMemo, useRef, useState } from 'react';
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

/** 「近 N 个交易日评分」历史条展示的交易日数量 */
const RECENT_SCORE_DAYS = 20;

/** 详情页评分入口的返回类型（去掉 null） */
type ScoreComputeResult = NonNullable<Awaited<ReturnType<typeof ScoreList.computeStockScoreForCode>>>;

/** YYYYMMDD -> YYYY-MM-DD（非法输入原样返回） */
const formatDay = (day?: string) =>
  day && /^\d{8}$/.test(day) ? `${day.substring(0, 4)}-${day.substring(4, 6)}-${day.substring(6, 8)}` : day || '--';

/** 卡片容器样式（三张明细卡 / 评分行卡共用） */
const cardStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: 8,
  backgroundColor: 'var(--card-background-color)',
  border: '1px solid var(--border-color)',
};

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

/**
 * 「近 N 个交易日评分」历史条
 *
 * 数据源与列表「短线评分」的历史列完全一致（评分序列），因此这里看到的分数
 * 就是从列表点进来时的同一份缓存；点击某个交易日即可切换到该交易日的明细。
 */
const DayScoreStrip = ({
  days,
  series,
  errors,
  viewDay,
  baseDayKey,
  loadingDay,
  missingCount,
  failedCount,
  computingMissing,
  computingProgress,
  onSelect,
  onBackToBase,
  onComputeMissing,
}: {
  days: string[];
  series: Record<string, ScoreList.ShortTermScoreRow>;
  /** 各交易日的计算失败原因（交易日 -> 原因） */
  errors: Record<string, string>;
  viewDay: string;
  baseDayKey: string;
  /** 正在按需计算明细的交易日（用于在条上提示进度） */
  loadingDay: string;
  /** 还没有评分缓存（且未现算）的交易日数量 */
  missingCount: number;
  /** 缺失交易日里已尝试取数、但计算失败的数量 */
  failedCount: number;
  /** 是否正在批量补算缺失交易日 */
  computingMissing: boolean;
  /** 批量补算进度 */
  computingProgress: { done: number; total: number } | null;
  onSelect: (day: string) => void;
  onBackToBase: () => void;
  /** 没有评分缓存的交易日：发起计算 */
  onComputeMissing: () => void;
}) => (
  <div style={cardStyle}>
    <Row className={styles.rowheader} style={{ marginBottom: 6 }}>
      <Col span={16}>近 {days.length} 个交易日评分（点击交易日可查看当日明细）</Col>
      <Col span={8} style={{ textAlign: 'right' }}>
        <span style={{ fontSize: 11, color: 'var(--secondary-text-color)' }}>
          当前查看 {formatDay(viewDay)}
          {viewDay && viewDay === baseDayKey ? '（评分基准日）' : ''}
        </span>
        {viewDay && baseDayKey && viewDay !== baseDayKey ? (
          <Button size="small" type="link" style={{ padding: '0 0 0 6px' }} onClick={onBackToBase}>
            回到基准日
          </Button>
        ) : null}
      </Col>
    </Row>
    <div style={{ display: 'flex', gap: 2, overflowX: 'auto', paddingBottom: 2 }}>
      {days.map((d) => {
        const row = series[d];
        const v = row && row.total != null ? row.total : null;
        const isActive = d === viewDay;
        const isBase = !!baseDayKey && d === baseDayKey;
        const isLoading = loadingDay === d;
        const note = row
          ? row.notListed
            ? '（评分基准日尚未上市）'
            : row.pending
              ? '（数据未就绪）'
              : row.intraday
                ? '（当日K线由分时补全）'
                : ''
          : '（无评分缓存）';
        return (
          <div
            key={d}
            onClick={() => onSelect(d)}
            title={`${formatDay(d)}：${v == null ? '--' : v.toFixed(1)} ${row?.grade || ''}${note}${
              isBase ? '｜评分基准日' : ''
            }${isLoading ? '｜正在计算该交易日明细…' : ''}${
              errors[d] ? `｜计算失败：${errors[d]}` : ''
            }`}
            style={{
              flex: '0 0 auto',
              minWidth: 48,
              padding: '4px 4px',
              textAlign: 'center',
              cursor: 'pointer',
              borderRadius: 6,
              border: `1px solid ${isActive ? '#1890ff' : isBase ? 'var(--border-color)' : 'transparent'}`,
              backgroundColor: isActive ? 'rgba(24,144,255,0.12)' : 'transparent',
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--secondary-text-color)' }}>
              {`${d.substring(4, 6)}-${d.substring(6, 8)}`}
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 'bold',
                color: v == null ? 'var(--reverse-text-color)' : Score.scoreColor(v),
              }}
            >
              {v == null ? '--' : v.toFixed(0)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--secondary-text-color)' }}>{row?.grade || '\u00a0'}</div>
          </div>
        );
      })}
    </div>
    {/* 没有评分缓存的交易日：给出一键补算入口（逐日现取数计算并写回评分序列） */}
    {missingCount > 0 || computingMissing ? (
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--secondary-text-color)' }}>
          {computingMissing && computingProgress
            ? `正在逐日补算 ${computingProgress.done}/${computingProgress.total}...`
            : `有 ${missingCount} 个交易日没有评分缓存${
                failedCount > 0 ? `，其中 ${failedCount} 个计算失败（悬停单元格可看原因）` : ''
              }`}
        </span>
        <Button
          size="small"
          style={{ marginLeft: 8 }}
          loading={computingMissing}
          disabled={computingMissing}
          onClick={onComputeMissing}
        >
          计算缺失的交易日
        </Button>
      </div>
    ) : null}
  </div>
);

/**
 * 评分行卡（只有序列里的评分行、没有完整明细时展示）
 *
 * 内容与列表「短线评分」的一行完全对应：综合分 / 评级 / 各维度分 / 评语。
 */
const RowSummaryCard = ({
  row,
  day,
  note,
  hint,
  computeText,
  onComputeDetail,
  computing,
  computeDisabled,
  error,
}: {
  row: ScoreList.ShortTermScoreRow;
  day: string;
  note?: string;
  hint?: string;
  computeText?: string;
  onComputeDetail?: () => void;
  computing?: boolean;
  computeDisabled?: boolean;
  error?: string;
}) => {
  const dims = [
    { label: '个股表现', weight: Score.SHORT_TERM_SCORE_CONFIG.weights.stock, score: row.stockScore },
    { label: '板块表现', weight: Score.SHORT_TERM_SCORE_CONFIG.weights.sector, score: row.sectorScore },
    { label: '大盘表现', weight: Score.SHORT_TERM_SCORE_CONFIG.weights.market, score: row.marketScore },
  ];
  return (
    <div style={cardStyle}>
      <Row className={styles.rowheader} style={{ marginBottom: 12 }}>
        <Col span={16}>短线综合评分（评分基准日 {formatDay(day)}）</Col>
        <Col span={8} style={{ textAlign: 'right' }}>
          <span style={{ fontSize: 11, color: 'var(--secondary-text-color)' }}>{note || '与列表「短线评分」同一份缓存'}</span>
        </Col>
      </Row>
      <Row style={{ marginBottom: 8, alignItems: 'center' }}>
        <Col span={6}>综合评分</Col>
        <Col span={6}>
          <span style={{ fontSize: 28, fontWeight: 'bold', color: Score.scoreColor(row.total ?? 0) }}>
            {row.total == null ? '--' : (row.total ?? 0).toFixed(1)}
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
              color: Score.scoreColor(row.total ?? 0),
            }}
          >
            {row.grade || '--'}
          </span>
          <span style={{ fontSize: 12 }}>{row.advice || '--'}</span>
        </Col>
      </Row>
      {dims.map((dim) => (
        <Row key={dim.label} style={{ marginBottom: 6, fontSize: 13, alignItems: 'center' }}>
          <Col span={6}>
            {dim.label}
            <span style={{ fontSize: 11, color: 'var(--secondary-text-color)', marginLeft: 4 }}>
              权重{(dim.weight * 100).toFixed(0)}%
            </span>
          </Col>
          <Col span={4} className={dim.score == null ? '' : Utils.GetValueColor(dim.score - 50).textClass}>
            {dim.score == null ? '--' : dim.score.toFixed(1)}
          </Col>
          <Col span={14}>
            {dim.score == null ? (
              <span style={{ fontSize: 11, color: 'var(--secondary-text-color)' }}>数据不足（未参与加权）</span>
            ) : (
              <ScoreBar value={dim.score} max={100} />
            )}
          </Col>
        </Row>
      ))}
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--secondary-text-color)' }}>
        {row.summary}
        {row.rsiPattern ? `｜RSI：${row.rsiPattern}` : ''}
        {row.moneyNote ? `｜资金：${row.moneyNote}` : ''}
        {row.sectorTrend ? `｜板块：${row.sectorTrend}` : ''}
      </div>
      {row.klineShape ? (
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--secondary-text-color)' }}>
          最新交易日K线：{row.klineShape}
          {`（${row.klineYin ? '阴线' : '阳线'}）`}
          {row.klineSize != null ? `｜实体 ${row.klineSize.toFixed(2)}倍平均` : ''}
          {row.volumeExpanded ? '｜放量' : ''}
          {row.intraday ? '｜当日K线由分时补全' : ''}
        </div>
      ) : null}
      {row.notListed ? (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--secondary-text-color)' }}>
          评分基准日尚未上市{row.listDate ? `（上市日期 ${formatDay(row.listDate)}）` : ''}：不计分、不取数
        </div>
      ) : null}
      {row.pending ? (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--secondary-text-color)' }}>
          {row.error || '当日数据尚未就绪，未写入缓存'}
        </div>
      ) : null}
      {row.error && !row.pending ? (
        <div style={{ marginTop: 6, fontSize: 12, color: '#ff4d4f' }}>{row.error}（该交易日按 0 分计入缓存）</div>
      ) : null}
      {onComputeDetail ? (
        <div style={{ marginTop: 10 }}>
          <Button size="small" onClick={onComputeDetail} loading={computing} disabled={computeDisabled}>
            {computeText || '现取数计算该交易日明细'}
          </Button>
          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--secondary-text-color)' }}>
            {hint || '现取数展开逐日明细，并覆盖该交易日的缓存'}
          </span>
        </div>
      ) : null}
      {error ? <div style={{ marginTop: 6, fontSize: 12, color: '#ff4d4f' }}>明细计算失败：{error}</div> : null}
    </div>
  );
};

/**
 * 完整评分明细卡（综合评分 / 大盘 / 板块 / 个股三部分）
 *
 * 基准日与历史交易日的明细渲染完全共用这一个组件，只是传入的明细、K线与基准日不同。
 */
const ScoreDetailCards = ({
  detail,
  klines,
  baselineName,
  scoreDayKey,
  trainText,
  moneyFlow,
  showMoneyChart,
  onRecompute,
  recomputeLoading,
  recomputeDisabled,
  recomputeHint,
}: {
  detail: ScoreList.ShortTermScoreDetail;
  klines?: ScoreComputeResult['klines'];
  baselineName: string;
  scoreDayKey: string;
  trainText?: string;
  moneyFlow?: ShortTermScoreProps['moneyFlow'];
  showMoneyChart?: boolean;
  onRecompute?: () => void;
  recomputeLoading?: boolean;
  recomputeDisabled?: boolean;
  recomputeHint?: string;
}) => {
  const { overall, market, sector, stock, volume, rsi, money } = detail;

  return (
    <div>
      {/* ==================== 综合评分卡 ==================== */}
      <div style={cardStyle}>
        <Row className={styles.rowheader} style={{ marginBottom: 12 }}>
          <Col span={20}>
            短线综合评分（评分基准日 {formatDay(scoreDayKey)}
            {trainText || ''}｜参考周期：近期交易日，侧重短线交易）
          </Col>
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
        {klines && klines.length > 0 && (
          <Row style={{ marginBottom: 8, fontSize: 12, color: 'var(--secondary-text-color)' }}>
            <Col span={6}>数据截止</Col>
            <Col span={18}>
              {klines[klines.length - 1].date}
              {trainText || ''}
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
        {onRecompute ? (
          <div style={{ marginTop: 10 }}>
            <Button size="small" onClick={onRecompute} loading={recomputeLoading} disabled={recomputeDisabled}>
              重新计算明细
            </Button>
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--secondary-text-color)' }}>
              {recomputeHint || '重新计算会现取数据、展开逐日明细，并覆盖该交易日的缓存'}
            </span>
          </div>
        ) : null}
      </div>

      {/* ==================== 大盘表现明细 ==================== */}
      <div style={{ ...cardStyle, marginTop: 12 }}>
        <Row className={styles.rowheader} style={{ marginBottom: 8 }}>
          <Col span={20}>大盘表现评分（涨跌比 + 相对{baselineName}表现，时间衰减加权）</Col>
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
对比基准为同类市值风格板块（${baselineName}），缺失时回退所属指数。
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
                <Col span={5}>{baselineName}</Col>
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
      <div style={{ ...cardStyle, marginTop: 12 }}>
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
      <div style={{ ...cardStyle, marginTop: 12 }}>
        <Row className={styles.rowheader} style={{ marginBottom: 8 }}>
          <Col span={20}>个股表现评分（量能20 + 资金60；RSI 不计权，但超买/钝化时对个股维度封顶）</Col>
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
  【当日倍量突破】当日量能（换手率优先，缺失回退成交量）/ 前5日均量 ≥ 2倍：
    按单日实际倍数补足纵向分（5日/20日均量会把单日放量稀释掉），并视作放量启动日（距启动0日）

择时位置修正（找买点，与板块同逻辑）：量能刚由萎缩转为温和放量分最高，以下情况下调——
 · 5日换手率/同类均值 > ${Score.SHORT_TERM_SCORE_CONFIG.volRatioAllow}倍（过热）：每超1倍扣6分
   当日倍量突破时改用「单日倍数 > ${Score.SHORT_TERM_SCORE_CONFIG.volBreakoutHotRatio}倍」判断，避免把刚启动的放量当成过热
 · 自放量启动日涨幅 > ${Score.SHORT_TERM_SCORE_CONFIG.volRiseAllow}%（已走远）：每超1%扣1.5分（无启动日/当日启动时退化为近5日涨幅）
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

形态只描述**当日**的 RSI(6/24) 结构，不记录“X日前金叉”这类历史天数。
格局（回看60日）：最近一次【真实超买】(RSI6≥80，或≥72且处95%以上历史分位，且与24日线差值≥10) 与
最近一次【真实超卖】(RSI6 ≤ 该股「深跌口径」且与24日线差值≤-10) 谁更靠后——只有最近是超买才判“超买回踩”，
避免“超卖后反抽一路冲高再回落”被误判成超买回踩。

「深跌口径」（逐股动态）：近250日 RSI6 局部低点（±3 交易日内最小、且 ≤55）的中位数 + 2 容差，夹在 [30, 42]。

类型与分值（满分40，仅作参考展示，不计入个股综合分）：
1. 超买回踩企稳 → 40分：超买后回落至24日线附近，当日 RSI6 回升（最佳）
2. 超买回踩中 → 35分：同上，当日仍回落
3. 超卖反转 → 35分：当日6日线上穿24日线，且近10日内曾跌破「深跌口径」
4. 金叉 → 27分：当日6日线上穿24日线（普通上穿）
5. 多头排列 → 27分：6日线在24日线上方，当日无新交叉、无回踩
6. 金叉在即 → 25分：6日线仍在24日线下方，差值收窄到5以内、当日继续收敛且 RSI6 回升
7. 修复中 → 20分：深跌后当日 RSI6 回升≥5 且差值收敛，但离24日线仍 >5
8. 死叉 → 13分：当日6日线下穿24日线
9. 空头排列 → 13分：6日线在24日线下方，且无修复 / 金叉在即信号
10. 超买钝化 → 11分：连续5日 RSI6 > 80 且差值 > 15（追高风险）

超买追高衰减（避免买在高点，两段式）：第1~7档等"偏多形态"成立时——
 · 偏高区：RSI6 > 68 起每高 1 点扣 1.5 分（到 80 累计扣 18 分）
 · 超买区：RSI6 ≥ 80 后每高 1 点再扣 2.5 分
 · 下限 10 分
死叉/空头排列/超买钝化本就低分，不再叠加。

追高护栏（个股维度封顶，避免"量能+资金双满分"把顶部推到A级）：
 · RSI6 ≥ 80 或「超买钝化」→ 个股维度 ≤ ${Score.SHORT_TERM_SCORE_CONFIG.rsiOverboughtCap}
 · RSI6 ≥ 68（偏高）→ 个股维度 ≤ ${Score.SHORT_TERM_SCORE_CONFIG.rsiHighCap}
 · 例外：「超买回踩企稳/回踩中」是从超买回落后的买点，不封顶`}
                </div>
              }
              placement="right"
            >
              <span>
                RSI指标(6/12/24) <QuestionCircleOutlined style={{ color: 'var(--secondary-text-color)', fontSize: 12, cursor: 'help' }} />
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
            RSI6: {rsi.rsi6.toFixed(1)}（历史分位{(rsi.rsi6Percentile * 100).toFixed(0)}%），RSI12: {rsi.rsi12.toFixed(1)}，RSI24: {rsi.rsi24.toFixed(1)}，深跌口径:{rsi.rsiDipLevel.toFixed(1)}；{rsi.pattern}
            <span style={{ marginLeft: 6 }}>（该分值仅展示，不计入个股综合分）</span>
          </div>
        )}
        {/* 资金 */}
        <Row style={{ marginBottom: 6, fontSize: 13, alignItems: 'center' }}>
          <Col span={10}>
            <Tooltip
              title={
                <div style={{ whiteSpace: 'pre-line', fontSize: 12 }}>
                  {`基于主力/散户近${Score.SHORT_TERM_SCORE_CONFIG.moneyWindow}日累计净流入曲线（与资金流向图同源），满分30；以「主力资金趋势」为主，散户强弱仅作小幅修正（-${Score.SHORT_TERM_SCORE_CONFIG.moneyRetailDivergePenalty}）：
完美微笑曲线(U型)上穿散户线且站上0轴 → 20~30分 ★（当日金叉最高，随天数衰减）
  但若主力线已在区间高位(≥72%)再下调${Score.SHORT_TERM_SCORE_CONFIG.moneyHighPosPenalty}分：20日累计是滞后指标，形态"完美"时常已到主升段中后段
近期上穿散户线（形态未识别为U型）→ 12~22分（站上0轴更高）
微笑曲线（资金回流）但尚未上穿 → 15分（转折前夜，等待确认）
尾部见底反转（整体倒U/回落，但最近${Score.SHORT_TERM_SCORE_CONFIG.moneyTurnLookback}日内主力线刚拐头向上、即将上穿0轴）→ 17~22分（最早的「资金拐点」，拐点越新鲜越高）
主力累计净流入为正且趋势向上：刚转正(近${Score.SHORT_TERM_SCORE_CONFIG.moneyZeroTurnDays}日内上穿0轴) → 18分 ★；否则 16分，已在区间高位(≥72%) → 15分
主力累计净流入为正但趋势走平/回落：主力强于散户 → 13分（已在区间高位 → 7分，谨防追高）；弱于散户 → 11分（已在区间高位 → 9分）
散户净流入强于主力仅小幅下调(-${Score.SHORT_TERM_SCORE_CONFIG.moneyRetailDivergePenalty})，不再作为"资金分歧"大幅减分
方向不明 → 11分
倒U型 → 6分；倒U型下穿散户线且在0轴下方 → 最低分（最差）`}
                </div>
              }
              placement="right"
            >
              <span>
                资金指标({Score.SHORT_TERM_SCORE_CONFIG.moneyWindow}日) <QuestionCircleOutlined style={{ color: 'var(--secondary-text-color)', fontSize: 12, cursor: 'help' }} />
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
            主力{Score.SHORT_TERM_SCORE_CONFIG.moneyWindow}日:{' '}
            <span className={Utils.GetValueColor(money.mainSum).textClass}>{formatAmount(money.mainSum)}</span>
            <span style={{ margin: '0 6px' }}>|</span>
            散户{Score.SHORT_TERM_SCORE_CONFIG.moneyWindow}日:{' '}
            <span className={Utils.GetValueColor(money.retailSum).textClass}>{formatAmount(money.retailSum)}</span>
            <span style={{ margin: '0 6px' }}>|</span>
            {money.note}
          </div>
        )}
        {/* 资金流向趋势图（与资金流向 Tab 同源数据；查看历史交易日时不展示，避免与当日明细混淆） */}
        {showMoneyChart && moneyFlow?.detail_dates?.length ? (
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
};

const ShortTermScore: React.FC<ShortTermScoreProps> = React.memo(({ code, moneyFlow, circMv }) => {
  const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`;
  const indexName = code.startsWith('6') ? '上证指数' : code.startsWith('3') ? '创业板指' : '深证成指';

  // 用户在板块页手动设置的活跃板块（优先）
  const hybk = useSelector((store: StoreState) => store.stock.stockConfigsMapping[secid]?.hybk);
  // 短线评分固定走 Tushare 源（ScoreList.SHORT_SCORE_SOURCE），与列表/预计算共用同一份缓存；
  // 不再跟随「K线数据源」设置，否则评分序列会按 source 分键存储、两边互相读不到。
  const { ontrain, trainDate } = useSelector((state: StoreState) => state.setting.systemSetting);
  // 训练模式：按训练日期区分请求缓存，并在训练日期变化时重新取数（评分必须基于训练日期为止的数据）
  const trainKey = ontrain && trainDate ? trainDate : 'live';

  // ---- 评分（与 STList 批量评分 / 训练周期预计算共用同一套取数与评分逻辑）----
  // 默认「以缓存为准」：先按基准日在评分序列里取点，命中就直接展示缓存行
  // （与列表点「短线评分」看到的是同一行数据，天然一致）；
  // 未命中才现算，算完写回序列。想看逐日明细时可点「重新计算明细」强制现算。
  const [scoreData, setScoreData] = useState<ScoreComputeResult | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [cachedScore, setCachedScore] = useState<{ row: ScoreList.ShortTermScoreRow; day: string } | null>(null);
  const [forceLive, setForceLive] = useState(false);
  const { run: runScore, loading: scoreLoading } = useRequest(
    async () => {
      const r = await ScoreList.computeStockScoreForCode({
        code,
        source: ScoreList.SHORT_SCORE_SOURCE,
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
      cacheKey: `ShortTermScore/${code}/${ScoreList.SHORT_SCORE_SOURCE}/${trainKey}`,
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
    setCachedScore(null);
    let canceled = false;
    (async () => {
      // 先看缓存（同一基准日的评分行），命中就不再取数计算
      if (!forceLive) {
        const hit = await ScoreList.getCachedScoreRow({
          code,
          source: ScoreList.SHORT_SCORE_SOURCE,
          date: ontrain && trainDate ? trainDate : undefined,
        });
        if (canceled) {
          return;
        }
        if (hit) {
          setCachedScore(hit);
          return;
        }
      }
      if (!canceled) {
        runScore();
      }
    })();
    return () => {
      canceled = true;
    };
  }, [code, trainKey, circMv, moneyFlow, forceLive]);

  // ---- 「近 N 个交易日评分」历史条：交易日列表 + 该股评分序列 ----
  const [recentDays, setRecentDays] = useState<string[]>([]);
  const [series, setSeries] = useState<Record<string, ScoreList.ShortTermScoreRow>>({});
  // 选中的交易日（空串 = 跟随评分基准日）
  const [selectedDay, setSelectedDay] = useState('');
  // 按需现算的历史交易日明细（交易日 -> 完整明细结果）
  const [dayDetails, setDayDetails] = useState<Record<string, ScoreComputeResult>>({});
  /** 正在按需计算明细的交易日（同时也是并发开关：同一时刻只算一个交易日） */
  const [dayDetailLoadingDay, setDayDetailLoadingDay] = useState('');
  /** 历史交易日明细计算失败原因（交易日 -> 原因；有值时不自动重算，需手动点按钮） */
  const [dayDetailErrors, setDayDetailErrors] = useState<Record<string, string>>({});
  /** 是否正在批量补算「没有评分缓存」的交易日 */
  const [batchComputing, setBatchComputing] = useState(false);
  /** 批量补算进度 */
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);

  const baseDayKey = scoreData?.scoreDayKey || cachedScore?.day || '';
  const viewDay = selectedDay || baseDayKey;
  // 当前「股票 + 数据源 + 训练日」身份：异步回写前用它比对，避免切换标的后把旧结果写到新标的上
  const identityRef = useRef('');
  identityRef.current = `${code}/${ScoreList.SHORT_SCORE_SOURCE}/${trainKey}`;

  // 切换股票 / 训练日 / 数据源：重置历史条的选择与按需计算结果
  useEffect(() => {
    setRecentDays([]);
    setSeries({});
    setSelectedDay('');
    setDayDetails({});
    setDayDetailErrors({});
    setDayDetailLoadingDay('');
    setBatchComputing(false);
    setBatchProgress(null);
  }, [code, trainKey]);

  // 加载近 N 个交易日 + 该股在这些交易日的评分序列（与列表「近 N 日评分」同一份缓存）
  useEffect(() => {
    let canceled = false;
    (async () => {
      let days: string[] = [];
      try {
        days = await ScoreList.resolveRecentTradingDays(ScoreList.SHORT_SCORE_SOURCE, RECENT_SCORE_DAYS);
      } catch {
        days = [];
      }
      // 基准日若不在最近 N 个交易日里（如上游回退到更早的交易日），补进来，保证基准日始终可选
      if (baseDayKey && !days.includes(baseDayKey)) {
        days = [...days, baseDayKey].sort().slice(-RECENT_SCORE_DAYS);
      }
      if (canceled) {
        return;
      }
      setRecentDays(days);
      if (!days.length) {
        setSeries({});
        return;
      }
      try {
        const s = await ScoreList.loadScoreSeries([code], ScoreList.SHORT_SCORE_SOURCE, { dates: days });
        if (!canceled) {
          setSeries(s?.[code] || {});
        }
      } catch {
        // 读取失败不影响主流程（历史条按无评分展示）
      }
    })();
    return () => {
      canceled = true;
    };
  }, [code, trainKey, baseDayKey]);

  /**
   * 现取数计算某个交易日的完整明细（单日点击 / 批量补算共用，不含 loading 状态）
   *
   * 与基准日评分同一套入口（computeStockScoreForCode + 按该交易日截断的取数），
   * 算完会写回评分序列，因此该交易日的缓存同时被补齐/刷新。
   * 成功返回结果（期间切换了标的则返回 null）；失败抛错，由调用方展示原因。
   */
  const computeDayDetail = async (day: string) => {
    // 记录发起时的身份（股票/数据源/训练日）：期间切换了标的就丢弃这次结果
    const runIdentity = identityRef.current;
    const r = await ScoreList.computeStockScoreForCode({
      code,
      source: ScoreList.SHORT_SCORE_SOURCE,
      date: day,
      circMv,
      moneyFlow,
      hybk: hybk || null,
    });
    if (identityRef.current !== runIdentity) {
      return null;
    }
    if (!r || !r.detail) {
      throw new Error(r?.row?.error || '未获取到该交易日的日K数据');
    }
    setDayDetails((prev) => ({ ...prev, [day]: r }));
    // 同步历史条上的分数（现算的这行就是写回序列的那行）
    setSeries((prev) => ({ ...prev, [r.scoreDayKey || day]: r.row }));
    return r;
  };

  /** 单日：点历史条上的某个交易日（或明细卡里的按钮）时现取数计算明细 */
  const startDayDetail = async (day: string) => {
    if (!day || dayDetailLoadingDay || batchComputing) {
      return;
    }
    setDayDetailLoadingDay(day);
    setDayDetailErrors((prev) => {
      const next = { ...prev };
      delete next[day];
      return next;
    });
    const runIdentity = identityRef.current;
    try {
      await computeDayDetail(day);
    } catch (e: any) {
      if (identityRef.current === runIdentity) {
        setDayDetailErrors((prev) => ({ ...prev, [day]: e?.message || '计算失败' }));
      }
    } finally {
      setDayDetailLoadingDay((prev) => (prev === day ? '' : prev));
    }
  };

  /**
   * 批量补算：把「近 N 个交易日」里没有评分缓存的交易日逐日现取数算出来
   *
   * 已有缓存的交易日不重复计算，缺哪天算哪天（历史条上对应的格子算完立刻显示分数）；
   * 一天一天串行取数，避免同时打十几个接口。
   */
  const startRecentScore = async () => {
    if (batchComputing || dayDetailLoadingDay) {
      return;
    }
    const targets = missingDays;
    if (!targets.length) {
      return;
    }
    const runIdentity = identityRef.current;
    setBatchComputing(true);
    setBatchProgress({ done: 0, total: targets.length });
    setDayDetailErrors((prev) => {
      const next = { ...prev };
      targets.forEach((d) => delete next[d]);
      return next;
    });
    try {
      for (let i = 0; i < targets.length; i += 1) {
        const day = targets[i];
        try {
          await computeDayDetail(day);
        } catch (e: any) {
          if (identityRef.current === runIdentity) {
            setDayDetailErrors((prev) => ({ ...prev, [day]: e?.message || '计算失败' }));
          }
        }
        if (identityRef.current !== runIdentity) {
          // 已切换到别的标的：丢弃剩余任务
          return;
        }
        setBatchProgress({ done: i + 1, total: targets.length });
      }
    } finally {
      setBatchComputing(false);
      setBatchProgress(null);
    }
  };

  // 选中历史交易日且序列里有该日评分行时，自动现算一次完整明细（每只股票每个交易日只自动算一次）
  useEffect(() => {
    const day = viewDay;
    if (!baseDayKey || !day || day === baseDayKey) {
      return;
    }
    if (dayDetails[day] || dayDetailErrors[day] || dayDetailLoadingDay) {
      return;
    }
    if (!series[day]) {
      // 该交易日没有评分缓存：不自动取数（可能是非交易日/未评分），需手动点「现取数计算」
      return;
    }
    void startDayDetail(day);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseDayKey, viewDay, dayDetails, dayDetailErrors, dayDetailLoadingDay, series]);

  // 历史条展示的交易日：不超过评分基准日（基准日之后的行属于未来数据，不展示）
  const displayDays = useMemo(
    () => (baseDayKey ? recentDays.filter((d) => d <= baseDayKey) : recentDays),
    [recentDays, baseDayKey]
  );

  // 历史条里还没有评分缓存、也没有现算结果的交易日：用于给出「计算缺失的交易日」入口
  const missingDays = useMemo(
    () => displayDays.filter((d) => !series[d] && !dayDetails[d]),
    [displayDays, series, dayDetails]
  );

  const dklines = scoreData?.klines || null;
  const result = scoreData?.detail || null;
  // 大盘评分对比基准名称：市值风格板块优先，缺失时回退所属指数（由评分内核决定）
  const marketBaselineName = scoreData?.baselineName || indexName;
  const trainText = ontrain && trainDate ? `（训练日 ${trainDate}）` : '';

  const activeRow = viewDay ? series[viewDay] : undefined;
  const activeDetail = viewDay
    ? viewDay === baseDayKey
      ? result
      : dayDetails[viewDay]?.detail || null
    : null;

  const strip =
    displayDays.length > 0 ? (
      <DayScoreStrip
        days={displayDays}
        series={series}
        errors={dayDetailErrors}
        viewDay={viewDay}
        baseDayKey={baseDayKey}
        loadingDay={dayDetailLoadingDay}
        missingCount={missingDays.length}
        failedCount={missingDays.filter((d) => !!dayDetailErrors[d]).length}
        computingMissing={batchComputing}
        computingProgress={batchProgress}
        onSelect={(d) => setSelectedDay(d)}
        onBackToBase={() => setSelectedDay('')}
        onComputeMissing={() => void startRecentScore()}
      />
    ) : null;

  let content: React.ReactNode;

  if (activeDetail) {
    // ① 有完整明细：基准日（现算/命中缓存后现算）或历史交易日（按需现算）
    const isBase = viewDay === baseDayKey;
    const dayResult = isBase ? scoreData : dayDetails[viewDay];
    content = (
      <ScoreDetailCards
        detail={activeDetail}
        klines={dayResult?.klines}
        baselineName={isBase ? marketBaselineName : dayResult?.baselineName || indexName}
        scoreDayKey={viewDay}
        trainText={isBase ? trainText : ''}
        moneyFlow={moneyFlow}
        showMoneyChart={isBase}
        onRecompute={() => (isBase ? setForceLive(true) : void startDayDetail(viewDay))}
        recomputeLoading={isBase ? scoreLoading : dayDetailLoadingDay === viewDay}
        recomputeDisabled={!isBase && batchComputing}
        recomputeHint={
          isBase ? '重新计算会现取数据、展开逐日明细，并覆盖该交易日的缓存' : '重新按该交易日取数，覆盖该交易日的缓存'
        }
      />
    );
  } else if (activeRow) {
    // ② 只有评分行（列表缓存）：先展示行摘要，历史交易日会自动现算明细
    const isBase = viewDay === baseDayKey;
    content = (
      <RowSummaryCard
        row={activeRow}
        day={viewDay}
        note={isBase ? '与列表「短线评分」同一份缓存' : '取自评分序列缓存（与列表历史列一致）'}
        computeText={isBase ? '重新计算明细' : undefined}
        hint={isBase ? '重新计算会现取数据、展开逐日明细，并覆盖该交易日的缓存' : undefined}
        onComputeDetail={isBase ? () => setForceLive(true) : () => void startDayDetail(viewDay)}
        computing={isBase ? scoreLoading : dayDetailLoadingDay === viewDay}
        computeDisabled={!isBase && batchComputing}
        error={dayDetailErrors[viewDay]}
      />
    );
  } else if (!viewDay || viewDay === baseDayKey) {
    // ③ 基准日还没结果：加载中 / 取数失败 / 数据不足
    if (scoreLoading) {
      content = (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin /> 短线评分数据加载中...
        </div>
      );
    } else {
      content = (
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
  } else if (dayDetailLoadingDay === viewDay) {
    content = (
      <div style={{ ...cardStyle, textAlign: 'center', padding: 24 }}>
        <Spin /> 正在按 {formatDay(viewDay)} 取数计算明细...
      </div>
    );
  } else if (batchComputing) {
    // 正在批量补算：这一天的分数还在排队计算
    content = (
      <div style={{ ...cardStyle, textAlign: 'center', padding: 24 }}>
        <Spin /> 正在批量补算缺失的交易日（{batchProgress?.done || 0}/{batchProgress?.total || 0}）...
      </div>
    );
  } else {
    // ④ 历史交易日没有评分缓存：手动现算
    content = (
      <div style={{ ...cardStyle, fontSize: 12, color: 'var(--secondary-text-color)' }}>
        <div style={{ marginBottom: 8 }}>{formatDay(viewDay)} 没有评分记录（可能当日未评分或数据不足）。</div>
        <Button size="small" onClick={() => void startDayDetail(viewDay)}>
          现取数计算该交易日明细
        </Button>
        {missingDays.length > 1 ? (
          <Button size="small" style={{ marginLeft: 8 }} onClick={() => void startRecentScore()}>
            计算缺失的 {missingDays.length} 个交易日
          </Button>
        ) : null}
        {dayDetailErrors[viewDay] ? (
          <div style={{ marginTop: 6, color: '#ff4d4f' }}>计算失败：{dayDetailErrors[viewDay]}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      {strip}
      <div style={{ marginTop: strip ? 12 : 0 }}>{content}</div>
    </div>
  );
});

export default ShortTermScore;
