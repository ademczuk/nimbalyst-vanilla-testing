/**
 * What the one-time post-migration summary should say, if anything (PRD D6).
 *
 * Existing setups migrate to the single sharing axis silently. The only part a
 * user cannot otherwise account for is a tracker whose sharing state actually
 * MOVED — where this machine's old per-tracker sync setting disagreed with the
 * schema file, and the setting they were really using won. W2 records exactly
 * those as `divergences`; everything else is a rename the sidebar already
 * explains, so it is not worth a banner.
 *
 * A workspace with no legacy disagreement (every fresh install) gets nothing.
 */

export type LegacyTrackerSharingMode = 'local' | 'shared' | 'hybrid';

/** Structural mirror of TrackerSharingMigrationEntry persisted in workspace state. */
export interface TrackerSharingMigrationEntryLike {
  trackerType: string;
  legacySchemaMode: LegacyTrackerSharingMode;
  legacyItemMode: LegacyTrackerSharingMode | null;
  sharing: 'personal' | 'team';
  draftByDefault: boolean;
  diverged: boolean;
}

export interface TrackerSharingMigrationReportLike {
  version: number;
  migratedAt: number;
  entries: TrackerSharingMigrationEntryLike[];
  divergences: TrackerSharingMigrationEntryLike[];
}

export interface TrackerSharingMigrationNotice {
  migratedAt: number;
  changes: TrackerSharingMigrationEntryLike[];
}

export function selectTrackerSharingMigrationNotice(
  report: TrackerSharingMigrationReportLike | null | undefined,
  seenAt: number | null | undefined,
): TrackerSharingMigrationNotice | null {
  if (!report || report.version !== 1) return null;
  // The report is rewritten while legacy per-machine policies are still being
  // finalized, so acknowledgement is tracked against the migration timestamp
  // rather than a flag inside the report a rewrite would drop.
  if (typeof seenAt === 'number' && seenAt >= report.migratedAt) return null;
  const changes = (report.divergences ?? []).filter((entry) => entry.diverged);
  return changes.length > 0 ? { migratedAt: report.migratedAt, changes } : null;
}

/** Where a diverged tracker landed, in the user's terms. */
export function describeTrackerSharingOutcome(entry: TrackerSharingMigrationEntryLike): string {
  if (entry.sharing === 'personal') return 'is now a personal tracker, kept on this machine';
  return entry.draftByDefault
    ? 'is now a team tracker whose new items start as drafts'
    : 'is now a team tracker, shared with everyone';
}
