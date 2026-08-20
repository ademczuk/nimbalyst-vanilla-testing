/** Shared shapes for the organization surface, so its parts do not import each
 * other only to name a prop. */

/** One membership as `team:list` reports it. */
export interface TeamSummary {
  orgId: string;
  name: string;
  boundPersonalOrgId?: string | null;
  sourceEmail?: string | null;
  owningPersonalOrgId?: string | null;
  membershipType?: string;
  role?: string;
}

/**
 * Whether the surface is the standalone window — which draws its own title bar,
 * status bar and org rail — or a mode inside the project window.
 */
export type OrgModeChrome = 'window' | 'mode';

export interface OrgModeHostProps {
  orgId: string | null;
  workspacePath?: string;
  surfaceId: string;
  chrome?: OrgModeChrome;
  isActive?: boolean;
  onOrgIdChange?: (orgId: string) => void;
}

/** Imperative surface the project window's gutter drives, as for every mode. */
export interface OrgModeHostRef {
  toggleSidebarCollapsed: () => void;
}
