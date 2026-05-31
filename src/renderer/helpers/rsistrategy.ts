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

/**
 * 计算年化波动率（对数收益率）
 */
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

/**
 * 计算分段波动率（突破前 vs 突破后）
 */
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

/**
 * 硬过滤条件（一票否决，不进入评分）
 * 针对东财每日返回上百只强势股票的优化
 */
export function hardFilter(
    stock: Stock.DetailItem,
    klines: Stock.KLineItem[]
): { pass: boolean; reason?: string } {
    if (klines.length < 2) return { pass: false, reason: 'K线不足' };

    const currentPrice = klines[klines.length - 1].sp;
    const prevPrice = klines[klines.length - 2].sp;
    const changePct = (currentPrice - prevPrice) / prevPrice;

    // 1. 涨幅不足：必须>=5%才算真正突破
    if (changePct < 0.05) {
        return { pass: false, reason: `涨幅不足(${(changePct * 100).toFixed(2)}% < 5%)` };
    }

    // 2. 成交额不足：5日均成交额<5000万剔除
    if (klines.length >= 5) {
        const avgAmount5d = klines.slice(-5).reduce((sum, k) => sum + k.cjl, 0) / 5;
        if (avgAmount5d < 50_000_000) {
            return { pass: false, reason: `成交额不足(${(avgAmount5d / 1e6).toFixed(0)}M < 50M)` };
        }
    }

    // 3. 股价太低：低于5元容易操纵，且1手金额太小
    if (currentPrice < 5) {
        return { pass: false, reason: `股价太低(${currentPrice.toFixed(2)} < 5)` };
    }

    // 4. 流通市值太小或太大
    const marketCap = (stock as Stock.DetailItem).lt;
    if (marketCap !== undefined && (marketCap < 20 || marketCap > 2000)) {
        return { pass: false, reason: `市值不符(${marketCap}亿, 需20-2000亿)` };
    }

    // 5. 已经连板太多（5连板以上风险极高）
    let consecutiveUp = 0;
    for (let i = klines.length - 1; i > 0; i--) {
        if (klines[i].sp > klines[i - 1].sp) consecutiveUp++;
        else break;
        if (consecutiveUp >= 5) break;
    }
    if (consecutiveUp >= 5) {
        return { pass: false, reason: `连板过多(${consecutiveUp}连板)` };
    }

    return { pass: true };
}

/**
 * 趋势型RSI信号 —— 统一为"二次启动"策略
 */
