import React, { useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { ReactSortable } from 'react-sortablejs';
import classnames from 'classnames';

import PureCard from '@/components/Card/PureCard';
import { ReactComponent as AddIcon } from '@/assets/icons/add.svg';
import { ReactComponent as MenuIcon } from '@/assets/icons/menu.svg';
import { ReactComponent as RemoveIcon } from '@/assets/icons/remove.svg';
import CustomDrawer from '@/components/CustomDrawer';
import Empty from '@/components/Empty';
import AddStockContent from '@/components/MiniHome/StockList/AddStockContent';
import { deleteStockAction, setStockConfigAction } from '@/actions/stock';
import { useDrawer } from '@/utils/hooks';
import { StoreState } from '@/reducers/types';
import styles from './index.scss';
import { Stock } from '@/types/stock';

export interface OptionalProps {}

const { dialog } = window.contextModules.electron;

const Optional: React.FC<OptionalProps> = () => {
  const dispatch = useDispatch();
  const { stockConfigs } = useSelector((state: StoreState) => state.stock);
  const { show: showAddDrawer, set: setAddDrawer, close: closeAddDrawer } = useDrawer(null);
  const sortStockConfig = useMemo(() => stockConfigs.map((_) => ({ ..._, id: _.secid })), [stockConfigs]);

  function onSortStockConfig(sortList: Stock.SettingItem[]) {
    const stockConfig = sortList.map((item, index) => {
      const stock = stockConfigs.find((s) => s.secid === item.secid)!;
      return {
        name: stock.name,
        secid: stock.secid,
        code: stock.code,
        market: stock.market,
        type: stock.type,
        pos: index,
      };
    });
    dispatch(setStockConfigAction(stockConfig));
  }

  async function onRemoveStock(stock: Stock.SettingItem) {
    const { response } = await dialog.showMessageBox({
      title: '删除股票',
      type: 'info',
      message: `确认删除 ${stock.name || ''} ${stock.code}`,
      buttons: ['确定', '取消'],
    });
    if (response === 0) {
      dispatch(deleteStockAction(stock.secid));
    }
  }

  return (
    <div className={styles.content}>
      {sortStockConfig.length ? (
        <ReactSortable animation={200} delay={2} list={sortStockConfig} setList={onSortStockConfig} dragClass={styles.dragItem} swap>
          {sortStockConfig.map((stock) => {
            return (
              <PureCard key={stock.secid} className={classnames(styles.row, 'hoverable')}>
                <RemoveIcon
                  className={styles.remove}
                  onClick={(e) => {
                    onRemoveStock(stock);
                    e.stopPropagation();
                  }}
                />
                <div className={styles.inner}>
                  <div className={styles.name}>
                    {stock.name}
                    <span className={styles.code}>（{stock.code}）</span>
                  </div>
                </div>
                <MenuIcon className={styles.menu} />
              </PureCard>
            );
          })}
        </ReactSortable>
      ) : (
        <Empty text="暂未自选股票~" />
      )}
      <div
        className={styles.add}
        onClick={(e) => {
          setAddDrawer(null);
          e.stopPropagation();
        }}
      >
        <AddIcon />
      </div>
      <CustomDrawer show={showAddDrawer}>
        <AddStockContent onClose={closeAddDrawer} onEnter={closeAddDrawer} />
      </CustomDrawer>
    </div>
  );
};
export default Optional;
