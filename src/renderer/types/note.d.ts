declare namespace Note {
  export interface NoteContentItem {
    id: number | string;
    html: string; // 预览输出
    modifiedTime: string; /// 修改时间
  }
  export interface NoteBriefItem {
    id: number | string;
    bookId: number;
    createTime: string;
    modifiedTime: string;
    firstLine: string;
  }
  export interface BookItem {
    id: number;
    name: string;
    domain?: string;
    description?: string;
    notes: NoteBriefItem[];
  }
}
