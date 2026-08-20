export type OrgMessagingDestination = 'project-mode' | 'org-window';

/**
 * Choose the messaging surface for an organization-scoped entry point.
 *
 * The project mode is pinned to the active project's organization. Every
 * other target stays in the standalone window, whose org can be retargeted.
 *
 * An absent id on either side is not a match. This runs at IPC and API
 * boundaries where TypeScript is not policing the arguments, and a bare `===`
 * let `(null, null)` claim a missing target belongs to the project — the one
 * direction that leaks another org's messages into this project's mode.
 */
export function resolveOrgMessagingDestination(
  projectOrgId: string | null | undefined,
  targetOrgId: string | null | undefined,
): OrgMessagingDestination {
  if (!projectOrgId || !targetOrgId) return 'org-window';
  return projectOrgId === targetOrgId ? 'project-mode' : 'org-window';
}
