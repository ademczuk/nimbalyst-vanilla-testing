/**
 * Navigation Dialog Registration
 *
 * Single tabbed dialog combining the app's quick navigation surfaces. Opened
 * with an initialTab; global shortcuts map to tabs and also jump between them
 * while the dialog is open.
 */

import React from 'react';
import { registerDialog } from '../contexts/DialogContext';
import type { DialogConfig } from '../contexts/DialogContext.types';
import { UnifiedQuickOpen, type UnifiedQuickOpenTab } from '../components/UnifiedQuickOpen';
import {
  CanvasCardPickerDialog,
  type CanvasCardPickerData,
} from '../components/EmbedFrame/CanvasCardPickerDialog';
import { DIALOG_IDS } from './registry';

export interface UnifiedQuickOpenData {
  workspacePath: string;
  initialTab?: UnifiedQuickOpenTab;
  currentFilePath?: string | null;
  onFileSelect: (filePath: string) => void;
  onFolderSelect?: (folderPath: string) => void;
  onSessionSelect: (sessionId: string) => void;
  onPromptSelect: (sessionId: string, messageTimestamp?: number) => void;
}

function UnifiedQuickOpenWrapper({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: UnifiedQuickOpenData;
}) {
  return (
    <UnifiedQuickOpen
      isOpen={isOpen}
      onClose={onClose}
      workspacePath={data.workspacePath}
      currentFilePath={data.currentFilePath}
      initialTab={data.initialTab}
      onFileSelect={(filePath) => {
        data.onFileSelect(filePath);
        onClose();
      }}
      onFolderSelect={data.onFolderSelect}
      onSessionSelect={(sessionId) => {
        data.onSessionSelect(sessionId);
        onClose();
      }}
      onPromptSelect={(sessionId, ts) => {
        data.onPromptSelect(sessionId, ts);
        onClose();
      }}
    />
  );
}

/**
 * The canvas picker resolves rather than navigates, so its `onPick` has to fire
 * on *both* exits. Closing without a choice must answer `null` and not leave
 * `pickCanvasCardReference`'s promise pending forever, which would wedge the
 * board's "Doc" button for the rest of the session.
 */
function CanvasCardPickerWrapper({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: CanvasCardPickerData;
}) {
  return (
    <CanvasCardPickerDialog
      isOpen={isOpen}
      onClose={() => {
        data.onPick(null);
        onClose();
      }}
      data={data}
    />
  );
}

export function registerNavigationDialogs() {
  registerDialog<UnifiedQuickOpenData>({
    id: DIALOG_IDS.UNIFIED_QUICK_OPEN,
    group: 'navigation',
    component: UnifiedQuickOpenWrapper as DialogConfig<UnifiedQuickOpenData>['component'],
    priority: 100,
  });
  registerDialog<CanvasCardPickerData>({
    id: DIALOG_IDS.CANVAS_CARD_PICKER,
    group: 'navigation',
    component: CanvasCardPickerWrapper as DialogConfig<CanvasCardPickerData>['component'],
    priority: 100,
  });
}
