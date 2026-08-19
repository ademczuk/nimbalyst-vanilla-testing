/**
 * How a tracker item's content area is edited.
 *
 * Extracted from TrackerItemDetail so the decision is testable on its own --
 * it is the thing that decides whether the sharer of a plan keeps editing their
 * local markdown file while teammates edit the collab doc.
 */

import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import type { TrackerSharing } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel';

export type TrackerContentMode = 'file-backed' | 'local-pglite' | 'collaborative';

/**
 * Whether this record is a native DB item (its content lives in the item, not in
 * a markdown file).
 *
 * A file-backed plan that has been shared is PROMOTED to `source: 'native'` while
 * KEEPING `documentPath` for provenance -- so this is an OR, not an AND: the
 * promoted item is native even though it remembers the file it came from.
 */
export function isNativeItem(record: TrackerRecord): boolean {
  return record.source === 'native' || !record.system.documentPath;
}

/**
 * Whether this item is backed by a markdown file, and therefore safe to UNSHARE
 * (it re-projects from disk; a truly native item would be deleted instead).
 *
 * Includes items whose id is still a legacy `fm:<type>:<path>` -- those were
 * shared before promotion existed, and the sync round-trip has since rewritten
 * their `source` to `'native'` and dropped `documentPath`. Judging by `source`
 * alone would lock their share toggle forever, leaving no way to move them onto
 * a stable id short of a migration.
 */
export function isFileBackedRecord(record: TrackerRecord): boolean {
  return (
    record.source === 'frontmatter' ||
    record.source === 'import' ||
    record.id.startsWith('fm:') ||
    // A promoted item: native, but still recording the file it came from.
    (record.source === 'native' && !!record.system.documentPath)
  );
}

export function resolveTrackerContentMode(params: {
  item: TrackerRecord | null | undefined;
  sharing: TrackerSharing;
  /** The existing per-item bit, expressed as Draft/Published. */
  isItemPublished: boolean;
  /** Tri-state: undefined = team lookup pending, null = confirmed no team. */
  teamOrgId: string | null | undefined;
}): TrackerContentMode {
  const { item, sharing, isItemPublished, teamOrgId } = params;
  if (!item || !isNativeItem(item)) return 'file-backed';
  if (sharing === 'personal' || !isItemPublished) return 'local-pglite';
  // Published team items need a team for collaborative editing. Without one,
  // content is purely local. While the team check is still pending
  // (`teamOrgId === undefined`) stay in collaborative mode so the loading UI
  // runs -- otherwise the local editor would mount and risk being clobbered if a
  // team is then discovered.
  if (teamOrgId === null) return 'local-pglite';
  return 'collaborative';
}
