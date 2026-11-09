declare namespace IndexScssNamespace {
  export interface IIndexScss {
    assistantMessage: string;
    avatar: string;
    blink: string;
    bubble: string;
    bubbleHeader: string;
    chatArea: string;
    container: string;
    cursor: string;
    hint: string;
    inputArea: string;
    inputRow: string;
    markdown: string;
    "md-table-wrapper": string;
    message: string;
    messages: string;
    optionCard: string;
    optionIcon: string;
    optionLabel: string;
    options: string;
    pulse: string;
    quickOptions: string;
    sendBtn: string;
    textInput: string;
    timestamp: string;
    typeTag: string;
    typing: string;
    userMessage: string;
    welcome: string;
    welcomeDesc: string;
    welcomeIcon: string;
    welcomeTitle: string;
  }
}

declare const IndexScssModule: IndexScssNamespace.IIndexScss & {
  /** WARNING: Only available when `css-loader` is used without `style-loader` or `mini-css-extract-plugin` */
  locals: IndexScssNamespace.IIndexScss;
};

export = IndexScssModule;
