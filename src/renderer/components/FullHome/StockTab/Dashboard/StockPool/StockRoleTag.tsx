import React from 'react';
import { Tooltip } from 'antd';
import type {
  BoardRoleFlags,
  BoardStageRole,
  BoardStageRoles,
  StockRoleBinding,
  StockRoleName,
} from '@/services/tushare';

/**
 * 板块内角色标签，依据《板块内角色绑定-实现规格》第 3 / 7 / 9 节。
 *
 * 角色只标注「该行业当天该关注哪三只股票」，是状态与排名，不是收益领先，
 * 不产出买点、目标价或收益预测。全部字段直接消费 sector_engine 的输出 JSON，
 * 渲染层不重算角色、不传候选池。
 */

const ROLE_STYLE: Record<StockRoleName, { color: string; background: string; border: string }> = {
  龙头: { color: '#cf1322', background: '#fff1f0', border: '#ffa39e' },
  中军: { color: '#096dd9', background: '#e6f7ff', border: '#91d5ff' },
  补涨: { color: '#389e0d', background: '#f6ffed', border: '#b7eb8f' },
};

/** 角色的产品语义：hover 文案用，避免出现「机会 / 建议买入」等误导表述 */
const ROLE_MEANING: Record<StockRoleName, string> = {
  龙头: '情绪温度计：盯连板是否延续、次日是否还在强势池；不是买入标的',
  中军: '按总市值选出（不是成交额）：盯趋势有没有走坏、量价是否背离；几乎不涨停',
  补涨: '近 20 日位置最低的老票，出现往往意味着扩散到末端，是板块进入后段的信号',
};

/** chip 内只显示 1 个关键指标：龙头=连板数，中军=总市值量级，补涨=近 20 日涨幅 */
function metricOf(role: StockRoleName, item: { limit_times?: number | null; total_mv?: number | null; gain20?: number | null }) {
  if (role === '龙头') return `${Number(item.limit_times) || 0}板`;
  if (role === '中军') {
    const mv = Number(item.total_mv) || 0;
    return mv > 0 ? `${(mv / 10000).toFixed(0)}亿` : '--';
  }
  return item.gain20 == null ? '--' : `${Number(item.gain20).toFixed(1)}%`;
}

function chipStyle(role: StockRoleName) {
  const c = ROLE_STYLE[role];
  return {
    display: 'inline-flex',
    alignItems: 'center',
    flex: '0 0 auto',
    whiteSpace: 'nowrap' as const,
    padding: '0 3px',
    marginRight: 2,
    borderRadius: 3,
    border: `1px solid ${c.border}`,
    background: c.background,
    color: c.color,
    fontSize: 9,
    lineHeight: '14px',
    cursor: 'help' as const,
  };
}

/** 「换」角标：角色平均连续 1.63 天，不提示会被误当成稳定标签 */
const ChangedMark: React.FC = () => (
  <span style={{ marginLeft: 2, color: '#fa8c16', fontWeight: 600 }} title="较上一交易日换人">
    换
  </span>
);

/** 股票行标签：名字列里紧跟股票名显示，按 6 位代码从 role_by_code 取 */
const StockRoleTag: React.FC<{ role?: StockRoleBinding }> = ({ role }) => {
  if (!role) return null;
  const c = ROLE_STYLE[role.role];
  const tip = (
    <div style={{ fontSize: 12, lineHeight: 1.7 }}>
      <div style={{ fontWeight: 600 }}>
        {role.industry} · {role.trade_date} 板块内角色（状态与排名，不是买点）
      </div>
      <div>
        角色 <b style={{ color: c.color }}>{role.role}</b> · {role.changed ? '较昨日换人' : '较昨日未换人'}
      </div>
      <div>{ROLE_MEANING[role.role]}</div>
      <div>判定依据：{role.reason}</div>
      <div>
        行业强势股 {role.n_strong} 只 / 行业成分 {role.n_members} 只 · 关键指标 {metricOf(role.role, role)}
      </div>
      {role.zdf != null ? <div>当日涨幅 {Number(role.zdf).toFixed(2)}%</div> : null}
      {role.degraded ? <div style={{ color: '#faad14' }}>数据提示：中军或补涨候选为空，已置降级，未用其他角色填充</div> : null}
      <div style={{ color: '#ffa39e' }}>
        三角色强制互斥，逐日重算；角色的价值在状态与排名，不产出买点、目标价或收益预测
      </div>
    </div>
  );
  return (
    <Tooltip title={tip}>
      <span style={chipStyle(role.role)} onClick={(e) => e.stopPropagation()}>
        {role.role} {metricOf(role.role, role)}
        {role.changed ? <ChangedMark /> : null}
      </span>
    </Tooltip>
  );
};

/** 规格 §9：行业行一行三枚 chip，只显示「名称 + 1 个关键指标」，某角色为 null 时显示灰色「—」 */
export const BoardRoleChips: React.FC<{ roles?: BoardStageRoles | null; flags?: BoardRoleFlags | null }> = ({
  roles,
  flags,
}) => {
  if (!roles) return null;
  const items: { key: keyof BoardStageRoles; label: StockRoleName }[] = [
    { key: 'leader', label: '龙头' },
    { key: 'middle', label: '中军' },
    { key: 'laggard', label: '补涨' },
  ];
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
      {items.map(({ key, label }) => {
        const item: BoardStageRole | null = roles[key];
        if (!item) {
          return (
            <span key={key} style={{ ...chipStyle(label), color: 'var(--hint-color)', borderColor: 'var(--border-color)', background: 'transparent' }}>
              {label} —
            </span>
          );
        }
        const changed = flags?.changed_vs_prev?.[key];
        return (
          <Tooltip
            key={key}
            title={
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                <div>{ROLE_MEANING[label]}</div>
                <div>{item.reason}</div>
                {changed ? <div style={{ color: '#fa8c16' }}>较上一交易日换人</div> : null}
                {flags?.degraded ? <div style={{ color: '#faad14' }}>存在角色候选为空（降级）</div> : null}
                {flags?.mv_source ? <div>市值来源：{flags.mv_source}</div> : null}
              </div>
            }
          >
            <span style={chipStyle(label)}>
              {label} {item.name} {metricOf(label, item)}
              {changed ? <ChangedMark /> : null}
            </span>
          </Tooltip>
        );
      })}
    </span>
  );
};

export default StockRoleTag;
