import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// The hook reads `window.electronAPI` at module scope, so the stub has to exist
// before the import is evaluated.
const invoke = vi.hoisted(() => {
  const fn = vi.fn();
  (window as unknown as { electronAPI: unknown }).electronAPI = { invoke: fn };
  return fn;
});

import { useSessionsForCommits } from '../hooks/useSessionsForCommits';

describe('useSessionsForCommits', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({ success: true, links: {} });
  });

  it('issues exactly one batched lookup for a page of commits, not one per row', async () => {
    // The N+1 guard: the git log renders up to 200 commits, and a per-row
    // invoke would mean 200 round-trips on every panel open.
    const shas = Array.from({ length: 50 }, (_, i) => `sha${i}`);
    renderHook(() => useSessionsForCommits(shas));

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenCalledWith('sessions:get-by-commits', shas);
  });

  it('does not call out at all for an empty log', () => {
    renderHook(() => useSessionsForCommits([]));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('refires when the page changes but not when an equal array is rebuilt', async () => {
    const { rerender } = renderHook(({ shas }) => useSessionsForCommits(shas), {
      initialProps: { shas: ['a', 'b'] },
    });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

    // A re-render with a fresh but equal array must not refetch.
    rerender({ shas: ['a', 'b'] });
    expect(invoke).toHaveBeenCalledTimes(1);

    rerender({ shas: ['a', 'b', 'c'] });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });

  it('re-asks while the backfill is still running, then stops once it settles', async () => {
    // Regression guard: on a first-ever open the ledger is still being built
    // from the message log, so the first response is legitimately empty. Without
    // the re-ask the Session column stays blank until the commit list changes.
    vi.useFakeTimers();
    try {
      invoke
        .mockResolvedValueOnce({ success: true, links: {}, backfillPending: true })
        .mockResolvedValueOnce({
          success: true,
          backfillPending: false,
          links: { a: { sessionId: 's1', title: 'Done', provider: 'claude-code', attribution: 'exact', committedAt: 1 } },
        });

      const { result } = renderHook(() => useSessionsForCommits(['a']));
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
      expect(result.current).toEqual({});

      await vi.advanceTimersByTimeAsync(1500);
      await vi.waitFor(() => expect(result.current.a?.sessionId).toBe('s1'));

      // Settled: no further polling.
      await vi.advanceTimersByTimeAsync(5000);
      expect(invoke).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns an empty map when the lookup fails so the log still renders', async () => {
    invoke.mockRejectedValue(new Error('backfill exploded'));
    const { result } = renderHook(() => useSessionsForCommits(['a']));

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(result.current).toEqual({});
  });

  it('exposes the returned links keyed by sha', async () => {
    invoke.mockResolvedValue({
      success: true,
      links: {
        a: { sessionId: 's1', title: 'Fix the thing', provider: 'claude-code', attribution: 'exact', committedAt: 1 },
      },
    });
    const { result } = renderHook(() => useSessionsForCommits(['a', 'b']));

    await waitFor(() => expect(result.current.a?.sessionId).toBe('s1'));
    expect(result.current.b).toBeUndefined();
  });
});
