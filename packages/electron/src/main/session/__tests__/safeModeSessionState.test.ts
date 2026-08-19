import { beforeEach, describe, expect, it } from 'vitest';
import {
  setSafeModeSessionStateProtection,
  shouldSuppressSafeModeSessionSave,
} from '../safeModeSessionState';
import { isSafeModeArgument } from '../startupSafeMode';

describe('safe-mode startup recovery', () => {
  beforeEach(() => setSafeModeSessionStateProtection(false));

  it('recognizes both supported no-restore flags', () => {
    expect(isSafeModeArgument('--safe-mode')).toBe(true);
    expect(isSafeModeArgument('--no-restore')).toBe(true);
    expect(isSafeModeArgument('--workspace')).toBe(false);
  });

  it('preserves saved restoration state while only Workspace Manager is open', () => {
    setSafeModeSessionStateProtection(true);
    expect(shouldSuppressSafeModeSessionSave([])).toBe(true);
    expect(shouldSuppressSafeModeSessionSave([{ mode: 'workspace-manager' }])).toBe(true);
  });

  it('resumes normal persistence after the user opens a workspace', () => {
    setSafeModeSessionStateProtection(true);
    expect(shouldSuppressSafeModeSessionSave([{ mode: 'workspace', workspacePath: '/repo' }])).toBe(false);
    expect(shouldSuppressSafeModeSessionSave([])).toBe(false);
  });
});
