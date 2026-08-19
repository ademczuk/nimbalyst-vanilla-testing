import React from 'react';
import { TrackerOwnershipSectionHeader, type OwnershipMember } from '../common/TrackerOwnershipChip';
import type { TrackerOwnership } from './trackerNavigationTree';

/**
 * One ownership group in the tracker sidebar: compact collapsible header plus
 * that group's navigation tree. The tree itself comes in as children because
 * its rendering shares drag/count closures with the rest of the sidebar.
 */
export const TrackerOwnershipSection: React.FC<{
  ownership: TrackerOwnership;
  teamName?: string | null;
  members: OwnershipMember[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Header controls scoped to this group -- a folder is born owned by it. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ ownership, teamName, members, collapsed, onToggleCollapsed, actions, children }) => (
  <div
    className="tracker-ownership-section mt-2 first:mt-1"
    data-testid="tracker-ownership-section"
    data-ownership={ownership}
    data-collapsed={collapsed || undefined}
  >
    <TrackerOwnershipSectionHeader
      ownership={ownership}
      teamName={teamName}
      members={members}
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      actions={actions}
    />
    {!collapsed && <div className="mt-1">{children}</div>}
  </div>
);
