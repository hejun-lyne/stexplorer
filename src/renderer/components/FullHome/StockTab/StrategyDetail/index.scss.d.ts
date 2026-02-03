declare namespace IndexScssNamespace {
  export interface IIndexScss {
    act: string;
    actBar: string;
    container: string;
    content: string;
    editor: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
