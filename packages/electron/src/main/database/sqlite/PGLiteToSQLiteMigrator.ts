/**
 * PGLiteToSQLiteMigrator
 *
 * Copies every row from the legacy PGLite store into a fresh SQLite database
 * (already opened by `SQLiteDatabase` with the consolidated `0001_initial.sql`
 * schema applied). The migrator is the data-plane half of the migration;
 * orchestration (backup → quiesce → schema → copy → cutover) lives in the
 * IPC handler that drives this class.
 *
 * Design choices:
 *   - Reads PGLite via the `@electric-sql/pglite` ESM module in the same
 *     process. The PGLite worker thread must be closed before the migrator
 *     runs; the migrator opens its own short-lived PGLite handle in
 *     `readonly: true` mode against the source directory.
 *   - Writes SQLite through `coordinator.runBackground(...)` so the JS event
 *     loop stays responsive during long table copies. Each batch is wrapped
 *     in a single `BEGIN IMMEDIATE / COMMIT` via better-sqlite3's transaction
 *     helper for fsync amortization.
 *   - `PRAGMA foreign_keys = OFF` during copy so we can insert tables in any
 *     order, plus self-referential FKs (`ai_sessions.parent_session_id`,
 *     `ai_transcript_events.parent_event_id`) don't need ordering. We turn
 *     them back on and run `PRAGMA foreign_key_check` at the end.
 *   - FTS5 mirrors (`ai_agent_messages_fts`, `ai_transcript_events_fts`)
 *     populate automatically through the AFTER INSERT triggers; no separate
 *     backfill step needed. The plan called for this to be wider than the
 *     PGLite `searchable=true` partial index — the SQLite trigger has no
 *     WHERE clause, so every copied row is indexed.
 *   - Generated columns (`tracker_items.title`, `status`, `kanban_sort_order`)
 *     are skipped at INSERT time; SQLite computes them from `data`.
 *
 * Verification:
 *   - Per-table row counts match.
 *   - Spot-check N random rows per table with normalized deep-equality.
 *   - `PRAGMA integrity_check` returns 'ok'.
 *   - `PRAGMA foreign_key_check` returns no rows.
 */

import type { Database as BetterSqliteDb } from 'better-sqlite3';
import type { SQLiteDatabase } from './SQLiteDatabase';

// Surface of the PGLite client we use. Keeps the migrator testable without
// importing the heavy ESM module in the test runner.
export interface PGLiteHandle {
  query<T = unknown>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; fields?: { name: string; dataTypeID: number }[] }>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}

export type MigrationPhase =
  | 'preparing'
  | 'copying'
  | 'verifying-counts'
  | 'verifying-integrity'
  | 'verifying-foreign-keys'
  | 'verifying-spot-check'
  | 'finalizing';

export interface MigrationProgress {
  phase: MigrationPhase;
  currentTable?: string;
  rowsCopied: number;
  rowsExpected: number;
  tableRowsCopied: number;
  tableRowsExpected: number;
  tablesCompleted: number;
  tablesTotal: number;
  percentOfTotal: number;
  /** Milliseconds since migrator.migrate() started. */
  elapsedMs: number;
}

export interface MigrationSummary {
  totalRowsCopied: number;
  tablesCopied: { name: string; rows: number }[];
  durationMs: number;
  integrityCheck: string;
  foreignKeyViolations: number;
  spotCheckCount: number;
}

export interface MigrateOptions {
  pglite: PGLiteHandle;
  sqlite: SQLiteDatabase;
  /** Receives progress events. Called synchronously from the migrator. */
  onProgress?: (progress: MigrationProgress) => void;
  /** Per-batch row count. Default 1000. */
  batchSize?: number;
  /** Number of random rows per table to deep-equality check. Default 5. */
  spotCheckPerTable?: number;
  /** Logger. */
  log?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
}

/**
 * Table copy order. Foreign keys are OFF during copy so this only matters for
 * humans reading progress and for deterministic verification ordering. The
 * order roughly follows dependency depth (parents before children) so the
 * progress UI tells a coherent story.
 */
const COPY_TABLES: readonly string[] = [
  'worktrees',
  'ai_sessions',
  'document_history',
  'session_files',
  'ai_agent_messages',
  'ai_tool_call_file_edits',
  'tracker_items',
  'tracker_body_cache',
  'tracker_transactions',
  'queued_prompts',
  'ai_session_wakeups',
  'super_loops',
  'super_iterations',
  'ai_transcript_events',
  'collab_local_origins',
];

