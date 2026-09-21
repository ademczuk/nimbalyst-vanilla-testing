import type { PersonalSyncWriteGateSnapshot } from '@nimbalyst/runtime/sync/personalSyncWriteGate';

/** Shared by the status query and the live status broadcast. */
export interface SessionSyncStatus {
  connected: boolean;
  syncing: boolean;
  error: string | null;
  skippedRowCount?: number;
  personalSyncWriteGate?: PersonalSyncWriteGateSnapshot | null;
}
