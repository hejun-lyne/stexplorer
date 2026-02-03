import { ThunkAction } from '@/reducers/types';
import * as Utils from '@/utils';
import * as Helpers from '@/helpers';
import { Stock } from '@/types/stock';
import { batch } from 'react-redux';
import moment from 'moment';
import { KNoteType, MarkType, PeriodMarkType, PeriodMarkTypeNames, StrategyType } from '@/utils/enums';

export const SET_STOCKS_LOADING = 'SET_STOCKS_LOADING';
export const SYNC_STOCKS_MAPPING = 'SYNC_STOCKS_MAPPING';
export const SYNC_STOCK_DATA = 'SYNC_STOCK_DATA';
export const SYNC_STOCKS_DATA = 'SYNC_STOCKS_DATA';
export const SET_STOCK_SYNING = 'SET_STOCK_SYNING';
export const SYNC_STOCK_CONFIG = 'SYNC_STOCK_CONFIG';
export const SYNC_MA_MONITOR = 'SYNC_MA_MONITOR';
export const SYNC_CHAN_MONITOR = 'SYNC_CHAN_MONITOR';
export const SYNC_G_MONITOR = 'SYNC_G_MONITOR';
export const SYNC_LONG_MONITOR = 'SYNC_LONG_MONITOR';
export const SYNC_SHORT_MONITOR = 'SYNC_SHORT_MONITOR';
export const SYNC_STOCK_NEWS = 'SYNC_STOCK_NEWS';
export const SYNC_HOLDINGS = 'SYNC_HOLDINGS';
export const SYNC_NOWHOLDS = 'SYNC_NOWHOLDS';
export const SYNC_STOCK_TRADING = 'SYNC_STOCK_TRADING';
export const SYNC_STOCK_TRAININGS = 'SYNC_STOCK_TRAININGS';

export function syncRemoteStocksAction(): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigsModified, stockConfigs },
        github: { storage },
      } = getState();
      if (!storage) {
        throw new Error('storage未初始化');
      }
      dispatch({ type: SET_STOCK_SYNING, payload: { v: true, t: '读取stocks数据中' } });
      storage
        .ReadRemoteStocks()
        .then((content) => {
          if (!content) {
            // 读取数据失败
            dispatch({ type: SET_STOCK_SYNING, payload: { v: false, t: '读取stocks数据失败' } });
            throw new Error('读取数据失败');
          }
          return content;
        })
        .then((content) => {
          if (content && content.data && content.lastModified >= stockConfigsModified) {
            const willUpdateAll = stockConfigs.length == 0;
            const holdings: string[] = [];
            (content.data as Stock.SettingItem[]).forEach((config) => {
              config.onDetailed = false;
              config.expanded = false;
              if (config.holdings && config.holdings.length) {
                holdings.push(config.secid);
              }
              if (config.knotes) {
                config.knotes.sort((a, b) => (a.id > b.id ? -1 : 1));
              }
            });
            batch(() => {
              dispatch({ type: SYNC_STOCK_CONFIG, payload: [content.data, content.lastModified] });
              dispatch({ type: SYNC_HOLDINGS, payload: holdings });
              dispatch({ type: SET_STOCK_SYNING, payload: { v: false, t: '读取stocks完成' } });
            });
            if (willUpdateAll) {
              // Helpers.Stock.UpdateStocksAllData();
              Helpers.Stock.MultiStockDetailPush(false);
              Helpers.Stock.UpdateStockDetails();
            }
            return false;
          }
          return true;
        })
        .then((content) => {
          if (content && stockConfigs.length) {
            dispatch({ type: SET_STOCK_SYNING, payload: { v: true, t: '写入stocks数据中' } });
            // eslint-disable-next-line promise/no-nesting
            storage
              .WriteRemoteStocks(stockConfigs, stockConfigsModified)
              .then((success) => {
                if (!success) {
                  throw new Error('写入远端数据失败');
                }
                dispatch({ type: SET_STOCK_SYNING, payload: { v: false, t: '写入stocks完成' } });
                return success;
              })
              .catch((error) => {
                dispatch({ type: SET_STOCK_SYNING, payload: { v: false, t: '同步stocks失败' } });
              });
          }
          return content;
        });
    } catch (error) {
      console.log('同步股票列表出错', error);
    }
  };
}

