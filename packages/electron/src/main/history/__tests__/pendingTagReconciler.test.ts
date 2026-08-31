// @vitest-environment node
/**
 * Fact-gathering for the pending-tag retire decision (#1403). The pure rules
 * are pinned in pendingTagReconcile.test.ts; what this covers is the wiring the
 * rules depend on being fed correctly — real files on disk, the two git sets,
 * and the session-liveness guard.
 *
 * The case that matters most is `landed-in-git` vs `gitignored`: both are
 * absent from git's uncommitted set, and getting them confused either leaves
 * the reported stale diff bar in place or silently drops legitimate pending
 * reviews under an ignored directory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { HistoryManager, HistoryTag } from '../../HistoryManager';

const trackedFiles = vi.fn(async (_root: string) => new Set<string>());
const uncommittedFiles = vi.fn(async (_root: string) => new Set<string>());
const sessionSubscribed = vi.fn((_sessionId: string) => false);

vi.mock('../../utils/gitUncommittedFiles', () => ({
  getCachedTrackedFiles: (root: string) => trackedFiles(root),
  getCachedUncommittedFiles: (root: string) => uncommittedFiles(root),
}));

vi.mock('../../file/WorkspaceEventBus', () => ({
  isSessionSubscribedAnywhere: (sessionId: string) => sessionSubscribed(sessionId),
}));

vi.mock('../../utils/logger', () => ({
  logger: { main: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } },
}));

const { reconcilePendingTagsForFile } = await import('../pendingTagReconciler');

/** Old enough that the grace guard is not what is under test. */
const OLD_ENOUGH = new Date(Date.now() - 10 * 60_000);

let repoRoot: string;
let filePath: string;
let updateTagStatus: ReturnType<typeof vi.fn>;
let tags: HistoryTag[];

function tag(overrides: Partial<HistoryTag> = {}): HistoryTag {
  return {
    id: 'ai-edit-pending-session-a-tool-1',
    filePath,
    content: 'baseline content\n',
    type: 'pre-edit',
    status: 'pending-review',
    sessionId: 'session-a',
    toolUseId: 'tool-1',
    createdAt: OLD_ENOUGH,
    updatedAt: OLD_ENOUGH,
    ...overrides,
  } as HistoryTag;
}

/** A HistoryManager stand-in: only the two methods the reconciler touches. */
function fakeManager(): HistoryManager {
  return {
    getPendingTags: async () => tags,
    updateTagStatus,
  } as unknown as HistoryManager;
}

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nim1403-'));
  // findGitRootForFile walks up for a `.git` entry; this makes repoRoot own the file.
  fs.mkdirSync(path.join(repoRoot, '.git'));
  fs.mkdirSync(path.join(repoRoot, 'src'));
  filePath = path.join(repoRoot, 'src', 'TagBoard.tsx');
  fs.writeFileSync(filePath, 'content on disk\n');

  updateTagStatus = vi.fn(async () => {});
  tags = [tag()];
  trackedFiles.mockResolvedValue(new Set(['src/TagBoard.tsx']));
  uncommittedFiles.mockResolvedValue(new Set());
  sessionSubscribed.mockReturnValue(false);
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('reconcilePendingTagsForFile', () => {
  it('retires a tracked, clean file whose baseline still differs from disk', async () => {
    // The reported bug: git says clean, but the stored baseline would still
    // render a diff bar.
    const survivors = await reconcilePendingTagsForFile(fakeManager(), filePath);

    expect(survivors).toEqual([]);
    expect(updateTagStatus).toHaveBeenCalledWith(
      filePath,
      'ai-edit-pending-session-a-tool-1',
      'reviewed',
    );
  });

  it('keeps a gitignored file with the same divergence', async () => {
    // Absent from the uncommitted set for a different reason: git does not
    // track it at all, so nothing says the edit landed.
    trackedFiles.mockResolvedValue(new Set(['src/other.ts']));

    const survivors = await reconcilePendingTagsForFile(fakeManager(), filePath);

    expect(survivors).toHaveLength(1);
    expect(updateTagStatus).not.toHaveBeenCalled();
  });

  it('keeps a tracked file that still has uncommitted changes', async () => {
    uncommittedFiles.mockResolvedValue(new Set(['src/TagBoard.tsx']));

    const survivors = await reconcilePendingTagsForFile(fakeManager(), filePath);

    expect(survivors).toHaveLength(1);
    expect(updateTagStatus).not.toHaveBeenCalled();
  });

  it('retires a tag whose baseline already matches disk, without consulting git', async () => {
    tags = [tag({ content: 'content on disk\n' })];

    const survivors = await reconcilePendingTagsForFile(fakeManager(), filePath);

    expect(survivors).toEqual([]);
    expect(trackedFiles).not.toHaveBeenCalled();
  });

  it('retires a tag whose file is gone', async () => {
    fs.rmSync(filePath);

    const survivors = await reconcilePendingTagsForFile(fakeManager(), filePath);

    expect(survivors).toEqual([]);
    expect(updateTagStatus).toHaveBeenCalled();
  });

  it('keeps a live tag whose session is still subscribed', async () => {
    // AgentToolHooks records a baseline before the tool writes; retiring here
    // would mean the user's diff never appears.
    sessionSubscribed.mockReturnValue(true);

    const survivors = await reconcilePendingTagsForFile(fakeManager(), filePath);

    expect(survivors).toHaveLength(1);
    expect(updateTagStatus).not.toHaveBeenCalled();
  });

  it('keeps the tag when retiring it fails', async () => {
    updateTagStatus.mockRejectedValue(new Error('db down'));

    const survivors = await reconcilePendingTagsForFile(fakeManager(), filePath);

    expect(survivors).toHaveLength(1);
  });
});
