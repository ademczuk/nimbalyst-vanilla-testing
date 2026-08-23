/**
 * Hover-expanding submenu for the board's card context menu.
 *
 * Positioned by floating-ui and rendered through FloatingPortal so it escapes the
 * board's scrolling, clipped columns.
 *
 * Sizing is inline style rather than Tailwind arbitrary values (`min-w-[140px]`)
 * on purpose: the scrollable-menu config resolves computed style on this panel,
 * and jsdom's selector engine throws on a `:has()` rule matched against a class
 * list containing brackets. See the note in TrackerRowContextMenu.
 */

import React, { useRef, useState } from 'react';
import { FloatingPortal } from '@floating-ui/react';
import { useScrollableMenuFloating } from '@nimbalyst/runtime/ui/floating/useScrollableMenuFloating';
import { MaterialSymbol } from '@nimbalyst/runtime';

export const KanbanContextSubmenu: React.FC<{
  label: string;
  icon: string;
  children: React.ReactNode;
}> = ({ label, icon, children }) => {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { refs, floatingStyles } = useScrollableMenuFloating('right-start');

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
            className="kanban-context-submenu-panel overflow-y-auto overscroll-contain bg-nim-secondary border border-nim rounded-md shadow-lg py-1"
            style={{ ...floatingStyles, minWidth: 140, maxWidth: 280, zIndex: 60 }}
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
