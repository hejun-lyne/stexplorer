declare namespace IndexScssNamespace {
  export interface IIndexScss {
    a: string;
    act: string;
    b: string;
    c: string;
    container: string;
    fundsEditInline: string;
    fundsHint: string;
    header: string;
    ratioInfo: string;
    row: string;
    seperator: string;
    stockName: string;
    topBar: string;
    topBarBtns: string;
    topBarDivider: string;
    topBarItem: string;
    topBarLabel: string;
    topBarValue: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
