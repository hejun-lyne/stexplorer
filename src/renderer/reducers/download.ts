import { Reducer } from './types';
import {
  ADD_DOWNLOAD_TASK,
  UPDATE_DOWNLOAD_PROGRESS,
  SET_DOWNLOAD_STATUS,
  REMOVE_DOWNLOAD_TASK,
  RESTORE_DOWNLOAD_TASKS,
  DownloadTaskStatus,
} from '@/actions/download';

export type DownloadStatus = DownloadTaskStatus;

export type DownloadTask = {
  key: string; // 唯一标识（src + 时间戳）
  title: string; // 视频标题
  type: string; // m3u8 / video / blob ...
  url: string; // 源 URL
  savePath: string; // 保存路径
  progress: number; // 0-100
  status: DownloadStatus;
  error?: string;
  createdAt: number;
  finishedAt?: number;
  /** 是否支持断点续传（file / m3u8 为 true，blob 为 false） */
  resumable?: boolean;
  /** 是否为 m3u8 播放列表 */
  isM3U8?: boolean;
};

export type DownloadState = {
  tasks: DownloadTask[];
};

const initialState: DownloadState = {
  tasks: [],
};

const download: Reducer<DownloadState> = (state = initialState, action) => {
  switch (action.type) {
    case ADD_DOWNLOAD_TASK: {
      const task = action.payload as DownloadTask;
      return {
        ...state,
        tasks: [
          {
            ...task,
            progress: 0,
            status: 'downloading',
            createdAt: Date.now(),
          },
          ...state.tasks,
        ],
      };
    }
    case UPDATE_DOWNLOAD_PROGRESS: {
      const { key, progress } = action.payload as { key: string; progress: number };
      return {
        ...state,
        tasks: state.tasks.map((item) => (item.key === key ? { ...item, progress } : item)),
      };
    }
    case SET_DOWNLOAD_STATUS: {
      const { key, status, error } = action.payload as {
        key: string;
        status: DownloadStatus;
        error?: string;
      };
      return {
        ...state,
        tasks: state.tasks.map((item) =>
          item.key === key ? { ...item, status, error, finishedAt: Date.now() } : item
        ),
      };
    }
    case REMOVE_DOWNLOAD_TASK: {
      const key = action.payload as string;
      return {
        ...state,
        tasks: state.tasks.filter((item) => item.key !== key),
      };
    }
    case RESTORE_DOWNLOAD_TASKS: {
      const restored = action.payload as DownloadTask[];
      // 只补充本地不存在的任务，避免覆盖运行中的任务
      const existingKeys = new Set(state.tasks.map((t) => t.key));
      const merged = [
        ...state.tasks,
        ...restored.filter((t) => !existingKeys.has(t.key)),
      ];
      return { ...state, tasks: merged };
    }
    default:
      return state;
  }
};

export default download;
