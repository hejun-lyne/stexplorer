# SQLite 本地存储方案（已弃用）

> **注意**：SQLite 存储方案已弃用，现在使用**本地文件存储**替代。
> 
> 请参阅 [LOCAL_STORAGE.md](./LOCAL_STORAGE.md) 了解新的存储方案。

## 弃用原因

1. **兼容性问题**：better-sqlite3 是原生模块，需要针对不同的 Node.js/Electron 版本重新编译
2. **部署复杂**：在不同平台（macOS、Windows、Linux）上可能遇到编译问题
3. **维护成本**：原生模块的升级和维护成本较高

## 替代方案

新的**本地文件存储**方案具有以下优势：

- ✅ 无原生模块依赖，使用纯 Node.js fs API
- ✅ 无需编译，跨平台兼容性好
- ✅ 数据以 JSON 格式存储，可直接查看和编辑
- ✅ 实现更简单，维护成本更低

## 迁移说明

1. 如果你之前使用 SQLite 存储，数据仍然保留在 `stexplorer.db` 文件中
2. 切换到本地文件存储后，需要重新配置应用数据
3. 建议导出重要数据后手动迁移到新的存储方式

## 技术说明

虽然 SQLite 存储已弃用，但代码中保留了 `sqlite-*` 命名的 IPC 接口以保持向后兼容：

- `sqlite-init` → 初始化本地文件存储
- `sqlite-read` → 读取本地 JSON 文件
- `sqlite-write` → 写入本地 JSON 文件
- `sqlite-delete` → 删除本地 JSON 文件
- `sqlite-stats` → 获取本地存储统计信息
- `sqlite-backup` → 备份本地存储

这些接口内部现在调用本地文件存储的实现。
