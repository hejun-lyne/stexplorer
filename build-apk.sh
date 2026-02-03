#!/bin/bash
# Android APK 构建脚本

set -e

echo "🚀 STExplorer Android APK 构建脚本"
echo "====================================="
echo ""

# 检查环境
if ! command -v java &> /dev/null; then
    echo "❌ 错误: 未找到 Java，请先安装 JDK 11 或更高版本"
    echo "   下载地址: https://adoptium.net/"
    exit 1
fi

if [ -z "$ANDROID_SDK_ROOT" ] && [ -z "$ANDROID_HOME" ]; then
    echo "❌ 错误: 未找到 Android SDK"
    echo "   请安装 Android Studio: https://developer.android.com/studio"
    echo "   或设置 ANDROID_SDK_ROOT 环境变量"
    exit 1
fi

echo "✅ 环境检查通过"
echo ""

# 构建 Web
echo "📦 步骤 1/4: 构建 Web 应用..."
yarn build:web
cp dist/full.html dist/index.html
echo "✅ Web 构建完成"
echo ""

# 同步到 Android
echo "📱 步骤 2/4: 同步到 Android 项目..."
npx cap sync
echo "✅ 同步完成"
echo ""

# 构建 APK
echo "🔨 步骤 3/4: 构建 APK..."
cd android

# 使用 Gradle 构建
if [ -f "./gradlew" ]; then
    ./gradlew assembleDebug
else
    echo "⚠️ 未找到 gradlew，尝试使用系统 Gradle..."
    gradle assembleDebug
fi

echo "✅ APK 构建完成"
echo ""

# 输出路径
echo "📤 步骤 4/4: 输出 APK 路径..."
APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_PATH" ]; then
    echo "✅ APK 文件已生成:"
    echo "   $(pwd)/$APK_PATH"
    echo ""
    ls -lh "$APK_PATH"
else
    echo "⚠️ 未找到 APK 文件，可能构建失败"
fi

cd ..
echo ""
echo "🎉 完成！"
