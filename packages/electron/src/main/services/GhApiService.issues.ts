import { createHash } from 'node:crypto';
import log from 'electron-log/main';
import type {
  GithubIssueCommentRow,
  GithubIssueEventRow,
  GithubIssueRow,
  GithubIssuesStore,
} from './GithubIssuesStore';
import {
  assertGithubIssueNumber,
  assertGithubIssueState,
  assertGithubWritableIssueState,
  assertGithubRemote,
  assertWorkspacePath,
  buildApiArgs,
  normalizeGithubSince,
  parsePagedJson,
  type GithubIssueState,
} from './ghApiHelpers';

const DEFAULT_PAGE_SIZE = 100;
const LIST_CACHE_SECONDS = 60;
const DETAIL_CACHE_SECONDS = 30;
export const MAX_INITIAL_ISSUE_PAGES = 10;

const logger = log.scope('GhApiServiceIssues');

export interface GithubIssueListOptions {
  state?: GithubIssueState;
  since?: string;
  perPage?: number;
}

interface GhIssuePayload {
  id: number;
  number: number;
  title: string;
  body?: string | null;
  state: 'open' | 'closed';
  state_reason?: 'completed' | 'not_planned' | 'reopened' | null;
  html_url?: string;
  pull_request?: unknown;
  user?: { login?: string; avatar_url?: string } | null;
  assignees?: Array<{ login?: string; avatar_url?: string }>;
  labels?: Array<{ name?: string; color?: string; description?: string | null } | string>;
  milestone?: { number?: number; title?: string; state?: 'open' | 'closed' } | null;
  comments?: number;
  locked?: boolean;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
}

interface GhCommentPayload {
  id: number | string;
  body?: string;
  html_url?: string;
  author_association?: string;
  user?: { login?: string; avatar_url?: string } | null;
  created_at: string;
  updated_at: string;
}

interface GhEventPayload {
  id?: number | string;
  node_id?: string;
  event?: string;
  actor?: { login?: string; avatar_url?: string } | null;
  created_at?: string | null;
}

export interface GhIssueApiDependencies {
  request(args: string[], workspacePath: string): Promise<string>;
  store: GithubIssuesStore;
}

export function githubIssueCacheId(workspacePath: string, remote: string, number: number): string {
  const workspaceKey = createHash('sha256').update(workspacePath).digest('hex').slice(0, 16);
  return `issue_${workspaceKey}_${remote.replace(/[^A-Za-z0-9_-]/g, '_')}_${number}`;
}

function rawWithoutBody<T extends { body?: unknown }>(payload: T): Omit<T, 'body'> {
  const { body: _body, ...raw } = payload;
  return raw;
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapIssue(workspacePath: string, remote: string, payload: GhIssuePayload): GithubIssueRow {
  const assignees = (payload.assignees ?? [])
    .filter((assignee): assignee is { login: string; avatar_url?: string } => Boolean(assignee.login))
    .map((assignee) => ({ login: assignee.login, avatarUrl: assignee.avatar_url ?? null }));
  const labels = (payload.labels ?? [])
    .map((label) =>
      typeof label === 'string'
        ? { name: label, color: null, description: null }
        : {
            name: label.name ?? '',
            color: label.color ?? null,
            description: label.description ?? null,
          },
    )
    .filter((label) => label.name.length > 0);
  const milestone =
    payload.milestone &&
    Number.isSafeInteger(payload.milestone.number) &&
    payload.milestone.title &&
    (payload.milestone.state === 'open' || payload.milestone.state === 'closed')
      ? {
          number: payload.milestone.number as number,
          title: payload.milestone.title,
          state: payload.milestone.state,
        }
      : null;
  return {
    id: githubIssueCacheId(workspacePath, remote, payload.number),
    workspacePath,
    remote,
    number: payload.number,
    title: payload.title,
    body: payload.body ?? null,
    state: payload.state,
    stateReason: payload.state_reason ?? null,
    authorLogin: payload.user?.login ?? null,
    authorAvatarUrl: payload.user?.avatar_url ?? null,
    assignees,
    labels,
    commentsCount: payload.comments ?? 0,
    locked: Boolean(payload.locked),
    htmlUrl: payload.html_url ?? `https://github.com/${remote}/issues/${payload.number}`,
    milestone,
    raw: rawWithoutBody(payload),
    createdAt: timestamp(payload.created_at) ?? 0,
    updatedAt: timestamp(payload.updated_at) ?? 0,
    closedAt: timestamp(payload.closed_at),
    fetchedAt: Date.now(),
  };
}

function mapComment(issue: string, payload: GhCommentPayload): GithubIssueCommentRow {
  return {
    issueId: issue,
    id: String(payload.id),
    authorLogin: payload.user?.login ?? null,
    authorAvatarUrl: payload.user?.avatar_url ?? null,
    authorAssociation: payload.author_association ?? null,
    body: payload.body ?? '',
    htmlUrl: payload.html_url ?? null,
    raw: rawWithoutBody(payload),
    createdAt: timestamp(payload.created_at) ?? 0,
    updatedAt: timestamp(payload.updated_at) ?? 0,
    fetchedAt: Date.now(),
  };
}

function validateListOptions(options: GithubIssueListOptions): {
  state: GithubIssueState;
  since?: string;
  perPage: number;
} {
  const state = options.state ?? 'open';
  assertGithubIssueState(state);
  const perPage = options.perPage ?? DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100) {
    throw new Error(`Invalid GitHub issues perPage: ${String(perPage)}`);
  }
  return { state, since: normalizeGithubSince(options.since), perPage };
}

