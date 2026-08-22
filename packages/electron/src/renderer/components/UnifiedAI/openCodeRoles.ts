import type { OpenCodeAgentSummary } from '../../../shared/openCodeAgentCatalog';

/**
 * Nimbalyst model id for the model an OpenCode role declares, in the same
 * `opencode:provider/model` shape the model picker uses.
 */
export function formatAgentModelId(
  model: OpenCodeAgentSummary['model'] | undefined
): string | null {
  if (!model?.providerID || !model?.modelID) return null;
  return `opencode:${model.providerID}/${model.modelID}`;
}

/**
 * Roles are only discovered from a running OpenCode server, so the list is empty
 * until this workspace has had a turn. Hide the control rather than offer an
 * empty menu -- but never hide a role the session already carries, or a user
 * whose catalog has not been refreshed would think their selection was lost.
 *
 * One discovered role is already a choice: the menu offers it *and* "Default"
 * (OpenCode's own default agent), which are two different things to run as.
 * Requiring two roles hid the control from everyone with a single configured
 * agent, which is the common shape of a project that defines one.
 */
export function shouldShowRoleSelector(roleCount: number, role: string | null): boolean {
  return roleCount >= 1 || role !== null;
}

export interface OpenCodeRoleModelConflict {
  /** The model the role is configured to run, as a Nimbalyst model id. */
  roleModelId: string;
  /** `provider/model`, for display. */
  roleModelLabel: string;
}

/**
 * Detect a role whose configured model is not the one this session will run.
 *
 * OpenCode resolves `input.model ?? agent.model ?? session model`, and Nimbalyst
 * always sends an explicit per-prompt model, so the session model wins and the
 * role's model is ignored. That is deliberate -- the model picker has to keep
 * describing what actually runs (#730) -- but it must not be silent, so the
 * conflict is reported to the user with a one-click way to adopt the role's
 * model instead.
 *
 * Returns null when the role declares no model, when it matches the session
 * model, or when the role is not in the catalog (nothing is known to conflict).
 */
export function findRoleModelConflict(
  roleName: string | null,
  agents: OpenCodeAgentSummary[],
  sessionModelId: string | null | undefined
): OpenCodeRoleModelConflict | null {
  if (!roleName) return null;
  const agent = agents.find((candidate) => candidate.name === roleName);
  const roleModelId = formatAgentModelId(agent?.model);
  if (!roleModelId) return null;
  if (normalizeModelId(sessionModelId) === roleModelId) return null;
  return { roleModelId, roleModelLabel: roleModelId.slice('opencode:'.length) };
}

function normalizeModelId(modelId: string | null | undefined): string | null {
  if (!modelId) return null;
  return modelId.startsWith('opencode:') ? modelId : `opencode:${modelId}`;
}

type PermissionDecision = 'ask' | 'allow' | 'deny';

/**
 * What a role is allowed to do, as this UI needs to read it.
 *
 * Structurally wider than `OpenCodeAgentSummary` on purpose. OpenCode's own
 * agent record also carries `permission.external_directory`, `permission
 * .doom_loop` and a resolved `tools` map, all of which change what running as
 * the role can do to the machine. The catalog does not carry them across IPC
 * yet; when it does, they are summarized here without another signature change.
 */
export interface OpenCodeRolePolicy {
  permission: {
    edit?: PermissionDecision;
    bash?: Record<string, PermissionDecision>;
    webfetch?: PermissionDecision;
    /** Operating on paths outside the workspace directory. */
    external_directory?: PermissionDecision;
    /** OpenCode's own name for letting an agent keep re-running itself. */
    doom_loop?: PermissionDecision;
  };
  /** Resolved per-tool allowlist: `false` is a tool this role cannot call. */
  tools?: Record<string, boolean>;
}

/**
 * One short phrase per permission that changes what running as this role can do
 * to the user's machine. `deny` entries are named explicitly -- "cannot edit" is
 * the reason someone picks a review or planning role.
 *
 * A permission the role does not set is left unmentioned rather than described
 * with OpenCode's default: the server, not this process, resolves an unset
 * policy, so a claim here would be unverified.
 */
export function summarizeRolePermissions(role: OpenCodeRolePolicy): string[] {
  const { permission } = role;
  const summary: string[] = [];

  if (permission.edit === 'deny') summary.push('no edits');
  else if (permission.edit === 'ask') summary.push('edits on approval');
  else summary.push('edits files');

  const bashDecisions = Object.values(permission.bash ?? {});
  const wildcard = permission.bash?.['*'];
  if (bashDecisions.length === 0) {
    // No policy at all: OpenCode's own default applies, so claim nothing.
  } else if (wildcard === 'deny' && bashDecisions.every((d) => d === 'deny')) {
    summary.push('no commands');
  } else if (wildcard === 'allow' && bashDecisions.every((d) => d === 'allow')) {
    summary.push('runs commands');
  } else if (wildcard === 'ask' && bashDecisions.every((d) => d === 'ask')) {
    summary.push('commands on approval');
  } else {
    summary.push('commands vary by rule');
  }

  // The workspace boundary: a role allowed outside it can read and write files
  // the user never opened this project to expose.
  if (permission.external_directory === 'allow') summary.push('works outside the workspace');
  else if (permission.external_directory === 'ask') summary.push('outside the workspace on approval');
  else if (permission.external_directory === 'deny') summary.push('workspace only');

  if (permission.webfetch === 'deny') summary.push('no web access');

  // Named with OpenCode's own permission key rather than a paraphrase of what
  // the server does with it.
  if (permission.doom_loop === 'allow') summary.push('doom loop allowed');
  else if (permission.doom_loop === 'ask') summary.push('doom loop on approval');
  else if (permission.doom_loop === 'deny') summary.push('no doom loop');

  const disabledTools = Object.values(role.tools ?? {}).filter((enabled) => enabled === false).length;
  if (disabledTools > 0) {
    summary.push(`${disabledTools} tool${disabledTools === 1 ? '' : 's'} disabled`);
  }

  return summary;
}

/**
 * Where the role came from. `builtIn` is the only provenance OpenCode reports:
 * everything else is defined in config, which may be the project's
 * `.opencode/agent` or the user's own -- so this must not claim "project".
 */
export function describeRoleOrigin(role: Pick<OpenCodeAgentSummary, 'builtIn'>): {
  label: string;
  title: string;
} {
  return role.builtIn
    ? {
      label: 'built-in',
      title: 'Ships with OpenCode.',
    }
    : {
      label: 'custom',
      title: "Defined in OpenCode config -- this project's .opencode/agent or your own -- not shipped with OpenCode.",
    };
}
