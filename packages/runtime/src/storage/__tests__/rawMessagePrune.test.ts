// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  classifyPrunableRawMessage,
  readCodexDeltaItemId,
  PRUNE_REASON_SUPERSESSION_PROOF,
  type PruneReason,
} from '../rawMessagePrune';
import {
  isTransientClaudeCodeFrame,
  CODEX_APP_SERVER_STATUS_EVENT_TYPES,
  CODEX_APP_SERVER_SUPERSEDED_DELTA_METHODS,
  CODEX_APP_SERVER_TRANSIENT_EVENT_TYPES,
} from '../nonRenderingFrames';
import { isTransientClaudeCodeChunk } from '../../ai/server/providers/claudeCode/toolChunkUtils';
import { HeadlessAgentRawParser, type HeadlessAgentKind } from '../../ai/server/transcript/parsers/HeadlessAgentRawParser';
import type { ParseContext } from '../../ai/server/transcript/parsers/IRawMessageParser';
import type { RawMessage } from '../../ai/server/transcript/TranscriptTransformer';
import { shouldSyncMessageForSessionRoom } from '../../sync/syncContentTruncator';
import {
  mapGrokAcpSessionUpdate,
  mapGrokRecord,
  readGrokACPUpdateEnvelope,
} from '../../ai/server/protocols/headless/GrokBuildRecordMapper';
import { mapCursorRecord } from '../../ai/server/protocols/headless/CursorAgentRecordMapper';

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

  // A delta and a token counter both render nothing, but only one of them makes
  // a claim about another row. Sharing one reason is what let a cancelled
  // codex turn's only partial message through the driver's guard unproven, so
  // the reasons -- and the proof each demands -- must stay apart.
  it('separates codex delta frames, which need proof, from pure status frames', () => {
    const delta = json({
      method: 'item/agentMessage/delta',
      params: { threadId: 't', turnId: 'turn', itemId: 'msg_1', delta: 'hi' },
    });
    expect(classifyPrunableRawMessage(delta, 'openai-codex')).toBe('codexAgentMessageDelta');
    expect(classifyPrunableRawMessage(
      json({ method: 'item/commandExecution/outputDelta', params: { threadId: 't', itemId: 'cmd_1' } }),
      'openai-codex',
    )).toBe('codexCommandOutputDelta');

    for (const method of [
      'thread/tokenUsage/updated', 'account/rateLimits/updated', 'thread/status/changed',
      'mcpServer/startupStatus/updated', 'turn/started', 'turn/completed', 'turn/diff/updated',
      'skills/changed',
    ]) {
      const reason = classifyPrunableRawMessage(json({ method, params: {} }), 'openai-codex');
      expect(reason).toBe('codexAppServerStatus');
      expect(PRUNE_REASON_SUPERSESSION_PROOF.has(reason!)).toBe(false);
    }

    expect(PRUNE_REASON_SUPERSESSION_PROOF.get('codexAgentMessageDelta')).toBe('codexItemCompleted');
    expect(PRUNE_REASON_SUPERSESSION_PROOF.get('codexCommandOutputDelta')).toBe('codexItemCompleted');

    // The driver proves supersession per ITEM, so the id has to survive the
    // trip out of the row. A delta that names none is unprovable and must say so.
    expect(readCodexDeltaItemId(delta)).toBe('msg_1');
    expect(readCodexDeltaItemId(json({ method: 'item/agentMessage/delta', params: { delta: 'hi' } })))
      .toBeNull();
    expect(readCodexDeltaItemId('{not json')).toBeNull();
  });

  // The provider's `fullText` accumulates `case 'text':` only -- `case
  // 'reasoning':` is a bare break -- so the turn-final `item.completed` it
  // synthesizes carries assistant text and no reasoning. Nothing supersedes a
  // thought chunk, at any age, for any turn.
  it('never proposes a reasoning delta, however the turn ended', () => {
    const reasoningShapes: Array<[HeadlessAgentKind, Record<string, unknown>]> = [
      ['grok-build', { type: 'thought', data: 'partial' }],
      ['grok-build', {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 's',
          update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'partial' } },
        },
      }],
      ['cursor-agent', { type: 'thinking', subtype: 'delta', text: 'partial' }],
    ];
    for (const [source, record] of reasoningShapes) {
      expect(classifyPrunableRawMessage(json(record), source)).toBeNull();
    }
  });

  // The prune lane's entire safety argument is that its headless classifier
  // REPORTS what the parser renders instead of defining it. Prove that coupling
  // against the REAL parser -- record mapper and `projectEvent` included, no
  // classifier short-circuit in the read path -- so that teaching the parser to
  // render one of these shapes turns this red in the same commit.
  it('prunes only headless frames the real parser renders as nothing', async () => {
    const outputRow = (record: unknown) => ({
      direction: 'output', content: json(record),
    }) as RawMessage;
    const context = {} as ParseContext;
    const mapped = (kind: HeadlessAgentKind, record: Record<string, unknown>) => {
      if (kind === 'cursor-agent') return mapCursorRecord(record).map((e) => e.type);
      const acpUpdate = readGrokACPUpdateEnvelope(record);
      return (acpUpdate ? mapGrokAcpSessionUpdate(acpUpdate, '') : mapGrokRecord(record, ''))
        .map((e) => e.type);
    };
    const acpDelta = (sessionUpdate: 'agent_message_chunk' | 'agent_thought_chunk') => ({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 's',
        update: { sessionUpdate, content: { type: 'text', text: 'partial' } },
      },
    });

    // Third column: the reason, or null for a shape that renders nothing and is
    // still never proposed -- rendering nothing is necessary, not sufficient.
    // Last column: the protocol events the mapper decodes the record into. It
    // keeps the assertion honest -- without it a misspelled fixture would fall
    // through to the mapper's `default` and "renders nothing" would be vacuous.
    const nonRendering: Array<[HeadlessAgentKind, Record<string, unknown>, PruneReason | null, string[]]> = [
      ['grok-build', { type: 'text', data: 'partial' }, 'headlessAgentTextDelta', ['text']],
      ['grok-build', { type: 'thought', data: 'partial' }, null, ['reasoning']],
      ['grok-build', acpDelta('agent_message_chunk'), 'grokAcpTextDelta', ['text']],
      ['grok-build', acpDelta('agent_thought_chunk'), null, ['reasoning']],
      // The one shape with no mapper branch anywhere: a static built-in catalog.
      ['grok-build', { type: 'available_commands', commands: [{ name: 'read_file' }] }, 'grokAvailableCommands', []],
      ['cursor-agent', { type: 'assistant', message: { content: [{ type: 'text', text: 'partial' }] } },
        'headlessAgentTextDelta', ['text']],
      ['cursor-agent', { type: 'thinking', subtype: 'delta', text: 'partial' }, null, ['reasoning']],
    ];

    for (const [source, record, reason, decodesTo] of nonRendering) {
      expect(mapped(source, record)).toEqual(decodesTo);
      expect(await new HeadlessAgentRawParser(source).parseMessage(outputRow(record), context)).toEqual([]);
      expect(classifyPrunableRawMessage(json(record), source)).toBe(reason);
      if (reason === null) continue;
      // A text delta's premise is "the turn-final item.completed holds this",
      // and only that turn's own completion can attest to it. The catalog is a
      // static built-in superseded by nothing, so it carries no such premise.
      expect(PRUNE_REASON_SUPERSESSION_PROOF.get(reason))
        .toBe(reason === 'grokAvailableCommands' ? undefined : 'headlessTurnFinal');
    }

    const rendered = {
      type: 'item.completed',
      item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] },
    };
    for (const source of ['grok-build', 'cursor-agent'] as const) {
      expect(await new HeadlessAgentRawParser(source).parseMessage(outputRow(rendered), context)).not.toEqual([]);
      expect(classifyPrunableRawMessage(json(rendered), source)).toBeNull();
    }

    // Cursor exposes no command-catalog frame, so that shape remains unknown.
    expect(classifyPrunableRawMessage(json({ type: 'available_commands' }), 'cursor-agent')).toBeNull();
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

  // Splitting the codex methods into "delta" and "status" was for the prune
  // lane's benefit only. The wire gate asks a different question -- what to put
  // on the wire, which is not destructive -- and must keep seeing every method
  // that renders nothing, or the deltas quietly start syncing again.
  it('keeps the whole codex set on the wire gate after the delta/status split', () => {
    const methods = [
      ...CODEX_APP_SERVER_SUPERSEDED_DELTA_METHODS,
      ...CODEX_APP_SERVER_STATUS_EVENT_TYPES,
    ];
    expect(methods.length).toBe(CODEX_APP_SERVER_TRANSIENT_EVENT_TYPES.size);
    for (const method of methods) {
      expect(CODEX_APP_SERVER_TRANSIENT_EVENT_TYPES.has(method)).toBe(true);
      expect(shouldSyncMessageForSessionRoom(
        'openai-codex',
        { transport: 'app-server', eventType: method },
        json({ method }),
      )).toBe(false);
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
