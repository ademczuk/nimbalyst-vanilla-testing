/**
 * "Put an existing document on the board" -- the desktop side of the canvas's
 * `pickCardReference` slot.
 *
 * Deliberately not `UnifiedQuickOpen`. That component is 3,000 lines of tabbed
 * navigation whose selection handlers *open* things: they switch modes, focus
 * tabs, and write recents. A picker has to resolve a value and change nothing
 * else, so reusing it would mean threading a "don't actually navigate" flag
 * through every one of those paths. What is worth reusing is the data
 * underneath, and that is what this does -- the same ripgrep-backed workspace
 * file cache the @ mention picker searches, and the same shared-document index
 * the docs tree reads.
 *
 * Two sources, one list:
 *
 * - **Shared documents** -- only when this workspace is bound to an org, and
 *   listed first because a `doc` card is the one that also renders in the
 *   browser console.
 * - **Files** -- workspace-relative paths, resolved by the card host through the
 *   file watcher. Always available; a `.canvas` file with no team is still a
 *   board full of live local documents.
 *
 * Nothing here creates anything. The dialog resolves a `CanvasCardPick`, so a
 * cancelled picker leaves no trace on disk and none in a room.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

import type { CanvasCardPick } from '@nimbalyst/runtime/canvas';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';

import {
  documentsLoadingAtom,
  fileMentionOptionsAtom,
  searchFileMentionAtom,
} from '../../store/atoms/fileMention';
import {
  activeTeamOrgIdAtom,
  sharedDocumentsAtom,
} from '../../store/atoms/collabDocuments';

export interface CanvasCardPickerData {
  workspacePath: string;
  onPick: (pick: CanvasCardPick | null) => void;
}

interface PickerRow {
  key: string;
  label: string;
  detail: string;
  icon: string;
  pick: CanvasCardPick;
}

/** How many rows each source contributes before the list is cut. */
const MAX_ROWS_PER_SOURCE = 40;

export function CanvasCardPickerDialog({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: CanvasCardPickerData;
}): React.ReactElement | null {
  const { workspacePath, onPick } = data;

  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useSetAtom(searchFileMentionAtom);
  const fileOptions = useAtomValue(fileMentionOptionsAtom(workspacePath));
  const searching = useAtomValue(documentsLoadingAtom(workspacePath));
  const orgId = useAtomValue(activeTeamOrgIdAtom);
  const sharedDocuments = useAtomValue(sharedDocumentsAtom);

  useEffect(() => {
    if (!isOpen) return;
    void search({ workspacePath, query });
  }, [isOpen, query, search, workspacePath]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const rows = useMemo<PickerRow[]>(() => {
    const files: PickerRow[] = fileOptions
      // Directories come back from the same search and cannot be embedded.
      .filter(
        (option) => (option.data as { type?: string } | undefined)?.type !== 'directory'
      )
      .slice(0, MAX_ROWS_PER_SOURCE)
      .map((option) => {
        const path = String(
          (option.data as { path?: string } | undefined)?.path ?? option.id
        );
        return {
          key: `file:${path}`,
          label: option.label,
          detail: path,
          icon: 'draft',
          pick: {
            reference: { kind: 'file' as const, path },
            label: option.label,
          },
        };
      });

    if (!orgId) return files;

    // The shared index is already in memory and is small, so it is filtered
    // here rather than round-tripping a search the file list needs but this
    // does not.
    const needle = query.trim().toLowerCase();
    const docs: PickerRow[] = sharedDocuments
      .filter(
        (document) =>
          !document.trashedAt &&
          (needle === '' || document.title.toLowerCase().includes(needle))
      )
      .slice(0, MAX_ROWS_PER_SOURCE)
      .map((document) => {
        const label = document.title || 'Untitled';
        return {
          key: `doc:${document.documentId}`,
          label,
          detail: 'Shared document',
          icon: 'group',
          pick: {
            reference: {
              kind: 'doc' as const,
              uri: `nimbalyst://doc/${encodeURIComponent(
                orgId
              )}/${encodeURIComponent(document.documentId)}` as const,
            },
            label,
          },
        };
      });

    return [...docs, ...files];
  }, [fileOptions, orgId, query, sharedDocuments]);

  // A shrinking result list must not leave the highlight past its end, or Enter
  // resolves nothing and the dialog reads as broken rather than as empty.
  const selectedIndex = Math.min(highlighted, Math.max(rows.length - 1, 0));

  const choose = useCallback(
    (row: PickerRow | undefined) => {
      if (!row) return;
      onPick(row.pick);
      onClose();
    },
    [onClose, onPick]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlighted((index) => Math.min(index + 1, rows.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlighted((index) => Math.max(index - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        choose(rows[selectedIndex]);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    },
    [choose, onClose, rows, selectedIndex]
  );

  if (!isOpen) return null;

  return (
    <>
      <div
        className="canvas-card-picker-backdrop fixed inset-0 z-[99998] nim-animate-fade-in bg-black/50"
        onClick={onClose}
      />
      <div
        className="canvas-card-picker fixed top-[15%] left-1/2 -translate-x-1/2 w-[92%] max-w-[640px] max-h-[60vh] flex flex-col overflow-hidden rounded-lg z-[99999] bg-nim border border-nim shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onKeyDown={onKeyDown}
      >
        <div className="canvas-card-picker__search flex items-center gap-2 px-3 py-2.5 border-b border-nim">
          <MaterialSymbol icon="search" size={18} className="text-nim-faint" />
          <input
            ref={inputRef}
            className="canvas-card-picker__input flex-1 bg-transparent outline-none text-nim placeholder:text-nim-faint"
            type="text"
            value={query}
            placeholder="Search files and shared documents"
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlighted(0);
            }}
          />
        </div>

        <ul
          className="canvas-card-picker__results flex-1 overflow-y-auto py-1"
          role="listbox"
        >
          {rows.map((row, index) => (
            <li key={row.key}>
              <button
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                className={`canvas-card-picker__row w-full flex items-center gap-2 px-3 py-1.5 text-left ${
                  index === selectedIndex
                    ? 'canvas-card-picker__row--active bg-[var(--nim-accent-subtle)]'
                    : ''
                }`}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => choose(row)}
              >
                <MaterialSymbol
                  icon={row.icon}
                  size={18}
                  className="shrink-0 text-nim-muted"
                />
                <span className="canvas-card-picker__label text-nim overflow-hidden text-ellipsis whitespace-nowrap">
                  {row.label}
                </span>
                <span className="canvas-card-picker__detail ml-auto text-xs text-nim-faint overflow-hidden text-ellipsis whitespace-nowrap">
                  {row.detail}
                </span>
              </button>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="canvas-card-picker__empty px-3 py-8 text-center text-nim-faint">
              {searching ? 'Searching…' : 'Nothing matches that.'}
            </li>
          )}
        </ul>
      </div>
    </>
  );
}
