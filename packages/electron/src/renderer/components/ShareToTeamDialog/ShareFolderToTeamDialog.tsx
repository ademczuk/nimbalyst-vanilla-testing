/**
 * Promoting a whole local folder to the team.
 *
 * The single-file dialog next door asks three questions because it places one
 * specific file. This asks two -- what the shared folder is called, and where it
 * goes -- and then spends its remaining space on the answer the author cannot
 * get anywhere else: *which* files this will and will not publish. A promote
 * that silently drops the six files with no collaborative document type reads as
 * "shared" and is the failure this surface exists to prevent, so the skipped
 * list is on screen before the button is pressed, not in a summary afterwards.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import {
  MAX_FOLDER_SHARE_DOCUMENTS,
  type FolderShareSkippedFile,
} from '../../services/folderShareCandidates';
import { SharedFolderPickerPanel } from './SharedFolderPickerPanel';
import { useLastSharedFolder } from './useLastSharedFolder';
import { useSharedFolderTree } from './useSharedFolderTree';

export interface ShareFolderToTeamDialogProps {
  isOpen: boolean;
  onClose: () => void;
  folderName: string;
  /** Workspace-relative path of the folder, as the source label. */
  sourceRelPath: string;
  candidateCount: number;
  skipped: FolderShareSkippedFile[];
  subfolderCount: number;
  /** The walk hit its file cap; not everything under the folder was considered. */
  truncated: boolean;
  onConfirm: (params: {
    folderId: string | null;
    folderPath: string;
    sharedFolderName: string;
  }) => void;
}

