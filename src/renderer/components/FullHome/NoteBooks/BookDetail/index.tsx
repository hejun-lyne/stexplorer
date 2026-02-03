import React from 'react';
import { useDispatch } from 'react-redux';
import CustomDrawerContent from '@/components/CustomDrawer/Content';
import { Button, Form, Input } from 'antd';
import { addBookAction, updateBookAction } from '@/actions/note';

export interface BookDetailProps {
  onClose: () => void;
  book: Note.BookItem | null;
}

const BookDetail: React.FC<BookDetailProps> = ({ onClose, book }) => {
  const dispatch = useDispatch();
  // 添加操作
  const onFinish = (values: { name: string; domain: string; description: string }) => {
    if (book) {
      dispatch(updateBookAction(book.id, values.name, values.domain, values.description));
    } else {
      dispatch(addBookAction(values.name, values.domain, values.description));
    }
    onClose();
  };
  const [form] = Form.useForm();
  return (
    <CustomDrawerContent title="笔记本" onClose={onClose}>
      <Form
        wrapperCol={{ span: 24 }}
        form={form}
        name="add_book_form"
        onFinish={onFinish}
        autoComplete="off"
        style={{
          padding: '16px 8px',
        }}
        initialValues={{
          name: book ? book.name : '',
          domain: book ? book.domain : '',
          description: book ? book.description : '',
        }}
      >
        <Form.Item name="name">
          <Input placeholder="Note Book" />
        </Form.Item>
        <Form.Item name="domain">
          <Input placeholder="https://www.domain.com" />
        </Form.Item>
        <Form.Item name="description">
          <Input.TextArea rows={8} placeholder="Description" />
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

export default BookDetail;
