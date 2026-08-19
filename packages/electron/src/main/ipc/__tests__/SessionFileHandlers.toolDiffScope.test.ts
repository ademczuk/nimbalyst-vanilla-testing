import { describe, expect, it } from 'vitest';
import { isSessionWorkspaceAllowed } from '../SessionFileHandlers';

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
