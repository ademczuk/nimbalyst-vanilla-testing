// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MemoryEngine } from '../engine.js';
import type { EngineConfig, VirtualRecord } from '../types.js';
import { FakeEmbedder } from './fakeEmbedder.js';
import { SqliteStore } from '../store/sqliteStore.js';

const roots: string[] = [];
function tmpRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mem-vrec-'));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeEngine(root: string): MemoryEngine {
  const config: EngineConfig = {
    root,
    dbPath: path.join(root, 'index.db'),
    factsDir: 'facts',
    // One on-disk source class so we can prove the file pass never prunes records.
    sources: [{ sourceClass: 'docs', include: ['docs/**/*.md'] }],
  };
  return MemoryEngine.create(config, new FakeEmbedder());
}

function rec(id: string, title: string, text: string): VirtualRecord {
  return { id, sourceClass: 'trackers', refType: 'tracker', refId: id.replace(/^tracker:/, ''), title, text };
}

describe('MemoryEngine virtual records', () => {
  it('skips unchanged catalog writes and snapshots but publishes metadata changes and empty records', async () => {
    const engine = makeEngine(tmpRoot());
    const record = rec('record:catalog', 'Catalog', 'quartzorchid');
    try {
      await engine.ingestRecords([record]);
      const loads = vi.spyOn(SqliteStore.prototype, 'loadAll');
      const writes = vi.spyOn(SqliteStore.prototype, 'upsertChunks');
      try {
        expect(await engine.ingestRecords([record])).toEqual({ ingested: 0 });
        expect(writes).toHaveBeenCalledTimes(0);
        expect(loads).toHaveBeenCalledTimes(0);
        // Embedding count alone cannot detect a changed destination or pruning.
        expect(await engine.ingestRecords([{ ...record, refId: 'new-destination' }])).toEqual({ ingested: 0 });
        expect(loads).toHaveBeenCalledTimes(1);
        expect((await engine.search('quartzorchid'))[0].refId).toBe('new-destination');
        expect(await engine.ingestRecords([{ ...record, title: '', text: '' }])).toEqual({ ingested: 0 });
        expect(loads).toHaveBeenCalledTimes(2);
        expect(await engine.search('quartzorchid')).toEqual([]);
      } finally { loads.mockRestore(); writes.mockRestore(); }
    } finally { await engine.close(); }
  });

  it('does not repeatedly reload the whole catalog during an unchanged file pass, but publishes deletions', async () => {
    const root = tmpRoot();
    mkdirSync(path.join(root, 'docs'));
    for (let i = 0; i < 51; i++) {
      writeFileSync(path.join(root, `docs/${i}.md`), `# Document ${i}\nunchanged project content`);
    }
    writeFileSync(path.join(root, 'docs/gone.md'), '# Obsolete\nquartzorchid');
    const engine = makeEngine(root);
    try {
      await engine.ingestRecords([rec('record:kept', 'Retained record', 'violetcatalog')]);
      const initialLoads = vi.spyOn(SqliteStore.prototype, 'loadAll');
      try {
        await engine.indexAll();
        // New content is still published at each batch boundary and at finish.
        expect(initialLoads).toHaveBeenCalledTimes(3);
      } finally { initialLoads.mockRestore(); }
      rmSync(path.join(root, 'docs/gone.md'));
      const loads = vi.spyOn(SqliteStore.prototype, 'loadAll');
      try {
        expect(await engine.indexAll()).toEqual({ indexed: 0, files: 51 });
        // One final snapshot publishes pruning; unchanged batches must not
        // repeatedly deserialize every dense vector in the virtual catalog.
        expect(loads).toHaveBeenCalledTimes(1);
        expect((await engine.search('quartzorchid', 100)).some(hit => hit.sourcePath === 'docs/gone.md')).toBe(false);
        expect((await engine.search('violetcatalog', 100)).some(hit => hit.sourcePath === 'record:kept')).toBe(true);
      } finally { loads.mockRestore(); }
    } finally { await engine.close(); }
  });

  it('ingests records and finds them by hybrid search, carrying refType/refId', async () => {
    const engine = makeEngine(tmpRoot());
    await engine.ingestRecords([
      rec('tracker:NIM-1', 'Login crash on empty password', 'The auth form throws when the password field is blank.'),
      rec('tracker:NIM-2', 'Sourdough recipe', 'How to bake bread with a wild yeast starter.'),
    ]);

    const hits = await engine.search('authentication blank password bug', 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].refType).toBe('tracker');
    expect(hits[0].refId).toBe('NIM-1');
    await engine.close();
  });

  it('removeRecords drops a record from results; unknown ids are no-ops', async () => {
    const engine = makeEngine(tmpRoot());
    await engine.ingestRecords([rec('tracker:NIM-9', 'Unique marker zylophone', 'zylophone unique token body')]);
    expect((await engine.search('zylophone', 5)).length).toBe(1);

    engine.removeRecords(['tracker:does-not-exist']); // no-op
    expect((await engine.search('zylophone', 5)).length).toBe(1);

    engine.removeRecords(['tracker:NIM-9']);
    expect((await engine.search('zylophone', 5)).length).toBe(0);
    await engine.close();
  });

  it('re-embeds only changed records (dirty-check by content hash)', async () => {
    const engine = makeEngine(tmpRoot());
    const r1 = rec('tracker:A', 'Title A', 'body one');
    const r2 = rec('tracker:B', 'Title B', 'body two');
    expect((await engine.ingestRecords([r1, r2])).ingested).toBeGreaterThan(0);

    // Re-ingest unchanged → zero (re)embeds.
    expect((await engine.ingestRecords([r1, r2])).ingested).toBe(0);

    // Change one body → exactly that record re-embeds.
    const r2b = rec('tracker:B', 'Title B', 'body two CHANGED substantially');
    expect((await engine.ingestRecords([r1, r2b])).ingested).toBe(1);
    await engine.close();
  });

  it('a markdown re-index never prunes virtual records', async () => {
    const root = tmpRoot();
    mkdirSync(path.join(root, 'docs'), { recursive: true });
    writeFileSync(path.join(root, 'docs', 'a.md'), '# Doc\n\nsome file content here\n');

    const engine = makeEngine(root);
    await engine.indexAll();
    await engine.ingestRecords([rec('tracker:keep', 'Keep me', 'durable catalog record body')]);
    const present = async () =>
      (await engine.search('durable catalog record', 5)).some(
        (h) => h.refType === 'tracker' && h.refId === 'keep'
      );
    expect(await present()).toBe(true);

    // A full file re-index (which prunes deleted files) must leave the record intact.
    await engine.indexAll();
    expect(await present()).toBe(true);
    await engine.close();
  });
});
