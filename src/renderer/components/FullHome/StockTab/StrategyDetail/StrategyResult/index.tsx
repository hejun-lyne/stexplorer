import React from 'react';
import styles from './index.scss';
import { Tabs } from 'antd';
import FilteredStocks from './FilteredStocks';
import StrategyLogs from '../StrategyLogs';
import BackTest from '../BackTest';

export interface StrategyResultProps {
  results: Strategy.RunResult;
  logs: string[];
  progress?: string;
  active: boolean;
  btResults: Strategy.BackTestResult[];
  tradings: Strategy.BackTestTrading[];
  onOpenStock: (secid: string, name: string, change?: number) => void;
  clearLogs: () => void;
}

const StrategyResult: React.FC<StrategyResultProps> = React.memo(
  ({ results, logs, progress, active, btResults, tradings, onOpenStock, clearLogs }) => {
    return (
      <div className={styles.container}>
        <Tabs defaultActiveKey={'logs'} size="small">
          <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>日志输出</span>} key={'logs'}>
            <StrategyLogs logs={logs} progress={progress} clear={clearLogs} />
          </Tabs.TabPane>
          <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>基本过滤</span>} key={'base-filter'}>
            <FilteredStocks secids={results.baseFiltered || []} active={active} onOpenStock={onOpenStock} />
          </Tabs.TabPane>
          <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>技术过滤</span>} key={'tech-filter'}>
            <FilteredStocks secids={results.techFiltered || []} active={active} onOpenStock={onOpenStock} />
          </Tabs.TabPane>
          <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>资金过滤</span>} key={'fund-filter'}>
            <FilteredStocks secids={results.fundFiltered || []} active={active} onOpenStock={onOpenStock} />
          </Tabs.TabPane>
          <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>板块过滤</span>} key={'bk-filter'}>
            <FilteredStocks secids={results.bkFiltered || []} active={active} onOpenStock={onOpenStock} />
          </Tabs.TabPane>
          <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>历史回测</span>} key={'backtest'}>
            <BackTest progress={progress} result={btResults} openStock={onOpenStock} tradings={tradings} />
          </Tabs.TabPane>
          <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>风控卖出</span>} key={'event'}></Tabs.TabPane>
        </Tabs>
      </div>
    );
  }
);
export default StrategyResult;
