/**
 * Tushare 数据源调用服务
 * 用于提供 tushare 数据接口的接入
 * 
 * Token 从系统设置中读取（setting.systemSetting.tushareTokenSetting）
 * 支持 6000 积分会员的绝大部分接口
 */

import dayjs from 'dayjs';
import NP from 'number-precision';
import * as Utils from '@/utils';
import { KLineType, StockMarketType } from '@/utils/enums';
import { Stock } from '@/types/stock';
import * as Helpers from '../helpers';
import store from '@/store/configureStore';

const { execPyScript, getLocalStoragePath } = window.contextModules.electron;

// Python 脚本路径
const TUSHARE_SCRIPT = 'tushare_api.py';

// 缓存本地存储路径，避免每次 IPC 调用
let cachedStoragePath: string | null = null;

async function getStoragePath(): Promise<string> {
  if (cachedStoragePath !== null) return cachedStoragePath;
  try {
    const result = await getLocalStoragePath();
    if (result?.success && result.path) {
      cachedStoragePath = result.path;
      return cachedStoragePath;
    }
  } catch (e) {
    console.error('[Tushare] 获取存储路径失败:', e);
  }
  cachedStoragePath = '';
  return '';
}

// 日志辅助函数
function logError(error: any, method: string, extraInfo?: string) {
  if (error?.message?.includes('socket hang up') || error?.message?.includes('ECONNRESET')) {
    console.error(`[网络错误] Method: ${method}`, error);
  } else if (extraInfo) {
    console.log(extraInfo, error);
  } else {
    console.error(`[${method}]`, error);
  }
}

/**
 * 调用 Python tushare 脚本
 * @param method 方法名
 * @param params 参数对象
 * @returns Promise<any>
 */
async function callTushare(method: string, params: Record<string, any> = {}): Promise<any> {
  try {
    const token = store.getState().setting?.systemSetting?.tushareTokenSetting || '';
    const args = [method, '--params', JSON.stringify(params)];
    if (token) {
      args.push('--token', token);
    }
    const storagePath = await getStoragePath();
    if (storagePath) {
      args.push('--storage-path', storagePath);
    }
    const result = await execPyScript(TUSHARE_SCRIPT, args);
    // Python 脚本输出 JSON 字符串，每行可能包含 JSON 或 debug 信息
    // 从最后一行往前找第一个可解析的 JSON 行
    if (Array.isArray(result) && result.length > 0) {
      for (let i = result.length - 1; i >= 0; i--) {
        const line = (result[i] as string).trim();
        if (line.startsWith('{') || line.startsWith('[')) {
          return JSON.parse(line);
        }
      }
    }
    return result;
  } catch (error) {
    logError(error, method);
    throw error;
  }
}

// ==================== 交易日历 ====================

const TRADE_CALENDAR_TABLE = 'trade_calendar_tushare';

/**
 * 从 Tushare 获取指定年份交易日列表
 */
export async function GetTradeDatesFromTushare(year?: string): Promise<string[]> {
  try {
    const result = await callTushare('get_trade_dates', { 
      year: year ? parseInt(year) : new Date().getFullYear() 
    });
    if (result.error) {
      console.error('获取交易日历失败:', result.error);
      return [];
    }
    return result.dates || [];
  } catch (error) {
    console.error('GetTradeDatesFromTushare error:', error);
    return [];
  }
}

/**
 * 判断某天是否为交易日（带本地缓存）
 */
export async function IsTradeDay(date?: string): Promise<boolean> {
  const checkDate = date || dayjs().format('YYYY-MM-DD');
  const year = checkDate.substring(0, 4);
  
  // 1. 先读本地缓存
  try {
    const cached = await window.contextModules.electron.sqliteRead(TRADE_CALENDAR_TABLE, year);
    if (cached?.success && cached.data?.data?.dates) {
      const dates: string[] = cached.data.data.dates;
      return dates.includes(checkDate);
    }
  } catch (e) {
    // 缓存不存在，继续往下
  }
  
  // 2. 缓存未命中，从 Tushare 拉取全年
  const dates = await GetTradeDatesFromTushare(year);
  if (dates.length === 0) {
    // 兜底：周一到周五为交易（简易判断）
    const weekday = dayjs(checkDate).day();
    return weekday !== 0 && weekday !== 6;
  }
  
  // 3. 写入本地缓存（有效期一年）
  try {
    await window.contextModules.electron.sqliteWrite(TRADE_CALENDAR_TABLE, {
      dates,
      year,
      syncedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    }, dayjs().format('YYYY-MM-DD HH:mm:ss'), year);
  } catch (e) {
    console.error('缓存交易日历失败:', e);
  }
  
  return dates.includes(checkDate);
}

/**
 * 批量判断多个日期是否为交易日
 */
export async function FilterTradeDays(dates: string[]): Promise<string[]> {
  if (dates.length === 0) return [];
  
  // 按年份分组，减少缓存查询次数
  const yearMap: Record<string, string[]> = {};
  dates.forEach(d => {
    const year = d.substring(0, 4);
    if (!yearMap[year]) yearMap[year] = [];
    yearMap[year].push(d);
  });
  
  const tradeDays: string[] = [];
  for (const [year, yearDates] of Object.entries(yearMap)) {
    // 确保该年缓存存在
    const cached = await window.contextModules.electron.sqliteRead(TRADE_CALENDAR_TABLE, year);
    let validDates: string[] = [];
    
    if (cached?.success && cached.data?.data?.dates) {
      validDates = cached.data.data.dates;
    } else {
      validDates = await GetTradeDatesFromTushare(year);
      if (validDates.length > 0) {
        await window.contextModules.electron.sqliteWrite(TRADE_CALENDAR_TABLE, {
          dates: validDates,
          year,
        }, dayjs().format('YYYY-MM-DD HH:mm:ss'), year);
      }
    }
    
    yearDates.forEach(d => {
      if (validDates.includes(d)) tradeDays.push(d);
    });
  }
  
  return tradeDays;
}

