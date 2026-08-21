import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Hoisted mocks. The vi.mock factories below reference these handles, so they
// must come from vi.hoisted() to be available before module resolution.
const {
  trayInstance,
  menuBuildFromTemplate,
  nativeThemeOn,
  nativeThemeRemoveListener,
  systemPrefsSubscribe,
  systemPrefsUnsubscribe,
  browserGetAllWindows,
  findWindowByWorkspaceMock,
  loggerInfo,
  loggerError,
  loggerWarn,
  loggerDebug,
  managerSubscribe,
  updateMetadataMock,
  syncPushChange,
  syncProvider,
  setShowTrayIconMock,
} = vi.hoisted(() => ({
  trayInstance: {
    setImage: vi.fn(),
    setTitle: vi.fn(),
    setContextMenu: vi.fn(),
    setToolTip: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
  },
  menuBuildFromTemplate: vi.fn().mockReturnValue({}),
  nativeThemeOn: vi.fn(),
  nativeThemeRemoveListener: vi.fn(),
  systemPrefsSubscribe: vi.fn().mockReturnValue(42),
  systemPrefsUnsubscribe: vi.fn(),
  browserGetAllWindows: vi.fn<() => unknown[]>(() => []),
  findWindowByWorkspaceMock: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  loggerDebug: vi.fn(),
  managerSubscribe: vi.fn().mockReturnValue(() => {}),
  updateMetadataMock: vi.fn().mockResolvedValue(undefined),
  syncPushChange: vi.fn(),
  syncProvider: { pushChange: vi.fn() },
  setShowTrayIconMock: vi.fn(),
}));

syncProvider.pushChange = syncPushChange;

function createNativeImageMock() {
  return {
    isEmpty: () => false,
    setTemplateImage: vi.fn(),
    toBitmap: vi.fn(() => Buffer.alloc(32 * 32 * 4)),
  };
}

vi.mock('electron', () => ({
  Tray: vi.fn(function () {
    return trayInstance;
  }),
  Menu: { buildFromTemplate: menuBuildFromTemplate },
  app: {
    dock: undefined,
    on: vi.fn(),
    isReady: () => true,
  },
  nativeImage: {
    createFromPath: vi.fn().mockImplementation(() => createNativeImageMock()),
    createFromBuffer: vi.fn().mockImplementation(() => createNativeImageMock()),
  },
  nativeTheme: {
    on: nativeThemeOn,
    removeListener: nativeThemeRemoveListener,
    shouldUseDarkColors: false,
  },
  systemPreferences: {
    subscribeNotification: systemPrefsSubscribe,
    unsubscribeNotification: systemPrefsUnsubscribe,
  },
  BrowserWindow: { getAllWindows: browserGetAllWindows },
}));

vi.mock('@nimbalyst/runtime/ai/server/SessionStateManager', () => ({
  getSessionStateManager: vi.fn(() => ({ subscribe: managerSubscribe })),
}));

vi.mock('@nimbalyst/runtime/storage/repositories/AISessionsRepository', () => ({
  AISessionsRepository: {
    updateMetadata: updateMetadataMock,
  },
}));

vi.mock('../../window/WindowManager', () => ({
  findWindowByWorkspace: findWindowByWorkspaceMock,
}));

vi.mock('../../utils/appPaths', () => ({
  getPackageRoot: vi.fn(() => '/fake/package/root'),
}));

vi.mock('../../utils/store', () => ({
  isShowTrayIcon: vi.fn(() => false), // skip createTray for simplicity
  setShowTrayIcon: setShowTrayIconMock,
  getSessionSyncConfig: vi.fn(() => ({})),
  setSessionSyncConfig: vi.fn(),
  getTheme: vi.fn(() => 'dark'),
  getTrayPanelWidth: vi.fn(() => undefined),
  setTrayPanelWidth: vi.fn(),
}));

// The tray panel is macOS-only; these tests run on whatever platform CI uses, so
// pin it off unless a test opts in. That keeps the native-menu assertions below
// exercising the `setContextMenu` path they were written against.
vi.mock('../../window/TrayPanelWindow', () => ({
  isTrayPanelSupported: vi.fn(() => false),
  isTrayPanelWindow: vi.fn(() => false),
  toggleTrayPanelWindow: vi.fn(),
  pushTrayPanelFeed: vi.fn(),
  closeTrayPanelWindow: vi.fn(),
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

vi.mock('../../services/PowerSaveService', () => ({
  isPreventingSleep: vi.fn(() => false),
  getSleepPreventionMode: vi.fn(() => 'auto'),
}));

vi.mock('../../services/SyncManager', () => ({
  updateSleepPrevention: vi.fn(),
  resolvePreventSleepMode: vi.fn(() => 'auto'),
  getSyncProvider: vi.fn(() => syncProvider),
}));

// Suppress the database-seed query in initialize() by stubbing it.
vi.mock('../TrayManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../TrayManager')>();
  return actual; // we want the real TrayManager; nothing to override at module level
});

import { TrayManager, groupTraySessions } from '../TrayManager';

function resetSingleton() {
  // Reset the private singleton between tests so each it() runs against a
  // fresh instance. The TrayManager class uses a static `instance` field,
  // so we have to clear it via the constructor cache.
  (TrayManager as unknown as { instance?: TrayManager }).instance = undefined;
}

function stubPlatform(value: NodeJS.Platform): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value, configurable: true });
  return () => Object.defineProperty(process, 'platform', original);
}

