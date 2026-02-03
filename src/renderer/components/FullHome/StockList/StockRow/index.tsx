import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import classnames from 'classnames';
import { CheckOutlined } from '@ant-design/icons';
import { useHomeContext } from '@/components/FullHome';
import * as Utils from '@/utils';
import * as Enums from '@/utils/enums';
import { StoreState } from '@/reducers/types';
import styles from './index.scss';
import { Menu, Dropdown } from 'antd';
import { deleteStockAction, addStockTagAction, deleteStockTagAction } from '@/actions/stock';
import { PositionStock } from '@/helpers/stock';
import { Stock } from '@/types/stock';

export interface StockRowProps {
  config: Stock.SettingItem;
  selected?: boolean;
  tags: string[];
  onClick: (config: Stock.SettingItem) => void;
  onAddTag: (secid: string) => void;
}

const { dialog } = window.contextModules.electron;
const StockRow: React.FC<StockRowProps> = React.memo(({ config, selected, tags, onClick, onAddTag }) => {
  const stock = useSelector((state: StoreState) => state.stock.stocksMapping[config.secid]);
  const dispatch = useDispatch();
  const { darkMode } = useHomeContext();
  async function deleteStock() {
    const { response } = await dialog.showMessageBox({
      title: '删除股票',
      type: 'info',
      message: `确认删除 ${config.name || ''} ${config.code}`,
      buttons: ['确定', '取消'],
    });
    if (response === 0) {
      dispatch(deleteStockAction(config.secid));
    }
  }

  const onContextMenu = (e) => {
    switch (e.key) {
      case 'delete':
        deleteStock();
        break;
      case 'top':
      case 'bottom':
      case 'up':
      case 'down':
        let type = Enums.PositionType.Top;
        if (e.key === 'bottom') {
          type = Enums.PositionType.Bottom;
        } else if (e.key === 'up') {
          type = Enums.PositionType.Up;
        } else if (e.key === 'down') {
          type = Enums.PositionType.Down;
        }
        PositionStock(config.secid, type);
        break;
      case 'new_tag':
        onAddTag(config.secid);
        break;
      default:
        if (config.tags?.includes(e.key)) {
          dispatch(deleteStockTagAction(e.key, config.secid));
        } else {
          dispatch(addStockTagAction(e.key, config.secid));
        }
        break;
    }
  };
  const menu = (
    <Menu onClick={onContextMenu} theme={darkMode ? 'dark' : 'light'}>
      <Menu.Item key="delete" danger={true}>
        删除
      </Menu.Item>
      <Menu.Divider />
      <Menu.SubMenu title="选择分组">
        <Menu.Item key="new_tag">创建新分组</Menu.Item>
        {tags
          .filter((_) => _ !== '未分类')
          .map((t) => (
            <Menu.Item key={t}>
              {t}
              {config.tags?.includes(t) && <CheckOutlined />}
            </Menu.Item>
          ))}
      </Menu.SubMenu>
      <Menu.Item key="top">移到顶部</Menu.Item>
      <Menu.Item key="bottom">移到底部</Menu.Item>
      <Menu.Item key="up">上移</Menu.Item>
      <Menu.Item key="down">下移</Menu.Item>
    </Menu>
  );
  let nameColor = 'var(--text-color)';
  if (config.marktype == 1) {
    nameColor = '#FF9933';
  } else if (config.marktype == 2) {
    nameColor = '#0099DD';
  } else if (config.marktype == 3) {
    nameColor = '#B4CF66';
  }
  return (
    <>
      <Dropdown overlay={menu} trigger={['contextMenu']}>
        <div
          className={classnames(styles.row, {
            [styles.selected]: selected,
          })}
          onClick={() => onClick(config)}
        >
          {/** 最新价格及变化 */}
          {stock && (
            <div>
              <div className={styles.zd}>
                <div style={{ display: 'flex', cursor: 'pointer' }}>
                  <div className={styles.zindexName} style={{ color: nameColor }}>
                    {config.name}
                  </div>
                  <div className={styles.hybk}>&nbsp;{config.hybk?.name}</div>
                </div>
                <div style={{ display: 'flex' }}>
                  <div className={classnames(styles.zdd, Utils.GetValueColor(stock.detail.zdf).textClass)}>{stock.detail.zx}</div>
                  <div className={classnames(styles.zdf, Utils.GetValueColor(stock.detail.zdf).textClass)}>
                    {Utils.Yang(stock.detail.zdf)} %
                  </div>
                </div>
              </div>
              {/* <div>
                <div className={classnames(styles.value)}>
                  <div className={classnames(styles.zx, Utils.GetValueColor(stock.detail.zdf).textClass)}>
                    <TrendChart trends={stock.trends} flows={stock.tflows} zs={stock.detail.zs} />
                  </div>
                </div>
              </div> */}
            </div>
          )}
        </div>
      </Dropdown>
    </>
  );
});
export default StockRow;
