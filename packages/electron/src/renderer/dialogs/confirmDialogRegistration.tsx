/**
 * Confirmation dialog registration.
 *
 * Kept out of `dataDialogs.tsx` so a caller (or a test) can pull in the
 * confirmation dialog without dragging the heavier data dialogs — and the
 * editor/session trees behind them — into its module graph.
 */

import React from 'react';
import { registerDialog } from '../contexts/DialogContext';
import type { DialogConfig } from '../contexts/DialogContext.types';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import { DIALOG_IDS } from './registry';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialogWrapper({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: ConfirmDialogData;
}) {
  return (
    <ConfirmDialog
      isOpen={isOpen}
      title={data.title}
      message={data.message}
      confirmLabel={data.confirmLabel}
      cancelLabel={data.cancelLabel}
      destructive={data.destructive}
      // ConfirmDialog is stateless: without closing here the overlay stays up
      // after the user answers it, and the answer looks like it did nothing.
      onConfirm={() => {
        data.onConfirm();
        onClose();
      }}
      onCancel={() => {
        data.onCancel();
        onClose();
      }}
    />
  );
}

export function registerConfirmDialog() {
  registerDialog<ConfirmDialogData>({
    id: DIALOG_IDS.CONFIRM,
    group: 'alert',
    component: ConfirmDialogWrapper as DialogConfig<ConfirmDialogData>['component'],
    priority: 350, // Confirmations are high priority but below errors
  });
}
