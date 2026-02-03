import React, { useState } from 'react';
import { batch, useSelector } from 'react-redux';
import { Input, Button, Form, Alert, Row, Col, Dropdown, Menu, Modal } from 'antd';
import { clearStorageAction, renewStorageAction, saveLoginInfoAction, syncProfileAction } from '@/actions/github';
import { useDispatch } from 'react-redux';
import GitHubApi from '@/services/github';
import { StoreState } from '@/reducers/types';

const GithubAccount: React.FC = () => {
  const { profile } = useSelector((state: StoreState) => state.github);
  const [error, setError] = useState(false);
  const dispatch = useDispatch();
  function save(values: { token: string }) {
    const t = values.token || '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';
    const api = new GitHubApi({ token: t });
    api
      .getProfile()
      .then((profile) => {
        if (profile) {
          batch(() => {
            dispatch(saveLoginInfoAction(t));
            dispatch(syncProfileAction(profile));
            dispatch(renewStorageAction());
          });
          return profile;
        } else {
          throw new Error("Profile doesn't exist");
        }
      })
      .catch((error) => {
        console.log('Error: ' + error);
        setError(true);
      });
  }

  const { syning } = useSelector((state: StoreState) => state.site);
  function syncData() {
    dispatch(renewStorageAction());
  }
  const [isModalOpen, setIsModalOpen] = useState(false);
  function handleLogoutClick() {
    setIsModalOpen(true);
  }
  const menu = (
    <><Menu onClick={handleLogoutClick}>
      <Menu.Item key="1">切换账号</Menu.Item>
    </Menu>
    <Modal title="Basic Modal" visible={isModalOpen} onOk={() => dispatch(clearStorageAction())} onCancel={()=>setIsModalOpen(false)}>
        <p>原账号认证信息将失效，确定要切换账号吗？</p>
    </Modal></>
  );
  return (
    <>
      {profile ? (
        <Dropdown.Button overlay={menu} style={{ padding: 0, width: '100%' }}>
          <Button type="primary" loading={syning.v} block onClick={syncData} style={{ border: 0 }}>
            {syning.v ? syning.t : '同步数据'}
          </Button>
        </Dropdown.Button>
      ) : (
        <Form
          wrapperCol={{ span: 24 }}
          onFinish={save}
          style={{
            padding: '5px',
          }}
        >
          {error && <Alert message="Token验证错误" type="error" />}
          <Form.Item name="token" rules={[{ required: true, message: 'OAuth token!' }]}>
            <Input placeholder="Github Personal Token" />
          </Form.Item>
          <Form.Item wrapperCol={{ span: 24 }}>
            <Button type="primary" htmlType="submit" block>
              连接GitHub
            </Button>
          </Form.Item>
        </Form>
      )}
    </>
  );
};
export default GithubAccount;
