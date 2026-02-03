/* eslint-disable promise/no-nesting */
import moment from 'moment';
import { ThunkAction } from '@/reducers/types';
import * as Utils from '@/utils';
import { batch } from 'react-redux';

export const SYNC_STRATEGY_GROUPS = 'SYNC_STRATEGY_GROUPS';
export const SYNC_STRATEGY_SOURCE = 'SYNC_STRATEGY_SOURCE';
export const SET_STRATEGY_SYNING = 'SET_STRATEGY_SYNING';

export function syncRemoteStrategyGroupsAction(): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        strategy: { groups, groupsModified },
        github: { storage },
      } = getState();
      if (!storage) {
        throw new Error('storage未初始化');
      }
      dispatch({ type: SET_STRATEGY_SYNING, payload: { v: true, t: '读取groups数据中' } });
      storage
        .ReadRemoteStrategyGroups()
        .then((content) => {
          if (!content) {
            // 读取数据失败
            dispatch({ type: SET_STRATEGY_SYNING, payload: { v: false, t: '读取groups数据失败' } });
          }
          return content;
        })
        .then((content) => {
          if (content && content.data && content.lastModified >= groupsModified) {
            batch(() => {
              dispatch({ type: SYNC_STRATEGY_GROUPS, payload: [content.data, content.lastModified] });
              dispatch({ type: SET_STRATEGY_SYNING, payload: { v: false, t: '读取groups完成' } });
            });
            return [false, content.data];
          }
          return [true, null];
        })
        .then(([willWrite, data]) => {
          if (willWrite && groups.length) {
            dispatch({ type: SET_STRATEGY_SYNING, payload: { v: true, t: '写入groups数据中' } });
            // eslint-disable-next-line promise/no-nesting
            storage
              .WriteRemoteStrategyGroups(groups, groupsModified)
              .then((success) => {
                if (!success) {
                  throw new Error('写入远端数据失败');
                }
                dispatch({ type: SET_STRATEGY_SYNING, payload: { v: false, t: '写入groups完成' } });
                return success;
              })
              .catch((error) => {
                dispatch({ type: SET_STRATEGY_SYNING, payload: { v: false, t: '写入groups失败' } });
              });
          }
          return data;
        });
    } catch (error) {
      console.log('同步策略数据出错', error);
    }
  };
}

export function syncRemoteStrategySourceAction(strategyId: number, groupId: number): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        strategy: { strategiesMapping },
        github: { storage },
      } = getState();
      if (!storage) {
        throw new Error('storage未初始化');
      }
      if (!strategiesMapping[strategyId]) {
        // 只有首次才下载
        dispatch({ type: SET_STRATEGY_SYNING, payload: { v: true, t: '读取strategy数据中' } });
        storage
          .ReadRemoteStrategy(groupId, strategyId)
          .then((content) => {
            if (!content) {
              // 读取数据失败
              dispatch({ type: SET_STRATEGY_SYNING, payload: { v: false, t: '读取strategy数据失败' } });
            }
            return content;
          })
          .then((content) => {
            const prev = strategiesMapping[strategyId];
            if (!content?.data) {
              if (!prev) {
                // 可能出错了，初始化内容为空
                batch(() => {
                  dispatch({
                    type: SYNC_STRATEGY_SOURCE,
                    payload: {
                      id: strategyId,
                      source: '//新策略',
                      modifiedTime: moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
                    } as Strategy.ContentItem,
                  });

                  dispatch({ type: SET_STRATEGY_SYNING, payload: { v: false, t: '读取strategy完成' } });
                });
              }
              return true;
            }
            const current = content.data as Strategy.ContentItem;
            if (!prev || (current && current.modifiedTime >= prev.modifiedTime)) {
              batch(() => {
                dispatch({
                  type: SYNC_STRATEGY_SOURCE,
                  payload: current,
                });

                dispatch({ type: SET_STRATEGY_SYNING, payload: { v: false, t: '读取strategy完成' } });
              });
              return false;
            }
            return true;
          })
          .then((content) => {
            const current = strategiesMapping[strategyId];
            if (content && current) {
              dispatch({ type: SET_STRATEGY_SYNING, payload: { v: true, t: '写入strategy数据中' } });
              // eslint-disable-next-line promise/no-nesting
              storage
                .WriteRemoteStrategy(strategyId, current)
                .then((success) => {
                  if (!success) {
                    throw new Error('写入远端数据失败');
                  }
                  dispatch({ type: SET_STRATEGY_SYNING, payload: { v: false, t: '写入strategy完成' } });
                  return success;
                })
                .catch((error) => {
                  dispatch({ type: SET_STRATEGY_SYNING, payload: { v: false, t: '写入strategy失败' } });
                });
            }
            return content;
          });
      } else {
        // 后续同步直接写入
        dispatch({ type: SET_STRATEGY_SYNING, payload: { v: true, t: '写入strategy数据中' } });
        // eslint-disable-next-line promise/no-nesting
        storage
          .WriteRemoteStrategy(groupId, strategiesMapping[strategyId])
          .then((success) => {
            if (!success) {
              throw new Error('写入远端数据失败');
            }
            dispatch({ type: SET_STRATEGY_SYNING, payload: { v: false, t: '写入strategy完成' } });
            return success;
          })
          .catch((error) => {
            dispatch({ type: SET_STRATEGY_SYNING, payload: { v: false, t: '写入strategy失败' } });
          });
      }
    } catch (error) {
      console.log('同步策略出错', error);
    }
  };
}

