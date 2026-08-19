/**
 * Coalescing loader for session-file links (#1146-style N+1 fix, NIM-3085).
 *
 * Four renderer call sites independently issued one `session-files:get-by-session`
 * IPC per session (initial load, the `session-files:updated` broadcast handler,
 * FileGutter, WorkspaceSidebar). With thousands of sessions that produced
 * thousands of individual round trips against a single-lane SQLite worker.
 *
 * Round-trip COUNT is the lever here, not per-query cost. The worker is
 * single-threaded and FIFO, so every extra round trip is an independent chance
 * to queue behind an unrelated multi-second query. Measured on 11 real sessions:
 * the per-session fan-out ran 368ms at the median but 21,337ms on its worst
 * run, while one batched call for identical data ran 141ms at the median and
 * never exceeded 203ms.
 *
 * Callers keep asking per session; this module collects the ids requested
 * within a short window and issues a single `session-files:get-by-sessions`,
 * then fans the rows back out by sessionId. Requests for the same
 * (sessionId, linkType) inside one window share a single promise.
 */

import type { FileLink } from '@nimbalyst/runtime/ai/server/types';

/**
 * Kept small deliberately. This only needs to catch callers that fire in the
 * same tick or two (sibling components mounting, one broadcast fanning out to
 * several listeners); a longer window would delay file-gutter updates for no
 * additional batching benefit.
 */
const BATCH_WINDOW_MS = 8;

/**
 * Hard cap on ids per query. `getFilesBySessionMany` becomes
 * `session_id = ANY($1::text[])`, which the dialect translator expands to one
 * bind parameter per id on SQLite. A workstream sidebar can request every child
 * session in a single tick (FilesEditedSidebar loops over `workstreamSessions`),
 * so an uncapped batch would build a thousands-wide IN list — past SQLite's
 * variable limit on older builds, and expensive to prepare on any of them.
 * Chunking keeps this at one query per 200 sessions instead of one per session,
 * which is the win, without trading the fan-out for a single monster query.
 */
const MAX_IDS_PER_QUERY = 200;

interface PendingBatch {
  ids: Set<string>;
  waiters: Map<string, Array<(files: FileLink[]) => void>>;
  rejecters: Array<(error: unknown) => void>;
  timer: ReturnType<typeof setTimeout> | null;
}

/** One batch per linkType — the batch IPC takes a single linkType. */
const batches = new Map<string, PendingBatch>();

function batchKey(linkType: string | undefined): string {
  return linkType ?? '\0all';
}

function flush(key: string): void {
  const batch = batches.get(key);
  if (!batch) return;
  batches.delete(key);
  if (batch.timer) clearTimeout(batch.timer);

  const sessionIds = Array.from(batch.ids);
  const linkType = key === '\0all' ? undefined : key;

  void (async () => {
    try {
      const chunks: string[][] = [];
      for (let i = 0; i < sessionIds.length; i += MAX_IDS_PER_QUERY) {
        chunks.push(sessionIds.slice(i, i + MAX_IDS_PER_QUERY));
      }

      // Sequential, not Promise.all: the worker is single-lane, so firing every
      // chunk at once would just rebuild the queue depth this module exists to
      // remove.
      const bySession = new Map<string, FileLink[]>();
      for (const chunk of chunks) {
        const result = await window.electronAPI.invoke(
          'session-files:get-by-sessions',
          chunk,
          linkType
        );
        if (result?.success && Array.isArray(result.files)) {
          for (const file of result.files as FileLink[]) {
            const existing = bySession.get(file.sessionId);
            if (existing) existing.push(file);
            else bySession.set(file.sessionId, [file]);
          }
        }
      }

      // A session with no links is a legitimate empty result, not a failure.
      for (const [sessionId, resolvers] of batch.waiters) {
        const files = bySession.get(sessionId) ?? [];
        for (const resolve of resolvers) resolve(files);
      }
    } catch (error) {
      for (const reject of batch.rejecters) reject(error);
    }
  })();
}

/**
 * Request the file links for one session. Transparently batched with any other
 * request for the same linkType made within `BATCH_WINDOW_MS`.
 */
export function loadSessionFiles(
  sessionId: string,
  linkType?: string
): Promise<FileLink[]> {
  if (!sessionId) return Promise.resolve([]);
  if (typeof window === 'undefined' || !window.electronAPI?.invoke) {
    return Promise.resolve([]);
  }

  const key = batchKey(linkType);
  let batch = batches.get(key);
  if (!batch) {
    batch = { ids: new Set(), waiters: new Map(), rejecters: [], timer: null };
    batches.set(key, batch);
    batch.timer = setTimeout(() => flush(key), BATCH_WINDOW_MS);
  }

  batch.ids.add(sessionId);

  return new Promise<FileLink[]>((resolve, reject) => {
    const existing = batch.waiters.get(sessionId);
    if (existing) existing.push(resolve);
    else batch.waiters.set(sessionId, [resolve]);
    batch.rejecters.push(reject);
  });
}

/**
 * Same data shaped like the old per-session IPC response, so call sites that
 * already branch on `result.success`/`result.files` can switch over without
 * restructuring their error handling.
 */
export async function loadSessionFilesResult(
  sessionId: string,
  linkType?: string
): Promise<{ success: boolean; files: FileLink[] }> {
  try {
    return { success: true, files: await loadSessionFiles(sessionId, linkType) };
  } catch {
    return { success: false, files: [] };
  }
}

/** Test seam: drop any pending batches between cases. */
export function __resetSessionFilesLoaderForTests(): void {
  for (const batch of batches.values()) {
    if (batch.timer) clearTimeout(batch.timer);
  }
  batches.clear();
}
