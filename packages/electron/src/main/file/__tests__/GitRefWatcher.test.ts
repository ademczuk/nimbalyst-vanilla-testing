import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';

// Hoisted mocks: simple-git fakes that individual tests can wire per scenario,
// plus logger fakes that the vi.mock factory below references. Hoisting is
// required because vi.mock factories run before any non-hoisted top-level
// statements.
const {
  mockStatus,
  mockLog,
  loggerInfo,
  loggerError,
  loggerWarn,
  loggerDebug,
  mockWatchFile,
  mockUnwatchFile,
} = vi.hoisted(() => ({
  mockStatus: vi.fn(),
  mockLog: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  loggerDebug: vi.fn(),
  mockWatchFile: vi.fn(),
  mockUnwatchFile: vi.fn(),
}));

vi.mock('simple-git', () => ({
  default: () => ({
    status: mockStatus,
    log: mockLog,
  }),
}));

// Pretend `<workspace>/.git` is a regular directory.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    watchFile: mockWatchFile,
    unwatchFile: mockUnwatchFile,
    promises: {
      ...actual.promises,
      stat: vi.fn().mockResolvedValue({
        isDirectory: () => true,
        isFile: () => false,
      }),
      readFile: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    main: {
      info: loggerInfo,
      error: loggerError,
      warn: loggerWarn,
      debug: loggerDebug,
    },
  },
}));

vi.mock('../../ipc/GitStatusHandlers', () => ({
  clearGitStatusCache: vi.fn(),
}));

import { GitRefWatcher } from '../GitRefWatcher';

describe('GitRefWatcher.start - empty repo handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips cleanly when git.log throws "does not have any commits yet"', async () => {
    mockStatus.mockResolvedValue({ current: 'master' });
    mockLog.mockRejectedValue(
      new Error("fatal: your current branch 'master' does not have any commits yet"),
    );

    const watcher = new GitRefWatcher();
    await expect(watcher.start('/fake/workspace')).resolves.toBeUndefined();

    expect(loggerInfo).toHaveBeenCalledWith(
      '[GitRefWatcher] Skipping workspace with no commits yet:',
      'workspace',
    );
    // The fresh-init path must NOT log via logger.error -- that was the
    // original symptom (multi-line stack trace in main.log).
    expect(loggerError).not.toHaveBeenCalled();

    expect(watcher.getStats().activeWatchers).toBe(0);
  });

  it('still logs error and skips when git.log throws an unrelated message', async () => {
    mockStatus.mockResolvedValue({ current: 'master' });
    mockLog.mockRejectedValue(new Error('unexpected git failure'));

    const watcher = new GitRefWatcher();
    await watcher.start('/fake/workspace');

    // The outer catch in start() handles all other errors and logs them.
    expect(loggerError).toHaveBeenCalledWith(
      '[GitRefWatcher] Failed to start watching:',
      expect.any(Error),
    );
    expect(watcher.getStats().activeWatchers).toBe(0);
  });

  it('skips detached HEAD workspaces (existing behavior preserved)', async () => {
    mockStatus.mockResolvedValue({ current: undefined });

    const watcher = new GitRefWatcher();
    await watcher.start('/fake/workspace');

    expect(loggerInfo).toHaveBeenCalledWith(
      '[GitRefWatcher] Skipping detached HEAD workspace:',
      '/fake/workspace',
    );
    expect(watcher.getStats().activeWatchers).toBe(0);
  });

  it('uses native file polling for git ref and index files', async () => {
    mockStatus.mockResolvedValue({ current: 'master' });
    mockLog.mockResolvedValue({ latest: { hash: 'abc123', message: 'Initial commit' } });

    const watcher = new GitRefWatcher();
    await watcher.start('/fake/workspace');

    // HEAD is watched alongside the branch ref: without it the ref watcher
    // stays pinned to whichever branch was current at start(), so after a
    // checkout no commit on the new branch is ever detected (#1403).
    const watched = [
      path.join('/fake/workspace', '.git', 'refs', 'heads', 'master'),
      path.join('/fake/workspace', '.git', 'index'),
      path.join('/fake/workspace', '.git', 'HEAD'),
    ];
    expect(mockWatchFile.mock.calls.map((call) => call[0])).toEqual(watched);
    expect(watcher.getStats().activeWatchers).toBe(1);

    await watcher.stop('/fake/workspace');

    expect(mockUnwatchFile.mock.calls.map((call) => call[0])).toEqual(watched);
    expect(watcher.getStats().activeWatchers).toBe(0);
  });

  it('re-points the ref watcher at the new branch when HEAD moves', async () => {
    mockStatus.mockResolvedValue({ current: 'master' });
    mockLog.mockResolvedValue({ latest: { hash: 'abc123', message: 'Initial commit' } });

    const watcher = new GitRefWatcher();
    await watcher.start('/fake/workspace');

    const headListener = mockWatchFile.mock.calls.find(
      (call) => call[0] === path.join('/fake/workspace', '.git', 'HEAD'),
    )?.[2];
    expect(headListener).toBeTypeOf('function');

    mockStatus.mockResolvedValue({ current: 'feature' });
    mockLog.mockResolvedValue({ latest: { hash: 'def456', message: 'On feature' } });

    // fs.watchFile hands the listener (curr, prev) stats; only a real change counts.
    await headListener!({ mtimeMs: 2, ctimeMs: 2, size: 1, ino: 1, nlink: 1 }, { mtimeMs: 1, ctimeMs: 1, size: 1, ino: 1, nlink: 1 });

    expect(mockUnwatchFile.mock.calls.map((call) => call[0])).toContain(
      path.join('/fake/workspace', '.git', 'refs', 'heads', 'master'),
    );
    expect(mockWatchFile.mock.calls.map((call) => call[0])).toContain(
      path.join('/fake/workspace', '.git', 'refs', 'heads', 'feature'),
    );
  });
});
