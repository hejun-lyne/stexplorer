import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import classnames from 'classnames';
import { Dropdown, Menu } from 'antd';

import { ReactComponent as ArrowDownIcon } from '@/assets/icons/arrow-down.svg';
import { ReactComponent as ArrowUpIcon } from '@/assets/icons/arrow-up.svg';
import { setStockSortModeAction } from '@/actions/sort';
import { StoreState } from '@/reducers/types';
import * as Enums from '@/utils/enums';
import * as Helpers from '@/helpers';
import styles from './index.scss';

export interface SortBarProps {}

const SortBar: React.FC<SortBarProps> = () => {
  const dispatch = useDispatch();
  const {
    stockSortMode: { type: stockSortType, order: stockSortOrder },
  } = useSelector((state: StoreState) => state.sort.sortMode);
  const { stockSortModeOptions, stockSortModeOptionsMap } = Helpers.Sort.GetSortConfig();

  function renderMenu() {
    return (
      <div className={styles.bar}>
        <div className={styles.mode}>
          <Dropdown
            placement="bottomRight"
            overlay={
              <Menu selectedKeys={[String(stockSortModeOptionsMap[stockSortType].key)]}>
                {stockSortModeOptions.map(({ key, value }) => (
                  <Menu.Item key={String(key)} onClick={() => dispatch(setStockSortModeAction({ type: key }))}>
                    {value}
                  </Menu.Item>
                ))}
              </Menu>
            }
          >
            <a>{stockSortModeOptionsMap[stockSortType].value}</a>
          </Dropdown>
        </div>
        <div
          className={styles.sort}
          onClick={() =>
            dispatch(
              setStockSortModeAction({
                order: stockSortOrder === Enums.SortOrderType.Asc ? Enums.SortOrderType.Desc : Enums.SortOrderType.Asc,
              })
            )
          }
        >
          <ArrowUpIcon
            className={classnames({
              [styles.selectOrder]: stockSortOrder === Enums.SortOrderType.Asc,
            })}
          />
          <ArrowDownIcon
            className={classnames({
              [styles.selectOrder]: stockSortOrder === Enums.SortOrderType.Desc,
            })}
          />
        </div>
      </div>
    );
  }
  return <div className={classnames(styles.content)}>{renderMenu()}</div>;
};
export default SortBar;
