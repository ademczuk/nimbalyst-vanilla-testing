// Exercises OpenAICodexProvider.maybeBuildAppServerFileChangeSnapshots in
// isolation. This is the load-bearing piece of Phase 3 of the codex
// app-server migration: when the protocol layer emits a `raw_event` with
// metadata.transport='app-server' and method='item/completed' carrying a
// fileChange item, the provider must produce a `pre_edit_snapshot` chunk
// (reverse-applied from the diff) and a `post_edit_snapshot` chunk (read
// from disk).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OpenAICodexProvider } from '../OpenAICodexProvider';
import { BaseAgentProvider } from '../BaseAgentProvider';

describe('OpenAICodexProvider.maybeBuildAppServerFileChangeSnapshots', () => {
  let workspace: string;
  let provider: OpenAICodexProvider;

  beforeEach(async () => {
    BaseAgentProvider.setTrustChecker({ shouldBypassPermissions: () => false } as never);
    BaseAgentProvider.setPermissionPatternSaver({ savePattern: vi.fn() } as never);
    BaseAgentProvider.setPermissionPatternChecker({ checkPattern: () => null } as never);
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-appserver-unit-'));
    // Construct provider with an explicit dep so the constructor doesn't try
    // to spawn anything during testing. We pass `transport: 'sdk'` AND a mock
    // protocol so the constructor takes the deps.protocol branch.
    provider = new OpenAICodexProvider({}, {
      transport: 'sdk',
      protocol: {
        platform: 'mock',
        createSession: vi.fn() as never,
        resumeSession: vi.fn() as never,
        forkSession: vi.fn() as never,
        sendMessage: () => (async function* () {})() as never,
        abortSession: vi.fn() as never,
        cleanupSession: vi.fn() as never,
      } as never,
    });
  });

  afterEach(async () => {
    try { await fs.rm(workspace, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function makeAppServerCompletedEvent(item: { id: string; type: string; status: string; changes: unknown[] }) {
    return {
      type: 'raw_event' as const,
      metadata: {
        transport: 'app-server',
        method: 'item/completed',
        params: { threadId: 't-1', turnId: 'turn-1', item },
      },
    };
  }

  it('produces pre/post snapshots for add + update + delete kinds', async () => {
    // Workspace files for kinds that need real disk state.
    const updatePath = path.join(workspace, 'note.md');
    await fs.writeFile(updatePath, 'one\nTWO\nthree\n', 'utf8'); // post-edit content
    const addPath = path.join(workspace, 'fruits.md');
    await fs.writeFile(addPath, 'apple\nbanana\ncherry\n', 'utf8'); // codex already wrote it
    // delete kind: file was already removed; the diff carries the old content.

    const event = makeAppServerCompletedEvent({
      id: 'call_full',
      type: 'fileChange',
      status: 'completed',
      changes: [
        { path: addPath, kind: { type: 'add' }, diff: 'apple\nbanana\ncherry\n' },
        { path: updatePath, kind: { type: 'update', move_path: null }, diff: '@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n' },
        { path: path.join(workspace, 'gone.md'), kind: { type: 'delete' }, diff: '-bye\n-cruel\n-world\n' },
      ],
    });

    // Method is private; access via (provider as any).
    const result = await (provider as unknown as {
      maybeBuildAppServerFileChangeSnapshots: (e: unknown, s: string) => Promise<{ preEdit: unknown; postEdit: unknown }>;
    }).maybeBuildAppServerFileChangeSnapshots(event, 'sess-app');

    expect(result.preEdit).toBeTruthy();
    expect(result.postEdit).toBeTruthy();

    const preEntries = (result.preEdit as { preEditSnapshot: { entries: Array<{ path: string; content: string | null; kind?: string }> } }).preEditSnapshot.entries;
    const postEntries = (result.postEdit as { postEditSnapshot: { entries: Array<{ path: string; content: string; kind?: string }> } }).postEditSnapshot.entries;

    // Add: pre is empty, post is the raw final content.
    expect(preEntries.find((e) => e.path === addPath)).toMatchObject({ content: '', kind: 'add' });
    expect(postEntries.find((e) => e.path === addPath)).toMatchObject({ content: 'apple\nbanana\ncherry\n', kind: 'add' });

    // Update: pre is reverse-applied; post is current disk.
    expect(preEntries.find((e) => e.path === updatePath)).toMatchObject({ content: 'one\ntwo\nthree\n', kind: 'update' });
    expect(postEntries.find((e) => e.path === updatePath)).toMatchObject({ content: 'one\nTWO\nthree\n', kind: 'update' });

    // Delete: pre carries the reconstructed-from-diff old content; no post entry.
    const deletePath = path.join(workspace, 'gone.md');
    expect(preEntries.find((e) => e.path === deletePath)).toMatchObject({ content: 'bye\ncruel\nworld\n', kind: 'delete' });
    expect(postEntries.find((e) => e.path === deletePath)).toBeUndefined();

    // Same edit-group ID across pre/post.
    const preId = (result.preEdit as { preEditSnapshot: { toolUseId: string } }).preEditSnapshot.toolUseId;
    const postId = (result.postEdit as { postEditSnapshot: { toolUseId: string } }).postEditSnapshot.toolUseId;
    expect(preId).toBe(postId);
  });

  it('dedupes repeated item/completed for the same itemId', async () => {
    const updatePath = path.join(workspace, 'note.md');
    await fs.writeFile(updatePath, 'one\nTWO\nthree\n', 'utf8');
    const event = makeAppServerCompletedEvent({
      id: 'call_dedupe',
      type: 'fileChange',
      status: 'completed',
      changes: [
        { path: updatePath, kind: { type: 'update', move_path: null }, diff: '@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n' },
      ],
    });

    const m = (provider as unknown as {
      maybeBuildAppServerFileChangeSnapshots: (e: unknown, s: string) => Promise<{ preEdit: unknown; postEdit: unknown }>;
    });
    const first = await m.maybeBuildAppServerFileChangeSnapshots(event, 'sess-dedupe');
    const second = await m.maybeBuildAppServerFileChangeSnapshots(event, 'sess-dedupe');

    expect(first.preEdit).toBeTruthy();
    expect(second.preEdit).toBeNull();
    expect(second.postEdit).toBeNull();
  });

  it('returns empty when transport metadata is missing', async () => {
    const eventWithoutTransport = {
      type: 'raw_event' as const,
      metadata: {
        // no transport / method / params
      },
    };
    const result = await (provider as unknown as {
      maybeBuildAppServerFileChangeSnapshots: (e: unknown, s: string) => Promise<{ preEdit: unknown; postEdit: unknown }>;
    }).maybeBuildAppServerFileChangeSnapshots(eventWithoutTransport, 'sess-x');
    expect(result.preEdit).toBeNull();
    expect(result.postEdit).toBeNull();
  });
});

// NIM-2962: a dead MCP server reports `status: 'failed'` on
// mcpServer/startupStatus/updated. The protocol layer used to discard it as
// "informational", so an agent could silently lose all of a server's tools
// with nothing in the UI. Codex is not special here -- ClaudeCodeProvider
// already emits `mcpServerStatus:changed` into a pipeline that ends at a
// session chip, so the fix is to feed the SAME pipeline rather than invent a
// new event.
//
// Payloads below are verbatim from a live codex 0.144.1 app-server
// (temptests/codex-appserver-probe2.mjs) pointed at the retired
// https://mcp.linear.app/sse endpoint.
describe('OpenAICodexProvider MCP startup status', () => {
  let provider: OpenAICodexProvider;

  beforeEach(() => {
    BaseAgentProvider.setTrustChecker({ shouldBypassPermissions: () => false } as never);
    BaseAgentProvider.setPermissionPatternSaver({ savePattern: vi.fn() } as never);
    BaseAgentProvider.setPermissionPatternChecker({ checkPattern: () => null } as never);
    provider = new OpenAICodexProvider({}, {
      transport: 'sdk',
      protocol: {
        platform: 'mock',
        createSession: vi.fn() as never,
        resumeSession: vi.fn() as never,
        forkSession: vi.fn() as never,
        sendMessage: () => (async function* () {})() as never,
        abortSession: vi.fn() as never,
        cleanupSession: vi.fn() as never,
      } as never,
    });
  });

  const statusEvent = (name: string, status: string, error: string | null = null) => ({
    type: 'raw_event' as const,
    metadata: {
      transport: 'app-server',
      method: 'mcpServer/startupStatus/updated',
      params: { threadId: 't-1', name, status, error, failureReason: null },
    },
  });

  it('emits mcpServerStatus:changed with a failed server so the UI can show it', () => {
    const emitted: Array<{ servers: Array<{ name: string; status: string; error?: string }> }> = [];
    provider.on('mcpServerStatus:changed', (p) => emitted.push(p as never));

    provider.handleAppServerMcpStatus(statusEvent('home-assistant', 'starting'), 'sess-1');
    provider.handleAppServerMcpStatus(statusEvent('home-assistant', 'ready'), 'sess-1');
    provider.handleAppServerMcpStatus(
      statusEvent(
        'nimbalyst_dead',
        'failed',
        'MCP client for `nimbalyst_dead` failed to start: HTTP 404: 404 Not Found, when send initialize request',
      ),
      'sess-1',
    );

    expect(emitted.length).toBeGreaterThan(0);
    const servers = emitted[emitted.length - 1].servers;
    expect(servers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'home-assistant', status: 'connected' }),
        expect.objectContaining({ name: 'nimbalyst_dead', status: 'failed' }),
      ]),
    );
    const dead = servers.find((s) => s.name === 'nimbalyst_dead');
    expect(dead?.error).toContain('404');
  });

  it('does not re-emit when a server repeats the status it already had', () => {
    const emitted: unknown[] = [];
    provider.on('mcpServerStatus:changed', (p) => emitted.push(p));

    provider.handleAppServerMcpStatus(statusEvent('node_repl', 'ready'), 'sess-1');
    const afterFirst = emitted.length;
    provider.handleAppServerMcpStatus(statusEvent('node_repl', 'ready'), 'sess-1');

    expect(emitted.length).toBe(afterFirst);
  });

  it('ignores events from other transports and other methods', () => {
    const emitted: unknown[] = [];
    provider.on('mcpServerStatus:changed', (p) => emitted.push(p));

    provider.handleAppServerMcpStatus(
      { type: 'raw_event' as const, metadata: { transport: 'sdk', method: 'mcpServer/startupStatus/updated', params: { name: 'x', status: 'failed' } } },
      'sess-1',
    );
    provider.handleAppServerMcpStatus(
      { type: 'raw_event' as const, metadata: { transport: 'app-server', method: 'item/completed', params: {} } },
      'sess-1',
    );

    expect(emitted).toHaveLength(0);
  });
});

