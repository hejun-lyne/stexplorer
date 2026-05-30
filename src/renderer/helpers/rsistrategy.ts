import { Stock } from '@/types/stock';
import * as Services from '@/services';
import * as Tech from '@/helpers/tech';

export interface BreakoutMetrics {
    preVol: number;          // 突破前年化波动率
    postVol: number;         // 突破后年化波动率
    expansionRatio: number;  // 波动率放大倍数
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
 * 针对东财强势股票（60天新高/涨停）设计
 */
export function calculateBreakoutMetrics(
    klines: Stock.KLineItem[],
    tradeDay: string
): BreakoutMetrics | null {
    const tradeIndex = klines.findIndex(k => k.date === tradeDay);
    if (tradeIndex < 0) return null;

    // 突破前：tradeIndex之前的120天（不含突破日）
    const preStart = Math.max(0, tradeIndex - 120);
    const preKlines = klines.slice(preStart, tradeIndex);
    const preVol = preKlines.length >= 5 ? calculateVolatility(preKlines) : 0.2;

    // 突破后：从突破日到当前（最多20天）
    const postEnd = Math.min(klines.length, tradeIndex + 20);
    const postKlines = klines.slice(tradeIndex, postEnd);

    // 如果突破后数据不足5天，用preVol * 1.5作为估计（突破日常伴随波动率跃升）
    let postVol: number;
    if (postKlines.length >= 5) {
        postVol = calculateVolatility(postKlines);
    } else if (postKlines.length >= 1) {
        // 用当日振幅年化估计
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
 * 趋势型RSI信号
 * 针对强势股设计：不寻找"超卖反弹"，而是寻找"动能启动"和"趋势结束"
 */
export function getTrendRSISignal(
    klines: Stock.KLineItem[],
    rsiValues: number[],
    lookback: number = 5
): TradeSignal {
    if (rsiValues.length < lookback + 2 || klines.length < lookback + 2) {
        return { type: 'hold', reason: '数据不足' };
    }

    const currentRSI = rsiValues[rsiValues.length - 1];
    const prevRSI = rsiValues[rsiValues.length - 2];
    const recentRSIs = rsiValues.slice(-lookback);
    const minRecentRSI = Math.min(...recentRSIs);

    // 买入：RSI从50下方快速突破60（动能启动）
    if (prevRSI < 60 && currentRSI >= 60 && minRecentRSI < 50) {
        return {
            type: 'buy',
            reason: `RSI动能启动(${prevRSI.toFixed(1)}→${currentRSI.toFixed(1)})`
        };
    }

    // 卖出1：顶背离（价格新高，RSI未新高）
    const recentPrices = klines.slice(-lookback);
    const priceHigh = Math.max(...recentPrices.map(k => k.zg));
    const rsiHigh = Math.max(...recentRSIs);
    const currentPrice = klines[klines.length - 1].sp;

    if (currentPrice >= priceHigh * 0.98 && currentRSI < rsiHigh * 0.95) {
        return { type: 'sell', reason: 'RSI顶背离' };
    }

    // 卖出2：RSI跌破60（趋势结束）
    if (prevRSI >= 60 && currentRSI < 60) {
        return { type: 'sell', reason: `RSI跌破60(${currentRSI.toFixed(1)})` };
    }

    return { type: 'hold', reason: '无信号' };
}

/**
 * 多因子评分系统（针对强势股）
 */
export function calculateScore(
    stockKlines: Stock.KLineItem[],
    boardData: Stock.BoardItem | null,
    metrics: BreakoutMetrics
): number {
    let score = 0;
    const closes = stockKlines.map(k => k.sp);
    const ma20 = Tech.calculateMA(closes, 20);
    const currentPrice = closes[closes.length - 1];
    const currentMA20 = ma20[ma20.length - 1];
    const prevMA20 = ma20[ma20.length - 2];

    // 1. 板块协同 (30分)
    if (boardData) {
        if (boardData.moneyIn5d > 0) score += 10;
        if (boardData.moneyIn > 1000000) score += 10; // 1000万
        if (boardData.moneyInRankInAll <= 0.05) score += 10; // 板块前5%
    } else {
        score += 15; // 无板块数据时给中性分
    }

    // 2. 突破质量 (25分) - 针对东财强势列表的核心因子
    if (metrics.expansionRatio > 2.0) score += 25;
    else if (metrics.expansionRatio > 1.5) score += 15;
    else if (metrics.expansionRatio > 1.2) score += 5;

    // 3. 趋势质量 (25分)
    if (currentPrice > currentMA20 && currentMA20 > prevMA20) score += 15;
    if (currentPrice > currentMA20 * 1.05) score += 10; // 偏离5%以上，确认强势

    // 4. 成交持续性 (20分)
    if (stockKlines.length >= 10) {
        const recentAmounts = stockKlines.slice(-5).map(k => k.cjl);
        const prevAmounts = stockKlines.slice(-10, -5).map(k => k.cjl);
        const avgAmount = recentAmounts.reduce((a, b) => a + b, 0) / 5;
        const prevAvgAmount = prevAmounts.length > 0
            ? prevAmounts.reduce((a, b) => a + b, 0) / prevAmounts.length
            : avgAmount;

        if (avgAmount > 100000000) score += 10; // 1亿
        if (prevAvgAmount > 0 && avgAmount > prevAvgAmount * 1.2) score += 10; // 放量20%
    }

    return score;
}

export interface Position {
    secid: string;
    buyDate: string;
    buyPrice: number;
    quantity: number;
    buyAmount: number;
    highestPrice: number;
    addCount: number;
}

export interface WatchItem {
    secid: string;
    addedDate: string;
    score: number;
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
    private capital: number;        // 总资金（用于计算仓位基准）
    private availableCash: number;
    private positions: Map<string, Position> = new Map();
    private watchList: Map<string, WatchItem> = new Map();
    private pendingOrders: PendingOrder[] = [];
    private tradeRecords: TradeRecord[] = [];
    private dailyValues: DailyValue[] = [];
    private tradeDays: string[];

    // 参数配置
    private readonly MAX_POSITIONS = 5;      // 最大持仓数
    private readonly POSITION_RATIO = 0.2;   // 每只仓位占比（20%）
    private readonly STOP_LOSS_PCT = 0.93;   // 固定止损 -7%
    private readonly TRAILING_STOP_PCT = 0.90; // 移动止盈（从最高点回撤10%）
    private readonly MIN_SCORE = 60;         // 观察列表入选阈值
    private readonly MAX_WATCHLIST = 10;     // 观察列表上限
    private readonly SLIPPAGE = 0.001;       // 滑点 0.1%
    private readonly COMMISSION = 0.0003;    // 佣金 万3
    private readonly STAMP_TAX = 0.001;      // 印花税 千1（仅卖出）
    private readonly RSI_PERIOD = 6;         // 固定RSI周期（不每天优化）
    private readonly RSI_LOOKBACK = 5;       // RSI信号回看天数

    constructor(tradeDays: string[], initialCapital: number = 1000000) {
        this.tradeDays = tradeDays;
        this.initialCapital = initialCapital;
        this.capital = initialCapital;
        this.availableCash = initialCapital;
        console.log(`[Backtest] 初始化完成 | 初始资金: ${initialCapital.toLocaleString()} | 交易日数: ${tradeDays.length}`);
    }

    /**
     * 执行回测
     */
    public async run(dataProvider: DataProvider, onProgress?: (message: string, percent?: number) => void): Promise<BacktestResult> {
        const totalDays = this.tradeDays.length;
        const dayPercentStep = totalDays > 0 ? 90 / totalDays : 0;

        console.log(`[Backtest] ====== 回测开始 ======`);
        console.log(`[Backtest] 参数配置:`, {
            MAX_POSITIONS: this.MAX_POSITIONS,
            POSITION_RATIO: this.POSITION_RATIO,
            STOP_LOSS_PCT: this.STOP_LOSS_PCT,
            TRAILING_STOP_PCT: this.TRAILING_STOP_PCT,
            MIN_SCORE: this.MIN_SCORE,
            MAX_WATCHLIST: this.MAX_WATCHLIST,
            SLIPPAGE: this.SLIPPAGE,
            COMMISSION: this.COMMISSION,
            STAMP_TAX: this.STAMP_TAX,
            RSI_PERIOD: this.RSI_PERIOD,
            RSI_LOOKBACK: this.RSI_LOOKBACK
        });

        for (let i = 0; i < totalDays; i++) {
            const today = this.tradeDays[i];
            const currentBase = Math.round(i * dayPercentStep);

            console.log(`\n[Backtest] ---------- 第 ${i + 1}/${totalDays} 天 [${today}] ----------`);
            console.log(`[Backtest] 当前持仓: ${this.positions.size} 只 | 观察列表: ${this.watchList.size} 只 | 可用资金: ${this.availableCash.toFixed(2)}`);

            // 1. 执行昨日产生的待执行订单（用今日开盘价）
            onProgress?.(`[${i + 1}/${totalDays}] ${today} 执行待处理订单...`, currentBase);
            console.log(`[Backtest] [${today}] 阶段1: 执行待处理订单 ${this.pendingOrders.length} 笔`);
            await this.executePendingOrders(today, dataProvider);

            // 2. 基于今日数据，处理观察列表并产生新订单（将在次日执行）
            if (i < totalDays - 1) {
                const nextDay = this.tradeDays[i + 1];
                onProgress?.(`[${i + 1}/${totalDays}] ${today} 生成交易信号...`, Math.round(currentBase + dayPercentStep * 0.3));
                console.log(`[Backtest] [${today}] 阶段2: 生成交易信号 (次日执行: ${nextDay})`);
                await this.generateSignals(today, nextDay, dataProvider, (msg) => {
                    onProgress?.(msg, Math.round(currentBase + dayPercentStep * 0.6));
                });
            }

            // 3. 记录今日净值（用收盘价）
            onProgress?.(`[${i + 1}/${totalDays}] ${today} 记录净值...`, Math.round(currentBase + dayPercentStep * 0.8));
            console.log(`[Backtest] [${today}] 阶段3: 记录净值`);
            await this.recordDailyValue(today, dataProvider);

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
     */
    private async executePendingOrders(today: string, dataProvider: DataProvider) {
        if (this.pendingOrders.length === 0) {
            console.log(`[Backtest] [${today}] 无待执行订单`);
            return;
        }

        for (const order of this.pendingOrders) {
            const klines = await dataProvider.getKLines(order.secid, today, 1);
            if (!klines || klines.length === 0) {
                console.log(`[Backtest] [${today}] 订单执行失败: ${order.secid} 未获取到K线数据`);
                continue;
            }

            const todayKLine = klines.find(k => k.date === today);
            if (!todayKLine) {
                console.log(`[Backtest] [${today}] 订单执行失败: ${order.secid} 未找到当日K线`);
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
    }

    /**
     * 基于当日数据生成信号和订单
     */
    private async generateSignals(
        today: string,
        nextDay: string,
        dataProvider: DataProvider,
        onProgress?: (message: string) => void
    ) {
        // ---- 阶段1：处理观察列表（交易逻辑）----
        console.log(`[Backtest] [${today}] 阶段2-1: 处理观察列表 ${this.watchList.size} 只`);
        onProgress?.(`[${today}] 处理观察列表 ${this.watchList.size} 只...`);

        for (const [secid, watchInfo] of this.watchList) {
            const klines = await dataProvider.getKLines(secid, today, 60);
            if (!klines || klines.length < 20) {
                console.log(`[Backtest] [${today}] ${secid} 观察处理跳过: K线不足(${klines?.length || 0})`);
                continue;
            }

            const position = this.positions.get(secid);
            const currentPrice = klines[klines.length - 1].sp;

            // 更新持仓最高价（用于移动止盈）
            if (position && currentPrice > position.highestPrice) {
                const oldHigh = position.highestPrice;
                position.highestPrice = currentPrice;
                console.log(`[Backtest] [${today}] ${secid} 更新最高价: ${oldHigh.toFixed(2)} → ${currentPrice.toFixed(2)}`);
            }

            // 止损判断（优先级最高，产生次日卖出订单）
            if (position) {
                const stopLossPrice = position.buyPrice * this.STOP_LOSS_PCT;
                const trailingStopPrice = position.highestPrice * this.TRAILING_STOP_PCT;

                // 固定止损
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

                // 移动止盈（仅当盈利时触发）
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

            // RSI趋势信号判断
            const rsiValues = Tech.calculateRSI(klines.map(k => k.sp), this.RSI_PERIOD);
            const signal = getTrendRSISignal(klines, rsiValues, this.RSI_LOOKBACK);

            if (signal.type !== 'hold') {
                console.log(`[Backtest] [${today}] ${secid} RSI信号: ${signal.type.toUpperCase()} | ${signal.reason}`);
            }

            if (signal.type === 'buy' && !position && this.positions.size < this.MAX_POSITIONS) {
                console.log(`[Backtest] [${today}] ${secid} ✅ 生成买入订单 (次日${nextDay}执行)`);
                this.pendingOrders.push({
                    secid: secid,
                    type: 'buy',
                    reason: signal.reason,
                    signalDate: today
                });
            } else if (signal.type === 'sell' && position) {
                console.log(`[Backtest] [${today}] ${secid} ✅ 生成卖出订单 (次日${nextDay}执行)`);
                this.pendingOrders.push({
                    secid: secid,
                    type: 'sell',
                    reason: signal.reason,
                    signalDate: today
                });
            }

            // 剔除超期未持仓股票
            if (!position) {
                const daysInWatch = this.getTradeDaysDiff(watchInfo.addedDate, today);
                if (daysInWatch > 5) {
                    console.log(`[Backtest] [${today}] ${secid} 从观察列表移除: 超期${daysInWatch}天未买入`);
                    this.watchList.delete(secid);
                }
            }
        }

        // ---- 阶段2：补充观察列表（选股逻辑）----
        console.log(`[Backtest] [${today}] 阶段2-2: 获取强势股票补充观察列表`);
        onProgress?.(`[${today}] 获取强势股票...`);
        const strongStocks = await dataProvider.getStrongStocks(today);
        console.log(`[Backtest] [${today}] 强势股票共 ${strongStocks.length} 只`);

        if (strongStocks.length > 0) {
            console.log(`[Backtest] [${today}] 强势股票前5:`, strongStocks.slice(0, 5).map(s => s.secid));
        }

        onProgress?.(`[${today}] 强势股票 ${strongStocks.length} 只，开始评分...`);
        const candidates: Array<{ secid: string; score: number; rawScore: number; matchScore: number; expansionRatio: number }> = [];

        for (let i = 0; i < strongStocks.length; i++) {
            const stock = strongStocks[i];
            if (i % 5 === 0) {
                onProgress?.(`[${today}] 评分中 ${i}/${strongStocks.length}...`);
            }

            // 已在观察列表或已持仓则跳过
            if (this.watchList.has(stock.secid)) continue;
            if (this.positions.has(stock.secid)) continue;

            const klines = await dataProvider.getKLines(stock.secid, today, 120);
            const boardData = await dataProvider.getBoardData(stock.bk, today);
            if (!klines || klines.length < 60) {
                console.log(`[Backtest] [${today}] ${stock.secid} 选股跳过: K线不足(${klines?.length || 0})`);
                continue;
            }

            // 计算分段波动率
            const metrics = calculateBreakoutMetrics(klines, today);
            if (!metrics || metrics.expansionRatio < 1.5) {
                console.log(`[Backtest] [${today}] ${stock.secid} 选股跳过: 波动率不达标(expansion=${metrics?.expansionRatio.toFixed(2) || 'N/A'})`);
                continue;
            }

            // 计算综合评分
            const score = calculateScore(klines, boardData, metrics);
            if (score < this.MIN_SCORE) {
                console.log(`[Backtest] [${today}] ${stock.secid} 选股跳过: 评分不足(${score.toFixed(1)} < ${this.MIN_SCORE})`);
                continue;
            }

            // 计算RSI策略匹配度（固定参数下近60天信号胜率）
            const recentKlines = klines.slice(-60);
            const rsiValues = Tech.calculateRSI(recentKlines.map(k => k.sp), this.RSI_PERIOD);
            const matchScore = this.backtestRSIOnHistory(recentKlines, rsiValues);

            // 综合排序分：评分*0.7 + 匹配度*0.3
            const finalScore = score * 0.7 + matchScore * 0.3;
            candidates.push({ secid: stock.secid, score: finalScore, rawScore: score, matchScore, expansionRatio: metrics.expansionRatio });

            if (i < 3 || finalScore > 80) {
                console.log(`[Backtest] [${today}] ${stock.secid} 评分详情: 综合=${finalScore.toFixed(1)} | 基础=${score.toFixed(1)} | 匹配度=${matchScore.toFixed(1)} | 波动率放大=${metrics.expansionRatio.toFixed(2)}`);
            }
        }

        // 按分数排序，补充观察列表
        candidates.sort((a, b) => b.score - a.score);
        const needCount = this.MAX_WATCHLIST - this.watchList.size;
        const addCount = Math.min(needCount, candidates.length);

        if (candidates.length > 0) {
            console.log(`[Backtest] [${today}] 候选股票排序前5:`, candidates.slice(0, 5).map(c => `${c.secid}(${c.score.toFixed(1)})`));
        }

        for (let i = 0; i < addCount; i++) {
            const candidate = candidates[i];
            this.watchList.set(candidate.secid, {
                secid: candidate.secid,
                addedDate: today,
                score: candidate.score
            });
            console.log(`[Backtest] [${today}] ${candidate.secid} 加入观察列表 | 综合评分: ${candidate.score.toFixed(1)}`);
        }

        console.log(`[Backtest] [${today}] 观察列表更新: 新增 ${addCount} 只, 当前共 ${this.watchList.size} 只`);
    }

    /**
     * 执行买入（内部）
     */
    private executeBuy(secid: string, date: string, price: number, reason: string) {
        const adjustedPrice = price * (1 + this.SLIPPAGE);
        const buyAmount = this.capital * this.POSITION_RATIO;
        const quantity = Math.floor(buyAmount / adjustedPrice / 100) * 100;

        if (quantity < 100) {
            console.log(`[Backtest] [${date}] ${secid} 买入失败: 计算数量不足100股 (价格${adjustedPrice.toFixed(2)}, 计划金额${buyAmount.toFixed(2)})`);
            return;
        }

        const totalAmount = adjustedPrice * quantity;
        const commission = totalAmount * this.COMMISSION;
        const totalCost = totalAmount + commission;

        if (this.availableCash < totalCost) {
            console.log(`[Backtest] [${date}] ${secid} 买入失败: 资金不足 (需${totalCost.toFixed(2)}, 余${this.availableCash.toFixed(2)})`);
            return;
        }

        this.availableCash -= totalCost;
        this.positions.set(secid, {
            secid: secid,
            buyDate: date,
            buyPrice: adjustedPrice,
            quantity,
            buyAmount: totalCost,
            highestPrice: adjustedPrice,
            addCount: 0
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

    /**
     * 执行卖出（内部）
     */
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
        this.watchList.delete(secid); // 卖出后移出观察列表
        console.log(`[Backtest] [${date}] ${secid} 已从持仓和观察列表移除`);
    }

    /**
     * 记录每日净值
     */
    private async recordDailyValue(date: string, dataProvider: DataProvider) {
        let stockValue = 0;
        let positionDetails: Array<{ secid: string; close: number; quantity: number; value: number }> = [];

        for (const [secid, pos] of this.positions) {
            const klines = await dataProvider.getKLines(secid, date, 1);
            if (klines && klines.length > 0) {
                const close = klines[klines.length - 1].sp;
                const value = close * pos.quantity;
                stockValue += value;
                positionDetails.push({ secid, close, quantity: pos.quantity, value });
            } else {
                console.log(`[Backtest] [${date}] ${secid} 净值计算: 未获取到收盘价，按成本价估算`);
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
    }

    /**
     * 计算回测结果指标
     */
    private calculateResult(): BacktestResult {
        const finalValue = this.dailyValues[this.dailyValues.length - 1]?.totalValue || this.initialCapital;
        const totalReturn = (finalValue - this.initialCapital) / this.initialCapital;
        const days = this.dailyValues.length;
        const annualizedReturn = days > 0 ? Math.pow(1 + totalReturn, 252 / days) - 1 : 0;

        // 最大回撤
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

        // 交易统计
        const sellTrades = this.tradeRecords.filter(t => t.type === 'sell');
        const winTrades = sellTrades.filter(t => (t.pnl || 0) > 0);
        const winRate = sellTrades.length > 0 ? winTrades.length / sellTrades.length : 0;

        const totalProfit = winTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        const lossTrades = sellTrades.filter(t => (t.pnl || 0) <= 0);
        const totalLoss = lossTrades.reduce((sum, t) => sum + Math.abs(t.pnl || 0), 0);
        const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : (totalProfit > 0 ? Infinity : 0);

        // 夏普比率（简化，假设无风险利率为0）
        const returns: number[] = [];
        for (let i = 1; i < this.dailyValues.length; i++) {
            returns.push((this.dailyValues[i].totalValue - this.dailyValues[i - 1].totalValue) / this.dailyValues[i - 1].totalValue);
        }
        const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
        const stdReturn = returns.length > 0
            ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length)
            : 0;
        const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

        // 平均持仓天数
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

    /**
     * 回测RSI策略历史表现（固定参数下近N天信号胜率）
     * 用于评估"策略匹配度"，而非优化参数
     */
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
                // 5天内最高价超过买入价3%算成功
                if (maxPrice > entryPrice * 1.03) wins++;
            }
        }

        return signals > 0 ? (wins / signals) * 100 : 50;
    }

    /**
     * 计算两个交易日之间的天数差
     */
    private getTradeDaysDiff(date1: string, date2: string): number {
        const idx1 = this.tradeDays.indexOf(date1);
        const idx2 = this.tradeDays.indexOf(date2);
        if (idx1 < 0 || idx2 < 0) return 0;
        return Math.abs(idx2 - idx1);
    }
}