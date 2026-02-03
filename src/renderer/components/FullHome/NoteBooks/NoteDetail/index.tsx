import React from 'react';
import { useSelector } from 'react-redux';
import CustomDrawerContent from '@/components/CustomDrawer/Content';
import styles from './index.scss';
import { Input, Empty, Button, Form, Select } from 'antd';
import { addNoteAction, updateNoteAction } from '@/actions/note';
import { useDispatch } from 'react-redux';
import { StoreState } from '@/reducers/types';

export interface NoteDetailProps {
  note: Note.NoteItem | null;
  back: () => void;
}

const NoteDetail: React.FC<NoteDetailProps> = ({ note, back }) => {
  const { books } = useSelector((state: StoreState) => state.note);
  const dispatch = useDispatch();
  function onChange(e) {
    if (note?.id !== '-1') {
      dispatch(updateNoteAction(note!.id, e.target.value));
    }
  }
  function save(values: { bookId: string; commentText: string }) {
    if (note?.id !== '-1') {
      dispatch(updateNoteAction(note!.id, values.commentText));
    } else {
      dispatch(addNoteAction(values.bookId, note.referUrl, note.referText, values.commentText));
    }
    back();
  }
  return (
    <CustomDrawerContent onClose={back} title="笔记详情">
      {note ? (
        <>
          <Form wrapperCol={{ span: 24 }} onFinish={save} initialValues={{ bookId: note.bookId, commentText: note.commentText }}>
            <Form.Item name="bookId">
              <Select bordered={false}>
                <Select.Option value="-1" key="-1">
                  选择笔记本
                </Select.Option>
                {books.length &&
                  books.map((b) => (
                    <Select.Option value={b.id} key={b.id}>
                      {b.name}
                    </Select.Option>
                  ))}
              </Select>
            </Form.Item>
            {note.referUrl && <div className={styles.referUrl}>{note.referUrl}</div>}
            {note.referText && <div className={styles.referText}>{note.referText}</div>}
            <Form.Item name="commentText">
              <Input.TextArea rows={8} className={styles.commentText} bordered={false} />
            </Form.Item>
            <Form.Item style={{ marginTop: 8 }}>
              <Button type="primary" htmlType="submit">
                保存
              </Button>
            </Form.Item>
          </Form>
        </>
      ) : (
        <Empty description="暂无股票数据~" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </CustomDrawerContent>
  );
};
export default NoteDetail;
