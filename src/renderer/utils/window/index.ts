// 检测是否在 Electron 环境
const isElectron = () => {
  return typeof window !== 'undefined' && 
    (window as any).process?.type === 'renderer';
};

// 只在 Electron 环境中加载
if (isElectron()) {
  require('./jsonpgz');
  require('./parsezindex');
  require('./contextModules');
}