export function getTrendRSISignal(
    klines: Stock.KLineItem[],
    rsiValues: number[],
    lookback: number = 5,
    peakRSI?: number
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

    // 买入信号1：强势回调二次启动
    const condition1 = prevRSI < 60 && currentRSI >= 60;
    const condition2 = minRecentRSI < 50;
    const recent10RSIs = rsiValues.slice(-10);
    const hasBeenStrong = peakRSI !== undefined ? peakRSI > 65 : Math.max(...recent10RSIs) > 65;
    const condition4 = currentPrice > currentMA20;

    // ====== 调试日志：RSI信号条件 ======
    const shouldLog = condition1 || condition2 || hasBeenStrong || condition4 || (prevRSI >= 60 && currentRSI < 60);
    if (shouldLog) {
        console.log(`[Backtest][RSISignal] conditions: c1=${condition1}(prevRSI=${prevRSI.toFixed(1)}, currRSI=${currentRSI.toFixed(1)}), c2=${condition2}(minRecent=${minRecentRSI.toFixed(1)}), hasBeenStrong=${hasBeenStrong}(peakRSI=${(peakRSI || 0).toFixed(1)}), c4=${condition4}(price=${currentPrice.toFixed(2)}, MA20=${currentMA20?.toFixed(2)})`);
    }

    if (condition1 && condition2 && hasBeenStrong && condition4) {
        return {
            type: 'buy',
            reason: `RSI二次启动(${prevRSI.toFixed(1)}→${currentRSI.toFixed(1)},峰值${(peakRSI || Math.max(...recent10RSIs)).toFixed(1)})`
        };
    }

    // 买入信号2：温和启动
    const condition1b = prevRSI < 55 && currentRSI >= 55 && currentRSI < 65;
    const condition2b = minRecentRSI < 45;
    const condition3b = currentPrice > currentMA20 * 1.02;
    const volumes = klines.slice(-6).map(k => k.cjl);
    const avgVol5 = volumes.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const condition4b = volumes[volumes.length - 1] > avgVol5 * 1.1;

    if (condition1b && condition2b && condition3b && condition4b) {
        if (shouldLog) console.log(`[Backtest][RSISignal] => BUY 温和启动`);
        return {
            type: 'buy',
            reason: `RSI温和启动(${prevRSI.toFixed(1)}→${currentRSI.toFixed(1)})`
        };
    }

    // 卖出条件
    const recentPrices = klines.slice(-lookback);
    const priceHigh = Math.max(...recentPrices.map(k => k.zg));
    const rsiHigh = Math.max(...recentRSIs);

    if (currentPrice >= priceHigh * 0.98 && currentRSI < rsiHigh * 0.95) {
        if (shouldLog) console.log(`[Backtest][RSISignal] => SELL 顶背离 priceHigh=${priceHigh.toFixed(2)} rsiHigh=${rsiHigh.toFixed(1)}`);
        return { type: 'sell', reason: 'RSI顶背离' };
    }

    if (prevRSI >= 60 && currentRSI < 60) {
        if (shouldLog) console.log(`[Backtest][RSISignal] => SELL 跌破60`);
        return { type: 'sell', reason: `RSI跌破60(${currentRSI.toFixed(1)})` };
    }

    return { type: 'hold', reason: '无信号' };
}

/**
 * 多因子评分系统（针对强势股）
 * 优化：提高突破质量权重到35分，总分100，拉开差距
 */