export function createGhIssueApi(dependencies: GhIssueApiDependencies) {
  const validate = (workspacePath: string, remote: string, number?: number): void => {
    assertWorkspacePath(workspacePath);
    assertGithubRemote(remote);
    if (number !== undefined) assertGithubIssueNumber(number);
  };

  return {
    async listIssues(
      workspacePath: string,
      remote: string,
      options: GithubIssueListOptions = {},
    ): Promise<GithubIssueRow[]> {
      validate(workspacePath, remote);
      const { state, since, perPage } = validateListOptions(options);
      const payloads: GhIssuePayload[] = [];
      for (let page = 1; ; page += 1) {
        const params = new URLSearchParams({
          state,
          sort: 'updated',
          direction: 'desc',
          per_page: String(perPage),
          page: String(page),
        });
        if (since) params.set('since', since);
        const stdout = await dependencies.request(
          buildApiArgs(`repos/${remote}/issues?${params.toString()}`, {
            cacheSeconds: LIST_CACHE_SECONDS,
          }),
          workspacePath,
        );
        const pagePayloads = JSON.parse(stdout.trim() || '[]') as GhIssuePayload[];
        if (!Array.isArray(pagePayloads)) {
          throw new Error('GitHub issues list returned a non-array payload');
        }
        payloads.push(...pagePayloads.filter((payload) => !payload.pull_request));
        if (pagePayloads.length < perPage) break;
        if (!since && page >= MAX_INITIAL_ISSUE_PAGES) {
          logger.warn('Initial GitHub issue poll truncated', {
            workspacePath,
            remote,
            pageLimit: MAX_INITIAL_ISSUE_PAGES,
            perPage,
          });
          break;
        }
      }
      const rows = payloads.map((payload) => mapIssue(workspacePath, remote, payload));
      await dependencies.store.upsertList(rows);
      return rows;
    },

    async getIssue(workspacePath: string, remote: string, number: number): Promise<GithubIssueRow> {
      validate(workspacePath, remote, number);
      const stdout = await dependencies.request(
        buildApiArgs(`repos/${remote}/issues/${number}`, { cacheSeconds: DETAIL_CACHE_SECONDS }),
        workspacePath,
      );
      const payload = JSON.parse(stdout.trim() || 'null') as GhIssuePayload | null;
      if (!payload || payload.pull_request) {
        throw new Error(`GitHub issue ${remote}#${number} not found`);
      }
      const row = mapIssue(workspacePath, remote, payload);
      await dependencies.store.upsertOne(row);
      return row;
    },

    async getIssueComments(
      workspacePath: string,
      remote: string,
      number: number,
    ): Promise<GithubIssueCommentRow[]> {
      validate(workspacePath, remote, number);
      const stdout = await dependencies.request(
        buildApiArgs(`repos/${remote}/issues/${number}/comments?per_page=100`, {
          cacheSeconds: DETAIL_CACHE_SECONDS,
          paginate: true,
        }),
        workspacePath,
      );
      const issue = githubIssueCacheId(workspacePath, remote, number);
      const rows = parsePagedJson<GhCommentPayload>(stdout).map((payload) =>
        mapComment(issue, payload),
      );
      await dependencies.store.replaceComments(issue, rows);
      return rows;
    },

    async getIssueTimeline(
      workspacePath: string,
      remote: string,
      number: number,
    ): Promise<GithubIssueEventRow[]> {
      validate(workspacePath, remote, number);
      const stdout = await dependencies.request(
        buildApiArgs(`repos/${remote}/issues/${number}/timeline?per_page=100`, {
          cacheSeconds: DETAIL_CACHE_SECONDS,
          paginate: true,
        }),
        workspacePath,
      );
      const issue = githubIssueCacheId(workspacePath, remote, number);
      const fetchedAt = Date.now();
      const rows = parsePagedJson<GhEventPayload>(stdout).map((payload, index) => ({
        issueId: issue,
        id: String(payload.id ?? payload.node_id ?? `${payload.event ?? 'event'}:${payload.created_at ?? 'unknown'}:${index}`),
        event: payload.event ?? 'unknown',
        actorLogin: payload.actor?.login ?? null,
        actorAvatarUrl: payload.actor?.avatar_url ?? null,
        raw: payload,
        createdAt: timestamp(payload.created_at) ?? 0,
        fetchedAt,
      }));
      await dependencies.store.replaceEvents(issue, rows);
      return rows;
    },

    async commentOnIssue(
      workspacePath: string,
      remote: string,
      number: number,
      body: string,
    ): Promise<GithubIssueCommentRow> {
      validate(workspacePath, remote, number);
      if (typeof body !== 'string' || body.trim().length === 0) {
        throw new Error('GitHub issue comment body required');
      }
      const stdout = await dependencies.request(
        [
          'api',
          '-X',
          'POST',
          `repos/${remote}/issues/${number}/comments`,
          '-H',
          'Accept: application/vnd.github+json',
          '-H',
          'X-GitHub-Api-Version: 2022-11-28',
          '-f',
          `body=${body.trim()}`,
        ],
        workspacePath,
      );
      const row = mapComment(
        githubIssueCacheId(workspacePath, remote, number),
        JSON.parse(stdout.trim()) as GhCommentPayload,
      );
      await dependencies.store.upsertComment(row);
      return row;
    },

    async setIssueState(
      workspacePath: string,
      remote: string,
      number: number,
      state: 'open' | 'closed',
    ): Promise<GithubIssueRow> {
      validate(workspacePath, remote, number);
      assertGithubWritableIssueState(state);
      const stdout = await dependencies.request(
        [
          'api',
          '-X',
          'PATCH',
          `repos/${remote}/issues/${number}`,
          '-H',
          'Accept: application/vnd.github+json',
          '-H',
          'X-GitHub-Api-Version: 2022-11-28',
          '-f',
          `state=${state}`,
        ],
        workspacePath,
      );
      const row = mapIssue(workspacePath, remote, JSON.parse(stdout.trim()) as GhIssuePayload);
      await dependencies.store.upsertOne(row);
      return row;
    },

    async getPollCursor(workspacePath: string, remote: string): Promise<number | null> {
      validate(workspacePath, remote);
      return dependencies.store.getPollCursor(workspacePath, remote);
    },

    async setPollCursor(workspacePath: string, remote: string, cursor: number): Promise<void> {
      validate(workspacePath, remote);
      if (!Number.isFinite(cursor) || cursor < 0) {
        throw new Error(`Invalid GitHub issue poll cursor: ${String(cursor)}`);
      }
      await dependencies.store.setPollCursor(workspacePath, remote, cursor);
    },
  };
}

export type GhIssueApi = ReturnType<typeof createGhIssueApi>;
