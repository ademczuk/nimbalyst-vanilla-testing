/**
 * toolOutputRetentionPass -- reclaim disk by tombstoning aged tool output.
 *
 * Layer 2 driver. The rewrite itself is pure and lives in
 * `@nimbalyst/runtime` (`toolOutputRetention`); this file owns row selection,
 * batching, and lane discipline.
 *
 * ## Why this runs on the background lane
 *
 * This is not a theoretical concern. While measuring the table for the plan
 * behind this work, four consecutive read-only analytical scans of
 * `ai_agent_messages` each held the SQLite worker to its 35-second timeout and
 * hung the app badly enough to need a restart -- routine reads
 * (`document_history`, `session_files`, normally 150-250 ms) queued behind
 * them. This pass touches the same table and additionally rewrites hundreds of
 * thousands of rows, so run naively it is an outage rather than a slow
 * maintenance job.
 *
 * `WriteCoordinator.runBackground` exists for exactly this: chunks yield to
 * the event loop between units, no hot-lane write runs concurrently with a
 * chunk, and any chunk over 50 ms is reported. Every query below is bounded by
 * `id` range and `LIMIT` -- there is no unbounded scan anywhere in this file,
 * including the estimate.
 *
 * ## What is never touched
 *
 *   - `direction = 'input'`  -- every user prompt, forever
 *   - `message_kind = 'assistant'` -- every word the agent said, forever
 *   - `tool_use` calls -- name, arguments and Edit diffs, so "what did the
 *     agent do to my repo" stays answerable
 *   - `system/init` / `compact_boundary` -- session forensics
 *   - rows in a session that is currently running or waiting on the user
 */
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { tombstoneRawContent } from '@nimbalyst/runtime/storage/toolOutputRetention';

/** Rows examined per background chunk. Sized to stay well under the
 *  coordinator's 50 ms slow-chunk warning on a cold cache. */
const CHUNK_ROWS = 250;

/** Rows sampled by the estimate. Deliberately bounded -- the full-table
 *  `SUM(LENGTH(content))` version of this query is what hung the app. */
const ESTIMATE_SAMPLE_ROWS = 2000;

/**
 * Only these providers have a tombstone shape. Others are left alone rather
 * than guessed at.
 */
const ELIGIBLE_SOURCE_PREFIXES = ['claude-code', 'openai-codex', 'copilot-cli'];

export interface RetentionProgress {
  scanned: number;
  rewritten: number;
  bytesSaved: number;
}

export interface RetentionResult extends RetentionProgress {
  durationMs: number;
  cutoffIso: string;
  stoppedEarly: boolean;
}

export interface RetentionOptions {
  /** Age threshold in days. Rows newer than this are never touched. */
  retentionDays: number;
  /** Cap on rows examined in one run so a first pass on a huge table ends. */
  maxRows?: number;
  onProgress?: (p: RetentionProgress) => void;
  /**
   * Log sink. Injected rather than imported because this pass executes inside
   * the SQLite worker_threads worker, where `electron-log/main` cannot be
   * required (no `electron` module resolution from a worker bundle). Defaults
   * to a no-op.
   */
  log?: (level: 'info' | 'warn', msg: string) => void;
  /** Injectable for tests. */
  now?: () => number;
}

interface CandidateRow {
  id: number;
  source: string;
  content: string;
}

