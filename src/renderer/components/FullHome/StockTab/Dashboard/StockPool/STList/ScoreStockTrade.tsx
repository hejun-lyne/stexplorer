import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, InputNumber, Select, Tooltip, message } from 'antd';
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
import { BuildStockTradeRecord, ComputeTrainAccount, IsTrainMark } from '@/helpers/trainAccount';
import { addTrainTradeRecordAction } from '@/actions/train';
import { GetLimitUpPct, GetStockDetail, GetStockType } from '@/helpers/stock';
import { calculateATR } from '@/helpers/tech';
import { GetStorage, SetStorage } from '@/utils';
import * as TrainFilter from '@/utils/trainFilter';
import { ReadReviewRecords, ReviewRecord, WriteReviewRecords } from '@/helpers/trainReview';

/** 一手股数 */
const MIN_LOT = 100;
/** 初始本金兜底（与详情页训练账户一致） */
const DEFAULT_CAPITAL = 100000;
/** 佣金兜底（与详情页训练账户一致） */
const DEFAULT_COMMISSION = 0.0003;
/** 训练买卖点标记（与详情页 TrainBar 的 TRAIN_TYPE 一致） */
const TRAIN_MARK = 'train';
/** ATR 趋势卖出信号（钱德退出）：ATR 周期 / 追踪高点回看天数 / 止损倍数 */
const ATR_PERIOD = 14;
const ATR_LOOKBACK = 20;
const ATR_MULTIPLIER = 3;
/** 仓位：全仓 / 可用资金（或持仓）的 1/2、1/3、1/4，与详情页买卖区一致 */
export const POSITION_RATIOS = [
  { value: 1, label: '全仓' },
  { value: 2, label: '1/2仓' },
  { value: 3, label: '1/3仓' },
  { value: 4, label: '1/4仓' },
];
/** 「买入/卖出理由」草稿的本地存储键（按标的分开存） */
const REASON_DRAFT_KEY = 'scoreStockTradeReasonDrafts';

function formatMoney(v: number) {
  const n = Math.abs(Math.round(Number(v) || 0));
  return `¥${n.toLocaleString('zh-CN')}`;
}

/** 读取该标的上次填写、尚未提交的买卖理由 */
function readReasonDraft(secid: string) {
  try {
    const drafts = GetStorage<Record<string, string>>(REASON_DRAFT_KEY, {}) || {};
    return String(drafts[secid] || '');
  } catch (e) {
    return '';
  }
}

/** 保存（传空则删除）该标的的买卖理由草稿 */
function writeReasonDraft(secid: string, text: string) {
  if (!secid) {
    return;
  }
  try {
    const drafts = GetStorage<Record<string, string>>(REASON_DRAFT_KEY, {}) || {};
    const value = String(text || '');
    if (value.trim()) {
      drafts[secid] = value;
    } else {
      delete drafts[secid];
    }
    SetStorage(REASON_DRAFT_KEY, drafts);
  } catch (e) {
    console.log('保存买卖理由草稿出错', e);
  }
}

/** 操作记录行（训练买卖点 / 手工交易记录 / 复盘统一成同一形态） */
interface TradeRecordRow {
  key: string;
  /** 记录时间（日期部分） */
  date: string;
  /** 记录时间（时分秒，仅复盘记录有） */
  time?: string;
  type: 'buy' | 'sell' | 'review';
  price: number;
  /** 股数 / 委托金额等补充信息 */
  detail: string;
  reason: string;
  pending?: boolean;
}

/** 记录排序键：日期 + 时分秒（买卖点为纯日期，复盘带时间） */
function getRecordSortKey(r: { date: string; time?: string }) {
  return `${r.date} ${r.time || '00:00:00'}`;
}

