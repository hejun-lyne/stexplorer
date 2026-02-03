import React, { useCallback, useRef } from 'react';
import styles from './index.scss';
import { useDispatch } from 'react-redux';
import GridLayout from 'react-grid-layout';
import { removeTagMonitor, updateMonitorLayouts } from '@/actions/setting';
import { Col, Row } from 'antd';

export interface TradeReviewProps {
  onOpenStock: (secid: string, name: string, change?: number) => void;
}

const TradeReview: React.FC<TradeReviewProps> = React.memo(({ onOpenStock }) => {
  const dispatch = useDispatch();
  return (
    <div className={styles.container}>
      <Row>
        <Col span={12}>行业分布</Col>
        <Col span={12}>胜率表现</Col>
      </Row>
      <Row>
        <Col span={12}>成功案例</Col>
        <Col span={12}>失败案例</Col>
      </Row>
    </div>
  );
});
export default TradeReview;
