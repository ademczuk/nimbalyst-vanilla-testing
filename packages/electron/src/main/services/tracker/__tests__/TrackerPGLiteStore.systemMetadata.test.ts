import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TrackerItemEnvelope, TrackerItemPayload } from '@nimbalyst/runtime/sync';
import { SQLiteDatabase } from '../../../database/sqlite/SQLiteDatabase';
import { TrackerPGLiteStore } from '../TrackerPGLiteStore';
import { repairTrackerIdentityKeys } from '../trackerIdentityKeyRepair';

const WORKSPACE = '/ws/shared';
const COMMENTS = [
  {
    id: 'comment-1',
    authorIdentity: { email: 'alice@example.com', displayName: 'Alice', gitName: null, gitEmail: null },
    body: 'persists',
    createdAt: 1,
  },
];
const ACTIVITY = [
  {
    id: 'activity-1',
    authorIdentity: { email: 'alice@example.com', displayName: 'Alice', gitName: null, gitEmail: null },
    action: 'commented' as const,
    timestamp: 1,
  },
];
const SECOND_COMMENT = {
  id: 'comment-2',
  authorIdentity: { email: 'bob@example.com', displayName: 'Bob', gitName: null, gitEmail: null },
  body: 'also persists',
  createdAt: 2,
};
const SECOND_ACTIVITY = {
  id: 'activity-2',
  authorIdentity: { email: 'bob@example.com', displayName: 'Bob', gitName: null, gitEmail: null },
  action: 'status_changed' as const,
  field: 'status',
  oldValue: 'to-do',
  newValue: 'in-progress',
  timestamp: 2,
};
const LINKED_PULL_REQUESTS = [{ remote: 'nimbalyst/nimbalyst', number: 42 }];

function payload(): TrackerItemPayload {
  return {
    itemId: 'bug-1',
    primaryType: 'bug',
    archived: false,
    bodyVersion: 0,
    fields: { title: 'Shared bug', status: 'to-do' },
    labels: {},
    comments: COMMENTS,
    activity: ACTIVITY,
    system: { linkedPullRequests: LINKED_PULL_REQUESTS },
  };
}

function envelope(syncId = 1): TrackerItemEnvelope {
  return {
    itemId: 'bug-1',
    syncId,
    encryptedPayload: 'encrypted',
    iv: 'iv',
    updatedAt: 1_700_000_000_000,
    deletedAt: null,
    orgKeyFingerprint: null,
  };
}

function parseData(value: unknown): Record<string, unknown> {
  return typeof value === 'string' ? JSON.parse(value) : value as Record<string, unknown>;
}

const BODY = 'The body a user typed into the tracker editor.';

