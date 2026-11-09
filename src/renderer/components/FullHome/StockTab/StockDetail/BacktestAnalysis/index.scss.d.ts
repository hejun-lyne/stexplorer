declare namespace IndexScssNamespace {
  export interface IIndexScss {
    btnGroup: string;
    container: string;
    hint: string;
    label: string;
    resultCard: string;
    row: string;
    section: string;
    title: string;
    value: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
