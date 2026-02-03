import NP from 'number-precision';
import dayjs from 'dayjs';
import * as Enums from '@/utils/enums';
import * as CONST from '@/constants';
import { Stock } from '@/types/stock';

const { invoke, encodeFF, decodeFF } = window.contextModules.electron;
const { version } = window.contextModules.process;

export function GroupBy(xs: any[], key: string) {
  return xs.reduce(function (rv, x) {
    (rv[x[key]] = rv[x[key]] || []).push(x);
    return rv;
  }, {});
}

export function Yang(num: string | number | undefined) {
  try {
    if (num == '--' || num == '-') {
      return '--';
    }
    if (num == undefined) {
      return '';
    }
    if (Number(num) < 0) {
      return String(Number(num).toFixed(2));
    }
    return `+${Number(num).toFixed(2)}`;
  } catch (error) {
    return String(num);
  }
}

export function CalcWithPrefix(a: any, b: any) {
  if (b >= a) {
    return `+${NP.minus(b, a)}`;
  }
  return NP.minus(b, a);
}

export function DeepCopy<T>(object: T): T {
  if (!object) {
    return object;
  }
  const data: any = object;
  try {
    return JSON.parse(JSON.stringify(data));
  } catch (error1) {
    try {
      let dataTmp: any;
      if (data === null || !(typeof data === 'object')) {
        dataTmp = data;
      } else {
        dataTmp = data instanceof Array ? [] : {};
        Object.keys(data).forEach((key) => {
          dataTmp[key] = DeepCopy(data[key]);
        });
      }
      return dataTmp;
    } catch (error2) {
      console.error('无法完成深拷贝，返回原始对象');
      return data;
    }
  }
}

export function GetStorage<T = any>(key: string, init?: T): T {
  const json = localStorage.getItem(key);
  console.log('GetStorage', key, json);
  return json ? JSON.parse(json) : init || json;
}

export function SetStorage(key: string, data: any) {
  console.log('SetStorage', key, data);
  localStorage.setItem(key, JSON.stringify(data));
}

export function ClearStorage(key: string) {
  localStorage.removeItem(key);
}

export function Encrypt(s: string) {
  return s.replace(/[+-]/g, '').replace(/[0-9]/g, '*');
}

export async function Sleep<T>(time: number, F?: T): Promise<T | undefined> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(F);
    }, time);
  });
}

export function JudgeWorkDayTime(timestamp: number) {
  const now = dayjs(timestamp);
  const hour = now.get('hour');
  const day = now.get('day');
  const minute = now.get('minute');
  const minutes = hour * 60 + minute;
  const isWorkDay = day >= 1 && day <= 5;
  const isMorningWorkTime = minutes >= 9 * 60 + 20 && minutes <= 11 * 60 + 30;
  const isAfternoonWorkTime = minutes >= 13 * 60 && minutes <= 15 * 60;
  return isWorkDay && (isMorningWorkTime || isAfternoonWorkTime);
}

export function JudgeUSWorkDayTime(timestamp: number) {
  const now = dayjs(timestamp);
  const hour = now.get('hour');
  const day = now.get('day');
  const minute = now.get('minute');
  const minutes = hour * 60 + minute;
  const isWorkDay = day >= 1 && day <= 6;
  const isMorningWorkTime = minutes >= 21 * 60 + 30 && minutes <= 23 * 60 + 59;
  const isAfternoonWorkTime = minutes <= 4 * 60;
  return isWorkDay && (isMorningWorkTime || isAfternoonWorkTime);
}

export function JudgeFixTime(timestamp: number) {
  const now = dayjs(timestamp);
  const hour = now.get('hour');
  const day = now.get('day');
  const minute = now.get('minute');
  const minutes = hour * 60 + minute;
  const isWorkDay = day >= 1 && day <= 5;
  const isFixTime = minutes <= 9 * 60 + 20 || minutes >= 11 * 60 + 30;
  return (isWorkDay && isFixTime) || !isWorkDay;
}

