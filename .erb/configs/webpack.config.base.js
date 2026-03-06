/**
 * Base webpack config used across other specific configs
 */

import webpack from 'webpack';
import webpackPaths from './webpack.paths.js';
import { dependencies as externals, version } from '../../build/app/package.json';
// const path = require('path');
// const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
export default {
  externals: [...Object.keys(externals || {})],
  module: {
    rules: [
      {
        test: /\.svg$/,
        use: ['@svgr/webpack'],
      },
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            happyPackMode: true,
          },
        },
      },
    ],
  },

  output: {
    path: webpackPaths.srcPath,
    // https://github.com/webpack/webpack/issues/1114
    library: {
      type: 'umd',
    },
  },

  /**
   * Determine the array of extensions that should be used to resolve modules.
   */

  resolve: {
    extensions: ['.js', '.jsx', '.json', '.ts', '.tsx'],
    modules: [webpackPaths.srcPath, 'node_modules'],
    alias: {
      '@': webpackPaths.srcRendererPath,
    },
    // fallback: {
    //   "fs": false,
    //   assert: require.resolve('assert/'),
    //   crypto: require.resolve('crypto-browserify'),
    //   os: require.resolve('os-browserify/browser'),
    //   path: require.resolve('path-browserify'),
    //   stream: require.resolve('stream-browserify'),
    //   util: require.resolve('util'),
    // },
  },

  plugins: [
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'production',
      VERSION: version,
    }),
    // new MonacoWebpackPlugin({
    //   // available options are documented at https://github.com/Microsoft/monaco-editor-webpack-plugin#options
    //   languages: ["json", "javascript", "typescript"],
    // })
  ],
};
