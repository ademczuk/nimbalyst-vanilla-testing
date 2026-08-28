import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import {
  createSharedFolder,
  activeCollabScopeAtom,
} from '../../store/atoms/collabDocuments';
import { activeWorkspacePathAtom } from '../../store/atoms/openProjects';
import { normalizeCollabPath } from '../CollabMode/collabTree';
import type { CollaborativeDocumentTypeDescriptor } from '../../services/CollaborativeDocumentTypeCatalog';
import type { EmbeddedDocumentCandidate } from '../../services/embeddedDocumentShare';
import { SharedFolderTree } from './SharedFolderTree';
import { useSharedFolderTree } from './useSharedFolderTree';

export interface ShareToTeamDialogProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  descriptor: CollaborativeDocumentTypeDescriptor;
  /** Workspace-relative path used as the source label in the dialog. */
  sourceRelPath: string;
  embeddedDocuments?: EmbeddedDocumentCandidate[];
  /**
   * Pre-selects a folder instead of the last-used one. Set by a caller that
   * already asked the author where this is going.
   */
  initialFolderId?: string | null;
  /**
   * Called when the user confirms. Returns the selected destination folder
   * (empty string = team root) and the shared name (with extension).
   */
  onConfirm: (params: {
    folderId: string | null;
    folderPath: string;
    sharedName: string;
    selectedEmbeddedDocumentPaths: string[];
  }) => void;
}

const EMPTY_EMBEDDED_DOCUMENTS: EmbeddedDocumentCandidate[] = [];

export function splitShareFileName(
  fileName: string,
  descriptor: CollaborativeDocumentTypeDescriptor,
): { baseName: string; suffix: string } {
  const lowerName = fileName.toLowerCase();
  const matchedSuffix = [...descriptor.fileExtensions]
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .find(suffix => lowerName.endsWith(suffix.toLowerCase()));
  const suffix = matchedSuffix
    ? fileName.slice(fileName.length - matchedSuffix.length)
    : descriptor.defaultExtension;
  const baseName = matchedSuffix ? fileName.slice(0, -matchedSuffix.length) : fileName;
  return { baseName, suffix };
}