// ==================== 搜索相关 ====================

export async function SearchFromTushare(keyword: string): Promise<any[]> {
  try {
    const result = await callTushare('search_stock', { keyword });
    if (result.error) {
      console.error('搜索失败:', result.error);
      return [];
    }
    
    // 转换为与原有接口兼容的格式
    return [{
      Type: StockMarketType.AB,
      Name: "A股",
      Count: result.length,
      Datas: result.map((item: any) => ({
        Code: item.Code,
        Name: item.Name,
        ID: item.Code,
        MktNum: item.Code?.startsWith('6') ? '1' : '0',
        SecurityType: '10',
        MarketType: item.Code?.startsWith('6') ? '_SH' : '_SZ',
        UnifiedCode: item.Code,
      }))
    }];
  } catch (error) {
    logError(error, 'SearchFromTushare', '搜索股票失败');
    return [];
  }
}

// ==================== 实时行情 ====================

export async function GetDetailFromTushare(secid: string): Promise<Stock.DetailItem | null> {
  try {
    const result = await callTushare('get_stock_realtime', { secid });
    if (result.error) {
      console.error('获取详情失败:', result.error);
      return null;
    }

    return {
      secid,
      code: result.code,
      name: result.name,
      zx: result.zx,
      zs: result.zs,
      zdf: result.zdf,
      zdd: result.zdd,
      cjl: result.cjl,
      cje: result.cje,
      zg: result.zg,
      zd: result.zd,
      jk: result.jk,
      lb: result.lb,
      hsl: result.hsl,
      lt: result.lt,
      bk: '',
      time: dayjs().format('MM-DD HH:mm'),
      // 买卖五档数据 tushare 可能无法提供，设置为 0
      b1: 0, b1p: 0, b2: 0, b2p: 0, b3: 0, b3p: 0, b4: 0, b4p: 0, b5: 0, b5p: 0,
      s1: 0, s1p: 0, s2: 0, s2p: 0, s3: 0, s3p: 0, s4: 0, s4p: 0, s5: 0, s5p: 0,
    } as Stock.DetailItem;
  } catch (error) {
    logError(error, 'GetDetailFromTushare', '获取股票详情失败');
    return null;
  }
}

/**
 * 批量获取股票详情（非交易时段用一次 tushare daily+daily_basic 全量请求，避免逐个调用）
 */
export async function GetDetailsFromTushareBatch(secids: string[]): Promise<(Stock.DetailItem | null)[]> {
  try {
    const result = await callTushare('get_stocks_realtime_batch', { secids });
    if (result.error) {
      console.error('批量获取详情失败:', result.error);
      return secids.map(() => null);
    }

    const data = result.data || {};
    return secids.map((secid) => {
      const item = data[secid];
      if (!item || item.error) return null;

      return {
        secid,
        code: item.code,
        name: item.name,
        zx: item.zx,
        zs: item.zs,
        zdf: item.zdf,
        zdd: item.zdd,
        cjl: item.cjl,
        cje: item.cje,
        zg: item.zg,
        zd: item.zd,
        jk: item.jk,
        lb: item.lb,
        hsl: item.hsl,
        lt: item.lt,
        bk: '',
        time: item.time || dayjs().format('MM-DD HH:mm'),
        b1: 0, b1p: 0, b2: 0, b2p: 0, b3: 0, b3p: 0, b4: 0, b4p: 0, b5: 0, b5p: 0,
        s1: 0, s1p: 0, s2: 0, s2p: 0, s3: 0, s3p: 0, s4: 0, s4p: 0, s5: 0, s5p: 0,
      } as Stock.DetailItem;
    });
  } catch (error) {
    logError(error, 'GetDetailsFromTushareBatch', '批量获取股票详情失败');
    return secids.map(() => null);
  }
}

// ==================== K 线数据 ====================
/**
 * 获取K线数据 - 使用 Tushare 数据源
 * 
 * 支持: 日K线、周K线、月K线
 * 复权: 支持前复权(qfq)、后复权(hfq)、不复权
 * 
 * 注意：缓存逻辑已迁移到 stock.ts 的 GetKFromDataSource
 */
export async function GetKFromTushare(secid: string, code: number, limit?: number): Promise<{ ks: Stock.KLineItem[], kt: number }> {
  const periodMap: Record<number, string> = {
    [KLineType.Day]: 'daily',
    [KLineType.Week]: 'weekly',
    [KLineType.Month]: 'monthly',
  };

  const period = periodMap[code] || 'daily';

  try {
    let klines: any[] = [];
    const result = await callTushare('get_kline_data', { secid, period, limit: limit || 0 });

    if (result.error || !Array.isArray(result) || result.length === 0) {
      console.error('获取K线失败:', result.error || 'Empty data');
      return { ks: [], kt: code };
    }

    klines = result;

    // 限制数量
    if (limit && limit > 0 && klines.length > limit) {
      klines = klines.slice(-limit);
    }

    const ks = klines.map((item: any) => ({
      secid,
      type: code,
      date: item.date,
      kp: item.kp,
      sp: item.sp,
      zg: item.zg,
      zd: item.zd,
      cjl: item.cjl,
      cje: item.cje,
      zdf: item.zdf,
      zde: item.zde,
      hsl: item.hsl,
      chan: 0, // ChanType.Unknow
    } as Stock.KLineItem));

    return { ks, kt: code };
  } catch (error) {
    logError(error, 'GetKFromTushare', '获取K线数据失败');
    return { ks: [], kt: code };
  }
}

/**
 * 批量获取K线数据 - 使用 Tushare 数据源
 * 
 * @param secids secid 数组，如 ["1.600000", "0.000001"]
 * @param date 截止日期 (YYYY-MM-DD)，获取该日期之前的 K 线
 * @param limit 每个 secid 返回的最大条数
 * @param code K线周期类型，默认日K
 * @returns 按 secid 分组的结果对象
 */
