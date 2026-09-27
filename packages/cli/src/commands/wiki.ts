/**
 * `nim wiki ...`: the hosted wiki's MCP tools and changeset API from a shell.
 *
 * Each subcommand mirrors one `wiki_*` tool or one changeset endpoint (contract
 * rev 10). Target resolution and the project commands live in wikiProject.ts;
 * the GitHub-native commands, off unless `NIM_GITHUB_NATIVE=on`, in
 * wikiGithub.ts. The desktop-loopback `nim tracker` commands are a different
 * path and share no code with this one.
 */
import type { ParsedArgs } from '../cli/parse.js';
import { flagBool, flagInt, flagList, flagStr } from '../cli/parse.js';
import { ExitCode, usageError } from '../cli/exitCodes.js';
import { safeText } from '../cli/output.js';
import { outputOptions, parseFields, readBody } from './common.js';
import { loadTypeSchema } from './typeSchema.js';
import * as fs from 'node:fs';
import yaml from 'js-yaml';
import { githubNativeEnabled, resolveServer } from '../cloud/config.js';
import { field, renderObject, renderRows, type Column } from '../cloud/wikiOutput.js';
import { wikiApi } from '../cloud/wikiClient.js';
import { operand, print, tool, type WikiCtx } from './wikiCtx.js';
import { runBind, runCreateProject, runPin, runTeamsStatus, teamsCtx } from './wikiProject.js';
import { GITHUB_NATIVE_VERBS, githubCtx, runGithubVerb } from './wikiGithub.js';

type Ctx = WikiCtx;

const ITEM_COLUMNS: Column[] = [
  { header: 'id', get: (r) => field(r, 'issueKey') ?? r.id },
  { header: 'type', get: (r) => field(r, 'type') ?? r.primaryType },
  { header: 'status', get: (r) => field(r, 'status') },
  { header: 'title', get: (r) => field(r, 'title') },
  { header: 'url', get: (r) => r.url },
];

const CHANGESET_COLUMNS: Column[] = [
  { header: 'id', get: (r) => r.id },
  { header: 'source', get: (r) => r.source },
  { header: 'by', get: (r) => r.principal?.email ?? r.principal?.login ?? r.principal?.id },
  { header: 'created', get: (r) => r.createdAt },
  { header: 'changes', get: (r) => countsText(r.counts) },
  { header: 'title', get: (r) => r.title },
];

const ENTRY_COLUMNS: Column[] = [
  { header: 'op', get: (r) => r.op },
  { header: 'type', get: (r) => r.itemType },
  { header: 'item', get: (r) => r.itemId },
  { header: 'title', get: (r) => r.title },
];

function countsText(counts: unknown): string {
  if (!counts || typeof counts !== 'object') return '';
  return Object.entries(counts as Record<string, unknown>)
    .filter(([, n]) => typeof n === 'number' && n > 0)
    .map(([k, n]) => `${n} ${k}`)
    .join(', ');
}

