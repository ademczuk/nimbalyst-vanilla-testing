/**
 * Colors the tracker surfaces paint status, priority, and type swatches with.
 *
 * Extracted from KanbanBoard so the board shell and the card render the same
 * swatch without one importing the other, and now the single source for the
 * desktop tag board and item detail as well. Their private copies had already
 * drifted: `critical` was `#dc2626` in the detail pane and `#ef4444`
 * everywhere else, so the same item read as two different priorities depending
 * on which surface you opened it from. New swatches belong here, not beside
 * the component that needed one.
 */

export const STATUS_COLORS: Record<string, string> = {
  'to-do': '#6b7280',
  'in-progress': '#eab308',
  'in-review': '#8b5cf6',
  'done': '#22c55e',
  'blocked': '#ef4444',
  "won't-fix": '#6b7280',
  'wont-fix': '#6b7280',
};

/**
 * Swatches for the five lifecycle categories, used when a menu offers categories
 * rather than literal statuses (a mixed-type selection has no shared status
 * vocabulary). Deliberately echoes STATUS_COLORS so `Done` looks the same green
 * whether it was reached as a category or as a bug's `done`.
 */
export const STATUS_CATEGORY_COLORS: Record<string, string> = {
  backlog: '#6b7280',
  unstarted: '#6b7280',
  started: '#eab308',
  done: '#22c55e',
  cancelled: '#ef4444',
};

export const PRIORITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#6b7280',
};

/**
 * Re-exported, not restated. This was a fourth copy of the built-in type
 * accents and had already lost `automation`, which exists only in the runtime
 * map -- an `automation` card fell through to the neutral swatch and read as a
 * type with no color rather than as a missing entry. `trackerTypeIdentity.ts`
 * is dependency-free precisely so surfaces can consume it directly.
 */
export { DEFAULT_TRACKER_TYPE_COLORS as TYPE_COLORS } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/trackerTypeIdentity';

/** Fallback swatch for a value with no assigned color. */
export const NEUTRAL_SWATCH = '#6b7280';
