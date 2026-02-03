import React from 'react';
import { useSelector } from 'react-redux';
import classnames from 'classnames';
import { Spin } from 'antd';
import { StoreState } from '@/reducers/types';
import styles from './index.scss';

export interface LoadingScreenProps { }
const LoadingScreen: React.FC<LoadingScreenProps> = () => {
  const { stocksMapping, stocksLoading } = useSelector((state: StoreState) => state.stock);
  const loading = Object.entries(stocksMapping).length === 0 && stocksLoading;
  return (
    <div
      className={classnames(styles.content, {
        [styles.disable]: !loading,
      })}
    >
      <Spin spinning={loading} tip="数据初始化..." />
    </div>
  );
};
export default LoadingScreen;