export function syncRemoteTradingsAction(): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { tradingsModified, tradings },
        github: { storage },
      } = getState();
      if (!storage) {
        throw new Error('storage未初始化');
      }
      dispatch({ type: SET_STOCK_SYNING, payload: { v: true, t: '读取tradings数据中' } });
      storage
        .ReadRemoteTradings()
        .then((content) => {
          if (!content) {
            // 读取数据失败
            dispatch({ type: SET_STOCK_SYNING, payload: { v: false, t: '读取tradings数据失败' } });
          }
          return content;
        })
        .then((content) => {
          if (content && content.data && content.lastModified >= tradingsModified) {
            batch(() => {
              dispatch(setStockTradingAction(content.data, content.lastModified));
              dispatch({ type: SET_STOCK_SYNING, payload: { v: false, t: '读取tradings完成' } });
            });
            return false;
          }
          return true;
        })
        .then((content) => {
          if (content && tradings.length) {
            dispatch({ type: SET_STOCK_SYNING, payload: { v: true, t: '写入tradings数据中' } });
            // eslint-disable-next-line promise/no-nesting
            storage
              .WriteRemoteTradings(tradings, tradingsModified)
              .then((success) => {
                if (!success) {
                  throw new Error('写入远端数据失败');
                }
                dispatch({ type: SET_STOCK_SYNING, payload: { v: false, t: '写入tradings完成' } });
                return success;
              })
              .catch((error) => {
                dispatch({ type: SET_STOCK_SYNING, payload: { v: false, t: '同步tradings失败' } });
              });
          }
          return content;
        });
    } catch (error) {
      console.log('同步交易记录列表出错', error);
    }
  };
}

export function syncRemoteTrainingsAction(): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { trainingsModified, trainings },
        github: { storage },
      } = getState();
      if (!storage) {
        throw new Error('storage未初始化');
      }
      dispatch({ type: SET_STOCK_SYNING, payload: { v: true, t: '读取trainings数据中' } });
      storage
        .ReadRemoteTrainings()
        .then((content) => {
          if (!content) {
            // 读取数据失败
            dispatch({ type: SET_STOCK_SYNING, payload: { v: false, t: '读取trainings数据失败' } });
          }
          if (content && content.data) {
            content?.data.forEach((act: Stock.QuantActionItem) => {
              act.day = moment(act.day);
              act.holds = act.holds.map((h) => {
                return { ...h, day: moment(h.day) };
              });
            });
            return content;
          } else {
            return null;
          }
        })
        .then((content) => {
          if (content && content.data && content.lastModified >= trainingsModified) {
            batch(() => {
              dispatch(setStockTrainingAction(content.data, content.lastModified));
              dispatch({ type: SET_STOCK_SYNING, payload: { v: false, t: '读取trainings完成' } });
            });
            return false;
          }
          return true;
        })
        .then((content) => {
          if (content && trainings.length) {
            dispatch({ type: SET_STOCK_SYNING, payload: { v: true, t: '写入trainings数据中' } });
            const data: Stock.QuantActionItem[] = [];
            trainings.forEach((act: Stock.QuantActionItem) => {
              data.push({
                ...act,
                day: act.day.format(),
                holds: act.holds.map((h) => {
                  return { ...h, day: h.day.format() };
                }),
              });
            });
            // eslint-disable-next-line promise/no-nesting
            storage
              .WriteRemoteTrainings(data, trainingsModified)
              .then((success) => {
                if (!success) {
                  throw new Error('写入远端数据失败');
                }
                dispatch({ type: SET_STOCK_SYNING, payload: { v: false, t: '写入trainings完成' } });
                return success;
              })
              .catch((error) => {
                dispatch({ type: SET_STOCK_SYNING, payload: { v: false, t: '同步trainings失败' } });
              });
          }
          return content;
        });
    } catch (error) {
      console.log('同步训练记录列表出错', error);
    }
  };
}

