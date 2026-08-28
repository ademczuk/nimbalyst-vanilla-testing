/**
 * Where a feedback request's subjects get published.
 *
 * A folder and nothing else. The share-to-team dialog next door asks three
 * questions -- name, folder, which embedded documents come along -- because it
 * is placing one specific file. This is placing a *set* of them, so the other
 * two questions have no single answer and are not asked.
 *
 * The one behavioural difference from that dialog, and the reason this is a
 * separate surface rather than a mode flag on it: **a new folder here is not
 * created here.** It is reported back as `pendingFolder` and created by the
 * send path, immediately before the first document that needs it. The author
 * has not committed to sending yet; a folder created now and then abandoned
 * would leave the team an empty folder nobody asked for. The share dialog
 * creates eagerly and can do exactly that, which is the behaviour this avoids
 * rather than copies.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { FeedbackComposeDestination } from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets/InteractiveWidgetHost';
import { normalizeCollabPath } from '../CollabMode/collabTree';
import { SharedFolderTree } from './SharedFolderTree';
import { useSharedFolderTree } from './useSharedFolderTree';

export interface FeedbackDestinationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The request's current destination, or null when it has none yet. */
  initialFolderId: string | null;
  /** How many subjects are being placed, so the author knows the stakes. */
  subjectCount: number;
  onConfirm(destination: FeedbackComposeDestination): void;
}

