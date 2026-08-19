/**
 * The team a local-origin binding belongs to, and the test seam for supplying
 * it directly.
 *
 * A leaf module on purpose. `CollabTestIdentityHandlers` needs to install the
 * override, and importing `CollabLocalOriginService` for that would drag the
 * database, TeamService and the asset pipeline into every test that mocks the
 * IPC registry.
 */

/**
 * The three fields a local-origin binding needs from the workspace's team.
 * Narrower than `TeamDetails` on purpose -- this stores a row, it does not need
 * a roster or a project registry.
 */
export interface LocalOriginTeam {
  orgId: string;
  teamProjectId: string | null;
  gitRemoteHash: string | null;
}

export type LocalOriginTeamResolver =
  (workspacePath: string) => Promise<LocalOriginTeam | null>;

let override: LocalOriginTeamResolver | null = null;

/**
 * Substitute team discovery for the wrangler-backed collab E2E specs.
 *
 * `findTeamForWorkspace` fails closed on `isAuthenticated()`, and the Playwright
 * collab harness deliberately has no Stytch session -- it supplies the identity
 * that document-sync normally derives from Stytch plus team discovery. Local
 * origin bindings resolve their org the same way, so without this every harness
 * `Share to Team` records nothing and raises a "No team found for this
 * workspace" error toast that outlives the step that caused it.
 *
 * Installed only by `CollabTestIdentityHandlers`, which is itself gated on
 * `!app.isPackaged` and `PLAYWRIGHT=1`. Passing null restores discovery.
 */
export function setLocalOriginTeamResolverForTests(
  resolver: LocalOriginTeamResolver | null,
): void {
  override = resolver;
}

export function getLocalOriginTeamOverride(): LocalOriginTeamResolver | null {
  return override;
}