describe('TrayManager - cross-platform initialisation (#39)', () => {
  let restorePlatform: () => void = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
    resetSingleton();
    delete process.env.PLAYWRIGHT;
  });

  afterEach(() => {
    restorePlatform();
  });

  it('does not return early on Linux', async () => {
    restorePlatform = stubPlatform('linux');
    const tm = TrayManager.getInstance();
    // Provide a database stub so seedUnreadFromDatabase doesn't blow up.
    tm.setDatabase({ query: vi.fn().mockResolvedValue({ rows: [] }) });

    await tm.initialize();

    // The "Skipping initialization on non-macOS platform" log used to fire
    // here. With the fix, only the routine "Initialized" line should land.
    const logged = loggerInfo.mock.calls.map(c => c[0]).join('\n');
    expect(logged).not.toContain('Skipping initialization on non-macOS platform');
    expect(logged).toContain('[TrayManager] Initialized');

    // Cross-platform listener is subscribed.
    expect(nativeThemeOn).toHaveBeenCalledWith('updated', expect.any(Function));
    // macOS-only listener is NOT subscribed on Linux.
    expect(systemPrefsSubscribe).not.toHaveBeenCalled();
  });

  it('does not return early on Windows', async () => {
    restorePlatform = stubPlatform('win32');
    const tm = TrayManager.getInstance();
    tm.setDatabase({ query: vi.fn().mockResolvedValue({ rows: [] }) });

    await tm.initialize();

    const logged = loggerInfo.mock.calls.map(c => c[0]).join('\n');
    expect(logged).not.toContain('Skipping initialization on non-macOS platform');
    expect(logged).toContain('[TrayManager] Initialized');

    expect(nativeThemeOn).toHaveBeenCalledWith('updated', expect.any(Function));
    expect(systemPrefsSubscribe).not.toHaveBeenCalled();
  });

  it('still subscribes the macOS appearance notification on darwin', async () => {
    restorePlatform = stubPlatform('darwin');
    const tm = TrayManager.getInstance();
    tm.setDatabase({ query: vi.fn().mockResolvedValue({ rows: [] }) });

    await tm.initialize();

    expect(nativeThemeOn).toHaveBeenCalledWith('updated', expect.any(Function));
    expect(systemPrefsSubscribe).toHaveBeenCalledWith(
      'AppleInterfaceThemeChangedNotification',
      expect.any(Function),
    );
  });
});

describe('TrayManager unread actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSingleton();
    browserGetAllWindows.mockReturnValue([]);
    findWindowByWorkspaceMock.mockReturnValue(undefined);
  });

  it('adds a Clear All Unread menu item and clears unread sessions through the shared read-state path', async () => {
    const tm = TrayManager.getInstance();
    const unreadA = {
      sessionId: 's1',
      title: 'Unread One',
      workspacePath: '/workspace/a',
      status: 'completed',
      isStreaming: false,
      hasPendingPrompt: false,
      hasUnread: true,
    };
    const unreadB = {
      sessionId: 's2',
      title: 'Unread Two',
      workspacePath: '/workspace/b',
      status: 'completed',
      isStreaming: false,
      hasPendingPrompt: false,
      hasUnread: true,
    };

    (tm as any).sessionCache.set(unreadA.sessionId, unreadA);
    (tm as any).sessionCache.set(unreadB.sessionId, unreadB);

    tm.setVisible(true);

    const menuItems = menuBuildFromTemplate.mock.calls.at(-1)?.[0];
    const clearAllItem = menuItems.find((item: any) => item.label === 'Clear All Unread');

    expect(clearAllItem).toBeTruthy();

    clearAllItem.click();

    await vi.waitFor(() => {
      expect(updateMetadataMock).toHaveBeenCalledTimes(2);
    });

    expect(updateMetadataMock).toHaveBeenNthCalledWith(1, 's1', {
      metadata: expect.objectContaining({ hasUnread: false, lastReadAt: expect.any(Number) }),
    });
    expect(updateMetadataMock).toHaveBeenNthCalledWith(2, 's2', {
      metadata: expect.objectContaining({ hasUnread: false, lastReadAt: expect.any(Number) }),
    });
    expect(syncPushChange).toHaveBeenCalledTimes(2);
    expect((tm as any).sessionCache.size).toBe(0);
    expect(browserGetAllWindows).toHaveBeenCalled();
  });

  it('clears unread when clicking a tray session and notifies the renderer immediately', async () => {
    const tm = TrayManager.getInstance();
    const targetWindow = {
      isDestroyed: vi.fn(() => false),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { send: vi.fn() },
    };
    browserGetAllWindows.mockReturnValue([targetWindow as any]);
    findWindowByWorkspaceMock.mockReturnValue(targetWindow);

    (tm as any).sessionCache.set('s1', {
      sessionId: 's1',
      title: 'Unread One',
      workspacePath: '/workspace/a',
      status: 'completed',
      isStreaming: false,
      hasPendingPrompt: false,
      hasUnread: true,
    });

    tm.setVisible(true);

    const menuItems = menuBuildFromTemplate.mock.calls.at(-1)?.[0];
    const unreadItem = menuItems.find((item: any) => item.label === 'Unread One');

    unreadItem.click();

    await vi.waitFor(() => {
      expect(updateMetadataMock).toHaveBeenCalledWith('s1', {
        metadata: expect.objectContaining({ hasUnread: false, lastReadAt: expect.any(Number) }),
      });
    });

    expect(targetWindow.show).toHaveBeenCalled();
    expect(targetWindow.focus).toHaveBeenCalled();
    expect(targetWindow.webContents.send).toHaveBeenNthCalledWith(1, 'tray:navigate-to-session', {
      sessionId: 's1',
      workspacePath: '/workspace/a',
    });
    expect(targetWindow.webContents.send).toHaveBeenNthCalledWith(2, 'tray:clear-unread', {
      sessions: [
        {
          sessionId: 's1',
          workspacePath: '/workspace/a',
          lastReadAt: expect.any(Number),
        },
      ],
    });
    expect((tm as any).sessionCache.size).toBe(0);
  });
});

