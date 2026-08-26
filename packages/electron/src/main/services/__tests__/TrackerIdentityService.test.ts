// @vitest-environment node
/**
 * `getCurrentIdentity` shelled out to `git config` twice on every call, with
 * execSync. Read-receipt websocket traffic calls it per message, so a CPU
 * profile caught 4,782ms of a 5,125ms window inside a single synchronous
 * spawn -- process creation is expensive, and ruinous when the machine is
 * under memory pressure.
 *
 * Git identity is a per-directory near-constant, so these pin that it is read
 * once per directory rather than once per call.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const execFileSync = vi.fn();
let stytchEmail: string | null = null;

vi.mock('child_process', () => ({
  execSync: vi.fn(() => { throw new Error('execSync must not be used on this path'); }),
  execFileSync: (...args: unknown[]) => execFileSync(...args),
}));
vi.mock('../StytchAuthService', () => ({
  getUserEmail: () => stytchEmail,
  getAuthState: () => ({ user: { name: { first_name: 'Ada', last_name: 'L' } } }),
}));

describe('getCurrentIdentity git config caching', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    stytchEmail = null;
    execFileSync.mockImplementation((_cmd: string, args: string[]) =>
      Buffer.from(args.includes('user.email') ? 'ada@example.com\n' : 'Ada\n')
    );
    const mod = await import('../TrackerIdentityService');
    mod.__resetGitIdentityCacheForTests();
  });

  afterEach(() => vi.useRealTimers());

  it('reads git config once across repeated calls for the same directory', async () => {
    const { getCurrentIdentity } = await import('../TrackerIdentityService');

    for (let i = 0; i < 20; i++) getCurrentIdentity('/repo-a');

    // user.name + user.email, once -- not 40 spawns.
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });

  it('still returns the right identity from cache', async () => {
    const { getCurrentIdentity } = await import('../TrackerIdentityService');

    const first = getCurrentIdentity('/repo-a');
    const second = getCurrentIdentity('/repo-a');

    expect(second).toEqual(first);
    expect(second.gitEmail).toBe('ada@example.com');
    expect(second.gitName).toBe('Ada');
  });

  it('caches per directory', async () => {
    const { getCurrentIdentity } = await import('../TrackerIdentityService');

    getCurrentIdentity('/repo-a');
    getCurrentIdentity('/repo-b');
    getCurrentIdentity('/repo-a');

    expect(execFileSync).toHaveBeenCalledTimes(4);
  });

  it('re-reads once the entry goes stale', async () => {
    const { getCurrentIdentity } = await import('../TrackerIdentityService');

    getCurrentIdentity('/repo-a');
    vi.advanceTimersByTime(10 * 60 * 1000);
    getCurrentIdentity('/repo-a');

    expect(execFileSync).toHaveBeenCalledTimes(4);
  });

  it('caches the not-configured case too, instead of respawning on every call', async () => {
    execFileSync.mockImplementation(() => { throw new Error('not a git repo'); });
    const { getCurrentIdentity } = await import('../TrackerIdentityService');

    const identity = getCurrentIdentity('/not-a-repo');
    getCurrentIdentity('/not-a-repo');
    getCurrentIdentity('/not-a-repo');

    expect(execFileSync).toHaveBeenCalledTimes(2);
    expect(identity.gitEmail).toBeNull();
  });

  it('prefers the signed-in email while still reporting git fields', async () => {
    stytchEmail = 'ada@work.example';
    const { getCurrentIdentity } = await import('../TrackerIdentityService');

    const identity = getCurrentIdentity('/repo-a');

    expect(identity.email).toBe('ada@work.example');
    expect(identity.gitEmail).toBe('ada@example.com');
  });
});
