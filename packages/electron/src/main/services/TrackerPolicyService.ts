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

function normalizeSharingPolicy(policy: Partial<TrackerSharingPolicy> | TrackerSharing): TrackerSharingPolicy {
  const sharing: TrackerSharing = policy === 'team' || (typeof policy === 'object' && policy?.sharing === 'team')
    ? 'team'
    : 'personal';
  return {
    sharing,
    draftByDefault: sharing === 'team' && typeof policy === 'object' && policy?.draftByDefault === true,
  };
}

/** Why a policy could not be resolved. Both mean "do not guess", not "personal". */
export type TrackerSharingUnresolvedReason =
  /** The workspace's schemas are loaded, and this type is not among them. */
  | 'no-model'
  /** No schema layer is cached for this workspace at all — it may not be loaded yet. */
  | 'no-layer';

/**
 * The result of a policy read, with "I do not know" as a first-class answer.
 *
 * `normalizeSharingPolicy` used to take `undefined` and return `personal`, so
 * "this tracker is private" and "I have not loaded this schema yet" were the
 * same value. Every consequence in NIM-3702 and NIM-2968 follows from that one
 * collapse — including a reconnect drain that read a registry miss as a
 * deliberate unshare and deleted 26 items out of a team's tracker room.
 */
export type TrackerSharingResolution =
  | { known: true; policy: TrackerSharingPolicy }
  | {
      known: false;
      reason: TrackerSharingUnresolvedReason;
      trackerType: string;
      workspacePath: string;
    };

/**
 * Resolve a tracker's sharing policy for an explicit workspace.
 *
 * Use this anywhere the answer drives a WRITE — `sync_status`, or a push /
 * skip / delete decision. Callers must handle `known: false`; there is no safe
 * default for a write, which is the whole point.
 *
 * For display-only reads see `getEffectiveTrackerSharingPolicy`.
 */
export function resolveTrackerSharingPolicy(
  workspacePath: string,
  trackerType: string,
  callerPolicy?: Partial<TrackerSharingPolicy> | TrackerSharing,
): TrackerSharingResolution {
  const model = globalRegistry.getForWorkspace(workspacePath, trackerType);
  const source = model ?? callerPolicy;
  if (source == null) {
    return {
      known: false,
      // `no-layer` says the workspace's schemas may simply not be loaded yet,
      // which is the case a retry can rescue. `no-model` says they are loaded
      // and this type is genuinely not among them.
      reason: globalRegistry.hasWorkspaceLayer(workspacePath) ? 'no-model' : 'no-layer',
      trackerType,
      workspacePath,
    };
  }
  return { known: true, policy: normalizeSharingPolicy(source) };
}

/**
 * Display-only policy read. Collapses an unresolved policy to `personal`,
 * because rendering an unresolvable tracker as private is the safe direction
 * for a *display*.
 *
 * It is the wrong direction for a write — `personal` on a previously-shared
 * item means "delete it from the room" — so this must not be reachable from the
 * sync lane. `scripts/check-tracker-policy-reads.mjs` enforces that; use
 * `resolveTrackerSharingPolicy` for anything that decides a sync outcome.
 */
export function getEffectiveTrackerSharingPolicy(
  workspacePath: string,
  trackerType: string,
  callerPolicy?: Partial<TrackerSharingPolicy> | TrackerSharing,
): TrackerSharingPolicy {
  const resolution = resolveTrackerSharingPolicy(workspacePath, trackerType, callerPolicy);
  return resolution.known ? resolution.policy : { sharing: 'personal', draftByDefault: false };
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

export type BackfillAction = 'upsert' | 'delete' | 'skip' | 'abort';

/**
 * The per-row verdict for the reconnect drain.
 *
 * Takes a resolution rather than a policy so the unresolved case cannot be
 * silently omitted. Before NIM-2968 this took a policy, an unresolved read
 * arrived as `personal`, and the `previouslyPublished` branch below deleted the
 * team's copy on the strength of a registry that had failed to load.
 *
 * | Resolution        | Previously shared | Action                        |
 * | ----------------- | ----------------- | ----------------------------- |
 * | team, published   | either            | `upsert`                      |
 * | personal          | yes               | `delete` — a real unshare     |
 * | personal          | no                | `skip`                        |
 * | **unresolved**    | **yes**           | **`abort` the run**           |
 * | unresolved        | no                | `skip` — nothing to destroy   |
 */
export function decideBackfillAction(
  resolution: TrackerSharingResolution,
  source: Record<string, any> | null | undefined,
  previouslyPublished: boolean,
): BackfillAction {
  if (!resolution.known) {
    // Deleting on a guess is the one outcome that is never recoverable here.
    // A never-shared row has nothing in the room to lose, so it degrades to a
    // counted skip rather than taking the whole drain down.
    return previouslyPublished ? 'abort' : 'skip';
  }
  if (shouldSyncTrackerItem(resolution.policy, source)) return 'upsert';
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
