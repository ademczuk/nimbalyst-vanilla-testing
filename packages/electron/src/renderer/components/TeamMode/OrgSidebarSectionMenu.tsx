import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { useAtomValue } from 'jotai';

import { HelpTooltip } from '../../help';
import { FloatingPortal, useFloatingMenu } from '../../hooks/useFloatingMenu';
import {
  orgWindowRouteSelectedAtomFamily,
  orgWindowRouteSelectionKey,
} from './orgWindowState';

export interface OrgSectionMenuItem {
  testId: string;
  label: string;
  icon: string;
  /** Absent when the viewer may not run the action — the row renders disabled. */
  onSelect?: () => void;
  /** Why the item is disabled, shown in place of the label's tooltip. */
  disabledLabel?: string;
  /** Set when the item is a destination — it then shows its own selection. */
  routeKey?: string;
}

/**
 * The `[+]` on a sidebar section header: one action, or a menu of them.
 *
 * The trigger stays enabled even when every item is not — a member who may not
 * create rooms can still reach the directory through it, which is where the
 * rooms they *can* join are.
 */
export function OrgSidebarSectionAdd({
  surfaceId,
  testId,
  addLabel,
  onAdd,
  disabledLabel,
  menuItems,
}: {
  surfaceId: string;
  testId: string;
  addLabel: string;
  onAdd?: () => void;
  /** Why the add control is disabled, shown as its tooltip. */
  disabledLabel?: string;
  menuItems?: OrgSectionMenuItem[];
}) {
  const menu = useFloatingMenu({ placement: 'bottom-end' });
  const hasMenu = Boolean(menuItems && menuItems.length > 0);

  return (
    <>
      <HelpTooltip testId={`${testId}-add`} disabled={!hasMenu && !onAdd}>
        <button
          type="button"
          ref={hasMenu ? menu.refs.setReference : undefined}
          {...(hasMenu ? menu.getReferenceProps() : {})}
          className="org-sidebar-section-add org-window-no-drag flex size-5 shrink-0 items-center justify-center rounded text-nim-faint hover:bg-nim-hover hover:text-nim disabled:cursor-not-allowed disabled:text-nim-disabled"
          data-testid={`${testId}-add`}
          title={hasMenu || onAdd ? addLabel : disabledLabel ?? addLabel}
          aria-label={addLabel}
          aria-haspopup={hasMenu ? 'menu' : undefined}
          aria-expanded={hasMenu ? menu.isOpen : undefined}
          disabled={!hasMenu && !onAdd}
          onClick={hasMenu ? () => menu.setIsOpen(!menu.isOpen) : onAdd}
        >
          <MaterialSymbol icon="add" size={14} />
        </button>
      </HelpTooltip>
      {hasMenu && menu.isOpen && (
        <FloatingPortal>
          <div
            ref={menu.refs.setFloating}
            style={menu.floatingStyles}
            {...menu.getFloatingProps()}
            data-testid={`${testId}-menu`}
            className="org-sidebar-section-menu org-window-no-drag z-[10000] min-w-[180px] overflow-y-auto rounded-md border border-nim bg-nim p-1 shadow-lg"
          >
            {menuItems!.map((item) => (
              <SectionMenuItemButton
                key={item.testId}
                surfaceId={surfaceId}
                item={item}
                onClose={() => menu.setIsOpen(false)}
              />
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

/** A destination inside a section's `[+]` menu, showing its own selection. */
function SectionMenuItemButton({
  surfaceId,
  item,
  onClose,
}: {
  surfaceId: string;
  item: OrgSectionMenuItem;
  onClose: () => void;
}) {
  // No route key means the item is an action rather than a destination; the
  // empty key matches no route, so it is never marked selected.
  const selected = useAtomValue(
    orgWindowRouteSelectedAtomFamily(
      orgWindowRouteSelectionKey(surfaceId, item.routeKey ?? ''),
    ),
  );
  return (
    <button
      type="button"
      data-testid={item.testId}
      className={`org-sidebar-section-menu-item flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] ${
        item.onSelect
          ? selected
            ? 'bg-nim-active text-nim'
            : 'text-nim hover:bg-nim-hover'
          : 'cursor-not-allowed text-nim-disabled'
      }`}
      title={item.onSelect ? undefined : item.disabledLabel}
      aria-current={selected ? 'page' : undefined}
      disabled={!item.onSelect}
      onClick={() => {
        onClose();
        item.onSelect?.();
      }}
    >
      <MaterialSymbol icon={item.icon} size={16} />
      {item.label}
    </button>
  );
}
