import { renderHook, waitFor } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitRepoProbe } from '../useGitRepoProbe';
import { isGitRepoAtom } from '../../store/actions/sessionHistoryActions';

let invoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  invoke = vi.fn().mockResolvedValue({ success: true, isRepo: true });
  (window as unknown as { electronAPI: unknown }).electronAPI = { invoke };
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  isGitRepoAtom.remove('/repo');
});

describe('useGitRepoProbe', () => {
  it('reports undefined until the IPC answers, so callers can tell "unknown" from "not a repo"', async () => {
    const { result } = renderHook(() => useGitRepoProbe('/repo'));

    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe(true));
  });

  // The regression: the answer used to be written by a single component's
  // effect. A reader that mounted against a fresh atom family never got the
  // write and stayed disabled forever. Every consumer now probes for itself.
  it('resolves for a consumer that mounts after the atom family is rebuilt', async () => {
    const first = renderHook(() => useGitRepoProbe('/repo'));
    await waitFor(() => expect(first.result.current).toBe(true));
    first.unmount();

    isGitRepoAtom.remove('/repo');
    const reader = renderHook(() => useAtomValue(isGitRepoAtom('/repo')));
    expect(reader.result.current).toBeUndefined();

    const second = renderHook(() => useGitRepoProbe('/repo'));
    await waitFor(() => expect(second.result.current).toBe(true));
  });

  it('shares one IPC round trip across concurrent consumers of the same workspace', async () => {
    const a = renderHook(() => useGitRepoProbe('/repo'));
    const b = renderHook(() => useGitRepoProbe('/repo'));

    await waitFor(() => expect(a.result.current).toBe(true));
    expect(b.result.current).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('reports false when the workspace is not a repository', async () => {
    invoke.mockResolvedValue({ success: true, isRepo: false });
    const { result } = renderHook(() => useGitRepoProbe('/repo'));

    await waitFor(() => expect(result.current).toBe(false));
  });
});
