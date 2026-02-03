import { combineReducers } from 'redux';
import stock from './stock';
import setting from './setting';
import sort from './sort';
import site from './site';
import note from './note';
import github from './github';
import baidu from './baidu';
import strategy from './strategy';
import training from './training';

export default function createRootReducer() {
  return combineReducers({
    stock,
    setting,
    sort,
    site,
    note,
    github,
    baidu,
    strategy,
    training
  });
}
