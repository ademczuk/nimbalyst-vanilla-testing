/**
 * Codec-free pieces of a tracker body seed. Kept apart from `seedTrackerBody`
 * so the data source can name the room without reaching the Markdown/Lexical
 * codec; `trackers-ui` must carry no Lexical graph, lazy or not.
 */
import type { Doc } from 'yjs';
import type { DocumentSyncStatus } from '@nimbalyst/runtime/sync/documentSyncTypes';

/** The slice of `DocumentSyncProvider` a body seed needs. */
export interface TrackerBodyRoom {
  getYDoc(): Doc;
  connect(): Promise<void>;
  isSynced(): boolean;
  hasUndecodedContent(): boolean;
  onStatusChange(listener: (status: DocumentSyncStatus) => void): () => void;
  flushWithAck(timeoutMs?: number): Promise<boolean>;
  destroy(): void;
}

/** Shape of `seedTrackerBody`, for hosts that inject it. */
export type TrackerBodySeeder = (room: TrackerBodyRoom, markdown: string) => Promise<void>;

export function trackerBodyDocumentId(itemId: string): string {
  return `tracker-content/${itemId}`;
}
