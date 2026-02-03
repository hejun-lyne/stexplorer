declare namespace IndexScssNamespace {
  export interface IIndexScss {
    address: string;
    bar: string;
    btn: string;
    content: string;
    disable: string;
    enable: string;
    sort: string;
    star: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
