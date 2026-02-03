// Patch unzip-crx-3 to handle corrupted CRX files gracefully
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
  const module = originalRequire.apply(this, arguments);
  
  // Intercept unzip-crx-3 to wrap errors
  if (id === 'unzip-crx-3' || id.includes('unzip-crx-3')) {
    return function crxToZipPatched(crxPath) {
      try {
        return module.apply(this, arguments);
      } catch (error) {
        console.warn('Skipping corrupted CRX file:', crxPath, error.message);
        return Promise.resolve(null);
      }
    };
  }
  
  return module;
};

module.exports = {};