export function calculateScore(
    stockKlines: Stock.KLineItem[],
    boardData: Stock.BoardItem | null,
    metrics: BreakoutMetrics,
    marketCap?: number
): number {
    let score = 0;
    const scoreBreakdown: Record<string, { condition: string; awarded: number; max: number }> = {};
    const closes = stockKlines.map(k => k.sp);
    const ma20 = Tech.calculateMA(closes, 20);
    const currentPrice = closes[closes.length - 1];
    const currentMA20 = ma20[ma20.length - 1];
    const prevMA20 = ma20[ma20.length - 2];

    // 1. 突破质量 (35分) —— 核心权重最高
    let sBreakout = 0;
    if (metrics.expansionRatio > 3.0) sBreakout = 35;
    else if (metrics.expansionRatio > 2.0) sBreakout = 25;
    else if (metrics.expansionRatio > 1.5) sBreakout = 15;
    else sBreakout = 5;
    score += sBreakout;
    scoreBreakdown['突破质量'] = { condition: `expansionRatio=${metrics.expansionRatio.toFixed(2)}`, awarded: sBreakout, max: 35 };

    // 2. 板块协同 (25分) —— 放宽到前50%
    if (boardData) {
        const moneyIn = boardData.moneyIn || 0;
        const rank = boardData.moneyInRankInAll ?? 1;
        let sBoard = 0;

        // 资金方向 (10分)
        if (boardData.moneyIn5d > 0) sBoard += 10;

        // 资金强度 (10分) —— 分档
        if (moneyIn > 50_000_000) sBoard += 10;
        else if (moneyIn > 10_000_000) sBoard += 7;
        else if (moneyIn > 0) sBoard += 3;

        // 板块排名 (5分) —— 前50%都有分
        if (rank <= 0.05) sBoard += 5;
        else if (rank <= 0.15) sBoard += 3;
        else if (rank <= 0.30) sBoard += 2;
        else if (rank <= 0.50) sBoard += 1;

        score += sBoard;
        scoreBreakdown['板块协同'] = {
            condition: `moneyIn5d=${boardData.moneyIn5d}, moneyIn=${moneyIn}, rank=${rank.toFixed(4)}`,
            awarded: sBoard,
            max: 25
        };
    } else {
        score += 12;
        scoreBreakdown['板块协同'] = { condition: '无板块数据', awarded: 12, max: 25 };
    }

    // 3. 趋势质量 (20分)
    let sTrend = 0;
    if (currentPrice > currentMA20 && currentMA20 > prevMA20) sTrend += 12;
    if (currentPrice > currentMA20 * 1.05) sTrend += 8;
    score += sTrend;
    scoreBreakdown['趋势质量'] = {
        condition: `price=${currentPrice.toFixed(2)}, MA20=${currentMA20?.toFixed(2)}, prevMA20=${prevMA20?.toFixed(2)}`,
        awarded: sTrend,
        max: 20
    };

    // 4. 成交持续性 (15分)
    let sVolume = 0;
    if (stockKlines.length >= 10) {
        const recentAmounts = stockKlines.slice(-5).map(k => k.cjl);
        const prevAmounts = stockKlines.slice(-10, -5).map(k => k.cjl);
        const avgAmount = recentAmounts.reduce((a, b) => a + b, 0) / 5;
        const prevAvgAmount = prevAmounts.length > 0
            ? prevAmounts.reduce((a, b) => a + b, 0) / prevAmounts.length
            : avgAmount;

        if (avgAmount > 100_000_000) sVolume += 8;
        if (prevAvgAmount > 0 && avgAmount > prevAvgAmount * 1.2) sVolume += 7;
        scoreBreakdown['成交持续性'] = {
            condition: `avgAmount=${avgAmount.toFixed(0)}, prevAvgAmount=${prevAvgAmount.toFixed(0)}`,
            awarded: sVolume,
            max: 15
        };
    } else {
        scoreBreakdown['成交持续性'] = { condition: 'K线不足10天', awarded: 0, max: 15 };
    }
    score += sVolume;

    // 5. 流通市值 (5分)
    let sCap = 0;
    if (marketCap !== undefined) {
        if (marketCap >= 50 && marketCap <= 300) sCap = 5;
        else if (marketCap > 300 && marketCap <= 1000) sCap = 3;
        else if (marketCap < 50) sCap = 1;
        scoreBreakdown['流通市值'] = { condition: `marketCap=${marketCap}亿`, awarded: sCap, max: 5 };
        score += sCap;
    } else {
        scoreBreakdown['流通市值'] = { condition: '无市值数据', awarded: 0, max: 5 };
    }

    // ====== 调试日志：评分拆解 ======
    console.log(`[Backtest][Score] 评分拆解 (总分=${score}):`);
    console.table(scoreBreakdown);

    return score;
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
    getKLines(secid: string, endDate: string, days?: number): Promise<Stock.KLineItem[] | null>;
    getBoardData(secid: string, endDate: string): Promise<Stock.BoardItem | null>;
}

