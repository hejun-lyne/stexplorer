declare namespace IndexScssNamespace {
  export interface IIndexScss {
    add: string;
    code: string;
    content: string;
    cyfe: string;
    dragItem: string;
    editWallet: string;
    editor: string;
    inner: string;
    menu: string;
    name: string;
    remove: string;
    row: string;
    wallet: string;
    walletName: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