export function JudgeAdjustmentNotificationTime(timestamp: number, adjustmentNotificationTime: string) {
  const now = dayjs(timestamp);
  const hour = now.get('hour');
  const day = now.get('day');
  const minute = now.get('minute');
  const isWorkDay = day >= 1 && day <= 5;
  const settingTime = dayjs(adjustmentNotificationTime);
  return {
    isAdjustmentNotificationTime: isWorkDay && hour === settingTime.hour() && minute === settingTime.minute(),
    now,
  };
}

export function getVariablesColor(variables: string[]) {
  return variables.reduce<Record<string, string>>((colorMap, variable) => {
    const color = window.getComputedStyle(document.body).getPropertyValue(variable);
    colorMap[variable] = color || '';
    return colorMap;
  }, {});
}

export async function UpdateSystemTheme(setting: Enums.SystemThemeType) {
  switch (setting) {
    case Enums.SystemThemeType.Light:
      await invoke.setNativeThemeSource('light');
      break;
    case Enums.SystemThemeType.Dark:
      await invoke.setNativeThemeSource('dark');
      break;
    case Enums.SystemThemeType.Auto:
    default:
      await invoke.setNativeThemeSource('system');
  }
}

export function UnitTransform(value: number | string) {
  if (typeof value === 'string') {
    return value;
  }
  const newValue = ['', '', ''];
  let fr = 1000;
  let num = 3;
  while (value / fr >= 1) {
    fr *= 10;
    num += 1;
  }
  if (num <= 4) {
    newValue[1] = '千';
    newValue[0] = NP.divide(value, 1000).toFixed(2);
  } else if (num <= 8) {
    const text1 = parseInt(String(num - 4), 10) / 3 > 1 ? '千万' : '万';
    const fm = text1 === '万' ? 10000 : 10000000;
    newValue[1] = text1;
    newValue[0] = NP.divide(value, fm).toFixed(2);
  } else if (num <= 16) {
    let text1 = (num - 8) / 3 > 1 ? '千亿' : '亿';
    text1 = (num - 8) / 4 > 1 ? '万亿' : text1;
    text1 = (num - 8) / 7 > 1 ? '千万亿' : text1;
    let fm = 1;
    if (text1 === '亿') {
      fm = 100000000;
    } else if (text1 === '千亿') {
      fm = 100000000000;
    } else if (text1 === '万亿') {
      fm = 1000000000000;
    } else if (text1 === '千万亿') {
      fm = 1000000000000000;
    }
    newValue[1] = text1;
    newValue[0] = NP.divide(value, fm).toFixed(2);
  }
  if (value < 1000) {
    newValue[1] = '';
    newValue[0] = value.toFixed(2);
  }
  return newValue.join('');
}

export function MakeHash() {
  return Math.random().toString(36).substr(2);
}

export function Group<T>(array: T[], num: number) {
  const groupList: T[][] = [];
  array.forEach((item) => {
    const last = groupList.pop();
    if (!last) {
      groupList.push([item]);
    } else if (last.length < num) {
      groupList.push([...last, item]);
    } else if (last.length === num) {
      groupList.push(last, [item]);
    }
  });
  return groupList;
}

export function MakeMap(list: number[]): Record<number, boolean>;
export function MakeMap(list: number[]): Record<string, boolean>;
export function MakeMap(list: (string | number)[]) {
  return list.reduce((r, c) => ({ ...r, [c]: true }), {});
}

export function GetValueColor(number?: number | string) {
  const value = number === '--' ? 0 : Number(number);
  const variableColors = getVariablesColor(CONST.VARIABLES);
  let c = variableColors['--increase-color'];
  let cl = 'text-up';
  let bc = 'block-up';
  if (value < 0) {
    c = variableColors['--reduce-color'];
    cl = 'text-down';
    bc = 'block-down';
  } else if (value === 0) {
    c = variableColors['--reverse-text-color'];
    cl = 'text-none';
    bc = 'block-none';
  }
  return {
    color: c,
    textClass: cl,
    blockClass: bc,
  };
}

