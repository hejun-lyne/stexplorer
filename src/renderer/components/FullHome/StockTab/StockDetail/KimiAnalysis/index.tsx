import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Alert, Input, Tag } from 'antd';
import { RobotOutlined, SendOutlined, StockOutlined, LineChartOutlined, FireOutlined, BankOutlined, UserOutlined, DeleteOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { Stock } from '@/types/stock';
import * as AkshareAPI from '@/services/akshare';
import dayjs from 'dayjs';
import styles from './index.scss';

export interface KimiAnalysisProps {
  stock: Stock.DetailItem;
  trends?: Stock.TrendItem[];
  klines?: Stock.KLineItem[];
  active: boolean;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  analysisType?: AnalysisType;
}

type AnalysisType = 'tech' | 'event' | 'fundamental';
type DataPrecision = 'fast' | 'deep';

const analysisOptions: { type: AnalysisType; label: string; icon: React.ReactNode; color: string }[] = [
  { type: 'tech', label: '技术分析', icon: <StockOutlined />, color: '#1890ff' },
  { type: 'event', label: '事件热点', icon: <FireOutlined />, color: '#fa8c16' },
  { type: 'fundamental', label: '基本面分析', icon: <BankOutlined />, color: '#722ed1' },
];

const typeNames: Record<AnalysisType, string> = {
  tech: '结合分时和K线进行分析',
  event: '事件热点分析',
  fundamental: '基本面分析',
};

const SYSTEM_PROMPT = `你是股票分析师，客观专业，风险提示充分，中文回答，格式清晰。`;

const TOOLS = [
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
];

const getToolsByType = (type?: AnalysisType) => {
  switch (type) {
    case 'tech':
      return TOOLS.filter(t => ['get_trend', 'get_kline'].includes(t.function.name));
    case 'fundamental':
      return TOOLS.filter(t => ['get_fundamental', 'get_finance'].includes(t.function.name));
    case 'event':
      return [];
    default:
      return TOOLS;
  }
};

// 根据分析类型自动决定数据精度
const getDataPrecision = (type?: AnalysisType): DataPrecision => {
  switch (type) {
    case 'tech': return 'deep';
    case 'fundamental':
    case 'event':
    default: return 'fast';
  }
};

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

function parseMarkdown(text: string): string {
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
      let quoteLines: string[] = [];
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

const KimiAnalysis: React.FC<KimiAnalysisProps> = ({ stock, trends, klines, active }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inputValue, setInputValue] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<any>(null);
  const trendsRef = useRef(trends);
  const klinesRef = useRef(klines);
  const stockRef = useRef(stock);
  const sessionIdRef = useRef<string>('');
  const kimiApiKey = useSelector((state: StoreState) => state.setting.systemSetting.kimiApiKeySetting);

  trendsRef.current = trends;
  klinesRef.current = klines;
  stockRef.current = stock;

  const scrollToBottom = useCallback(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  const CACHE_TABLE = 'kimi_analysis';

  const loadCache = useCallback(async (code: string) => {
    try {
      const result = await window.contextModules.electron.sqliteRead(CACHE_TABLE, code);
      if (result?.success && result.data?.data?.messages) {
        const cached = result.data.data.messages as Message[];
        if (cached.length > 0) {
          setMessages(cached);
        }
      }
    } catch (e) {
      console.error('加载 Kimi 分析缓存失败:', e);
    }
  }, []);

  const saveCache = useCallback(async (code: string, msgs: Message[]) => {
    if (!code || msgs.length === 0) return;
    try {
      await window.contextModules.electron.sqliteWrite(CACHE_TABLE, {
        messages: msgs.slice(-100),
        stockCode: code,
        stockName: stock.name,
      }, dayjs().format('YYYY-MM-DD HH:mm:ss'), code);
    } catch (e) {
      console.error('保存 Kimi 分析缓存失败:', e);
    }
  }, [stock.name]);

  const clearCache = useCallback(async (code: string) => {
    if (!code) return;
    try {
      await window.contextModules.electron.sqliteWrite(CACHE_TABLE, {
        messages: [],
        stockCode: code,
        stockName: stock.name,
      }, dayjs().format('YYYY-MM-DD HH:mm:ss'), code);
      setMessages([]);
    } catch (e) {
      console.error('清除 Kimi 分析缓存失败:', e);
    }
  }, [stock.name]);

  useEffect(() => {
    if (active && stock?.code) {
      setMessages([]);
      loadCache(stock.code);
    } else {
      setMessages([]);
    }
  }, [active, stock?.code, loadCache]);

  useEffect(() => {
    if (stock?.code && messages.length > 0) {
      const timer = setTimeout(() => {
        saveCache(stock.code, messages);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [messages, stock?.code, saveCache]);

  const buildBaseInfo = useCallback((detail: Stock.DetailItem): string => {
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
      .map(([k, v, unit]) => `- ${k}：${v}${unit || ''}`);
      
    return lines.length > 0 ? `股票信息：\n${lines.join('\n')}` : '';
  }, []);

  // ===== 双模式分时数据 =====
  const formatTrendData = useCallback((trendData?: Stock.TrendItem[], mode: DataPrecision = 'fast'): string => {
    if (!trendData || trendData.length === 0) return '无分时数据';
    
    if (mode === 'deep') {
      // 深度模式：每5分钟采样，保留足够细节用于形态识别
      const sampled = trendData.filter((_, i) => i % 5 === 0);
      const prices = trendData.map(t => t.current);
      const avg = prices.reduce((a, b) => a + b) / prices.length;
      const max = Math.max(...prices);
      const min = Math.min(...prices);
      const volSum = trendData.reduce((s, t) => s + (t.vol || 0), 0);
      
      return `分时统计：均价${avg.toFixed(2)}，最高${max.toFixed(2)}，最低${min.toFixed(2)}，总成交${volSum}
采样点位(每5分钟)：${sampled.map(t => `${t.datetime.slice(-5)}:${t.current.toFixed(2)}`).join('，')}`;
    }
    
    // 快速模式：5个关键点位+统计
    const n = trendData.length;
    const keyPoints = [
      trendData[0],
      trendData[Math.floor(n / 4)],
      trendData[Math.floor(n / 2)],
      trendData[Math.floor(3 * n / 4)],
      trendData[n - 1],
    ];
    
    const prices = trendData.map(t => t.current);
    const avg = prices.reduce((a, b) => a + b) / n;
    const max = Math.max(...prices);
    const min = Math.min(...prices);
    const volSum = trendData.reduce((s, t) => s + (t.vol || 0), 0);
    
    return `分时统计：均价${avg.toFixed(2)}，最高${max.toFixed(2)}，最低${min.toFixed(2)}，总成交${volSum}
关键点位：${keyPoints.map(t => `${t.datetime.slice(-5)}:${t.current.toFixed(2)}`).join('，')}`;
  }, []);

  // ===== 双模式K线数据 =====
  const formatKlineData = useCallback((klineData?: Stock.KLineItem[], mode: DataPrecision = 'fast'): string => {
    if (!klineData || klineData.length === 0) return '无K线数据';
    
    if (mode === 'deep') {
      // 深度模式：最近60根完整K线，支持形态识别
      const recent = klineData.slice(-60);
      const summary = {
        upDays: recent.filter(k => k.zdf > 0).length,
        downDays: recent.filter(k => k.zdf < 0).length,
        avgVol: Math.round(recent.reduce((s, k) => s + k.cjl, 0) / recent.length),
        maxZdf: Math.max(...recent.map(k => k.zdf)),
        minZdf: Math.min(...recent.map(k => k.zdf)),
      };
      
      const rows = recent.map(k => 
        `${k.date} ${k.kp.toFixed(2)} ${k.sp.toFixed(2)} ${k.zg.toFixed(2)} ${k.zd.toFixed(2)} ${(k.cjl/1e4).toFixed(0)}万 ${k.zdf.toFixed(2)}%`
      );
      
      return `近${recent.length}日K线：涨${summary.upDays}跌${summary.downDays}，均量${(summary.avgVol/1e4).toFixed(0)}万，最大涨幅${summary.maxZdf.toFixed(1)}%，最大跌幅${summary.minZdf.toFixed(1)}%
${rows.join('\n')}`;
    }
    
    // 快速模式：20根精简
    const recent = klineData.slice(-20);
    const summary = {
      upDays: recent.filter(k => k.zdf > 0).length,
      downDays: recent.filter(k => k.zdf < 0).length,
      avgVol: Math.round(recent.reduce((s, k) => s + k.cjl, 0) / recent.length),
      maxZdf: Math.max(...recent.map(k => k.zdf)),
      minZdf: Math.min(...recent.map(k => k.zdf)),
    };
    
    const rows = recent.map(k => 
      `${k.date.slice(-5)} ${k.sp.toFixed(2)} ${k.zdf > 0 ? '+' : ''}${k.zdf.toFixed(1)}% ${(k.cjl/1e4).toFixed(0)}万`
    );
    
    return `近${recent.length}日K线：涨${summary.upDays}跌${summary.downDays}，均量${(summary.avgVol/1e4).toFixed(0)}万，最大涨幅${summary.maxZdf.toFixed(1)}%，最大跌幅${summary.minZdf.toFixed(1)}%
${rows.join('\n')}`;
  }, []);

  const executeTools = useCallback(async (toolCalls: any[], precision: DataPrecision) => {
    const results: any[] = [];
    for (const tc of toolCalls) {
      const name = tc.function?.name;
      const args = JSON.parse(tc.function?.arguments || '{}');
      let content = '';

      if (name === 'get_trend') {
        let trendData = trendsRef.current;
        if (!trendData || trendData.length < 50) {
          try {
            const res = await AkshareAPI.GetTrendFromAkshare(stockRef.current?.secid || args.secid);
            if (res?.trends && res.trends.length > 0) {
              trendData = res.trends;
            }
          } catch (e) {
            console.error('Failed to fetch trend data:', e);
          }
        }
        content = `分时：${formatTrendData(trendData, precision)}`;
      } else if (name === 'get_kline') {
        let klineData = klinesRef.current;
        if (!klineData || klineData.length < 5) {
          try {
            const res = await AkshareAPI.GetKFromAkshare(stockRef.current?.secid || args.secid, 101);
            if (res?.ks && res.ks.length > 0) {
              klineData = res.ks;
            }
          } catch (e) {
            console.error('Failed to fetch kline data:', e);
          }
        }
        content = `K线：${formatKlineData(klineData, precision)}`;
      } else if (name === 'get_fundamental') {
        try {
          const res = await AkshareAPI.GetFundamentalFromAkshare(stockRef.current?.secid || args.secid);
          if (res) {
            const compact = Object.fromEntries(
              Object.entries(res)
                .filter(([_, v]) => v != null && v !== 0 && v !== '0')
                .slice(0, 15)
            );
            content = `财务指标：${JSON.stringify(compact)}`;
          } else {
            content = '无基本面数据';
          }
        } catch (e) {
          content = `获取失败：${e}`;
        }
      } else if (name === 'get_finance') {
        try {
          const res = await AkshareAPI.GetFinanceDataFromAkshare(stockRef.current?.secid || args.secid);
          if (res) {
            const compact = {
              periods: res.periods?.slice(0, 2) || [],
              keyItems: {
                revenue: res.revenue?.slice(0, 2),
                netProfit: res.netProfit?.slice(0, 2),
                totalAssets: res.totalAssets?.slice(0, 2),
                totalLiabilities: res.totalLiabilities?.slice(0, 2),
                operatingCashFlow: res.operatingCashFlow?.slice(0, 2),
              }
            };
            content = `财务报表(近2期)：${JSON.stringify(compact)}`;
          } else {
            content = '无财务数据';
          }
        } catch (e) {
          content = `获取失败：${e}`;
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
  }, [formatTrendData, formatKlineData]);

  const MAX_HISTORY_ROUNDS = 4;

  const sendMessage = useCallback(async (typeOrText: AnalysisType | string, isOption = false) => {
    if (!kimiApiKey) {
      setError('请先在设置中配置 Kimi API Key');
      return;
    }
    if (!stock?.code) {
      setError('股票数据尚未加载');
      return;
    }

    const userContent = isOption ? typeNames[typeOrText as AnalysisType] : (typeOrText as string);
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userContent,
      analysisType: isOption ? (typeOrText as AnalysisType) : undefined,
    };

    const assistantMsg: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      analysisType: isOption ? (typeOrText as AnalysisType) : undefined,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setLoading(true);
    setError('');

    const { ipcRenderer } = window.contextModules.electron;
    const sessionId = Date.now().toString() + Math.random().toString(36).slice(2);
    sessionIdRef.current = sessionId;

    const baseInfo = buildBaseInfo(stock);
    const userPrompt = isOption
      ? `请对以下股票进行${typeNames[typeOrText as AnalysisType]}。\n\n${baseInfo}\n\n请根据提供的工具获取所需数据后进行分析，用中文回答，分析客观专业，风险提示充分。`
      : `${typeOrText}\n\n股票基本信息：\n${baseInfo}\n\n请根据提供的工具获取所需数据后回答，用中文回答，分析客观专业，风险提示充分。`;

    const recentMessages = messages.slice(-MAX_HISTORY_ROUNDS * 2);

    const apiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...recentMessages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userPrompt },
    ];

    const tools = isOption ? getToolsByType(typeOrText as AnalysisType) : TOOLS;
    
    // ===== 自动选择数据精度 =====
    const precision = isOption ? getDataPrecision(typeOrText as AnalysisType) : 'fast';

    const chunkHandler = (_: any, data: { content?: string }) => {
      if (data.content !== undefined) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant') {
            const updated = { ...last, content: data.content || '' };
            return [...prev.slice(0, -1), updated];
          }
          return prev;
        });
      }
    };
    ipcRenderer.on('kimi-analysis-chunk', chunkHandler);

    const toolHandler = async (_: any, data: { requestId: string; sessionId?: string; toolCalls: any[] }) => {
      if (data.sessionId && data.sessionId !== sessionIdRef.current) {
        return;
      }
      try {
        const results = await executeTools(data.toolCalls, precision);
        await ipcRenderer.invoke('kimi-tool-response', { requestId: data.requestId, results });
      } catch (e) {
        console.error('Tool execution failed:', e);
        await ipcRenderer.invoke('kimi-tool-response', {
          requestId: data.requestId,
          results: data.toolCalls.map((tc: any) => ({
            tool_call_id: tc.id,
            role: 'tool',
            content: `工具执行失败：${e}`,
          })),
        });
      }
    };
    ipcRenderer.on('kimi-tool-request', toolHandler);

    try {
      const result = await ipcRenderer.invoke('kimi-analyze-with-tools', {
        apiKey: kimiApiKey,
        messages: apiMessages,
        tools,
        sessionId,
      });

      if (result?.error) {
        setError(result.error);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, content: `❌ 分析失败：${result.error}` }];
          }
          return prev;
        });
      } else if (result?.content) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, content: result.content }];
          }
          return prev;
        });
      }
    } catch (e: any) {
      setError('请求失败: ' + (e.message || String(e)));
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant') {
          return [...prev.slice(0, -1), { ...last, content: `❌ 请求失败：${e.message || String(e)}` }];
        }
        return prev;
      });
      console.error('Kimi analyze failed:', e);
    } finally {
      ipcRenderer.off('kimi-analysis-chunk', chunkHandler);
      ipcRenderer.off('kimi-tool-request', toolHandler);
      setLoading(false);
    }
  }, [kimiApiKey, stock, buildBaseInfo, executeTools, messages]);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || loading) return;
    setInputValue('');
    sendMessage(text, false);
  }, [inputValue, loading, sendMessage]);

  const handleOptionClick = useCallback((type: AnalysisType) => {
    if (loading) return;
    sendMessage(type, true);
  }, [loading, sendMessage]);

  const renderMarkdown = (text: string) => {
    return { __html: parseMarkdown(text) };
  };

  const hasMessages = messages.length > 0;

  return (
    <div className={styles.container}>
      <div className={styles.chatArea} ref={contentRef}>
        {!hasMessages && (
          <div className={styles.welcome}>
            <div className={styles.welcomeIcon}>
              <RobotOutlined />
            </div>
            <div className={styles.welcomeTitle}>Kimi 股票智能分析</div>
            <div className={styles.welcomeDesc}>选择下方分析维度，或直接在底部输入您的问题</div>
            <div className={styles.options}>
              {analysisOptions.map((opt) => (
                <div
                  key={opt.type}
                  className={styles.optionCard}
                  style={{ borderColor: opt.color }}
                  onClick={() => handleOptionClick(opt.type)}
                >
                  <div className={styles.optionIcon} style={{ color: opt.color }}>
                    {opt.icon}
                  </div>
                  <div className={styles.optionLabel}>{opt.label}</div>
                </div>
              ))}
            </div>
            {!kimiApiKey && (
              <div className={styles.hint}>请先在设置中配置 Kimi API Key</div>
            )}
          </div>
        )}

        {hasMessages && (
          <div className={styles.messages}>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`${styles.message} ${msg.role === 'user' ? styles.userMessage : styles.assistantMessage}`}
              >
                <div className={styles.avatar}>
                  {msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                </div>
                <div className={styles.bubble}>
                  {msg.analysisType && msg.role === 'user' && (
                    <Tag color={analysisOptions.find((o) => o.type === msg.analysisType)?.color} className={styles.typeTag}>
                      {typeNames[msg.analysisType]}
                    </Tag>
                  )}
                  <div
                    className={styles.markdown}
                    dangerouslySetInnerHTML={renderMarkdown(msg.content)}
                  />
                  {msg.role === 'assistant' && loading && msg.content === '' && (
                    <span className={styles.typing}>Kimi 正在思考...</span>
                  )}
                  {msg.role === 'assistant' && loading && msg.content && (
                    <span className={styles.cursor}>▌</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            closable
            onClose={() => setError('')}
            style={{ margin: '12px 16px' }}
          />
        )}
      </div>

      <div className={styles.inputArea}>
        {hasMessages && (
          <div className={styles.quickOptions}>
            {analysisOptions.map((opt) => (
              <Button
                key={opt.type}
                size="small"
                icon={opt.icon}
                onClick={() => handleOptionClick(opt.type)}
                loading={loading}
                disabled={!kimiApiKey}
                style={{ color: opt.color, borderColor: opt.color }}
              >
                {opt.label}
              </Button>
            ))}
            <Button
              size="small"
              icon={<DeleteOutlined />}
              onClick={() => stock?.code && clearCache(stock.code)}
              disabled={!stock?.code}
              danger
              ghost
            >
              清除历史
            </Button>
          </div>
        )}
        <div className={styles.inputRow}>
          <Input.TextArea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={kimiApiKey ? '输入您的问题，按 Enter 发送，Shift+Enter 换行...' : '请先在设置中配置 Kimi API Key'}
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={!kimiApiKey || loading}
            className={styles.textInput}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={loading}
            onClick={handleSend}
            disabled={!kimiApiKey || !inputValue.trim()}
            className={styles.sendBtn}
          />
        </div>
      </div>
    </div>
  );
};

export default KimiAnalysis;