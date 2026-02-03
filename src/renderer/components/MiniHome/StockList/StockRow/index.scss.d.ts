declare namespace IndexScssNamespace {
  export interface IIndexScss {
    arrow: string;
    code: string;
    collapseContent: string;
    row: string;
    rowBar: string;
    value: string;
    view: string;
    zd: string;
    zdd: string;
    zdf: string;
    zindexName: string;
    zx: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
