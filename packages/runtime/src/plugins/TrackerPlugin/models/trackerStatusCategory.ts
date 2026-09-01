import {
  getDoneStatusValue as coreGetDoneStatusValue,
  getStatusValueForCategory as coreGetStatusValueForCategory,
  getWorkflowStatusFieldName as coreGetWorkflowStatusFieldName,
  getWorkflowStatusOptions as coreGetWorkflowStatusOptions,
  isCancelledStatus as coreIsCancelledStatus,
  isDoneStatus as coreIsDoneStatus,
  isTerminalStatus as coreIsTerminalStatus,
  resolveKnownStatusCategory as coreResolveKnownStatusCategory,
  resolveStatusCategory as coreResolveStatusCategory,
  statusCategoryOfItem as coreStatusCategoryOfItem,
  statusValuesInCategories as coreStatusValuesInCategories,
  type StatusCategory,
} from "@nimbalyst/tracker-core";
import type { FieldOption } from "./TrackerDataModel";
import { runtimeTrackerContext } from "./trackerCoreContext";

export {
  OPEN_CATEGORIES,
  READINESS_FILTER_FIELD,
  STATUS_CATEGORIES,
  STATUS_CATEGORY_FILTER_FIELD,
  STATUS_CATEGORY_LABELS,
  TERMINAL_CATEGORIES,
  isStatusCategory,
  statusScopeClause,
} from "@nimbalyst/tracker-core";

export type { StatusCategory } from "@nimbalyst/tracker-core";

export function getWorkflowStatusFieldName(type: string): string {
  return coreGetWorkflowStatusFieldName(runtimeTrackerContext, type);
}

export function getWorkflowStatusOptions(type: string): FieldOption[] {
  return coreGetWorkflowStatusOptions(
    runtimeTrackerContext,
    type
  ) as FieldOption[];
}

export function resolveStatusCategory(
  type: string,
  statusValue: string | null | undefined
): StatusCategory {
  return coreResolveStatusCategory(runtimeTrackerContext, type, statusValue);
}

export function resolveKnownStatusCategory(
  type: string,
  statusValue: string | null | undefined
): StatusCategory | undefined {
  return coreResolveKnownStatusCategory(
    runtimeTrackerContext,
    type,
    statusValue
  );
}

export function isTerminalStatus(
  type: string,
  statusValue: string | null | undefined
): boolean {
  return coreIsTerminalStatus(runtimeTrackerContext, type, statusValue);
}

export function isDoneStatus(
  type: string,
  statusValue: string | null | undefined
): boolean {
  return coreIsDoneStatus(runtimeTrackerContext, type, statusValue);
}

export function isCancelledStatus(
  type: string,
  statusValue: string | null | undefined
): boolean {
  return coreIsCancelledStatus(runtimeTrackerContext, type, statusValue);
}

export function statusValuesInCategories(
  types: readonly string[],
  categories: readonly StatusCategory[]
): Set<string> {
  return coreStatusValuesInCategories(runtimeTrackerContext, types, categories);
}

export function statusCategoryOfItem(
  type: string,
  readField: (fieldName: string) => unknown
): StatusCategory {
  return coreStatusCategoryOfItem(runtimeTrackerContext, type, readField);
}

export function getStatusValueForCategory(
  type: string,
  category: StatusCategory
): string | undefined {
  return coreGetStatusValueForCategory(runtimeTrackerContext, type, category);
}

export function getDoneStatusValue(type: string): string | undefined {
  return coreGetDoneStatusValue(runtimeTrackerContext, type);
}
