// @vitest-environment node
/**
 * The unread seed query against a real better-sqlite3 engine.
 *
 * A string assertion would be worthless here: the bug this covers was a query
 * that read correctly, ran without error, and returned zero rows forever,
 * because SQLite's `->>` yields the integer 1 for a JSON boolean where PGLite
 * yields the text `true`. Only the engine can say which comparison is true, so
 * only the engine is asked.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SQLiteDatabase } from '../../database/sqlite/SQLiteDatabase';
import { unreadSeedQuery } from '../unreadSeedQuery';

describe('unreadSeedQuery (SQLite)', () => {
  let tmpDir: string;
  let sqlite: SQLiteDatabase;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-unread-seed-'));
    sqlite = new SQLiteDatabase({
      dbDir: tmpDir,
      schemaDir: path.resolve(__dirname, '..', '..', 'database', 'sqlite', 'schemas'),
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await sqlite.initialize();
  });

  afterEach(async () => {
    await sqlite.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function insertSession(options: {
    id: string;
    updatedAt: string;
    metadata: unknown;
    isArchived?: boolean;
  }): Promise<void> {
    await sqlite.query(
      `INSERT INTO ai_sessions (id, title, workspace_id, provider, updated_at, metadata, is_archived)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        options.id,
        options.id,
        '/tmp/workspace',
        'claude',
        options.updatedAt,
        JSON.stringify(options.metadata),
        options.isArchived ?? false,
      ],
    );
  }

  const ids = async (limit: number): Promise<string[]> => {
    const { rows } = await sqlite.query<{ id: string }>(unreadSeedQuery(limit));
    return rows.map((row) => row.id);
  };

  it('matches a JSON boolean true, which SQLite reads back as an integer', async () => {
    // The regression. `metadata->'metadata'->>'hasUnread'` is the integer 1
    // here and the text `true` on PGLite, and SQLite never equates an integer
    // with a string -- so the previous `= 'true'` matched nothing at all and
    // every session unread from before launch vanished from the tray.
    await insertSession({
      id: 'unread',
      updatedAt: '2026-08-30T12:00:00.000Z',
      metadata: { metadata: { hasUnread: true } },
    });
    await insertSession({
      id: 'read',
      updatedAt: '2026-08-30T13:00:00.000Z',
      metadata: { metadata: { hasUnread: false, lastReadAt: 1788110766217 } },
    });
    await insertSession({
      id: 'never-had-the-flag',
      updatedAt: '2026-08-30T14:00:00.000Z',
      metadata: { phase: 'complete' },
    });

    expect(await ids(25)).toEqual(['unread']);
  });

  it('still matches the flat path older rows were written with', async () => {
    await insertSession({
      id: 'legacy',
      updatedAt: '2026-08-30T12:00:00.000Z',
      metadata: { hasUnread: true },
    });

    expect(await ids(25)).toEqual(['legacy']);
  });

  it('leaves archived sessions out', async () => {
    await insertSession({
      id: 'archived',
      updatedAt: '2026-08-30T12:00:00.000Z',
      metadata: { metadata: { hasUnread: true } },
      isArchived: true,
    });

    expect(await ids(25)).toEqual([]);
  });

  it('takes the newest when there are more unread than the cap', async () => {
    // The cap is what keeps a menu bar panel usable on an install with hundreds
    // of these, and it only helps if it drops the *oldest*. `updated_at` is ISO
    // text on this backend and a TIMESTAMPTZ on the other, which is why the
    // ordering is done in SQL by that column rather than by a date expression.
    for (const hour of ['09', '10', '11', '12']) {
      await insertSession({
        id: `unread-${hour}`,
        updatedAt: `2026-08-30T${hour}:00:00.000Z`,
        metadata: { metadata: { hasUnread: true } },
      });
    }

    expect(await ids(2)).toEqual(['unread-12', 'unread-11']);
  });
});
