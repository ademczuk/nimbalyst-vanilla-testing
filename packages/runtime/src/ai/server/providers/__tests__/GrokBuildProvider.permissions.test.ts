// @vitest-environment node
/**
 * The security-bearing branches of Grok's ACP permission decision.
 *
 * Approval is covered end-to-end in `GrokACPProtocol.test.ts`; approval is also
 * the branch that fails safe. These are the ones that do not: an untrusted
 * workspace, a pattern the user persisted earlier, and an outright rejection at
 * the prompt. A regression in any of them silently runs a tool the user did not
 * authorise.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PermissionOption, ToolCallUpdate } from '@agentclientprotocol/sdk';
import { BaseAgentProvider } from '../BaseAgentProvider';
import { GrokBuildProvider } from '../GrokBuildProvider';
import type {
  GrokACPPermissionDecision,
  GrokACPPermissionRequest,
} from '../../protocols/GrokACPProtocol';

const OPTIONS: PermissionOption[] = [
  { optionId: 'allow-once', name: 'Yes', kind: 'allow_once' },
  { optionId: 'reject-once', name: 'No', kind: 'reject_once' },
];

/**
 * The provider wires its own decision handler into the protocol it constructs,
 * so the protocol instance is the only place it is reachable. Calling it there
 * exercises the real wiring rather than a re-implementation of it.
 */
function decide(
  provider: GrokBuildProvider,
  overrides: Partial<GrokACPPermissionRequest> = {},
): Promise<GrokACPPermissionDecision> {
  const toolCall = { toolCallId: 'call-1', kind: 'execute', title: 'Execute `rm -rf /`' } as ToolCallUpdate;
  const handler = (provider as any).protocol.onPermissionRequest as
    (request: GrokACPPermissionRequest) => Promise<GrokACPPermissionDecision>;
  return handler({
    requestId: 'call-1',
    sessionId: 'grok-session',
    nimbalystSessionId: 'nimbalyst-session',
    workspacePath: '/proj',
    toolName: 'Bash',
    providerToolName: 'run_terminal_command',
    toolTitle: 'Execute `rm -rf /`',
    toolKind: 'execute',
    toolInput: { command: 'rm -rf /' },
    toolCall,
    options: OPTIONS,
    signal: new AbortController().signal,
    ...overrides,
  });
}

afterEach(() => {
  BaseAgentProvider.setTrustChecker(null);
  BaseAgentProvider.setPermissionPatternChecker(null);
  BaseAgentProvider.setPermissionPatternSaver(null);
});

describe('GrokBuildProvider ACP permission decisions', () => {
  it('denies every tool in an untrusted workspace without prompting', async () => {
    const prompted = vi.fn();
    BaseAgentProvider.setTrustChecker(() => ({ trusted: false, mode: 'ask' }) as any);
    const provider = new GrokBuildProvider();
    (provider as any).emit = prompted;

    // Read tools too: an untrusted workspace is not "prompt harder", it is no.
    expect(await decide(provider)).toEqual({ decision: 'deny', scope: 'once' });
    expect(await decide(provider, { toolName: 'Read' })).toEqual({ decision: 'deny', scope: 'once' });
    expect(prompted).not.toHaveBeenCalled();
  });

  it('honours a persisted pattern and caches it for the session', async () => {
    const checker = vi.fn(async () => true);
    BaseAgentProvider.setTrustChecker(() => ({ trusted: true, mode: 'ask' }) as any);
    BaseAgentProvider.setPermissionPatternChecker(checker);
    const provider = new GrokBuildProvider();

    expect(await decide(provider, { permissionsPath: '/perms' }))
      .toEqual({ decision: 'allow', scope: 'always' });
    // The persisted lookup is scoped to the permissions path, not the workspace
    // path, so a worktree does not inherit the parent's approvals by accident.
    expect(checker).toHaveBeenCalledWith('/perms', 'Bash(rm:*)');
    expect((provider as any).permissions.sessionApprovedPatterns.has('Bash(rm:*)')).toBe(true);
  });

  it('maps a rejection at the prompt to a deny, not a fall-through allow', async () => {
    BaseAgentProvider.setTrustChecker(() => ({ trusted: true, mode: 'ask' }) as any);
    BaseAgentProvider.setPermissionPatternChecker(async () => false);
    const provider = new GrokBuildProvider();
    const permissions = (provider as any).permissions;
    (provider as any).logAgentMessage = async () => {};
    (provider as any).pollForPermissionResponse = async () => {};
    (provider as any).emit = (event: string, payload: any) => {
      if (event !== 'toolPermission:pending') return;
      permissions.pendingToolPermissions.get(payload.requestId)
        ?.resolve({ decision: 'deny', scope: 'once' });
    };

    expect(await decide(provider)).toEqual({ decision: 'deny', scope: 'once' });
    // A denial must never leave the pattern cached, or the next identical call
    // in the same session would skip the prompt entirely.
    expect(permissions.sessionApprovedPatterns.has('Bash(rm:*)')).toBe(false);
  });
});