/**
 * 添加股票配置
 */
export function addStockAction(
  stock: Stock.DetailItem,
  type: number,
  trends?: Stock.TrendItem[],
  fflows?: Stock.FlowTrendItem[],
  monitors?: string[]
): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs, stocksMapping },
      } = getState();

      const cloneStockConfig = Utils.DeepCopy(stockConfigs);
      const exist = cloneStockConfig.find((item) => stock.secid === item.secid);
      if (!exist) {
        cloneStockConfig.unshift({
          market: stock.market,
          code: stock.code,
          secid: stock.secid,
          name: stock.name!,
          type,
          pos: stockConfigs.length,
          holdings: [],
          monitors: monitors || [],
        });

        const finded = stocksMapping[stock.secid];
        if (!finded) {
          stocksMapping[stock.secid] = {
            detail: stock,
            bankuais: [],
            trendspic: '',
            trends: trends || [],
            tflows: fflows || [],
            klines: {},
            kstates: {},
            dflows: [],
            chans: {},
            chanStokes: {},
            chanLines: {},
            chanPlatforms: {},
            chanState: [],
            extra: {
              position: 0,
            },
          };
          dispatch({ type: SYNC_STOCKS_MAPPING, payload: stocksMapping });

          // 重启长链接推送
          setTimeout(Helpers.Stock.MultiStockDetailPush, 1000, [true]);
        }
        // 同步配置
        dispatch(setStockConfigAction(cloneStockConfig));
      }
    } catch (error) {
      console.log('添加股票配置出错', error);
    }
  };
}

/**
 * 更新股票配置
 */
export function updateStockAction(stock: { secid: string; type?: number }): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      stockConfigs.forEach((item) => {
        if (stock.secid === item.secid) {
          if (stock.type !== undefined) {
            item.type = stock.type;
          }
        }
      });
      dispatch(setStockConfigAction(Utils.DeepCopy(stockConfigs)));
    } catch (error) {
      console.log('设置股票配置出错', error);
    }
  };
}

export function syncStockOnDetailedAction(secid: string, onDetailed: boolean): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const config = stockConfigs.find((c) => c.secid === secid);
      if (config) config.onDetailed = onDetailed;
      dispatch(setStockConfigAction(Utils.DeepCopy(stockConfigs)));
    } catch (error) {
      console.log('设置股票配置状态出错', error);
    }
  };
}

export function syncStockMarktypeAction(secid: string, marktype: MarkType): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const config = stockConfigs.find((c) => c.secid === secid);
      if (config) config.marktype = marktype;
      dispatch(setStockConfigAction([...stockConfigs]));
    } catch (error) {
      console.log('设置股票关注状态出错', error);
    }
  };
}

export function syncStockOnHoldedAction(secid: string, onHolded: boolean): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const config = stockConfigs.find((c) => c.secid === secid);
      if (config) config.onHolded = onHolded;
      dispatch(setStockConfigAction([...stockConfigs]));
    } catch (error) {
      console.log('设置股票持有状态出错', error);
    }
  };
}

export function syncStockStrategyAction(secid: string, strategy: StrategyType): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const config = stockConfigs.find((c) => c.secid === secid);
      if (config) config.strategy = strategy;
      dispatch(setStockConfigAction([...stockConfigs]));
    } catch (error) {
      console.log('设置股票策略出错', error);
    }
  };
}

