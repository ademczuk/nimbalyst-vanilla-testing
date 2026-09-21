// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createPendingIndexPublications } from '../pendingIndexPublications';
import type { IndexPublishOutcome, SessionIndexData } from '../types';

const row = (id: string): SessionIndexData => ({ id, title: id, provider: 'claude-code', workspaceId: '/test', updatedAt: 1, createdAt: 1, messageCount: 0 });
const withheld: IndexPublishOutcome = { published: false, retryable: true, publishedSessionIds: [] };
const sent = (id: string): IndexPublishOutcome => ({ published: true, publishedSessionIds: [id] });

describe('pending index publication ownership', () => {
  it('retains only unsent retryable rows and waits for an external retry signal', async () => {
    const publish = vi.fn().mockResolvedValueOnce({ ...withheld, publishedSessionIds: ['a'] }).mockResolvedValueOnce(sent('b'));
    const queue = createPendingIndexPublications({ ready: () => true, sequence: () => 0, publish, warn: vi.fn() });
    queue.enqueue([row('a'), row('b')]);
    await queue.drain();
    expect(publish).toHaveBeenCalledTimes(1);
    await queue.drain();
    expect(publish.mock.calls[1][0].map((r: SessionIndexData) => r.id)).toEqual(['b']);
    await queue.drain();
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('preserves newer queued snapshots when an earlier queued publication advances the sequence', async () => {
    let sequence = 0;
    const publish = vi.fn(async () => { sequence++; return sent('a'); });
    const queue = createPendingIndexPublications({ ready: () => true, sequence: () => sequence, publish, warn: vi.fn() });
    queue.enqueue([{ ...row('a'), title: 'Old' }]);
    queue.enqueue([{ ...row('a'), title: 'New' }]);
    await queue.drain();
    expect(publish).toHaveBeenLastCalledWith([expect.objectContaining({ title: 'New' })], undefined);
  });

  it('does not replay terminal exclusions or overwrite a newer publication', async () => {
    let sequence = 0;
    const publish = vi.fn().mockResolvedValue({ ...withheld, retryable: false });
    const queue = createPendingIndexPublications({ ready: () => true, sequence: () => sequence, publish, warn: vi.fn() });
    queue.enqueue([row('terminal')]);
    await queue.drain();
    await queue.drain();
    queue.enqueue([row('stale')]);
    sequence++;
    await queue.drain();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('serializes draining and never resurrects account work after teardown', async () => {
    let resolve!: (result: IndexPublishOutcome) => void;
    const publish = vi.fn(() => new Promise<IndexPublishOutcome>(r => { resolve = r; }));
    const queue = createPendingIndexPublications({ ready: () => true, sequence: () => 0, publish, warn: vi.fn() });
    queue.enqueue([row('old-account')]);
    const draining = queue.drain();
    await queue.drain();
    expect(publish).toHaveBeenCalledTimes(1);
    queue.clear();
    resolve(withheld);
    await draining;
    await queue.drain();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('retains a thrown send failure until reconnect', async () => {
    const publish = vi.fn().mockRejectedValueOnce(new Error('socket closed')).mockResolvedValue(sent('a'));
    const warn = vi.fn();
    const queue = createPendingIndexPublications({ ready: () => true, sequence: () => 0, publish, warn });
    queue.enqueue([row('a')]);
    await queue.drain();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    await queue.drain();
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
