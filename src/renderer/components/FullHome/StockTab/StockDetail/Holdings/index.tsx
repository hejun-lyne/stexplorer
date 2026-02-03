import React, { useState } from 'react';
import classnames from 'classnames';
import PureCard from '@/components/Card/PureCard';
import * as Utils from '@/utils';
import styles from './index.scss';
import { Form, InputNumber, Button, List } from 'antd';
import { useDispatch } from 'react-redux';
import { addStockHolding, removeStockHolding } from '@/actions/stock';
import { Stock } from '@/types/stock';
import moment from 'moment';

export interface HoldingsProps {
  secid: string;
  zx: number;
  holdings: Stock.HoldingItem[];
}

const Holdings: React.FC<HoldingsProps> = React.memo(({ secid, zx, holdings }) => {
  const dispatch = useDispatch();
  const [mHolding, setMHolding] = useState(holdings);
  const onFinish = (values: any) => {
    const h = {
      price: values.price,
      count: values.count,
      time: moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
      profit: 0,
      sold: false,
    };
    dispatch(addStockHolding(secid, h));
    setMHolding([h].concat(mHolding));
  };
  const onRemove = (i: number) => {
    dispatch(removeStockHolding(secid, i));
    setMHolding(mHolding.filter((h, ii) => ii != i));
  };
  holdings.forEach((h) => {
    const profit = (zx / h.price - 1) * 100;
    h.profit = profit;
  });

  return (
    <PureCard>
      <div className={styles.container}>
        <Form name="adding" initialValues={{ price: zx, count: 100 }} onFinish={onFinish} autoComplete="off">
          <Form.Item label="价格" name="price" rules={[{ required: true }]}>
            <InputNumber style={{ width: 120 }} defaultValue={zx} step="0.01" stringMode size="small" />
          </Form.Item>
          <Form.Item label="数量" name="count" rules={[{ required: true }]}>
            <InputNumber style={{ width: 120 }} defaultValue={100} min={100} max={10000} step={100} size="small" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              添加
            </Button>
          </Form.Item>
        </Form>
        <div className={styles.header}>
          <span className={styles.b}>价格</span>
          <span className={styles.b}>数量</span>
          <span className={styles.b}>收益</span>
          <span className={styles.b}>操作</span>
        </div>
        <List
          size="small"
          bordered={false}
          split={false}
          dataSource={holdings}
          renderItem={(item, i) => (
            <List.Item key={i} style={{ padding: 0 }}>
              <div className={styles.row}>
                <span className={styles.b}>{item.price}</span>
                <span className={styles.b}>{item.count}</span>
                <span className={classnames(styles.b, Utils.GetValueColor(item.profit).textClass)}>{item.profit.toFixed(2)}%</span>
                <Button size="small" type="text" onClick={() => onRemove(i)} className={styles.act}>
                  删除
                </Button>
              </div>
            </List.Item>
          )}
        />
      </div>
    </PureCard>
  );
});
export default Holdings;
