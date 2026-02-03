import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { Button, List, Row, Col, Tooltip } from 'antd';
import { StoreState } from '@/reducers/types';
import styles from './index.scss';
import { AimOutlined } from '@ant-design/icons';
import { CStateStrings, GStateStrings, KStateStrings, MAType } from '@/utils/enums';
import * as Utils from '@/utils';

export interface BKMonitorProps {
  onOpenStock: (secid: string, name: string) => void;
}
const BKMonitor: React.FC<BKMonitorProps> = ({ onOpenStock }) => {
  const { stockConfigs, stocksMapping } = useSelector((state: StoreState) => state.stock);
  tradings.forEach((t) => {
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
                    <Row>
                      <Col span={6}>
                        <Tooltip title="MA5">
                          <span>{KStateStrings[t.maStates[MAType.MA5]]}</span>
                          <span className={Utils.GetValueColor(t.maStates[MAType.MA5] > 3 ? -1 : 1).textClass}>
                            {t.maStates[MAType.MA5] > 3 ? '↓' : '↑'}
                          </span>
                        </Tooltip>
                      </Col>
                      <Col span={6}>
                        <Tooltip title="MA10">
                          <span>{KStateStrings[t.maStates[MAType.MA10]]}</span>
                          <span className={Utils.GetValueColor(t.maStates[MAType.MA20] > 3 ? -1 : 1).textClass}>
                            {t.maStates[MAType.MA10] > 3 ? '↓' : '↑'}
                          </span>
                        </Tooltip>
                      </Col>
                      <Col span={7}>
                        <Tooltip title="MA20">
                          <span>{KStateStrings[t.maStates[MAType.MA20]]}</span>
                          <span className={Utils.GetValueColor(t.maStates[MAType.MA20] > 3 ? -1 : 1).textClass}>
                            {t.maStates[MAType.MA20] > 3 ? '↓' : '↑'}
                          </span>
                        </Tooltip>
                      </Col>
                      <Col span={5}>
                        <Tooltip title="MA30">
                          <span>{KStateStrings[t.maStates[MAType.MA30]]}</span>
                          <span className={Utils.GetValueColor(t.maStates[MAType.MA30] > 3 ? -1 : 1).textClass}>
                            {t.maStates[MAType.MA30] > 3 ? '↓' : '↑'}
                          </span>
                        </Tooltip>
                      </Col>
                    </Row>
                    <Row>
                      <Col span={6}>
                        <Tooltip title="K线趋势">
                          <span>{CStateStrings[t.chanStates[0]]}</span>
                          <span className={Utils.GetValueColor(t.chanStates[0] > 2 ? -1 : 1).textClass}>
                            {t.chanStates[0] > 2 ? '↓' : '↑'}
                          </span>
                        </Tooltip>
                      </Col>
                      <Col span={6}>
                        <Tooltip title="G点">
                          <span>{GStateStrings[t.chanStates[1]]}</span>
                          <span className={Utils.GetValueColor(t.chanStates[1] > 3 ? -1 : 1).textClass}>
                            {t.chanStates[1] > 3 ? '↓' : '↑'}
                          </span>
                        </Tooltip>
                      </Col>
                      <Col span={6}>
                        <Tooltip title="消息面">
                          <span>{t.latestNewsAs === 'netural' ? '中性' : t.latestNewsAs === 'positive' ? '正面' : '负面'}</span>
                        </Tooltip>
                      </Col>
                      <Col span={6}></Col>
                    </Row>
                    <Row>
                      <div className={styles.explain}>{t.explain}</div>
                    </Row>
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

export default BKMonitor;
