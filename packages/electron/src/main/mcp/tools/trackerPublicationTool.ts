import { globalRegistry } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel';
import type { TrackerItem } from '@nimbalyst/runtime';
import type { ElectronDocumentService } from '../../services/ElectronDocumentService';
import { isTrackerSyncActive, isTrackerSyncConfigured } from '../../services/TrackerSyncManager';
import { awaitServerIssueKey } from '../../services/tracker/awaitServerIssueKey';
import { resolveTrackerRowByReference } from './trackerToolItemAccess';
import {
  getAssignedIssueKey,
  getTrackerDisplayRef,
  issueKeyAvailabilityNote,
  issueKeyMessage,
  issueKeyStatus,
  type McpToolResult,
} from './trackerToolResult';

export async function handleTrackerPublicationUpdate(
  args: any,
  item: TrackerItem,
  workspacePath: string | undefined,
  db: { query: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[] }> },
  docService: ElectronDocumentService | undefined,
  rowToTrackerItem: (row: any) => TrackerItem,
): Promise<McpToolResult> {
  const combinedMutation = [
    'title', 'status', 'priority', 'description', 'tags', 'archived',
    'owner', 'dueDate', 'progress', 'assigneeEmail', 'reporterEmail',
    'assigneeId', 'reporterId', 'labels', 'linkedCommitSha', 'typeTags',
    'primaryType', 'fields', 'unsetFields', 'linkSession',
  ].find((key) => args[key] !== undefined);
  if (combinedMutation) {
    return {
      content: [{ type: 'text', text: 'Publish or unpublish an item in a separate tracker_update call from content and field changes.' }],
      isError: true,
    };
  }
  if (typeof args.published !== 'boolean') {
    return {
      content: [{ type: 'text', text: 'published must be a boolean.' }],
      isError: true,
    };
  }
  const model = globalRegistry.get(item.type);
  if (model?.sharing !== 'team') {
    return {
      content: [{ type: 'text', text: `Tracker '${item.type}' is personal. Promote the tracker before publishing its items.` }],
      isError: true,
    };
  }
  if (!docService) {
    return {
      content: [{ type: 'text', text: 'No document service is available to change Draft/Published state. Open the workspace and retry.' }],
      isError: true,
    };
  }

  const existingKey = getAssignedIssueKey(item);
  // Two different questions, and conflating them misreports one case or the
  // other. Whether a key can EVER arrive is about the team: without a room,
  // claiming a key is "pending" is #1346, where the item was published and then
  // waited nine days on a room that did not exist. Whether to WAIT for one now
  // is about the socket: offline there is nothing to wait for, and asking would
  // just spend the timeout (NIM-3659).
  const canIssueKeys = isTrackerSyncConfigured(workspacePath);
  const canAwaitKey = isTrackerSyncActive(workspacePath);
  let publishedItem = await docService.setTrackerItemPublished(item.id, args.published);
  if (args.published && !existingKey && !getAssignedIssueKey(publishedItem) && canAwaitKey) {
    const serverKey = await awaitServerIssueKey(db, publishedItem.id);
    if (serverKey) {
      const keyedRow = await resolveTrackerRowByReference(db, publishedItem.id, workspacePath);
      publishedItem = keyedRow ? rowToTrackerItem(keyedRow) : { ...publishedItem, issueKey: serverKey };
    }
  }

  const publishedKey = getAssignedIssueKey(publishedItem);
  if (existingKey && publishedKey && existingKey !== publishedKey) {
    throw new Error(`Existing issue key changed during publication: ${existingKey} -> ${publishedKey}`);
  }
  const finalKey = existingKey ?? publishedKey;
  const publishedRef = {
    id: publishedItem.id,
    issueKey: finalKey,
    localKey: publishedItem.localKey ?? item.localKey ?? undefined,
  };
  const keyContext = { published: args.published, canIssueKeys };
  const keyMessage = issueKeyMessage(publishedRef, keyContext);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          structured: {
            action: args.published ? 'published' as const : 'unpublished' as const,
            id: publishedItem.id,
            issueNumber: publishedItem.issueNumber ?? undefined,
            issueKey: finalKey,
            localKey: publishedRef.localKey,
            issueKeyStatus: issueKeyStatus(publishedRef),
            ...(keyMessage ? { issueKeyMessage: keyMessage } : {}),
            type: publishedItem.type,
            title: publishedItem.title || '',
            published: args.published,
          },
          summary: `${args.published ? 'Published' : 'Unpublished'} tracker item ${getTrackerDisplayRef(publishedRef)}.${issueKeyAvailabilityNote(publishedRef, keyContext)}`,
        }),
      },
    ],
    isError: false,
  };
}
