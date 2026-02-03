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
import moment from 'moment';

export interface StockNewsProps {
  secid: string;
  active: boolean;
  openUrl: (url: string) => void;
}

const StockNews: React.FC<StockNewsProps> = React.memo(({ secid, active, openUrl }) => {
  const [noMore, setNoMore] = useState(false);
  const [news, setNews] = useState<Stock.NewsItem[]>([]);
  const [pageSize, setPageSize] = useState(10);
  const dispatch = useDispatch();
  function mergeNews(appends: Stock.NewsItem[]) {
    if (!news.length) {
      setNews(appends);
    } else if (appends.length) {
      const first = moment(news[0].time);
      const last = moment(news[news.length - 1].time);
      let firstIndex = 0;
      for (let i = 0; i < appends.length; i++) {
        const ntime = moment(appends[i].time);
        if (ntime.isAfter(first)) {
          // 在第一个之前
          firstIndex = i;
          break;
        }
      }
      if (firstIndex > 0) {
        news.push(...appends.slice(0, firstIndex));
      }
      let lastIndex = appends.length;
      for (let i = firstIndex; i < appends.length; i++) {
        const ntime = moment(appends[i].time);
        if (ntime.isBefore(last)) {
          lastIndex = i;
          break;
        }
      }
      if (lastIndex < appends.length) {
        news.push(...appends.slice(lastIndex));
      }
    }
    setNoMore(appends.length < pageSize);
    dispatch(syncStockNewsAction(secid, news));
  }
  const { run: runGetStockNews } = useRequest(Helpers.Stock.GetStockNews, {
    throwOnError: true,
    manual: true,
    onSuccess: (values) => mergeNews(values),
    pollingWhenHidden: false,
    cacheKey: `GetStockNews/${secid}`,
  });

  useEffect(() => {
    runGetStockNews(secid, 0, pageSize);
  }, [secid]);

  return (
    <div className={styles.container}>
      <List
        size="small"
        loading={news.length === 0}
        bordered={false}
        split={false}
        dataSource={news}
        renderItem={(item, i) => (
          <List.Item key={i} style={{ padding: 0 }}>
            <div className={styles.row}>
              <div className={styles.title} onClick={() => openUrl(item.url)}>
                <span style={{ marginRight: 5 }}>{item.time}</span>
                <span>{item.title}</span>
              </div>
              <div className={styles.abstract}>{item.abstract}</div>
            </div>
          </List.Item>
        )}
      >
        {!noMore && (
          <div className={styles.loadmore} onClick={() => runGetStockNews(secid, Math.floor(news.length / pageSize) + 1, pageSize)}>
            <span>加载更多</span>
          </div>
        )}
      </List>
    </div>
  );
});
export default StockNews;
