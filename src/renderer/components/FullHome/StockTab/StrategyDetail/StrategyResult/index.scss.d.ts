declare namespace IndexScssNamespace {
  export interface IIndexScss {
    btn: string;
    container: string;
    header: string;
    listContainer: string;
    subcontainer: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
