# Android 构建指南

## 环境要求

1. **Android Studio** - 下载并安装 https://developer.android.com/studio
2. **JDK 11 或更高版本**
3. **Android SDK** (通过 Android Studio 安装)

## 首次设置

```bash
# 1. 构建 Web 应用
yarn build:web

# 2. 初始化 Android 项目
npx cap add android

# 3. 同步代码到 Android
npx cap sync

# 4. 打开 Android Studio
npx cap open android
```

## 日常开发

```bash
# 构建并同步到 Android
yarn build:web && npx cap sync

# 然后打开 Android Studio 运行
npx cap open android
```

## 直接运行（需要连接设备或模拟器）

```bash
# 构建并运行
yarn build:web && npx cap run android
```

## 注意事项

1. **Electron API 替换** - 项目中使用的 Electron API 需要在 Android 中找到替代方案
2. **文件系统访问** - 使用 Capacitor Filesystem API
3. **网络请求** - Capacitor 会自动处理 CORS
4. **状态栏** - 可以使用 @capacitor/status-bar 插件
