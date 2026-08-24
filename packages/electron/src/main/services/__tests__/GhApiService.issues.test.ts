// @vitest-environment node

import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerWarn, spawnMock } = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock('child_process', () => ({ spawn: spawnMock }));
vi.mock('electron-log/main', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: loggerWarn }) },
}));

import { GhApiService } from '../GhApiService';
import { MAX_INITIAL_ISSUE_PAGES } from '../GhApiService.issues';

function childReturning(stdout: string, exitCode = 0, stderr = '') {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    child.stdout.emit('data', stdout);
    child.stderr.emit('data', stderr);
    child.emit('close', exitCode);
  });
  return child;
}

describe('GhApiService GitHub issues', () => {
  const upsertList = vi.fn();

  beforeEach(() => {
    spawnMock.mockReset();
    loggerWarn.mockReset();
    upsertList.mockReset().mockResolvedValue(undefined);
  });

  it('filters pull requests, consumes pages, and threads since through every request', async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      const endpoint = args.find((arg) => arg.startsWith('repos/')) ?? '';
      const page = new URLSearchParams(endpoint.split('?')[1]).get('page');
      if (page === '1') {
        return childReturning(JSON.stringify([
          {
            id: 101,
            number: 11,
            title: 'Issue one',
            state: 'open',
            body: 'Body one',
            html_url: 'https://github.com/owner/repo/issues/11',
            user: { login: 'alice' },
            labels: [],
            assignees: [],
            comments: 0,
            locked: false,
            created_at: '2026-08-01T00:00:00Z',
            updated_at: '2026-08-02T00:00:00Z',
          },
          {
            id: 102,
            number: 12,
            title: 'Pull request from issues endpoint',
            state: 'open',
            html_url: 'https://github.com/owner/repo/pull/12',
            pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/12' },
            created_at: '2026-08-01T00:00:00Z',
            updated_at: '2026-08-02T00:00:00Z',
          },
        ]));
      }
      return childReturning(JSON.stringify([
        {
          id: 103,
          number: 13,
          title: 'Issue two',
          state: 'closed',
          body: null,
          html_url: 'https://github.com/owner/repo/issues/13',
          user: { login: 'bob' },
          labels: [{ name: 'bug', color: 'ff0000' }],
          assignees: [],
          comments: 2,
          locked: false,
          created_at: '2026-08-03T00:00:00Z',
          updated_at: '2026-08-04T00:00:00Z',
          closed_at: '2026-08-04T00:00:00Z',
        },
      ]));
    });

    const service = new GhApiService(
      {} as never,
      undefined,
      { upsertList } as never,
    );
    const since = '2026-08-10T12:34:56.000Z';
    const rows = await service.listIssues('/workspace', 'owner/repo', {
      state: 'all',
      perPage: 2,
      since,
    });

    expect(rows.map((row) => row.number)).toEqual([11, 13]);
    expect(rows[0].raw).not.toHaveProperty('body');
    expect(upsertList).toHaveBeenCalledWith(rows);
    expect(spawnMock).toHaveBeenCalledTimes(2);
    for (const [, args] of spawnMock.mock.calls) {
      const endpoint = (args as string[]).find((arg) => arg.startsWith('repos/')) ?? '';
      expect(endpoint).toContain('state=all');
      expect(endpoint).toContain(`since=${encodeURIComponent(since)}`);
    }
  });

  it('rejects malformed remotes and non-positive issue numbers before spawning gh', async () => {
    const service = new GhApiService(
      {} as never,
      undefined,
      { upsertList } as never,
    );

    await expect(service.listIssues('/workspace', 'owner/repo/extra')).rejects.toThrow(
      'Invalid GitHub remote',
    );
    await expect(service.listIssues('/workspace', 'owner/..')).rejects.toThrow(
      'Invalid GitHub remote',
    );
    await expect(service.getIssue('/workspace', 'owner/repo', Number.NaN)).rejects.toThrow(
      'Invalid GitHub issue number',
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('bounds an initial history walk while leaving incremental paging available', async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      const endpoint = args.find((arg) => arg.startsWith('repos/')) ?? '';
      const page = Number(new URLSearchParams(endpoint.split('?')[1]).get('page'));
      return childReturning(JSON.stringify([{
        id: page,
        number: page,
        title: `Issue ${page}`,
        state: 'open',
        labels: [],
        assignees: [],
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-02T00:00:00Z',
      }]));
    });
    const service = new GhApiService({} as never, undefined, { upsertList } as never);

    const rows = await service.listIssues('/workspace', 'owner/repo', {
      state: 'all',
      perPage: 1,
    });

    expect(spawnMock).toHaveBeenCalledTimes(MAX_INITIAL_ISSUE_PAGES);
    expect(rows).toHaveLength(MAX_INITIAL_ISSUE_PAGES);
  });

  it('does not log form or header values when issue and PR mutations fail', async () => {
    const issueSecret = 'confidential issue comment';
    const prSecret = 'confidential PR comment';
    spawnMock.mockImplementation(() => childReturning('', 1, 'network unavailable'));
    const service = new GhApiService({} as never, undefined, { upsertList } as never);

    await expect(
      service.commentOnIssue('/workspace', 'owner/repo', 42, issueSecret),
    ).rejects.toThrow('gh api repos/owner/repo/issues/42/comments failed');
    await expect(
      service.commentOnPullRequest('/workspace', 'owner/repo', 43, prSecret),
    ).rejects.toThrow('gh api repos/owner/repo/issues/43/comments failed');

    const logged = JSON.stringify(loggerWarn.mock.calls);
    expect(logged).not.toContain(issueSecret);
    expect(logged).not.toContain(prSecret);
    expect(logged).not.toContain('Accept: application/vnd.github+json');
    expect(logged).toContain('repos/owner/repo/issues/42/comments');
    expect(logged).toContain('POST');
  });
});
