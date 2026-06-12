import { Stock } from '@/types/stock';
import * as Services from '@/services';
import * as Tech from '@/helpers/tech';

export interface BreakoutMetrics {
    preVol: number;
    postVol: number;
    expansionRatio: number;
    breakoutDate: string;
    breakoutIndex: number;
}

export interface TradeSignal {
    type: 'buy' | 'sell' | 'hold';
    reason: string;
}

function calculateVolatility(klines: Stock.KLineItem[]): number {
    if (klines.length < 5) return 0;
    const returns: number[] = [];
    for (let i = 1; i < klines.length; i++) {
        returns.push(Math.log(klines[i].sp / klines[i - 1].sp));
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
    return Math.sqrt(variance) * Math.sqrt(252);
}

export function calculateBreakoutMetrics(
    klines: Stock.KLineItem[],
    tradeDay: string
): BreakoutMetrics | null {
    const tradeIndex = klines.findIndex(k => k.date === tradeDay);
    if (tradeIndex < 0) return null;

    const preStart = Math.max(0, tradeIndex - 120);
    const preKlines = klines.slice(preStart, tradeIndex);
    const preVol = preKlines.length >= 5 ? calculateVolatility(preKlines) : 0.2;

    const postEnd = Math.min(klines.length, tradeIndex + 20);
    const postKlines = klines.slice(tradeIndex, postEnd);

    let postVol: number;
    if (postKlines.length >= 5) {
        postVol = calculateVolatility(postKlines);
    } else if (postKlines.length >= 1) {
        const day = postKlines[0];
        const dailyRange = (day.zg - day.zd) / day.kp;
        postVol = dailyRange * Math.sqrt(252);
    } else {
        postVol = preVol * 1.5;
    }

    return {
        preVol,
        postVol,
        expansionRatio: preVol > 0 ? postVol / preVol : 1,
        breakoutDate: tradeDay,
        breakoutIndex: tradeIndex
    };
}

export function hardFilter(
    stock: Stock.DetailItem,
    klines: Stock.KLineItem[]
): { pass: boolean; reason?: string } {
    if (klines.length < 2) return { pass: false, reason: 'K线不足' };

    const currentPrice = klines[klines.length - 1].sp;
    const prevPrice = klines[klines.length - 2].sp;
    const changePct = (currentPrice - prevPrice) / prevPrice;

    if (changePct < 0.01) {
        return { pass: false, reason: `涨幅不足(${(changePct * 100).toFixed(2)}% < 1%)` };
    }

    if (klines.length >= 5) {
        const avgAmount5d = klines.slice(-5).reduce((sum, k) => sum + (k.cje || 0), 0) / 5;
        if (avgAmount5d < 30_000_000) {
            return { pass: false, reason: `成交额不足(${(avgAmount5d / 1e6).toFixed(0)}M < 30M)` };
        }
    }

    if (currentPrice < 3) {
        return { pass: false, reason: `股价太低(${currentPrice.toFixed(2)} < 3)` };
    }

    const marketCap = (stock as Stock.DetailItem).lt;
    if (marketCap !== undefined && (marketCap < 10 || marketCap > 3000)) {
        return { pass: false, reason: `市值不符(${marketCap}亿, 需10-3000亿)` };
    }

    let consecutiveUp = 0;
    for (let i = klines.length - 1; i > 0; i--) {
        if (klines[i].sp > klines[i - 1].sp) consecutiveUp++;
        else break;
        if (consecutiveUp >= 6) break;
    }
    if (consecutiveUp >= 6) {
        return { pass: false, reason: `连板过多(${consecutiveUp}连板)` };
    }

    return { pass: true };
}

/**
 * 多指标共振趋势阶段判断
 */
export function getTrendStage(klines: Stock.KLineItem[]): 'start' | 'middle' | 'end' | 'consolidation' | 'downtrend' {
    if (klines.length < 20) return 'consolidation';

    const currentPrice = klines[klines.length - 1].sp;
    const closes = klines.map(k => k.sp);

    // 均线
    const ma5 = Tech.calculateMA(closes, 5);
    const ma20 = Tech.calculateMA(closes, 20);
    const currentMA5 = ma5[ma5.length - 1];
    const currentMA20 = ma20[ma20.length - 1];

    // 必要条件：价格在MA20上方
    if (currentPrice < currentMA20 * 0.98) return 'downtrend';

    // 均线发散度
    const maSpread = (currentMA5 - currentMA20) / currentMA20 * 100;

    // 量比
    const todayVol = klines[klines.length - 1].cjl;
    const avgVol5 = klines.slice(-5).reduce((s, k) => s + k.cjl, 0) / 5;
    const volumeRatio = avgVol5 > 0 ? todayVol / avgVol5 : 1;

    // 布林带宽度（20日标准差/MA20）
    const recent20 = closes.slice(-20);
    const mean20 = recent20.reduce((a, b) => a + b, 0) / 20;
    const variance20 = recent20.reduce((sum, p) => sum + Math.pow(p - mean20, 2), 0) / 20;
    const std20 = Math.sqrt(variance20);
    const bandwidth = std20 / currentMA20;

    // 距离前高（20日）
    const recentHigh20 = Math.max(...klines.slice(-20).map(k => k.zg));
    const recentLow20 = Math.min(...klines.slice(-20).map(k => k.zd));
    const range = recentHigh20 - recentLow20;
    const distanceToHigh = range > 0 ? (recentHigh20 - currentPrice) / range : 0;

    // 通道位置（基于ATR）
    const atr = klines.slice(-14).reduce((sum, k, i, arr) => {
        if (i === 0) return 0;
        return sum + Math.abs(k.sp - arr[i-1].sp);
    }, 0) / 14;
    const upperAtr = currentMA20 + 2 * atr;
    const lowerAtr = currentMA20 - 2 * atr;
    const channelPosition = (upperAtr - lowerAtr) > 0 ? (currentPrice - lowerAtr) / (upperAtr - lowerAtr) : 0.5;

    // 趋势开始：4个条件满足3个
    const startConditions = [
        maSpread > 0 && maSpread < 3,
        volumeRatio > 1.5,
        bandwidth < 0.08 || bandwidth > 0.15,
        distanceToHigh < 0.15
    ];
    if (startConditions.filter(Boolean).length >= 3) return 'start';

    // 趋势中段：4个条件满足3个
    const middleConditions = [
        maSpread > 2 && maSpread < 8,
        volumeRatio > 1.0 && volumeRatio < 2.5,
        bandwidth > 0.08 && bandwidth < 0.25,
        distanceToHigh < 0.30
    ];
    if (middleConditions.filter(Boolean).length >= 3) return 'middle';

    // 趋势末尾：3个条件满足2个
    const endConditions = [
        maSpread > 6,
        volumeRatio < 0.8 && currentPrice > currentMA20 * 1.05,
        channelPosition > 0.85 || distanceToHigh < 0.05
    ];
    if (endConditions.filter(Boolean).length >= 2) return 'end';

    return 'consolidation';
}

/**
 * 多因子评分系统 —— 量价+趋势阶段驱动
 */
export function calculateScore(
    stockKlines: Stock.KLineItem[],
    metrics: BreakoutMetrics,
    marketCap?: number
): { score: number; stage: string; volumeRatio: number; maSpread: number; distanceToHigh: number } {
    let score = 0;
    const closes = stockKlines.map(k => k.sp);
    const currentPrice = closes[closes.length - 1];
    const ma5 = Tech.calculateMA(closes, 5);
    const ma10 = Tech.calculateMA(closes, 10);
    const ma20 = Tech.calculateMA(closes, 20);
    const currentMA5 = ma5[ma5.length - 1];
    const currentMA10 = ma10[ma10.length - 1];
    const currentMA20 = ma20[ma20.length - 1];

    // 1. 突破强度 (30分)
    const recentHigh60 = Math.max(...stockKlines.slice(-60).map(k => k.zg));
    const highBreakPct = (currentPrice - recentHigh60) / recentHigh60;
    let sBreakout = 0;
    if (highBreakPct > 0.05) sBreakout = 30;
    else if (highBreakPct > 0.02) sBreakout = 20;
    else if (currentPrice >= recentHigh60) sBreakout = 12;
    else sBreakout = 5;
    score += sBreakout;

    // 2. 量比/量能 (25分)
    const todayVol = stockKlines[stockKlines.length - 1].cjl;
    const avgVol5 = stockKlines.slice(-5).reduce((s, k) => s + k.cjl, 0) / 5;
    const volumeRatio = avgVol5 > 0 ? todayVol / avgVol5 : 1;
    let sVolume = 0;
    if (volumeRatio > 3.0) sVolume = 25;
    else if (volumeRatio > 2.0) sVolume = 20;
    else if (volumeRatio > 1.5) sVolume = 15;
    else if (volumeRatio > 1.0) sVolume = 8;
    score += sVolume;

    // 3. 趋势阶段 (25分)
    const stage = getTrendStage(stockKlines);
    let sStage = 0;
    if (stage === 'start') sStage = 25;
    else if (stage === 'middle') sStage = 18;
    else if (stage === 'end') sStage = 5;
    else if (stage === 'consolidation') sStage = 10;
    score += sStage;

    // 4. 均线趋势 (15分)
    let sMA = 0;
    if (currentPrice > currentMA5 && currentMA5 > currentMA10 && currentMA10 > currentMA20) sMA = 15;
    else if (currentPrice > currentMA5 && currentMA5 > currentMA20) sMA = 10;
    else if (currentPrice > currentMA20) sMA = 5;
    score += sMA;

    // 5. 成交持续性 (5分)
    let sContinuity = 0;
    if (stockKlines.length >= 10) {
        const recentAmounts = stockKlines.slice(-5).map(k => k.cje || 0);
        const prevAmounts = stockKlines.slice(-10, -5).map(k => k.cje || 0);
        const avgAmount = recentAmounts.reduce((a, b) => a + b, 0) / 5;
        const prevAvgAmount = prevAmounts.length > 0
            ? prevAmounts.reduce((a, b) => a + b, 0) / prevAmounts.length
            : avgAmount;
        if (avgAmount > 100_000_000) sContinuity = 3;
        if (prevAvgAmount > 0 && avgAmount > prevAvgAmount * 1.2) sContinuity += 2;
    }
    score += sContinuity;

    // 6. 市值微调 (±5分)
    if (marketCap !== undefined) {
        if (marketCap >= 50 && marketCap <= 300) score += 3;
        else if (marketCap > 300 && marketCap <= 1000) score += 1;
    }

    // 均线发散度和距离前高用于日志
    const maSpread = (currentMA5 - currentMA20) / currentMA20 * 100;
    const recentHigh20 = Math.max(...stockKlines.slice(-20).map(k => k.zg));
    const recentLow20 = Math.min(...stockKlines.slice(-20).map(k => k.zd));
    const range = recentHigh20 - recentLow20;
    const distanceToHigh = range > 0 ? (recentHigh20 - currentPrice) / range : 0;

    console.log(`[Backtest][Score] 评分拆解: 突破=${sBreakout}/30 量比=${sVolume}/25 阶段=${sStage}/25(${stage}) 均线=${sMA}/15 持续=${sContinuity}/5 总分=${score}`);

    return { score, stage, volumeRatio, maSpread, distanceToHigh };
}

export interface Position {
    secid: string;
    boardCode: string;
    buyDate: string;
    buyPrice: number;
    quantity: number;
    buyAmount: number;
    highestPrice: number;
}

export interface WatchItem {
    secid: string;
    addedDate: string;
    score: number;
    boardCode: string;
    maxRSI: number;
    maxPrice: number;
}

export interface PendingOrder {
    secid: string;
    type: 'buy' | 'sell';
    reason: string;
    signalDate: string;
}

export interface TradeRecord {
    date: string;
    secid: string;
    type: 'buy' | 'sell';
    price: number;
    quantity: number;
    amount: number;
    reason: string;
    pnl?: number;
}

export interface DailyValue {
    date: string;
    totalValue: number;
}

export interface BacktestResult {
    totalReturn: number;
    annualizedReturn: number;
    maxDrawdown: number;
    winRate: number;
    profitFactor: number;
    sharpeRatio: number;
    totalTrades: number;
    avgHoldingDays: number;
    trades: TradeRecord[];
    dailyValues: DailyValue[];
}

export interface DataProvider {
    getStrongStocks(date: string): Promise<Stock.DetailItem[]>;
    getKLines(secids: string[], endDate: string, days?: number): Promise<Stock.KLineItem[]>;
    getBoardData(name: string, endDate: string): Promise<Stock.BoardItem | null>;
}

export class StrongStockBacktest {
    private initialCapital: number;
    private capital: number;
    private availableCash: number;
    private positions: Map<string, Position> = new Map();
    private watchList: Map<string, WatchItem> = new Map();
    private pendingOrders: PendingOrder[] = [];
    private tradeRecords: TradeRecord[] = [];
    private dailyValues: DailyValue[] = [];
    private tradeDays: string[];
    private cancelOptions?: { onShouldCancel?: () => boolean; onShouldPause?: () => boolean };

    private readonly MAX_POSITIONS = 8;
    private readonly POSITION_RATIO = 0.125;
    private readonly MAX_SAME_BOARD = 2;
    private readonly MIN_POSITION_RATIO = 0.05;
    private readonly STOP_LOSS_PCT = 0.93;
    private readonly TRAILING_STOP_PCT = 0.90;
    private readonly MIN_SCORE = 60;
    private readonly MAX_WATCHLIST = 20;
    private readonly WATCHLIST_SCORE_DECAY = 2;
    private readonly WATCHLIST_MAX_AGE = 8;
    private readonly SLIPPAGE = 0.001;
    private readonly COMMISSION = 0.0003;
    private readonly STAMP_TAX = 0.001;
    private readonly RSI_PERIOD = 6;
    private readonly RSI_LOOKBACK = 5;
    private readonly BATCH_SIZE = 10;

    constructor(tradeDays: string[], initialCapital: number = 1000000) {
        this.tradeDays = tradeDays.map(d => this.normalizeDate(d));
        this.initialCapital = initialCapital;
        this.capital = initialCapital;
        this.availableCash = initialCapital;
        console.log(`[Backtest] 初始化完成 | 初始资金: ${initialCapital.toLocaleString()} | 交易日数: ${tradeDays.length}`);
    }

    public async run(
        dataProvider: DataProvider,
        onProgress?: (message: string, percent?: number) => void,
        options?: { onShouldCancel?: () => boolean; onShouldPause?: () => boolean }
    ): Promise<BacktestResult> {
        this.cancelOptions = options;
        const totalDays = this.tradeDays.length;
        const dayPercentStep = totalDays > 0 ? 90 / totalDays : 0;

        console.log(`[Backtest] ====== 回测开始 ======`);
        console.log(`[Backtest] 参数配置:`, {
            MAX_POSITIONS: this.MAX_POSITIONS,
            POSITION_RATIO: this.POSITION_RATIO,
            MAX_SAME_BOARD: this.MAX_SAME_BOARD,
            MIN_POSITION_RATIO: this.MIN_POSITION_RATIO,
            STOP_LOSS_PCT: this.STOP_LOSS_PCT,
            TRAILING_STOP_PCT: this.TRAILING_STOP_PCT,
            MIN_SCORE: this.MIN_SCORE,
            MAX_WATCHLIST: this.MAX_WATCHLIST,
            WATCHLIST_SCORE_DECAY: this.WATCHLIST_SCORE_DECAY,
            WATCHLIST_MAX_AGE: this.WATCHLIST_MAX_AGE,
            SLIPPAGE: this.SLIPPAGE,
            COMMISSION: this.COMMISSION,
            STAMP_TAX: this.STAMP_TAX,
            RSI_PERIOD: this.RSI_PERIOD,
            RSI_LOOKBACK: this.RSI_LOOKBACK,
            BATCH_SIZE: this.BATCH_SIZE
        });

        for (let i = 0; i < totalDays; i++) {
            if (this.isCancelled()) {
                console.log(`[Backtest] 回测在第 ${i + 1}/${totalDays} 天被取消`);
                onProgress?.('回测已取消', 100);
                return this.calculateResult();
            }
            const cancelledDuringPause = await this.waitIfPaused();
            if (cancelledDuringPause) {
                console.log(`[Backtest] 回测在暂停期间被取消`);
                onProgress?.('回测已取消', 100);
                return this.calculateResult();
            }

            const today = this.tradeDays[i];
            const currentBase = Math.round(i * dayPercentStep);

            console.log(`\n[Backtest] ---------- 第 ${i + 1}/${totalDays} 天 [${today}] ----------`);
            console.log(`[Backtest] 当前持仓: ${this.positions.size} 只 | 观察列表: ${this.watchList.size} 只 | 可用资金: ${this.availableCash.toFixed(2)}`);

            onProgress?.(`[${i + 1}/${totalDays}] ${today} 执行待处理订单...`, currentBase);
            console.log(`[Backtest] [${today}] 阶段1: 执行待处理订单 ${this.pendingOrders.length} 笔`);
            if (await this.executePendingOrders(today, dataProvider)) {
                onProgress?.('回测已取消', 100);
                return this.calculateResult();
            }

            if (i < totalDays - 1) {
                const nextDay = this.tradeDays[i + 1];
                onProgress?.(`[${i + 1}/${totalDays}] ${today} 生成交易信号...`, Math.round(currentBase + dayPercentStep * 0.3));
                console.log(`[Backtest] [${today}] 阶段2: 生成交易信号 (次日执行: ${nextDay})`);
                if (await this.generateSignals(today, nextDay, dataProvider, (msg) => {
                    onProgress?.(msg, Math.round(currentBase + dayPercentStep * 0.6));
                })) {
                    onProgress?.('回测已取消', 100);
                    return this.calculateResult();
                }
            }

            onProgress?.(`[${i + 1}/${totalDays}] ${today} 记录净值...`, Math.round(currentBase + dayPercentStep * 0.8));
            console.log(`[Backtest] [${today}] 阶段3: 记录净值`);
            if (await this.recordDailyValue(today, dataProvider)) {
                onProgress?.('回测已取消', 100);
                return this.calculateResult();
            }

            console.log(`[Backtest] [${today}] 日终状态: 持仓 ${this.positions.size} 只 | 观察 ${this.watchList.size} 只 | 净值 ${this.dailyValues[this.dailyValues.length - 1]?.totalValue.toFixed(2)}`);
        }

        onProgress?.('正在计算回测结果...', 95);
        console.log(`\n[Backtest] ====== 计算最终结果 ======`);
        const result = this.calculateResult();
        onProgress?.('回测完成！', 100);
        console.log(`[Backtest] ====== 回测结束 ======\n`);
        return result;
    }

    private async executePendingOrders(today: string, dataProvider: DataProvider): Promise<boolean> {
        if (this.pendingOrders.length === 0) {
            console.log(`[Backtest] [${today}] 无待执行订单`);
            return false;
        }

        for (const order of this.pendingOrders) {
            if (this.isCancelled()) return true;
            await this.waitIfPaused();
            if (this.isCancelled()) return true;

            const klines = await dataProvider.getKLines(order.secid, today, 1);
            if (!klines || klines.length === 0) {
                console.log(`[Backtest] [${today}] 订单执行失败: ${order.secid} 未获取到K线数据`);
                continue;
            }

            const todayKLine = klines.find(k => k.date === today);
            if (!todayKLine) {
                console.log(`[Backtest] [${today}] 订单执行失败: ${order.secid} 未找到当日K线 (可用日期: ${klines.map(k => k.date).join(',')})`);
                continue;
            }

            const openPrice = todayKLine.kp;

            if (order.type === 'buy') {
                console.log(`[Backtest] [${today}] 执行买入: ${order.secid} | 开盘价: ${openPrice.toFixed(2)} | 原因: ${order.reason}`);
                this.executeBuy(order.secid, today, openPrice, order.reason);
            } else if (order.type === 'sell') {
                const position = this.positions.get(order.secid);
                if (position) {
                    console.log(`[Backtest] [${today}] 执行卖出: ${order.secid} | 开盘价: ${openPrice.toFixed(2)} | 持仓成本: ${position.buyPrice.toFixed(2)} | 原因: ${order.reason}`);
                    this.executeSell(order.secid, today, openPrice, position.quantity, order.reason);
                } else {
                    console.log(`[Backtest] [${today}] 卖出订单忽略: ${order.secid} 无持仓`);
                }
            }
        }
        this.pendingOrders = [];
        return false;
    }

    private async generateSignals(
        today: string,
        nextDay: string,
        dataProvider: DataProvider,
        onProgress?: (message: string) => void
    ): Promise<boolean> {
        console.log(`[Backtest] [${today}] 阶段2-1: 处理观察列表 ${this.watchList.size} 只`);
        onProgress?.(`[${today}] 处理观察列表 ${this.watchList.size} 只...`);

        const buyCandidates: Array<{
            secid: string;
            score: number;
            boardCode: string;
            price: number;
            reason: string;
        }> = [];

        for (const [secid, watchInfo] of this.watchList) {
            if (this.isCancelled()) return true;
            await this.waitIfPaused();
            if (this.isCancelled()) return true;

            const klines = await dataProvider.getKLines(secid, today, 60);
            if (!klines || klines.length < 20) {
                console.log(`[Backtest] [${today}] ${secid} 观察处理跳过: K线不足(${klines?.length || 0})`);
                continue;
            }

            const position = this.positions.get(secid);
            const currentPrice = klines[klines.length - 1].sp;

            if (position && currentPrice > position.highestPrice) {
                const oldHigh = position.highestPrice;
                position.highestPrice = currentPrice;
                console.log(`[Backtest] [${today}] ${secid} 更新最高价: ${oldHigh.toFixed(2)} → ${currentPrice.toFixed(2)}`);
            }

            const rsiValues = Tech.calculateRSI(klines.map(k => k.sp), this.RSI_PERIOD);
            const currentRSI = rsiValues[rsiValues.length - 1];
            const closes = klines.map(k => k.sp);
            const ma20 = Tech.calculateMA(closes, 20);
            const currentMA20 = ma20[ma20.length - 1];

            if (currentRSI > watchInfo.maxRSI) watchInfo.maxRSI = currentRSI;
            if (currentPrice > watchInfo.maxPrice) watchInfo.maxPrice = currentPrice;
            if (watchInfo.maxRSI <= 0) {
                watchInfo.maxRSI = currentRSI;
                console.log(`[Backtest] [${today}] ${secid} maxRSI从0修复为${currentRSI.toFixed(1)}`);
            }

            // 止损/止盈
            if (position) {
                const stopLossPrice = position.buyPrice * this.STOP_LOSS_PCT;
                const trailingStopPrice = position.highestPrice * this.TRAILING_STOP_PCT;

                if (currentPrice < stopLossPrice) {
                    console.log(`[Backtest] [${today}] ${secid} 🔴 固定止损触发: 当前${currentPrice.toFixed(2)} < 止损价${stopLossPrice.toFixed(2)}`);
                    this.pendingOrders.push({
                        secid: secid,
                        type: 'sell',
                        reason: `固定止损(${currentPrice.toFixed(2)} < ${stopLossPrice.toFixed(2)})`,
                        signalDate: today
                    });
                    continue;
                }

                if (currentPrice > position.buyPrice && currentPrice < trailingStopPrice) {
                    console.log(`[Backtest] [${today}] ${secid} 🟡 移动止盈触发: 当前${currentPrice.toFixed(2)} < 止盈价${trailingStopPrice.toFixed(2)}`);
                    this.pendingOrders.push({
                        secid: secid,
                        type: 'sell',
                        reason: `移动止盈(从最高${position.highestPrice.toFixed(2)}回撤至${currentPrice.toFixed(2)})`,
                        signalDate: today
                    });
                    continue;
                }
            }

            // 未持仓股票的动态移除
            const daysInWatch = this.getTradeDaysDiff(watchInfo.addedDate, today);
            if (!position) {
                const stage = getTrendStage(klines);
                const todayVol = klines[klines.length - 1].cjl;
                const avgVol5 = klines.slice(-5).reduce((s, k) => s + k.cjl, 0) / 5;
                const volumeRatio = avgVol5 > 0 ? todayVol / avgVol5 : 1;
                const decayedScore = watchInfo.score - daysInWatch * this.WATCHLIST_SCORE_DECAY;

                if (currentPrice < currentMA20) {
                    console.log(`[Backtest] [${today}] ${secid} 从观察列表移除: 跌破MA20`);
                    this.watchList.delete(secid);
                    continue;
                }

                if (stage === 'end' && volumeRatio < 1.0) {
                    console.log(`[Backtest] [${today}] ${secid} 从观察列表移除: 趋势末尾+量能萎缩`);
                    this.watchList.delete(secid);
                    continue;
                }

                if (volumeRatio < 0.6) {
                    console.log(`[Backtest] [${today}] ${secid} 从观察列表移除: 量比过低(${volumeRatio.toFixed(2)})`);
                    this.watchList.delete(secid);
                    continue;
                }

                if (decayedScore < 50) {
                    console.log(`[Backtest] [${today}] ${secid} 从观察列表移除: 评分衰减至${decayedScore.toFixed(1)}`);
                    this.watchList.delete(secid);
                    continue;
                }

                if (daysInWatch > this.WATCHLIST_MAX_AGE) {
                    console.log(`[Backtest] [${today}] ${secid} 从观察列表移除: 超期${daysInWatch}天未触发`);
                    this.watchList.delete(secid);
                    continue;
                }
            }

            const stage = getTrendStage(klines);
            const todayVol = klines[klines.length - 1].cjl;
            const avgVol5 = klines.slice(-5).reduce((s, k) => s + k.cjl, 0) / 5;
            const volumeRatio = avgVol5 > 0 ? todayVol / avgVol5 : 1;
            const prevRSI = rsiValues[rsiValues.length - 2];
            
            // 量价驱动买入判断
            if (!position) {
                let hasBuySignal = false;
                let buyReason = '';

                // 信号1：趋势刚启动 + 放量（最佳）
                if (stage === 'start' && volumeRatio > 1.5 && currentPrice > currentMA20) {
                    hasBuySignal = true;
                    buyReason = `趋势启动(阶段=${stage}, 量比=${volumeRatio.toFixed(1)}, RSI=${currentRSI.toFixed(1)})`;
                }
                // 信号2：趋势中段 + 量比持续
                else if (stage === 'middle' && volumeRatio > 1.2 && currentPrice > currentMA20 && currentRSI > 50) {
                    hasBuySignal = true;
                    buyReason = `趋势延续(阶段=${stage}, 量比=${volumeRatio.toFixed(1)}, RSI=${currentRSI.toFixed(1)})`;
                }
                // 信号3：强势整理后再次放量（RSI从弱势区回升）
                else if (volumeRatio > 1.8 && prevRSI < 50 && currentRSI >= 50 && currentPrice > currentMA20) {
                    hasBuySignal = true;
                    buyReason = `强势整理(量比=${volumeRatio.toFixed(1)}, RSI=${prevRSI.toFixed(1)}→${currentRSI.toFixed(1)})`;
                }

                if (hasBuySignal) {
                    console.log(`[Backtest] [${today}] ${secid} ✅ 买入信号触发: ${buyReason}`);
                    buyCandidates.push({
                        secid,
                        score: watchInfo.score - daysInWatch * this.WATCHLIST_SCORE_DECAY,
                        boardCode: watchInfo.boardCode,
                        price: currentPrice,
                        reason: buyReason
                    });
                }
            }

            // 持仓卖出：趋势末尾或量能萎缩
            if (position) {
                const stage = getTrendStage(klines);
                const todayVol = klines[klines.length - 1].cjl;
                const avgVol5 = klines.slice(-5).reduce((s, k) => s + k.cjl, 0) / 5;
                const volumeRatio = avgVol5 > 0 ? todayVol / avgVol5 : 1;

                if (stage === 'end') {
                    console.log(`[Backtest] [${today}] ${secid} ✅ 趋势末尾卖出`);
                    this.pendingOrders.push({
                        secid: secid,
                        type: 'sell',
                        reason: `趋势末尾(阶段=${stage})`,
                        signalDate: today
                    });
                }
                else if (volumeRatio < 0.8 && currentPrice < position.highestPrice * 0.95) {
                    console.log(`[Backtest] [${today}] ${secid} ✅ 量能萎缩卖出(量比=${volumeRatio.toFixed(1)})`);
                    this.pendingOrders.push({
                        secid: secid,
                        type: 'sell',
                        reason: `量能萎缩(量比=${volumeRatio.toFixed(1)})`,
                        signalDate: today
                    });
                }
                // 原有RSI卖出信号保留
                else {
                    const recentPrices = klines.slice(-5);
                    const priceHigh = Math.max(...recentPrices.map(k => k.zg));
                    const rsiHigh = Math.max(...rsiValues.slice(-5));
                    if (currentPrice >= priceHigh * 0.98 && currentRSI < rsiHigh * 0.95) {
                        this.pendingOrders.push({
                            secid: secid,
                            type: 'sell',
                            reason: 'RSI顶背离',
                            signalDate: today
                        });
                    }
                    else if (prevRSI >= 60 && currentRSI < 60) {
                        this.pendingOrders.push({
                            secid: secid,
                            type: 'sell',
                            reason: `RSI跌破60(${currentRSI.toFixed(1)})`,
                            signalDate: today
                        });
                    }
                }
            }
        }

        // 按优先级选择买入候选
        if (buyCandidates.length > 0) {
            buyCandidates.sort((a, b) => b.score - a.score);
            console.log(`[Backtest] [${today}] 买入候选共 ${buyCandidates.length} 只，排序前5:`, buyCandidates.slice(0, 5).map(c => `${c.secid}(${c.score.toFixed(1)})`));

            const boardHoldings = new Map<string, number>();
            for (const pos of this.positions.values()) {
                boardHoldings.set(pos.boardCode, (boardHoldings.get(pos.boardCode) || 0) + 1);
            }

            for (const candidate of buyCandidates) {
                if (this.positions.size >= this.MAX_POSITIONS) {
                    console.log(`[Backtest] [${today}] 买入停止: 已达最大持仓数 ${this.MAX_POSITIONS}`);
                    break;
                }

                const boardCount = boardHoldings.get(candidate.boardCode) || 0;
                if (boardCount >= this.MAX_SAME_BOARD) {
                    console.log(`[Backtest] [${today}] ${candidate.secid} 买入跳过: 板块${candidate.boardCode}已有${boardCount}只持仓`);
                    continue;
                }

                const standardAmount = this.capital * this.POSITION_RATIO;
                const maxBuyAmount = Math.min(standardAmount, this.availableCash);
                const adjustedPrice = candidate.price * (1 + this.SLIPPAGE);
                const quantity = Math.floor(maxBuyAmount / adjustedPrice / 100) * 100;
                const actualAmount = adjustedPrice * quantity;

                if (actualAmount < this.capital * this.MIN_POSITION_RATIO || quantity < 100) {
                    console.log(`[Backtest] [${today}] ${candidate.secid} 买入跳过: 资金不足或低于最小仓位`);
                    break;
                }

                this.pendingOrders.push({
                    secid: candidate.secid,
                    type: 'buy',
                    reason: candidate.reason,
                    signalDate: today
                });
                boardHoldings.set(candidate.boardCode, boardCount + 1);
                console.log(`[Backtest] [${today}] ${candidate.secid} ✅ 生成买入订单 (次日${nextDay}执行) | 评分${candidate.score.toFixed(1)} | 板块${candidate.boardCode}`);
            }
        } else {
            console.log(`[Backtest] [${today}] 无买入候选触发`);
        }

        // ---- 阶段2: 补充观察列表（动态排行榜）----
        console.log(`[Backtest] [${today}] 阶段2-2: 获取强势股票并动态更新观察列表`);
        onProgress?.(`[${today}] 获取强势股票...`);
        const strongStocks = await dataProvider.getStrongStocks(today);
        console.log(`[Backtest] [${today}] 东财强势股票共 ${strongStocks.length} 只`);

        onProgress?.(`[${today}] 硬过滤+评分中...`);
        const newCandidates: Array<{
            secid: string;
            score: number;
            rawScore: number;
            matchScore: number;
            expansionRatio: number;
            boardCode: string;
            initialRSI: number;
            initialPrice: number;
            stage: string;
            volumeRatio: number;
        }> = [];

        let hardFilterPass = 0;
        let hardFilterFail = 0;
        let scoreDistribution: number[] = [];

        const filteredStocks = strongStocks.filter(s => !this.watchList.has(s.secid) && !this.positions.has(s.secid));
        console.log(`[Backtest] [${today}] 排除已监控/已持仓后剩余 ${filteredStocks.length} 只`);

        for (let batchStart = 0; batchStart < filteredStocks.length; batchStart += this.BATCH_SIZE) {
            if (this.isCancelled()) return true;
            await this.waitIfPaused();
            if (this.isCancelled()) return true;

            const batch = filteredStocks.slice(batchStart, batchStart + this.BATCH_SIZE);
            onProgress?.(`[${today}] 评分中 ${Math.min(batchStart + this.BATCH_SIZE, filteredStocks.length)}/${filteredStocks.length}...`);

            const batchResults = await Promise.allSettled(
                batch.map(async (stock) => {
                    const klines = await dataProvider.getKLines(stock.secid, today, 120);
                    if (!klines || klines.length < 60) {
                        return { pass: false, reason: 'K线不足', stage: 'klines' };
                    }

                    const filterResult = hardFilter(stock, klines);
                    if (!filterResult.pass) {
                        return { pass: false, reason: filterResult.reason, stage: 'hardFilter' };
                    }

                    const metrics = calculateBreakoutMetrics(klines, today);
                    if (!metrics || metrics.expansionRatio < 1.2) {
                        return { pass: false, reason: `波动率不达标(${metrics?.expansionRatio.toFixed(2) || 'N/A'})`, stage: 'expansion' };
                    }

                    const marketCap = (stock as Stock.DetailItem).lt;
                    const scoreResult = calculateScore(klines, metrics, marketCap);

                    const recentKlines = klines.slice(-60);
                    const rsiValues = Tech.calculateRSI(recentKlines.map(k => k.sp), this.RSI_PERIOD);
                    const matchScore = this.backtestRSIOnHistory(recentKlines, rsiValues);
                    const finalScore = scoreResult.score * 0.7 + matchScore * 0.3;

                    const initialRSI = (rsiValues[rsiValues.length - 1] && rsiValues[rsiValues.length - 1] > 0) ? rsiValues[rsiValues.length - 1] : 50;
                    const initialPrice = klines[klines.length - 1].sp;

                    return {
                        pass: true,
                        secid: stock.secid,
                        score: finalScore,
                        rawScore: scoreResult.score,
                        matchScore,
                        expansionRatio: metrics.expansionRatio,
                        boardCode: stock.bk,
                        initialRSI,
                        initialPrice,
                        stage: scoreResult.stage,
                        volumeRatio: scoreResult.volumeRatio
                    };
                })
            );

            for (const result of batchResults) {
                if (result.status === 'fulfilled') {
                    const value = result.value as any;
                    if (value.pass) {
                        hardFilterPass++;
                        scoreDistribution.push(value.rawScore);
                        if (value.score >= this.MIN_SCORE) {
                            newCandidates.push({
                                secid: value.secid,
                                score: value.score,
                                rawScore: value.rawScore,
                                matchScore: value.matchScore,
                                expansionRatio: value.expansionRatio,
                                boardCode: value.boardCode,
                                initialRSI: value.initialRSI,
                                initialPrice: value.initialPrice,
                                stage: value.stage,
                                volumeRatio: value.volumeRatio
                            });
                        }
                    } else {
                        if (value.stage === 'hardFilter' || value.stage === 'expansion') hardFilterFail++;
                    }
                }
            }
        }

        console.log(`[Backtest] [${today}] ====== 每日统计 ======`);
        console.log(`[Backtest] [${today}] 硬过滤: 通过=${hardFilterPass}, 失败=${hardFilterFail}`);
        if (scoreDistribution.length > 0) {
            const avgScore = scoreDistribution.reduce((a, b) => a + b, 0) / scoreDistribution.length;
            const maxScore = Math.max(...scoreDistribution);
            const minScore = Math.min(...scoreDistribution);
            console.log(`[Backtest] [${today}] 评分分布: 平均=${avgScore.toFixed(1)}, 最高=${maxScore.toFixed(1)}, 最低=${minScore.toFixed(1)}`);
        }
        console.log(`[Backtest] [${today}] 评分门槛(${this.MIN_SCORE}): 通过=${newCandidates.length}`);
        // 打印阶段分布
        const stageCounts: Record<string, number> = {};
        for (const c of newCandidates) {
            stageCounts[c.stage] = (stageCounts[c.stage] || 0) + 1;
        }
        console.log(`[Backtest] [${today}] 阶段分布:`, stageCounts);
        console.log(`[Backtest] [${today}] ====== 统计结束 ======`);

        // 动态排行榜
        const combined: Array<{
            secid: string;
            score: number;
            boardCode: string;
            source: 'existing' | 'new';
            initialRSI?: number;
            initialPrice?: number;
        }> = [];

        for (const [secid, item] of this.watchList) {
            if (!this.positions.has(secid)) {
                const daysInWatch = this.getTradeDaysDiff(item.addedDate, today);
                const decayedScore = item.score - daysInWatch * this.WATCHLIST_SCORE_DECAY;
                combined.push({
                    secid,
                    score: decayedScore,
                    boardCode: item.boardCode,
                    source: 'existing'
                });
            }
        }

        for (const c of newCandidates) {
            combined.push({
                secid: c.secid,
                score: c.score,
                boardCode: c.boardCode,
                source: 'new',
                initialRSI: c.initialRSI,
                initialPrice: c.initialPrice
            });
        }

        combined.sort((a, b) => b.score - a.score);
        const topN = combined.slice(0, this.MAX_WATCHLIST);

        const newWatchList = new Map<string, WatchItem>();

        for (const [secid, item] of this.watchList) {
            if (this.positions.has(secid)) {
                newWatchList.set(secid, item);
            }
        }

        let addCount = 0;
        for (const c of topN) {
            if (c.source === 'new') {
                newWatchList.set(c.secid, {
                    secid: c.secid,
                    addedDate: today,
                    score: c.score,
                    boardCode: c.boardCode,
                    maxRSI: (c.initialRSI && c.initialRSI > 0) ? c.initialRSI : 50,
                    maxPrice: c.initialPrice || 0
                });
                addCount++;
                if (addCount <= 5 || c.score > 80) {
                    console.log(`[Backtest] [${today}] ${c.secid} 新加入观察列表 | 评分: ${c.score.toFixed(1)} | 板块: ${c.boardCode}`);
                }
            } else {
                const oldItem = this.watchList.get(c.secid)!;
                newWatchList.set(c.secid, oldItem);
            }
        }

        let removedCount = 0;
        for (const [secid, item] of this.watchList) {
            if (!this.positions.has(secid) && !newWatchList.has(secid)) {
                removedCount++;
            }
        }

        this.watchList = newWatchList;
        console.log(`[Backtest] [${today}] 观察列表动态更新: 新增 ${addCount} 只, 淘汰 ${removedCount} 只, 当前共 ${this.watchList.size} 只 (含持仓)`);
        return false;
    }

    private executeBuy(secid: string, date: string, price: number, reason: string) {
        const adjustedPrice = price * (1 + this.SLIPPAGE);
        const standardAmount = this.capital * this.POSITION_RATIO;
        const maxBuyAmount = Math.min(standardAmount, this.availableCash);
        const quantity = Math.floor(maxBuyAmount / adjustedPrice / 100) * 100;
        const actualAmount = adjustedPrice * quantity;

        if (actualAmount < this.capital * this.MIN_POSITION_RATIO || quantity < 100) {
            console.log(`[Backtest] [${date}] ${secid} 买入失败: 低于最小仓位或数量不足`);
            return;
        }

        const commission = actualAmount * this.COMMISSION;
        const totalCost = actualAmount + commission;

        if (this.availableCash < totalCost) {
            console.log(`[Backtest] [${date}] ${secid} 买入失败: 资金不足`);
            return;
        }

        this.availableCash -= totalCost;

        const watchItem = this.watchList.get(secid);
        const boardCode = watchItem?.boardCode || '';

        this.positions.set(secid, {
            secid: secid,
            boardCode: boardCode,
            buyDate: date,
            buyPrice: adjustedPrice,
            quantity,
            buyAmount: totalCost,
            highestPrice: adjustedPrice
        });

        console.log(`[Backtest] [${date}] ${secid} 买入成功: 价${adjustedPrice.toFixed(2)} | 量${quantity} | 总成本${totalCost.toFixed(2)} | 剩余资金${this.availableCash.toFixed(2)}`);

        this.tradeRecords.push({
            date,
            secid: secid,
            type: 'buy',
            price: adjustedPrice,
            quantity,
            amount: totalCost,
            reason
        });
    }

    private executeSell(secid: string, date: string, price: number, quantity: number, reason: string) {
        const position = this.positions.get(secid);
        if (!position) {
            console.log(`[Backtest] [${date}] ${secid} 卖出失败: 无持仓`);
            return;
        }

        const adjustedPrice = price * (1 - this.SLIPPAGE);
        const totalAmount = adjustedPrice * quantity;
        const commission = totalAmount * this.COMMISSION;
        const stampTax = totalAmount * this.STAMP_TAX;
        const netAmount = totalAmount - commission - stampTax;

        this.availableCash += netAmount;
        const pnl = netAmount - position.buyAmount;

        console.log(`[Backtest] [${date}] ${secid} 卖出成功: 价${adjustedPrice.toFixed(2)} | 量${quantity} | 净额${netAmount.toFixed(2)} | 盈亏${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} | 剩余资金${this.availableCash.toFixed(2)}`);

        this.tradeRecords.push({
            date,
            secid: secid,
            type: 'sell',
            price: adjustedPrice,
            quantity,
            amount: netAmount,
            reason,
            pnl
        });

        this.positions.delete(secid);
        this.watchList.delete(secid);
        console.log(`[Backtest] [${date}] ${secid} 已从持仓和观察列表移除`);
    }

    private async recordDailyValue(date: string, dataProvider: DataProvider): Promise<boolean> {
        let stockValue = 0;
        let positionDetails: Array<{ secid: string; close: number; quantity: number; value: number }> = [];

        for (const [secid, pos] of this.positions) {
            if (this.isCancelled()) return true;
            await this.waitIfPaused();
            if (this.isCancelled()) return true;

            const klines = await dataProvider.getKLines(secid, date, 1);
            if (klines && klines.length > 0) {
                const close = klines[klines.length - 1].sp;
                const value = close * pos.quantity;
                stockValue += value;
                positionDetails.push({ secid, close, quantity: pos.quantity, value });
            } else {
                stockValue += pos.buyAmount;
                positionDetails.push({ secid, close: pos.buyPrice, quantity: pos.quantity, value: pos.buyAmount });
            }
        }

        const totalValue = this.availableCash + stockValue;
        this.dailyValues.push({
            date,
            totalValue
        });

        if (positionDetails.length > 0) {
            console.log(`[Backtest] [${date}] 净值明细: 现金${this.availableCash.toFixed(2)} + 股票市值${stockValue.toFixed(2)} = 总净值${totalValue.toFixed(2)}`);
            console.table(positionDetails);
        } else {
            console.log(`[Backtest] [${date}] 净值: ${totalValue.toFixed(2)} (空仓)`);
        }
        return false;
    }

    private calculateResult(): BacktestResult {
        const finalValue = this.dailyValues[this.dailyValues.length - 1]?.totalValue || this.initialCapital;
        const totalReturn = (finalValue - this.initialCapital) / this.initialCapital;
        const days = this.dailyValues.length;
        const annualizedReturn = days > 0 ? Math.pow(1 + totalReturn, 252 / days) - 1 : 0;

        let maxDrawdown = 0;
        let peak = this.initialCapital;
        let peakDate = this.dailyValues[0]?.date || '';
        let troughDate = this.dailyValues[0]?.date || '';

        for (const dv of this.dailyValues) {
            if (dv.totalValue > peak) {
                peak = dv.totalValue;
                peakDate = dv.date;
            }
            const dd = (peak - dv.totalValue) / peak;
            if (dd > maxDrawdown) {
                maxDrawdown = dd;
                troughDate = dv.date;
            }
        }

        const sellTrades = this.tradeRecords.filter(t => t.type === 'sell');
        const winTrades = sellTrades.filter(t => (t.pnl || 0) > 0);
        const winRate = sellTrades.length > 0 ? winTrades.length / sellTrades.length : 0;

        const totalProfit = winTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        const lossTrades = sellTrades.filter(t => (t.pnl || 0) <= 0);
        const totalLoss = lossTrades.reduce((sum, t) => sum + Math.abs(t.pnl || 0), 0);
        const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : (totalProfit > 0 ? Infinity : 0);

        const returns: number[] = [];
        for (let i = 1; i < this.dailyValues.length; i++) {
            returns.push((this.dailyValues[i].totalValue - this.dailyValues[i - 1].totalValue) / this.dailyValues[i - 1].totalValue);
        }
        const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
        const stdReturn = returns.length > 0
            ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length)
            : 0;
        const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

        const holdingDays: number[] = [];
        for (const sell of sellTrades) {
            const buy = this.tradeRecords.find(
                t => t.secid === sell.secid && t.type === 'buy' && t.date <= sell.date
            );
            if (buy) {
                holdingDays.push(this.getTradeDaysDiff(buy.date, sell.date));
            }
        }
        const avgHoldingDays = holdingDays.length > 0
            ? holdingDays.reduce((a, b) => a + b, 0) / holdingDays.length
            : 0;

        const result: BacktestResult = {
            totalReturn,
            annualizedReturn,
            maxDrawdown,
            winRate,
            profitFactor,
            sharpeRatio,
            totalTrades: sellTrades.length,
            avgHoldingDays,
            trades: this.tradeRecords,
            dailyValues: this.dailyValues
        };

        console.log(`[Backtest] 结果指标:`, {
            初始资金: this.initialCapital,
            最终资金: finalValue.toFixed(2),
            总收益率: (totalReturn * 100).toFixed(2) + '%',
            年化收益率: (annualizedReturn * 100).toFixed(2) + '%',
            最大回撤: (maxDrawdown * 100).toFixed(2) + '%',
            回撤区间: `${peakDate} → ${troughDate}`,
            胜率: (winRate * 100).toFixed(2) + '%',
            盈亏比: profitFactor.toFixed(2),
            夏普比率: sharpeRatio.toFixed(2),
            总交易次数: sellTrades.length,
            平均持仓天数: avgHoldingDays.toFixed(1)
        });

        console.log(`[Backtest] 买卖记录汇总:`);
        console.table(this.tradeRecords.map(t => ({
            日期: t.date,
            股票: t.secid,
            方向: t.type,
            价格: t.price.toFixed(2),
            数量: t.quantity,
            金额: t.amount.toFixed(2),
            盈亏: t.pnl !== undefined ? (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(2) : '-',
            原因: t.reason
        })));

        return result;
    }

    private backtestRSIOnHistory(klines: Stock.KLineItem[], rsiValues: number[]): number {
        if (klines.length < 25) return 50;

        let signals = 0;
        let wins = 0;

        for (let i = 20; i < klines.length - 5; i++) {
            const subKlines = klines.slice(0, i + 1);
            const subRSI = rsiValues.slice(0, i + 1);
            const signal = this.getTrendRSISignalForHistory(subKlines, subRSI, this.RSI_LOOKBACK);

            if (signal.type === 'buy') {
                signals++;
                const entryPrice = klines[i].sp;
                const futurePrices = klines.slice(i + 1, Math.min(i + 6, klines.length));
                if (futurePrices.length === 0) continue;

                const maxPrice = Math.max(...futurePrices.map(k => k.zg));
                if (maxPrice > entryPrice * 1.03) wins++;
            }
        }

        return signals > 0 ? (wins / signals) * 100 : 50;
    }

    private getTrendRSISignalForHistory(
        klines: Stock.KLineItem[],
        rsiValues: number[],
        lookback: number = 5
    ): TradeSignal {
        if (rsiValues.length < lookback + 2 || klines.length < 20) {
            return { type: 'hold', reason: '数据不足' };
        }

        const currentRSI = rsiValues[rsiValues.length - 1];
        const prevRSI = rsiValues[rsiValues.length - 2];
        const recentRSIs = rsiValues.slice(-lookback);
        const minRecentRSI = Math.min(...recentRSIs);
        const currentPrice = klines[klines.length - 1].sp;
        const closes = klines.map(k => k.sp);
        const ma20 = Tech.calculateMA(closes, 20);
        const currentMA20 = ma20[ma20.length - 1];

        const condition1 = prevRSI < 60 && currentRSI >= 60;
        const condition2 = minRecentRSI < 50;
        const recent10RSIs = rsiValues.slice(-10);
        const hasBeenStrong = Math.max(...recent10RSIs) > 65;
        const condition4 = currentPrice > currentMA20;

        if (condition1 && condition2 && hasBeenStrong && condition4) {
            return { type: 'buy', reason: 'RSI二次启动' };
        }

        const recentPrices = klines.slice(-lookback);
        const priceHigh = Math.max(...recentPrices.map(k => k.zg));
        const rsiHigh = Math.max(...recentRSIs);

        if (currentPrice >= priceHigh * 0.98 && currentRSI < rsiHigh * 0.95) {
            return { type: 'sell', reason: 'RSI顶背离' };
        }

        if (prevRSI >= 60 && currentRSI < 60) {
            return { type: 'sell', reason: `RSI跌破60` };
        }

        return { type: 'hold', reason: '无信号' };
    }

    private getTradeDaysDiff(date1: string, date2: string): number {
        const idx1 = this.tradeDays.indexOf(date1);
        const idx2 = this.tradeDays.indexOf(date2);
        if (idx1 < 0 || idx2 < 0) return 0;
        return Math.abs(idx2 - idx1);
    }

    private normalizeDate(date: string): string {
        if (date.length === 8 && date.includes('-') === false) {
            return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
        }
        return date;
    }

    private isCancelled(): boolean {
        return this.cancelOptions?.onShouldCancel?.() ?? false;
    }

    private async waitIfPaused(): Promise<boolean> {
        while (this.cancelOptions?.onShouldPause?.()) {
            await new Promise(resolve => setTimeout(resolve, 500));
            if (this.isCancelled()) {
                return true;
            }
        }
        return false;
    }
}