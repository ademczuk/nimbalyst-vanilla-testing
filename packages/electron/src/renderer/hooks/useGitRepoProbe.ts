import { useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { isGitRepoAtom } from '../store/actions/sessionHistoryActions';

/**
 * In-flight `git:is-repo` calls, keyed by workspace path, so the several
 * components that mount this hook for the same workspace share one IPC
 * round trip. Entries are removed as soon as the call settles — this
 * deduplicates concurrent probes, it does not cache the answer (a user can
 * `git init` a workspace while it is open).
 */
const inFlight = new Map<string, Promise<boolean>>();

function probeIsGitRepo(workspacePath: string): Promise<boolean> {
  const existing = inFlight.get(workspacePath);
  if (existing) return existing;

  const pending = window.electronAPI
    .invoke('git:is-repo', workspacePath)
    .then((result: { success?: boolean; isRepo?: boolean } | undefined) =>
      Boolean(result?.success && result.isRepo),
    )
    .catch(() => false)
    .finally(() => {
      inFlight.delete(workspacePath);
    });

  inFlight.set(workspacePath, pending);
  return pending;
}

/**
 * Resolve whether `workspacePath` is a git repository, sharing the answer
 * through `isGitRepoAtom` so every gated surface agrees.
 *
 * Every component that gates UI on the answer calls this, rather than one
 * component probing and the rest reading its write. A single writer is
 * fragile: the probe ran once per workspace mount, so any reader that came
 * up against a fresh `isGitRepoAtom` family read the default forever. In
 * dev, a Vite hot update of the module that owns the atom family rebuilds
 * it from scratch; the probe never re-ran because its dependency
 * (`workspacePath`) had not changed, and New Worktree / New Blitz / New
 * Super Loop stayed greyed out in a repository that plainly was one.
 *
 * Returns `undefined` until the IPC answers. Gate on an explicit `false`,
 * never on a falsy check, so "we have not asked yet" is not mistaken for
 * "this is not a repository".
 */
export function useGitRepoProbe(workspacePath: string | undefined): boolean | undefined {
  const path = workspacePath ?? '';
  const isGitRepo = useAtomValue(isGitRepoAtom(path));
  const setIsGitRepo = useSetAtom(isGitRepoAtom(path));

  useEffect(() => {
    if (!path) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const run = () => {
      if (cancelled) return;
      if (!window.electronAPI?.invoke) {
        // Preload bridge not ready yet. Retry briefly rather than writing a
        // `false` we would never revisit.
        retryTimer = setTimeout(run, 250);
        return;
      }
      void probeIsGitRepo(path).then((result) => {
        if (!cancelled) setIsGitRepo(result);
      });
    };

    run();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [path, setIsGitRepo]);

  return isGitRepo;
}
