import React, { useCallback, useRef } from 'react';
import { useState } from 'react';
import styles from './index.scss';
import { useDispatch, useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import BraftEditor from 'braft-editor';
import { ContentUtils } from 'braft-utils';
import LoadingBar from '@/components/LoadingBar';
import { saveTrackingNoteAction, syncRemoteTrackingNoteAction, updateHTMLContentAction } from '@/actions/note';

export interface TrackingNoteProps {
  secid: string;
  active: boolean;
  onNoteUpdated: (changed?: boolean) => void;
}

const TrackingNote: React.FC<TrackingNoteProps> = React.memo(({ active, secid, onNoteUpdated }) => {
  const note = useSelector((storeState: StoreState) => storeState.note.notesMapping[secid]);
  const dispatch = useDispatch();
  if (!note) {
    // 需要从远端同步
    dispatch(syncRemoteTrackingNoteAction(secid));
  }
  const [changeValid, setChangeValid] = useState(false);
  const [editorState, setEditorState] = useState<any>();
  const onChange = useCallback(
    (state) => {
      if (!changeValid) {
        return;
      }
      const html = state.toHTML() as string;
      dispatch(updateHTMLContentAction(secid, html));
      setEditorState(state);
      onNoteUpdated(true);
    },
    [changeValid, secid]
  );
  const onSave = () => {
    dispatch(saveTrackingNoteAction(secid));
    onNoteUpdated(false);
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
              {
                key: 'save-now-button',
                type: 'button',
                text: '保存',
                onClick: onSave,
              },
            ]}
          />
        )}
      </div>
    </div>
  );
});
export default TrackingNote;
