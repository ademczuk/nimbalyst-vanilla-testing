import type { IndexPublishOutcome, SessionIndexData, SyncProvider } from './types';

type PublishOptions = Parameters<NonNullable<SyncProvider['syncSessionsToIndex']>>[1];
type Pending = { rows: SessionIndexData[]; options?: PublishOptions; sequences: Map<string, number> };

/** Account-local retry ownership. A closed gate never consumes a pending row. */
export function createPendingIndexPublications(deps: {
  ready(): boolean;
  sequence(id: string): number;
  publish(rows: SessionIndexData[], options?: PublishOptions): Promise<IndexPublishOutcome>;
  warn(error: unknown): void;
}) {
  let pending: Pending[] = [];
  let generation = 0;
  let draining = false;
  let requested = false;

  async function drain(): Promise<void> {
    if (draining) { requested = true; return; }
    if (!deps.ready()) return;
    draining = true;
    const started = generation;
    try {
      do {
        requested = false;
        const batch = pending;
        pending = [];
        for (const op of batch) {
          if (started !== generation) return;
          // A newer publication supersedes the snapshot captured at enqueue.
          const rows = op.rows.filter(row => deps.sequence(row.id) === op.sequences.get(row.id));
          if (!rows.length) continue;
          if (!deps.ready()) { pending.push({ ...op, rows }); continue; }
          let result: IndexPublishOutcome;
          try { result = await deps.publish(rows, op.options); }
          catch (error) {
            deps.warn(error); // Retained below; reconnect/readiness re-drives it.
            result = { published: false, retryable: true, publishedSessionIds: [] };
          }
          if (started !== generation) return;
          // Our own send must not invalidate a later queued snapshot. Advance
          // its fence only for exactly our publication, never an intervening
          // live update (which increments the sequence again).
          for (const id of result.publishedSessionIds) {
            const previous = op.sequences.get(id);
            const current = deps.sequence(id);
            if (previous === undefined || current !== previous + 1) continue;
            for (const later of [...batch, ...pending]) {
              if (later !== op && later.sequences.get(id) === previous) later.sequences.set(id, current);
            }
          }
          if (!result.published && result.retryable !== false) {
            const unsent = rows.filter(row => !result.publishedSessionIds.includes(row.id));
            if (unsent.length) pending.push({ ...op, rows: unsent });
          }
        }
        // Only an external readiness/enqueue signal requests another pass.
      } while (requested && deps.ready() && started === generation);
    } finally { draining = false; }
  }

  return {
    enqueue(rows: SessionIndexData[], options?: PublishOptions) {
      pending.push({ rows, options, sequences: new Map(rows.map(row => [row.id, deps.sequence(row.id)])) });
    },
    drain,
    clear() { generation++; pending = []; requested = false; },
  };
}
