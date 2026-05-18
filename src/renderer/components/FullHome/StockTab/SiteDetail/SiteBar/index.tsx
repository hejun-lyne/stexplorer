import React, { useCallback, useRef } from 'react';
import { useState } from 'react';
import classnames from 'classnames';
import { Input, List, Popover, message } from 'antd';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ReloadOutlined,
  StarOutlined,
  StarFilled,
  EditOutlined,
  PlayCircleOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import styles from './index.scss';
import { NoteTabId } from '../..';
import { DetectedVideo } from '..';

export interface SiteBarProps {
  url: string;
  canBackward: boolean;
  canForward: boolean;
  stared: boolean;
  tabsSelectVisible: boolean;
  videos: DetectedVideo[];
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

  const handleCopyVideoUrl = useCallback((src: string) => {
    try {
      const { clipboard } = window.contextModules.electron;
      clipboard.writeText(src);
      message.success('已复制视频链接');
    } catch (e) {
      message.error('复制失败');
    }
  }, []);

  const handleDownloadVideo = useCallback(async (item: DetectedVideo) => {
    try {
      const ext = item.type === 'audio' ? '.mp3' : '.mp4';
      const defaultPath = `video_${Date.now()}${ext}`;
      const { dialog, downloadVideo } = window.contextModules.electron;
      const result = await dialog.showSaveDialog({
        defaultPath,
        filters: [{ name: item.type === 'audio' ? 'Audio' : 'Video', extensions: [item.type === 'audio' ? 'mp3' : 'mp4'] }],
      });
      if (result.canceled || !result.filePath) return;

      message.loading({ content: '下载中...', key: item.src, duration: 0 });
      await downloadVideo(item.src, result.filePath);
      message.success({ content: '下载完成', key: item.src });
    } catch (e) {
      message.error({ content: '下载失败', key: item.src });
      console.error('Download video failed:', e);
    }
  }, []);
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
          title="检测到视频"
          style={{ backgroundColor: '#333' }}
          content={() =>
            props.videos.length ? (
              <List
                size="small"
                dataSource={props.videos}
                renderItem={(item) => (
                  <List.Item>
                    <div className={styles.videoItem} onClick={() => handleCopyVideoUrl(item.src)}>
                      <span className={styles.videoType}>{item.type}</span>
                      <span className={styles.videoSrc} title={item.src}>{item.src}</span>
                    </div>
                    {item.type !== 'iframe' && (
                      <div className={styles.videoDownload} onClick={() => handleDownloadVideo(item)}>
                        <DownloadOutlined />
                      </div>
                    )}
                  </List.Item>
                )}
              />
            ) : (
              <div style={{ padding: '8px 16px', color: '#999' }}>未检测到视频</div>
            )
          }
          trigger="click"
        >
          <div className={classnames(styles.btn, props.videos.length ? styles.enable : styles.disable)}>
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
              const isUrl = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}/i.test(text);
              if (isUrl) {
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
