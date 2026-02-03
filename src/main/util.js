"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
exports.base64ToBuffer = exports.checkEnvTool = exports.lockSingleInstance = exports.installExtensions = exports.getAssetPath = exports.resolveHtmlPath = void 0;
var electron_1 = require("electron");
var url_1 = require("url");
var path = require("path");
var electron_log_1 = require("electron-log");
if (process.env.NODE_ENV === 'development') {
    var port_1 = process.env.PORT || 1212;
    exports.resolveHtmlPath = function (htmlFileName) {
        var url = new url_1.URL("http://localhost:".concat(port_1));
        url.pathname = htmlFileName;
        return url.href;
    };
}
else {
    exports.resolveHtmlPath = function (htmlFileName) {
        var fs = require('fs');
        // 尝试多个可能的路径
        var possiblePaths = [
            // 1. 从构建目录运行的标准路径
            path.resolve(__dirname, '../renderer/', htmlFileName),
            // 2. 从源码运行时的路径（项目根目录）
            path.join(electron_1.app.getAppPath(), 'build/app/dist/renderer', htmlFileName),
            // 3. 相对于 cwd 的路径
            path.join(process.cwd(), 'build/app/dist/renderer', htmlFileName),
        ];
        for (var _i = 0, possiblePaths_1 = possiblePaths; _i < possiblePaths_1.length; _i++) {
            var tryPath = possiblePaths_1[_i];
            if (fs.existsSync(tryPath)) {
                return "file://".concat(tryPath);
            }
        }
        // 默认返回第一个路径（即使文件不存在，让 Electron 报告错误）
        return "file://".concat(possiblePaths[0]);
    };
}
function getAssetPath(resourceFilename) {
    var EXTRA_RESOURCES_PATH = electron_1.app.isPackaged ? path.join(process.resourcesPath, 'assets') : path.join(__dirname, '../../assets');
    return path.join(EXTRA_RESOURCES_PATH, resourceFilename);
}
exports.getAssetPath = getAssetPath;
function installExtensions() {
    var installer = require('electron-devtools-installer');
    var forceDownload = !!process.env.UPGRADE_EXTENSIONS;
    var extensions = ['REACT_DEVELOPER_TOOLS', 'REDUX_DEVTOOLS'];
    return Promise.all(extensions.map(function (name) { return installer["default"](installer[name], forceDownload); }))["catch"](console.log);
}
exports.installExtensions = installExtensions;
function lockSingleInstance() {
    var isSingleInstance = electron_1.app.requestSingleInstanceLock();
    if (!isSingleInstance) {
        electron_1.app.quit();
    }
}
exports.lockSingleInstance = lockSingleInstance;
function checkEnvTool() {
    return __awaiter(this, void 0, void 0, function () {
        var sourceMapSupport;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (process.env.NODE_ENV === 'production') {
                        sourceMapSupport = require('source-map-support');
                        Object.assign(console, electron_log_1["default"].functions);
                        sourceMapSupport.install();
                    }
                    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true') {
                        require('electron-debug')();
                    }
                    if (!(process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true')) return [3 /*break*/, 2];
                    return [4 /*yield*/, installExtensions()];
                case 1:
                    _a.sent();
                    _a.label = 2;
                case 2: return [2 /*return*/];
            }
        });
    });
}
exports.checkEnvTool = checkEnvTool;
function base64ToBuffer(dataUrl) {
    var data = dataUrl.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    var imageBuffer = Buffer.from(data[2], 'base64');
    return imageBuffer;
}
exports.base64ToBuffer = base64ToBuffer;
