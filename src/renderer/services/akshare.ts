/**
 * Akshare Python 库调用服务
 * 用于替换原有的 eastmoney.com 直接 HTTP 调用
 */

import dayjs from 'dayjs';
import NP from 'number-precision';
import * as Utils from '@/utils';
import { KLineType, StockMarketType } from '@/utils/enums';
import { Stock } from '@/types/stock';
import * as Helpers from '../helpers';

const { execPyScript } = window.contextModules.electron;

// Python 脚本路径
const AKSHARE_SCRIPT = 'akshare_api.py';

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
 * 调用 Python akshare 脚本
 * @param method 方法名
 * @param params 参数对象
 * @returns Promise<any>
 */
async function callAkshare(method: string, params: Record<string, any> = {}): Promise<any> {
  try {
    const result = await execPyScript(AKSHARE_SCRIPT, [method, '--params', JSON.stringify(params)]);
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

// ==================== 搜索相关 ====================

export async function SearchFromAkshare(keyword: string): Promise<any[]> {
  try {
    const result = await callAkshare('search_stock', { keyword });
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
    logError(error, 'SearchFromAkshare', '搜索股票失败');
    return [];
  }
}

// ==================== 实时行情 ====================

export async function GetDetailFromAkshare(secid: string): Promise<Stock.DetailItem | null> {
  try {
    const result = await callAkshare('get_stock_realtime', { secid });
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
      // 买卖五档数据 akshare 可能无法提供，设置为 0
      b1: 0, b1p: 0, b2: 0, b2p: 0, b3: 0, b3p: 0, b4: 0, b4p: 0, b5: 0, b5p: 0,
      s1: 0, s1p: 0, s2: 0, s2p: 0, s3: 0, s3p: 0, s4: 0, s4p: 0, s5: 0, s5p: 0,
    } as Stock.DetailItem;
  } catch (error) {
    logError(error, 'GetDetailFromAkshare', '获取股票详情失败');
    return null;
  }
}

// ==================== K 线数据 (腾讯财经数据源) ====================
/**
 * 获取K线数据 - 使用腾讯财经数据源
 * 
 * 数据源: 腾讯财经 (stock_zh_a_hist_tx)
 * 支持: 日K线(通过日K接口获取)、周/月K线(通过日K聚合)
 * 复权: 支持前复权(qfq)、后复权(hfq)、不复权
 */
export async function GetKFromAkshare(secid: string, code: number, limit?: number): Promise<{ ks: Stock.KLineItem[], kt: number }> {
  try {
    // 映射 K 线类型
    const periodMap: Record<number, string> = {
      [KLineType.Day]: 'daily',
      [KLineType.Week]: 'weekly',
      [KLineType.Month]: 'monthly',
    };
    
    const period = periodMap[code] || 'daily';
    const result = await callAkshare('get_kline_data', { secid, period });
    
    if (result.error) {
      console.error('获取K线失败:', result.error);
      return { ks: [], kt: code };
    }
    
    // 限制数量
    let klines = result;
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
    logError(error, 'GetKFromAkshare', '获取K线数据失败');
    return { ks: [], kt: code };
  }
}

// ==================== 分时走势 (腾讯财经数据源) ====================
/**
 * 获取分时走势数据 - 使用腾讯财经数据源
 * 
 * 数据源: 腾讯财经 (stock_zh_a_tick_tx_js)
 * 数据类型: 当日分笔成交数据
 * 备用: 如腾讯接口失败，自动切换到 163 数据源
 */
export async function GetTrendFromAkshare(secid: string): Promise<{ secid: string, trends: Stock.TrendItem[] }> {
  try {
    const result = await callAkshare('get_stock_trend', { secid });
    if (result.error) {
      console.error('获取分时数据失败:', result.error);
      return { secid, trends: [] };
    }
    
    const trends = result.map((item: any) => ({
      datetime: item.datetime,
      current: item.current,
      last: item.last,
      vol: item.vol,
      average: 0,
      up: item.current >= item.last ? 1 : -1,
    }));
    
    return { secid, trends };
  } catch (error) {
    logError(error, 'GetTrendFromAkshare', '获取分时走势失败');
    return { secid, trends: [] };
  }
}

// ==================== 板块数据 ====================

export async function GetBanKuaisFromAkshare(type: number, pageSize = 20): Promise<any> {
  try {
    const bk_type = type === 0 ? 'industry' : 'concept';
    const result = await callAkshare('get_sector_boards', { bk_type });
    
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
    logError(error, 'GetBanKuaisFromAkshare', '获取板块数据失败');
    return {};
  }
}

// ==================== 涨停跌停数据 ====================

export async function GeZTStocksFromAkshare(pageSize = 20, date?: string): Promise<any> {
  try {
    const params: any = {};
    if (date) params.date = date;
    
    const result = await callAkshare('get_limit_up_stocks', params);
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
    logError(error, 'GeZTStocksFromAkshare', '获取涨停股票失败');
    return {};
  }
}

export async function GeDTStocksFromAkshare(pageSize = 20, date?: string): Promise<any> {
  try {
    const params: any = {};
    if (date) params.date = date;
    
    const result = await callAkshare('get_limit_down_stocks', params);
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
    logError(error, 'GeDTStocksFromAkshare', '获取跌停股票失败');
    return {};
  }
}

// ==================== 公司信息 ====================

export async function GetCompanyFromAkshare(secid: string): Promise<Stock.Company> {
  try {
    const code = secid.split('.').pop() || secid;
    const result = await callAkshare('get_stock_company_info', { code });
    
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
    logError(error, 'GetCompanyFromAkshare', '获取公司信息失败');
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

export async function GetNewsFromAkshare(secid: string, pageIndex: number = 1, pageSize: number = 20): Promise<any[]> {
  try {
    const code = secid.split('.').pop() || secid;
    const result = await callAkshare('get_stock_news', { code, page: pageIndex, page_size: pageSize });
    
    if (result.error) {
      console.error('获取新闻失败:', result.error);
      return [];
    }
    
    return result.map((item: any) => ({
      newsid: Utils.MakeHash(),
      title: item.title,
      url: '', // akshare 可能不提供 URL
      time: item.time,
    }));
  } catch (error) {
    logError(error, 'GetNewsFromAkshare', '获取新闻失败');
    return [];
  }
}

export async function GetResearchesFromAkshare(secid: string, page: number = 1): Promise<any[]> {
  try {
    const code = secid.split('.').pop() || secid;
    const result = await callAkshare('get_research_reports', { code });
    
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
    logError(error, 'GetResearchesFromAkshare', '获取研报失败');
    return [];
  }
}

// ==================== 资金流向 ====================

export async function GetMoneyFlowFromAkshare(secid: string): Promise<any> {
  try {
    const code = secid.split('.').pop() || secid;
    const result = await callAkshare('get_money_flow', { code });
    
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
    logError(error, 'GetMoneyFlowFromAkshare', '获取资金流向失败');
    return null;
  }
}

// ==================== 综合查询 ====================

export async function FromAkshare(secid: string): Promise<any> {
  """获取股票综合数据（趋势+详情）"""
  try {
    const [trendResult, detailResult] = await Promise.all([
      GetTrendFromAkshare(secid),
      GetDetailFromAkshare(secid),
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
    logError(error, 'FromAkshare', '获取股票综合数据失败');
    return null;
  }
}

// ==================== 导出枚举 ====================

export enum DataSourceType {
  Eastmoney = 'eastmoney',
  Akshare = 'akshare',
}