export async function BatchGetKFromTushare(
  secids: string[],
  date: string,
  limit: number,
  code: number = KLineType.Day
): Promise<Record<string, Stock.KLineItem[]>> {
  const periodMap: Record<number, string> = {
    [KLineType.Day]: 'daily',
    [KLineType.Week]: 'weekly',
    [KLineType.Month]: 'monthly',
  };

  const period = periodMap[code] || 'daily';
  const endDate = date.replace(/-/g, '');

  try {
    const batchResult = await callTushare('get_kline_data_batch', {
      secids,
      period,
      limit,
      end_date: endDate,
    });

    if (batchResult.error || typeof batchResult !== 'object') {
      console.error('批量获取K线失败:', batchResult.error || 'Invalid response');
      const emptyMap: Record<string, Stock.KLineItem[]> = {};
      secids.forEach((secid) => { emptyMap[secid] = []; });
      return emptyMap;
    }

    const map: Record<string, Stock.KLineItem[]> = {};
    for (const secid of secids) {
      const klines = batchResult[secid];
      if (!Array.isArray(klines) || klines.length === 0) {
        map[secid] = [];
        continue;
      }

      let sliced = klines;
      if (limit > 0 && sliced.length > limit) {
        sliced = sliced.slice(-limit);
      }

      map[secid] = sliced.map((item: any) => ({
        secid,
        type: code,
        date: item.date,
        kp: item.kp,
        sp: item.sp,
        zg: item.zg,
        zd: item.zd,
        cjl: item.cjl,
        cje: item.cje,
        zdf: item.zdf,
        zde: item.zde,
        hsl: item.hsl,
        chan: 0,
      } as Stock.KLineItem));
    }

    return map;
  } catch (error) {
    logError(error, 'BatchGetKFromTushare', '批量获取K线数据失败');
    const emptyMap: Record<string, Stock.KLineItem[]> = {};
    secids.forEach((secid) => { emptyMap[secid] = []; });
    return emptyMap;
  }
}

// ==================== 分时走势 ====================
/**
 * 获取分时走势数据 - 使用 Tushare 数据源
 * 
 * tushare 免费版无分时数据接口，使用新浪财经分时代用
 */
export async function GetTrendFromTushare(secid: string): Promise<{ secid: string, trends: Stock.TrendItem[] }> {
  try {
    const result = await callTushare('get_stock_trend', { secid });
    if (result.error) {
      console.error('获取分时数据失败:', result.error);
      return { secid, trends: [] };
    }
    
    const trends = result
      .map((item: any) => ({
        datetime: item.datetime,
        current: item.current,
        last: item.last,
        vol: item.vol,
        average: item.average || 0,
        up: item.up !== undefined ? item.up : (item.current >= item.last ? 1 : -1),
      }))
      .filter((t: any) => t.current > 0);
    
    return { secid, trends };
  } catch (error) {
    logError(error, 'GetTrendFromTushare', '获取分时走势失败');
    return { secid, trends: [] };
  }
}

// ==================== 板块数据 ====================

/**
 * 获取特定交易日全板块数据
 * @param bk_type 板块类型: "industry"(行业板块) 或 "concept"(概念板块)
 * @param date 交易日期(YYYYMMDD)，不传则默认最近交易日
 * @returns 板块列表，包含代码、名字、涨跌幅等
 */
export async function GetBoardsByDateFromTushare(bk_type: string = 'industry', date?: string): Promise<any> {
  try {
    const params: Record<string, any> = { bk_type };
    if (date) params.date = date;

    const result = await callTushare('get_boards_by_date', params);

    if (result.error) {
      console.error('获取特定交易日板块数据失败:', result.error);
      return {};
    }

    const arr = result.boards.map((item: any) => ({
      code: item.code,
      name: item.name,
      market: 90,
      secid: `90.${item.code}`,
      zx: item.zx || 0,
      zdf: item.zdf || 0,
      zdd: item.zdd || 0,
      hsl: item.hsl || 0,
      szs: item.szs || 0,
      xds: item.xds || 0,
      lt: item.lt || 0,
      cje: item.cje || 0,
      cjl: item.cjl || 0,
      mainIn: item.main_in || 0,
      mainIn5d: item.main_in_5d || 0,
      date: result.date,
      source: item.source || 'dc',
    }));

    return { to: result.count || arr.length, arr, date: result.date };
  } catch (error) {
    logError(error, 'GetBoardsByDateFromTushare', '获取特定交易日板块数据失败');
    return {};
  }
}

/**
 * 获取板块指定交易日的成分股及涨幅（用于回测板块内排名）
 * @param secid 板块ID，如 "90.BK0428"
 * @param date 交易日期(YYYYMMDD)
 * @returns 成分股列表，含 secid 和 zf（涨跌幅%）
 */
export async function GetBoardStocksByDateFromTushare(
  secid: string, 
  date: string
): Promise<Array<{ secid: string; zf: number }>> {
  try {
    const result = await callTushare('get_board_stocks', { secid, date });
    
    if (result.error || !result.stocks) {
      console.error('获取板块成分股失败:', result.error);
      return [];
    }
    
    return result.stocks.map((s: any) => ({
      secid: s.secid,
      zf: s.zdf || 0,
    }));
  } catch (error) {
    logError(error, 'GetBoardStocksByDateFromTushare', '获取板块成分股失败');
    return [];
  }
}

/**
 * 批量获取多个交易日的全市场板块数据（industry + concept 合并）
 * @param dates 交易日期数组 (YYYYMMDD)
 * @param bk_type 板块类型，"industry"(行业板块) 或 "concept"(概念板块)。不传则默认合并
 * @returns 按日期分组的全市场板块数据
 */
