declare namespace IndexScssNamespace {
  export interface IIndexScss {
    chart: string;
    row: string;
    rowheader: string;
    table: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
