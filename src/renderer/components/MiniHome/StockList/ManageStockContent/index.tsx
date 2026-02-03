import React, { useState } from 'react';
import { Tabs } from 'antd';
import PureCard from '@/components/Card/PureCard';
import Optional from './Optional';
import SelfRank from './SelfRank';
import MainRank from './MainRank';
import CustomDrawerContent from '@/components/CustomDrawer/Content';
import styles from './index.scss';

export interface ManageStockContentProps {
  onEnter: () => void;
  onClose: () => void;
}

const ManageStockContent: React.FC<ManageStockContentProps> = ({ onEnter, onClose }) => {
  return (
    <CustomDrawerContent title="管理股票" enterText="确定" onEnter={onEnter} onClose={onClose}>
      <div className={styles.content}>
        <Tabs animated={{ tabPane: true }} tabBarGutter={15}>
        <Tabs.TabPane tab="自选股票" key={String(0)}>
            <Optional />
          </Tabs.TabPane>
          <Tabs.TabPane tab="个股资金流" key={String(1)}>
            <PureCard>
              <SelfRank />
            </PureCard>
          </Tabs.TabPane>
          <Tabs.TabPane tab="主力排名" key={String(2)}>
            <PureCard>
              <MainRank />
            </PureCard>
          </Tabs.TabPane>
        </Tabs>
      </div>
    </CustomDrawerContent>
  );
};
export default ManageStockContent;
