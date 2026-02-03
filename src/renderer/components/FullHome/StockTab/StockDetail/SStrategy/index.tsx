import React, { useEffect, useState } from 'react';
import styles from './index.scss';
import { useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import 'moment/locale/zh-cn';
import locale from 'antd/es/date-picker/locale/zh_CN';
import { Button, Col, DatePicker, Form, Input, InputNumber, List, Row, Select, Tabs, Timeline } from 'antd';
import {
  ChanTrendState,
  ChanType,
  CStateStrings,
  KLineType,
  KNoteType,
  KNoteTypeNames,
  KStateStrings,
  MAType,
  MRType,
  PriceMAState,
  DayTrendType,
  DayTrendTypeNames,
  StrategyType,
  ZLType,
  ZLTypeHints,
  ZLTypeNames,
  InDayTrendTypeNames,
  InDayTrendType,
  MRTypeNames,
  MRTypeHints,
} from '@/utils/enums';
import classnames from 'classnames';
import { Stock } from '@/types/stock';
import { useCallback } from 'react';
import * as Helpers from '@/helpers';
import * as Utils from '@/utils';
import moment from 'moment';
import { addKNoteAction, appendTrade, updateStockCharactorAction } from '@/actions/stock';
import { BoxPlotOutlined } from '@ant-design/icons';

export interface SStrategyProps {
  stype: StrategyType;
  trainMode?: boolean;
  toDate?: string;
  detail: Stock.DetailItem;
  onTimelineClicked: (date: string) => void;
}

// 策略，
const SStrategy: React.FC<SStrategyProps> = React.memo(({ stype, trainMode, toDate, detail, onTimelineClicked }) => {
  const config = useSelector((store: StoreState) => store.stock.stockConfigsMapping[detail.secid]);
  const holding = useSelector((store: StoreState) => store.stock.nowHolds.find((h) => h.secid == detail.secid));
  const knotes = config?.knotes;
  const character = config?.character;
  const [bDate, setBDate] = useState<string | null>(null);
  const [jlInfo, setJLInfo] = useState<Stock.JLStrategyItem | undefined>();
  const [chans, setChans] = useState<any>(null);
  const [cstate, setCState] = useState<ChanTrendState>(ChanTrendState.Unknow);
  const [trendFilter, setTrendFilter] = useState<number>(0);
  const [matype, setMAType] = useState(MAType.MA20);
  const [qsinfo, setQSInfo] = useState<Stock.QSStrategyItem | undefined>();
  const computInfos = useCallback(
    (t: StrategyType, ks: Stock.KLineItem[]) => {
      if (stype === StrategyType.QSJL && bDate && ks) {
        const info = Helpers.Stock.ComputJLInfo(ks, bDate);
        setJLInfo(info);
      }
    },
    [bDate]
  );
  const computChans = useCallback((ks: Stock.KLineItem[]) => {
    const chans = Helpers.Stock.ComputeChans(ks);
    let s = 0;
    if (chans.chansData.length > 2) {
      const beforeLastChan = chans.chansData[chans.chansData.length - 2]; //(today === chansData[chansData.length - 1].date ? 3 : 2)];
      if (beforeLastChan.type === ChanType.Top) {
        s = ChanTrendState.TopDown;
      } else if (beforeLastChan.type === ChanType.Bottom) {
        s = ChanTrendState.BottomUp;
      } else {
        s = chans.chansData[chans.chansData.length - 1].type === ChanType.StepDown ? ChanTrendState.TrendDown : ChanTrendState.TrendUp;
      }
    }
    setCState(s);
    setChans(chans);
  }, []);
  const computeQSInfo = useCallback(
    (ks: Stock.KLineItem[]) => {
      if (ks) {
        const info = Helpers.Stock.ComputLQSInfo(ks, matype);
        setQSInfo(info);
      }
    },
    [matype]
  );
  const [tradeForm] = Form.useForm();
  const [knoteForm] = Form.useForm();
  const dispatch = useDispatch();
  const zx = detail.zx;
  const [zltype, setZLType] = useState(ZLType.SJG);
  const [qstype, setQSType] = useState(DayTrendType.None);
  const [drtype, setDRType] = useState(InDayTrendType.None);
  const [zlcb, setZLCB] = useState(detail.zx || 0.0);
  const [mrtype, setMRType] = useState(MRType.None);
  const [summary, setSummary] = useState('');
  const [jyprice, setJYPrice] = useState(detail.zx);
  const [jyCount, setJYCount] = useState(0);
  const updateSCharacter = () => {
    dispatch(updateStockCharactorAction(detail.secid, { zltype, zlcb, qstype }));
  };
  const addKNote = () => {
    const d = trainMode && toDate ? toDate : moment(new Date()).format('YYYY-MM-DD HH:mm:ss');
    const text = `【${InDayTrendTypeNames[drtype]}】 ${summary}`;
    const startDate = d;
    const endDate = startDate;
    dispatch(addKNoteAction(detail.secid, startDate, endDate, 0, text, 0));
  };
  const addTrade = (type: string) => {
    const h = {
      id: 0,
      type,
      secid: detail.secid,
      name: detail.name,
      price: parseFloat('' + jyprice),
      count: parseInt('' + jyCount),
      time: moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
      stoplossAt: 0,
      latestNewsAs: 'positive',
      explain: '',
      profits: [0, 0, 0, 0, 0], // 获利情况
      strategy: mrtype,
    } as Stock.DoTradeItem;
    dispatch(appendTrade(h));
  };
  return (
    <div className={styles.container}>
      <div className={styles.twoWrapper}>
        <div className={styles.form}>
          <div className={styles.leading}>
            <span>先定性(找龙头)</span>
            <Button type="link" size="small" style={{ marginRight: 5 }} onClick={() => updateSCharacter()}>
              更新
            </Button>
          </div>
          <Form.Item label="主力模式">
            <Select defaultValue={ZLType.MJG} onChange={setZLType}>
              <Select.Option value={ZLType.MJG}>{ZLTypeNames[ZLType.MJG]}</Select.Option>
              <Select.Option value={ZLType.SJG}>{ZLTypeNames[ZLType.SJG]}</Select.Option>
              <Select.Option value={ZLType.YZ}>{ZLTypeNames[ZLType.YZ]}</Select.Option>
              <Select.Option value={ZLType.ZJ}>{ZLTypeNames[ZLType.ZJ]}</Select.Option>
              <Select.Option value={ZLType.None}>{ZLTypeNames[ZLType.None]}</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="顺大势">
            <Select defaultValue={DayTrendType.None} onChange={setQSType}>
              <Select.Option value={DayTrendType.None}>{DayTrendTypeNames[DayTrendType.None]}</Select.Option>
              <Select.Option value={DayTrendType.SZJQ}>{DayTrendTypeNames[DayTrendType.SZJQ]}</Select.Option>
              <Select.Option value={DayTrendType.SZJR}>{DayTrendTypeNames[DayTrendType.SZJR]}</Select.Option>
              <Select.Option value={DayTrendType.XDJQ}>{DayTrendTypeNames[DayTrendType.XDJQ]}</Select.Option>
              <Select.Option value={DayTrendType.XDJR}>{DayTrendTypeNames[DayTrendType.XDJR]}</Select.Option>
              <Select.Option value={DayTrendType.ZDJA}>{DayTrendTypeNames[DayTrendType.ZDJA]}</Select.Option>
              <Select.Option value={DayTrendType.ZDJR}>{DayTrendTypeNames[DayTrendType.ZDJR]}</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="主力成本">
            <InputNumber step="0.01" defaultValue={zx || 0.0} stringMode onChange={setZLCB} />
          </Form.Item>
          <div style={{ height: 2, marginBottom: 5, backgroundColor: 'var(--nav-background-color' }}></div>
          <div className={styles.leading}>
            <span>再复盘</span>
            <Button type="link" size="small" style={{ marginRight: 5 }} onClick={() => addKNote()}>
              保存
            </Button>
          </div>
          <Form.Item label="逆小势(60分钟)">
            <Select defaultValue={InDayTrendType.None} onChange={setDRType}>
              <Select.Option value={InDayTrendType.None}>{InDayTrendTypeNames[InDayTrendType.None]}</Select.Option>
              <Select.Option value={InDayTrendType.DBXT}>{InDayTrendTypeNames[InDayTrendType.DBXT]}</Select.Option>
              <Select.Option value={InDayTrendType.SSXT}>{InDayTrendTypeNames[InDayTrendType.SSXT]}</Select.Option>
              <Select.Option value={InDayTrendType.SSZJ}>{InDayTrendTypeNames[InDayTrendType.SSZJ]}</Select.Option>
              <Select.Option value={InDayTrendType.DiBXT}>{InDayTrendTypeNames[InDayTrendType.DiBXT]}</Select.Option>
              <Select.Option value={InDayTrendType.XDXT}>{InDayTrendTypeNames[InDayTrendType.XDXT]}</Select.Option>
              <Select.Option value={InDayTrendType.XDZJ}>{InDayTrendTypeNames[InDayTrendType.XDZJ]}</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="">
            <Input.TextArea
              placeholder="大盘&板块走势，消息面，观察动能变化(角度、弧度、速度)（同级别比较！）～"
              style={{ width: '100%', height: 60 }}
              onChange={(e) => setSummary(e.target.value)}
            />
          </Form.Item>
          <div style={{ height: 2, marginBottom: 5, backgroundColor: 'var(--nav-background-color' }}></div>
          <div className={styles.leading}>
            <span>后买卖(恐惧、贪婪、冲动)</span>
          </div>
          <Input.Group compact>
            <Form.Item label="">
              <InputNumber step="0.01" defaultValue={zx || 0.0} stringMode onChange={setJYPrice} />
            </Form.Item>
            <Form.Item label="">
              <InputNumber step="100" defaultValue={0} stringMode onChange={setJYCount} />
            </Form.Item>
            <Form.Item label="">
              <Select defaultValue={MRType.None} onChange={setMRType}>
                <Select.Option value={MRType.None}>{MRTypeNames[MRType.None]}</Select.Option>
                <Select.Option value={MRType.JDXH}>{MRTypeNames[MRType.JDXH]}</Select.Option>
                <Select.Option value={MRType.SYJC}>{MRTypeNames[MRType.SYJC]}</Select.Option>
                <Select.Option value={MRType.LFCX}>{MRTypeNames[MRType.LFCX]}</Select.Option>
                <Select.Option value={MRType.DGWY}>{MRTypeNames[MRType.DGWY]}</Select.Option>
              </Select>
            </Form.Item>
          </Input.Group>

          <div className={styles.hint}>{MRTypeHints[mrtype]}</div>
          <Input.Group compact>
            <Form.Item>
              <Button type="primary" htmlType="submit" style={{ marginRight: 5 }} onClick={() => addTrade('buy')}>
                Buy
              </Button>
            </Form.Item>
            <Form.Item>
              <Button type="danger" htmlType="submit" style={{ marginRight: 5 }} onClick={() => addTrade('sell')}>
                Sell
              </Button>
            </Form.Item>
          </Input.Group>
        </div>
        <div className={styles.list}>
          <div className={styles.chara}>
            {character && (
              <>
                <span>当前趋势：{DayTrendTypeNames[character.qstype]}</span>
                &nbsp;
                <span>主力类型：{ZLTypeNames[character.zltype]}</span>
                &nbsp;
                <span className={Utils.GetValueColor(detail.zx - character.zlcb).textClass}>
                  主力成本：{character.zlcb}, {(((detail.zx - character.zlcb) / detail.zx) * 100).toFixed(2)}%
                </span>
                <br />
              </>
            )}
            {holding && (
              <>
                <span>持有数量：{holding.count}</span>
                &nbsp;
                <span>持有市值：{(holding.count * holding.price).toFixed(2)}</span>
                &nbsp;
                <span className={Utils.GetValueColor(detail.zx - holding.price).textClass}>
                  持有成本：{holding.price}, {(((detail.zx - holding.price) / holding.price) * 100).toFixed(2)}%
                </span>
                &nbsp;
                <span>买入逻辑：{MRTypeNames[holding.lastBuyStrategy]}</span>
              </>
            )}
          </div>
          <Timeline mode="left">
            {knotes &&
              knotes.map((n) => (
                <Timeline.Item key={n.id} label={n.startDate}>
                  <span onClick={() => onTimelineClicked(n.startDate)} style={{ cursor: 'pointer' }}>{n.text}</span>
                </Timeline.Item>
              ))}
          </Timeline>
        </div>
      </div>
    </div>
  );
});
export default SStrategy;
