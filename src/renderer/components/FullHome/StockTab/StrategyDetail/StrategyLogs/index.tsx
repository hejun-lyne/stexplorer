import React from 'react';
import styles from './index.scss';
import { Button, List } from 'antd';
import { ClearOutlined } from '@ant-design/icons';

export interface StrategyLogsProps {
  logs: string[];
  progress?: string;
  clear: () => void;
}

const StrategyLogs: React.FC<StrategyLogsProps> = React.memo(({ logs, progress, clear }) => {
  return (
    <div className={styles.subcontainer}>
      <div className={styles.header}>
        <Button type="text" className={styles.btn} icon={<ClearOutlined />} onClick={clear}>
          清除
        </Button>
        {progress && <div style={{ marginLeft: 10, paddingTop: 3 }}>当前步骤：{progress}</div>}
      </div>
      <div className={styles.listContainer}>
        <List size="small" dataSource={logs} renderItem={(item) => <List.Item>{item}</List.Item>} />
      </div>
    </div>
  );
});
export default StrategyLogs;
