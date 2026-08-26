// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGlobalRegistryGet, mockHasWorkspaceLayer } = vi.hoisted(() => ({
  mockGlobalRegistryGet: vi.fn((..._args: any[]) => undefined as any),
  mockHasWorkspaceLayer: vi.fn((..._args: any[]) => true),
}));

vi.mock('@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel', () => ({
  globalRegistry: {
    get: mockGlobalRegistryGet,
    // The policy resolver reads by explicit workspace (NIM-3702); the workspace
    // argument is irrelevant to these cases, so both spellings share one stub.
    getForWorkspace: (_workspacePath: string, type: string) => mockGlobalRegistryGet(type),
    hasWorkspaceLayer: mockHasWorkspaceLayer,
  },
}));

import {
  decideBackfillAction,
  getEffectiveTrackerSharingPolicy,
  getInitialTrackerSyncStatus,
  isTrackerItemPublished,
  migrateTrackerSharingModels,
  resolveTrackerSharingPolicy,
  shouldSyncTrackerItem,
} from '../TrackerPolicyService';

/** A resolution that succeeded, for the cases that are not about the miss. */
const known = (sharing: 'team' | 'personal', draftByDefault = false) =>
  ({ known: true, policy: { sharing, draftByDefault } }) as const;

describe('TrackerPolicyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGlobalRegistryGet.mockReturnValue(undefined);
  });

  it('reads the single sharing policy from the tracker model', () => {
    mockGlobalRegistryGet.mockReturnValue({ sharing: 'team', draftByDefault: true });

    expect(getEffectiveTrackerSharingPolicy('/tmp/ws', 'plan')).toEqual({
      sharing: 'team',
      draftByDefault: true,
    });
  });

  it('uses caller model data when the main-process registry is not loaded', () => {
    expect(getEffectiveTrackerSharingPolicy('/tmp/ws', 'bug', {
      sharing: 'team',
      draftByDefault: false,
    })).toEqual({ sharing: 'team', draftByDefault: false });
  });

  it('defaults an unknown tracker to personal on the display-only read', () => {
    // The wrapper still collapses, deliberately: showing an unresolvable tracker
    // as private is the safe direction FOR A DISPLAY. It is the wrong direction
    // for a write, which is why the sync lane uses resolveTrackerSharingPolicy.
    expect(getEffectiveTrackerSharingPolicy('/tmp/ws', 'unknown')).toEqual({
      sharing: 'personal',
      draftByDefault: false,
    });
  });

  describe('resolveTrackerSharingPolicy', () => {
    it('reports a registry miss as unknown rather than answering personal', () => {
      // NIM-2968: `undefined -> personal` is what let the drain read "I have not
      // loaded this schema" as "the user made this private" and delete the
      // team's copy. The miss must be representable.
      const resolution = resolveTrackerSharingPolicy('/tmp/ws', 'unknown');

      expect(resolution.known).toBe(false);
      expect(resolution).toMatchObject({ reason: 'no-model', trackerType: 'unknown' });
    });

    it('resolves a registered tracker', () => {
      mockGlobalRegistryGet.mockReturnValue({ sharing: 'team', draftByDefault: true });

      expect(resolveTrackerSharingPolicy('/tmp/ws', 'plan')).toEqual(known('team', true));
    });

    it('falls back to the caller policy only when the registry misses', () => {
      expect(resolveTrackerSharingPolicy('/tmp/ws', 'bug', { sharing: 'team', draftByDefault: false }))
        .toEqual(known('team'));
    });
  });

  it('maps personal items to local and published team items to pending', () => {
    expect(getInitialTrackerSyncStatus({ sharing: 'personal', draftByDefault: false })).toBe('local');
    expect(getInitialTrackerSyncStatus({ sharing: 'team', draftByDefault: false })).toBe('pending');
  });

  it('starts unflagged items as drafts only when the team tracker defaults to drafts', () => {
    const drafts = { sharing: 'team' as const, draftByDefault: true };
    expect(getInitialTrackerSyncStatus(drafts)).toBe('local');
    expect(getInitialTrackerSyncStatus(drafts, {})).toBe('local');
    expect(getInitialTrackerSyncStatus(drafts, { shared: true })).toBe('pending');
    expect(getInitialTrackerSyncStatus(drafts, { share: { status: 'team' } })).toBe('pending');
  });

  describe('isTrackerItemPublished', () => {
    it('uses the tracker default when the item has no explicit state', () => {
      expect(isTrackerItemPublished(null, false)).toBe(true);
      expect(isTrackerItemPublished({}, false)).toBe(true);
      expect(isTrackerItemPublished({}, true)).toBe(false);
    });

    it('recognizes the existing per-item boolean in draft/published vocabulary', () => {
      expect(isTrackerItemPublished({ shared: true }, true)).toBe(true);
      expect(isTrackerItemPublished({ shared: false }, false)).toBe(false);
    });

    it('recognizes legacy frontmatter sharing values as the same published bit', () => {
      expect(isTrackerItemPublished({ share: { status: 'team' } }, true)).toBe(true);
      expect(isTrackerItemPublished({ share: { status: 'private' } }, false)).toBe(false);
      expect(isTrackerItemPublished({ share: { body: 'team' } }, true)).toBe(true);
      expect(isTrackerItemPublished({ share: { body: 'private' } }, false)).toBe(false);
    });

    it('recognizes the existing bit nested under customFields', () => {
      expect(isTrackerItemPublished({ customFields: { shared: true } }, true)).toBe(true);
      expect(isTrackerItemPublished({ customFields: { shared: false } }, false)).toBe(false);
    });
  });

  describe('shouldSyncTrackerItem', () => {
    it('never syncs a personal tracker', () => {
      expect(shouldSyncTrackerItem({ sharing: 'personal', draftByDefault: false }, { shared: true })).toBe(false);
    });

    it('syncs published items and keeps drafts local in a team tracker', () => {
      const drafts = { sharing: 'team' as const, draftByDefault: true };
      expect(shouldSyncTrackerItem(drafts, {})).toBe(false);
      expect(shouldSyncTrackerItem(drafts, { shared: true })).toBe(true);
      const published = { sharing: 'team' as const, draftByDefault: false };
      expect(shouldSyncTrackerItem(published, {})).toBe(true);
      expect(shouldSyncTrackerItem(published, { shared: false })).toBe(false);
    });
  });

  describe('legacy migration', () => {
    it.each([
      ['local', 'personal', false],
      ['shared', 'team', false],
      ['hybrid', 'team', true],
    ] as const)('maps legacy schema mode %s', (mode, sharing, draftByDefault) => {
      const legacy = { type: 'bug', sync: { mode, scope: 'project' } } as any;
      const result = migrateTrackerSharingModels([legacy], {}, 123);

      expect(result.models[0]).toMatchObject({ type: 'bug', sharing, draftByDefault });
      expect(result.models[0]).not.toHaveProperty('sync');
      expect(result.report.entries).toEqual([{
        trackerType: 'bug',
        legacySchemaMode: mode,
        legacyItemMode: null,
        sharing,
        draftByDefault,
        diverged: false,
      }]);
      expect(result.report.divergences).toEqual([]);
    });

    it('lets the legacy item policy win and reports disagreement as structured data', () => {
      const result = migrateTrackerSharingModels(
        [{ type: 'plan', sync: { mode: 'shared', scope: 'workspace' } } as any],
        { plan: { mode: 'local', scope: 'workspace' } },
        456,
      );

      expect(result.models[0]).toMatchObject({ sharing: 'personal', draftByDefault: false });
      expect(result.report.migratedAt).toBe(456);
      expect(result.report.divergences).toEqual([{
        trackerType: 'plan',
        legacySchemaMode: 'shared',
        legacyItemMode: 'local',
        sharing: 'personal',
        draftByDefault: false,
        diverged: true,
      }]);
    });
  });

  describe('decideBackfillAction', () => {
    const drafts = known('team', true);

    it('upserts a published item regardless of prior state', () => {
      expect(decideBackfillAction(drafts, { shared: true }, false)).toBe('upsert');
      expect(decideBackfillAction(drafts, { shared: true }, true)).toBe('upsert');
    });

    it('deletes a draft that was previously published and skips a never-published draft', () => {
      expect(decideBackfillAction(drafts, {}, true)).toBe('delete');
      expect(decideBackfillAction(drafts, {}, false)).toBe('skip');
    });

    it('aborts rather than deleting when the policy could not be resolved', () => {
      // The NIM-2968 branch. A miss and a deliberate unshare were the same
      // value, so an unloaded registry deleted 26 team items.
      const unresolved = {
        known: false as const, reason: 'no-model' as const,
        trackerType: 'bug', workspacePath: '/tmp/ws',
      };

      expect(decideBackfillAction(unresolved, {}, true)).toBe('abort');
    });

    it('skips rather than aborting when an unresolved item was never shared', () => {
      // Nothing to destroy, so an unresolved policy here is not worth taking the
      // whole run down for -- but it is still counted separately, not as routine.
      const unresolved = {
        known: false as const, reason: 'no-layer' as const,
        trackerType: 'bug', workspacePath: '/tmp/ws',
      };

      expect(decideBackfillAction(unresolved, {}, false)).toBe('skip');
    });
  });
});
