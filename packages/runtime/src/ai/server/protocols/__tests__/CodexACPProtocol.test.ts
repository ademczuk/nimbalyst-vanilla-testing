// @vitest-environment node

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { CodexACPProtocol, appendBoundedTail } from '../CodexACPProtocol';

function fixturePath(): string {
  return fileURLToPath(new URL('./fixtures/mockCodexAcpAgent.mjs', import.meta.url));
}

function auditRows(auditPath: string): Array<{ method: string; params: Record<string, string | null> }> {
  return fs.readFileSync(auditPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('CodexACPProtocol', () => {
  it('streams ACP updates, permission previews, and completion data', async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-acp-protocol-'));
    const protocol = new CodexACPProtocol('test-key', {
      command: process.execPath,
      args: [fixturePath()],
      onPermissionRequest: async () => ({
        decision: 'allow',
        scope: 'session',
      }),
    });

    try {
      const session = await protocol.createSession({
        workspacePath,
        permissionMode: 'ask',
      });

      const events: any[] = [];
      for await (const event of protocol.sendMessage(session, {
        content: 'Apply the ACP edit',
      })) {
        events.push(event);
      }

      expect(events.some((event) => event.type === 'raw_event' && event.metadata?.rawEvent?.type === 'session/request_permission')).toBe(true);
      expect(events.some((event) => event.type === 'text' && event.content === 'Starting ACP turn')).toBe(true);
      expect(events.some((event) => event.type === 'text' && event.content === 'ACP edit applied')).toBe(true);
      expect(events.some((event) => event.type === 'tool_call' && event.toolCall?.name === 'Write')).toBe(true);

      const completeEvent = events.find((event) => event.type === 'complete');
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.contextFillTokens).toBe(42);
      expect(completeEvent?.contextWindow).toBe(100);

      expect(fs.readFileSync(path.join(workspacePath, 'acp-target.txt'), 'utf-8')).toBe('after from acp\n');
    } finally {
      protocol.destroy();
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
  }, 15000);

  it('maps denied ACP permission requests to failed tool results', async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-acp-protocol-deny-'));
    const protocol = new CodexACPProtocol('test-key', {
      command: process.execPath,
      args: [fixturePath()],
      onPermissionRequest: async () => ({
        decision: 'deny',
        scope: 'once',
      }),
    });

    try {
      const session = await protocol.createSession({
        workspacePath,
        permissionMode: 'ask',
      });

      const events: any[] = [];
      for await (const event of protocol.sendMessage(session, {
        content: 'Reject the ACP edit',
      })) {
        events.push(event);
      }

      expect(events.some((event) => event.type === 'tool_call' && event.toolCall?.result?.success === false)).toBe(true);
      expect(fs.existsSync(path.join(workspacePath, 'acp-target.txt'))).toBe(false);
    } finally {
      protocol.destroy();
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
  }, 15000);

  it('delivers the configured OPENAI_API_KEY and no other key the shell happens to hold', async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-acp-env-'));
    const configuredAudit = path.join(workspacePath, 'configured.ndjson');
    const unconfiguredAudit = path.join(workspacePath, 'unconfigured.ndjson');
    const saved = { openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY };
    // The exact CLAUDE.md incident: unrelated keys sitting in the user's shell.
    // They must never authenticate or bill the Codex child.
    process.env.OPENAI_API_KEY = 'sentinel-from-user-shell';
    process.env.ANTHROPIC_API_KEY = 'sentinel-from-user-shell';

    const withKey = new CodexACPProtocol('configured-key', {
      command: process.execPath,
      args: [fixturePath()],
      env: {
        CODEX_ACP_TEST_AUDIT_PATH: configuredAudit,
        CODEX_ACP_TEST_PASSTHROUGH: 'delivered',
        // Scrubbing must be the LAST step, so even a key handed in explicitly
        // is dropped rather than merged back over a sanitized map.
        XAI_API_KEY: 'sentinel-from-extra-env',
      },
    });
    const withoutKey = new CodexACPProtocol('', {
      command: process.execPath,
      args: [fixturePath()],
      env: { CODEX_ACP_TEST_AUDIT_PATH: unconfiguredAudit },
    });

    try {
      await withKey.createSession({ workspacePath });
      await withoutKey.createSession({ workspacePath });

      // Observed inside the child, not in what the protocol assembled: the bug
      // was the spawn site merging process.env back over the sanitized map, and
      // a test on that map passes while the shell key still ships.
      expect(auditRows(configuredAudit).find((row) => row.method === 'process:env')?.params).toEqual({
        // The key the user configured in Nimbalyst settings -- not the shell's.
        OPENAI_API_KEY: 'configured-key',
        ANTHROPIC_API_KEY: null,
        XAI_API_KEY: null,
        CODEX_ACP_TEST_PASSTHROUGH: 'delivered',
      });
      // No configured key means no key at all; the shell's does not stand in.
      expect(auditRows(unconfiguredAudit).find((row) => row.method === 'process:env')?.params)
        .toMatchObject({ OPENAI_API_KEY: null, ANTHROPIC_API_KEY: null });
    } finally {
      withKey.destroy();
      withoutKey.destroy();
      process.env.OPENAI_API_KEY = saved.openai;
      process.env.ANTHROPIC_API_KEY = saved.anthropic;
      if (saved.openai === undefined) delete process.env.OPENAI_API_KEY;
      if (saved.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
  }, 15000);

  it('inlines document attachments as additional text prompt blocks', async () => {
    const protocol = new CodexACPProtocol('test-key', {
      command: process.execPath,
      args: [fixturePath()],
    });
    const attachmentPath = path.join(os.tmpdir(), `codex-acp-doc-${Date.now()}.txt`);
    fs.writeFileSync(attachmentPath, 'prompt attachment body', 'utf-8');

    try {
      const blocks = await (protocol as any).buildPromptBlocks({
        content: 'Review @notes.txt',
        attachments: [
          {
            id: 'doc-1',
            filename: 'notes.txt',
            filepath: attachmentPath,
            mimeType: 'text/plain',
            size: 22,
            type: 'document',
            addedAt: Date.now(),
          },
        ],
      });

      expect(blocks).toEqual([
        { type: 'text', text: 'Review @notes.txt' },
        { type: 'text', text: '<file name="notes.txt">\nprompt attachment body\n</file>' },
      ]);
    } finally {
      fs.rmSync(attachmentPath, { force: true });
      protocol.destroy();
    }
  });
});

describe('appendBoundedTail', () => {
  it('returns the combined buffer when under the limit', () => {
    const result = appendBoundedTail(Buffer.from('abc'), Buffer.from('def'), 16);
    expect(result.toString('utf-8')).toBe('abcdef');
  });

  it('caps the buffer to maxBytes when the combined size exceeds it', () => {
    const result = appendBoundedTail(Buffer.from('abcdef'), Buffer.from('ghij'), 4);
    expect(result.length).toBe(4);
    expect(result.toString('utf-8')).toBe('ghij');
  });

  it('drops only the oldest bytes when exceeding maxBytes', () => {
    const result = appendBoundedTail(Buffer.from('abcdefgh'), Buffer.from('ij'), 6);
    expect(result.toString('utf-8')).toBe('efghij');
  });

  it('takes the tail of a single chunk that is itself larger than maxBytes', () => {
    const result = appendBoundedTail(Buffer.from('xy'), Buffer.from('abcdefghij'), 4);
    expect(result.toString('utf-8')).toBe('ghij');
  });

  it('stays bounded across many appends, simulating long-running stderr', () => {
    const limit = 1024;
    let tail: Buffer = Buffer.alloc(0);
    const line = Buffer.from('codex stderr line that is forty bytes!\n');
    // 100k iterations * 39 bytes ~= 3.9 MB of input, retained must stay <= limit.
    for (let i = 0; i < 100_000; i++) {
      tail = appendBoundedTail(tail, line, limit);
    }
    expect(tail.length).toBeLessThanOrEqual(limit);
    // The retained tail must contain only data from the recent appends.
    expect(tail.toString('utf-8').endsWith('codex stderr line that is forty bytes!\n')).toBe(true);
  });
});