interface TargetColumn {
  name: string;
  type: string;
  /** Whether this column is GENERATED (must not appear in INSERT). */
  generated: boolean;
  /** Whether this column is BLOB-typed (BYTEA in PGLite). */
  isBlob: boolean;
}

export class PGLiteToSQLiteMigrator {
  async migrate(opts: MigrateOptions): Promise<MigrationSummary> {
    const t0 = performance.now();
    const batchSize = opts.batchSize ?? 1000;
    const spotCheckPerTable = opts.spotCheckPerTable ?? 5;
    const log = opts.log ?? (() => {});
    const sqliteHandle = opts.sqlite.getRawHandle();
    if (!sqliteHandle) {
      throw new Error('SQLiteDatabase must be initialized before migration');
    }

    const pgliteCounts = await this.measureSourceCounts(opts.pglite);
    const totalExpected = pgliteCounts.reduce((sum, t) => sum + t.rows, 0);

    log('info', `[migrator] starting; ${totalExpected} rows across ${pgliteCounts.length} tables`);

    // Foreign keys OFF during copy so the order doesn't matter and self-FKs work.
    sqliteHandle.pragma('foreign_keys = OFF');

    let totalCopied = 0;
    const tableSummary: { name: string; rows: number }[] = [];

    opts.onProgress?.({
      phase: 'preparing',
      rowsCopied: 0,
      rowsExpected: totalExpected,
      tableRowsCopied: 0,
      tableRowsExpected: 0,
      tablesCompleted: 0,
      tablesTotal: pgliteCounts.length,
      percentOfTotal: 0,
      elapsedMs: performance.now() - t0,
    });

    for (let i = 0; i < pgliteCounts.length; i++) {
      const { name, rows: tableExpected } = pgliteCounts[i];
      const copied = await this.copyTable({
        sourceTable: name,
        expectedRows: tableExpected,
        pglite: opts.pglite,
        sqlite: opts.sqlite,
        sqliteHandle,
        batchSize,
        onBatchProgress: (tableRowsCopied) => {
          totalCopied = pgliteCounts
            .slice(0, i)
            .reduce((s, t) => s + t.rows, 0) + tableRowsCopied;
          opts.onProgress?.({
            phase: 'copying',
            currentTable: name,
            rowsCopied: totalCopied,
            rowsExpected: totalExpected,
            tableRowsCopied,
            tableRowsExpected: tableExpected,
            tablesCompleted: i,
            tablesTotal: pgliteCounts.length,
            percentOfTotal:
              totalExpected === 0 ? 100 : (totalCopied / totalExpected) * 100,
            elapsedMs: performance.now() - t0,
          });
        },
        log,
      });
      tableSummary.push({ name, rows: copied });
      log('info', `[migrator] copied ${copied}/${tableExpected} rows from ${name}`);
    }

    // Verify counts.
    opts.onProgress?.({
      phase: 'verifying-counts',
      rowsCopied: totalCopied,
      rowsExpected: totalExpected,
      tableRowsCopied: 0,
      tableRowsExpected: 0,
      tablesCompleted: pgliteCounts.length,
      tablesTotal: pgliteCounts.length,
      percentOfTotal: 100,
      elapsedMs: performance.now() - t0,
    });
    for (const { name, rows: expected } of pgliteCounts) {
      const actual = sqliteHandle.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(name)}`).get() as { c: number };
      if (actual.c !== expected) {
        throw new Error(
          `Row-count mismatch on ${name}: source=${expected}, target=${actual.c}`,
        );
      }
    }

    // Spot-check N random rows per table.
    opts.onProgress?.({
      phase: 'verifying-spot-check',
      rowsCopied: totalCopied,
      rowsExpected: totalExpected,
      tableRowsCopied: 0,
      tableRowsExpected: 0,
      tablesCompleted: pgliteCounts.length,
      tablesTotal: pgliteCounts.length,
      percentOfTotal: 100,
      elapsedMs: performance.now() - t0,
    });
    let spotCheckCount = 0;
    for (const { name, rows: expected } of pgliteCounts) {
      if (expected === 0) continue;
      const n = Math.min(spotCheckPerTable, expected);
      spotCheckCount += await this.spotCheckTable({
        table: name,
        pglite: opts.pglite,
        sqliteHandle,
        sampleSize: n,
      });
    }

    // Integrity + FK checks.
    opts.onProgress?.({
      phase: 'verifying-integrity',
      rowsCopied: totalCopied,
      rowsExpected: totalExpected,
      tableRowsCopied: 0,
      tableRowsExpected: 0,
      tablesCompleted: pgliteCounts.length,
      tablesTotal: pgliteCounts.length,
      percentOfTotal: 100,
      elapsedMs: performance.now() - t0,
    });
    const integrity = sqliteHandle.pragma('integrity_check', { simple: true }) as string;
    if (integrity !== 'ok') {
      throw new Error(`integrity_check returned: ${integrity}`);
    }

    opts.onProgress?.({
      phase: 'verifying-foreign-keys',
      rowsCopied: totalCopied,
      rowsExpected: totalExpected,
      tableRowsCopied: 0,
      tableRowsExpected: 0,
      tablesCompleted: pgliteCounts.length,
      tablesTotal: pgliteCounts.length,
      percentOfTotal: 100,
      elapsedMs: performance.now() - t0,
    });
    sqliteHandle.pragma('foreign_keys = ON');
    const fkViolations = sqliteHandle.prepare('PRAGMA foreign_key_check').all() as unknown[];
    if (fkViolations.length > 0) {
      throw new Error(
        `foreign_key_check failed: ${fkViolations.length} violations; first: ${JSON.stringify(fkViolations[0])}`,
      );
    }

    opts.onProgress?.({
      phase: 'finalizing',
      rowsCopied: totalCopied,
      rowsExpected: totalExpected,
      tableRowsCopied: 0,
      tableRowsExpected: 0,
      tablesCompleted: pgliteCounts.length,
      tablesTotal: pgliteCounts.length,
      percentOfTotal: 100,
      elapsedMs: performance.now() - t0,
    });

    const summary: MigrationSummary = {
      totalRowsCopied: totalCopied,
      tablesCopied: tableSummary,
      durationMs: performance.now() - t0,
      integrityCheck: integrity,
      foreignKeyViolations: fkViolations.length,
      spotCheckCount,
    };
    log('info', '[migrator] migration complete', summary);
    return summary;
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private async measureSourceCounts(
    pglite: PGLiteHandle,
  ): Promise<{ name: string; rows: number }[]> {
    const out: { name: string; rows: number }[] = [];
    for (const name of COPY_TABLES) {
      const exists = await this.tableExistsInPglite(pglite, name);
      if (!exists) {
        out.push({ name, rows: 0 });
        continue;
      }
      const result = await pglite.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM ${quoteIdent(name)}`,
      );
      const count = Number(result.rows[0]?.c ?? 0);
      out.push({ name, rows: count });
    }
    return out;
  }

  private async getSourceColumns(pglite: PGLiteHandle, table: string): Promise<Set<string>> {
    const result = await pglite.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );
    return new Set(result.rows.map((r) => r.column_name));
  }

  private async tableExistsInPglite(pglite: PGLiteHandle, name: string): Promise<boolean> {
    const result = await pglite.query<{ e: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS e`,
      [name],
    );
    return Boolean(result.rows[0]?.e);
  }

  private async copyTable(opts: {
    sourceTable: string;
    expectedRows: number;
    pglite: PGLiteHandle;
    sqlite: SQLiteDatabase;
    sqliteHandle: BetterSqliteDb;
    batchSize: number;
    onBatchProgress: (rowsCopiedInTable: number) => void;
    log: NonNullable<MigrateOptions['log']>;
  }): Promise<number> {
    if (opts.expectedRows === 0) {
      opts.onBatchProgress(0);
      return 0;
    }

    const target = this.getTargetColumns(opts.sqliteHandle, opts.sourceTable);
    // Intersect with the source's columns so we don't try to INSERT a target
    // column the source never had (the SQLite schema may legitimately add
    // columns that the PGLite end-state didn't carry). SQLite fills in the
    // DEFAULT for any column we omit.
    const sourceCols = await this.getSourceColumns(opts.pglite, opts.sourceTable);
    const insertableCols = target.filter(
      (c) => !c.generated && sourceCols.has(c.name),
    );
    if (insertableCols.length === 0) {
      throw new Error(`No insertable columns for ${opts.sourceTable}`);
    }
    const insertSql = `INSERT INTO ${quoteIdent(opts.sourceTable)}(${insertableCols
      .map((c) => quoteIdent(c.name))
      .join(',')}) VALUES (${insertableCols.map(() => '?').join(',')})`;

    const stmt = opts.sqliteHandle.prepare(insertSql);
    const insertMany = opts.sqliteHandle.transaction((rows: unknown[][]) => {
      for (const r of rows) stmt.run(...r);
    });

    // Stream batches. PGLite doesn't expose server-side cursors over the JS
    // API, so we paginate with LIMIT/OFFSET. For large tables this is O(n^2)
    // in the worst case (each batch re-scans rows it skipped), but PGLite is
    // a single-process embedded engine — in practice the dominant cost is
    // (de)serialization, and this stays well below user-tolerance for the
    // expected DB sizes.
    let copied = 0;
    let offset = 0;
    while (offset < opts.expectedRows) {
      const result = await opts.pglite.query<Record<string, unknown>>(
        `SELECT * FROM ${quoteIdent(opts.sourceTable)} ORDER BY 1 LIMIT $1 OFFSET $2`,
        [opts.batchSize, offset],
      );
      if (result.rows.length === 0) break;

      const translatedBatch: unknown[][] = result.rows.map((row) =>
        this.translateRow(row, insertableCols),
      );

      // Run the insert through the hot write lane. Each batch is a single
      // BEGIN IMMEDIATE / COMMIT so we pay one fsync per batch instead of one
      // per row. The await yields the event loop after the batch commits,
      // and the next iteration awaits pglite.query() which yields again.
      const coordinator = opts.sqlite.getCoordinator();
      if (!coordinator) throw new Error('SQLiteDatabase coordinator not available');
      await coordinator.write((db: BetterSqliteDb) => {
        if (db === opts.sqliteHandle) {
          insertMany(translatedBatch);
        } else {
          // Defensive: coordinator should always pass the same handle we
          // prepared the statement against.
          throw new Error('WriteCoordinator handed a different db handle');
        }
      });

      copied += result.rows.length;
      offset += result.rows.length;
      opts.onBatchProgress(copied);

      // Safety: if PGLite returned fewer rows than batchSize, we're done.
      if (result.rows.length < opts.batchSize) break;
    }

    if (copied !== opts.expectedRows) {
      opts.log(
        'warn',
        `[migrator] ${opts.sourceTable}: copied ${copied} but expected ${opts.expectedRows}`,
      );
    }
    return copied;
  }

  private getTargetColumns(db: BetterSqliteDb, table: string): TargetColumn[] {
    // PRAGMA table_xinfo returns hidden=2 for GENERATED STORED columns and
    // hidden=3 for GENERATED VIRTUAL columns. Neither can appear in INSERT.
    const rows = db
      .prepare(`PRAGMA table_xinfo(${quoteIdent(table)})`)
      .all() as { name: string; type: string; hidden: number }[];
    return rows.map((r) => ({
      name: r.name,
      type: (r.type || '').toUpperCase(),
      generated: r.hidden === 2 || r.hidden === 3,
      isBlob: (r.type || '').toUpperCase().includes('BLOB'),
    }));
  }

  /**
   * Map a PGLite row into a tuple of better-sqlite3-bindable values, in the
   * order of `cols`. Type rules:
   *   - undefined / null     -> null
   *   - Date                 -> ISO-8601 string
   *   - Buffer / Uint8Array  -> Buffer (kept; for BLOB columns)
   *   - boolean              -> 0 / 1 (better-sqlite3 doesn't accept booleans)
   *   - object / array       -> JSON.stringify (covers JSONB and TEXT[])
   *   - bigint               -> kept (better-sqlite3 has bigint mode; we
   *                             default to Number-safe values, so leave as is)
   *   - number / string      -> kept verbatim
   */
  private translateRow(row: Record<string, unknown>, cols: TargetColumn[]): unknown[] {
    const out: unknown[] = new Array(cols.length);
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      const raw = row[col.name];
      out[i] = translateValue(raw, col);
    }
    return out;
  }

  private async spotCheckTable(opts: {
    table: string;
    pglite: PGLiteHandle;
    sqliteHandle: BetterSqliteDb;
    sampleSize: number;
  }): Promise<number> {
    // PGLite syntax for random sampling. ORDER BY random() is fine for the
    // small N we're sampling.
    const pgRows = await opts.pglite.query<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdent(opts.table)} ORDER BY random() LIMIT $1`,
      [opts.sampleSize],
    );
    if (pgRows.rows.length === 0) return 0;

    const targetCols = this.getTargetColumns(opts.sqliteHandle, opts.table);
    const sourceCols = await this.getSourceColumns(opts.pglite, opts.table);
    // Spot-check only compares columns that exist in BOTH source and target —
    // columns we didn't copy (because the source lacked them) just hold the
    // SQLite default, which is by definition correct.
    const checkCols = targetCols.filter((c) => !c.generated && sourceCols.has(c.name));
    // Find a primary-key-ish column to look up by. Use the first non-generated
    // column whose name is `id`, `item_id`, or fall back to the first column.
    const pkCol = checkCols.find((c) => c.name === 'id' || c.name === 'item_id')
      || checkCols[0];
    if (!pkCol) return 0;

    let checked = 0;
    const stmt = opts.sqliteHandle.prepare(
      `SELECT * FROM ${quoteIdent(opts.table)} WHERE ${quoteIdent(pkCol.name)} = ?`,
    );
    for (const pgRow of pgRows.rows) {
      const pkValue = translateValue(pgRow[pkCol.name], pkCol);
      const sqliteRow = stmt.get(pkValue) as Record<string, unknown> | undefined;
      if (!sqliteRow) {
        throw new Error(
          `Spot check failed: ${opts.table}.${pkCol.name}=${String(pkValue)} not found in SQLite`,
        );
      }
      assertRowsMatch(opts.table, pgRow, sqliteRow, checkCols);
      checked++;
    }
    return checked;
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function quoteIdent(name: string): string {
  // We only accept names from a fixed whitelist (COPY_TABLES) plus column
  // names returned by PRAGMA table_xinfo / information_schema. Double-quote
  // to escape any reserved keywords.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to quote suspicious identifier: ${name}`);
  }
  return `"${name}"`;
}

