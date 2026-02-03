import moment from 'moment';
import { ThunkAction } from '@/reducers/types';
import * as Utils from '@/utils';
import { batch } from 'react-redux';

export const SYNC_FAVOR_SITES = 'SYNC_FAVOR_SITES';
export const SYNC_HIST_SITES = 'SYNC_HIST_SITES';
export const SET_SITE_SYNING = 'SET_SITE_SYNING';
export const SET_SITE_SYNING_TEXT = 'SET_SITE_SYNING_TEXT';

export function syncRemoteFavorSitesAction(): ThunkAction {
  console.log('syncRemoteFavorSitesAction');
  return (dispatch, getState) => {
    try {
      const {
        site: { stars, starsModified },
        github: { storage },
      } = getState();
      if (!storage) {
        throw new Error('storage未初始化');
      }
      dispatch({ type: SET_SITE_SYNING, payload: { v: true, t: '读取sites数据中' } });
      storage
        .ReadRemoteStarSites()
        .then((content) => {
          if (!content) {
            // 读取数据失败
            dispatch({ type: SET_SITE_SYNING, payload: { v: false, t: '读取sites数据失败' } });
          }
          return content;
        })
        .then((content) => {
          if (content && content.data && content.lastModified >= starsModified) {
            batch(() => {
              dispatch({ type: SYNC_FAVOR_SITES, payload: [content.data, content.lastModified] });
              dispatch({ type: SET_SITE_SYNING, payload: { v: false, t: '读取sites完成' } });
            });
            return false;
          }
          return true;
        })
        .then((content) => {
          if (content && stars.length) {
            dispatch({ type: SET_SITE_SYNING, payload: { v: true, t: '写入sites数据中' } });
            // eslint-disable-next-line promise/no-nesting
            storage
              .WriteRemoteStarSites(stars, starsModified)
              .then((success) => {
                if (!success) {
                  throw new Error('写入远端数据失败');
                }
                dispatch({ type: SET_SITE_SYNING, payload: { v: false, t: '写入sites完成' } });
                return success;
              })
              .catch((error) => {
                dispatch({ type: SET_SITE_SYNING, payload: { v: false, t: '写入sites失败' } });
              });
          }
          return content;
        });
    } catch (error) {
      console.log('同步站点出错', error);
    }
  };
}

export function setFavorSitesAction(sites: Site.FavorItem[]): ThunkAction {
  return (dispatch, getState) => {
    try {
      dispatch({ type: SYNC_FAVOR_SITES, payload: [[...sites], moment(new Date()).format('YYYY-MM-DD HH:mm:ss')] });
      dispatch(syncRemoteFavorSitesAction());
    } catch (error) {
      console.log('同步站点出错', error);
    }
  };
}

export function addFavorSiteAction(name: string, url: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        site: { stars },
      } = getState();
      const id = stars.length ? String(Math.max(...stars.map((s) => Number(s.id))) + 1) : '100';
      const temp = Utils.DeepCopy(stars);
      temp.push({
        id: id,
        name: name,
        url: url,
      });
      dispatch(setFavorSitesAction(temp));
    } catch (error) {
      console.log('添加站点出错', error);
    }
  };
}

export function deleteFavorSiteAction(url: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        site: { stars },
      } = getState();
      const ss = stars.filter((s) => s.url !== url);
      dispatch(setFavorSitesAction(ss));
    } catch (error) {
      console.log('删除站点出错', error);
    }
  };
}

export function setHistorySitesAction(hists: Site.HistoryItem[]): ThunkAction {
  return (dispatch, getState) => {
    try {
      dispatch({ type: SYNC_HIST_SITES, payload: [hists, moment(new Date()).format('YYYY-MM-DD HH:mm:ss')] });
      dispatch(syncRemoteFavorSitesAction());
    } catch (error) {
      console.log('同步历史站点出错', error);
    }
  };
}

export function addHistorySiteAction(url: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        site: { hists },
      } = getState();
      const id = hists.length ? String(Math.max(...hists.map((n) => Number(n.id))) + 1) : '100';
      hists.push({
        id: id,
        time: moment(new Date()).format('MM月dd日 HH:mm:ss'),
        url: url,
      });
      // Helpers.Site.SetHistSites(hists);
      dispatch(setHistorySitesAction(hists));
    } catch (error) {
      console.log('添加站点历史出错', error);
    }
  };
}

export function deleteHistorySiteAction(id: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        site: { hists },
      } = getState();
      const ss = hists.filter((s) => s.id === id);
      // Helpers.Site.SetHistSites(ss);
      dispatch(setHistorySitesAction(ss));
    } catch (error) {
      console.log('删除站点历史出错', error);
    }
  };
}

export function addSiteTagAction(name: string, sid: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        site: { stars },
      } = getState();
      const ss = stars.find((s) => s.id === sid);
      if (ss && ss.tags) ss.tags.push(name);
      else if (ss) ss.tags = [name];
      dispatch(setFavorSitesAction(stars));
    } catch (error) {
      console.log('添加站点标签出错', error);
    }
  };
}

export function deleteSiteTagAction(name: string, sid: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        site: { stars },
      } = getState();
      const ss = stars.find((s) => s.id === sid);
      if (ss && ss.tags) ss.tags = ss.tags.filter((s) => s !== name);
      dispatch(setFavorSitesAction(stars));
    } catch (error) {
      console.log('删除站点标签出错', error);
    }
  };
}
