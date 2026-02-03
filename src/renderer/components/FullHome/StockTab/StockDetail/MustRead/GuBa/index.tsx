import React, { useCallback, useEffect, useState } from 'react';
import * as Services from '@/services';
import { useClickAway, useRequest } from 'ahooks';
import styles from './index.scss';
import { Button, List } from 'antd';
import { Stock } from '@/types/stock';
import { batch, useDispatch } from 'react-redux';
import { ChromeOutlined } from '@ant-design/icons';

export interface GubaProps {
  secid: string;
  active: boolean;
  openUrl: (url: string) => void;
}

const Guba: React.FC<GubaProps> = React.memo(({ secid, active, openUrl }) => {
  const [noMore, setNoMore] = useState(false);
  const [comments, setComments] = useState<Stock.Comment[]>([]);
  const [gubaCode, setGubaCode] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [initLoading, setInitLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const { run: runGetGubaComments } = useRequest(Services.Stock.GetWebArticleList, {
    throwOnError: true,
    manual: true,
    onSuccess: ({p, list}) => {
        batch(() => {
            if (p == 1) {
                // refresh
                setComments(list);
            } else {
                setComments(comments.concat(list));
            }
            setPage(p + 1);
            setInitLoading(false);
            setLoading(false);

            if (list.length == 0) {
                setNoMore(true);
            }
        });
    },
    pollingWhenHidden: false,
    cacheKey: `GetGubaCode/${secid}`,
  });
  const { run: runGetGubaCode } = useRequest(Services.Stock.GetGubaCode, {
    throwOnError: true,
    manual: true,
    onSuccess: (code) => {
        setGubaCode(code);
        setPage(1);
        if (code) {
            // refresh
            runGetGubaComments(code, 1);
        }
    },
    pollingWhenHidden: false,
    cacheKey: `GetGubaCode/${secid}`,
  });
  const refresh = useCallback(() => {
    if (gubaCode) {
        setPage(1);
        runGetGubaComments(gubaCode, 1);
    }
  }, [gubaCode]);
  const loadMore = useCallback(() => {
    if (gubaCode) {
        setLoading(true);
        runGetGubaComments(gubaCode, page);
    }
  }, [gubaCode, page]);

  useEffect(() => {
    runGetGubaCode(secid);
  }, [secid]);

  return (
    <div className={styles.container}>
      <List
        size="small"
        loading={initLoading}
        bordered={false}
        split={false}
        dataSource={comments}
        loadMore={!initLoading && !loading && !noMore ? (
            <div
                style={{
                textAlign: 'center',
                marginTop: 12,
                height: 32,
                lineHeight: '32px',
                }}
            >
            <Button onClick={loadMore}>loading more</Button>
      </div>
        ) : null}
        renderItem={(item, i) => (
          <List.Item key={i} style={{ padding: 0 }}>
            <div className={styles.row}>
              {i == 0 && (<div>
                <a onClick={refresh}>点击刷新数据</a>
              </div>)}
              <div className={styles.title}>
                <span style={{ marginRight: 5 }}>{item.time}</span>
                &nbsp;
                <span>{item.userNick}</span>
                &nbsp;
                <span className={styles.age}>{item.userAge}</span>
                &nbsp;
                <a onClick={() => openUrl(item.url)}>web</a>
              </div>
              <div className={styles.abstract}>
                <span>{item.content}</span>
              </div>
              <div className={styles.replies}>
                {item.replies.map((r, i) => (
                <div className={styles.reply} key={'r-' + i}>
                    <span className={styles.reply_leading}>{r.time} &nbsp; {r.userNick}</span>
                    &nbsp;
                    <span className={styles.age}>{r.userAge}</span>
                    {/* &nbsp;
                    <span className={styles.age}>{r.userArea}</span> */}
                    &nbsp;
                    {r.isAuthor && <span className={styles.age}>作者</span>}
                    <span>: </span>
                    <span>{r.text}</span>
                </div>))}
              </div>
            </div>
          </List.Item>
        )}
      >
        {/* {!noMore && (
          <div className={styles.loadmore} onClick={loadMore}>
            <span>加载更多</span>
          </div>
        )} */}
      </List>
    </div>
  );
});
export default Guba;
