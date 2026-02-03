declare namespace IndexScssNamespace {
  export interface IIndexScss {
    container: string;
    left: string;
    on: string;
    right: string;
    rightTab: string;
    zoomBtn: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