/** JSONB comes back parsed on PGLite and as raw text on SQLite. */
function readBody(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * The body has no wire representation at all -- the metadata envelope carries
 * only a `bodyVersion` pointer, and `payloadToRecord` always emits
 * `content: undefined`. So an ack that wrote the `content` column could only
 * ever write NULL over whatever the user had typed.
 */
async function expectBodySurvivesMetadataAck(
  db: { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> },
  store: TrackerPGLiteStore,
) {
  await store.applyRemoteItem(envelope(), payload());
  // Mirrors the real body write in ElectronDocumentService.updateTrackerItemContent.
  await db.query(
    'UPDATE tracker_items SET content = $1::jsonb, body_version = 1 WHERE id = $2',
    [JSON.stringify(BODY), 'bug-1'],
  );

  const ack = payload();
  ack.bodyVersion = 1;
  await store.applyRemoteItem(envelope(2), ack);

  const result = await db.query<{ content: unknown }>(
    'SELECT content FROM tracker_items WHERE id = $1',
    ['bug-1'],
  );
  expect(readBody(result.rows[0].content)).toBe(BODY);
}

/**
 * The issue number and key belong to the indexed columns and nowhere else.
 * Persisting a second copy inside `data` gave the two writers different rules
 * -- the column COALESCEs, the blob is replaced wholesale from the server
 * payload -- so they drifted apart and an item could report a key that was not
 * its own. Readers all go through the column, so the blob copy was a shadow
 * that could only ever be wrong.
 */
async function expectIssueKeyStoredOnceOnly(
  db: { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> },
  apply: () => Promise<unknown>,
  expectedKey: string | null,
  expectedNumber: number | null,
) {
  await apply();
  const result = await db.query<{ issue_key: string | null; issue_number: unknown; data: unknown }>(
    'SELECT issue_key, issue_number, data FROM tracker_items WHERE id = $1',
    ['bug-1'],
  );
  const row = result.rows[0];
  expect(row.issue_key).toBe(expectedKey);
  expect(row.issue_number === null ? null : Number(row.issue_number)).toBe(expectedNumber);
  const data = parseData(row.data);
  expect(data.issueKey).toBeUndefined();
  expect(data.issueNumber).toBeUndefined();
}

type TestDb = { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> };

/**
 * Seed the two shapes of legacy row the repair has to tell apart: one whose
 * columns carry the key (so the blob copy is redundant), and one the
 * `issue_number` collision branch stranded with NULL columns (so the blob copy
 * is the only key it has left).
 */
async function seedLegacyBlobKeyRows(db: TestDb) {
  const blob = (key: string, num: number) => JSON.stringify({
    title: 'Legacy', status: 'to-do', issueKey: key, issueNumber: num, typeTags: ['bug'],
  });
  await db.query(
    `INSERT INTO tracker_items (id, issue_number, issue_key, type, data, workspace)
     VALUES ($1, $2, $3, 'bug', $4, $5)`,
    ['keyed-1', 42, 'NIM-42', blob('NIM-41', 41), WORKSPACE],
  );
  await db.query(
    `INSERT INTO tracker_items (id, issue_number, issue_key, type, data, workspace)
     VALUES ($1, NULL, NULL, 'bug', $2, $3)`,
    ['stranded-1', blob('NIM-77', 77), WORKSPACE],
  );
}

async function readDataFor(db: TestDb, id: string): Promise<Record<string, unknown>> {
  const result = await db.query<{ data: unknown }>('SELECT data FROM tracker_items WHERE id = $1', [id]);
  return parseData(result.rows[0].data);
}

/**
 * The repair clears a redundant blob copy but must never touch a stranded row:
 * the collision branch lands those with NULL columns and no renumber path
 * exists, so their blob copy is the only surviving record of the key the server
 * allocated. Stripping it would destroy the evidence needed to reconcile them.
 */
async function expectRepairSparesStrandedRows(db: TestDb, engine: 'pglite' | 'sqlite') {
  await seedLegacyBlobKeyRows(db);
  const port = { query: db.query.bind(db), getEngine: () => engine };

  const result = await repairTrackerIdentityKeys(port as any, WORKSPACE);
  expect(result).toEqual({ repaired: 1, strandedSkipped: 1 });

  const keyed = await readDataFor(db, 'keyed-1');
  expect(keyed.issueKey).toBeUndefined();
  expect(keyed.issueNumber).toBeUndefined();
  expect(keyed.typeTags).toBeUndefined();
  expect(keyed.title).toBe('Legacy');

  const stranded = await readDataFor(db, 'stranded-1');
  expect(stranded.issueKey).toBe('NIM-77');
  expect(stranded.issueNumber).toBe(77);

  // Idempotent: a second launch repairs nothing.
  expect(await repairTrackerIdentityKeys(port as any, WORKSPACE))
    .toEqual({ repaired: 0, strandedSkipped: 1 });
}

/**
 * A legacy row's stale blob key must not reach `customFields`. The converter
 * maps the column onto `issueKey`, so sweeping the blob copy into the bag put
 * two different keys on one item and let callers read the wrong one.
 */
async function expectStaleBlobKeyNotLeakedToCustomFields(db: TestDb, store: TrackerPGLiteStore) {
  await seedLegacyBlobKeyRows(db);
  const item = await store.getTrackerItem('keyed-1');
  expect(item?.issueKey).toBe('NIM-42');
  expect(item?.customFields?.issueKey).toBeUndefined();
  expect(item?.customFields?.issueNumber).toBeUndefined();
  expect(item?.customFields?.typeTags).toBeUndefined();
}

/**
 * The room is the sole allocator of issue identity -- `TrackerRoom` says so
 * outright, and enforces uniqueness across the whole room. So when an item
 * arrives holding a key some local row already claims, the local row is the
 * one that guessed: every client create path used to allocate its own
 * `MAX(issue_number)+1` before the mutation was acked, which is why `LC-###`
 * and the dotted `local_key` exist at all.
 *
 * The client used to resolve this backwards, dropping the number the room had
 * just vouched for and keeping the local guess. That stranded the incoming row
 * with no key at all, and no renumber path existed to give it one back.
 */
async function expectIncomingKeyWinsCollision(
  db: TestDb,
  store: TrackerPGLiteStore,
) {
  await db.query(
    `INSERT INTO tracker_items (id, issue_number, issue_key, type, data, workspace)
     VALUES ($1, 42, 'NIM-42', 'bug', $2, $3)`,
    ['squatter-1', JSON.stringify({ title: 'Locally numbered first', status: 'to-do' }), WORKSPACE],
  );

  await store.applyRemoteItem({ ...envelope(), issueNumber: 42, issueKey: 'NIM-42' }, payload());

  const rows = await db.query<{ id: string; issue_key: string | null; issue_number: unknown }>(
    'SELECT id, issue_key, issue_number FROM tracker_items ORDER BY id',
    [],
  );
  const byId = new Map(rows.rows.map((r) => [r.id, r]));

  // The room's allocation lands on the item the room allocated it to.
  expect(byId.get('bug-1')?.issue_key).toBe('NIM-42');
  expect(Number(byId.get('bug-1')?.issue_number)).toBe(42);

  // The local guess yields rather than being renumbered into the room's
  // namespace -- a recycled number sends you to the wrong item with no warning.
  expect(byId.get('squatter-1')?.issue_key).toBeNull();
  expect(byId.get('squatter-1')?.issue_number).toBeNull();
}

/**
 * A prefix change (`tracker_set_issue_key_prefix`, or the room's own conflict
 * path handing back NIM -> NIMA) leaves two legitimately distinct keys sharing
 * one number. Uniqueness keyed on the number alone called that a duplicate and
 * stranded the second item.
 */
async function expectSameNumberDifferentPrefixCoexists(
  db: TestDb,
  store: TrackerPGLiteStore,
) {
  await db.query(
    `INSERT INTO tracker_items (id, issue_number, issue_key, type, data, workspace)
     VALUES ($1, 42, 'NIM-42', 'bug', $2, $3)`,
    ['older-prefix-1', JSON.stringify({ title: 'Numbered under the old prefix', status: 'to-do' }), WORKSPACE],
  );

  await store.applyRemoteItem({ ...envelope(), issueNumber: 42, issueKey: 'NIMA-42' }, payload());

  const rows = await db.query<{ id: string; issue_key: string | null }>(
    'SELECT id, issue_key FROM tracker_items ORDER BY id',
    [],
  );
  const byId = new Map(rows.rows.map((r) => [r.id, r.issue_key]));
  expect(byId.get('older-prefix-1')).toBe('NIM-42');
  expect(byId.get('bug-1')).toBe('NIMA-42');
}

async function expectSystemCollections(db: { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }) {
  const result = await db.query<{ data: unknown }>('SELECT data FROM tracker_items WHERE id = $1', ['bug-1']);
  const data = parseData(result.rows[0].data);
  expect(data.comments).toEqual(COMMENTS);
  expect(data.activity).toEqual(ACTIVITY);
  expect(data.linkedPullRequests).toEqual(LINKED_PULL_REQUESTS);
}

describe('TrackerPGLiteStore system metadata projection (PGLite)', () => {
  let db: PGlite;
  let store: TrackerPGLiteStore;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TABLE tracker_items (
        id TEXT PRIMARY KEY,
        issue_number INTEGER,
        issue_key TEXT,
        type TEXT NOT NULL,
        data JSONB NOT NULL,
        workspace TEXT NOT NULL,
        document_path TEXT,
        line_number INTEGER,
        content JSONB,
        archived BOOLEAN NOT NULL DEFAULT FALSE,
        source TEXT DEFAULT 'inline',
        source_ref TEXT,
        type_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        sync_status TEXT DEFAULT 'local',
        sync_id BIGINT,
        body_version INTEGER NOT NULL DEFAULT 0,
        deleted_at TIMESTAMPTZ,
        created TIMESTAMPTZ DEFAULT NOW(),
        updated TIMESTAMPTZ DEFAULT NOW(),
        last_indexed TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE UNIQUE INDEX idx_tracker_workspace_issue_key
        ON tracker_items(workspace, issue_key) WHERE issue_key IS NOT NULL;
    `);
    store = new TrackerPGLiteStore(db as any, WORKSPACE);
  });

  afterEach(async () => {
    await db.close();
  });

  it('preserves collections through applyRemoteItem', async () => {
    await store.applyRemoteItem(envelope(), payload());
    await expectSystemCollections(db as any);
  });

  it('preserves collections through applyOptimistic', async () => {
    await store.applyOptimistic('bug-1', payload());
    await expectSystemCollections(db as any);
  });

  it('does not let an older remote payload erase activity or pull request links', async () => {
    await store.applyRemoteItem(envelope(), payload());
    const legacyPayload = payload();
    delete legacyPayload.activity;
    delete legacyPayload.system.linkedPullRequests;
    await store.applyRemoteItem(envelope(2), legacyPayload);
    await expectSystemCollections(db as any);
  });

  it('merges comments and activity when a stale echo lands after a newer local snapshot', async () => {
    const newerPayload = payload();
    newerPayload.comments = [...COMMENTS, SECOND_COMMENT];
    newerPayload.activity = [...ACTIVITY, SECOND_ACTIVITY];
    await store.applyRemoteItem(envelope(), newerPayload);
    await store.applyRemoteItem(envelope(2), payload());

    const result = await db.query<{ data: unknown }>('SELECT data FROM tracker_items WHERE id = $1', ['bug-1']);
    const data = parseData(result.rows[0].data);
    expect(data.comments).toEqual([...COMMENTS, SECOND_COMMENT]);
    expect(data.activity).toEqual([...ACTIVITY, SECOND_ACTIVITY]);
  });

  it('does not let a metadata ack erase the item body', async () => {
    await expectBodySurvivesMetadataAck(db as any, store);
  });

  it('keeps the issue key in the column only, through applyRemoteItem', async () => {
    await expectIssueKeyStoredOnceOnly(
      db as any,
      () => store.applyRemoteItem({ ...envelope(), issueNumber: 42, issueKey: 'NIM-42' }, payload()),
      'NIM-42',
      42,
    );
  });

  it('keeps the issue key in the column only, through applyOptimistic', async () => {
    await store.applyRemoteItem({ ...envelope(), issueNumber: 42, issueKey: 'NIM-42' }, payload());
    await expectIssueKeyStoredOnceOnly(
      db as any,
      () => store.applyOptimistic('bug-1', payload()),
      'NIM-42',
      42,
    );
  });

  it('does not leak a legacy row\'s stale blob key into customFields', async () => {
    await expectStaleBlobKeyNotLeakedToCustomFields(db as any, store);
  });

  it('gives the room\'s key to the item the room allocated it to', async () => {
    await expectIncomingKeyWinsCollision(db as any, store);
  });

  it('lets one number carry two prefixes', async () => {
    await expectSameNumberDifferentPrefixCoexists(db as any, store);
  });

  it('repairs a legacy blob copy but spares a collision-stranded row', async () => {
    await expectRepairSparesStrandedRows(db as any, 'pglite');
  });
});

describe('TrackerPGLiteStore system metadata projection (SQLite)', () => {
  let tmpDir: string;
  let db: SQLiteDatabase;
  let store: TrackerPGLiteStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-tracker-system-'));
    db = new SQLiteDatabase({
      dbDir: tmpDir,
      schemaDir: path.resolve(__dirname, '..', '..', '..', 'database', 'sqlite', 'schemas'),
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await db.initialize();
    store = new TrackerPGLiteStore(db as any, WORKSPACE);
  });

  afterEach(async () => {
    await db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('preserves collections through applyRemoteItem', async () => {
    await store.applyRemoteItem(envelope(), payload());
    await expectSystemCollections(db as any);
  });

  it('preserves collections through applyOptimistic', async () => {
    await store.applyOptimistic('bug-1', payload());
    await expectSystemCollections(db as any);
  });

  it('does not let an older optimistic payload erase activity or pull request links', async () => {
    await store.applyRemoteItem(envelope(), payload());
    const legacyPayload = payload();
    delete legacyPayload.activity;
    delete legacyPayload.system.linkedPullRequests;
    await store.applyOptimistic('bug-1', legacyPayload);
    await expectSystemCollections(db as any);
  });

  it('merges comments and activity when a stale echo lands after a newer local snapshot', async () => {
    const newerPayload = payload();
    newerPayload.comments = [...COMMENTS, SECOND_COMMENT];
    newerPayload.activity = [...ACTIVITY, SECOND_ACTIVITY];
    await store.applyRemoteItem(envelope(), newerPayload);
    await store.applyRemoteItem(envelope(2), payload());

    const result = await db.query<{ data: unknown }>('SELECT data FROM tracker_items WHERE id = $1', ['bug-1']);
    const data = parseData(result.rows[0].data);
    expect(data.comments).toEqual([...COMMENTS, SECOND_COMMENT]);
    expect(data.activity).toEqual([...ACTIVITY, SECOND_ACTIVITY]);
  });

  it('does not let a metadata ack erase the item body', async () => {
    await expectBodySurvivesMetadataAck(db as any, store);
  });

  it('keeps the issue key in the column only, through applyRemoteItem', async () => {
    await expectIssueKeyStoredOnceOnly(
      db as any,
      () => store.applyRemoteItem({ ...envelope(), issueNumber: 42, issueKey: 'NIM-42' }, payload()),
      'NIM-42',
      42,
    );
  });

  it('keeps the issue key in the column only, through applyOptimistic', async () => {
    await store.applyRemoteItem({ ...envelope(), issueNumber: 42, issueKey: 'NIM-42' }, payload());
    await expectIssueKeyStoredOnceOnly(
      db as any,
      () => store.applyOptimistic('bug-1', payload()),
      'NIM-42',
      42,
    );
  });

  it('does not leak a legacy row\'s stale blob key into customFields', async () => {
    await expectStaleBlobKeyNotLeakedToCustomFields(db as any, store);
  });

  it('gives the room\'s key to the item the room allocated it to', async () => {
    await expectIncomingKeyWinsCollision(db as any, store);
  });

  it('lets one number carry two prefixes', async () => {
    await expectSameNumberDifferentPrefixCoexists(db as any, store);
  });

  it('repairs a legacy blob copy but spares a collision-stranded row', async () => {
    await expectRepairSparesStrandedRows(db as any, 'sqlite');
  });
});
