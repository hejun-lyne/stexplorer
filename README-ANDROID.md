# STExplorer Android 配置指南

本项目已配置支持在 Android 系统上运行。

## 技术方案

使用 **Capacitor** 将现有的 React Web 应用打包为 Android App：
- 保留现有的 React + TypeScript + Ant Design 代码
- 通过 WebView 渲染 Web 内容
- 使用 Capacitor 插件访问原生功能（文件系统、分享等）
- Electron 代码通过 Mock 层在 Web 环境运行

## 快速开始

### 1. 环境准备

- **Node.js** 16+ 
- **Android Studio** (下载: https://developer.android.com/studio)
- **JDK 11 或更高版本**
- **Android SDK** (通过 Android Studio 安装)

### 2. 安装依赖

```bash
yarn install
```

### 3. 初始化 Android 项目

```bash
# 构建 Web 版本
yarn build:web

# 添加 Android 平台
npx cap add android

# 同步 Web 代码到 Android
npx cap sync
```

### 4. 运行

```bash
# 打开 Android Studio
npx cap open android
```

在 Android Studio 中：
1. 连接 Android 设备或启动模拟器
2. 点击 **Run** 按钮 (▶️)

或者直接运行：
```bash
npx cap run android
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `yarn build:web` | 构建 Web 版本 |
| `yarn build:web:dev` | 开发模式启动 Web 服务器 |
| `yarn android:build` | 构建并同步到 Android |
| `yarn android:sync` | 同步代码到 Android |
| `yarn android:open` | 打开 Android Studio |
| `npx cap run android` | 直接运行到设备 |

## 项目结构

```
project/
├── android/                    # Android 原生项目（自动生成）
├── src/
│   ├── renderer/              # React 渲染进程代码
│   │   ├── utils/
│   │   │   └── platform.ts    # 平台检测工具
│   │   └── styles/
│   │       └── mobile.scss    # 移动端样式
│   └── main/                  # Electron 主进程代码
├── .erb/
│   ├── configs/
│   │   └── webpack.config.web.babel.js  # Web 构建配置
│   └── mocks/
│       └── electron-mock.js   # Electron API Mock
├── capacitor.config.ts        # Capacitor 配置
└── dist/                      # Web 构建输出（Capacitor 读取）
```

## 平台检测

使用 `src/renderer/utils/platform.ts` 中的工具检测运行环境：

```typescript
import { isElectron, isCapacitor, isAndroid, isMobile } from '@/utils/platform';

if (isElectron()) {
  // 在 Electron 中运行
}

if (isCapacitor()) {
  // 在 Capacitor (Android/iOS) 中运行
}

if (isAndroid()) {
  // 在 Android 设备上
}

if (isMobile()) {
  // 在移动设备上（包括手机浏览器）
}
```

## 原生功能适配

### 文件系统

```typescript
import { getFileSystemAPI } from '@/utils/platform';

const fs = await getFileSystemAPI();
if (fs) {
  // Capacitor Filesystem API
  await fs.writeFile({
    path: 'data.json',
    data: JSON.stringify(data),
    directory: fs.Directory.Documents,
  });
}
```

### 分享功能

```typescript
import { shareContent } from '@/utils/platform';

await shareContent({
  title: '股票分析',
  text: '查看这只股票',
  url: 'https://example.com',
});
```

### 状态栏控制

```typescript
import { StatusBar } from '@capacitor/status-bar';

// 设置状态栏颜色
await StatusBar.setBackgroundColor({ color: '#1890ff' });

// 设置状态栏样式
await StatusBar.setStyle({ style: Style.Light });
```

## Electron API 替代方案

| Electron API | Web/Capacitor 替代 |
|--------------|-------------------|
| `ipcRenderer` | 使用 Capacitor Plugins 或 React Context |
| `shell.openExternal` | `window.open()` 或 Capacitor Browser |
| `clipboard` | Navigator Clipboard API |
| `dialog` | 原生 `<input type="file">` 或 Capacitor FilePicker |
| `fs` | Capacitor Filesystem API |

## 注意事项

### 1. 安全策略

Capacitor 使用 `https://localhost` 加载本地内容，比 Electron 的 `file://` 协议更安全。

### 2. CORS

Capacitor 的 WebView 对 CORS 的处理与浏览器一致，确保后端 API 支持跨域。

### 3. 存储

- 使用 `@capacitor/preferences` 替代 `localStorage`（更可靠）
- 使用 `@capacitor/filesystem` 替代 Node.js `fs`

### 4. 样式适配

- 使用 `src/renderer/styles/mobile.scss` 中的移动端样式
- 针对触摸设备优化按钮大小（最小 44x44px）
- 处理安全区域（刘海屏、手势导航条）

### 5. 性能

- 开启代码分割和懒加载
- 图片使用适当尺寸
- 避免频繁的 DOM 操作

## 调试

### Android Studio 调试

1. 连接设备并开启 USB 调试
2. 在 Android Studio 中使用 **Logcat** 查看日志
3. 在 Chrome 中访问 `chrome://inspect` 调试 WebView

### 热更新开发

```bash
# 启动开发服务器
yarn build:web:dev

# 在 capacitor.config.ts 中设置服务器地址
# 然后在 Android Studio 中运行
```

## 发布

### 生成 APK

在 Android Studio 中：
1. Build → Generate Signed Bundle/APK
2. 选择 APK
3. 配置签名密钥
4. 选择 release 版本

### 生成 AAB (Google Play)

1. Build → Generate Signed Bundle/APK
2. 选择 Android App Bundle
3. 配置签名密钥

## 常见问题

### 1. WebView 白屏

检查 `dist` 目录是否正确生成，运行 `npx cap sync` 重新同步。

### 2. 原生插件不工作

确保在 Android 中正确导入并注册插件：
```java
// MainActivity.java
import com.capacitorjs.plugins.filesystem.FilesystemPlugin;
```

### 3. 样式问题

添加 viewport meta 标签（已在 index.ejs 中）：
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
```

## 相关文档

- [Capacitor 文档](https://capacitorjs.com/docs)
- [Capacitor Plugins](https://capacitorjs.com/docs/plugins)
- [Android Studio 下载](https://developer.android.com/studio)
