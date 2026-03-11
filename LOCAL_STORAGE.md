# 本地文件存储方案

本文档介绍了 STExplorer 的本地文件存储功能，作为 GitHub 存储的替代方案。

## 功能概述

STExplorer 支持三种数据存储方式：

1. **GitHub 存储**（原有）：数据存储在 GitHub 仓库中，支持跨设备同步
2. **SQLite 本地存储**（已弃用）：数据存储在本地 SQLite 数据库中（现在使用本地文件存储实现）
3. **本地文件存储**（当前）：数据以 JSON 文件形式存储在本地，无需网络连接，无需编译原生模块

## 使用方法

### 切换存储方式

1. 打开应用设置（点击左侧栏的设置按钮）
2. 在"数据存储方式"部分，选择你想要的存储类型：
   - **GitHub 存储**：需要连接 GitHub 账号，数据会同步到 GitHub 仓库
   - **本地存储**：数据保存在本地 JSON 文件中，无需网络连接

### 首次使用本地存储

1. 在设置中选择"本地存储"
2. 系统会自动创建本地存储目录和 JSON 文件
3. 存储位置：
   - macOS: `~/Library/Application Support/STExplorer/storage/`
   - Windows: `%APPDATA%/STExplorer/storage/`
   - Linux: `~/.config/STExplorer/storage/`

### 文件结构

本地存储目录结构：

```
storage/
├── settings.json          # 应用设置
├── star_sites.json        # 收藏的网站
├── stock_settings.json    # 股票设置
├── tradings.json          # 交易记录
├── trainings.json         # 训练记录
├── ktrainings.json        # K线训练记录
├── books.json             # 笔记本列表
├── strategy_groups.json   # 策略组
├── notes/                 # 笔记内容目录
│   ├── 1_note1.json
│   └── 2_note2.json
└── strategies/            # 策略内容目录
    └── 1_1.json
```

### 数据迁移

目前两种存储方式是独立的，切换后数据不会自动同步。你可以：
- 继续使用 GitHub 存储来保持现有数据
- 或者手动导出导入数据（后续版本会支持自动迁移）

## 技术实现

### 文件结构

```
src/
├── main/
│   └── localFileStorage.ts  # 主进程本地文件存储服务
├── renderer/
│   ├── services/
│   │   ├── storage.ts       # 统一存储接口
│   │   ├── localStorage.ts  # 本地文件存储实现
│   │   └── storageTypes.ts  # 存储类型定义
│   ├── helpers/
│   │   └── storage.ts       # 存储帮助函数
│   ├── actions/
│   │   └── storage.ts       # 存储相关 actions
│   └── reducers/
│       └── storage.ts       # 存储 reducer
```

### 数据文件格式

每个 JSON 文件包含以下结构：

```json
{
  "lastModified": "2024-01-01T00:00:00.000Z",
  "data": { ... }
}
```

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

### 主进程文件操作

```typescript
import { initLocalFileStorage, readLocalData, writeLocalData } from '@/main/localFileStorage';

// 初始化存储
initLocalFileStorage();

// 读取数据
const result = readLocalData('settings');

// 写入数据
writeLocalData('settings', data, lastModified);
```

### 渲染进程存储操作

```typescript
import { Storage } from '@/services/storage';
import ThingsStorage from '@/services/things';

// 使用本地文件存储
const storage = new Storage('local');
await storage.init();

// 使用 ThingsStorage
const thingsStorage = new ThingsStorage(storage);
const settings = await thingsStorage.ReadRemoteSetting();
```

## 与 SQLite 的区别

| 特性 | SQLite 存储 | 本地文件存储 |
|------|-------------|--------------|
| 依赖 | better-sqlite3（原生模块）| 无（纯 Node.js fs API）|
| 编译 | 需要重新编译原生模块 | 无需编译 |
| 性能 | 适合大量数据查询 | 适合配置类数据读写 |
| 调试 | 需要数据库工具查看 | 可直接查看 JSON 文件 |
| 备份 | 复制单个文件 | 复制整个目录 |

## 注意事项

1. **数据隔离**：GitHub 存储和本地存储的数据是独立的，切换后需要重新配置
2. **备份建议**：使用本地存储时，建议定期备份整个 storage 目录
3. **兼容性**：本地存储不支持跨设备同步
4. **性能**：本地存储使用 JSON 文件，适合中小规模数据
5. **迁移**：从 SQLite 切换到本地文件存储时，原有数据需要手动迁移

## 常见问题

### Q: 切换存储方式后数据会丢失吗？
A: 不会丢失，但两种存储的数据是独立的。切换后看到的是对应存储方式的数据。

### Q: 可以同时使用两种存储吗？
A: 同一时间只能使用一种存储方式，但可以随时切换。

### Q: 本地存储文件可以备份吗？
A: 可以，直接复制整个 storage 目录即可。

### Q: 如何从 GitHub 迁移到本地存储？
A: 目前需要手动导出导入。建议先使用设置中的备份功能导出配置，然后切换到本地存储后再导入。

### Q: 为什么弃用 SQLite？
A: SQLite 依赖 better-sqlite3 原生模块，在不同 Node.js/Electron 版本间需要重新编译，容易导致兼容性问题。本地文件存储使用纯 Node.js API，更加稳定可靠。
