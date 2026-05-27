/**
 * Database Browser handlers, SQLite edition.
 *
 * Mirrors the channel surface of `DatabaseBrowserHandlers.ts` (PGLite) so the
 * renderer doesn't have to know which backend is live. The cutover wiring in
 * `initialize.ts` registers exactly one of the two sets based on the resolved
 * backend.
 *
 * Translations vs the PGLite handlers:
 *   `pg_catalog.pg_tables`              -> `sqlite_master`
 *   `information_schema.columns`        -> `PRAGMA table_info(t)`
 *   `pg_index` / `pg_attribute`         -> `PRAGMA table_info(t)` (pk col)
 *   `pg_total_relation_size('"t"')`     -> `SELECT sum(pgsize) FROM dbstat WHERE name = ?`
 *   `pg_database_size(current_database())` -> `PRAGMA page_count * page_size`
 *   `pg_ls_waldir()`                    -> file size of `nimbalyst.sqlite-wal`
 *
 * The Performance tab is a new surface — there's no PGLite equivalent.
 * Channel `database:getPerformance` reads from `SQLiteDatabase.getInstrumentation()`.
 */
import * as fs from 'fs';
import * as path from 'path';
import { safeHandle } from '../utils/ipcRegistry';
import type { SQLiteDatabase } from '../database/sqlite/SQLiteDatabase';
import type { SQLiteBackupService } from '../services/database/SQLiteBackupService';

export interface SqliteBrowserHandlerDeps {
  /** Live SQLite database handle. */
  sqlite: SQLiteDatabase;
  /** Backup service for dashboard status; null if not yet wired. */
  backupService?: SQLiteBackupService | null;
  /** Absolute path of `nimbalyst.sqlite` so we can stat WAL/SHM siblings. */
  sqliteFilePath: string;
}

type Sanitizer = (s: string) => string;
const sanitize: Sanitizer = (name) => name.replace(/[^a-zA-Z0-9_]/g, '');

// Pure-logic backend exposed for unit testing. Each method returns the same
// shape the IPC handler returns; the handler is a thin try/catch wrapper.
export class DatabaseBrowserSqliteBackend {
  constructor(private deps: SqliteBrowserHandlerDeps) {}

