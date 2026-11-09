declare namespace IndexScssNamespace {
  export interface IIndexScss {
    arrow: string;
    attrTitle: string;
    attrWrap: string;
    buyRow: string;
    buysLabel: string;
    chip: string;
    chipBuy: string;
    chipReview: string;
    chipSell: string;
    container: string;
    dayCell: string;
    dayText: string;
    del: string;
    detailBuys: string;
    detailCost: string;
    detailCount: string;
    detailEmpty: string;
    detailEmptyText: string;
    detailHead: string;
    detailLoading: string;
    detailRange: string;
    detailTable: string;
    detailTitle: string;
    detailWrap: string;
    dot: string;
    note: string;
    noteText: string;
    notes: string;
    sellRow: string;
    sub: string;
    summary: string;
    table: string;
    tableWrap: string;
    tabs: string;
    tradeCell: string;
    tradeTime: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
