declare namespace IndexScssNamespace {
  export interface IIndexScss {
    buy: string;
    chart: string;
    chartTitle: string;
    container: string;
    header: string;
    item: string;
    itemLabel: string;
    itemValue: string;
    items: string;
    sell: string;
    stock: string;
    sub: string;
    table: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
