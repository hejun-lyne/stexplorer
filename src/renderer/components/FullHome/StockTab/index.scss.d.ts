declare namespace IndexScssNamespace {
  export interface IIndexScss {
    container: string;
    extBtn: string;
    full: string;
    fullBtn: string;
    mainTab: string;
    noteBtn: string;
    on: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
