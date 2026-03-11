/**
 * 存储类型定义
 * 用于避免循环依赖
 */

// 统一的存储接口
export interface ContentRef {
  load(): Promise<any>;
  save(contentObj: any): Promise<any>;
}

// 存储类型
export type StorageType = 'github' | 'sqlite' | 'local';

// 加密选项
export interface StorageOptions {
  encryptKey: string;
}
