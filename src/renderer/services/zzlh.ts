const { got } = window.contextModules;

export async function requestModeTrend(date: string, type: number) {
  try {
    const {
      body: { code, data },
    } = await got<{
      code: 20000;
      data: [['09:30', 0.55]];
    }>(`http://stock.zizizaizai.com:9001/v2/api/sentiment/trend/${type}`, {
      searchParams: {
        date1: date,
      },
      responseType: 'json',
    });
    if (code != 20000) {
      console.error('获取市场情绪失败:' + date);
    }
    return data || [];
  } catch (error) {
    console.log('获取市场情绪失败', error);
    return [];
  }
}

export async function requestZTTrend(date: string) {
  try {
    const {
      body: { code, data },
    } = await got<{
      code: 20000;
      data: {
        day: '2022-02-17';
        errcode: '0';
        max: 59;
        min: 0;
        nums: { DT: 15; SZJS: 1580; XDJS: 2946; ZBL: 45.6311; ZRZT: 51; ZT: 58; ZTZB: 47; yestRase: 0.166 };
        time: 0;
        trend: [['09:30', 0, 0], ['09:31', 1, 7]];
        ttag: 0.001367;
      };
    }>('http://stock.zizizaizai.com:9001/open/sentiment/uplimit/trend', {
      searchParams: {
        date1: date,
      },
      responseType: 'json',
    });
    if (code != 20000) {
      console.error('获取涨停板数据失败:' + date);
    }
    return data || {};
  } catch (error) {
    console.log('获取涨停板数据失败', error);
    return {};
  }
}

/// type: 0-昨日涨停；20-昨日人气
export async function requestTopPerfKline(date: string, type: number) {
  try {
    const {
      body: { code, data },
    } = await got<{
      code: 20000;
      data: [
        {
          date: '2021-02-18';
          id: 533;
          modal_id: 0;
          p_close: 323.35;
          p_close_pre1d: 321.02;
          p_high: 324.44;
          p_low: 320.39;
          p_open: 321.7;
        }
      ];
    }>(`http://stock.zizizaizai.com:9001/v2/api/sentiment/kline/day/${type}`, {
      searchParams: {
        date1: date,
      },
      responseType: 'json',
    });
    if (code != 20000) {
      console.error('获取昨日表现数据失败:' + date);
    }
    return data || {};
  } catch (error) {
    console.log('获取昨日表现数据失败', error);
    return {};
  }
}
