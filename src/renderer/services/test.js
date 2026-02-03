gw: function(t, e) { // 前一日，后一日
  var i = 6048e5
    , n = 2592e5
    , r = (t.getTime() - n) / i
    , a = (e.getTime() - n) / i;
  return Math.floor(r) == Math.floor(a)
},
gm: function(t, e) { // 前一日，后一日
  return t.getFullYear() == e.getFullYear() ? t.getMonth() == e.getMonth() : !1
},
gy: function(t, e) { // 前一日，后一日
  return t.getFullYear() == e.getFullYear()
},

mw: function(t, e, i, n, r) {
  "number" != typeof n && (n = 0);
  var a = t.length
    , o = t[0];
  n > 1 && (o.volume /= n);
  var s, l = [], u = [], c = [];
  // l == week, u == month, c == year
  if (1 == a)
    l[0] = {
      open: e.open,
      high: e.high,
      low: e.low,
      close: e.price,
      volume: e.totalVolume,
      amount: e.totalAmount,
      date: D.dd(e.date)
    },
      u[0] = {
        open: e.open,
        high: e.high,
        low: e.low,
        close: e.price,
        volume: e.totalVolume,
        amount: e.totalAmount,
        date: D.dd(e.date)
      },
      c[0] = {
        open: e.open,
        high: e.high,
        low: e.low,
        close: e.price,
        volume: e.totalVolume,
        amount: e.totalAmount,
        date: D.dd(e.date)
      };
  else
    for (var d, h = o.open, f = o.high, m = o.low, p = o.close, g = o.volume, v = o.date, b = o.amount, N = o.open, y = o.high, w = o.low, x = o.close, S = o.volume, k = o.date, T = o.amount, P = o.open, C = o.high, _ = o.low, R = o.close, A = o.volume, O = o.date, E = o.amount, I = 1; a > I; I++)
      o = t[I],
        n > 1 && (o.volume /= n,
          o.postVol && (o.postVol /= n)),
        D.gw(t[I - 1].date, o.date) ? (o.high > f && (f = o.high),
          o.low < m && (m = o.low),
          p = o.close,
          g += o.volume,
          b += o.amount,
          v = o.date) : (isNaN(r) || (s = v.getDay(),
            0 == s && (s = 7),
            d = s - r,
            d > 0 && (v = D.ddt(v),
              v.setDate(v.getDate() - d))),
            l.push({
              open: h,
              high: f,
              low: m,
              close: p,
              volume: g,
              date: v,
              amount: b
            }),
            h = o.open,
            f = o.high,
            m = o.low,
            p = o.close,
            g = o.volume,
            b = o.amount,
            v = o.date),
        D.gm(t[I - 1].date, o.date) ? (o.high > y && (y = o.high),
          o.low < w && (w = o.low),
          x = o.close,
          S += o.volume,
          T += o.amount,
          k = o.date) : (isNaN(r) || (s = k.getDay(),
            0 == s && (s = 7),
            d = s - r,
            d > 0 && (k = D.ddt(k),
              k.setDate(k.getDate() - d))),
            u.push({
              open: N,
              high: y,
              low: w,
              close: x,
              volume: S,
              date: k,
              amount: T
            }),
            N = o.open,
            y = o.high,
            w = o.low,
            x = o.close,
            S = o.volume,
            T = o.amount,
            k = o.date),
        D.gy(t[I - 1].date, o.date) ? (o.high > C && (C = o.high),
          o.low < _ && (_ = o.low),
          R = o.close,
          A += o.volume,
          E += o.amount,
          O = o.date) : (c.push({
            open: P,
            high: C,
            low: _,
            close: R,
            volume: A,
            date: O,
            amount: E
          }),
            P = o.open,
            C = o.high,
            _ = o.low,
            R = o.close,
            A = o.volume,
            O = o.date),
        I == a - 1 && (l.push({
          open: h,
          high: f,
          low: m,
          close: p,
          volume: g,
          date: v,
          amount: b
        }),
          u.push({
            open: N,
            high: y,
            low: w,
            close: x,
            volume: S,
            date: k,
            amount: T
          }),
          c.push({
            open: P,
            high: C,
            low: _,
            close: R,
            volume: A,
            date: O,
            amount: E
          }));
  return l[0].prevclose = i,
    u[0].prevclose = i,
    c[0].prevclose = i,
    [l, u, c]
}