export function ShareFolderToTeamDialog({
  isOpen,
  onClose,
  folderName,
  sourceRelPath,
  candidateCount,
  skipped,
  subfolderCount,
  truncated,
  onConfirm,
}: ShareFolderToTeamDialogProps) {
  const folderTree = useSharedFolderTree(isOpen);
  const {
    isRefreshing: isRefreshingFolders,
    refreshFailed: folderRefreshFailed,
    revealFolder,
  } = folderTree;

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [hasInitializedSelection, setHasInitializedSelection] = useState(false);
  const [sharedFolderName, setSharedFolderName] = useState(folderName);
  const [showSkipped, setShowSkipped] = useState(false);

  const folderLookups = useMemo(
    () => ({
      ids: folderTree.ids,
      pathById: folderTree.pathById,
      idByPath: folderTree.idByPath,
    }),
    [folderTree.ids, folderTree.pathById, folderTree.idByPath],
  );

  const { hasLoaded: hasLoadedState, folderId: resolvedLastSharedFolderId } =
    useLastSharedFolder(isOpen, folderLookups);

  useEffect(() => {
    if (!isOpen) return;
    setSharedFolderName(folderName);
    setShowSkipped(false);
    setHasInitializedSelection(false);
  }, [folderName, isOpen]);

  // Seed the selection once, after both the persisted preference and the
  // authoritative refresh have landed.
  useEffect(() => {
    if (
      !isOpen
      || !hasLoadedState
      || isRefreshingFolders
      || folderRefreshFailed
      || hasInitializedSelection
    ) return;
    const candidate = resolvedLastSharedFolderId ?? null;
    setSelectedFolderId(candidate);
    revealFolder(candidate);
    setHasInitializedSelection(true);
  }, [
    folderRefreshFailed,
    hasInitializedSelection,
    hasLoadedState,
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

  const isOverDocumentLimit = candidateCount > MAX_FOLDER_SHARE_DOCUMENTS;
  const canConfirm = Boolean(sharedFolderName.trim())
    && !sharedFolderName.includes('/')
    && !sharedFolderName.includes('\\')
    && candidateCount > 0
    && !isOverDocumentLimit
    && !isRefreshingFolders
    && !folderRefreshFailed
    && hasInitializedSelection;

  const handleConfirm = useCallback(() => {
    if (!canConfirm) return;
    onConfirm({
      folderId: selectedFolderId,
      folderPath: selectedFolderId ? (folderLookups.pathById.get(selectedFolderId) ?? '') : '',
      sharedFolderName: sharedFolderName.trim(),
    });
    onClose();
  }, [canConfirm, folderLookups, onClose, onConfirm, selectedFolderId, sharedFolderName]);

  if (!isOpen) return null;

  const selectedFolderPath = selectedFolderId
    ? (folderLookups.pathById.get(selectedFolderId) ?? '')
    : '';
  const destinationFullPath = selectedFolderPath
    ? `${selectedFolderPath.split('/').join(' / ')} /`
    : 'Team root /';

  return (
    <div
      className="share-folder-to-team-overlay fixed inset-0 z-[10000] flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="share-folder-to-team-dialog flex max-h-[90vh] w-[460px] max-w-[92%] flex-col overflow-hidden rounded-xl border border-[var(--nim-border)] bg-[var(--nim-bg)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Share Folder to Team"
      >
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-[var(--nim-border)]">
          <div className="w-7 h-7 rounded-md bg-[var(--nim-primary)]/15 text-[var(--nim-primary)] flex items-center justify-center shrink-0 mt-0.5">
            <MaterialSymbol icon="drive_folder_upload" size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[14px] font-semibold text-[var(--nim-text)] m-0 leading-tight">
              Share Folder to Team
            </h2>
            <p className="text-[12px] text-[var(--nim-text-faint)] m-0 mt-0.5 leading-snug">
              Publishes a copy of the shareable files in this folder. Files added later stay local.
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

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-2">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-[var(--nim-text-faint)] mb-1.5">
            Source folder
          </div>
          <div className="flex items-center gap-2.5 px-3 py-2 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border-subtle,var(--nim-border))] rounded-md mb-4">
            <MaterialSymbol icon="folder" size={20} className="text-[var(--nim-primary)] shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-[var(--nim-text)] truncate">{folderName}</div>
              <div className="text-[11px] text-[var(--nim-text-faint)] truncate">{sourceRelPath}</div>
            </div>
          </div>

          <div className="text-[11px] uppercase tracking-wider font-semibold text-[var(--nim-text-faint)] mb-1.5">
            Shared folder name
          </div>
          <div className="flex items-center gap-1.5 px-2 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border-subtle,var(--nim-border))] rounded-md mb-4 focus-within:border-[var(--nim-primary)]">
            <MaterialSymbol icon="edit" size={14} className="text-[var(--nim-text-faint)]" />
            <input
              type="text"
              value={sharedFolderName}
              onChange={(e) => setSharedFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canConfirm) {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
              className="flex-1 bg-transparent border-none text-[var(--nim-text)] text-[13px] py-2 outline-none font-inherit"
              placeholder="Folder name"
              aria-label="Shared folder name"
            />
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
            <span>Will be created as</span>
            <span className="text-[var(--nim-text)] font-medium truncate">{destinationFullPath}</span>
            <span className="text-[var(--nim-primary)] truncate">{sharedFolderName.trim() || folderName}</span>
          </div>

          <div className="share-folder-to-team-contents rounded-md border border-[var(--nim-border-subtle,var(--nim-border))] bg-[var(--nim-bg-secondary)] mb-3">
            <div className="px-3 py-2 text-[12px] leading-snug text-[var(--nim-text)] border-b border-[var(--nim-border-subtle,var(--nim-border))]">
              <span className="font-medium">
                {candidateCount} document{candidateCount === 1 ? '' : 's'}
              </span>
              {subfolderCount > 0 && (
                <span className="text-[var(--nim-text-muted)]">
                  {' '}across {subfolderCount} subfolder{subfolderCount === 1 ? '' : 's'}
                </span>
              )}
              <span className="text-[var(--nim-text-muted)]">
                {isOverDocumentLimit ? ' were found.' : ' will be shared.'}
              </span>
            </div>
            {isOverDocumentLimit && (
              <div className="share-folder-to-team-over-limit px-3 py-2 text-[12px] leading-snug text-[var(--nim-warning)] border-b border-[var(--nim-border-subtle,var(--nim-border))]">
                That is more than the {MAX_FOLDER_SHARE_DOCUMENTS} one promote can publish.
                Share this folder&apos;s subfolders separately so nothing lands in the team
                space half-finished.
              </div>
            )}
            {skipped.length > 0 && (
              <div className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => setShowSkipped(value => !value)}
                  className="inline-flex items-center gap-1 text-[12px] text-[var(--nim-warning)] hover:underline"
                >
                  <MaterialSymbol icon={showSkipped ? 'expand_less' : 'expand_more'} size={15} />
                  {skipped.length} file{skipped.length === 1 ? '' : 's'} will not be shared
                </button>
                {showSkipped && (
                  <ul className="mt-1.5 max-h-[160px] overflow-y-auto list-none p-0 m-0">
                    {skipped.map(file => (
                      <li
                        key={file.relativePath}
                        className="text-[11px] text-[var(--nim-text-faint)] py-0.5 truncate"
                        title={file.reason}
                      >
                        {file.relativePath}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-1 text-[11px] leading-snug text-[var(--nim-text-faint)]">
                  These have no collaborative document type and stay on your machine.
                </div>
              </div>
            )}
            {truncated && (
              <div className="px-3 py-2 text-[11px] leading-snug text-[var(--nim-warning)] border-t border-[var(--nim-border-subtle,var(--nim-border))]">
                This folder holds more files than one promote can scan, so some were not considered.
                Share its subfolders separately to cover the rest.
              </div>
            )}
          </div>
        </div>

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
            {isOverDocumentLimit
              ? 'Too many documents'
              : `Share ${candidateCount} document${candidateCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
