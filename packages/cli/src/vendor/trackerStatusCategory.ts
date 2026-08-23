/**
 * VENDORED SUBSET of
 * `packages/runtime/src/plugins/TrackerPlugin/models/trackerStatusCategory.ts`.
 *
 * The CLI cannot import the runtime's Vite bundle from Node ESM. This copy keeps
 * only the status-category functions required by tracker readiness. Direct mode
 * supplies the app-materialized type models from `tracker_type_defs`, so custom
 * declared categories still win over the legacy-name fallback without loading
 * the runtime registry.
 *
 * KEEP IN SYNC with the runtime module. Changes to status resolution must be
 * mirrored here or the app and direct CLI can disagree about cleared blockers.
 */

export type StatusCategory =
  | 'backlog'
  | 'unstarted'
  | 'started'
  | 'done'
  | 'cancelled';

interface StatusOption {
  value: string;
  category?: StatusCategory;
}

export interface TrackerReadinessTypeModel {
  type: string;
  roles?: Record<string, string>;
  fields?: Array<{
    name: string;
    type: string;
    default?: unknown;
    options?: Array<StatusOption | string>;
    relationshipTypeKey?: string;
  }>;
}

const TERMINAL_CATEGORIES: ReadonlySet<StatusCategory> = new Set(['done', 'cancelled']);

const LEGACY_CATEGORY_BY_NAME: Record<string, StatusCategory> = {
  'done': 'done',
  'completed': 'done',
  'complete': 'done',
  'closed': 'done',
  'resolved': 'done',
  'released': 'done',
  'shipped': 'done',
  'implemented': 'done',
  'decided': 'done',
  'fixed': 'done',
  'cancelled': 'cancelled',
  'canceled': 'cancelled',
  'rejected': 'cancelled',
  'declined': 'cancelled',
  'abandoned': 'cancelled',
  'obsolete': 'cancelled',
  'superseded': 'cancelled',
  'duplicate': 'cancelled',
  'wont-do': 'cancelled',
  'wont-fix': 'cancelled',
  "won't-do": 'cancelled',
  "won't-fix": 'cancelled',
  'not-planned': 'cancelled',
  'in-progress': 'started',
  'in-development': 'started',
  'in-review': 'started',
  'changes-requested': 'started',
  'approved': 'started',
  'blocked': 'started',
  'active': 'started',
  'to-do': 'unstarted',
  'todo': 'unstarted',
  'open': 'unstarted',
  'planned': 'unstarted',
  'ready': 'unstarted',
  'ready-for-development': 'unstarted',
  'draft': 'backlog',
  'new': 'backlog',
  'backlog': 'backlog',
  'proposed': 'backlog',
  'triage': 'backlog',
};

const typeModels = new Map<string, TrackerReadinessTypeModel>();

export function replaceTrackerReadinessTypeModels(
  models: Iterable<TrackerReadinessTypeModel>,
): void {
  typeModels.clear();
  for (const model of models) typeModels.set(model.type, model);
}

export function getTrackerReadinessTypeModel(
  type: string,
): TrackerReadinessTypeModel | undefined {
  return typeModels.get(type);
}

function normalize(status: string | null | undefined): string {
  return String(status ?? '').trim().toLowerCase();
}

function isStatusCategory(value: unknown): value is StatusCategory {
  return (
    value === 'backlog' ||
    value === 'unstarted' ||
    value === 'started' ||
    value === 'done' ||
    value === 'cancelled'
  );
}

function getWorkflowStatusFieldName(type: string): string {
  return getTrackerReadinessTypeModel(type)?.roles?.workflowStatus ?? 'status';
}

function getWorkflowStatusOptions(type: string): StatusOption[] {
  const model = getTrackerReadinessTypeModel(type);
  if (!model) return [];
  const fieldName = getWorkflowStatusFieldName(type);
  const options = model.fields?.find((field) => field.name === fieldName)?.options ?? [];
  return options.map((option) =>
    typeof option === 'string' ? { value: option } : option,
  );
}

function resolveKnownStatusCategory(
  type: string,
  statusValue: string | null | undefined,
): StatusCategory | undefined {
  const value = normalize(statusValue);
  if (!value) return undefined;
  const declared = getWorkflowStatusOptions(type)
    .find((option) => normalize(option.value) === value)?.category;
  if (isStatusCategory(declared)) return declared;
  return LEGACY_CATEGORY_BY_NAME[value];
}

export function resolveStatusCategory(
  type: string,
  statusValue: string | null | undefined,
): StatusCategory {
  const value = normalize(statusValue);
  if (!value) return 'unstarted';

  const known = resolveKnownStatusCategory(type, value);
  if (known) return known;

  const model = getTrackerReadinessTypeModel(type);
  const options = getWorkflowStatusOptions(type);
  const field = model?.fields?.find((candidate) =>
    candidate.name === getWorkflowStatusFieldName(type)
  );
  const initial = normalize(
    (typeof field?.default === 'string' ? field.default : undefined) ?? options[0]?.value,
  );
  return initial && initial === value ? 'unstarted' : 'started';
}

export function isTerminalStatus(
  type: string,
  statusValue: string | null | undefined,
): boolean {
  return TERMINAL_CATEGORIES.has(resolveStatusCategory(type, statusValue));
}

export const READINESS_FILTER_FIELD = 'readiness';
