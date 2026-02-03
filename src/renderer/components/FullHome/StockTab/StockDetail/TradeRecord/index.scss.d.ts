declare namespace IndexScssNamespace {
  export interface IIndexScss {
    a: string;
    b: string;
    buys: string;
    c: string;
    container: string;
    loadmore: string;
    row: string;
    seats: string;
    sells: string;
    seperator: string;
    trades: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
