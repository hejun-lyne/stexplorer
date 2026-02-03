import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import styles from './index.scss';
import { Button, Switch, Input, Select, Tag, Form } from 'antd';
import moment from 'moment';
import * as Utils from '@/utils';
import { batch, useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { ColumnWidthOutlined, HeartFilled, HeartOutlined, PlusOutlined } from '@ant-design/icons';
import {
  addStockMarkLineAction,
  addStockTagAction,
  addStockTradePointAction,
  clearKNoteAction,
  clearStockTradePointAction,
  deleteStockMarkLineAction,
  deleteStockTagAction,
  syncStockMarktypeAction,
  syncStockOnHoldedAction,
} from '@/actions/stock';
import { Stock } from '@/types/stock';
import { MarkType } from '@/utils/enums';

export interface TrainBarProps {
  secid: string;
  all30Mints: Stock.KLineItem[];
  onToggleTrainMode: (on: boolean) => void;
  onTrainDateChanged: (date: string) => void;
  addStock: () => void;
  removeStock: () => void;
}

const TrainBar: React.FC<TrainBarProps> = React.memo(
  ({ secid, all30Mints, onToggleTrainMode, onTrainDateChanged, addStock, removeStock }) => {
    const dispatch = useDispatch();
    const config = useSelector((state: StoreState) => state.stock.stockConfigsMapping[secid]);
    const [marktype, setMarktype] = useState(config?.marktype || 0);
    const [dateIdx, setDateIdx] = useState(0);
    const allTrade = (config?.buyPoints || [])
      .filter((t) => t.t)
      .map((t) => {
        return {
          x: t.x,
          y: t.y,
          t: 'b',
        };
      })
      .concat(
        (config?.sellPoints || [])
          .filter((t) => t.t)
          .map((t) => {
            return {
              x: t.x,
              y: t.y,
              t: 's',
            };
          })
      );
    allTrade.sort((a, b) => (a.x > b.x ? 1 : -1));
    let netVal = 1;
    if (all30Mints.length) {
      let bp = 0;
      for (let i = 0; i < allTrade.length; i++) {
        if (allTrade[i].t == 'b') {
          bp = all30Mints.find((k) => k.date == allTrade[i].x)?.sp || 0;
        } else if (bp && allTrade[i].t == 's') {
          const sp = all30Mints.find((k) => k.date == allTrade[i].x)?.sp || 0;
          if (sp) {
            netVal *= sp / bp;
            bp = 0;
          }
        }
      }
      if (bp) {
        const cp = all30Mints[dateIdx].sp;
        netVal *= cp / bp;
      }
    }
    const toggleOn = useCallback((o) => {
      setDateIdx(0);
      onToggleTrainMode(o);
    }, []);
    const next30Mint = useCallback(() => {
      if (dateIdx != -1 && dateIdx != all30Mints.length - 1) {
        batch(() => {
          setDateIdx(dateIdx + 1);
          onTrainDateChanged(all30Mints[dateIdx + 1].date);
        });
      }
    }, [all30Mints, dateIdx, config]);
    const nextDay = useCallback(() => {
      if (all30Mints.length && dateIdx < all30Mints.length - 1) {
        const day = all30Mints[dateIdx].date.substring(0, 10);
        let dIdx = dateIdx;
        for (let i = dateIdx + 1; i < all30Mints.length; i++) {
          if (!all30Mints[i].date.startsWith(day)) {
            dIdx = i;
            break;
          }
        }
        batch(() => {
          setDateIdx(dIdx);
          onTrainDateChanged(all30Mints[dIdx].date);
        });
      }
    }, [all30Mints, dateIdx]);
    const doBuy = useCallback(() => {
      const lastB = config.buyPoints?.length ? config.buyPoints.slice(-1)[0].x : null;
      const lastS = config.sellPoints?.length ? config.sellPoints.slice(-1)[0].x : null;
      if (!lastB || (lastS && lastS > lastB)) {
        // 卖了才能买
        dispatch(addStockTradePointAction(secid, all30Mints[dateIdx].date, all30Mints[dateIdx].zg, true));
      }
    }, [all30Mints, dateIdx, config]);
    const doSell = useCallback(() => {
      const lastB = config.buyPoints?.length ? config.buyPoints.slice(-1)[0].x : null;
      const lastS = config.sellPoints?.length ? config.sellPoints.slice(-1)[0].x : null;
      if (lastB && (!lastS || lastB > lastS)) {
        // 买了才能卖
        dispatch(addStockTradePointAction(secid, all30Mints[dateIdx].date, all30Mints[dateIdx].zg, false));
      }
    }, [all30Mints, dateIdx, config]);
    const clearBS = useCallback(() => {
      batch(() => {
        dispatch(clearStockTradePointAction(secid, true));
        dispatch(clearKNoteAction(secid, true));
      });
    }, [secid]);

    const [tagInputVisible, setTagInputVisible] = useState(false);
    const [tagInputValue, setTagInputValue] = useState('');
    const removeTag = useCallback((t) => {
      dispatch(deleteStockTagAction(t, secid));
    }, []);
    const addTag = useCallback(() => {
      if (tagInputValue.length > 0) {
        dispatch(addStockTagAction(tagInputValue, secid));
      }
      setTagInputValue('');
      setTagInputVisible(false);
    }, [tagInputValue]);

    const [markInputVisible, setMarkInputVisible] = useState(false);
    const [markInputValue, setMarkInputValue] = useState('');
    const removeMarkLine = useCallback((t) => {
      dispatch(deleteStockMarkLineAction(t, secid));
    }, []);
    const addMarkLine = useCallback(() => {
      if (markInputValue.length > 0) {
        dispatch(addStockMarkLineAction(Number(markInputValue), secid));
      }
      setMarkInputValue('');
      setMarkInputVisible(false);
    }, [markInputValue]);
    const onMarktypeChange = useCallback((t) => {
      setMarktype(t);
      dispatch(syncStockMarktypeAction(secid, t));
    }, []);
    return (
      <div className={styles.container}>
        <div className={styles.row}>
          <div className={styles.item}>
            <Form.Item label="训练" style={{ margin: 0 }}>
              <Switch checkedChildren="开启" unCheckedChildren="关闭" defaultChecked={false} onChange={toggleOn} />
            </Form.Item>
          </div>
          <div className={styles.item}>
            <Form.Item label="时间" style={{ margin: 0 }}>
              <Input value={all30Mints.length ? all30Mints[dateIdx].date : ''} style={{ width: 150, marginRight: 5 }} size="small" />
              <Button type="primary" onClick={next30Mint} size="small">
                Next 30min
              </Button>
              &nbsp;
              <Button type="primary" onClick={nextDay} size="small">
                Next day
              </Button>
              &nbsp;
              <Button type="primary" onClick={doBuy} size="small">
                买
              </Button>
              &nbsp;
              <Button type="primary" onClick={doSell} size="small" danger>
                卖
              </Button>
              &nbsp;
              <Button type="primary" onClick={clearBS} size="small" danger>
                清
              </Button>
            </Form.Item>
          </div>
          <Form.Item label="净值" style={{ margin: 0, marginRight: 20 }}>
            <span className={Utils.GetValueColor(netVal - 1).textClass}>{netVal.toFixed(3)}</span>
          </Form.Item>
          <div className={styles.item}>
            <Form.Item label="" style={{ margin: 0 }}>
              {config ? (
                <>
                  <Button className={styles.btn} type="text" icon={<HeartFilled />} onClick={removeStock} size="small">
                    已收藏
                  </Button>
                </>
              ) : (
                <Button className={styles.btn} type="text" icon={<HeartOutlined />} onClick={addStock} size="small">
                  未收藏
                </Button>
              )}
              &nbsp;
              <Select value={marktype} onChange={onMarktypeChange} size="small" style={{ width: 80}}>
                <Select.Option value={MarkType.Default}>未确定</Select.Option>
                <Select.Option value={MarkType.WillBuy}>可买入</Select.Option>
                <Select.Option value={MarkType.WillHold}>可持有</Select.Option>
                <Select.Option value={MarkType.WillSell}>需卖出</Select.Option>
              </Select>
              &nbsp;
              {/* {config?.onHolded ? (
                <>
                  <Button
                    className={styles.btn}
                    type="text"
                    icon={<HeartFilled />}
                    onClick={() => dispatch(syncStockOnHoldedAction(secid, false))}
                    size="small"
                  >
                    已持有
                  </Button>
                </>
              ) : (
                <Button
                  className={styles.btn}
                  type="text"
                  icon={<HeartOutlined />}
                  onClick={() => dispatch(syncStockOnHoldedAction(secid, true))}
                  size="small"
                >
                  未持有
                </Button>
              )} */}
            </Form.Item>
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.item}>
            {config?.tags?.map((t) => (
              <Tag className="edit-tag" key={t} closable onClose={() => removeTag(t)}>
                <span>{t}</span>
              </Tag>
            ))}
            {tagInputVisible && (
              <Input
                type="text"
                size="small"
                className="tag-input"
                value={tagInputValue}
                onChange={(e) => setTagInputValue(e.target.value)}
                onBlur={addTag}
                onPressEnter={addTag}
                style={{ width: 60 }}
              />
            )}
            {!tagInputVisible && (
              <Tag className="site-tag-plus" onClick={() => setTagInputVisible(true)}>
                <PlusOutlined /> New Tag
              </Tag>
            )}
            <span style={{ margin: '0 20px' }}>
              <ColumnWidthOutlined />
            </span>
            {config?.markLines?.map((t) => (
              <Tag className="edit-tag" key={t} closable onClose={() => removeMarkLine(t)}>
                <span>{t}</span>
              </Tag>
            ))}
            {markInputVisible && (
              <Input
                type="number"
                size="small"
                className="tag-input"
                value={markInputValue}
                onChange={(e) => setMarkInputValue(e.target.value)}
                onBlur={addMarkLine}
                onPressEnter={addMarkLine}
                style={{ width: 60 }}
              />
            )}
            {!markInputVisible && (
              <Tag className="site-tag-plus" onClick={() => setMarkInputVisible(true)}>
                <PlusOutlined /> New MarkLine
              </Tag>
            )}
          </div>
        </div>
      </div>
    );
  }
);
export default TrainBar;
