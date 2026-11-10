import React from 'react';
import { Tooltip } from 'antd';
import type { BoardStageEffect, BoardStageItem } from '@/services/tushare';

/** 四态阶段的显示颜色：只用于标注状态，不含任何买点或收益预测 */
export const BOARD_STAGE_COLORS: Record<string, string> = {
  冷: 'var(--hint-color)',
  启动: '#cf1322',
  延续: '#d46b08',
  退潮: '#389e0d',
};

/**
 * 板块阶段标记：四态阶段 +「启动」复盘标签 + 封板质量分
 *
 * STList 与 QSList 共用，保证两处板块标签的阶段显示完全一致。
 * 全部字段直接来自 sector_engine 的输出 JSON，渲染层不重算任何判定。
 * 判定只覆盖 110 个行业（stock_basic.industry），概念 / 风格板块没有结果就不显示。
 * `start` 需要连续 3 日板块效应，天然滞后 2 日，属于复盘标签而不是买点；
 * 质量分只在当日板块效应候选池内部有区分度。
 */
const BoardStageMark: React.FC<{ stage: BoardStageItem; compact?: boolean }> = ({ stage, compact }) => {
  const e = (stage.effect || {}) as BoardStageEffect;
  const score = Math.round((stage.quality || 0) * 100);
  const threshold = stage.quality_threshold == null ? '—' : Math.round(stage.quality_threshold * 100);
  const fmt = (v: number | undefined, digits = 0) => (Number(v) || 0).toFixed(digits);
  const tip = (
    <div style={{ fontSize: 12, lineHeight: 1.7 }}>
      <div style={{ fontWeight: 600 }}>
        {stage.industry} · {stage.trade_date} 板块效应启动判定（复盘标签，非买点）
      </div>
      <div>
        阶段 <b style={{ color: BOARD_STAGE_COLORS[stage.stage] }}>{stage.stage}</b>
        {stage.start ? ' · 结论：启动' : ` · 结论：未启动 · ${stage.reason}`}
      </div>
      <div>质量分 {score} / 当日候选池 60 分位阈值 {threshold}</div>
      <div>
        快照 N {fmt(e.N_raw)} → EMA N {fmt(e.N, 2)}（dN {fmt(e.dN, 2)}、数量分位{' '}
        {fmt((e.qN || 0) * 100)}%、连续 {fmt(e.run_len)} 日）
      </div>
      <div>
        事件分解 新进 {fmt(e.N_new)} / 留存 {fmt(e.N_stay)} / 退出 {fmt(e.N_exit)}（只供复盘，不进打分）
      </div>
      <div>
        行业全体 20 日收益 {fmt(e.r20, 2)}%（位置分位 {fmt((e.q_r20 || 0) * 100)}%） · 篮子{' '}
        {fmt(e.basket_ret, 2)}%
      </div>
      <div>
        涨停 {fmt(e.zt_n)} 家 · 炸板率 {fmt((e.zbl || 0) * 100, 1)}% · 最高连板 {fmt(e.max_lb)} · 多次涨停{' '}
        {fmt(e.multi_zt)} 家
      </div>
      <div>
        封单中位数 {fmt((e.fd_med || 0) / 1e8, 2)} 亿 · 平均首封 {fmt(e.first_min)} 分钟（分位{' '}
        {fmt((e.q_zbl_in || 0) * 100)}% / {fmt((e.q_fd_in || 0) * 100)}% / {fmt((e.q_fmin_in || 0) * 100)}%）
      </div>
      <div>
        近 3 日主力净额 {fmt(e.mf3, 2)} 亿（分位 {fmt((e.q_mf3 || 0) * 100)}%，资金项反向计分）
      </div>
      {stage.roles ? (
        <div>
          角色 龙头 {stage.roles.leader?.name || '—'} / 中军 {stage.roles.middle?.name || '—'} / 补涨{' '}
          {stage.roles.laggard?.name || '—'}
          {Object.values(stage.role_flags?.changed_vs_prev || {}).some(Boolean) ? ' · 较昨日换人' : ''}
          {stage.role_flags?.degraded ? ' · 存在候选为空（降级）' : ''}
          {stage.role_flags?.mv_source ? ` · 市值来源 ${stage.role_flags.mv_source}` : ''}
        </div>
      ) : null}
      <div style={{ color: '#ffa39e' }}>
        {stage.s2_candidate ? '当日进入板块效应候选池' : '非候选池'}；质量分只在候选池内部有区分度，不作全市场打分
        {stage.first_divergence ? ' · 首次分歧（实验观察标记，不进主判定）' : ''}
      </div>
      {stage.warnings?.length ? <div style={{ color: '#faad14' }}>数据提示：{stage.warnings.join('、')}</div> : null}
    </div>
  );
  return (
    <Tooltip title={tip}>
      <span
        style={{
          display: 'inline-block',
          marginLeft: compact ? 2 : 4,
          whiteSpace: 'nowrap',
          verticalAlign: 'middle',
          fontSize: compact ? 9 : 10,
          lineHeight: '14px',
          cursor: 'help',
        }}
      >
        <span style={{ color: BOARD_STAGE_COLORS[stage.stage] || 'var(--hint-color)', marginRight: 2 }}>
          {stage.stage}
        </span>
        {stage.start ? (
          <span
            style={{
              padding: '0 3px',
              marginRight: 2,
              borderRadius: 3,
              border: '1px solid #ffa39e',
              background: '#fff1f0',
              color: '#cf1322',
              fontWeight: 600,
            }}
          >
            {compact ? '启' : '启动'}
          </span>
        ) : null}
        <span style={{ color: stage.start ? '#cf1322' : 'var(--hint-color)' }}>
          {compact ? `质${score}` : `质量${score}`}
        </span>
      </span>
    </Tooltip>
  );
};

export default BoardStageMark;