export function addKNoteAction(
  secid: string,
  startDate: string,
  endDate: string,
  type: KNoteType,
  text: string,
  stoplossAt?: number,
  isTrain = false
): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const config = stockConfigs.find((c) => c.secid === secid);
      if (!config) {
        throw new Error('无法找到股票配置: ' + secid);
      }
      const now = moment(new Date()).format('MM月DD日 HH:mm:ss');
      const id = config.knotes && config.knotes.length ? Math.max(...config.knotes.map((n) => Number(n.id))) + 1 : 1;
      const n = {
        id,
        startDate,
        endDate,
        type,
        text,
        createTime: now,
        modifiedTime: now,
        isTrain,
      } as Stock.KNoteItem;
      if (stoplossAt) {
        n.stoplossAt = stoplossAt;
        if (type == KNoteType.BUY || type == KNoteType.HOLD) {
          n.text += `(止损价：${n.stoplossAt})`;
        }
      }

      if (!config.knotes) {
        config.knotes = [n];
      } else {
        config.knotes.push(n);
      }
      config.knotes.sort((a, b) => (a.id > b.id ? -1 : 1));
      const i = stockConfigs.indexOf(config);
      stockConfigs[i] = { ...config };
      dispatch(setStockConfigAction([...stockConfigs]));
    } catch (error) {
      console.log('添加K线标记出错', error);
    }
  };
}

export function removeKNoteAction(secid: string, id: number): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const config = stockConfigs.find((c) => c.secid === secid);
      if (!config) {
        throw new Error('无法找到股票配置: ' + secid);
      }
      config.knotes = config.knotes?.filter((k) => k.id !== id);
      if (config.knotes) config.knotes.sort((a, b) => (a.id > b.id ? -1 : 1));
      dispatch(setStockConfigAction([...stockConfigs]));
    } catch (error) {
      console.log('删除K线标记出错', error);
    }
  };
}

export function clearKNoteAction(secid: string, isTrain: boolean): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const config = stockConfigs.find((c) => c.secid === secid);
      if (!config) {
        throw new Error('无法找到股票配置: ' + secid);
      }
      if (isTrain) {
        config.knotes = config.knotes?.filter((k) => k.isTrain != undefined && !k.isTrain) || [];
      } else {
        config.knotes = [];
      }

      if (config.knotes?.length) config.knotes.sort((a, b) => (a.id > b.id ? -1 : 1));
      dispatch(setStockConfigAction([...stockConfigs]));
    } catch (error) {
      console.log('清除K线标记出错', error);
    }
  };
}

export function editKNoteAction(
  secid: string,
  id: number,
  startDate?: string,
  endDate?: string,
  type?: KNoteType,
  text?: string
): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const config = stockConfigs.find((c) => c.secid === secid);
      if (!config) {
        throw new Error('无法找到股票配置: ' + secid);
      }
      const n = config.knotes?.find((k) => k.id === id);
      if (!n) {
        throw new Error('无法找到K线标记: ' + secid);
      }
      if (startDate) {
        n.startDate = startDate;
      }
      if (endDate) {
        n.endDate = endDate;
      }
      if (type) {
        n.type = type;
      }
      if (text) {
        n.text = text;
      }
      n.modifiedTime = moment(new Date()).format('MM月DD日 HH:mm:ss');
      dispatch(setStockConfigAction([...stockConfigs]));
    } catch (error) {
      console.log('修改K线标记出错', error);
    }
  };
}

export function syncStocksExpandedAction(expandedTags: string[]): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      stockConfigs.forEach((item) => {
        if (expandedTags.includes('默认')) {
          item.expanded = true;
        } else {
          item.expanded = item.tags?.some((t) => expandedTags.includes(t));
        }
      });
      dispatch(setStockConfigAction(Utils.DeepCopy(stockConfigs)));
    } catch (error) {
      console.log('设置股票配置状态出错', error);
    }
  };
}

export function addStockHolding(secid: string, holding: Stock.HoldingItem): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs, holdings },
      } = getState();
      const config = stockConfigs.find((s) => s.secid === secid);
      let needUpdateHoldings = false;
      if (config) {
        if (!config.holdings) {
          config.holdings = [holding];
          holdings.push(secid);
          needUpdateHoldings = true;
        } else {
          config.holdings.unshift(holding);
        }
      }
      dispatch(setStockConfigAction(stockConfigs));
      if (needUpdateHoldings) {
        dispatch({ type: SYNC_HOLDINGS, payload: Utils.DeepCopy(holding) });
      }
    } catch (error) {
      console.log('增加股票持仓出错', error);
    }
  };
}

