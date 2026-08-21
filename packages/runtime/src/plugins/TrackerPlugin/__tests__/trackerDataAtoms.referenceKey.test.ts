// @vitest-environment node
import { createStore } from 'jotai';
import { describe, expect, it } from 'vitest';

import type { TrackerRecord } from '../../../core/TrackerRecord';
import {
  replaceAllTrackerItemsAtom,
  replaceOrgTrackerItemsAtom,
  trackerItemByReferenceKeyAtom,
  trackerItemsByTypeAtom,
} from '../trackerDataAtoms';

function record(id: string, issueKey: string, title: string): TrackerRecord {
  return {
    id,
    issueKey,
    primaryType: 'bug',
    typeTags: ['bug'],
    archived: false,
    fields: { title },
    system: { workspace: '/w', createdAt: '', updatedAt: '' },
  } as unknown as TrackerRecord;
}

describe('tracker reference resolution across workspace and org records', () => {
  it('resolves a key an org surface knows about but the workspace does not', () => {
    const store = createStore();
    store.set(replaceAllTrackerItemsAtom, [record('bug-1', 'NIM-1', 'Local')]);
    store.set(replaceOrgTrackerItemsAtom, {
      orgId: 'org-a',
      records: [record('bug-2', 'NIM-2', 'Another project')],
    });

    expect(store.get(trackerItemByReferenceKeyAtom('NIM-2'))?.id).toBe('bug-2');
  });

  it('prefers the workspace copy so a chip agrees with the grid beside it', () => {
    const store = createStore();
    store.set(replaceAllTrackerItemsAtom, [record('bug-1', 'NIM-1', 'Edited here')]);
    store.set(replaceOrgTrackerItemsAtom, {
      orgId: 'org-a',
      records: [record('bug-1', 'NIM-1', 'Stale org copy')],
    });

    expect(store.get(trackerItemByReferenceKeyAtom('NIM-1'))?.fields.title).toBe('Edited here');
  });

  it('keeps org records out of the workspace surfaces that count and list items', () => {
    const store = createStore();
    store.set(replaceAllTrackerItemsAtom, [record('bug-1', 'NIM-1', 'Local')]);
    store.set(replaceOrgTrackerItemsAtom, {
      orgId: 'org-a',
      records: [record('bug-2', 'NIM-2', 'Another project')],
    });

    expect(store.get(trackerItemsByTypeAtom('bug')).map((r) => r.id)).toEqual(['bug-1']);
  });

  it('replaces only the named org slice', () => {
    const store = createStore();
    store.set(replaceOrgTrackerItemsAtom, { orgId: 'org-a', records: [record('bug-1', 'NIM-1', 'A')] });
    store.set(replaceOrgTrackerItemsAtom, { orgId: 'org-b', records: [record('bug-2', 'NIM-2', 'B')] });
    store.set(replaceOrgTrackerItemsAtom, { orgId: 'org-b', records: [] });

    expect(store.get(trackerItemByReferenceKeyAtom('NIM-1'))?.id).toBe('bug-1');
    expect(store.get(trackerItemByReferenceKeyAtom('NIM-2'))).toBeNull();
  });
});
