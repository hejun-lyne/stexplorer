declare namespace IndexScssNamespace {
  export interface IIndexScss {
    appName: string;
    colorful: string;
    content: string;
    describe: string;
    exit: string;
    fill: string;
    group: string;
    link: string;
    logo: string;
    radio: string;
    setting: string;
    title: string;
    version: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
