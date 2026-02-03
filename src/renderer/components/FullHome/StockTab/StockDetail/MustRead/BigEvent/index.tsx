import React, { useEffect, useState } from 'react';
import styles from '../index.scss';
import * as Services from '@/services';
import { useRequest } from 'ahooks';
import { Timeline } from 'antd';

export interface BigEventProps {
  code: string;
}

const BigEvent: React.FC<BigEventProps> = React.memo(({ code }) => {
  const [events, setEvents] = useState<any>([]);
  const { run: runGetEvents } = useRequest(Services.Stock.GetStockEvents, {
    throwOnError: true,
    manual: true,
    onSuccess: setEvents,
  });

  useEffect(() => {
    runGetEvents(code);
  }, []);

  return (
    <div className={styles.eventWrapper}>
      <Timeline mode="left">
        {events.map((e, i) => (
          <Timeline.Item label={e[0].NOTICE_DATE} key={i}>
            <div className={styles.eventTitle}>{e[0].EVENT_TYPE}</div>
            <div className={styles.eventBrief}>{e[0].LEVEL1_CONTENT}</div>
          </Timeline.Item>
        ))}
      </Timeline>
    </div>
  );
});
export default BigEvent;
