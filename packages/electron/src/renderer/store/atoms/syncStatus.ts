/**
 * Sync Status Atom
 *
 * Holds the latest partial sync status broadcast by the main process via
 * the `sync:status-changed` IPC event. Components merge this into their
 * full status snapshot.
 *
 * Updated by store/listeners/syncListeners.ts.
 */

import { atom } from 'jotai';

import type { SessionSyncStatus } from '../../../shared/sessionSyncStatus';
export type SyncStatusUpdate = SessionSyncStatus;

export const syncStatusUpdateAtom = atom<SyncStatusUpdate | null>(null);
