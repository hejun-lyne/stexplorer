import React, { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Empty, Collapse, Dropdown, Menu, Button, Form, Input } from 'antd';
import { FolderOpenOutlined, FolderOutlined, PlusOutlined } from '@ant-design/icons';
import { StoreState } from '@/reducers/types';
import styles from './index.scss';
import { addStrategyAction, addStrategyGroupAction, deleteStrategyGroupAction } from '@/actions/strategy';
import StrategyList from './StrategyList';

export interface MyStrategiesProps {
  openGroup: (group: Strategy.GroupItem | null) => void;
  openStrategy: (strategy: Strategy.BriefItem) => void;
}
const MyStrategies: React.FC<MyStrategiesProps> = ({ openGroup, openStrategy }) => {
  const { groups } = useSelector((state: StoreState) => state.strategy);
  const dispatch = useDispatch();
  const GroupHeader = (group: Strategy.GroupItem) => {
    const onContextMenu = (e) => {
      switch (e.key) {
        case 'delete':
          dispatch(deleteStrategyGroupAction(group.id));
          break;
        case 'edit':
          openGroup(group);
          break;
        case 'strategy':
          dispatch(addStrategyAction(group.id, '//新建策略组～'));
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
        <Menu.Item key="strategy">新策略</Menu.Item>
      </Menu>
    );
    return (
      <Dropdown overlay={menu} trigger={['contextMenu']}>
        <div>
          <span className={styles.name}>{group.name}</span>
          {/* {book.description && <span className={styles.description}>{book.description}</span>} */}
        </div>
      </Dropdown>
    );
  };

  // 添加操作
  const onFinish = (values: { name: string }) => {
    dispatch(addStrategyGroupAction(values.name));
  };
  const [form] = Form.useForm();

  return (
    <div className={styles.container}>
      <div>
        <Form
          layout="inline"
          form={form}
          name="add_sgroup_form"
          onFinish={onFinish}
          initialValues={{
            name: '',
          }}
          style={{ padding: 5 }}
        >
          <Form.Item name="name" style={{ marginRight: 0 }}>
            <Input placeholder="新建策略组" style={{ width: 160, marginRight: 10 }} />
          </Form.Item>
          <Form.Item style={{ marginRight: 0 }}>
            <Button type="primary" htmlType="submit">
              提交
            </Button>
          </Form.Item>
        </Form>
      </div>
      {groups.length ? (
        <Collapse bordered={false} expandIcon={({ isActive }) => (!isActive ? <FolderOutlined /> : <FolderOpenOutlined />)}>
          {groups.map((b) => (
            <Collapse.Panel header={GroupHeader(b)} key={b.id}>
              <StrategyList group={b} onStrategyClick={openStrategy} />
              <Button
                icon={<PlusOutlined />}
                className={styles.add}
                type="text"
                onClick={() => dispatch(addStrategyAction(b.id, '//新建策略～'))}
                block
              >
                添加策略
              </Button>
            </Collapse.Panel>
          ))}
        </Collapse>
      ) : (
        <Empty description="暂无策略数据~" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </div>
  );
};

export default MyStrategies;
