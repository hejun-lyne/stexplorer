import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, InputNumber, Select, message } from 'antd';
import moment from 'moment';
import { useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { Stock } from '@/types/stock';
import { addStockTradePointAction, appendTrade, fillPendingBuyTradesAction, removeTrade } from '@/actions/stock';
import { ComputeTrainAccount, IsTrainMark } from '@/helpers/trainAccount';
import { IsLimitUpKline } from '@/helpers/stock';

/** 一手股数 */
const MIN_LOT = 100;
/** 初始本金兜底（与详情页训练账户一致） */
const DEFAULT_CAPITAL = 100000;
/** 佣金兜底（与详情页训练账户一致） */
const DEFAULT_COMMISSION = 0.0003;
/** 训练买卖点标记（与详情页 TrainBar 的 TRAIN_TYPE 一致） */
const TRAIN_MARK = 'train';
/** 仓位：全仓 / 可用资金（或持仓）的 1/2、1/3、1/4，与详情页买卖区一致 */
const POSITION_RATIOS = [
  { value: 1, label: '全仓' },
  { value: 2, label: '1/2仓' },
  { value: 3, label: '1/3仓' },
  { value: 4, label: '1/4仓' },
];

function formatMoney(v: number) {
  const n = Math.abs(Math.round(Number(v) || 0));
  return `¥${n.toLocaleString('zh-CN')}`;
}

export interface ScoreStockTradeProps {
  secid: string;
  code: string;
  name: string;
  /** 面板日K（训练模式下已按训练日截断） */
  klines: Stock.KLineItem[];
}

/**
 * 评分结果面板的买入卖出区域
 *
 * - 训练模式：与详情页 TrainBar 完全共用一套数据 —— 买卖点写进 `buyPoints/sellPoints`（t='train'），
 *   买入按训练日收盘价成交（可用金额下委托），卖出为一次清仓，资金/持仓/成本取共享训练账户
 *   （`ComputeTrainAccount`），并遵循 T+1、停牌不可交易、需在自选股中；
 * - 非训练模式：写入手工交易记录（`tradings`），资金口径为「初始本金 - 持仓成本」。
 *
 * 涨停：买入当天涨停买不进，挂为待成交委托，等下一交易日开盘价成交
 * （训练模式下补成交时写入训练买卖点，见 `fillPendingBuyTradesAction`）。
 */
const ScoreStockTrade: React.FC<ScoreStockTradeProps> = ({ secid, code, name, klines }) => {
  const dispatch = useDispatch();
  const { ontrain, trainDate, trainStartDate, initialCapital, commissionRate } = useSelector(
    (state: StoreState) => state.setting.systemSetting
  );
  const { stockConfigsMapping, nowHolds, tradings } = useSelector((state: StoreState) => state.stock);
  const config = stockConfigsMapping?.[secid];

  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  /** 非训练模式的委托价（训练模式按训练日收盘价成交，不可改） */
  const [price, setPrice] = useState<number | null>(null);
  const [ratio, setRatio] = useState<number>(POSITION_RATIOS[0].value);
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');

  const commission =
    Number.isFinite(Number(commissionRate)) && Number(commissionRate) >= 0
      ? Number(commissionRate)
      : DEFAULT_COMMISSION;

  // ===== 训练账户（与详情页同一份数据）=====
  const trainAccount = useMemo(
    () =>
      ontrain
        ? ComputeTrainAccount({
            configs: Object.values(stockConfigsMapping || {}),
            startDate: trainStartDate || '',
            currentDay: trainDate || '',
            initialCapital: Number(initialCapital) || 0,
            commissionRate,
          })
        : null,
    [ontrain, stockConfigsMapping, trainStartDate, trainDate, initialCapital, commissionRate]
  );
  const trainPosition = trainAccount?.positions.find((p) => p.secid === secid);
  const trainCash = trainAccount?.cash || 0;

  // ===== 手工交易记录（非训练模式）=====
  const hold = useMemo(() => nowHolds.find((h) => h.secid === secid), [nowHolds, secid]);
  const holdShares = Number(hold?.count) || 0;
  const occupiedCash = useMemo(
    () => nowHolds.reduce((sum, h) => sum + Number(h.price) * Number(h.count), 0),
    [nowHolds]
  );
  const availableCash = Math.max(0, (Number(initialCapital) || DEFAULT_CAPITAL) - occupiedCash);

  // ===== 行情 =====
  const lastBar = klines.length ? klines[klines.length - 1] : null;
  /** 训练日当天该股的K线；停牌/非交易日为空（此时不可交易） */
  const trainBar = useMemo(() => {
    if (!ontrain) {
      return null;
    }
    if (!trainDate) {
      return lastBar;
    }
    return klines.find((k) => String(k.date).substring(0, 10) === trainDate) || null;
  }, [ontrain, trainDate, klines, lastBar]);

  const tradePrice = ontrain ? Number(trainBar?.sp) || 0 : Number(price) || 0;
  const limitBar = ontrain ? trainBar : lastBar;
  const limitUpToday = !!limitBar && IsLimitUpKline(limitBar, secid, name);

  const cashBase = ontrain ? trainCash : availableCash;
  /** 可卖股数：训练模式为训练账户持仓，非训练模式为手工持仓 */
  const sellSharesBase = ontrain ? Number(trainPosition?.shares) || 0 : holdShares;
  /** 仓位基数：买入按可用资金，卖出按持仓市值 */
  const positionBase = tradeType === 'buy' ? cashBase : sellSharesBase * tradePrice;

  // 仓位 / 买卖方向 / 基数变化时，按仓位比例重新换算委托金额
  useEffect(() => {
    setAmount(positionBase > 0 ? Math.floor(positionBase / ratio) : null);
  }, [ratio, tradeType, positionBase]);

  const tradeAmount = Number(amount) || 0;
  const shares = useMemo(() => {
    if (tradePrice <= 0) {
      return 0;
    }
    // 训练模式卖出 = 一次清仓（与详情页一致）
    if (tradeType === 'sell' && ontrain) {
      return sellSharesBase;
    }
    if (tradeAmount <= 0) {
      return 0;
    }
    if (tradeType === 'buy') {
      // 训练模式金额含佣金（与 ComputeTrainAccount 的口径一致），保证预计股数与实际成交一致
      const budget = ontrain ? tradeAmount / (1 + commission) : tradeAmount;
      return Math.floor(budget / tradePrice / MIN_LOT) * MIN_LOT;
    }
    return Math.min(sellSharesBase, Math.floor(tradeAmount / tradePrice));
  }, [tradeType, ontrain, sellSharesBase, tradeAmount, tradePrice, commission]);

  const orderAmount = shares * tradePrice;

  /** T+1：训练模式下当日买入不可卖出 */
  const boughtToday = useMemo(() => {
    if (!ontrain || !trainDate || !config) {
      return false;
    }
    return (config.buyPoints || []).some(
      (p) => IsTrainMark(p.t) && String(p.x).substring(0, 10) === trainDate && Number(p.y) > 0
    );
  }, [ontrain, trainDate, config]);

  const pendingBuys = useMemo(
    () => (tradings || []).filter((t) => t.pending && t.secid === secid),
    [tradings, secid]
  );

  // 拿到日K后补成交待成交委托（训练模式写入训练买卖点，否则回填手工交易记录）
  useEffect(() => {
    if (klines.length) {
      dispatch(fillPendingBuyTradesAction(secid, klines));
    }
  }, [secid, klines, dispatch]);

  // 换股：重置表单（价格等K线回来后再填）
  useEffect(() => {
    setTradeType('buy');
    setReason('');
    setRatio(POSITION_RATIOS[0].value);
    setPrice(null);
  }, [secid]);

  // 非训练模式：最新收盘价作为默认委托价
  useEffect(() => {
    if (!ontrain && lastBar) {
      setPrice(Number(lastBar.sp) || null);
    }
  }, [ontrain, lastBar]);

  const canSubmit = (() => {
    if (ontrain) {
      if (!config || !trainBar || tradePrice <= 0) {
        return false;
      }
      if (tradeType === 'buy') {
        return shares >= MIN_LOT && tradeAmount > 0 && tradeAmount <= trainCash + 1e-6;
      }
      return sellSharesBase > 0 && !boughtToday;
    }
    if (tradeType === 'buy') {
      return shares >= MIN_LOT && tradeAmount > 0 && tradeAmount <= availableCash + 1e-6;
    }
    return shares > 0 && shares <= holdShares;
  })();

  const handleSubmit = () => {
    if (!canSubmit) {
      return;
    }
    const reasonText = reason.trim();
    const tradeDate = ontrain
      ? String(trainBar?.date).substring(0, 10)
      : String(lastBar?.date).substring(0, 10) || moment().format('YYYY-MM-DD');
    const pendingBuy = tradeType === 'buy' && limitUpToday;

    if (ontrain) {
      if (tradeType === 'buy') {
        if (pendingBuy) {
          dispatch(
            appendTrade({
              id: 0,
              type: 'buy',
              secid,
              name: name || code,
              price: tradePrice,
              count: shares,
              time: `${tradeDate} 15:00:00`,
              stoplossAt: 0,
              latestNewsAs: 'positive',
              explain: '',
              reason: reasonText,
              pending: true,
              pendingAmount: tradeAmount,
              profits: [0, 0, 0, 0, 0],
            })
          );
          message.success(`当日涨停买不进，已挂下一交易日开盘价买入：${name}（${formatMoney(tradeAmount)}）`);
        } else {
          dispatch(addStockTradePointAction(secid, tradeDate, tradePrice, true, TRAIN_MARK, tradeAmount, reasonText));
          message.success(`已买入 ${name}：${tradePrice.toFixed(2)} × ${shares} 股（${formatMoney(orderAmount)}）`);
        }
      } else {
        dispatch(addStockTradePointAction(secid, tradeDate, tradePrice, false, TRAIN_MARK, undefined, reasonText));
        message.success(`已清仓 ${name}：${tradePrice.toFixed(2)} × ${shares} 股（${formatMoney(orderAmount)}）`);
      }
    } else {
      dispatch(
        appendTrade({
          id: 0,
          type: tradeType,
          secid,
          name: name || code,
          price: pendingBuy ? Number(lastBar?.sp) || tradePrice : tradePrice,
          count: shares,
          time: pendingBuy ? `${tradeDate} 15:00:00` : moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
          stoplossAt: 0,
          latestNewsAs: 'positive',
          explain: '',
          reason: reasonText,
          pending: pendingBuy || undefined,
          pendingAmount: pendingBuy ? orderAmount : undefined,
          profits: [0, 0, 0, 0, 0],
        })
      );
      message.success(
        pendingBuy
          ? `当日涨停买不进，已挂下一交易日开盘价买入：${name}（${formatMoney(orderAmount)}）`
          : `${tradeType === 'buy' ? '买入' : '卖出'}已记录：${name} ${tradePrice.toFixed(2)} × ${shares} 股（${formatMoney(
              orderAmount
            )}）`
      );
    }
    setReason('');
  };

  const noConfig = ontrain && !config;
  const suspended = ontrain && !!trainDate && !!lastBar && !trainBar;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
        交易操作
        <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 'normal', color: 'var(--hint-color)' }}>
          {ontrain ? '训练模式 · 与详情页共用训练账户' : '手工交易记录'}
        </span>
      </div>
      <Input.TextArea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="买入/卖出理由（会记录到交易理由里）"
        maxLength={200}
        style={{ fontSize: 12 }}
      />
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        <Button
          size="small"
          style={{ width: 54 }}
          type={tradeType === 'buy' ? 'primary' : 'default'}
          onClick={() => setTradeType('buy')}
        >
          买入
        </Button>
        <Button
          size="small"
          style={{ width: 54 }}
          type={tradeType === 'sell' ? 'primary' : 'default'}
          danger={tradeType === 'sell'}
          onClick={() => setTradeType('sell')}
        >
          卖出
        </Button>
        {ontrain ? (
          <span style={{ fontSize: 11, color: 'var(--secondary-text-color)' }}>
            收盘 {tradePrice > 0 ? tradePrice.toFixed(2) : '--'}
          </span>
        ) : (
          <InputNumber
            size="small"
            style={{ width: 88 }}
            placeholder="价格"
            step={0.01}
            min={0}
            value={price}
            onChange={setPrice}
          />
        )}
        {tradeType === 'buy' || !ontrain ? (
          <>
            <Select size="small" style={{ width: 82 }} value={ratio} onChange={(v) => setRatio(Number(v))}>
              {POSITION_RATIOS.map((r) => (
                <Select.Option key={r.value} value={r.value}>
                  {r.label}
                </Select.Option>
              ))}
            </Select>
            <InputNumber
              size="small"
              style={{ width: 108 }}
              placeholder={tradeType === 'buy' ? '买入金额' : '卖出金额'}
              step={1000}
              min={0}
              value={amount}
              onChange={setAmount}
              title="委托金额（元），按仓位自动换算，可手动修改"
            />
          </>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--secondary-text-color)' }}>一次清仓</span>
        )}
        <Button
          size="small"
          type="primary"
          onClick={handleSubmit}
          disabled={!canSubmit}
          danger={tradeType === 'sell'}
        >
          确认{tradeType === 'buy' ? (limitUpToday ? '买入(次日开盘)' : '买入') : ontrain ? '清仓' : '卖出'}
        </Button>
      </div>

      <div style={{ fontSize: 11, color: 'var(--secondary-text-color)', marginTop: 4 }}>
        {ontrain
          ? `持仓 ${sellSharesBase} 股${
              trainPosition ? ` · 成本 ${trainPosition.costPrice.toFixed(2)}` : ''
            } ｜ 可用资金 ${formatMoney(trainCash)}`
          : `${hold ? `持仓 ${holdShares} 股 · 成本 ${Number(hold.price).toFixed(2)}` : '当前无持仓'} ｜ 可用资金 ${formatMoney(
              availableCash
            )}`}
      </div>
      <div style={{ fontSize: 11, color: 'var(--main-text-color)', marginTop: 2 }}>
        预计成交 <b>{shares}</b> 股 ｜ 金额 <b>{formatMoney(orderAmount)}</b>
        {shares === 0 ? (
          <span style={{ color: 'var(--hint-color)' }}>
            （{tradeType === 'buy' ? '可用资金不足一手' : '无持仓可卖'}）
          </span>
        ) : null}
      </div>
      {tradeType === 'sell' && ontrain && boughtToday ? (
        <div style={{ fontSize: 11, color: '#faad14', marginTop: 2 }}>
          T+1：当日买入，下一交易日才能卖出
        </div>
      ) : null}
      {suspended ? (
        <div style={{ fontSize: 11, color: '#faad14', marginTop: 2 }}>训练日当天停牌，无法交易</div>
      ) : null}
      {noConfig ? (
        <div style={{ fontSize: 11, color: '#faad14', marginTop: 2 }}>
          训练模式需先加入自选股（与详情页一致），才有对应的训练持仓账户
        </div>
      ) : null}
      {tradeType === 'buy' && limitUpToday ? (
        <div style={{ fontSize: 11, color: '#faad14', marginTop: 2 }}>
          当日涨停（收盘 {Number(limitBar?.sp).toFixed(2)}）买不进，买入将按下一交易日开盘价成交
        </div>
      ) : null}
      {pendingBuys.length ? (
        <div style={{ fontSize: 11, color: 'var(--hint-color)', marginTop: 4 }}>
          {pendingBuys.map((t) => (
            <div key={t.id}>
              待成交买入 {formatMoney(Number(t.pendingAmount) || 0)}（{String(t.time).substring(0, 10)}{' '}
              涨停挂单，等次日开盘价）
              <a style={{ marginLeft: 6 }} onClick={() => dispatch(removeTrade(t.id))}>
                取消
              </a>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default ScoreStockTrade;