export function NotEmpty<TValue>(value: TValue | null | undefined) {
  return value != null && value !== undefined;
}

export function GenerateBackupConfig() {
  const config = Object.keys(CONST.STORAGE).reduce<Record<string, any>>((data, key) => {
    const content = GetStorage(key);
    if (content !== undefined) {
      data[key] = content;
    }
    return data;
  }, {});
  const fileConfig: Backup.Config = {
    name: 'My-Quantization-Backup',
    author: 'jimmy',
    version: version,
    content: encodeFF(config),
    timestamp: Date.now(),
    suffix: 'mq',
  };
  return fileConfig;
}

export function coverBackupConfig(fileConfig: Backup.Config) {
  const content = decodeFF(fileConfig.content);
  Object.entries(content).forEach(([key, value]) => {
    if (key in CONST.STORAGE && value !== undefined) {
      SetStorage(key, value);
    }
  });
}

export function calculateMA(count: any, values: any[]) {
  const result = [];
  const startIndex = count - 1;
  for (let i = 0; i < values.length; i++) {
    if (i < startIndex || isNaN(values[i])) {
      result.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = 0; j < count; j++) {
      sum += values[i - j];
    }
    result.push(NP.divide(sum, count));
  }
  return result;
}

// 济安线公式：
// AA:= ABS((2 * CLOSE + HIGH + LOW) / 4 - MA(CLOSE, N)) / MA(CLOSE, N);
// 济安线: DMA((2 * CLOSE + LOW + HIGH) / 4, AA), LINETHICK3, COLORMAGENTA;
// CC:= (CLOSE / 济安线);
// MA1:= MA(CC * (2 * CLOSE + HIGH + LOW) / 4, 3);
// MAAA:= ((MA1 - 济安线) / 济安线) / 3;
// TMP:= MA1 - MAAA * MA1;
// J: IF(TMP <= 济安线, 济安线, DRAWNULL), LINETHICK3, COLORCYAN;
// A: TMP, LINETHICK2, COLORYELLOW;
// X: IF(TMP <= 济安线, TMP, DRAWNULL), LINETHICK2, COLORGREEN;
export function calculateJAX(ks: Stock.KLineItem[], count: number) {
  const ma = calculateMA(
    count,
    ks.map((_) => _.sp)
  );
  const kma = ks.map((k) => (2 * k.sp + k.zg + k.zd) / 4);
  const aa = kma.map((v, i) => (isNaN(ma[i]) ? NaN : Math.abs((v - ma[i]) / ma[i])));
  // X = DMA(C, A) = A * X + (1 - A) * X'(A小于1）
  const jax = [NaN];
  for (let i = 1; i < kma.length; i++) {
    if (isNaN(aa[i - 1])) {
      if (!isNaN(aa[i])) {
        jax.push(kma[i]);
      } else {
        jax.push(NaN);
      }
    } else {
      const v = aa[i] * kma[i] + (1 - aa[i]) * jax[i - 1];
      jax.push(v);
    }
  }

  const cc = jax.map((j, i) => (isNaN(j) ? NaN : (ks[i].sp / j) * kma[i]));
  const ma3 = calculateMA(3, cc);
  const ma3a = ma3.map((m, i) => (isNaN(m) ? NaN : (m - jax[i]) / jax[i] / 3));
  const tmp = ma3.map((m, i) => (isNaN(m) ? NaN : m - ma3a[i] * m));
  return [jax, tmp];
}

