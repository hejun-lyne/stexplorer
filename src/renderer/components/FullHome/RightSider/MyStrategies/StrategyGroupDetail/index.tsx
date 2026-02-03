import React from 'react';
import { useDispatch } from 'react-redux';
import CustomDrawerContent from '@/components/CustomDrawer/Content';
import { Button, Form, Input } from 'antd';
import { addStrategyGroupAction, updateStrategyGroupAction } from '@/actions/strategy';

export interface StrategyGroupDetailProps {
  onClose: () => void;
  group: Strategy.GroupItem | null;
}

const StrategyGroupDetail: React.FC<StrategyGroupDetailProps> = ({ onClose, group }) => {
  const dispatch = useDispatch();
  // 添加操作
  const onFinish = (values: { name: string; domain: string; description: string }) => {
    if (group) {
      dispatch(updateStrategyGroupAction(group.id, values.name));
    } else {
      dispatch(addStrategyGroupAction(values.name));
    }
    onClose();
  };
  const [form] = Form.useForm();
  return (
    <CustomDrawerContent title="策略组" onClose={onClose}>
      <Form
        wrapperCol={{ span: 24 }}
        form={form}
        name="add_sgroup_form"
        onFinish={onFinish}
        autoComplete="off"
        style={{
          padding: '16px 8px',
        }}
        initialValues={{
          name: group ? group.name : '',
        }}
      >
        <Form.Item name="name">
          <Input placeholder="策略组名字" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit">
            提交
          </Button>
        </Form.Item>
      </Form>
    </CustomDrawerContent>
  );
};

export default StrategyGroupDetail;
