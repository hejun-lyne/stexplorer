import { Stock } from '@/types/stock';
import NP from 'number-precision';
import {EMA, MACD, FasterRSI, FasterOBV, FasterStochasticOscillator, OpenHighLowCloseVolume, FasterADX, OpenHighLowCloseNumber, FasterCG} from 'trading-signals';
import * as Helpers from '@/helpers';
import * as Enums from '@/utils/enums';
import kdj from 'kdj';
import { TechIndicatorSeriesNames, TechIndicatorType } from '@/utils/enums';

export function calculateMACD(values: number[], slowPeriods: number, fastPeriods: number, signalPeriods: number): {
  histogram: number[],
  MACD: number[],
  signal: number[]
} {
  const macd = new MACD({
    indicator: EMA,
    shortInterval: fastPeriods,
    longInterval: slowPeriods,
    signalInterval: signalPeriods
  });

  const result = {
    histogram: [] as number[],
    MACD: [] as number[],
    signal: [] as number[]
  };
  for (let i = 0; i < values.length; i++) {
    const res = macd.update(values[i]);
    if (typeof res === 'undefined') {
      result.histogram.push(0);
      result.MACD.push(0);
      result.signal.push(0);
    } else {
      result.histogram.push(Number(res.histogram));
      result.MACD.push(Number(res.macd));
      result.signal.push(Number(res.signal));
    }
  }
  return result;
}

export function calculateMA(values: number[], count: number) {
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
    result.push(sum / count);
  }
  return result;
}

/// EMA(n) = 2 / (n + 1) * (C(n) - EMA(n - 1)) + EMA(n - 1)
export function calculateEMA(values: number[], count: number) {
  const ema = new FasterEMA(count);

  const result: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const res = ema.update(values[i]);
    result.push(Number(res));
    // const a = 2.0 / (count + 1);
    // result.push(a * values[i] + (1 - a) * result[i - 1]);
  }
  return result;
}

export function calculateOBV(ks: Stock.KLineItem[]) {
  const obv = new FasterOBV();
  const result:number[] = [];

  for (let i = 0; i < ks.length; i++) {
    const ohlcv: OpenHighLowCloseVolume = {
      open: ks[i].kp,
      high: ks[i].zg,
      low: ks[i].zd,
      close: ks[i].sp,
      volume: ks[i].cjl
    };
    const res = obv.update(ohlcv);
    if (typeof res === 'undefined') {
      result.push(0);
    } else {
      result.push(Number(res));
    }
  }
  return result;
}

export function calculateRSI(sps: number[], count: number) {
  const rsi = new FasterRSI(count);

  const result:number[] = [];

  for (let i = 0; i < sps.length; i++) {
    const res = rsi.update(sps[i]);
    if (typeof res === 'undefined') {
      result.push(0);
    } else {
      result.push(Number(res));
    }
  }
  return result;
  // const startIndex = count - 1;
  // for (let i = 0; i < zdfs.length; i++) {
  //   if (i < startIndex || isNaN(zdfs[i])) {
  //     result.push(NaN);
  //     continue;
  //   }
  //   let sum = 0;
  //   let asum = 0;
  //   for (let j = 0; j < count; j++) {
  //     sum += zdfs[i - j] > 0 ? zdfs[i - j] : 0;
  //     asum += Math.abs(zdfs[i - j]);
  //   }
  //   result.push(sum / asum);
  // }
  // return result;
}

export function calculateADV(ks: Stock.KLineItem[]) {
  const adv = new FasterADX(6);
  const result:number[] = [];
  const mdi: number[] = [];
  const pdi: number[] = [];
  for (let i = 0; i < ks.length; i++) {
    const ohlc: OpenHighLowCloseNumber = {
      open: ks[i].kp,
      high: ks[i].zg,
      low: ks[i].zd,
      close: ks[i].sp,
    };
    const res = adv.update(ohlc);
    if (typeof res === 'undefined') {
      result.push(0);
      mdi.push(0);
      pdi.push(0);
    } else {
      result.push(Number(res));
      mdi.push(Number(adv.mdi));
      pdi.push(Number(adv.pdi));
    }
  }
  return [result, pdi, mdi];
}

