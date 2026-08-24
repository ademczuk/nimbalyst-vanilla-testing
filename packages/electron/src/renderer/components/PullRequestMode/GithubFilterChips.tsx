/**
 * GithubFilterChips — a labelled group of toggle chips, shared by the GitHub
 * panel's filter sidebars so the PR and issue lists stay visually identical.
 *
 * The chip vocabulary belongs to each list; this only renders and toggles.
 * A chip may carry a colour, which is how the tracker-derived groups render in
 * their own schema's colours rather than the panel accent.
 */

import type { JSX } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { trackerColorStyle } from './githubTrackerBadge';

export interface GithubFilterChip<TId extends string = string> {
  id: TId;
  label: string;
  icon?: string;
  /** Optional match count shown after the label; omit to show nothing. */
  count?: number;
  /** Schema colour for tracker-derived chips; omit for the panel accent. */
  color?: string;
}

interface GithubFilterChipsProps<TId extends string> {
  heading: string;
  chips: ReadonlyArray<GithubFilterChip<TId>>;
  activeIds: ReadonlyArray<TId>;
  onToggle: (id: TId) => void;
  /** Prefix for each chip's `data-testid` (`${prefix}-${chip.id}`). */
  testIdPrefix: string;
  /** Marker/test id for the group wrapper. */
  groupTestId?: string;
}

export function GithubFilterChips<TId extends string>({
  heading,
  chips,
  activeIds,
  onToggle,
  testIdPrefix,
  groupTestId,
}: GithubFilterChipsProps<TId>): JSX.Element {
  return (
    <div className="github-filter-chips px-2 pt-2 pb-1" data-testid={groupTestId}>
      <div className="text-[10px] font-semibold text-nim-faint uppercase tracking-wider px-1 mb-1.5">
        {heading}
      </div>
      <div className="flex flex-wrap gap-1">
        {chips.map((chip) => {
          const isActive = activeIds.includes(chip.id);
          const colored = chip.color !== undefined;
          return (
            <button
              key={chip.id}
              data-testid={`${testIdPrefix}-${chip.id}`}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                isActive
                  ? colored
                    ? 'text-nim-on-primary'
                    : 'bg-[var(--nim-primary)] text-nim-on-primary'
                  : colored
                    ? 'text-nim-muted hover:text-nim hover:bg-nim-active'
                    : 'bg-nim-tertiary text-nim-muted hover:bg-nim-active hover:text-nim'
              }`}
              style={
                colored
                  ? isActive
                    ? { backgroundColor: chip.color }
                    : trackerColorStyle(chip.color)
                  : undefined
              }
              onClick={() => onToggle(chip.id)}
            >
              {chip.icon && <MaterialSymbol icon={chip.icon} size={13} />}
              {chip.label}
              {chip.count !== undefined && <span className="opacity-70">{chip.count}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