export function setStockHybk(secid: string, code: string, name: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const config = stockConfigs.find((s) => s.secid === secid);
      if (!config) {
        throw new Error('找不到股票配置:' + secid);
      }
      config.hybk = {
        code,
        name,
      };
      dispatch(setStockConfigAction([...stockConfigs]));
    } catch (error) {
      console.log('设置股票板块出错', error);
    }
  };
}

export function removeStockHolding(secid: string, index: number): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs, holdings },
      } = getState();
      const config = stockConfigs.find((s) => s.secid === secid);
      if (config && config.holdings.length > index) {
        config.holdings.splice(index, 1);
        if (config.holdings.length === 0) {
          dispatch({ type: SYNC_HOLDINGS, payload: holdings.filter((_) => _ !== secid) });
        }
      }
      dispatch(setStockConfigAction(stockConfigs));
    } catch (error) {
      console.log('删除股票持仓出错', error);
    }
  };
}

export function appendTrade(trade: Stock.DoTradeItem): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { tradings },
      } = getState();
      trade.id = tradings.length ? Math.max(...tradings.map((t) => t.id)) + 1 : 1;
      tradings.push(trade);
      dispatch(setStockTradingAction(tradings));
    } catch (error) {
      console.log('增加交易操作出错', error);
    }
  };
}

export function removeTrade(id: number): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { tradings },
      } = getState();
      dispatch(setStockTradingAction(tradings.filter((t) => t.id !== id)));
    } catch (error) {
      console.log('删除交易操作出错', error);
    }
  };
}

export function updateMonitors(secid: string, monitors: string[]): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();

      const config = stockConfigs.find((s) => s.secid == secid);
      if (!config) {
        console.error('未找到板块配置:' + secid);
        return;
      }
      config.monitors = monitors;
      dispatch(setStockConfigAction([...stockConfigs]));
    } catch (error) {
      console.log('增加板块监控出错', error);
    }
  };
}

/**
 * 删除股票配置
 */
export function deleteStockAction(secid: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();

      const filtered = stockConfigs.filter((s) => s.secid !== secid);
      if (filtered.length !== stockConfigs.length) {
        dispatch(setStockConfigAction(filtered));
        // 重启长链接推送
        setTimeout(Helpers.Stock.MultiStockDetailPush, 1000, [true]);
      }
    } catch (error) {
      console.log('删除股票出错', error);
    }
  };
}

export function setStockConfigAction(stockConfig: Stock.SettingItem[]): ThunkAction {
  return (dispatch, getState) => {
    try {
      dispatch({ type: SYNC_STOCK_CONFIG, payload: [stockConfig, moment(new Date()).format('YYYY-MM-DD HH:mm:ss')] });
      dispatch(syncRemoteStocksAction());
    } catch (error) {
      console.log('设置股票配置出错', error);
    }
  };
}

export function setStockTradingAction(tradings: Stock.DoTradeItem[], lastModified?: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const sortedTradings = tradings.sort((a, b) => b.id - a.id);
      // 更新持有信息
      const holds: Record<string, Stock.NowHoldItem> = {};
      for (let i = sortedTradings.length - 1; i >= 0; i--) {
        const t = sortedTradings[i];
        if (!t.strategy) {
          // 之前默认都为接力
          t.strategy = StrategyType.QSJL;
        }
        const h = holds[t.secid];
        if (t.type === 'buy') {
          if (!h) {
            holds[t.secid] = {
              secid: t.secid,
              name: t.name,
              price: t.price,
              count: t.count,
              lastBuyDate: t.time,
              lastBuyStrategy: t.strategy,
              lastBuyReason: t.explain,
            } as Stock.NowHoldItem;
          } else {
            // 如果加了仓，那就需要计算平均价
            h.price = (h.price * h.count + t.price * t.count) / (h.count + t.count);
            h.count = h.count + t.count;
            h.lastBuyDate = t.time;
            h.lastBuyStrategy = t.strategy;
            h.lastBuyReason = t.explain;
          }
        } else {
          if (!h) {
            console.error('setStockTradingAction 未记录买入操作', t);
          } else {
            if (t.count >= h.count) {
              // 清仓
              delete holds[t.secid];
            } else {
              // 减仓价格不变
              h.count -= t.count;
            }
          }
        }
      }
      batch(() => {
        dispatch({ type: SYNC_STOCK_TRADING, payload: [tradings, lastModified || moment(new Date()).format('YYYY-MM-DD HH:mm:ss')] });
        dispatch({ type: SYNC_NOWHOLDS, payload: Object.values(holds) });
      });
      if (!lastModified) {
        dispatch(syncRemoteTradingsAction());
      }
    } catch (error) {
      console.log('设置股票交易记录出错', error);
    }
  };
}