export async function GetBoardsByDateBatchFromTushare(dates: string[], bk_type?: string): Promise<Record<string, Array<{ code: string; name: string; zf: number }>>> {
  try {
    const result = await callTushare('get_boards_by_date_batch', { dates, bk_type });

    if (result.error || typeof result !== 'object') {
      console.error('批量获取板块数据失败:', result.error || 'Invalid response');
      const emptyMap: Record<string, Array<{ code: string; name: string; zf: number }>> = {};
      dates.forEach((d) => { emptyMap[d] = []; });
      return emptyMap;
    }

    const map: Record<string, Array<{ code: string; name: string; zf: number }>> = {};
    for (const date of dates) {
      const dayData = result[date];
      if (dayData && Array.isArray(dayData.boards)) {
        map[date] = dayData.boards.map((item: any) => ({
          code: item.code,
          name: item.name,
          zf: item.zdf || 0,
        }));
      } else {
        map[date] = [];
      }
    }
    return map;
  } catch (error) {
    logError(error, 'GetBoardsByDateBatchFromTushare', '批量获取板块数据失败');
    const emptyMap: Record<string, Array<{ code: string; name: string; zf: number }>> = {};
    dates.forEach((d) => { emptyMap[d] = []; });
    return emptyMap;
  }
}

/**
 * 批量获取板块成分股，按 date+boardCode 去重内部查询
 * @param requests 请求数组，每个元素包含 { date, boardCode, boardName }
 * @returns 按 "date_boardCode" 分组的成分股列表
 */
export async function GetBoardStocksBatchFromTushare(
  requests: Array<{ date: string; boardCode: string | null; boardName: string }>
): Promise<Record<string, Array<{ secid: string; zf: number }>>> {
  try {
    // 将日期转为 YYYYMMDD
    const formattedReqs = requests.map((req) => ({
      date: req.date.replace(/-/g, ''),
      boardCode: req.boardCode,
      boardName: req.boardName,
    }));

    const result = await callTushare('get_board_stocks_batch', { requests: formattedReqs });

    if (result.error || typeof result !== 'object') {
      console.error('批量获取板块成分股失败:', result.error || 'Invalid response');
      const emptyMap: Record<string, Array<{ secid: string; zf: number }>> = {};
      requests.forEach((req) => { emptyMap[`${req.date}_${req.boardCode}`] = []; });
      return emptyMap;
    }

    const map: Record<string, Array<{ secid: string; zf: number }>> = {};
    for (const req of requests) {
      const rkey = `${req.date.replace(/-/g, '')}_${req.boardCode}`;
      const key = `${req.date}_${req.boardCode}`;
      const dayData = result[rkey];
      if (dayData && Array.isArray(dayData.stocks)) {
        map[key] = dayData.stocks.map((s: any) => ({
          secid: s.secid,
          zf: s.zdf || 0,
        }));
      } else {
        map[key] = [];
      }
    }
    return map;
  } catch (error) {
    logError(error, 'GetBoardStocksBatchFromTushare', '批量获取板块成分股失败');
    const emptyMap: Record<string, Array<{ secid: string; zf: number }>> = {};
    requests.forEach((req) => { emptyMap[`${req.date}_${req.boardCode}`] = []; });
    return emptyMap;
  }
}

export async function GetBanKuaisFromTushare(type: number, dataSource = 'dc'): Promise<any> {
  try {
    const bk_type = type === 0 ? 'industry' : 'concept';
    const result = await callTushare('get_sector_boards', { bk_type, data_source: dataSource });
    
    if (result.error) {
      console.error('获取板块失败:', result.error);
      return {};
    }

    // 打印 debug 信息到 Electron 控制台
    if (result.debug) {
      console.log('[Tushare dc_index debug]', result.debug);
    }
    
    const arr = result.boards.map((item: any) => ({
      code: item.code,
      name: item.name,
      market: 90,
      secid: `90.${item.code}`,
      // 修复后（从接口读取）
      zx: item.zx || 0,
      zdf: item.zdf || 0,
      zdd: item.zdd || 0,
      hsl: item.hsl || 0,
      szs: item.szs || 0,
      xds: item.xds || 0,
      lt: item.lt || 0,
      cje: item.cje || 0,
      cjl: item.cjl || 0,
      mainIn: item.main_in || 0,
      mainIn5d: item.main_in_5d || 0,
    }));
    
    return { to: result.boards.length, arr };
  } catch (error) {
    logError(error, 'GetBanKuaisFromTushare', '获取板块数据失败');
    return {};
  }
}

/**
 * 获取单个板块详情（含指定交易日资金流入全板块排名）
 * @param secid 板块ID，如 "90.BK0428"
 * @param date 指定交易日(YYYYMMDD)，不传则默认今天
 * @returns 兼容 GetBanKuaisFromTushare 的单条格式，增加 mainInRank / mainInTotal
 */
export async function GetBoardDetailFromTushare(secid: string, date?: string): Promise<any> {
  try {
    const params: Record<string, any> = { secid };
    if (date) params.date = date;

    const result = await callTushare('get_board_detail', params);

    if (result.error) {
      console.error('获取板块详情失败:', result.error);
      return null;
    }

    // mainInRank 是绝对排名(如第3名)，mainInTotal 是总板块数(如100)
    // moneyInRankInAll 需要是排名比例(如 0.03 表示前3%)
    const rank = result.mainInRank || 0;
    const total = result.mainInTotal || 1;
    const moneyInRankInAll = total > 0 ? rank / total : 0;

    return {
      code: result.code,
      name: result.name,
      market: 90,
      secid: result.secid,
      zx: result.zx || 0,
      zdf: result.zdf || 0,
      zdd: result.zdd || 0,
      hsl: result.hsl || 0,
      szs: result.szs || 0,
      xds: result.xds || 0,
      lt: result.lt || 0,
      cje: result.cje || 0,
      cjl: result.cjl || 0,
      moneyIn: result.mainIn || 0,
      moneyIn5d: result.mainIn5d || 0,
      moneyIn10d: result.mainIn10d || 0,
      moneyInRankInAll,
      date: result.date,
      source: result.source,
    };
  } catch (error) {
    logError(error, 'GetBoardDetailFromTushare', '获取板块详情失败');
    return null;
  }
}

