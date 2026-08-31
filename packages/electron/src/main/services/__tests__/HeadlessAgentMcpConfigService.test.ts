// @vitest-environment node
/**
 * Cursor Agent is the only provider that writes MCP servers into a file the
 * user also owns and edits (`.cursor/mcp.json`), so the properties under test
 * are all "we did not clobber their config" — plus one that the resolved,
 * credential-bearing server map never lands anywhere else.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  HeadlessAgentMcpConfigService,
  mergeNimbalystMcpServers,
  resolveHeadlessAgentMcpConfigPath,
  type HeadlessAgentMcpTarget,
} from '../HeadlessAgentMcpConfigService';

describe('mergeNimbalystMcpServers', () => {
  it('keeps every server the user added and namespaces only its own', () => {
    const merged = mergeNimbalystMcpServers(
      {
        mcpServers: {
          'my-server': { command: 'mine' },
          'nimbalyst:stale': { command: 'old' },
        },
        someOtherSetting: true,
      },
      { trackers: { command: 'node', args: ['trackers.js'] } },
    );

    expect(merged.mcpServers).toEqual({
      'my-server': { command: 'mine' },
      'nimbalyst:trackers': { command: 'node', args: ['trackers.js'] },
    });
    // Unrelated top-level keys survive a merge untouched.
    expect(merged.someOtherSetting).toBe(true);
  });

  it('removes stale Nimbalyst entries when the enabled set is empty', () => {
    const merged = mergeNimbalystMcpServers(
      { mcpServers: { 'nimbalyst:gone': { command: 'x' }, keep: { command: 'y' } } },
      {},
    );
    expect(merged.mcpServers).toEqual({ keep: { command: 'y' } });
  });
});

describe('resolveHeadlessAgentMcpConfigPath', () => {
  it('scopes Cursor to the workspace and never resolves outside .cursor', () => {
    // Every target this service accepts, so a new one cannot quietly reopen a
    // credential-bearing file for an agent that gets its servers inline. Grok
    // is not a target: it receives them through ACP `session/new`, and the
    // `~/.grok/mcp.json` this used to write is mode 0644 resolved secrets.
    const targets: HeadlessAgentMcpTarget[] = ['cursor-agent'];
    for (const target of targets) {
      expect(resolveHeadlessAgentMcpConfigPath(target, '/proj', '/home/u'))
        .toBe(path.join('/proj', '.cursor', 'mcp.json'));
      // No workspace: fall back to the user-level file rather than writing nowhere.
      expect(resolveHeadlessAgentMcpConfigPath(target, undefined, '/home/u'))
        .toBe(path.join('/home/u', '.cursor', 'mcp.json'));
    }
  });
});

describe('HeadlessAgentMcpConfigService.sync', () => {
  let workspace: string;
  const service = new HeadlessAgentMcpConfigService();
  const configPath = () => path.join(workspace, '.cursor', 'mcp.json');

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'nim-mcp-'));
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('creates the file and its directory on first write', async () => {
    const written = await service.sync('cursor-agent', { trackers: { command: 'node' } }, workspace);
    expect(written).toBe(configPath());
    const parsed = JSON.parse(await fs.readFile(configPath(), 'utf8'));
    expect(parsed.mcpServers['nimbalyst:trackers']).toEqual({ command: 'node' });
  });

  it('does not rewrite an unchanged file', async () => {
    await service.sync('cursor-agent', { trackers: { command: 'node' } }, workspace);
    const second = await service.sync('cursor-agent', { trackers: { command: 'node' } }, workspace);
    // Rewriting on every turn would churn a file the user may have open.
    expect(second).toBeNull();
  });

  it('leaves a malformed config alone rather than replacing it', async () => {
    await fs.mkdir(path.dirname(configPath()), { recursive: true });
    await fs.writeFile(configPath(), '{ this is not json', 'utf8');

    const written = await service.sync('cursor-agent', { trackers: { command: 'node' } }, workspace);

    expect(written).toBeNull();
    // The user's file is configuration we failed to read, not configuration
    // that is worthless. Overwriting it destroys settings we cannot see.
    expect(await fs.readFile(configPath(), 'utf8')).toBe('{ this is not json');
  });
});
