import React from 'react';
import { Col, Row } from 'antd';
import MarketMood from './MarketMood';
import MarketPeriod from './MarketPeriod';
import MarketStatistic from './MarketStatistic';

export interface MarketMonitorProps { }

const MarketMonitor: React.FC<MarketMonitorProps> = React.memo(() => {
  return (
    <Row style={{ height: '100%', marginTop: 4 }} gutter={4}>
      <Col span={8} style={{ height: '100%', backgroundColor: 'var(--background-color)' }}>
        <MarketMood />
      </Col>
      <Col span={8} style={{ height: '100%', backgroundColor: 'var(--background-color)' }}>
        <MarketPeriod />
      </Col>
      <Col span={8} style={{ height: '100%', backgroundColor: 'var(--background-color)' }}>
        <MarketStatistic />
      </Col>
    </Row>
  );
});
export default MarketMonitor;
