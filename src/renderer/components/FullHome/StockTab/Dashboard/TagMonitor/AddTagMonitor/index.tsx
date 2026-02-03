import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import CustomDrawerContent from '@/components/CustomDrawer/Content';
import { Button, Form, Select } from 'antd';
import { addTagMonitor } from '@/actions/setting';
import { StoreState } from '@/reducers/types';
import { StockMarketType } from '@/utils/enums';
import { Stock } from '@/types/stock';

export interface AddTagMonitorProps {
  onClose: () => void;
  monitor?: Stock.MonitorItem;
}

const AddTagMonitor: React.FC<AddTagMonitorProps> = React.memo(({ onClose, monitor }) => {
  const configs = useSelector((state: StoreState) => state.stock.stockConfigs);
  const stockConfigs = configs.filter((_) => _.type === StockMarketType.AB);
  const bankuaiConfigs = configs.filter((_) => _.type !== StockMarketType.AB);
  const tags: string[] = [...new Set([].concat.apply([], [...stockConfigs.map((s) => s.tags || [])]))].filter((t) => t != '默认');
  const dispatch = useDispatch();
  // 添加操作
  const onFinish = (values: { tag: string; bankuai: string }) => {
    dispatch(addTagMonitor(values.tag, values.bankuai));
    onClose();
  };
  const [form] = Form.useForm();
  return (
    <CustomDrawerContent title="分类监控" onClose={onClose}>
      <Form
        wrapperCol={{ span: 24 }}
        form={form}
        name="add_monitor_form"
        onFinish={onFinish}
        autoComplete="off"
        style={{
          padding: '16px 8px',
        }}
      >
        <Form.Item name="tag">
          <Select>
            <Select.Option value={-1}>选择标签</Select.Option>
            {tags.map((t) => (
              <Select.Option value={t} key={t}>
                {t}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item name="bankuai">
          <Select>
            <Select.Option value={-1}>选择板块/指数</Select.Option>
            {bankuaiConfigs.map((t) => (
              <Select.Option value={t.secid} key={t.code}>
                {t.name}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit">
            提交
          </Button>
        </Form.Item>
      </Form>
    </CustomDrawerContent>
  );
});

export default AddTagMonitor;