export function setStockTrainingAction(trainings: Stock.QuantActionItem[], lastModified?: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      batch(() => {
        dispatch({ type: SYNC_STOCK_TRAININGS, payload: [trainings, lastModified || moment(new Date()).format('YYYY-MM-DD HH:mm:ss')] });
      });
      if (!lastModified) {
        dispatch(syncRemoteTrainingsAction());
      }
    } catch (error) {
      console.log('设置股票训练记录出错', error);
    }
  };
}

export function syncStockDataAction(
  secid: string,
  detail?: Stock.DetailItem,
  trends?: Stock.TrendItem[],
  trendsPic?: { secid: string; pic: string },
  tflows?: Stock.FlowTrendItem[],
  klines?: Stock.KLineItem[],
  dflows?: Stock.FlowDLineItem[]
): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stocksMapping, maMonitors, chanMonitors, gMonitors },
      } = getState();
      const data = Helpers.Stock.UpdateStockData(
        stocksMapping[secid],
        maMonitors,
        chanMonitors,
        gMonitors,
        secid,
        detail,
        trends,
        trendsPic,
        tflows,
        klines,
        dflows
      );
      batch(() => {
        dispatch({ type: SYNC_STOCK_DATA, payload: data });
        dispatch({ type: SYNC_MA_MONITOR, payload: Utils.DeepCopy(maMonitors) });
        dispatch({ type: SYNC_CHAN_MONITOR, payload: Utils.DeepCopy(chanMonitors) });
        dispatch({ type: SYNC_G_MONITOR, payload: Utils.DeepCopy(gMonitors) });
      });
    } catch (error) {
      console.log('同步股票数据出错', error);
    }
  };
}

export function updateStockCharactorAction(secid: string, character: any): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const ss = stockConfigs.find((s) => s.secid === secid);
      if (ss) {
        ss.character = character;
        const i = stockConfigs.indexOf(ss);
        stockConfigs[i] = { ...ss };
      }
      dispatch(setStockConfigAction([...stockConfigs]));
    } catch (error) {
      console.log('更新股票特性出错', error);
    }
  };
}

export function addStockTagAction(name: string, sid: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const ss = stockConfigs.find((s) => s.secid === sid);
      if (ss && ss.tags) ss.tags.push(name);
      else if (ss) ss.tags = [name];
      dispatch(setStockConfigAction(Utils.DeepCopy(stockConfigs)));
    } catch (error) {
      console.log('添加标的标签出错', error);
    }
  };
}

export function deleteStockTagAction(name: string, sid: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const ss = stockConfigs.find((s) => s.secid === sid);
      if (ss && ss.tags) ss.tags = ss.tags.filter((s) => s !== name);
      dispatch(setStockConfigAction(Utils.DeepCopy(stockConfigs)));
    } catch (error) {
      console.log('删除标的标签出错', error);
    }
  };
}

