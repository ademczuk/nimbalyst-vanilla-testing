/**
 * Eviction plan for accumulated per-workstream UI state.
 *
 * `WorkspaceState.workstreamStates` holds one entry per workstream -- layout
 * mode, split ratio, sidebar visibility, open files -- keyed by session id, and
 * nothing ever removed them. One workspace had grown to 3,798 entries (2.0MB)
 * against 683 live sessions. Because the settings store rewrites the whole file
 * on every `set`, that dead weight was paid on every persist.
 *
 * The decision is kept as a pure function so the dangerous part -- choosing what
 * to delete -- is testable without a database or a real settings file. The
 * caller supplies the live session ids; this returns the plan.
 */

export interface WorkstreamStatePrunePlan {
  /** Keys safe to delete. */
  remove: string[];
  /** Entries that will survive. */
  keptCount: number;
}

export function planWorkstreamStatePrune(
  existing: Record<string, unknown> | undefined,
  liveSessionIds: ReadonlySet<string>,
): WorkstreamStatePrunePlan {
  const keys = Object.keys(existing ?? {});

  // An empty session set is indistinguishable from "the query failed" or "the
  // database was not ready yet". Deleting every entry on that basis is exactly
  // the class of mistake this codebase has been bitten by before, so treat it
  // as no-information and leave the data alone.
  if (liveSessionIds.size === 0) {
    return { remove: [], keptCount: keys.length };
  }

  const remove = keys.filter(key => !liveSessionIds.has(key));
  return { remove, keptCount: keys.length - remove.length };
}
