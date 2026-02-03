let mCache = createMap();
let mTimeouts = createMap();

export const kDefaultCacheExpireTime = 600;

export function get(key: string) {
  return mCache[key];
}

export function set(key: string, value: any, expireTime: number) {
  del(key);
  mCache[key] = value;
  if (expireTime) {
    mTimeouts[key] = setTimeout(() => del(key), expireTime * 1000);
  }
}

export function del(key: string) {
  delete mCache[key];
  if (key in mTimeouts) {
    clearTimeout(mTimeouts[key]);
    delete mTimeouts[key];
  }
}

export function clear() {
  mCache = createMap();
  for (const key in mTimeouts) {
    clearTimeout(mTimeouts[key]);
  }
  mTimeouts = createMap();
}

function createMap() {
  return Object.create(null);
}