export function addStockPeriodMarkItemAction(secid: string, name: string, type: PeriodMarkType, startDate: string, endDate: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const ss = stockConfigs.find((s) => s.secid === secid);
      if (ss) {
        let id = 1;
        if (ss.periodMarks && ss.periodMarks.length > 0) {
          id = ss.periodMarks.reduce((m, item) => item.id > m ? item.id : m, 0) + 1;
        }
        const tag = PeriodMarkTypeNames[type];
        if (ss.tags) ss.tags.indexOf(tag) == -1 ? ss.tags.push(tag) : undefined;
        else if (ss) ss.tags = [tag];

        const item = {
          id, secid, name, type, startDate, endDate
        } as Stock.PeriodMarkItem;
        if (ss.periodMarks) ss.periodMarks = [item].concat(ss.periodMarks);
        else ss.periodMarks = [item];
        dispatch(setStockConfigAction(Utils.DeepCopy(stockConfigs)));
      }
    } catch (error) {
      console.log('添加区间标记出错', error);
    }
  };
}

export function deleteStockPeriodMarkItemAction(fromsecid: string, id: number): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const ss = stockConfigs.find((s) => s.secid === fromsecid);
      const pm = ss?.periodMarks.find((_) => _.id === id);
      if (ss && pm) {
        ss.periodMarks = ss.periodMarks.filter((s) => s.id !== id);
        const hasType = ss.periodMarks.reduce((pre, p) => pre || p.type === pm.type, false);
        if (!hasType) {
          // 需要更新标签
          const tag = PeriodMarkTypeNames[pm.type];
          if (ss && ss.tags) ss.tags = ss.tags.filter((s) => s !== tag);
        }
      }
      dispatch(setStockConfigAction(Utils.DeepCopy(stockConfigs)));
    } catch (error) {
      console.log('删除区间标记出错', error);
    }
  };
}

export function addStockSimiItemAction(tosecid: string, secid: string, name: string, startDate: string, endDate: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const ss = stockConfigs.find((s) => s.secid === tosecid);
      if (ss) {
        let id = 1;
        if (ss.similars && ss.similars.length > 0) {
          id = ss.similars.reduce((m, item) => item.id > m ? item.id : m, 0) + 1;
        }
        const item = {
          id, secid, name, startDate, endDate
        } as Stock.SimilarItem;
        if (ss.similars) ss.similars = [item].concat(ss.similars);
        else ss.similars = [item];
        dispatch(setStockConfigAction(Utils.DeepCopy(stockConfigs)));
      }
    } catch (error) {
      console.log('添加相似标的出错', error);
    }
  };
}

export function deleteStockSimiItemAction(fromsecid: string, id: number): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const ss = stockConfigs.find((s) => s.secid === fromsecid);
      if (ss && ss.similars) ss.similars = ss.similars.filter((s) => s.id !== id);
      dispatch(setStockConfigAction(Utils.DeepCopy(stockConfigs)));
    } catch (error) {
      console.log('删除相似标的出错', error);
    }
  };
}

export function addStockMarkLineAction(value: number, sid: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const ss = stockConfigs.find((s) => s.secid === sid);
      if (ss) {
        if (ss.markLines) ss.markLines = [...new Set(ss.markLines.concat([value]))];
        else ss.markLines = [value];
        dispatch(setStockConfigAction(Utils.DeepCopy(stockConfigs)));
      }
    } catch (error) {
      console.log('添加标的标记线出错', error);
    }
  };
}

export function deleteStockMarkLineAction(value: number, sid: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const ss = stockConfigs.find((s) => s.secid === sid);
      if (ss && ss.markLines) ss.markLines = ss.markLines.filter((s) => s !== value);
      dispatch(setStockConfigAction(Utils.DeepCopy(stockConfigs)));
    } catch (error) {
      console.log('删除标的标记线出错', error);
    }
  };
}

export function addStockTradePointAction(secid: string, date: string, value: number, isBuy: boolean, isTrain = true): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const ss = stockConfigs.find((s) => s.secid === secid);
      if (ss) {
        if (isBuy) {
          if (ss.buyPoints) {
            ss.buyPoints = ss.buyPoints.filter((p) => p.x != date);
            ss.buyPoints.push({ x: date, y: value, t: isTrain });
          } else ss.buyPoints = [{ x: date, y: value, t: isTrain }];
        } else {
          if (ss.sellPoints) {
            ss.sellPoints = ss.sellPoints.filter((p) => p.x != date);
            ss.sellPoints.push({ x: date, y: value, t: isTrain });
          } else ss.sellPoints = [{ x: date, y: value, t: isTrain }];
        }
        dispatch(setStockConfigAction(Utils.DeepCopy(stockConfigs)));
      }
    } catch (error) {
      console.log('添加标的标记点出错', error);
    }
  };
}

