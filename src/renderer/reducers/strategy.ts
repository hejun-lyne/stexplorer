import { SYNC_STRATEGY_GROUPS, SYNC_STRATEGY_SOURCE, SET_STRATEGY_SYNING } from '@/actions/strategy';
import { Reducer } from '@/reducers/types';

export type StrategyState = {
  groups: Strategy.GroupItem[];
  groupsModified: string;
  strategiesMapping: Record<string, Strategy.ContentItem>;
  syning: { v: boolean; t: string };
};

const strategy: Reducer<StrategyState> = (
  state = {
    groups: [],
    groupsModified: '1970-01-01 00:00:00',
    strategiesMapping: {},
    syning: { v: false, t: '' },
  },
  action
) => {
  switch (action.type) {
    case SYNC_STRATEGY_GROUPS:
      const [groups, modified] = action.payload;
      return {
        ...state,
        groups,
        groupsModified: modified,
      };
    case SYNC_STRATEGY_SOURCE:
      const data = action.payload as Strategy.ContentItem;
      return {
        ...state,
        strategiesMapping: {
          ...state.strategiesMapping,
          [data.id]: data,
        },
      };
    case SET_STRATEGY_SYNING:
      return {
        ...state,
        syning: action.payload,
      };
    default:
      return state;
  }
};

export default strategy;
