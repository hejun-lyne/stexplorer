import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jimmy.stexplorer',
  appName: 'STExplorer',
  webDir: 'dist',  // Capacitor 会从这个目录加载 web 内容
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#ffffff',
    },
  },
  // 开发时使用，允许访问本地服务器
  ...(process.env.NODE_ENV === 'development' && {
    server: {
      url: 'http://localhost:1212',
      cleartext: true,
    },
  }),
};

export default config;