function translateValue(raw: unknown, col: TargetColumn): unknown {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw.toISOString();
  if (raw instanceof Uint8Array || Buffer.isBuffer(raw)) {
    // better-sqlite3 accepts Buffer / Uint8Array for BLOB columns.
    return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  }
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (typeof raw === 'bigint') return raw;
  if (typeof raw === 'number' || typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return JSON.stringify(raw);
  if (typeof raw === 'object') {
    // PGLite JSONB columns come back as parsed objects; stringify for storage.
    return JSON.stringify(raw);
  }
  return raw;
}

function assertRowsMatch(
  table: string,
  pgRow: Record<string, unknown>,
  sqliteRow: Record<string, unknown>,
  cols: TargetColumn[],
): void {
  for (const col of cols) {
    if (col.generated) continue;
    const pgVal = translateValue(pgRow[col.name], col);
    const sqliteVal = sqliteRow[col.name];
    if (!valuesEquivalent(pgVal, sqliteVal, col)) {
      throw new Error(
        `Spot check mismatch in ${table}.${col.name}: pglite=${stringifyForError(pgVal)}, sqlite=${stringifyForError(sqliteVal)}`,
      );
    }
  }
}

function valuesEquivalent(a: unknown, b: unknown, col: TargetColumn): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) return a.equals(b);
  if (Buffer.isBuffer(a) || Buffer.isBuffer(b)) {
    const av = Buffer.isBuffer(a) ? a : Buffer.from(b as Buffer);
    const bv = Buffer.isBuffer(b) ? b : Buffer.from(a as Buffer);
    return av.equals(bv);
  }
  // Numbers may come back as bigint from better-sqlite3 for INTEGER columns.
  if (
    (typeof a === 'number' || typeof a === 'bigint') &&
    (typeof b === 'number' || typeof b === 'bigint')
  ) {
    return BigInt(a as number | bigint) === BigInt(b as number | bigint);
  }
  // JSON columns: compare by parsed form to ignore key ordering and whitespace.
  if (typeof a === 'string' && typeof b === 'string') {
    if (looksLikeJson(a) || looksLikeJson(b)) {
      try {
        return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
      } catch {
        /* fall through */
      }
    }
    return a === b;
  }
  return false;
}

function looksLikeJson(s: string): boolean {
  if (s.length === 0) return false;
  const c = s[0];
  return c === '{' || c === '[' || c === '"';
}

function stringifyForError(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (Buffer.isBuffer(v)) return `<Buffer ${v.length}b>`;
  if (typeof v === 'string') return v.length > 200 ? `${v.slice(0, 200)}…` : v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const __TEST_HOOKS = { COPY_TABLES, quoteIdent, translateValue };