export interface BankuaiMatchResult {
  secid: string;
  type: 'industry' | 'concept';
}
/**
 * 根据板块名字反查板块代码（Tushare 数据源）
 * @param name 板块名称
 * @param fuzzy 是否启用模糊匹配（默认 true）
 * @returns 匹配板块的 secid 和类型（行业/概念），未找到返回 null
 */
export async function GetBankuaiCodeByNameFromTushare(name: string, fuzzy = true): Promise<BankuaiMatchResult | null> {
  if (!name) {
    return null;
  }
  try {
    const [industryResult, gainianResult] = await Promise.all([
           GetBanKuaisFromTushare(0, 'dc'),
      GetBanKuaisFromTushare(1, 'dc'),
    ]);
    const industryBks: Stock.BanKuaiItem[] = industryResult?.arr || [];
    const conceptBks: Stock.BanKuaiItem[] = gainianResult?.arr || [];
    const trimmedName = name.trim();
    const findMatch = (list: Stock.BanKuaiItem[]): Stock.BanKuaiItem | undefined => {
      // 1. 精确匹配
      let match = list.find((bk) => bk.name === trimmedName);
      if (match) return match;
      // 2. 忽略大小写精确匹配
      match = list.find((bk) => bk.name.toLowerCase() === trimmedName.toLowerCase());
      if (match) return match;
      // 3. 模糊匹配（包含关系）
      if (fuzzy) {
        match = list.find((bk) => bk.name.includes(trimmedName));
        if (match) return match;
        match = list.find((bk) => trimmedName.includes(bk.name));
        if (match) return match;
      }
      return undefined;
    };
    // 优先在行业板块中查找
    let match = findMatch(industryBks);
    if (match) {
      return { secid: match.secid, type: 'industry' };
    }
    // 再在概念板块中查找
    match = findMatch(conceptBks);
    if (match) {
      return { secid: match.secid, type: 'concept' };
    }
    return null;
  } catch (error) {
    console.error('根据板块名字反查板块代码失败 (Tushare):', name, error);
    return null;
  }
}

// ==================== 板块成分股 ====================

export async function GetBankuaiStocksFromTushare(secid: string, date: string): Promise<any> {
  try {
    const result = await callTushare('get_board_stocks', { secid, date });
    
    if (result.error) {
      console.error('获取板块成分股失败:', result.error);
      return { total: 0, stocks: [] };
    }
    
    return result;
  } catch (error) {
    logError(error, 'GetBankuaiStocksFromTushare', '获取板块成分股失败');
    return { total: 0, stocks: [] };
  }
}

// ==================== 涨停跌停数据 ====================

export async function GeZTStocksFromTushare(pageSize = 20, date?: string): Promise<any> {
  try {
    const params: any = {};
    if (date) params.date = date;
    
    const result = await callTushare('get_limit_up_stocks', params);
    if (result.error) {
      console.error('获取涨停股票失败:', result.error);
      return {};
    }
    
    const arr = result.slice(0, pageSize).map((item: any) => ({
      code: item.code,
      name: item.name,
      market: item.code?.startsWith('6') ? 1 : 0,
      secid: `${item.code?.startsWith('6') ? 1 : 0}.${item.code}`,
      zx: item.zx,
      zdf: item.zdf,
      lbc: item.lbc,
      fbt: item.fbt,
      lbt: item.lbt,
      zbc: item.zbc,
      fbf: item.fbf,
    }));
    
    return { to: result.length, arr };
  } catch (error) {
    logError(error, 'GeZTStocksFromTushare', '获取涨停股票失败');
    return {};
  }
}

export async function GeDTStocksFromTushare(pageSize = 20, date?: string): Promise<any> {
  try {
    const params: any = {};
    if (date) params.date = date;
    
    const result = await callTushare('get_limit_down_stocks', params);
    if (result.error) {
      console.error('获取跌停股票失败:', result.error);
      return {};
    }
    
    const arr = result.slice(0, pageSize).map((item: any) => ({
      code: item.code,
      name: item.name,
      market: item.code?.startsWith('6') ? 1 : 0,
      secid: `${item.code?.startsWith('6') ? 1 : 0}.${item.code}`,
      zx: item.zx,
      zdf: item.zdf,
      dtdays: item.dtdays,
    }));
    
    return { to: result.length, arr };
  } catch (error) {
    logError(error, 'GeDTStocksFromTushare', '获取跌停股票失败');
    return {};
  }
}

// ==================== 公司信息 ====================

export async function GetCompanyFromTushare(secid: string): Promise<Stock.Company> {
  try {
    const code = secid.split('.').pop() || secid;
    const result = await callTushare('get_stock_company_info', { code });
    
    if (result.error) {
      console.error('获取公司信息失败:', result.error);
      return {
        gsjs: '',
        sshy: '',
        dsz: '',
        zcdz: '',
        clrq: '',
        ssrq: '',
      };
    }
    
    return {
      gsjs: result.gsjs,
      sshy: result.sshy,
      dsz: result.dsz,
      zcdz: result.zcdz,
      clrq: result.clrq,
      ssrq: result.ssrq,
    };
  } catch (error) {
    logError(error, 'GetCompanyFromTushare', '获取公司信息失败');
    return {
      gsjs: '',
      sshy: '',
      dsz: '',
      zcdz: '',
      clrq: '',
      ssrq: '',
    };
  }
}

// ==================== 新闻研报 ====================

export async function GetNewsFromTushare(secid: string, pageIndex: number = 1, pageSize: number = 20): Promise<any[]> {
  try {
    const code = secid.split('.').pop() || secid;
    const result = await callTushare('get_stock_news', { code, page: pageIndex, page_size: pageSize });
    
    if (result.error) {
      console.error('获取新闻失败:', result.error);
      return [];
    }
    
    return result.map((item: any) => ({
      newsid: Utils.MakeHash(),
      title: item.title,
      url: '',
      time: item.time,
    }));
  } catch (error) {
    logError(error, 'GetNewsFromTushare', '获取新闻失败');
    return [];
  }
}

