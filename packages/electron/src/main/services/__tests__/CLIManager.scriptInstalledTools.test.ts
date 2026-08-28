// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const {
  execSyncMock,
  execMock,
  spawnMock,
  safeHandleMock,
  existsSyncMock,
  simpleGitMock,
} = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
  execMock: vi.fn((_command: string, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    callback(new Error('offline'), '', '');
  }),
  spawnMock: vi.fn(),
  safeHandleMock: vi.fn(),
  existsSyncMock: vi.fn((_p: string) => false),
  simpleGitMock: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: vi.fn() },
}));

vi.mock('child_process', () => ({
  spawn: spawnMock,
  exec: execMock,
  execSync: execSyncMock,
}));

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  constants: { R_OK: 4 },
}));

vi.mock('../WindowsPathResolver', () => ({
  findExecutableInWindowsPath: vi.fn(),
  getEnhancedWindowsPath: vi.fn(() => ''),
}));

vi.mock('../../utils/ipcRegistry', () => ({ safeHandle: safeHandleMock }));
vi.mock('../../utils/store', () => ({ getAppSetting: vi.fn(() => null) }));
vi.mock('../services/analytics/AnalyticsService.ts', () => ({
  AnalyticsService: { getInstance: () => ({ sendEvent: vi.fn() }) },
}));
vi.mock('simple-git', () => ({ simpleGit: simpleGitMock }));

import * as os from 'os';
import * as path from 'path';
import { CLIManager } from '../CLIManager';

/** A spawn stub that answers `--version` with `output` and exit code 0. */
function spawnVersion(output: string) {
  let stdoutHandler: ((data: string) => void) | undefined;
  let closeHandler: ((code: number) => void) | undefined;
  const child = {
    stdout: { on: vi.fn((e: string, h: (d: string) => void) => { if (e === 'data') stdoutHandler = h; }) },
    stderr: { on: vi.fn() },
    on: vi.fn((e: string, h: (...args: any[]) => void) => {
      if (e === 'close') closeHandler = h as (code: number) => void;
    }),
    kill: vi.fn(),
  };
  queueMicrotask(() => {
    stdoutHandler?.(output);
    closeHandler?.(0);
  });
  return child as any;
}

describe('CLIManager script-installed tools', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    simpleGitMock.mockReturnValue({ version: vi.fn().mockResolvedValue({ installed: false }) });
    execSyncMock.mockReset();
    spawnMock.mockReset();
    existsSyncMock.mockReset();
    existsSyncMock.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
  });

  it('detects a vendor-installed CLI that is absent from PATH', async () => {
    // The whole point of the extra-locations probe: GUI-launched Electron does
    // not inherit a login shell, so `~/.local/bin` is routinely missing from
    // PATH while the tool works fine in the user's terminal.
    const grokPath = path.join(os.homedir(), '.grok', 'bin', 'grok');
    existsSyncMock.mockImplementation((p: string) => p === grokPath);
    spawnMock.mockImplementation((command: string) => {
      expect(command).toBe(grokPath);
      return spawnVersion('grok 1.0.5 (5115b46bc909)\n');
    });

    const result = await new CLIManager().checkInstallation('grok-build' as any);

    expect(result.installed).toBe(true);
    expect(result.version).toBe('1.0.5');
    expect(result.path).toBe(grokPath);
    // No npm registry to consult, so no phantom "update available" prompt.
    expect(result.updateAvailable).toBe(false);
  });

  it('refuses to install a script-only CLI and names the vendor command', async () => {
    execSyncMock.mockReturnValue('/usr/local/bin/npm\n');
    const manager = new CLIManager();

    await expect(manager.install('cursor-agent' as any)).rejects.toThrow(
      /not an npm package.*cursor\.com\/install/s
    );
    await expect(manager.upgrade('grok-build' as any)).rejects.toThrow(
      /not an npm package.*x\.ai\/cli\/install\.sh/s
    );
  });
});
