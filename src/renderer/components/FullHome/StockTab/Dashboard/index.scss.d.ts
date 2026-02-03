declare namespace IndexScssNamespace {
  export interface IIndexScss {
    bankuai: string;
    container: string;
    content: string;
    extra: string;
    header: string;
    on: string;
    panel: string;
    title: string;
    toggleFull: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
