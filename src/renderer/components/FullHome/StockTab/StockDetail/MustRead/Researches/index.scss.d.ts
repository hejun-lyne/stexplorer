declare namespace IndexScssNamespace {
  export interface IIndexScss {
    abstract: string;
    container: string;
    loadmore: string;
    row: string;
    title: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
