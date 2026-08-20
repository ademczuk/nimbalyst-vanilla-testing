import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAtomValue, useStore } from 'jotai';

import { organizationDirectoryAtom } from '../../store/atoms/settingsDomains';
import { OrgModeBody } from './OrgModeBody';
import { OrgModeUnboundArm } from './OrgModeUnboundArm';
import { OrgWindowTitleBar } from './OrgWindowTitleBar';
import {
  createAtomInboxProvider,
  InboxProviderContext,
  useInboxProvider,
} from './Inbox/inboxProvider';
import { isActiveMembership, persistLastSelectedOrgId } from './defaultOrg';
import type { OrgModeHostProps, OrgModeHostRef, TeamSummary } from './orgModeTypes';
import { normalizeTeamAnalyticsCallerRole } from '../../../shared/analytics/teamAnalytics';
import { trackTeamAnalyticsEvent } from '../../utils/teamAnalytics';
import { CONSOLE_ORIGIN } from '../../../shared/consoleOrigin';

export type { OrgModeChrome, OrgModeHostProps, OrgModeHostRef } from './orgModeTypes';

export const OrgModeHost = forwardRef<OrgModeHostRef, OrgModeHostProps>(
  function OrgModeHost(props, ref) {
    const jotaiStore = useStore();
    const atomInboxProvider = useMemo(
      () => createAtomInboxProvider(jotaiStore),
      [jotaiStore],
    );
    const inboxProvider = useInboxProvider(atomInboxProvider);
    // Re-clicking the active gutter icon collapses the left pane, the way every
    // other content mode behaves. The window has no gutter, so it never toggles.
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    useImperativeHandle(ref, () => ({
      toggleSidebarCollapsed: () => setSidebarCollapsed((collapsed) => !collapsed),
    }), []);
    return (
      <InboxProviderContext.Provider value={inboxProvider}>
        <OrgModeHostContent {...props} sidebarCollapsed={sidebarCollapsed} />
      </InboxProviderContext.Provider>
    );
  },
);

function OrgModeHostContent({
  orgId,
  workspacePath,
  surfaceId,
  chrome = 'mode',
  isActive = true,
  onOrgIdChange,
  sidebarCollapsed,
}: OrgModeHostProps & { sidebarCollapsed: boolean }) {
  const hydratedOrganizations = useAtomValue(organizationDirectoryAtom);
  const [team, setTeam] = useState<TeamSummary | null>(null);
  const [organizations, setOrganizations] = useState<TeamSummary[]>([]);
  const [boundEmail, setBoundEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [organizationLoadError, setOrganizationLoadError] = useState<string | null>(null);
  const [organizationReloadNonce, setOrganizationReloadNonce] = useState(0);
  const surfaceOpenRecordedRef = useRef(false);

  const selectOrganization = useCallback((orgId: string) => {
    const selectedOrganization = organizations.find((organization) => organization.orgId === orgId);
    trackTeamAnalyticsEvent('team_organization_switched', {
      surface: 'desktop',
      entryPoint: 'org_switcher',
      callerRole: normalizeTeamAnalyticsCallerRole(selectedOrganization?.role),
    });
    onOrgIdChange?.(orgId);
    void persistLastSelectedOrgId(orgId);
  }, [onOrgIdChange, organizations]);

  const reloadOrganizations = useCallback(
    () => setOrganizationReloadNonce((value) => value + 1),
    [],
  );

  useEffect(() => {
    if (!isActive) return;
    setLoading(true);
    setOrganizationLoadError(null);
    let cancelled = false;
    void Promise.all([
      // Only the workspace-hosted surface falls back to the workspace's team.
      // The standalone org window always targets an explicitly selected org.
      workspacePath
        ? window.electronAPI.team.findForWorkspace(workspacePath)
        : Promise.resolve(null),
      window.electronAPI.stytch.getAccounts(),
      // Always listed: the switcher offers every active membership, not just
      // the targeted one. `team:list` is cached in main, so this is cheap.
      window.electronAPI.organization.list(),
    ]).then(([result, accounts, directory]) => {
      if (cancelled) return;
      if (directory?.success === false) {
        throw new Error(directory.error || 'Organization directory unavailable');
      }
      const workspaceTeam = result?.team ?? result ?? null;
      const listedOrganizations: TeamSummary[] =
        directory?.success && Array.isArray(directory.teams)
          ? directory.teams
          : [];
      const organizations = listedOrganizations.length > 0
        ? listedOrganizations
        : hydratedOrganizations;
      setOrganizations(organizations);
      const selectedTeam = orgId
        ? organizations.find((organization) =>
          organization.orgId === orgId && isActiveMembership(organization.membershipType)) ?? null
        : null;

      const found = orgId ? selectedTeam : workspaceTeam;
      setTeam(found?.orgId ? found : null);
      if (!surfaceOpenRecordedRef.current) {
        surfaceOpenRecordedRef.current = true;
        trackTeamAnalyticsEvent('team_surface_opened', {
          surface: 'desktop',
          entryPoint: 'account_org_list',
          hasActiveOrganization: !!found?.orgId,
          callerRole: normalizeTeamAnalyticsCallerRole(found?.role),
        });
      }
      const personalOrgId = found?.boundPersonalOrgId ?? found?.owningPersonalOrgId;
      setBoundEmail(accounts.find((account) => account.personalOrgId === personalOrgId)?.email ?? found?.sourceEmail ?? null);
      setLoading(false);
    }).catch((error) => {
      if (!cancelled) {
        setOrganizationLoadError(
          error instanceof Error ? error.message : String(error),
        );
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [
    hydratedOrganizations,
    isActive,
    organizationReloadNonce,
    orgId,
    workspacePath,
  ]);

  // Every arm carries the title-bar strip: the traffic lights are drawn over
  // the window whatever it is showing, and they must never land on content.
  if (loading) {
    return (
      <section className="org-mode-host team-mode team-mode-loading-arm flex h-full flex-col overflow-hidden" data-component="OrgModeHost">
        {chrome === 'window' && <OrgWindowTitleBar />}
        <div className="team-mode-loading flex flex-1 items-center justify-center text-sm text-nim-muted">Loading organization…</div>
      </section>
    );
  }

  if (!team) {
    return (
      <OrgModeUnboundArm
        chrome={chrome}
        targetedOrgId={orgId}
        organizations={organizations}
        loadError={organizationLoadError}
        onSelectOrganization={selectOrganization}
        onReload={reloadOrganizations}
        onLoadError={setOrganizationLoadError}
      />
    );
  }

  return (
    <OrgModeBody
      team={team}
      organizations={organizations}
      boundEmail={boundEmail}
      workspacePath={workspacePath}
      surfaceId={surfaceId}
      chrome={chrome}
      sidebarCollapsed={sidebarCollapsed}
      onSelectOrganization={selectOrganization}
    />
  );
}
