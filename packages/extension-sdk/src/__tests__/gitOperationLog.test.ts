import { describe, expect, it } from 'vitest';
import {
  mergeGitOperationEntries,
  normalizeGitOperationEntry,
  selectLatestRunningGitOperation,
  selectLatestTerminalGitOperation,
  selectRunningGitOperations,
  type GitOperationLogWireEntry,
} from '../gitOperationLog';

function entry(overrides: Partial<GitOperationLogWireEntry> & { id: string }): GitOperationLogWireEntry {
  return {
    timestamp: 1000,
    updatedAt: 1000,
    command: 'git status',
    executable: 'git',
    args: ['status'],
    cwd: '/repo',
    status: 'running',
    output: '',
    stdout: '',
    stderr: '',
    ...overrides,
  };
}

describe('git operation log selectors', () => {
  it('keeps a live terminal event that landed while hydration was in flight', () => {
    // The `git:operation-log:get` response is older than upserts that arrived
    // after it was requested. Applying it blindly rewinds a finished push back
    // to running, which is exactly the stale indicator this ordering prevents.
    const hydrated = [entry({ id: 'a', status: 'running', updatedAt: 1000 })];
    const live = [entry({ id: 'a', status: 'success', updatedAt: 2000 })];

    expect(mergeGitOperationEntries(hydrated, live)[0].status).toBe('success');
    expect(mergeGitOperationEntries(live, hydrated)[0].status).toBe('success');
  });

  it('names the newest running command and counts the rest', () => {
    const entries = [
      entry({ id: 'push', timestamp: 1000, command: 'git push' }),
      entry({ id: 'fetch', timestamp: 3000, command: 'git fetch origin' }),
      entry({ id: 'done', timestamp: 2000, status: 'success', updatedAt: 5000 }),
    ];

    expect(selectLatestRunningGitOperation(entries)?.id).toBe('fetch');
    expect(selectRunningGitOperations(entries).map((e) => e.id)).toEqual(['push', 'fetch']);
    expect(selectLatestTerminalGitOperation(entries)?.id).toBe('done');
  });

  it('reads a journal written before source metadata existed as app-owned direct git', () => {
    const legacy = entry({ id: 'legacy' });
    delete (legacy as Partial<GitOperationLogWireEntry>).source;
    delete (legacy as Partial<GitOperationLogWireEntry>).executor;

    const normalized = normalizeGitOperationEntry(legacy);

    expect(normalized.source).toBe('nimbalyst');
    expect(normalized.executor).toBe('git');
  });

  it('does not let an agent entry inherit the app-owned default', () => {
    const agent = entry({ id: 'agent', source: 'agent', executor: 'shell', sessionId: 's1' });

    expect(normalizeGitOperationEntry(agent).source).toBe('agent');
    expect(normalizeGitOperationEntry(agent).executor).toBe('shell');
  });
});
