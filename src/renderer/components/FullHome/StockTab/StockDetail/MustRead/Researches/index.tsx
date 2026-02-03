import React, { useEffect, useState } from 'react';
import * as Services from '@/services';
import * as Utils from '@/utils';
import * as Helpers from '@/helpers';
import { useRequest } from 'ahooks';
import styles from './index.scss';
import { List } from 'antd';
import * as CONST from '@/constants';
import { useWorkDayTimeToDo } from '@/utils/hooks';
import { Stock } from '@/types/stock';
import { useDispatch } from 'react-redux';
import { syncStockNewsAction } from '@/actions/stock';

export interface StockResearchesProps {
  secid: string;
  active: boolean;
  openUrl: (url: string) => void;
}

const StockResearches: React.FC<StockResearchesProps> = React.memo(({ secid, active, openUrl }) => {
  const [noMore, setNoMore] = useState(false);
  const [researches, setResearches] = useState<any[]>([]);
  const [pageSize] = useState(20);
  const dispatch = useDispatch();
  function mergeResearches(appends: any[]) {
    if (!researches.length) {
      setResearches(appends);
    } else if (appends.length) {
      const first = researches[0];
      const last = researches[appends.length - 1];
      let firstIndex = -1;
      for (let i = 0; i < appends.length; i++) {
        if (appends[i].publish_time <= first.publish_time) {
          firstIndex = i;
          break;
        }
      }
      if (firstIndex > 0) {
        researches.push(...appends.slice(0, firstIndex));
      }
      let lastIndex = appends.length;
      for (let i = 0; i < appends.length; i++) {
        if (appends[i].publish_time > last.publish_time) {
          lastIndex = i;
          break;
        }
      }
      if (lastIndex < appends.length) {
        researches.push(...appends.slice(lastIndex));
      }
      setResearches([...researches]);
    }
    setNoMore(appends.length < pageSize);
  }
  const { run: runGetStockResearches } = useRequest(Services.Stock.GetStockResearches, {
    throwOnError: true,
    manual: true,
    onSuccess: (values) => mergeResearches(values),
    pollingWhenHidden: false,
    cacheKey: `GetStockResearches/${secid}`,
  });

  useEffect(() => {
    runGetStockResearches(secid);
  }, [secid]);

  return (
    <div className={styles.container}>
      <List
        size="small"
        loading={researches.length === 0}
        bordered={false}
        split={false}
        dataSource={researches}
        renderItem={(item, i) => (
          <List.Item key={i} style={{ padding: 0 }}>
            <div className={styles.row}>
              <div className={styles.title} onClick={() => openUrl(`https://wap.eastmoney.com/report/${item.art_code}.html`)}>
                <span style={{ marginRight: 5 }}>{item.publish_time.substring(0, 10)}</span>
                <span>{item.source}</span>
              </div>
              <div className={styles.abstract}>{item.title}</div>
            </div>
          </List.Item>
        )}
      >
        {!noMore && (
          <div className={styles.loadmore} onClick={() => runGetStockResearches(secid, Math.floor(researches.length / 20) + 1)}>
            <span>加载更多</span>
          </div>
        )}
      </List>
    </div>
  );
});
export default StockResearches;
