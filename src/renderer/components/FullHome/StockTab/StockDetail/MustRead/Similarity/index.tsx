import React, { useCallback, useEffect, useState } from 'react';
import styles from '../index.scss';
import * as Services from '@/services';
import { useRequest } from 'ahooks';
import { Row, Col, List, Input, Form, DatePicker, Button } from 'antd';
import * as Utils from '@/utils';
import { useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import SimilarItem from './SimilarItem';
import { KLineType, MAPeriodType } from '@/utils/enums';
import { addStockSimiItemAction, deleteStockSimiItemAction } from '@/actions/stock';

export interface SimilarityProps {
  secid: string;
  openStock: (secid: string, name: string, change?: number) => void;
}

const Similarity: React.FC<SimilarityProps> = React.memo(({ secid, openStock }) => {
    const config = useSelector((store: StoreState) => store.stock.stockConfigsMapping[secid]);
    const [form] = Form.useForm();
    const dispatch = useDispatch();
    const onSubmit = useCallback((values: any) => {
        // 添加记录
        Services.Stock.GetDetailFromEastmoney(values.secid).then((detail) => {
            if (!detail) {
                console.log('获取标的详情失败', values.secid);
            } else {
                dispatch(addStockSimiItemAction(secid, detail.secid, detail.name, values.range[0].format('YYYY-MM-DD'), values.range[1].format('YYYY-MM-DD')));
            }
        });
    }, [secid]);
    const deleteItem = useCallback((id: number) => {
        dispatch(deleteStockSimiItemAction(secid, id));
    }, [secid]);
    return (
        <div className={styles.commonWrapper}>
            <div>
                <Form layout='inline' form={form} onFinish={onSubmit}>
                    <Form.Item label='secid' name='secid' required>
                        <Input />
                    </Form.Item>
                    <Form.Item label='range' name='range' required>
                        <DatePicker.RangePicker size="small" />
                    </Form.Item>
                    <Form.Item wrapperCol={{ offset: 8, span: 16 }}>
                        <Button type="primary" htmlType="submit">
                        添加记录
                        </Button>
                    </Form.Item>
                </Form>

            </div>
            <div>
            <List
                itemLayout="horizontal"
                dataSource={config.similars}
                renderItem={(s) => (
                <SimilarItem
                    ktype={KLineType.Day}
                    mtype={MAPeriodType.Medium}
                    item={s}
                    deleteItem={deleteItem}
                    openStock={openStock}
                />
                )}
            />
            </div>
        </div>
    );
});
export default Similarity;
