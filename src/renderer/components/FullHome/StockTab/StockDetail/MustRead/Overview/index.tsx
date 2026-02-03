import React, { useCallback, useEffect, useState } from 'react';
import styles from '../index.scss';
import * as Services from '@/services';
import { useRequest } from 'ahooks';
import { Row, Col, Button } from 'antd';
import * as Utils from '@/utils';
import { CopyOutlined } from '@ant-design/icons';
const { clipboard } = window.contextModules.electron;

export interface StockOverviewProps {
  code: string;
}

const StockOverview: React.FC<StockOverviewProps> = React.memo(({ code }) => {
  const [statics, setStatics] = useState<any>({});
  const { run: runGetStatics } = useRequest(Services.Stock.GetStockOverview, {
    throwOnError: true,
    manual: true,
    onSuccess: setStatics,
  });
  const [mainops, setMainops] = useState<any>([]);
  const { run: runGetMainops } = useRequest(Services.Stock.GetStockMainOp, {
    throwOnError: true,
    manual: true,
    onSuccess: setMainops,
  });

  useEffect(() => {
    runGetStatics(code);
    runGetMainops(code);
  }, []);

  return (
    <div className={styles.commonWrapper}>
      <strong>公司简介({statics.SECUCODE})</strong>
      <Button type='text' onClick={() => clipboard.writeText(`${statics.SECUCODE.endsWith('.SH') ? '1' : '0'}.${code}`)}><CopyOutlined /></Button>
      <Row>
        <Col span={6}>
          <span>成立日期&nbsp;&nbsp;{!statics.FOUND_DATE ? '--' : statics.FOUND_DATE.substring(0, 10)}</span>
        </Col>
        <Col span={6}>
          <span>
            注册资本(元)&nbsp;&nbsp;
            {!statics.REG_CAPITAL
              ? '--'
              : statics.REG_CAPITAL > 10000
                ? (statics.REG_CAPITAL / 10000).toFixed(1) + '亿'
                : statics.REG_CAPITAL.toFixed(1) + '万'}
          </span>
        </Col>
        <Col span={6}>
          <span>员工人数&nbsp;&nbsp;{statics.TOTAL_NUM}</span>
        </Col>
        <Col span={6}>
          <span>管理层人数&nbsp;&nbsp;{statics.TATOLNUMBER}</span>
        </Col>
      </Row>
      <div style={{ padding: 4, border: '1px solid grey' }}>{statics.ORG_PROFIE}</div>
      <br />
      <strong>主营业务</strong>
      <div>{statics.MAIN_BUSINESS}</div>
      <br />
      <strong>收入构成</strong>
      <Row className={styles.staticsheader}>
        <Col span={6}>主营行业/产品</Col>
        <Col span={6}>收入(元)</Col>
        <Col span={6}>收入占比</Col>
        <Col span={6}>毛利率</Col>
      </Row>
      {mainops && mainops.filter((s) => s.MAINOP_TYPE == '1').map((s, i) => (
        <Row key={i}>
          <Col span={6}>{s.ITEM_NAME}</Col>
          <Col span={6}>
            {s.MAIN_BUSINESS_INCOME > 100000000
              ? (s.MAIN_BUSINESS_INCOME / 100000000).toFixed(1) + '亿'
              : (s.MAIN_BUSINESS_INCOME / 10000).toFixed(1) + '万'}
          </Col>
          <Col span={6}>{!s.GROSS_RPOFIT_RATIO ? '--' : (s.MBI_RATIO * 100).toFixed(2) + '%'}</Col>
          <Col span={6}>{!s.GROSS_RPOFIT_RATIO ? '--' : (s.GROSS_RPOFIT_RATIO * 100).toFixed(2) + '%'}</Col>
        </Row>
      ))}
      <hr />
      {mainops && mainops.filter((s) => s.MAINOP_TYPE == '2').map((s, i) => (
        <Row key={i}>
          <Col span={6}>{s.ITEM_NAME}</Col>
          <Col span={6}>
            {s.MAIN_BUSINESS_INCOME > 100000000
              ? (s.MAIN_BUSINESS_INCOME / 100000000).toFixed(1) + '亿'
              : (s.MAIN_BUSINESS_INCOME / 10000).toFixed(1) + '万'}
          </Col>
          <Col span={6}>{!s.GROSS_RPOFIT_RATIO ? '--' : (s.MBI_RATIO * 100).toFixed(2) + '%'}</Col>
          <Col span={6}>{!s.GROSS_RPOFIT_RATIO ? '--' : (s.GROSS_RPOFIT_RATIO * 100).toFixed(2) + '%'}</Col>
        </Row>
      ))}
    </div>
  );
});
export default StockOverview;
