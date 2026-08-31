import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { CollaborativeDocumentTypeDescriptor } from '../../services/CollaborativeDocumentTypeCatalog';
import type { EmbeddedDocumentCandidate } from '../../services/embeddedDocumentShare';
import { SharedFolderPickerPanel } from './SharedFolderPickerPanel';
import { useLastSharedFolder } from './useLastSharedFolder';
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
  const folderTree = useSharedFolderTree(isOpen);
  const {
    isRefreshing: isRefreshingFolders,
    refreshFailed: folderRefreshFailed,
    revealFolder,
  } = folderTree;

  const [hasInitializedSelection, setHasInitializedSelection] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const fileNameParts = useMemo(
    () => splitShareFileName(fileName, descriptor),
    [descriptor, fileName],
  );
  const [sharedBaseName, setSharedBaseName] = useState<string>(fileNameParts.baseName);
  const [selectedEmbeddedDocumentPaths, setSelectedEmbeddedDocumentPaths] = useState<Set<string>>(
    () => new Set(embeddedDocuments.map(document => document.absolutePath)),
  );

  // Reset transient state every time the dialog opens for a different file.
  useEffect(() => {
    if (!isOpen) return;
    setSharedBaseName(fileNameParts.baseName);
    setHasInitializedSelection(false);
    setSelectedEmbeddedDocumentPaths(
      new Set(embeddedDocuments.map(document => document.absolutePath)),
    );
  }, [embeddedDocuments, fileNameParts.baseName, isOpen]);

  const folderLookups = useMemo(
    () => ({
      ids: folderTree.ids,
      pathById: folderTree.pathById,
      idByPath: folderTree.idByPath,
    }),
    [folderTree.ids, folderTree.pathById, folderTree.idByPath],
  );

  // Folder rows themselves come only from TeamRoom, never workspace/PGLite state.
  const { hasLoaded: hasLoadedState, folderId: resolvedLastSharedFolderId } =
    useLastSharedFolder(isOpen, folderLookups);

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

          <SharedFolderPickerPanel
            folderTree={folderTree}
            selectedFolderId={selectedFolderId}
            onSelectFolder={setSelectedFolderId}
            highlightFolderId={resolvedLastSharedFolderId}
            canCreateFolder={hasInitializedSelection}
          />

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
