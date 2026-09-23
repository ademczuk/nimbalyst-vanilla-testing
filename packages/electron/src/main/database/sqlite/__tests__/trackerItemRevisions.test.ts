// @vitest-environment node
/**
 * The tracker item revision log (knowledge-scopes contract 4.2) against the
 * real schema DDL.
 *
 * Identity is a UUID and the only sequential number comes from the room, so
 * the properties worth pinning here are: every revision gets a distinct id, the
 * parent chain is what orders history, a write that does not touch `data`
 * records nothing (sync replays re-apply identical payloads constantly, and
 * each spurious revision is a citation pointing at churn), and `server_revision`
 * stays NULL until the room assigns it.
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', async () => ({
  app: {
    getPath: (await import('../../../../../test-stubs/privateUserData')).testApp.getPath,
    getName: vi.fn(() => 'test-app'),
    getVersion: vi.fn(() => '1.0.0'),
    on: vi.fn(),
  },
}));

import { SQLiteDatabase } from '../SQLiteDatabase';
import {
  getItemRevision,
  getItemRevisionByServerNumber,
  getLatestItemRevision,
  listItemRevisions,
  pinItemRevision,
  TrackerItemNotFoundError,
  TrackerRevisionNotFoundError,
} from '../../../services/tracker/trackerItemRevisionStore';
import { pinCitedRevisions } from '../../../services/tracker/citationPins';

const SCHEMA_DIR = path.resolve(__dirname, '..', 'schemas');
const WS = '/tmp/ws';

let tmp: string;
let sqlite: SQLiteDatabase;

interface RevisionRow {
  revision_id: string;
  item_id: string;
  parent_revision_id: string | null;
  server_revision: number | null;
  data: string;
  actor: string | null;
  published: number | null;
  sync_status: string | null;
  deleted_at: string | null;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// A knowledge type: only those record history on their own.
async function insertItem(id: string, data: Record<string, unknown>, syncStatus = 'local', type = 'claim'): Promise<void> {
  await sqlite.query(
    `INSERT INTO tracker_items (id, type, data, workspace, sync_status) VALUES ($1, $5, $2, $3, $4)`,
    [id, JSON.stringify(data), WS, syncStatus, type],
  );
}

async function revisionsFor(id: string): Promise<RevisionRow[]> {
  // rowid is SQLite's insertion order, which is what this helper wants and is
  // deterministic. The production reads deliberately do NOT sort this way; they
  // walk the parent chain (see listItemRevisions).
  const result = await sqlite.query<RevisionRow>(
    `SELECT revision_id, item_id, parent_revision_id, server_revision, data, actor, published, sync_status, deleted_at
     FROM tracker_item_revisions WHERE item_id = $1 ORDER BY rowid ASC`,
    [id],
  );
  return result.rows;
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-tracker-rev-'));
  sqlite = new SQLiteDatabase({
    dbDir: path.join(tmp, 'sqlite-db'),
    schemaDir: SCHEMA_DIR,
    slowQueryThresholdMs: 1000,
    sampleRate: 0,
  });
  await sqlite.initialize();
});

afterAll(async () => {
  await sqlite.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  await sqlite.query('DELETE FROM tracker_items', []);
  await sqlite.query('DELETE FROM tracker_item_revisions', []);
});

describe('tracker_item_revisions triggers', () => {
  it('gives each revision a UUID and chains it to the one it superseded', async () => {
    await insertItem('item-1', { title: 'First' });
    await sqlite.query(`UPDATE tracker_items SET data = $1 WHERE id = 'item-1'`, [
      JSON.stringify({ title: 'Second' }),
    ]);

    const rows = await revisionsFor('item-1');
    expect(rows).toHaveLength(2);
    expect(rows[0].revision_id).toMatch(UUID_V4);
    expect(rows[1].revision_id).toMatch(UUID_V4);
    expect(rows[0].revision_id).not.toBe(rows[1].revision_id);
    // The chain is what orders history; there is no local counter.
    expect(rows[0].parent_revision_id).toBeNull();
    expect(rows[1].parent_revision_id).toBe(rows[0].revision_id);
    // Numbers belong to the room, so nothing is numbered before it syncs.
    expect(rows[0].server_revision).toBeNull();
    expect(rows[1].server_revision).toBeNull();
    // The whole field bag, not a delta: a citation renders one revision without
    // replaying the chain.
    expect(JSON.parse(rows[0].data).title).toBe('First');
    expect(JSON.parse(rows[1].data).title).toBe('Second');
  });

  it('ignores writes that leave data untouched', async () => {
    await insertItem('item-2', { title: 'Same' });
    await sqlite.query(`UPDATE tracker_items SET sync_id = 42 WHERE id = 'item-2'`, []);
    // A sync replay re-applying the identical payload.
    await sqlite.query(`UPDATE tracker_items SET data = $1 WHERE id = 'item-2'`, [
      JSON.stringify({ title: 'Same' }),
    ]);

    expect(await revisionsFor('item-2')).toHaveLength(1);
  });

  it('keeps and extends the chain after a delete and re-insert', async () => {
    await insertItem('item-3', { title: 'Before' });
    const edited = { title: 'Edited', lastModifiedBy: { displayName: 'Alice' } };
    await sqlite.query(`UPDATE tracker_items SET data = $1 WHERE id = 'item-3'`, [
      JSON.stringify(edited),
    ]);
    await sqlite.query(`DELETE FROM tracker_items WHERE id = 'item-3'`, []);
    // Identical data: only the deleted/live state distinguishes it from the tip.
    await insertItem('item-3', edited);

    const rows = await revisionsFor('item-3');
    expect(rows).toHaveLength(4);
    expect(rows[2].deleted_at).not.toBeNull();
    // The row names its last editor, not the deleter.
    expect(rows[2].actor).toBeNull();
    expect(rows[3].deleted_at).toBeNull();
    // Deleting appends a tombstone, and a later re-insert is a resurrection
    // chained after it rather than a live revision that skips over the death.
    expect(rows[3].parent_revision_id).toBe(rows[2].revision_id);
    expect(JSON.parse(rows[0].data).title).toBe('Before');
  });

  it('appends a tombstone for a soft delete that leaves data unchanged', async () => {
    await insertItem('item-soft-delete', { title: 'Before' });
    await sqlite.query(
      `UPDATE tracker_items SET deleted_at = $1 WHERE id = 'item-soft-delete'`,
      ['2026-09-22T12:00:00.000Z'],
    );

    const rows = await revisionsFor('item-soft-delete');
    expect(rows).toHaveLength(2);
    expect(rows[1].parent_revision_id).toBe(rows[0].revision_id);
    expect(rows[1].deleted_at).toBe('2026-09-22T12:00:00.000Z');
    expect(JSON.parse(rows[1].data).title).toBe('Before');
  });

  it('records the row-evident publication state and leaves the schema-dependent case undetermined', async () => {
    await insertItem('pub-explicit', { title: 'A', share: { status: 'team', body: 'team' } });
    await insertItem('pub-private', { title: 'B', share: { status: 'private', body: 'private' } });
    await insertItem('pub-nested', { title: 'C', customFields: { share: { status: 'team' } } });
    await insertItem('pub-legacy', { title: 'D', shared: true });
    await insertItem('pub-synced', { title: 'E' }, 'synced');
    await insertItem('pub-unknown', { title: 'F' }, 'local');

    const published = async (id: string) => (await revisionsFor(id))[0].published;
    expect(await published('pub-explicit')).toBe(1);
    expect(await published('pub-private')).toBe(0);
    expect(await published('pub-nested')).toBe(1);
    expect(await published('pub-legacy')).toBe(1);
    expect(await published('pub-synced')).toBe(1);
    // Resolving this one needs the tracker schema's draftByDefault, which SQL
    // cannot read. NULL means "ask the schema", never "draft".
    expect(await published('pub-unknown')).toBeNull();
  });

  it('captures the actor from either storage shape when one is known', async () => {
    await insertItem('actor-top', { title: 'A', lastModifiedBy: { displayName: 'Alice' } });
    await insertItem('actor-nested', { title: 'B', customFields: { lastModifiedBy: { displayName: 'Bob' } } });
    await insertItem('actor-author', { title: 'C', authorIdentity: { displayName: 'Cleo' } });
    await insertItem('actor-none', { title: 'D' });

    const actorOf = async (id: string) => {
      const raw = (await revisionsFor(id))[0].actor;
      return raw === null ? null : (JSON.parse(raw) as { displayName?: string }).displayName;
    };
    expect(await actorOf('actor-top')).toBe('Alice');
    expect(await actorOf('actor-nested')).toBe('Bob');
    expect(await actorOf('actor-author')).toBe('Cleo');
    // Backfills and imports have no author. Recording none beats inventing one.
    expect(await actorOf('actor-none')).toBeNull();
  });

  // The PGLite->SQLite cutover copies tracker_item_revisions and then
  // tracker_items. An item copy that appended a revision would write a
  // spurious entry into permanent history.
  it('stays quiet when a soft-deleted item is copied over its tombstone tip', async () => {
    const deletedAt = '2026-09-22T12:00:00.000Z';
    const data = JSON.stringify({ title: 'Gone' });
    await sqlite.query(
      `INSERT INTO tracker_item_revisions
         (revision_id, item_id, parent_revision_id, workspace, data, deleted_at)
       VALUES ($1, 'cutover-soft', NULL, $2, $3, NULL),
              ($4, 'cutover-soft', $1, $2, $3, $5)`,
      ['00000000-0000-4000-8000-000000000011', WS, data, '00000000-0000-4000-8000-000000000012', deletedAt],
    );
    await sqlite.query(
      `INSERT INTO tracker_items (id, type, data, workspace, sync_status, deleted_at) VALUES ('cutover-soft', 'claim', $1, $2, 'local', $3)`,
      [data, WS, deletedAt],
    );

    expect(await revisionsFor('cutover-soft')).toHaveLength(2);
  });

  it('stays quiet when an insert reproduces the latest recorded revision', async () => {
    // The cutover copies revision history before current item rows. Seed that
    // state directly: unlike a user delete, the copy must not add a tombstone.
    await sqlite.query(
      `INSERT INTO tracker_item_revisions
         (revision_id, item_id, parent_revision_id, workspace, data)
       VALUES ($1, 'cutover-1', NULL, $2, $3)`,
      ['00000000-0000-4000-8000-000000000001', WS, JSON.stringify({ title: 'Migrated' })],
    );
    await insertItem('cutover-1', { title: 'Migrated' });

    expect(await revisionsFor('cutover-1')).toHaveLength(1);
  });

  // Regression: ordering by recorded_at with a UUID tie-break returned these
  // in random order, because several writes land inside the same millisecond.
  // The chain is the only thing that knows the real sequence.
  it('orders rapid successive writes by the chain, not the clock', async () => {
    await insertItem('rapid-1', { title: 'v1' });
    for (const title of ['v2', 'v3', 'v4']) {
      await sqlite.query(`UPDATE tracker_items SET data = $1 WHERE id = 'rapid-1'`, [
        JSON.stringify({ title }),
      ]);
    }

    // Force the collision rather than hope for it. Waiting for four writes to
    // land inside one millisecond makes the test a race: it passed on a busy
    // machine and failed on a fast one, and the assertion that fell over was
    // the precondition, not the behavior. Collapsing every timestamp to the
    // same value tests the stronger invariant directly -- ordering must not
    // consult `recorded_at` at all.
    await sqlite.query(
      `UPDATE tracker_item_revisions SET recorded_at = '2026-09-22T00:00:00.000Z' WHERE item_id = 'rapid-1'`,
      [],
    );

    const chain = await listItemRevisions(
      sqlite as unknown as import('../../PGLiteDatabaseWorker').AppDatabase,
      WS,
      'rapid-1',
    );
    expect(chain.map(r => r.data.title)).toEqual(['v1', 'v2', 'v3', 'v4']);
  });

  it('tracks each item independently', async () => {
    await insertItem('a', { title: 'a1' });
    await insertItem('b', { title: 'b1' });
    await sqlite.query(`UPDATE tracker_items SET data = $1 WHERE id = 'a'`, [JSON.stringify({ title: 'a2' })]);

    expect(await revisionsFor('a')).toHaveLength(2);
    const b = await revisionsFor('b');
    expect(b).toHaveLength(1);
    // Item b's first revision does not inherit item a's chain.
    expect(b[0].parent_revision_id).toBeNull();
  });
});

describe('revision scope and pin-on-cite', () => {
  const db = () => sqlite as unknown as import('../../PGLiteDatabaseWorker').AppDatabase;

  it('records nothing for an ordinary tracker type on insert, edit, or delete', async () => {
    await insertItem('bug-1', { title: 'v1' }, 'local', 'bug');
    await sqlite.query(`UPDATE tracker_items SET data = $1 WHERE id = 'bug-1'`, [JSON.stringify({ title: 'v2' })]);
    await sqlite.query(`DELETE FROM tracker_items WHERE id = 'bug-1'`, []);

    expect(await revisionsFor('bug-1')).toHaveLength(0);
  });

  it('pins an ordinary item once per state and chains later pins', async () => {
    await insertItem('bug-2', { title: 'v1' }, 'local', 'bug');

    const first = await pinItemRevision(db(), WS, 'bug-2');
    // Unchanged item: the existing pin is reused, nothing is appended.
    expect(await pinItemRevision(db(), WS, 'bug-2')).toBe(first);
    expect((await getItemRevision(db(), WS, 'bug-2', first)).data.title).toBe('v1');

    await sqlite.query(`UPDATE tracker_items SET data = $1 WHERE id = 'bug-2'`, [JSON.stringify({ title: 'v2' })]);
    const second = await pinItemRevision(db(), WS, 'bug-2');

    const rows = await revisionsFor('bug-2');
    expect(rows.map(r => r.revision_id)).toEqual([first, second]);
    expect(rows[1].parent_revision_id).toBe(first);
    // The earlier pin still resolves to the state that was cited.
    expect((await getItemRevision(db(), WS, 'bug-2', first)).data.title).toBe('v1');
  });

  it('reuses a knowledge item\'s trigger-recorded tip and refuses a missing item', async () => {
    await insertItem('claim-pin', { title: 'c1' });
    const [tip] = (await revisionsFor('claim-pin')).map(r => r.revision_id);

    expect(await pinItemRevision(db(), WS, 'claim-pin')).toBe(tip);
    await expect(pinItemRevision(db(), WS, 'missing')).rejects.toBeInstanceOf(TrackerItemNotFoundError);
  });

  it('pins new cites targets on write and keeps an existing pin when a write re-sends the target', async () => {
    const citesField = {
      name: 'claim', type: 'relationship', multiValue: true, relationshipTypeKey: 'cites', targetTrackerTypes: '*',
    } as unknown as import('@nimbalyst/runtime/plugins/TrackerPlugin/models').FieldDefinition;
    await insertItem('bug-cited', { title: 'then' }, 'local', 'bug');
    await insertItem('bug-new', { title: 'other' }, 'local', 'bug');
    const oldPin = await pinItemRevision(db(), WS, 'bug-cited');
    await insertItem('cite-1', { title: 'c', claim: [{ itemId: 'bug-cited', revisionId: oldPin }] }, 'local', 'citation');
    // The cited item moves on after it was cited.
    await sqlite.query(`UPDATE tracker_items SET data = $1 WHERE id = 'bug-cited'`, [JSON.stringify({ title: 'now' })]);

    const data: Record<string, unknown> = { claim: [{ itemId: 'bug-cited' }, { itemId: 'bug-new' }] };
    await pinCitedRevisions(db(), WS, 'cite-1', data, [citesField]);

    const [kept, added] = data.claim as Array<{ itemId: string; revisionId?: string }>;
    expect(kept.revisionId).toBe(oldPin);
    expect((await getItemRevision(db(), WS, 'bug-new', added.revisionId!)).data.title).toBe('other');
  });
});

describe('trackerItemRevisionStore', () => {
  const db = () => sqlite as unknown as import('../../PGLiteDatabaseWorker').AppDatabase;

  async function revisionIds(id: string): Promise<string[]> {
    return (await revisionsFor(id)).map(r => r.revision_id);
  }

  it('reads one exact revision and refuses a missing one instead of falling back to latest', async () => {
    await insertItem('read-1', { title: 'v1' });
    await sqlite.query(`UPDATE tracker_items SET data = $1 WHERE id = 'read-1'`, [
      JSON.stringify({ title: 'v2' }),
    ]);
    const [firstId] = await revisionIds('read-1');

    const first = await getItemRevision(db(), WS, 'read-1', firstId);
    expect(first.data.title).toBe('v1');
    expect(first.parentRevisionId).toBeNull();
    expect(first.serverRevision).toBeNull();
    expect(first.recordedAt).toBeGreaterThan(0);

    // The property the whole contract rests on: a pinned revision that no
    // longer exists must fail loudly, not silently render newer evidence.
    await expect(
      getItemRevision(db(), WS, 'read-1', '00000000-0000-4000-8000-000000000000'),
    ).rejects.toBeInstanceOf(TrackerRevisionNotFoundError);
  });

  it('scopes reads to the workspace', async () => {
    await insertItem('read-2', { title: 'v1' });
    const [id] = await revisionIds('read-2');
    await expect(getItemRevision(db(), '/tmp/other-ws', 'read-2', id)).rejects.toBeInstanceOf(
      TrackerRevisionNotFoundError,
    );
  });

  it('returns the latest revision and the bounded history in chain order', async () => {
    await insertItem('read-3', { title: 'v1' });
    for (const title of ['v2', 'v3']) {
      await sqlite.query(`UPDATE tracker_items SET data = $1 WHERE id = 'read-3'`, [
        JSON.stringify({ title }),
      ]);
    }
    const ids = await revisionIds('read-3');

    expect((await getLatestItemRevision(db(), WS, 'read-3'))?.revisionId).toBe(ids[2]);
    expect(await getLatestItemRevision(db(), WS, 'missing-item')).toBeNull();

    const all = await listItemRevisions(db(), WS, 'read-3');
    expect(all.map(r => r.revisionId)).toEqual(ids);
    expect(all.map(r => r.data.title)).toEqual(['v1', 'v2', 'v3']);
    expect((await listItemRevisions(db(), WS, 'read-3', { limit: 1 })).map(r => r.revisionId)).toEqual([ids[0]]);
  });

  // The room owns the number. Until it assigns one there is nothing to look up
  // by, which is the point: an unsynced revision has no number a teammate
  // could cite.
  it('resolves a revision by the room-assigned number once it exists', async () => {
    await insertItem('read-6', { title: 'v1' }, 'synced');
    const [id] = await revisionIds('read-6');

    await expect(getItemRevisionByServerNumber(db(), WS, 'read-6', 7)).rejects.toBeInstanceOf(
      TrackerRevisionNotFoundError,
    );

    await sqlite.query(`UPDATE tracker_item_revisions SET server_revision = 7 WHERE revision_id = $1`, [id]);
    const byNumber = await getItemRevisionByServerNumber(db(), WS, 'read-6', 7);
    expect(byNumber.revisionId).toBe(id);
    expect(byNumber.serverRevision).toBe(7);
  });

  it('rejects two revisions of one item claiming the same room number', async () => {
    await insertItem('read-7', { title: 'v1' }, 'synced');
    await sqlite.query(`UPDATE tracker_items SET data = $1 WHERE id = 'read-7'`, [
      JSON.stringify({ title: 'v2' }),
    ]);
    const ids = await revisionIds('read-7');
    await sqlite.query(`UPDATE tracker_item_revisions SET server_revision = 3 WHERE revision_id = $1`, [ids[0]]);

    await expect(
      sqlite.query(`UPDATE tracker_item_revisions SET server_revision = 3 WHERE revision_id = $1`, [ids[1]]),
    ).rejects.toThrow();
  });

  it('normalizes the backend-divergent columns', async () => {
    await insertItem('read-4', { title: 'v1', lastModifiedBy: { displayName: 'Alice' } }, 'synced');
    const [id] = await revisionIds('read-4');

    const rev = await getItemRevision(db(), WS, 'read-4', id);
    // SQLite hands back JSON text where PGLite hands back an object.
    expect(rev.data).toEqual({ title: 'v1', lastModifiedBy: { displayName: 'Alice' } });
    expect(rev.actor?.displayName).toBe('Alice');
    // SQLite stores 0/1 where PGLite stores a boolean.
    expect(rev.published).toBe(true);

    await insertItem('read-5', { title: 'v1' }, 'local');
    const [localId] = await revisionIds('read-5');
    expect((await getItemRevision(db(), WS, 'read-5', localId)).published).toBeNull();
  });
});
