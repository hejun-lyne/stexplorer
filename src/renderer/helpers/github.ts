import * as Utils from '@/utils';
import * as CONST from '@/constants';
import ThingsStorage from '@/services/things';
import { Storage } from '@/services/storage';
import GitHubApi from '@/services/github';

export function GetGithubToken() {
  return Utils.GetStorage(CONST.STORAGE.GITHUB_TOKEN, null);
}

export function SaveGithubToken(token: string) {
  Utils.SetStorage(CONST.STORAGE.GITHUB_TOKEN, token);
}

export function GetGithubProfile() {
  const profile: GitHubSpace.Profile | null = Utils.GetStorage(CONST.STORAGE.GITHUB_PROFILE, null);
  return profile;
}

export function SaveGithubProfile(profile: GitHubSpace.Profile) {
  Utils.SetStorage(CONST.STORAGE.GITHUB_PROFILE, profile);
}

export function ClearGithub() {
  Utils.ClearStorage(CONST.STORAGE.GITHUB_TOKEN);
  Utils.ClearStorage(CONST.STORAGE.GITHUB_PROFILE);
}

export function InitStorage() {
  const token: string | null = Utils.GetStorage(CONST.STORAGE.GITHUB_TOKEN, null);
  if (!token) {
    return null;
  }
  const profile: GitHubSpace.Profile | null = Utils.GetStorage(CONST.STORAGE.GITHUB_PROFILE, null);
  if (!profile) {
    return null;
  }
  const githubApi = new GitHubApi({
    token,
    owner: (profile as GitHubSpace.Profile).name,
  });
  const st = new Storage(githubApi);
  const s = new ThingsStorage(st);

  return s;
}
