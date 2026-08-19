/**
 * Session Commit Service
 *
 * Persists and reads the `session_commits` ledger: which AI session produced a
 * given git commit. Backs the Session column in the Git extension's Git Log
 * panel.
 *
 * Read-path invariant: lookups key on `commit_sha` ALONE. A session running in
 * a worktree records `workspace_id = …/worktrees/feature-x` while the user
 * browses the log from the main checkout — adding `AND workspace_id = $2` here
 * would silently drop every worktree session, which is exactly the
 * parallel-agent case this feature exists to show. SHAs are content-addressed
 * and globally unique; workspace_id is informational only.
 *
 * SQL is written in PostgreSQL dialect only ($1..$N, NOW(), = ANY). The
 * dialect translator rewrites it for better-sqlite3.
 */

import { database, type AppDatabase } from '../database/PGLiteDatabaseWorker';
import { toMillis } from '../utils/timestampUtils';
import { logger } from '../utils/logger';

/** Attribution tier. Only 'exact' is written in v1. */
export type CommitAttribution = 'exact' | 'inferred';

export interface RecordCommitInput {
  commitSha: string;
  sessionId: string;
  workspaceId?: string | null;
  committedAt?: Date;
  attribution?: CommitAttribution;
}

export interface SessionCommitLink {
  sessionId: string;
  title: string | null;
  provider: string | null;
  attribution: CommitAttribution;
  committedAt: number | null;
}

type BackfillResult = { rowsRecorded: number; messagesScanned: number; complete: boolean };

/** Rows read per backfill chunk from the ~2M-row message log. */
const BACKFILL_CHUNK_SIZE = 2000;

/**
 * Marker present in every commit-proposal response payload. Used as the
 * coarse SQL prefilter before JSON parsing. Deliberately not narrowed by
 * `source`: a meaningful share of these payloads come from codex providers.
 */
const COMMITTED_MARKER = '"action":"committed"';

export class SessionCommitService {
  private static instance: SessionCommitService | null = null;
  private backfillPromise: Promise<BackfillResult> | null = null;

  /** Injectable for tests; defaults to the shared backend-selecting facade. */
  constructor(private db: AppDatabase = database) {}

  public static getInstance(): SessionCommitService {
    if (!this.instance) this.instance = new SessionCommitService();
    return this.instance;
  }

  /**
   * Record that `sessionId` produced `commitSha`. Idempotent — replaying the
   * same commit (widget response round-trip after the IPC already recorded it)
   * is a no-op rather than an error.
   */
  async recordCommit(input: RecordCommitInput): Promise<void> {
    const commitSha = input.commitSha?.trim();
    const sessionId = input.sessionId?.trim();
    if (!commitSha || !sessionId) return;

    try {
      await this.db.runTransaction([
        {
          sql: `INSERT INTO session_commits
                  (commit_sha, session_id, workspace_id, attribution, committed_at, created_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (commit_sha, session_id) DO NOTHING`,
          params: [
            commitSha,
            sessionId,
            input.workspaceId ?? null,
            input.attribution ?? 'exact',
            input.committedAt ?? new Date(),
          ],
        },
      ]);
    } catch (error) {
      // Provenance is a nice-to-have; never fail a commit over the ledger.
      logger.main.warn(
        `[SessionCommitService] Failed to record commit ${commitSha.slice(0, 9)}:`,
        error,
      );
    }
  }

  /**
   * Batch lookup for a page of the git log. One call per page, never per row.
   * Returns a map keyed by the sha exactly as it was passed in.
   */
  async getSessionsForCommits(shas: readonly string[]): Promise<Record<string, SessionCommitLink>> {
    const unique = [...new Set(shas.map((s) => s?.trim()).filter((s): s is string => !!s))];
    if (unique.length === 0) return {};

    const { rows } = await this.db.query<{
      commit_sha: string;
      session_id: string;
      attribution: string;
      committed_at: unknown;
      title: string | null;
      provider: string | null;
    }>(
      `SELECT sc.commit_sha, sc.session_id, sc.attribution, sc.committed_at,
              s.title, s.provider
       FROM session_commits sc
       LEFT JOIN ai_sessions s ON s.id = sc.session_id
       WHERE sc.commit_sha = ANY($1::text[])
       ORDER BY sc.created_at ASC`,
      [unique],
    );

    const links: Record<string, SessionCommitLink> = {};
    for (const row of rows) {
      // First row wins: v1 surfaces one session per commit, and the ledger is
      // ordered oldest-first so the original committer beats later additions.
      if (links[row.commit_sha]) continue;
      links[row.commit_sha] = {
        sessionId: row.session_id,
        title: row.title ?? null,
        provider: row.provider ?? null,
        attribution: row.attribution === 'inferred' ? 'inferred' : 'exact',
        committedAt: toMillis(row.committed_at),
      };
    }
    return links;
  }

  /**
   * Whether the historical backfill has finished. The Git Log panel polls this
   * through the IPC response: on a first-ever open the ledger is still empty
   * while the scan runs, and without this the Session column would stay blank
   * until something else changed the visible commit list.
   */
  async isBackfillComplete(): Promise<boolean> {
    try {
      const { rows } = await this.db.query<{ completed_at: unknown }>(
        `SELECT completed_at FROM session_commit_backfill_meta WHERE singleton = 1`,
      );
      return rows[0]?.completed_at != null;
    } catch {
      // Treat an unreadable marker as "done" so the panel stops polling rather
      // than retrying forever against a broken table.
      return true;
    }
  }

