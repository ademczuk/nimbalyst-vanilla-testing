// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import {
  isBunRuntimeSpawnCrash,
  collectSpawnCrashDiagnostics,
  armAgentSdkDebugLogging,
} from '../claudeCode/spawnCrashDiagnostics';
import { classifyAbnormalChildExit } from '../claudeCode/abnormalExit';

describe('isBunRuntimeSpawnCrash', () => {
  it('detects the #614 signature: exit code 1 with Bun unknown-error stderr', () => {
    const result = isBunRuntimeSpawnCrash(
      'Claude Code process exited with code 1',
      ['error: An unknown error occurred (Unexpected)\n'],
    );
    expect(result).toBe(true);
  });

  it('detects the low-fd variant of the Bun message', () => {
    const result = isBunRuntimeSpawnCrash(
      'Claude Code process exited with code 1',
      ['error: An unknown error occurred, possibly due to low max file descriptors (Unexpected)\n'],
    );
    expect(result).toBe(true);
  });

  it('detects the signature when stderr was folded into the enriched message', () => {
    const result = isBunRuntimeSpawnCrash(
      'Claude Code process exited with code 1\n\nProcess output:\nerror: An unknown error occurred (Unexpected)',
      [],
    );
    expect(result).toBe(true);
  });

  it('ignores non-exit errors even when stderr mentions unknown errors', () => {
    expect(
      isBunRuntimeSpawnCrash('Stream closed', ['error: An unknown error occurred (Unexpected)']),
    ).toBe(false);
  });

  it('ignores exit-code failures with unrelated stderr (e.g. auth)', () => {
    expect(
      isBunRuntimeSpawnCrash('Claude Code process exited with code 1', ['Not logged in\n']),
    ).toBe(false);
  });
});

describe('classifyAbnormalChildExit', () => {
  // GitHub #1361: the bundled Windows binary exited 0xC0000005 on ~80% of spawns
  // and the raw integer was all the user ever saw.
  it('translates the Windows access violation and allows one retry when nothing was streamed', () => {
    const assessment = classifyAbnormalChildExit({
      errorMessage: 'Claude Code process exited with code 3221225477',
      stderrLines: [],
      producedOutput: false,
    });

    expect(assessment).not.toBeNull();
    expect(assessment!.kind).toBe('access-violation');
    expect(assessment!.exitCode).toBe(3221225477);
    expect(assessment!.retryable).toBe(true);
    // The whole point is that the user stops seeing a bare number.
    expect(assessment!.message).toMatch(/access violation/i);
    expect(assessment!.message).not.toBe('Claude Code process exited with code 3221225477');
  });

  it('maps the POSIX segfault code the same crash reports as 139', () => {
    const assessment = classifyAbnormalChildExit({
      errorMessage: 'Claude Code process exited with code 139',
      stderrLines: [],
      producedOutput: false,
    });

    expect(assessment?.kind).toBe('segfault');
    expect(assessment?.retryable).toBe(true);
  });

  it('refuses to retry once the turn already streamed output', () => {
    const assessment = classifyAbnormalChildExit({
      errorMessage: 'Claude Code process exited with code 3221225477',
      stderrLines: [],
      producedOutput: true,
    });

    expect(assessment?.kind).toBe('access-violation');
    // Replaying would duplicate whatever the user already saw.
    expect(assessment?.retryable).toBe(false);
  });

  it('classifies an OOM kill but does not retry it', () => {
    const assessment = classifyAbnormalChildExit({
      errorMessage: 'Claude Code process exited with code 137',
      stderrLines: [],
      producedOutput: false,
    });

    expect(assessment?.kind).toBe('killed');
    // A second spawn hits the same memory ceiling.
    expect(assessment?.retryable).toBe(false);
  });

  it('ignores ordinary non-zero exits so real errors keep their own message', () => {
    expect(
      classifyAbnormalChildExit({
        errorMessage: 'Claude Code process exited with code 1',
        stderrLines: ['Not logged in\n'],
        producedOutput: false,
      }),
    ).toBeNull();
  });

  it('ignores failures that are not a process exit at all', () => {
    expect(
      classifyAbnormalChildExit({
        errorMessage: 'Stream closed',
        stderrLines: [],
        producedOutput: false,
      }),
    ).toBeNull();
  });

  it('still classifies when stderr was folded into the enriched message', () => {
    const assessment = classifyAbnormalChildExit({
      errorMessage: 'Claude Code process exited with code 139\n\nProcess output:\nSegmentation fault',
      stderrLines: ['Segmentation fault'],
      producedOutput: false,
    });

    expect(assessment?.kind).toBe('segfault');
  });
});

describe('collectSpawnCrashDiagnostics', () => {
  it('reports inherited fd limits and binary existence', () => {
    const diag = collectSpawnCrashDiagnostics({ binaryPath: '/nonexistent/claude', cwd: process.cwd() });
    expect(diag.binaryExists).toBe(false);
    expect(diag.cwdExists).toBe(true);
    expect(diag.platform).toBe(process.platform);
    // process.report is available in Node/Electron; userLimits should resolve.
    expect(diag.openFilesLimit ?? diag.userLimits).toBeDefined();
  });
});

describe('armAgentSdkDebugLogging', () => {
  const original = process.env.DEBUG_CLAUDE_AGENT_SDK;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.DEBUG_CLAUDE_AGENT_SDK;
    } else {
      process.env.DEBUG_CLAUDE_AGENT_SDK = original;
    }
  });

  it('arms once and reports already-armed on subsequent calls', () => {
    delete process.env.DEBUG_CLAUDE_AGENT_SDK;
    expect(armAgentSdkDebugLogging()).toBe(true);
    expect(process.env.DEBUG_CLAUDE_AGENT_SDK).toBe('1');
    expect(armAgentSdkDebugLogging()).toBe(false);
  });
});