export function deleteStockTradePointAction(secid: string, date: string, isBuy: boolean): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const ss = stockConfigs.find((s) => s.secid === secid);
      if (isBuy) {
        if (ss && ss.buyPoints) ss.buyPoints = ss.buyPoints.filter((s) => s.x != date);
      } else {
        if (ss && ss.sellPoints) ss.sellPoints = ss.sellPoints.filter((s) => s.x != date);
      }
      dispatch(setStockConfigAction(Utils.DeepCopy(stockConfigs)));
    } catch (error) {
      console.log('删除标的标记点出错', error);
    }
  };
}

export function clearStockTradePointAction(secid: string, isTrain: boolean): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stockConfigs },
      } = getState();
      const ss = stockConfigs.find((s) => s.secid === secid);
      if (isTrain) {
        if (ss && ss.buyPoints) ss.buyPoints = ss.buyPoints.filter((s) => s.t != undefined && !s.t);
        if (ss && ss.sellPoints) ss.sellPoints = [];
        if (ss && ss.buyPoints) ss.buyPoints = [];
      }
      dispatch(setStockConfigAction(Utils.DeepCopy(stockConfigs)));
    } catch (error) {
      console.log('清除标的标记点出错', error);
    }
  };
}

export function sortStocksAction(): ThunkAction {
  return (dispatch, getState) => {
    console.log('sort not supported now');
  };
}

export function syncStockNewsAction(secid: string, data: Stock.NewsItem[]): ThunkAction {
  return (dispatch, getState) => {
    dispatch({ type: SYNC_STOCK_NEWS, payload: { secid, data } });
  };
}

export function updateStockPriceAction(secid: string, price: number): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stocksMapping },
      } = getState();
      const data = stocksMapping[secid];
      if (data && data.detail) {
        data.detail.zx = price;
        data.detail.zdd = price - data.detail.zs;
        data.detail.zdf = +((data.detail.zdd / data.detail.zs) * 100).toFixed(2);
        dispatch({ type: SYNC_STOCK_DATA, payload: data });
      }
    } catch (error) {
      console.error('updateStockPriceAction error', error);
    }
  };
}

export function updateStockPartDetailsAction(details: Stock.PartDetailItem[]): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        stock: { stocksMapping },
      } = getState();
      details.forEach((d) => {
        const data = stocksMapping[d.secid];
        if (data) {
          if (!isNaN(d.zx)) {
            data.detail.zx = d.zx;
          }
          if (!isNaN(d.zdf)) {
            data.detail.zdf = d.zdf;
          }
          if (!isNaN(d.zdd)) {
            data.detail.zdd = d.zdd;
          }
          if (!isNaN(d.hsl)) {
            data.detail.hsl = d.hsl;
          }
          if (!isNaN(d.zss)) {
            data.detail.zss = d.zss;
          }
          if (!isNaN(d.np)) {
            data.detail.np = d.np;
          }
          if (!isNaN(d.wp)) {
            data.detail.wp = d.wp;
          }
          if (!isNaN(d.jj)) {
            data.detail.jj = d.jj;
          }
          data.detail = { ...data.detail };
          stocksMapping[d.secid] = { ...data };
        } else {
          stocksMapping[d.secid] = {
            detail: d as unknown as Stock.DetailItem,
            bankuais: [],
            trendspic: '',
            trends: [],
            tflows: [],
            klines: {},
            dflows: [],
            chans: {},
            chanStokes: {},
            chanLines: {},
            chanPlatforms: {},
            kstates: {},
            chanState: [0, 0],
            extra: {
              position: 0,
            },
          };
        }
      });
      dispatch({ type: SYNC_STOCKS_DATA, payload: { ...stocksMapping } });
    } catch (error) {
      console.error('updateStockPriceAction error', error);
    }
  };
}
