/**
 * Draft / Published, in the ownership chip's visual grammar.
 *
 * This is deliberately the SAME chip shape, size and colour logic as
 * `TrackerOwnershipChip` (electron: components/common) — a user learns the
 * vocabulary once and reads it everywhere. "Whose is this" and "can they see it
 * yet" are two questions in one language, not two chip languages.
 *
 * It lives in runtime because the tracker table renders it, and runtime cannot
 * import from the electron package. Keep the two files in visual lockstep; do
 * not invent a third treatment for the same idea.
 */

import React from 'react';
import { MaterialSymbol } from '../../../ui/icons/MaterialSymbol';
import type { TrackerItemPublicationState } from '../trackerRecordAccessors';

export function trackerPublicationLabel(state: TrackerItemPublicationState): string {
  return state === 'published' ? 'Published' : 'Draft';
}

export function trackerPublicationIcon(state: TrackerItemPublicationState): string {
  return state === 'published' ? 'group' : 'lock';
}

/** One line saying who can see this item. */
export function trackerPublicationDescription(state: TrackerItemPublicationState): string {
  return state === 'published'
    ? 'Your team can see this item.'
    : 'Only you can see this. Publish it when it is ready.';
}

/**
 * `state: 'n/a'` (a personal tracker) renders nothing: publication does not
 * apply there, and an ever-present "Draft" would imply an unfinished step.
 */
export const TrackerPublicationChip: React.FC<{
  state: TrackerItemPublicationState;
  className?: string;
}> = ({ state, className = '' }) => {
  if (state === 'n/a') return null;
  const published = state === 'published';
  return (
    <span
      className={`tracker-publication-chip inline-flex items-center gap-1 px-[7px] py-[2px] rounded-[10px] text-[10px] font-semibold ${
        published
          ? 'bg-[color-mix(in_srgb,var(--nim-primary)_15%,transparent)] text-[var(--nim-primary)]'
          : 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-faint)]'
      } ${className}`}
      data-publication={state}
      data-testid="tracker-publication-chip"
      title={trackerPublicationDescription(state)}
    >
      <MaterialSymbol icon={trackerPublicationIcon(state)} size={11} />
      {trackerPublicationLabel(state)}
    </span>
  );
};
