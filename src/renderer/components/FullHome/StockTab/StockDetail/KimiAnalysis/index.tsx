import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Alert, Spin, message } from 'antd';
import { RobotOutlined, ReloadOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { Stock } from '@/types/stock';
import styles from './index.scss';

export interface KimiAnalysisProps {
  stock: Stock.DetailItem;
  active: boolean;
}

const KimiAnalysis: React.FC<KimiAnalysisProps> = ({ stock, active }) => {
  const [analysis, setAnalysis] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const kimiApiKey = useSelector((state: StoreState) => state.setting.systemSetting.kimiApiKeySetting);

  const buildPrompt = useCallback((detail: Stock.DetailItem): string => {
    const lines: string[] = [
      `请对以下股票进行专业的投资分析，从基本面、技术面、资金面、风险评估四个维度展开，最后给出明确的投资建议。`,
      ``,
      `## 股票基本信息`,
      `- 股票名称：${detail.name || '未知'}`,
      `- 股票代码：${detail.code || '未知'}`,
      `- 所属板块：${detail.hybk || '未知'}`,
      `- 最新价：${detail.zx ? (detail.zx / 1000).toFixed(2) : '未知'}`,
      `- 涨跌幅：${detail.zdf ? detail.zdf.toFixed(2) + '%' : '未知'}`,
      `- 涨跌额：${detail.zdd ? (detail.zdd / 1000).toFixed(2) : '未知'}`,
      `- 开盘价：${detail.jk ? (detail.jk / 1000).toFixed(2) : '未知'}`,
      `- 最高价：${detail.zg ? (detail.zg / 1000).toFixed(2) : '未知'}`,
      `- 最低价：${detail.zd ? (detail.zd / 1000).toFixed(2) : '未知'}`,
      `- 昨收价：${detail.zs ? (detail.zs / 1000).toFixed(2) : '未知'}`,
      `- 成交量：${detail.cjl ? detail.cjl.toString() : '未知'}`,
      `- 成交额：${detail.cje ? detail.cje.toString() : '未知'}`,
      `- 换手率：${detail.hsl ? detail.hsl.toFixed(2) + '%' : '未知'}`,
      `- 市盈率(动)：${detail.ped || '未知'}`,
      `- 市盈率(TTM)：${detail.pettm || '未知'}`,
      `- 市净率：${detail.pb || '未知'}`,
      `- 总市值：${detail.zsz ? (detail.zsz / 100000000).toFixed(2) + '亿' : '未知'}`,
      `- 流通市值：${detail.ltsz ? (detail.ltsz / 100000000).toFixed(2) + '亿' : '未知'}`,
      `- 振幅：${detail.zf ? detail.zf.toFixed(2) + '%' : '未知'}`,
      `- 量比：${detail.lb ? detail.lb.toFixed(2) : '未知'}`,
      `- 内盘：${detail.np || '未知'}`,
      `- 外盘：${detail.wp || '未知'}`,
      `- 委比：${detail.wb ? detail.wb.toFixed(2) + '%' : '未知'}`,
      `- 委差：${detail.wc || '未知'}`,
      `- 涨停价：${detail.zt ? (detail.zt / 1000).toFixed(2) : '未知'}`,
      `- 跌停价：${detail.dt ? (detail.dt / 1000).toFixed(2) : '未知'}`,
      ``,
      `请用中文回答，格式清晰，使用 Markdown 标题分层。分析应客观、专业，风险提示必须充分。`,
    ];
    return lines.join('\n');
  }, []);

  const doAnalyze = useCallback(async () => {
    if (!kimiApiKey) {
      setError('请先在设置中配置 Kimi API Key');
      return;
    }
    if (!stock?.code) {
      setError('股票数据尚未加载');
      return;
    }
    setLoading(true);
    setError('');
    setAnalysis('');
    try {
      const prompt = buildPrompt(stock);
      const { ipcRenderer } = window.contextModules.electron;
      const result = await ipcRenderer.invoke('kimi-analyze-stock', {
        apiKey: kimiApiKey,
        prompt,
      });
      if (result?.content) {
        setAnalysis(result.content);
      } else if (result?.error) {
        setError(result.error);
      } else {
        setError('分析结果为空');
      }
    } catch (e: any) {
      setError('请求失败: ' + (e.message || String(e)));
      console.error('Kimi analyze failed:', e);
    } finally {
      setLoading(false);
    }
  }, [kimiApiKey, stock, buildPrompt]);

  useEffect(() => {
    if (active && stock?.code && !analysis && !loading && !error) {
      // 首次进入且未分析时自动分析
      doAnalyze();
    }
  }, [active, stock?.code]);

  const renderMarkdown = (text: string) => {
    // 简单的 Markdown 渲染：标题、列表、加粗、换行
    const html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/^- (.*$)/gim, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/\n/g, '<br/>');
    return { __html: html };
  };

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <Button
          type="primary"
          icon={<RobotOutlined />}
          loading={loading}
          onClick={doAnalyze}
          disabled={!kimiApiKey}
        >
          {analysis ? '重新分析' : '开始分析'}
        </Button>
        {!kimiApiKey && (
          <span className={styles.hint}>请先在设置中配置 Kimi API Key</span>
        )}
      </div>

      {error && (
        <Alert
          message={error}
          type="error"
          showIcon
          closable
          onClose={() => setError('')}
          style={{ marginBottom: 12 }}
        />
      )}

      {loading && (
        <div className={styles.loading}>
          <Spin tip="Kimi 正在分析中，请稍候..." size="large" />
        </div>
      )}

      {analysis && !loading && (
        <div className={styles.content} ref={contentRef}>
          <div
            className={styles.markdown}
            dangerouslySetInnerHTML={renderMarkdown(analysis)}
          />
        </div>
      )}

      {!analysis && !loading && !error && (
        <div className={styles.empty}>
          <RobotOutlined style={{ fontSize: 48, color: '#ccc' }} />
          <p>点击上方按钮，让 Kimi AI 为您分析这只股票</p>
        </div>
      )}
    </div>
  );
};

export default KimiAnalysis;
