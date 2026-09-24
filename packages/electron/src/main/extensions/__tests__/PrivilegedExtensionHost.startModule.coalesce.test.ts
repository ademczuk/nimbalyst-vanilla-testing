// @vitest-environment node
/**
 * Unit test for startModule concurrency coalescing.
 *
 * A single start attempt can park on an async consent/trust prompt
 * ('awaiting-consent'), which the running/starting fast-paths do NOT treat as
 * in-flight. Two near-simultaneous callers (the set-enable IPC and the
 * workspace-open sweep) would then each launch a runtime — double-spawning the
 * utility process. startModule now tracks the in-flight attempt on
 * `managed.startInFlight` so later concurrent callers await it instead.
 *
 * This drives the real startModule but stubs the extracted `runStartAttempt`
 * (the trust→consent→spawn body) with a controllable deferred, so the test is
 * fast and asserts exactly the coalescing decision.
 *
 * Run from repo root:
 *   npx vitest --run packages/electron/src/main/extensions/__tests__/PrivilegedExtensionHost.startModule.coalesce.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { utilityProcess } from 'electron';

vi.mock('electron', async () => {
  const noop = () => {};
  return {
    app: {
      on: vi.fn(), once: vi.fn(), whenReady: vi.fn(() => Promise.resolve()),
      getPath: (await import('../../../../test-stubs/privateUserData')).testApp.getPath, getName: vi.fn(() => 'test-app'),
      getVersion: vi.fn(() => '1.0.0'), setName: vi.fn(), setPath: vi.fn(), quit: vi.fn(),
      requestSingleInstanceLock: vi.fn(() => true), commandLine: { appendSwitch: vi.fn() },
      isPackaged: false, isReady: () => true,
    },
    BrowserWindow: class FakeBrowserWindow {
      static fromWebContents = vi.fn(() => null);
      static getFocusedWindow = vi.fn(() => null);
      static getAllWindows = vi.fn(() => []);
      on = noop;
    },
    ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
    ipcRenderer: { send: vi.fn(), on: vi.fn(), invoke: vi.fn() },
    dialog: { showMessageBox: vi.fn(), showOpenDialog: vi.fn() },
    screen: { getPrimaryDisplay: vi.fn(() => ({ workAreaSize: { width: 1920, height: 1080 } })), on: vi.fn() },
    nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
    nativeImage: { createFromPath: vi.fn(() => ({})), createEmpty: vi.fn(() => ({})) },
    Menu: class FakeMenu { static setApplicationMenu = vi.fn(); static buildFromTemplate = vi.fn(); },
    shell: { openExternal: vi.fn() },
    utilityProcess: { fork: vi.fn() },
  };
});

import { PrivilegedExtensionHost, type StartModuleArgs } from '../PrivilegedExtensionHost';

const ARGS: StartModuleArgs = {
  extensionId: 'com.nimbalyst.memory',
  extensionName: 'Nimbalyst Memory',
  extensionPath: '/x',
  module: { id: 'memory-engine', entry: 'dist/backend.js', runtime: 'utility-process', permissions: [], enablement: { default: 'disabled', promptOn: 'firstUse', purpose: 'test' } } as any,
  workspacePath: '/ws',
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('PrivilegedExtensionHost.startModule coalescing', () => {
  let host: PrivilegedExtensionHost;

  beforeEach(() => {
    vi.clearAllMocks();
    host = new PrivilegedExtensionHost();
  });

  it('coalesces concurrent starts into a single attempt, but runs sequential starts separately', async () => {
    const gate = deferred<void>();
    const runHandle = { extensionId: ARGS.extensionId, moduleId: ARGS.module.id, workspacePath: ARGS.workspacePath, state: { status: 'running', startedAt: 0, methods: [] } };
    const runStartAttempt = vi.fn(async () => {
      await gate.promise;
      return runHandle;
    });
    (host as unknown as { runStartAttempt: unknown }).runStartAttempt = runStartAttempt;

    // Two concurrent callers for the SAME module.
    const p1 = host.startModule(ARGS);
    const p2 = host.startModule(ARGS);

    // Only one attempt launched; the second coalesced onto the same promise.
    expect(runStartAttempt).toHaveBeenCalledTimes(1);

    gate.resolve();
    const [h1, h2] = await Promise.all([p1, p2]);
    expect(h1).toBe(runHandle);
    expect(h2).toBe(runHandle);

    // After completion the in-flight latch is cleared, so a later start re-attempts.
    const gate2 = deferred<void>();
    runStartAttempt.mockImplementationOnce(async () => {
      await gate2.promise;
      return runHandle;
    });
    const p3 = host.startModule(ARGS);
    expect(runStartAttempt).toHaveBeenCalledTimes(2);
    gate2.resolve();
    await p3;
  });
});

it('ignores a stopped process reporting messages or exit after its replacement starts', async () => {
  const host = new PrivilegedExtensionHost();
  const children = [1, 2].map(pid => Object.assign(new EventEmitter(), {
    pid, postMessage: vi.fn(), kill: vi.fn(() => true),
  }));
  const fork = vi.mocked(utilityProcess.fork);
  for (const child of children) fork.mockReturnValueOnce(child as any);
  const internals = host as any;
  let spawned = 0;
  internals.runStartAttempt = async (managed: any) => {
    managed.state = { status: 'starting' };
    managed.runtime = internals.spawnUtilityProcess(managed, '/unused', {}, 'test');
    children[spawned++].emit('message', { kind: 'init-ack', methods: ['status'] });
    return internals.snapshot(managed);
  };
  await host.startModule(ARGS);
  await host.stopModule(ARGS.extensionId, ARGS.module.id, ARGS.workspacePath);
  await host.startModule(ARGS);
  children[0].emit('exit', 0);
  children[0].emit('message', { kind: 'init-ack', methods: ['stale'] });
  expect(host.getState(ARGS.extensionId, ARGS.module.id, ARGS.workspacePath)).toMatchObject({ status: 'running', methods: ['status'] });
  const managed = [...internals.modules.values()][0] as any;
  expect(managed.runtime?.isAlive()).toBe(true);
  children[1].emit('exit', 1);
  expect(host.getState(ARGS.extensionId, ARGS.module.id, ARGS.workspacePath)).toMatchObject({ status: 'crashed', exitCode: 1 });
});

it('bounds simultaneous runtime initialization and releases slots after failure', async () => {
  const host = new PrivilegedExtensionHost() as any;
  const pending: Array<() => void> = [];
  let active = 0;
  let peak = 0;
  host.resolveBootstrapPath = () => '/unused';
  host.buildRuntimeContext = () => ({});
  host.spawnUtilityProcess = vi.fn((managed: any) => {
    active++;
    peak = Math.max(peak, active);
    const number = host.spawnUtilityProcess.mock.calls.length;
    if (number === 5) {
      active--;
      throw new Error('Synthetic spawn failure');
    }
    pending.push(() => { active--; host.setState(managed, { status: 'running', startedAt: 0, methods: [] }); });
    return { send: vi.fn(), kill: vi.fn(), isAlive: () => true };
  });
  const starts = Array.from({ length: 12 }, (_, i) => host.spawnRuntime({
    args: { ...ARGS, workspacePath: `/ws/${i}` },
    state: { status: 'starting' }, pending: new Map(), grantedPermissions: [],
  }).catch((error: Error) => error.message));
  try {
    await vi.waitFor(() => expect(host.spawnUtilityProcess).toHaveBeenCalledTimes(4));
    expect(peak).toBe(4);
  } finally {
    // Drain even the failing (unbounded) implementation so the red run exits.
    while (host.spawnUtilityProcess.mock.calls.length < 12 || pending.length) {
      pending.splice(0).forEach(finish => finish());
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    await Promise.all(starts);
  }
  const results = await Promise.all(starts);
  expect(results.filter(Boolean)).toEqual(['Synthetic spawn failure']);
  expect(peak).toBe(4);
});

it('does not spawn a queued runtime after it is stopped', async () => {
  const host = new PrivilegedExtensionHost() as any;
  const pending: Array<() => void> = [];
  host.runStartAttempt = async (managed: any) => {
    managed.state = { status: 'starting' };
    await host.spawnRuntime(managed);
    return host.snapshot(managed);
  };
  host.initializeRuntime = vi.fn((managed: any) => new Promise<void>(resolve => {
    pending.push(() => { host.setState(managed, { status: 'running', startedAt: 0, methods: [] }); resolve(); });
  }));
  const starts = Array.from({ length: 5 }, (_, i) => host.startModule({ ...ARGS, workspacePath: `/queued/${i}` }));
  await vi.waitFor(() => expect(host.initializeRuntime).toHaveBeenCalledTimes(4));
  await host.stopModule(ARGS.extensionId, ARGS.module.id, '/queued/4');
  pending.splice(0).forEach(finish => finish());
  await Promise.all(starts);
  expect(host.initializeRuntime).toHaveBeenCalledTimes(4);
  expect(host.getState(ARGS.extensionId, ARGS.module.id, '/queued/4').status).toBe('stopped');
});
