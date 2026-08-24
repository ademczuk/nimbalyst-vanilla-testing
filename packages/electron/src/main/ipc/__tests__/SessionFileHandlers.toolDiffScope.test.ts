import { describe, expect, it } from 'vitest';
import { isSessionWorkspaceAllowed, resolveSessionDiffPath } from '../SessionFileHandlers';

describe('session-files:get-tool-call-diffs workspace scope', () => {
  const session = {
    workspacePath: '/projects/main',
    worktreePath: '/projects/worktrees/feature',
  };

  it('accepts the owning workspace and session worktree', () => {
    expect(isSessionWorkspaceAllowed(session, '/projects/main')).toBe(true);
    expect(isSessionWorkspaceAllowed(session, '/projects/worktrees/feature')).toBe(true);
  });

  it('rejects missing sessions and cross-workspace requests', () => {
    expect(isSessionWorkspaceAllowed(null, '/projects/main')).toBe(false);
    expect(isSessionWorkspaceAllowed(session, '/projects/other')).toBe(false);
  });
});

describe('session:file-diff path resolution', () => {
  const workspacePath = '/projects/main';

  // The commit proposal widget is the one caller that sends workspace-relative
  // paths (git:get-commit-context returns them relative). document_history is
  // keyed absolute, so an unresolved relative path matches zero snapshot rows
  // and the widget silently loses its hunk pre-selection.
  it('resolves a workspace-relative path against the workspace', () => {
    expect(resolveSessionDiffPath(workspacePath, 'packages/electron/package.json'))
      .toBe('/projects/main/packages/electron/package.json');
  });

  // Absolute paths are the pre-existing contract for the two sidebar callers,
  // including sessions that edited a file outside the workspace, so they pass
  // through untouched rather than being newly subjected to containment.
  it('passes an already-absolute path through unchanged', () => {
    expect(resolveSessionDiffPath(workspacePath, '/projects/main/src/index.ts'))
      .toBe('/projects/main/src/index.ts');
    expect(resolveSessionDiffPath(workspacePath, '/elsewhere/notes.md'))
      .toBe('/elsewhere/notes.md');
  });

  it('refuses a relative path that escapes the workspace', () => {
    expect(resolveSessionDiffPath(workspacePath, '../other/secrets.env')).toBeNull();
  });

  it('returns null when a relative path has no workspace to resolve against', () => {
    expect(resolveSessionDiffPath('', 'packages/electron/package.json')).toBeNull();
  });
});
