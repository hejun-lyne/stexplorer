import React from 'react';
import { Empty } from 'antd';
import NoteRow from './StrategyRow';
import styles from './index.scss';

export interface StrategyListProps {
  group: Strategy.GroupItem | undefined;
  onStrategyClick: (n: Strategy.BriefItem) => void;
}

const StrategyList: React.FC<StrategyListProps> = ({ group, onStrategyClick }) => {
  return (
    <div className={styles.container}>
      {group && group.strategies && group.strategies.length ? (
        group.strategies
          .sort((a, b) => (a.modifiedTime > b.modifiedTime ? 1 : -1))
          .map((n) => <NoteRow key={n.id} brief={n} onClick={onStrategyClick} />)
      ) : (
        <Empty description="暂无策略数据~" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </div>
  );
};

export default StrategyList;
