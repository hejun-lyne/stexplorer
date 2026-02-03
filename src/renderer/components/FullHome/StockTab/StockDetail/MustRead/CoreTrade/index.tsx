import React, { useCallback, useEffect, useState } from 'react';
import styles from '../index.scss';
import * as Services from '@/services';
import * as Utils from '@/utils';
import { useRequest } from 'ahooks';
import { Col, Collapse, Row, Tabs } from 'antd';
import DeptTradeBack from './DeptTradeBack';
import { batch } from 'react-redux';

export interface CoreTradeProps {
  code: string;
}

const CoreTrade: React.FC<CoreTradeProps> = React.memo(({ code }) => {
  const [lhbangs, setLHBangs] = useState<any[]>();
  const { run: runGetLongHuBang } = useRequest(Services.Stock.GetLongHuBang, {
    throwOnError: true,
    manual: true,
    onSuccess: setLHBangs,
    cacheKey: `GetLongHuBang/${code}`,
  });
  const [blockTrades, setBlockTrades] = useState<any[]>();
  const { run: runGetBlockTrade } = useRequest(Services.Stock.GetBlockTrades, {
    throwOnError: true,
    manual: true,
    onSuccess: setBlockTrades,
    cacheKey: `GetBlockTrades/${code}`,
  });
  const [holderChanges, setHolderChanges] = useState<any[]>();
  const { run: runGetHolderChange } = useRequest(Services.Stock.GetHolderChanges, {
    throwOnError: true,
    manual: true,
    onSuccess: setHolderChanges,
    cacheKey: `GetHolderChanges/${code}`,
  });
  const [exchangeChanges, setExchangeChanges] = useState<any[]>();
  const { run: runGetExchangeChange } = useRequest(Services.Stock.GetExchangeChanges, {
    throwOnError: true,
    manual: true,
    onSuccess: setExchangeChanges,
    cacheKey: `GetExchangeChanges/${code}`,
  });
  const [zhiyaSum, setZhiyaSum] = useState<any[]>();
  const { run: runGetZhiyaSum } = useRequest(Services.Stock.GetStockZhiYaSum, {
    throwOnError: true,
    manual: true,
    onSuccess: setZhiyaSum,
    cacheKey: `GetStockZhiYaSum/${code}`,
  });
  const [nomoreZhiya, setnomoreZhiya] = useState(false);
  const [zhiyaPage, setZhiyaPage] = useState(1);
  const [zhiyaDetail, setZhiyaDetail] = useState<any[]>();
  const { run: runGetZhiyaDetail } = useRequest(Services.Stock.GetStockZhiYaDetail, {
    throwOnError: true,
    manual: true,
    onSuccess: (d) => {
      if (!zhiyaDetail) {
        setZhiyaDetail(d);
      } else {
        setZhiyaDetail(zhiyaDetail.concat(d));
      }
      if (d && d.length == 0) {
        setnomoreZhiya(true);
      }
    },
    cacheKey: `GetStockZhiYaSum/${code}`,
  });
  useEffect(() => {
    runGetLongHuBang(code);
    runGetBlockTrade(code);
    runGetHolderChange(code);
    runGetExchangeChange(code);
    runGetZhiyaSum(code);
    runGetZhiyaDetail(code);
  }, [code]);

  const [deptCodes, setDeptCodes] = useState([]);
  const [modelVisible, setModelVisible] = useState(false);
  const showDeptTradeBacks = useCallback((list) => {
    batch(() => {
      setDeptCodes(list.map((l) => l.OPERATEDEPT_CODE));
      setModelVisible(true);
    });
  }, []);

  const loadMoreZhiya = useCallback(() => {
    const p = zhiyaPage + 1;
    runGetZhiyaDetail(code, p);
    setZhiyaPage(p);
  }, [code, zhiyaPage]);
  return (
    <div className={styles.coretrade}>
      <DeptTradeBack codes={deptCodes} visible={modelVisible} close={() => setModelVisible(false)} />
      <Tabs tabPosition="left" defaultActiveKey={'lhb'} style={{ height: '100%' }}>
        <Tabs.TabPane tab={<span>龙虎榜</span>} key={'lhb'}>
          <div className={styles.cardcontent}>
            <Collapse expandIconPosition="right">
              {lhbangs?.map((d) => (
                <Collapse.Panel
                  header={
                    <>
                      <div>{d.TRADE_DATE.substring(0, 10)}</div>
                      <div>{d.EXPLANATION}</div>
                      <div style={{ display: 'flex' }}>
                        <div style={{ marginRight: 15 }}>
                          <span>成交额</span>
                          <span className={Utils.GetValueColor(d.ACCUM_AMOUNT).textClass}>
                            {(d.ACCUM_AMOUNT / 100000000.0).toFixed(2)}亿
                          </span>
                        </div>
                        <div style={{ marginRight: 15 }}>
                          <span>涨跌幅</span>
                          <span className={Utils.GetValueColor(d.CHANGE_RATE).textClass}>{d.CHANGE_RATE.toFixed(2)}%</span>
                        </div>
                        <div>
                          <span>净买入</span>
                          <span className={Utils.GetValueColor(d.NET_BUY).textClass}>{(d.NET_BUY / 10000.0).toFixed(2)}万</span>
                        </div>
                      </div>
                    </>
                  }
                  key={d.TRADE_ID}
                >
                  <div className={styles.lhb}>
                    <Row gutter={10} style={{ marginBottom: 5 }} className={styles.rowheader}>
                      <Col span={9}>
                        <a onClick={() => showDeptTradeBacks(d.LIST.filter((l) => parseInt(l.TRADE_DIRECTION) === 0))}>买入营业部</a>
                      </Col>
                      <Col span={5}>买入金额(元)</Col>
                      <Col span={5}>卖出金额(元)</Col>
                      <Col span={5}>买入占比(元)</Col>
                    </Row>
                    {d.LIST.filter((l) => parseInt(l.TRADE_DIRECTION) === 0).map((l) => (
                      <Row gutter={10} key={l.OPERATEDEPT_NAME}>
                        <Col span={9}>{l.OPERATEDEPT_NAME}</Col>
                        <Col span={5} className={Utils.GetValueColor(1).textClass}>
                          {!l.BUY_AMT_REAL ? '--' : (l.BUY_AMT_REAL / 10000.0).toFixed(2)}万
                        </Col>
                        <Col span={5} className={Utils.GetValueColor(-1).textClass}>
                          {!l.SELL_AMT_REAL ? '--' : (l.SELL_AMT_REAL / 10000.0).toFixed(2)}万
                        </Col>
                        <Col span={5}>{!l.BUY_RATIO ? '--' : l.BUY_RATIO.toFixed(2)}%</Col>
                      </Row>
                    ))}
                    <Row gutter={10} style={{ marginBottom: 5, marginTop: 5 }} className={styles.rowheader}>
                      <Col span={9}>卖出营业部</Col>
                      <Col span={5}>卖出金额(元)</Col>
                      <Col span={5}>买入金额(元)</Col>
                      <Col span={5}>卖出占比(元)</Col>
                    </Row>
                    {d.LIST.filter((l) => parseInt(l.TRADE_DIRECTION) === 1).map((l) => (
                      <Row gutter={10} key={l.OPERATEDEPT_NAME}>
                        <Col span={9}>{l.OPERATEDEPT_NAME}</Col>
                        <Col span={5} className={Utils.GetValueColor(-1).textClass}>
                          {!l.SELL_AMT_REAL ? '--' : (l.SELL_AMT_REAL / 10000.0).toFixed(2)}万
                        </Col>
                        <Col span={5} className={Utils.GetValueColor(1).textClass}>
                          {!l.BUY_AMT_REAL ? '--' : (l.BUY_AMT_REAL / 10000.0).toFixed(2)}万
                        </Col>
                        <Col span={5}>{!l.SELL_RATIO ? '--' : l.SELL_RATIO.toFixed(2)}%</Col>
                      </Row>
                    ))}
                  </div>
                </Collapse.Panel>
              ))}
            </Collapse>
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span>大宗交易</span>} key={'dzjy'}>
          <div className={styles.cardcontent}>
            {blockTrades?.map((b) => (
              <div className={styles.blocktrade} key={b.DEAL_AMT}>
                <Row>
                  <Col span={4}>交易日期</Col>
                  <Col span={4}>{!b.TRADE_DATE ? '--' : b.TRADE_DATE.substring(0, 10)}</Col>
                  <Col span={3}>成交价(元)</Col>
                  <Col span={4}>{b.DEAL_PRICE}</Col>
                </Row>
                <Row>
                  <Col span={4}>成交额</Col>
                  <Col span={4}>{(b.DEAL_AMT / 10000.0).toFixed(2)}万</Col>
                  <Col span={3}>折/溢价率</Col>
                  <Col span={4} className={Utils.GetValueColor(b.PREMIUM_RATIO).textClass}>
                    {(b.PREMIUM_RATIO * 100).toFixed(2)}%
                  </Col>
                </Row>
                <Row>
                  <Col span={4}>买入营业部</Col>
                  <Col span={20}>{b.BUYER_NAME}</Col>
                </Row>
                <Row>
                  <Col span={4}>卖出营业部</Col>
                  <Col span={20}>{b.SELLER_NAME}</Col>
                </Row>
              </div>
            ))}
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span>股东增减</span>} key={'gdzj'}>
          <div className={styles.cardcontent}>
            <div className={styles.gdzj}>
              <Row className={styles.rowheader}>
                <Col span={4}>截止日期</Col>
                <Col span={4}>起始日期</Col>
                <Col span={6}>股东名称</Col>
                <Col span={6}>变动数量(股)(变动比例)</Col>
                <Col span={4}>变动后持股比例</Col>
              </Row>
              {holderChanges?.map((h) => (
                <Row key={h.CHANGE_NUM}>
                  <Col span={4}>{!h.END_DATE ? '--' : h.END_DATE.substring(0, 10)}</Col>
                  <Col span={4}>{!h.START_DATE ? '--' : h.START_DATE.substring(0, 10)}</Col>
                  <Col span={6}>{h.HOLDER_NAME}</Col>
                  <Col span={6} className={Utils.GetValueColor(h.CHANGE_NUM).textClass}>
                    {(h.CHANGE_NUM / 10000.0).toFixed(2)}万 ({!h.CHANGE_RATIO ? '--' : h.CHANGE_RATIO.toFixed(2) + '%'})
                  </Col>
                  <Col span={4}>{!h.HOLD_RATIO ? '--' : h.HOLD_RATIO.toFixed(2)}%</Col>
                </Row>
              ))}
            </div>
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span>高管增减</span>} key={'ggzj'}>
          <div className={styles.cardcontent}>
            <div className={styles.ggzj}>
              <Row>
                <Col span={3}>变动日期</Col>
                <Col span={2}>变动人</Col>
                <Col span={3}>变动数量(股)</Col>
                <Col span={3}>交易均价(元)</Col>
                <Col span={3}>结存股票(股)</Col>
                <Col span={3}>交易方式</Col>
                <Col span={2}>董监高管</Col>
                <Col span={3}>高管职位</Col>
                <Col span={2}>关系</Col>
              </Row>
              {exchangeChanges?.map((e, i) => (
                <Row key={i}>
                  <Col span={3}>{!e.END_DATE ? '--' : e.END_DATE.substring(0, 10)}</Col>
                  <Col span={2}>{e.HOLDER_NAME}</Col>
                  <Col span={3} className={Utils.GetValueColor(e.CHANGE_NUM).textClass}>
                    {(e.CHANGE_NUM / 10000.0).toFixed(2)}万
                  </Col>
                  <Col span={3}>{!e.AVERAGE_PRICE ? '--' : e.AVERAGE_PRICE.toFixed(2)}</Col>
                  <Col span={3}>{!e.CHANGE_AFTER_HOLDNUM ? '--' : (e.CHANGE_AFTER_HOLDNUM / 10000.0).toFixed(2)}万</Col>
                  <Col span={3}>{e.TRADE_WAY}</Col>
                  <Col span={2}>{e.EXECUTIVE_NAME}</Col>
                  <Col span={3}>{e.POSITION}</Col>
                  <Col span={2}>{e.EXECUTIVE_RELATION}</Col>
                </Row>
              ))}
            </div>
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span>股权质押</span>} key={'gqzy'}>
          <div className={styles.cardcontent}>
            <div className={styles.gqzy}>
                {zhiyaSum && <>
                  <Row>
                    <Col span={12}>股东名称</Col>
                    <Col span={4}>质押股数</Col>
                    <Col span={4}>占持股比</Col>
                    <Col span={4}>占总股本比</Col>
                  </Row>
                  {zhiyaSum?.map((e, i) => (
                    <Row key={i}>
                      <Col span={12}>{e.HOLDER_NAME}</Col>
                      <Col span={4}>{(e.ACCUM_PLEDGE_NUM / 10000.0).toFixed(2)}万</Col>
                      <Col span={4}>{e.ACCUM_PLEDGE_HR}%</Col>
                      <Col span={4}>{e.ACCUM_PLEDGE_TSR}%</Col>
                    </Row>
                  ))}
                </>}
                <br />
                {zhiyaDetail && <>
                  <Row>
                    <Col span={4}>质押日期</Col>
                    <Col span={3}>股东名称</Col>
                    <Col span={3}>质押股数</Col>
                    <Col span={2}>质押价</Col>
                    <Col span={2}>预警线</Col>
                    <Col span={3}>平仓线</Col>
                    <Col span={3}>市值</Col>
                    <Col span={4}>状态</Col>
                  </Row>
                  {zhiyaDetail?.map((e, i) => (
                    <>
                    <Row key={i}>
                      <Col span={4}>{!e.PF_START_DATE ? '--' : e.PF_START_DATE.substring(0, 10)}</Col>
                      <Col span={3}>{e.HOLDER_NAME}</Col>
                      <Col span={3}>{(e.PF_NUM / 10000.0).toFixed(2)}万</Col>
                      <Col span={2}>{!e.CLOSE_FORWARD_ADJPRICE ? '--' : e.CLOSE_FORWARD_ADJPRICE.toFixed(2)}</Col>
                      <Col span={2}>{!e.WARNING_LINE ? '--' : e.WARNING_LINE.toFixed(2)}</Col>
                      <Col span={3}>{!e.OPENLINE ? '--' : e.OPENLINE.toFixed(2)}</Col>
                      <Col span={3}>{(e.MARKET_CAP / 100000000.0).toFixed(2)}亿</Col>
                      <Col span={4}>{e.WARNING_STATE}</Col>
                    </Row>
                    </>
                  ))}
                  {!nomoreZhiya && (
                      <div className={styles.loadmore} onClick={loadMoreZhiya}>
                      <span>加载更多</span>
                    </div>
                    )}
                </>}
            </div>
          </div>
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
});
export default CoreTrade;
