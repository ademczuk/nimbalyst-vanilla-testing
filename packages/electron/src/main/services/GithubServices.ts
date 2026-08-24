/** Shared lazy wiring for the PR and issue handlers. */

import { getDatabase } from '../database/initialize';
import { getEffectiveGhAccount } from '../utils/store';
import { GhApiService } from './GhApiService';
import { createGithubIssuesStore, type GithubIssuesStore } from './GithubIssuesStore';
import {
  getPullRequestPollScheduler,
  initPullRequestPollScheduler,
  type PullRequestPollScheduler,
} from './PullRequestPollScheduler';
import { createPullRequestsStore, type PullRequestsStore } from './PullRequestsStore';

let pullRequestsStore: PullRequestsStore | null = null;
let githubIssuesStore: GithubIssuesStore | null = null;
let apiService: GhApiService | null = null;

function database() {
  const db = getDatabase();
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function getGithubPullRequestsStore(): PullRequestsStore {
  if (!pullRequestsStore) pullRequestsStore = createPullRequestsStore(database());
  return pullRequestsStore;
}

export function getGithubIssuesStore(): GithubIssuesStore {
  if (!githubIssuesStore) githubIssuesStore = createGithubIssuesStore(database());
  return githubIssuesStore;
}

export function getGithubApiService(): GhApiService {
  if (!apiService) {
    apiService = new GhApiService(
      getGithubPullRequestsStore(),
      (workspacePath) => getEffectiveGhAccount(workspacePath),
      getGithubIssuesStore(),
    );
  }
  return apiService;
}

export function getGithubPollScheduler(): PullRequestPollScheduler {
  return initPullRequestPollScheduler(getGithubApiService());
}

export function stopGithubPollScheduler(): void {
  getPullRequestPollScheduler()?.stopAll();
}