export interface ScoreStockTradeProps {
  secid: string;
  code: string;
  name: string;
  /** 面板日K（训练模式下已按训练日截断） */
  klines: Stock.KLineItem[];
  /** 当前分时价（训练模式为训练时刻之前最后一分钟，非训练模式为实时最新价）；0 表示暂无分时 */
  currentPrice?: number;
  /** 分时是否已取回（false = 还在加载）：加载中不允许下单，避免用收盘价成交 */
  intradayReady?: boolean;
  /**
   * 受控仓位（列表模式顶部统一选择）：传值时不由本组件维护，切换股票也不会重置
   */
  ratio?: number;
  /** 受控仓位的变更回调（由顶部统一选择维护时必传） */
  onRatioChange?: (ratio: number) => void;
  /**
   * 紧凑模式（右侧面板列表模式）
   *
   * 只保留「买入（按顶部选择的仓位金额）」与「清仓（有持仓时）」两个按钮，
   * 不渲染理由输入、金额输入、仓位下拉与操作记录，避免多只股票时占满屏幕。
   */
  compact?: boolean;
  /**
   * 行内模式（列表模式的信息行）：只保留买入 / 清仓按钮，
   * 隐藏现价、持仓、待成交等辅助文字，让名字、买入与图表切换挤在同一行。
   */
  inline?: boolean;
}

/**
 * 评分结果面板的买入卖出区域
 *
 * - 成交价：买入与卖出都按「当前分时价」成交（`currentPrice`，即面板分时的最后一分钟价），
 *   取不到分时数据时退回日K收盘价（训练模式为训练日收盘，非训练模式为最新收盘）；
 *   分时还在加载（`intradayReady === false`）时禁止下单，避免用收盘价成交；
 * - 训练模式：与详情页 TrainBar 完全共用一套数据 —— 买卖点写进 `buyPoints/sellPoints`（t='train'），
 *   买入按可用金额下委托，卖出为一次清仓，资金/持仓/成本取共享训练账户
 *   （`ComputeTrainAccount`），并遵循 T+1、停牌不可交易、需在自选股中；
 * - 非训练模式：写入手工交易记录（`tradings`），资金口径为「初始本金 - 持仓成本」。
 *
 * 涨停：买入当天涨停买不进，挂为待成交委托，等下一交易日开盘价成交
 * （训练模式下补成交时写入训练买卖点，见 `fillPendingBuyTradesAction`）。
 *
 * 买入/卖出理由：内容不为空时按标的存本地草稿，切换股票 / 推进训练日 / 关闭面板都不会丢，
 * 下次自动回填；执行买入或卖出后，文本作为 `reason` 写入操作记录并清空草稿。
 * 另有「复盘」操作：不产生买卖点 / 交易记录，只把当前理由按标的存成复盘记录（本地存储），
 * 与买卖记录一起列在操作记录里。
 * 面板最后按标的列出操作记录（训练买卖点 / 手工交易记录 / 复盘），逐条显示理由。
 */
