import type { DownloadTask } from '@/reducers/download';

export const ADD_DOWNLOAD_TASK = 'ADD_DOWNLOAD_TASK';
export const UPDATE_DOWNLOAD_PROGRESS = 'UPDATE_DOWNLOAD_PROGRESS';
export const SET_DOWNLOAD_STATUS = 'SET_DOWNLOAD_STATUS';
export const REMOVE_DOWNLOAD_TASK = 'REMOVE_DOWNLOAD_TASK';
export const RESTORE_DOWNLOAD_TASKS = 'RESTORE_DOWNLOAD_TASKS';

export type DownloadTaskStatus = 'downloading' | 'paused' | 'done' | 'failed';

export interface AddDownloadTaskPayload {
  key: string;
  title: string;
  type: string;
  url: string;
  savePath: string;
  /** 是否支持断点续传（file / m3u8 为 true，blob 为 false） */
  resumable?: boolean;
  /** 是否为 m3u8 播放列表 */
  isM3U8?: boolean;
}

export function addDownloadTaskAction(payload: AddDownloadTaskPayload) {
  return { type: ADD_DOWNLOAD_TASK, payload };
}

export function updateDownloadProgressAction(key: string, progress: number) {
  return { type: UPDATE_DOWNLOAD_PROGRESS, payload: { key, progress } };
}

export function setDownloadStatusAction(
  key: string,
  status: DownloadTaskStatus,
  error?: string
) {
  return { type: SET_DOWNLOAD_STATUS, payload: { key, status, error } };
}

export function removeDownloadTaskAction(key: string) {
  return { type: REMOVE_DOWNLOAD_TASK, payload: key };
}

/** 应用启动时从主进程恢复未完成的下载任务 */
export function restoreDownloadTasksAction(tasks: DownloadTask[]) {
  return { type: RESTORE_DOWNLOAD_TASKS, payload: tasks };
}
