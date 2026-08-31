/**
 * The destination the author shared into last time.
 *
 * Persisted per workspace, and persisted twice on purpose: `lastSharedFolderId`
 * is authoritative, `lastSharedFolder` is the pre-id path kept so a client that
 * has not migrated still lands somewhere sensible. Resolving one to the other
 * needs the live folder tree, which is why this takes the lookups rather than
 * reading the atom itself.
 *
 * A persisted id that no longer exists resolves to the team root rather than to
 * nothing: the folder was deleted, and a picker with no selection at all cannot
 * be confirmed.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { activeWorkspacePathAtom } from '../../store/atoms/openProjects';
import { normalizeCollabPath } from '../CollabMode/collabTree';

export interface SharedFolderLookups {
  ids: Set<string>;
  idByPath: Map<string, string>;
}

export interface LastSharedFolderState {
  /** False until the persisted state has been read; seeding must wait for it. */
  hasLoaded: boolean;
  /** `undefined` when the workspace has never recorded a destination. */
  folderId: string | null | undefined;
}

export function useLastSharedFolder(
  isOpen: boolean,
  lookups: SharedFolderLookups,
): LastSharedFolderState {
  const workspacePath = useAtomValue(activeWorkspacePathAtom);
  const [persistedId, setPersistedId] = useState<string | null | undefined>(undefined);
  const [legacyPath, setLegacyPath] = useState<string>('');
  const [hasAny, setHasAny] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setHasLoaded(false);
    if (!workspacePath || !window.electronAPI?.invoke) {
      setHasLoaded(true);
      return;
    }
    let cancelled = false;
    window.electronAPI.invoke('workspace:get-state', workspacePath)
      .then((state: any) => {
        if (cancelled) return;
        const collabTree = state?.collabTree;
        const hasPersistedId = Boolean(
          collabTree && Object.prototype.hasOwnProperty.call(collabTree, 'lastSharedFolderId'),
        );
        const hasPersistedPath = typeof collabTree?.lastSharedFolder === 'string';
        setPersistedId(
          hasPersistedId && typeof collabTree.lastSharedFolderId === 'string'
            ? collabTree.lastSharedFolderId
            : hasPersistedId
            ? null
            : undefined,
        );
        setLegacyPath(hasPersistedPath ? normalizeCollabPath(collabTree.lastSharedFolder) : '');
        setHasAny(hasPersistedId || hasPersistedPath);
        setHasLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setHasAny(false);
        setHasLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, workspacePath]);

  const folderId = useMemo<string | null | undefined>(() => {
    if (!hasAny) return undefined;
    if (persistedId !== undefined) {
      return persistedId && lookups.ids.has(persistedId) ? persistedId : null;
    }
    return legacyPath ? (lookups.idByPath.get(legacyPath) ?? null) : null;
  }, [hasAny, legacyPath, lookups, persistedId]);

  return { hasLoaded, folderId };
}
