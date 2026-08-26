import type { CollabCommand, CollabCommandResult, Unsubscribe } from '@nimbalyst/collab-client/core';
import type { TrackerMutationRejectCode } from '@nimbalyst/collab-protocol';
import type { TrackerItem } from '@nimbalyst/runtime/core/DocumentService';
import type { TeamMemberId } from '@nimbalyst/runtime/auth/jwtScopes';
import type { TrackerAccessTermination } from '@nimbalyst/runtime/sync/trackerAccessTermination';

export type { TrackerItem } from '@nimbalyst/runtime/core/DocumentService';
export type {
  TrackerAccessTermination,
  TrackerAccessTerminationReason,
} from '@nimbalyst/runtime/sync/trackerAccessTermination';

export type TrackerSyncStatus = 'disconnected' | 'connecting' | 'syncing' | 'connected' | 'error';

export interface TrackerSyncState {
  workspacePath: string;
  status: TrackerSyncStatus;
  projectId: string | null;
  /**
   * Why the room refused this client, when it did so permanently.
   *
   * `status` alone cannot carry this: `error` is also what a transient server
   * error looks like, and `disconnected` is what a dropped socket looks like,
   * and both of those are being retried. A surface that cannot tell them apart
   * either spins forever on a revocation or claims a network blip is a
   * permission problem. When this is set, no reconnect is pending and none
   * will be attempted.
   *
   * Optional so a host that cannot observe refusals -- the desktop IPC data
   * source, which sees only the status string -- keeps satisfying the contract.
   */
  access?: TrackerAccessTermination | null;
  /**
   * The reconnect drain refused to run, so team items are not syncing.
   *
   * Like `access`, this cannot ride on `status`: the socket is fine and the
   * status is `connected`. Only the drain declined, because it could not
   * resolve the sharing policy and would otherwise have deleted previously
   * shared items from the room on a guess (NIM-2968).
   *
   * Cleared by the next drain that runs to completion, so a transient
   * resolution failure self-heals rather than sticking.
   */
  drainHold?: TrackerDrainHold | null;
}

/** Why the reconnect drain held back rather than touching the team room. */
export interface TrackerDrainHold {
  reason: 'unresolved-policy-would-delete' | 'zero-upserts-with-deletes';
  /** Local rows waiting on the hold. */
  rowsHeldBack: number;
}

/** Serialized shared-view row projected by TrackerPersistence. */
export interface TrackerSavedViewRecord {
  viewId: string;
  payload: string;
}

export interface TrackerDataSnapshot {
  items: TrackerItem[];
  savedViews: TrackerSavedViewRecord[];
  /** Remote members currently connected to this tracker room. */
  presence: TrackerPresenceMember[];
  sync: TrackerSyncState;
}

export interface TrackerPresenceMember {
  teamMemberId: TeamMemberId;
  displayName: string;
  avatarUrl: string | null;
}

export interface TrackerMutationRejection {
  workspacePath: string;
  itemId: string;
  clientMutationId?: string;
  code: TrackerMutationRejectCode;
  message?: string;
}

export type TrackerDataChange =
  | { type: 'items-replaced'; items: TrackerItem[] }
  | { type: 'items-upserted'; items: TrackerItem[] }
  | { type: 'items-removed'; itemIds: string[] }
  | { type: 'saved-views-replaced'; savedViews: TrackerSavedViewRecord[] }
  | { type: 'presence'; members: TrackerPresenceMember[] }
  | { type: 'status'; sync: TrackerSyncState }
  | { type: 'mutation-rejected'; rejection: TrackerMutationRejection }
  | {
      type: 'config-changed';
      workspacePath: string;
      config: { issueKeyPrefix: string };
    };

export interface TrackerCreateItemInput {
  id: string;
  type: string;
  title: string;
  status: string;
  priority: string;
  workspace: string;
  description?: string;
  owner?: string;
  tags?: string[];
  customFields?: Record<string, unknown>;
  sharing?: 'personal' | 'team';
  draftByDefault?: boolean;
  content?: unknown;
  source?: string;
  sourceRef?: string;
}

export interface TrackerUpdateItemInput {
  itemId: string;
  updates: Record<string, unknown>;
  sharing?: 'personal' | 'team';
  draftByDefault?: boolean;
}

export interface TrackerBatchUpdateInput {
  entries: Array<{
    itemId: string;
    fileUpdates?: Record<string, unknown>;
    storeUpdates?: Record<string, unknown>;
    sharing?: 'personal' | 'team';
    draftByDefault?: boolean;
  }>;
}

export type TrackerDataCommand =
  | { type: 'list-items' }
  | { type: 'refresh-items' }
  | { type: 'create-item'; item: TrackerCreateItemInput }
  | { type: 'update-item'; input: TrackerUpdateItemInput }
  | { type: 'update-items'; input: TrackerBatchUpdateInput }
  | { type: 'archive-item'; itemId: string; archive: boolean }
  | { type: 'delete-item'; itemId: string }
  | { type: 'update-item-content'; itemId: string; content: unknown }
  | { type: 'add-comment'; itemId: string; body: string }
  | {
      type: 'update-comment';
      itemId: string;
      commentId: string;
      body?: string;
      deleted?: boolean;
    }
  | { type: 'share-saved-view'; savedView: TrackerSavedViewRecord }
  | { type: 'unshare-saved-view'; viewId: string }
  | { type: 'reconnect' };

export interface TrackerDataCommandResult extends CollabCommandResult {
  /** The existing host mutation result, preserved without renderer-side reshaping. */
  result?: unknown;
  items?: TrackerItem[];
  savedViews?: TrackerSavedViewRecord[];
}

/**
 * Projection/command seam between tracker UI state and a host-owned sync engine.
 *
 * Desktop proxies the engine through Electron IPC; browsers host it in-page.
 * The lifecycle deliberately matches CollabDataSource without exposing either
 * host's transport.
 */
export interface TrackerDataSource {
  snapshot(): Promise<TrackerDataSnapshot>;
  subscribe(cb: (change: TrackerDataChange) => void): Unsubscribe;
  command(command: TrackerDataCommand): Promise<TrackerDataCommandResult>;
  status(): TrackerSyncState;
  dispose(): void;
}

// Compile-time assertion that tracker commands retain the shared command shape.
const _trackerDataCommand: CollabCommand = {} as TrackerDataCommand;
void _trackerDataCommand;
