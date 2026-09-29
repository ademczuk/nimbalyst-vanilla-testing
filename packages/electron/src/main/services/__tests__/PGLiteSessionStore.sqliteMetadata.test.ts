// @vitest-environment node
/**
 * updateMetadata's in-SQL merge against a real better-sqlite3 backend, where
 * `metadata || $n` is translated to json_patch. The fake-db tests cannot show
 * that the translated statement actually runs and merges.
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', async () => ({
  app: {
    getPath: (await import('../../../../test-stubs/privateUserData')).testApp.getPath,
    getName: vi.fn(() => 'test-app'),
    getVersion: vi.fn(() => '1.0.0'),
    on: vi.fn(),
  },
}));

import { SQLiteDatabase } from '../../database/sqlite/SQLiteDatabase';
import { createPGLiteSessionStore } from '../PGLiteSessionStore';
import { OWNER_METADATA_MERGE_SQL } from '../extensionSessions/sessionOwnership';

let tmpDir: string;
let sqlite: SQLiteDatabase;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-meta-'));
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

it('merges overlapping metadata updates without losing either key', async () => {
  await sqlite.query(
    `INSERT INTO ai_sessions (id, provider, workspace_id, metadata) VALUES ('s1', 'claude-code', '/p', $1)`,
    [JSON.stringify({ tags: ['ai'] })],
  );
  const store = createPGLiteSessionStore(sqlite);
  await Promise.all([
    store.updateMetadata('s1', { metadata: { hasPendingPrompt: true } }),
    store.updateMetadata('s1', { metadata: { tokenUsage: { totalTokens: 5 } } }),
    store.updateMetadata('s1', { metadata: { phase: 'implementing' } }),
  ]);
  const { rows } = await sqlite.query<{ metadata: string }>(`SELECT metadata FROM ai_sessions WHERE id = 's1'`);
  const metadata = JSON.parse(rows[0].metadata);
  expect(metadata).toMatchObject({ tags: ['ai'], hasPendingPrompt: true, tokenUsage: { totalTokens: 5 }, phase: 'implementing' });
  expect(metadata.activity).toHaveLength(1);
});

// Ownership is assigned by the host at creation and is immutable afterwards;
// only the owning extension (through extensionSessionsService) edits its bag.
it('keeps extension ownership out of reach of ordinary metadata writes and re-creates', async () => {
  const owned = { sessionOwner: { extensionId: 'com.example.owner', key: 'ada' }, ownerMetadata: { chapter: 1 } };
  const store = createPGLiteSessionStore(sqlite);
  await store.create({ id: 's2', provider: 'claude-code', workspaceId: '/p', metadata: owned });

  await store.updateMetadata('s2', {
    metadata: { sessionOwner: { extensionId: 'com.evil', key: 'x' }, ownerMetadata: { chapter: 99 }, phase: 'planning' },
  });
  // A renderer re-issuing sessions:create for an existing id must not wipe the owner.
  await store.create({ id: 's2', provider: 'claude-code', workspaceId: '/p', metadata: { phase: 'implementing' } });

  const { rows } = await sqlite.query<{ metadata: string }>(`SELECT metadata FROM ai_sessions WHERE id = 's2'`);
  expect(JSON.parse(rows[0].metadata)).toMatchObject({ ...owned, phase: 'implementing' });

  // The owner's own bag write (merged in SQL) runs on this backend.
  await sqlite.query(OWNER_METADATA_MERGE_SQL, [JSON.stringify({ ownerMetadata: { chapter: 2 } }), 's2']);
  const after = await sqlite.query<{ metadata: string }>(`SELECT metadata FROM ai_sessions WHERE id = 's2'`);
  expect(JSON.parse(after.rows[0].metadata)).toMatchObject({ sessionOwner: owned.sessionOwner, ownerMetadata: { chapter: 2 } });
});
