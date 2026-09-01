import type { StatusCategory } from "./trackerStatusCategory.js";

export interface TrackerFieldOption {
  value: string;
  label?: string;
  icon?: string;
  color?: string;
  category?: StatusCategory;
}

export interface TrackerFieldDefinition {
  name: string;
  type: string;
  required?: boolean;
  displayInline?: boolean;
  default?: unknown;
  options?: Array<TrackerFieldOption | string>;
  relationshipTypeKey?: string;
  targetTrackerTypes?: string[] | "*";
  multiValue?: boolean;
}

export interface TrackerTypeModel {
  type: string;
  fields: TrackerFieldDefinition[];
  roles?: Record<string, string | undefined>;
}

/** Per-request schema lookup. Hosts must never share mutable module-level registry state. */
export interface TrackerCoreContext {
  getTypeModel(type: string): TrackerTypeModel | undefined;
}

export function createTrackerCoreContext(
  getTypeModel: TrackerCoreContext["getTypeModel"]
): TrackerCoreContext {
  return { getTypeModel };
}
