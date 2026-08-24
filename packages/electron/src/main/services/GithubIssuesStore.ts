/**
 * Write-through cache for GitHub issues, comments, and timeline events.
 *
 * Every table stores the normalized domain payload in one `data` JSON column.
 * PGLite returns that column as an object while SQLite returns text, so every
 * read defensively parses the whole column before reconstructing the row.
 */

import log from 'electron-log/main';
import { toMillis } from '../utils/timestampUtils';

const logger = log.scope('GithubIssuesStore');

export interface GithubIssueUser {
  login: string;
  avatarUrl: string | null;
}

export interface GithubIssueLabel {
  name: string;
  color: string | null;
  description: string | null;
}

export interface GithubIssueMilestone {
  number: number;
  title: string;
  state: 'open' | 'closed';
}

export interface GithubIssueRow {
  id: string;
  workspacePath: string;
  remote: string;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  stateReason: 'completed' | 'not_planned' | 'reopened' | null;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  assignees: GithubIssueUser[];
  labels: GithubIssueLabel[];
  commentsCount: number;
  locked: boolean;
  htmlUrl: string;
  milestone: GithubIssueMilestone | null;
  raw: unknown;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  fetchedAt: number;
}

export interface GithubIssueCommentRow {
  issueId: string;
  id: string;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  authorAssociation: string | null;
  body: string;
  htmlUrl: string | null;
  raw: unknown;
  createdAt: number;
  updatedAt: number;
  fetchedAt: number;
}

export interface GithubIssueEventRow {
  issueId: string;
  id: string;
  event: string;
  actorLogin: string | null;
  actorAvatarUrl: string | null;
  raw: unknown;
  createdAt: number;
  fetchedAt: number;
}

export interface GithubIssueListFilters {
  state?: 'open' | 'closed' | 'all';
  authorLogin?: string;
  assigneeLogin?: string;
  label?: string;
  search?: string;
}

interface IssueDbRow {
  id: string;
  workspace_id: string;
  remote: string;
  number: number;
  state: string;
  data: unknown;
  created_at: Date | string | number;
  updated_at: Date | string | number;
  fetched_at: Date | string | number;
}

interface CommentDbRow {
  issue_id: string;
  id: string;
  data: unknown;
  created_at: Date | string | number;
  updated_at: Date | string | number;
  fetched_at: Date | string | number;
}

interface EventDbRow {
  issue_id: string;
  id: string;
  event: string;
  data: unknown;
  created_at: Date | string | number;
  fetched_at: Date | string | number;
}

type DatabaseLike = {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  runTransaction(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void>;
};

type EnsureReady = () => Promise<void>;

const WRITE_BATCH_SIZE = 100;

interface SqlStatement {
  sql: string;
  params: unknown[];
}

function chunks<T>(rows: T[]): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < rows.length; offset += WRITE_BATCH_SIZE) {
    result.push(rows.slice(offset, offset + WRITE_BATCH_SIZE));
  }
  return result;
}

function placeholders(rowCount: number, columnCount: number): string {
  let parameter = 1;
  return Array.from({ length: rowCount }, () =>
    `(${Array.from({ length: columnCount }, () => `$${parameter++}`).join(', ')})`,
  ).join(', ');
}

function parseData<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      logger.warn('Failed to parse GitHub issue cache JSON', { error });
      return fallback;
    }
  }
  return value as T;
}

type IssueData = Omit<
  GithubIssueRow,
  'id' | 'workspacePath' | 'remote' | 'number' | 'state' | 'createdAt' | 'updatedAt' | 'fetchedAt'
>;
type CommentData = Omit<
  GithubIssueCommentRow,
  'issueId' | 'id' | 'createdAt' | 'updatedAt' | 'fetchedAt'
>;
type EventData = Omit<GithubIssueEventRow, 'issueId' | 'id' | 'event' | 'createdAt' | 'fetchedAt'>;

function issueData(row: GithubIssueRow): IssueData {
  const {
    id: _id,
    workspacePath: _workspacePath,
    remote: _remote,
    number: _number,
    state: _state,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    fetchedAt: _fetchedAt,
    ...data
  } = row;
  return data;
}

function issueUpsertStatement(rows: GithubIssueRow[]): SqlStatement {
  const params = rows.flatMap((row) => [
    row.id,
    row.workspacePath,
    row.remote,
    row.number,
    row.state,
    JSON.stringify(issueData(row)),
    new Date(row.createdAt),
    new Date(row.updatedAt),
    new Date(row.fetchedAt),
  ]);
  return {
    sql: `INSERT INTO github_issues (
      id, workspace_id, remote, number, state, data, created_at, updated_at, fetched_at
    ) VALUES ${placeholders(rows.length, 9)}
    ON CONFLICT (workspace_id, remote, number) DO UPDATE SET
      id = EXCLUDED.id,
      state = EXCLUDED.state,
      data = EXCLUDED.data,
      created_at = EXCLUDED.created_at,
      updated_at = EXCLUDED.updated_at,
      fetched_at = EXCLUDED.fetched_at`,
    params,
  };
}

