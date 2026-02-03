/* eslint-disable promise/no-nesting */
import moment from 'moment';
import { ThunkAction } from '@/reducers/types';
import * as Utils from '@/utils';
import { batch } from 'react-redux';
import { appendLog } from './setting';

export const SYNC_NOTE_BOOKS = 'SYNC_NOTE_BOOKS';
export const SYNC_BOOK_NOTE = 'SYNC_BOOK_NOTE';
export const SET_BOOK_SYNING = 'SET_BOOK_SYNING';

export function syncRemoteBooksAction(): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        note: { books, booksModified },
        github: { storage },
      } = getState();
      if (!storage) {
        throw new Error('storage未初始化');
      }
      dispatch({ type: SET_BOOK_SYNING, payload: { v: true, t: '读取books数据中' } });
      storage
        .ReadRemoteBooks()
        .then((content) => {
          if (!content) {
            // 读取数据失败
            dispatch(appendLog('读取books数据失败: content = undefined'));
            dispatch({ type: SET_BOOK_SYNING, payload: { v: false, t: '读取books数据失败' } });
          }
          return content;
        })
        .then((content) => {
          if (content && content.data && content.lastModified >= booksModified) {
            batch(() => {
              dispatch({ type: SYNC_NOTE_BOOKS, payload: [content.data, content.lastModified] });
              dispatch({ type: SET_BOOK_SYNING, payload: { v: false, t: '读取books完成' } });
            });
            return [false, content.data];
          }
          return [true, null];
        })
        .then(([willWrite, data]) => {
          if (willWrite && books.length) {
            dispatch({ type: SET_BOOK_SYNING, payload: { v: true, t: '写入books数据中' } });
            // eslint-disable-next-line promise/no-nesting
            storage
              .WriteRemoteBooks(books, booksModified)
              .then((success) => {
                if (!success) {
                  dispatch(appendLog('写入books数据失败: success = false'));
                  throw new Error('写入远端数据失败');
                }
                dispatch({ type: SET_BOOK_SYNING, payload: { v: false, t: '写入books完成' } });
                return success;
              })
              .catch((error) => {
                dispatch(appendLog('写入books数据失败: error = ' + error.description));
                dispatch({ type: SET_BOOK_SYNING, payload: { v: false, t: '写入books失败' } });
              });
          }
          return data;
        });
    } catch (error) {
      console.log('同步笔记出错', error);
    }
  };

}

export function syncRemoteTrackingNoteAction(secid: string): ThunkAction {
  return (dispatch, getState) => {
    const {
      note: { books },
    } = getState();
    const book = books.find((b) => b.name == '我的复盘');
    if (!book) {
      console.log('需要先创建《我的复盘》');
    } else {
      const note = book.notes.find((n) => n.id === secid);
      if (!note) {
        console.log(`日志${secid}不存在，需要创建`);
        dispatch(addNoteAction(book.id, `${secid}复盘`, secid));
      } else {
        dispatch(syncRemoteBookNoteAction(secid, book.id));
      }
    }
  };
}

