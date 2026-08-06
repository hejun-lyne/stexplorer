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
    // video popover styles
    videoPopover: string;
    videoHeader: string;
    videoHeaderTitle: string;
    videoHeaderActions: string;
    videoList: string;
    videoCard: string;
    videoCardHeader: string;
    videoType: string;
    videoTypeLabel: string;
    videoIndex: string;
    videoTitle: string;
    videoUrlRow: string;
    videoSrc: string;
    videoMime: string;
    videoMimeTag: string;
    videoProgress: string;
    videoProgressDone: string;
    videoProgressDoneIcon: string;
    videoProgressDoneText: string;
    videoCardActions: string;
    videoCardBtn: string;
    videoEmpty: string;
    videoEmptyText: string;
    videoEmptyHint: string;
    videoPopoverOverlay: string;
    videoItem: string;
    videoAction: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
