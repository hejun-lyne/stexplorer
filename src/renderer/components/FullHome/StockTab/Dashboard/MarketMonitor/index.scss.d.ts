declare namespace IndexScssNamespace {
  export interface IIndexScss {
    content: string;
    echart: string;
    name: string;
    on: string;
    toolbar: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
