import { describe, expect, it } from 'vitest';
import type { CollabDocumentTypeDescriptor } from '@nimbalyst/collab-client/core';
import {
  applySharedDocumentRenameSuffix,
  getSharedDocumentRenameParts,
} from '../documentPresentation';

const mindmapDescriptor: CollabDocumentTypeDescriptor = {
  documentType: 'mindmap',
  displayName: 'Mindmap',
  fileExtensions: ['.mindmap'],
  defaultExtension: '.mindmap',
  icon: 'account_tree',
  editor: { kind: 'extension', extensionId: 'com.nimbalyst.mindmap' },
  content: { strategy: 'structured-yjs', codecId: 'mindmap-v1' },
  capabilities: {
    localCreate: true,
    shareToTeam: true,
    sharedCreate: true,
    history: true,
    export: true,
  },
};

describe('shared document rename suffix', () => {
  it('keeps the V2 type suffix outside the editable name and restores it exactly once', () => {
    const parts = getSharedDocumentRenameParts({
      title: 'Maps/Original.mindmap',
      documentType: 'mindmap',
      metadataVersion: 2,
      fileExtension: '.mindmap',
      editorId: 'com.nimbalyst.mindmap',
    }, [mindmapDescriptor]);

    expect(parts).toEqual({ baseName: 'Original', suffix: '.mindmap' });
    expect(applySharedDocumentRenameSuffix('Renamed', parts.suffix)).toBe('Renamed.mindmap');
    expect(applySharedDocumentRenameSuffix('Renamed.MINDMAP', parts.suffix)).toBe('Renamed.mindmap');
  });
});
