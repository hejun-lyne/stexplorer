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

const { execPyScript } = window.contextModules.electron;

// Python 脚本路径
const TUSHARE_SCRIPT = 'tushare_api.py';

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
    const result = await execPyScript(TUSHARE_SCRIPT, args);
    // Python 脚本会输出 JSON 字符串
    if (Array.isArray(result) && result.length > 0) {
      const output = result[result.length - 1]; // 取最后一行输出
      return JSON.parse(output);
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
  const checkDate = date || dayjs().format('YYYYMMDD');
  const cleanDate = checkDate.replace(/-/g, '');
  const year = cleanDate.substring(0, 4);
  
  // 1. 先读本地缓存
  try {
    const cached = await window.contextModules.electron.sqliteRead(TRADE_CALENDAR_TABLE, year);
    if (cached?.success && cached.data?.data?.dates) {
      const dates: string[] = cached.data.data.dates;
      return dates.includes(cleanDate);
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
  
  return dates.includes(cleanDate);
}

/**
 * 批量判断多个日期是否为交易日
 */
export async function FilterTradeDays(dates: string[]): Promise<string[]> {
  if (dates.length === 0) return [];
  
  // 按年份分组，减少缓存查询次数
  const yearMap: Record<string, string[]> = {};
  dates.forEach(d => {
    const clean = d.replace(/-/g, '');
    const year = clean.substring(0, 4);
    if (!yearMap[year]) yearMap[year] = [];
    yearMap[year].push(clean);
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
    const result = await callTushare('get_kline_data', { secid, period });

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
    }));

    return { ks, kt: code };
  } catch (error) {
    logError(error, 'GetKFromTushare', '获取K线数据失败');
    return { ks: [], kt: code };
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

export async function GetBanKuaisFromTushare(type: number, pageSize = 20): Promise<any> {
  try {
    const bk_type = type === 0 ? 'industry' : 'concept';
    const result = await callTushare('get_sector_boards', { bk_type });
    
    if (result.error) {
      console.error('获取板块失败:', result.error);
      return {};
    }
    
    const arr = result.slice(0, pageSize).map((item: any) => ({
      code: item.code,
      name: item.name,
      market: 90,
      secid: `90.${item.code}`,
      zx: 0,
      zdd: 0,
      zdf: item.zdf,
      hsl: 0,
      zsz: item.zsz,
      szs: 0,
      xds: 0,
    }));
    
    return { to: result.length, arr };
  } catch (error) {
    logError(error, 'GetBanKuaisFromTushare', '获取板块数据失败');
    return {};
  }
}

// ==================== 板块成分股 ====================

export async function GetBankuaiStocksFromTushare(secid: string, count = 20): Promise<any> {
  try {
    const result = await callTushare('get_board_stocks', { secid, count });
    
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
    
    return {
      secid,
      ...detailResult,
      trends: trendResult.trends,
    };
  } catch (error) {
    logError(error, 'FromTushare', '获取股票综合数据失败');
    return null;
  }
}
