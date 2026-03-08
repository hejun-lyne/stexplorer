# SQLite 本地存储方案

本文档介绍了 STExplorer 新增的 SQLite 本地存储功能，作为 GitHub 存储的替代方案。

## 功能概述

现在 STExplorer 支持两种数据存储方式：

1. **GitHub 存储**（原有）：数据存储在 GitHub 仓库中，支持跨设备同步
2. **SQLite 本地存储**（新增）：数据存储在本地 SQLite 数据库中，无需网络连接

## 使用方法

### 切换存储方式

1. 打开应用设置（点击左侧栏的设置按钮）
2. 在"数据存储方式"部分，选择你想要的存储类型：
   - **GitHub 存储**：需要连接 GitHub 账号，数据会同步到 GitHub 仓库
   - **本地 SQLite 存储**：数据保存在本地，无需网络连接

### 首次使用 SQLite 存储

1. 在设置中选择"本地 SQLite 存储"
2. 系统会自动创建本地数据库文件
3. 数据库文件位置：
   - macOS: `~/Library/Application Support/STExplorer/stexplorer.db`
   - Windows: `%APPDATA%/STExplorer/stexplorer.db`
   - Linux: `~/.config/STExplorer/stexplorer.db`

### 数据迁移

目前两种存储方式是独立的，切换后数据不会自动同步。你可以：
- 继续使用 GitHub 存储来保持现有数据
- 或者手动导出导入数据（后续版本会支持自动迁移）

## 技术实现

### 文件结构

```
src/
├── main/
│   └── database.ts          # 主进程 SQLite 服务
├── renderer/
│   ├── services/
│   │   ├── storage.ts       # 统一存储接口
│   │   ├── sqliteStorage.ts # SQLite 存储实现
│   │   └── storageTypes.ts  # 存储类型定义
│   ├── helpers/
│   │   └── storage.ts       # 存储帮助函数
│   ├── actions/
│   │   └── storage.ts       # 存储相关 actions
│   └── reducers/
│       └── storage.ts       # 存储 reducer
```

### 数据表结构

SQLite 数据库包含以下表：

- `settings` - 应用设置
- `star_sites` - 收藏的网站
- `stock_settings` - 股票设置
- `tradings` - 交易记录
- `trainings` - 训练记录
- `ktrainings` - K线训练记录
- `books` - 笔记本列表
- `notes` - 笔记内容
- `strategy_groups` - 策略组
- `strategies` - 策略内容

### 存储接口

两种存储方式实现了统一的接口：

```typescript
interface ContentRef {
  load(): Promise<any>;
  save(contentObj: any): Promise<any>;
}

class Storage {
  async ref(path: string, initContent?: string): Promise<ContentRef>;
  async init(): Promise<void>;
}
```

## 开发说明

### 安装依赖

```bash
yarn add better-sqlite3
yarn add -D @types/better-sqlite3
```

### 主进程数据库操作

```typescript
import { initDatabase, readData, writeData } from '@/main/database';

// 初始化数据库
initDatabase();

// 读取数据
const result = readData('settings');

// 写入数据
writeData('settings', data, lastModified);
```

### 渲染进程存储操作

```typescript
import { Storage } from '@/services/storage';
import ThingsStorage from '@/services/things';

// 使用 SQLite 存储
const storage = new Storage('sqlite');
await storage.init();

// 使用 ThingsStorage
const thingsStorage = new ThingsStorage(storage);
const settings = await thingsStorage.ReadRemoteSetting();
```

## 注意事项

1. **数据隔离**：GitHub 存储和 SQLite 存储的数据是独立的，切换后需要重新配置
2. **备份建议**：使用 SQLite 存储时，建议定期备份数据库文件
3. **兼容性**：SQLite 存储不支持跨设备同步
4. **性能**：SQLite 存储在本地访问速度更快，适合大量数据的场景

## 常见问题

### Q: 切换存储方式后数据会丢失吗？
A: 不会丢失，但两种存储的数据是独立的。切换后看到的是对应存储方式的数据。

### Q: 可以同时使用两种存储吗？
A: 同一时间只能使用一种存储方式，但可以随时切换。

### Q: SQLite 数据库文件可以备份吗？
A: 可以，直接复制数据库文件即可。数据库文件位于用户数据目录中。

### Q: 如何从 GitHub 迁移到 SQLite？
A: 目前需要手动导出导入。建议先使用设置中的备份功能导出配置，然后切换到 SQLite 存储后再导入。
