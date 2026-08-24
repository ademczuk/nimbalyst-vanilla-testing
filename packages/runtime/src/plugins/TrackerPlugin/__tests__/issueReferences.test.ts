// @vitest-environment node
import { createStore } from 'jotai';
import { describe, expect, it } from 'vitest';
import type { LinkedIssue, TrackerRecord } from '../../../core/TrackerRecord';
import { dbRowToRecord, recordToDbParams } from '../../../core/TrackerRecord';
import { trackerItemsMapAtom } from '../trackerDataAtoms';
import {
  buildIssueUrl,
  getRecordIssueReferences,
  issueTrackerReferencesAtom,
  parseIssueUrl,
} from '../issueReferences';
import { parsePrUrl } from '../prReferences';

function makeRecord(
  id: string,
  fields: Record<string, unknown>,
  system: Partial<TrackerRecord['system']> = {},
  archived = false,
): TrackerRecord {
  return {
    id,
    primaryType: 'bug',
    typeTags: ['bug'],
    source: 'native',
    archived,
    syncStatus: 'local',
    system: {
      workspace: '/tmp/ws',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      ...system,
    },
    fields,
  };
}

/** Serialize/deserialize exactly as the store does, so a fixture can't outrun persistence. */
function throughStore(record: TrackerRecord): TrackerRecord {
  const params = recordToDbParams(record);
  return dbRowToRecord({
    id: params.id,
    type: params.type,
    type_tags: params.typeTags,
    data: params.data,
    workspace: params.workspace,
    document_path: params.documentPath,
    line_number: params.lineNumber,
    sync_status: params.syncStatus,
    archived: params.archived,
    source: params.source,
    source_ref: params.sourceRef,
  });
}

describe('parseIssueUrl', () => {
  it('parses GitHub issue URL variants and canonicalizes the remote', () => {
    for (const url of [
      'https://github.com/Owner/Repo/issues/9/',
      'https://github.com/Owner/Repo/issues/9?notification_referrer_id=1',
      'https://github.com/Owner/Repo/issues/9#issuecomment-123',
      'https://github.com/Owner/Repo/issues/9/files',
      'http://www.GITHUB.COM/Owner/Repo/issues/9',
    ]) {
      expect(parseIssueUrl(url)).toEqual({ remote: 'owner/repo', number: 9 });
    }
    expect(parseIssueUrl(buildIssueUrl('owner/repo', 42))).toEqual({ remote: 'owner/repo', number: 42 });
  });

  it('treats /issues URLs as issue references but not /pull URLs', () => {
    expect(parseIssueUrl('https://github.com/owner/repo/issues/9')).toEqual({ remote: 'owner/repo', number: 9 });
    expect(parseIssueUrl('https://github.com/owner/repo/pull/9')).toBeNull();
    expect(parsePrUrl('https://github.com/owner/repo/issues/9')).toBeNull();
    expect(parseIssueUrl('https://github.com/owner/repo/issues/12abc')).toBeNull();
  });
});

describe('getRecordIssueReferences', () => {
  it('combines persisted explicit links and SQLite-shaped URL fields without duplicates', () => {
    const linkedIssues: LinkedIssue[] = [
      { remote: 'A/B', number: 7 },
      { remote: 'a/b', number: 8, url: 'https://github.com/a/b/issues/8' },
    ];
    // Explicit links only work if linkedIssues survives serialize -> deserialize;
    // it is a system key, so omitting it from any of those sites silently drops it.
    const record = throughStore(makeRecord(
      'bug-1',
      { issueUrl: JSON.stringify({ url: 'https://github.com/a/b/issues/7', label: '#7' }) },
      { linkedIssues },
    ));

    expect(record.system.linkedIssues).toEqual(linkedIssues);
    expect(record.fields.linkedIssues).toBeUndefined();
    expect(getRecordIssueReferences(record)).toEqual([
      { remote: 'a/b', number: 7 },
      { remote: 'a/b', number: 8 },
    ]);
  });
});

describe('issueTrackerReferencesAtom', () => {
  it('filters by remote and archive state, then sorts each bucket newest first', () => {
    const older = makeRecord('older', { link: 'https://github.com/a/b/issues/7' }, {
      updatedAt: '2026-08-09T00:00:00.000Z',
    });
    const newer = makeRecord('newer', { link: { url: 'https://github.com/A/B/issues/7' } }, {
      updatedAt: '2026-08-11T00:00:00.000Z',
    });
    const archived = makeRecord('archived', { link: 'https://github.com/a/b/issues/7' }, {
      updatedAt: '2026-08-12T00:00:00.000Z',
    }, true);
    const crossRepo = makeRecord('cross-repo', { link: 'https://github.com/other/repo/issues/7' });
    const store = createStore();
    store.set(trackerItemsMapAtom, new Map([older, newer, archived, crossRepo].map((record) => [record.id, record])));

    expect(store.get(issueTrackerReferencesAtom('A/B')).get(7)?.map((record) => record.id)).toEqual([
      'newer',
      'older',
    ]);
  });
});
