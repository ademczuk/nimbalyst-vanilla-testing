/**
 * Ask the workspace's connected tracker engine to push its schema outbox now.
 *
 * The engine drains `tracker_type_defs` rows at `sync_status` 'local' / 'pending'
 * (and the predicate registry) only at the end of a bootstrap. Without a nudge, a
 * schema saved mid-session waited for the next disconnect/connect, so teammates
 * and the web console read a stale definition with nothing telling the author
 * (NIM-6654).
 *
 * The writers that put a change into the outbox call `requestTrackerSchemaFlush`;
 * `TrackerSyncManager` registers the handler that reaches the engine. Kept apart
 * from both so the store does not import the sync manager (and its socket) and
 * the manager does not grow.
 *
 * Debounced per workspace: a YAML directory load or a burst of saves materializes
 * many rows, and one push after the burst sends each of them once.
 */

type FlushHandler = (workspacePath: string) => void | Promise<void>;

export const TRACKER_SCHEMA_FLUSH_DEBOUNCE_MS = 250;

let handler: FlushHandler | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Returns an unregister function; a later registration replaces this one. */
export function registerTrackerSchemaFlushHandler(next: FlushHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

export function requestTrackerSchemaFlush(workspacePath: string): void {
  if (!workspacePath) return;
  const existing = timers.get(workspacePath);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    timers.delete(workspacePath);
    const current = handler;
    if (!current) return;
    // A failed push leaves the row queued; the next bootstrap retries it.
    void Promise.resolve()
      .then(() => current(workspacePath))
      .catch(err => console.warn('[TrackerSchemaSync] schema flush failed for', workspacePath, err));
  }, TRACKER_SCHEMA_FLUSH_DEBOUNCE_MS);
  (timer as { unref?: () => void }).unref?.();
  timers.set(workspacePath, timer);
}
