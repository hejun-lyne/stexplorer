import { SYNC_FAVOR_SITES, SYNC_HIST_SITES, SET_SITE_SYNING } from '@/actions/site';
import { Reducer } from '@/reducers/types';

export type SiteState = {
  stars: Site.FavorItem[];
  hists: Site.HistoryItem[];
  starsModified: string;
  histsModified: string;
  syning: { v: boolean; t: string };
};

const site: Reducer<SiteState> = (
  state = {
    stars: [],
    hists: [],
    starsModified: '1970-01-01 00:00:00',
    histsModified: '1970-01-01 00:00:00',
    syning: { v: false, t: '' },
  },
  action
) => {
  switch (action.type) {
    case SYNC_FAVOR_SITES:
      const [stars, favorModified] = action.payload;
      return {
        ...state,
        stars,
        starsModified: favorModified,
      };
    case SYNC_HIST_SITES:
      const [hists, histModified] = action.payload;
      return {
        ...state,
        hists,
        histsModified: histModified,
      };
    case SET_SITE_SYNING:
      return {
        ...state,
        syning: action.payload,
      };
    default:
      return state;
  }
};

export default site;
