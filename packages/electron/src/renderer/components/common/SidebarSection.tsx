import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';

/**
 * A collapsible group of rows in a mode's left navigation.
 *
 * Every mode's sidebar had grown its own version of the same header — an
 * uppercase label, a disclosure chevron and a slot for the group's own controls
 * — so this is the one shape they share. The collapsed flag is passed in rather
 * than held here: whether it survives a remount is the host's business, and each
 * mode persists its own (`trackerSidebarCollapsedSectionsAtom` for the tracker,
 * `orgSidebarPreferences` for the organization).
 *
 * `data-section-id` and `data-collapsed` are the stable markers; the title is
 * presentation and must not be what a test keys on.
 */
export function SidebarSection({
  sectionId,
  title,
  collapsed = false,
  onToggleCollapsed,
  actions,
  testId,
  className = '',
  children,
}: {
  /** Stable identity for the group, used as its DOM marker and its stored key. */
  sectionId: string;
  title: string;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /**
   * Controls that act on this group alone — a `[+]`, a retry. Kept outside the
   * disclosure button so clicking one does not also collapse the group.
   */
  actions?: React.ReactNode;
  testId?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      className={`sidebar-section ${className}`.trim()}
      data-testid={testId}
      data-section-id={sectionId}
      data-collapsed={collapsed ? 'true' : undefined}
    >
      <div className="sidebar-section-header flex items-center gap-1 px-2 pb-1 pt-2">
        <button
          type="button"
          className="sidebar-section-toggle org-window-no-drag flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left text-nim-faint hover:bg-nim-hover hover:text-nim-muted"
          data-testid={testId ? `${testId}-toggle` : undefined}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          <MaterialSymbol
            icon={collapsed ? 'chevron_right' : 'expand_more'}
            size={14}
            className="shrink-0"
          />
          <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase leading-5 tracking-wider">
            {title}
          </span>
        </button>
        {actions}
      </div>
      {!collapsed && (
        <div className="sidebar-section-body flex flex-col">{children}</div>
      )}
    </section>
  );
}