// ==================== 回测主类 ====================

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

    // 参数配置 —— 针对上百只候选的优化
    private readonly MAX_POSITIONS = 8;
    private readonly POSITION_RATIO = 0.125;
    private readonly MAX_SAME_BOARD = 2;
    private readonly MIN_POSITION_RATIO = 0.05;
    private readonly STOP_LOSS_PCT = 0.93;
    private readonly TRAILING_STOP_PCT = 0.90;
    private readonly MIN_SCORE = 75;          // 从60提高到75
    private readonly MAX_WATCHLIST = 20;      // 从10提高到20
    private readonly WATCHLIST_SCORE_DECAY = 2; // 每天衰减2分
    private readonly WATCHLIST_MAX_AGE = 15;    // 从5天延长到15天
    private readonly SLIPPAGE = 0.001;
    private readonly COMMISSION = 0.0003;
    private readonly STAMP_TAX = 0.001;
    private readonly RSI_PERIOD = 6;
    private readonly RSI_LOOKBACK = 5;
    private readonly BATCH_SIZE = 10;         // 并行评分批次大小

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
            // 检查取消
            if (this.isCancelled()) {
                console.log(`[Backtest] 回测在第 ${i + 1}/${totalDays} 天被取消`);
                onProgress?.('回测已取消', 100);
                return this.calculateResult();
            }
            // 检查暂停
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

    /**
     * 执行待执行订单（次日开盘价成交）
     * @returns true 表示被取消
     */
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

            // ====== 调试日志：订单执行K线数据 ======
            console.log(`[Backtest] [${today}] ${order.secid} 订单执行K线:`, klines.map(k => ({
                date: k.date, kp: k.kp, sp: k.sp, zg: k.zg, zd: k.zd, cjl: k.cjl, cje: k.cje
            })));

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

    /**
     * 基于当日数据生成信号和订单
     * @returns true 表示被取消
     */
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

            // 更新持仓最高价
            if (position && currentPrice > position.highestPrice) {
                const oldHigh = position.highestPrice;
                position.highestPrice = currentPrice;
                console.log(`[Backtest] [${today}] ${secid} 更新最高价: ${oldHigh.toFixed(2)} → ${currentPrice.toFixed(2)}`);
            }

            // 计算RSI
            const rsiValues = Tech.calculateRSI(klines.map(k => k.sp), this.RSI_PERIOD);
            const currentRSI = rsiValues[rsiValues.length - 1];

            // ====== 调试日志：观察列表RSI数据 ======
            console.log(`[Backtest] [${today}] ${secid} 观察列表RSI: currentRSI=${currentRSI.toFixed(2)}, prevRSI=${rsiValues[rsiValues.length-2]?.toFixed(2)}, minRecentRSI=${Math.min(...rsiValues.slice(-this.RSI_LOOKBACK)).toFixed(2)}, 最新价=${currentPrice.toFixed(2)}`);

            // 更新观察期峰值
            if (currentRSI > watchInfo.maxRSI) {
                watchInfo.maxRSI = currentRSI;
            }
            if (currentPrice > watchInfo.maxPrice) {
                watchInfo.maxPrice = currentPrice;
            }

            // 止损判断
            if (position) {
                const stopLossPrice = position.buyPrice * this.STOP_LOSS_PCT;
                const trailingStopPrice = position.highestPrice * this.TRAILING_STOP_PCT;

                if (currentPrice < stopLossPrice) {
                    console.log(`[Backtest] [${today}] ${secid} 🔴 固定止损触发: 当前${currentPrice.toFixed(2)} < 止损价${stopLossPrice.toFixed(2)} (成本${position.buyPrice.toFixed(2)})`);
                    this.pendingOrders.push({
                        secid: secid,
                        type: 'sell',
                        reason: `固定止损(${currentPrice.toFixed(2)} < ${stopLossPrice.toFixed(2)})`,
                        signalDate: today
                    });
                    continue;
                }

                if (currentPrice > position.buyPrice && currentPrice < trailingStopPrice) {
                    console.log(`[Backtest] [${today}] ${secid} 🟡 移动止盈触发: 当前${currentPrice.toFixed(2)} < 止盈价${trailingStopPrice.toFixed(2)} (最高${position.highestPrice.toFixed(2)})`);
                    this.pendingOrders.push({
                        secid: secid,
                        type: 'sell',
                        reason: `移动止盈(从最高${position.highestPrice.toFixed(2)}回撤至${currentPrice.toFixed(2)})`,
                        signalDate: today
                    });
                    continue;
                }
            }

            // 未持仓股票的动态移除检查
            if (!position) {
                const daysInWatch = this.getTradeDaysDiff(watchInfo.addedDate, today);
                const closes = klines.map(k => k.sp);
                const ma20 = Tech.calculateMA(closes, 20);
                const currentMA20 = ma20[ma20.length - 1];
                const recent3RSI = rsiValues.slice(-3);
                const decayedScore = watchInfo.score - daysInWatch * this.WATCHLIST_SCORE_DECAY;

                // 优先级1: RSI回调过深
                if (currentRSI < 35) {
                    console.log(`[Backtest] [${today}] ${secid} 从观察列表移除: RSI回调过深(${currentRSI.toFixed(1)} < 35)`);
                    this.watchList.delete(secid);
                    continue;
                }

                // 优先级2: 跌破MA20
                if (currentPrice < currentMA20) {
                    console.log(`[Backtest] [${today}] ${secid} 从观察列表移除: 跌破MA20(${currentPrice.toFixed(2)} < ${currentMA20.toFixed(2)})`);
                    this.watchList.delete(secid);
                    continue;
                }

                // 优先级3: RSI连续3天<<40
                if (recent3RSI.length >= 3 && recent3RSI.every(r => r < 40)) {
                    console.log(`[Backtest] [${today}] ${secid} 从观察列表移除: RSI连续3天<<40`);
                    this.watchList.delete(secid);
                    continue;
                }

                // 优先级4: 评分衰减至<<50
                if (decayedScore < 50) {
                    console.log(`[Backtest] [${today}] ${secid} 从观察列表移除: 评分衰减至${decayedScore.toFixed(1)}`);
                    this.watchList.delete(secid);
                    continue;
                }

                // 兜底: 超期15天
                if (daysInWatch > this.WATCHLIST_MAX_AGE) {
                    console.log(`[Backtest] [${today}] ${secid} 从观察列表移除: 超期${daysInWatch}天未触发`);
                    this.watchList.delete(secid);
                    continue;
                }
            }

            // RSI趋势信号判断
            const signal = getTrendRSISignal(klines, rsiValues, this.RSI_LOOKBACK, watchInfo.maxRSI);

            if (signal.type !== 'hold') {
                console.log(`[Backtest] [${today}] ${secid} RSI信号: ${signal.type.toUpperCase()} | ${signal.reason} | 观察期峰值RSI=${watchInfo.maxRSI.toFixed(1)}`);
            }

            if (signal.type === 'sell' && position) {
                console.log(`[Backtest] [${today}] ${secid} ✅ 生成卖出订单 (次日${nextDay}执行)`);
                this.pendingOrders.push({
                    secid: secid,
                    type: 'sell',
                    reason: signal.reason,
                    signalDate: today
                });
            }

            if (signal.type === 'buy' && !position) {
                buyCandidates.push({
                    secid,
                    score: watchInfo.score - this.getTradeDaysDiff(watchInfo.addedDate, today) * this.WATCHLIST_SCORE_DECAY,
                    boardCode: watchInfo.boardCode,
                    price: currentPrice,
                    reason: signal.reason
                });
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
                    console.log(`[Backtest] [${today}] ${candidate.secid} 买入跳过: 资金不足或低于最小仓位 (计划金额${actualAmount.toFixed(2)}, 可用${this.availableCash.toFixed(2)}, 最小要求${(this.capital * this.MIN_POSITION_RATIO).toFixed(2)})`);
                    break;
                }

                this.pendingOrders.push({
                    secid: candidate.secid,
                    type: 'buy',
                    reason: candidate.reason,
                    signalDate: today
                });
                boardHoldings.set(candidate.boardCode, boardCount + 1);
                console.log(`[Backtest] [${today}] ${candidate.secid} ✅ 生成买入订单 (次日${nextDay}执行) | 衰减后评分${candidate.score.toFixed(1)} | 板块${candidate.boardCode}`);
            }
        }

        // ---- 阶段2: 补充观察列表（动态排行榜机制）----
        console.log(`[Backtest] [${today}] 阶段2-2: 获取强势股票并动态更新观察列表`);
        onProgress?.(`[${today}] 获取强势股票...`);
        const strongStocks = await dataProvider.getStrongStocks(today);
        console.log(`[Backtest] [${today}] 东财强势股票共 ${strongStocks.length} 只`);

        // 并行评分处理（批次控制）
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
        }> = [];

        // 先过滤掉已在观察列表或已持仓的
        const filteredStocks = strongStocks.filter(s => !this.watchList.has(s.secid) && !this.positions.has(s.secid));
        console.log(`[Backtest] [${today}] 排除已监控/已持仓后剩余 ${filteredStocks.length} 只`);

        // 批次并行处理
        for (let batchStart = 0; batchStart < filteredStocks.length; batchStart += this.BATCH_SIZE) {
            if (this.isCancelled()) return true;
            await this.waitIfPaused();
            if (this.isCancelled()) return true;

            const batch = filteredStocks.slice(batchStart, batchStart + this.BATCH_SIZE);
            onProgress?.(`[${today}] 评分中 ${Math.min(batchStart + this.BATCH_SIZE, filteredStocks.length)}/${filteredStocks.length}...`);

            const batchResults = await Promise.allSettled(
                batch.map(async (stock) => {
                    const klines = await dataProvider.getKLines(stock.secid, today, 120);
                    const boardData = await dataProvider.getBoardData(stock.bk, today);

                    // ====== 调试日志：K线和板块原始数据 ======
                    console.log(`[Backtest] [${today}] ${stock.secid}(${stock.name || ''}) 原始数据:`);
                    if (klines && klines.length > 0) {
                        console.log(`  K线: 长度=${klines.length}, 范围=${klines[0].date}~${klines[klines.length-1].date}, 最新收盘=${klines[klines.length-1].sp}, 最高=${klines[klines.length-1].zg}, 最低=${klines[klines.length-1].zd}, 成交量=${klines[klines.length-1].cjl}`);
                    } else {
                        console.log(`  K线: 空`);
                    }
                    if (boardData) {
                        console.log(`  板块[${stock.bk}]: name=${boardData.name}, zx=${boardData.zx}, zdf=${boardData.zdf}, moneyIn=${boardData.moneyIn}, moneyIn5d=${boardData.moneyIn5d}, moneyIn10d=${boardData.moneyIn10d}, moneyInRankInAll=${boardData.moneyInRankInAll}, cje=${boardData.cje}, cjl=${boardData.cjl}`);
                    } else {
                        console.log(`  板块[${stock.bk}]: null`);
                    }

                    if (!klines || klines.length < 60) {
                        return { pass: false, reason: 'K线不足' };
                    }

                    // 硬过滤
                    const filterResult = hardFilter(stock, klines);
                    if (!filterResult.pass) {
                        return { pass: false, reason: filterResult.reason };
                    }

                    // 分段波动率
                    const metrics = calculateBreakoutMetrics(klines, today);
                    if (!metrics || metrics.expansionRatio < 1.5) {
                        return { pass: false, reason: `波动率不达标(${metrics?.expansionRatio.toFixed(2) || 'N/A'})` };
                    }

                    // 综合评分
                    const marketCap = (stock as Stock.DetailItem).lt;
                    const score = calculateScore(klines, boardData, metrics, marketCap);
                    if (score < this.MIN_SCORE) {
                        return { pass: false, reason: `评分不足(${score.toFixed(1)} < ${this.MIN_SCORE})` };
                    }

                    // RSI匹配度
                    const recentKlines = klines.slice(-60);
                    const rsiValues = Tech.calculateRSI(recentKlines.map(k => k.sp), this.RSI_PERIOD);
                    const matchScore = this.backtestRSIOnHistory(recentKlines, rsiValues);
                    const finalScore = score * 0.7 + matchScore * 0.3;

                    // 初始RSI和价格用于观察列表峰值追踪
                    const initialRSI = rsiValues[rsiValues.length - 1] || 50;
                    const initialPrice = klines[klines.length - 1].sp;

                    return {
                        pass: true,
                        secid: stock.secid,
                        score: finalScore,
                        rawScore: score,
                        matchScore,
                        expansionRatio: metrics.expansionRatio,
                        boardCode: stock.bk,
                        initialRSI,
                        initialPrice
                    };
                })
            );

            for (const result of batchResults) {
                if (result.status === 'fulfilled') {
                    const value = result.value as any;
                    if (value.pass) {
                        newCandidates.push({
                            secid: value.secid,
                            score: value.score,
                            rawScore: value.rawScore,
                            matchScore: value.matchScore,
                            expansionRatio: value.expansionRatio,
                            boardCode: value.boardCode,
                            initialRSI: value.initialRSI,
                            initialPrice: value.initialPrice
                        });
                    } else if (value.reason && batchStart < 30) {
                        // 只打印前几个过滤原因，避免日志爆炸
                        // console.log(`[Backtest] [${today}] 过滤: ${value.reason}`);
                    }
                }
            }
        }

        console.log(`[Backtest] [${today}] 硬过滤后剩余 ${newCandidates.length} 只进入候选池`);

        // 动态排行榜：现有未持仓观察列表 + 新候选一起竞争
        const combined: Array<{
            secid: string;
            score: number;
            boardCode: string;
            source: 'existing' | 'new';
            initialRSI?: number;
            initialPrice?: number;
        }> = [];

        // 现有未持仓的观察列表（评分衰减后）
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

        // 新候选
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

        // 按评分降序，取前20名
        combined.sort((a, b) => b.score - a.score);
        const topN = combined.slice(0, this.MAX_WATCHLIST);

        // 重建观察列表（保留已持仓的，因为它们不在combined中）
        const newWatchList = new Map<string, WatchItem>();

        // 先保留已持仓的（不参与竞争，但保留监控）
        for (const [secid, item] of this.watchList) {
            if (this.positions.has(secid)) {
                newWatchList.set(secid, item);
            }
        }

        // 再加入竞争胜出的
        let addCount = 0;
        for (const c of topN) {
            if (c.source === 'new') {
                newWatchList.set(c.secid, {
                    secid: c.secid,
                    addedDate: today,
                    score: c.score,
                    boardCode: c.boardCode,
                    maxRSI: c.initialRSI || 50,
                    maxPrice: c.initialPrice || 0
                });
                addCount++;
                if (addCount <= 5 || c.score > 80) {
                    console.log(`[Backtest] [${today}] ${c.secid} 新加入观察列表 | 评分: ${c.score.toFixed(1)} | 板块: ${c.boardCode}`);
                }
            } else {
                // 保留老的
                const oldItem = this.watchList.get(c.secid)!;
                newWatchList.set(c.secid, oldItem);
            }
        }

        // 统计被踢出的
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
            console.log(`[Backtest] [${date}] ${secid} 买入失败: 低于最小仓位或数量不足 (计划金额${actualAmount.toFixed(2)}, 最小要求${(this.capital * this.MIN_POSITION_RATIO).toFixed(2)}, 可用${this.availableCash.toFixed(2)})`);
            return;
        }

        const commission = actualAmount * this.COMMISSION;
        const totalCost = actualAmount + commission;

        if (this.availableCash < totalCost) {
            console.log(`[Backtest] [${date}] ${secid} 买入失败: 资金不足 (需${totalCost.toFixed(2)}, 余${this.availableCash.toFixed(2)})`);
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

    /**
     * 记录每日净值
     * @returns true 表示被取消
     */
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
                // ====== 调试日志：净值计算K线数据 ======
                console.log(`[Backtest] [${date}] ${secid} 净值K线: date=${klines[0]?.date}, close=${close}, kp=${klines[0]?.kp}, zg=${klines[0]?.zg}, zd=${klines[0]?.zd}`);
            } else {
                console.log(`[Backtest] [${date}] ${secid} 净值计算: 未获取到收盘价 (klines=${klines?.length || 0})，按成本价估算`);
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
            const signal = getTrendRSISignal(subKlines, subRSI, this.RSI_LOOKBACK);

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

    /**
     * 检查是否被取消
     */
    private isCancelled(): boolean {
        return this.cancelOptions?.onShouldCancel?.() ?? false;
    }

    /**
     * 如果被暂停则等待，同时检查是否被取消
     * @returns true 表示在暂停期间被取消
     */
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
