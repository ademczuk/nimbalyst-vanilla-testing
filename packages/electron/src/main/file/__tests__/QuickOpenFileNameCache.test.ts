// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { QuickOpenFileNameCache } from '../QuickOpenFileNameCache';
import { mkdtemp, mkdir, writeFile, rename, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const file = (path: string) => ({ path, name: path.split('/').at(-1)!, type: 'file' as const });
afterEach(() => vi.useRealTimers());

it('rescans real disk files while preserving ignored-file, binary and local-plan filtering', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nimbalyst-1596-'));
  const cache = new QuickOpenFileNameCache();
  try {
    await mkdir(join(root, '.git'));
    await writeFile(join(root, '.gitignore'), 'ignored/\nnimbalyst-local/\n');
    await mkdir(join(root, 'ignored'));
    await writeFile(join(root, 'ignored', 'hidden.md'), 'hidden');
    await mkdir(join(root, 'nimbalyst-local'));
    await writeFile(join(root, 'nimbalyst-local', 'plan.md'), 'plan');
    await writeFile(join(root, 'archive.zip'), 'binary');
    const initial = (await cache.get(root)).map(item => item.path);
    expect(initial).toContain(join(root, 'nimbalyst-local', 'plan.md'));
    expect(initial).not.toContain(join(root, 'ignored', 'hidden.md'));
    expect(initial).not.toContain(join(root, 'archive.zip'));

    await mkdir(join(root, 'created'));
    await writeFile(join(root, 'created', 'new.md'), 'new');
    cache.invalidate(root);
    const created = (await cache.get(root)).map(item => item.path);
    expect(created).toContain(join(root, 'created', 'new.md'));
    expect(created).toContain(join(root, 'created'));
    await rename(join(root, 'created'), join(root, 'renamed'));
    cache.invalidate(root);
    const renamed = (await cache.get(root)).map(item => item.path);
    expect(renamed).not.toContain(join(root, 'created', 'new.md'));
    expect(renamed).toContain(join(root, 'renamed', 'new.md'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('coalesces scans and retries when a creation arrives during the scan, isolating other roots', async () => {
  let finish!: (items: ReturnType<typeof file>[]) => void;
  const scan = vi.fn(async (root: string) => [file(`${root}/old.md`)]);
  const cache = new QuickOpenFileNameCache(scan);
  await cache.get('/other');
  scan.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = cache.get('/project');
  const second = cache.get('/project', true);
  await Promise.resolve();
  cache.invalidate('/project');
  scan.mockResolvedValue([file('/project/new.md')]);
  finish([file('/project/old.md')]);
  expect(await first).toEqual([file('/project/new.md')]);
  expect(await second).toEqual([file('/project/new.md')]);
  expect(scan).toHaveBeenCalledTimes(3);
  expect(await cache.get('/other')).toEqual([file('/other/old.md')]);
  expect(scan).toHaveBeenCalledTimes(3);
});

it('retries failed scans, including refresh failures, without treating a failure as a fresh snapshot', async () => {
  const scan = vi.fn().mockRejectedValueOnce(new Error('scan failed')).mockResolvedValue([file('/project/old.md')]);
  const cache = new QuickOpenFileNameCache(scan);
  await expect(cache.get('/project')).rejects.toThrow('scan failed');
  expect(await cache.get('/project')).toEqual([file('/project/old.md')]);
  scan.mockRejectedValueOnce(new Error('refresh failed'));
  cache.invalidate('/project');
  await expect(cache.get('/project')).rejects.toThrow('refresh failed');
  scan.mockResolvedValue([file('/project/new.md')]);
  expect(await cache.get('/project')).toEqual([file('/project/new.md')]);
});

it('expires unwatched snapshots and caches empty roots without scanning on every query', async () => {
  vi.useFakeTimers();
  const scan = vi.fn().mockResolvedValue([]);
  const cache = new QuickOpenFileNameCache(scan);
  expect(await cache.get('/project')).toEqual([]);
  expect(await cache.get('/project')).toEqual([]);
  expect(scan).toHaveBeenCalledTimes(1);
  scan.mockResolvedValue([file('/project/new.md')]);
  vi.advanceTimersByTime(30_000);
  expect(await cache.get('/project')).toEqual([file('/project/new.md')]);
  expect(scan).toHaveBeenCalledTimes(2);
});

it('bounds rescans during continuous changes and keeps the snapshot dirty for the next search', async () => {
  const scan = vi.fn(async () => {
    cache.invalidate('/project');
    return [file(`/project/file-${scan.mock.calls.length}.md`)];
  });
  const cache = new QuickOpenFileNameCache(scan);
  expect(await cache.get('/project')).toEqual([file('/project/file-2.md')]);
  expect(scan).toHaveBeenCalledTimes(2);
  scan.mockImplementation(async () => [file('/project/settled.md')]);
  expect(await cache.get('/project')).toEqual([file('/project/settled.md')]);
  expect(scan).toHaveBeenCalledTimes(3);
});