describe('groupTraySessions', () => {
  const base = {
    workspacePath: '/Users/dev/projects/nimbalyst',
    isStreaming: false,
    hasPendingPrompt: false,
    hasUnread: false,
    provider: 'claude-code',
    model: 'claude-code:opus-1m',
  };

  it('buckets a mixed cross-workspace set the way the in-app popover does', () => {
    const feed = groupTraySessions([
      { ...base, sessionId: 'blocked', title: 'Blocked', status: 'running', hasPendingPrompt: true, updatedAt: 500 },
      { ...base, sessionId: 'errored', title: 'Errored', status: 'error', updatedAt: 400 },
      { ...base, sessionId: 'running', title: 'Running', status: 'running', isStreaming: true, updatedAt: 300 },
      { ...base, sessionId: 'unread', title: 'Unread', status: 'completed', hasUnread: true, updatedAt: 200 },
      { ...base, sessionId: 'quiet', title: 'Quiet', status: 'completed', updatedAt: 100 },
    ] as any);

    // `error` folds into Needs Attention -- the tray's one intended divergence
    // from the popover, which has no error state of its own.
    expect(feed.needsAttention.map((s) => s.sessionId)).toEqual(['blocked', 'errored']);
    expect(feed.running.map((s) => s.sessionId)).toEqual(['running']);
    expect(feed.unread.map((s) => s.sessionId)).toEqual(['unread']);
    // A completed, read, unblocked session belongs in no bucket at all.
    expect(feed.needsAttention.concat(feed.running, feed.unread)
      .some((s) => s.sessionId === 'quiet')).toBe(false);
  });

  // An agent sets phase 'complete' just before its closing output, which is what
  // flags the session unread -- so `complete` may only suppress the running
  // bucket, never an unread or prompting one. Mirrors agentSessionAttentionAtom.
  it('excludes archived sessions, and lets complete-phase suppress only Running', () => {
    const feed = groupTraySessions([
      { ...base, sessionId: 'archived', title: 'Archived', status: 'completed', hasUnread: true, isArchived: true, updatedAt: 4 },
      { ...base, sessionId: 'done-streaming', title: 'Done streaming', status: 'running', phase: 'complete', updatedAt: 3 },
      { ...base, sessionId: 'done-prompting', title: 'Done prompting', status: 'running', hasPendingPrompt: true, phase: 'complete', updatedAt: 2 },
      { ...base, sessionId: 'done-unread', title: 'Done unread', status: 'completed', hasUnread: true, phase: 'complete', updatedAt: 1 },
    ] as any);

    expect(feed.needsAttention.map((s) => s.sessionId)).toEqual(['done-prompting']);
    expect(feed.running).toEqual([]);
    expect(feed.unread.map((s) => s.sessionId)).toEqual(['done-unread']);
  });

  it('sorts newest first and derives the workspace chip from the path', () => {
    const feed = groupTraySessions([
      { ...base, sessionId: 'older', title: 'Older', status: 'running', updatedAt: 10 },
      { ...base, sessionId: 'newer', title: 'Newer', status: 'running', workspacePath: '/Users/dev/projects/other', updatedAt: 99 },
    ] as any);

    expect(feed.running.map((s) => s.sessionId)).toEqual(['newer', 'older']);
    expect(feed.running.map((s) => s.workspaceName)).toEqual(['other', 'nimbalyst']);
  });
});
