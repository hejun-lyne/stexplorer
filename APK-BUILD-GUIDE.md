# APK 构建指南

## 方案一：使用 Android Studio（推荐）

### 1. 环境要求
- [Android Studio](https://developer.android.com/studio) (最新版)
- JDK 11 或更高版本

### 2. 构建步骤

```bash
# 1. 构建 Web 版本
yarn build:web

# 2. 创建 index.html 入口
cp dist/full.html dist/index.html

# 3. 同步到 Android 项目
npx cap sync

# 4. 打开 Android Studio
npx cap open android
```

在 Android Studio 中：
1. 等待 Gradle 同步完成
2. 连接 Android 设备或启动模拟器
3. 点击菜单 **Build → Build Bundle(s) / APK(s) → Build APK(s)**
4. APK 将生成在：`android/app/build/outputs/apk/debug/app-debug.apk`

### 3. 安装到设备

```bash
# 使用 ADB 安装
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

## 方案二：命令行构建

### 1. 安装依赖

```bash
# macOS
brew install openjdk@11
brew install android-commandlinetools

# 设置环境变量
export ANDROID_SDK_ROOT=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin
```

### 2. 安装 Android SDK 组件

```bash
sdkmanager "platforms;android-33"
sdkmanager "build-tools;33.0.0"
```

### 3. 运行构建脚本

```bash
./build-apk.sh
```

## 方案三：GitHub Actions 自动构建

创建 `.github/workflows/build-apk.yml`：

```yaml
name: Build Android APK

on:
  push:
    branches: [ main ]
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'yarn'
      
      - name: Install dependencies
        run: yarn install
      
      - name: Build Web
        run: |
          yarn build:web
          cp dist/full.html dist/index.html
      
      - name: Setup Java
        uses: actions/setup-java@v3
        with:
          distribution: 'temurin'
          java-version: '11'
      
      - name: Setup Android SDK
        uses: android-actions/setup-android@v2
      
      - name: Add Android platform
        run: npx cap add android
      
      - name: Sync Capacitor
        run: npx cap sync
      
      - name: Build APK
        run: |
          cd android
          ./gradlew assembleDebug
      
      - name: Upload APK
        uses: actions/upload-artifact@v3
        with:
          name: app-debug
          path: android/app/build/outputs/apk/debug/app-debug.apk
```

## 项目结构

```
android/
├── app/
│   ├── src/
│   │   └── main/
│   │       ├── AndroidManifest.xml
│   │       ├── assets/
│   │       │   └── public/          # Web 应用代码
│   │       │       ├── index.html   # 入口文件
│   │       │       ├── full.html
│   │       │       ├── mini.html
│   │       │       └── ...
│   │       ├── java/
│   │       │   └── com/jimmy/stexplorer/
│   │       │       └── MainActivity.java
│   │       └── res/                 # Android 资源
│   └── build.gradle                 # 应用构建配置
├── build.gradle                     # 项目构建配置
└── settings.gradle
```

## 常见问题

### 1. Gradle 同步失败

**问题**: `Could not find com.android.tools.build:gradle:xxx`

**解决**: 检查 `android/build.gradle` 中的 Gradle 版本，确保与 Android Studio 兼容。

### 2. 找不到 SDK

**问题**: `SDK location not found`

**解决**: 创建 `android/local.properties` 文件：
```properties
sdk.dir=/Users/你的用户名/Library/Android/sdk
```

### 3. Web 资源未更新

**解决**: 每次修改 Web 代码后，重新运行：
```bash
yarn build:web
cp dist/full.html dist/index.html
npx cap sync
```

### 4. 签名 APK（发布版）

生成签名密钥：
```bash
keytool -genkey -v -keystore stexplorer.keystore -alias stexplorer -keyalg RSA -keysize 2048 -validity 10000
```

在 `android/app/build.gradle` 中添加：
```gradle
android {
    signingConfigs {
        release {
            storeFile file("stexplorer.keystore")
            storePassword "你的密码"
            keyAlias "stexplorer"
            keyPassword "你的密码"
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
```

构建发布版：
```bash
cd android
./gradlew assembleRelease
```

## 当前状态

✅ Web 构建完成  
✅ Android 项目初始化完成  
✅ 代码同步完成  
⏳ 等待构建 APK...

Android 项目已准备好，可以通过上述任一方式构建 APK。
