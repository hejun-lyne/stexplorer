import React, { useCallback, useRef } from 'react';
import { useState } from 'react';
import classnames from 'classnames';
import { Input, List, Popover } from 'antd';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ReloadOutlined,
  StarOutlined,
  StarFilled,
  EditOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import styles from './index.scss';
import { NoteTabId } from '../..';

export interface SiteBarProps {
  url: string;
  canBackward: boolean;
  canForward: boolean;
  stared: boolean;
  tabsSelectVisible: boolean;
  onBackward: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onToggleStar: (url: string) => void;
  onChangeUrl: (url: string) => void;
  getEditingNotes: () => NoteTabId[];
  confirmReferTab: (tad: NoteTabId) => void;
}

const SiteBar: React.FC<SiteBarProps> = (props) => {
  const inputRef = useRef<Input>(null);
  const [edittext, setEdittext] = useState<string | undefined>(undefined);
  if (edittext && document.activeElement !== inputRef.current?.input) {
    setEdittext(undefined);
  }
  function renderMenu() {
    return (
      <div className={styles.bar}>
        <div
          className={classnames(styles.btn, {
            [styles.enable]: props.canBackward,
            [styles.disable]: !props.canBackward,
          })}
          onClick={props.onBackward}
        >
          <ArrowLeftOutlined />
        </div>
        <div
          className={classnames(styles.btn, {
            [styles.enable]: props.canForward,
            [styles.disable]: !props.canForward,
          })}
          onClick={props.onForward}
        >
          <ArrowRightOutlined />
        </div>
        <div className={classnames(styles.btn, styles.enable)} onClick={props.onRefresh}>
          <ReloadOutlined />
        </div>
        <div
          className={classnames(styles.btn, styles.star, styles.enable)}
          onClick={() => {
            if (inputRef.current) {
              props.onToggleStar(inputRef.current.input.value);
            }
          }}
        >
          {props.stared ? <StarFilled /> : <StarOutlined />}
        </div>
        <Popover
          placement="bottom"
          visible={props.tabsSelectVisible}
          title="添加到"
          style={{ backgroundColor: '#333' }}
          content={() => (
            <List
              size="small"
              dataSource={props.getEditingNotes()}
              renderItem={(item) => <List.Item onClick={() => props.confirmReferTab(item)}>{item.title}</List.Item>}
            />
          )}
          trigger="click"
        >
          <div className={classnames(styles.btn, styles.enable)}>
            <EditOutlined />
          </div>
        </Popover>
        <Popover
          placement="bottom"
          visible={props.tabsSelectVisible}
          title="检测到可下载"
          style={{ backgroundColor: '#333' }}
          content={() => (
            <List
              size="small"
              dataSource={props.getEditingNotes()}
              renderItem={(item) => <List.Item onClick={() => props.confirmReferTab(item)}>{item.title}</List.Item>}
            />
          )}
          trigger="click"
        >
          <div className={classnames(styles.btn, styles.enable)}>
            <PlayCircleOutlined />
          </div>
        </Popover>
        <div className={styles.address}>
          <Input
            ref={inputRef}
            placeholder="URL"
            bordered={false}
            allowClear={true}
            value={edittext ? edittext : props.url}
            onChange={(e) => {
              setEdittext(e.target.value);
            }}
            onPressEnter={(e) => {
              inputRef.current?.blur();
              const text = e.target.value;
              if (
                text.includes('.com') ||
                text.includes('.cn') ||
                text.includes('.org') ||
                text.includes('.tv') ||
                text.includes('.eth') ||
                text.includes('.info') ||
                text.includes('.xyz') ||
                text.includes('.me') ||
                text.includes('.net') ||
                text.includes('.app') ||
                text.includes('.website') ||
                text.includes('.io') ||
                text.includes('.kz') ||
                text.includes('.top') ||
                text.includes('.icu') ||
                text.includes('.cc') ||
                text.includes('.site')
              ) {
                if (!text.includes('http')) {
                  props.onChangeUrl(`http://${text}`);
                } else {
                  props.onChangeUrl(text);
                }
              } else {
                props.onChangeUrl(`https://www.google.com.hk/search?q=${text}`);
              }
            }}
          />
        </div>
      </div>
    );
  }
  return <div className={classnames(styles.content)}>{renderMenu()}</div>;
};
export default SiteBar;
