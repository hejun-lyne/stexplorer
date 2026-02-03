import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { Button, List, Row, Col, Tooltip } from 'antd';
import { StoreState } from '@/reducers/types';
import styles from './index.scss';
import { AimOutlined } from '@ant-design/icons';
import { CStateStrings, GStateStrings, KStateStrings, MAType } from '@/utils/enums';
import * as Utils from '@/utils';

export interface TradeHistProps {
  onOpenStock: (secid: string, name: string) => void;
  onOpenReview: () => void;
}
const TradeHist: React.FC<TradeHistProps> = ({ onOpenStock, onOpenReview }) => {
  const { tradings, stockConfigsMapping } = useSelector((state: StoreState) => state.stock);
  tradings?.forEach((t) => {
    if (!t.name && stockConfigsMapping[t.secid]) {
      t.name = stockConfigsMapping[t.secid].name;
    }
  });
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span>交易记录</span>
        <Button type="link" size="small" style={{ float: 'right' }} icon={<AimOutlined />} onClick={onOpenReview}>
          分析
        </Button>
      </div>
      <List
        dataSource={tradings.sort((a, b) => (a.time > b.time ? -1 : 1))}
        renderItem={(t) => (
          <List.Item>
            <div className={styles.row}>
              <div className={styles.rowHeader}>
                <div>{t.time.split(' ')[0]}</div>
                <div className={Utils.GetValueColor(t.type === 'buy' ? 1 : -1).textClass}>&nbsp;{t.type === 'buy' ? '买入' : '卖出'}</div>
                <div><a style={{ marginLeft: 5, marginRight: 5 }} onClick={() => onOpenStock(t.secid, t.name)}>
                  {t.name}
                </a></div>
              </div>
              <div className={styles.rowContent}>
                <Row>
                  <Col span={4} className={styles.leader}>
                    操作
                  </Col>
                  <Col span={20}>
                    <Row>
                      <Col span={6}>
                        <Tooltip title="价格">
                          <span>{t.price}</span>
                        </Tooltip>
                      </Col>
                      <Col span={6}>
                        <Tooltip title="数量">
                          <span>{t.count}</span>
                        </Tooltip>
                      </Col>
                      <Col span={12}>
                        <Tooltip title="盈亏">
                          {t.profits ? (
                            <span className={Utils.GetValueColor(t.profits[t.profits.length - 1]).textClass}>
                              {Utils.Yang(t.profits[t.profits.length - 1])}%
                            </span>
                          ) : (
                            <span>--</span>
                          )}
                        </Tooltip>
                      </Col>
                    </Row>
                  </Col>
                </Row>
                <Row>
                  <Col span={4} className={styles.leader}>
                    理由
                  </Col>
                  <Col span={20}>
                    <div className={styles.explain}>{t.explain}</div>
                  </Col>
                </Row>
                {t.profits && (
                  <Row>
                    <Col span={4} className={styles.leader}>
                      结果
                    </Col>
                    <Col span={20}>
                      <Row>
                        <Col span={6}>
                          <Tooltip title="当日">
                            {t.profits[0] === -1 ? (
                              <span>--</span>
                            ) : (
                              <span className={Utils.GetValueColor(t.profits[0]).textClass}>{Utils.Yang(t.profits[0])}%</span>
                            )}
                          </Tooltip>
                        </Col>
                        <Col span={6}>
                          <Tooltip title="次日">
                            {t.profits[1] === -1 ? (
                              <span>--</span>
                            ) : (
                              <span className={Utils.GetValueColor(t.profits[1]).textClass}>{Utils.Yang(t.profits[1])}%</span>
                            )}
                          </Tooltip>
                        </Col>
                        <Col span={6}>
                          <Tooltip title="5日">
                            {t.profits[2] === -1 ? (
                              <span>--</span>
                            ) : (
                              <span className={Utils.GetValueColor(t.profits[2]).textClass}>{Utils.Yang(t.profits[2])}%</span>
                            )}
                          </Tooltip>
                        </Col>
                        <Col span={6}>
                          <Tooltip title="10日">
                            {t.profits[3] === -1 ? (
                              <span>--</span>
                            ) : (
                              <span className={Utils.GetValueColor(t.profits[3]).textClass}>{Utils.Yang(t.profits[3])}%</span>
                            )}
                          </Tooltip>
                        </Col>
                      </Row>
                    </Col>
                  </Row>
                )}
              </div>
            </div>
          </List.Item>
        )}
      />
    </div>
  );
};

export default TradeHist;
