#!/usr/bin/env node
/**
 * Guards SQLite expression indexes against the `->>` accessor that silently
 * skips them.
 *
 * SQLite treats `metadata->>'status'` and `json_extract(metadata,'$.status')`
 * as the same value but not the same expression. An index declared over
 * `json_extract(...)` is never matched by a `->>` predicate, so the query
 * returns the right rows off a full table scan. Nothing fails, nothing logs,
 * and review sees a normal-looking WHERE clause.
 *
 * That cost 31% of the SQLite worker's time: all four partial indexes on
 * `document_history` were declared with `json_extract`, every predicate in
 * `HistoryManager` used `->>`, and the hot pending-review lookup scanned 46,110
 * rows at ~76ms a call for as long as the indexes had existed.
 *
 * The fix is always `jsonKeyExpr(engine, column, key)` from
 * `packages/electron/src/main/database/jsonKeyExpr.ts`, which emits
 * `json_extract` on SQLite and `->>` on PGLite. Hardcoding either form is wrong
 * while both backends are live.
 *
 * Scope: a `->>` in a WHERE predicate, inside a SQL literal that also names the
 * indexed table. A projection (`SELECT metadata->>'x' AS x`) does not affect
 * planning and is not reported.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const SCHEMA_DIR = path.join(repoRoot, 'packages/electron/src/main/database/sqlite/schemas');
const SOURCE_ROOTS = [
  path.join(repoRoot, 'packages/electron/src/main'),
  path.join(repoRoot, 'packages/runtime/src'),
];

const JSON_EXTRACT_RE = /json_extract\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*'\$\.([A-Za-z0-9_]+)'\s*\)/gi;
const ARROW_ACCESSOR_RE = /([A-Za-z_][A-Za-z0-9_]*)\s*->>\s*'([^']+)'/g;
const TABLE_REFERENCE_RE = /\b(?:from|join|update|into)\s+([a-z_][a-z0-9_]*)/gi;

function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, '');
}

/**
 * Every JSON key that a SQLite expression index depends on, keyed by table.
 * Both the indexed columns and the partial-index WHERE clause count: a query
 * only reaches a partial index if its own predicate matches that clause too.
 *
 * Returns Map<table, Map<`${column}.${key}`, indexName[]>>.
 */
export function collectIndexedJsonKeys(schemaDir = SCHEMA_DIR) {
  const byTable = new Map();
  const files = readdirSync(schemaDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = stripSqlComments(readFileSync(path.join(schemaDir, file), 'utf8'));
    const createIndex = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)\s+ON\s+([A-Za-z0-9_]+)\s*\(/gi;
    let match;
    while ((match = createIndex.exec(sql)) !== null) {
      const [, indexName, table] = match;
      // Balanced scan over the column list; json_extract(...) nests parens.
      let depth = 1;
      let i = createIndex.lastIndex;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '(') depth += 1;
        else if (sql[i] === ')') depth -= 1;
        i += 1;
      }
      const terminator = sql.indexOf(';', i);
      const body = sql.slice(match.index, terminator === -1 ? sql.length : terminator);

      JSON_EXTRACT_RE.lastIndex = 0;
      let keyMatch;
      while ((keyMatch = JSON_EXTRACT_RE.exec(body)) !== null) {
        const [, column, key] = keyMatch;
        const table_ = table.toLowerCase();
        if (!byTable.has(table_)) byTable.set(table_, new Map());
        const keys = byTable.get(table_);
        const id = `${column.toLowerCase()}.${key}`;
        if (!keys.has(id)) keys.set(id, []);
        if (!keys.get(id).includes(indexName)) keys.get(id).push(indexName);
      }
      createIndex.lastIndex = i;
    }
  }
  return byTable;
}

function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === 'out') continue;
      out.push(...listSourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Raw text of every string/template literal in the file, with its start offset. */
function collectSqlLiterals(sourceFile) {
  const literals = [];
  const visit = (node) => {
    if (
      ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateExpression(node)
      || ts.isStringLiteral(node)
    ) {
      literals.push({ text: node.getText(sourceFile), start: node.getStart(sourceFile) });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return literals;
}

export function findArrowAccessorsSkippingIndexes(
  files = SOURCE_ROOTS.flatMap((root) => listSourceFiles(root)),
  indexed = collectIndexedJsonKeys(),
) {
  const violations = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('->>')) continue;
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

    for (const literal of collectSqlLiterals(sourceFile)) {
      const sql = literal.text;
      if (!sql.includes('->>')) continue;

      TABLE_REFERENCE_RE.lastIndex = 0;
      const tables = new Set();
      let tableMatch;
      while ((tableMatch = TABLE_REFERENCE_RE.exec(sql)) !== null) {
        tables.add(tableMatch[1].toLowerCase());
      }
      if (tables.size === 0) continue;

      const whereAt = sql.search(/\bWHERE\b/i);
      if (whereAt === -1) continue;

      ARROW_ACCESSOR_RE.lastIndex = 0;
      let accessor;
      while ((accessor = ARROW_ACCESSOR_RE.exec(sql)) !== null) {
        if (accessor.index < whereAt) continue;
        const [, column, key] = accessor;
        const id = `${column.toLowerCase()}.${key}`;
        for (const table of tables) {
          const indexes = indexed.get(table)?.get(id);
          if (!indexes) continue;
          const { line } = sourceFile.getLineAndCharacterOfPosition(literal.start + accessor.index);
          violations.push({
            file: path.relative(repoRoot, file),
            line: line + 1,
            table,
            expression: `${column}->>'${key}'`,
            indexes,
          });
        }
      }
    }
  }
  return violations;
}

export function checkJsonAccessorIndexes() {
  const violations = findArrowAccessorsSkippingIndexes();
  if (violations.length > 0) {
    throw new Error(
      'SQLite expression indexes are skipped by these `->>` predicates:\n'
      + violations
        .map((v) => `  + ${v.file}:${v.line} ${v.expression} on ${v.table} skips ${v.indexes.join(', ')}`)
        .join('\n')
      + '\nUse jsonKeyExpr(engine, column, key) from'
      + ' packages/electron/src/main/database/jsonKeyExpr.ts.\n'
      + 'SQLite will not match a `->>` predicate against a json_extract index, so the\n'
      + 'query silently falls back to a full table scan.',
    );
  }
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    checkJsonAccessorIndexes();
    console.log('[json-accessor-indexes] no `->>` predicate skips a json_extract index.');
  } catch (error) {
    console.error(`[json-accessor-indexes] ${error.message}`);
    process.exit(1);
  }
}
