declare namespace IndexScssNamespace {
  export interface IIndexScss {
    act: string;
    code: string;
    hybk: string;
    oncontext: string;
    row: string;
    rowBar: string;
    selected: string;
    time: string;
    value: string;
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
