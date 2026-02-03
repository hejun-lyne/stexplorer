import { SYNC_NOTE_BOOKS, SYNC_BOOK_NOTE, SET_BOOK_SYNING } from '@/actions/note';
import { Reducer } from '@/reducers/types';
import moment from 'moment';

export type NoteState = {
  books: Note.BookItem[];
  booksModified: string;
  notesMapping: Record<string, Note.NoteContentItem>;
  syning: { v: boolean; t: string };
};

const note: Reducer<NoteState> = (
  state = {
    books: [],
    booksModified: '1970-01-01 00:00:00',
    notesMapping: {},
    syning: { v: false, t: '' },
  },
  action
) => {
  switch (action.type) {
    case SYNC_NOTE_BOOKS:
      const [books, modified] = action.payload;
      // for (var i = 0; i < books.length; i++) {
      //   var book = books[i] as Note.BookItem;
      //   for (var j = 0; j < book.notes.length; j++) {
      //     if (book.notes[j].firstLine == '') {
      //       book.notes[j].firstLine = 'firstLine lost';
      //     }
      //   }
      // }
      return {
        ...state,
        books,
        booksModified: modified,
      };
    case SYNC_BOOK_NOTE:
      const data = action.payload as Note.NoteContentItem;
      return {
        ...state,
        notesMapping: {
          ...state.notesMapping,
          [data.id]: data,
        },
      };
    case SET_BOOK_SYNING:
      return {
        ...state,
        syning: action.payload,
      };
    default:
      return state;
  }
};

export default note;
