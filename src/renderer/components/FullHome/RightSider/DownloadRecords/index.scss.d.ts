declare namespace IndexScssNamespace {
  export interface IIndexScss {
    actions: string;
    container: string;
    count: string;
    empty: string;
    error: string;
    header: string;
    item: string;
    itemFooter: string;
    itemHeader: string;
    list: string;
    name: string;
    path: string;
    percent: string;
    progressWrap: string;
    status: string;
    time: string;
    title: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
