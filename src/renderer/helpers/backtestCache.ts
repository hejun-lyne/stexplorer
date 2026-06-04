const electron = (() => {
  try {
    return window.contextModules.electron;
  } catch {
    return undefined;
  }
})();

export async function ReadCache<T>(key: string): Promise<T | null> {
  try {
    if (!electron) {
      return null;
    }
    const result = await electron.readCache(key);
    if (result.success) {
      return result.data?.data ?? null;
    }
    return null;
  } catch (error: any) {
    console.error('读取缓存失败:', error);
    return null;
  }
}

export async function WriteCache<T>(key: string, data: T): Promise<boolean> {
  try {
    if (!electron) {
      return false;
    }
    const result = await electron.writeCache(key, data);
    return result.success;
  } catch (error: any) {
    console.error('写入缓存失败:', error);
    return false;
  }
}
