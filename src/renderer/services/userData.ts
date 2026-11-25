/** 用户数据库相关的渲染进程接口 */

/** 把旧版写在股票库 / JSON 文件里的用户数据迁移到独立用户库（幂等） */
export async function migrateUserData(): Promise<void> {
  const result = await (window.contextModules.electron as any).migrateUserData();
  if (result?.success === false) {
    throw new Error(result?.error || '用户数据迁移失败');
  }
  return result?.data;
}

/** 从用户库读取 localStorage 镜像（首次启动回填） */
export async function readMirror<T = any>(key: string): Promise<T | null> {
  const result = await (window.contextModules.electron as any).readUserDataMirror(key);
  if (result?.success === false) {
    return null;
  }
  return result?.data ?? null;
}

/** 把 localStorage 的用户数据写入用户库（权威副本） */
export async function writeMirror(key: string, value: any): Promise<void> {
  const result = await (window.contextModules.electron as any).writeUserDataMirror(key, value);
  if (result?.success === false) {
    throw new Error(result?.error || '写入用户库失败');
  }
}
