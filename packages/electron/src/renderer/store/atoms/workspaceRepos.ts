/**
 * Repositories the current workspace spans.
 *
 * Written by `fileTreeListeners` alongside the root list -- attaching or
 * detaching a folder is the only thing that changes which repos are in play,
 * and that listener already handles `workspace:folders-changed`.
 *
 * A single-folder workspace that is a git repo holds exactly one entry, so
 * every consumer's "more than one repo" branch stays dark and the UI is
 * unchanged from before multi-root.
 */

import { atom } from 'jotai';
import { activeFilePathAtom } from './fileTree';
import { resolveRepoForPath } from '../../utils/workspaceRepos';

/** Repos of the current workspace, in root order. Empty when none is a repo. */
export const workspaceRepoPathsAtom = atom<string[]>([]);

/**
 * The repo the active file belongs to, falling back to the first repo in root
 * order when no file is open or the open file is in no repo.
 *
 * This is what the title-bar branch indicator follows: in a workspace spanning
 * two repos, editing a file in the attached one shows that repo's branch.
 */
export const activeFileRepoPathAtom = atom<string | null>((get) => {
  const repos = get(workspaceRepoPathsAtom);
  if (repos.length === 0) return null;

  const activeFile = get(activeFilePathAtom);
  return (activeFile ? resolveRepoForPath(repos, activeFile) : null) ?? repos[0];
});
