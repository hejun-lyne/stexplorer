import React, { useEffect, useState } from 'react';
import styles from '../index.scss';
import * as Services from '@/services';
import { useRequest } from 'ahooks';

export interface KeyFinanceProps {
  code: string;
}

const KeyFinance: React.FC<KeyFinanceProps> = React.memo(({ code }) => {
  const [reports, setReports] = useState<any[]>([]);
  const { run: runGetReport } = useRequest(Services.Stock.GetReportData, {
    throwOnError: true,
    manual: true,
    onSuccess: setReports,
    cacheKey: `GetReportData/${code}`,
  });
  useEffect(() => {
    runGetReport(code);
  }, [code]);
  return (
    <>
      <div className={styles.leading}>
        <div style={{ width: 150 }}>
          <span>报告期</span>
        </div>
        <div className={styles.data}>
          {reports?.map((r) => (
            <div key={r.REPORT_DATE_NAME}>
              <div className={styles.header}>
                <span>{r.REPORT_DATE_NAME}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.coretheme}>
        <div>
          <div className={styles.wrapper}>
            <div className={styles.row}>
              <strong>每股指标</strong>
            </div>
            <div className={styles.row}>
              <span>基本每股收益(元)</span>
            </div>
            <div className={styles.row}>
              <span>扣非每股收益(元)</span>
            </div>
            <div className={styles.row}>
              <span>稀释每股收益(元)</span>
            </div>
            <div className={styles.row}>
              <span>每股净资产(元)</span>
            </div>
            <div className={styles.row}>
              <span>每股资本公积(元)</span>
            </div>
            <div className={styles.row}>
              <span>每股未分配利润(元)</span>
            </div>
            <div className={styles.row}>
              <span>每股经营现金流(元)</span>
            </div>
          </div>
          <div className={styles.wrapper}>
            <div className={styles.row}>
              <strong>成长能力</strong>
            </div>
            <div className={styles.row}>
              <span>营业总收入(元)</span>
            </div>
            <div className={styles.row}>
              <span>毛利润(元)</span>
            </div>
            <div className={styles.row}>
              <span>归属净利润(元)</span>
            </div>
            <div className={styles.row}>
              <span>扣非净利润(元)</span>
            </div>
            <div className={styles.row}>
              <span>营业总收入同比增长</span>
            </div>
            <div className={styles.row}>
              <span>归属净利润同比增长</span>
            </div>
            <div className={styles.row}>
              <span>扣非净利润同比增长</span>
            </div>
            <div className={styles.row}>
              <span>营业总收入滚动环比增长</span>
            </div>
            <div className={styles.row}>
              <span>归属净利润滚动环比增长</span>
            </div>
            <div className={styles.row}>
              <span>扣非净利润滚动环比增长</span>
            </div>
          </div>
          <div className={styles.wrapper}>
            <div className={styles.row}>
              <strong>盈利能力</strong>
            </div>
            <div className={styles.row}>
              <span>净资产收益率(加权)</span>
            </div>
            <div className={styles.row}>
              <span>净资产收益率(扣非/加权)</span>
            </div>
            <div className={styles.row}>
              <span>总资产收益率(加权)</span>
            </div>
            <div className={styles.row}>
              <span>投入资本回报率</span>
            </div>
            <div className={styles.row}>
              <span>毛利率</span>
            </div>
            <div className={styles.row}>
              <span>净利率</span>
            </div>
          </div>
          <div className={styles.wrapper}>
            <div className={styles.row}>
              <strong>收益质量</strong>
            </div>
            <div className={styles.row}>
              <span>销售净现金流/营业收入</span>
            </div>
            <div className={styles.row}>
              <span>经营净现金流/营业收入</span>
            </div>
          </div>
          <div className={styles.wrapper}>
            <div className={styles.row}>
              <strong>财务风险</strong>
            </div>
            <div className={styles.row}>
              <span>流动比率</span>
            </div>
            <div className={styles.row}>
              <span>速动比率</span>
            </div>
            <div className={styles.row}>
              <span>现金流量比率</span>
            </div>
            <div className={styles.row}>
              <span>资产负债率</span>
            </div>
            <div className={styles.row}>
              <span>权益乘数</span>
            </div>
            <div className={styles.row}>
              <span>产权比率</span>
            </div>
          </div>
          <div className={styles.wrapper}>
            <div className={styles.row}>
              <strong>营运能力</strong>
            </div>
            <div className={styles.row}>
              <span>总资产周转天数(天)</span>
            </div>
            <div className={styles.row}>
              <span>存货周转天数(天)</span>
            </div>
            <div className={styles.row}>
              <span>应收帐款周转天数(天)</span>
            </div>
            <div className={styles.row}>
              <span>总资产周转率(次)</span>
            </div>
            <div className={styles.row}>
              <span>存货周转率(次)</span>
            </div>
            <div className={styles.row}>
              <span>应收帐款周转率(次)</span>
            </div>
          </div>
        </div>
        <div className={styles.data}>
          {reports &&
            reports.map((r) => (
              <div key={r.REPORT_DATE_NAME}>
                <div className={styles.wrapper}>
                  <div className={styles.row}>
                    <strong>&#8205; </strong>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.EPSJB ? '--' : r.EPSJB.toFixed(4)}</span>
                  </div>
                  <div className={styles.row}>
                    <span>{r.EPSKCJB ? r.EPSKCJB.toFixed(4) : '--'}</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.EPSXS ? '--' : r.EPSXS.toFixed(4)}</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.BPS ? '--' : r.BPS.toFixed(4)}</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.MGZBGJ ? '--' : r.MGZBGJ.toFixed(4)}</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.MGWFPLR ? '--' : r.MGWFPLR.toFixed(4)}</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.MGJYXJJE ? '--' : r.MGJYXJJE.toFixed(4)}</span>
                  </div>
                </div>
                <div className={styles.wrapper}>
                  <div className={styles.row}>
                    <strong>&#8205; </strong>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.TOTALOPERATEREVE ? '--' : (r.TOTALOPERATEREVE / 100000000.0).toFixed(3)}亿</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.MLR ? '--' : (r.MLR / 10000).toFixed(0)}万</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.PARENTNETPROFIT ? '--' : (r.PARENTNETPROFIT / 100000000).toFixed(3)}亿</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.KCFJCXSYJLR ? '--' : (r.KCFJCXSYJLR / 100000000).toFixed(3)}亿</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.TOTALOPERATEREVETZ ? '--' : r.TOTALOPERATEREVETZ.toFixed(2)}%</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.PARENTNETPROFITTZ ? '--' : r.PARENTNETPROFITTZ.toFixed(2)}%</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.KCFJCXSYJLRTZ ? '--' : r.KCFJCXSYJLRTZ.toFixed(2)}%</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.YYZSRGDHBZC ? '--' : r.YYZSRGDHBZC.toFixed(2)}%</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.NETPROFITRPHBZC ? '--' : r.NETPROFITRPHBZC.toFixed(2)}%</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.KFJLRGDHBZC ? '--' : r.KFJLRGDHBZC.toFixed(2)}%</span>
                  </div>
                </div>
                <div className={styles.wrapper}>
                  <div className={styles.row}>
                    <strong>&#8205; </strong>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.ROEJQ ? '--' : r.ROEJQ.toFixed(2)}%</span>
                  </div>
                  <div className={styles.row}>
                    <span>{r.ROEKCJQ ? r.ROEKCJQ.toFixed(2) : '--'}%</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.ZZCJLL ? '--' : r.ZZCJLL.toFixed(2)}%</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.ROIC ? '--' : r.ROIC.toFixed(2)}%</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.XSMLL ? '--' : r.XSMLL.toFixed(2)}%</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.XSJLL ? '--' : r.XSJLL.toFixed(2)}%</span>
                  </div>
                </div>
                <div className={styles.wrapper}>
                  <div className={styles.row}>
                    <strong>&#8205; </strong>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.XSJXLYYSR ? '--' : r.XSJXLYYSR.toFixed(2)}</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.JYXJLYYSR ? '--' : r.JYXJLYYSR.toFixed(2)}</span>
                  </div>
                </div>
                <div className={styles.wrapper}>
                  <div className={styles.row}>
                    <strong>&#8205; </strong>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.LD ? '--' : r.LD.toFixed(2)}</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.SD ? '--' : r.SD.toFixed(2)}</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.XJLLB ? '--' : r.XJLLB.toFixed(2)}</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.ZCFZL ? '--' : r.ZCFZL.toFixed(2)}</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.QYCS ? '--' : r.QYCS.toFixed(2)}</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.CQBL ? '--' : r.CQBL.toFixed(2)}</span>
                  </div>
                </div>
                <div className={styles.wrapper}>
                  <div className={styles.row}>
                    <strong>&#8205; </strong>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.ZZCZZTS ? '--' : r.ZZCZZTS.toFixed(2)}</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.CHZZTS ? '--' : r.CHZZTS.toFixed(2)}</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.YSZKZZTS ? '--' : r.YSZKZZTS.toFixed(2)}</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.ZZCJLL ? '--' : r.ZZCJLL.toFixed(2)}</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.CHZZL ? '--' : r.CHZZL.toFixed(2)}</span>
                  </div>
                  <div className={styles.row}>
                    <span>{!r.YSZKZZL ? '--' : r.YSZKZZL.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>
    </>
  );
});
export default KeyFinance;