export function calculateSTOCH(ks: Stock.KLineItem[]) {
  const stoch = new FasterStochasticOscillator(14, 3, 3);
  const d: number[] = [];
  const k: number[] = [];
  for (let i = 0; i < ks.length; i++) {
    const ohlc: OpenHighLowCloseNumber = {
      open: ks[i].kp,
      high: ks[i].zg,
      low: ks[i].zd,
      close: ks[i].sp,
    };
    const res = stoch.update(ohlc);
    if (typeof res === 'undefined') {
      d.push(0);
      k.push(0);
    } else {
      d.push(Number(res.stochD));
      k.push(Number(res.stochK));
    }
  }
  return [d, k];
}

export function calculateCG(ks: Stock.KLineItem[]) {
  const cg = new FasterCG(14, 5);
  const r: number[] = [];
  const s: number[] = [];
  for (let i = 0; i < ks.length; i++) {
    const res = cg.update(ks[i].sp);
    if (typeof res === 'undefined') {
      r.push(0);
      s.push(0);
    } else {
      r.push(Number(res));
      s.push(Number(cg.signal.getResult()));
    }
  }
  return [r, s];
}

export function calculateIndicators(ks: Stock.KLineItem[], techType: TechIndicatorType, opaque: any = undefined) {
  var values: number[][] = [];
  var names: string[] = TechIndicatorSeriesNames[techType];
  switch (techType) {
    case TechIndicatorType.MACD:
      const macd = calculateMACD(ks.map((_) => _.sp), 26, 12, 9);
      values = [macd.histogram, macd.MACD, macd.signal];
      break;
    case TechIndicatorType.KDJ:
      values = calculateKDJ(ks);
      break;
    case TechIndicatorType.RSI:
      const sps = ks.map((_) => _.sp);
      values = [calculateRSI(sps, 6), calculateRSI(sps, 12), calculateRSI(sps, 24)];
      break;
    case TechIndicatorType.OBV:
      values = [calculateOBV(ks)];
      break;
    case TechIndicatorType.ADV:
      values = calculateADV(ks);
      break; 
    case TechIndicatorType.STOCH:
      values = calculateSTOCH(ks);
      break;
    case TechIndicatorType.CG:
      values = calculateCG(ks);
      break;
    default:
      break;
  }


  return {
    names,
    values,
    techType,
    opaque
  };
}

