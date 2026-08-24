// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SQLiteDatabase } from '../../database/sqlite/SQLiteDatabase';
import { githubIssueCacheId } from '../GhApiService.issues';
import {
  createGithubIssuesStore,
  type GithubIssueCommentRow,
  type GithubIssueEventRow,
  type GithubIssueRow,
} from '../GithubIssuesStore';

type JsonBackend = 'pglite' | 'sqlite';

class RoundTripDb {
  private issue: Record<string, unknown> | null = null;
  private comments: Array<Record<string, unknown>> = [];
  private events: Array<Record<string, unknown>> = [];

  constructor(private readonly backend: JsonBackend) {}

  private jsonValue(value: unknown): unknown {
    return this.backend === 'sqlite' ? value : JSON.parse(String(value));
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    if (sql.includes('INSERT INTO github_issues')) {
      this.issue = {
        id: params[0],
        workspace_id: params[1],
        remote: params[2],
        number: params[3],
        state: params[4],
        data: this.jsonValue(params[5]),
        created_at: params[6],
        updated_at: params[7],
        fetched_at: params[8],
      };
      return { rows: [] };
    }
    if (sql.includes('DELETE FROM github_issue_comments')) {
      this.comments = [];
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO github_issue_comments')) {
      this.comments.push({
        issue_id: params[0],
        id: params[1],
        data: this.jsonValue(params[2]),
        created_at: params[3],
        updated_at: params[4],
        fetched_at: params[5],
      });
      return { rows: [] };
    }
    if (sql.includes('DELETE FROM github_issue_events')) {
      this.events = [];
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO github_issue_events')) {
      this.events.push({
        issue_id: params[0],
        id: params[1],
        event: params[2],
        data: this.jsonValue(params[3]),
        created_at: params[4],
        fetched_at: params[5],
      });
      return { rows: [] };
    }
    if (sql.includes('FROM github_issues')) {
      return { rows: (this.issue ? [this.issue] : []) as T[] };
    }
    if (sql.includes('FROM github_issue_comments')) {
      return { rows: this.comments as T[] };
    }
    if (sql.includes('FROM github_issue_events')) {
      return { rows: this.events as T[] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  async runTransaction(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    for (const statement of statements) {
      await this.query(statement.sql, statement.params);
    }
  }
}

const issue: GithubIssueRow = {
  id: 'issue_owner_repo_42',
  workspacePath: '/workspace',
  remote: 'owner/repo',
  number: 42,
  title: 'Nested cache data survives',
  body: 'body',
  state: 'open',
  stateReason: null,
  authorLogin: 'alice',
  authorAvatarUrl: 'https://avatars.example/alice',
  assignees: [{ login: 'bob', avatarUrl: null }],
  labels: [{ name: 'bug', color: 'ff0000', description: 'A bug' }],
  commentsCount: 1,
  locked: false,
  htmlUrl: 'https://github.com/owner/repo/issues/42',
  milestone: { number: 3, title: 'Next', state: 'open' },
  raw: { nested: { value: true } },
  createdAt: Date.parse('2026-08-01T00:00:00Z'),
  updatedAt: Date.parse('2026-08-02T00:00:00Z'),
  closedAt: null,
  fetchedAt: Date.parse('2026-08-03T00:00:00Z'),
};

const comment: GithubIssueCommentRow = {
  issueId: issue.id,
  id: 'comment-1',
  authorLogin: 'carol',
  authorAvatarUrl: null,
  authorAssociation: 'CONTRIBUTOR',
  body: 'hello',
  htmlUrl: 'https://github.com/owner/repo/issues/42#issuecomment-1',
  raw: { reactions: { total_count: 2 } },
  createdAt: Date.parse('2026-08-02T01:00:00Z'),
  updatedAt: Date.parse('2026-08-02T01:30:00Z'),
  fetchedAt: Date.parse('2026-08-03T00:00:00Z'),
};

const event: GithubIssueEventRow = {
  issueId: issue.id,
  id: 'event-1',
  event: 'labeled',
  actorLogin: 'dana',
  actorAvatarUrl: null,
  raw: { label: { name: 'bug', color: 'ff0000' } },
  createdAt: Date.parse('2026-08-02T02:00:00Z'),
  fetchedAt: Date.parse('2026-08-03T00:00:00Z'),
};

describe.each<JsonBackend>(['pglite', 'sqlite'])('GithubIssuesStore %s JSON backend', (backend) => {
  it('round-trips issue, comment, and timeline JSON through the real store mapping', async () => {
    const store = createGithubIssuesStore(new RoundTripDb(backend));

    await store.upsertOne(issue);
    await store.replaceComments(issue.id, [comment]);
    await store.replaceEvents(issue.id, [event]);

    expect(await store.getByNumber('/workspace', 'owner/repo', 42)).toEqual(issue);
    expect(await store.getComments(issue.id)).toEqual([comment]);
    expect(await store.getEvents(issue.id)).toEqual([event]);
  });
});

describe('GithubIssuesStore real SQLite schema', () => {
  it('caches the same remote issue independently in two workspaces', async () => {
    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-issues-store-'));
    const db = new SQLiteDatabase({
      dbDir,
      schemaDir: path.resolve(__dirname, '../../database/sqlite/schemas'),
      sampleRate: 0,
    });

    try {
      await db.initialize();
      const store = createGithubIssuesStore(db);
      const first = {
        ...issue,
        id: githubIssueCacheId('/workspace/a', issue.remote, issue.number),
        workspacePath: '/workspace/a',
      };
      const second = {
        ...issue,
        id: githubIssueCacheId('/workspace/b', issue.remote, issue.number),
        workspacePath: '/workspace/b',
        title: 'Workspace B copy',
      };

      await store.upsertOne(first);
      await store.upsertOne(second);

      await expect(store.getByNumber('/workspace/a', 'owner/repo', 42)).resolves.toMatchObject({
        workspacePath: '/workspace/a',
        title: issue.title,
      });
      await expect(store.getByNumber('/workspace/b', 'owner/repo', 42)).resolves.toMatchObject({
        workspacePath: '/workspace/b',
        title: 'Workspace B copy',
      });
    } finally {
      await db.close();
      fs.rmSync(dbDir, { recursive: true, force: true });
    }
  });

  it('batches issue upserts while persisting every row', async () => {
    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-issues-batch-'));
    const db = new SQLiteDatabase({
      dbDir,
      schemaDir: path.resolve(__dirname, '../../database/sqlite/schemas'),
      sampleRate: 0,
    });

    try {
      await db.initialize();
      const store = createGithubIssuesStore(db);
      const query = vi.spyOn(db, 'query');
      const rows = [1, 2, 3].map((number) => ({
        ...issue,
        id: githubIssueCacheId('/workspace', issue.remote, number),
        number,
      }));

      await store.upsertList(rows);

      const inserts = query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO github_issues'));
      expect(inserts).toHaveLength(1);
      expect(await store.list('/workspace', issue.remote)).toHaveLength(3);
    } finally {
      await db.close();
      fs.rmSync(dbDir, { recursive: true, force: true });
    }
  });

  it('rolls back comment and event replacement when a later batch fails', async () => {
    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-issues-atomic-'));
    const db = new SQLiteDatabase({
      dbDir,
      schemaDir: path.resolve(__dirname, '../../database/sqlite/schemas'),
      sampleRate: 0,
    });

    try {
      await db.initialize();
      const store = createGithubIssuesStore(db);
      const cachedIssue = {
        ...issue,
        id: githubIssueCacheId(issue.workspacePath, issue.remote, issue.number),
      };
      const priorComment = { ...comment, issueId: cachedIssue.id };
      const priorEvent = { ...event, issueId: cachedIssue.id };
      await store.upsertOne(cachedIssue);
      await store.replaceComments(cachedIssue.id, [priorComment]);
      await store.replaceEvents(cachedIssue.id, [priorEvent]);

      const comments = Array.from({ length: 101 }, (_, index) => ({
        ...priorComment,
        id: `replacement-comment-${index}`,
        issueId: index === 100 ? 'missing-issue' : cachedIssue.id,
      }));
      const events = Array.from({ length: 101 }, (_, index) => ({
        ...priorEvent,
        id: `replacement-event-${index}`,
        issueId: index === 100 ? 'missing-issue' : cachedIssue.id,
      }));

      await expect(store.replaceComments(cachedIssue.id, comments)).rejects.toThrow();
      await expect(store.getComments(cachedIssue.id)).resolves.toEqual([priorComment]);
      await expect(store.replaceEvents(cachedIssue.id, events)).rejects.toThrow();
      await expect(store.getEvents(cachedIssue.id)).resolves.toEqual([priorEvent]);
    } finally {
      await db.close();
      fs.rmSync(dbDir, { recursive: true, force: true });
    }
  });
});
