import React, { useEffect, useState } from 'react';
import styles from '../index.scss';
import * as Services from '@/services';
import { useRequest } from 'ahooks';
import { Row, Col } from 'antd';
import * as Utils from '@/utils';

export interface BriefStaticsProps {
  code: string;
}

const BriefStatics: React.FC<BriefStaticsProps> = React.memo(({ code }) => {
  const [statics, setStatics] = useState<any>([]);
  const { run: runGetStatics } = useRequest(Services.Stock.GetStockStatics, {
    throwOnError: true,
    manual: true,
    onSuccess: setStatics,
  });

  useEffect(() => {
    runGetStatics(code);
  }, []);

  return (
    <div className={styles.commonWrapper}>
      <Row className={styles.staticsrow}>
        <Col span={8} className={styles.statics}>
          <span>市盈率(动)</span>
          <span>{!statics.PE_DYNAMIC ? '--' : statics.PE_DYNAMIC}</span>
        </Col>
        <Col span={8} className={styles.statics}>
          <span>市净率</span>
          <span>{!statics.OPERATE_INCOME_RATIO ? '--' : statics.PB_MRQ_REALTIME}</span>
        </Col>
        <Col span={8} className={styles.statics}>
          <span>每股收益(元)</span>
          <span>{!statics.EPS ? '--' : statics.EPS.toFixed(4)}</span>
        </Col>
      </Row>
      <Row className={styles.staticsrow}>
        <Col span={8} className={styles.statics}>
          <span>每股净资产(元)</span>
          <span>{!statics.BVPS ? '--' : statics.BVPS.toFixed(4)}</span>
        </Col>
        <Col span={8} className={styles.statics}>
          <span>营业总收入(元)</span>
          <span>
            {!statics.TOTAL_OPERATE_INCOME
              ? '--'
              : statics.TOTAL_OPERATE_INCOME > 100000000
                ? (statics.TOTAL_OPERATE_INCOME / 100000000).toFixed(1) + '亿'
                : (statics.TOTAL_OPERATE_INCOME / 10000).toFixed(1) + '万'}
          </span>
        </Col>
        <Col span={8} className={styles.statics}>
          <span>营收同比</span>
          <span className={Utils.GetValueColor(statics.OPERATE_INCOME_RATIO).textClass}>
            {!statics.OPERATE_INCOME_RATIO ? '--' : statics.OPERATE_INCOME_RATIO.toFixed(2) + '%'}
          </span>
        </Col>
      </Row>
      <Row className={styles.staticsrow}>
        <Col span={8} className={styles.statics}>
          <span>净利润(元)</span>
          <span>
            {!statics.NETPROFIT
              ? '--'
              : statics.NETPROFIT > 100000000
                ? (statics.NETPROFIT / 100000000).toFixed(1) + '亿'
                : (statics.NETPROFIT / 10000).toFixed(1) + '万'}
          </span>
        </Col>
        <Col span={8} className={styles.statics}>
          <span>净利润同比</span>
          <span className={Utils.GetValueColor(statics.NETPROFIT_RATIO).textClass}>
            {!statics.NETPROFIT_RATIO ? '--' : statics.NETPROFIT_RATIO.toFixed(2) + '%'}
          </span>
        </Col>
        <Col span={8} className={styles.statics}>
          <span>毛利率</span>
          <span>{!statics.GROSS_PROFIT_RATIO ? '--' : statics.GROSS_PROFIT_RATIO.toFixed(2) + '%'}</span>
        </Col>
      </Row>
      <Row className={styles.staticsrow}>
        <Col span={8} className={styles.statics}>
          <span>净利率</span>
          <span>{!statics.NPR ? '--' : statics.NPR.toFixed(2) + '%'}</span>
        </Col>
        <Col span={8} className={styles.statics}>
          <span>净资产收益率</span>
          <span>{!statics.ROE ? '--' : statics.ROE.toFixed(2) + '%'}</span>
        </Col>
        <Col span={8} className={styles.statics}>
          <span>负债率</span>
          <span>{!statics.DEBT ? '--' : statics.DEBT.toFixed(2) + '%'}</span>
        </Col>
      </Row>
      <Row className={styles.staticsrow}>
        <Col span={8} className={styles.statics}>
          <span>总股本</span>
          <span>{!statics.TOTAL_SHARES ? '--' : (statics.TOTAL_SHARES / 100000000).toFixed(2) + '亿'}</span>
        </Col>
        <Col span={8} className={styles.statics}>
          <span>总市值(元)</span>
          <span>{!statics.TOTAL_MARKET_CAP ? '--' : (statics.TOTAL_MARKET_CAP / 100000000).toFixed(2) + '亿'}</span>
        </Col>
        <Col span={8} className={styles.statics}>
          <span>流通A股</span>
          <span>{!statics.FREE_A_SHARES ? '--' : (statics.FREE_A_SHARES / 100000000).toFixed(2) + '亿'}</span>
        </Col>
      </Row>
      <Row className={styles.staticsrow}>
        <Col span={8} className={styles.statics}>
          <span>流A市值(元)</span>
          <span>{!statics.MARKETCAP_FREE_A ? '--' : (statics.MARKETCAP_FREE_A / 100000000).toFixed(2) + '亿'}</span>
        </Col>
        <Col span={8} className={styles.statics}>
          <span>质押比例</span>
          <span>{!statics.PLEDGE_RATIO ? '--' : statics.PLEDGE_RATIO.toFixed(2) + '%'}</span>
        </Col>
        <Col span={8} className={styles.statics}>
          <span>商誉规模</span>
          <span>
            {!statics.GOODWILL
              ? '--'
              : statics.GOODWILL > 100000000
                ? (statics.GOODWILL / 100000000).toFixed(1) + '亿'
                : (statics.GOODWILL / 10000).toFixed(1) + '万'}
          </span>
        </Col>
      </Row>
    </div>
  );
});
export default BriefStatics;
