// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  parseCollabPendingKey,
  drainLegacyPendingUpdates,
} from '../legacyPendingUpdateDrain';

const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');

describe('parseCollabPendingKey', () => {
  it('splits the org and document out of a pending key', () => {
    expect(parseCollabPendingKey('org:organization-live-abc:doc:doc-1')).toEqual({
      orgId: 'organization-live-abc',
      documentId: 'doc-1',
    });
  });

  it('rejects keys that are not in the org/doc shape', () => {
    expect(parseCollabPendingKey('doc-1')).toBeNull();
    expect(parseCollabPendingKey('org:only-an-org')).toBeNull();
  });
});

describe('drainLegacyPendingUpdates', () => {
  const entry = (bytes: number[]) => ({ mergedUpdateBase64: b64(bytes), updatedAt: 1 });

  it('migrates every pending entry, not just the document being opened', async () => {
    const migrate = vi.fn().mockResolvedValue(true);
    const result = await drainLegacyPendingUpdates({
      pending: {
        'org:org-a:doc:doc-1': entry([1]),
        'org:org-a:doc:doc-2': entry([2]),
        'org:org-b:doc:doc-3': entry([3]),
      },
      accountId: 'account-1',
      resolveDocumentType: (id) => (id === 'doc-3' ? 'excalidraw' : undefined),
      migrate,
    });

    expect(result.migrated.sort()).toEqual([
      'org:org-a:doc:doc-1',
      'org:org-a:doc:doc-2',
      'org:org-b:doc:doc-3',
    ]);
    expect(result.failed).toEqual([]);
    expect(migrate).toHaveBeenCalledTimes(3);

    // Identity is parsed per entry, so a second org drains on the same pass.
    expect(migrate).toHaveBeenCalledWith(
      { accountId: 'account-1', orgId: 'org-b', documentId: 'doc-3' },
      'excalidraw',
      new Uint8Array([3])
    );
    // Unknown document types fall back to markdown, matching the open path.
    expect(migrate).toHaveBeenCalledWith(
      { accountId: 'account-1', orgId: 'org-a', documentId: 'doc-1' },
      'markdown',
      new Uint8Array([1])
    );
  });

  it('keeps an entry whose migration did not commit', async () => {
    const migrate = vi.fn(async (identity: { documentId: string }) => identity.documentId === 'doc-1');
    const result = await drainLegacyPendingUpdates({
      pending: {
        'org:org-a:doc:doc-1': entry([1]),
        'org:org-a:doc:doc-2': entry([2]),
      },
      accountId: 'account-1',
      resolveDocumentType: () => undefined,
      migrate,
    });

    expect(result.migrated).toEqual(['org:org-a:doc:doc-1']);
    expect(result.failed).toEqual(['org:org-a:doc:doc-2']);
  });

  it('keeps an entry whose migration threw, so unsynced edits survive', async () => {
    const migrate = vi.fn().mockRejectedValue(new Error('replica store unavailable'));
    const onError = vi.fn();
    const result = await drainLegacyPendingUpdates({
      pending: { 'org:org-a:doc:doc-1': entry([1]) },
      accountId: 'account-1',
      resolveDocumentType: () => undefined,
      migrate,
      onError,
    });

    expect(result.migrated).toEqual([]);
    expect(result.failed).toEqual(['org:org-a:doc:doc-1']);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('drops a malformed key without calling migrate', async () => {
    const migrate = vi.fn().mockResolvedValue(true);
    const result = await drainLegacyPendingUpdates({
      pending: { 'garbage-key': entry([1]) },
      accountId: 'account-1',
      resolveDocumentType: () => undefined,
      migrate,
    });

    expect(migrate).not.toHaveBeenCalled();
    expect(result.migrated).toEqual([]);
    expect(result.failed).toEqual(['garbage-key']);
  });
});
