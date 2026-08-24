// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAllWindows } = vi.hoisted(() => ({ getAllWindows: vi.fn() }));

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows } }));
vi.mock('electron-log/main', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn() }) },
}));

import { PullRequestPollScheduler } from '../PullRequestPollScheduler';

describe('PullRequestPollScheduler issue lane', () => {
  const send = vi.fn();
  const listPullRequests = vi.fn();
  const listIssues = vi.fn();
  const getIssuePollCursor = vi.fn();
  const setIssuePollCursor = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T12:00:00Z'));
    send.mockReset();
    listPullRequests.mockReset().mockResolvedValue([]);
    listIssues.mockReset().mockResolvedValue([]);
    getIssuePollCursor.mockReset().mockResolvedValue(null);
    setIssuePollCursor.mockReset().mockResolvedValue(undefined);
    getAllWindows.mockReturnValue([{ isDestroyed: () => false, webContents: { send } }]);
  });

  it('keeps PR cadence unchanged and uses since after the first issue poll', async () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    const scheduler = new PullRequestPollScheduler({
      listPullRequests,
      listIssues,
      getIssuePollCursor,
      setIssuePollCursor,
    } as never);

    scheduler.start('/workspace', '/workspace', 'owner/repo');
    expect(intervalSpy).toHaveBeenLastCalledWith(expect.any(Function), 5 * 60_000);
    scheduler.setFocus('/workspace', true);
    expect(intervalSpy).toHaveBeenLastCalledWith(expect.any(Function), 60_000);

    await scheduler.pollNow('/workspace');
    vi.setSystemTime(new Date('2026-08-11T12:00:01Z'));
    await scheduler.pollNow('/workspace');

    expect(listPullRequests).toHaveBeenCalledTimes(2);
    expect(listPullRequests).toHaveBeenNthCalledWith(1, '/workspace', 'owner/repo', {
      state: 'open',
    });
    expect(listIssues).toHaveBeenCalledTimes(2);
    expect(listIssues.mock.calls[0][2]).toMatchObject({ state: 'all' });
    expect(listIssues.mock.calls[0][2].since).toBeUndefined();
    expect(listIssues.mock.calls[1][2]).toEqual({
      state: 'all',
      since: '2026-08-11T12:00:00.000Z',
    });
    expect(getIssuePollCursor).toHaveBeenCalledTimes(1);
    expect(setIssuePollCursor).toHaveBeenNthCalledWith(
      1,
      '/workspace',
      'owner/repo',
      Date.parse('2026-08-11T12:00:00Z'),
    );
    expect(send).toHaveBeenCalledWith('pr:list-updated', {
      workspacePath: '/workspace',
      remote: 'owner/repo',
    });
    expect(send).toHaveBeenCalledWith('issue:list-updated', {
      workspacePath: '/workspace',
      remote: 'owner/repo',
    });

    scheduler.stopAll();
    vi.useRealTimers();
  });

  it('restores the persisted issue cursor after the scheduler is rebuilt', async () => {
    getIssuePollCursor.mockResolvedValue(Date.parse('2026-08-10T09:30:00Z'));
    const scheduler = new PullRequestPollScheduler({
      listPullRequests,
      listIssues,
      getIssuePollCursor,
      setIssuePollCursor,
    } as never);

    scheduler.start('/workspace', '/workspace', 'owner/repo');
    await scheduler.pollNow('/workspace');

    expect(listIssues).toHaveBeenCalledWith('/workspace', 'owner/repo', {
      state: 'all',
      since: '2026-08-10T09:30:00.000Z',
    });
    scheduler.stopAll();
    vi.useRealTimers();
  });
});