const ScoreStockTrade: React.FC<ScoreStockTradeProps> = ({
  secid,
  code,
  name,
  klines,
  currentPrice,
  intradayReady,
  ratio: ratioProp,
  onRatioChange,
  compact = false,
  inline = false,
}) => {
  const dispatch = useDispatch();
  const { ontrain, trainDate, trainTime, trainStartDate, initialCapital, commissionRate, kLineApiSourceSetting } =
    useSelector((state: StoreState) => state.setting.systemSetting);
  const { stockConfigsMapping, nowHolds, tradings } = useSelector((state: StoreState) => state.stock);
  /** 训练窗口交易日：用于把「持有天数」换算成交易日数 */
  const trainDays = useSelector((state: StoreState) => state.train.days);
  const config = stockConfigsMapping?.[secid];

  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [innerRatio, setInnerRatio] = useState<number>(POSITION_RATIOS[0].value);
  /** 受控仓位（列表模式顶部统一选择）：外部传值时以外部为准，切股不重置 */
  const ratioControlled = typeof ratioProp === 'number' && ratioProp > 0;
  const ratio = ratioControlled ? Number(ratioProp) : innerRatio;
  const setRatio = (v: number) => {
    if (!ratioControlled) {
      setInnerRatio(v);
    }
    if (onRatioChange) {
      onRatioChange(v);
    }
  };
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  // ===== 复盘记录（按标的存本地，不参与训练账户 / 交易记录计算）=====
  const [reviewRecords, setReviewRecords] = useState<ReviewRecord[]>([]);

  useEffect(() => {
    setReviewRecords(ReadReviewRecords(secid));
  }, [secid]);

  // ===== 买入/卖出理由草稿（按标的保存，切换股票 / 推进训练日后自动回填）=====
  /** 草稿归属的标的、训练日与最新内容（换股/换日/卸载时按它落盘）；初始为空，首次渲染即回填 */
  const reasonDraftRef = useRef({ secid: '', date: '', text: '' });

  // 换股：先把上一只标的已填写的内容存下来，再把该标的上次记录的理由回填到输入框
  // 换训练日：同样先把内容存下来，下次（同标的）自动带出
  useEffect(() => {
    const prev = reasonDraftRef.current;
    const day = trainDate || '';
    const stockChanged = prev.secid !== secid;
    if (prev.secid && (stockChanged || prev.date !== day || prev.text)) {
      writeReasonDraft(prev.secid, prev.text);
    }
    if (stockChanged) {
      const draft = readReasonDraft(secid);
      setReason(draft);
      reasonDraftRef.current = { secid, date: day, text: draft };
      return;
    }
    reasonDraftRef.current = { secid, date: day, text: prev.text };
  }, [secid, trainDate]);

  // 卸载（关闭右侧面板）时也把没提交的内容存下来
  useEffect(
    () => () => {
      const prev = reasonDraftRef.current;
      writeReasonDraft(prev.secid, prev.text);
    },
    []
  );

  // 输入内容随时同步到草稿引用，保证换股/换日/卸载时存的是最新文本
  useEffect(() => {
    reasonDraftRef.current = { secid, date: trainDate || '', text: reason };
  }, [secid, trainDate, reason]);

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

  /** 当前分时价：买入、卖出都按它成交 */
  const trendPrice = Number(currentPrice) || 0;
  /** 兜底：没有分时数据时用日K收盘价（训练模式为训练日收盘，非训练模式为最新收盘） */
  const closePrice = ontrain ? Number(trainBar?.sp) || 0 : Number(lastBar?.sp) || 0;
  const tradePrice = trendPrice > 0 ? trendPrice : closePrice;
  const limitBar = ontrain ? trainBar : lastBar;
  /**
   * 当日是否已涨停：按「当前分时价」相对昨收判断
   *
   * 之前按日K收盘价 + 最高价判断，训练模式下用的是收盘后的未来数据：
   * 盘中并未涨停也会被判定成「涨停买不进」，反之也可能漏判。
   */
  const limitUpToday = useMemo(() => {
    const prevClose = Number(limitBar?.zs) || 0;
    if (tradePrice <= 0 || prevClose <= 0) {
      return false;
    }
    return (tradePrice / prevClose) * 100 - 100 >= GetLimitUpPct(secid, name) - 0.3;
  }, [tradePrice, limitBar, secid, name]);

  const cashBase = ontrain ? trainCash : availableCash;
  /** 可卖股数：训练模式为训练账户持仓，非训练模式为手工持仓 */
  const sellSharesBase = ontrain ? Number(trainPosition?.shares) || 0 : holdShares;
  /**
   * ATR 趋势卖出信号（钱德退出）：仅对持仓股票计算
   *
   * 止损线 = 近 ATR_LOOKBACK 日最高价（不含当日） − ATR_MULTIPLIER × ATR(ATR_PERIOD)；
   * 当日收盘价跌破止损线即触发「趋势走坏」卖出提示。数据不足（日K太少 / ATR 未成形）时返回 null。
   */
  const atrSellSignal = useMemo(() => {
    if (sellSharesBase <= 0 || !(klines && klines.length)) {
      return null;
    }
    const bars = [...klines].sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1));
    const last = bars[bars.length - 1];
    const close = Number(last.sp);
    if (!Number.isFinite(close) || close <= 0) {
      return null;
    }
    const atr = calculateATR(bars, ATR_PERIOD);
    const atrNow = atr[atr.length - 1];
    if (!Number.isFinite(atrNow) || atrNow <= 0) {
      return null;
    }
    const lookback = Math.min(ATR_LOOKBACK, bars.length - 1);
    if (lookback <= 0) {
      return null;
    }
    const prior = bars.slice(bars.length - 1 - lookback, bars.length - 1);
    const high = Math.max(...prior.map((k) => Number(k.zg)));
    if (!Number.isFinite(high) || high <= 0) {
      return null;
    }
    const stopLine = high - ATR_MULTIPLIER * atrNow;
    return { close, atr: atrNow, high, stopLine, triggered: close < stopLine };
  }, [klines, sellSharesBase]);
  /** 仓位基数：买入按可用资金，卖出按持仓市值 */
  const positionBase = tradeType === 'buy' ? cashBase : sellSharesBase * tradePrice;

  // 仓位 / 买卖方向 / 基数变化时，按仓位比例重新换算委托金额。
  // 换股也要重算：训练模式的可用资金是共享的，换股后 positionBase 往往不变，
  // 不重算会把上一只股票手填的金额带过来（可能超过可用资金，按钮就一直不可点）。
  // 现价（分时每分钟刷新）不触发重算：否则会不断覆盖手填的委托金额。
  const amountBaseRef = useRef('');
  useEffect(() => {
    const key = `${secid}_${tradeType}_${ratio}_${cashBase}_${sellSharesBase}`;
    if (amountBaseRef.current === key) {
      return;
    }
    amountBaseRef.current = key;
    setAmount(positionBase > 0 ? Math.floor(positionBase / ratio) : null);
  }, [ratio, tradeType, positionBase, secid, cashBase, sellSharesBase]);

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

  // 换股：重置表单（成交价随分时/日K自动更新；理由由上面的草稿逻辑回填，这里不动）
  // 受控仓位（列表模式顶部统一选择）不在这里重置，否则每只股票都会回到「全仓」
  useEffect(() => {
    setTradeType('buy');
    if (!ratioControlled) {
      setInnerRatio(POSITION_RATIOS[0].value);
    }
  }, [secid, ratioControlled]);

  const canSubmit = (() => {
    if (intradayReady === false) {
      return false;
    }
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

  /**
   * 提交买卖
   *
   * @param override 列表模式（紧凑交易区）直接指定方向 / 股数 / 金额，
   *                 不依赖界面上没有渲染的「买卖方向 / 金额输入框」状态
   */
  const doSubmit = async (override?: { type?: 'buy' | 'sell'; shares?: number; amount?: number; reason?: string }) => {
    const submitType = override?.type || tradeType;
    const submitShares = override?.shares != null ? override.shares : shares;
    const submitAmount = override?.amount != null ? override.amount : tradeAmount;
    const submitOrderAmount = submitShares * tradePrice;
    // 训练模式下买入未收藏的标的：先自动加入自选股（标签：训练），再写入买卖点
    if (submitType === 'buy' && !(await ensureTrainConfig())) {
      return;
    }
    const reasonText = (override?.reason != null ? override.reason : reason).trim();
    const tradeDate = ontrain
      ? String(trainBar?.date).substring(0, 10)
      : String(lastBar?.date).substring(0, 10) || moment().format('YYYY-MM-DD');
    // 成交时间点：训练模式取当前训练时钟（与分时价对应），非训练模式取真实时间
    const tradeClock = ontrain ? TrainFilter.NormalizeTrainClock(trainTime) : moment(new Date()).format('HH:mm');
    const pendingBuy = submitType === 'buy' && limitUpToday;

    if (ontrain) {
      if (submitType === 'buy') {
        if (pendingBuy) {
          dispatch(
            appendTrade({
              id: 0,
              type: 'buy',
              secid,
              name: name || code,
              price: tradePrice,
              count: submitShares,
              time: `${tradeDate} 15:00:00`,
              stoplossAt: 0,
              latestNewsAs: 'positive',
              explain: '',
              reason: reasonText,
              pending: true,
              pendingAmount: submitAmount,
              profits: [0, 0, 0, 0, 0],
            })
          );
          message.success(`当日涨停买不进，已挂下一交易日开盘价买入：${name}（${formatMoney(submitAmount)}）`);
        } else {
          dispatch(
            addStockTradePointAction(
              secid,
              tradeDate,
              tradePrice,
              true,
              TRAIN_MARK,
              submitAmount,
              reasonText,
              tradeClock
            )
          );
          message.success(
            `已买入 ${name}：${tradePrice.toFixed(2)} × ${submitShares} 股（${formatMoney(submitOrderAmount)}）`
          );
        }
      } else {
        // 清仓即归档：把本轮（上一次清仓 → 本次清仓）的完整交易写入「训练记录」
        const tradeRecord = BuildStockTradeRecord({
          secid,
          name: name || code,
          sellDate: tradeDate,
          sellTime: tradeClock,
          sellPrice: tradePrice,
          shares: Number(trainPosition?.shares) || 0,
          costAmount: Number(trainPosition?.costAmount) || 0,
          commissionRate: commission,
          reason: reasonText,
          trainStartDate,
          buyPoints: config?.buyPoints,
          sellPoints: config?.sellPoints,
          tradingDays: trainDays,
        });
        dispatch(
          addStockTradePointAction(secid, tradeDate, tradePrice, false, TRAIN_MARK, undefined, reasonText, tradeClock)
        );
        if (tradeRecord) {
          dispatch(addTrainTradeRecordAction(tradeRecord));
        }
        message.success(
          `已清仓 ${name}：${tradePrice.toFixed(2)} × ${submitShares} 股（${formatMoney(submitOrderAmount)}）`
        );
      }
    } else {
      dispatch(
        appendTrade({
          id: 0,
          type: submitType,
          secid,
          name: name || code,
          price: pendingBuy ? Number(lastBar?.sp) || tradePrice : tradePrice,
          count: submitShares,
          time: pendingBuy ? `${tradeDate} 15:00:00` : moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
          stoplossAt: 0,
          latestNewsAs: 'positive',
          explain: '',
          reason: reasonText,
          pending: pendingBuy || undefined,
          pendingAmount: pendingBuy ? submitOrderAmount : undefined,
          profits: [0, 0, 0, 0, 0],
        })
      );
      message.success(
        pendingBuy
          ? `当日涨停买不进，已挂下一交易日开盘价买入：${name}（${formatMoney(submitOrderAmount)}）`
          : `${submitType === 'buy' ? '买入' : '卖出'}已记录：${name} ${tradePrice.toFixed(
              2
            )} × ${submitShares} 股（${formatMoney(submitOrderAmount)}）`
      );
    }
    // 理由已经写进操作记录，草稿清空（输入框里不再留着上一笔的理由）
    writeReasonDraft(secid, '');
    reasonDraftRef.current = { secid, date: trainDate || '', text: '' };
    setReason('');
  };

  const noConfig = ontrain && !config;
  const suspended = ontrain && !!trainDate && !!lastBar && !trainBar;

  /**
   * 复盘：只把当前理由存成一条复盘记录（不产生买卖点 / 交易记录，不影响训练账户）
   *
   * 训练模式下日期取训练日（而不是真实日期），方便和当天的买卖点对上；保存后清空草稿。
   */
  const handleReview = () => {
    const reasonText = reason.trim();
    if (!reasonText) {
      message.info('请先填写复盘内容');
      return;
    }
    const record: ReviewRecord = {
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      date: ontrain
        ? trainDate || String(trainBar?.date).substring(0, 10) || moment().format('YYYY-MM-DD')
        : moment().format('YYYY-MM-DD'),
      time: moment().format('HH:mm:ss'),
      reason: reasonText,
      price: tradePrice > 0 ? tradePrice : 0,
    };
    const next = [...ReadReviewRecords(secid), record];
    WriteReviewRecords(secid, next);
    setReviewRecords(next);
    // 内容已经写进复盘记录，草稿清空
    writeReasonDraft(secid, '');
    reasonDraftRef.current = { secid, date: trainDate || '', text: '' };
    setReason('');
    message.success(`复盘已保存到操作记录：${name || code}`);
  };

  /**
   * 该标的的操作记录（面板最后展示，带买入/卖出/复盘理由）
   *
   * - 训练模式：取训练买卖点（`buyPoints/sellPoints` 中 t='train' 的点），与详情页共用；
   * - 非训练模式：取手工交易记录（`tradings`），待成交委托也列出来；
   * - 两种模式都追加该标的的复盘记录（本地存储，只按日期过滤未来记录）。
   */
  const tradeRecords = useMemo<TradeRecordRow[]>(() => {
    const reviewRows: TradeRecordRow[] = reviewRecords
      .filter((r) => !ontrain || !trainDate || r.date <= trainDate)
      .map((r) => ({
        key: `review_${r.id}`,
        date: r.date,
        time: r.time,
        type: 'review' as 'review',
        price: Number(r.price) || 0,
        detail: '复盘',
        reason: r.reason,
      }));
    const rows: TradeRecordRow[] = [];
    if (ontrain) {
      // 训练日之后的买卖点不展示（属于还没走到的未来）
      const inRange = (p: { x: string }) => !trainDate || String(p.x).substring(0, 10) <= trainDate;
      (config?.buyPoints || []).forEach((p, i) => {
        const price = Number(p.y) || 0;
        if (!IsTrainMark(p.t) || price <= 0 || !inRange(p)) {
          return;
        }
        const budget = Number(p.a) || 0;
        rows.push({
          key: `buy_${p.x}_${i}`,
          date: String(p.x).substring(0, 10),
          time: p.time ? String(p.time) : '',
          type: 'buy',
          price,
          detail: budget > 0 ? formatMoney(budget) : '按可用资金',
          reason: String(p.reason || ''),
        });
      });
      (config?.sellPoints || []).forEach((p, i) => {
        const price = Number(p.y) || 0;
        if (!IsTrainMark(p.t) || price <= 0 || !inRange(p)) {
          return;
        }
        rows.push({
          key: `sell_${p.x}_${i}`,
          date: String(p.x).substring(0, 10),
          time: p.time ? String(p.time) : '',
          type: 'sell',
          price,
          detail: '一次清仓',
          reason: String(p.reason || ''),
        });
      });
    } else {
      rows.push(
        ...[...(tradings || [])]
          .filter((t) => t.secid === secid)
          .map((t) => ({
            key: `trade_${t.id}`,
            date: String(t.time || '').substring(0, 10),
            time: String(t.time || '').substring(11, 19),
            type: (t.type === 'sell' ? 'sell' : 'buy') as 'buy' | 'sell',
            price: Number(t.price) || 0,
            detail: t.pending ? `${formatMoney(Number(t.pendingAmount) || 0)} 待成交` : `${Number(t.count) || 0} 股`,
            reason: String(t.reason || t.explain || ''),
            pending: !!t.pending,
          }))
      );
    }
    // 最近的排最前；同一天按时间倒序（复盘带时分秒），同一时刻先买后卖
    return [...rows, ...reviewRows].sort((a, b) => {
      const ka = getRecordSortKey(a);
      const kb = getRecordSortKey(b);
      if (ka !== kb) {
        return ka < kb ? 1 : -1;
      }
      if (a.type === b.type) {
        return 0;
      }
      return a.type === 'buy' ? -1 : 1;
    });
  }, [ontrain, config, tradings, secid, trainDate, reviewRecords]);

  /**
   * 「确认买入/清仓」按钮不可点的原因（就绪时为空串）
   *
   * 直接显示在按钮下方：之前只有「未加入自选」「停牌」两个提示，
   * 委托金额超可用资金、当天没有行情、T+1 这些情况点了没反应又看不出原因。
   */
  const disabledReason = (() => {
    if (intradayReady === false) {
      // 分时还没取回来：此时只能拿到日K收盘价，训练模式下那是收盘后的未来数据，不能成交
      return '分时价加载中，稍等一下再下单（成交价按当前分时价计算）';
    }
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

  // ===== 紧凑模式（列表模式）：只保留「按顶部仓位买入」与「清仓」 =====
  /** 买入金额：可用资金 ÷ 顶部选择的仓位比例 */
  const compactBuyBudget = Math.floor(cashBase / ratio);
  const compactBuyShares = (() => {
    if (tradePrice <= 0 || compactBuyBudget <= 0) {
      return 0;
    }
    // 训练模式金额含佣金（与 ComputeTrainAccount 口径一致）
    const budget = ontrain ? compactBuyBudget / (1 + commission) : compactBuyBudget;
    return Math.floor(budget / tradePrice / MIN_LOT) * MIN_LOT;
  })();
  const compactBuyAmount = compactBuyShares * tradePrice;
  const canCompactBuy =
    intradayReady !== false &&
    tradePrice > 0 &&
    (!ontrain || !!trainBar) &&
    compactBuyShares >= MIN_LOT &&
    compactBuyBudget <= cashBase + 1e-6;
  const canCompactSell =
    intradayReady !== false && tradePrice > 0 && sellSharesBase > 0 && (!ontrain || (!!trainBar && !boughtToday));
  const ratioLabel = POSITION_RATIOS.find((r) => r.value === ratio)?.label || `${ratio}`;
  /** 买入按钮不可点的原因（列表模式没有输入框，需要一句话说明） */
  const compactBuyHint =
    intradayReady === false
      ? '分时价加载中'
      : ontrain && !trainBar
        ? suspended
          ? '当日停牌'
          : '当日无行情'
        : tradePrice <= 0
          ? '暂无行情'
          : compactBuyShares < MIN_LOT
            ? '可用资金不足一手'
            : '';

  /** 列表模式直接下单：买入按顶部仓位金额，卖出一次清仓 */
  const handleCompactSubmit = async (type: 'buy' | 'sell') => {
    if (submittingRef.current) {
      return;
    }
    if (type === 'buy' ? !canCompactBuy : !canCompactSell) {
      return;
    }
    submittingRef.current = true;
    try {
      if (type === 'buy') {
        await doSubmit({ type: 'buy', shares: compactBuyShares, amount: compactBuyBudget });
      } else {
        await doSubmit({ type: 'sell', shares: sellSharesBase, amount: sellSharesBase * tradePrice });
      }
    } finally {
      submittingRef.current = false;
    }
  };

  /** ATR 趋势卖出信号提示（仅持仓时渲染，悬停看说明） */
  const atrSellNode = atrSellSignal ? (
    <Tooltip
      title={
        <div style={{ fontSize: 11, lineHeight: 1.6 }}>
          趋势卖出信号（ATR 钱德退出，仅对持仓股计算）：止损线 = 近{ATR_LOOKBACK}日最高价{' '}
          {atrSellSignal.high.toFixed(2)} − {ATR_MULTIPLIER}×ATR({ATR_PERIOD}，{atrSellSignal.atr.toFixed(2)}) ={' '}
          {atrSellSignal.stopLine.toFixed(2)}；最新收盘 {atrSellSignal.close.toFixed(2)}。
          {atrSellSignal.triggered
            ? '收盘价已跌破止损线，波动通道下轨失守，中期趋势可能走坏，建议考虑卖出。'
            : '收盘价未跌破止损线，趋势仍属正常，暂不提示卖出。'}
        </div>
      }
    >
      <span
        style={{
          color: atrSellSignal.triggered ? '#ff4d4f' : 'var(--secondary-text-color)',
          fontWeight: atrSellSignal.triggered ? 'bold' : 'normal',
          cursor: 'help',
        }}
      >
        {atrSellSignal.triggered ? '⚠ 趋势卖出信号' : '趋势正常'}
      </span>
    </Tooltip>
  ) : null;

  if (compact) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: inline ? 'nowrap' : 'wrap',
          gap: inline ? 4 : 6,
          fontSize: 11,
          whiteSpace: inline ? 'nowrap' : undefined,
          color: 'var(--secondary-text-color)',
        }}
      >
        {!inline ? (
          <>
            <span>
              {trendPrice > 0 ? '现价' : '收盘'} <b>{tradePrice > 0 ? tradePrice.toFixed(2) : '--'}</b>
            </span>
            {sellSharesBase > 0 ? (
              <span>
                持仓 <b>{sellSharesBase}</b> 股
              </span>
            ) : null}
            {atrSellNode}
          </>
        ) : null}
        <Button
          size="small"
          type="primary"
          disabled={!canCompactBuy}
          onClick={() => handleCompactSubmit('buy')}
          title={compactBuyHint || `按顶部仓位（${ratioLabel}）买入 ${formatMoney(compactBuyAmount)}，金额随可用资金自动换算`}
        >
          {limitUpToday ? '买入(次日开盘)' : '买入'}
          {inline ? '' : ` · ${formatMoney(compactBuyAmount)}`}
        </Button>
        {sellSharesBase > 0 ? (
          <Button
            size="small"
            danger
            disabled={!canCompactSell}
            onClick={() => handleCompactSubmit('sell')}
            title={boughtToday ? 'T+1：当日买入，下一交易日才能卖出' : `按现价清仓 ${sellSharesBase} 股`}
          >
            清仓
          </Button>
        ) : null}
        {!inline && compactBuyHint ? <span style={{ color: '#faad14' }}>{compactBuyHint}</span> : null}
        {!inline && pendingBuys.length ? (
          <span style={{ color: 'var(--hint-color)' }}>
            待成交 {formatMoney(Number(pendingBuys[0].pendingAmount) || 0)}
            <a style={{ marginLeft: 4 }} onClick={() => dispatch(removeTrade(pendingBuys[0].id))}>
              取消
            </a>
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
        交易操作
        <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 'normal', color: 'var(--hint-color)' }}>
          {ontrain ? '训练模式 · 与详情页共用训练账户' : '手工交易记录'}
        </span>
      </div>
      {atrSellNode ? <div style={{ marginBottom: 6 }}>{atrSellNode}</div> : null}
      <Input.TextArea
        rows={5}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="买入/卖出理由或复盘内容（记录到操作记录；切换股票/下一日会自动保留）"
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
        <span
          style={{ fontSize: 11, color: 'var(--secondary-text-color)' }}
          title={
            trendPrice > 0
              ? '按当前分时价成交（买入、卖出一致）'
              : '暂无分时数据，按日K收盘价成交（买入、卖出一致）'
          }
        >
          {trendPrice > 0 ? '现价' : '收盘'} {tradePrice > 0 ? tradePrice.toFixed(2) : '--'}
        </span>
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
        <Button
          size="small"
          type="dashed"
          onClick={handleReview}
          disabled={!reason.trim()}
          title="只把当前内容存成一条复盘记录（不产生买卖点 / 交易记录），列在下方操作记录里"
        >
          复盘
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
          当前已涨停（现价 {tradePrice.toFixed(2)}）买不进，买入将按下一交易日开盘价成交
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
      {/* 该标的的操作记录：买入/卖出/价格/股数或金额，并显示下单时填写的理由 */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          操作记录
          <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 'normal', color: 'var(--hint-color)' }}>
            {ontrain ? '训练买卖点 · 与详情页共用' : '手工交易记录'}
          </span>
        </div>
        {tradeRecords.length ? (
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {tradeRecords.map((r) => (
              <div
                key={r.key}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 6,
                  fontSize: 11,
                  lineHeight: 2,
                  borderBottom: '1px dashed var(--border-color)',
                }}
              >
                <span style={{ width: 108, flex: '0 0 auto', color: 'var(--secondary-text-color)' }}>
                  {r.date}
                  {r.time ? ` ${String(r.time).substring(0, 5)}` : ''}
                </span>
                <span
                  style={{
                    flex: '0 0 auto',
                    fontWeight: 600,
                    color:
                      r.type === 'review'
                        ? '#1677ff'
                        : r.type === 'buy'
                        ? 'var(--increase-color, #d32f2f)'
                        : 'var(--reduce-color, #388e3c)',
                  }}
                >
                  {r.type === 'review' ? '复盘' : r.pending ? '买入(待成交)' : r.type === 'buy' ? '买入' : '卖出'}
                </span>
                <span style={{ flex: '0 0 auto' }}>{r.price > 0 ? r.price.toFixed(2) : '—'}</span>
                <span style={{ flex: '0 0 auto', color: 'var(--secondary-text-color)' }}>{r.detail}</span>
                <span
                  style={{
                    flex: '1 1 auto',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: 'var(--secondary-text-color)',
                  }}
                  title={r.reason}
                >
                  {r.reason || '—'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--hint-color)' }}>暂无操作记录</div>
        )}
      </div>
      <div style={{ height: 30 }}>
      </div>
    </div>
  );
};

export default ScoreStockTrade;
