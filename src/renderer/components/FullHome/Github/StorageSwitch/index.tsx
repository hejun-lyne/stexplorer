/**
 * 存储类型切换组件
 * 允许用户在 GitHub 和 SQLite 本地存储之间切换
 */
import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Button, Card, Radio, Alert, Descriptions, Tag, message } from 'antd';
import { DatabaseOutlined, CloudOutlined, SyncOutlined } from '@ant-design/icons';
import { StoreState } from '@/reducers/types';
import { switchStorageTypeAction } from '@/actions/storage';
import * as Helpers from '@/helpers';

const StorageSwitch: React.FC = () => {
  const dispatch = useDispatch();
  const { type: storageType, storage } = useSelector((state: StoreState) => state.storage);
  const { profile } = useSelector((state: StoreState) => state.github);
  
  const [loading, setLoading] = useState(false);
  const [dbStats, setDbStats] = useState<{ size: number; tables: string[] } | null>(null);
  const [checking, setChecking] = useState(false);

  // 当切换到 SQLite 时获取数据库统计信息
  useEffect(() => {
    if (storageType === 'sqlite' && storage) {
      fetchDbStats();
    }
  }, [storageType, storage]);

  const fetchDbStats = async () => {
    setChecking(true);
    try {
      const result = await Helpers.Storage.StorageHelper.GetStorageStats();
      if (result && result.stats) {
        setDbStats(result.stats);
      }
    } catch (error) {
      console.error('获取数据库统计信息失败:', error);
    }
    setChecking(false);
  };

  const handleSwitchStorage = async (newType: 'github' | 'sqlite') => {
    if (newType === storageType) {
      return;
    }

    // 如果切换到 GitHub，检查是否已登录
    if (newType === 'github' && !profile) {
      message.warning('请先连接 GitHub 账号');
      return;
    }

    setLoading(true);
    try {
      await dispatch(switchStorageTypeAction(newType));
      message.success(`已切换到 ${newType === 'sqlite' ? '本地 SQLite' : 'GitHub'} 存储`);
    } catch (error) {
      message.error('切换存储类型失败');
      console.error(error);
    }
    setLoading(false);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <Card 
      title="数据存储方式" 
      bordered={false}
      style={{ marginBottom: 16 }}
    >
      <Radio.Group 
        value={storageType} 
        onChange={(e) => handleSwitchStorage(e.target.value)}
        disabled={loading}
        style={{ marginBottom: 16 }}
      >
        <Radio.Button value="github" style={{ padding: '0 16px' }}>
          <CloudOutlined /> GitHub 存储
        </Radio.Button>
        <Radio.Button value="sqlite" style={{ padding: '0 16px' }}>
          <DatabaseOutlined /> 本地 SQLite 存储
        </Radio.Button>
      </Radio.Group>

      {storageType === 'github' && (
        <Alert
          message="GitHub 存储"
          description={
            profile 
              ? `当前已连接到 GitHub 账号: ${profile.name}。数据将同步到 GitHub 仓库中。`
              : '尚未连接 GitHub 账号。请先连接 GitHub 账号才能使用此存储方式。'
          }
          type={profile ? "info" : "warning"}
          showIcon
          style={{ marginTop: 16 }}
        />
      )}

      {storageType === 'sqlite' && (
        <>
          <Alert
            message="本地 SQLite 存储"
            description="数据存储在本地 SQLite 数据库中，无需网络连接即可访问。数据不会同步到云端。"
            type="success"
            showIcon
            style={{ marginTop: 16, marginBottom: 16 }}
          />
          
          {dbStats && (
            <Descriptions 
              title="数据库信息" 
              bordered 
              size="small"
              column={1}
            >
              <Descriptions.Item label="数据库大小">
                {formatFileSize(dbStats.size)}
              </Descriptions.Item>
              <Descriptions.Item label="数据表">
                {dbStats.tables.map(table => (
                  <Tag key={table} color="blue">{table}</Tag>
                ))}
              </Descriptions.Item>
            </Descriptions>
          )}
          
          <Button 
            icon={<SyncOutlined spin={checking} />} 
            onClick={fetchDbStats}
            loading={checking}
            size="small"
            style={{ marginTop: 8 }}
          >
            刷新统计
          </Button>
        </>
      )}

      {loading && (
        <Alert
          message="正在切换存储方式..."
          type="info"
          showIcon
          style={{ marginTop: 16 }}
        />
      )}
    </Card>
  );
};

export default StorageSwitch;