export function syncRemoteBookNoteAction(noteId: number | string, bookId: number): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        note: { notesMapping },
        github: { storage },
      } = getState();
      if (!storage) {
        throw new Error('storage未初始化');
      }
      if (!notesMapping[noteId]) {
        // 只有首次才下载
        dispatch(appendLog(`读取note<${noteId}>数据中`));
        dispatch({ type: SET_BOOK_SYNING, payload: { v: true, t: `读取note<${noteId}>数据中` } });
        storage
          .ReadRemoteNote(bookId, noteId)
          .then((content) => {
            if (!content) {
              // 读取数据失败
              dispatch(appendLog(`读取note<${noteId}>数据失败`));
              dispatch({ type: SET_BOOK_SYNING, payload: { v: false, t: `读取note<${noteId}>数据失败` } });
            }
            return content;
          })
          .then((content) => {
            const prev = notesMapping[noteId];
            if (!content?.data) {
              if (!prev) {
                // 可能出错了，初始化内容为空
                batch(() => {
                  dispatch({
                    type: SYNC_BOOK_NOTE,
                    payload: {
                      id: noteId,
                      html: '',
                      modifiedTime: moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
                    } as Note.NoteContentItem,
                  });
                  dispatch(appendLog(`读取note<${noteId}>完成`));
                  dispatch({ type: SET_BOOK_SYNING, payload: { v: false, t: `读取note<${noteId}>完成` } });
                });
              }
              return true;
            }
            const current = content.data as Note.NoteContentItem;
            if (!prev || (current && current.modifiedTime >= prev.modifiedTime)) {
              batch(() => {
                dispatch({
                  type: SYNC_BOOK_NOTE,
                  payload: current,
                });

                dispatch({
                  type: SET_BOOK_SYNING,
                  payload: {
                    v: false,
                    t: `读取note<${noteId}>完成`,
                  },
                });
              });
              return false;
            }
            return true;
          })
          .then((content) => {
            const current = notesMapping[noteId];
            if (content && current) {
              dispatch(appendLog(`写入note<${noteId}>数据中`));
              dispatch({ type: SET_BOOK_SYNING, payload: { v: true, t: `写入note<${noteId}>数据中` } });
              // eslint-disable-next-line promise/no-nesting
              storage
                .WriteRemoteNote(bookId, current)
                .then((success) => {
                  if (!success) {
                    throw new Error('写入远端数据失败');
                  }
                  dispatch(appendLog(`写入note<${noteId}>完成`));
                  dispatch({ type: SET_BOOK_SYNING, payload: { v: false, t: `写入note<${noteId}>完成` } });
                  return success;
                })
                .catch((error) => {
                  dispatch(appendLog(`写入note<${noteId}>失败`));
                  dispatch({ type: SET_BOOK_SYNING, payload: { v: false, t: `写入note<${noteId}>失败` } });
                });
            }
            return content;
          });
      } else {
        // 后续同步直接写入
        dispatch(appendLog(`写入note<${noteId}>数据中`));
        dispatch({ type: SET_BOOK_SYNING, payload: { v: true, t: `写入note<${noteId}>数据中` } });
        // eslint-disable-next-line promise/no-nesting
        storage
          .WriteRemoteNote(bookId, notesMapping[noteId])
          .then((success) => {
            if (!success) {
              throw new Error('写入远端数据失败');
            }
            dispatch(appendLog(`写入note<${noteId}>完成`));
            dispatch({ type: SET_BOOK_SYNING, payload: { v: false, t: `写入note<${noteId}>完成` } });
            return success;
          })
          .catch((error) => {
            dispatch(appendLog(`写入note<${noteId}>失败`));
            dispatch({
              type: SET_BOOK_SYNING,
              payload: {
                v: false,
                t: `写入note<${noteId}>失败`,
              },
            });
          });
      }
    } catch (error) {
      console.log('同步笔记出错', error);
    }
  };
}

export function addBookAction(name: string, domain: string, description?: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        note: { books },
      } = getState();
      const id = books.length ? Math.max(...books.map((n) => Number(n.id))) + 1 : 100;
      dispatch(
        setNoteBooksAction(
          books.concat([
            {
              id: id,
              name: name,
              domain: domain || '',
              description: description || '',
              notes: [],
            },
          ])
        )
      );
    } catch (error) {
      console.log('添加NoteBook出错', error);
    }
  };
}

export function updateBookAction(id: number, name?: string, domain?: string, description?: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        note: { books },
      } = getState();
      const b = books.find((n) => n.id === id);
      if (b) {
        if (name) b.name = name;
        if (domain) b.domain = domain;
        if (description) b.description = description;
        dispatch(setNoteBooksAction(Utils.DeepCopy(books)));
      }
    } catch (error) {
      console.log('更新NoteBook出错', error);
    }
  };
}

export function deleteBookAction(id: number): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        note: { books },
      } = getState();
      const filtered = books.filter((n) => n.id !== id);
      dispatch(setNoteBooksAction(filtered));
    } catch (error) {
      console.log('移除NoteBook出错', error);
    }
  };
}

function setNoteBooksAction(books: Note.BookItem[]): ThunkAction {
  return (dispatch, getState) => {
    try {
      dispatch({ type: SYNC_NOTE_BOOKS, payload: [books, moment(new Date()).format('YYYY-MM-DD HH:mm:ss')] });
      dispatch(syncRemoteBooksAction());
    } catch (error) {
      console.log('移除NoteBook出错', error);
    }
  };
}

