/**
 * Tracker lifecycle operations for the UI: promote a personal tracker to the
 * team, and archive/unarchive a team tracker.
 *
 * These transitions already existed as agent tools. This module is their
 * surface for a person, not a second implementation: both funnel through
 * `handleTrackerDefineType`, which owns the one-way promotion guard, the schema
 * write, the DB mirror, and the publish-existing-items sweep that mints keys.
 * Reimplementing any of that here would give the UI and the agent two different
 * answers to "what does promotion do".
 *
 * The one thing added on top is patch MERGING: the schema patch file is written
 * whole, so flipping one flag has to carry the tracker's existing overrides
 * with it or a click of "Archive" would quietly discard someone's custom
 * fields.
 */

import path from 'path';
import fsPromises from 'fs/promises';
import { safeHandle } from '../../utils/ipcRegistry';
import { handleTrackerDefineType } from '../../mcp/tools/trackerToolHandlers';
import { ensureWorkspaceTrackerSchemasLoaded } from '../TrackerSchemaService';
import {
  globalRegistry,
  parseTrackerSchemaPatchYAML,
  resolveTrackerPromotionEligibility,
  type TrackerSchemaPatch,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models';

export interface TrackerPromotionSummary {
  publishedCount: number;
  assignedKeyCount: number;
  pendingKeyCount: number;
}

/** Mirrors `TrackerSchemaService`'s deterministic patch file name. */
function patchFilePath(workspacePath: string, type: string): string {
  return path.join(workspacePath, '.nimbalyst', 'trackers', `${type}.patch.yaml`);
}

/**
 * The tracker's existing patch, so a one-flag change is a delta on top of it
 * rather than a replacement of it. No patch on disk yet is the normal case.
 */
async function readExistingPatch(workspacePath: string, type: string): Promise<TrackerSchemaPatch | null> {
  try {
    const content = await fsPromises.readFile(patchFilePath(workspacePath, type), 'utf-8');
    return parseTrackerSchemaPatchYAML(content);
  } catch {
    return null;
  }
}

interface DefineTypeStructuredResult {
  type: string;
  promotion?: TrackerPromotionSummary;
}

/**
 * Apply a lifecycle flag change through the agent-facing define-type path and
 * unwrap its MCP-shaped result.
 */
async function applyLifecycleChange(
  workspacePath: string,
  type: string,
  change: Pick<TrackerSchemaPatch, 'sharing' | 'archived'>,
  options?: { promoteExistingItems?: boolean },
): Promise<DefineTypeStructuredResult> {
  const existing = await readExistingPatch(workspacePath, type);
  const patch: TrackerSchemaPatch = { ...(existing ?? {}), type, ...change };

  const result = await handleTrackerDefineType(
    { patch, overwrite: true, promoteExistingItems: options?.promoteExistingItems === true },
    workspacePath,
  );
  const first = result.content?.[0];
  const text = first?.type === 'text' ? first.text ?? '' : '';
  if (result.isError) {
    throw new Error(text || `Could not update tracker '${type}'.`);
  }
  try {
    return JSON.parse(text).structured as DefineTypeStructuredResult;
  } catch {
    // The write succeeded; only the envelope was unreadable.
    return { type };
  }
}

/**
 * Promote a personal tracker to the team. One-way by design: every existing
 * item is published now and receives its server-issued key at that moment.
 */
export async function promoteTrackerToTeam(
  workspacePath: string,
  type: string,
): Promise<TrackerPromotionSummary> {
  ensureWorkspaceTrackerSchemasLoaded(workspacePath);
  const model = globalRegistry.get(type);
  if (!model) throw new Error(`Unknown tracker type '${type}'`);
  const eligibility = resolveTrackerPromotionEligibility(model);
  if (!eligibility.canPromote) {
    throw new Error(eligibility.message ?? `Tracker '${type}' cannot be shared with the team.`);
  }

  const structured = await applyLifecycleChange(
    workspacePath,
    type,
    { sharing: 'team' },
    { promoteExistingItems: true },
  );
  return structured.promotion ?? { publishedCount: 0, assignedKeyCount: 0, pendingKeyCount: 0 };
}

/**
 * Archive or unarchive a tracker. Items are untouched: they stay in place,
 * stay searchable, and keep their keys. Only writes are refused afterwards.
 */
export async function setTrackerArchived(
  workspacePath: string,
  type: string,
  archived: boolean,
): Promise<void> {
  ensureWorkspaceTrackerSchemasLoaded(workspacePath);
  if (!globalRegistry.get(type)) throw new Error(`Unknown tracker type '${type}'`);
  await applyLifecycleChange(workspacePath, type, { archived });
}

export function registerTrackerLifecycleIpc(): void {
  safeHandle('tracker-lifecycle:promote', async (_event, payload: { workspacePath: string; type: string }) => {
    if (!payload?.workspacePath) throw new Error('workspacePath is required');
    if (!payload?.type) throw new Error('type is required');
    try {
      const promotion = await promoteTrackerToTeam(payload.workspacePath, payload.type);
      return { success: true, promotion };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  safeHandle('tracker-lifecycle:set-archived', async (
    _event,
    payload: { workspacePath: string; type: string; archived: boolean },
  ) => {
    if (!payload?.workspacePath) throw new Error('workspacePath is required');
    if (!payload?.type) throw new Error('type is required');
    try {
      await setTrackerArchived(payload.workspacePath, payload.type, payload.archived === true);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
