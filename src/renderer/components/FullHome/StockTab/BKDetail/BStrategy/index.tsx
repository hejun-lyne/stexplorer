import React, { useState } from 'react';
import styles from './index.scss';
import { useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import 'moment/locale/zh-cn';
import * as Utils from '@/utils';
import { Button, Col, Form, Input, InputNumber, Row, Select, Timeline } from 'antd';
import {
  MRType,
  MRTypeHints,
  MRTypeNames,
  DayTrendType,
  DayTrendTypeNames,
  ZLType,
  ZLTypeHints,
  ZLTypeNames,
  InDayTrendType,
  InDayTrendTypeNames,
} from '@/utils/enums';
import moment from 'moment';
import { addKNoteAction, updateStockCharactorAction } from '@/actions/stock';

export interface BStrategyProps {
  secid: string;
  zx: number;
}

// 策略，
const BStrategy: React.FC<BStrategyProps> = React.memo(({ secid, zx }) => {
  const config = useSelector((store: StoreState) => store.stock.stockConfigsMapping[secid]);
  const knotes = config?.knotes;
  const character = config?.character;
  const dispatch = useDispatch();
  const [zltype, setZLType] = useState(ZLType.None);
  const [qstype, setQSType] = useState(DayTrendType.None);
  const [drtype, setDRType] = useState(InDayTrendType.None);
  const [zlcb, setZLCB] = useState(character?.zlcb || zx || 0.0);
  const [mrtype, setMRType] = useState(MRType.None);
  const [summary, setSummary] = useState('');
  const updateSCharacter = () => {
    dispatch(updateStockCharactorAction(secid, { zltype, zlcb, qstype }));
  };
  const addKNote = () => {
    const d = moment(new Date()).format('YYYY-MM-DD HH:mm:ss');
    const text = `【${InDayTrendTypeNames[drtype]}】, 主力成本【${zlcb}, ${(((zx - zlcb) / zx) * 100).toFixed(2)}%】, ${summary}`;
    const startDate = d;
    const endDate = startDate;
    dispatch(addKNoteAction(secid, startDate, endDate, 0, text, 0));
  };
  return (
    <div className={styles.container}>
      <div className={styles.form}>
        <div className={styles.leading}>
          <span>先定性</span>
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
        <Form.Item label="日线趋势">
          <Select defaultValue={DayTrendType.None} onChange={setQSType}>
            <Select.Option value={DayTrendType.None}>横盘震荡</Select.Option>
            <Select.Option value={DayTrendType.SZJQ}>上涨加速</Select.Option>
            <Select.Option value={DayTrendType.SZJR}>上涨减弱</Select.Option>
            <Select.Option value={DayTrendType.XDJQ}>下跌加速</Select.Option>
            <Select.Option value={DayTrendType.XDJR}>下跌减弱</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item label="主力成本">
          <InputNumber step="0.01" defaultValue={zx || 0.0} stringMode onChange={setZLCB} />
        </Form.Item>
        <div style={{ height: 2, marginBottom: 5, backgroundColor: 'var(--nav-background-color' }}></div>
        <div className={styles.leading}>
          <span>当日复盘</span>
          <Button type="link" size="small" style={{ marginRight: 5 }} onClick={() => addKNote()}>
            保存
          </Button>
        </div>
        <Form.Item label="日内走势(30分钟)">
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
            placeholder="大盘&板块走势，观察动能变化(角度、弧度、速度)～"
            style={{ width: '100%', height: 60 }}
            onChange={(e) => setSummary(e.target.value)}
          />
        </Form.Item>
      </div>
      <div className={styles.list}>
        {character && (
          <div className={styles.chara}>
            <span>当前趋势：{DayTrendTypeNames[character.qstype]}</span>
            &nbsp;
            <span>主力类型：{ZLTypeNames[character.zltype]}</span>
            &nbsp;
            <span className={Utils.GetValueColor(zx - character.zlcb).textClass}>
              主力成本：{character.zlcb}, {(((zx - character.zlcb) / zx) * 100).toFixed(2)}%
            </span>
          </div>
        )}
        <Timeline mode="left">
          {knotes &&
            knotes.map((n) => (
              <Timeline.Item key={n.id} label={n.startDate.substring(0, 10)}>
                {n.text}
              </Timeline.Item>
            ))}
        </Timeline>
      </div>
    </div>
  );
});
export default BStrategy;
