declare namespace IndexScssNamespace {
  export interface IIndexScss {
    address: string;
    bar: string;
    btn: string;
    content: string;
    disable: string;
    enable: string;
    sort: string;
    star: string;
    videoAction: string;
    videoCard: string;
    videoCardActions: string;
    videoCardBtn: string;
    videoCardHeader: string;
    videoEmpty: string;
    videoEmptyHint: string;
    videoEmptyText: string;
    videoHeader: string;
    videoHeaderActions: string;
    videoHeaderTitle: string;
    videoIndex: string;
    videoItem: string;
    videoList: string;
    videoMime: string;
    videoMimeTag: string;
    videoPopover: string;
    videoPopoverOverlay: string;
    videoProgress: string;
    videoProgressDone: string;
    videoProgressDoneIcon: string;
    videoProgressDoneText: string;
    videoProgressHint: string;
    videoSrc: string;
    videoTitle: string;
    videoType: string;
    videoTypeLabel: string;
    videoUrlRow: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
