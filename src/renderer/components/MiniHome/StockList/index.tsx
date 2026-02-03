import React from 'react';
import { useSelector } from 'react-redux';

import StockRow from './StockRow';
import Empty from '@/components/Empty';
import LoadingBar from '@/components/LoadingBar';
import CustomDrawer from '@/components/CustomDrawer';
import DetailStockContent from './DetailStockContent';
import { StoreState } from '@/reducers/types';
import { useDrawer, useSyncFixStockSetting } from '@/utils/hooks';
import styles from './index.scss';
import { Stock } from '@/types/stock';

interface StockListProps {
  filter: (stock: Stock.AllData) => boolean;
}

const StockList: React.FC<StockListProps> = ({ filter }) => {
  const { stocksMapping } = useSelector((state: StoreState) => state.stock);
  const stocks = Object.values(stocksMapping);
  const stocksLoading = useSelector((state: StoreState) => state.stock.stocksLoading);
  const { data: detailStockSecid, show: showDetailDrawer, set: setDetailDrawer, close: closeDetailDrawer } = useDrawer('');
  const list = stocks.filter(filter);
  const { done: syncStockSettingDone } = useSyncFixStockSetting();

  return (
    <div className={styles.container}>
      <LoadingBar show={stocksLoading} />
      {list.length ? (
        syncStockSettingDone ? (
          list.map((stock) => <StockRow key={stock.detail.secid} stock={stock} onDetail={setDetailDrawer} />)
        ) : (
          <Empty text="正在同步股票设置~" />
        )
      ) : (
        <Empty text="暂无股票数据~" />
      )}
      <CustomDrawer show={showDetailDrawer}>
        <DetailStockContent onEnter={closeDetailDrawer} onClose={closeDetailDrawer} secid={detailStockSecid} />
      </CustomDrawer>
    </div>
  );
};
export default StockList;