  async listTables() {
    const { sqlite } = this.deps;
    const result = await sqlite.query<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
         AND name NOT LIKE '\\_%' ESCAPE '\\'
       ORDER BY name`,
    );
    return result.rows.map((r) => r.name);
  }

  getTableSchema(tableName: string) {
    const handle = this.deps.sqlite.getRawHandle();
    if (!handle) throw new Error('SQLite handle unavailable');
    const safeName = sanitize(tableName);
    const rows = handle.prepare(`PRAGMA table_info(${safeName})`).all() as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }[];
    return rows.map((r) => ({
      column_name: r.name,
      data_type: r.type,
      is_nullable: r.notnull ? 'NO' : 'YES',
      column_default: r.dflt_value,
    }));
  }

  getPrimaryKeys(tableName: string): string[] {
    const handle = this.deps.sqlite.getRawHandle();
    if (!handle) throw new Error('SQLite handle unavailable');
    const safeName = sanitize(tableName);
    const rows = handle.prepare(`PRAGMA table_info(${safeName})`).all() as {
      name: string;
      pk: number;
    }[];
    return rows.filter((r) => r.pk > 0).sort((a, b) => a.pk - b.pk).map((r) => r.name);
  }

  async getTotalDbBytes(): Promise<number> {
    const handle = this.deps.sqlite.getRawHandle();
    if (!handle) throw new Error('SQLite handle unavailable');
    const pageCount = Number(handle.pragma('page_count', { simple: true }) ?? 0);
    const pageSize = Number(handle.pragma('page_size', { simple: true }) ?? 0);
    return pageCount * pageSize;
  }

  async getTableSizeBytes(tableName: string): Promise<number> {
    const handle = this.deps.sqlite.getRawHandle();
    if (!handle) throw new Error('SQLite handle unavailable');
    try {
      const r = handle
        .prepare(`SELECT sum(pgsize) AS s FROM dbstat WHERE name = ?`)
        .get(tableName) as { s: number | null } | undefined;
      return Number(r?.s ?? 0);
    } catch {
      return 0; // dbstat not compiled in (rare)
    }
  }
}

export function registerDatabaseBrowserSqliteHandlers(deps: SqliteBrowserHandlerDeps): void {
  const { sqlite, sqliteFilePath } = deps;
  const backend = new DatabaseBrowserSqliteBackend(deps);

  safeHandle('database:getTables', async () => {
    try {
      return { success: true, tables: await backend.listTables() };
    } catch (error) {
      console.error('[DatabaseBrowserSqliteHandlers] getTables error:', error);
      return { success: false, error: String(error) };
    }
  });

  safeHandle('database:getTableSchema', async (_event, tableName: string) => {
    try {
      const safeName = sanitize(tableName);
      const handle = sqlite.getRawHandle();
      if (!handle) throw new Error('SQLite handle unavailable');
      const rows = handle.prepare(`PRAGMA table_info(${safeName})`).all() as {
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }[];
      return {
        success: true,
        columns: rows.map((r) => ({
          column_name: r.name,
          data_type: r.type,
          is_nullable: r.notnull ? 'NO' : 'YES',
          column_default: r.dflt_value,
        })),
      };
    } catch (error) {
      console.error('[DatabaseBrowserSqliteHandlers] getTableSchema error:', error);
      return { success: false, error: String(error) };
    }
  });

  safeHandle(
    'database:getTableData',
    async (
      _event,
      tableName: string,
      limit = 100,
      offset = 0,
      sortColumn?: string,
      sortDirection?: 'asc' | 'desc',
    ) => {
      try {
        const safeName = sanitize(tableName);
        // Count.
        const countRes = await sqlite.queryReadOnly<{ c: number }>(
          `SELECT COUNT(*) AS c FROM "${safeName}"`,
        );
        const totalCount = Number(countRes.rows[0]?.c ?? 0);

        let orderByClause = '';
        if (sortColumn) {
          const safeCol = sanitize(sortColumn);
          const direction = sortDirection === 'desc' ? 'DESC' : 'ASC';
          // SQLite: NULLS LAST requires CASE WHEN trick. For descending we
          // explicitly add `NULLS LAST` via expression.
          orderByClause = ` ORDER BY "${safeCol}" IS NULL, "${safeCol}" ${direction}`;
        }

        const dataRes = await sqlite.queryReadOnly(
          `SELECT * FROM "${safeName}"${orderByClause} LIMIT ? OFFSET ?`,
          [limit, offset],
        );
        return {
          success: true,
          rows: dataRes.rows,
          totalCount,
          limit,
          offset,
        };
      } catch (error) {
        console.error('[DatabaseBrowserSqliteHandlers] getTableData error:', error);
        return { success: false, error: String(error) };
      }
    },
  );

  safeHandle('database:executeQuery', async (_event, sql: string) => {
    try {
      const trimmed = sql.trim().toLowerCase();
      if (!trimmed.startsWith('select') && !trimmed.startsWith('with')) {
        return {
          success: false,
          error: 'Only SELECT (or WITH ... SELECT) queries are allowed.',
        };
      }
      const result = await sqlite.queryReadOnly(sql);
      return { success: true, rows: result.rows, rowCount: result.rows.length };
    } catch (error) {
      console.error('[DatabaseBrowserSqliteHandlers] executeQuery error:', error);
      return { success: false, error: String(error) };
    }
  });

  safeHandle('database:getStats', async () => {
    try {
      const stats = await sqlite.getStats();
      return { success: true, stats };
    } catch (error) {
      console.error('[DatabaseBrowserSqliteHandlers] getStats error:', error);
      return { success: false, error: String(error) };
    }
  });

  safeHandle('database:getDashboardStats', async () => {
    try {
      const handle = sqlite.getRawHandle();
      if (!handle) throw new Error('SQLite handle unavailable');

      const tablesRes = await sqlite.queryReadOnly<{ name: string }>(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_%'
         ORDER BY name`,
      );

      // dbstat is a virtual table that exposes per-page storage info; it's
      // compiled into the official SQLite build. If a future build drops it,
      // we degrade gracefully: zeroes everywhere with a one-line warning.
      let dbstatAvailable = true;
      try {
        handle.prepare(`SELECT sum(pgsize) FROM dbstat LIMIT 1`).get();
      } catch {
        dbstatAvailable = false;
      }

      const tableStats: Array<{
        name: string;
        rowCount: number;
        size: string;
        sizeBytes: number;
      }> = [];
      for (const t of tablesRes.rows) {
        const safeName = sanitize(t.name);
        let rowCount = 0;
        try {
          const c = await sqlite.queryReadOnly<{ c: number }>(
            `SELECT COUNT(*) AS c FROM "${safeName}"`,
          );
          rowCount = Number(c.rows[0]?.c ?? 0);
        } catch { /* table may be FTS5 hidden shadow; skip */ }

        let sizeBytes = 0;
        if (dbstatAvailable) {
          try {
            const r = handle
              .prepare(`SELECT sum(pgsize) AS s FROM dbstat WHERE name = ?`)
              .get(t.name) as { s: number | null } | undefined;
            sizeBytes = Number(r?.s ?? 0);
          } catch { /* ignore */ }
        }
        tableStats.push({
          name: t.name,
          rowCount,
          size: humanBytes(sizeBytes),
          sizeBytes,
        });
      }
      tableStats.sort((a, b) => b.sizeBytes - a.sizeBytes);

