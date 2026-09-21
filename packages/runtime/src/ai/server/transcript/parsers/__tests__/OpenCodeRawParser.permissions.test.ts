import { describe, expect, it, vi } from 'vitest';
import { OpenCodeRawParser } from '../OpenCodeRawParser';
import type { ParseContext } from '../IRawMessageParser';
import type { RawMessage } from '../../TranscriptTransformer';

function context(): ParseContext {
  return {
    sessionId: 'nim-session-1',
    hasToolCall: () => false,
    hasSubagent: () => false,
    findByProviderToolCallId: vi.fn(async () => null),
    findActiveToolCallByRawProviderId: vi.fn(async () => null),
  };
}

function message(event: Record<string, unknown>): RawMessage {
  return {
    id: 1,
    sessionId: 'nim-session-1',
    source: 'opencode',
    direction: 'output',
    content: JSON.stringify(event),
    createdAt: new Date('2026-09-21T00:00:00Z'),
    hidden: true,
  };
}

describe('OpenCodeRawParser native permissions', () => {
  it('projects a live permission.asked request into a durable ToolPermission call', async () => {
    const parser = new OpenCodeRawParser();
    const descriptors = await parser.parseMessage(
      message({
        type: 'permission.asked',
        properties: {
          id: 'permission-1',
          sessionID: 'oc-session-1',
          permission: 'external_directory',
          patterns: ['/tmp/*'],
          always: ['/tmp/*'],
          metadata: { path: '/tmp/scratch.txt' },
        },
      }),
      context()
    );

    expect(descriptors).toEqual([
      expect.objectContaining({
        type: 'tool_call_started',
        toolName: 'ToolPermission',
        providerToolCallId: 'permission-1',
        arguments: expect.objectContaining({
          requestId: 'permission-1',
          toolName: 'external_directory',
          pattern: 'OpenCode(external_directory:/tmp/*)',
          suppressAlwaysAllowRule: false,
        }),
      }),
    ]);
  });

  it('normalizes the generated-SDK request shape and suppresses reusable scopes without always patterns', async () => {
    const parser = new OpenCodeRawParser();
    const descriptors = await parser.parseMessage(
      message({
        type: 'permission.updated',
        properties: {
          id: 'permission-2',
          sessionID: 'oc-session-1',
          type: 'bash',
          pattern: 'git status',
          title: 'Run git status',
          metadata: {},
        },
      }),
      context()
    );

    expect(descriptors[0]).toMatchObject({
      type: 'tool_call_started',
      providerToolCallId: 'permission-2',
      arguments: {
        toolName: 'bash',
        rawCommand: 'Run git status',
        suppressAlwaysAllowRule: true,
      },
    });
  });

  it.each([
    [
      {
        permissionID: 'permission-1',
        sessionID: 'oc-session-1',
        response: 'always',
      },
      'completed',
      { decision: 'allow', scope: 'always' },
    ],
    [
      { requestID: 'permission-2', sessionID: 'oc-session-1', reply: 'reject' },
      'error',
      { decision: 'deny', scope: 'once' },
    ],
  ])('completes permission cards for both reply shapes', async (properties, status, result) => {
    const parser = new OpenCodeRawParser();
    const descriptors = await parser.parseMessage(message({ type: 'permission.replied', properties }), context());

    expect(descriptors[0]).toMatchObject({
      type: 'tool_call_completed',
      status,
      result: JSON.stringify(result),
    });
  });
});
