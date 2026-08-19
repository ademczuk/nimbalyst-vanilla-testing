/**
 * CommonFileActions - Shared menu items for file operations.
 *
 * Renders the common file action items (Open in Default App, Open in External Editor,
 * Show in system file browser, Copy Path, Share Link, Share to Team) used across multiple context menus:
 * - FileContextMenu (file tree right-click)
 * - TabBar context menu (tab right-click)
 * - UnifiedEditorHeaderBar (header actions dropdown)
 *
 * Each consumer provides CSS classes to match their own styling.
 */

import React, { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  getShowInFileBrowserLabel,
  MaterialSymbol,
} from '@nimbalyst/runtime';
import { useAtomValue } from 'jotai';
import { useFileActions } from '../hooks/useFileActions';
import { workspaceHasTeamAtom } from '../store/atoms/collabDocuments';
import { isCollabUri } from '@nimbalyst/collab-protocol';
import { getCollaborativeDocumentTypeCatalog } from '../services/CollaborativeDocumentTypeCatalog';
import { askShareToTeam, shareFileToTeam } from '../services/shareToTeamFlow';

interface CommonFileActionsProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
  /** CSS class for each menu item row */
  menuItemClass: string;
  /** CSS class for separator divs */
  separatorClass: string;
  /** Icon size in px (default 18) */
  iconSize?: number;
  /** Whether to show icons (default true) */
  showIcons?: boolean;
  /** Render items as <button> elements instead of <div> (default false) */
  useButtons?: boolean;
}

export function CommonFileActions({
  filePath,
  fileName,
  onClose,
  menuItemClass,
  separatorClass,
  iconSize = 18,
  showIcons = true,
  useButtons = false,
}: CommonFileActionsProps) {
  const actions = useFileActions(filePath, fileName);
  const hasTeam = useAtomValue(workspaceHasTeamAtom);
  const documentTypeCatalog = getCollaborativeDocumentTypeCatalog();
  const catalogRevision = useSyncExternalStore(
    documentTypeCatalog.subscribe,
    documentTypeCatalog.getSnapshot,
    documentTypeCatalog.getSnapshot,
  );
  const shareability = useMemo(
    () => documentTypeCatalog.resolveShareability(fileName),
    [catalogRevision, documentTypeCatalog, fileName],
  );
  /**
   * Ask, then share. Both halves live in `shareToTeamFlow` so the feedback-request
   * compose path drives the same dialog and the same publish rather than a
   * parallel one.
   */
  const openShareToTeamDialog = useCallback(async () => {
    if (shareability.state !== 'ready') return;
    const ask = await askShareToTeam({ filePath, fileName });
    if (ask.status !== 'answered') return;
    await shareFileToTeam({ filePath, fileName, answers: ask.answers });
  }, [filePath, fileName, shareability]);

  const Item = useButtons ? 'button' : 'div';

  return (
    <>
      {/* Open in Default App */}
      <Item
        className={menuItemClass}
        onClick={() => { actions.openInDefaultApp(); onClose(); }}
      >
        {showIcons && <MaterialSymbol icon="launch" size={iconSize} />}
        <span>Open in Default App</span>
      </Item>

      {/* Open in External Editor (conditional) */}
      {actions.hasExternalEditor && (
        <Item
          className={menuItemClass}
          onClick={() => { actions.openInExternalEditor(); onClose(); }}
        >
          {showIcons && <MaterialSymbol icon="open_in_new" size={iconSize} />}
          <span>Open in {actions.externalEditorName}</span>
        </Item>
      )}

      {/* Show in system file browser */}
      <Item
        className={menuItemClass}
        onClick={() => { actions.revealInFinder(); onClose(); }}
      >
        {showIcons && <MaterialSymbol icon="folder_open" size={iconSize} />}
        <span>{getShowInFileBrowserLabel()}</span>
      </Item>

      {/* Copy Path */}
      {!isCollabUri(filePath) && (
        <Item
          className={menuItemClass}
          onClick={() => { actions.copyFilePath(); onClose(); }}
        >
          {showIcons && <MaterialSymbol icon="content_copy" size={iconSize} />}
          <span>Copy Path</span>
        </Item>
      )}

      {/* Share Link (conditional on file type) */}
      {actions.isShareable && (
        <Item
          className={menuItemClass}
          onClick={() => { actions.shareLink(); onClose(); }}
        >
          {showIcons && <MaterialSymbol icon="share" size={iconSize} />}
          <span>Share Link</span>
        </Item>
      )}

      {/* Team workspaces always explain catalog eligibility. Unsupported
          types stay visible but cannot open the promotion dialog. */}
      {hasTeam && !isCollabUri(filePath) && (
        <Item
          className={`${menuItemClass} ${shareability.state === 'ready' ? '' : 'opacity-55 cursor-not-allowed'}`}
          aria-disabled={shareability.state !== 'ready'}
          title={shareability.state === 'unsupported' ? shareability.reason : undefined}
          onClick={() => {
            if (shareability.state !== 'ready') return;
            void openShareToTeamDialog();
            onClose();
          }}
        >
          {showIcons && <MaterialSymbol icon="group" size={iconSize} />}
          <span className="min-w-0 flex-1">
            <span className="block">Share to Team</span>
            {shareability.state === 'unsupported' && (
              <span className="block text-[11px] leading-snug text-nim-disabled mt-0.5">
                {shareability.reason}
              </span>
            )}
          </span>
        </Item>
      )}
    </>
  );
}
