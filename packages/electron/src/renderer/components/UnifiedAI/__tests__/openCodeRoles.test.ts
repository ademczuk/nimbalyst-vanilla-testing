// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { OpenCodeAgentSummary } from '../../../../shared/openCodeAgentCatalog';
import {
  describeRoleOrigin,
  findRoleModelConflict,
  shouldShowRoleSelector,
  summarizeRolePermissions,
} from '../openCodeRoles';

function agent(overrides: Partial<OpenCodeAgentSummary> = {}): OpenCodeAgentSummary {
  return {
    name: 'plan',
    mode: 'primary',
    builtIn: true,
    permission: { edit: 'allow', bash: { '*': 'allow' } },
    ...overrides,
  };
}

describe('findRoleModelConflict', () => {
  const roleWithModel = [agent({ model: { providerID: 'anthropic', modelID: 'claude-opus-4-1' } })];

  it('reports the role model that the session model will override', () => {
    // OpenCode resolves input.model ?? agent.model ?? session model, and
    // Nimbalyst always sends input.model -- so this pairing silently ran the
    // session model until the user was told about it.
    expect(findRoleModelConflict('plan', roleWithModel, 'opencode:anthropic/claude-sonnet-4-5')).toEqual({
      roleModelId: 'opencode:anthropic/claude-opus-4-1',
      roleModelLabel: 'anthropic/claude-opus-4-1',
    });
  });

  it('is silent when the session already runs the role model, prefix or not', () => {
    expect(findRoleModelConflict('plan', roleWithModel, 'opencode:anthropic/claude-opus-4-1')).toBeNull();
    expect(findRoleModelConflict('plan', roleWithModel, 'anthropic/claude-opus-4-1')).toBeNull();
  });

  it('claims no conflict for a role with no model, no role, or a role not yet discovered', () => {
    expect(findRoleModelConflict('plan', [agent()], 'opencode:anthropic/claude-sonnet-4-5')).toBeNull();
    expect(findRoleModelConflict(null, roleWithModel, 'opencode:anthropic/claude-sonnet-4-5')).toBeNull();
    expect(findRoleModelConflict('review', roleWithModel, 'opencode:anthropic/claude-sonnet-4-5')).toBeNull();
  });
});

describe('shouldShowRoleSelector', () => {
  it('keeps a session role visible even when discovery has not answered', () => {
    // The catalog only fills once a server has run; a persisted selection is
    // still being sent, so hiding it would read as "my role was lost".
    expect(shouldShowRoleSelector(0, 'plan')).toBe(true);
    expect(shouldShowRoleSelector(0, null)).toBe(false);
  });

  it('offers a single discovered role, which is a choice against Default', () => {
    expect(shouldShowRoleSelector(1, null)).toBe(true);
  });
});

describe('summarizeRolePermissions', () => {
  it('does not flatten a mixed bash policy into a single claim', () => {
    expect(summarizeRolePermissions({ permission: { edit: 'ask', bash: { '*': 'ask', 'git push': 'deny' } } }))
      .toEqual(['edits on approval', 'commands vary by rule']);
  });

  it('names the permissions that reach past the workspace and the tools withheld', () => {
    // These were dropped, so a config-defined role with access outside the
    // project read exactly like a built-in one.
    expect(summarizeRolePermissions({
      permission: { edit: 'allow', bash: {}, external_directory: 'allow', doom_loop: 'allow' },
      tools: { read: true, webfetch: false, bash: false },
    })).toEqual(expect.arrayContaining([
      'works outside the workspace',
      'doom loop allowed',
      '2 tools disabled',
    ]));
  });

  it('claims nothing about a permission the role does not set', () => {
    // The server resolves an unset policy, so any claim here is unverified.
    expect(summarizeRolePermissions({ permission: { edit: 'allow', bash: {} } })).toEqual(['edits files']);
  });
});

describe('describeRoleOrigin', () => {
  it('does not claim a config-defined role came from the project', () => {
    // `builtIn: false` covers both `.opencode/agent` here and the user's own
    // global config; OpenCode reports no finer provenance than that.
    expect(describeRoleOrigin({ builtIn: false }).label).toBe('custom');
    expect(describeRoleOrigin({ builtIn: false }).title).not.toMatch(/^This project/);
    expect(describeRoleOrigin({ builtIn: true }).label).toBe('built-in');
  });
});
