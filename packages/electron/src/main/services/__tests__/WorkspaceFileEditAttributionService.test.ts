import { afterEach, describe, expect, it, vi } from 'vitest';

const { matchWorkspaceFileEdit, addFileLink, debug, getGitFactsForFile } = vi.hoisted(() => ({
  matchWorkspaceFileEdit: vi.fn(),
  addFileLink: vi.fn(),
  debug: vi.fn(),
  getGitFactsForFile: vi.fn(),
}));

vi.mock('../../history/fileGitFacts', () => ({
  getGitFactsForFile,
  UNKNOWN_GIT_FACTS: { isTracked: null, isUncommitted: null },
}));

vi.mock('@nimbalyst/runtime', () => ({
  SessionFilesRepository: { addFileLink },
}));

vi.mock('../../HistoryManager', () => ({
  historyManager: { createTag: vi.fn() },
}));

vi.mock('../../file/WorkspaceEventBus', () => ({
  getSubscriberIds: vi.fn(() => ['legacy-session']),
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    main: { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

vi.mock('../../utils/fileFilters', () => ({
  pathContainsExcludedDir: vi.fn(() => false),
}));

vi.mock('../SessionEditQuota', () => ({
  sessionEditQuota: { tryReserve: vi.fn(() => Promise.resolve(true)) },
}));

vi.mock('../WorkspaceAttributionThrottle', () => ({
  workspaceAttributionThrottle: { tryAcquire: vi.fn(() => true) },
}));

vi.mock('../ToolCallMatcher', () => ({
  toolCallMatcher: { matchWorkspaceFileEdit },
}));

vi.mock('../CodexEditWindowRegistry', () => ({
  codexEditWindowRegistry: {
    findWindowForEdit: vi.fn(() => null),
    recordObservation: vi.fn(),
  },
}));

vi.mock('../sessionFilesNotify', () => ({
  notifySessionFilesUpdated: vi.fn(),
}));

import { workspaceFileAttributionPolicy } from '../WorkspaceFileAttributionPolicy';
import { workspaceFileEditAttributionService } from '../WorkspaceFileEditAttributionService';

describe('WorkspaceFileEditAttributionService', () => {
  afterEach(() => {
    workspaceFileAttributionPolicy.__resetForTests();
    matchWorkspaceFileEdit.mockReset();
    addFileLink.mockReset();
    debug.mockReset();
  });

  it('drops pooled listener events workspace-wide while app-server attribution is disabled', async () => {
    workspaceFileAttributionPolicy.set('app-server-session', '/workspace', 'disabled');

    workspaceFileEditAttributionService.ingestWatcherEvent({
      workspacePath: '/workspace',
      filePath: '/workspace/src/app.ts',
      timestamp: Date.now(),
      beforeContent: 'before',
    });

    await vi.waitFor(() => {
      expect(debug).toHaveBeenCalledWith(
        '[WorkspaceFileEditAttributionService] Listener attribution disabled for workspace:',
        expect.objectContaining({ filePath: '/workspace/src/app.ts' }),
      );
    });
    expect(matchWorkspaceFileEdit).not.toHaveBeenCalled();
    expect(addFileLink).not.toHaveBeenCalled();
  });
});

/**
 * The already-landed guard suppresses a pending tag for content a merge or
 * checkout has already written. It has to ask git about the repo that owns the
 * file: a project can span several folders, and a root can be a container of
 * checkouts rather than a repo itself, so relativizing against the workspace
 * path answers about the wrong repo — or, when the root has no `.git` at all,
 * answers nothing and turns the guard into a permanent no-op.
 */
describe('WorkspaceFileEditAttributionService.alreadyLandedInGit', () => {
  afterEach(() => {
    getGitFactsForFile.mockReset();
  });

  it('asks git about the file, not the workspace root', async () => {
    getGitFactsForFile.mockResolvedValue({ isTracked: true, isUncommitted: false });

    const landed = await (workspaceFileEditAttributionService as any).alreadyLandedInGit({
      workspacePath: '/proj/primary',
      filePath: '/elsewhere/attached-repo/src/a.ts',
      timestamp: Date.now(),
    });

    expect(getGitFactsForFile).toHaveBeenCalledWith('/elsewhere/attached-repo/src/a.ts');
    expect(landed).toBe(true);
  });

  it('does not claim a tracked-but-modified file has landed', async () => {
    getGitFactsForFile.mockResolvedValue({ isTracked: true, isUncommitted: true });

    await expect(
      (workspaceFileEditAttributionService as any).alreadyLandedInGit({
        workspacePath: '/proj/primary',
        filePath: '/proj/primary/src/a.ts',
        timestamp: Date.now(),
      }),
    ).resolves.toBe(false);
  });

  it('answers false when git could not answer, so a live diff is never suppressed', async () => {
    getGitFactsForFile.mockResolvedValue({ isTracked: null, isUncommitted: null });

    await expect(
      (workspaceFileEditAttributionService as any).alreadyLandedInGit({
        workspacePath: '/proj/primary',
        filePath: '/proj/primary/src/a.ts',
        timestamp: Date.now(),
      }),
    ).resolves.toBe(false);
  });
});
