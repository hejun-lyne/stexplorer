import { Store as ReduxStore, Action, Dispatch as ReduxDispatch } from 'redux';
import { ThunkDispatch as ReduxThunkDispatch, ThunkAction as ReduxThunkAction } from 'redux-thunk';

import { StockState } from './stock';
import { SortState } from './sort';
import { SettingState } from './setting';
import { SiteState } from './site';
import { NoteState } from './note';
import { GithubState } from './github';
import { BaiduState } from './baidu';
import { StrategyState } from './strategy';
import { TrainingState } from './training';

export type StoreState = {
  stock: StockState;
  sort: SortState;
  site: SiteState;
  note: NoteState;
  github: GithubState;
  baidu: BaiduState;
  setting: SettingState;
  strategy: StrategyState;
  training: TrainingState;
};

export type GetState = () => StoreState;
export type Dispatch = ReduxThunkDispatch<StoreState, unknown, Action<string>>;
export type Store = ReduxStore<StoreState, any | Dispatch>;
export type ThunkAction<T = void> = (dispatch: Dispatch, getState: GetState) => T;
export type PromiseAction<T = void> = (dispatch: Dispatch, getState: GetState) => Promise<T>;
export type Reducer<S> = (state: S, action: any | Dispatch) => S;
