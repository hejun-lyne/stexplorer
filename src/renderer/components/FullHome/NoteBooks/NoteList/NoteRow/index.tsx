import React from 'react';
import { useDispatch } from 'react-redux';
import styles from './index.scss';
import { Menu, Dropdown } from 'antd';
import { deleteNoteAction } from '@/actions/note';

export interface NoteRowProps {
  note: Note.NoteBriefItem;
  onClick: (note: Note.NoteBriefItem) => void;
}

const { dialog } = window.contextModules.electron;
const NoteRow: React.FC<NoteRowProps> = ({ note, onClick }) => {
  const dispatch = useDispatch();

  async function deleteNote() {
    const { response } = await dialog.showMessageBox({
      title: '删除笔记',
      type: 'info',
      message: `确认删除 ${note.id}`,
      buttons: ['确定', '取消'],
    });
    if (response === 0) {
      dispatch(deleteNoteAction(note.id, note.bookId));
    }
  }
  function editStock() {
    onClick(note);
  }

  const onContextMenu = (e) => {
    switch (e.key) {
      case 'delete':
        deleteNote();
        break;
    }
  };
  const menu = (
    <Menu onClick={onContextMenu}>
      <Menu.Item key="delete" danger={true}>
        删除
      </Menu.Item>
    </Menu>
  );
  return (
    <>
      <Dropdown overlay={menu} trigger={['contextMenu']}>
        <div onClick={editStock} className={styles.row}>
          <div className={styles.time}>{note.modifiedTime}</div>
          {note.firstLine.length > 0 && <div className={styles.firstLine}>{note.firstLine}</div>}
          {note.firstLine.length == 0 && <div className={styles.nonefirstLine}>firstLine lost</div>}
        </div>
      </Dropdown>
    </>
  );
};

export default NoteRow;
