import { StoreState } from '@/reducers/types';
import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import styles from './index.scss';

export interface MessageBarProps {
}

const MessageBar: React.FC<MessageBarProps> = React.memo(() => {
  const logs = useSelector((state: StoreState) => state.setting.logs);
  return (
    <div className={styles.container}>
      <div>
        <span>{logs.length > 0 ? logs[logs.length - 1].c : ''}</span>
      </div>
    </div>
  );
});

export default MessageBar;
