/**
 * The folder rows themselves, shared by the two surfaces that pick a team-files
 * destination.
 *
 * Fully controlled: it owns no selection, no expansion, and no idea what
 * creating a folder means. That is what lets the share dialog create eagerly
 * and the feedback picker defer creation to its publish pass while both render
 * identical rows. A component that owned the create call could not do both.
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { ShareFolderNode } from './shareFolderTree';

export interface SharedFolderTreeProps {
  nodes: ShareFolderNode[];
  selectedFolderId: string | null;
  onSelect(folderId: string): void;
  expandedFolders: Set<string>;
  onToggleFolder(folderId: string): void;
  /** Gets a small chip, e.g. the folder the author shared into last time. */
  highlightFolderId?: string | null;
  highlightLabel?: string;
  /** The folder whose inline "new folder" input is open, if any. */
  newFolderParentId?: string | null;
  newFolderName?: string;
  onNewFolderNameChange?(name: string): void;
  onCommitNewFolder?(): void;
  onCancelNewFolder?(): void;
}

export const SharedFolderTree: React.FC<SharedFolderTreeProps> = ({
  nodes,
  selectedFolderId,
  onSelect,
  expandedFolders,
  onToggleFolder,
  highlightFolderId,
  highlightLabel = 'last used',
  newFolderParentId,
  newFolderName = '',
  onNewFolderNameChange,
  onCommitNewFolder,
  onCancelNewFolder,
}) => {
  const renderRow = (node: ShareFolderNode): React.ReactNode => {
    const isExpanded = expandedFolders.has(node.folderId);
    const isSelected = selectedFolderId === node.folderId;
    const isHighlighted = highlightFolderId === node.folderId;
    const hasChildren = node.children.length > 0;
    const showInlineNewFolder = newFolderParentId === node.folderId;
    const depthPx = 8 + node.depth * 18;

    return (
      <React.Fragment key={node.folderId}>
        <div
          role="treeitem"
          aria-selected={isSelected}
          tabIndex={0}
          onClick={() => onSelect(node.folderId)}
          onDoubleClick={() => onToggleFolder(node.folderId)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(node.folderId);
            }
          }}
          className={`shared-folder-tree-row relative flex items-center gap-1 px-2 py-1.5 rounded text-[13px] cursor-pointer select-none ${
            isSelected
              ? 'bg-[var(--nim-primary)]/20 text-[var(--nim-text)]'
              : 'text-[var(--nim-text)] hover:bg-[var(--nim-bg-tertiary)]'
          }`}
          style={{ paddingLeft: depthPx }}
        >
          {isSelected && (
            <span
              aria-hidden
              className="absolute left-0 top-1 bottom-1 w-0.5 rounded bg-[var(--nim-primary)]"
            />
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) onToggleFolder(node.folderId);
            }}
            className={`w-4 h-4 inline-flex items-center justify-center text-[var(--nim-text-faint)] ${
              hasChildren ? 'cursor-pointer' : 'cursor-default invisible'
            }`}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            <MaterialSymbol icon={isExpanded ? 'expand_more' : 'chevron_right'} size={16} />
          </button>
          <span
            className={`inline-flex items-center justify-center ${
              isSelected ? 'text-[var(--nim-primary)]' : 'text-[var(--nim-text-muted)]'
            }`}
          >
            <MaterialSymbol icon={isExpanded ? 'folder_open' : 'folder'} size={18} />
          </span>
          <span className="flex-1 truncate">{node.name}</span>
          {isHighlighted && (
            <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[var(--nim-primary)]/15 text-[var(--nim-primary)]">
              {highlightLabel}
            </span>
          )}
        </div>
        {showInlineNewFolder && (
          <div className="flex items-center gap-2 py-1" style={{ paddingLeft: depthPx + 18 }}>
            <MaterialSymbol icon="create_new_folder" size={14} className="text-[var(--nim-primary)]" />
            <input
              autoFocus
              type="text"
              value={newFolderName}
              onChange={(e) => onNewFolderNameChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onCommitNewFolder?.();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onCancelNewFolder?.();
                }
              }}
              onBlur={() => onCommitNewFolder?.()}
              placeholder="Folder name"
              className="flex-1 bg-[var(--nim-bg)] border border-[var(--nim-primary)] rounded text-[13px] text-[var(--nim-text)] px-2 py-1 outline-none"
            />
          </div>
        )}
        {isExpanded && node.children.map((child) => renderRow(child))}
      </React.Fragment>
    );
  };

  return <>{nodes.map((node) => renderRow(node))}</>;
};