export function calculateKDJ(ks: Stock.KLineItem[], ndays = 9, m1 = 3, m2 = 3) {
  const startIndex = ndays - 1;
  const zgs = ks.map((k, i) => {
    if (i < startIndex) {
      return NaN;
    }
    return Math.max(...ks.slice(i - startIndex, i + 1).map((_) => _.zg));
  });
  const zds = ks.map((k, i) => {
    if (i < startIndex) {
      return NaN;
    }
    return Math.max(...ks.slice(i - startIndex, i + 1).map((_) => _.zd));
  });
  const rsv = ks.map((k, i) => {
    if (i < startIndex) {
      return NaN;
    }
    return ((k.sp - zds[i]) / (zgs[i] - zds[i])) * 100;
  });
  let prevkv = 50;
  const kvals = rsv.map((r, i) => {
    if (i < startIndex) {
      return 50;
    }
    prevkv = (2 / 3) * prevkv + (1 / 3) * r;
    return prevkv;
  });
  let prevdv = 50;
  const dvals = rsv.map((r, i) => {
    if (i < startIndex) {
      return 50;
    }
    prevdv = (2 / 3) * prevdv + (1 / 3) * kvals[i];
    return prevdv;
  });
  const jvals = kvals.map((k, i) => {
    return 3 * dvals[i] - 2 * k;
  });
  return [calculateMA(m1, kvals), calculateMA(m2, dvals), jvals];
}

// {
//   公式名称: 登高望远秘
//   公式描述:
//   参数数量: 2
//   参数1: X1, 最小: 1, 最大: 50, 缺省: 6
//   参数2: X2, 最小: 1, 最大: 50, 缺省: 45
//   公式类型: 技术指标公式 - 其他类型
//   画线方法: 主图叠加
//   公式版本: 0
//   显示小数: 缺省位数
//   坐标线位置: 自动
//   额外Y轴分界: 无

//   参数精灵 /
//     请设置计算参数:
//   X1: Param#0(1.00--50.00)
//   X2: Param#1(1.00--50.00)
//   用法注释: 无
//   公式源码:}
// X_1:= MA(CLOSE, X1);
// X_2:= MA(CLOSE, X2);
// X_3:= CROSS(X_1, X_2);
// X_4:= CROSS(X_2, X_1);
// X_5:= TFILTER(X_3, X_4, 1);
// X_6:= TFILTER(X_3, X_4, 2);
// X_7:= 15;
// X_8:= 1;
// X_9:= 2.3;
// MID: MA(CLOSE, X_7), DOTLINE, COLORMAGENTA;
// UPPER: MID + X_9 * STD(CLOSE, X_7), COLORMAGENTA;
// LOWER: MID - X_8 * STD(CLOSE, X_7), COLORMAGENTA;
// DRAWICON(X_5 = 1, LOW, 1), COLORRED;
// DRAWICON(X_6 = 1, HIGH, 2), COLORRED;
export function calculateDGWY(ks: Stock.KLineItem[], count: number) {
  const sps = ks.map((_) => _.sp);
  const kma = calculateMA(count, sps); // ks.map((k) => (2 * k.sp + k.zg + k.zd) / 4);

  // 计算标准差 15
  function std(arr: number[]) {
    arr.sort((a, b) => b - 1);
    const len = arr.length;
    const ma = arr.reduce((s, a) => s + a) / len;
    return Math.sqrt(arr.map((a) => (a - ma) * (a - ma)).reduce((s, c) => s + c) / len);
  }
  const startIndex = count - 1;
  const stds = sps.map((_, i) => (i < startIndex ? NaN : std(sps.slice(i - startIndex, i + 1))));
  const uppers = stds.map((s, i) => (isNaN(s) ? NaN : kma[i] + 2.3 * stds[i]));
  const lowers = stds.map((s, i) => (isNaN(s) ? NaN : kma[i] - 1.3 * stds[i]));
  const diffs = uppers.map((s, i) => (isNaN(s) ? NaN : uppers[i] - lowers[i]));
  return [kma, uppers, lowers, diffs];
}