function commentUpsertStatement(comments: GithubIssueCommentRow[]): SqlStatement {
  const params = comments.flatMap((comment) => {
    const {
      issueId: _issueId,
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      fetchedAt: _fetchedAt,
      ...data
    } = comment;
    return [
      comment.issueId,
      comment.id,
      JSON.stringify(data),
      new Date(comment.createdAt),
      new Date(comment.updatedAt),
      new Date(comment.fetchedAt),
    ];
  });
  return {
    sql: `INSERT INTO github_issue_comments (
      issue_id, id, data, created_at, updated_at, fetched_at
    ) VALUES ${placeholders(comments.length, 6)}
    ON CONFLICT (issue_id, id) DO UPDATE SET
      data = EXCLUDED.data,
      created_at = EXCLUDED.created_at,
      updated_at = EXCLUDED.updated_at,
      fetched_at = EXCLUDED.fetched_at`,
    params,
  };
}

function eventUpsertStatement(events: GithubIssueEventRow[]): SqlStatement {
  const params = events.flatMap((event) => {
    const {
      issueId: _issueId,
      id: _id,
      event: _event,
      createdAt: _createdAt,
      fetchedAt: _fetchedAt,
      ...data
    } = event;
    return [
      event.issueId,
      event.id,
      event.event,
      JSON.stringify(data),
      new Date(event.createdAt),
      new Date(event.fetchedAt),
    ];
  });
  return {
    sql: `INSERT INTO github_issue_events (
      issue_id, id, event, data, created_at, fetched_at
    ) VALUES ${placeholders(events.length, 6)}
    ON CONFLICT (issue_id, id) DO UPDATE SET
      event = EXCLUDED.event,
      data = EXCLUDED.data,
      created_at = EXCLUDED.created_at,
      fetched_at = EXCLUDED.fetched_at`,
    params,
  };
}

function rowToIssue(row: IssueDbRow): GithubIssueRow {
  const data = parseData<IssueData>(row.data, {
    title: '',
    body: null,
    stateReason: null,
    authorLogin: null,
    authorAvatarUrl: null,
    assignees: [],
    labels: [],
    commentsCount: 0,
    locked: false,
    htmlUrl: '',
    milestone: null,
    raw: null,
    closedAt: null,
  });
  return {
    id: row.id,
    workspacePath: row.workspace_id,
    remote: row.remote,
    number: row.number,
    state: row.state as GithubIssueRow['state'],
    ...data,
    createdAt: toMillis(row.created_at) ?? 0,
    updatedAt: toMillis(row.updated_at) ?? 0,
    fetchedAt: toMillis(row.fetched_at) ?? 0,
  };
}

function rowToComment(row: CommentDbRow): GithubIssueCommentRow {
  const data = parseData<CommentData>(row.data, {
    authorLogin: null,
    authorAvatarUrl: null,
    authorAssociation: null,
    body: '',
    htmlUrl: null,
    raw: null,
  });
  return {
    issueId: row.issue_id,
    id: row.id,
    ...data,
    createdAt: toMillis(row.created_at) ?? 0,
    updatedAt: toMillis(row.updated_at) ?? 0,
    fetchedAt: toMillis(row.fetched_at) ?? 0,
  };
}

function rowToEvent(row: EventDbRow): GithubIssueEventRow {
  const data = parseData<EventData>(row.data, {
    actorLogin: null,
    actorAvatarUrl: null,
    raw: null,
  });
  return {
    issueId: row.issue_id,
    id: row.id,
    event: row.event,
    ...data,
    createdAt: toMillis(row.created_at) ?? 0,
    fetchedAt: toMillis(row.fetched_at) ?? 0,
  };
}