// Phase 4 -- the declared capability contract.
//
// #1251-#1254 all shared one root cause: capabilities were optional
// duck-typed methods, so "this provider never implemented it" and "this
// provider has none right now" were the same observable -- an empty array.
// Codex is the case that proves the two apart: it declares slash commands
// UNSUPPORTED (nothing in the app-server interprets them, so
// KNOWN_SLASH_COMMANDS is deliberately empty) while declaring skills
// SUPPORTED, whose list is legitimately empty until the transport answers
// skills/list.
describe('OpenAICodexProvider declared capabilities', () => {
  const mockProtocol = (extra: Record<string, unknown> = {}) => ({
    platform: 'mock',
    createSession: vi.fn() as never,
    resumeSession: vi.fn() as never,
    forkSession: vi.fn() as never,
    sendMessage: () => (async function* () {})() as never,
    abortSession: vi.fn() as never,
    cleanupSession: vi.fn() as never,
    ...extra,
  });

  beforeEach(() => {
    BaseAgentProvider.setTrustChecker({ shouldBypassPermissions: () => false } as never);
    BaseAgentProvider.setPermissionPatternSaver({ savePattern: vi.fn() } as never);
    BaseAgentProvider.setPermissionPatternChecker({ checkPattern: () => null } as never);
  });

  it('reports unsupported slash commands and supported-but-empty skills distinctly', () => {
    const provider = new OpenAICodexProvider({}, { transport: 'sdk', protocol: mockProtocol() as never });
    const capabilities = provider.getAgentCapabilities();

    // Both accessors return [] -- only the declaration tells them apart.
    expect(provider.getSlashCommands()).toEqual([]);
    expect(provider.getSkills()).toEqual([]);
    expect(capabilities.slashCommands).toBe(false);
    expect(capabilities.skills).toBe(true);
  });

  it('narrows compaction to the live transport rather than the provider type', () => {
    const noCompact = new OpenAICodexProvider({}, { transport: 'sdk', protocol: mockProtocol() as never });
    const withCompact = new OpenAICodexProvider({}, {
      transport: 'sdk',
      protocol: mockProtocol({ compactSession: vi.fn() }) as never,
    });

    expect(noCompact.getAgentCapabilities().compaction).toBe('unsupported');
    expect(withCompact.getAgentCapabilities().compaction).toBe('rpc');
  });
});
