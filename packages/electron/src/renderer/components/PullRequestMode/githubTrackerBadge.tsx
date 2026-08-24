/**
 * A tracker item's workflow status (and optional priority marker) rendered
 * with the item's own schema colors, shared by both GitHub lists.
 *
 * Type-agnostic: driven entirely by the workflowStatus / priority roles, so a
 * `github-pr` item on a PR row and a `github-issue` overlay on an issue row —
 * two different ladders and vocabularies — both render correctly with no
 * per-list status table. Each list supplies its own marker class so DOM
 * markers stay list-specific.
 */

import type { CSSProperties, JSX } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import {
  getRecordStatus,
  getRecordPriority,
  getStatusOptions,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';

export const FALLBACK_TRACKER_COLOR = 'var(--nim-text-muted)';
const PRIORITY_MARKERS: Record<string, string> = {
  critical: 'var(--nim-error)',
  high: 'var(--nim-warning)',
};

export function trackerColorStyle(color?: string): CSSProperties {
  const foreground = color || FALLBACK_TRACKER_COLOR;
  return {
    color: foreground,
    backgroundColor: `color-mix(in srgb, ${foreground} 12%, transparent)`,
  };
}

export interface TrackerStatusOption {
  value: string;
  label: string;
  icon?: string;
  color?: string;
}

export function statusOptionFor(record: TrackerRecord): TrackerStatusOption | null {
  const status = getRecordStatus(record);
  if (!status) return null;
  const option = getStatusOptions(record.primaryType).find((o) => o.value === status);
  return option ?? { value: status, label: status };
}

export interface GithubTrackerBadgeProps {
  record: TrackerRecord;
  /** Compact list-row variant: smaller, no icon. */
  compact?: boolean;
  onClick?: () => void;
  title?: string;
  /** Stable DOM marker for the list this badge belongs to. */
  markerClass: string;
}

export function GithubTrackerBadge({
  record,
  compact,
  onClick,
  title,
  markerClass,
}: GithubTrackerBadgeProps): JSX.Element | null {
  const option = statusOptionFor(record);
  if (!option) return null;
  const priority = getRecordPriority(record);
  const priorityColor = PRIORITY_MARKERS[priority];

  const inner = (
    <>
      {!compact && option.icon && <MaterialSymbol icon={option.icon} size={12} />}
      {option.label}
      {priorityColor && (
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: priorityColor }}
          title={`${priority} priority`}
        />
      )}
    </>
  );

  const className = `${markerClass} inline-flex items-center gap-1 rounded font-medium shrink-0 ${
    compact ? 'px-1 py-px text-[10px]' : 'px-1.5 py-0.5 text-[11px]'
  }`;
  const style = trackerColorStyle(option.color);

  if (onClick) {
    return (
      <button
        type="button"
        className={`${className} hover:brightness-125 transition-[filter]`}
        style={style}
        title={title ?? `${record.issueKey ?? ''} ${option.label}`.trim()}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        {inner}
      </button>
    );
  }
  return (
    <span className={className} style={style} title={title}>
      {inner}
    </span>
  );
}
