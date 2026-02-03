declare namespace IndexScssNamespace {
  export interface IIndexScss {
    btn: string;
    content: string;
    echart: string;
    header: string;
    monitor: string;
    table: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
