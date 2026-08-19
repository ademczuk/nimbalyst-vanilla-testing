// @vitest-environment node
/**
 * The dangerous failure here is silent truncation: buildManifest turns this
 * result into the wire manifest, and a file missing from that manifest reads to
 * the sync server as "deleted". So the fallback path matters more than the fast
 * path — these tests pin that a broken worker still yields a COMPLETE, correct
 * result rather than a short one.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

vi.mock('electron', () => ({ app: { isPackaged: false } }));
vi.mock('../../utils/logger', () => ({
  logger: { main: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } },
}));
// Point the worker lookup at a directory with no bundle in it, so `new Worker()`
// throws and we exercise the inline fallback.
vi.mock('../../utils/appPaths', () => ({
  getPackageRoot: () => path.join(tmpdir(), 'nimbalyst-no-such-package-root'),
}));

import { hashProjectFiles } from '../ProjectManifestHasher';

let dir: string;
const files: string[] = [];

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'manifest-hasher-'));
  await mkdir(path.join(dir, 'nested'), { recursive: true });
  const fixtures: Array<[string, string]> = [
    ['a.md', '# A\n'],
    ['b.md', '# B\nsome body\n'],
    ['nested/c.md', 'nested content'],
    ['empty.md', ''],
    ['unicode.md', '# café — über\n'],
  ];
  for (const [rel, content] of fixtures) {
    const full = path.join(dir, rel);
    await writeFile(full, content, 'utf-8');
    files.push(full);
  }
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('hashProjectFiles', () => {
  it('returns a complete, correct result even when the worker cannot start', async () => {
    const results = await hashProjectFiles(files);

    // Completeness is the property that protects against phantom deletions.
    expect(results).toHaveLength(files.length);
    expect(results.map(r => r.filePath).sort()).toEqual([...files].sort());

    const byPath = new Map(results.map(r => [r.filePath, r]));
    expect(byPath.get(path.join(dir, 'a.md'))?.contentHash).toBe(sha256('# A\n'));
    expect(byPath.get(path.join(dir, 'b.md'))?.contentHash).toBe(sha256('# B\nsome body\n'));
    expect(byPath.get(path.join(dir, 'nested/c.md'))?.contentHash).toBe(sha256('nested content'));
    expect(byPath.get(path.join(dir, 'empty.md'))?.contentHash).toBe(sha256(''));
    expect(byPath.get(path.join(dir, 'unicode.md'))?.contentHash).toBe(sha256('# café — über\n'));

    for (const r of results) {
      expect(r.error).toBeUndefined();
      expect(typeof r.lastModifiedAt).toBe('number');
      expect(Number.isInteger(r.lastModifiedAt)).toBe(true);
    }
  });

  it('reports an unreadable file as an error entry instead of dropping it', async () => {
    const missing = path.join(dir, 'does-not-exist.md');
    const results = await hashProjectFiles([files[0], missing]);

    // Still 2 entries: buildManifest skips the errored one explicitly rather
    // than silently receiving a shorter list.
    expect(results).toHaveLength(2);
    const bad = results.find(r => r.filePath === missing);
    expect(bad?.error).toBeTruthy();
    expect(bad?.contentHash).toBeUndefined();
    expect(results.find(r => r.filePath === files[0])?.contentHash).toBe(sha256('# A\n'));
  });

  it('short-circuits an empty file list without touching the worker', async () => {
    await expect(hashProjectFiles([])).resolves.toEqual([]);
  });
});