export const FeedbackDestinationDialog: React.FC<FeedbackDestinationDialogProps> = ({
  isOpen,
  onClose,
  initialFolderId,
  subjectCount,
  onConfirm,
}) => {
  const folderTree = useSharedFolderTree(isOpen);
  const {
    tree,
    ids,
    pathById,
    idByPath,
    isRefreshing,
    refreshFailed,
    expandedFolders,
    toggleFolder,
    revealFolder,
    expandFolder,
  } = folderTree;

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(initialFolderId);
  const [hasSeeded, setHasSeeded] = useState(false);
  const [newFolderParentId, setNewFolderParentId] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState('');
  const [pendingFolder, setPendingFolder] = useState<
    { name: string; parentFolderId: string | null } | null
  >(null);

  useEffect(() => {
    if (!isOpen) {
      setHasSeeded(false);
      setPendingFolder(null);
      setNewFolderParentId(undefined);
      setNewFolderName('');
    }
  }, [isOpen]);

  // Seed once the refresh has landed, so a folder that no longer exists is not
  // shown as selected -- the same rule the share dialog follows.
  useEffect(() => {
    if (!isOpen || isRefreshing || refreshFailed || hasSeeded) return;
    const candidate = initialFolderId && ids.has(initialFolderId) ? initialFolderId : null;
    setSelectedFolderId(candidate);
    revealFolder(candidate);
    setHasSeeded(true);
  }, [hasSeeded, ids, initialFolderId, isOpen, isRefreshing, refreshFailed, revealFolder]);

  const beginNewFolder = useCallback(
    (parentFolderId: string | null) => {
      setNewFolderParentId(parentFolderId);
      setNewFolderName('');
      if (parentFolderId) expandFolder(parentFolderId);
    },
    [expandFolder],
  );

  const cancelNewFolder = useCallback(() => {
    setNewFolderParentId(undefined);
    setNewFolderName('');
  }, []);

  /**
   * Records the name rather than creating the folder. A name that already
   * matches a real folder selects that folder instead, so the author does not
   * end up with two folders of the same name in the same parent.
   */
  const commitNewFolder = useCallback(() => {
    const trimmed = newFolderName.trim();
    const parentFolderId = newFolderParentId ?? null;
    setNewFolderParentId(undefined);
    setNewFolderName('');
    if (!trimmed || trimmed.includes('/') || trimmed.includes('\\')) return;

    const parentPath = parentFolderId ? (pathById.get(parentFolderId) ?? '') : '';
    const fullPath = normalizeCollabPath(parentPath ? `${parentPath}/${trimmed}` : trimmed);
    const existingFolderId = idByPath.get(fullPath);
    if (existingFolderId) {
      setPendingFolder(null);
      setSelectedFolderId(existingFolderId);
      return;
    }
    setPendingFolder({ name: trimmed, parentFolderId });
    setSelectedFolderId(parentFolderId);
  }, [idByPath, newFolderName, newFolderParentId, pathById]);

  const selectFolder = useCallback((folderId: string | null) => {
    // Choosing a real folder abandons the one the author was inventing.
    setPendingFolder(null);
    setSelectedFolderId(folderId);
  }, []);

  const handleConfirm = useCallback(() => {
    const path = selectedFolderId ? (pathById.get(selectedFolderId) ?? '') : '';
    onConfirm({
      folderId: selectedFolderId,
      path,
      ...(pendingFolder ? { pendingFolder } : {}),
    });
    onClose();
  }, [onClose, onConfirm, pathById, pendingFolder, selectedFolderId]);

  if (!isOpen) return null;

  const selectedPath = selectedFolderId ? (pathById.get(selectedFolderId) ?? '') : '';
  const destinationLabel = pendingFolder
    ? `${selectedPath ? `${selectedPath.split('/').join(' / ')} / ` : ''}${pendingFolder.name}`
    : selectedPath
      ? selectedPath.split('/').join(' / ')
      : 'Team root';

  return (
    <div
      className="feedback-destination-overlay fixed inset-0 z-[10000] flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="feedback-destination-dialog flex max-h-[90vh] w-[440px] max-w-[92%] flex-col overflow-hidden rounded-xl border border-[var(--nim-border)] bg-[var(--nim-bg)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Choose a destination"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--nim-border)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="m-0 text-[15px] font-semibold text-[var(--nim-text)]">
              Where should these go?
            </h2>
            <p className="m-0 mt-0.5 text-[12px] text-[var(--nim-text-muted)]">
              {subjectCount === 1
                ? '1 subject will be published here when you send.'
                : `${subjectCount} subjects will be published here when you send.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-[var(--nim-text-faint)] hover:text-[var(--nim-text)] bg-transparent border-none cursor-pointer p-0"
          >
            <MaterialSymbol icon="close" size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2" role="tree" aria-label="Team folders">
          {refreshFailed ? (
            <div className="px-3 py-6 text-center text-[13px] text-[var(--nim-text-muted)]">
              Your team folders could not be loaded, so there is nowhere to choose from yet.
            </div>
          ) : isRefreshing ? (
            <div className="px-3 py-6 text-center text-[13px] text-[var(--nim-text-muted)]">
              Loading team folders…
            </div>
          ) : (
            <>
              <div
                role="treeitem"
                aria-selected={selectedFolderId === null && !pendingFolder}
                tabIndex={0}
                onClick={() => selectFolder(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectFolder(null);
                  }
                }}
                className={`relative flex items-center gap-1 px-2 py-1.5 rounded text-[13px] cursor-pointer select-none ${
                  selectedFolderId === null && !pendingFolder
                    ? 'bg-[var(--nim-primary)]/20 text-[var(--nim-text)]'
                    : 'text-[var(--nim-text)] hover:bg-[var(--nim-bg-tertiary)]'
                }`}
                style={{ paddingLeft: 8 }}
              >
                <span className="w-4 h-4 inline-flex items-center justify-center invisible">
                  <MaterialSymbol icon="chevron_right" size={16} />
                </span>
                <span className="inline-flex items-center justify-center text-[var(--nim-text-muted)]">
                  <MaterialSymbol icon="workspaces" size={18} />
                </span>
                <span className="flex-1 truncate">Team root</span>
              </div>

              <SharedFolderTree
                nodes={tree}
                selectedFolderId={pendingFolder ? null : selectedFolderId}
                onSelect={selectFolder}
                expandedFolders={expandedFolders}
                onToggleFolder={toggleFolder}
                newFolderParentId={newFolderParentId}
                newFolderName={newFolderName}
                onNewFolderNameChange={setNewFolderName}
                onCommitNewFolder={commitNewFolder}
                onCancelNewFolder={cancelNewFolder}
              />

              {newFolderParentId === null && (
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
                        commitNewFolder();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelNewFolder();
                      }
                    }}
                    onBlur={commitNewFolder}
                    placeholder="Folder name"
                    className="flex-1 bg-[var(--nim-bg)] border border-[var(--nim-primary)] rounded text-[13px] text-[var(--nim-text)] px-2 py-1 outline-none"
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--nim-border)] px-4 py-3">
          <button
            type="button"
            data-testid="feedback-destination-new-folder"
            onClick={() => beginNewFolder(selectedFolderId)}
            disabled={isRefreshing || refreshFailed}
            className="inline-flex items-center gap-1.5 text-[13px] text-[var(--nim-primary)] bg-transparent border-none p-0 cursor-pointer hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <MaterialSymbol icon="create_new_folder" size={16} />
            New folder
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-[13px] text-[var(--nim-text)] bg-transparent border border-[var(--nim-border)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="feedback-destination-confirm"
              onClick={handleConfirm}
              disabled={isRefreshing || refreshFailed}
              className="px-3 py-1.5 rounded-md text-[13px] font-medium text-[var(--nim-on-primary)] bg-[var(--nim-primary)] border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Use {destinationLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
