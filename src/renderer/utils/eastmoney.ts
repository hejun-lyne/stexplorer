/**
 * 是否是沪深股票
 * @param {*} f13
 * @param {*} f19
 */
export function isHSStock(f13: number, f19: number) {
  return (f13 == 1 && f19 == 2) || (f13 == 1 && f19 == 23) || (f13 == 0 && (f19 == 6 || f19 == 13 || f19 == 80));
}

/**
 * 通过代码判断是否是沪深A股
 * @param {*} code
 */
export function isHSStockByCode(code: string) {
  const codearray = code.split('.');
  if (codearray.length < 2) {
    return false;
  }
  const market = codearray[0];
  const codestr = codearray[1];
  if (market == '1' && codestr[0] == '6') {
    //上证A股
    return true;
  }
  if (market == '0' && codestr[0] == '0' && codestr[1] == '0' && codestr[2] == '2') {
    //中小板
    return true;
  }
  if (market == '0' && codestr[0] == '0' && codestr[1] == '0') {
    //深证A股
    return true;
  }
  if (market == '0' && codestr[0] == '3' && codestr[1] == '0') {
    //创业板
    return true;
  }

  return false;
}

/**
 * 通过代码获取行情链接
 * @param {*} code
 */
export function getLinkByCode(code: string) {
  if (isHSStockByCode(code)) {
    const codearray = code.split('.');
    const market = codearray[0];
    const codestr = codearray[1];
    let marketstr = 'sz';
    if (market == '1') {
      marketstr = 'sh';
    }
    return 'http://quote.eastmoney.com/concept/' + marketstr + codestr + '.html?from=zixuan';
  }
  return 'http://quote.eastmoney.com/unify/r/' + code;
}
