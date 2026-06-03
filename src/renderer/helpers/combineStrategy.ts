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

    const marketCap = (stock as Stock.DetailItem).lt / 100_000_000;
    if (marketCap !== undefined && (marketCap < 10 || marketCap > 3000)) {
        return { pass: false, reason: `市值不符(${marketCap}亿, 需10-3000亿)` };
    }

    return { pass: true };
}

/**
 * 趋势型RSI信号 —— 保留用于历史匹配度计算
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

    const condition1 = prevRSI < 60 && currentRSI >= 60;
    const condition2 = minRecentRSI < 50;
    const recent10RSIs = rsiValues.slice(-10);
    const effectivePeakRSI = (peakRSI && peakRSI > 0) ? peakRSI : Math.max(...recent10RSIs);
    const hasBeenStrong = effectivePeakRSI > 65;
    const condition4 = currentPrice > currentMA20;

    if (condition1 && condition2 && hasBeenStrong && condition4) {
        return {
            type: 'buy',
            reason: `RSI二次启动(${prevRSI.toFixed(1)}→${currentRSI.toFixed(1)},峰值${effectivePeakRSI.toFixed(1)})`
        };
    }

    const condition1b = prevRSI < 55 && currentRSI >= 55 && currentRSI < 65;
    const condition2b = minRecentRSI < 45;
    const condition3b = currentPrice > currentMA20 * 1.02;
    const volumes = klines.slice(-6).map(k => k.cjl);
    const avgVol5 = volumes.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const condition4b = volumes[volumes.length - 1] > avgVol5 * 1.1;

    if (condition1b && condition2b && condition3b && condition4b) {
        return {
            type: 'buy',
            reason: `RSI温和启动(${prevRSI.toFixed(1)}→${currentRSI.toFixed(1)})`
        };
    }

    const recentPrices = klines.slice(-lookback);
    const priceHigh = Math.max(...recentPrices.map(k => k.zg));
    const rsiHigh = Math.max(...recentRSIs);

    if (currentPrice >= priceHigh * 0.98 && currentRSI < rsiHigh * 0.95) {
        return { type: 'sell', reason: 'RSI顶背离' };
    }

    if (prevRSI >= 60 && currentRSI < 60) {
        return { type: 'sell', reason: `RSI跌破60(${currentRSI.toFixed(1)})` };
    }

    return { type: 'hold', reason: '无信号' };
}

/**
 * 多因子评分系统 —— 板块权重提到40分
 */
