// @vitest-environment node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  GrokACPProtocol,
  isMissingAgentStdioSubcommand,
  mapGrokAcpSessionUpdate as mapGrokAcpSessionUpdateFromProtocol,
  normalizeGrokAcpUsage,
  type GrokACPPermissionDecision,
  type GrokACPPermissionRequest,
  type GrokAskUserQuestionRequest,
} from '../GrokACPProtocol';
import {
  mapGrokAcpSessionUpdate,
  readGrokACPUpdateEnvelope,
} from '../headless/GrokBuildRecordMapper';
import type { ProtocolEvent, ToolResult } from '../ProtocolInterface';

const FIXTURE_DIR = path.join(__dirname, 'fixtures');

function mockAgentPath(): string {
  return fileURLToPath(new URL('./fixtures/mockGrokAcpAgent.mjs', import.meta.url));
}

function capturedFrames(): Array<Record<string, unknown>> {
  return fs.readFileSync(path.join(FIXTURE_DIR, 'grokAcp.captured.ndjson'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function auditRows(auditPath: string): Array<{ method: string; params: any }> {
  return fs.readFileSync(auditPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe('GrokACPProtocol captured traffic', () => {
  it('maps a captured Grok diff update to an exact path and before/after baseline', () => {
    expect(mapGrokAcpSessionUpdateFromProtocol).toBe(mapGrokAcpSessionUpdate);
    const frame = capturedFrames().find((candidate) => candidate.method === 'session/update');
    const update = readGrokACPUpdateEnvelope(frame ?? {});
    expect(update).not.toBeNull();
    const events = mapGrokAcpSessionUpdate(update!, '/private/tmp/workspace');
    const resultEvent = events.find((event) => event.type === 'tool_result');
    const result = resultEvent?.toolResult?.result as ToolResult;
    expect(result.changes).toEqual([{
      path: '/private/tmp/nimbalyst-grok-acp-edit.XuwVSl/acp-edit.txt',
      kind: 'update',
      beforeContent: '',
      afterContent: 'alpha\n',
    }]);
    expect(result.output).toMatchObject({ type: 'SearchReplace' });
  });

  it('reads token counts from the captured prompt result _meta, reproducing grok totals', () => {
    const promptResult = capturedFrames()
      .find((frame) => (frame.result as any)?._meta?.totalTokens !== undefined);
    const meta = (promptResult!.result as any)._meta;
    // Grok 1.0.5 leaves standard `usage` unset, so a reader of `response.usage`
    // alone reports nothing and the context chip stays empty.
    expect((promptResult!.result as any).usage).toBeUndefined();

    // `inputTokens` ALREADY folds `cachedReadTokens` (14697 of which 14592 were
    // cached), unlike the `-p` shape normalizeGrokUsage sums — folding again
    // would double-count. `totalTokens` is grok's own running session total and
    // is reported verbatim, not recomputed from the parts.
    expect(meta).toMatchObject({ inputTokens: 14697, cachedReadTokens: 14592, outputTokens: 38, totalTokens: 14737 });
    expect(normalizeGrokAcpUsage(promptResult!.result as any)).toEqual({
      input_tokens: 14697,
      output_tokens: 38,
      total_tokens: 14737,
    });
  });

  it('prefers standard usage when an agent populates it', () => {
    expect(normalizeGrokAcpUsage({
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      _meta: { inputTokens: 999, totalTokens: 999 },
    } as any)).toEqual({ input_tokens: 10, output_tokens: 2, total_tokens: 12 });
    expect(normalizeGrokAcpUsage({ stopReason: 'end_turn', _meta: { modelId: 'grok-4.6' } } as any))
      .toBeUndefined();
  });

  it('names the upgrade when the installed grok predates `agent stdio`', () => {
    // clap's wording on a grok old enough that `--version` still succeeds, so
    // isInstalled() passes and only this string distinguishes the case.
    expect(isMissingAgentStdioSubcommand(
      "Grok ACP process exited with code 2\nstderr: error: unrecognized subcommand 'stdio'",
    )).toBe(true);
    expect(isMissingAgentStdioSubcommand('Grok ACP process exited with code 1\nstderr: network error'))
      .toBe(false);
  });

  it('loads the persisted provider id, delivers ACP MCP servers, and blocks for permission', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-acp-protocol-'));
    const auditPath = path.join(tempDir, 'audit.ndjson');
    const permissionStarted = deferred<GrokACPPermissionRequest>();
    const permissionDecision = deferred<GrokACPPermissionDecision>();
    const protocol = new GrokACPProtocol({
      command: process.execPath,
      args: [mockAgentPath()],
      env: { GROK_ACP_TEST_AUDIT_PATH: auditPath },
      onPermissionRequest: async (request) => {
        permissionStarted.resolve(request);
        return permissionDecision.promise;
      },
    });

    try {
      const realWorkspacePath = fs.realpathSync(tempDir);
      const created = await protocol.createSession({
        workspacePath: tempDir,
        mcpServers: {
          local: { command: '/usr/bin/local-mcp', args: ['--stdio'], env: { TOKEN: 'test' } },
          remoteHttp: {
            type: 'http',
            url: 'http://127.0.0.1:41000/mcp',
            headers: { Authorization: 'Bearer test' },
          } as any,
          remoteSse: {
            type: 'sse',
            url: 'http://127.0.0.1:41000/sse',
          } as any,
          invalid: {} as any,
        },
      });
      expect(created.deliveredMcpServerCount).toBe(3);

      const newSession = auditRows(auditPath).find((row) => row.method === 'session/new');
      expect(newSession?.params.mcpServers).toEqual([
        {
          name: 'local',
          command: '/usr/bin/local-mcp',
          args: ['--stdio'],
          env: [{ name: 'TOKEN', value: 'test' }],
        },
        {
          type: 'http',
          name: 'remoteHttp',
          url: 'http://127.0.0.1:41000/mcp',
          headers: [{ name: 'Authorization', value: 'Bearer test' }],
        },
        {
          type: 'sse',
          name: 'remoteSse',
          url: 'http://127.0.0.1:41000/sse',
          headers: [],
        },
      ]);

      const resumed = await protocol.resumeSession('legacy-p-session', {
        workspacePath: tempDir,
        mcpServers: {},
      });
      expect(resumed.id).toBe('legacy-p-session');
      expect(auditRows(auditPath).find((row) => row.method === 'session/load')?.params)
        .toMatchObject({ sessionId: 'legacy-p-session', cwd: realWorkspacePath, mcpServers: [] });

      const events: ProtocolEvent[] = [];
      const turn = (async () => {
        for await (const event of protocol.sendMessage(resumed, {
          content: 'Run the captured permission turn',
          sessionId: 'nimbalyst-session-1',
        })) {
          events.push(event);
        }
      })();

      const request = await permissionStarted.promise;
      expect(request).toMatchObject({
        requestId: 'call-6e798cf0-803c-413f-82d5-ab4ada283d4d-0',
        sessionId: 'legacy-p-session',
        nimbalystSessionId: 'nimbalyst-session-1',
        toolName: 'Bash',
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(events.some((event) => event.type === 'complete')).toBe(false);
      expect(events.some((event) => (
        event.type === 'raw_event'
        && (event.metadata?.rawEvent as any)?.type === 'session/request_permission'
      ))).toBe(true);

      permissionDecision.resolve({ decision: 'allow', scope: 'session' });
      await turn;

      expect(events.find((event) => (
        event.type === 'raw_event'
        && (event.metadata?.rawEvent as any)?.method === 'session/update'
      ))?.metadata?.rawEvent).toEqual({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'legacy-p-session',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Waiting for permission' },
          },
        },
      });
      expect(events.some((event) => event.type === 'text' && event.content === 'Permission accepted')).toBe(true);
      expect(events.some((event) => event.type === 'complete')).toBe(true);
      expect(auditRows(auditPath).find((row) => row.method === 'session/request_permission:response')?.params)
        .toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } });
    } finally {
      protocol.destroy();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it('never lets a shell API key reach the spawned agent', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-acp-env-'));
    const auditPath = path.join(tempDir, 'audit.ndjson');
    const saved = { xai: process.env.XAI_API_KEY, grok: process.env.GROK_API_KEY };
    // The exact CLAUDE.md incident: an unrelated key sitting in the user's
    // shell. It must not authenticate or bill `grok agent stdio`.
    process.env.XAI_API_KEY = 'sentinel-from-user-shell';
    process.env.GROK_API_KEY = 'sentinel-from-user-shell';

    const protocol = new GrokACPProtocol({
      command: process.execPath,
      args: [mockAgentPath()],
      env: {
        GROK_ACP_TEST_AUDIT_PATH: auditPath,
        GROK_ACP_TEST_PASSTHROUGH: 'delivered',
        // Scrubbing must be the LAST step, so even a key handed in explicitly
        // is dropped rather than merged back over a sanitized map.
        ANTHROPIC_API_KEY: 'sentinel-from-extra-env',
      },
    });

    try {
      await protocol.createSession({ workspacePath: tempDir, mcpServers: {} });
      // Observed inside the child, not in what buildChildEnvironment returned:
      // the bug was the spawn site merging process.env back over that map, and
      // a test on the return value passes while the key still ships.
      const childEnv = auditRows(auditPath).find((row) => row.method === 'process:env')?.params;
      expect(childEnv).toEqual({
        XAI_API_KEY: null,
        GROK_API_KEY: null,
        ANTHROPIC_API_KEY: null,
        GROK_ACP_TEST_PASSTHROUGH: 'delivered',
      });
    } finally {
      protocol.destroy();
      process.env.XAI_API_KEY = saved.xai;
      process.env.GROK_API_KEY = saved.grok;
      if (saved.xai === undefined) delete process.env.XAI_API_KEY;
      if (saved.grok === undefined) delete process.env.GROK_API_KEY;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it('applies the selected model and reports only what was delivered', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-acp-model-'));
    const auditPath = path.join(tempDir, 'audit.ndjson');
    const protocol = new GrokACPProtocol({
      command: process.execPath,
      args: [mockAgentPath()],
      env: { GROK_ACP_TEST_AUDIT_PATH: auditPath },
    });

    try {
      const created = await protocol.createSession({
        workspacePath: tempDir,
        model: 'grok-build:grok-4.5',
        mcpServers: {
          a: { command: '/bin/a' },
          b: { command: '/bin/b' },
          c: { command: '/bin/c' },
        },
      });
      // The `-m` spawn flag is reset at session/new, so set_model is the only
      // thing that sticks; without it grok runs its own default while the host
      // reports the model the user picked.
      expect(auditRows(auditPath).filter((row) => row.method === 'session/set_model')
        .map((row) => row.params.modelId)).toEqual(['grok-4.5']);
      expect(created.appliedModel).toBe('grok-4.5');
      expect(created.deliveredMcpServerCount).toBe(3);

      const second = await protocol.resumeSession(created.id, {
        workspacePath: tempDir,
        model: 'grok-build:grok-4.5',
        mcpServers: { a: { command: '/bin/a' } },
      });
      // ACP delivers MCP servers at session/new or session/load only, and this
      // session was neither. Reporting the freshly resolved 1 would claim a
      // delivery that never happened.
      expect(second.deliveredMcpServerCount).toBe(3);
      expect(auditRows(auditPath).some((row) => row.method === 'session/load')).toBe(false);
      // Already on grok-4.5: no redundant round-trip.
      expect(auditRows(auditPath).filter((row) => row.method === 'session/set_model')).toHaveLength(1);

      const unavailable = await protocol.resumeSession(created.id, {
        workspacePath: tempDir,
        model: 'grok-build:grok-9-imaginary',
        mcpServers: {},
      });
      // An unknown id is a -32602 that would kill the turn; report the live
      // model instead of asking for one grok never offered.
      expect(auditRows(auditPath).filter((row) => row.method === 'session/set_model')).toHaveLength(1);
      expect(unavailable.appliedModel).toBe('grok-4.5');
    } finally {
      protocol.destroy();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it('routes a native grok question through the extension seam and answers it', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-acp-question-'));
    const auditPath = path.join(tempDir, 'audit.ndjson');
    const seen: GrokAskUserQuestionRequest[] = [];
    const protocol = new GrokACPProtocol({
      command: process.execPath,
      args: [mockAgentPath()],
      env: { GROK_ACP_TEST_AUDIT_PATH: auditPath },
      onAskUserQuestion: async (request) => {
        seen.push(request);
        return { outcome: 'accepted', answers: { 'Choose one': 'Alpha' }, partial_answers: false };
      },
    });

    try {
      const session = await protocol.createSession({ workspacePath: tempDir, mcpServers: {} });
      for await (const _event of protocol.sendMessage(session, {
        content: 'ASK_QUESTION please',
        sessionId: 'nimbalyst-session-q',
      })) { /* drain */ }

      // Routing is by the turn, not "the active session": the handler is an
      // application-wide static and two grok sessions must not cross.
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        toolCallId: 'call-question-0',
        nimbalystSessionId: 'nimbalyst-session-q',
        workspacePath: fs.realpathSync(tempDir),
        questions: [{ question: 'Choose one' }],
      });
      expect(auditRows(auditPath).find((row) => row.method === '_x.ai/ask_user_question:response')?.params)
        .toEqual({ outcome: 'accepted', answers: { 'Choose one': 'Alpha' }, partial_answers: false });
    } finally {
      protocol.destroy();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it('sends a denial to grok as a reject option rather than a silent cancel', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-acp-deny-'));
    const auditPath = path.join(tempDir, 'audit.ndjson');
    const protocol = new GrokACPProtocol({
      command: process.execPath,
      args: [mockAgentPath()],
      env: { GROK_ACP_TEST_AUDIT_PATH: auditPath },
      onPermissionRequest: async () => ({ decision: 'deny', scope: 'once' }),
    });

    try {
      const session = await protocol.resumeSession('legacy-p-session', {
        workspacePath: tempDir,
        mcpServers: {},
      });
      const events: ProtocolEvent[] = [];
      for await (const event of protocol.sendMessage(session, {
        content: 'Run the captured permission turn',
        sessionId: 'nimbalyst-session-deny',
      })) {
        events.push(event);
      }

      expect(auditRows(auditPath).find((row) => row.method === 'session/request_permission:response')?.params)
        .toEqual({ outcome: { outcome: 'selected', optionId: 'reject-once' } });
      // The denied tool never ran, so no edit reaches the transcript.
      expect(events.some((event) => event.type === 'tool_result')).toBe(false);
      expect(events.find((event) => event.type === 'complete')?.metadata?.stopReason)
        .toBe('cancelled');
    } finally {
      protocol.destroy();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 15_000);
});
