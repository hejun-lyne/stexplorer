import React from 'react';
import { Empty } from 'antd';
import NoteRow from './NoteRow';
import styles from './index.scss';

export interface NoteListProps {
  book: Note.BookItem | undefined;
  onNoteClick: (n: Note.NoteBriefItem) => void;
}

const NoteList: React.FC<NoteListProps> = ({ book, onNoteClick }) => {
  return (
    <div className={styles.container}>
      {book && book.notes && book.notes.length ? (
        book.notes
          .sort((a, b) => (a.modifiedTime > b.modifiedTime ? 1 : -1))
          .map((n) => <NoteRow key={n.id} note={n} onClick={onNoteClick} />)
      ) : (
        <Empty description="暂无笔记数据~" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </div>
  );
};

export default NoteList;
