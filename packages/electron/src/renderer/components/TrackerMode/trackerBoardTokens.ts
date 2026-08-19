/**
 * Colors the board paints status, priority, and type swatches with.
 *
 * Extracted from KanbanBoard so the board shell and the card render the same
 * swatch without one importing the other.
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

export const PRIORITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#6b7280',
};

export const TYPE_COLORS: Record<string, string> = {
  bug: '#dc2626',
  task: '#2563eb',
  plan: '#7c3aed',
  idea: '#ca8a04',
  decision: '#8b5cf6',
  feature: '#10b981',
};

/** Fallback swatch for a value with no assigned color. */
export const NEUTRAL_SWATCH = '#6b7280';
