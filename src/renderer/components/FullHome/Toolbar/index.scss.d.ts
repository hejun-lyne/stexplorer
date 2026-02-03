declare namespace IndexScssNamespace {
  export interface IIndexScss {
    bar: string;
    content: string;
    mode: string;
    setting: string;
    sort: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
