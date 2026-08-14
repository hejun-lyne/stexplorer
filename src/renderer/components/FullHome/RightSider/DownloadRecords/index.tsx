import React, { useEffect, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Button, Empty, message, Progress, Tag, Tooltip } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import moment from 'moment';
import { StoreState } from '@/reducers/types';
import { DownloadTask } from '@/reducers/download';
import {
  removeDownloadTaskAction,
  restoreDownloadTasksAction,
  setDownloadStatusAction,
  updateDownloadProgressAction,
} from '@/actions/download';
import styles from './index.scss';

const DownloadRecords: React.FC = () => {
  const dispatch = useDispatch();
  const tasks = useSelector((state: StoreState) => state.download.tasks);

  // 挂载时从主进程恢复未完成的下载任务（支持跨重启断点续传）
  useEffect(() => {
    window.contextModules.electron.downloads.list().then((list) => {
      const restored: DownloadTask[] = (list || []).map((t) => ({
        key: t.taskId,
        title: t.title,
        type: t.type,
        url: t.url,
        savePath: t.savePath,
        progress: t.progress || 0,
        status: t.status === 'downloading' ? 'paused' : t.status,
        resumable: true,
        isM3U8: t.isM3U8,
        createdAt: t.createdAt,
        finishedAt: t.finishedAt,
      }));
      dispatch(restoreDownloadTasksAction(restored));
    });
  }, [dispatch]);

  // 全局下载进度监听（按 taskId 匹配，兼容暂停/继续场景）
  useEffect(() => {
    const handler = (_event: unknown, data: { taskId?: string; progress: number }) => {
      if (data && data.taskId !== undefined) {
        dispatch(updateDownloadProgressAction(data.taskId, data.progress));
      }
    };
    window.contextModules.electron.ipcRenderer.on('download-video-progress', handler);
    return () => {
      window.contextModules.electron.ipcRenderer.off('download-video-progress', handler);
    };
  }, [dispatch]);

  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => b.createdAt - a.createdAt), [tasks]);

  const typeColor = (type: string) => {
    if (type === 'm3u8') return 'volcano';
    if (type === 'blob' || type === 'mse') return 'geekblue';
    return 'purple';
  };

  const pauseTask = (task: DownloadTask) => {
    window.contextModules.electron.downloads.pause(task.key);
    dispatch(setDownloadStatusAction(task.key, 'paused'));
  };

  const resumeTask = async (task: DownloadTask) => {
    if (!task.resumable) return;
    dispatch(setDownloadStatusAction(task.key, 'downloading'));
    const { downloads } = window.contextModules.electron;
    try {
      await downloads.start({
        taskId: task.key,
        url: task.url,
        savePath: task.savePath,
        isM3U8: task.isM3U8,
        title: task.title,
        type: task.type,
      });
      dispatch(setDownloadStatusAction(task.key, 'done'));
      message.success('下载完成');
    } catch (e: any) {
      if (e?.code === 'PAUSED') {
        dispatch(setDownloadStatusAction(task.key, 'paused'));
      } else {
        dispatch(setDownloadStatusAction(task.key, 'failed', e?.message || String(e)));
        message.error(e?.message || '下载失败');
      }
    }
  };

  const removeTask = (task: DownloadTask) => {
    const { downloads } = window.contextModules.electron;
    if (task.resumable) {
      if (task.status === 'done') {
        downloads.remove(task.key);
      } else {
        // 未完成任务：取消并清理已下载的临时文件
        downloads.cancel(task.key);
      }
    }
    dispatch(removeDownloadTaskAction(task.key));
  };

  const openFolder = (savePath: string) => {
    window.contextModules.electron.shell.showItemInFolder(savePath);
  };

  const fileName = (savePath: string) => savePath.split(/[\\/]/).pop() || savePath;

  const downloadingCount = tasks.filter((t) => t.status === 'downloading').length;
  const pausedCount = tasks.filter((t) => t.status === 'paused').length;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>下载记录</span>
        <span className={styles.count}>
          {downloadingCount > 0
            ? `${downloadingCount} 个进行中`
            : pausedCount > 0
            ? `${pausedCount} 个已暂停`
            : `${tasks.length} 条记录`}
        </span>
      </div>
      {sortedTasks.length === 0 ? (
        <div className={styles.empty}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无下载记录" />
        </div>
      ) : (
        <div className={styles.list}>
          {sortedTasks.map((task) => (
            <div key={task.key} className={styles.item}>
              <div className={styles.itemHeader}>
                <span className={styles.status}>
                  {task.status === 'downloading' ? (
                    <LoadingOutlined style={{ color: 'var(--primary-color)' }} />
                  ) : task.status === 'done' ? (
                    <CheckCircleOutlined style={{ color: '#52c41a' }} />
                  ) : task.status === 'paused' ? (
                    <PauseCircleOutlined style={{ color: '#faad14' }} />
                  ) : (
                    <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                  )}
                </span>
                <Tooltip title={task.title}>
                  <span className={styles.name}>{task.title || fileName(task.savePath)}</span>
                </Tooltip>
                <Tag color={typeColor(task.type)} style={{ marginRight: 0 }}>
                  {task.type}
                </Tag>
              </div>
              {task.status === 'downloading' || task.status === 'paused' ? (
                <div className={styles.progressWrap}>
                  <Progress percent={Math.round(task.progress)} size="small" showInfo={false} />
                  <span className={styles.percent}>{Math.round(task.progress)}%</span>
                </div>
              ) : null}
              <Tooltip title={task.savePath}>
                <div className={styles.path}>{fileName(task.savePath)}</div>
              </Tooltip>
              {task.status === 'failed' && task.error ? (
                <div className={styles.error}>{task.error}</div>
              ) : null}
              <div className={styles.itemFooter}>
                <span className={styles.time}>
                  {task.status === 'downloading' || task.status === 'paused'
                    ? `开始于 ${moment(task.createdAt).format('HH:mm:ss')}`
                    : `完成于 ${moment(task.finishedAt || task.createdAt).format('MM-DD HH:mm:ss')}`}
                </span>
                <span className={styles.actions}>
                  {task.status === 'downloading' && task.resumable ? (
                    <Button
                      type="text"
                      size="small"
                      icon={<PauseCircleOutlined />}
                      onClick={() => pauseTask(task)}
                    >
                      暂停
                    </Button>
                  ) : null}
                  {(task.status === 'paused' || task.status === 'failed') && task.resumable ? (
                    <Button
                      type="text"
                      size="small"
                      icon={<PlayCircleOutlined />}
                      onClick={() => resumeTask(task)}
                    >
                      继续
                    </Button>
                  ) : null}
                  {task.status === 'done' ? (
                    <Button
                      type="text"
                      size="small"
                      icon={<FolderOpenOutlined />}
                      onClick={() => openFolder(task.savePath)}
                    >
                      打开文件夹
                    </Button>
                  ) : null}
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeTask(task)}
                  />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DownloadRecords;
