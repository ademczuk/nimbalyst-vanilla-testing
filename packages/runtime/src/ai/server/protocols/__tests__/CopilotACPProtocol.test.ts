// @vitest-environment node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ChildProcess } from 'child_process';
import { describe, expect, it, vi } from 'vitest';
import { CopilotACPProtocol } from '../CopilotACPProtocol';

function mockAgentPath(): string {
  return fileURLToPath(new URL('./fixtures/mockCopilotAcpAgent.mjs', import.meta.url));
}

function childEnv(auditPath: string): Record<string, string | null> | undefined {
  return fs.readFileSync(auditPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((row) => row.method === 'process:env')?.params;
}

describe('CopilotACPProtocol', () => {
  it('never lets a shell API key reach the spawned agent, built env or fallback', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-acp-env-'));
    const builtAudit = path.join(tempDir, 'built.ndjson');
    const fallbackAudit = path.join(tempDir, 'fallback.ndjson');
    const saved = { openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY };
    // The exact CLAUDE.md incident: unrelated keys sitting in the user's shell.
    process.env.OPENAI_API_KEY = 'sentinel-from-user-shell';
    process.env.ANTHROPIC_API_KEY = 'sentinel-from-user-shell';

    const withBuiltEnv = new CopilotACPProtocol();
    withBuiltEnv.setCommand(process.execPath, [mockAgentPath()]);
    withBuiltEnv.setProcessEnv({
      COPILOT_ACP_TEST_AUDIT_PATH: builtAudit,
      COPILOT_ACP_TEST_PASSTHROUGH: 'delivered',
      // Scrubbing must be the LAST step, so even a key handed in explicitly is
      // dropped rather than surviving as the authoritative value.
      XAI_API_KEY: 'sentinel-from-built-env',
    });

    // The provider returns null whenever it can load neither a shell env nor an
    // enhanced PATH; the protocol then falls back to `process.env`, which is
    // where an unscrubbed shell reaches the child.
    const withFallbackEnv = new CopilotACPProtocol();
    withFallbackEnv.setCommand(process.execPath, [mockAgentPath()]);
    process.env.COPILOT_ACP_TEST_AUDIT_PATH = fallbackAudit;

    try {
      await withBuiltEnv.createSession({ workspacePath: tempDir });
      await withFallbackEnv.createSession({ workspacePath: tempDir });

      // Observed inside the child, not in what the provider assembled: a test on
      // the sanitizing function's return value passes while the key still ships.
      expect(childEnv(builtAudit)).toEqual({
        OPENAI_API_KEY: null,
        ANTHROPIC_API_KEY: null,
        XAI_API_KEY: null,
        COPILOT_ACP_TEST_PASSTHROUGH: 'delivered',
      });
      expect(childEnv(fallbackAudit)).toMatchObject({
        OPENAI_API_KEY: null,
        ANTHROPIC_API_KEY: null,
      });
    } finally {
      withBuiltEnv.destroy();
      withFallbackEnv.destroy();
      delete process.env.COPILOT_ACP_TEST_AUDIT_PATH;
      process.env.OPENAI_API_KEY = saved.openai;
      process.env.ANTHROPIC_API_KEY = saved.anthropic;
      if (saved.openai === undefined) delete process.env.OPENAI_API_KEY;
      if (saved.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 15000);

  it('stops logging about the child once destroy() has killed it', async () => {
    const protocol = new CopilotACPProtocol();
    protocol.setCommand(process.execPath, [mockAgentPath()]);
    await protocol.createSession({ workspacePath: os.tmpdir() });

    // destroy() returns before SIGTERM lands. Anything still listening for the
    // child's exit then fires after the caller has moved on; in a test file
    // that is after the file finished, which vitest reports as an unhandled
    // error when the worker is already closing its rpc.
    const child = (protocol as unknown as { process: ChildProcess }).process;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      protocol.destroy();
      await exited;
      expect(log.mock.calls.map((call) => call.join(' '))).not.toContainEqual(
        expect.stringContaining('[COPILOT-ACP] Process exited'),
      );
    } finally {
      log.mockRestore();
    }
  }, 15000);
});
