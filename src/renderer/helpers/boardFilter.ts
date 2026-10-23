/**
 * 板块过滤规则（概念板块「只看题材」）
 *
 * 东财/同花顺的「概念板块」里混着大量伪概念：风格（小盘股）、指数成分（沪深300）、
 * 互联互通（沪股通）、机构持仓（基金重仓）、事件（举牌/回购）、业绩预告（预盈预增）等。
 * 这里用一组正则把它们排掉，只留「题材」属性板块（政策主题、产业主题、技术主题等）。
 *
 * 维护方式：遇到漏网的伪概念，直接在 NON_THEME_PATTERNS 里加一行正则即可。
 */
export const NON_THEME_PATTERNS: string[] = [
  // 1. 市值/价格风格类 —— 小盘股、大盘股、微盘股、高价股、低价股、绩优股...
  String.raw`.*盘股$`,
  String.raw`.*[高低中]价股$`,
  '微利股|绩优股|亏损股|破净股|破发|首断|首破',
  // 2. 上市/股本属性类 —— 次新股、ST股、B股、AH股
  '次新股|注册制次新|ST板块|ST股|B股|AH股|GDR|AB股',
  // 3. 指数成分/国际指数类 —— MSCI、富时罗素、标普A股
  String.raw`沪深300|上证50|上证180|中证\d+|创业板\d*|科创\d*|北证\d*|MSCI|富时罗素|标普.{0,4}A股`,
  // 4. 互联互通类
  '沪股通|深股通|陆股通',
  // 5. 机构持仓类 —— 机构重仓、基金重仓、社保重仓、证金持股、国家队
  '(机构|基金|社保|保险|券商|信托|QFII|公募|私募).{0,2}重仓|国家队|证金|汇金',
  // 6. 事件/资本运作类 —— 举牌、股权转让、增持回购、员工持股
  //    （并购重组、高送转有人算事件题材，默认不拉黑）
  '举牌|股权转让|增持|回购|员工持股|股权激励|再融资|定向增发|壳资源',
  // 7. 业绩预告类
  '预盈预增|预亏预减',
  // 8. 地域组合类（一带一路、雄安这类政策题材是主题，不要拉黑，只过滤纯地域组合）
  '长江三角|珠江三角|京津冀|西部开发|东北振兴',
  // 9. 其他杂项
  '中字头|转债标的|含可转债|百元股|两融|融资融券',
];

const NON_THEME_RE: RegExp[] = NON_THEME_PATTERNS.map((p) => new RegExp(p));

/** true = 题材属性板块；false = 风格/指数/持仓等伪概念 */
export function isThemeBoard(name: string): boolean {
  const text = String(name || '');
  if (!text) {
    return false;
  }
  return !NON_THEME_RE.some((rx) => rx.test(text));
}

/** 过滤出题材板块（保留原始对象） */
export function filterThemeBoards<T extends { name?: string }>(boards: T[]): T[] {
  return (boards || []).filter((b) => isThemeBoard(String(b?.name || '')));
}
