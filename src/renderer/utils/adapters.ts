import * as Utils from './index';

export interface Collector<T> {
  (...arg: any): Promise<T | null>;
}

/**
 * 所有请求并行发送，所有请求完成后promise结束
 * @param requests Collector[]
 * @param delay 延迟时间
 */
export const ConCurrencyAllAdapter: <T>(requests: Collector<T>[], delay?: number) => Promise<(T | null)[]> = async (
  requests,
  delay = 0
) => {
  await Utils.Sleep(delay);
  return Promise.all(requests.map((_) => (typeof _ === 'function' ? _() : _)));
};

/**
 * 串行发送所有请求
 * @param collectors Collector[]
 * @param delay 延迟时间
 */
export const ChokeAllAdapter: <T>(requests: Collector<T>[], delay?: number) => Promise<(T | null)[]> = async <U>(
  requests: Collector<U>[],
  delay = 0
) => {
  const result: (U | null)[] = [];
  return requests
    .reduce(
      (last, next, index) =>
        last.then(next).then((res) => {
          result.push(res);
          return Utils.Sleep(delay);
        }),
      Promise.resolve()
    )
    .then(() => result);
};

/**
 * 并行发送所有请求，有一个请求结束，则所有结束
 * @param requests Collector[]
 * @param delay 延迟时间
 */
export const ConcurrencyPreemptiveAdapter: <T>(requests: Collector<T>[], delay?: number) => Promise<T | null> = async (
  requests,
  delay = 0
) => {
  await Utils.Sleep(delay);
  return new Promise((resolve, reject) => {
    requests.forEach(async (next, index) => {
      const res = await next();
      resolve(res);
    });
  });
};

/**
 * 串行发送所有请求，有一个请求结束，则所有结束
 * @param requests Collector[]
 * @param delay 延迟时间
 */
export const ChokePreemptiveAdapter: <T>(requests: Collector<T>[], delay?: number) => Promise<T | null> = async (requests, delay = 0) => {
  return new Promise((resolve, reject) => {
    requests.reduce((last, next, index) => {
      return last.then(async () => {
        try {
          const res = await next();
          return resolve(res);
        } catch {
          return Utils.Sleep(delay);
        }
      });
    }, Promise.resolve());
  });
};

/**
 * 串行任务组，每个小任务为并发
 * @param collectors Collector[]
 * @param slice 分组数量
 * @param delay 延迟时间
 */
export const ChokeGroupAdapter: <T>(collectors: Collector<T>[], slice?: number, delay?: number) => Promise<(T | null)[]> = async <T>(
  collectors: Collector<T>[],
  slice = 1,
  delay = 0
) => {
  const collectorGroups: Collector<T>[][] = [];
  collectors.forEach((collector, index: number) => {
    const groupIndex = Math.floor(index / slice);
    const group = collectorGroups[groupIndex] || [];
    group.push(collector);
    collectorGroups[groupIndex] = group;
  });

  const taskcollectors = collectorGroups.map((collectorGroup) => async () => ConCurrencyAllAdapter(collectorGroup));
  return (await ChokeAllAdapter(taskcollectors, delay)).flat();
};