export function addNoteAction(bookId: number, initContent?: string, fixId?: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        note: { books },
      } = getState();
      const book = books.find((n) => n.id === bookId);
      if (!book) {
        throw new Error('无法找到book: ' + bookId);
      }
      const now = moment(new Date()).format('MM月DD日 HH:mm:ss');
      const id = fixId || bookId * 1000 + (book.notes && book.notes.length ? Math.max(...book.notes.map((n) => Number(n.id))) + 1 : 1);

      if (!book.notes) {
        book.notes = [
          {
            id,
            bookId,
            createTime: now,
            modifiedTime: now,
            firstLine: initContent || '新笔记',
          },
        ];
      } else {
        book.notes.push({
          id,
          bookId,
          createTime: now,
          modifiedTime: now,
          firstLine: initContent || '新笔记',
        });
      }
      dispatch(setNoteBooksAction(books));
      if (initContent) {
        dispatch(
          setNoteAction(bookId, {
            id,
            modifiedTime: now,
            html: `<p>${initContent}</p>`,
          })
        );
      }
    } catch (error) {
      console.log('添加笔记出错', error);
    }
  };
}

function setNoteAction(bookId: number, note: Note.NoteContentItem): ThunkAction {
  return (dispatch, getState) => {
    try {
      dispatch({ type: SYNC_BOOK_NOTE, payload: note });
    } catch (error) {
      console.log('移除NoteBook出错', error);
    }
  };
}

export function updateNoteAction(bookId: number, id: string, html: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        note: { notesMapping },
      } = getState();
      const n = notesMapping[id];
      if (!n) {
        throw new Error(`找不到笔记:${id}`);
      }
      const now = moment(new Date()).format('MM月DD日 HH:mm:ss');
      n.html = html;
      n.modifiedTime = now;
      dispatch(setNoteAction(bookId, n));
    } catch (error) {
      console.log('更新Note出错', error);
    }
  };
}

export function updateHTMLContentAction(id: number | string, html: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        note: { notesMapping },
      } = getState();
      const n = notesMapping[id];
      if (!n) {
        throw new Error(`找不到笔记:${id}`);
      }
      n.html = html;
      dispatch({ type: SYNC_BOOK_NOTE, payload: Utils.DeepCopy(n) });
    } catch (error) {
      console.log('更新Note出错', error);
    }
  };
}

export function appendReferAction(id: number, url: string, text: string): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        note: { notesMapping },
      } = getState();
      const n = notesMapping[id];
      if (!n) {
        throw new Error(`找不到笔记:${id}`);
      }
      n.html = `${n.html}<blockquote>${text}<br/><a href="${url}">${url}</a></blockquote><p></p>`;
      dispatch({ type: SYNC_BOOK_NOTE, payload: Utils.DeepCopy(n) });
    } catch (error) {
      console.log('更新Note出错', error);
    }
  };
}

export function saveTrackingNoteAction(secid: string): ThunkAction {
  return (dispatch, getState) => {
    const {
      note: { books },
    } = getState();
    const book = books.find((b) => b.name == '我的复盘');
    if (!book) {
      console.log('需要先创建《我的复盘》');
    } else {
      dispatch(saveBookNoteAction(secid, book.id));
    }
  };
}

export function saveBookNoteAction(id: number | string, bookId: number): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        note: { books, notesMapping },
      } = getState();
      const n = notesMapping[id];
      if (!n) {
        throw new Error(`找不到笔记:${id}`);
      }
      dispatch(syncRemoteBookNoteAction(id, bookId));
      const book = books.find((b) => b.id === bookId);
      if (book) {
        const brief = book.notes.find((n) => n.id === id);
        if (brief) {
          brief.firstLine = n.html.substring(0, n.html.indexOf('</p>') + 4).replace(/<\/?[^>]+(>|$)/g, '');
          brief.modifiedTime = n.modifiedTime;
          dispatch(setNoteBooksAction(Utils.DeepCopy(books)));
        }
      }
    } catch (error) {
      console.log('保存Note出错', error);
    }
  };
}

export function deleteNoteAction(id: number, bookId: number): ThunkAction {
  return (dispatch, getState) => {
    try {
      const {
        note: { books },
      } = getState();
      const book = books.find((n) => n.id === bookId);
      if (!book) {
        throw new Error(`找不到笔记本:${bookId}`);
      }
      const filtered = book.notes.filter((n) => n.id !== id);
      book.notes = filtered;
      dispatch(setNoteBooksAction(books));
    } catch (error) {
      console.log('移除Note出错', error);
    }
  };
}
