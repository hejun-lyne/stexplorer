declare namespace IndexScssNamespace {
  export interface IIndexScss {
    container: string;
    content: string;
    detail: string;
    detailItem: string;
    detailItemLabel: string;
    subTitleRow: string;
    titleRow: string;
    zdf: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
