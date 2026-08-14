import React, { useCallback, useRef } from 'react';
import { useState } from 'react';
import classnames from 'classnames';
import { useDispatch, useSelector } from 'react-redux';
import { Input, List, Popover, message, Button, Divider, Tooltip, Empty } from 'antd';
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
  VideoCameraOutlined,
  AudioOutlined,
  CodeOutlined,
  CloudOutlined,
  FileOutlined,
  LinkOutlined,
  CheckOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import styles from './index.scss';
import { NoteTabId } from '../..';
import { DetectedVideo } from '..';
import { StoreState } from '@/reducers/types';
import {
  addDownloadTaskAction,
  setDownloadStatusAction,
  updateDownloadProgressAction,
} from '@/actions/download';

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
  onDownloadBlob?: (src: string, savePath: string, onProgress: (p: number) => void) => Promise<void>;
}

const SiteBar: React.FC<SiteBarProps> = (props) => {
  const inputRef = useRef<Input>(null);
  const [edittext, setEdittext] = useState<string | undefined>(undefined);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const dispatch = useDispatch();
  const downloadTasks = useSelector((state: StoreState) => state.download.tasks);
  if (edittext && document.activeElement !== inputRef.current?.input) {
    setEdittext(undefined);
  }

  const handleCopyVideoUrl = useCallback((src: string, index?: number) => {
    try {
      const { clipboard } = window.contextModules.electron;
      clipboard.writeText(src);
      message.success('已复制视频链接');
      if (index !== undefined) {
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
      }
    } catch (e) {
      message.error('复制失败');
    }
  }, []);

  const handleCopyAllUrls = useCallback(() => {
    try {
      const allUrls = props.videos.map((v, i) => `${i + 1}. [${v.type.toUpperCase()}] ${v.src}`).join('\n');
      const { clipboard } = window.contextModules.electron;
      clipboard.writeText(allUrls);
      message.success(`已复制 ${props.videos.length} 个视频链接`);
    } catch (e) {
      message.error('复制失败');
    }
  }, [props.videos]);

  const handleDownloadVideo = useCallback(
    async (item: DetectedVideo) => {
      const isBlob = item.type === 'blob' || item.type === 'mse' || item.src.startsWith('blob:');
      if (isBlob && !props.onDownloadBlob) {
        message.error({ content: '当前版本不支持下载该视频', key: item.src });
        return;
      }
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

      const downloadKey = `${item.src}_${Date.now()}`;
      const taskTitle = item.title || defaultPath;
      // 注册全局下载任务（进度展示迁移到右侧"下载记录"）
      dispatch(
        addDownloadTaskAction({
          key: downloadKey,
          title: taskTitle,
          type: item.type,
          url: item.src,
          savePath: result.filePath,
          resumable: !isBlob,
          isM3U8,
        })
      );

      try {
        if (isBlob) {
          // blob:/MSE 视频无法由主进程直接下载，需从 webview 页面内读取数据再写文件
          try {
            await props.onDownloadBlob!(item.src, result.filePath, (p) => {
              dispatch(updateDownloadProgressAction(downloadKey, p));
            });
            dispatch(setDownloadStatusAction(downloadKey, 'done'));
            message.success({ content: '下载完成，可在下载记录中查看', key: downloadKey });
          } catch (e: any) {
            dispatch(setDownloadStatusAction(downloadKey, 'failed', e.message || String(e)));
            message.error({ content: '下载失败: ' + (e.message || String(e)), key: downloadKey });
            console.error('Download video failed:', e);
          }
          return;
        }

        // 使用支持断点续传的下载接口（暂停后可从断点继续）
        const { downloads, ipcRenderer } = window.contextModules.electron;

        // 监听进度（DownloadRecords 也会按 taskId 全局监听，这里作为兜底）
        const progressHandler = (_: any, data: { taskId?: string; url: string; progress: number }) => {
          if (data.taskId === downloadKey || data.url === item.src) {
            dispatch(updateDownloadProgressAction(downloadKey, data.progress));
          }
        };
        ipcRenderer.on('download-video-progress', progressHandler);

        try {
          await downloads.start({
            taskId: downloadKey,
            url: item.src,
            savePath: result.filePath,
            isM3U8,
            title: taskTitle,
            type: item.type,
          });
          dispatch(setDownloadStatusAction(downloadKey, 'done'));
          message.success({ content: '下载完成，可在下载记录中查看', key: downloadKey });
        } catch (e: any) {
          if (e?.code === 'PAUSED') {
            // 用户可能在下载记录中暂停或删除，静默同步状态即可
            dispatch(setDownloadStatusAction(downloadKey, 'paused'));
          } else {
            dispatch(setDownloadStatusAction(downloadKey, 'failed', e.message || String(e)));
            message.error({ content: '下载失败: ' + (e.message || String(e)), key: downloadKey });
            console.error('Download video failed:', e);
          }
        } finally {
          ipcRenderer.off('download-video-progress', progressHandler);
        }
      } catch (e) {
        dispatch(setDownloadStatusAction(downloadKey, 'failed', e instanceof Error ? e.message : String(e)));
        message.error({ content: '下载失败', key: item.src });
        console.error('Download video failed:', e);
      }
    },
    [props.onDownloadBlob]
  );

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

  const getVideoTypeIcon = (type: string) => {
    const props = { style: { fontSize: 13 } };
    switch (type) {
      case 'm3u8': return <CloudOutlined {...props} />;
      case 'video': return <VideoCameraOutlined {...props} />;
      case 'audio': return <AudioOutlined {...props} />;
      case 'blob': return <FileOutlined {...props} />;
      case 'mse': return <CodeOutlined {...props} />;
      case 'iframe': return <LinkOutlined {...props} />;
      default: return <VideoCameraOutlined {...props} />;
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
          overlayClassName={styles.videoPopoverOverlay}
          content={() =>
            props.videos.length ? (
              <div className={styles.videoPopover}>
                <div className={styles.videoHeader}>
                  <span className={styles.videoHeaderTitle}>
                    <PlayCircleOutlined style={{ marginRight: 6 }} />
                    检测到 {props.videos.length} 个媒体资源
                  </span>
                  <div className={styles.videoHeaderActions}>
                    <Tooltip title="复制全部链接">
                      <Button
                        size="small"
                        type="text"
                        icon={<CopyOutlined />}
                        onClick={handleCopyAllUrls}
                      />
                    </Tooltip>
                  </div>
                </div>
                <Divider style={{ margin: '0 0 8px' }} />
                <div className={styles.videoList}>
                  {props.videos.map((item, index) => {
                    const isDownloading = downloadTasks.some(
                      (t) => t.url === item.src && t.status === 'downloading'
                    );
                    return (
                      <div key={index} className={styles.videoCard}>
                        <div className={styles.videoCardHeader}>
                          <Tooltip title={getVideoTypeLabel(item)}>
                            <span
                              className={styles.videoType}
                              style={{ backgroundColor: getVideoTypeColor(item.type) }}
                            >
                              {getVideoTypeIcon(item.type)}
                              <span className={styles.videoTypeLabel}>{getVideoTypeLabel(item)}</span>
                            </span>
                          </Tooltip>
                          <span className={styles.videoIndex}>#{index + 1}</span>
                        </div>
                        {item.title && (
                          <div className={styles.videoTitle} title={item.title}>
                            {item.title}
                          </div>
                        )}
                        <div
                          className={styles.videoUrlRow}
                          onClick={() => handleCopyVideoUrl(item.src, index)}
                          title="点击复制链接"
                        >
                          <code className={styles.videoSrc}>{item.src}</code>
                        </div>
                        {item.mimeType && (
                          <div className={styles.videoMime}>
                            <Tooltip title="MIME 类型">
                              <span className={styles.videoMimeTag}>{item.mimeType}</span>
                            </Tooltip>
                          </div>
                        )}
                        {isDownloading && (
                          <div className={styles.videoProgressHint}>
                            <LoadingOutlined style={{ color: getVideoTypeColor(item.type) }} />
                            <span>下载中，进度见右侧「下载记录」</span>
                          </div>
                        )}
                        <div className={styles.videoCardActions}>
                          <Tooltip title={copiedIndex === index ? '已复制' : '复制链接'}>
                            <Button
                              size="small"
                              type="text"
                              className={styles.videoCardBtn}
                              icon={copiedIndex === index ? <CheckOutlined style={{ color: '#52c41a' }} /> : <CopyOutlined />}
                              onClick={() => handleCopyVideoUrl(item.src, index)}
                            />
                          </Tooltip>
                          {item.type !== 'iframe' && (
                            <Tooltip title={isDownloading ? '下载中，详见右侧下载记录' : '下载'}>
                              <Button
                                size="small"
                                type="text"
                                className={styles.videoCardBtn}
                                icon={<DownloadOutlined />}
                                onClick={() => handleDownloadVideo(item)}
                                loading={isDownloading}
                                disabled={isDownloading}
                              />
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className={styles.videoEmpty}>
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <span className={styles.videoEmptyText}>
                      当前页面未检测到视频资源
                      <br />
                      <span className={styles.videoEmptyHint}>播放视频后会自动检测</span>
                    </span>
                  }
                />
              </div>
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
