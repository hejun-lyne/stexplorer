/**
 * 盘前分析（训练模式，本地存储）
 *
 * 结构与「复盘记录」不同：盘前分析按交易日每天一条、不绑定个股，
 * 存成 { [date]: { date, text, updatedAt } }，date 为 YYYY-MM-DD。
 *
 * 用途：训练日盘中/盘后复盘之前，先写下当天对市场情绪、主线与计划的判断；
 * 内容会展示在「训练记录 · 盘前分析」页签，以及训练记录逐日明细的备注里。
 */
import { GetStorage, SetStorage } from '@/utils';

export const PREOPEN_NOTE_KEY = 'trainPreopenNotes';

export interface PreopenNote {
  /** 所属交易日 YYYY-MM-DD */
  date: string;
  /** 分析内容（纯文本） */
  text: string;
  /** 最后保存时间 ISO 字符串 */
  updatedAt: string;
}

function normalizeDate(date: string): string {
  const d = String(date || '').trim();
  if (!d) {
    return '';
  }
  // 兼容 YYYYMMDD
  if (/^\d{8}$/.test(d)) {
    return `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`;
  }
  return d.substring(0, 10);
}

/** 读取全部盘前分析（date → note） */
export function ReadAllPreopenNotes(): Record<string, PreopenNote> {
  try {
    const all = GetStorage<Record<string, PreopenNote>>(PREOPEN_NOTE_KEY, {});
    return all && typeof all === 'object' ? all : {};
  } catch (error) {
    return {};
  }
}

/** 读取某个交易日的盘前分析 */
export function ReadPreopenNote(date: string): PreopenNote | null {
  const d = normalizeDate(date);
  if (!d) {
    return null;
  }
  const note = ReadAllPreopenNotes()[d];
  return note && typeof note.text === 'string' ? note : null;
}

/** 保存某个交易日的盘前分析（内容为空时删除该日记录） */
export function WritePreopenNote(date: string, text: string): PreopenNote | null {
  const d = normalizeDate(date);
  if (!d) {
    return null;
  }
  const all = ReadAllPreopenNotes();
  const content = String(text || '');
  if (!content.trim()) {
    if (all[d]) {
      delete all[d];
      SetStorage(PREOPEN_NOTE_KEY, all);
    }
    return null;
  }
  const note: PreopenNote = { date: d, text: content, updatedAt: new Date().toISOString() };
  all[d] = note;
  SetStorage(PREOPEN_NOTE_KEY, all);
  return note;
}

/** 删除某个交易日的盘前分析 */
export function RemovePreopenNote(date: string): void {
  const d = normalizeDate(date);
  if (!d) {
    return;
  }
  const all = ReadAllPreopenNotes();
  if (all[d]) {
    delete all[d];
    SetStorage(PREOPEN_NOTE_KEY, all);
  }
}

/** 全部盘前分析，按日期倒序（训练记录页签用） */
export function ListPreopenNotes(): PreopenNote[] {
  return Object.values(ReadAllPreopenNotes())
    .filter((n) => n && typeof n.text === 'string' && !!n.text.trim())
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
