import { Stock } from '@/types/stock';
import { CloseCircleOutlined, PieChartOutlined, StarFilled, StarOutlined, VerticalAlignTopOutlined } from '@ant-design/icons';
import { Button, Col, Row } from 'antd';
import classnames from 'classnames';
import React, { useCallback, useEffect, useState } from 'react';
import styles from './index.scss';
import * as Helpers from '@/helpers';
import * as Utils from '@/utils';
import * as Services from '@/services';
import { KLineType, StockMarketType } from '@/utils/enums';
import moment from 'moment';
import { batch } from 'react-redux';
import QKlineBrief from './QKlineBrief';
import QNowTrendBrief from './QNowTrendBrief';
import QHistTrendBrief from './QHistTrendBrief';

export interface BKStockBriefProps {
  ktype: KLineType;
  secid: string;
  active: boolean;
  tick: string;
  tilDate: string;
  nexDate: string;
  selected: boolean;
  range: { start: number; end: number };
  hold: any; // 是否持有
  moveTop: (secid: string) => void;
  remove: (secid: string) => void;
  openStock: (secid: string, name: string, change?: number) => void;
  toggleSelected: (secid: string) => void;
  doBuy: (secid: string, price: number, day: string) => void;
  doSell: (secid: string, price: number, day: string) => void;
  analyzeBK: (secid: string) => void;
  onTick: (secid: string, zdf: number, main: number) => void;
}

const BKStockBrief: React.FC<BKStockBriefProps> = React.memo(
  ({
    ktype,
    secid,
    active,
    tick,
    tilDate,
    nexDate,
    selected,
    range,
    hold,
    moveTop,
    remove,
    openStock,
    toggleSelected,
    doBuy,
    doSell,
    analyzeBK,
    onTick,
  }) => {
    const [detail, setDetail] = useState(Helpers.Stock.QuantGetDetail(secid));
    const [zx, setZx] = useState(detail?.zx || 0);
    const [zdf, setZdf] = useState(detail?.zdf || 0);
    const [zs, setZs] = useState(0);
    const [zss, setZss] = useState(detail?.zss || 1);
    const [nflow, setNFlow] = useState<Stock.FlowTrendItem>();
    useEffect(() => {
      if (!detail) {
        Services.Stock.GetDetailFromEastmoney(secid).then((d) => {
          if (d) {
            batch(() => {
              setDetail(d);
              setZx(d.zx);
              setZdf(d.zdf);
              setZss(d.zss);
            });
          }
          return d;
        });
      }
    }, [secid]);

    const [nexKline, setNexKline] = useState<Stock.KLineItem>(null);
    const isBk = Helpers.Stock.GetStockType(secid) == StockMarketType.AB;
    const isToday = tilDate == moment(new Date()).format('YYYY-MM-DD');
    const onTilDateK = useCallback((k: Stock.KLineItem) => {
      batch(() => {
        setZx(k.sp);
        setZdf(k.zdf);
        setZs(k.sp);
      });
    }, []);
    const onBriefTick = useCallback(
      (s: string, nk: Stock.KLineItem, flows: Stock.FlowTrendItem | null) => {
        batch(() => {
          if (detail?.ltg) {
            nk.hsl = nk.cjl / detail.ltg;
          }
          setNexKline(nk);
          setNFlow(flows);
          setZx(nk.sp);
          setZdf(nk.zdf);
        });
        onTick(s, nk.zdf, flows?.mainDiff || 0);
      },
      [onTick]
    );
    return (
      <aside className={classnames(styles.content)}>
        <div className={styles.toolbar}>
          <div className={styles.name}>
            <a onClick={() => openStock(detail.secid, detail.name, detail.zdf)}>{detail?.name || ''}</a>
            &nbsp;
            <span className={Utils.GetValueColor(zdf).textClass}>{zx.toFixed(2)}</span>
            &nbsp;
            <span className={Utils.GetValueColor(zdf).textClass}>{Utils.Yang(zdf)}%</span>
            &nbsp;
            {detail?.lt && <span>{(detail.lt / 100000000).toFixed(2)}亿</span>}
            &nbsp;
            <span>主力：{nflow?.main.toFixed(2)}</span>
            &nbsp;
            {hold && <span className={Utils.GetValueColor(hold.price - zx).textClass}>成本: {hold.price.toFixed(2)}</span>}
            <Button type="link" onClick={() => doBuy(secid, zx, nexDate)}>
              买
            </Button>
            <Button type="link" onClick={() => doSell(secid, zx, nexDate)} danger>
              卖
            </Button>
          </div>
          <div>
            <Button type="text" icon={<PieChartOutlined />} onClick={() => analyzeBK(secid)} />
            <Button type="text" icon={selected ? <StarFilled /> : <StarOutlined />} onClick={() => toggleSelected(detail.secid)} />
            <Button type="text" icon={<VerticalAlignTopOutlined />} onClick={() => moveTop(detail.secid)} />
            <Button type="text" icon={<CloseCircleOutlined />} onClick={() => remove(detail.secid)} />
          </div>
        </div>
        <Row>
          <Col span={12}>
            <QKlineBrief secid={secid} tilDate={tilDate} nexDate={nexDate} nexKline={nexKline} range={range} onTilDate={onTilDateK} />
          </Col>
          <Col span={12}>
            {isToday ? (
              <QNowTrendBrief secid={secid} zs={zs} onTick={onBriefTick} />
            ) : (
              <QHistTrendBrief secid={secid} tick={tick} nexDate={nexDate} zs={zs} onTick={onBriefTick} />
            )}
          </Col>
        </Row>
      </aside>
    );
  }
);

export default BKStockBrief;