export async function GetResearchesFromTushare(secid: string, page: number = 1): Promise<any[]> {
  try {
    const code = secid.split('.').pop() || secid;
    const result = await callTushare('get_research_reports', { code });
    
    if (result.error) {
      console.error('获取研报失败:', result.error);
      return [];
    }
    
    return result.map((item: any) => ({
      title: item.title,
      source: item.source,
      author: item.author,
      publish_time: item.time,
      rating: item.rating,
    }));
  } catch (error) {
    logError(error, 'GetResearchesFromTushare', '获取研报失败');
    return [];
  }
}

// ==================== 资金流向 ====================

export async function GetMoneyFlowFromTushare(secid: string): Promise<any> {
  try {
    const code = secid.split('.').pop() || secid;
    const result = await callTushare('get_money_flow', { code });
    
    if (result.error) {
      console.error('获取资金流向失败:', result.error);
      return null;
    }
    
    return {
      main: result.main_in,
      small: result.small_in,
      medium: result.medium_in,
      big: result.big_in,
      superbig: result.super_big_in,
    };
  } catch (error) {
    logError(error, 'GetMoneyFlowFromTushare', '获取资金流向失败');
    return null;
  }
}

// ==================== 基本面数据 ====================

export async function GetFundamentalFromTushare(secid: string): Promise<any> {
  try {
    const code = secid.split('.').pop() || secid;
    const result = await callTushare('get_stock_fundamental', { code });
    
    if (result.error) {
      console.error('获取基本面数据失败:', result.error);
      return null;
    }
    
    return result;
  } catch (error) {
    logError(error, 'GetFundamentalFromTushare', '获取基本面数据失败');
    return null;
  }
}

// ==================== 财务数据 ====================

export async function GetFinanceDataFromTushare(secid: string): Promise<any> {
  try {
    const code = secid.split('.').pop() || secid;
    const result = await callTushare('get_stock_finance_data', { code });
    
    if (result.error) {
      console.error('获取财务数据失败:', result.error);
      return null;
    }
    
    return result;
  } catch (error) {
    logError(error, 'GetFinanceDataFromTushare', '获取财务数据失败');
    return null;
  }
}

// ==================== 强势股票 ====================

/**
 * 获取指定日期的强势股票（60日新高 或 涨停）
 * 优先读本地缓存，未命中则调用 Tushare 生成
 */
export async function GetStrongStocksFromTushare(date: string): Promise<any> {
  try {
    const queryDate = date.replace(/-/g, '');

    // 1. 先读本地缓存（QSList backup）
    try {
      const cached = await Helpers.Storage.ReadQSListBackup(queryDate);
      if (cached?.data?.stocks) {
        console.log(`[StrongStocks] 缓存命中: ${date}`);
        return cached.data;
      }
    } catch (e) {
      // 缓存不存在
    }

    // 2. 调用 Python 生成
    console.log(`[StrongStocks] 生成强势股票: ${date}`);
    const result = await callTushare('get_strong_stocks', { date: queryDate });

    if (result.error) {
      console.error('生成强势股票失败:', result.error);
      return { stocks: [], date: queryDate, count: 0 };
    }

    // 3. 写入本地缓存（QSList backup）
    try {
      await Helpers.Storage.WriteQSListBackup(queryDate, result);
      console.log(`[StrongStocks] 已缓存: ${date}, ${result.count} 只`);
    } catch (e) {
      console.error('缓存强势股票失败:', e);
    }

    return result;
  } catch (error) {
    logError(error, 'GetStrongStocksFromTushare', '获取强势股票失败');
    return { stocks: [], date: date.replace(/-/g, ''), count: 0 };
  }
}

/**
 * 批量生成指定时间段的每日强势股票（回测预生成用）
 * 返回按日期分组的对象
 */
export async function BatchGetStrongStocksFromTushare(startDate: string, endDate: string): Promise<Record<string, any>> {
  try {
    const start = startDate.replace(/-/g, '');
    const end = endDate.replace(/-/g, '');

    // 1. 逐日检查 QSList backup 缓存
    const allDates: string[] = [];
    let current = dayjs(startDate);
    const endDay = dayjs(endDate);
    while (!current.isAfter(endDay, 'day')) {
      allDates.push(current.format('YYYYMMDD'));
      current = current.add(1, 'day');
    }

    const cachedDates: Record<string, any> = {};
    const missingDates: string[] = [];

    for (const d of allDates) {
      try {
        const cached = await Helpers.Storage.ReadQSListBackup(d);
        if (cached?.data?.stocks) {
          cachedDates[d] = cached.data;
        } else {
          missingDates.push(d);
        }
      } catch (e) {
        missingDates.push(d);
      }
    }

    if (missingDates.length === 0) {
      console.log(`[StrongStocks] 批量缓存全部命中: ${startDate} ~ ${endDate}`);
      return cachedDates;
    }

    console.log(`[StrongStocks] 批量生成: ${startDate} ~ ${endDate}, 缺失 ${missingDates.length} 天`);
    const result = await callTushare('get_strong_stocks_batch', { start_date: start, end_date: end });

    if (result.error || !result.dates) {
      console.error('批量生成强势股票失败:', result.error);
      // 如果有部分缓存，返回部分缓存（降级）
      if (Object.keys(cachedDates).length > 0) {
        return cachedDates;
      }
      return {};
    }

    // 逐日写入 QSList backup 缓存
    const dates = Object.keys(result.dates);
    for (const d of dates) {
      try {
        await Helpers.Storage.WriteQSListBackup(d, result.dates[d]);
        cachedDates[d] = result.dates[d];
      } catch (e) {
        // 单条缓存失败继续
      }
    }

    console.log(`[StrongStocks] 批量完成: ${dates.length} 天`);
    return cachedDates;
  } catch (error) {
    logError(error, 'BatchGetStrongStocksFromTushare', '批量生成强势股票失败');
    return {};
  }
}

