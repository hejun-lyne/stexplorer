import React from 'react';
import { Row, Col, DatePicker, Select, Button, Tag } from 'antd';
import styles from '../index.scss';
import * as Services from '@/services';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
import { useState } from 'react';
import { Stock } from '@/types/stock';
import { useRequest, useThrottleFn } from 'ahooks';
import { useCallback } from 'react';
import { useWorkDayTimeToDo } from '@/utils/hooks';
import moment from 'moment';
import classNames from 'classnames';
import { SlidersOutlined, UnorderedListOutlined } from '@ant-design/icons';
import STMonitor from '../STMonitor';
import { batch } from 'react-redux';
import CheckableTag from 'antd/lib/tag/CheckableTag';

export interface ZTListProps {
  industries: Stock.BanKuaiItem[];
  onOpenStock: (secid: string, name: string) => void;
  active: boolean;
}

const ZTList: React.FC<ZTListProps> = ({ industries, onOpenStock, active }) => {
  const [date, setDate] = useState(moment(new Date()).format('YYYYMMDD'));
  const [dates, setDates] = useState([moment(new Date()).format('YYYYMMDD')]);
  const [pageSize, setPageSize] = useState(100);
  const [noMore, setNoMore] = useState(false);
  const [stocks, setStocks] = useState<Stock.ZTItem[]>([]);
  const [hybks, setHybks] = useState<Record<string, number>>({});
  const [sBks, setSBks] = useState<string[]>([]);
  const [filterIndustry, setFilterIndustry] = useState<string>('');
  const { run: runGetStocks } = useRequest(Services.Stock.GeZTStocks, {
    throwOnError: true,
    manual: true,
    onSuccess: (data) => {
      if (data.arr) {
        const nm = data.to == data.arr.length;
        const idx = dates.indexOf(date);
        if (nm) {
          if (idx == dates.length - 1) {
            // 已经是最后了
            setNoMore(nm);
          } else {
            // 继续下一个
            setDate(dates[idx + 1]);
          }
        }

        // 合并数据
        let sts = data.arr;
        if (idx != 0) {
          sts = ([] as Stock.ZTItem[]).concat(stocks);
          const secids = sts.map((s) => s.secid);
          data.arr.forEach((s) => {
            const idx = secids.indexOf(s.secid);
            if (idx != -1) {
              // 替换
              sts.splice(idx, 1, s);
            } else {
              sts.push(s);
            }
          });
        }
        const bks = {} as Record<string, number>;
        sts.forEach((s) => {
          if (bks[s.hybk]) {
            bks[s.hybk] = bks[s.hybk] + 1;
          } else {
            bks[s.hybk] = 1;
          }
        });
        const nsBks = sBks.filter((s) => Object.keys(bks).indexOf(s) != -1);
        batch(() => {
          setHybks({ ...bks });
          setSBks(nsBks);
          setStocks(sts);
        });
      }
    },
  });
  const { run: mayGetStocks } = useThrottleFn(
    (ps: number, da: string) => {
      runGetStocks(ps, da);
    },
    {
      wait: 2000,
    }
  );
  const loadMore = useCallback(() => {
    const ps = pageSize + 20;
    setPageSize(ps);
    mayGetStocks(ps, date);
  }, [pageSize, date]);

  const onChangeDate = useCallback(
    (d: moment.Moment | null, isStart = true) => {
      if (!d) {
        return;
      }
      const nd = d.format('YYYYMMDD');
      if (dates.length) {
        if (isStart) {
          const ed = dates[dates.length - 1];
          if (nd > ed) {
            setDates([nd]);
            return;
          }
          const newDates = [nd];
          const edm = moment(ed, 'YYYYMMDD');
          let i = 1;
          while (true) {
            const next = d.add(i++, 'days');
            if (next.isBefore(edm)) {
              newDates.push(next.format('YYYYMMDD'));
            } else {
              break;
            }
          }
          setDates(newDates);
        } else {
          const sd = dates[0];
          if (nd < sd) {
            setDates([nd]);
            return;
          }
          const newDates = [sd];
          const sdm = moment(sd, 'YYYYMMDD');
          let i = 1;
          while (true) {
            const next = sdm.add(i++, 'days');
            if (next.isBefore(d)) {
              newDates.push(next.format('YYYYMMDD'));
            } else {
              break;
            }
          }
          newDates.push(nd);
          setDates(newDates);
        }
      } else {
        setDates([nd]);
      }
    },
    [dates]
  );

  const startQuery = useCallback(() => {
    if (dates.length) {
      batch(() => {
        setNoMore(false);
        setDate(dates[0]);
        setPageSize(60);
        mayGetStocks(60, dates[0]);
      });
    }
  }, [dates]);

  const [kview, setKView] = useState(false);

  const toggleBK = useCallback(
    (c, b) => {
      const idx = sBks.indexOf(b);
      if (idx != -1) {
        sBks.splice(idx, 1);
      } else {
        sBks.push(b);
      }
      setSBks([...sBks]);
    },
    [sBks]
  );

  const prevDate = useCallback(() => {
    setDates([moment(dates[0], 'YYYYMMDD').add(-1, 'd').format('YYYYMMDD')]);
  }, [dates]);
  const nextDate = useCallback(() => {
    setDates([moment(dates[0], 'YYYYMMDD').add(1, 'd').format('YYYYMMDD')]);
  }, [dates]);
  return (
    <>
      <div className={styles.header}>
        <Select value={filterIndustry} onSelect={setFilterIndustry} style={{ width: 120 }}>
          <Select.Option value="">所有板块</Select.Option>
          {industries.map((i) => (
            <Select.Option value={i.name} key={i.code}>
              {i.name}
            </Select.Option>
          ))}
        </Select>
        &nbsp;
        <DatePicker onChange={onChangeDate} value={moment(dates[0], 'YYYYMMDD')} style={{ marginRight: 10 }} />
        <DatePicker
          onChange={(d) => onChangeDate(d, false)}
          value={moment(dates[dates.length - 1], 'YYYYMMDD')}
          style={{ marginRight: 10 }}
        />
        <Button type="primary" onClick={prevDate}>
          前一天
        </Button>
        &nbsp;
        <Button type="primary" onClick={nextDate}>
          后一天
        </Button>
        &nbsp;
        <Button
          icon={kview ? <UnorderedListOutlined /> : <SlidersOutlined />}
          type="text"
          onClick={() => setKView(!kview)}
          className={styles.toggleK}
        />
        <Button type="primary" onClick={startQuery}>
          查询
        </Button>
      </div>
      {Object.keys(hybks).length > 1 && (
        <div className={styles.tagbar}>
          {Object.keys(hybks)
            .sort((a, b) => hybks[b] - hybks[a])
            .map((b) => (
              <CheckableTag
                className="edit-tag"
                key={b}
                checked={sBks.indexOf(b) > -1}
                onChange={(c) => toggleBK(c, b)}
                style={{ marginTop: 5 }}
              >
                <span>
                  {b}({hybks[b]})
                </span>
              </CheckableTag>
            ))}
        </div>
      )}
      {kview ? (
        <STMonitor
          details={stocks.filter((s) => (sBks.length == 0 ? true : sBks.indexOf(s.hybk) != -1)) as Stock.DetailItem[]}
          active={active}
          noMore={noMore}
          onLoadMore={loadMore}
          onOpenStock={onOpenStock}
        />
      ) : (
        <>
          <Row className={styles.header}>
            <Col span={2}>名字</Col>
            <Col span={2}>板块</Col>
            <Col span={2}>最新价</Col>
            <Col span={2}>涨跌幅</Col>
            <Col span={2}>换手率</Col>
            <Col span={2}>首封时间</Col>
            <Col span={2}>最后封板</Col>
            <Col span={2}>流通市值</Col>
            <Col span={2}>封板资金</Col>
            <Col span={2}>资金比例</Col>
            <Col span={1}>炸板</Col>
            <Col span={1}>连板</Col>
            <Col span={2}>连板统计</Col>
          </Row>
          <div className={classNames(styles.table, styles.ztmoreheader)}>
            {stocks
              .filter((s) => (filterIndustry == '' ? true : filterIndustry.indexOf(s.hybk) != -1))
              .filter((s) => (sBks.length == 0 ? true : sBks.indexOf(s.hybk) != -1))
              .map((s) => (
                <Row key={s.code} className={styles.row}>
                  <Col span={2} style={{ cursor: 'pointer' }} onClick={() => onOpenStock(s.secid, s.name)}>
                    {s.name}
                  </Col>
                  <Col span={2}>{s.hybk}</Col>
                  <Col span={2} className={Utils.GetValueColor(s.zdf).textClass}>
                    {(s.zx / 1000).toFixed(2)}
                  </Col>
                  <Col span={2} className={Utils.GetValueColor(s.zdf).textClass}>
                    {s.zdf.toFixed(2) + '%'}
                  </Col>
                  <Col span={2}>{(s.hsl / 100).toFixed(2) + '%'}</Col>
                  <Col span={2}>{s.fbt}</Col>
                  <Col span={2} className={Utils.GetValueColor(12 - parseInt(s.lbt.substring(0, 2))).textClass}>
                    {s.lbt}
                  </Col>
                  <Col span={2}>{(s.ltsz / 100000000).toFixed(2) + '亿'}</Col>
                  <Col span={2}>
                    {s.fbf > 100000000
                      ? (s.fbf / 100000000).toFixed(2) + '亿'
                      : s.fbf > 10000000
                        ? (s.fbf / 10000000).toFixed(2) + '千万'
                        : (s.fbf / 10000).toFixed(2) + '万'}
                  </Col>
                  <Col span={2}>{((s.fbf / s.ltsz) * 100).toFixed(2) + '%'}</Col>
                  <Col span={1}>{s.zbc}</Col>
                  <Col span={1}>{s.lbc}</Col>
                  <Col span={2}>{s.zttj.days + '天' + s.zttj.ct + '板'}</Col>
                </Row>
              ))}
            {!noMore && (
              <div className={styles.loadmore} onClick={loadMore}>
                <span>加载更多</span>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
};

export default ZTList;
