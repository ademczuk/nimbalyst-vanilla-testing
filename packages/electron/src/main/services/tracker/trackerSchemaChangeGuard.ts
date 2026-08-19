/**
 * The guard rail on destructive tracker schema changes (PRD principle 6, D3).
 *
 * Adding is free: a new field, status or select option applies instantly, with no
 * role check and no confirmation, because the data layer is schema-tolerant and
 * an older client provably cannot lose data to it. Removing is not: a removal,
 * rename, type change or narrowed constraint has to state its blast radius —
 * counted against THIS workspace's item table — and be approved, and on a team
 * tracker it has to be approved by an admin.
 *
 * The verdict itself lives in the classifier (`resolveTrackerSchemaChangeGate`),
 * which is pure. This module is the seam that gives it the two things it cannot
 * compute: how many items are affected, and what role the caller holds.
 *
 * THIS IS NOT THE ENFORCEMENT POINT. Everything here runs inside the client, so
 * a modified client skips it entirely by sending `trackerSchemaMutation` itself.
 * What it buys is the things a server cannot do: a blast radius counted against
 * the local item table, a confirmation dialog, and a refusal that lands before
 * the write reaches disk. The authority for D3 on a team tracker is the
 * TrackerRoom, which re-derives destructiveness from the previous schema it
 * holds and resolves the actor's role through the org's TeamRoom. Keep the two
 * in agreement, but never treat a change here as a security control.
 */
