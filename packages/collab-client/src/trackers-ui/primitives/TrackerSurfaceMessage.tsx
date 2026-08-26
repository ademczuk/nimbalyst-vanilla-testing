/**
 * The centered "nothing to show" block every tracker surface renders.
 *
 * Four surfaces had drifted copies of the same eight lines -- board, tag board,
 * grid, inbox -- differing only in icon and wording, and one of them had already
 * lost the muted-hint line the others kept. One component, so a surface added
 * later cannot start a fifth copy.
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';

export interface TrackerSurfaceMessageProps {
  icon: string;
  message: string;
  /** Second line, quieter: what the reader could do about it. */
  hint?: string;
  /** Action row under the hint, e.g. a create button. */
  children?: React.ReactNode;
  testId?: string;
}

export function TrackerSurfaceMessage({
  icon,
  message,
  hint,
  children,
  testId,
}: TrackerSurfaceMessageProps) {
  return (
    <div
      className="tracker-surface-message flex-1 flex items-center justify-center text-nim-muted"
      data-testid={testId}
    >
      <div className="text-center">
        <MaterialSymbol icon={icon} size={48} className="opacity-30" />
        <p className="mt-2 text-sm">{message}</p>
        {hint ? <p className="mt-1 text-xs text-nim-faint">{hint}</p> : null}
        {children ? <div className="mt-3 flex items-center justify-center gap-2">{children}</div> : null}
      </div>
    </div>
  );
}
