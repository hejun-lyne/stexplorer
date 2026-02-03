declare namespace IndexScssNamespace {
  export interface IIndexScss {
    act: string;
    actBar: string;
    added: string;
    category: string;
    categoryHeader: string;
    code: string;
    content: string;
    folderBtn: string;
    mainTab: string;
    name: string;
    nameText: string;
    navbar: string;
    rightbar: string;
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
