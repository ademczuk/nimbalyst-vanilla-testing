// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: vi.fn() } }));
vi.mock('../../utils/ipcRegistry', () => ({ safeHandle: vi.fn() }));
vi.mock('../../utils/logger', () => ({ logger: { main: { info: vi.fn() } } }));

import {
  claimProjectWalk,
  recordProjectWalkOriginator,
  resetProjectWalkClaims,
} from '../ProjectWalkClaim';

const KEY = 'project-walk:org-acme';
const NOW = 1_760_000_000_000;

describe('claimProjectWalk', () => {
  beforeEach(() => resetProjectWalkClaims());

  // Every window gets the auth broadcast; only one may open the modal.
  it('grants the first caller and refuses the rest', () => {
    expect(claimProjectWalk({ key: KEY, windowId: 1, nowMs: NOW })).toBe(true);
    expect(claimProjectWalk({ key: KEY, windowId: 2, nowMs: NOW })).toBe(false);
  });

  it('grants a different organization its own walk', () => {
    claimProjectWalk({ key: KEY, windowId: 1, nowMs: NOW });
    expect(claimProjectWalk({ key: 'project-walk:org-other', windowId: 2, nowMs: NOW }))
      .toBe(true);
  });

  // Signing out and back in later is a new sign-in, not a replay of the old one.
  it('grants again once the claim has expired', () => {
    claimProjectWalk({ key: KEY, windowId: 1, nowMs: NOW });
    expect(claimProjectWalk({ key: KEY, windowId: 1, nowMs: NOW + 6 * 60_000 })).toBe(true);
  });

  // The user asked to sign in from one window and expects to land back in it,
  // not in whichever window's broadcast happened to arrive first.
  it('holds the walk for the window the sign-in was started from', () => {
    recordProjectWalkOriginator(7, NOW);
    expect(claimProjectWalk({ key: KEY, windowId: 3, nowMs: NOW + 1_000 })).toBe(false);
    expect(claimProjectWalk({ key: KEY, windowId: 7, nowMs: NOW + 1_000 })).toBe(true);
  });

  // That window may have been closed in the meantime, so the preference has to
  // lapse or the walk would be stranded forever.
  it('lets any window claim once the originator grace period lapses', () => {
    recordProjectWalkOriginator(7, NOW);
    expect(claimProjectWalk({ key: KEY, windowId: 3, nowMs: NOW + 3 * 60_000 })).toBe(true);
  });
});
