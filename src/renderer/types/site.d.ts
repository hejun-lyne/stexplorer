declare namespace Site {
  export interface FavorItem {
    id: string;
    name: string;
    description?: string;
    url: string;
    tags?: string[];
  }
  export interface HistoryItem {
    id: string;
    time: string;
    url: string;
  }
}
