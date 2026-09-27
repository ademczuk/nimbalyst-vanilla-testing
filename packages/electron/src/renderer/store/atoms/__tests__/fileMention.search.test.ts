// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createStore } from 'jotai';
import { fileMentionOptionsAtom, searchFileMentionAtom } from '../fileMention';

vi.mock('@nimbalyst/runtime/ui/icons/fileIcons', () => ({ getFileIcon: () => 'file' }));
afterEach(() => vi.unstubAllGlobals());

it('delegates freshness to each main-process search instead of building a renderer-owned snapshot', async () => {
  const store = createStore();
  const workspacePath = '/mention-refresh';
  const buildQuickOpenCache = vi.fn().mockResolvedValue({ success: false });
  const searchWorkspaceFileNames = vi.fn().mockResolvedValue([]);
  vi.stubGlobal('window', { electronAPI: { buildQuickOpenCache, searchWorkspaceFileNames } });

  await store.set(searchFileMentionAtom, { workspacePath, query: 'new' });
  searchWorkspaceFileNames.mockResolvedValue([{ path: `${workspacePath}/new.md`, type: 'file' }]);
  await store.set(searchFileMentionAtom, { workspacePath, query: 'new' });

  expect(store.get(fileMentionOptionsAtom(workspacePath)).map(option => option.id)).toEqual(['new.md']);
  expect(searchWorkspaceFileNames).toHaveBeenCalledTimes(2);
  expect(buildQuickOpenCache).not.toHaveBeenCalled();
});
