/**
 * Which schema fields the quick-create popup puts in front of you, and which
 * values survive a create or a type switch.
 *
 * Pure over schema + values so the rules are assertable without rendering the
 * popup. A tracker with fifteen fields must not turn a capture surface into a
 * second inspector, and a rapid-fire run must not silently inherit `critical`
 * from the first item — both decisions live here.
 */

import {
  getTrackerFieldLayout,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerFieldLayout';
import { isCollectionRelationshipField } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/trackerCollections';
import type {
  FieldDefinition,
  TrackerDataModel,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel';

export interface QuickCreateFieldSplit {
  /** Always visible: required fields, the role-mapped four, and `displayInline`. */
  primary: FieldDefinition[];
  /** Behind the "More fields" disclosure. */
  more: FieldDefinition[];
}

/** Role field names for this model, with the conventional fallbacks. */
export function quickCreateRoleFields(model: TrackerDataModel | undefined): {
  status: string;
  priority: string;
  assignee: string;
  tags: string;
} {
  const roles = model?.roles ?? {};
  return {
    status: roles.workflowStatus ?? 'status',
    priority: roles.priority ?? 'priority',
    assignee: roles.assignee ?? 'owner',
    tags: roles.tags ?? 'tags',
  };
}

export function splitQuickCreateFields(
  type: string,
  model: TrackerDataModel | undefined,
): QuickCreateFieldSplit {
  const layout = getTrackerFieldLayout(type);
  const roles = quickCreateRoleFields(model);
  const promoted = new Set<string>([roles.status, roles.priority, roles.assignee, roles.tags]);

  const primary: FieldDefinition[] = [];
  const more: FieldDefinition[] = [];
  for (const field of layout) {
    if (field.required || field.displayInline || promoted.has(field.name)) primary.push(field);
    else more.push(field);
  }
  return { primary, more };
}

/**
 * Field names whose value carries into the next item of a rapid-fire run.
 *
 * Entering five bugs against the same milestone should not mean picking it five
 * times. Priority is included on purpose and is marked as carried in the UI —
 * an unmarked inherited `critical` is exactly the failure this set risks.
 */
export function stickyQuickCreateFieldNames(
  type: string,
  model: TrackerDataModel | undefined,
): string[] {
  const roles = quickCreateRoleFields(model);
  const sticky = new Set<string>([roles.priority, roles.assignee, roles.tags]);
  for (const field of model?.fields ?? []) {
    if (isCollectionRelationshipField(field)) sticky.add(field.name);
  }
  return getTrackerFieldLayout(type)
    .filter((field) => sticky.has(field.name))
    .map((field) => field.name);
}

/**
 * Values to keep after a create: the sticky fields that actually hold a value.
 * Everything else — including the status, which always restarts at the schema
 * default — is dropped.
 */
export function carryStickyValues(
  values: Record<string, unknown>,
  stickyNames: string[],
): { values: Record<string, unknown>; carried: string[] } {
  const next: Record<string, unknown> = {};
  const carried: string[] = [];
  for (const name of stickyNames) {
    const value = values[name];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    next[name] = value;
    carried.push(name);
  }
  return { values: next, carried };
}

/**
 * Values that survive a type switch: a field the target schema also declares
 * under the same name, with a compatible type. Everything else is dropped
 * rather than written into a field that cannot hold it.
 */
export function carryValuesAcrossTypes(
  values: Record<string, unknown>,
  nextModel: TrackerDataModel | undefined,
  previousModel: TrackerDataModel | undefined,
): Record<string, unknown> {
  if (!nextModel) return {};
  const previousByName = new Map((previousModel?.fields ?? []).map((field) => [field.name, field]));
  const next: Record<string, unknown> = {};
  for (const field of nextModel.fields) {
    const value = values[field.name];
    if (value === undefined) continue;
    const previous = previousByName.get(field.name);
    if (previous && previous.type !== field.type) continue;
    // A select value that the target schema does not offer would render as an
    // out-of-schema chip and fail validation on create.
    if (field.type === 'select' && field.options && !field.options.some((o) => o.value === value)) {
      continue;
    }
    next[field.name] = value;
  }
  return next;
}
