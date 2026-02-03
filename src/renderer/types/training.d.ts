declare namespace Training {
    export interface Trade {
        secid: string;
        name: string;
        buy_sp: number;
        buy_date: string;
        sell_sp: number;
        gain: number;
        hold: number;
    }
    export interface Record {
      date: string;
      wins: number;
      lose: number;
      even: number;
      records: Trade[];
    }
  }