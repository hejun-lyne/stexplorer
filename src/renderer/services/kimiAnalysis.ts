/**
 * Kimi 分析服务
 * 负责分析过程调用、工具执行、结果缓存管理
 * 与 UI 解耦，即使页面切换或关闭也能保持分析状态和结果
 */
import { Stock } from '@/types/stock';
import * as AkshareAPI from '@/services/akshare';
import * as Services from '@/services';
import dayjs from 'dayjs';
import { calculateMACD, calculateRSI } from '@/helpers/tech';
import { BacktestRSIBounce } from '@/helpers/stock';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  analysisType?: AnalysisType;
  timestamp: number;
}

export type AnalysisType = 'tech' | 'event' | 'fundamental' | 'custom';
export type DataPrecision = 'fast' | 'deep';

export interface AnalysisOption {
  type: AnalysisType;
  label: string;
  color: string;
}

export const analysisOptions: AnalysisOption[] = [
  { type: 'tech', label: '技术分析', color: '#1890ff' },
  { type: 'event', label: '事件热点', color: '#fa8c16' },
  { type: 'fundamental', label: '基本面分析', color: '#722ed1' },
];

export const typeNames: Record<AnalysisType, string> = {
  tech: '结合分时和K线进行分析',
  event: '事件热点分析',
  fundamental: '基本面分析',
};

export const SYSTEM_PROMPT = `你是股票分析师，客观专业，风险提示充分，中文回答，格式清晰。数据格式说明：【】内为数据类别，| 分隔不同字段，表格有明确的列标题。`;

