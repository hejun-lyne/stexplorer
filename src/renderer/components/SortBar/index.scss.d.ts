declare namespace IndexScssNamespace {
  export interface IIndexScss {
    arrow: string;
    bar: string;
    content: string;
    mode: string;
    name: string;
    selectOrder: string;
    sort: string;
    visible: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
