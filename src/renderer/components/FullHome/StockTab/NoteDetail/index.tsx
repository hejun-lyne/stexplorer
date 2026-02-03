import React, { useCallback, useRef } from 'react';
import { useState } from 'react';
import styles from './index.scss';
import { useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { NoteTabId } from '..';
import BraftEditor from 'braft-editor';
import { ContentUtils } from 'braft-utils';
import LoadingBar from '@/components/LoadingBar';
import { saveBookNoteAction, syncRemoteBookNoteAction, updateHTMLContentAction } from '@/actions/note';

export interface NoteDetailProps {
  tab: NoteTabId;
  active: boolean;
  onNoteUpdated: (tid: string, title?: string, changed?: boolean) => void;
}

const NoteDetail: React.FC<NoteDetailProps> = React.memo(({ tab, active, onNoteUpdated }) => {
  const note = useSelector((storeState: StoreState) => storeState.note.notesMapping[tab.nid]);
  const dispatch = useDispatch();
  if (!note) {
    // 需要从远端同步
    dispatch(syncRemoteBookNoteAction(tab.nid, tab.bid));
  }
  const [changeValid, setChangeValid] = useState(false);
  const [editorState, setEditorState] = useState<any>();
  const onChange = useCallback(
    (state) => {
      if (!changeValid) {
        return;
      }
      const html = state.toHTML() as string;
      dispatch(updateHTMLContentAction(tab.nid, html));
      setEditorState(state);
      const title = html.substring(0, html.indexOf('</p>') + 4).replace(/<\/?[^>]+(>|$)/g, '');
      onNoteUpdated(tab.tid, title, true);
    },
    [changeValid]
  );
  const onSave = () => {
    onNoteUpdated(tab.tid, undefined, false);
    dispatch(saveBookNoteAction(tab.nid, tab.bid));
  };
  if (!editorState && note) {
    setEditorState(BraftEditor.createEditorState(note.html));
  }
  const changeThrottle = useCallback(() => {
    setChangeValid(false);
    setTimeout(() => {
      setChangeValid(true);
    }, 100);
  }, []);
  const clearTextColor = useCallback(() => {
    setEditorState(ContentUtils.removeSelectionInlineStyles(editorState, ''));
  }, [editorState]);
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <LoadingBar show={note === undefined} />
        {editorState && (
          <BraftEditor
            value={editorState}
            onChange={onChange}
            onSave={onSave}
            stripPastedStyles={true}
            onBlur={changeThrottle}
            onFocus={changeThrottle}
            extendControls={[
              {
                key: 'clear-color-button',
                type: 'button',
                text: '清除颜色',
                onClick: clearTextColor,
              },
            ]}
          />
        )}
      </div>
    </div>
  );
});
export default NoteDetail;
