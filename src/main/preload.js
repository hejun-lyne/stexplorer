"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
var electron_1 = require("electron");
var got_1 = require("got");
var js_base64_1 = require("js-base64");
var fs = require("fs");
var util_1 = require("./util");
var package_json_1 = require("../../build/app/package.json");
var FormData = require('form-data');
var CryptoJS = require('crypto-js');
var fss = require('fs-slice');
var electron_log_1 = require("electron-log");
Object.assign(console, electron_log_1["default"].functions);
console.log('will run preload');
electron_1.contextBridge.exposeInMainWorld('contextModules', {
    got: function (url, config) {
        if (config === void 0) { config = {}; }
        return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
            return [2 /*return*/, (0, got_1["default"])(url, __assign(__assign({}, config), { retry: 3, timeout: 6000 }))];
        }); });
    },
    process: {
        production: process.env.NODE_ENV === 'production',
        electron: process.versions.electron,
        version: process.env.VERSION || package_json_1.version
    },
    electron: {
        shell: {
            openExternal: electron_1.shell.openExternal
        },
        ipcRenderer: {
            invoke: electron_1.ipcRenderer.invoke,
            on: function (channel, func) {
                var validChannels = [
                    'nativeTheme-updated',
                    'clipboard-funds-copy',
                    'clipboard-funds-import',
                    'backup-all-config-export',
                    'backup-all-config-import',
                    'update-available',
                    'change-current-wallet-code',
                    'add-note',
                    'add-stock',
                    'close-current-tab',
                    'message-to-worker',
                    'message-from-worker',
                    'on-console-log',
                    'on-progress-log',
                ];
                if (validChannels.includes(channel)) {
                    return electron_1.ipcRenderer.on(channel, func);
                }
                else {
                    return null;
                }
            },
            off: function (channel, func) {
                return electron_1.ipcRenderer.removeListener(channel, func);
            },
            offAll: function (channel) {
                return electron_1.ipcRenderer.removeAllListeners(channel);
            }
        },
        dialog: {
            showMessageBox: function (config) { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                return [2 /*return*/, electron_1.ipcRenderer.invoke('show-message-box', config)];
            }); }); },
            showSaveDialog: function (config) { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                return [2 /*return*/, electron_1.ipcRenderer.invoke('show-save-dialog', config)];
            }); }); },
            showOpenDialog: function (config) { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                return [2 /*return*/, electron_1.ipcRenderer.invoke('show-open-dialog', config)];
            }); }); }
        },
        invoke: {
            showCurrentWindow: function () { return electron_1.ipcRenderer.invoke('show-current-window'); },
            getShouldUseDarkColors: function () { return electron_1.ipcRenderer.invoke('get-should-use-dark-colors'); },
            setNativeThemeSource: function (config) { return electron_1.ipcRenderer.invoke('set-native-theme-source', config); }
        },
        app: {
            setLoginItemSettings: function (config) { return electron_1.ipcRenderer.invoke('set-login-item-settings', config); },
            quit: function () { return electron_1.ipcRenderer.invoke('app-quit'); }
        },
        clipboard: {
            readText: electron_1.clipboard.readText,
            writeText: electron_1.clipboard.writeText,
            writeImage: function (dataUrl) { return electron_1.clipboard.writeImage(electron_1.nativeImage.createFromDataURL(dataUrl)); }
        },
        saveImage: function (filePath, dataUrl) {
            var imageBuffer = (0, util_1.base64ToBuffer)(dataUrl);
            fs.writeFileSync(filePath, imageBuffer);
        },
        saveString: function (fileName, content) { return __awaiter(void 0, void 0, void 0, function () {
            var filePath;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, electron_1.ipcRenderer.invoke('save-string-silently', { fileName: fileName, content: content })];
                    case 1:
                        filePath = _a.sent();
                        return [2 /*return*/, filePath];
                }
            });
        }); },
        encodeFF: function (content) {
            var ffprotocol = 'ff://'; // FF协议
            return "".concat(ffprotocol).concat((0, js_base64_1.encode)(JSON.stringify(content)));
        },
        decodeFF: function (content) {
            var ffprotocol = 'ff://'; // FF协议
            try {
                var protocolLength = ffprotocol.length;
                var protocol = content.slice(0, protocolLength);
                if (protocol !== ffprotocol) {
                    throw Error('协议错误');
                }
                var body = content.slice(protocolLength);
                return JSON.parse((0, js_base64_1.decode)(body));
            }
            catch (error) {
                console.log('解码失败', error);
                return null;
            }
        },
        readFile: function (path) {
            return fs.readFileSync(path, 'utf-8');
        },
        uploadBaiduFile: function (content, dir, fileName, accessToken) {
            return __awaiter(this, void 0, void 0, function () {
                function uploadFileStep1(params) {
                    return __awaiter(this, void 0, void 0, function () {
                        var url, data, body, res1;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    console.log('uploadFileStep1: ' + JSON.stringify(params));
                                    url = "http://pan.baidu.com/rest/2.0/xpan/file?method=precreate&access_token=".concat(params.accessToken);
                                    data = "path=".concat(params.remotePath, "&size=").concat(params.fileSize, "&isdir=0&autoinit=1&rtype=0&block_list=[\"").concat(params.hash, "\"]");
                                    return [4 /*yield*/, (0, got_1["default"])(url, {
                                            method: 'POST',
                                            body: data
                                        })];
                                case 1:
                                    body = (_a.sent()).body;
                                    res1 = JSON.parse(body);
                                    return [2 /*return*/, __assign(__assign({}, params), { res1: res1 })];
                            }
                        });
                    });
                }
                function uploadFileStep2(params) {
                    return __awaiter(this, void 0, void 0, function () {
                        var url, formData, body, res2;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    console.log('uploadFileStep2: ' + JSON.stringify(params));
                                    url = "https://d.pcs.baidu.com/rest/2.0/pcs/superfile2?access_token=".concat(params.accessToken, "&method=upload&type=tmpfile&path=").concat(params.remotePath, "&uploadid=").concat(params.res1.uploadid, "=&partseq=0");
                                    formData = new FormData();
                                    formData.append('access_token', params.accessToken);
                                    formData.append('file', fs.createReadStream(params.filePath));
                                    return [4 /*yield*/, got_1["default"].post(url, {
                                            body: formData
                                        })];
                                case 1:
                                    body = (_a.sent()).body;
                                    res2 = JSON.parse(body);
                                    return [2 /*return*/, __assign(__assign({}, params), { res2: res2 })];
                            }
                        });
                    });
                }
                function uploadFileStep3(params) {
                    return __awaiter(this, void 0, void 0, function () {
                        var url, data, body, res3;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    console.log('uploadFileStep3: ' + JSON.stringify(params));
                                    url = "https://pan.baidu.com/rest/2.0/xpan/file?method=create&access_token=".concat(params.accessToken);
                                    data = "path=".concat(params.remotePath, "&size=").concat(params.fileSize, "&isdir=0&uploadid=").concat(params.res1.uploadid, "&block_list=[\"").concat(params.res2.md5, "\"]");
                                    return [4 /*yield*/, (0, got_1["default"])(url, {
                                            method: 'POST',
                                            body: data
                                        })];
                                case 1:
                                    body = (_a.sent()).body;
                                    res3 = JSON.parse(body);
                                    return [2 /*return*/, __assign(__assign({}, params), { res3: res3 })];
                            }
                        });
                    });
                }
                var filePath, stats, fileSize, files, remotePath, hash, res, error_1;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, electron_1.ipcRenderer.invoke('save-tmpstring-silently', { fileName: fileName, content: content })];
                        case 1:
                            filePath = _a.sent();
                            stats = fs.statSync(filePath);
                            fileSize = stats.size;
                            if (fileSize > 4 * 1024 * 1024) {
                                files = fss(filePath).avgSliceAsFile({ blockSize: 4 * 1024 * 1024 });
                            }
                            remotePath = encodeURI("".concat(dir, "/").concat(fileName));
                            hash = CryptoJS.MD5(content).toString();
                            _a.label = 2;
                        case 2:
                            _a.trys.push([2, 6, , 7]);
                            return [4 /*yield*/, uploadFileStep1({ filePath: filePath, fileSize: fileSize, fileName: fileName, remotePath: remotePath, hash: hash, accessToken: accessToken })];
                        case 3:
                            res = _a.sent();
                            console.log('step1: ' + JSON.stringify(res));
                            if (!res.res1 || res.res1.errno != 0) {
                                console.log('创建预上传任务失败');
                            }
                            return [4 /*yield*/, uploadFileStep2(res)];
                        case 4:
                            res = _a.sent();
                            console.log('step2: ' + JSON.stringify(res));
                            if (!res.res2 || !res.res2.md5) {
                                console.log('执行上传过程失败');
                            }
                            return [4 /*yield*/, uploadFileStep3(res)];
                        case 5:
                            res = _a.sent();
                            console.log('step3: ' + JSON.stringify(res));
                            if (!res.res3 || res.res3.errno != 0) {
                                console.log('创建文件记录失败');
                            }
                            return [2 /*return*/, res];
                        case 6:
                            error_1 = _a.sent();
                            console.log(error_1);
                            return [3 /*break*/, 7];
                        case 7: return [2 /*return*/];
                    }
                });
            });
        },
        execPyScript: function (fileName, params) {
            return __awaiter(this, void 0, void 0, function () {
                var result;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, electron_1.ipcRenderer.invoke('run-python-script', { fileName: fileName, params: params })];
                        case 1:
                            result = _a.sent();
                            return [2 /*return*/, result];
                    }
                });
            });
        },
        compileTS: function (source) {
            return __awaiter(this, void 0, void 0, function () {
                var result;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, electron_1.ipcRenderer.invoke('compile-ts-source', { source: source })];
                        case 1:
                            result = _a.sent();
                            return [2 /*return*/, result];
                    }
                });
            });
        },
        makeWorkerExec: function (method, args) {
            return __awaiter(this, void 0, void 0, function () {
                return __generator(this, function (_a) {
                    return [2 /*return*/, electron_1.ipcRenderer.invoke('message-to-worker', { method: method, args: args })];
                });
            });
        }
    }
});
