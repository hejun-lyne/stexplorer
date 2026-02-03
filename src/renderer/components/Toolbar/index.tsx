import React from 'react';
import { Badge } from 'antd';
import { useSelector } from 'react-redux';
import { useBoolean, useThrottleFn } from 'ahooks';

import { ReactComponent as MenuAddIcon } from '@/assets/icons/add.svg';
import { ReactComponent as RefreshIcon } from '@/assets/icons/refresh.svg';
import { ReactComponent as SettingIcon } from '@/assets/icons/setting.svg';
import CustomDrawer from '../CustomDrawer';
import ManageStockContent from '../MiniHome/StockList/ManageStockContent';
import SettingContent from '../SettingContent';
import { StoreState } from '@/reducers/types';
import { useScrollToTop } from '@/utils/hooks';
import * as Enums from '@/utils/enums';
import * as CONST from '@/constants';
import * as Helpers from '@/helpers';
import styles from './index.scss';

export interface ToolBarProps {}

const iconSize = { height: 18, width: 18 };
const ToolBar: React.FC<ToolBarProps> = () => {
  const { lowKeySetting, baseFontSizeSetting } = useSelector((state: StoreState) => state.setting.systemSetting);
  const { run: runLoadStocks } = useThrottleFn(Helpers.Stock.UpdateStockDetailsAndTrends, {
    wait: CONST.DEFAULT.FRESH_BUTTON_THROTTLE_DELAY,
  });
  const freshStocks = useScrollToTop({ after: () => runLoadStocks(true) });
  const [showManageStockDrawer, { setTrue: openManageStockDrawer, setFalse: closeManageStockDrawer, toggle: ToggleManageStockDrawer }] =
    useBoolean(false);
  const [showSettingDrawer, { setTrue: openSettingDrawer, setFalse: closeSettingDrawer, toggle: ToggleSettingDrawer }] = useBoolean(false);
  return (
    <>
      <style>{` html { filter: ${lowKeySetting && 'grayscale(100%)'} }`}</style>
      <style>{` html {font-size: ${baseFontSizeSetting}px }`}</style>
      <div className={styles.bar}>
        <MenuAddIcon style={{ ...iconSize }} onClick={openManageStockDrawer} />
        <RefreshIcon style={{ ...iconSize }} onClick={freshStocks} />
        <SettingIcon style={{ ...iconSize }} onClick={openSettingDrawer} />
      </div>
      <CustomDrawer show={showManageStockDrawer}>
        <ManageStockContent
          onClose={closeManageStockDrawer}
          onEnter={() => {
            freshStocks();
            closeManageStockDrawer();
          }}
        />
      </CustomDrawer>
      <CustomDrawer show={showSettingDrawer}>
        <SettingContent onClose={closeSettingDrawer} />
      </CustomDrawer>
    </>
  );
};
export default ToolBar;