export function addStrategyGroupAction(name: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        strategy: { groups },
      } = getState();
      const id = groups.length ? Math.max(...groups.map((n) => Number(n.id))) + 1 : 100;
      dispatch(
        setStrategyGroupsAction(
          groups.concat([
            {
              id: id,
              name: name,
              strategies: [],
            },
          ])
        )
      );
    } catch (error) {
      console.log('添加StrategyGroup出错', error);
    }
  };
}

export function updateStrategyGroupAction(id: number, name?: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        strategy: { groups },
      } = getState();
      const b = groups.find((n) => n.id === id);
      if (b) {
        if (name) b.name = name;
        dispatch(setStrategyGroupsAction(Utils.DeepCopy(groups)));
      }
    } catch (error) {
      console.log('更新Group出错', error);
    }
  };
}

export function deleteStrategyGroupAction(id: number): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        strategy: { groups },
      } = getState();
      const filtered = groups.filter((n) => n.id !== id);
      dispatch(setStrategyGroupsAction(filtered));
    } catch (error) {
      console.log('移除Group出错', error);
    }
  };
}

function setStrategyGroupsAction(groups: Strategy.GroupItem[]): ThunkAction {
  return (dispatch, getState) => {
    try {
      dispatch({ type: SYNC_STRATEGY_GROUPS, payload: [groups, moment(new Date()).format('YYYY-MM-DD HH:mm:ss')] });
      dispatch(syncRemoteStrategyGroupsAction());
    } catch (error) {
      console.log('移除Group出错', error);
    }
  };
}

export function addStrategyAction(groupId: number, initSource?: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        strategy: { groups },
      } = getState();
      const group = groups.find((n) => n.id === groupId);
      if (!group) {
        throw new Error('无法找到strategy_group: ' + groupId);
      }
      const now = moment(new Date()).format('MM月DD日 HH:mm:ss');
      const id =
        groupId * 1000 + (group.strategies && group.strategies.length ? Math.max(...group.strategies.map((n) => Number(n.id))) + 1 : 1);

      if (!group.strategies) {
        group.strategies = [
          {
            id,
            groupId,
            createTime: now,
            modifiedTime: now,
            firstLine: initSource || '// 新策略',
          },
        ];
      } else {
        group.strategies.push({
          id,
          groupId,
          createTime: now,
          modifiedTime: now,
          firstLine: initSource || '// 新策略',
        });
      }
      dispatch(setStrategyGroupsAction(groups));
      if (initSource) {
        dispatch(
          setStrategyAction(groupId, {
            id,
            modifiedTime: now,
            source: initSource,
          }, false)
        );
      }
    } catch (error) {
      console.log('添加策略出错', error);
    }
  };
}

function setStrategyAction(groupId: number, content: Strategy.ContentItem, willSave = false): ThunkAction {
  return (dispatch, getState) => {
    try {
      dispatch({ type: SYNC_STRATEGY_SOURCE, payload: content });
      if (willSave) {
        dispatch(syncRemoteStrategySourceAction(content.id, groupId));
      }
    } catch (error) {
      console.log('同步Strategies出错', error);
    }
  };
}

export function updateStrategyAction(groupId: number, id: number, source: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        strategy: { strategiesMapping },
      } = getState();
      const n = strategiesMapping[id];
      if (!n) {
        throw new Error(`找不到策略:${id}`);
      }
      const now = moment(new Date()).format('MM月DD日 HH:mm:ss');
      n.source = source;
      n.modifiedTime = now;
      dispatch(setStrategyAction(groupId, n));
    } catch (error) {
      console.log('更新Strategy出错', error);
    }
  };
}

export function saveStrategyAction(id: number, groupId: number): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        strategy: { groups, strategiesMapping },
      } = getState();
      const n = strategiesMapping[id];
      if (!n) {
        throw new Error(`找不到策略:${id}`);
      }
      // 保存到远端
      dispatch(syncRemoteStrategySourceAction(id, groupId));
      const group = groups.find((b) => b.id === groupId);
      if (group) {
        const brief = group.strategies.find((n) => n.id === id);
        if (brief) {
          brief.firstLine = n.source.substring(0, n.source.indexOf('\n'));
          brief.modifiedTime = n.modifiedTime;
          dispatch(setStrategyGroupsAction(Utils.DeepCopy(groups)));
        }
      }
    } catch (error) {
      console.log('保存Strategy出错', error);
    }
  };
}

export function deleteStrategyAction(id: number, groupId: number): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        strategy: { groups },
      } = getState();
      const group = groups.find((n) => n.id === groupId);
      if (!group) {
        throw new Error(`找不到策略组:${groupId}`);
      }
      const filtered = group.strategies.filter((n) => n.id !== id);
      group.strategies = filtered;
      dispatch(setStrategyGroupsAction(groups));
    } catch (error) {
      console.log('移除策略出错', error);
    }
  };
}