function itemsOf(result: any): any[] {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

function bodyOf(res: any): { status: string; code?: string; message?: string } | undefined {
  const body = res?.body && typeof res.body === 'object' ? res.body : res?.item?.body;
  return body && typeof body.status === 'string' ? body : undefined;
}

/**
 * What happened to the page text on a write that carried a description
 * (contract rev 9.2). `refused`/`body_edited` means a person edited the page
 * since the server last wrote it; the fields were still written.
 */
function bodyOutcome(res: any): string | undefined {
  const body = bodyOf(res);
  if (!body) return undefined;
  return `${body.status}${body.code ? ` (${body.code})` : ''}${body.message ? `: ${body.message}` : ''}`;
}

/**
 * Prints an item write, then makes a page-text problem impossible to miss in
 * every output mode: a refused or failed outcome always goes to stderr with the
 * item id. `failed` exits PARTIAL_WRITE: the fields were written and the text
 * was not, so retrying the same call would only repeat that.
 */
function printItemWrite(ctx: Ctx, res: any, id: unknown): number {
  const opts = outputOptions(ctx.args);
  const item = res?.item ?? res;
  const itemId = item?.id ?? id;
  print(ctx, res, () => renderObject({ id: itemId, url: item?.url, body: bodyOutcome(res) }, opts));
  const body = bodyOf(res);
  if (body?.status === 'refused' || body?.status === 'failed') {
    const note = body.status === 'failed' ? ' The item was written; its page text was not. Do not retry the same call.' : '';
    process.stderr.write(`nim: page text of ${safeText(String(itemId ?? ''))} ${safeText(bodyOutcome(res) ?? '')}.${note}\n`);
  }
  return body?.status === 'failed' ? ExitCode.PARTIAL_WRITE : ExitCode.OK;
}

function itemArgs(ctx: Ctx): Record<string, unknown> {
  const fields = parseFields(flagList(ctx.args, 'field'));
  const tags = flagList(ctx.args, 'tag');
  const labels = flagList(ctx.args, 'label');
  return {
    status: flagStr(ctx.args, 'status'),
    priority: flagStr(ctx.args, 'priority'),
    owner: flagStr(ctx.args, 'owner'),
    description: readBody(ctx.args),
    tags: tags.length ? tags : undefined,
    labels: labels.length ? labels : undefined,
    fields: Object.keys(fields).length ? fields : undefined,
    changesetId: flagStr(ctx.args, 'changeset'),
  };
}

/** A predicate registry file: a YAML/JSON array, or an object with `predicates`. */
function loadPredicates(file: string): unknown[] {
  let parsed: any;
  try {
    parsed = yaml.load(fs.readFileSync(file, 'utf8'));
  } catch (err: any) {
    throw usageError(`Could not read predicates file "${file}": ${err?.message ?? err}`);
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.predicates;
  if (!Array.isArray(list)) throw usageError(`"${file}" must be a list of predicates or have a top-level "predicates" list.`);
  return list;
}

async function runChanges(ctx: Ctx): Promise<number> {
  const sub = ctx.args.positionals[0];
  const opts = outputOptions(ctx.args);

  // Changeset lifecycle goes through the MCP tools, like every other write.
  if (sub === 'begin') {
    const title = flagStr(ctx.args, 'title');
    if (!title) throw usageError(`'nim wiki changes begin' requires --title.`);
    const res = await tool(ctx, 'wiki_begin_changeset', {
      title,
      source: flagStr(ctx.args, 'source') ?? 'cli',
      sessionRef: flagStr(ctx.args, 'session-ref'),
    });
    return print(ctx, res, () => renderObject({ changesetId: res?.changesetId, url: res?.url }, opts, 'changesetId'));
  }
  if (sub === 'finish') {
    const changesetId = operand(ctx, 1, 'a changeset id');
    const res = await tool(ctx, 'wiki_finish_changeset', { changesetId, summary: flagStr(ctx.args, 'summary') });
    return print(ctx, res, () => {
      if (opts.quiet) return safeText(String(res?.url ?? changesetId));
      if (typeof res === 'string') return safeText(res);
      const digest = typeof res?.digest === 'string' ? res.digest : typeof res?.text === 'string' ? res.text : undefined;
      return digest ? [safeText(digest), res?.url ? safeText(String(res.url)) : ''].filter(Boolean).join('\n') : renderObject(res ?? {}, opts);
    });
  }

  const base = await ctx.changesetsPath();

  if (!sub || sub === 'list') {
    const q = new URLSearchParams();
    const limit = flagInt(ctx.args, 'limit');
    if (limit !== undefined) q.set('limit', String(limit));
    const before = flagStr(ctx.args, 'before');
    if (before) q.set('before', before);
    const res = await wikiApi(ctx.server, `${base}${q.size ? `?${q}` : ''}`);
    return print(ctx, res, () => renderRows(res?.changesets ?? [], CHANGESET_COLUMNS, opts, (r) => r.id));
  }

  const changesetId = operand(ctx, 1, 'a changeset id');
  const path = `${base}/${encodeURIComponent(changesetId)}`;
  if (sub === 'show') {
    const res = await wikiApi(ctx.server, path);
    return print(ctx, res, () => {
      const table = renderRows(res?.entries ?? [], ENTRY_COLUMNS, opts, (r) => r.itemId);
      if (opts.quiet || opts.csv) return table;
      const cs = res?.changeset ?? {};
      const head = `${safeText(String(cs.title ?? changesetId))}  (${safeText(String(cs.source ?? ''))})`;
      const page = typeof cs.url === 'string' ? cs.url : ctx.changesetPage?.(changesetId);
      return [head, ...(page ? [safeText(page)] : []), '', table].join('\n');
    });
  }
  throw usageError(`Unknown 'nim wiki changes' subcommand '${sub}'. Use list, show, begin, or finish.`);
}

export async function runWiki(args: ParsedArgs): Promise<number> {
  const startDir = flagStr(args, 'workspace') ?? process.cwd();
  const server = resolveServer();
  const githubNative = githubNativeEnabled();
  if (!githubNative && GITHUB_NATIVE_VERBS.has(args.verb ?? '')) {
    throw usageError(
      `'nim wiki ${args.verb}' is not available: membership is managed in Nimbalyst Teams. Use 'nim wiki status' to see how this repo connects.`,
    );
  }
  const ctx: Ctx = githubNative ? githubCtx(args, server, startDir) : teamsCtx(args, server, startDir);
  const opts = outputOptions(args);

  if (githubNative) {
    const handled = await runGithubVerb(ctx);
    if (handled !== undefined) return handled;
  }

  switch (args.verb) {
    case 'status':
      return runTeamsStatus(ctx);
    case 'pin':
      return runPin(ctx);
    case 'bind':
      return runBind(ctx);
    case 'create-project':
      return runCreateProject(ctx);
    case 'types': {
      const res = await tool(ctx, 'wiki_list_types');
      const types: any[] = Array.isArray(res?.types) ? res.types : itemsOf(res);
      return print(ctx, res, () =>
        renderRows(
          types,
          [
            { header: 'type', get: (t) => t.type },
            { header: 'name', get: (t) => t.displayName },
            { header: 'count', get: (t) => t.count },
          ],
          opts,
          (t) => t.type,
        ),
      );
    }
    case 'define-type': {
      const file = flagStr(args, 'file');
      const predicatesFile = flagStr(args, 'predicates-file');
      if (!file && !predicatesFile) {
        throw usageError(`'nim wiki define-type' requires -f <schema.yaml|.json> and/or --predicates-file <file>.`);
      }
      const res = await tool(ctx, 'wiki_define_type', {
        schema: file ? loadTypeSchema(file).schema : undefined,
        overwrite: flagBool(args, 'overwrite') || undefined,
        predicates: predicatesFile ? loadPredicates(predicatesFile) : undefined,
        changesetId: flagStr(args, 'changeset'),
      });
      return print(ctx, res, () => (typeof res === 'string' ? safeText(res) : renderObject(res ?? {}, opts, 'type')));
    }
    case 'list': {
      const res = await tool(ctx, 'wiki_list', {
        type: flagStr(args, 'type'),
        status: flagStr(args, 'status'),
        search: flagStr(args, 'search'),
        limit: flagInt(args, 'limit'),
      });
      return print(ctx, res, () => renderRows(itemsOf(res), ITEM_COLUMNS, opts, (r) => r.id));
    }
    case 'get': {
      const res = await tool(ctx, 'wiki_get', { id: operand(ctx, 0, 'an item id') });
      const item = res?.item ?? res;
      return print(ctx, res, () => renderObject(item ?? {}, opts));
    }
    case 'create-item': {
      const type = operand(ctx, 0, 'a type');
      const title = operand(ctx, 1, 'a title');
      const res = await tool(ctx, 'wiki_create_item', { type, title, ...itemArgs(ctx) });
      return printItemWrite(ctx, res, undefined);
    }
    case 'update-item': {
      const id = operand(ctx, 0, 'an item id');
      const unset = flagList(args, 'unset');
      const update: Record<string, unknown> = {
        title: flagStr(args, 'title'),
        ...itemArgs(ctx),
        unsetFields: unset.length ? unset : undefined,
      };
      if (Object.entries(update).every(([k, v]) => k === 'changesetId' || v === undefined)) {
        throw usageError('Nothing to update. Pass at least one of --title, --status, --field, --unset, etc.');
      }
      const res = await tool(ctx, 'wiki_update_item', { id, ...update });
      return printItemWrite(ctx, res, id);
    }
    case 'changes':
      return runChanges(ctx);
    default:
      throw usageError(
        `Unknown 'nim wiki' subcommand '${args.verb ?? ''}'. Run 'nim --help' for the list.`,
      );
  }
}
