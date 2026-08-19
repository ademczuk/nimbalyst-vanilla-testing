/**
 * Promise-based confirmation over the registered CONFIRM dialog.
 *
 * Callers used to hand-roll this `new Promise` + `dialogRef.current.open(CONFIRM, …)`
 * dance, which is easy to get subtly wrong. Import from this module rather than the
 * `dialogs` barrel — that barrel drags every dialog component into the caller's graph.
 */
import { dialogRef } from '../contexts/DialogContext';
import { DIALOG_IDS } from './registry';

export interface RequestConfirmationOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

/**
 * Show the confirmation dialog and resolve with the user's answer.
 * Resolves `false` when no DialogProvider is mounted, so a caller can never
 * proceed with a destructive action it failed to confirm.
 */
export function requestConfirmation(options: RequestConfirmationOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (!dialogRef.current) {
      resolve(false);
      return;
    }
    dialogRef.current.open(DIALOG_IDS.CONFIRM, {
      ...options,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}
