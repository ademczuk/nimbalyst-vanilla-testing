/**
 * Wires the messaging resource-preview seam to this organization's shared
 * documents, in whichever window is asking.
 *
 * WHY THIS IS NOT JUST `useAtomValue(sharedDocumentsAtom)`
 *
 * Messaging renders in two windows. `sharedDocumentsAtom` derives from
 * `activeCollabScopeAtom`, which only `CollabMode` ever sets, and `CollabMode`
 * mounts only in the project window. Read the active list from the
 * organization window and it is permanently `[]` -- which the resolver would
 * report as "you cannot see this document" for a document the reader owns.
 *
 * So this hook addresses scopes directly instead of asking which one is
 * active: it resolves the organization's local workspaces, starts a documents
 * session for each, and reads the per-scope atom. In the project window that
 * session already exists and `start()` is memoized, so this attaches to it
 * rather than racing it. The two windows are separate renderer processes and
 * share no module state, so there is nothing to contend over between them.
 *
 * A document is addressed by id alone; the link does not say which project it
 * belongs to. Every local workspace of the organization is therefore a
 * candidate, and the union of their documents is what the reader can see.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { atom, useAtomValue } from 'jotai';
import { sharedDocumentsForScopeAtom } from '@nimbalyst/collab-client/docs';

import {
  createResourcePreviewResolver,
  type PreviewableSharedDocument,
} from '../components/Comments/resourcePreviewResolver';
import type { ResourcePreviewResolver } from '../components/Comments/commentTypes';
import { initSharedDocuments, resolveDesktopCollabScope } from '../store/atoms/collabDocuments';
import { getCollaborativeDocumentTypeCatalog } from '../services/CollaborativeDocumentTypeCatalog';

/**
 * Per-organization workspace lookup, shared across every surface in the window.
 *
 * `resolveOrgProjectsLocalState` resolves git remotes across recent workspaces
 * and measured ~1.7s on a two-project organization. The answer changes only
 * when projects are added or cloned, so mounting a second conversation must not
 * pay for it again. Cached by organization for the life of the window;
 * a failure is not cached, so a transient one retries on the next mount.
 */
const scopeKeysByOrg = new Map<string, Promise<readonly string[]>>();

function loadOrgScopeKeys(orgId: string): Promise<readonly string[]> {
  const cached = scopeKeysByOrg.get(orgId);
  if (cached) return cached;

  // Guarded like `resolveDesktopCollabScope` guards its own preload surface:
  // a window without it can still show the conversation, with references
  // reporting that they cannot be read rather than taking the thread down.
  const team = window.electronAPI?.team;
  if (!team?.resolveOrgProjectsLocalState) return Promise.resolve([]);

  const pending = team
    .resolveOrgProjectsLocalState(orgId)
    .then((result: { success: boolean; projects?: { workspacePath: string | null }[] }) => {
      if (!result?.success) throw new Error('resolveOrgProjectsLocalState reported failure');
      const paths = (result.projects ?? [])
        .map((project) => project.workspacePath)
        .filter((path): path is string => !!path);
      return Array.from(new Set(paths));
    })
    .catch((error: unknown) => {
      scopeKeysByOrg.delete(orgId);
      // An unknown workspace set is not an empty one, but a resolver that never
      // answers leaves pills spinning. Report "nothing readable" and let the
      // pill say so.
      console.error('[ResourcePreviews] Failed to resolve local projects:', error);
      return [] as readonly string[];
    });

  scopeKeysByOrg.set(orgId, pending);
  return pending;
}

/**
 * Workspace paths this window may read documents from for `orgId`.
 *
 * `null` while the answer is unknown, which the resolver reports as `loading`
 * rather than as "no access" -- see the header of `resourcePreviewResolver`.
 */
function useOrgScopeKeys(orgId: string): readonly string[] | null {
  const [scopeKeys, setScopeKeys] = useState<readonly string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setScopeKeys(null);
    void loadOrgScopeKeys(orgId).then((paths) => {
      if (!cancelled) setScopeKeys(paths);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return scopeKeys;
}

/** Start a documents session per scope so the per-scope atom fills. */
function useStartedDocumentSessions(scopeKeys: readonly string[] | null): void {
  const scopeKeysKey = scopeKeys === null ? null : scopeKeys.join('\x00');

  useEffect(() => {
    if (scopeKeysKey === null || scopeKeysKey === '') return;
    let cancelled = false;
    for (const scopeKey of scopeKeysKey.split('\x00')) {
      void resolveDesktopCollabScope(scopeKey)
        .then(({ scope }) => {
          if (cancelled || !scope) return;
          return initSharedDocuments(scope);
        })
        .catch((error: unknown) => {
          console.error(`[ResourcePreviews] Failed to open documents for ${scopeKey}:`, error);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [scopeKeysKey]);
}

/**
 * Extension-contributed document types load after the first render, in both
 * windows. Tracking the catalog's revision re-derives the type label when they
 * arrive instead of freezing whatever was known at mount.
 */
function useCatalogRevision(): number {
  const catalog = getCollaborativeDocumentTypeCatalog();
  return useSyncExternalStore(
    (listener) => catalog.subscribe(listener),
    () => catalog.getSnapshot(),
  );
}

export function useResourcePreviewResolver(orgId: string): ResourcePreviewResolver {
  const scopeKeys = useOrgScopeKeys(orgId);
  useStartedDocumentSessions(scopeKeys);

  const scopeKeysKey = scopeKeys === null ? null : scopeKeys.join('\x00');
  const documentsAtom = useMemo(
    () =>
      atom((get) =>
        scopeKeysKey === null || scopeKeysKey === ''
          ? []
          : scopeKeysKey
              .split('\x00')
              .flatMap((scopeKey) => get(sharedDocumentsForScopeAtom(scopeKey))),
      ),
    [scopeKeysKey],
  );
  const documents = useAtomValue(documentsAtom);
  const catalogRevision = useCatalogRevision();

  return useMemo(
    () =>
      createResourcePreviewResolver({
        documents: () => (scopeKeysKey === null ? null : documents),
        describeDocumentType: describeDocumentType,
      }),
    // `catalogRevision` is not read here: it is the signal that
    // `describeDocumentType` would now answer differently, and rebuilding the
    // resolver is what makes `useResourcePreviews` ask again.
    [documents, scopeKeysKey, catalogRevision],
  );
}

/**
 * The display name of the document's type, by the same three-step fallback the
 * shared-doc typeahead uses: the stored extension, then one inferred from the
 * title, then the type's default.
 */
function describeDocumentType(document: PreviewableSharedDocument): string | undefined {
  const catalog = getCollaborativeDocumentTypeCatalog();
  const extension = document.fileExtension
    ?? catalog.inferFileExtension(document.documentType, document.title);
  const resolved = catalog.resolveMetadata(document.documentType, extension, document.editorId);
  return resolved.descriptor?.displayName;
}