export function calculateScore(
    stockKlines: Stock.KLineItem[],
    boardData: Stock.BoardItem | null,
    metrics: BreakoutMetrics,
    marketCap?: number
): number {
    let score = 0;
    const closes = stockKlines.map(k => k.sp);
    const ma20 = Tech.calculateMA(closes, 20);
    const currentPrice = closes[closes.length - 1];
    const currentMA20 = ma20[ma20.length - 1];
    const prevMA20 = ma20[ma20.length - 2];

    // 1. 板块协同 (40分) —— 核心权重最高
    if (boardData) {
        const moneyIn = boardData.moneyIn || 0;
        const rank = boardData.moneyInRankInAll ?? 1;
        let sBoard = 0;

        // 资金方向 (15分)
        if (boardData.moneyIn5d > 0) sBoard += 15;
        else if (boardData.moneyIn5d > -1000000) sBoard += 8;
        else sBoard += 0;

        // 资金强度 (15分)
        if (moneyIn > 50_000_000) sBoard += 15;
        else if (moneyIn > 10_000_000) sBoard += 12;
        else if (moneyIn > 5_000_000) sBoard += 9;
        else if (moneyIn > 1_000_000) sBoard += 6;
        else if (moneyIn > 0) sBoard += 3;

        // 板块排名 (10分)
        if (rank <= 0.05) sBoard += 10;
        else if (rank <= 0.15) sBoard += 7;
        else if (rank <= 0.30) sBoard += 5;
        else if (rank <= 0.50) sBoard += 3;
        else if (rank <= 0.70) sBoard += 1;

        score += sBoard;
    } else {
        score += 20;
    }

    // 2. 突破质量 (25分)
    if (metrics.expansionRatio > 3.0) score += 25;
    else if (metrics.expansionRatio > 2.0) score += 20;
    else if (metrics.expansionRatio > 1.5) score += 12;
    else if (metrics.expansionRatio > 1.2) score += 6;
    else score += 2;

    // 3. 趋势质量 (20分)
    if (currentPrice > currentMA20 && currentMA20 > prevMA20) score += 12;
    if (currentPrice > currentMA20 * 1.05) score += 8;

    // 4. 成交持续性 (15分)
    if (stockKlines.length >= 10) {
        const recentAmounts = stockKlines.slice(-5).map(k => k.cje || 0);
        const prevAmounts = stockKlines.slice(-10, -5).map(k => k.cje || 0);
        const avgAmount = recentAmounts.reduce((a, b) => a + b, 0) / 5;
        const prevAvgAmount = prevAmounts.length > 0
            ? prevAmounts.reduce((a, b) => a + b, 0) / prevAmounts.length
            : avgAmount;

        if (avgAmount > 100_000_000) score += 8;
        else if (avgAmount > 50_000_000) score += 5;
        else if (avgAmount > 30_000_000) score += 3;
        if (prevAvgAmount > 0 && avgAmount > prevAvgAmount * 1.2) score += 7;
        else if (prevAvgAmount > 0 && avgAmount > prevAvgAmount) score += 3;
    }

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
    private readonly WATCHLIST_MAX_AGE = 10;     // 从15天缩短到10天（板块驱动不需要等太久）
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

    /**
     * 板块驱动的买入信号判断
     * 核心逻辑：板块趋势 + 个股健康，不再执着于RSI深回调形态
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

        // 不用观察列表，直接取强势股票，增加板块数据，直接评分排序选出买入候选（核心改动）
        // 1. 获取5-10个交易日前的强势股票集合（去重）
        // 2. 对每只强势股票，调用接口
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

            // 计算RSI和技术指标
            const rsiValues = Tech.calculateRSI(klines.map(k => k.sp), this.RSI_PERIOD);
            const currentRSI = rsiValues[rsiValues.length - 1];
            const prevRSI = rsiValues[rsiValues.length - 2];
            const closes = klines.map(k => k.sp);
            const ma20 = Tech.calculateMA(closes, 20);
            const currentMA20 = ma20[ma20.length - 1];

            // 获取板块数据（关键：板块驱动）
            const boardData = await dataProvider.getBoardData(watchInfo.boardCode, today);
            const boardFlow3d = boardData?.moneyIn5d || 0;
            const boardFlowToday = boardData?.moneyIn || 0;
            const boardRank = boardData?.moneyInRankInAll || 1;

            console.log(`[Backtest] [${today}] ${secid} 板块[${watchInfo.boardCode}]数据: 3日流入=${boardFlow3d}, 当日流入=${boardFlowToday}, 排名=${boardRank.toFixed(4)}, 个股RSI=${currentRSI.toFixed(1)}, 股价=${currentPrice.toFixed(2)}, MA20=${currentMA20?.toFixed(2)}`);

            // 更新观察期峰值RSI
            if (currentRSI > watchInfo.maxRSI) {
                watchInfo.maxRSI = currentRSI;
            }
            if (currentPrice > watchInfo.maxPrice) {
                watchInfo.maxPrice = currentPrice;
            }
            // 防御：maxRSI为0时修复
            if (watchInfo.maxRSI <= 0) {
                watchInfo.maxRSI = currentRSI;
                console.log(`[Backtest] [${today}] ${secid} maxRSI从0修复为${currentRSI.toFixed(1)}`);
            }

            // ========== 止损/止盈（最高优先级）==========
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

                // 新增：板块退潮卖出（3日资金大幅流出）
                if (boardFlow3d < -10_000_000) {
                    console.log(`[Backtest] [${today}] ${secid} 🔵 板块退潮卖出: 板块3日流出${boardFlow3d}`);
                    this.pendingOrders.push({
                        secid: secid,
                        type: 'sell',
                        reason: `板块退潮(3日流出${boardFlow3d})`,
                        signalDate: today
                    });
                    continue;
                }
            }

            const daysInWatch = this.getTradeDaysDiff(watchInfo.addedDate, today);
            // ========== 未持仓股票的动态移除检查 ==========
            if (!position) {
               
                const recent3RSI = rsiValues.slice(-3);
                const decayedScore = watchInfo.score - daysInWatch * this.WATCHLIST_SCORE_DECAY;

                // 移除1: RSI回调过深
                if (currentRSI < 35) {
                    console.log(`[Backtest] [${today}] ${secid} 从观察列表移除: RSI回调过深(${currentRSI.toFixed(1)} < 35)`);
                    this.watchList.delete(secid);
                    continue;
                }

                // 移除2: 跌破MA20
                if (currentPrice < currentMA20) {
                    console.log(`[Backtest] [${today}] ${secid} 从观察列表移除: 跌破MA20(${currentPrice.toFixed(2)} < ${currentMA20.toFixed(2)})`);
                    this.watchList.delete(secid);
                    continue;
                }

                // 移除3: RSI连续3天<<40
                if (recent3RSI.length >= 3 && recent3RSI.every(r => r < 40)) {
                    console.log(`[Backtest] [${today}] ${secid} 从观察列表移除: RSI连续3天<<40`);
                    this.watchList.delete(secid);
                    continue;
                }

                // 移除4: 板块退潮（3日资金大幅流出）
                if (boardFlow3d < -15_000_000) {
                    console.log(`[Backtest] [${today}] ${secid} 从观察列表移除: 板块退潮(3日流出${boardFlow3d})`);
                    this.watchList.delete(secid);
                    continue;
                }

                // 移除5: 评分衰减
                if (decayedScore < 50) {
                    console.log(`[Backtest] [${today}] ${secid} 从观察列表移除: 评分衰减至${decayedScore.toFixed(1)}`);
                    this.watchList.delete(secid);
                    continue;
                }

                // 移除6: 超期
                if (daysInWatch > this.WATCHLIST_MAX_AGE) {
                    console.log(`[Backtest] [${today}] ${secid} 从观察列表移除: 超期${daysInWatch}天未触发`);
                    this.watchList.delete(secid);
                    continue;
                }
            }

            // ========== 板块驱动买入判断（核心修改）==========
            if (!position) {
                let hasBuySignal = false;
                let buyReason = '';

                // 信号1：板块趋势延续（最常用）
                // 板块3日资金为正 + 个股RSI在50-80健康强势区间 + 股价>MA20
                if (boardFlow3d > 0 && currentRSI > 50 && currentRSI < 80 && currentPrice > currentMA20) {
                    hasBuySignal = true;
                    buyReason = `板块趋势延续(板块3日流入${boardFlow3d}, RSI=${currentRSI.toFixed(1)}, 股价>MA20)`;
                }
                // 信号2：板块启动确认
                // 板块当日大幅流入 + 个股RSI刚突破50（启动初期）
                else if (boardFlowToday > 5_000_000 && prevRSI < 55 && currentRSI >= 55 && currentPrice > currentMA20) {
                    hasBuySignal = true;
                    buyReason = `板块启动确认(板块当日流入${boardFlowToday}, RSI=${prevRSI.toFixed(1)}→${currentRSI.toFixed(1)})`;
                }
                // 信号3：板块龙头（板块极强）
                // 板块排名前20% + 个股RSI>55 + 股价>MA20
                else if (boardRank <= 0.20 && currentRSI > 55 && currentPrice > currentMA20) {
                    hasBuySignal = true;
                    buyReason = `板块龙头(板块前${(boardRank*100).toFixed(0)}%, RSI=${currentRSI.toFixed(1)})`;
                }
                // 信号4：板块强势+个股技术确认（RSI从弱势区回升）
                // 板块3日流入为正 + 个股RSI从<50回升到>50 + 股价>MA20
                else if (boardFlow3d > 0 && prevRSI < 50 && currentRSI >= 50 && currentPrice > currentMA20) {
                    hasBuySignal = true;
                    buyReason = `个股技术确认(板块3日流入${boardFlow3d}, RSI=${prevRSI.toFixed(1)}→${currentRSI.toFixed(1)})`;
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

            // 原有RSI卖出信号（顶背离/跌破60）保留
            if (position) {
                const signal = getTrendRSISignal(klines, rsiValues, this.RSI_LOOKBACK, watchInfo.maxRSI);
                if (signal.type === 'sell') {
                    console.log(`[Backtest] [${today}] ${secid} ✅ 生成RSI卖出订单: ${signal.reason}`);
                    this.pendingOrders.push({
                        secid: secid,
                        type: 'sell',
                        reason: signal.reason,
                        signalDate: today
                    });
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
                    const boardData = await dataProvider.getBoardData(stock.bk, today);

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
                    const score = calculateScore(klines, boardData, metrics, marketCap);

                    const recentKlines = klines.slice(-60);
                    const rsiValues = Tech.calculateRSI(recentKlines.map(k => k.sp), this.RSI_PERIOD);
                    const matchScore = this.backtestRSIOnHistory(recentKlines, rsiValues);
                    const finalScore = score * 0.7 + matchScore * 0.3;

                    const initialRSI = (rsiValues[rsiValues.length - 1] && rsiValues[rsiValues.length - 1] > 0) ? rsiValues[rsiValues.length - 1] : 50;
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
                                initialPrice: value.initialPrice
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