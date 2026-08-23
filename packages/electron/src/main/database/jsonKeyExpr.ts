import type { DatabaseEngine } from './PGLiteDatabaseWorker';

/**
 * SQL expression for reading a top-level JSON key out of a JSON column, in the
 * form the active backend's expression indexes are declared with.
 *
 * Why this exists: SQLite treats `col->>'key'` and `json_extract(col,'$.key')`
 * as the same *value* but not the same *expression*. An index declared over
 * `json_extract(...)` is never matched by a `->>` predicate, so the query
 * silently degrades to a full scan — correct rows, wrong plan, nothing in
 * review or CI catches it. PostgreSQL has no `json_extract` at all (and no
 * `(jsonb, unknown)` overload), so PGLite has to keep the `->>` form.
 *
 * Use this for every `WHERE` predicate over a JSON key on a table that carries
 * an expression index. Projections (`SELECT metadata->>'x' AS x`) don't affect
 * planning and don't need it.
 *
 * `scripts/check-json-accessor-indexes.mjs` enforces this at push time.
 */
export function jsonKeyExpr(engine: DatabaseEngine, column: string, key: string): string {
  return engine === 'sqlite'
    ? `json_extract(${column}, '$.${key}')`
    : `${column}->>'${key}'`;
}

/**
 * Bind {@link jsonKeyExpr} to one engine + column so query builders read as
 * `${md('status')} = 'pending-review'`.
 */
export function jsonKeyAccessor(
  engine: DatabaseEngine,
  column: string,
): (key: string) => string {
  return (key: string) => jsonKeyExpr(engine, column, key);
}
