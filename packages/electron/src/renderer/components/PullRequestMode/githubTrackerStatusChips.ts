/**
 * One filter chip per workflow status carried by the tracker items about the
 * listed PRs or issues, labelled and coloured by each item's own schema.
 *
 * Nothing here knows a status vocabulary: the PR list discovers whatever
 * statuses its referencing items happen to use, and the issues list seeds the
 * `github-issue` ladder from that type's schema so its queues exist before
 * anything has been triaged. Adding a status to either schema needs no change
 * in this file.
 *
 * Counts are per listed row, not per item — two items about the same issue in
 * the same status are one match, because the chip narrows a list of issues.
 */

import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import {
  getRecordStatus,
  getStatusOptions,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import { FALLBACK_TRACKER_COLOR, type TrackerStatusOption } from './githubTrackerBadge';

export interface TrackerStatusChipData {
  value: string;
  label: string;
  icon?: string;
  color: string;
  count: number;
}

export function collectTrackerStatusChips({
  numbers,
  references,
  seedOptions = [],
  activeValues,
}: {
  /** The listed PR / issue numbers, which is what the counts count. */
  numbers: Iterable<number>;
  references: ReadonlyMap<number, ReadonlyArray<TrackerRecord>>;
  /** Statuses that always render, in schema order, before discovered ones. */
  seedOptions?: ReadonlyArray<TrackerStatusOption>;
  /** Active filters, so a chip can always be toggled back off. */
  activeValues: ReadonlyArray<string>;
}): TrackerStatusChipData[] {
  const chips = new Map<string, TrackerStatusChipData>();
  const add = (option: TrackerStatusOption, count: number): void => {
    const existing = chips.get(option.value);
    if (existing) {
      existing.count += count;
      return;
    }
    chips.set(option.value, {
      value: option.value,
      label: option.label,
      icon: option.icon,
      color: option.color || FALLBACK_TRACKER_COLOR,
      count,
    });
  };

  for (const option of seedOptions) add(option, 0);

  for (const number of numbers) {
    const items = references.get(number);
    if (!items?.length) continue;
    const seenForRow = new Set<string>();
    for (const item of items) {
      const status = getRecordStatus(item);
      if (!status || seenForRow.has(status)) continue;
      seenForRow.add(status);
      const option = getStatusOptions(item.primaryType).find((o) => o.value === status);
      add(option ?? { value: status, label: status }, 1);
    }
  }

  for (const value of activeValues) {
    if (!chips.has(value)) add({ value, label: value }, 0);
  }

  return Array.from(chips.values());
}
