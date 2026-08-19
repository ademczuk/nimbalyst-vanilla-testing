// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { buildCollabUri, collabUriToRoomId, parseCollabUri } from '../collabUri.js';

describe('collab URI grammar', () => {
  it('round-trips document IDs, assigns trailing colon segments to the document ID, and rejects invalid URIs', () => {
    const uri = buildCollabUri('org-1', 'document:revision:2');

    expect(uri).toBe('collab://org:org-1:doc:document:revision:2');
    expect(parseCollabUri(uri)).toEqual({
      orgId: 'org-1',
      documentId: 'document:revision:2',
    });
    expect(collabUriToRoomId(uri)).toBe('org:org-1:doc:document:revision:2');
    expect(() => parseCollabUri('https://example.com/document/1')).toThrow('Not a collab URI');
    expect(() => parseCollabUri('collab://org:org-1:document:document-1')).toThrow(
      'Invalid collab URI format',
    );
  });
});