  /**
   * Retry-safe historical backfill from raw `ai_agent_messages`. Single-flight,
   * chunked newest-first (so the commits at the top of the log resolve first),
   * and resumable via the `cursor_at` marker.
   */
  async backfillFromRawMessages(): Promise<BackfillResult> {
    if (this.backfillPromise) return this.backfillPromise;
    this.backfillPromise = this.runHistoricalBackfill();
    try {
      return await this.backfillPromise;
    } finally {
      this.backfillPromise = null;
    }
  }

  private async runHistoricalBackfill(): Promise<BackfillResult> {
    const { rows: metaRows } = await this.db.query<{
      cutoff_at: unknown;
      cursor_at: unknown;
      completed_at: unknown;
    }>(
      `SELECT cutoff_at, cursor_at, completed_at
       FROM session_commit_backfill_meta WHERE singleton = 1`,
    );
    const meta = metaRows[0];
    if (!meta) throw new Error('Session commit backfill cutoff is unavailable');
    if (meta.completed_at != null) {
      return { rowsRecorded: 0, messagesScanned: 0, complete: true };
    }

    // Resume from where an interrupted run left off; otherwise start at the
    // cutoff so live-recorded commits are never re-scanned.
    let cursor = (meta.cursor_at ?? meta.cutoff_at) as unknown;
    let rowsRecorded = 0;
    let messagesScanned = 0;

    for (;;) {
      // `<=` not `<`: two payloads can share a created_at, and a chunk boundary
      // landing between them would drop one. Re-reading the boundary row is
      // free because the INSERT below is ON CONFLICT DO NOTHING.
      const { rows } = await this.db.query<{
        session_id: string;
        content: string;
        created_at: unknown;
        workspace_id: string | null;
      }>(
        `SELECT m.session_id, m.content, m.created_at, s.workspace_id
         FROM ai_agent_messages m
         LEFT JOIN ai_sessions s ON s.id = m.session_id
         WHERE m.created_at <= $1
           AND m.content LIKE $2
         ORDER BY m.created_at DESC
         LIMIT $3`,
        [cursor, `%${COMMITTED_MARKER}%`, BACKFILL_CHUNK_SIZE],
      );

      if (rows.length === 0) break;
      messagesScanned += rows.length;

      const statements: Array<{ sql: string; params?: unknown[] }> = [];
      for (const row of rows) {
        const commitSha = extractCommitSha(row.content);
        if (!commitSha || !row.session_id) continue;
        statements.push({
          sql: `INSERT INTO session_commits
                  (commit_sha, session_id, workspace_id, attribution, committed_at, created_at)
                VALUES ($1, $2, $3, 'exact', $4, NOW())
                ON CONFLICT (commit_sha, session_id) DO NOTHING`,
          params: [commitSha, row.session_id, row.workspace_id ?? null, row.created_at],
        });
      }

      // Advance the cursor in the same transaction as the rows it covers, so
      // an interruption never skips a chunk.
      const nextCursor = rows[rows.length - 1].created_at;
      statements.push({
        sql: `UPDATE session_commit_backfill_meta SET cursor_at = $1 WHERE singleton = 1`,
        params: [nextCursor],
      });
      await this.db.runTransaction(statements);
      rowsRecorded += statements.length - 1;

      if (rows.length < BACKFILL_CHUNK_SIZE) break;
      // With an inclusive cursor, a chunk made entirely of one timestamp would
      // otherwise repeat forever.
      if (String(nextCursor) === String(cursor)) break;
      cursor = nextCursor;
    }

    await this.db.runTransaction([
      {
        sql: `UPDATE session_commit_backfill_meta SET completed_at = NOW() WHERE singleton = 1`,
      },
    ]);

    // rowsRecorded counts INSERTs attempted, not rows added (ON CONFLICT makes
    // replays no-ops), so report the ledger's real size alongside it.
    const { rows: totals } = await this.db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM session_commits`,
    );
    logger.main.info(
      `[SessionCommitService] backfill complete: ${rowsRecorded} links from ` +
        `${messagesScanned} messages; ledger now holds ${totals[0]?.n ?? 0} rows`,
    );
    return { rowsRecorded, messagesScanned, complete: true };
  }
}

/**
 * Pull the commit hash out of a persisted commit-proposal response payload.
 * Parses rather than regexes the sha so a hash mentioned in unrelated prose
 * can never be mistaken for the committed one.
 */
export function extractCommitSha(content: string): string | null {
  // Cheap reject before the JSON parse. Deliberately matches the bare word,
  // not the full `"action":"committed"` marker: inside an escaped envelope the
  // marker reads `\"action\":\"committed\"` and a stricter guard would skip it.
  if (!content || !content.includes('committed')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  return findCommittedHash(parsed, 0);
}

function findCommittedHash(node: unknown, depth: number): string | null {
  if (depth > 6 || node == null || typeof node !== 'object') return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findCommittedHash(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const obj = node as Record<string, unknown>;
  if (obj.action === 'committed' && typeof obj.commitHash === 'string' && obj.commitHash.trim()) {
    return obj.commitHash.trim();
  }
  for (const value of Object.values(obj)) {
    // Nested JSON is sometimes stored as a string (widget payloads inside a
    // message envelope), so recurse through one level of re-encoding.
    if (typeof value === 'string' && value.includes(COMMITTED_MARKER)) {
      const inner = extractCommitSha(value);
      if (inner) return inner;
    } else if (typeof value === 'object') {
      const found = findCommittedHash(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}
