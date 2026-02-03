import React, { useCallback, useRef, useState } from 'react';
import NoteBooks from '../NoteBooks';
import styles from '../index.scss';
import CustomDrawer from '@/components/CustomDrawer';
import BookDetail from '../NoteBooks/BookDetail';
import GithubAccount from '../Github/Login';
import { useDrawer } from '@/utils/hooks';
import { MenuFoldOutlined, MenuUnfoldOutlined, PlusOutlined, SettingOutlined } from '@ant-design/icons';
import AddTagMonitor from '../StockTab/Dashboard/TagMonitor/AddTagMonitor';
import StockAssist from './StockAssist';
import { Button, Tabs } from 'antd';
import SettingContent from '@/components/SettingContent';
import MyStrategies from './MyStrategies';
import StrategyGroupDetail from './MyStrategies/StrategyGroupDetail';
import MessageBar from './MessageBar';

export interface RightSiderProps {
  activeSecid: string;
  barHidden: boolean;
  onStrategyEdit: (strategy: Strategy.BriefItem) => void;
  onNoteEdit: (note: Note.NoteBriefItem) => void;
  onOpenStock: (secid: string, name: string) => void;
  onOpenUrl: (url: string) => void;
  onOpenReview: () => void;
  toggleRightBar: () => void;
}
const RightSider: React.FC<RightSiderProps> = ({
  activeSecid,
  barHidden,
  onNoteEdit,
  onStrategyEdit,
  onOpenStock,
  onOpenUrl,
  onOpenReview,
  toggleRightBar,
}) => {
  const { show: showSettingDrawer, set: setSettingDrawer, close: closeSettingDrawer } = useDrawer<System.Setting | null>(null);
  const { show: showMonitorDrawer, set: setMonitorDrawer, close: closeMonitorDrawer } = useDrawer<System.MonitorItem | null>(null);
  const { show: showBookDrawer, set: setBookDrawer, close: closeBookDrawer, data: editingBook } = useDrawer<Note.BookItem | null>(null);
  const {
    show: showGroupDrawer,
    set: setGroupDrawer,
    close: closeGroupDrawer,
    data: editingGroup,
  } = useDrawer<Strategy.GroupItem | null>(null);
  const [width, setWidth] = useState(1);
  const div = useRef<HTMLDivElement>(null);
  const openGroup = useCallback((g: Strategy.GroupItem | null) => {
    setWidth(div.current ? div.current.offsetWidth : 200);
    setGroupDrawer(g);
  }, []);
  const openBook = useCallback((b: Note.BookItem | null) => {
    setWidth(div.current ? div.current.offsetWidth : 200);
    setBookDrawer(b);
  }, []);
  const openMonitor = useCallback((m: System.MonitorItem | null) => {
    setWidth(div.current ? div.current.offsetWidth : 200);
    setMonitorDrawer(m);
  }, []);
  const openStrategy = useCallback((strategy: Strategy.BriefItem) => {
    onStrategyEdit(strategy);
  }, []);
  const openNote = useCallback((note: Note.NoteBriefItem) => {
    onNoteEdit(note);
  }, []);
  const openSetting = useCallback((m: System.Setting | null) => {
    setWidth(div.current ? div.current.offsetWidth : 200);
    setSettingDrawer(m);
  }, []);
  return (
    <div className={styles.rightbar} ref={div}>
      <GithubAccount />
      <div className={styles.actBar}>
        <Button type="text" icon={barHidden ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />} onClick={toggleRightBar} />
        <Button type="text" onClick={() => openBook(null)} icon={<PlusOutlined />}>
          笔记本
        </Button>
        <Button type="text" onClick={() => openMonitor(null)} icon={<PlusOutlined />}>
          监控
        </Button>
        <Button type="text" onClick={() => openSetting(null)} icon={<SettingOutlined />}>
          设置
        </Button>
      </div>
      <Tabs defaultActiveKey={'knowhow'} className={styles.mainTab} style={{ height: 'calc(100% - 96px)' }}>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>策略库</span>} key={'strategies'}>
          <MyStrategies openGroup={openGroup} openStrategy={openStrategy} />
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>知识库</span>} key={'knowhow'}>
          <NoteBooks openBook={openBook} openNote={openNote} />
        </Tabs.TabPane>
      </Tabs>
      <MessageBar />
      <CustomDrawer show={showGroupDrawer} width={showGroupDrawer ? width : 1} placement="right">
        <StrategyGroupDetail
          group={editingGroup}
          onClose={() => {
            closeGroupDrawer();
            setWidth(1);
          }}
        />
      </CustomDrawer>
      <CustomDrawer show={showBookDrawer} width={showBookDrawer ? width : 1} placement="right">
        <BookDetail
          book={editingBook}
          onClose={() => {
            closeBookDrawer();
            setWidth(1);
          }}
        />
      </CustomDrawer>
      <CustomDrawer show={showMonitorDrawer} width={showMonitorDrawer ? width : 1} placement="right">
        <AddTagMonitor
          onClose={() => {
            closeMonitorDrawer();
            setWidth(1);
          }}
        />
      </CustomDrawer>
      <CustomDrawer show={showSettingDrawer} width={showSettingDrawer ? width : 1} placement="right">
        <SettingContent
          onClose={() => {
            closeSettingDrawer();
            setWidth(1);
          }}
          onOpenUrl={onOpenUrl}
        />
      </CustomDrawer>
    </div>
  );
};

export default RightSider;
