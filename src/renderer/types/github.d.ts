declare namespace GitHubSpace {
  export interface Profile {
    id: number;
    avatarUrl: string;
    htmlUrl: string;
    name: string;
    email: string;
  }
  export interface Reposity {
    id: number;
    name: string;
    fullName: string;
    private: boolean;
    htmlUrl: string;
    description: string;
    url: string;
  }
  export interface FileRes {
    name: string;
    path: string;
    size: number;
    content?: string;
    sha: string;
    downloadUrl: string;
  }
}
