/**
 * Hover-expanding submenu for the board's card context menu.
 *
 * Positioned by floating-ui and rendered through FloatingPortal so it escapes the
 * board's scrolling, clipped columns.
 */

import React, { useRef, useState } from 'react';
import { useFloating, offset, flip, shift, FloatingPortal } from '@floating-ui/react';
import { windowControlsClearance } from '@nimbalyst/runtime/ui/floating/windowControlsClearance';
import { MaterialSymbol } from '@nimbalyst/runtime';

export const KanbanContextSubmenu: React.FC<{
  label: string;
  icon: string;
  children: React.ReactNode;
}> = ({ label, icon, children }) => {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { refs, floatingStyles } = useFloating({
    placement: 'right-start',
    middleware: [offset(2), flip({ padding: 8 }), shift({ padding: 8 }), windowControlsClearance()],
  });

  return (
    <div
      className="kanban-context-submenu"
      ref={refs.setReference as React.RefCallback<HTMLDivElement>}
      onMouseEnter={() => { if (timeoutRef.current) clearTimeout(timeoutRef.current); setOpen(true); }}
      onMouseLeave={() => { timeoutRef.current = setTimeout(() => setOpen(false), 150); }}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 text-nim hover:bg-nim-tertiary cursor-pointer">
        <MaterialSymbol icon={icon} size={16} />
        <span className="flex-1">{label}</span>
        <MaterialSymbol icon="chevron_right" size={14} className="text-nim-faint" />
      </div>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className="min-w-[140px] bg-nim-secondary border border-nim rounded-md shadow-lg py-1 z-[60]"
            style={floatingStyles}
            onMouseEnter={() => { if (timeoutRef.current) clearTimeout(timeoutRef.current); setOpen(true); }}
            onMouseLeave={() => { timeoutRef.current = setTimeout(() => setOpen(false), 150); }}
          >
            {children}
          </div>
        </FloatingPortal>
      )}
    </div>
  );
};
