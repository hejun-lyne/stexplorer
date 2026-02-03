import React, { PropsWithChildren, useState } from 'react';
import { Drawer } from 'antd';

export interface CustomDrawerProps {
  show: boolean;
  width?: string | number;
  placement?: string;
}

const CustomDrawer: React.FC<PropsWithChildren<CustomDrawerProps>> = ({ show, width, placement, children, ...config }) => {
  const [drawerOpened, setDrawerOpened] = useState(show);
  const w = width || '100%';
  const p = placement || 'bottom';
  return (
    <Drawer
      visible={show}
      closable={false}
      handler={false}
      placement={p}
      getContainer={false}
      height="100vh"
      width={w}
      mask={false}
      keyboard={false}
      afterVisibleChange={setDrawerOpened}
      bodyStyle={{ padding: 0, overflow: 'hidden' }}
      push={false}
      style={{
        width: w,
      }}
      {...config}
    >
      {(show || drawerOpened) && children}
    </Drawer>
  );
};
export default CustomDrawer;
