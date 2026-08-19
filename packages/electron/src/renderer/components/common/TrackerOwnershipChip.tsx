/**
 * The one visual grammar for "whose is this".
 *
 * A user learns it once — lock + "Personal" means this machine only, people +
 * the team's name means everyone on that team sees the same fields, items and
 * numbers — and then reads it everywhere ownership appears: the tracker
 * sidebar's section headers, the tracker settings rows, and (later) documents.
 * Everything here is presentational so a second surface can adopt it without
 * inheriting tracker plumbing.
 *
 * Do not invent a second treatment for the same idea in another component.
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { TrackerOwnership } from '../TrackerMode/trackerNavigationTree';

/** Minimal member shape, kept local so this file pulls in no editor graph. */
export interface OwnershipMember {
  email: string;
  name?: string;
}

export function trackerOwnershipIcon(ownership: TrackerOwnership): string {
  return ownership === 'team' ? 'group' : 'lock';
}

/**
 * The words for an ownership. A team is named, because the name is the point:
 * "Bugs is Stravu's" answers the question that a generic "Shared" does not.
 */
export function trackerOwnershipLabel(
  ownership: TrackerOwnership,
  teamName?: string | null,
): string {
  if (ownership === 'personal') return 'Personal';
  return teamName?.trim() || 'Team';
}

/** One-line explanation of what the ownership means for the user's edits. */
export function trackerOwnershipDescription(
  ownership: TrackerOwnership,
  memberCount?: number,
): string {
  if (ownership === 'personal') return 'On this machine. Never synced.';
  const everyone = 'Everyone sees the same fields, items, and numbers.';
  return memberCount && memberCount > 1
    ? `Shared with ${memberCount} people. ${everyone}`
    : everyone;
}

/**
 * The compressed form for surfaces that can't afford the full sentence — the
 * sidebar section header shows this inline and carries
 * {@link trackerOwnershipDescription} in its tooltip.
 */
export function trackerOwnershipShortDescription(
  ownership: TrackerOwnership,
  memberCount?: number,
): string {
  if (ownership === 'personal') return 'Local only';
  return memberCount && memberCount > 1 ? `Shared · ${memberCount} people` : 'Shared with the team';
}

export const TrackerOwnershipChip: React.FC<{
  ownership: TrackerOwnership;
  teamName?: string | null;
  /** Team trackers can start new items as private drafts. */
  draftByDefault?: boolean;
  className?: string;
}> = ({ ownership, teamName, draftByDefault = false, className = '' }) => {
  const isTeam = ownership === 'team';
  const label = trackerOwnershipLabel(ownership, teamName);
  return (
    <span
      className={`tracker-ownership-chip inline-flex items-center gap-1 px-[7px] py-[2px] rounded-[10px] text-[10px] font-semibold ${
        isTeam
          ? 'bg-[color-mix(in_srgb,var(--nim-primary)_15%,transparent)] text-[var(--nim-primary)]'
          : 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-faint)]'
      } ${className}`}
      data-ownership={ownership}
      title={
        isTeam
          ? `${label} owns this tracker — changing its fields changes them for everyone`
          : 'Only on this machine'
      }
    >
      <MaterialSymbol icon={trackerOwnershipIcon(ownership)} size={11} />
      {isTeam && draftByDefault ? `${label} · drafts` : label}
    </span>
  );
};

/**
 * Overlapping initials for the people a team tracker is shared with. Silent
 * when the roster is unknown — an empty ring would read as "shared with nobody".
 */
export const TrackerOwnershipAvatars: React.FC<{
  members: OwnershipMember[];
  max?: number;
}> = ({ members, max = 3 }) => {
  if (members.length === 0) return null;
  const shown = members.slice(0, max);
  const overflow = members.length - shown.length;
  return (
    <span className="tracker-ownership-avatars flex items-center -space-x-1" aria-hidden="true">
      {shown.map((member) => (
        <span
          key={member.email}
          className="flex size-[17px] shrink-0 items-center justify-center rounded-full border border-[var(--nim-bg-secondary)] bg-[color-mix(in_srgb,var(--nim-primary)_62%,var(--nim-bg))] text-[8px] font-semibold text-[var(--nim-on-primary)]"
          title={member.name || member.email}
        >
          {ownershipInitials(member)}
        </span>
      ))}
      {overflow > 0 && (
        <span className="flex size-[17px] shrink-0 items-center justify-center rounded-full border border-[var(--nim-bg-secondary)] bg-[var(--nim-bg-tertiary)] text-[8px] font-semibold text-[var(--nim-text-muted)]">
          +{overflow}
        </span>
      )}
    </span>
  );
};

function ownershipInitials(member: OwnershipMember): string {
  const source = member.name?.trim() || member.email;
  return source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

/**
 * Section header for an ownership group. Same shape wherever a surface splits
 * its navigation into mine/the team's, so the split reads as one idea.
 *
 * One compact row — chevron, name in the same muted style as the sibling
 * section headers, then the ownership's status affordance (avatar stack or
 * lock) right-aligned. The short subtitle sits under the name; the full
 * explanation lives in the row's tooltip.
 */
export const TrackerOwnershipSectionHeader: React.FC<{
  ownership: TrackerOwnership;
  teamName?: string | null;
  members?: OwnershipMember[];
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Controls that act on this group alone, e.g. "new folder". Kept outside the toggle button. */
  actions?: React.ReactNode;
}> = ({ ownership, teamName, members = [], collapsed = false, onToggleCollapsed, actions }) => {
  const isTeam = ownership === 'team';
  const memberCount = isTeam ? members.length : undefined;
  return (
    <div className="tracker-ownership-section-header pt-1" data-ownership={ownership}>
      {/* py-1.5 + leading-5 matches the 32px type rows so the click target is the same size. */}
      <div className="group flex items-center gap-1">
        <button
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1.5 text-left text-[var(--nim-text-faint)] hover:bg-[var(--nim-bg-tertiary)] hover:text-[var(--nim-text-muted)]"
          onClick={onToggleCollapsed}
          title={trackerOwnershipDescription(ownership, memberCount)}
          aria-expanded={!collapsed}
          data-testid="tracker-ownership-section-toggle"
        >
          <MaterialSymbol icon={collapsed ? 'chevron_right' : 'expand_more'} size={15} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-[10px] leading-5 font-semibold uppercase tracking-wider">
            {trackerOwnershipLabel(ownership, teamName)}
          </span>
          {isTeam
            ? <TrackerOwnershipAvatars members={members} />
            : <MaterialSymbol icon={trackerOwnershipIcon(ownership)} size={12} className="shrink-0" />}
        </button>
        {actions}
      </div>
      <div className="pl-[25px] text-[10px] leading-snug text-[var(--nim-text-faint)]">
        {trackerOwnershipShortDescription(ownership, memberCount)}
      </div>
    </div>
  );
};