import {
  calculateTrackerSchemaBlastRadius,
  classifyTrackerSchemaChanges,
  describeTrackerSchemaBlastRadius,
  describeTrackerSchemaDestructiveChange,
  resolveTrackerSchemaChangeGate,
  type DestructiveTrackerSchemaChange,
  type TrackerSchemaActorRole,
  type TrackerSchemaBlastRadiusEntry,
  type TrackerSchemaChangeClassification,
  type TrackerSchemaChangeGateVerdict,
  type TrackerSchemaDestructiveConfirmCopy,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models/trackerSchemaChangeClassifier';
import type {
  TrackerDataModel,
  TrackerSharing,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { getDatabase } from '../../database/initialize';
import { logger } from '../../utils/logger';
import { findTeamForWorkspace } from '../TeamService';

/** Minimal DB surface, injectable so the counting rules test against real rows. */
export interface TrackerItemCountDb {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
  getEngine?: () => string;
}

/** One item's stored `data` blob, already parsed. */
export type TrackerItemDataRow = Record<string, unknown>;

/**
 * Flatten an item's field bag the way the read path does: a nested
 * `data.customFields` entry wins over a same-named top-level one (NIM-863).
 * Counting against only one of the two shapes under-reports the blast radius for
 * exactly the synced/CLI-written items a team change is most likely to hit.
 */
function itemFieldValue(row: TrackerItemDataRow, fieldName: string): unknown {
  const nested = row.customFields;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const value = (nested as Record<string, unknown>)[fieldName];
    if (value !== undefined) return value;
  }
  return row[fieldName];
}

/** Present means "this item would notice the field going away". */
function hasFieldValue(row: TrackerItemDataRow, fieldName: string): boolean {
  const value = itemFieldValue(row, fieldName);
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function usesOptionValue(row: TrackerItemDataRow, fieldName: string, optionValue: string): boolean {
  const value = itemFieldValue(row, fieldName);
  if (Array.isArray(value)) return value.includes(optionValue);
  return value === optionValue;
}

/**
 * How many of `rows` a single destructive change reaches. Pure over already-read
 * rows so the whole blast radius costs ONE query rather than one per change.
 */
export function countItemsAffectedBySchemaChange(
  rows: readonly TrackerItemDataRow[],
  change: DestructiveTrackerSchemaChange,
): number {
  switch (change.kind) {
    case 'field-removed':
    case 'field-type-changed':
    case 'constraint-narrowed':
    case 'field-definition-changed':
      return rows.filter((row) => hasFieldValue(row, change.fieldName)).length;
    case 'status-removed':
    case 'select-option-removed':
      return rows.filter((row) => usesOptionValue(row, change.fieldName, change.option.value)).length;
    case 'workflow-status-field-changed':
      if (!change.previousFieldName) return 0;
      return rows.filter((row) => hasFieldValue(row, change.previousFieldName!)).length;
  }
}

/**
 * Read every live item of `type` once. `type_tags` membership is expressed
 * differently per backend — a JSON column on SQLite, TEXT[] on PGLite — and
 * skipping the tag branch would silently under-count items that carry the type
 * as a tag rather than as their primary type.
 */
export async function loadTrackerItemDataRows(
  workspacePath: string,
  type: string,
  dbOverride?: TrackerItemCountDb,
): Promise<TrackerItemDataRow[]> {
  const db = dbOverride ?? (getDatabase() as unknown as TrackerItemCountDb | null);
  if (!db) return [];
  // No dialect that satisfies both backends exists for the tag test, and the
  // wrong one is a thrown query rather than a wrong number. An unknown engine
  // therefore drops the tag clause: a slightly low count is recoverable, a
  // blast radius that failed to compute leaves the change ungated.
  const engine = typeof db.getEngine === 'function' ? db.getEngine() : null;
  const tagMembership =
    engine === 'sqlite'
      ? ` OR EXISTS (SELECT 1 FROM json_each(type_tags) WHERE value = $2)`
      : engine === null
        ? ''
        : ` OR $2 = ANY(type_tags)`;
  const result = (await db.query(
    `SELECT data FROM tracker_items
      WHERE workspace = $1 AND (type = $2${tagMembership}) AND deleted_at IS NULL`,
    [workspacePath, type],
  )) as { rows?: Array<{ data: unknown }> } | undefined;

  const rows: TrackerItemDataRow[] = [];
  for (const row of result?.rows ?? []) {
    // JSONB comes back parsed on PGLite and as TEXT on SQLite (DATABASE.md).
    const parsed = typeof row.data === 'string' ? safeParse(row.data) : row.data;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      rows.push(parsed as TrackerItemDataRow);
    }
  }
  return rows;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * The caller's role in the team that owns this workspace. No team means no team
 * tracker, so there is nobody to be an admin over — treat the user as the owner
 * of their own machine rather than locking them out of their personal trackers.
 *
 * Failing closed on a lookup error would do the same damage in reverse: it would
 * block a solo user's own edit whenever the team lookup is merely offline. The
 * role only matters when the tracker is team-owned, and a team-owned tracker
 * implies a team the lookup found.
 */
export async function resolveTrackerSchemaActorRole(
  workspacePath: string,
): Promise<TrackerSchemaActorRole> {
  try {
    const team = await findTeamForWorkspace(workspacePath);
    if (!team) return 'admin';
    return team.role === 'admin' || team.role === 'owner' ? 'admin' : 'member';
  } catch (err) {
    logger.main.warn('[trackerSchemaChangeGuard] role lookup failed for', workspacePath, err);
    return 'member';
  }
}

export interface TrackerSchemaChangeDecision {
  classification: TrackerSchemaChangeClassification;
  verdict: TrackerSchemaChangeGateVerdict;
  blastRadius: TrackerSchemaBlastRadiusEntry[];
  blastRadiusText: string;
  actorRole: TrackerSchemaActorRole;
  sharing: TrackerSharing | undefined;
  /** Only built for a destructive change; the additive path never pays for it. */
  copy?: TrackerSchemaDestructiveConfirmCopy;
}

export interface EvaluateTrackerSchemaChangeInput {
  workspacePath: string;
  /** The schema in force right now; `undefined` for a brand-new type. */
  previous: TrackerDataModel | undefined;
  next: TrackerDataModel;
  /** The caller showed the blast radius and the user approved it. */
  confirmed?: boolean;
  actorRole?: TrackerSchemaActorRole;
  teamName?: string | null;
  dbOverride?: TrackerItemCountDb;
}

/**
 * Classify a proposed schema write, price it against the local item table, and
 * apply the gate. A brand-new type has nothing to be destructive to, so it short
 * circuits as additive rather than being diffed against a synthetic empty model.
 */
export async function evaluateTrackerSchemaChange(
  input: EvaluateTrackerSchemaChangeInput,
): Promise<TrackerSchemaChangeDecision> {
  const { workspacePath, previous, next, confirmed = false, dbOverride } = input;
  // A tracker's sharing is decided by what it IS now and what it is becoming;
  // take the stricter of the two so a personal->team save is judged as a team
  // change rather than sneaking a removal in on the way up.
  const sharing: TrackerSharing | undefined =
    previous?.sharing === 'team' || next.sharing === 'team' ? 'team' : next.sharing ?? previous?.sharing;

  const classification: TrackerSchemaChangeClassification = previous
    ? classifyTrackerSchemaChanges(previous, next)
    : { classification: 'additive', changes: [], renameCandidates: [] };

  const actorRole =
    input.actorRole ??
    (classification.classification === 'destructive' && sharing === 'team'
      ? await resolveTrackerSchemaActorRole(workspacePath)
      : 'admin');

  const verdict = resolveTrackerSchemaChangeGate({
    classification,
    sharing,
    actorRole,
    confirmed,
  });

  if (classification.classification !== 'destructive') {
    return {
      classification,
      verdict,
      blastRadius: [],
      blastRadiusText: describeTrackerSchemaBlastRadius([]),
      actorRole,
      sharing,
    };
  }

  const rows = await loadTrackerItemDataRows(workspacePath, next.type, dbOverride);
  const blastRadius = await calculateTrackerSchemaBlastRadius(classification, (change) =>
    countItemsAffectedBySchemaChange(rows, change),
  );

  return {
    classification,
    verdict,
    blastRadius,
    blastRadiusText: describeTrackerSchemaBlastRadius(blastRadius),
    actorRole,
    sharing,
    copy: describeTrackerSchemaDestructiveChange({
      displayNamePlural: next.displayNamePlural || next.type,
      sharing,
      teamName: input.teamName,
      blastRadius,
      renameCandidates: classification.renameCandidates,
    }),
  };
}

/**
 * Thrown by every schema write path the gate refuses. `.code` lets the MCP tools
 * and IPC map it without string-matching, and the message is written for the
 * agent that will read it: it names the blast radius and the one thing to do next.
 */
export class TrackerSchemaChangeBlockedError extends Error {
  readonly code = 'TRACKER_SCHEMA_CHANGE_BLOCKED';

  constructor(
    readonly type: string,
    readonly decision: TrackerSchemaChangeDecision,
  ) {
    super(buildBlockedMessage(type, decision));
    this.name = 'TrackerSchemaChangeBlockedError';
  }

  get reason(): 'needs-confirmation' | 'requires-admin' {
    return this.decision.verdict.allowed
      ? 'needs-confirmation'
      : this.decision.verdict.reason;
  }
}

function buildBlockedMessage(type: string, decision: TrackerSchemaChangeDecision): string {
  const radius = decision.blastRadiusText;
  const options = decision.copy?.options.map((option) => option.label).join(' | ') ?? '';
  if (!decision.verdict.allowed && decision.verdict.reason === 'requires-admin') {
    return (
      `This change to '${type}' removes or narrows part of a tracker your team shares, ` +
      `and only a team admin can do that. ${radius} ` +
      `Adding fields, statuses and options is unrestricted — apply the additive part now ` +
      `and ask an admin for the removal.`
    );
  }
  return (
    `This change to '${type}' is destructive and needs explicit confirmation. ${radius} ` +
    `Nothing is deleted: retiring a field keeps its values in your items. ` +
    (options ? `Options: ${options}. ` : '') +
    `Show this to the user, then retry with confirmDestructive: true.`
  );
}
