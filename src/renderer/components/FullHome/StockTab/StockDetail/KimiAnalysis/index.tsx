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

const SYSTEM_PROMPT = `你是一位专业的股票分析师，擅长基本面分析、技术面分析、资金面分析和风险评估。
分析时请客观、专业，风险提示必须充分，用中文回答，格式清晰。`;

// ===== Markdown 解析器 =====
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

    // 代码块
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      let code = '';
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code += lines[i] + '\n';
        i++;
      }
      i++; // skip ```
      result += `<pre><code${lang ? ` class="language-${lang}"` : ''}>${escapeHtml(code.slice(0, -1))}</code></pre>`;
      continue;
    }

    // 标题
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2].trim();
      result += `<h${level}>${parseInline(escapeHtml(content))}</h${level}>`;
      i++;
      continue;
    }

    // 分割线
    if (line.trim().match(/^(-{3,}|\*{3,}|_{3,})\s*$/)) {
      result += '<hr/>';
      i++;
      continue;
    }

    // 表格
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
        // 回退为段落处理
        i -= tableLines.length;
      }
    }

    // 引用块
    if (line.trim().startsWith('>')) {
      let quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().slice(1).trim());
        i++;
      }
      // 引用块内部支持简单换行
      const quoteText = quoteLines.join('\n');
      result += `<blockquote>${parseInline(escapeHtml(quoteText))}</blockquote>`;
      continue;
    }

    // 无序列表
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

    // 有序列表
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

    // 空行
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 普通段落
    let para = '';
    while (i < lines.length && lines[i].trim() !== '') {
      para += lines[i] + ' ';
      i++;
    }
    result += `<p>${parseInline(escapeHtml(para.trim()))}</p>`;
  }

  return result;
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_stock_trend_data',
      description: '获取指定股票今日的实时分时走势数据，包含每个时间点的价格、均价、成交量等信息。当用户要求进行分时走势分析时必须调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          secid: { type: 'string', description: '股票secid，例如 "0.002594"' },
        },
        required: ['secid'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_stock_kline_data',
      description: '获取指定股票近期K线数据，包含每根K线的日期、开盘、收盘、最高、最低、成交量、涨跌幅等。当用户要求进行K线技术分析时必须调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          secid: { type: 'string', description: '股票secid，例如 "0.002594"' },
          period: { type: 'string', enum: ['day', 'week', 'month'], description: 'K线周期，默认day' },
          count: { type: 'number', description: '获取最近多少根K线，默认30' },
        },
        required: ['secid'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_stock_fundamental',
      description: '获取指定股票的基本面数据（财务指标），包含ROE、净利润、营收、毛利率、资产负债率、现金流等关键指标。当用户要求进行基本面分析时必须调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          secid: { type: 'string', description: '股票secid，例如 "0.002594"' },
        },
        required: ['secid'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_stock_finance_data',
      description: '获取指定股票的财务数据（三大报表摘要），包含资产负债表、利润表、现金流量表的核心科目。当用户要求查看财务报表或详细财务数据时必须调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          secid: { type: 'string', description: '股票secid，例如 "0.002594"' },
        },
        required: ['secid'],
      },
    },
  },
];

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

  // ===== 磁盘缓存 =====
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
        messages: msgs.slice(-100), // 最多保留100条
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

  // 激活或股票切换时加载缓存
  useEffect(() => {
    if (active && stock?.code) {
      setMessages([]); // 先清空，避免显示旧股票消息
      loadCache(stock.code);
    } else {
      setMessages([]);
    }
  }, [active, stock?.code, loadCache]);

  // messages 变化时自动保存缓存
  useEffect(() => {
    if (stock?.code && messages.length > 0) {
      const timer = setTimeout(() => {
        saveCache(stock.code, messages);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [messages, stock?.code, saveCache]);

  const buildBaseInfo = useCallback((detail: Stock.DetailItem): string => {
    return [
      `## 股票基本信息`,
      `- 股票名称：${detail.name || '未知'}`,
      `- 股票代码：${detail.code || '未知'}`,
      `- 所属板块：${detail.hybk || '未知'}`,
      `- 最新价：${detail.zx ? detail.zx.toFixed(2) : '未知'}`,
      `- 涨跌幅：${detail.zdf ? detail.zdf.toFixed(2) + '%' : '未知'}`,
      `- 涨跌额：${detail.zdd ? detail.zdd.toFixed(2) : '未知'}`,
      `- 开盘价：${detail.jk ? detail.jk.toFixed(2) : '未知'}`,
      `- 最高价：${detail.zg ? detail.zg.toFixed(2) : '未知'}`,
      `- 最低价：${detail.zd ? detail.zd.toFixed(2) : '未知'}`,
      `- 昨收价：${detail.zs ? detail.zs.toFixed(2) : '未知'}`,
      `- 成交量：${detail.cjl ? detail.cjl.toString() : '未知'}`,
      `- 成交额：${detail.cje ? detail.cje.toString() : '未知'}`,
      `- 换手率：${detail.hsl ? (detail.hsl / 100).toFixed(2) + '%' : '未知'}`,
      `- 市盈率(动)：${(detail as any).ped || '未知'}`,
      `- 市盈率(TTM)：${(detail as any).pettm || '未知'}`,
      `- 市净率：${(detail as any).pb || '未知'}`,
      `- 总市值：${(detail as any).zsz ? ((detail as any).zsz / 100000000).toFixed(2) + '亿' : '未知'}`,
      `- 流通市值：${(detail as any).ltsz ? ((detail as any).ltsz / 100000000).toFixed(2) + '亿' : '未知'}`,
      `- 量比：${detail.lb ? detail.lb.toFixed(2) : '未知'}`,
      `- 内盘：${detail.np || '未知'}`,
      `- 外盘：${detail.wp || '未知'}`,
      `- 委比：${(detail as any).wb ? (detail as any).wb.toFixed(2) + '%' : '未知'}`,
    ].join('\n');
  }, []);

  const formatTrendData = useCallback((trendData?: Stock.TrendItem[]): string => {
    if (!trendData || trendData.length === 0) {
      return '暂无分时数据';
    }
    // const recent = trendData.slice(-60);
    const rows = trendData.map((t) => {
      const time = t.datetime.length >= 10 ? t.datetime.split(' ')[1] || t.datetime : t.datetime;
      return `${time}\t${t.current.toFixed(2)}\t${t.average ? t.average.toFixed(2) : '-'}\t${t.vol}`;
    });
    return [
      `时间\t价格\t均价\t成交量`,
      ...rows,
    ].join('\n');
  }, []);

  const formatKlineData = useCallback((klineData?: Stock.KLineItem[]): string => {
    if (!klineData || klineData.length === 0) {
      return '暂无K线数据';
    }
    const recent = klineData.slice(-120);
    const rows = recent.map((k) => {
      return `${k.date}\t${k.kp.toFixed(2)}\t${k.sp.toFixed(2)}\t${k.zg.toFixed(2)}\t${k.zd.toFixed(2)}\t${k.cjl}\t${k.zdf.toFixed(2)}%`;
    });
    return [
      `日期\t开盘\t收盘\t最高\t最低\t成交量\t涨跌幅`,
      ...rows,
    ].join('\n');
  }, []);

  const executeTools = useCallback(async (toolCalls: any[]) => {
    const results: any[] = [];
    for (const tc of toolCalls) {
      const name = tc.function?.name;
      const args = JSON.parse(tc.function?.arguments || '{}');
      let content = '';

      if (name === 'get_stock_trend_data') {
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
        const data = formatTrendData(trendData);
        content = `以下是 ${stockRef.current?.name || args.secid} 的分时数据：\n${data}`;
      } else if (name === 'get_stock_kline_data') {
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
        const data = formatKlineData(klineData);
        content = `以下是 ${stockRef.current?.name || args.secid} 的K线数据（最近30根日线）：\n${data}`;
      } else if (name === 'get_stock_fundamental') {
        try {
          const res = await AkshareAPI.GetFundamentalFromAkshare(stockRef.current?.secid || args.secid);
          if (res) {
            content = `以下是 ${stockRef.current?.name || args.secid} 的基本面数据（财务指标）：\n${JSON.stringify(res, null, 2)}`;
          } else {
            content = '暂无基本面数据';
          }
        } catch (e) {
          content = `获取基本面数据失败：${e}`;
        }
      } else if (name === 'get_stock_finance_data') {
        try {
          const res = await AkshareAPI.GetFinanceDataFromAkshare(stockRef.current?.secid || args.secid);
          if (res) {
            content = `以下是 ${stockRef.current?.name || args.secid} 的财务数据（三大报表）：\n${JSON.stringify(res, null, 2)}`;
          } else {
            content = '暂无财务数据';
          }
        } catch (e) {
          content = `获取财务数据失败：${e}`;
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

    // 构建系统提示词 + 用户消息
    const baseInfo = buildBaseInfo(stock);
    const userPrompt = isOption
      ? `请对以下股票进行${typeNames[typeOrText as AnalysisType]}。\n\n${baseInfo}\n\n请根据提供的工具获取所需数据后进行分析，用中文回答，分析客观专业，风险提示充分。`
      : `${typeOrText}\n\n股票基本信息：\n${baseInfo}\n\n请根据提供的工具获取所需数据后回答，用中文回答，分析客观专业，风险提示充分。`;

    const apiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    // 需要传给工具的 tools 列表
    const tools = (isOption && (typeOrText === 'tech' || typeOrText === 'fundamental')) || !isOption
      ? TOOLS
      : undefined;

    // 监听流式 chunk
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

    // 监听工具调用请求
    const toolHandler = async (_: any, data: { requestId: string; sessionId?: string; toolCalls: any[] }) => {
      if (data.sessionId && data.sessionId !== sessionIdRef.current) {
        return; // 不是当前 session 的请求，忽略
      }
      try {
        const results = await executeTools(data.toolCalls);
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
  }, [kimiApiKey, stock, buildBaseInfo, executeTools]);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || loading) return;
    setInputValue('');
    sendMessage(text, false);
  }, [inputValue, loading, sendMessage]);

  // const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  //   if (e.key === 'Enter' && !e.shiftKey) {
  //     e.preventDefault();
  //     handleSend();
  //   }
  // }, [handleSend]);

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
            // onKeyDown={handleKeyDown}
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