function cutoffIso(retentionDays: number, now: number): string {
  return new Date(now - retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

const SOURCE_PREDICATE = ELIGIBLE_SOURCE_PREFIXES.map(() => `m.source LIKE ? || '%'`).join(' OR ');

/**
 * Candidate selection. Tool rows only, older than the cutoff, in a session
 * that is not currently active.
 *
 * `message_kind = 'tool'` covers claude-code; codex persists its raw item
 * events as `meta`, so both are admitted and the pure rewrite decides whether
 * a given row actually carries output.
 */
const CANDIDATE_SQL = `
  SELECT m.id, m.source, m.content
  FROM ai_agent_messages m
  JOIN ai_sessions s ON s.id = m.session_id
  WHERE m.id > ?
    AND m.created_at < ?
    AND m.direction = 'output'
    AND m.message_kind IN ('tool', 'meta')
    AND (${SOURCE_PREDICATE})
    AND s.status NOT IN ('running', 'waiting_for_input')
  ORDER BY m.id ASC
  LIMIT ?
`;

/**
 * Estimate reclaimable bytes from a bounded sample, for a confirmation prompt.
 * Extrapolates from the sample's hit rate rather than scanning the table.
 */
export interface ReclaimEstimate {
  sampledRows: number;
  sampleBytesSaved: number;
  candidateRows: number;
  estimatedBytesSaved: number;
}

/** Id span counted per estimate chunk, so the worker yields while counting. */
const ESTIMATE_COUNT_WINDOW = 200_000;

/**
 * Chunked estimate for the background lane.
 *
 * Counting all candidates in ONE statement took 5.7 s against a real 10 GB
 * store, and better-sqlite3 is synchronous -- that is 5.7 s of blocked worker
 * behind a single click, which is the exact failure this whole file exists to
 * avoid. (It never showed up in `_perf_slow_queries` either: the estimate runs
 * on the raw handle and bypasses the instrumented query path, the same blind
 * spot that hid the 35 s timeouts during the original investigation.) Counting
 * an id window per chunk lets the coordinator yield between windows.
 */
export function createToolOutputEstimateWork(
  retentionDays: number,
  onDone: (estimate: ReclaimEstimate) => void,
  now: number = Date.now(),
) {
  const cutoff = cutoffIso(retentionDays, now);
  const iso = new Date(now).toISOString();

  let bounds: { lo: number; hi: number } | null = null;
  let cursor = 0;
  let candidateRows = 0;
  let sampleBytesSaved = 0;
  let sampledRows = 0;
  let sampleTaken = 0;

  return {
    name: 'tool-output-retention-estimate',
    chunk(db: SqliteDatabase): { done: boolean } {
      if (!bounds) {
        const b = db
          .prepare(
            `SELECT MIN(id) AS lo, MAX(id) AS hi FROM ai_agent_messages WHERE created_at < ?`,
          )
          .get(cutoff) as { lo: number | null; hi: number | null } | undefined;
        bounds = { lo: Number(b?.lo ?? 0), hi: Number(b?.hi ?? 0) };
        // Windows are half-open (`id > cursor`), so start one below the lowest
        // id or the very first candidate row is never counted.
        cursor = bounds.lo - 1;
      }

      if (cursor > bounds.hi) {
        const perRow = sampledRows > 0 ? sampleBytesSaved / sampledRows : 0;
        onDone({
          sampledRows,
          sampleBytesSaved,
          candidateRows,
          estimatedBytesSaved: Math.round(perRow * candidateRows),
        });
        return { done: true };
      }

      const windowEnd = cursor + ESTIMATE_COUNT_WINDOW;
      const row = db
        .prepare(
          `SELECT COUNT(*) AS n
             FROM ai_agent_messages m
             JOIN ai_sessions s ON s.id = m.session_id
            WHERE m.id > ? AND m.id <= ?
              AND m.created_at < ?
              AND m.direction = 'output'
              AND m.message_kind IN ('tool', 'meta')
              AND (${SOURCE_PREDICATE})
              AND s.status NOT IN ('running', 'waiting_for_input')`,
        )
        .get(cursor, windowEnd, cutoff, ...ELIGIBLE_SOURCE_PREFIXES) as { n: number } | undefined;
      candidateRows += Number(row?.n ?? 0);

      // Sample from every window, so the estimate reflects the whole id range
      // rather than the oldest (and smallest) rows.
      const budget = Math.ceil(ESTIMATE_SAMPLE_ROWS / 20);
      if (sampleTaken < ESTIMATE_SAMPLE_ROWS) {
        const rows = db
          .prepare(CANDIDATE_SQL)
          .all(cursor, cutoff, ...ELIGIBLE_SOURCE_PREFIXES, budget) as CandidateRow[];
        for (const r of rows) {
          if (r.id > windowEnd) break;
          sampleTaken++;
          sampledRows++;
          const rewritten = tombstoneRawContent(r.content, r.source, iso);
          if (rewritten !== null) sampleBytesSaved += r.content.length - rewritten.length;
        }
      }

      cursor = windowEnd;
      return { done: false };
    },
  };
}

/**
 * Synchronous convenience wrapper that drives the chunked estimate to
 * completion. Fine for tests and small stores; production callers should hand
 * `createToolOutputEstimateWork` to the background lane instead.
 */
export function estimateReclaimableBytes(
  db: SqliteDatabase,
  retentionDays: number,
  now: number = Date.now(),
): ReclaimEstimate {
  let out: ReclaimEstimate | null = null;
  const work = createToolOutputEstimateWork(retentionDays, (e) => { out = e; }, now);
  while (!work.chunk(db).done) { /* drive to completion */ }
  return out ?? { sampledRows: 0, sampleBytesSaved: 0, candidateRows: 0, estimatedBytesSaved: 0 };
}

/**
 * Build the chunked background work. The caller hands this to
 * `SQLiteDatabase.runBackground` so it inherits the coordinator's yielding and
 * hot-lane priority.
 */
export function createToolOutputRetentionWork(
  options: RetentionOptions,
  onDone: (result: RetentionResult) => void,
) {
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});
  const startedAt = now();
  const cutoff = cutoffIso(options.retentionDays, startedAt);
  const stampIso = new Date(startedAt).toISOString();
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;

  const progress: RetentionProgress = { scanned: 0, rewritten: 0, bytesSaved: 0 };
  let lastId = 0;

  return {
    name: 'tool-output-retention',
    chunk(db: SqliteDatabase): { done: boolean } {
      if (progress.scanned >= maxRows) {
        onDone({ ...progress, durationMs: now() - startedAt, cutoffIso: cutoff, stoppedEarly: true });
        return { done: true };
      }

      const rows = db
        .prepare(CANDIDATE_SQL)
        .all(lastId, cutoff, ...ELIGIBLE_SOURCE_PREFIXES, CHUNK_ROWS) as CandidateRow[];

      if (rows.length === 0) {
        log(
          'info',
          `[ToolRetention] complete: scanned=${progress.scanned} rewritten=${progress.rewritten} `
            + `saved=${(progress.bytesSaved / 1024 / 1024).toFixed(1)}MB`,
        );
        onDone({ ...progress, durationMs: now() - startedAt, cutoffIso: cutoff, stoppedEarly: false });
        return { done: true };
      }

      const update = db.prepare('UPDATE ai_agent_messages SET content = ? WHERE id = ?');
      for (const row of rows) {
        lastId = row.id;
        progress.scanned++;
        const rewritten = tombstoneRawContent(row.content, row.source, stampIso);
        if (rewritten === null) continue;
        update.run(rewritten, row.id);
        progress.rewritten++;
        progress.bytesSaved += row.content.length - rewritten.length;
      }

      options.onProgress?.({ ...progress });
      return { done: false };
    },
  };
}
