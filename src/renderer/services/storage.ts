import { encryptObj, decryptObj } from '@/utils/crypto';
import GitHubApi from './github';
// import { dirname, basename } from 'path';
const dirname = (path: string) => ((path.split('\\') || []).pop() || '').split('/').slice(0, -1).join('/');
const basename = (path: string) => ((path.split('\\') || []).pop() || '').split('/').pop();
export class RefError extends Error {
  code: number;

  constructor(code: number, m = 'Error') {
    super(m);
    this.code = code;
  }
}

export class ContentRef {
  encryptKey: string;

  api: GitHubApi;

  path: string;

  reading: boolean;

  writing: boolean;

  writing_Indexs: Record<number, boolean>;

  _cache: { cached: boolean; content: string; sha: string; size: number; download_url: '' };

  constructor(api: GitHubApi, path: string, item: any, options: { encryptKey: string }) {
    this.encryptKey = options.encryptKey;
    this.api = api;
    this.path = path;
    this.reading = false;
    this.writing = false;
    this.writing_Indexs = {};
    this._cache = {
      cached: false,
      content: '',
      sha: item.sha,
      size: item.size,
      download_url: item.download_url,
    };
  }

  _parse(json: string) {
    const obj = JSON.parse(json);
    return decryptObj(obj, this.encryptKey);
  }

  _stringify(obj: any) {
    const enc = encryptObj(obj, this.encryptKey);
    return JSON.stringify(enc, null, ' ');
  }

  async load() {
    if (this.reading) {
      while (this.reading) {
        // 等待直到读取完成
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return this._cache.content;
    }
    this.reading = true;
    let result;
    if (this.path.endsWith('json')) {
      result = await this.api.getContents(this.path, 'application/vnd.github.raw+json');
    } else {
      result = await this.api.getContents(this.path);
    }
 
    const [code, file] = result;
    if (code != 0 || !file) {
      this.reading = false;
      throw new RefError(code);
    }

    let item = file;
    if (Array.isArray(file)) {
      item = file[0];
    }
    if (item.size > 1024 * 1024 || item.content.length == 0) {
      // 超过1M
      item.content = await this.api.getFileContent(item.download_url);
    }
    this._cache.cached = true;
    this._cache.content = this._parse(item.content)!;
    if (item.sha) {
      this._cache.sha = item.sha;
    }
    if (item.size) {
      this._cache.size = item.size;
    }
    if (item.download_url) {
      this._cache.download_url = item.download_url;
    }
    this.reading = false;
    return this._cache.content;
  }

  async save(contentObj: any) {
    if (this.writing) {
      // cancel waiting writing
      const keys = Object.keys(this.writing_Indexs).map((s) => parseInt(s));
      keys.forEach((i) => (this.writing_Indexs[i] = false));
      const curKey = keys.length ? Math.max(...keys) + 1 : 0;
      this.writing_Indexs[curKey] = true;
      while (this.writing && this.writing_Indexs[curKey]) {
        // 等待直到写入完成
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const willContinue = this.writing_Indexs[curKey];
      delete this.writing_Indexs[curKey];
      if (!willContinue) {
        // 无需执行中间的写入操作
        return;
      }
      console.log('will continue writing');
    }

    this.writing = true;
    try {
      const content = this._stringify(contentObj);
      const [code, file] = await this.api.createOrUpdateFile(this.path, content, this._cache.sha);
      if (file) {
        this._cache.sha = file.sha;
        console.log('cache updated: ', this._cache);
        this.writing = false;
        return file;
      } else {
        this.writing = false;
        throw new RefError(code);
      }
    } catch (e) {
      console.log(e);
      return null;
    }
  }
}

export class Storage {
  encryptKey: string;

  api: GitHubApi;

  refs: Record<string, ContentRef>;

  constructor(api: GitHubApi, options: { encryptKey: string } = { encryptKey: 'jimmy' }) {
    this.encryptKey = options.encryptKey;
    this.api = api;
    this.refs = {};
  }

  async ref(path: string, initContent = '{}') {
    const c = this.refs[path];
    if (c && c._cache && c._cache.sha) {
      return this.refs[path];
    }
    let existedItem = await this.existsRef(path);
    if (!existedItem) {
      const [code, file] = await this.api.createOrUpdateFile(path, initContent);
      if (code == 0) {
        existedItem = file;
      }
    }
    this.refs[path] = new ContentRef(this.api, path, existedItem, { encryptKey: this.encryptKey });
    return this.refs[path];
  }

  async existsRef(path: string) {
    const items: {
      type: 'file';
      size: 625;
      name: 'octokit.rb';
      path: 'lib/octokit.rb';
      sha: 'fff6fe3a23bf1c8ea0692b4a883af99bee26fd3b';
      url: 'https://api.github.com/repos/octokit/octokit.rb/contents/lib/octokit.rb';
      git_url: 'https://api.github.com/repos/octokit/octokit.rb/git/blobs/fff6fe3a23bf1c8ea0692b4a883af99bee26fd3b';
      html_url: 'https://github.com/octokit/octokit.rb/blob/master/lib/octokit.rb';
      download_url: 'https://raw.githubusercontent.com/octokit/octokit.rb/master/lib/octokit.rb';
      _links: {
        self: 'https://api.github.com/repos/octokit/octokit.rb/contents/lib/octokit.rb';
        git: 'https://api.github.com/repos/octokit/octokit.rb/git/blobs/fff6fe3a23bf1c8ea0692b4a883af99bee26fd3b';
        html: 'https://github.com/octokit/octokit.rb/blob/master/lib/octokit.rb';
      };
    }[] = await this.api.getContents(dirname(path));
    if (!items) {
      throw new Error(`获取文件夹(${dirname(path)})内容失败`);
    } else {
      const bname = basename(path);
      function findItem(arr: any[]) {
        let item;
        for (let i = 0; i < arr.length; i++) {
          if (Array.isArray(arr[i])) {
            const r: any = findItem(arr[i]);
            if (r) {
              return r;
            }
          } else if (arr[i].name) {
            if (arr[i].name === bname) {
              return arr[i];
            }
          }
        }
        return null;
      }
      return findItem(items);
    }
  }
}