/**
 * 批量获取多个交易日的市场上涨占比数据
 * @param dates 交易日期数组 (YYYYMMDD)
 * @returns 按日期分组的市场情绪数据
 */
export async function GetUpRatioFromTushare(dates: string[]): Promise<Record<string, any>> {
  if (!dates || dates.length === 0) {
    return {};
  }

  try {
    const result = await callTushare('get_up_down_ratio_batch', { dates });

    if (result.error || typeof result !== 'object') {
      console.error('批量获取涨跌比数据失败:', result.error || 'Invalid response');
      return {};
    }

    return result;
  } catch (error) {
    logError(error, 'GetUpDownRateFromTushare', '批量获取涨跌比数据失败');
    return {};
  }
}
// ==================== 涨停股票评分 (LimitUpScorer) ====================

/**
 * LimitUpScorer 评分结果维度详情
 */
export interface LimitUpDimensionDetail {
  score: number;
  weight: number;
  weighted: number;
  detail: Record<string, any>;
}

/**
 * LimitUpScorer 单只股票评分结果
 */
export interface LimitUpScoreResult {
  secid: string;
  ts_code: string;
  trade_date: string;
  name: string;
  total_score: number;
  grade: string;
  recommendation: string;
  penalty: number;
  dimension_scores: {
    topic_heat?: LimitUpDimensionDetail;
    ma60_break?: LimitUpDimensionDetail;
    trend_stage?: LimitUpDimensionDetail;
    relative_strength?: LimitUpDimensionDetail;
    stock_character?: LimitUpDimensionDetail;
  };
  weights: Record<string, number>;
}

/**
 * 调用 LimitUpScorer 对单只涨停股票进行评分
 * @param secid 股票ID，如 "0.000001"
 * @param tradeDate 交易日期 (YYYY-MM-DD)
 * @returns 评分结果
 */
export async function ScoreLimitUpStock(secid: string, tradeDate: string): Promise<LimitUpScoreResult | null> {
  try {
    const result = await callTushare('score_limit_up_stock', {
      secid,
      trade_date: tradeDate.replace(/-/g, ''),
    });
    if (result.error) {
      console.error('涨停评分失败:', result.error);
      return null;
    }
    return result as LimitUpScoreResult;
  } catch (error) {
    logError(error, 'ScoreLimitUpStock', '涨停评分失败');
    return null;
  }
}

// ==================== 综合查询 ====================

export async function FromTushare(secid: string): Promise<any> {
  // 获取股票综合数据（趋势+详情）
  try {
    const [trendResult, detailResult] = await Promise.all([
      GetTrendFromTushare(secid),
      GetDetailFromTushare(secid),
    ]);
    
    if (!trendResult || !detailResult) {
      return null;
    }
    
    const result: any = {
      ...detailResult,
      trends: trendResult.trends,
    };

    if (!result.secid) {
      result.secid = secid;
    }

    return result;
  } catch (error) {
    logError(error, 'FromTushare', '获取股票综合数据失败');
    return null;
  }
}

// ==================== 选股模块配置类型 ====================

export interface IndustryFilterConfig {
  /** 资金流入计算天数，默认 5 */
  fund_flow_days?: number;
  /** 资金流入排名百分比(前30%)，默认 0.3 */
  fund_flow_rank_pct?: number;
  /** 最小5日涨幅(%)，默认 2.0 */
  min_return_5d?: number;
  /** 最小相对强弱，默认 1.1 */
  min_rs?: number;
  /** 是否要求均线多头排列，默认 true */
  require_ma_bull?: boolean;
}

export interface StockFilterConfig {
  /** 行业内选取龙头数量，默认 5 */
  leader_top_n?: number;
  /** 最小流通市值(亿)，默认 20 */
  min_circ_mv?: number;
  /** 最大流通市值(亿)，默认 800 */
  max_circ_mv?: number;
  /** 最小日均成交额(万)，默认 5000 */
  min_avg_amount?: number;
  /** 最小扣非净利润增速(%)，默认 -30 */
  min_profit_growth?: number;
  /** 距近期高点最大回撤(%)，默认 15 */
  max_decline_from_high?: number;
  /** 是否要求股价在年线上方，默认 false */
  require_above_ma250?: boolean;
}

export interface BuySignalConfig {
  /** 策略类型: breakout(突破)/callback(回调)/both，默认 breakout */
  strategy?: string;
  /** 突破时量比要求，默认 1.5 */
  breakout_volume_ratio?: number;
  /** 回调至哪条均线，默认 ma10 */
  callback_to_ma?: string;
  /** 最大回调深度(%)，默认 8 */
  max_callback_depth?: number;
}

// ==================== 选股模块 - 步骤拆分接口 ====================

/**
 * 步骤1: 筛选值得投资的二级行业
 *
 * 基于趋势得分、资金流入、均线多头排列综合筛选，返回符合条件的行业列表。
 * 可独立调用，用于观察当前哪些行业处于强势状态。
 *
 * @param tradeDate 交易日期(YYYY-MM-DD 或 YYYYMMDD)
 * @param config 行业筛选配置
 * @returns { industries: [...], count: N, trade_date: "..." }
 */
export async function FilterIndustriesFromTushare(
  tradeDate: string,
  config?: IndustryFilterConfig,
  return_all?: boolean
): Promise<any> {
  try {
    const result = await callTushare('filter_industries', {
      trade_date: tradeDate.replace(/-/g, ''),
      ...config,
      return_all,
    });
    if (result.error) {
      console.error('行业筛选失败:', result.error);
      return { industries: [], count: 0 };
    }
    return result;
  } catch (error) {
    logError(error, 'FilterIndustriesFromTushare', '行业筛选失败');
    return { industries: [], count: 0 };
  }
}

