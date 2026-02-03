import React, { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Empty, Collapse, Dropdown, Menu, Button } from 'antd';
import { FolderOpenOutlined, FolderOutlined, PlusOutlined } from '@ant-design/icons';
import NoteList from './NoteList';
import { StoreState } from '@/reducers/types';
import styles from './index.scss';
import { addNoteAction, deleteBookAction } from '@/actions/note';

export interface NoteBooksProps {
  openBook: (book: Note.BookItem | null) => void;
  openNote: (note: Note.NoteBriefItem) => void;
}
const NoteBooks: React.FC<NoteBooksProps> = ({ openBook, openNote }) => {
  const { books } = useSelector((state: StoreState) => state.note);
  const dispatch = useDispatch();
  const BookHeader = (book: Note.BookItem) => {
    const onContextMenu = (e) => {
      switch (e.key) {
        case 'delete':
          dispatch(deleteBookAction(book.id));
          break;
        case 'edit':
          openBook(book);
          break;
        case 'note':
          dispatch(addNoteAction(book.id, '新建笔记～'));
          break;
      }
    };
    const menu = (
      <Menu onClick={onContextMenu}>
        <Menu.Item key="delete" danger={true}>
          删除
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item key="edit">编辑</Menu.Item>
        <Menu.Item key="note">新笔记</Menu.Item>
      </Menu>
    );
    return (
      <Dropdown overlay={menu} trigger={['contextMenu']}>
        <div style={{ marginTop: -20, marginLeft: 20 }}>
          <span className={styles.name}>{book.name}</span>
          {/* {book.description && <span className={styles.description}>{book.description}</span>} */}
        </div>
      </Dropdown>
    );
  };

  return (
    <div className={styles.container}>
      {books.length ? (
        <Collapse bordered={false} expandIcon={({ isActive }) => (!isActive ? <FolderOutlined /> : <FolderOpenOutlined />)}>
          {books.map((b) => (
            <Collapse.Panel header={BookHeader(b)} key={b.id}>
              <NoteList book={b} onNoteClick={openNote} />
              <Button
                icon={<PlusOutlined />}
                className={styles.addNote}
                type="text"
                onClick={() => dispatch(addNoteAction(b.id, '新建笔记～'))}
                block
              >
                添加笔记
              </Button>
            </Collapse.Panel>
          ))}
        </Collapse>
      ) : (
        <Empty description="暂无笔记数据~" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </div>
  );
};

export default NoteBooks;
