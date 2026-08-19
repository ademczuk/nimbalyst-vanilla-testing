import { globalRegistry } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel';
import type { TrackerItem } from '@nimbalyst/runtime';
import type { ElectronDocumentService } from '../../services/ElectronDocumentService';
import { isTrackerSyncActive } from '../../services/TrackerSyncManager';
import { awaitServerIssueKey } from '../../services/tracker/awaitServerIssueKey';
import { resolveTrackerRowByReference } from './trackerToolItemAccess';
import {
  getAssignedIssueKey,
  getTrackerDisplayRef,
  issueKeyAvailabilityNote,
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
  let publishedItem = await docService.setTrackerItemPublished(item.id, args.published);
  if (args.published && !existingKey && !getAssignedIssueKey(publishedItem) && isTrackerSyncActive(workspacePath)) {
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
  const publishedRef = { id: publishedItem.id, issueKey: finalKey };
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
            issueKeyStatus: issueKeyStatus(publishedRef),
            type: publishedItem.type,
            title: publishedItem.title || '',
            published: args.published,
          },
          summary: `${args.published ? 'Published' : 'Unpublished'} tracker item ${getTrackerDisplayRef(publishedRef)}.${issueKeyAvailabilityNote(publishedRef, args.published)}`,
        }),
      },
    ],
    isError: false,
  };
}
