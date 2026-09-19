import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './index.scss';
import { Button, Input, Modal, Select, Tag, message } from 'antd';
import { ColumnWidthOutlined, HeartFilled, HeartOutlined, PlusOutlined } from '@ant-design/icons';
import { batch, useDispatch, useSelector } from 'react-redux';
import moment from 'moment';
import { StoreState } from '@/reducers/types';
import * as Helpers from '@/helpers';
import {
  addStockMarkLineAction,
  addStockTagAction,
  addStockTradePointAction,
  clearKNoteAction,
  clearStockTradePointAction,
  deleteStockMarkLineAction,
  deleteStockTagAction,
  syncStockMarktypeAction,
} from '@/actions/stock';
import { addTrainArchiveAction, setTrainCurrentDateAction, stopTrainAction } from '@/actions/train';
import { Stock } from '@/types/stock';
import { MarkType } from '@/utils/enums';
import * as Utils from '@/utils';
import TrainSettlement from '../TrainSettlement';

/** 训练模式买卖点的类型标记，用于和手动标记点区分 */
export const TRAIN_TYPE = 'train';
/** 工具栏高度：开启训练模式（两行）/ 关闭训练模式（仅标签行），详情区据此撑满剩余高度 */
export const TRAIN_BAR_HEIGHT = 60;
export const TRAIN_BAR_HEIGHT_BASE = 34;

const DEFAULT_CAPITAL = 100000;
const DEFAULT_COMMISSION = 0.0003;
const MIN_LOT = 100;

const isTrainMark = (t: any) => t === TRAIN_TYPE || t === true;

function formatNumber(v: number) {
  return Math.abs(Math.round(v)).toLocaleString('zh-CN');
}
function formatSigned(v: number) {
  return `${v >= 0 ? '+' : '-'}${formatNumber(v)}`;
}

export interface TrainBarProps {
  secid: string;
  all30Mints: Stock.KLineItem[];
  addStock: () => void;
  removeStock: () => void;
  /** 是否显示模拟持仓、成本、盈亏与买卖操作（个股训练） */
  showTrade?: boolean;
}

