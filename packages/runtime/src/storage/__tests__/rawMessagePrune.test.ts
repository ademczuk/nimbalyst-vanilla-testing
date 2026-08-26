// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { classifyPrunableRawMessage } from '../rawMessagePrune';
import { isTransientClaudeCodeFrame } from '../nonRenderingFrames';
import { isTransientClaudeCodeChunk } from '../../ai/server/providers/claudeCode/toolChunkUtils';
import { shouldSyncMessageForSessionRoom } from '../../sync/syncContentTruncator';

const json = (o: unknown) => JSON.stringify(o);

describe('classifyPrunableRawMessage', () => {
  it('prunes a claude-code thinking_tokens progress tick', () => {
    const tick = json({
      type: 'system', subtype: 'thinking_tokens',
      estimated_tokens: 250, estimated_tokens_delta: 100, uuid: 'u', session_id: 's',
    });
    expect(classifyPrunableRawMessage(tick, 'claude-code')).toBe('claudeCodeTransient');
    // Prefix match, so the CLI transport gets the same answer.
    expect(classifyPrunableRawMessage(tick, 'claude-code-cli')).toBe('claudeCodeTransient');
  });

  it('prunes codex delta frames superseded by item/completed', () => {
    expect(classifyPrunableRawMessage(
      json({ method: 'item/agentMessage/delta', params: { threadId: 't', delta: 'hi' } }),
      'openai-codex',
    )).toBe('codexAppServerTransient');
    expect(classifyPrunableRawMessage(
      json({ method: 'item/commandExecution/outputDelta', params: { threadId: 't' } }),
      'openai-codex',
    )).toBe('codexAppServerTransient');
  });

  it('prunes item/started only for item types that emit no descriptor', () => {
    const started = (type: string) => json({ method: 'item/started', params: { item: { type, id: 'i' } } });

    for (const type of ['reasoning', 'commandExecution', 'agentMessage', 'fileChange', 'userMessage']) {
      expect(classifyPrunableRawMessage(started(type), 'openai-codex')).toBe('codexItemStartedNonRendering');
    }
    // These render a widget at START time -- an MCP prompt blocks on the user and
    // item/completed does not fire until they click through. Pruning them would
    // strand the transcript on "Thinking...".
    for (const type of ['mcpToolCall', 'collabAgentToolCall', 'webSearch']) {
      expect(classifyPrunableRawMessage(started(type), 'openai-codex')).toBeNull();
    }
  });

  // The rule that matters most: this is a destructive path, so anything it does
  // not positively recognize must survive.
  it('keeps everything it does not positively recognize', () => {
    const cases: Array<[string, string]> = [
      // Real content, both providers.
      [json({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }), 'claude-code'],
      [json({ type: 'user', message: { content: [{ type: 'tool_result', content: 'out' }] } }), 'claude-code'],
      [json({ method: 'item/completed', params: { item: { type: 'reasoning' } } }), 'openai-codex'],
      // System frames kept on purpose for forensics.
      [json({ type: 'system', subtype: 'init', tools: [] }), 'claude-code'],
      [json({ type: 'system', subtype: 'compact_boundary' }), 'claude-code'],
      [json({ type: 'system', subtype: 'permission_denied' }), 'claude-code'],
      // Unknown provider, unknown shape, unparseable, empty.
      [json({ type: 'system', subtype: 'thinking_tokens' }), 'some-future-provider'],
      [json({ type: 'system', subtype: 'a_subtype_we_have_never_seen' }), 'claude-code'],
      ['{not json', 'claude-code'],
      ['{"method":"item/started"', 'openai-codex'],
      ['', 'claude-code'],
    ];
    for (const [content, source] of cases) {
      expect(classifyPrunableRawMessage(content, source)).toBeNull();
    }
  });

  it('never prunes a claude-code frame the storage write gate would persist', () => {
    // The prune lane must be a subset of "the write path would have dropped it",
    // or a backfill deletes rows a fresh install would still be keeping.
    const frames = [
      { type: 'system', subtype: 'thinking_tokens' },
      { type: 'system', subtype: 'init' },
      { type: 'tool_progress', toolUseId: 't' },
      { type: 'assistant', message: { content: [] } },
    ];
    for (const frame of frames) {
      const pruned = classifyPrunableRawMessage(json(frame), 'claude-code') !== null;
      expect(pruned).toBe(isTransientClaudeCodeChunk(frame));
    }
  });
});

describe('nonRenderingFrames is the single source of truth', () => {
  // These two gates kept private copies of the same set and drifted:
  // `thinking_tokens` was filtered on the wire and persisted to disk for months,
  // and `task_updated` was the reverse. Now that both import the shared set,
  // pin them together so the copies cannot come back.
  it('agrees between the storage write gate and the sync wire gate', () => {
    const subtypes = [
      'thinking_tokens', 'task_updated', 'hook_started', 'hook_response',
      'task_started', 'task_progress', 'task_notification',
    ];
    for (const subtype of subtypes) {
      const frame = { type: 'system', subtype };
      const content = json(frame);
      expect(isTransientClaudeCodeFrame(frame)).toBe(true);
      expect(isTransientClaudeCodeChunk(frame)).toBe(true);
      expect(shouldSyncMessageForSessionRoom('claude-code', null, content)).toBe(false);
    }
  });

  it('still lets frames the transcript renders through both gates', () => {
    for (const frame of [
      { type: 'system', subtype: 'permission_denied' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
    ]) {
      expect(isTransientClaudeCodeFrame(frame)).toBe(false);
      expect(shouldSyncMessageForSessionRoom('claude-code', null, json(frame))).toBe(true);
    }
  });
});
