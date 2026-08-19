export interface WorkspaceManagerWindowOptions {
  showOnboarding?: boolean;
  safeMode?: boolean;
  /**
   * Window behavior rather than renderer state (deliberately not part of the
   * renderer query): this window is opened by launch, so it is revealed without
   * activating and StartupActivation foregrounds the app once at the end.
   */
  startupReveal?: boolean;
}

export type WorkspaceManagerRendererQuery = Record<string, string>;

export function createWorkspaceManagerRendererQuery(
  theme: string,
  options: WorkspaceManagerWindowOptions = {},
): WorkspaceManagerRendererQuery {
  return {
    mode: 'workspace-manager',
    theme,
    ...(options.showOnboarding ? { onboarding: '1' } : {}),
    ...(options.safeMode ? { safeMode: '1' } : {}),
  };
}

export function createWorkspaceManagerDevUrl(
  port: string,
  query: WorkspaceManagerRendererQuery,
): string {
  return `http://localhost:${port}/?${new URLSearchParams(query).toString()}`;
}
