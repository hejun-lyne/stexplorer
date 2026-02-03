import React, { useCallback, useLayoutEffect, useRef } from 'react';
import { useState } from 'react';
import styles from './index.scss';
import { batch, useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { StrategyTabId } from '..';
import { monaco } from '@monaco-editor/react';
import MonacoEditor, { ControlledEditor } from '@monaco-editor/react';
import LoadingBar from '@/components/LoadingBar';
import { saveStrategyAction, syncRemoteStrategySourceAction, updateStrategyAction } from '@/actions/strategy';
import { useHomeContext } from '../..';
import { Button, Steps } from 'antd';
import { PlayCircleOutlined, SaveOutlined } from '@ant-design/icons';
import SplitPane from 'react-split-pane';
import StrategyResult from './StrategyResult';
import { runBackTest, runStrategy } from '@/helpers/strategy';
import { StrategyPhaseType } from '@/utils/enums';
import moment from 'moment';

const { ipcRenderer } = window.contextModules.electron;

export interface StrategyDetailProps {
  tab: StrategyTabId;
  active: boolean;
  onStrategyUpdated: (tid: string, title?: string, changed?: boolean) => void;
  onOpenStock: (secid: string, name: string, change?: number) => void;
}

let sLogs: string[] = [];
const sRunResult: Strategy.RunResult = {};
const sBTResults: Strategy.BackTestResult[] = [];
const sTradings: Strategy.BackTestTrading[] = [];
const StrategyDetail: React.FC<StrategyDetailProps> = React.memo(({ tab, active, onStrategyUpdated, onOpenStock }) => {
  const strategy = useSelector((storeState: StoreState) => storeState.strategy.strategiesMapping[tab.sid]);
  const dispatch = useDispatch();
  if (!strategy) {
    // 需要从远端同步
    dispatch(syncRemoteStrategySourceAction(tab.sid, tab.gid));
  }
  const [changeValid, setChangeValid] = useState(false);
  const onChange = useCallback(
    (ev, newValue) => {
      if (!changeValid) {
        return;
      }
      dispatch(updateStrategyAction(tab.gid, tab.sid, newValue));
      const title = newValue.substring(0, newValue.indexOf('\n'));
      onStrategyUpdated(tab.tid, title, true);
    },
    [changeValid]
  );
  const onSave = () => {
    onStrategyUpdated(tab.tid, undefined, false);
    dispatch(saveStrategyAction(tab.sid, tab.gid));
  };
  const [runDate, setRunDate] = useState<string | undefined>();
  const [runResult, setRunResults] = useState<Strategy.RunResult>(sRunResult);
  const [logs, setLogs] = useState<string[]>(sLogs);
  const [progress, setProgress] = useState<string | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const onLog = useCallback((text) => {
    // 日志区域
    if (sLogs.length > 1000) {
      sLogs = sLogs.slice(100);
    }
    if (Array.isArray(text)) {
      text.forEach((t) => sLogs.push(`${moment(new Date()).format('YYYY-MM-DD HH:mm:ss')} ${t}`));
    } else {
      sLogs.push(`${moment(new Date()).format('YYYY-MM-DD HH:mm:ss')} ${text}`);
    }
    setLogs([...sLogs]);
  }, []);
  const onProgress = useCallback((text) => {
    setProgress(text);
  }, []);
  const onRun = useCallback(() => {
    // 执行策略脚本
    setRunning(true);
    runStrategy(
      strategy.source,
      (phase, result) => {
        switch (phase) {
          case StrategyPhaseType.Candidates:
            sRunResult.candidates = result;
            setRunResults({ ...sRunResult });
            break;
          case StrategyPhaseType.BaseFilter:
            sRunResult.baseFiltered = result;
            setRunResults({
              ...sRunResult,
            });
            break;
          case StrategyPhaseType.TechFilter:
            sRunResult.techFiltered = result;
            setRunResults({
              ...sRunResult,
            });
            break;
          case StrategyPhaseType.FundFilter:
            sRunResult.fundFiltered = result;
            setRunResults({
              ...sRunResult,
            });
            break;
          case StrategyPhaseType.BKFilter:
            sRunResult.bkFiltered = result;
            setRunResults({
              ...sRunResult,
            });
            break;
          case StrategyPhaseType.Finished:
            setRunning(false);
            break;
        }
      },
      onLog,
      (text) => {
        setProgress(text);
      }
    );
  }, [strategy]);

  const [btResults, setBTResults] = useState<Strategy.BackTestResult[]>([]);
  const [btTradings, setBTTradings] = useState<Strategy.BackTestTrading[]>([]);
  const onBackTest = useCallback(() => {
    // 执行策略脚本
    setRunning(true);
    sBTResults.length = 0;
    sTradings.length = 0;
    runBackTest(
      strategy.source,
      (phase, result) => {
        switch (phase) {
          case StrategyPhaseType.Finished:
            setRunning(false);
            break;
        }
      },
      onLog,
      (text) => {
        setProgress(text);
      },
      (deal) => {
        console.log('onDeal', JSON.stringify(deal));
        sTradings.push(deal);
        setBTTradings([...sTradings]);
      },
      (result) => {
        result.trading = [];
        sBTResults.push(result);
        setBTResults([...sBTResults]);
      }
    );
  }, [strategy]);

  useLayoutEffect(() => {
    ipcRenderer.on('on-console-log', (e, data) => onLog(data));
    ipcRenderer.on('on-progress-log', (e, data) => onProgress(data));
  }, []);

  const changeThrottle = useCallback(() => {
    setChangeValid(false);
    setTimeout(() => {
      setChangeValid(true);
    }, 100);
  }, []);
  const [options] = useState({
    acceptSuggestionOnCommitCharacter: true,
    acceptSuggestionOnEnter: 'on',
    accessibilitySupport: 'auto',
    autoIndent: false,
    automaticLayout: true,
    codeLens: true,
    colorDecorators: true,
    contextmenu: true,
    cursorBlinking: 'blink',
    cursorSmoothCaretAnimation: false,
    cursorStyle: 'line',
    disableLayerHinting: false,
    disableMonospaceOptimizations: false,
    dragAndDrop: false,
    fixedOverflowWidgets: false,
    folding: true,
    foldingStrategy: 'auto',
    fontLigatures: false,
    formatOnPaste: false,
    formatOnType: false,
    hideCursorInOverviewRuler: false,
    highlightActiveIndentGuide: true,
    links: true,
    mouseWheelZoom: false,
    multiCursorMergeOverlapping: true,
    multiCursorModifier: 'alt',
    overviewRulerBorder: true,
    overviewRulerLanes: 2,
    quickSuggestions: true,
    quickSuggestionsDelay: 100,
    readOnly: false,
    renderControlCharacters: false,
    renderFinalNewline: true,
    renderIndentGuides: true,
    renderLineHighlight: 'all',
    renderWhitespace: 'none',
    revealHorizontalRightPadding: 30,
    roundedSelection: true,
    rulers: [],
    scrollBeyondLastColumn: 5,
    scrollBeyondLastLine: true,
    selectOnLineNumbers: true,
    selectionClipboard: true,
    selectionHighlight: true,
    showFoldingControls: 'mouseover',
    smoothScrolling: false,
    suggestOnTriggerCharacters: true,
    wordBasedSuggestions: true,
    // eslint-disable-next-line
    wordSeparators: `~!@#$%^&*()-=+[{]}\|;:'",.<>/?`,
    wordWrap: 'off',
    wordWrapBreakAfterCharacters: '\t})]?|&,;',
    wordWrapBreakBeforeCharacters: '{([+',
    wordWrapBreakObtrusiveCharacters: '.',
    wordWrapColumn: 80,
    wordWrapMinified: true,
    wrappingIndent: 'none',
  });
  const { darkMode } = useHomeContext();
  monaco.init().then((m) => m.editor.setTheme(!darkMode ? 'vs' : 'vs-dark'));

  const wrapperRef = useRef<HTMLDivElement>(null);
  const clearLogs = useCallback(() => {
    sLogs.length = 0; // https://stackoverflow.com/questions/1232040/how-do-i-empty-an-array-in-javascript
    batch(() => {
      setLogs([]);
      setProgress(undefined);
    });
  }, []);
  return (
    <div className={styles.container} ref={wrapperRef}>
      <SplitPane split="horizontal" minSize={40} defaultSize={200} style={{ position: 'inherit' }}>
        <div style={{ width: '100%' }}>
          {runResult && (
            <StrategyResult
              active={active}
              results={runResult}
              onOpenStock={onOpenStock}
              logs={logs}
              progress={progress}
              clearLogs={clearLogs}
              btResults={btResults}
              tradings={btTradings}
            />
          )}
          <div className={styles.actBar}>
            <Button type="text" icon={<SaveOutlined />} onClick={onSave}>
              保存
            </Button>
            <Button type="text" icon={<PlayCircleOutlined />} onClick={onRun} disabled={running}>
              筛选
            </Button>
            <Button type="text" icon={<PlayCircleOutlined />} onClick={onBackTest} disabled={running}>
              回测
            </Button>
          </div>
        </div>
        <div className={styles.content}>
          <LoadingBar show={strategy === undefined} />
          {strategy && (
            <div className={styles.editor}>
              <ControlledEditor
                height="100%"
                theme={!darkMode ? 'vs' : 'vs-dark'}
                value={strategy.source}
                language="javascript"
                options={options}
                onChange={onChange}
                editorDidMount={changeThrottle}
              />
            </div>
          )}
        </div>
      </SplitPane>
    </div>
  );
});
export default StrategyDetail;
