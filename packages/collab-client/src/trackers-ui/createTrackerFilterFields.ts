import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import {
  getCellValue,
  getFieldForColumn,
  type TrackerColumnDef,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerColumns';
import type { TrackerDataModel } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { READINESS_FILTER_FIELD } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/trackerStatusCategory';
import { resolveRoleFieldName } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import {
  getTrackerFilterValue,
  STATUS_CHANGED_FROM_FILTER_FIELD,
  STATUS_CHANGED_TO_FILTER_FIELD,
  type FilterContext,
} from '../trackers';
import type { TrackerFilterField } from './trackerFilterFields';

const ROLE_ORDER = new Map<string, number>([
  ['title', 0],
  ['workflowStatus', 1],
  ['priority', 2],
  ['assignee', 3],
  ['reporter', 4],
  ['tags', 5],
  ['progress', 6],
  ['startDate', 7],
  ['dueDate', 8],
]);

const STRUCTURAL_ORDER = new Map<string, number>([
  ['type', 20],
  ['key', 21],
  ['updated', 22],
  ['viewed', 23],
  ['created', 24],
  ['createdBy', 25],
  ['updatedBy', 26],
  ['module', 27],
  ['shared', 28],
  ['favorite', 29],
  ['archived', 30],
]);

/** Build the filter menu's field catalog from the same columns every host renders. */
export function createTrackerFilterFields(
  availableColumns: TrackerColumnDef[],
  schemaType: string,
  trackerTypes: TrackerDataModel[],
): TrackerFilterField[] {
  const orderedColumns = [...availableColumns].sort((left, right) => {
    const leftOrder = left.role
      ? (ROLE_ORDER.get(left.role) ?? 15)
      : (STRUCTURAL_ORDER.get(left.id) ?? 10);
    const rightOrder = right.role
      ? (ROLE_ORDER.get(right.role) ?? 15)
      : (STRUCTURAL_ORDER.get(right.id) ?? 10);
    return leftOrder - rightOrder || left.label.localeCompare(right.label);
  });

  const fields: TrackerFilterField[] = orderedColumns.map(column => {
    const directField = getFieldForColumn(schemaType, column.id);
    const roleFields = column.role
      ? trackerTypes
        .map(model => {
          const roleFieldName = model.roles?.[column.role!];
          return roleFieldName
            ? model.fields.find(field => field.name === roleFieldName)
            : undefined;
        })
        .filter((field): field is NonNullable<typeof field> => field !== undefined)
      : [];
    const representativeField = directField ?? roleFields[0];
    const optionMap = new Map<string, { label: string; color?: string; icon?: string }>();
    for (const field of directField ? [directField] : roleFields) {
      for (const option of field.options ?? []) {
        optionMap.set(option.value, {
          label: option.label,
          color: option.color,
          icon: option.icon,
        });
      }
    }

    if (column.id === 'shared') {
      return {
        id: column.id,
        label: column.label,
        type: 'select',
        group: 'system',
        options: [
          { value: 'draft', label: 'Draft' },
          { value: 'published', label: 'Published' },
        ],
      };
    }
    if (column.id === 'type') {
      return {
        id: column.id,
        label: column.label,
        type: 'select',
        group: 'system',
        options: trackerTypes.map(model => ({ value: model.type, label: model.displayName })),
      };
    }
    return {
      id: column.id,
      label: column.label,
      group: column.role
        ? 'common'
        : STRUCTURAL_ORDER.has(column.id) ? 'system' : 'custom',
      type: representativeField?.type
        ?? (column.render === 'date' ? 'date'
          : column.render === 'tags' ? 'array'
            : column.render === 'avatar' ? 'user'
              : optionMap.size > 0 ? 'select' : 'string'),
      multiValue: representativeField?.multiValue,
      options: optionMap.size > 0
        ? Array.from(optionMap, ([value, option]) => ({ value, ...option }))
        : representativeField?.options,
    };
  });

  if (!fields.some(field => field.id === 'owner' || availableColumns.some(
    column => column.id === field.id && column.role === 'assignee',
  ))) {
    fields.splice(Math.min(3, fields.length), 0, {
      id: 'owner',
      label: 'Owner',
      type: 'user',
      group: 'common',
    });
  }
  if (!fields.some(field => field.id === 'favorite')) {
    fields.push({
      id: 'favorite',
      label: 'Starred',
      type: 'boolean',
      group: 'system',
      options: [
        { value: 'true', label: 'Yes' },
        { value: 'false', label: 'No' },
      ],
    });
  }
  if (!fields.some(field => field.id === 'archived')) {
    fields.push({ id: 'archived', label: 'Archived', type: 'boolean', group: 'system' });
  }
  if (!fields.some(field => field.id === READINESS_FILTER_FIELD)) {
    fields.push({
      id: READINESS_FILTER_FIELD,
      label: 'Readiness',
      type: 'select',
      group: 'system',
      options: [
        { value: 'ready', label: 'Ready' },
        { value: 'blocked', label: 'Blocked' },
        { value: 'closed', label: 'Closed' },
      ],
    });
  }

  const statusOptions = new Map<string, {
    value: string;
    label: string;
    color?: string;
    icon?: string;
  }>();
  for (const model of trackerTypes) {
    const statusFieldName = model.roles?.workflowStatus;
    const statusField = statusFieldName
      ? model.fields.find(field => field.name === statusFieldName)
      : undefined;
    for (const option of statusField?.options ?? []) {
      statusOptions.set(option.value, {
        value: option.value,
        label: option.label,
        color: option.color,
        icon: option.icon,
      });
    }
  }
  const transitionFields: TrackerFilterField[] = [
    {
      id: STATUS_CHANGED_TO_FILTER_FIELD,
      label: 'Status changed to',
      type: 'select',
      group: 'common',
      options: Array.from(statusOptions.values()),
    },
    {
      id: STATUS_CHANGED_FROM_FILTER_FIELD,
      label: 'Status changed from',
      type: 'select',
      group: 'common',
      options: Array.from(statusOptions.values()),
    },
  ];
  const statusIndex = fields.findIndex(field => availableColumns.some(
    column => column.id === field.id && column.role === 'workflowStatus',
  ));
  fields.splice(statusIndex >= 0 ? statusIndex + 1 : Math.min(1, fields.length), 0, ...transitionFields);
  return fields;
}

export function getTrackerHeaderFilterValue(
  item: TrackerRecord,
  field: string,
  availableColumns: TrackerColumnDef[],
  filterContext: FilterContext,
): unknown {
  const role = availableColumns.find(column => column.id === field)?.role;
  if (role) {
    return getCellValue(item, resolveRoleFieldName(item.primaryType, role));
  }
  return getTrackerFilterValue(item, field, filterContext);
}