export function ShareToTeamDialog({
  isOpen,
  onClose,
  fileName,
  descriptor,
  sourceRelPath,
  embeddedDocuments = EMPTY_EMBEDDED_DOCUMENTS,
  initialFolderId,
  onConfirm,
}: ShareToTeamDialogProps) {
  const workspacePath = useAtomValue(activeWorkspacePathAtom);
  const collabScope = useAtomValue(activeCollabScopeAtom);
  const folderTree = useSharedFolderTree(isOpen);
  const {
    isRefreshing: isRefreshingFolders,
    refreshFailed: folderRefreshFailed,
    expandedFolders,
    toggleFolder,
    revealFolder,
    expandFolder,
  } = folderTree;

  const [lastSharedFolderId, setLastSharedFolderId] = useState<string | null | undefined>(undefined);
  const [legacyLastSharedFolderPath, setLegacyLastSharedFolderPath] = useState<string>('');
  const [hasLastSharedFolder, setHasLastSharedFolder] = useState(false);
  const [hasLoadedState, setHasLoadedState] = useState(false);
  const [hasInitializedSelection, setHasInitializedSelection] = useState(false);

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const fileNameParts = useMemo(
    () => splitShareFileName(fileName, descriptor),
    [descriptor, fileName],
  );
  const [sharedBaseName, setSharedBaseName] = useState<string>(fileNameParts.baseName);
  const [newFolderParentId, setNewFolderParentId] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [selectedEmbeddedDocumentPaths, setSelectedEmbeddedDocumentPaths] = useState<Set<string>>(
    () => new Set(embeddedDocuments.map(document => document.absolutePath)),
  );

  // Reset transient state every time the dialog opens for a different file.
  useEffect(() => {
    if (!isOpen) return;
    setSharedBaseName(fileNameParts.baseName);
    setNewFolderParentId(undefined);
    setNewFolderName('');
    setHasInitializedSelection(false);
    setSelectedEmbeddedDocumentPaths(
      new Set(embeddedDocuments.map(document => document.absolutePath)),
    );
  }, [embeddedDocuments, fileNameParts.baseName, isOpen]);

  // Load workspace-persisted state for the last-used destination. Folder rows
  // themselves come only from TeamRoom, never workspace/PGLite state.
  useEffect(() => {
    if (!isOpen) return;
    setHasLoadedState(false);
    if (!workspacePath || !window.electronAPI?.invoke) {
      setHasLoadedState(true);
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
        const persistedId = typeof collabTree?.lastSharedFolderId === 'string'
          ? collabTree.lastSharedFolderId
          : null;
        const persistedPath = hasPersistedPath
          ? normalizeCollabPath(collabTree.lastSharedFolder)
          : '';
        setLastSharedFolderId(hasPersistedId ? persistedId : undefined);
        setLegacyLastSharedFolderPath(persistedPath);
        setHasLastSharedFolder(hasPersistedId || hasPersistedPath);
        setHasLoadedState(true);
      })
      .catch(() => {
        if (cancelled) return;
        setHasLastSharedFolder(false);
        setHasLoadedState(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, workspacePath]);

  const folderLookups = useMemo(
    () => ({
      ids: folderTree.ids,
      pathById: folderTree.pathById,
      idByPath: folderTree.idByPath,
    }),
    [folderTree.ids, folderTree.pathById, folderTree.idByPath],
  );

  const resolvedLastSharedFolderId = useMemo<string | null | undefined>(() => {
    if (!hasLastSharedFolder) return undefined;
    if (lastSharedFolderId !== undefined) {
      return lastSharedFolderId && folderLookups.ids.has(lastSharedFolderId)
        ? lastSharedFolderId
        : null;
    }
    return legacyLastSharedFolderPath
      ? (folderLookups.idByPath.get(legacyLastSharedFolderPath) ?? null)
      : null;
  }, [folderLookups, hasLastSharedFolder, lastSharedFolderId, legacyLastSharedFolderPath]);

  // After both local preference state and the authoritative refresh finish,
  // seed selection exactly once for this open.
  useEffect(() => {
    if (
      !isOpen
      || !hasLoadedState
      || isRefreshingFolders
      || folderRefreshFailed
      || hasInitializedSelection
    ) return;
    // A caller-supplied folder outranks the last-used one: it is an answer the
    // author already gave for this specific share, not a recency guess. A stale
    // one that no longer exists falls back rather than selecting nothing.
    const supplied = initialFolderId !== undefined
      && initialFolderId !== null
      && folderLookups.ids.has(initialFolderId)
      ? initialFolderId
      : undefined;
    const candidate = supplied
      ?? (initialFolderId === null ? null : resolvedLastSharedFolderId ?? null);
    setSelectedFolderId(candidate);
    revealFolder(candidate);
    setHasInitializedSelection(true);
  }, [
    folderLookups,
    hasInitializedSelection,
    hasLoadedState,
    folderRefreshFailed,
    initialFolderId,
    isOpen,
    isRefreshingFolders,
    resolvedLastSharedFolderId,
    revealFolder,
  ]);

  useEffect(() => {
    if (hasInitializedSelection && selectedFolderId && !folderLookups.ids.has(selectedFolderId)) {
      setSelectedFolderId(null);
    }
  }, [folderLookups, hasInitializedSelection, selectedFolderId]);

  // New folders are first-class TeamRoom rows immediately, never local path
  // drafts that can leak into a later dialog open.
  const beginNewFolder = useCallback((parentFolderId: string | null) => {
    setNewFolderParentId(parentFolderId);
    setNewFolderName('');
    if (parentFolderId) expandFolder(parentFolderId);
  }, [expandFolder]);

  const commitNewFolder = useCallback(async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) {
      setNewFolderParentId(undefined);
      setNewFolderName('');
      return;
    }
    if (trimmed.includes('/') || trimmed.includes('\\')) {
      // Reject path separators; folder names are single segments.
      return;
    }
    const parentFolderId = newFolderParentId ?? null;
    const parentPath = parentFolderId ? (folderLookups.pathById.get(parentFolderId) ?? '') : '';
    const fullPath = normalizeCollabPath(parentPath ? `${parentPath}/${trimmed}` : trimmed);
    const existingFolderId = folderLookups.idByPath.get(fullPath);
    setNewFolderParentId(undefined);
    setNewFolderName('');
    if (existingFolderId) {
      setSelectedFolderId(existingFolderId);
      return;
    }
    try {
      if (!collabScope) return;
      const folderId = await createSharedFolder(collabScope, trimmed, parentFolderId);
      setSelectedFolderId(folderId);
      expandFolder(folderId);
      if (parentFolderId) expandFolder(parentFolderId);
    } catch (error) {
      console.error('[ShareToTeamDialog] Failed to create shared folder:', error);
    }
  }, [collabScope, expandFolder, folderLookups, newFolderName, newFolderParentId]);

  const cancelNewFolder = useCallback(() => {
    setNewFolderParentId(undefined);
    setNewFolderName('');
  }, []);

  const handleConfirm = useCallback(() => {
    const trimmedName = sharedBaseName.trim();
    if (
      !trimmedName
      || isRefreshingFolders
      || folderRefreshFailed
      || !hasInitializedSelection
    ) return;
    onConfirm({
      folderId: selectedFolderId,
      folderPath: selectedFolderId ? (folderLookups.pathById.get(selectedFolderId) ?? '') : '',
      sharedName: `${trimmedName}${fileNameParts.suffix}`,
      selectedEmbeddedDocumentPaths: [...selectedEmbeddedDocumentPaths],
    });
    onClose();
  }, [
    folderLookups,
    folderRefreshFailed,
    hasInitializedSelection,
    isRefreshingFolders,
    onClose,
    onConfirm,
    selectedFolderId,
    selectedEmbeddedDocumentPaths,
    fileNameParts.suffix,
    sharedBaseName,
  ]);

  if (!isOpen) return null;

  const selectedFolderPath = selectedFolderId
    ? (folderLookups.pathById.get(selectedFolderId) ?? '')
    : '';
  const destinationFolderLabel = selectedFolderPath || 'Team root';
  const destinationFullPath = selectedFolderPath
    ? `${selectedFolderPath.split('/').join(' / ')} /`
    : 'Team root /';

  const isRootCreateOpen = newFolderParentId === null;
  const canConfirm = Boolean(sharedBaseName.trim())
    && !isRefreshingFolders
    && !folderRefreshFailed
    && hasInitializedSelection;
  const previewSharedName = `${sharedBaseName.trim() || fileNameParts.baseName}${fileNameParts.suffix}`;
  const selectedEmbeddedCount = selectedEmbeddedDocumentPaths.size;
  // Already-shared embeds are reused, not created, so they don't count toward
  // what this action will actually share.
  const newlySharedEmbeddedCount = embeddedDocuments.filter(
    document => selectedEmbeddedDocumentPaths.has(document.absolutePath)
      && !document.alreadyShared,
  ).length;
  const shareDocumentCount = 1 + newlySharedEmbeddedCount;

  return (
    <div
      className="share-to-team-overlay fixed inset-0 z-[10000] flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="share-to-team-dialog flex max-h-[90vh] w-[460px] max-w-[92%] flex-col overflow-hidden rounded-xl border border-[var(--nim-border)] bg-[var(--nim-bg)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Share to Team"
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-[var(--nim-border)]">
          <div className="w-7 h-7 rounded-md bg-[var(--nim-primary)]/15 text-[var(--nim-primary)] flex items-center justify-center shrink-0 mt-0.5">
            <MaterialSymbol icon="group" size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[14px] font-semibold text-[var(--nim-text)] m-0 leading-tight">
              Share to Team
            </h2>
            <p className="text-[12px] text-[var(--nim-text-faint)] m-0 mt-0.5 leading-snug">
              Pick where this document should live in your team space.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--nim-text-faint)] hover:text-[var(--nim-text)] hover:bg-[var(--nim-bg-tertiary)] w-6 h-6 rounded inline-flex items-center justify-center"
            aria-label="Close"
          >
            <MaterialSymbol icon="close" size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-2">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-[var(--nim-text-faint)] mb-1.5">
            Source file
          </div>
          <div className="flex items-center gap-2.5 px-3 py-2 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border-subtle,var(--nim-border))] rounded-md mb-4">
            <MaterialSymbol icon={descriptor.icon} size={20} className="text-[var(--nim-primary)] shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-[var(--nim-text)] truncate">{fileName}</div>
              <div className="text-[11px] text-[var(--nim-text-faint)] truncate">
                {descriptor.displayName} · {sourceRelPath}
              </div>
            </div>
          </div>

          <div className="text-[11px] uppercase tracking-wider font-semibold text-[var(--nim-text-faint)] mb-1.5">
            Shared name
          </div>
          <div className="flex items-center gap-1.5 px-2 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border-subtle,var(--nim-border))] rounded-md mb-4 focus-within:border-[var(--nim-primary)]">
            <MaterialSymbol icon="edit" size={14} className="text-[var(--nim-text-faint)]" />
            <input
              type="text"
              value={sharedBaseName}
              onChange={(e) => {
                const nextName = e.target.value;
                setSharedBaseName(
                  nextName.toLowerCase().endsWith(fileNameParts.suffix.toLowerCase())
                    ? nextName.slice(0, -fileNameParts.suffix.length)
                    : nextName,
                );
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canConfirm) {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
              className="flex-1 bg-transparent border-none text-[var(--nim-text)] text-[13px] py-2 outline-none font-inherit"
              placeholder="Document name"
            />
            <span className="text-[12px] text-[var(--nim-text-muted)] pr-1 shrink-0">
              {fileNameParts.suffix}
            </span>
          </div>

          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-[var(--nim-text-faint)]">
              Destination folder
            </div>
            <button
              type="button"
              onClick={() => beginNewFolder(selectedFolderId)}
              disabled={isRefreshingFolders || folderRefreshFailed || !hasInitializedSelection}
              className="text-[11px] text-[var(--nim-primary)] hover:underline inline-flex items-center gap-1 disabled:opacity-50 disabled:no-underline"
            >
              <MaterialSymbol icon="create_new_folder" size={13} />
              New folder
            </button>
          </div>
          <div className="share-to-team-tree bg-[var(--nim-bg-secondary)] border border-[var(--nim-border-subtle,var(--nim-border))] rounded-md p-1 mb-3 max-h-[240px] overflow-y-auto">
            {isRefreshingFolders ? (
              <div className="flex items-center justify-center gap-2 px-3 py-6 text-[12px] text-[var(--nim-text-muted)]">
                <MaterialSymbol icon="progress_activity" size={16} className="animate-spin" />
                Refreshing shared folders…
              </div>
            ) : folderRefreshFailed ? (
              <div className="px-3 py-6 text-center text-[12px] text-[var(--nim-text-muted)]">
                Shared folders could not be refreshed. Close this dialog and try again.
              </div>
            ) : (
              <>
            {/* Team root row */}
            <div
              role="treeitem"
              aria-selected={selectedFolderId === null}
              tabIndex={0}
              onClick={() => setSelectedFolderId(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedFolderId(null);
                }
              }}
              className={`relative flex items-center gap-1 px-2 py-1.5 rounded text-[13px] cursor-pointer select-none ${
                selectedFolderId === null
                  ? 'bg-[var(--nim-primary)]/20 text-[var(--nim-text)]'
                  : 'text-[var(--nim-text)] hover:bg-[var(--nim-bg-tertiary)]'
              }`}
              style={{ paddingLeft: 8 }}
            >
              {selectedFolderId === null && (
                <span aria-hidden className="absolute left-0 top-1 bottom-1 w-0.5 rounded bg-[var(--nim-primary)]" />
              )}
              <span className="w-4 h-4 inline-flex items-center justify-center text-[var(--nim-text-faint)] invisible">
                <MaterialSymbol icon="chevron_right" size={16} />
              </span>
              <span className={`inline-flex items-center justify-center ${selectedFolderId === null ? 'text-[var(--nim-primary)]' : 'text-[var(--nim-text-muted)]'}`}>
                <MaterialSymbol icon="workspaces" size={18} />
              </span>
              <span className="flex-1 truncate">Team root</span>
              {resolvedLastSharedFolderId === null && (
                <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[var(--nim-primary)]/15 text-[var(--nim-primary)]">
                  last used
                </span>
              )}
            </div>

            <SharedFolderTree
              nodes={folderTree.tree}
              selectedFolderId={selectedFolderId}
              onSelect={setSelectedFolderId}
              expandedFolders={expandedFolders}
              onToggleFolder={toggleFolder}
              highlightFolderId={resolvedLastSharedFolderId}
              newFolderParentId={newFolderParentId}
              newFolderName={newFolderName}
              onNewFolderNameChange={setNewFolderName}
              onCommitNewFolder={() => { void commitNewFolder(); }}
              onCancelNewFolder={cancelNewFolder}
            />

            {/* Inline new-folder input at root level */}
            {isRootCreateOpen && (
              <div className="flex items-center gap-2 py-1 px-2">
                <MaterialSymbol icon="create_new_folder" size={14} className="text-[var(--nim-primary)]" />
                <input
                  autoFocus
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void commitNewFolder();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelNewFolder();
                    }
                  }}
                  onBlur={() => { void commitNewFolder(); }}
                  placeholder="Folder name"
                  className="flex-1 bg-[var(--nim-bg)] border border-[var(--nim-primary)] rounded text-[13px] text-[var(--nim-text)] px-2 py-1 outline-none"
                />
              </div>
            )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2 px-3 py-2 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border-subtle,var(--nim-border))] rounded-md mb-3 text-[12px] text-[var(--nim-text-muted)]">
            <MaterialSymbol icon="place" size={14} className="text-[var(--nim-text-faint)]" />
            <span>Will be shared as</span>
            <span className="text-[var(--nim-text)] font-medium truncate" title={destinationFolderLabel}>
              {destinationFullPath}
            </span>
            <span className="text-[var(--nim-primary)] truncate" title={previewSharedName}>
              {previewSharedName}
            </span>
          </div>

          {embeddedDocuments.length > 0 && (
            <div className="share-to-team-linked-documents mb-3">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-[var(--nim-text-faint)] mb-1.5">
                Linked documents
              </div>
              <div className="max-h-[260px] overflow-y-auto rounded-md border border-[var(--nim-border-subtle,var(--nim-border))] bg-[var(--nim-bg-secondary)]">
                <div className="px-3 py-2 text-[12px] leading-snug text-[var(--nim-text-muted)] border-b border-[var(--nim-border-subtle,var(--nim-border))]">
                  Sharing this document will also share the documents it embeds so your team can see them.
                </div>
                {embeddedDocuments.map(document => {
                  const checked = selectedEmbeddedDocumentPaths.has(document.absolutePath);
                  return (
                    <label
                      key={document.absolutePath}
                      className="flex items-center gap-2.5 px-3 py-2 text-[12px] text-[var(--nim-text)] hover:bg-[var(--nim-bg-tertiary)] cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedEmbeddedDocumentPaths(previous => {
                            const next = new Set(previous);
                            if (next.has(document.absolutePath)) next.delete(document.absolutePath);
                            else next.add(document.absolutePath);
                            return next;
                          });
                        }}
                        aria-label={`Share ${document.fileName}`}
                      />
                      <MaterialSymbol
                        icon={document.descriptor.icon}
                        size={17}
                        className="text-[var(--nim-primary)] shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{document.fileName}</span>
                        <span className="block truncate text-[11px] text-[var(--nim-text-faint)]">
                          {document.descriptor.displayName}
                        </span>
                      </span>
                      {document.alreadyShared && (
                        <span className="shrink-0 rounded-full bg-[var(--nim-primary)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--nim-primary)]">
                          Already shared
                        </span>
                      )}
                    </label>
                  );
                })}
                {selectedEmbeddedCount < embeddedDocuments.length && (
                  <div className="px-3 py-2 text-[11px] leading-snug text-[var(--nim-warning)] border-t border-[var(--nim-border-subtle,var(--nim-border))]">
                    Unchecked documents stay as local links that teammates cannot open.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--nim-border)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 bg-transparent rounded-md text-[var(--nim-text-muted)] text-[13px] hover:bg-[var(--nim-bg-tertiary)] hover:text-[var(--nim-text)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={`px-3.5 py-1.5 rounded-md text-[13px] font-medium inline-flex items-center gap-1.5 ${
              canConfirm
                ? 'bg-[var(--nim-primary)] text-[#0f1115] hover:bg-[var(--nim-primary-hover)] hover:text-white cursor-pointer'
                : 'bg-[var(--nim-primary)] text-[#0f1115] opacity-50 cursor-not-allowed'
            }`}
          >
            <MaterialSymbol icon="group_add" size={16} />
            {embeddedDocuments.length > 0
              ? `Share ${shareDocumentCount} document${shareDocumentCount === 1 ? '' : 's'}`
              : 'Share to Team'}
          </button>
        </div>
      </div>
    </div>
  );
}
