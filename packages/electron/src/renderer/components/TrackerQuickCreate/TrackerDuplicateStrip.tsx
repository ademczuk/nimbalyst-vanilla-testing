/**
 * "Have I already filed this?" — shown between the title and the description
 * while you type, advisory and never blocking.
 *
 * Done/closed items are shown WITH their status: "this was already fixed" is
 * one of the two answers the strip exists to give, and hiding closed items
 * would suppress it.
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { getTypeIcon } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerColumns';
import type { DuplicateMatch } from './scoreTrackerDuplicates';

export interface TrackerDuplicateStripProps {
  matches: DuplicateMatch[];
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Index of the keyboard-focused row, or -1 when focus is still in the title. */
  activeIndex: number;
  onOpenItem: (itemId: string) => void;
  onHoverItem: (index: number) => void;
  /** Rendered under the rows when the semantic arm is unavailable and undismissed. */
  footer?: React.ReactNode;
}

export const TrackerDuplicateStrip: React.FC<TrackerDuplicateStripProps> = ({
  matches,
  expanded,
  onToggleExpanded,
  activeIndex,
  onOpenItem,
  onHoverItem,
  footer,
}) => {
  if (matches.length === 0) return null;

  return (
    <div className="tracker-quick-create-duplicates border-t border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] px-3 py-2 text-xs">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left text-[var(--nim-text-muted)] hover:text-[var(--nim-text)]"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
      >
        <MaterialSymbol icon={expanded ? 'expand_more' : 'chevron_right'} size={14} />
        <span>
          {matches.length === 1 ? '1 possible duplicate' : `${matches.length} possible duplicates`}
        </span>
      </button>

      {expanded && (
        <ul className="tracker-quick-create-duplicate-rows mt-1.5 flex flex-col gap-0.5" role="listbox">
          {matches.map((match, index) => (
            <li key={match.entry.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                data-testid={`tracker-quick-create-duplicate-${match.entry.id}`}
                className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left ${
                  index === activeIndex ? 'bg-[var(--nim-bg-selected)]' : 'hover:bg-[var(--nim-bg-hover)]'
                }`}
                onMouseEnter={() => onHoverItem(index)}
                onClick={() => onOpenItem(match.entry.id)}
              >
                <MaterialSymbol icon={getTypeIcon(match.entry.type)} size={14} className="shrink-0 text-[var(--nim-text-muted)]" />
                {match.entry.displayKey && (
                  <span
                    className="shrink-0 font-mono text-[10px] text-[var(--nim-text-muted)]"
                    title={match.entry.keyIsShared ? undefined : 'Local number — not a shared issue key'}
                  >
                    {match.entry.displayKey}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[var(--nim-text)]">{match.entry.title}</span>
                {match.entry.status && (
                  <span className="shrink-0 rounded bg-[var(--nim-bg)] px-1.5 py-0.5 text-[10px] text-[var(--nim-text-muted)]">
                    {match.entry.status}
                  </span>
                )}
                <span className="shrink-0 text-[10px] text-[var(--nim-text-muted)]">
                  {match.arms.includes('semantic') ? 'similar' : 'wording'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {expanded && footer}
    </div>
  );
};

export default TrackerDuplicateStrip;
