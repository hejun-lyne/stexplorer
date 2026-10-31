import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, InputNumber, Select, message } from 'antd';
import moment from 'moment';
import { useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { Stock } from '@/types/stock';
import {
  addStockAction,
  addStockTagAction,
  addStockTradePointAction,
  appendTrade,
  fillPendingBuyTradesAction,
  removeTrade,
} from '@/actions/stock';
import { ComputeTrainAccount, IsTrainMark } from '@/helpers/trainAccount';
import { GetStockDetail, GetStockType, IsLimitUpKline } from '@/helpers/stock';

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
  const { ontrain, trainDate, trainStartDate, initialCapital, commissionRate, kLineApiSourceSetting } = useSelector(
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

  // 仓位 / 买卖方向 / 基数变化时，按仓位比例重新换算委托金额。
  // 换股也要重算：训练模式的可用资金是共享的，换股后 positionBase 往往不变，
  // 不重算会把上一只股票手填的金额带过来（可能超过可用资金，按钮就一直不可点）。
  useEffect(() => {
    setAmount(positionBase > 0 ? Math.floor(positionBase / ratio) : null);
  }, [ratio, tradeType, positionBase, secid]);

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

  // 拿到日K后补成交待成交委托（训练模式写入训练买卖点，否则回填手工交易记录）。
  // trainDate 也要作为依赖：训练日推进后，即使日K还没刷新完，也会用新数据再补一次
  // （旧日K里找不到「委托日之后」的K线，属于安全空操作）。
  useEffect(() => {
    if (klines.length) {
      dispatch(fillPendingBuyTradesAction(secid, klines));
    }
  }, [secid, klines, dispatch, trainDate]);

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
      // 不再要求已在自选股：买入时会自动加入（见 ensureTrainConfig）
      if (!trainBar || tradePrice <= 0) {
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

  /** 防止重复提交（自动加入自选股要现取详情，期间连点会重复下单/重复打标签） */
  const submittingRef = useRef(false);

  /**
   * 训练模式买入前确保该股在自选股里
   *
   * 训练账户的买卖点存在个股配置（`stockConfigsMapping[secid]`）里，之前要求先手动收藏；
   * 现在改为买入时自动加入自选股，并打上「训练」标签，方便在自选股里筛出训练过的标的。
   */
  const ensureTrainConfig = async () => {
    if (!ontrain || config) {
      return true;
    }
    try {
      const detail = await GetStockDetail(kLineApiSourceSetting, secid);
      if (!detail) {
        message.warning('自动加入自选股失败（未取到个股详情），请手动加入后再买入');
        return false;
      }
      dispatch(
        addStockAction(
          { ...detail, secid, code, name: detail.name || name || code } as Stock.DetailItem,
          GetStockType(secid)
        )
      );
      dispatch(addStockTagAction('训练', secid));
      message.success(`已自动加入自选股：${name || code}（标签：训练）`);
      console.log(`[交易] 未在自选股，已自动加入：${name || code}（标签：训练）`);
      return true;
    } catch (e: any) {
      message.warning(`自动加入自选股失败：${e?.message || e}`);
      return false;
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    try {
      await doSubmit();
    } finally {
      submittingRef.current = false;
    }
  };

  const doSubmit = async () => {
    // 训练模式下买入未收藏的标的：先自动加入自选股（标签：训练），再写入买卖点
    if (tradeType === 'buy' && !(await ensureTrainConfig())) {
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

  /**
   * 「确认买入/清仓」按钮不可点的原因（就绪时为空串）
   *
   * 直接显示在按钮下方：之前只有「未加入自选」「停牌」两个提示，
   * 委托金额超可用资金、当天没有行情、T+1 这些情况点了没反应又看不出原因。
   */
  const disabledReason = (() => {
    if (ontrain) {
      if (!trainBar || tradePrice <= 0) {
        return suspended ? '训练日当天停牌，无法交易' : '训练日当天没有该股行情，无法交易';
      }
      if (tradeType === 'buy') {
        if (tradeAmount <= 0) {
          return '请填写委托金额（大于 0）';
        }
        if (tradeAmount > trainCash + 1e-6) {
          return `委托金额 ${formatMoney(tradeAmount)} 超过可用资金 ${formatMoney(trainCash)}`;
        }
        return '';
      }
      if (sellSharesBase <= 0) {
        return '当前无持仓，无法卖出';
      }
      if (boughtToday) {
        return 'T+1：当日买入，下一交易日才能卖出';
      }
      return '';
    }
    if (tradeType === 'buy') {
      if (tradeAmount <= 0) {
        return '请填写委托金额（大于 0）';
      }
      if (tradeAmount > availableCash + 1e-6) {
        return `委托金额 ${formatMoney(tradeAmount)} 超过可用资金 ${formatMoney(availableCash)}`;
      }
      return '';
    }
    if (shares <= 0) {
      return '无持仓可卖';
    }
    if (shares > holdShares) {
      return `可卖股数超过持仓（${holdShares} 股）`;
    }
    return '';
  })();

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
        交易操作
        <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 'normal', color: 'var(--hint-color)' }}>
          {ontrain ? '训练模式 · 与详情页共用训练账户' : '手工交易记录'}
        </span>
      </div>
      <Input.TextArea
        rows={5}
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
        {pendingBuys.length ? '本次新委托预计成交' : '预计成交'} <b>{shares}</b> 股 ｜ 金额{' '}
        <b>{formatMoney(orderAmount)}</b>
        {shares === 0 ? (
          <span style={{ color: 'var(--hint-color)' }}>
            （
            {tradeType === 'buy'
              ? `可用资金不足一手，1 手约需 ${formatMoney(tradePrice * MIN_LOT * (1 + commission))}`
              : '无持仓可卖'}
            ）
          </span>
        ) : null}
      </div>
      {disabledReason ? (
        <div style={{ fontSize: 11, color: '#faad14', marginTop: 2 }}>无法委托：{disabledReason}</div>
      ) : null}
      {noConfig && tradeType === 'buy' ? (
        <div style={{ fontSize: 11, color: 'var(--hint-color)', marginTop: 2 }}>
          未在自选股：买入时会自动加入自选股，并打上「训练」标签
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
      <div style={{ height: 30}}>
      </div>
    </div>
  );
};

export default ScoreStockTrade;
