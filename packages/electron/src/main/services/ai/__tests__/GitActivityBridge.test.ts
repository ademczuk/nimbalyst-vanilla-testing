import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/logger', () => ({
  logger: { main: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } },
}));

import {
  GitActivityBridge,
  bashCommandObservation,
  interpretToolResult,
} from '../GitActivityBridge';
import type { GitOperationLogService } from '../../GitOperationLogService';

function fakeLog() {
  return {
    startExternal: vi.fn().mockResolvedValue(undefined),
    finishExternal: vi.fn().mockResolvedValue(undefined),
    interruptExternal: vi.fn().mockResolvedValue(undefined),
  };
}

let log: ReturnType<typeof fakeLog>;
let bridge: GitActivityBridge;

beforeEach(() => {
  log = fakeLog();
  bridge = new GitActivityBridge(
    log as unknown as GitOperationLogService,
    'session-1',
    'openai-codex',
  );
});

describe('GitActivityBridge', () => {
  it('records a git command once across a start event and a completion event', async () => {
    // Codex emits item.started then item.completed for one command_execution;
    // a second start must upsert the same entry, not open a phantom.
    await bridge.observe({
      command: 'git fetch origin',
      workspacePath: '/repo',
      providerToolCallId: 'nimtc|abc|1|0',
      result: undefined,
    });
    await bridge.observe({
      command: 'git fetch origin',
      workspacePath: '/repo',
      providerToolCallId: 'nimtc|abc|1|0',
      result: { exitCode: 0, stdout: 'From origin\n' },
    });

    expect(log.startExternal).toHaveBeenCalledTimes(1);
    expect(log.startExternal.mock.calls[0][0]).toMatchObject({
      workspacePath: '/repo',
      source: 'agent',
      sessionId: 'session-1',
      provider: 'openai-codex',
    });
    expect(log.finishExternal).toHaveBeenCalledTimes(1);
    expect(log.finishExternal.mock.calls[0][0]).toMatchObject({ success: true, exitCode: 0 });
  });

  it('ignores a repeated terminal event for a command that already settled', async () => {
    const observation = {
      command: 'git status',
      workspacePath: '/repo',
      providerToolCallId: 'call-1',
      result: 'On branch main',
    };
    await bridge.observe(observation);
    await bridge.observe(observation);

    expect(log.finishExternal).toHaveBeenCalledTimes(1);
  });

  it('does not record a command that only mentions git', async () => {
    await bridge.observe({
      command: 'npm test && echo "git push"',
      workspacePath: '/repo',
      providerToolCallId: 'call-1',
      result: undefined,
    });

    expect(log.startExternal).not.toHaveBeenCalled();
  });

  it('attaches the entry to the worktree the command targeted', async () => {
    await bridge.observe({
      command: 'git diff --stat',
      workspacePath: '/repo/.worktrees/feature',
      providerToolCallId: 'call-1',
      result: undefined,
    });

    expect(log.startExternal.mock.calls[0][0].workspacePath).toBe('/repo/.worktrees/feature');
  });

  it('interrupts a command whose completion never arrived', async () => {
    await bridge.observe({
      command: 'git push origin main',
      workspacePath: '/repo',
      providerToolCallId: 'call-1',
      result: undefined,
    });

    await bridge.interruptOutstanding('cancelled');

    expect(log.interruptExternal).toHaveBeenCalledTimes(1);
    expect(log.interruptExternal.mock.calls[0][0]).toMatchObject({
      workspacePath: '/repo',
      providerToolCallId: 'call-1',
      reason: 'cancelled',
    });
  });

  it('leaves an already-settled command alone when the turn ends', async () => {
    await bridge.observe({
      command: 'git status',
      workspacePath: '/repo',
      providerToolCallId: 'call-1',
      result: { exitCode: 0 },
    });

    await bridge.interruptOutstanding();

    expect(log.interruptExternal).not.toHaveBeenCalled();
  });
});

describe('bashCommandObservation', () => {
  it('addresses one entry across a Claude Code tool_use and its later tool_result', async () => {
    // ClaudeCodeProvider yields `tool_call` once, at tool_use, then attaches the
    // result by mutating that same object. Both stream events must resolve to
    // the same journal entry, or the command spins for the rest of the turn and
    // lands as `interrupted` even when it succeeded.
    const toolCall: Record<string, unknown> = {
      id: 'toolu_01AkNL',
      name: 'Bash',
      arguments: { command: 'git log --oneline -5' },
    };

    const started = bashCommandObservation(toolCall);
    expect(started).toEqual({
      command: 'git log --oneline -5',
      providerToolCallId: 'toolu_01AkNL',
      result: undefined,
    });

    toolCall.result = 'eba36a4f8 fix: something\n';
    expect(bashCommandObservation(toolCall)).toEqual({
      command: 'git log --oneline -5',
      providerToolCallId: 'toolu_01AkNL',
      result: 'eba36a4f8 fix: something\n',
    });

    const claudeBridge = new GitActivityBridge(
      log as unknown as GitOperationLogService,
      'session-1',
      'claude-code',
    );
    for (const observation of [started!, bashCommandObservation(toolCall)!]) {
      await claudeBridge.observe({ ...observation, workspacePath: '/repo' });
    }
    await claudeBridge.interruptOutstanding();

    expect(log.finishExternal.mock.calls[0][0]).toMatchObject({ success: true });
    expect(log.interruptExternal).not.toHaveBeenCalled();
  });

  it('accepts only the synthetic id on Codex, which reuses raw ids across turns', () => {
    const codexCall = { id: 'item_0', name: 'Bash', arguments: { command: 'git status' } };
    expect(
      bashCommandObservation({ ...codexCall, toolUseId: 'nimtc|abc|1|0' }, 'openai-codex'),
    ).toMatchObject({ providerToolCallId: 'nimtc|abc|1|0' });
    // Without one, `item_0` would merge this turn's command into an unrelated
    // entry from an earlier turn.
    expect(bashCommandObservation(codexCall, 'openai-codex')).toBeNull();
  });

  it.each([
    ['a non-shell tool', { id: 'a', name: 'Read', arguments: { file_path: '/a.ts' } }],
    ['a shell call with no command', { id: 'a', name: 'Bash', arguments: {} }],
    ['a call with no id', { name: 'Bash', arguments: { command: 'git status' } }],
  ])('has nothing to observe for %s', (_label, toolCall) => {
    expect(bashCommandObservation(toolCall)).toBeNull();
  });
});

describe('interpretToolResult', () => {
  it('treats a missing result as still running', () => {
    expect(interpretToolResult(undefined).terminal).toBe(false);
    expect(interpretToolResult(null).terminal).toBe(false);
  });

  it.each([
    [{ exitCode: 0, stdout: 'ok' }, true],
    [{ exitCode: 1, stderr: 'rejected' }, false],
    [{ success: false, error: 'boom' }, false],
    [{ is_error: true, content: 'nope' }, false],
    ['plain string output', true],
  ])('reads %j as success=%s', (result, success) => {
    const outcome = interpretToolResult(result);
    expect(outcome.terminal).toBe(true);
    expect(outcome.success).toBe(success);
  });

  it('carries stderr as the error only on failure', () => {
    // A successful git command routinely writes progress to stderr; surfacing
    // that as an error would mark healthy fetches red in the Output tab.
    expect(interpretToolResult({ exitCode: 0, stderr: 'Receiving objects...' }).error).toBeUndefined();
    expect(interpretToolResult({ exitCode: 128, stderr: 'not a repository' }).error).toBe(
      'not a repository',
    );
  });
});
