declare namespace IndexScssNamespace {
  export interface IIndexScss {
    btn: string;
    chartBar: string;
    choumawrapper: string;
    content: string;
    echart: string;
    indicators: string;
    markBar: string;
    row: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
