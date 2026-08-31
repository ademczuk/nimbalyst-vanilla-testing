/**
 * The type stage of Quick Track: a filter input over a vertical list of
 * creatable tracker types.
 *
 * Everything here is keyboard-first. The list never wraps into pills, because a
 * workspace with thirty types turned that row into a third of the popup and
 * left most types behind a "+N more" button that no accelerator could reach.
 */

import React, { useEffect, useRef } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { getTypeIcon } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerColumns';
import type { TrackerTypeChoice } from './rankTrackerTypes';

interface TrackerTypePickerProps {
  choices: TrackerTypeChoice[];
  /** Index into `choices`; clamped by the owner. */
  activeIndex: number;
  query: string;
  onQueryChange: (query: string) => void;
  onActiveIndexChange: (index: number) => void;
  onSelect: (type: string) => void;
  /** The type that is currently on the draft, marked as such in the list. */
  selectedType: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Rendered under the list — the in-progress title, when there is one. */
  footer?: React.ReactNode;
}

/** Split a display name so fuzzy-matched characters can be emphasised. */
function renderHighlighted(text: string, matchedIndices: number[]): React.ReactNode {
  if (matchedIndices.length === 0) return text;
  const matched = new Set(matchedIndices);
  return Array.from(text).map((char, index) =>
    matched.has(index) ? (
      <span key={index} className="font-semibold text-[var(--nim-primary)]">{char}</span>
    ) : (
      <span key={index}>{char}</span>
    ),
  );
}

export const TrackerTypePicker: React.FC<TrackerTypePickerProps> = ({
  choices,
  activeIndex,
  query,
  onQueryChange,
  onActiveIndexChange,
  onSelect,
  selectedType,
  inputRef,
  footer,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const row = listRef.current?.children[activeIndex];
    // Guarded: jsdom has no layout, so it does not implement scrollIntoView.
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, choices.length]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      event.preventDefault();
      onActiveIndexChange(Math.min(activeIndex + 1, choices.length - 1));
      return;
    }
    if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      event.preventDefault();
      onActiveIndexChange(Math.max(activeIndex - 1, 0));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      onActiveIndexChange(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      onActiveIndexChange(choices.length - 1);
      return;
    }
    // Tab commits like Enter rather than moving focus: the next stop is always
    // the title field, and the picker is the only thing on screen.
    if (event.key === 'Enter' || event.key === 'Tab') {
      const choice = choices[activeIndex];
      if (!choice) return;
      event.preventDefault();
      onSelect(choice.model.type);
    }
  };

  return (
    <div className="tracker-quick-create-type-picker flex flex-col">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded
        aria-controls="tracker-quick-create-type-list"
        aria-activedescendant={choices[activeIndex] ? `tracker-quick-create-type-option-${choices[activeIndex].model.type}` : undefined}
        data-testid="tracker-quick-create-type-search"
        className="tracker-quick-create-type-search select-text bg-transparent px-3 py-2 text-sm text-[var(--nim-text)] outline-none placeholder:text-[var(--nim-text-muted)]"
        placeholder="What kind of item?"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />

      <div
        ref={listRef}
        id="tracker-quick-create-type-list"
        role="listbox"
        aria-label="Tracker types"
        className="tracker-quick-create-type-list max-h-[260px] overflow-y-auto border-t border-[var(--nim-border)] py-1"
      >
        {choices.length === 0 && (
          <div className="px-3 py-2 text-xs text-[var(--nim-text-muted)]">
            {query.trim() ? `No tracker type matches “${query.trim()}”.` : 'No creatable tracker types.'}
          </div>
        )}
        {choices.map((choice, index) => (
          <button
            key={choice.model.type}
            type="button"
            id={`tracker-quick-create-type-option-${choice.model.type}`}
            role="option"
            aria-selected={index === activeIndex}
            data-testid={`tracker-quick-create-type-${choice.model.type}`}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
              index === activeIndex
                ? 'bg-[var(--nim-bg-selected)] text-[var(--nim-text)]'
                : 'text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)]'
            }`}
            onMouseMove={() => onActiveIndexChange(index)}
            onClick={() => onSelect(choice.model.type)}
          >
            <MaterialSymbol icon={getTypeIcon(choice.model.type)} size={15} />
            <span className="truncate">
              {renderHighlighted(choice.model.displayName, choice.matchedIndices)}
            </span>
            {choice.model.type === selectedType && (
              <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-[var(--nim-text-muted)]">
                current
              </span>
            )}
          </button>
        ))}
      </div>

      {footer}
    </div>
  );
};

export default TrackerTypePicker;
