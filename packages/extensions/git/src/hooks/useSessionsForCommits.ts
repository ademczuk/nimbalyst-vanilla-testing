import { useEffect, useState } from 'react';

const ipc = (window as unknown as {
  electronAPI: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  };
}).electronAPI;

export interface CommitSessionLink {
  sessionId: string;
  title: string | null;
  provider: string | null;
  attribution: 'exact' | 'inferred';
  committedAt: number | null;
}

export type CommitSessionMap = Record<string, CommitSessionLink>;

interface Response {
  success?: boolean;
  links?: CommitSessionMap;
  /** True while the historical scan is still running; the caller re-asks. */
  backfillPending?: boolean;
}

/** Poll interval while the one-time historical backfill is still running. */
const BACKFILL_POLL_MS = 1500;
/** Stop after this many polls so a wedged backfill can't poll forever. */
const MAX_BACKFILL_POLLS = 20;

/**
 * Maps each visible commit sha to the AI session that produced it.
 *
 * One batched IPC call per page of the log, never per row. The map is held
 * separately from the commit list on purpose: a slow or still-running backfill
 * must never block the log itself from rendering, and commits with no recorded
 * session simply stay absent from the map.
 */
export function useSessionsForCommits(shas: readonly string[]): CommitSessionMap {
  const [links, setLinks] = useState<CommitSessionMap>({});

  // Join the shas so the effect refires when the visible page changes, not on
  // every render that rebuilds an equal array.
  const key = shas.join(',');

  useEffect(() => {
    if (shas.length === 0) {
      setLinks({});
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fetchLinks = async (attempt: number): Promise<void> => {
      try {
        const res = (await ipc.invoke('sessions:get-by-commits', [...shas])) as Response;
        if (cancelled) return;
        setLinks(res?.success && res.links ? res.links : {});

        // On a first-ever open the ledger is still being populated from the
        // message log. Re-ask until it settles, so the column fills in instead
        // of staying blank until the commit list happens to change.
        if (res?.backfillPending && attempt < MAX_BACKFILL_POLLS) {
          timer = setTimeout(() => void fetchLinks(attempt + 1), BACKFILL_POLL_MS);
        }
      } catch {
        // Provenance is decoration on the log; a failed lookup leaves the
        // column empty rather than surfacing an error over the commit list.
        if (!cancelled) setLinks({});
      }
    };

    void fetchLinks(0);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return links;
}
