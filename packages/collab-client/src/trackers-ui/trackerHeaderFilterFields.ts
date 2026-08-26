/**
 * Option lists for the tracker header's column filters.
 *
 * A filter dropdown offers the values actually present in the current rows, with
 * counts, rather than the schema's full vocabulary. Relationship and identity
 * values arrive as objects, so this owns the one place that decides which key
 * identifies such a value and which one labels it.
 */

import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import type { TrackerFilterField } from './trackerFilterFields';

/** Field types whose options are derived from the rows rather than the schema. */
const VALUE_DERIVED_TYPES = ['user', 'select', 'multiselect', 'array', 'relationship', 'reference'];

/** Options are capped so one high-cardinality field cannot stall the dropdown. */
const MAX_OPTIONS = 100;

interface CountedOption {
  label: string;
  count: number;
  color?: string;
  icon?: string;
}

export function buildHeaderFilterFields(
  filterFields: TrackerFilterField[],
  items: TrackerRecord[],
  getViewFilterValue: (item: TrackerRecord, fieldId: string) => unknown,
): TrackerFilterField[] {
  return filterFields.map(field => {
    if (!VALUE_DERIVED_TYPES.includes(field.type ?? '')) return field;

    const options = new Map<string, CountedOption>();
    for (const option of field.options ?? []) {
      options.set(option.value, {
        label: option.label,
        count: 0,
        color: option.color,
        icon: option.icon,
      });
    }

    const addValue = (value: unknown): void => {
      if (value === undefined || value === null || value === '') return;
      if (Array.isArray(value)) {
        value.forEach(addValue);
        return;
      }
      if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const optionValue = record.itemId ?? record.issueKey ?? record.url
          ?? record.email ?? record.gitEmail ?? record.gitName ?? record.displayName ?? record.title;
        const label = record.title ?? record.name ?? record.displayName
          ?? record.email ?? record.gitEmail ?? record.gitName ?? record.issueKey ?? optionValue;
        if (optionValue === undefined) return;
        const key = String(optionValue);
        const existing = options.get(key);
        options.set(key, {
          label: existing?.label ?? String(label),
          count: (existing?.count ?? 0) + 1,
          color: existing?.color,
          icon: existing?.icon,
        });
        return;
      }
      const key = String(value);
      const existing = options.get(key);
      options.set(key, {
        label: existing?.label ?? key,
        count: (existing?.count ?? 0) + 1,
        color: existing?.color,
        icon: existing?.icon,
      });
    };

    for (const item of items) addValue(getViewFilterValue(item, field.id));

    const derived = Array.from(options, ([value, option]) => ({ value, ...option }));
    // A schema-declared vocabulary keeps its declared order; a derived one has
    // no meaningful order of its own, so it sorts by label.
    if (!field.options?.length) {
      derived.sort((left, right) => left.label.localeCompare(right.label));
    }
    return { ...field, options: derived.slice(0, MAX_OPTIONS) };
  });
}