const TrainBar: React.FC<TrainBarProps> = React.memo(({ secid, all30Mints, addStock, removeStock, showTrade = false }) => {
  const dispatch = useDispatch();
  const config = useSelector((state: StoreState) => state.stock.stockConfigsMapping[secid]);
  const stock = useSelector((state: StoreState) => state.stock.stocksMapping[secid]);
  const { ontrain, trainDate, trainStartDate, trainEndDate, initialCapital, commissionRate } = useSelector(
    (state: StoreState) => state.setting.systemSetting
  );
  const [marktype, setMarktype] = useState(config?.marktype || 0);
  /** 训练窗口内的交易日（跳过非交易日） */
  const [days, setDays] = useState<string[]>([]);
  /** 结算结果（弹窗展示） */
  const [settlement, setSettlement] = useState<Train.ArchiveRecord | null>(null);
  const [settling, setSettling] = useState(false);

  const startDate = trainStartDate || '';
  const endDate = trainEndDate || '';
  const currentDay = trainDate || '';
  const capital = initialCapital > 0 ? initialCapital : DEFAULT_CAPITAL;
  const commission = commissionRate >= 0 ? commissionRate : DEFAULT_COMMISSION;

  // 载入训练窗口内的交易日，用于按天推进（自动跳过非交易日）
  useEffect(() => {
    let mounted = true;
    if (!ontrain || !startDate || !endDate) {
      setDays([]);
      return () => {
        mounted = false;
      };
    }
    Helpers.Stock.GetTrainTradingDays(secid, startDate, endDate).then((ds) => {
      if (mounted) {
        setDays(ds);
      }
    });
    return () => {
      mounted = false;
    };
  }, [ontrain, secid, startDate, endDate]);

  // 校正训练日期：保证当前日期落在交易日上
  useEffect(() => {
    if (!ontrain || !days.length) {
      return;
    }
    if (currentDay && days.includes(currentDay)) {
      return;
    }
    const first = days.find((d) => d >= currentDay) || days[days.length - 1];
    dispatch(setTrainCurrentDateAction(first));
  }, [ontrain, days, currentDay]);

  const currentIdx = days.indexOf(currentDay);
  const nextDay = currentIdx >= 0 && currentIdx < days.length - 1 ? days[currentIdx + 1] : '';
  // 推进到窗口内最后一个交易日即视为训练结束
  const finished = days.length > 0 && currentIdx >= days.length - 1;

  // 当前训练日期对应的最新行情（数据层已按当前训练日期过滤，不会出现未来数据）
  const currentKline = useMemo(() => {
    const bars = all30Mints.filter((k) => !currentDay || k.date.substring(0, 10) <= currentDay);
    return bars.length ? bars[bars.length - 1] : undefined;
  }, [all30Mints, currentDay]);

  // 训练窗口内的买卖记录（按时间正序，日期统一按天比较）
  const trainTrades = useMemo(() => {
    const buys = (config?.buyPoints || [])
      .filter((t) => isTrainMark(t.t))
      .map((t) => ({ date: String(t.x).substring(0, 10), price: t.y, isBuy: true }));
    const sells = (config?.sellPoints || [])
      .filter((t) => isTrainMark(t.t))
      .map((t) => ({ date: String(t.x).substring(0, 10), price: t.y, isBuy: false }));
    return buys
      .concat(sells)
      .filter((t) => (!startDate || t.date >= startDate) && (!currentDay || t.date <= currentDay))
      .sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
  }, [config, startDate, currentDay]);

  // 模拟账户：以初始资金起算，按整百股买入/加仓，卖出一次性清仓，买卖均按比例收佣金
  const account = useMemo(() => {
    let cash = capital;
    let shares = 0;
    let costAmount = 0;
    let realized = 0;
    trainTrades.forEach((t) => {
      const price = Number(t.price);
      if (!price) {
        return;
      }
      if (t.isBuy) {
        const lots = Math.floor(cash / (price * MIN_LOT * (1 + commission)));
        if (lots < 1) {
          return;
        }
        const count = lots * MIN_LOT;
        const amount = price * count;
        const fee = amount * commission;
        cash -= amount + fee;
        shares += count;
        costAmount += amount + fee;
      } else if (shares > 0) {
        const amount = price * shares;
        const fee = amount * commission;
        cash += amount - fee;
        realized += amount - fee - costAmount;
        shares = 0;
        costAmount = 0;
      }
    });
    const costPrice = shares > 0 ? costAmount / shares : 0;
    const lastPrice = Number(currentKline?.sp) || 0;
    const profit = shares > 0 ? (lastPrice - costPrice) * shares : 0;
    const profitRatio = costPrice > 0 ? ((lastPrice - costPrice) / costPrice) * 100 : 0;
    return { cash, shares, costPrice, lastPrice, profit, profitRatio, realized };
  }, [trainTrades, capital, commission, currentKline]);

  const nextDayAction = useCallback(() => {
    if (!nextDay) {
      return;
    }
    // 按交易日推进（days 已跳过非交易日）
    dispatch(setTrainCurrentDateAction(nextDay));
    if (days[days.length - 1] === nextDay) {
      message.info('已推进到训练结束日期，请进行结算归档');
    }
  }, [nextDay, days]);

  const trade = useCallback(
    (isBuy: boolean) => {
      if (!currentKline) {
        message.warning('当前训练日期的行情数据还在加载中');
        return;
      }
      dispatch(addStockTradePointAction(secid, currentKline.date, currentKline.sp, isBuy, TRAIN_TYPE));
    },
    [currentKline, secid]
  );

  const clearBS = useCallback(() => {
    batch(() => {
      dispatch(clearStockTradePointAction(secid, true, TRAIN_TYPE));
      dispatch(clearKNoteAction(secid, true));
    });
  }, [secid]);

  // 结算并归档
  const settle = useCallback(async () => {
    if (!currentDay || !days.length) {
      return;
    }
    setSettling(true);
    try {
      // 日收盘价同样取自数据层（已按当前训练日期过滤，不含未来数据）
      const dayCloses = await Helpers.Stock.GetTrainDayCloses(secid);
      const result = Helpers.TrainSettle.SettleTrain({
        startDate: startDate || days[0],
        endDate: currentDay,
        initialCapital: capital,
        commissionRate: commission,
        days,
        dayCloses,
        trades: trainTrades,
      });
      const record: Train.ArchiveRecord = {
        ...result,
        id: `${secid}_${moment().format('YYYYMMDDHHmmss')}`,
        secid,
        name: stock?.detail?.name || secid,
        createdAt: moment().format('YYYY-MM-DD HH:mm:ss'),
      };
      dispatch(addTrainArchiveAction(record));
      // 归档后清理本次训练的买卖标记，避免影响下一次训练
      dispatch(clearStockTradePointAction(secid, true, TRAIN_TYPE));
      setSettlement(record);
      dispatch(stopTrainAction());
      message.success('训练已结束，结算结果已归档到左侧“训练归档”');
    } catch (error) {
      console.log('训练结算失败', error);
      message.error('训练结算失败');
    } finally {
      setSettling(false);
    }
  }, [currentDay, days, secid, startDate, capital, commission, trainTrades, stock]);

  const removeTag = useCallback((t) => {
    dispatch(deleteStockTagAction(t, secid));
  }, []);
  const [tagInputVisible, setTagInputVisible] = useState(false);
  const [tagInputValue, setTagInputValue] = useState('');
  const addTag = useCallback(() => {
    if (tagInputValue.length > 0) {
      dispatch(addStockTagAction(tagInputValue, secid));
    }
    setTagInputValue('');
    setTagInputVisible(false);
  }, [tagInputValue]);

  const removeMarkLine = useCallback((t) => {
    dispatch(deleteStockMarkLineAction(t, secid));
  }, []);
  const [markInputVisible, setMarkInputVisible] = useState(false);
  const [markInputValue, setMarkInputValue] = useState('');
  const addMarkLine = useCallback(() => {
    if (markInputValue.length > 0) {
      dispatch(addStockMarkLineAction(Number(markInputValue), secid));
    }
    setMarkInputValue('');
    setMarkInputVisible(false);
  }, [markInputValue]);
  const onMarktypeChange = useCallback((t) => {
    setMarktype(t);
    dispatch(syncStockMarktypeAction(secid, t));
  }, []);

  const canBuy = !!config && !!currentKline && Math.floor(account.cash / ((currentKline.sp || 0) * MIN_LOT * (1 + commission))) >= 1;
  const canSell = !!config && account.shares > 0;
  const profitClass = Utils.GetValueColor(account.profit).textClass;
  const realizedClass = Utils.GetValueColor(account.realized).textClass;

  return (
    <div className={styles.container}>
      {ontrain && (
        <div className={styles.row}>
          <div className={styles.item}>
            <Tag color="volcano">训练模式</Tag>
          </div>
          <div className={styles.item}>
            <span className={styles.label}>训练日期</span>
            <span className={`${styles.value} ${styles.strong}`}>{currentDay || '加载中...'}</span>
            {days.length > 0 && (
              <span className={styles.sub}>
                ({currentIdx + 1}/{days.length})
              </span>
            )}
          </div>
          <div className={styles.item}>
            {finished ? (
              <>
                <Tag color="gold">训练结束</Tag>
                <Button type="primary" size="small" loading={settling} onClick={settle}>
                  结算并归档
                </Button>
              </>
            ) : (
              <>
                <Button type="primary" size="small" disabled={!nextDay} onClick={nextDayAction}>
                  下一天
                </Button>
                &nbsp;
                <Button size="small" disabled={settling || !currentDay} loading={settling} onClick={settle}>
                  结算归档
                </Button>
              </>
            )}
          </div>
          {showTrade && (
            <>
              <div className={styles.item}>
                <span className={styles.label}>持仓</span>
                <span className={styles.strong}>{account.shares > 0 ? `${account.shares} 股` : '空仓'}</span>
              </div>
              <div className={styles.item}>
                <span className={styles.label}>成本</span>
                <span className={styles.strong}>{account.shares > 0 ? account.costPrice.toFixed(2) : '--'}</span>
              </div>
              {account.shares > 0 && (
                <div className={styles.item}>
                  <span className={styles.label}>现价</span>
                  <span className={styles.strong}>{account.lastPrice.toFixed(2)}</span>
                </div>
              )}
              <div className={styles.item}>
                <span className={styles.label}>浮动盈亏</span>
                <span className={account.shares > 0 ? profitClass : undefined}>
                  {account.shares > 0
                    ? `${formatSigned(account.profit)} (${account.profitRatio >= 0 ? '+' : ''}${account.profitRatio.toFixed(2)}%)`
                    : '--'}
                </span>
              </div>
              <div className={styles.item}>
                <span className={styles.label}>已结盈亏</span>
                <span className={trainTrades.length > 0 ? realizedClass : undefined}>
                  {trainTrades.length > 0 ? formatSigned(account.realized) : '--'}
                </span>
              </div>
              <div className={styles.item}>
                <span className={styles.label}>可用</span>
                <span className={styles.strong}>{formatNumber(account.cash)}</span>
              </div>
              <div className={styles.item}>
                <Button type="primary" size="small" disabled={!canBuy || finished} onClick={() => trade(true)}>
                  买入
                </Button>
                &nbsp;
                <Button type="primary" size="small" danger disabled={!canSell || finished} onClick={() => trade(false)}>
                  卖出
                </Button>
                &nbsp;
                <Button size="small" danger disabled={!trainTrades.length} onClick={clearBS}>
                  清空
                </Button>
              </div>
              {!config && <span className={styles.hint}>先收藏该标的后才可以进行模拟买卖</span>}
            </>
          )}
        </div>
      )}
      <div className={styles.row}>
        <div className={styles.item}>
          {config ? (
            <Button className={styles.btn} type="text" icon={<HeartFilled />} onClick={removeStock} size="small">
              已收藏
            </Button>
          ) : (
            <Button className={styles.btn} type="text" icon={<HeartOutlined />} onClick={addStock} size="small">
              未收藏
            </Button>
          )}
          &nbsp;
          <Select value={marktype} onChange={onMarktypeChange} size="small" style={{ width: 80 }}>
            <Select.Option value={MarkType.Default}>未确定</Select.Option>
            <Select.Option value={MarkType.WillBuy}>可买入</Select.Option>
            <Select.Option value={MarkType.WillHold}>可持有</Select.Option>
            <Select.Option value={MarkType.WillSell}>需卖出</Select.Option>
          </Select>
        </div>
        <div className={styles.item}>
          {config?.tags?.map((t) => (
            <Tag className="edit-tag" key={t} closable onClose={() => removeTag(t)}>
              <span>{t}</span>
            </Tag>
          ))}
          {tagInputVisible && (
            <Input
              type="text"
              size="small"
              className="tag-input"
              value={tagInputValue}
              onChange={(e) => setTagInputValue(e.target.value)}
              onBlur={addTag}
              onPressEnter={addTag}
              style={{ width: 60 }}
            />
          )}
          {!tagInputVisible && (
            <Tag className="site-tag-plus" onClick={() => setTagInputVisible(true)}>
              <PlusOutlined /> New Tag
            </Tag>
          )}
          <span style={{ margin: '0 20px' }}>
            <ColumnWidthOutlined />
          </span>
          {config?.markLines?.map((t) => (
            <Tag className="edit-tag" key={t} closable onClose={() => removeMarkLine(t)}>
              <span>{t}</span>
            </Tag>
          ))}
          {markInputVisible && (
            <Input
              type="number"
              size="small"
              className="tag-input"
              value={markInputValue}
              onChange={(e) => setMarkInputValue(e.target.value)}
              onBlur={addMarkLine}
              onPressEnter={addMarkLine}
              style={{ width: 60 }}
            />
          )}
          {!markInputVisible && (
            <Tag className="site-tag-plus" onClick={() => setMarkInputVisible(true)}>
              <PlusOutlined /> New MarkLine
            </Tag>
          )}
        </div>
      </div>
      <Modal
        title="训练结算"
        visible={!!settlement}
        footer={null}
        width={1000}
        onCancel={() => setSettlement(null)}
        destroyOnClose
      >
        {settlement && <TrainSettlement record={settlement} />}
      </Modal>
    </div>
  );
});

export default TrainBar;
