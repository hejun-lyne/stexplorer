/**
 * 存储类型切换组件
 * 允许用户在 GitHub 和本地文件存储之间切换
 */
import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Button, Card, Radio, Alert, Descriptions, Tag, message, Modal, Switch, InputNumber, Divider } from 'antd';
import { CloudOutlined, SyncOutlined, FolderOutlined, ImportOutlined, ExclamationCircleOutlined, CloudUploadOutlined } from '@ant-design/icons';
import { StoreState } from '@/reducers/types';
import { 
  switchStorageTypeAction, 
  migrateFromGithubToLocalAction,
  updateSyncConfigAction,
  syncToBaiduAction,
  startAutoSyncAction,
  stopAutoSyncAction,
  loadSyncConfigAction,
} from '@/actions/storage';
import * as Helpers from '@/helpers';

const StorageSwitch: React.FC = () => {
  const dispatch = useDispatch();
  const { 
    type: storageType, 
    storage, 
    profile, 
    token, 
    migrating, 
    migrateProgress,
    syncing,
    syncProgress,
    syncConfig,
  } = useSelector((state: StoreState) => ({
    type: state.storage.type,
    storage: state.storage.storage,
    profile: state.storage.profile,
    token: state.storage.token,
    migrating: state.storage.migrating,
    migrateProgress: state.storage.migrateProgress,
    syncing: state.storage.syncing,
    syncProgress: state.storage.syncProgress,
    syncConfig: state.storage.syncConfig,
  }));
  
  const baiduAccessToken = useSelector((state: StoreState) => state.baidu.accessToken);
  
  const [loading, setLoading] = useState(false);
  const [dbStats, setDbStats] = useState<{ size: number; tables: string[]; files?: string[] } | null>(null);
  const [checking, setChecking] = useState(false);

  // 加载同步配置
  useEffect(() => {
    dispatch(loadSyncConfigAction());
  }, []);
  
  // 当切换到本地存储且启用同步时，启动自动同步
  useEffect(() => {
    if (storageType === 'local' && syncConfig.enabled && baiduAccessToken) {
      dispatch(startAutoSyncAction());
    } else {
      dispatch(stopAutoSyncAction());
    }
  }, [storageType, syncConfig.enabled, baiduAccessToken]);

  // 当切换到本地存储时获取统计信息
  useEffect(() => {
    if ((storageType === 'sqlite' || storageType === 'local') && storage) {
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

  const handleSwitchStorage = async (newType: 'github' | 'sqlite' | 'local') => {
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
      message.success(`已切换到 ${newType === 'github' ? 'GitHub' : '本地文件'} 存储`);
    } catch (error) {
      message.error('切换存储类型失败');
      console.error(error);
    }
    setLoading(false);
  };

  const handleMigrate = async () => {
    if (!token || !profile) {
      message.warning('请先连接 GitHub 账号才能迁移数据');
      return;
    }

    Modal.confirm({
      title: '确认迁移数据',
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <p>此操作将从 GitHub 同步所有数据到本地存储，并替换本地存储中的现有数据。</p>
          <p>迁移完成后，存储类型将自动切换为本地文件存储。</p>
          <p style={{ color: '#ff4d4f' }}>注意：本地存储中的现有数据将被覆盖！</p>
        </div>
      ),
      okText: '确认迁移',
      cancelText: '取消',
      onOk: async () => {
        try {
          await dispatch(migrateFromGithubToLocalAction());
          message.success('数据迁移成功！已切换到本地文件存储');
        } catch (error: any) {
          message.error('数据迁移失败: ' + error.message);
        }
      },
    });
  };

  const handleSyncToBaidu = async () => {
    if (!baiduAccessToken) {
      message.warning('请先登录百度账号');
      return;
    }
    
    try {
      await dispatch(syncToBaiduAction());
      message.success('同步到百度云盘成功');
    } catch (error: any) {
      message.error('同步失败: ' + error.message);
    }
  };

  const handleAutoSyncChange = (enabled: boolean) => {
    dispatch(updateSyncConfigAction({ enabled }));
    
    if (enabled) {
      if (!baiduAccessToken) {
        message.warning('请先登录百度账号才能启用自动同步');
        dispatch(updateSyncConfigAction({ enabled: false }));
        return;
      }
      message.success('自动同步已启用');
    } else {
      message.info('自动同步已关闭');
    }
  };

  const handleIntervalChange = (interval: number | null) => {
    if (interval && interval >= 1) {
      dispatch(updateSyncConfigAction({ interval: interval * 60 * 1000 }));
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 是否显示迁移按钮（已登录 GitHub 且当前是本地存储）
  const canMigrate = token && profile;
  
  // 是否显示同步按钮（当前是本地存储）
  const isLocalStorage = storageType === 'local' || storageType === 'sqlite';

  return (
    <Card 
      title="数据存储方式" 
      bordered={false}
      style={{ marginBottom: 16 }}
    >
      <Radio.Group 
        value={storageType} 
        onChange={(e) => handleSwitchStorage(e.target.value)}
        disabled={loading || migrating}
        style={{ marginBottom: 16 }}
      >
        <Radio.Button value="github" style={{ padding: '0 16px' }}>
          <CloudOutlined /> GitHub 存储
        </Radio.Button>
        <Radio.Button value="local" style={{ padding: '0 16px' }}>
          <FolderOutlined /> 本地文件存储
        </Radio.Button>
      </Radio.Group>

      {/* 数据迁移按钮 */}
      {canMigrate && (
        <Button
          type="primary"
          icon={<ImportOutlined />}
          onClick={handleMigrate}
          loading={migrating}
          disabled={loading}
          style={{ marginLeft: 16 }}
        >
          从 GitHub 迁移数据
        </Button>
      )}

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

      {isLocalStorage && (
        <>
          <Alert
            message="本地文件存储"
            description="数据以 JSON 文件形式存储在本地，无需网络连接即可访问。数据不会同步到云端。文件位于用户数据目录的 storage 文件夹中。"
            type="success"
            showIcon
            style={{ marginTop: 16, marginBottom: 16 }}
          />
          
          {/* 百度云盘同步设置 */}
          <Divider>百度云盘同步</Divider>
          
          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8 }}>
              <Switch
                checked={syncConfig.enabled}
                onChange={handleAutoSyncChange}
                disabled={!baiduAccessToken}
              />
              <span style={{ marginLeft: 8 }}>启用自动同步到百度云盘</span>
            </div>
            
            {syncConfig.enabled && (
              <div style={{ marginTop: 8, marginLeft: 48 }}>
                <span>同步间隔：</span>
                <InputNumber
                  min={1}
                  max={60}
                  value={Math.floor(syncConfig.interval / 60000)}
                  onChange={handleIntervalChange}
                  style={{ width: 80, marginRight: 8 }}
                />
                <span>分钟</span>
              </div>
            )}
            
            {!baiduAccessToken && (
              <Alert
                message="请先登录百度账号以启用同步功能"
                type="warning"
                showIcon
                style={{ marginTop: 8 }}
              />
            )}
            
            {syncConfig.lastSyncTime && (
              <div style={{ marginTop: 8, color: '#888' }}>
                上次同步时间: {new Date(syncConfig.lastSyncTime).toLocaleString()}
              </div>
            )}
          </div>
          
          <Button
            icon={<CloudUploadOutlined />}
            onClick={handleSyncToBaidu}
            loading={syncing}
            disabled={!baiduAccessToken}
          >
            立即同步到百度云盘
          </Button>
          
          {syncing && (
            <Alert
              message={syncProgress || '正在同步...'}
              type="info"
              showIcon
              style={{ marginTop: 8 }}
            />
          )}
          
          <Divider />
          
          {dbStats && (
            <Descriptions 
              title="存储信息" 
              bordered 
              size="small"
              column={1}
            >
              <Descriptions.Item label="存储目录大小">
                {formatFileSize(dbStats.size)}
              </Descriptions.Item>
              <Descriptions.Item label="数据文件">
                {dbStats.files ? dbStats.files.map(file => (
                  <Tag key={file} color="blue">{file}</Tag>
                )) : dbStats.tables.map(table => (
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

      {migrating && (
        <Alert
          message={migrateProgress || '正在迁移数据...'}
          type="info"
          showIcon
          style={{ marginTop: 16 }}
        />
      )}
    </Card>
  );
};

export default StorageSwitch;
