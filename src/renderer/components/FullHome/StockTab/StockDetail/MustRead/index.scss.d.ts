declare namespace IndexScssNamespace {
  export interface IIndexScss {
    active: string;
    blocktrade: string;
    cardcontent: string;
    commonWrapper: string;
    container: string;
    coretheme: string;
    coretrade: string;
    data: string;
    eventBrief: string;
    eventTitle: string;
    eventWrapper: string;
    gdzj: string;
    ggzj: string;
    gqzy: string;
    header: string;
    holdernumWrapper: string;
    holdernumtable: string;
    leading: string;
    lhb: string;
    loadmore: string;
    moreheader: string;
    row: string;
    rowdata: string;
    rowheader: string;
    statics: string;
    staticsheader: string;
    staticsrow: string;
    stock: string;
    tab: string;
    table: string;
    themeWrapper: string;
    themedetail: string;
    themetabs: string;
    title: string;
    wrapper: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
