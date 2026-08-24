import { getGithubIssueOverlayService } from '../../services/GithubIssueOverlayService';
import type { McpToolResult } from './trackerToolResult';

interface GithubIssueOverlayToolDependencies {
  linkSession(itemId: string): Promise<McpToolResult>;
  notifyAdded(itemId: string): Promise<void>;
  notifyUpdated(itemId: string): Promise<void>;
}

/** Route github-issue tracker_create calls through the atomic URL-keyed overlay service. */
export async function handleGithubIssueOverlayCreate(
  args: any,
  workspacePath: string,
  shouldLinkSession: boolean,
  dependencies: GithubIssueOverlayToolDependencies,
): Promise<McpToolResult | null> {
  if (
    args.type !== 'github-issue' ||
    !args.fields ||
    typeof args.fields !== 'object' ||
    typeof args.fields.issueUrl !== 'string'
  ) {
    return null;
  }

  const explicitFields = { ...args.fields };
  const updates: Record<string, unknown> = { ...explicitFields };
  if (typeof args.status === 'string' && args.status.trim()) updates.status = args.status.trim();
  if (typeof args.priority === 'string' && args.priority.trim()) updates.priority = args.priority.trim();
  const result = await getGithubIssueOverlayService().getOrCreate({
    workspacePath,
    issueUrl: args.fields.issueUrl,
    title: args.title,
    status: typeof args.status === 'string' && args.status.trim() ? args.status.trim() : 'untriaged',
    priority: typeof args.priority === 'string' && args.priority.trim() ? args.priority.trim() : 'medium',
    customFields: explicitFields,
    updates,
  });

  if (shouldLinkSession) {
    const linkResult = await dependencies.linkSession(result.id);
    if (linkResult.isError) return linkResult;
  }
  if (result.created) await dependencies.notifyAdded(result.id);
  else if (Object.keys(updates).length > 0) await dependencies.notifyUpdated(result.id);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        structured: {
          action: result.created ? 'created' : 'resolved',
          item: { id: result.id, type: 'github-issue', issueUrl: result.issueUrl },
        },
        summary: `${result.created ? 'Created' : 'Resolved'} GitHub issue overlay ${result.id} for ${result.issueUrl}.`,
      }),
    }],
    isError: false,
  };
}
