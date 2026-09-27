/**
 * Write a new tracker item's body into its collaborative document room,
 * `tracker-content/<itemId>`, the same room and document shape a desktop
 * writes (`initializeHeadlessBodyMarkdown`).
 *
 * The guard is the desktop's: a room already holding this exact markdown is a
 * retry and is left alone; a room holding anything else -- including an empty
 * body with history, which someone may have cleared on purpose -- is refused
 * rather than overwritten. The write only counts once the server acknowledges
 * it.
 *
 * Conversion uses the React-free writer (`runtime/src/sync/markdownYDoc.ts`),
 * which produces the same document the editor-side adapter does, so this
 * headless entry never pulls in an editor.
 */
import { applyUpdate, decodeStateVector, encodeStateAsUpdate, encodeStateVector } from 'yjs';
import { lexicalYDocToMarkdown, markdownToLexicalYUpdate } from '@nimbalyst/runtime/sync/markdownYDoc';
import type { TrackerBodyRoom } from './trackerBodyRoom';

export { trackerBodyDocumentId, type TrackerBodyRoom } from './trackerBodyRoom';

const SYNC_TIMEOUT_MS = 10_000;
const ACK_TIMEOUT_MS = 8_000;

function waitForSync(room: TrackerBodyRoom, timeoutMs: number): Promise<void> {
  if (room.isSynced()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('The item body could not be reached. The item was not created.'));
    }, timeoutMs);
    const unsubscribe = room.onStatusChange((status) => {
      if (!room.isSynced() && status !== 'error') return;
      clearTimeout(timer);
      unsubscribe();
      if (room.isSynced()) resolve();
      else reject(new Error('The item body could not be opened. The item was not created.'));
    });
  });
}

export async function seedTrackerBody(room: TrackerBodyRoom, markdown: string): Promise<void> {
  try {
    void room.connect();
    await waitForSync(room, SYNC_TIMEOUT_MS);
    if (room.hasUndecodedContent()) {
      throw new Error('The item body already has content this browser cannot read. The item was not created.');
    }
    const doc = room.getYDoc();
    const hasHistory = decodeStateVector(encodeStateVector(doc)).size > 0;
    const current = hasHistory ? lexicalYDocToMarkdown(encodeStateAsUpdate(doc)) : '';
    if (current.trimEnd() !== markdown.trimEnd()) {
      if (hasHistory) throw new Error('The item body already has edits. The item was not created.');
      applyUpdate(doc, markdownToLexicalYUpdate(markdown));
    }
    if (!(await room.flushWithAck(ACK_TIMEOUT_MS))) {
      throw new Error('The item body was not acknowledged by the server. The item was not created.');
    }
  } finally {
    room.destroy();
  }
}