export const MAX_HISTORY_ROUNDS = 0;

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_trend',
      description: '获取今日分时数据（价格/均价/成交量），技术分析时调用',
      parameters: {
        type: 'object',
        properties: {
          secid: { type: 'string', description: 'secid如0.002594' },
        },
        required: ['secid'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_kline',
      description: '获取K线数据（开收高低/成交量/涨跌幅），K线分析时调用',
      parameters: {
        type: 'object',
        properties: {
          secid: { type: 'string' },
          period: { type: 'string', enum: ['day', 'week', 'month'] },
          count: { type: 'number', description: '默认30' },
        },
        required: ['secid'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_fundamental',
      description: '获取财务指标（ROE/营收/毛利率/负债率/现金流），基本面分析时调用',
      parameters: {
        type: 'object',
        properties: {
          secid: { type: 'string' },
        },
        required: ['secid'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_finance',
      description: '获取三大报表摘要（资产负债/利润/现金流量表），财务分析时调用',
      parameters: {
        type: 'object',
        properties: {
          secid: { type: 'string' },
        },
        required: ['secid'],
      },
    },
  },
  // ===== 事件热点分析专用工具 =====
  {
    type: 'function',
    function: {
      name: 'get_news',
      description: '股票新闻',
      parameters: {
        type: 'object',
        properties: {
          secid: { type: 'string', description: 'secid如1.603829' },
        },
        required: ['secid'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_researches',
      description: '机构研报',
      parameters: {
        type: 'object',
        properties: {
          secid: { type: 'string' },
        },
        required: ['secid'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_themes',
      description: '概念题材',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '纯股票代码如603829' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_longhubang',
      description: '龙虎榜',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '纯股票代码如603829' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_events',
      description: '公司事件',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '纯股票代码如603829' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_moneyflow',
      description: '资金流向',
      parameters: {
        type: 'object',
        properties: {
          secid: { type: 'string' },
        },
        required: ['secid'],
      },
    },
  },
];

export function getToolsByType(type?: AnalysisType) {
  switch (type) {
    case 'tech':
      return TOOLS.filter((t) => ['get_trend', 'get_kline'].includes(t.function.name));
    case 'fundamental':
      return TOOLS.filter((t) => ['get_fundamental', 'get_finance'].includes(t.function.name));
    case 'event':
      return TOOLS.filter((t) =>
        ['get_news', 'get_researches', 'get_themes', 'get_longhubang', 'get_events', 'get_moneyflow'].includes(
          t.function.name
        )
      );
    default:
      return TOOLS;
  }
}

export function getDataPrecision(type?: AnalysisType): DataPrecision {
  switch (type) {
    case 'tech':
      return 'deep';
    case 'fundamental':
    case 'event':
    default:
      return 'fast';
  }
}

// ===== Markdown 解析工具 =====
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseInline(text: string): string {
  return text
    .replace(/~~(.*?)~~/g, '<del>$1</del>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function parseMarkdown(text: string): string {
  if (!text) return '';
  const lines = text.split('\n');
  let result = '';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      let code = '';
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code += lines[i] + '\n';
        i++;
      }
      i++;
      result += `<pre><code${lang ? ` class="language-${lang}"` : ''}>${escapeHtml(code.slice(0, -1))}</code></pre>`;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2].trim();
      result += `<h${level}>${parseInline(escapeHtml(content))}</h${level}>`;
      i++;
      continue;
    }

    if (line.trim().match(/^(-{3,}|\*{3,}|_{3,})\s*$/)) {
      result += '<hr/>';
      i++;
      continue;
    }

    if (line.trim().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      if (tableLines.length >= 2 && tableLines[1].trim().match(/^\|?[\s\-:|]+\|?$/)) {
        const headers = tableLines[0].split('|').map((c) => c.trim()).filter((c) => c);
        const bodyRows = tableLines.slice(2);
        let tableHtml = '<div class="md-table-wrapper"><table><thead><tr>';
        headers.forEach((h) => {
          tableHtml += `<th>${parseInline(escapeHtml(h))}</th>`;
        });
        tableHtml += '</tr></thead><tbody>';
        bodyRows.forEach((row) => {
          const cells = row.split('|').map((c) => c.trim()).filter((c) => c);
          tableHtml += '<tr>';
          cells.forEach((c) => {
            tableHtml += `<td>${parseInline(escapeHtml(c))}</td>`;
          });
          tableHtml += '</tr>';
        });
        tableHtml += '</tbody></table></div>';
        result += tableHtml;
        continue;
      } else {
        i -= tableLines.length;
      }
    }

    if (line.trim().startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().slice(1).trim());
        i++;
      }
      const quoteText = quoteLines.join('\n');
      result += `<blockquote>${parseInline(escapeHtml(quoteText))}</blockquote>`;
      continue;
    }

    if (line.trim().match(/^[-*]\s/)) {
      result += '<ul>';
      while (i < lines.length && lines[i].trim().match(/^[-*]\s/)) {
        const content = lines[i].trim().slice(2);
        result += `<li>${parseInline(escapeHtml(content))}</li>`;
        i++;
      }
      result += '</ul>';
      continue;
    }

    if (line.trim().match(/^\d+\.\s/)) {
      result += '<ol>';
      while (i < lines.length && lines[i].trim().match(/^\d+\.\s/)) {
        const content = lines[i].trim().replace(/^\d+\.\s/, '');
        result += `<li>${parseInline(escapeHtml(content))}</li>`;
        i++;
      }
      result += '</ol>';
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    let para = '';
    while (i < lines.length && lines[i].trim() !== '') {
      para += lines[i] + ' ';
      i++;
    }
    result += `<p>${parseInline(escapeHtml(para.trim()))}</p>`;
  }

  return result;
}

// ===== 股票基础信息构建 =====
export function buildBaseInfo(detail: Stock.DetailItem): string {
  const fields: [string, any, string?][] = [
    ['名称', detail.name],
    ['代码', detail.code],
    ['板块', detail.bk],
    ['最新价', detail.zx, '元'],
    ['涨跌幅', detail.zdf, '%'],
    ['换手率', detail.hsl ? detail.hsl / 100 : null, '%'],
    ['市盈率TTM', (detail as any).pettm],
    ['市净率', (detail as any).pb],
    ['总市值', (detail as any).zsz ? ((detail as any).zsz / 1e8).toFixed(2) + '亿' : null],
  ];

  const lines = fields
    .filter(([_, v]) => v != null && v !== '' && v !== '未知')
    .map(([k, v, unit]) => `${k}：${v}${unit || ''}`);

  return lines.length > 0 ? `【股票信息】\n${lines.join(' | ')}` : '';
}

// ===== 双模式分时数据 =====
export function formatTrendData(trendData?: Stock.TrendItem[], mode: DataPrecision = 'fast'): string {
  if (!trendData || trendData.length === 0) return '【分时数据】暂无';

  const prices = trendData.map((t) => t.current);
  const avg = prices.reduce((a, b) => a + b) / prices.length;
  const max = Math.max(...prices);
  const min = Math.min(...prices);
  const volSum = trendData.reduce((s, t) => s + (t.vol || 0), 0);

  const stats = `【分时统计】均价${avg.toFixed(2)} | 最高${max.toFixed(2)} | 最低${min.toFixed(2)} | 总成交${volSum}手`;

  if (mode === 'deep') {
    const sampled = trendData.filter((_, i) => i % 5 === 0);
    const rows = sampled.map((t) => `${t.datetime.slice(-8)}  ${t.current.toFixed(2)}  ${t.vol || 0}`);
    return `${stats}\n【分时明细】(每5分钟采样)\n时间        价格    成交量\n${rows.join('\n')}`;
  }

  // fast 模式
  const n = trendData.length;
  const keyPoints = [
    trendData[0],
    trendData[Math.floor(n / 4)],
    trendData[Math.floor(n / 2)],
    trendData[Math.floor((3 * n) / 4)],
    trendData[n - 1],
  ];
  const keyRows = keyPoints.map((t) => `${t.datetime.slice(-8)}  ${t.current.toFixed(2)}`);

  return `${stats}\n【关键点位】\n${keyRows.join('\n')}`;
}

// ===== 双模式K线数据 =====
export function formatKlineData(klineData?: Stock.KLineItem[], mode: DataPrecision = 'fast'): string {
  if (!klineData || klineData.length === 0) return '【K线数据】暂无';

  if (mode === 'deep') {
    const recent = klineData.slice(-60);
    const summary = {
      upDays: recent.filter((k) => k.zdf > 0).length,
      downDays: recent.filter((k) => k.zdf < 0).length,
      avgVol: Math.round(recent.reduce((s, k) => s + k.cjl, 0) / recent.length),
      maxZdf: Math.max(...recent.map((k) => k.zdf)),
      minZdf: Math.min(...recent.map((k) => k.zdf)),
    };

    const rows = recent.map(
      (k) =>
        `${k.date}  ${k.kp.toFixed(2)}  ${k.sp.toFixed(2)}  ${k.zg.toFixed(2)}  ${k.zd.toFixed(2)}  ${(
          k.cjl / 1e4
        ).toFixed(1)}万  ${k.zdf.toFixed(2)}%`
    );

    return `【K线统计】近${recent.length}日：涨${summary.upDays}天 | 跌${summary.downDays}天 | 均量${(
      summary.avgVol / 1e4
    ).toFixed(1)}万手 | 最大涨幅${summary.maxZdf.toFixed(1)}% | 最大跌幅${summary.minZdf.toFixed(1)}%
  【K线明细】
  日期        开盘    收盘    最高    最低    成交量    涨跌幅
  ${rows.join('\n')}`;
  }

  // fast 模式
  const recent = klineData.slice(-20);
  const summary = {
    upDays: recent.filter((k) => k.zdf > 0).length,
    downDays: recent.filter((k) => k.zdf < 0).length,
    avgVol: Math.round(recent.reduce((s, k) => s + k.cjl, 0) / recent.length),
    maxZdf: Math.max(...recent.map((k) => k.zdf)),
    minZdf: Math.min(...recent.map((k) => k.zdf)),
  };

  const rows = recent.map(
    (k) => `${k.date}  ${k.sp.toFixed(2)}  ${k.zdf > 0 ? '+' : ''}${k.zdf.toFixed(1)}%  ${(k.cjl / 1e4).toFixed(1)}万`
  );

  return `【K线统计】近${recent.length}日：涨${summary.upDays}天 | 跌${summary.downDays}天 | 均量${(
    summary.avgVol / 1e4
  ).toFixed(1)}万手
  【K线明细】
  日期        收盘    涨跌幅    成交量
  ${rows.join('\n')}`;
}

// ===== RSI 回测 =====
function backtestRSI(
  klineData: Stock.KLineItem[],
  closes: number[],
  rsi6: number[],
  currentIdx: number
) {
  const overbought: Array<{ after5: number; after10: number }> = [];
  const oversold: Array<{ after5: number; after10: number }> = [];
  const divergences: string[] = [];

  for (let i = 14; i < currentIdx - 10; i++) {
    if (rsi6[i] > 70) {
      overbought.push({
        after5: ((closes[i + 5] - closes[i]) / closes[i]) * 100,
        after10: ((closes[i + 10] - closes[i]) / closes[i]) * 100,
      });
    }
    if (rsi6[i] < 30) {
      oversold.push({
        after5: ((closes[i + 5] - closes[i]) / closes[i]) * 100,
        after10: ((closes[i + 10] - closes[i]) / closes[i]) * 100,
      });
    }
    if (i >= 5) {
      const priceHighNow = Math.max(...closes.slice(i - 4, i + 1));
      const priceHighPrev = Math.max(...closes.slice(i - 9, i - 4));
      const rsiHighNow = Math.max(...rsi6.slice(i - 4, i + 1));
      const rsiHighPrev = Math.max(...rsi6.slice(i - 9, i - 4));
      if (priceHighNow > priceHighPrev * 1.02 && rsiHighNow < rsiHighPrev * 0.98) {
        divergences.push(`${klineData[i].date.slice(-5)} 顶背离`);
      }
      const priceLowNow = Math.min(...closes.slice(i - 4, i + 1));
      const priceLowPrev = Math.min(...closes.slice(i - 9, i - 4));
      const rsiLowNow = Math.min(...rsi6.slice(i - 4, i + 1));
      const rsiLowPrev = Math.min(...rsi6.slice(i - 9, i - 4));
      if (priceLowNow < priceLowPrev * 0.98 && rsiLowNow > rsiLowPrev * 1.02) {
        divergences.push(`${klineData[i].date.slice(-5)} 底背离`);
      }
    }
  }

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const winRate = (arr: number[]) => (arr.length ? (arr.filter((v) => v > 0).length / arr.length) * 100 : 0);

  const currentRSI = rsi6[currentIdx];
  let currentState = '';
  if (currentRSI > 70) currentState = '超买区';
  else if (currentRSI < 30) currentState = '超卖区';
  else currentState = '中性区';

  return {
    overbought: overbought.length
      ? {
          count: overbought.length,
          avg5d: avg(overbought.map((m) => m.after5)),
          winRate5d: winRate(overbought.map((m) => m.after5)),
          avg10d: avg(overbought.map((m) => m.after10)),
        }
      : null,
    oversold: oversold.length
      ? {
          count: oversold.length,
          avg5d: avg(oversold.map((m) => m.after5)),
          winRate5d: winRate(oversold.map((m) => m.after5)),
          avg10d: avg(oversold.map((m) => m.after10)),
        }
      : null,
    divergences: divergences.slice(-5),
    currentState,
    currentRSI,
  };
}

// ===== 工具执行 =====
export async function executeTools(
  toolCalls: any[],
  precision: DataPrecision,
  stock: Stock.DetailItem,
  trends?: Stock.TrendItem[],
  klines?: Stock.KLineItem[]
): Promise<any[]> {
  const results: any[] = [];
  const getCode = (secid: string) => secid.split('.').pop() || '';

  for (const tc of toolCalls) {
    const name = tc.function?.name;
    const args = JSON.parse(tc.function?.arguments || '{}');
    let content = '';

    if (name === 'get_trend') {
      let trendData = trends;
      if (!trendData || trendData.length < 50) {
        try {
          const res = await AkshareAPI.GetTrendFromAkshare(stock?.secid || args.secid);
          if (res?.trends && res.trends.length > 0) {
            trendData = res.trends;
          }
        } catch (e) {
          console.error('Failed to fetch trend data:', e);
        }
      }
      content = `分时：${formatTrendData(trendData, precision)}`;
    } else if (name === 'get_kline') {
      let klineData = klines;
      if (!klineData || klineData.length < 5) {
        try {
          const res = await AkshareAPI.GetKFromAkshare(stock?.secid || args.secid, 101);
          if (res?.ks && res.ks.length > 0) klineData = res.ks;
        } catch (e) {
          console.error('Failed to fetch kline data:', e);
        }
      }

      let indicatorStr = '';
      let backtestStr = '';
      let rsiBacktestStr = '';

      if (klineData && klineData.length > 35) {
        const closes = klineData.map((k) => k.sp);
        const macdRes = calculateMACD(closes, 26, 12, 9);
        const dif = macdRes.MACD;
        const dea = macdRes.signal;
        const hist = macdRes.histogram;
        const rsi6 = calculateRSI(closes, 6);
        const rsi12 = calculateRSI(closes, 12);
        const rsi24 = calculateRSI(closes, 24);

        const idx = closes.length - 1;

        const lines: string[] = [];
        for (let i = Math.max(0, idx - 4); i <= idx; i++) {
          lines.push(
            `${klineData[i].date.slice(-5)} DIF:${dif[i].toFixed(2)} DEA:${dea[i].toFixed(2)} MACD:${hist[i].toFixed(
              2
            )} RSI6:${rsi6[i].toFixed(1)} RSI12:${rsi12[i].toFixed(1)} RSI24:${rsi24[i].toFixed(1)}`
          );
        }
        indicatorStr = `\n【技术指标】MACD/RSI最近5日：\n${lines.join('\n')}`;

        const prevIdx = idx - 1;
        const isGoldenCross = dif[idx] > dea[idx] && dif[prevIdx] <= dea[prevIdx];
        const isDeadCross = dif[idx] < dea[idx] && dif[prevIdx] >= dea[prevIdx];
        const state = isGoldenCross ? '金叉' : isDeadCross ? '死叉' : '中性';

        const matches: Array<{ after5: number; after10: number; after20: number }> = [];
        for (let i = 35; i < idx - 20; i++) {
          const prev = i - 1;
          const matchGolden = dif[i] > dea[i] && dif[prev] <= dea[prev];
          const matchDead = dif[i] < dea[i] && dif[prev] >= dea[prev];
          if ((state === '金叉' && matchGolden) || (state === '死叉' && matchDead)) {
            matches.push({
              after5: ((closes[i + 5] - closes[i]) / closes[i]) * 100,
              after10: ((closes[i + 10] - closes[i]) / closes[i]) * 100,
              after20: ((closes[i + 20] - closes[i]) / closes[i]) * 100,
            });
          }
        }

        if (matches.length > 0) {
          const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
          const winRate = (arr: number[]) => (arr.filter((v) => v > 0).length / arr.length) * 100;
          backtestStr = `\n【历史回测】近${matches.length}次${state}后平均收益：5日${avg(matches.map((m) => m.after5)).toFixed(
            1
          )}%(胜率${winRate(matches.map((m) => m.after5)).toFixed(0)}%) | 10日${avg(matches.map((m) => m.after10)).toFixed(
            1
          )}% | 20日${avg(matches.map((m) => m.after20)).toFixed(1)}%
      当前DIF=${dif[idx].toFixed(2)} DEA=${dea[idx].toFixed(2)} RSI6=${rsi6[idx].toFixed(1)} 状态：${state}`;
        } else {
          backtestStr = `\n【历史回测】当前${state}，历史样本不足（需至少35根K线）`;
        }

        const rsi6Result = BacktestRSIBounce(closes, rsi6, idx, 30, 5);
        const rsi12Result = BacktestRSIBounce(closes, rsi12, idx, 30, 5);
        const rsi24Result = BacktestRSIBounce(closes, rsi24, idx, 30, 5);

        const formatRSIResult = (name: string, r: any) => {
          const history =
            r.count > 0
              ? `历史反弹${r.count}次，5日平均收益${r.avgReturn.toFixed(1)}%(胜率${r.winRate.toFixed(
                  0
                )}%)，平均超卖${r.avgOversoldDays.toFixed(1)}天`
              : '无历史反弹样本';
          const status =
            r.daysSinceRebound >= 0 ? `${r.currentStatus}，距反弹${r.daysSinceRebound}天` : r.currentStatus;
          return `${name}：${history} | 当前${r.currentRSI.toFixed(1)}（${status}）`;
        };

        const rsiLines = [
          formatRSIResult('RSI6', rsi6Result),
          formatRSIResult('RSI12', rsi12Result),
          formatRSIResult('RSI24', rsi24Result),
        ];

        const r6 = rsi6[idx];
        const r12 = rsi12[idx];
        const r24 = rsi24[idx];
        let resonance = '';
        if (r6 > 70 && r12 > 70 && r24 > 70) resonance = '（三周期共振超买，极端过热）';
        else if (r6 < 30 && r12 < 30 && r24 < 30) resonance = '（三周期共振超卖，极端低迷）';
        else if (r6 > 70 && r24 < 60) resonance = '（短高长低，上涨中继）';
        else if (r6 < 30 && r24 > 40) resonance = '（短低长高，下跌中继）';

        rsiBacktestStr = `\n【RSI超卖反弹回测】\n${rsiLines.join('\n')}${resonance}`;
      }

      const data = formatKlineData(klineData, precision);
      content = `K线：${data}${indicatorStr}${backtestStr}${rsiBacktestStr}`;
    } else if (name === 'get_fundamental') {
      try {
        const code = (stock?.secid || args.secid).split('.').pop() || '';
        const res = await Services.Stock.GetStockStatics(code);

        if (res && Object.keys(res).length > 0) {
          const fields: [string, any][] = [
            ['股票代码', res.SECURITY_CODE],
            ['股票名称', res.SECURITY_NAME_ABBR],
            ['动态市盈率', res.PE_DYNAMIC],
            ['静态市盈率', res.PE_STATIC],
            ['市盈率TTM', res.PE_TTM],
            ['市净率', res.PB_MRQ_REALTIME || res.PB_NEW_NOTICE],
            ['净资产收益率ROE', res.ROE],
            ['每股收益EPS', res.EPS],
            ['每股净资产BPS', res.BVPS],
            ['营业总收入', res.TOTAL_OPERATE_INCOME],
            ['净利润', res.NETPROFIT],
            ['毛利率', res.GROSS_PROFIT_RATIO],
            ['净利率', res.NPR],
            ['资产负债率', res.DEBT],
            ['质押比例', res.PLEDGE_RATIO],
          ];

          const lines = fields
            .filter(([_, v]) => v != null && v !== '' && String(v) !== '暂未披露' && !String(v).includes('null'))
            .map(([k, v]) => `${k}：${v}`);

          content = lines.length > 0 ? `【财务指标】\n${lines.join(' | ')}` : '【财务指标】该股票暂无有效财务指标数据';
        } else {
          content = '【财务指标】暂无数据（可能为新股或数据未披露）';
        }
      } catch (e) {
        content = `【财务指标】获取异常：${e}`;
      }
    } else if (name === 'get_finance') {
      try {
        const code = (stock?.secid || args.secid).split('.').pop() || '';
        const res = await Services.Stock.GetReportData(code);

        if (res && Array.isArray(res) && res.length > 0) {
          const recent = res.slice(0, 2);

          const periods = recent.map((item: any) => {
            const fields: [string, any][] = [
              ['报告期', item.REPORT_DATE_NAME || item.REPORT_DATE],
              ['营业总收入', item.TOTAL_OPERATE_INCOME || item.TOTALOPERATEREVE],
              ['归属净利润', item.PARENTNETPROFIT],
              ['扣非净利润', item.KCFJCXSYJLR],
              ['每股收益', item.EPSJB],
              ['每股净资产', item.BPS],
              ['每股经营现金流', item.MGJYXJJE],
              ['ROE(加权)', item.ROEJQ],
              ['毛利率', item.GROSS_PROFIT_RATIO],
              ['净利率', item.NPR],
              ['资产负债率', item.ZCFZL],
              ['流动比率', item.LD],
              ['速动比率', item.SD],
              ['存货周转天数', item.CHZZTS],
              ['应收账款周转天数', item.YSZKZZTS],
            ];

            const lines = fields
              .filter(([_, v]) => v != null && v !== '' && String(v) !== 'null' && !String(v).includes('暂未披露'))
              .map(([k, v]) => `${k}：${v}`);

            return lines.join(' | ');
          });

          content = `【财务报表】最近${recent.length}期数据\n${periods.join('\n')}`;
        } else {
          content = '【财务报表】暂无报表数据（可能为新股或数据未披露）';
        }
      } catch (e) {
        content = `【财务报表】获取异常：${e}`;
      }
    } else if (name === 'get_news') {
      try {
        const secid = stock?.secid || args.secid;
        const res = await Services.Stock.GetNews(secid, 1, 10);
        if (res && res.length > 0) {
          const lines = res.slice(0, 10).map((n: any) => `${n.time?.slice(0, 10)} ${n.title}`);
          content = `【新闻资讯】最近${res.length}条：\n${lines.join('\n')}`;
        } else {
          content = '【新闻资讯】暂无最新新闻';
        }
      } catch (e) {
        content = `【新闻资讯】获取失败：${e}`;
      }
    } else if (name === 'get_researches') {
      try {
        const secid = stock?.secid || args.secid;
        const res = await Services.Stock.GetStockResearches(secid, 1);
        if (res && res.length > 0) {
          const lines = res.slice(0, 5).map(
            (r: any) => `${r.publish_time?.slice(0, 10)} [${r.em_rating_name || '评级'}] ${r.title}（${r.source}）`
          );
          content = `【机构研报】最近${Math.min(res.length, 5)}篇：\n${lines.join('\n')}`;
        } else {
          content = '【机构研报】暂无研报';
        }
      } catch (e) {
        content = `【机构研报】获取失败：${e}`;
      }
    } else if (name === 'get_themes') {
      try {
        const code = getCode(stock?.secid || args.secid || args.code);
        const res = await Services.Stock.GetStockThemes(code, 1);
        if (res && Array.isArray(res) && res.length > 0) {
          const lines = res.slice(0, 8).map(
            (t: any) => `${t.BOARD_NAME}（${t.SELECTED_BOARD_REASON?.slice(0, 30)}...）`
          );
          content = `【概念题材】共${res.length}个相关概念：\n${lines.join('\n')}`;
        } else {
          content = '【概念题材】暂无概念数据';
        }
      } catch (e) {
        content = `【概念题材】获取失败：${e}`;
      }
    } else if (name === 'get_longhubang') {
      try {
        const code = getCode(stock?.secid || args.secid || args.code);
        const res = await Services.Stock.GetLongHuBang(code, 1);
        if (res && Array.isArray(res) && res.length > 0) {
          const lines = res.slice(0, 3).map((l: any) => {
            const topBuy = l.LIST?.slice(0, 3)
              .map((b: any) => `${b.OPERATEDEPT_NAME}买${(b.BUY_AMT_REAL / 1e4).toFixed(0)}万`)
              .join('，');
            return `${l.TRADE_DATE?.slice(0, 10)} ${l.EXPLANATION}，净买${(l.NET_BUY / 1e4).toFixed(0)}万 [${topBuy}]`;
          });
          content = `【龙虎榜】最近${Math.min(res.length, 3)}次：\n${lines.join('\n')}`;
        } else {
          content = '【龙虎榜】近期未上榜';
        }
      } catch (e) {
        content = `【龙虎榜】获取失败：${e}`;
      }
    } else if (name === 'get_events') {
      try {
        const code = getCode(stock?.secid || args.secid || args.code);
        const res = await Services.Stock.GetStockEvents(code, 1);
        if (res && Array.isArray(res) && res.length > 0) {
          const flat = res.flat().slice(0, 5);
          const lines = flat.map((e: any) => `${e.NOTICE_DATE?.slice(0, 10)} ${e.EVENT_TYPE}：${e.LEVEL1_CONTENT}`);
          content = `【公司事件】最近${flat.length}条：\n${lines.join('\n')}`;
        } else {
          content = '【公司事件】暂无重大事件';
        }
      } catch (e) {
        content = `【公司事件】获取失败：${e}`;
      }
    } else if (name === 'get_moneyflow') {
      try {
        const secid = stock?.secid || args.secid;
        const res = await Services.Stock.GetFlowTrendFromEastmoney(secid);
        if (res?.ffTrends && res.ffTrends.length > 0) {
          const latest = res.ffTrends[res.ffTrends.length - 1];
          content = `【资金流向】当日主力净流入${(latest.main / 1e4).toFixed(0)}万，超大单${(
            latest.superbig / 1e4
          ).toFixed(0)}万，大单${(latest.big / 1e4).toFixed(0)}万，中单${(latest.medium / 1e4).toFixed(
            0
          )}万，小单${(latest.small / 1e4).toFixed(0)}万`;
        } else {
          content = '【资金流向】暂无数据';
        }
      } catch (e) {
        content = `【资金流向】获取失败：${e}`;
      }
    } else {
      content = `未知工具：${name}`;
    }

    results.push({
      tool_call_id: tc.id,
      role: 'tool',
      content,
    });
  }
  return results;
}

// ===== 缓存管理 =====
export function getCacheTable(code: string): string {
  return `kimi_analysis_${code}`;
}

export async function loadCache(code: string): Promise<Message[]> {
  try {
    const table = getCacheTable(code);
    const result = await window.contextModules.electron.sqliteRead(table, code);
    if (result?.success && result.data?.data?.messages) {
      const cached = result.data.data.messages as Message[];
      if (cached.length > 0) {
        return cached;
      }
    }
  } catch (e) {
    console.error('加载 Kimi 分析缓存失败:', e);
  }
  return [];
}

export async function saveCache(code: string, msgs: Message[], stockName: string): Promise<void> {
  if (!code || msgs.length === 0) return;
  try {
    const table = getCacheTable(code);
    await window.contextModules.electron.sqliteWrite(
      table,
      {
        messages: msgs.slice(-100),
        stockCode: code,
        stockName,
      },
      dayjs().format('YYYY-MM-DD HH:mm:ss'),
      code
    );
  } catch (e) {
    console.error('保存 Kimi 分析缓存失败:', e);
  }
}

export async function clearCache(code: string, stockName: string): Promise<void> {
  if (!code) return;
  try {
    const table = getCacheTable(code);
    await window.contextModules.electron.sqliteWrite(
      table,
      {
        messages: [],
        stockCode: code,
        stockName,
      },
      dayjs().format('YYYY-MM-DD HH:mm:ss'),
      code
    );
  } catch (e) {
    console.error('清除 Kimi 分析缓存失败:', e);
  }
}

// ===== API 消息构建 =====
export function buildApiMessages(
  stock: Stock.DetailItem,
  messages: Message[],
  typeOrText: AnalysisType | string,
  isOption: boolean
): any[] {
  const baseInfo = buildBaseInfo(stock);
  const userPrompt = isOption
    ? `请对以下股票进行${typeNames[typeOrText as AnalysisType]}。\n\n${baseInfo}\n\n请根据提供的工具获取所需数据后进行分析，用中文回答，分析客观专业，风险提示充分。`
    : `${typeOrText}\n\n股票基本信息：\n${baseInfo}\n\n请根据提供的工具获取所需数据后回答，用中文回答，分析客观专业，风险提示充分。`;

  const recentMessages = messages
    .slice(-MAX_HISTORY_ROUNDS * 2)
    .filter((m) => m.role === 'user')
    .map((m) => ({ role: m.role, content: m.content }));

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...recentMessages.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userPrompt },
  ];
}

export function getAnalysisTools(typeOrText: AnalysisType | string, isOption: boolean): any[] {
  return isOption ? getToolsByType(typeOrText as AnalysisType) : TOOLS;
}

export function getAnalysisPrecision(typeOrText: AnalysisType | string, isOption: boolean): DataPrecision {
  return isOption ? getDataPrecision(typeOrText as AnalysisType) : 'fast';
}

// ===== IPC 调用封装 =====
export interface KimiAnalyzeParams {
  apiKey: string;
  messages: any[];
  tools: any[];
  sessionId: string;
}

export async function invokeKimiAnalyze(params: KimiAnalyzeParams): Promise<any> {
  const { ipcRenderer } = window.contextModules.electron;
  return ipcRenderer.invoke('kimi-analyze-with-tools', params);
}

export async function invokeKimiToolResponse(requestId: string, results: any[]): Promise<any> {
  const { ipcRenderer } = window.contextModules.electron;
  return ipcRenderer.invoke('kimi-tool-response', { requestId, results });
}

export function onKimiAnalysisChunk(handler: (event: any, data: { content?: string; sessionId?: string }) => void): void {
  const { ipcRenderer } = window.contextModules.electron;
  ipcRenderer.on('kimi-analysis-chunk', handler);
}

export function offKimiAnalysisChunk(handler: (event: any, data: { content?: string; sessionId?: string }) => void): void {
  const { ipcRenderer } = window.contextModules.electron;
  ipcRenderer.off('kimi-analysis-chunk', handler);
}

export function onKimiToolRequest(
  handler: (event: any, data: { requestId: string; sessionId?: string; toolCalls: any[] }) => void
): void {
  const { ipcRenderer } = window.contextModules.electron;
  ipcRenderer.on('kimi-tool-request', handler);
}

export function offKimiToolRequest(
  handler: (event: any, data: { requestId: string; sessionId?: string; toolCalls: any[] }) => void
): void {
  const { ipcRenderer } = window.contextModules.electron;
  ipcRenderer.off('kimi-tool-request', handler);
}
