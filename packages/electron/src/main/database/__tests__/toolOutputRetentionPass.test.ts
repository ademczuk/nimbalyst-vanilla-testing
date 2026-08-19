// @vitest-environment node
/**
 * Exercises the retention pass against a real in-memory better-sqlite3
 * database, because the invariants that matter here are about ROW SELECTION --
 * which rows the SQL admits and which it must never touch. A mocked handle
 * would assert the query I wrote rather than the query the database runs.
 */
import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import {
  createToolOutputRetentionWork,
  estimateReclaimableBytes,
} from '../toolOutputRetentionPass';

const NOW = Date.parse('2026-08-19T12:00:00.000Z');
const OLD = '2026-01-01T00:00:00.000Z';
const RECENT = '2026-08-18T00:00:00.000Z';
const BIG = 'stdout line\n'.repeat(4000);

function toolResult(content: string): string {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content }] },
  });
}

function toolUse(fileContent: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id: 'toolu_2', name: 'Write', input: { content: fileContent } }],
    },
  });
}

function makeDb(): SqliteDatabase {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE ai_sessions (id TEXT PRIMARY KEY, status TEXT);
    CREATE TABLE ai_agent_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      source TEXT NOT NULL,
      direction TEXT NOT NULL,
      content TEXT NOT NULL,
      message_kind TEXT
    );
    INSERT INTO ai_sessions (id, status) VALUES ('idle-session', 'idle'), ('live-session', 'running');
  `);
  return db;
}

function insert(
  db: SqliteDatabase,
  row: Partial<{
    session: string;
    createdAt: string;
    source: string;
    direction: string;
    content: string;
    kind: string;
  }>,
): number {
  const info = db
    .prepare(
      `INSERT INTO ai_agent_messages (session_id, created_at, source, direction, content, message_kind)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.session ?? 'idle-session',
      row.createdAt ?? OLD,
      row.source ?? 'claude-code',
      row.direction ?? 'output',
      row.content ?? toolResult(BIG),
      row.kind ?? 'tool',
    );
  return Number(info.lastInsertRowid);
}

/** Drive the chunk loop to completion, as runBackground would. */
function runPass(db: SqliteDatabase, retentionDays = 30) {
  let result: any = null;
  const work = createToolOutputRetentionWork(
    { retentionDays, now: () => NOW },
    (r) => { result = r; },
  );
  for (let i = 0; i < 100; i++) {
    if (work.chunk(db).done) break;
  }
  return result;
}

function contentOf(db: SqliteDatabase, id: number): string {
  return (db.prepare('SELECT content FROM ai_agent_messages WHERE id = ?').get(id) as any).content;
}

describe('tool output retention pass', () => {
  it('tombstones aged tool output and reports the bytes saved', () => {
    const db = makeDb();
    const id = insert(db, {});
    const before = contentOf(db, id).length;

    const result = runPass(db);

    expect(result.rewritten).toBe(1);
    expect(result.bytesSaved).toBeGreaterThan(before / 2);
    expect(contentOf(db, id)).toContain('Output discarded to reclaim disk');
  });

  it('never touches user prompts', () => {
    const db = makeDb();
    const id = insert(db, { direction: 'input', kind: 'user', content: toolResult(BIG) });
    const before = contentOf(db, id);

    runPass(db);

    expect(contentOf(db, id)).toBe(before);
  });

  it('never touches assistant text', () => {
    const db = makeDb();
    const id = insert(db, { kind: 'assistant', content: toolResult(BIG) });
    const before = contentOf(db, id);

    runPass(db);

    expect(contentOf(db, id)).toBe(before);
  });

  it('never touches a tool_use call, however large the file it wrote', () => {
    const db = makeDb();
    const id = insert(db, { content: toolUse('plan line\n'.repeat(8000)) });
    const before = contentOf(db, id);

    runPass(db);

    expect(contentOf(db, id)).toBe(before);
  });

  it('never touches rows newer than the retention window', () => {
    const db = makeDb();
    const id = insert(db, { createdAt: RECENT });
    const before = contentOf(db, id);

    runPass(db);

    expect(contentOf(db, id)).toBe(before);
  });

  it('never touches a session that is still running', () => {
    const db = makeDb();
    const id = insert(db, { session: 'live-session' });
    const before = contentOf(db, id);

    runPass(db);

    expect(contentOf(db, id)).toBe(before);
  });

  it('is idempotent across runs', () => {
    const db = makeDb();
    const id = insert(db, {});

    const first = runPass(db);
    const afterFirst = contentOf(db, id);
    const second = runPass(db);

    expect(first.rewritten).toBe(1);
    expect(second.rewritten).toBe(0);
    expect(contentOf(db, id)).toBe(afterFirst);
  });

  it('bounds every chunk rather than scanning the whole table', () => {
    // The regression this guards is an app hang, not a wrong value: an
    // unbounded scan of this table held the SQLite worker for 35s at a time.
    const db = makeDb();
    for (let i = 0; i < 900; i++) insert(db, {});

    const prepare = vi.spyOn(db, 'prepare');
    runPass(db);

    const selects = prepare.mock.calls
      .map((c) => String(c[0]))
      .filter((sql) => sql.includes('FROM ai_agent_messages'));
    expect(selects.length).toBeGreaterThan(0);
    for (const sql of selects) expect(sql).toContain('LIMIT');
  });

  it('estimates from a bounded sample without reading every row', () => {
    const db = makeDb();
    for (let i = 0; i < 50; i++) insert(db, {});

    const est = estimateReclaimableBytes(db, 30, NOW);

    expect(est.candidateRows).toBe(50);
    expect(est.estimatedBytesSaved).toBeGreaterThan(0);
    expect(est.sampledRows).toBeLessThanOrEqual(2000);
  });

  it('counts every candidate row rather than saturating at a cost guard', () => {
    // Regression: the count was once wrapped in LIMIT 1000000 as a cost guard.
    // On a real 10 GB store it saturated at exactly that value and reported
    // ~1.4 GB reclaimable instead of ~3.9 GB -- a wrong number that looks
    // precise and reads LOW, talking the user out of space they need.
    const db = makeDb();
    const total = 2500;
    for (let i = 0; i < total; i++) insert(db, {});

    const est = estimateReclaimableBytes(db, 30, NOW);

    expect(est.candidateRows).toBe(total);
    // Sampling still bounds the expensive half (the content reads).
    expect(est.sampledRows).toBeLessThan(total);
    // Extrapolation scales the sample to the FULL population.
    const expected = (est.sampleBytesSaved / est.sampledRows) * total;
    expect(est.estimatedBytesSaved).toBeCloseTo(expected, -3);
    expect(est.estimatedBytesSaved).toBeGreaterThan(est.sampleBytesSaved);
  });

  it('never counts rows it would refuse to rewrite', () => {
    const db = makeDb();
    for (let i = 0; i < 10; i++) insert(db, {});
    insert(db, { direction: 'input', kind: 'user' });
    insert(db, { kind: 'assistant' });
    insert(db, { session: 'live-session' });
    insert(db, { createdAt: RECENT });

    expect(estimateReclaimableBytes(db, 30, NOW).candidateRows).toBe(10);
  });
});
