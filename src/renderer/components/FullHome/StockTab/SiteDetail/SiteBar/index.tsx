import React, { useCallback, useRef } from 'react';
import { useState } from 'react';
import classnames from 'classnames';
import { Input, List, Popover, message, Progress } from 'antd';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ReloadOutlined,
  StarOutlined,
  StarFilled,
  EditOutlined,
  PlayCircleOutlined,
  DownloadOutlined,
  CopyOutlined,
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
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
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
      const isM3U8 = item.type === 'm3u8' || item.src.toLowerCase().includes('.m3u8');
      const extMap: Record<string, string> = {
        audio: '.mp3',
        m3u8: '.mp4',
        video: '.mp4',
        blob: '.mp4',
        mse: '.mp4',
        iframe: '.html',
      };
      const ext = extMap[item.type] || '.mp4';
      const defaultPath = `video_${Date.now()}${ext}`;
      const { dialog } = window.contextModules.electron;
      const result = await dialog.showSaveDialog({
        defaultPath,
        filters: [
          { name: 'Video', extensions: ['mp4', 'ts', 'mkv'] },
          { name: 'Audio', extensions: ['mp3'] },
          { name: 'M3U8 Index', extensions: ['m3u8'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePath) return;

      const downloadKey = item.src;
      message.loading({ content: isM3U8 ? '解析 M3U8 并下载中...' : '下载中...', key: downloadKey, duration: 0 });
      setDownloadProgress((prev) => ({ ...prev, [downloadKey]: 0 }));

      // 使用新的 IPC 接口下载
      const { ipcRenderer } = window.contextModules.electron;

      // 监听进度
      const progressHandler = (_: any, data: { url: string; progress: number }) => {
        if (data.url === downloadKey) {
          setDownloadProgress((prev) => ({ ...prev, [downloadKey]: data.progress }));
        }
      };
      ipcRenderer.on('download-video-progress', progressHandler);

      try {
        await ipcRenderer.invoke('download-video-advanced', {
          url: item.src,
          savePath: result.filePath,
          isM3U8,
        });
        message.success({ content: '下载完成', key: downloadKey });
      } catch (e: any) {
        message.error({ content: '下载失败: ' + (e.message || String(e)), key: downloadKey });
        console.error('Download video failed:', e);
      } finally {
        ipcRenderer.off('download-video-progress', progressHandler);
        setDownloadProgress((prev) => {
          const next = { ...prev };
          delete next[downloadKey];
          return next;
        });
      }
    } catch (e) {
      message.error({ content: '下载失败', key: item.src });
      console.error('Download video failed:', e);
    }
  }, []);

  const getVideoTypeLabel = (item: DetectedVideo) => {
    const labels: Record<string, string> = {
      m3u8: 'M3U8',
      video: 'VIDEO',
      audio: 'AUDIO',
      blob: 'BLOB',
      mse: 'MSE',
      iframe: 'IFRAME',
    };
    return labels[item.type] || item.type.toUpperCase();
  };

  const getVideoTypeColor = (type: string) => {
    switch (type) {
      case 'm3u8': return '#ff4d4f';
      case 'video': return '#52c41a';
      case 'audio': return '#722ed1';
      case 'blob': return '#fa8c16';
      case 'mse': return '#13c2c2';
      case 'iframe': return '#8c8c8c';
      default: return '#1890ff';
    }
  };

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
          title={`检测到 ${props.videos.length} 个视频`}
          style={{ backgroundColor: '#333' }}
          content={() =>
            props.videos.length ? (
              <List
                size="small"
                dataSource={props.videos}
                style={{ maxWidth: 480, maxHeight: 400, overflow: 'auto' }}
                renderItem={(item) => {
                  const progress = downloadProgress[item.src];
                  return (
                    <List.Item style={{ padding: '8px 0', flexDirection: 'column', alignItems: 'stretch' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                        <div className={styles.videoItem} onClick={() => handleCopyVideoUrl(item.src)}>
                          <span
                            className={styles.videoType}
                            style={{ backgroundColor: getVideoTypeColor(item.type) }}
                          >
                            {getVideoTypeLabel(item)}
                          </span>
                          <span className={styles.videoSrc} title={item.src}>{item.src}</span>
                        </div>
                        <div className={styles.videoAction} onClick={() => handleCopyVideoUrl(item.src)} title="复制链接">
                          <CopyOutlined />
                        </div>
                        {item.type !== 'iframe' && (
                          <div className={styles.videoAction} onClick={() => handleDownloadVideo(item)} title="下载">
                            <DownloadOutlined />
                          </div>
                        )}
                      </div>
                      {progress !== undefined && progress < 100 && (
                        <div style={{ marginTop: 4, paddingLeft: 4 }}>
                          <Progress size="small" percent={Math.round(progress)} status="active" />
                        </div>
                      )}
                      {item.mimeType && (
                        <div style={{ fontSize: 11, color: '#999', marginTop: 2, paddingLeft: 4 }}>
                          {item.mimeType}
                        </div>
                      )}
                    </List.Item>
                  );
                }}
              />
            ) : (
              <div style={{ padding: '8px 16px', color: '#999' }}>未检测到视频</div>
            )
          }
          trigger="click"
        >
          <div className={classnames(styles.btn, props.videos.length ? styles.enable : styles.disable)}>
            <PlayCircleOutlined />
            {props.videos.length > 0 && (
              <span style={{ fontSize: 10, marginLeft: 2 }}>{props.videos.length}</span>
            )}
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