export function createGithubIssuesStore(db: DatabaseLike, ensureDbReady?: EnsureReady) {
  const ready = async (): Promise<void> => {
    if (ensureDbReady) await ensureDbReady();
  };

  return {
    async upsertOne(row: GithubIssueRow): Promise<void> {
      await ready();
      const statement = issueUpsertStatement([row]);
      await db.query(statement.sql, statement.params);
    },

    async upsertList(rows: GithubIssueRow[]): Promise<void> {
      await ready();
      for (const batch of chunks(rows)) {
        const statement = issueUpsertStatement(batch);
        await db.query(statement.sql, statement.params);
      }
    },

    async list(
      workspacePath: string,
      remote: string,
      filters: GithubIssueListFilters = {},
    ): Promise<GithubIssueRow[]> {
      await ready();
      const values: unknown[] = [workspacePath, remote];
      let stateClause = '';
      if (filters.state && filters.state !== 'all') {
        values.push(filters.state);
        stateClause = ` AND state = $${values.length}`;
      }
      const { rows } = await db.query<IssueDbRow>(
        `SELECT * FROM github_issues
         WHERE workspace_id = $1 AND remote = $2${stateClause}
         ORDER BY updated_at DESC`,
        values,
      );
      let issues = rows.map(rowToIssue);
      if (filters.authorLogin) {
        issues = issues.filter((issue) => issue.authorLogin === filters.authorLogin);
      }
      if (filters.assigneeLogin) {
        issues = issues.filter((issue) =>
          issue.assignees.some((assignee) => assignee.login === filters.assigneeLogin),
        );
      }
      if (filters.label) {
        issues = issues.filter((issue) => issue.labels.some((label) => label.name === filters.label));
      }
      if (filters.search) {
        const needle = filters.search.toLowerCase();
        issues = issues.filter(
          (issue) =>
            issue.title.toLowerCase().includes(needle) || String(issue.number).includes(needle),
        );
      }
      return issues;
    },

    async getByNumber(
      workspacePath: string,
      remote: string,
      number: number,
    ): Promise<GithubIssueRow | null> {
      await ready();
      const { rows } = await db.query<IssueDbRow>(
        `SELECT * FROM github_issues
         WHERE workspace_id = $1 AND remote = $2 AND number = $3
         LIMIT 1`,
        [workspacePath, remote, number],
      );
      return rows.length > 0 ? rowToIssue(rows[0]) : null;
    },

    async upsertComment(comment: GithubIssueCommentRow): Promise<void> {
      await ready();
      const statement = commentUpsertStatement([comment]);
      await db.query(statement.sql, statement.params);
    },

    async replaceComments(issueId: string, comments: GithubIssueCommentRow[]): Promise<void> {
      await ready();
      const statements: SqlStatement[] = [
        { sql: 'DELETE FROM github_issue_comments WHERE issue_id = $1', params: [issueId] },
        ...chunks(comments).map(commentUpsertStatement),
      ];
      await db.runTransaction(statements);
    },

    async getComments(issueId: string): Promise<GithubIssueCommentRow[]> {
      await ready();
      const { rows } = await db.query<CommentDbRow>(
        `SELECT * FROM github_issue_comments WHERE issue_id = $1 ORDER BY created_at ASC`,
        [issueId],
      );
      return rows.map(rowToComment);
    },

    async replaceEvents(issueId: string, events: GithubIssueEventRow[]): Promise<void> {
      await ready();
      const seen = new Set<string>();
      const uniqueEvents = events.filter((event) => {
        if (seen.has(event.id)) return false;
        seen.add(event.id);
        return true;
      });
      const statements: SqlStatement[] = [
        { sql: 'DELETE FROM github_issue_events WHERE issue_id = $1', params: [issueId] },
        ...chunks(uniqueEvents).map(eventUpsertStatement),
      ];
      await db.runTransaction(statements);
    },

    async getEvents(issueId: string): Promise<GithubIssueEventRow[]> {
      await ready();
      const { rows } = await db.query<EventDbRow>(
        `SELECT * FROM github_issue_events WHERE issue_id = $1 ORDER BY created_at ASC`,
        [issueId],
      );
      return rows.map(rowToEvent);
    },

    async getPollCursor(workspacePath: string, remote: string): Promise<number | null> {
      await ready();
      const { rows } = await db.query<{ last_successful_poll_at: Date | string | number }>(
        `SELECT last_successful_poll_at
         FROM github_issue_poll_state
         WHERE workspace_id = $1 AND remote = $2
         LIMIT 1`,
        [workspacePath, remote],
      );
      return rows.length > 0 ? (toMillis(rows[0].last_successful_poll_at) ?? null) : null;
    },

    async setPollCursor(workspacePath: string, remote: string, cursor: number): Promise<void> {
      await ready();
      await db.query(
        `INSERT INTO github_issue_poll_state (workspace_id, remote, last_successful_poll_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, remote) DO UPDATE SET
           last_successful_poll_at = EXCLUDED.last_successful_poll_at`,
        [workspacePath, remote, new Date(cursor)],
      );
    },
  };
}

export type GithubIssuesStore = ReturnType<typeof createGithubIssuesStore>;