export function calculateJAX(ks: Stock.KLineItem[], count: number) {
  const ma = calculateMA(
    ks.map((_) => _.sp),
    count
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
  const ma3 = calculateMA(cc, 3);
  const ma3a = ma3.map((m, i) => (isNaN(m) ? NaN : (m - jax[i]) / jax[i] / 3));
  const tmp = ma3.map((m, i) => (isNaN(m) ? NaN : m - ma3a[i] * m));
  return [jax, tmp];
}

export function calculateKDJ(ks: Stock.KLineItem[], ndays = 9, m1 = 3, m2 = 3) : number[][] {
  const res: {
    K: number[],
    D: number[],
    J: number[]
  } = kdj(ks.map(_ => _.sp), ks.map(_ => _.zd), ks.map(_ => _.zg), ndays, m1, m2, 3, 2);
  return [res.K, res.D, res.J];

  // const startIndex = ndays - 1;
  // const zgs = ks.map((k, i) => {
  //   if (i < startIndex) {
  //     return NaN;
  //   }
  //   return Math.max(...ks.slice(i - startIndex, i + 1).map((_) => _.zg));
  // });
  // const zds = ks.map((k, i) => {
  //   if (i < startIndex) {
  //     return NaN;
  //   }
  //   return Math.max(...ks.slice(i - startIndex, i + 1).map((_) => _.zd));
  // });
  // const rsv = ks.map((k, i) => {
  //   if (i < startIndex) {
  //     return NaN;
  //   }
  //   return ((k.sp - zds[i]) / (zgs[i] - zds[i])) * 100;
  // });
  // let prevkv = 50;
  // const kvals = rsv.map((r, i) => {
  //   if (i < startIndex) {
  //     return 50;
  //   }
  //   prevkv = (2 / 3) * prevkv + (1 / 3) * r;
  //   return prevkv;
  // });
  // let prevdv = 50;
  // const dvals = rsv.map((r, i) => {
  //   if (i < startIndex) {
  //     return 50;
  //   }
  //   prevdv = (2 / 3) * prevdv + (1 / 3) * kvals[i];
  //   return prevdv;
  // });
  // const jvals = kvals.map((k, i) => {
  //   return 3 * dvals[i] - 2 * k;
  // });
  // return [calculateMA(kvals, m1), calculateMA(dvals, m2), jvals];
}

export function calculateDGWY(ks: Stock.KLineItem[], count: number) {
  const sps = ks.map((_) => _.sp);
  const kma = calculateMA(sps, count); // ks.map((k) => (2 * k.sp + k.zg + k.zd) / 4);

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

/**
 *
 * @param klines K线数据
 * @param accuracyFactor 分多少组
 */
export function calculateChouMa(klines: { date: string; zg: number; zd: number; hsl: number }[], accuracyFactor = 150) {
  // r => accuracyFactor
  let maxZg = 0; // e
  let minZd = 0; // o
  // 计算周期的最高、最低
  klines.forEach((k, i) => {
    // s => k, a => i
    maxZg = maxZg ? Math.max(maxZg, k.zg) : k.zg;
    minZd = minZd ? Math.min(minZd, k.zd) : k.zd;
  });

  const step = Math.max(0.01, (maxZg - minZd) / (accuracyFactor - 1)); // l
  const steps = []; // h
  const data: number[] = []; // d
  for (let i = 0; i < accuracyFactor; i++) {
    steps.push((minZd + step * i).toFixed(2));
    data.push(0);
  }
  klines.forEach((k, i) => {
    // i => a, c => k, p => k.kp, g => k.sp, A => k.zg, u => k.zd
    const avg = (k.kp + k.sp + k.zg + k.zd) / 4; // f
    const hsl = Math.min(1, k.hsl / 100 || 0); // m
    const ZgtoMinZd = Math.floor((k.zg - minZd) / step); // C
    const ZdtoMinZd = Math.ceil((k.zd - minZd) / step); // y
    const pair = [k.zg === k.zd ? accuracyFactor - 1 : 2 / (k.zg - k.zd), Math.floor((avg - minZd) / step)]; // v
    for (let j = 0; j < data.length; j++) {
      // j => x
      data[j] *= 1 - hsl;
    }
    if (k.zg === k.zd) {
      data[pair[1]] += (pair[0] * hsl) / 2;
    } else {
      for (let ii = ZdtoMinZd; ii <= ZgtoMinZd; ii++) {
        // ii => I
        const b = minZd + step * ii;
        if (b <= avg) {
          if (Math.abs(avg - k.zd) < 1e-8) {
            data[ii] += pair[0] * hsl;
          } else {
            data[ii] += ((b - k.zd) / (avg - k.zd)) * pair[0] * hsl;
          }
        } else {
          if (Math.abs(k.zg - avg) < 1e-8) {
            data[ii] += pair[0] * hsl;
          } else {
            data[ii] += ((k.zg - b) / (k.zg - avg)) * pair[0] * hsl;
          }
        }
      }
    }
  });

  let total = 0; // k
  const lastSp = klines[klines.length - 1].sp; // w
  let benefitTotal = 0;
  for (let i = 0; i < data.length; i++) {
    // i => a
    total += data[i];
    if (minZd + i * step <= lastSp) {
      benefitTotal += data[i];
    }
  }
  if (total === 0) {
    console.log('ComputeChouMa: something bad happen');
  }
  const benefitPart = total == 0 ? 0 : benefitTotal / total;

  function findPercentValue(p: number) {
    let sum = 0;
    let result = 0;
    for (let i = 0; i < accuracyFactor; i++) {
      const a = data[i];
      if (p < sum + a) {
        result = minZd + i * step;
        break;
      }
      sum += a;
    }
    return result;
  }

  function computePercentChips(p: number) {
    const pair = [(1 - p) / 2, (1 + p) / 2]; // e
    const result = [findPercentValue(total * pair[0]), findPercentValue(total * pair[1])];
    return {
      percentile: p,
      priceRange: {
        start: result[0].toFixed(2),
        end: result[1].toFixed(2),
      },
      concentration: result[0] + result[1] === 0 ? 0 : (result[1] - result[0]) / (result[0] + result[1]),
    };
  }

  const percentChips = [computePercentChips(0.9), computePercentChips(0.7)];

  const avgCost = findPercentValue(0.5 * total).toFixed(2);
  return {
    date: klines.slice(-1)[0].date,
    values: data,
    steps,
    benefitRatio: benefitPart,
    avgCost,
    percentChips,
  } as Stock.ChouMaItem;
}

export function DescribeKlines(klines: Stock.KLineItem[]) {
  const referDays = 40; // 参考最近10天的k线作为形态判别
  if (klines.length <= referDays) {
    return;
  }
  function stateK(k: Stock.KLineItem) {
    const isYin = k.kp > k.sp;
    const entityTop = Math.max(k.kp, k.sp);
    const entityDown = Math.min(k.kp, k.sp);
    const entityCenter = (entityTop + entityDown) / 2;
    const entitySize = (entityTop - entityDown) / entityCenter;
    const topHatch = (k.zg - entityTop) / entityCenter;
    const downHatch = (entityDown - k.zd) / entityCenter;
    return { isYin, entitySize, topHatch, downHatch };
  }
  const data = klines.map((_) => stateK(_));
  for (let i = data.length - 1; i > referDays; i--) {
    const prevs = data.slice(i - referDays, i + 1);
    const avgEntitySize = prevs.reduce((s, { entitySize }) => s + entitySize, 0) / prevs.length;
    const avgTopHatch = prevs.reduce((s, { topHatch }) => s + topHatch, 0) / prevs.length;
    const avgDownHatch = prevs.reduce((s, { downHatch }) => s + downHatch, 0) / prevs.length;
    const avgHatch = (avgTopHatch + avgDownHatch) / 2;
    const shape = {
      yin: data[i].isYin,
      size: data[i].entitySize / avgEntitySize,
      top: data[i].topHatch / avgHatch,
      down: data[i].downHatch / avgHatch,
    };
    if (klines[i].date == '2022-07-13') {
      console.log('debug');
    }
    // 实体大小
    let sizeType = Enums.KLineEntitySize.Unknow;
    if (shape.size < 0.5) {
      // small
      sizeType = Enums.KLineEntitySize.Small;
    } else if (shape.size > 1.5) {
      // big
      sizeType = Enums.KLineEntitySize.Big;
    } else {
      // medium
      sizeType = Enums.KLineEntitySize.Medium;
    }
    // 影线
    let hatchType = Enums.KLineHatchType.Unknow;
    if (shape.top < 0.5) {
      if (shape.down < 0.5) {
        hatchType = Enums.KLineHatchType.EqualTiny;
      } else if (shape.down > 1.5 || shape.down > 2 * shape.top /*&& shape.down > 3 * shape.size*/) {
        hatchType = Enums.KLineHatchType.SuperDown;
      } else {
        hatchType = Enums.KLineHatchType.MoreDown;
      }
    } else if (shape.top > 1.5) {
      if (shape.down < 0.5 || shape.top > 2 * shape.down /*&& shape.top > 3 * shape.size*/) {
        hatchType = Enums.KLineHatchType.SuperTop;
      } else if (shape.down > 1.5) {
        hatchType = Enums.KLineHatchType.EqualSuper;
      } else {
        hatchType = Enums.KLineHatchType.MoreTop;
      }
    } else {
      if (shape.down < 0.5) {
        if (shape.top > 1 && shape.top > 3 * shape.size) {
          hatchType = Enums.KLineHatchType.SuperTop;
        } else {
          hatchType = Enums.KLineHatchType.MoreTop;
        }
      } else if (shape.down > 1.5) {
        if (shape.down > 2 * shape.top && shape.down > 3 * shape.size) {
          hatchType = Enums.KLineHatchType.SuperDown;
        } else {
          hatchType = Enums.KLineHatchType.MoreDown;
        }
      } else {
        hatchType = Enums.KLineHatchType.EqualMedium;
      }
    }
    // 根据size和hatch判断shape
    let shapeType = Enums.SingleKLineShape.Unknown;
    if (sizeType == Enums.KLineEntitySize.Small) {
      if (hatchType == Enums.KLineHatchType.SuperTop) {
        shapeType = Enums.SingleKLineShape.BJX;
      } else if (hatchType == Enums.KLineHatchType.SuperDown) {
        shapeType = Enums.SingleKLineShape.DBJX;
      } else if (
        hatchType == Enums.KLineHatchType.EqualMedium ||
        hatchType == Enums.KLineHatchType.EqualSuper ||
        hatchType == Enums.KLineHatchType.MoreTop ||
        hatchType == Enums.KLineHatchType.MoreDown
      ) {
        shapeType = Enums.SingleKLineShape.SZX;
      } else if (hatchType == Enums.KLineHatchType.EqualTiny) {
        shapeType = Enums.SingleKLineShape.LXJ;
      }
    } else if (sizeType == Enums.KLineEntitySize.Medium) {
      if (hatchType == Enums.KLineHatchType.SuperDown) {
        shapeType = Enums.SingleKLineShape.TCX;
      } else if (hatchType == Enums.KLineHatchType.SuperTop) {
        shapeType = Enums.SingleKLineShape.DTCX;
      } else if (hatchType == Enums.KLineHatchType.EqualTiny) {
        shapeType = Enums.SingleKLineShape.ZHMBB;
      } else {
        shapeType = Enums.SingleKLineShape.FCX;
      }
    } else if (sizeType == Enums.KLineEntitySize.Big) {
      if (hatchType == Enums.KLineHatchType.SuperDown || hatchType == Enums.KLineHatchType.MoreDown) {
        shapeType = Enums.SingleKLineShape.DXBB;
      } else if (hatchType == Enums.KLineHatchType.SuperTop || hatchType == Enums.KLineHatchType.MoreTop) {
        shapeType = Enums.SingleKLineShape.TXBB;
      } else {
        if (shape.size > shape.top && shape.size > shape.down) {
          shapeType = Enums.SingleKLineShape.DHMBB;
        } else {
          shapeType = Enums.SingleKLineShape.FCX;
        }
      }
    }

    klines[i].describe = {
      ...shape,
      sizeType,
      hatchType,
      sshapeType: shapeType,
      mshapeType: Enums.MultiKlineShape.Unknown,
    };
  }
}

export function DetermineKlines(klines: Stock.KLineItem[]) {
  const referDays = 100;
  if (klines.length <= referDays) {
    return;
  }
  const short_days = 20;
  const medium_days = 40;
  const long_days = 60;
  const vals = klines.map(({ sp }) => sp);
  const ma_short = calculateMA(vals, short_days);
  const ma_medium = calculateMA(vals, medium_days);
  const ma_long = calculateMA(vals, long_days);
  const ma1_diffs = ma_medium.map((v, i) => v - ma_short[i]);
  const ma2_diffs = ma_long.map((v, i) => v - ma_medium[i]);
  const ma3_diffs = ma_long.map((v, i) => v - ma_short[i]);
  const [jax_short, jax_long] = calculateJAX(klines, 15);
  const jax_diffs = jax_short.map((s, i) => (isNaN(s) || isNaN(jax_long[i]) ? NaN : s - jax_long[i]));
  const [dgwy_ma, dgwy_uppers, dgwy_lowers] = calculateDGWY(klines, 15);

  // filter buy
  for (let n = referDays; n < klines.length; n++) {
    const k = klines[n];
    k.buyorsell = {
      canBuy: false,
      doBuy: false,
      canSell: false,
      buyReason: '',
      sellReason: '',
    };
    if (k.zg < ma_long[n]) {
      k.buyorsell.buyReason = 'ma_long break down';
      continue;
    }
    let angleAIndex = 0;
    for (let i = n; i >= 0; i--) {
      if (ma1_diffs[i] > 0) {
        // 长线穿越短线
        angleAIndex = i;
        break;
      }
    }
    if (n - angleAIndex < short_days) {
      k.buyorsell.buyReason = 'ma_short break down';
      continue;
    }
    let angleAAIndex = 0;
    for (let i = n; i >= 0; i--) {
      if (ma2_diffs[i] > 0) {
        // 长线穿越短线
        angleAAIndex = i;
        break;
      }
    }
    if (n - angleAAIndex < short_days / 2) {
      k.buyorsell.buyReason = 'ma_medium break down';
      continue;
    }
    // 最近n日到达均线支撑
    const cdays = 2;
    function kcontains(k: Stock.KLineItem, v: number) {
      // console.log('kcontains', k.zg, k.zd, v);
      return k.zg >= v && k.zd <= v;
    }
    let kreachMatch = false;
    for (let i = 0; i < cdays && !kreachMatch; i++) {
      kreachMatch = kcontains(klines[n - i], ma_medium[n - i]) || kcontains(klines[n - i], ma_long[n - i]);
    }
    if (!kreachMatch) {
      k.buyorsell.buyReason = 'ma_medium | ma_long not reach';
      continue;
    }
    // 判断三角形态：均线交叉点、最高点、当前点
    let angleAAAIndex = 0;
    for (let i = n; i >= 0; i--) {
      if (ma3_diffs[i] > 0) {
        // 长线穿越短线
        angleAAAIndex = i;
        break;
      }
    }
    let angleBIndex = angleAAAIndex;
    let maxsp = 0;
    for (let i = angleAAAIndex + 1; i <= n; i++) {
      if (klines[i].sp > maxsp) {
        maxsp = klines[i].sp;
        angleBIndex = i;
      }
    }
    // stdA is equal to 1
    const stdB = Math.round(((klines[angleBIndex].sp + klines[angleBIndex].kp) / 2 / klines[angleAAAIndex].kp - 1) * 100);
    const stdC = Math.round(((k.sp + k.kp) / 2 / klines[angleAAAIndex].kp - 1) * 100);
    const lineAB = Math.sqrt(Math.pow(stdB, 2) + Math.pow(angleBIndex - angleAAAIndex, 2));
    const lineBC = Math.sqrt(Math.pow(stdB - stdC, 2) + Math.pow(n - angleBIndex, 2));
    // angleC代表回调力度（越小越好）
    const angleC = Math.atan2(stdB - stdC, n - angleBIndex);
    const ratioCBThreshold = angleC < 0.5 ? 1 : 0.718; //0.618;
    // ratioCB代表回调长度（越短越好）
    const ratioCB = lineBC / lineAB;
    if (ratioCB > ratioCBThreshold) {
      k.buyorsell.buyReason = 'ratioCB too big';
      continue;
    }
    // 要求不能长期回调
    // console.log('jax.length', jax_diffs.length, klen);
    // 好的形态是短线一直在济安线上方
    if (jax_diffs[n] > 0) {
      let count = 0;
      for (let i = n; i >= 0; i--) {
        if (jax_diffs[i] > 0) {
          count++;
        } else {
          break;
        }
      }
      if (count >= 5) {
        k.buyorsell.buyReason = 'jax break down';
        continue;
      }
    }
    // 最近2日回踩下沿
    if (k.zd > dgwy_lowers[n] && klines[n - 1].zd > dgwy_lowers[n - 1]) {
      k.buyorsell.buyReason = 'dgwy.lowers not match';
      continue;
    }
    if (k.date == '2022-06-06') {
      console.log('debug');
    }
    const des = k.describe;
    if (!des) {
      continue;
    }
    if (des.sshapeType == Enums.SingleKLineShape.SZX || des.sshapeType == Enums.SingleKLineShape.DBJX) {
      k.buyorsell.canBuy = true;
      k.buyorsell.buyReason = 'shape: ' + Enums.SingleKLineShapeNames[des.sshapeType];
    }
    if (
      !des.yin &&
      (des.sshapeType == Enums.SingleKLineShape.TCX ||
        des.sshapeType == Enums.SingleKLineShape.LXJ ||
        des.sshapeType == Enums.SingleKLineShape.DXBB ||
        des.sshapeType == Enums.SingleKLineShape.XHMBB ||
        des.sshapeType == Enums.SingleKLineShape.ZHMBB)
    ) {
      // 探底走势
      k.buyorsell.canBuy = true;
      k.buyorsell.buyReason = 'shape: ' + Enums.SingleKLineShapeNames[des.sshapeType];
    }
  }
  // do buy
  for (let n = referDays + 1; n < klines.length; n++) {
    const k = klines[n];
    const lastK = klines[n - 1];
    const desc = k.describe;
    const bos = k.buyorsell;
    const lastBos = lastK.buyorsell;
    if (!desc || !bos || !lastBos) {
      continue;
    }

    if (k.date == '2022-06-07') {
      console.log('debug');
    }
    if (!lastBos.canBuy) {
      continue;
    }
    if (desc.sshapeType == Enums.SingleKLineShape.BJX || desc.sshapeType == Enums.SingleKLineShape.DTCX) {
      // 冲高回落
      continue;
    }
    if (desc.yin) {
      if (
        desc.sshapeType == Enums.SingleKLineShape.ZHMBB ||
        desc.sshapeType == Enums.SingleKLineShape.DHMBB ||
        desc.sshapeType == Enums.SingleKLineShape.TXBB ||
        desc.sshapeType == Enums.SingleKLineShape.DBJX ||
        desc.sshapeType == Enums.SingleKLineShape.DXBB
      ) {
        continue;
      }
    }
    // 不能突破前低
    if (k.sp < lastK.zd) {
      continue;
    }
    // 是否已经处于高位
    if (k.zg / lastK.zd > 1.1) {
      continue;
    }
    bos.buyReason = 'all filters passed';
    bos.doBuy = true;
  }
  // do sell
  for (let n = referDays + 1; n < klines.length; n++) {
    const k = klines[n];
    const lastK = klines[n - 1];
    const desc = k.describe;
    const bos = k.buyorsell;
    if (!desc || !bos) {
      continue;
    }
    if (desc.sshapeType == Enums.SingleKLineShape.DBJX) {
      bos.sellReason = 'shape: ' + Enums.SingleKLineShapeNames[desc.sshapeType];
      continue;
    }
    if (desc.sshapeType == Enums.SingleKLineShape.TXBB && desc.top > 3) {
      bos.sellReason = 'shape: desc.top > 3 ' + Enums.SingleKLineShapeNames[desc.sshapeType];
      continue;
    }
    // if (desc.yin) {
    //   if (desc.sshapeType == Enums.SingleKLineShape.TXBB || desc.sshapeType == Enums.SingleKLineShape.DHMBB) {
    //     bos.canSell = true;
    //     bos.sellReason = 'shape: ' + Enums.SingleKLineShapeNames[desc.sshapeType];
    //     continue;
    //   }
    //   if (desc.sshapeType == Enums.SingleKLineShape.ZHMBB && k.sp / k.kp < 0.95) {
    //     bos.canSell = true;
    //     bos.sellReason = 'shape: ' + Enums.SingleKLineShapeNames[desc.sshapeType];
    //     continue;
    //   }
    // }
    if (desc.sshapeType == Enums.SingleKLineShape.BJX || desc.sshapeType == Enums.SingleKLineShape.DTCX) {
      if (k.zg / Math.max(k.kp, k.sp) > 1.03) {
        // 下跌超过3个点
        if (desc.top > 1.5 && desc.top > 2 * desc.down) {
          bos.canSell = true;
          bos.sellReason = 'shape: ' + Enums.SingleKLineShapeNames[desc.sshapeType];
          continue;
        }
      }
    }
    if (desc.top > 1.5 && desc.top > desc.size) {
      if (k.zg / Math.max(k.kp, k.sp) > 1.03) {
        // 下跌超过3个点
        // 双针探顶
        for (let i = n - 1; i >= 0; i--) {
          const prek = klines[i];
          if (prek.zg < k.zd) {
            break;
          }
          if (prek.zd > k.zg) {
            break;
          }
          if (!prek.describe) {
            continue;
          }
          if (prek.describe.top > 1.5 && prek.describe.top > prek.describe.size) {
            // 要求这个k线是最近最高的
            if (prek.zg > klines[i - 1].zg && prek.zg > klines[i - 2].zg) {
              // 找到双针，检查是否相互重叠
              if ((prek.zg > k.zg && prek.zd < k.zd) || (prek.zg < k.zg && prek.zd > k.zd)) {
                bos.canSell = true;
                bos.sellReason = 'checkSell double top' + prek.date;
                break;
              }
            }
          }
        }
      }
    }
    if (!bos.canSell) {
      // 连续新低
      const prek = klines[n - 1];
      const predesc = prek.describe;
      if (predesc && predesc.yin) {
        // if (desc.sshapeType == Enums.SingleKLineShape.TXBB || desc.sshapeType == Enums.SingleKLineShape.DHMBB) {
        //   bos.canSell = true;
        //   bos.sellReason = 'shape: ' + Enums.SingleKLineShapeNames[desc.sshapeType];
        //   continue;
        // }
        // if (desc.sshapeType == Enums.SingleKLineShape.ZHMBB && k.sp / k.kp < 0.95) {
        //   bos.canSell = true;
        //   bos.sellReason = 'shape: ' + Enums.SingleKLineShapeNames[desc.sshapeType];
        //   continue;
        // }
      }
      // 破位
      if (klines[n - 1].sp < ma_long[n - 1] && klines[n - 2].sp < ma_long[n - 2] && klines[n - 3].sp >= ma_long[n - 3]) {
        bos.canSell = true;
        bos.sellReason = 'ma_long break down';
        continue;
      }
      if (k.zg < prek.zg && prek.zg < klines[n - 2].zg) {
        if (desc.sshapeType == Enums.SingleKLineShape.TCX && desc.down > 2) {
          continue;
        }
        if (desc.sshapeType == Enums.SingleKLineShape.SZX) {
          continue;
        }
        if (desc.yin || desc.sshapeType == Enums.SingleKLineShape.BJX || desc.sshapeType == Enums.SingleKLineShape.DTCX) {
          const desc1 = prek.describe!;
          if (
            desc1.yin ||
            desc1.sshapeType == Enums.SingleKLineShape.BJX ||
            desc1.sshapeType == Enums.SingleKLineShape.SZX ||
            desc1.sshapeType == Enums.SingleKLineShape.DTCX
          ) {
            if (k.zd < prek.zd) {
              // 新低
              const desc2 = klines[n - 2].describe!;
              if (
                desc2.yin ||
                desc2.sshapeType == Enums.SingleKLineShape.BJX ||
                desc2.sshapeType == Enums.SingleKLineShape.SZX ||
                desc2.sshapeType == Enums.SingleKLineShape.DTCX
              ) {
                if (prek.zd < klines[n - 2].zd) {
                  // 新低
                  bos.canSell = true;
                  bos.sellReason = 'continous lower';
                  continue;
                }
              }
            }
          }
        }
      }
    }
  }
}

/**
 * 找到相似K线
 * @param secid 模版标的
 * @param startDate K线开始日期
 * @param endDate K线结束日期
 */
export function MatchKlines(template: Stock.KLineItem[], target: Stock.KLineItem[]) {
  // 归一化
  template.forEach((k, i) => {
    k.kp /= target[0].kp;
    k.sp /= target[0].kp;
    k.zg /= target[0].kp;
    k.zd /= target[0].kp;
  });
  const maDays = 5;
  const templateDgwy = calculateDGWY(template, maDays);
  const klen = template.length;
  const diffs: number[] = [];
  for (let i = klen; i < 2 * klen; i++) {
    const parts = target.slice(target.length - i - 1, klen);
    // 归一化
    parts.forEach((k, i) => {
      k.kp /= parts[0].kp;
      k.sp /= parts[0].kp;
      k.zg /= parts[0].kp;
      k.zd /= parts[0].kp;
    });
    // 根据dgwy指标来拟合
    const partsDgwy = calculateDGWY(parts, maDays);

    // 计算差值
    const kmaDiffs = templateDgwy[0].map((a, i) => (isNaN(a) ? 0 : Math.abs(a - partsDgwy[0][i])));
    const upperDiffs = templateDgwy[1].map((a, i) => (isNaN(a) ? 0 : Math.abs(a - partsDgwy[1][i])));
    const lowerDiffs = templateDgwy[2].map((a, i) => (isNaN(a) ? 0 : Math.abs(a - partsDgwy[2][i])));
    // 计算均差
    const avgKmaDiffs = kmaDiffs.reduce((s, a) => s + a, 0) / (kmaDiffs.length - maDays);
    const avgUpperDiffs = upperDiffs.reduce((s, a) => s + a, 0) / (upperDiffs.length - maDays);
    const avgLowerDiffs = lowerDiffs.reduce((s, a) => s + a, 0) / (lowerDiffs.length - maDays);
    // 计算加权均差
    const weightedDiffs = 0.5 * avgKmaDiffs + 0.25 * avgUpperDiffs + 0.25 * avgLowerDiffs;
    diffs.push(weightedDiffs);
  }
  const minDiff = Math.min(...diffs);
  const maxIndex = diffs.indexOf(minDiff);
  const maxDate = target[target.length - klen - maxIndex].date;
  return { diff: minDiff, date: maxDate };
}

export function barlast(values1: number[], values2: number[], condition: (a: number[], b: number[], index: number) => boolean) {
  let result = 0; // 当前是一天
  for (let i = values1.length - 1; i >= 0; i--) {
    if (condition(values1, values2, i)) {
      return result;
    }
    result ++;
  }
  return -1;
}

export function cross(values1: number[], values2: number[], index: number) {
  if (index <= 0) {
    return false;
  }
  return values1[index - 1] <= values2[index - 1] && values1[index] > values2[index];
}

export function count(values1: number[], values2: number[], condition: (a: number[], b: number[], index: number) => boolean, days: number) {
  let result = 0;
  for (let i = 1; i <= days && i < values1.length; i++) {
    if (condition(values1, values2, values1.length - i)) {
      result++;
    }
  }
  return result;
}

export function hhv(values: number[], n: number) {
  let result = [];
  for (let i = values.length - 1; i >= 0; i--) {
    let max = Math.max(...values.slice(i - n, i + 1));
    result.unshift(max);
  }
  return result;
}

export function llv(values: number[], n: number) {
  let result = [];
  for (let i = values.length - 1; i >= 0; i--) {
    let max = Math.min(...values.slice(i - n, i + 1));
    result.unshift(max);
  }
  return result;
}