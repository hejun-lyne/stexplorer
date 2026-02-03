import classnames from 'classnames';
import React, { useCallback, useEffect, useState } from 'react';
import styles from './index.scss';
import { KLineType, MAPeriodType } from '@/utils/enums';
import BKStockBrief from '../BKStockBrief';
import { Button, List } from 'antd';
import { batch } from 'react-redux';

export interface BKStockMonitorProps {
  secids: string[];
  active: boolean;
  ktype: KLineType;
  mtype: MAPeriodType;
  markdate?: string;
  moveTop?: (secid: string) => void;
  remove?: (secid: string) => void;
  openStock: (secid: string, name: string, change?: number) => void;
  range: { start: number; end: number };
  area?: { start: string; end: string } | null;
}

const BKStockMonitor: React.FC<BKStockMonitorProps> = React.memo(
  ({ secids, active, markdate, ktype, mtype, moveTop, remove, openStock, range, area }) => {
    const [shownList, setShowList] = useState<string[]>([]);
    const [page, setPage] = useState(1);
    useEffect(() => {
      batch(() => {
        const total = page * 5;
        setShowList(secids.length < total ? secids : secids.slice(0, total));
      });
    }, [secids]);
    const onLoadMore = useCallback(() => {
      const total = (page + 1) * 5;
      batch(() => {
        setPage(page + 1);
        setShowList(secids.length < total ? secids : secids.slice(0, total));
      });
    }, [page, secids]);
    const loadMore =
      secids.length >= page * 5 ? (
        <div
          style={{
            textAlign: 'center',
            marginTop: 12,
            height: 32,
            lineHeight: '32px',
          }}
        >
          <Button onClick={onLoadMore}>loading more</Button>
        </div>
      ) : null;
    return (
      <div className={classnames(styles.container)}>
        <div className={styles.content}>
          <List
            itemLayout="horizontal"
            loadMore={loadMore}
            dataSource={shownList}
            renderItem={(s) => (
              <BKStockBrief
                ktype={ktype}
                mtype={mtype}
                secid={s}
                markdate={markdate}
                active={active}
                moveTop={moveTop}
                remove={remove}
                openStock={openStock}
                outRange={range}
                outArea={area}
              />
            )}
          />
        </div>
      </div>
    );
  }
);

export default BKStockMonitor;
