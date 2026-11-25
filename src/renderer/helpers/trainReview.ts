/**
 * 训练复盘记录（本地存储）
 *
 * 复盘只保存文字理由，不产生买卖点 / 交易记录，结构为：
 *   { [secid]: ReviewRecord[] }
 *
 * 与「买卖理由草稿」不同：草稿是未提交的输入内容，复盘是已经保存下来的记录，
 * 会按日期挂在训练记录的逐日明细里展示。
 */
import { GetStorage, SetStorage } from '@/utils';
import * as Services from '@/services';

export const REVIEW_RECORD_KEY = 'scoreStockTradeReviewRecords';

export interface ReviewRecord {
  id: string;
  /** 复盘所属日期（训练模式为训练日，YYYY-MM-DD） */
  date: string;
  /** 保存时间 HH:mm:ss */
  time: string;
  reason: string;
  /** 保存时的价格，0 表示暂无行情 */
  price: number;
}

/** 读取全部标的的复盘记录 */
export function ReadAllReviewRecords(): Record<string, ReviewRecord[]> {
  try {
    return GetStorage<Record<string, ReviewRecord[]>>(REVIEW_RECORD_KEY, {}) || {};
  } catch (e) {
    return {};
  }
}

/** 读取某只标的的复盘记录 */
export function ReadReviewRecords(secid: string): ReviewRecord[] {
  if (!secid) {
    return [];
  }
  const list = ReadAllReviewRecords()[secid];
  return Array.isArray(list) ? list : [];
}

/** 覆盖保存某只标的的复盘记录 */
export function WriteReviewRecords(secid: string, records: ReviewRecord[]) {
  if (!secid) {
    return;
  }
  try {
    const all = ReadAllReviewRecords();
    all[secid] = records;
    SetStorage(REVIEW_RECORD_KEY, all);
    // 用户库是权威副本；localStorage 仅作为同步读取的镜像
    Services.UserData.writeMirror(REVIEW_RECORD_KEY, all).catch((e) =>
      console.error('[UserData] 保存复盘到用户库失败', e)
    );
  } catch (e) {
    console.log('保存复盘记录出错', e);
  }
}

/** 启动时用用户库数据回填 localStorage 镜像（用户库为空时把现有镜像灌入用户库） */
export async function HydrateReviewRecords(): Promise<void> {
  try {
    const stored = await Services.UserData.readMirror<Record<string, ReviewRecord[]>>(REVIEW_RECORD_KEY);
    if (stored && typeof stored === 'object') {
      SetStorage(REVIEW_RECORD_KEY, stored);
    } else {
      const local = ReadAllReviewRecords();
      if (Object.keys(local).length) {
        await Services.UserData.writeMirror(REVIEW_RECORD_KEY, local);
      }
    }
  } catch (e) {
    console.error('[UserData] 回填复盘记录失败', e);
  }
}
