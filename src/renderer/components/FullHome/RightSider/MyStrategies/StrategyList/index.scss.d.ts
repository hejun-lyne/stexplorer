declare namespace IndexScssNamespace {
  export interface IIndexScss {
    commentText: string;
    container: string;
    firstLine: string;
    oncontext: string;
    referText: string;
    referUrl: string;
    row: string;
    selected: string;
    time: string;
    title: string;
    value: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
