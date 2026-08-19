// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SQLiteDatabase } from '../../database/sqlite/SQLiteDatabase';
import { SessionCommitService, extractCommitSha } from '../SessionCommitService';
import type { AppDatabase } from '../../database/PGLiteDatabaseWorker';

/**
 * Exercises the session_commits ledger against a live better-sqlite3 backend
 * with the real schema dir (including 0031), so the PG-dialect SQL is proven
 * through the actual dialect translator rather than a mock.
 */
describe('SessionCommitService (real SQLite backend)', () => {
  let tmpDir: string;
  let sqlite: SQLiteDatabase;
  let service: SessionCommitService;

  const schemaDir = path.resolve(__dirname, '..', '..', 'database', 'sqlite', 'schemas');

  /** ai_agent_messages has an FK onto ai_sessions, so sessions come first. */
  const seedSession = async (id: string, workspaceId: string, title = `Session ${id}`) => {
    await sqlite.query(
      `INSERT INTO ai_sessions (id, workspace_id, provider, title) VALUES ($1, $2, $3, $4)`,
      [id, workspaceId, 'claude-code', title],
    );
  };

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-session-commits-'));
    sqlite = new SQLiteDatabase({
      dbDir: tmpDir,
      schemaDir,
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await sqlite.initialize();
    service = new SessionCommitService(sqlite as unknown as AppDatabase);
  });

  afterEach(async () => {
    await sqlite.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates session_commits and seeds the backfill cutoff via migration 0031', async () => {
    const handle = sqlite.getRawHandle()!;
    const cols = handle
      .prepare(`PRAGMA table_info(session_commits)`)
      .all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'commit_sha',
        'session_id',
        'workspace_id',
        'attribution',
        'committed_at',
      ]),
    );

    const meta = handle
      .prepare(`SELECT cutoff_at, cursor_at, completed_at FROM session_commit_backfill_meta`)
      .all() as Array<{ cutoff_at: string; cursor_at: string | null; completed_at: string | null }>;
    expect(meta).toHaveLength(1);
    expect(meta[0].cutoff_at).toBeTruthy();
    expect(meta[0].completed_at).toBeNull();
  });

  it('records a commit and reads it back with the joined session title', async () => {
    await seedSession('sess-1', '/repo', 'Fix the thing');
    await service.recordCommit({
      commitSha: 'aaaa111',
      sessionId: 'sess-1',
      workspaceId: '/repo',
      committedAt: new Date('2026-08-01T10:00:00.000Z'),
    });

    const links = await service.getSessionsForCommits(['aaaa111']);
    expect(links['aaaa111']).toMatchObject({
      sessionId: 'sess-1',
      title: 'Fix the thing',
      provider: 'claude-code',
      attribution: 'exact',
    });
    expect(links['aaaa111'].committedAt).toBe(Date.parse('2026-08-01T10:00:00.000Z'));
  });

  it('is idempotent on replay of the same (sha, session)', async () => {
    await seedSession('sess-1', '/repo');
    await service.recordCommit({ commitSha: 'bbbb222', sessionId: 'sess-1' });
    await service.recordCommit({ commitSha: 'bbbb222', sessionId: 'sess-1' });

    const { rows } = await sqlite.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM session_commits WHERE commit_sha = $1`,
      ['bbbb222'],
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it('resolves a worktree-recorded commit browsed from the main checkout', async () => {
    // Regression guard: the read path must key on commit_sha ALONE. Adding
    // `AND workspace_id = $2` back would drop every worktree session, which is
    // the parallel-agent case the feature exists to show.
    await seedSession('sess-wt', '/repo/worktrees/feature-x');
    await service.recordCommit({
      commitSha: 'cccc333',
      sessionId: 'sess-wt',
      workspaceId: '/repo/worktrees/feature-x',
    });

    const links = await service.getSessionsForCommits(['cccc333']);
    expect(links['cccc333']?.sessionId).toBe('sess-wt');
  });

  it('batches a page of shas in one query and tolerates an empty input', async () => {
    await seedSession('sess-1', '/repo');
    await seedSession('sess-2', '/repo');
    await service.recordCommit({ commitSha: 'sha-a', sessionId: 'sess-1' });
    await service.recordCommit({ commitSha: 'sha-b', sessionId: 'sess-2' });

    const links = await service.getSessionsForCommits(['sha-a', 'sha-b', 'sha-missing']);
    expect(Object.keys(links).sort()).toEqual(['sha-a', 'sha-b']);
    expect(links['sha-a'].sessionId).toBe('sess-1');
    expect(links['sha-b'].sessionId).toBe('sess-2');

    await expect(service.getSessionsForCommits([])).resolves.toEqual({});
  });

  it('backfills historical commit payloads, including codex sources, and resumes', async () => {
    await seedSession('sess-old', '/repo');
    await seedSession('sess-codex', '/repo');

    const payload = (hash: string) =>
      JSON.stringify({
        type: 'git_commit_proposal_response',
        proposalId: 'toolu_1',
        action: 'committed',
        commitHash: hash,
        filesCommitted: ['a.ts'],
      });

    const insert = async (sessionId: string, source: string, hash: string, createdAt: string) => {
      await sqlite.query(
        `INSERT INTO ai_agent_messages (session_id, created_at, source, direction, content)
         VALUES ($1, $2, $3, 'output', $4)`,
        [sessionId, createdAt, source, payload(hash)],
      );
    };

    await insert('sess-old', 'nimbalyst', 'old-sha-1', '2026-07-01T10:00:00.000Z');
    await insert('sess-codex', 'openai-codex', 'codex-sha-1', '2026-07-01T09:00:00.000Z');
    // A message with no commit payload must be ignored, not crash the scan.
    await sqlite.query(
      `INSERT INTO ai_agent_messages (session_id, created_at, source, direction, content)
       VALUES ($1, $2, 'nimbalyst', 'output', $3)`,
      ['sess-old', '2026-07-01T08:00:00.000Z', JSON.stringify({ type: 'text', text: 'hello' })],
    );

    const result = await service.backfillFromRawMessages();
    expect(result.complete).toBe(true);

    const links = await service.getSessionsForCommits(['old-sha-1', 'codex-sha-1']);
    expect(links['old-sha-1']?.sessionId).toBe('sess-old');
    expect(links['codex-sha-1']?.sessionId).toBe('sess-codex');

    // A second run short-circuits on completed_at rather than rescanning.
    const second = await service.backfillFromRawMessages();
    expect(second.messagesScanned).toBe(0);

    const { rows } = await sqlite.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM session_commits`,
    );
    expect(Number(rows[0].n)).toBe(2);
  });

  it('resumes an interrupted backfill from the persisted cursor without duplicating rows', async () => {
    await seedSession('sess-1', '/repo');
    const payload = (hash: string) =>
      JSON.stringify({ action: 'committed', commitHash: hash });

    await sqlite.query(
      `INSERT INTO ai_agent_messages (session_id, created_at, source, direction, content)
       VALUES ($1, $2, 'nimbalyst', 'output', $3)`,
      ['sess-1', '2026-07-01T10:00:00.000Z', payload('resume-newer')],
    );
    await sqlite.query(
      `INSERT INTO ai_agent_messages (session_id, created_at, source, direction, content)
       VALUES ($1, $2, 'nimbalyst', 'output', $3)`,
      ['sess-1', '2026-07-01T09:00:00.000Z', payload('resume-older')],
    );

    // Simulate a run that got through the newer row then died: the cursor sits
    // between the two messages and completed_at is still unset.
    await sqlite.query(
      `INSERT INTO session_commits (commit_sha, session_id, attribution, committed_at, created_at)
       VALUES ('resume-newer', 'sess-1', 'exact', $1, $1)`,
      ['2026-07-01T10:00:00.000Z'],
    );
    await sqlite.query(
      `UPDATE session_commit_backfill_meta SET cursor_at = $1 WHERE singleton = 1`,
      ['2026-07-01T10:00:00.000Z'],
    );

    await service.backfillFromRawMessages();

    const links = await service.getSessionsForCommits(['resume-newer', 'resume-older']);
    expect(links['resume-newer']?.sessionId).toBe('sess-1');
    expect(links['resume-older']?.sessionId).toBe('sess-1');

    const { rows } = await sqlite.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM session_commits`,
    );
    expect(Number(rows[0].n)).toBe(2);
  });
});

describe('extractCommitSha', () => {
  it('pulls the hash from a real commit-proposal response payload', () => {
    const content = JSON.stringify({
      type: 'git_commit_proposal_response',
      proposalId: 'toolu_018jxXhtR2z6YQWXWuXnYp37',
      action: 'committed',
      commitHash: 'c9df8cd635000eeb29885b5b6d26a60be1584aff',
      commitDate: '2026-08-07T12:52:06-04:00',
      filesCommitted: ['a.ts'],
    });
    expect(extractCommitSha(content)).toBe('c9df8cd635000eeb29885b5b6d26a60be1584aff');
  });

  it('ignores cancelled proposals and unparseable content', () => {
    expect(
      extractCommitSha(JSON.stringify({ action: 'cancelled', commitHash: 'deadbeef' })),
    ).toBeNull();
    expect(extractCommitSha('not json at all')).toBeNull();
    expect(extractCommitSha('')).toBeNull();
  });

  it('finds a payload nested inside a message envelope', () => {
    const inner = JSON.stringify({ action: 'committed', commitHash: 'abc1234' });
    expect(extractCommitSha(JSON.stringify({ type: 'widget', payload: inner }))).toBe('abc1234');
    expect(
      extractCommitSha(JSON.stringify({ content: [{ action: 'committed', commitHash: 'def5678' }] })),
    ).toBe('def5678');
  });
});
