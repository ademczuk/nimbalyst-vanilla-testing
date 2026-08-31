/**
 * Canonical-event parser for the headless NDJSON agents (Grok Build, Cursor
 * Agent).
 *
 * Both providers persist their CLI's records verbatim, plus a Codex-shaped
 * `item.completed` at the end of a turn carrying the full assistant text.
 * Cursor and historical Grok rows are flat records; Grok rows written after
 * its ACP transport move are JSON-RPC envelopes around `params.update`. Those
 * shapes intentionally coexist under `source = 'grok-build'` forever.
 *
 * The wire vocabulary this parser must read is exactly the one the protocol
 * adapters already decode — so rather than re-implementing it (and drifting
 * from it), this parser runs the shared Grok/Cursor record mappers and projects
 * their `ProtocolEvent`s onto canonical descriptors.
 *
 * The alternative — a second hand-written decoder per agent — is precisely how
 * `CodexACPRawParser` and `CopilotRawParser` ended up duplicating their
 * protocols' event shapes.
 *
 * A third shape shares the same source: the host's own `nimbalyst_tool_use` /
 * `nimbalyst_tool_result` rows, which carry durable interactive prompts
 * (ToolPermission, AskUserQuestion) into the transcript. They come from
 * Nimbalyst, not the agent, so no record mapper knows them.
 */

import type { RawMessage } from '../TranscriptTransformer';
import type {
  IRawMessageParser,
  ParseContext,
  CanonicalEventDescriptor,
} from './IRawMessageParser';
import type { ProtocolEvent, ToolResult } from '../../protocols/ProtocolInterface';
import {
  mapGrokAcpSessionUpdate,
  mapGrokRecord,
  readGrokACPUpdateEnvelope,
} from '../../protocols/headless/GrokBuildRecordMapper';
import { mapCursorRecord } from '../../protocols/headless/CursorAgentRecordMapper';

export type HeadlessAgentKind = 'grok-build' | 'cursor-agent';

export type NonRenderingHeadlessAgentRecord =
  | 'textDelta'
  | 'reasoningDelta'
  | 'grokAcpTextDelta'
  | 'grokAcpReasoningDelta'
  | 'availableCommands';

/**
 * REPORT which provider records this parser currently renders as nothing.
 *
 * This function must never be consulted by `parseOutput`. It describes the
 * parser's behaviour; it does not produce it. If it short-circuited the read
 * path, then adding a `text` branch to `projectEvent` would leave that branch
 * silently dead while the prune lane went on deleting the frames it was
 * written to render -- verification trusting the source it verifies, which is
 * exactly what `.claude/rules/destructive-data-paths.md` forbids.
 *
 * The coupling is instead proven by test: `rawMessagePrune.test.ts` runs the
 * real parser over each shape named here and asserts it yields no descriptors.
 * Teach the parser to render one of these and that test goes red in the same
 * commit, which is the signal the prune lane's safety argument depends on.
 *
 * Grok and Cursor do not share delta shapes: Grok uses `text` / `thought`,
 * while Cursor uses `assistant` / `thinking` with a `delta` subtype. Only
 * Grok's record stream has an `available_commands` catalog.
 */
export function classifyNonRenderingHeadlessAgentRecord(
  record: Record<string, unknown>,
  kind: HeadlessAgentKind,
): NonRenderingHeadlessAgentRecord | null {
  if (kind === 'grok-build') {
    const acpUpdate = readGrokACPUpdateEnvelope(record);
    if (acpUpdate?.sessionUpdate === 'agent_message_chunk') return 'grokAcpTextDelta';
    if (acpUpdate?.sessionUpdate === 'agent_thought_chunk') return 'grokAcpReasoningDelta';
    if (record.type === 'text') return 'textDelta';
    if (record.type === 'thought') return 'reasoningDelta';
    if (record.type === 'available_commands') return 'availableCommands';
    return null;
  }

  if (record.type === 'assistant') return 'textDelta';
  if (record.type === 'thinking' && record.subtype === 'delta') return 'reasoningDelta';
  return null;
}

export class HeadlessAgentRawParser implements IRawMessageParser {
  constructor(private readonly kind: HeadlessAgentKind) {}

  async parseMessage(
    msg: RawMessage,
    context: ParseContext,
  ): Promise<CanonicalEventDescriptor[]> {
    if (msg.hidden) return [];
    return msg.direction === 'input'
      ? this.parseInput(msg)
      : this.parseOutput(msg, context);
  }

  private parseInput(msg: RawMessage): CanonicalEventDescriptor[] {
    const content = String(msg.content ?? '').trim();
    if (!content) return [];

    if (
      msg.metadata?.promptType === 'system_reminder'
      || /<SYSTEM_REMINDER>[\s\S]*<\/SYSTEM_REMINDER>/.test(content)
    ) {
      return [{ type: 'system_message', text: content, systemType: 'status', createdAt: msg.createdAt }];
    }

    return [{
      type: 'user_message',
      text: content,
      mode: (msg.metadata?.mode as 'agent' | 'planning') ?? 'agent',
      createdAt: msg.createdAt,
    }];
  }

  private async parseOutput(
    msg: RawMessage,
    context: ParseContext,
  ): Promise<CanonicalEventDescriptor[]> {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(msg.content) as Record<string, unknown>;
    } catch {
      const text = String(msg.content ?? '').trim();
      return text ? [{ type: 'assistant_message', text, createdAt: msg.createdAt }] : [];
    }

