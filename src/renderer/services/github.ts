import { Octokit } from 'octokit';
const base64 = require('base-64');
const utf8 = require('utf8');
const encode = (text: string) => base64.encode(utf8.encode(text));
const decode = (encoded: string) => utf8.decode(base64.decode(encoded));
const { got } = window.contextModules;
class GitHubApi {
  octokit: any;

  owner: string;

  repo: string;

  repoDetails: any;

  putting: boolean;

  path_readings: Record<string, boolean>;

  path_caches: Record<string, any>;

  constructor(options: { token: string; owner?: string; repo?: string }) {
    this.octokit = new Octokit({
      auth: options.token,
    });
    this.owner = options.owner || 'hejun-lyne';
    this.repo = options.repo || 'ThingsStore';
    this.putting = false;
    this.path_readings = {};
    this.path_caches = {};
  }

  async getProfile() {
    const profile = await this.octokit.rest.users
      .getAuthenticated()
      .then(({ data }) => {
        return {
          id: data.id,
          avatarUrl: data.avatar_url,
          htmlUrl: data.html_url,
          name: data.login,
          email: data.email,
        } as GitHubSpace.Profile;
      })
      .catch((e) => {
        return null;
      });
    return profile;
  }

  async getRepo(repoName?: string) {
    const repo = await this.octokit.rest.repos
      .get({
        owner: this.owner,
        repo: this.repo,
      })
      .then(({ data }) => {
        return {
          id: data.id,
          name: data.name,
          url: data.url,
          htmlUrl: data.html_url,
          private: data.private,
          description: data.description,
          fullName: data.full_name,
        };
      })
      .catch((e) => {
        return null;
      });
    return repo;
  }

  async createRepo(repoName?: string, description?: string) {
    const repo = await this.octokit.rest.repos
      .createForAuthenticatedUser({
        repo: repoName || this.repo,
      })
      .then(({ data }) => {
        return {
          id: data.id,
          name: data.name,
          url: data.url,
          htmlUrl: data.html_url,
          private: data.private,
          description: data.description,
          fullName: data.full_name,
        };
      })
      .catch((e) => {
        return null;
      });
    return repo;
  }

  async getContents(path: string, mediaType: string = 'application/vnd.github.raw+json') {
    if (this.path_readings[path]) {
      while (this.path_readings[path]) {
        // 等待直到读取完成
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return this.path_caches[path];
    }
    this.path_readings[path] = true;

    if (!this.repoDetails) {
      const repo = await this.getRepo();
      if (!repo) {
        await this.createRepo();
      } else {
        this.repoDetails = repo;
      }
    }
    const content = await this.octokit.request('GET /repos/{owner}/{repo}/contents/{path}?_time=' + new Date().getTime(), 
    // const content = await this.octokit.rest.repos.getContent(
      {
        owner: this.owner,
        repo: this.repo,
        path: path,
        headers: {
          "accept": mediaType
      }
      })
      .then(({ data }) => {
        if (typeof(data) == 'string') {
          // const content = decode(data);
          return [
            0,
            [
              {
                content: data,
              },
            ],
          ];
        }
        if (Array.isArray(data)) {
          const list = (data as Array<any>).map((r) => {
            return {
              name: r.name,
              path: r.path,
              size: r.size,
              sha: r.sha,
              download_url: r.download_url,
            };
          });
          return [0, list];
        } else {
          const content = decode(data.content);
          return [
            0,
            [
              {
                name: data.name,
                path: data.path,
                size: data.size,
                sha: data.sha,
                content,
                download_url: data.download_url,
              },
            ],
          ];
        }
      })
      .catch((e) => {
        return [e.status, null];
      });
    this.path_caches[path] = content;
    this.path_readings[path] = false;
    return content;
  }

  async getFileContent(downloadUrl: string) {
    try {
      const { body } = await got<string>(downloadUrl, {
        headers: {
          'authorization': 'token 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',
        },
      });
      return body;
    } catch (error) {
      console.log(error);
      return "";
    }
  }

  async getBlobContent(sha: string) {
    const content = await this.octokit.rest.git
      .getBlob({
        owner: this.owner,
        repo: this.repo,
        sha,
      })
      .then(({ data }) => {
        const content = decode(data.content);
        return [
          0,
          {
            size: data.size,
            sha: data.sha,
            url: data.url,
            content,
          },
        ];
      })
      .catch((e) => {
        console.error(e.message);
        return [e.status, null];
      });
    return content;
  }

  async createOrUpdateFile(path: string, content: string, sha?: string) {
    console.log('createOrUpdateFile', path, sha);
    while (this.putting) {
      // 等待直到写入完成
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    this.putting = true;
    const file = await this.octokit.rest.repos
      .createOrUpdateFileContents({
        owner: this.owner,
        repo: this.repo,
        path,
        message: '创建或更新文件: ' + path,
        content: encode(content),
        sha,
      })
      .then(({ data }) => {
        return [0, data.content];
      })
      .catch((e) => {
        return [e.status, null];
      });
    this.putting = false;
    return file;
  }
}

export default GitHubApi;
