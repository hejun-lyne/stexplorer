import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Alert, Input, Tag } from 'antd';
import { RobotOutlined, SendOutlined, StockOutlined, FireOutlined, BankOutlined, UserOutlined, DeleteOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { Stock } from '@/types/stock';
import * as KimiAnalysisService from '@/services/kimiAnalysis';
import styles from './index.scss';

export interface KimiAnalysisProps {
  stock: Stock.DetailItem;
  trends?: Stock.TrendItem[];
  klines?: Stock.KLineItem[];
  active: boolean;
}

type Message = KimiAnalysisService.Message;
type AnalysisType = KimiAnalysisService.AnalysisType;

const analysisOptions = [
  { type: 'tech' as AnalysisType, label: '技术分析', icon: <StockOutlined />, color: '#1890ff' },
  { type: 'event' as AnalysisType, label: '事件热点', icon: <FireOutlined />, color: '#fa8c16' },
  { type: 'fundamental' as AnalysisType, label: '基本面分析', icon: <BankOutlined />, color: '#722ed1' },
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
  const currentStockCodeRef = useRef<string>('');
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

  // ===== 缓存相关：按股票动态分表 =====
  const loadCache = useCallback(async (code: string) => {
    const cached = await KimiAnalysisService.loadCache(code);
    if (cached.length > 0) {
      setMessages(cached);
    }
  }, []);

  const saveCache = useCallback(async (code: string, msgs: Message[]) => {
    await KimiAnalysisService.saveCache(code, msgs, stock.name);
  }, [stock.name]);

  const clearCache = useCallback(async (code: string) => {
    await KimiAnalysisService.clearCache(code, stock.name);
    setMessages([]);
  }, [stock.name]);

  useEffect(() => {
    // 只在 stock code 真正变化时才重新加载缓存
    // 不再因 active=false 清空消息，避免流式响应进行中丢失内容
    if (stock?.code && stock.code !== currentStockCodeRef.current) {
      currentStockCodeRef.current = stock.code;
      setMessages([]);
      setLoading(false);
      setError('');
      loadCache(stock.code);
    }
  }, [stock?.code, loadCache]);

  useEffect(() => {
    if (stock?.code && messages.length > 0) {
      const timer = setTimeout(() => {
        saveCache(stock.code, messages);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [messages, stock?.code, saveCache]);

  const sendMessage = useCallback(async (typeOrText: AnalysisType | string, isOption = false) => {
    if (!kimiApiKey) {
      setError('请先在设置中配置 Kimi API Key');
      return;
    }
    if (!stock?.code) {
      setError('股票数据尚未加载');
      return;
    }

    const now = Date.now();
    const userContent = isOption ? KimiAnalysisService.typeNames[typeOrText as AnalysisType] : (typeOrText as string);
    const userMsg: Message = {
      id: now.toString(),
      role: 'user',
      content: userContent,
      analysisType: isOption ? (typeOrText as AnalysisType) : 'custom',
      timestamp: now,
    };

    const assistantMsg: Message = {
      id: (now + 1).toString(),
      role: 'assistant',
      content: '',
      analysisType: isOption ? (typeOrText as AnalysisType) : 'custom',
      timestamp: now,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setLoading(true);
    setError('');

    const sessionId = Date.now().toString() + Math.random().toString(36).slice(2);
    sessionIdRef.current = sessionId;

    const apiMessages = KimiAnalysisService.buildApiMessages(stock, messages, typeOrText, isOption);
    const tools = KimiAnalysisService.getAnalysisTools(typeOrText, isOption);
    const precision = KimiAnalysisService.getAnalysisPrecision(typeOrText, isOption);

    // ===== 关键修复：chunkHandler 增加 sessionId 过滤 =====
    const chunkHandler = (_: any, data: { content?: string; sessionId?: string }) => {
      if (data.sessionId && data.sessionId !== sessionIdRef.current) {
        return; // 不是当前 session 的 chunk，忽略
      }
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
    KimiAnalysisService.onKimiAnalysisChunk(chunkHandler);

    const toolHandler = async (_: any, data: { requestId: string; sessionId?: string; toolCalls: any[] }) => {
      if (data.sessionId && data.sessionId !== sessionIdRef.current) {
        return;
      }
      try {
        const results = await KimiAnalysisService.executeTools(
          data.toolCalls,
          precision,
          stockRef.current,
          trendsRef.current,
          klinesRef.current
        );
        await KimiAnalysisService.invokeKimiToolResponse(data.requestId, results);
      } catch (e) {
        console.error('Tool execution failed:', e);
        await KimiAnalysisService.invokeKimiToolResponse(data.requestId, data.toolCalls.map((tc: any) => ({
          tool_call_id: tc.id,
          role: 'tool',
          content: `工具执行失败：${e}`,
        })));
      }
    };
    KimiAnalysisService.onKimiToolRequest(toolHandler);

    try {
      const result = await KimiAnalysisService.invokeKimiAnalyze({
        apiKey: kimiApiKey,
        messages: apiMessages,
        tools,
        sessionId,
      });

      if (result?.error) {
        setError(result.error);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && last.content === '') {
            return [...prev.slice(0, -1), { ...last, content: `❌ ${result.error}` }];
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
      KimiAnalysisService.offKimiAnalysisChunk(chunkHandler);
      KimiAnalysisService.offKimiToolRequest(toolHandler);
      setLoading(false);
    }
  }, [kimiApiKey, stock, messages]);

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

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day} ${hours}:${minutes}`;
  };

  const renderMarkdown = (text: string) => {
    return { __html: KimiAnalysisService.parseMarkdown(text) };
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
                  <div className={styles.bubbleHeader}>
                    {msg.analysisType && msg.role === 'user' && (
                      <Tag color={analysisOptions.find((o) => o.type === msg.analysisType)?.color} className={styles.typeTag}>
                        {KimiAnalysisService.typeNames[msg.analysisType]}
                      </Tag>
                    )}
                    <span className={styles.timestamp}>{formatTime(msg.timestamp)}</span>
                  </div>
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
