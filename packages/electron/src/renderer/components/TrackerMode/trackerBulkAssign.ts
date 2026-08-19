/**
 * Placing cards in a milestone without dragging them there.
 *
 * Fifty plans exist and none of them belongs to a milestone; dragging is one card
 * at a time. This module resolves the field writes for a whole selection, and it
 * deliberately does NOT contain a relationship writer of its own -- it builds the
 * same board column a drop would land in and calls `resolveBoardColumnWrite`, so
 * the three ways to place a card cannot drift apart. Both non-drag paths -- the
 * bulk bar over a selection and the card chip over one card -- come through here,
 * so both have drag's semantics: they REASSIGN the milestone axis and preserve
 * off-axis memberships (`collection` also holds releases).
 *
 * Two items are dropped from the batch rather than written:
 *
 *  - an item whose type declares no collection field (nothing to write), and
 *  - an item already in exactly the target milestone, because re-stamping a row
 *    that is already correct is a write the user paid for and cannot see.
 *
 * Pure and React-free; the batched IPC lives in `trackerFieldSave`.
 */

import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import {
  resolveGroupingRelationshipValues,
  type TrackerRelationshipValue,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { resolveBoardColumnWrite, type TrackerBoardColumn } from './trackerBoardColumns';

/** The milestone a bulk action places cards in; `itemId: null` clears the axis. */
export interface MilestoneAssignTarget {
  itemId: string | null;
  title?: string;
  issueKey?: string;
}

export interface TrackerFieldWrite {
  item: TrackerRecord;
  updates: Record<string, unknown>;
}

/** The board column a drop into `target` would resolve, so both paths share a writer. */
function milestoneTargetColumn(target: MilestoneAssignTarget): TrackerBoardColumn {
  if (target.itemId === null) {
    return { key: 'milestone:empty', value: null, label: 'No milestone', empty: true };
  }
  const ref: TrackerRelationshipValue = {
    itemId: target.itemId,
    ...(target.title ? { title: target.title } : {}),
    ...(target.issueKey ? { issueKey: target.issueKey } : {}),
    trackerType: 'milestone',
  };
  return {
    key: `milestone:value:${target.itemId}`,
    value: target.itemId,
    label: target.title || target.issueKey || target.itemId,
    empty: false,
    ref,
  };
}

/** True when the item's milestone membership already equals the target's. */
function alreadyAssigned(item: TrackerRecord, target: MilestoneAssignTarget): boolean {
  const current = resolveGroupingRelationshipValues(item, 'milestone').map(value => value.itemId);
  if (target.itemId === null) return current.length === 0;
  return current.length === 1 && current[0] === target.itemId;
}

/**
 * The writes that place `items` in `target`, skipping the ones that would change
 * nothing. Callers persist these through `saveTrackerFieldsBatch`.
 */
export function resolveMilestoneAssignmentWrites(
  items: readonly TrackerRecord[],
  target: MilestoneAssignTarget,
): TrackerFieldWrite[] {
  const column = milestoneTargetColumn(target);
  const writes: TrackerFieldWrite[] = [];

  for (const item of items) {
    if (alreadyAssigned(item, target)) continue;
    const updates = resolveBoardColumnWrite(item, 'milestone', column);
    if (!updates) continue;
    writes.push({ item, updates });
  }

  return writes;
}

/**
 * How many of `items` belong to each milestone.
 *
 * The picker needs the count, not the set: a milestone holding some of the
 * selection is a third state ("2 of 5"), distinct from holding all of it, and
 * showing it as merely assigned is what turns an assign click into a clear.
 */
export function milestoneMembershipCounts(
  items: readonly TrackerRecord[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const value of resolveGroupingRelationshipValues(item, 'milestone')) {
      counts.set(value.itemId, (counts.get(value.itemId) ?? 0) + 1);
    }
  }
  return counts;
}

/** Read a card's own milestone memberships for chip display. */
export function cardMilestoneValues(item: TrackerRecord): TrackerRelationshipValue[] {
  return resolveGroupingRelationshipValues(item, 'milestone');
}
