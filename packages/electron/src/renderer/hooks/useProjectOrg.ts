import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';

import { activeWorkspacePathAtom } from '../store/atoms/openProjects';
import { projectOrgRevisionAtom } from '../store/atoms/orgScope';
import { stytchAuthAtom } from '../store/atoms/stytchAuth';

export interface ProjectOrg {
  orgId: string;
  name: string;
}

export interface ProjectOrgState {
  org: ProjectOrg | null;
  /** True until the lookup for the current workspace has answered. */
  loading: boolean;
}

/**
 * The organization the active project belongs to, or `null` when it has none.
 *
 * Several surfaces need this at once — the top bar's inbox control, the account
 * popover's Messages and Organization rows — and each used to run its own
 * `findForWorkspace` round trip with its own cancel bookkeeping. The active
 * workspace atom wins over the caller's path: a window's `workspacePath` prop is
 * the root project, while the atom follows the project the user is actually
 * looking at.
 *
 * Callers must distinguish `loading` from a resolved `null`: rendering "No
 * organization" over an unfinished lookup reads as a definitive answer, and
 * during org creation it was a wrong one.
 *
 * A lookup that main could not carry out is unfinished in exactly that sense.
 * `team:find-for-workspace` reports it as `complete: false` — no auth session
 * yet, or the team directory fetch failed — and the `null` team riding along
 * with it is not an answer. Caching one as though it were is what left the
 * gutter's Organization item dead on startup: the lookup landed a beat before
 * the team directory became fetchable, nothing bumps the revision afterwards,
 * and so the stale `null` stood for the life of the window.
 *
 * "Stytch reports a session" is not the same fact as "the team directory is
 * fetchable". The auth snapshot hydrates as authenticated well before main can
 * answer, so it cannot stand in for completeness — an earlier fix that let a
 * loaded auth snapshot resolve an incomplete lookup reproduced the original bug
 * exactly. `complete` is the only signal that says main got an answer, so it is
 * the only one that resolves the lookup.
 */
interface ProjectOrgResolution {
  workspacePath: string | null;
  revision: number;
  org: ProjectOrg | null;
  /** Whether main could carry the lookup out at all. */
  complete: boolean;
  /** How many lookups this path/revision has spent, retries included. */
  attempt: number;
  /** True when no further attempt can change this answer. */
  settled: boolean;
}

/**
 * Backoff for a lookup main could not carry out, roughly a minute in total.
 *
 * Bounded on purpose: an incomplete answer that never completes must land as an
 * answer eventually, because the alternative a caller renders is a spinner that
 * never stops. Signing in bumps the revision, which restarts the schedule from
 * scratch, so exhausting it is not permanent.
 */
const INCOMPLETE_RETRY_DELAYS_MS = [250, 500, 1000, 2000, 4000, 8000, 15000, 30000] as const;

export function useProjectOrg(workspacePath?: string | null): ProjectOrgState {
  const activePathFromAtom = useAtomValue(activeWorkspacePathAtom);
  const activePath = activePathFromAtom ?? workspacePath ?? null;
  // Creating an organization binds it to this workspace in the main process,
  // and signing out unbinds every one of them; nothing about the workspace path
  // changes in either case, so the revision is what tells the lookup to run
  // again.
  const revision = useAtomValue(projectOrgRevisionAtom);
  // Signed out is the one incomplete answer that is final: main has no session
  // to look a workspace's org up with and will never grow one without a sign-in,
  // which bumps the revision and re-runs this from scratch. A *missing* snapshot
  // is not that — it is the startup gap, and retrying through it is the point.
  const auth = useAtomValue(stytchAuthAtom);
  const signedOut = auth !== null && !auth.isAuthenticated;

  const [resolved, setResolvedState] = useState<ProjectOrgResolution | null>(null);
  // Bumped by the backoff timer to re-run the effect. The answer itself is read
  // through a ref, so landing one never schedules another lookup.
  const [retryTick, setRetryTick] = useState(0);
  const resolvedRef = useRef<ProjectOrgResolution | null>(null);
  const resolve = useCallback((next: ProjectOrgResolution) => {
    resolvedRef.current = next;
    setResolvedState(next);
  }, []);

  useEffect(() => {
    // An answer main could carry out stands, so the windows that resolved on the
    // first try do not re-ask on startup.
    const current = resolvedRef.current;
    const matchesCurrentLookup = current !== null
      && current.workspacePath === activePath
      && current.revision === revision;
    if (matchesCurrentLookup && (current.complete || current.settled)) return;
    const attempt = matchesCurrentLookup ? current.attempt : 0;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const land = (org: ProjectOrg | null, complete: boolean) => {
      const nextAttempt = attempt + 1;
      const settled = complete
        || signedOut
        || nextAttempt >= INCOMPLETE_RETRY_DELAYS_MS.length;
      resolve({ workspacePath: activePath, revision, org, complete, attempt: nextAttempt, settled });
      if (settled) return;
      retryTimer = setTimeout(
        () => setRetryTick((tick) => tick + 1),
        INCOMPLETE_RETRY_DELAYS_MS[attempt],
      );
    };

    if (!activePath) {
      land(null, true);
      return;
    }

    const pending = (window as { electronAPI?: any })
      .electronAPI?.team?.findForWorkspace?.(activePath);
    // No `electronAPI` at all (a bare renderer, or a caller mocking a narrower
    // surface) is an answer, not a stall: retrying cannot conjure the bridge.
    if (!pending) {
      land(null, true);
      return;
    }

    void pending
      .then((result: any) => {
        if (cancelled) return;
        const found = result?.team ?? result;
        land(
          found?.orgId ? { orgId: found.orgId, name: found.name } : null,
          // Only an explicit `false` holds the answer open. A caller mocking
          // this API, or an older main without the flag, keeps answering.
          result?.complete !== false,
        );
      })
      .catch(() => {
        if (!cancelled) land(null, false);
      });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [activePath, resolve, retryTick, revision, signedOut]);

  // Report a switch as still in flight rather than the previous answer, so a
  // badge never briefly claims the wrong organization. The revision has to
  // count for the same reason the path does: sign-out bumps it, and holding the
  // old org until the lookup answers is what left the account popover offering
  // an organization to a signed-out user.
  //
  // An incomplete answer counts as in flight until the retry schedule above has
  // either completed it or run out. `settled` covers both terminal cases — a
  // signed-out window, which can never resolve further, and a directory that
  // stayed unfetchable for the whole schedule — so no caller waits forever.
  const answered = resolved
    && resolved.workspacePath === activePath
    && resolved.revision === revision
    && (resolved.complete || resolved.settled);
  if (!answered) {
    return { org: null, loading: activePath !== null };
  }
  return { org: resolved.org, loading: false };
}
