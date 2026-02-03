declare namespace IndexScssNamespace {
  export interface IIndexScss {
    added: string;
    code: string;
    content: string;
    name: string;
    nameText: string;
    none: string;
    select: string;
    stock: string;
    tag: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