    // Nimbalyst's own interactive-prompt rows (ToolPermission, AskUserQuestion).
    // These are not agent output: the host writes them so a durable prompt
    // widget has a tool call to render from. Both headless agents raise real
    // permission prompts, and Grok's ACP transport raises native questions, so
    // without this branch the widget the user is supposed to answer never
    // reaches the transcript at all.
    if (record.type === 'nimbalyst_tool_use') {
      return parseNimbalystToolUse(record, msg, context);
    }
    if (record.type === 'nimbalyst_tool_result') {
      return parseNimbalystToolResult(record);
    }

    // New Grok rows are raw ACP JSON-RPC envelopes. Historical Grok rows are
    // flat streaming-json records under the same source, so dispatch from the
    // frame's own structure and keep both paths permanently.
    if (this.kind === 'grok-build') {
      const acpUpdate = readGrokACPUpdateEnvelope(record);
      if (acpUpdate) {
        return mapGrokAcpSessionUpdate(acpUpdate, '')
          .flatMap((event) => projectEvent(event, msg));
      }
    }

    // The turn-final assistant message, stored by the provider in the Codex
    // `item.completed` shape. Text deltas are deliberately not emitted
    // per-chunk: this one message carries the whole response.
    if (record.type === 'item.completed') {
      return parseItemCompleted(record.item, msg);
    }

    const events = this.kind === 'grok-build'
      // The workspace path only matters for absolutizing tool arguments at
      // stream time; by the time a raw message is re-parsed the path is
      // already absolute, and '' leaves an absolute path untouched.
      ? mapGrokRecord(record, '')
      : mapCursorRecord(record);

    return events.flatMap((event) => projectEvent(event, msg));
  }
}

/**
 * Contract mirrors `ClaudeCodeRawParser.parseNimbalystToolUse` and
 * `interactivePromptTranscript.ts`: `name` -> toolName, `input` -> arguments,
 * `id` -> providerToolCallId. The widget answers on `providerToolCallId`, so
 * that id must survive verbatim.
 */
async function parseNimbalystToolUse(
  record: Record<string, unknown>,
  msg: RawMessage,
  context: ParseContext,
): Promise<CanonicalEventDescriptor[]> {
  const id = typeof record.id === 'string' ? record.id : null;
  if (id) {
    if (context.hasToolCall(id)) return [];
    if (await context.findByProviderToolCallId(id)) return [];
  }

  const args = record.input;
  return [{
    type: 'tool_call_started',
    toolName: typeof record.name === 'string' ? record.name : 'unknown',
    toolDisplayName: typeof record.name === 'string' ? record.name : 'unknown',
    arguments: (args && typeof args === 'object' ? args : {}) as Record<string, unknown>,
    providerToolCallId: id,
    createdAt: msg.createdAt,
  }];
}

function parseNimbalystToolResult(
  record: Record<string, unknown>,
): CanonicalEventDescriptor[] {
  const id = typeof record.tool_use_id === 'string'
    ? record.tool_use_id
    : typeof record.id === 'string' ? record.id : null;
  if (!id) return [];

  const isError = record.is_error === true;
  return [{
    type: 'tool_call_completed',
    providerToolCallId: id,
    status: isError ? 'error' : 'completed',
    isError,
    result: typeof record.result === 'string' ? record.result : safeStringify(record.result),
  }];
}

function projectEvent(event: ProtocolEvent, msg: RawMessage): CanonicalEventDescriptor[] {
  switch (event.type) {
    case 'tool_call': {
      const call = event.toolCall;
      if (!call) return [];
      return [{
        type: 'tool_call_started',
        toolName: call.name,
        toolDisplayName: call.name,
        arguments: call.arguments ?? {},
        targetFilePath: readTargetFilePath(call.arguments),
        providerToolCallId: call.id ?? null,
        createdAt: msg.createdAt,
      }];
    }

    case 'tool_result': {
      const id = event.toolResult?.id;
      if (!id) return [];
      const result = event.toolResult?.result;
      const succeeded = typeof result === 'string' || (result as ToolResult | undefined)?.success !== false;
      return [{
        type: 'tool_call_completed',
        providerToolCallId: id,
        status: succeeded ? 'completed' : 'error',
        isError: !succeeded,
        result: typeof result === 'string' ? result : safeStringify(result),
        exitCode: typeof result === 'object' && result !== null
          ? (result as ToolResult).exit_code
          : undefined,
      }];
    }

    case 'error': {
      return event.error
        ? [{ type: 'system_message', text: event.error, systemType: 'error', createdAt: msg.createdAt }]
        : [];
    }

    // Text and reasoning deltas are covered by the turn-final `item.completed`;
    // emitting them here would duplicate the whole response.
    case 'text':
    case 'reasoning':
    case 'usage':
    case 'complete':
    case 'raw_event':
    default:
      return [];
  }
}

function parseItemCompleted(item: unknown, msg: RawMessage): CanonicalEventDescriptor[] {
  if (!item || typeof item !== 'object') return [];
  const record = item as Record<string, unknown>;
  if (record.type !== 'message' || record.role !== 'assistant') return [];
  if (!Array.isArray(record.content)) return [];

  const text = record.content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const p = part as Record<string, unknown>;
      return p.type === 'output_text' && typeof p.text === 'string' ? p.text : '';
    })
    .join('');

  return text ? [{ type: 'assistant_message', text, createdAt: msg.createdAt }] : [];
}

/**
 * The file a tool call targets, for the transcript's file-link affordance.
 *
 * The two agents spell it differently — Grok's edit tools use `file_path`,
 * Cursor's use `path` — and both also use `target_file` for reads.
 */
function readTargetFilePath(args: Record<string, unknown> | undefined): string | null {
  for (const key of ['file_path', 'path', 'target_file'] as const) {
    const value = args?.[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}
