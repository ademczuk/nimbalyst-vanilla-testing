import { isLocalIssueKey } from '../../../shared/localIssueKey';
import { onTrackerItemApplied } from '../TrackerSyncManager';

/**
 * How long a create waits for the room to hand back the real issue key.
 *
 * The ack is a WebSocket round trip to the tracker room's Durable Object, and
 * we only wait at all when the engine reports `connected`, so the normal case
 * resolves well inside this. The bound exists for the case where the socket
 * drops between the send and the ack -- the queued mutation then waits for a
 * reconnect, which is unbounded, and a create must not hang on it.
 */
export const SERVER_ISSUE_KEY_TIMEOUT_MS = 2000;

interface QueryableDb {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Wait for the tracker room to assign `itemId` its real issue key.
 *
 * Returns the server key, or null if it did not arrive in time. A null result
 * means the item still has no key; callers must explain that it remains
 * unavailable until the publish reaches the server.
 *
 * Subscribing is not enough on its own: the ack can land between the caller's
 * last read and this call, and that listener would then never fire. So we
 * subscribe first, then re-read the row. An immutable existing key wins; when
 * the row is still unassigned, any acknowledgement buffered during the read is
 * returned instead.
 */
export async function awaitServerIssueKey(
  db: QueryableDb,
  itemId: string,
  timeoutMs: number = SERVER_ISSUE_KEY_TIMEOUT_MS,
): Promise<string | null> {
  let resolveAck: (key: string) => void = () => {};
  const acked = new Promise<string>((resolve) => { resolveAck = resolve; });
  const timeout = Symbol('issue-key-timeout');
  let resolveTimeout: (value: typeof timeout) => void = () => {};
  const timedOut = new Promise<typeof timeout>((resolve) => { resolveTimeout = resolve; });

  const unsubscribe = onTrackerItemApplied((_workspacePath, applied) => {
    if (applied.itemId !== itemId) return;
    if (!applied.issueKey || isLocalIssueKey(applied.issueKey)) return;
    resolveAck(applied.issueKey);
  });
  const timer = setTimeout(() => resolveTimeout(timeout), timeoutMs);

  try {
    // Read first (while already subscribed) so an immutable existing key wins
    // even if a conflicting ack arrives during the query. The read shares the
    // same timeout as the later ack wait, so a stalled database worker cannot
    // extend the advertised bound.
    const existing = await Promise.race([readServerIssueKey(db, itemId), timedOut]);
    if (existing === timeout) return null;
    if (existing) return existing;

    const assigned = await Promise.race([acked, timedOut]);
    return assigned === timeout ? null : assigned;
  } finally {
    unsubscribe();
    clearTimeout(timer);
  }
}

async function readServerIssueKey(db: QueryableDb, itemId: string): Promise<string | null> {
  const result = await db.query<{ issue_key: string | null }>(
    `SELECT issue_key FROM tracker_items WHERE id = $1`,
    [itemId],
  );
  const key = result.rows[0]?.issue_key ?? null;
  return key && !isLocalIssueKey(key) ? key : null;
}
