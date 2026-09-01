/**
 * Write a minimal Nimbalyst tracker database for the packed-tarball smoke test.
 *
 * Run from inside the scratch project that has `@nimbalyst/cli` installed, so
 * better-sqlite3 is required through the same node_modules the installed `nim`
 * will load it from:
 *
 *   node smoke-fixture.mjs <db-path>
 *
 * The point is not schema fidelity -- the unit tests cover that against the
 * real DDL. It is that `nim tracker list` and `nim tracker ready` have real
 * rows to convert, so the tracker record/readiness code that now lives in
 * `@nimbalyst/tracker-core` actually executes in the installed artifact. A
 * `--help` run does not reach it.
 */
import { createRequire } from 'node:module';
import * as path from 'node:path';

const require = createRequire(path.join(process.cwd(), 'noop.js'));
const Database = require('better-sqlite3');

const dbPath = process.argv[2];
if (!dbPath) {
  process.stderr.write('usage: smoke-fixture.mjs <db-path>\n');
  process.exit(2);
}

const db = new Database(dbPath);
db.exec(`
CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT);
CREATE TABLE tracker_items (
  id TEXT PRIMARY KEY,
  issue_number INTEGER,
  issue_key TEXT,
  local_key TEXT,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  workspace TEXT NOT NULL,
  document_path TEXT,
  line_number INTEGER,
  content TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  source TEXT DEFAULT 'inline',
  source_ref TEXT,
  type_tags TEXT NOT NULL DEFAULT '[]',
  sync_status TEXT DEFAULT 'local',
  sync_id INTEGER,
  body_version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  last_indexed TEXT NOT NULL DEFAULT '',
  title TEXT GENERATED ALWAYS AS (json_extract(data, '$.title')) STORED,
  status TEXT GENERATED ALWAYS AS (json_extract(data, '$.status')) STORED,
  kanban_sort_order TEXT GENERATED ALWAYS AS (json_extract(data, '$.kanbanSortOrder')) STORED
);
CREATE TABLE tracker_body_cache (
  item_id TEXT NOT NULL, body_version INTEGER NOT NULL, content TEXT NOT NULL,
  cached_at TEXT, PRIMARY KEY (item_id, body_version)
);
CREATE TABLE tracker_type_defs (
  id TEXT PRIMARY KEY, workspace TEXT NOT NULL, type TEXT NOT NULL,
  model TEXT NOT NULL, deleted_at TEXT, updated TEXT NOT NULL
);
`);

db.prepare(
  `INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)`,
  // Inside the CLI's supported range, so the smoke run is not muddied by the
  // "schema newer than this nim build knows" warning.
).run(12, 'smoke', '2026-01-01T00:00:00.000Z');

const now = '2026-01-01T00:00:00.000Z';
const workspace = '/tmp/nim-smoke-workspace';

// `tracker ready` refuses to guess: without a materialized type model it errors
// out before reaching tracker-core's readiness engine, which is half the point
// of running it here.
const defineType = db.prepare(
  `INSERT INTO tracker_type_defs (id, workspace, type, model, updated) VALUES (?, ?, ?, ?, ?)`,
);
for (const type of ['bug', 'task']) {
  defineType.run(
    `${workspace}::${type}`,
    workspace,
    type,
    JSON.stringify({
      type,
      roles: { title: 'title', workflowStatus: 'status' },
      fields: [
        {
          name: 'status',
          type: 'select',
          default: 'open',
          options: [
            { value: 'open', category: 'unstarted' },
            { value: 'in-progress', category: 'started' },
            { value: 'done', category: 'done' },
          ],
        },
        { name: 'dependsOn', type: 'relationship', relationshipTypeKey: 'depends-on' },
      ],
    }),
    now,
  );
}

const insert = db.prepare(
  `INSERT INTO tracker_items (id, issue_key, type, data, workspace, type_tags, created, updated)
   VALUES (@id, @issueKey, @type, @data, @workspace, @typeTags, @created, @updated)`,
);
insert.run({
  id: 'smoke-bug-1',
  issueKey: 'SMK-1',
  type: 'bug',
  data: JSON.stringify({ title: 'smoke bug', status: 'open', priority: 'high' }),
  workspace,
  typeTags: JSON.stringify(['bug']),
  created: now,
  updated: now,
});
insert.run({
  id: 'smoke-task-1',
  issueKey: 'SMK-2',
  type: 'task',
  data: JSON.stringify({ title: 'smoke task', status: 'done' }),
  workspace,
  typeTags: JSON.stringify(['task']),
  created: now,
  updated: now,
});
db.close();
process.stdout.write(`wrote ${dbPath}\n`);
