import {
  globalRegistry,
  type TrackerDataModel,
  type TrackerSharing,
  type TrackerSharingPolicy,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel';

export type LegacyTrackerSharing = 'local' | 'shared' | 'hybrid';
export type LegacyTrackerSyncPolicy =
  | LegacyTrackerSharing
  | { mode?: LegacyTrackerSharing; scope?: unknown }
  | undefined;

export interface TrackerSharingMigrationEntry extends TrackerSharingPolicy {
  trackerType: string;
  legacySchemaMode: LegacyTrackerSharing;
  legacyItemMode: LegacyTrackerSharing | null;
  diverged: boolean;
}

export interface TrackerSharingMigrationReport {
  version: 1;
  migratedAt: number;
  entries: TrackerSharingMigrationEntry[];
  divergences: TrackerSharingMigrationEntry[];
}

function isLegacyMode(value: unknown): value is LegacyTrackerSharing {
  return value === 'local' || value === 'shared' || value === 'hybrid';
}

function legacyModeFromPolicy(policy: LegacyTrackerSyncPolicy): LegacyTrackerSharing | null {
  if (isLegacyMode(policy)) return policy;
  return isLegacyMode(policy?.mode) ? policy.mode : null;
}

function sharingFromLegacyMode(mode: LegacyTrackerSharing): TrackerSharingPolicy {
  if (mode === 'local') return { sharing: 'personal', draftByDefault: false };
  return { sharing: 'team', draftByDefault: mode === 'hybrid' };
}

function legacyModeFromModel(model: TrackerDataModel): LegacyTrackerSharing {
  const legacy = (model as TrackerDataModel & { sync?: { mode?: unknown } }).sync?.mode;
  if (isLegacyMode(legacy)) return legacy;
  if (model.sharing !== 'team') return 'local';
  return model.draftByDefault ? 'hybrid' : 'shared';
}

function normalizeSharingPolicy(policy: Partial<TrackerSharingPolicy> | TrackerSharing | null | undefined): TrackerSharingPolicy {
  const sharing: TrackerSharing = policy === 'team' || (typeof policy === 'object' && policy?.sharing === 'team')
    ? 'team'
    : 'personal';
  return {
    sharing,
    draftByDefault: sharing === 'team' && typeof policy === 'object' && policy?.draftByDefault === true,
  };
}

/** Resolve the one tracker-level sharing policy. The workspace path is retained for call-site symmetry. */
export function getEffectiveTrackerSharingPolicy(
  _workspacePath: string,
  trackerType: string,
  callerPolicy?: Partial<TrackerSharingPolicy> | TrackerSharing,
): TrackerSharingPolicy {
  const model = globalRegistry.get(trackerType);
  return normalizeSharingPolicy(model ?? callerPolicy);
}

/** True when the tracker has any team-visible item lane. */
export function shouldSyncTrackerPolicy(policy: TrackerSharingPolicy): boolean {
  return policy.sharing === 'team';
}

type ExplicitPublishedState = boolean | undefined;

function readExplicitPublishedState(source: Record<string, any> | null | undefined): ExplicitPublishedState {
  if (!source) return undefined;
  const read = (value: any): ExplicitPublishedState => {
    if (!value || typeof value !== 'object') return undefined;
    if (typeof value.shared === 'boolean') return value.shared;
    if (value.share && typeof value.share === 'object') {
      if (value.share.status === 'team' || value.share.body === 'team') return true;
      if (value.share.status === 'private' || value.share.body === 'private') return false;
    }
    return undefined;
  };
  return read(source) ?? read(source.customFields);
}

/**
 * Read the existing per-item shared bit as Draft/Published. No parallel state is
 * introduced: `shared` and legacy frontmatter share values remain the storage
 * representation until a later item-storage migration deliberately changes it.
 */
export function isTrackerItemPublished(
  source: Record<string, any> | null | undefined,
  draftByDefault: boolean,
): boolean {
  return readExplicitPublishedState(source) ?? !draftByDefault;
}

export function shouldSyncTrackerItem(
  policy: TrackerSharingPolicy,
  source: Record<string, any> | null | undefined,
): boolean {
  return policy.sharing === 'team' && isTrackerItemPublished(source, policy.draftByDefault);
}

export type BackfillAction = 'upsert' | 'delete' | 'skip';

export function decideBackfillAction(
  policy: TrackerSharingPolicy,
  source: Record<string, any> | null | undefined,
  previouslyPublished: boolean,
): BackfillAction {
  if (shouldSyncTrackerItem(policy, source)) return 'upsert';
  return previouslyPublished ? 'delete' : 'skip';
}

export function getInitialTrackerSyncStatus(
  policy: TrackerSharingPolicy,
  source?: Record<string, any> | null,
): 'local' | 'pending' {
  return shouldSyncTrackerItem(policy, source ?? null) ? 'pending' : 'local';
}

/**
 * Pure legacy migration. The per-machine item policy wins whenever present,
 * because it governed the data users actually saw. Every result drops `sync`
 * and emits the new top-level shape.
 */
export function migrateTrackerSharingModels(
  models: TrackerDataModel[],
  legacyItemPolicies: Record<string, LegacyTrackerSyncPolicy>,
  migratedAt = Date.now(),
): { models: TrackerDataModel[]; report: TrackerSharingMigrationReport } {
  const entries: TrackerSharingMigrationEntry[] = [];
  const migratedModels = models.map((model) => {
    const legacySchemaMode = legacyModeFromModel(model);
    const legacyItemMode = legacyModeFromPolicy(legacyItemPolicies[model.type]);
    const resolved = sharingFromLegacyMode(legacyItemMode ?? legacySchemaMode);
    const diverged = legacyItemMode !== null && legacyItemMode !== legacySchemaMode;
    const { sync: _legacySync, ...rest } = model as TrackerDataModel & { sync?: unknown };
    entries.push({
      trackerType: model.type,
      legacySchemaMode,
      legacyItemMode,
      ...resolved,
      diverged,
    });
    return { ...rest, ...resolved };
  });
  return {
    models: migratedModels,
    report: {
      version: 1,
      migratedAt,
      entries,
      divergences: entries.filter((entry) => entry.diverged),
    },
  };
}
