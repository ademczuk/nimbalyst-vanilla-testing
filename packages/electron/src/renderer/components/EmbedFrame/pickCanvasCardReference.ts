/**
 * Promise-based "which document goes on the board?" over the registered canvas
 * picker dialog, in the shape of `requestConfirmation`.
 *
 * Imported from this module rather than the `dialogs` barrel, which drags every
 * dialog component into the caller's graph.
 *
 * Every exit resolves exactly once, including the ones that are not a choice --
 * no DialogProvider mounted, no open workspace, or the user dismissing the
 * dialog. A pending promise here does not merely lose a card: the board awaits
 * it before placing anything, so a dropped resolution wedges the "Doc" button
 * for the rest of the session with no error anywhere to explain it.
 */
import type { CanvasCardPick } from '@nimbalyst/runtime/canvas';
import { store } from '@nimbalyst/runtime/store';

import { dialogRef } from '../../contexts/DialogContext';
import { DIALOG_IDS } from '../../dialogs/registry';
import { activeWorkspacePathAtom } from '../../store/atoms/openProjects';

export function pickCanvasCardReference(): Promise<CanvasCardPick | null> {
  return new Promise<CanvasCardPick | null>((resolve) => {
    const workspacePath = store.get(activeWorkspacePathAtom);
    if (!dialogRef.current || !workspacePath) {
      resolve(null);
      return;
    }

    // The dialog answers on selection *and* on dismissal, and the two can both
    // fire for one interaction. First answer wins.
    let settled = false;
    const settle = (pick: CanvasCardPick | null) => {
      if (settled) return;
      settled = true;
      resolve(pick);
    };

    dialogRef.current.open(DIALOG_IDS.CANVAS_CARD_PICKER, {
      workspacePath,
      onPick: settle,
    });
  });
}
