declare namespace IndexScssNamespace {
  export interface IIndexScss {
    abtn: string;
    actbar: string;
    actions: string;
    anticon: string;
    autoSize: string;
    chart: string;
    chartwrapper: string;
    container: string;
    content: string;
    header: string;
    hint: string;
    loadmore: string;
    moreheader: string;
    name: string;
    on: string;
    qsmoreheader: string;
    row: string;
    rowheader: string;
    sortbtn: string;
    table: string;
    tagbar: string;
    tdate: string;
    toggleK: string;
    toolbar: string;
    trades: string;
    trecord: string;
    ztmoreheader: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
