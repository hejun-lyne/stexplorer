declare namespace IndexScssNamespace {
  export interface IIndexScss {
    actions: string;
    btns: string;
    container: string;
    header: string;
    hists: string;
    status: string;
    title: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
