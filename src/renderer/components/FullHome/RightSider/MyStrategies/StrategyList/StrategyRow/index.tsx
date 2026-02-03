import React, { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import styles from '../index.scss';
import { Menu, Dropdown } from 'antd';
import { deleteStrategyAction } from '@/actions/strategy';

export interface StrategyRowProps {
  brief: Strategy.BriefItem;
  onClick: (brief: Strategy.BriefItem) => void;
}

const { dialog } = window.contextModules.electron;
const StrategyRow: React.FC<StrategyRowProps> = ({ brief, onClick }) => {
  const dispatch = useDispatch();

  const deleteNote = useCallback(async () => {
    const { response } = await dialog.showMessageBox({
      title: '删除策略',
      type: 'info',
      message: `确认删除 ${brief.id}`,
      buttons: ['确定', '取消'],
    });
    if (response === 0) {
      dispatch(deleteStrategyAction(brief.id, brief.groupId));
    }
  }, [brief]);

  const editStrategy = useCallback(() => onClick(brief), [brief]);

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
        <div onClick={editStrategy} className={styles.row}>
          <div className={styles.time}>{brief.modifiedTime}</div>
          {brief.firstLine && <div className={styles.firstLine}>{brief.firstLine}</div>}
        </div>
      </Dropdown>
    </>
  );
};

export default StrategyRow;
