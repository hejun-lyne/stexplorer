import React, { useCallback, useEffect, useState } from 'react';
import styles from '../index.scss';
import * as Services from '@/services';
import { useRequest } from 'ahooks';
import { Row, Col, List, Input, Form, DatePicker, Button, Select, Radio } from 'antd';
import * as Utils from '@/utils';
import { useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { KLineType, MAPeriodType, PeriodMarkType, PeriodMarkTypeDescribes, PeriodMarkTypeNames } from '@/utils/enums';
import { addStockPeriodMarkItemAction, addStockSimiItemAction, deleteStockPeriodMarkItemAction, deleteStockSimiItemAction } from '@/actions/stock';
import { DeleteOutlined } from '@ant-design/icons';
import { Stock } from '@/types/stock';

export interface PeriodMarkProps {
  secid: string;
  showPeriod: (period: Stock.PeriodMarkItem|null) => void;
}

const PeriodMark: React.FC<PeriodMarkProps> = React.memo(({ secid, showPeriod }) => {
    const config = useSelector((store: StoreState) => store.stock.stockConfigsMapping[secid]);
    const [form] = Form.useForm();
    const dispatch = useDispatch();
    const onSubmit = useCallback((values: any) => {
        // 添加记录
        dispatch(addStockPeriodMarkItemAction(secid, config.name, values.type, values.range[0].format('YYYY-MM-DD'), values.range[1].format('YYYY-MM-DD')));
    }, [secid]);
    const deleteItem = useCallback((id: number) => {
        dispatch(deleteStockPeriodMarkItemAction(secid, id));
    }, [secid]);
    const [activeId, setActiveId] = useState(0);
    const changActive = useCallback((s: Stock.PeriodMarkItem) => {
        if (activeId == s.id) {
            setActiveId(0);
            showPeriod(null);
        } else {
            setActiveId(s.id);
            showPeriod(s);
        }
    }, [activeId]);
    return (
        <div className={styles.commonWrapper}>
            <div>
                <Form layout='inline' form={form} onFinish={onSubmit}>
                    <Form.Item label='type' name='type' required>
                        <Select size='small' style={{ width: 120}} defaultValue={PeriodMarkType.Unknown}>
                            <Select.Option value={PeriodMarkType.Unknown}>{PeriodMarkTypeNames[PeriodMarkType.Unknown]}</Select.Option>
                            <Select.Option value={PeriodMarkType.DuoChongDing}>{PeriodMarkTypeNames[PeriodMarkType.DuoChongDing]}</Select.Option>
                            <Select.Option value={PeriodMarkType.QingXingZhengLi}>{PeriodMarkTypeNames[PeriodMarkType.QingXingZhengLi]}</Select.Option>
                            <Select.Option value={PeriodMarkType.LiSanLaXingLaSheng}>{PeriodMarkTypeNames[PeriodMarkType.LiSanLaXingLaSheng]}</Select.Option>
                        </Select>
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
                dataSource={config.periodMarks}
                renderItem={(s) => (
                <List.Item key={s.id}>
                    <List.Item.Meta 
                        avatar={<Radio checked={s.id === activeId} onClick={() => changActive(s)} style={{marginTop: 2}}></Radio>}
                        title={<><strong>{PeriodMarkTypeNames[s.type]} {s.startDate} to {s.endDate}</strong><Button type="text" icon={<DeleteOutlined />} onClick={() => deleteItem(s.id)} /></>}
                        description={PeriodMarkTypeDescribes[s.type]}
                    />
                </List.Item>
                )}
            />
            </div>
        </div>
    );
});
export default PeriodMark;
