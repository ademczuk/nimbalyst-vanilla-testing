// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  selectTrackerSharingMigrationNotice,
  type TrackerSharingMigrationEntryLike,
  type TrackerSharingMigrationReportLike,
} from '../trackerSharingMigrationNotice';

const entry = (
  overrides: Partial<TrackerSharingMigrationEntryLike>,
): TrackerSharingMigrationEntryLike => ({
  trackerType: 'plan',
  legacySchemaMode: 'shared',
  legacyItemMode: null,
  sharing: 'team',
  draftByDefault: false,
  diverged: false,
  ...overrides,
});

const report = (entries: TrackerSharingMigrationEntryLike[], migratedAt = 1000): TrackerSharingMigrationReportLike => ({
  version: 1,
  migratedAt,
  entries,
  divergences: entries.filter((e) => e.diverged),
});

describe('selectTrackerSharingMigrationNotice', () => {
  it('says nothing when no tracker changed hands', () => {
    // Every fresh install migrates every type; none of it moved, so no banner.
    expect(selectTrackerSharingMigrationNotice(report([
      entry({ trackerType: 'bug' }),
      entry({ trackerType: 'plan', legacySchemaMode: 'hybrid', draftByDefault: true }),
    ]), undefined)).toBeNull();
  });

  it('reports the trackers whose sharing state actually moved', () => {
    const notice = selectTrackerSharingMigrationNotice(report([
      entry({ trackerType: 'bug' }),
      entry({
        trackerType: 'plan',
        legacySchemaMode: 'shared',
        legacyItemMode: 'local',
        sharing: 'personal',
        diverged: true,
      }),
    ]), undefined);
    expect(notice?.changes.map((c) => c.trackerType)).toEqual(['plan']);
    expect(notice?.migratedAt).toBe(1000);
  });

  it('stays dismissed once acknowledged, and returns for a later migration', () => {
    const changed = [entry({ diverged: true, sharing: 'personal', legacyItemMode: 'local' })];
    expect(selectTrackerSharingMigrationNotice(report(changed, 1000), 1000)).toBeNull();
    expect(selectTrackerSharingMigrationNotice(report(changed, 2000), 1000)).not.toBeNull();
  });

  it('ignores a report from an unknown version rather than guessing its shape', () => {
    const unknown = { ...report([entry({ diverged: true })]), version: 2 };
    expect(selectTrackerSharingMigrationNotice(unknown, undefined)).toBeNull();
    expect(selectTrackerSharingMigrationNotice(null, undefined)).toBeNull();
  });
});