      const pageCount = Number(handle.pragma('page_count', { simple: true }) ?? 0);
      const pageSize = Number(handle.pragma('page_size', { simple: true }) ?? 0);
      const totalSizeBytes = pageCount * pageSize;

      // WAL: one file per database. Stat it directly.
      let walStats: {
        fileCount: number;
        totalBytes: number;
        totalSize: string;
      } | null = null;
      try {
        const walPath = `${sqliteFilePath}-wal`;
        if (fs.existsSync(walPath)) {
          const walSize = fs.statSync(walPath).size;
          walStats = {
            fileCount: 1,
            totalBytes: walSize,
            totalSize: humanBytes(walSize),
          };
        } else {
          walStats = { fileCount: 0, totalBytes: 0, totalSize: '0 bytes' };
        }
      } catch (walErr) {
        console.warn('[DatabaseBrowserSqliteHandlers] WAL stat failed:', walErr);
      }

      const basicStats = await sqlite.getStats();
      const backupStatus = deps.backupService ? deps.backupService.getBackupStatus() : null;

      return {
        success: true,
        tableStats,
        totalSize: humanBytes(totalSizeBytes),
        totalSizeBytes,
        basicStats,
        backupStatus,
        walStats,
      };
    } catch (error) {
      console.error('[DatabaseBrowserSqliteHandlers] getDashboardStats error:', error);
      return { success: false, error: String(error) };
    }
  });

  safeHandle('database:getPrimaryKeys', async (_event, tableName: string) => {
    try {
      const safeName = sanitize(tableName);
      const handle = sqlite.getRawHandle();
      if (!handle) throw new Error('SQLite handle unavailable');
      const rows = handle.prepare(`PRAGMA table_info(${safeName})`).all() as {
        name: string;
        pk: number;
      }[];
      // pk > 0 indicates a PK column; the value is the 1-based position.
      const pkRows = rows.filter((r) => r.pk > 0).sort((a, b) => a.pk - b.pk);
      return { success: true, primaryKeys: pkRows.map((r) => r.name) };
    } catch (error) {
      console.error('[DatabaseBrowserSqliteHandlers] getPrimaryKeys error:', error);
      return { success: false, error: String(error) };
    }
  });

  safeHandle(
    'database:updateCell',
    async (
      _event,
      tableName: string,
      primaryKeys: { column: string; value: unknown }[],
      columnName: string,
      newValue: unknown,
    ) => {
      try {
        if (!primaryKeys || primaryKeys.length === 0) {
          return { success: false, error: 'Cannot update: table has no primary key' };
        }
        const safeTable = sanitize(tableName);
        const safeColumn = sanitize(columnName);
        const whereParts: string[] = [];
        const params: unknown[] = [newValue];
        for (const pk of primaryKeys) {
          whereParts.push(`"${sanitize(pk.column)}" = ?`);
          params.push(pk.value);
        }
        const sql = `UPDATE "${safeTable}" SET "${safeColumn}" = ? WHERE ${whereParts.join(' AND ')}`;
        const result = await sqlite.query(sql, params);
        return {
          success: true,
          rowsAffected: (result as { rowsAffected?: number }).rowsAffected ?? 1,
        };
      } catch (error) {
        console.error('[DatabaseBrowserSqliteHandlers] updateCell error:', error);
        return { success: false, error: String(error) };
      }
    },
  );

  // ----- New: Performance tab -----

  safeHandle('database:getPerformance', async (_event, opts?: { slowLimit?: number }) => {
    try {
      const slowLimit = opts?.slowLimit ?? 50;
      const inst = sqlite.getInstrumentation();
      const snapshot = inst.getSnapshot();
      // The snapshot already carries the histogram, byTable counts, byShape
      // aggregations, and in-flight list. We still pull slow queries
      // separately because the renderer wants a tunable limit.
      return {
        success: true,
        snapshot,
        slowQueries: inst.getSlowQueries(slowLimit),
      };
    } catch (error) {
      console.error('[DatabaseBrowserSqliteHandlers] getPerformance error:', error);
      return { success: false, error: String(error) };
    }
  });
}

function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 bytes';
  if (n < 1024) return `${n} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  for (const u of units) {
    if (v < 1024) return `${v.toFixed(1)} ${u}`;
    v /= 1024;
  }
  return `${v.toFixed(1)} PB`;
}
