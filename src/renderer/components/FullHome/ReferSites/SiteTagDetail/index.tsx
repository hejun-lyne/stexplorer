import React from 'react';
import { useDispatch } from 'react-redux';
import CustomDrawerContent from '@/components/CustomDrawer/Content';
import { Button, Form, Input } from 'antd';
import { addSiteTagAction } from '@/actions/site';

export interface SiteTagDetailProps {
  siteId: string;
  onClose: () => void;
}

const SiteTagDetail: React.FC<SiteTagDetailProps> = ({ siteId, onClose }) => {
  const dispatch = useDispatch();
  // 添加操作
  const onFinish = (values: { name: string }) => {
    dispatch(addSiteTagAction(values.name, siteId));
    onClose();
  };
  const [form] = Form.useForm();
  return (
    <CustomDrawerContent title="添加标签" onClose={onClose}>
      <Form
        wrapperCol={{ span: 24 }}
        form={form}
        name="add_sitetag_form"
        onFinish={onFinish}
        autoComplete="off"
        style={{
          padding: '16px 8px',
        }}
      >
        <Form.Item name="name" style={{ marginBottom: 10 }}>
          <Input placeholder="标签名字" />
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

export default SiteTagDetail;
