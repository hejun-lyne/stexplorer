/**
 * Webpack config for backtest worker in development.
 *
 * 开发环境下主进程由 ts-node 直接运行 .ts，但 worker_threads 只接受 .js 入口，
 * 且 worker 的依赖链里包含纯 ESM 包（trading-signals），无法被 CommonJS require，
 * 因此单独把 worker 打成 JS 包，供主进程在开发环境加载。
 */

import path from 'path';
import { merge } from 'webpack-merge';
import baseConfig from './webpack.config.base';
import webpackPaths from './webpack.paths';

export default merge(baseConfig, {
  mode: 'development',

  devtool: 'source-map',

  target: 'electron-main',

  entry: {
    'backtest.worker': path.join(webpackPaths.srcMainPath, 'backtest.worker.ts'),
  },

  output: {
    path: path.join(webpackPaths.buildPath, 'dev'),
    filename: '[name].js',
  },

  node: {
    __dirname: false,
    __filename: false,
  },
});
