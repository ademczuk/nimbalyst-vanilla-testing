import { store } from '@nimbalyst/runtime/store';
import {
  activeCollabScopeAtom,
  sharedDocumentsAtom,
} from '../store/atoms/collabDocuments';

export type SharedDocumentVisibility = {
  kind: 'document';
  sourceId: string;
  teamVisible: boolean;
  orgId: string | null;
  reason: 'shared' | 'notShared' | 'noTeam';
};

/** Read the same active shared-document index that backs the Team files UI. */
export function getSharedDocumentVisibility(sourceId: string): SharedDocumentVisibility {
  const scope = store.get(activeCollabScopeAtom);
  if (!scope) {
    return { kind: 'document', sourceId, teamVisible: false, orgId: null, reason: 'noTeam' };
  }
  const shared = store.get(sharedDocumentsAtom).some((document) => document.documentId === sourceId);
  return shared
    ? { kind: 'document', sourceId, teamVisible: true, orgId: scope.orgId, reason: 'shared' }
    : { kind: 'document', sourceId, teamVisible: false, orgId: null, reason: 'notShared' };
}

export function registerMcpCollabReadHandlers(): (() => void)[] {
  if (!window.electronAPI.onMcpGetResourceSharingStatus) return [];
  return [window.electronAPI.onMcpGetResourceSharingStatus(({ sourceId, resultChannel }) => {
    try {
      window.electronAPI.sendMcpCollabReadResult(resultChannel, {
        success: true,
        result: getSharedDocumentVisibility(sourceId),
      });
    } catch (error) {
      window.electronAPI.sendMcpCollabReadResult(resultChannel, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown shared-document read error',
      });
    }
  })];
}
