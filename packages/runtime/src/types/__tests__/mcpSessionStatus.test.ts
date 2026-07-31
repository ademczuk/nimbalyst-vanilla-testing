/**
 * Snapshot builder for the in-session MCP status surface (NIM-2272 / GH #1089).
 *
 * Two things this file exists to protect:
 * - Credentials never reach the payload. The SDK status object and the config
 *   snapshot both carry secrets; the builder copies whitelisted scalars only.
 * - "Absent" means something. A server missing from an unpolled session is
 *   unknown, not stripped, and saying otherwise would misdiagnose the very
 *   bugs this surface exists to explain.
 */

import { describe, expect, it } from 'vitest';
import {
  buildMcpSessionStatusSnapshot,
  type McpSessionStatusInput,
} from '../MCPServerConfig';

const POLLED_AT = 1_700_000_000_000;

function status(overrides: Partial<McpSessionStatusInput> & { name: string }): McpSessionStatusInput {
  return { status: 'connected', ...overrides };
}

describe('buildMcpSessionStatusSnapshot', () => {
  it('maps SDK statuses to rows with scope, tool count, and error text', () => {
    const snapshot = buildMcpSessionStatusSnapshot({
      sessionId: 's1',
      supported: true,
      active: true,
      statuses: [
        status({ name: 'trackers', scope: 'local', tools: [{}, {}, {}] }),
        status({
          name: 'internal-tools',
          status: 'failed',
          scope: 'project',
          error: 'connection closed unexpectedly',
        }),
      ],
      configuredNames: ['trackers', 'internal-tools'],
      lastCheckedAt: POLLED_AT,
    });

    expect(snapshot.servers).toEqual([
      { name: 'trackers', state: 'connected', scope: 'local', toolCount: 3 },
      {
        name: 'internal-tools',
        state: 'failed',
        scope: 'project',
        error: 'connection closed unexpectedly',
      },
    ]);
    expect(snapshot.lastCheckedAt).toBe(POLLED_AT);
  });

  it('marks a configured server the CLI never reported as absent', () => {
    const snapshot = buildMcpSessionStatusSnapshot({
      sessionId: 's1',
      supported: true,
      active: true,
      statuses: [status({ name: 'trackers' })],
      configuredNames: ['trackers', 'google-drive'],
      lastCheckedAt: POLLED_AT,
    });

    expect(snapshot.servers.find((s) => s.name === 'google-drive')).toEqual({
      name: 'google-drive',
      state: 'absent',
    });
  });

  it('does not report absent servers before the first poll', () => {
    const snapshot = buildMcpSessionStatusSnapshot({
      sessionId: 's1',
      supported: true,
      active: true,
      statuses: [],
      configuredNames: ['trackers', 'google-drive'],
      lastCheckedAt: null,
    });

    expect(snapshot.servers).toEqual([]);
  });

  it('reports nothing absent when the config snapshot has not settled', () => {
    const snapshot = buildMcpSessionStatusSnapshot({
      sessionId: 's1',
      supported: true,
      active: true,
      statuses: [status({ name: 'trackers' })],
      configuredNames: null,
      lastCheckedAt: POLLED_AT,
    });

    expect(snapshot.servers.map((s) => s.name)).toEqual(['trackers']);
  });

  it('drops any field outside the whitelist, including credential-bearing config', () => {
    const snapshot = buildMcpSessionStatusSnapshot({
      sessionId: 's1',
      supported: true,
      active: true,
      statuses: [
        {
          name: 'remote',
          status: 'connected',
          scope: 'user',
          serverInfo: { name: 'remote', version: '2.1.0' },
          // Fields the SDK carries that must never cross IPC.
          config: {
            url: 'https://internal.example.com/mcp',
            headers: { Authorization: 'Bearer super-secret' },
            env: { API_KEY: 'sk-live-nope' },
          },
        } as McpSessionStatusInput,
      ],
      configuredNames: ['remote'],
      lastCheckedAt: POLLED_AT,
    });

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('sk-live-nope');
    expect(serialized).not.toContain('internal.example.com');
    expect(snapshot.servers[0]).toEqual({
      name: 'remote',
      state: 'connected',
      scope: 'user',
      version: '2.1.0',
    });
  });

  it('falls back to pending for a status string the SDK adds later', () => {
    const snapshot = buildMcpSessionStatusSnapshot({
      sessionId: 's1',
      supported: true,
      active: true,
      statuses: [status({ name: 'future', status: 'reconnecting' })],
      configuredNames: null,
      lastCheckedAt: POLLED_AT,
    });

    expect(snapshot.servers[0].state).toBe('pending');
  });
});
