// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readTrackerRevision } from '../trackerRevisionService';
import type { AppDatabase } from '../../../database/PGLiteDatabaseWorker';

/**
 * Knowledge-scopes contract 4.2. `trackerItemRevisionStore` is already covered
 * against the real DDL; what is untested without this is the layer that decides
 * how a miss is reported, and that decision is the whole point: a miss must
 * come back as a distinct code, never as the item's current row.
 */

function db(rows: Array<Record<string, unknown>>): AppDatabase {
  return { query: vi.fn(async () => ({ rows })) } as unknown as AppDatabase;
}

const ROW = {
  revision_id: '9f2c1d4a-7b31-4e59-a0c8-5d6e2f1b3a77',
  item_id: 'itm_1',
  parent_revision_id: null,
  server_revision: 3,
  workspace: '/w',
  data: '{"title":"As it was"}',
  actor: null,
  published: 1,
  sync_status: 'synced',
  sync_id: 12,
  recorded_at: 1_700_000_000_000,
};

const BASE = { workspacePath: '/w', itemId: 'itm_1' };

describe('readTrackerRevision', () => {
  it('reads by UUID and normalizes the backend-divergent columns', async () => {
    const result = await readTrackerRevision(db([ROW]), { ...BASE, revisionId: ROW.revision_id });
    expect(result).toEqual({
      success: true,
      revision: expect.objectContaining({
        revisionId: ROW.revision_id,
        serverRevision: 3,
        // SQLite hands back JSON text and 0/1 where PGLite hands back an object
        // and a boolean; both backends are live.
        data: { title: 'As it was' },
        published: true,
      }),
    });
  });

  it('reports a miss with its own code and never falls back to the current row', async () => {
    const empty = db([]);
    const result = await readTrackerRevision(empty, { ...BASE, serverRevision: 9 });
    expect(result).toEqual({ success: false, code: 'revision-not-found', error: expect.any(String) });
    // One query, against the revision log. A fallback would show as a second.
    expect(empty.query).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['neither address', {}],
    ['both addresses', { revisionId: ROW.revision_id, serverRevision: 3 }],
  ])('rejects a request carrying %s', async (_label, address) => {
    // Preferring one of a mismatched pair would answer with a revision that
    // agrees with neither of the things the caller asked for.
    const result = await readTrackerRevision(db([ROW]), { ...BASE, ...address });
    expect(result).toMatchObject({ success: false, code: 'invalid-request' });
  });

  it('separates a broken read from a missing revision', async () => {
    const broken = { query: vi.fn(async () => { throw new Error('db down'); }) } as unknown as AppDatabase;
    const result = await readTrackerRevision(broken, { ...BASE, serverRevision: 3 });
    expect(result).toMatchObject({ success: false, code: 'read-failed', error: 'db down' });
  });
});