/**
 * 步骤2: 识别某行业的龙头股票
 *
 * 对指定行业的所有成分股计算龙头得分（涨幅、资金流入、涨停次数、行业相关性），
 * 按得分降序返回前 N 只。可独立调用，用于观察某行业内的强势股。
 *
 * @param industryCode 行业指数代码，如 "801010.SI"（申万二级）
 * @param tradeDate 交易日期
 * @param topN 返回前 N 只龙头，默认 10
 * @returns { leaders: [...], count: N, industry_code: "..." }
 */
export async function GetIndustryLeadersFromTushare(
  industryCode: string,
  tradeDate: string,
  topN?: number
): Promise<any> {
  try {
    const result = await callTushare('get_industry_leaders', {
      industry_code: industryCode,
      trade_date: tradeDate.replace(/-/g, ''),
      top_n: topN || 10,
    });
    if (result.error) {
      console.error('行业龙头识别失败:', result.error);
      return { leaders: [], count: 0 };
    }
    return result;
  } catch (error) {
    logError(error, 'GetIndustryLeadersFromTushare', '行业龙头识别失败');
    return { leaders: [], count: 0 };
  }
}

/**
 * 步骤3: 对股票列表进行排雷过滤
 *
 * 对传入的股票列表逐一检查风险指标：流通市值、日均成交额、业绩增速、
 * 距高点回撤、年线位置。返回每只股票是否通过及未通过原因。
 * 可独立调用，用于对自选股或观察列表进行风险排查。
 *
 * @param tradeDate 交易日期
 * @param stocks ts_code 数组，如 ["000001.SZ", "600000.SH"]
 * @param config 个股筛选配置
 * @returns { results: [{ts_code, passed, reason}], count, passed_count }
 */
export async function RiskFilterStocksFromTushare(
  tradeDate: string,
  stocks: string[],
  config?: StockFilterConfig
): Promise<any> {
  try {
    const result = await callTushare('risk_filter_stocks', {
      trade_date: tradeDate.replace(/-/g, ''),
      stocks,
      ...config,
    });
    if (result.error) {
      console.error('排雷过滤失败:', result.error);
      return { results: [], count: 0, passed_count: 0 };
    }
    return result;
  } catch (error) {
    logError(error, 'RiskFilterStocksFromTushare', '排雷过滤失败');
    return { results: [], count: 0, passed_count: 0 };
  }
}

/**
 * 步骤4: 对股票列表检查买入信号
 *
 * 对传入的股票列表检查突破信号（放量突破近期高点）或回调信号（回调至均线附近）。
 * 返回每只股票是否有信号、信号类型及信号详情。
 * 可独立调用，用于对候选股票进行择时判断。
 *
 * @param tradeDate 交易日期
 * @param stocks ts_code 数组
 * @param config 买入信号配置
 * @returns { results: [{ts_code, has_signal, signal_type, signal_detail}], count, signal_count }
 */
export async function CheckBuySignalsFromTushare(
  tradeDate: string,
  stocks: string[],
  config?: BuySignalConfig
): Promise<any> {
  try {
    const result = await callTushare('check_buy_signals', {
      trade_date: tradeDate.replace(/-/g, ''),
      stocks,
      ...config,
    });
    if (result.error) {
      console.error('买入信号检查失败:', result.error);
      return { results: [], count: 0, signal_count: 0 };
    }
    return result;
  } catch (error) {
    logError(error, 'CheckBuySignalsFromTushare', '买入信号检查失败');
    return { results: [], count: 0, signal_count: 0 };
  }
}

/**
 * 完整选股流程: 行业筛选 -> 龙头识别 -> 排雷过滤 -> 择时信号
 *
 * 一键执行全部步骤，返回带 final_score 的最终候选列表。
 * 适合每日收盘后自动执行或手动一键选股。
 *
 * @param tradeDate 交易日期
 * @param industryConfig 行业筛选配置
 * @param stockConfig 个股筛选配置
 * @param buyConfig 买入信号配置
 * @param topIndustries 选取前 N 个行业，默认 5
 * @param topStocksPerIndustry 每个行业选取前 N 只，默认 3
 * @returns { results: [...], count: N, trade_date: "..." }
 */
export async function SelectStocksFromTushare(
  tradeDate: string,
  industryConfig?: IndustryFilterConfig,
  stockConfig?: StockFilterConfig,
  buyConfig?: BuySignalConfig,
  topIndustries?: number,
  topStocksPerIndustry?: number
): Promise<any> {
  try {
    const result = await callTushare('select_stocks', {
      trade_date: tradeDate.replace(/-/g, ''),
      industry_config: industryConfig || {},
      stock_config: stockConfig || {},
      buy_config: buyConfig || {},
      top_industries: topIndustries || 5,
      top_stocks_per_industry: topStocksPerIndustry || 3,
    });
    if (result.error) {
      console.error('选股失败:', result.error);
      return { results: [], count: 0 };
    }
    return result;
  } catch (error) {
    logError(error, 'SelectStocksFromTushare', '选股失败');
    return { results: [], count: 0 };
  }
}


// ==================== 申万行业成分股 ====================

/**
 * 获取申万二级行业成分股（支持 801010.SI 格式）
 * @param secid 申万行业代码，如 "801010.SI" 或 "90.801010"
 * @param date 查询日期(YYYYMMDD)，不传则默认最近交易日
 * @returns 兼容 GetBankuaiStocksFromTushare 的返回格式
 */
export async function GetIndustryStocksFromTushare(secid: string, date?: string): Promise<any> {
  try {
    const params: Record<string, any> = { secid };
    if (date) params.date = date;

    const result = await callTushare('get_industry_stocks', params);

    if (result.error) {
      console.error('获取申万行业成分股失败:', result.error);
      return { total: 0, stocks: [] };
    }

    return result;
  } catch (error) {
    logError(error, 'GetIndustryStocksFromTushare', '获取申万行业成分股失败');
    return { total: 0, stocks: [] };
  }
}