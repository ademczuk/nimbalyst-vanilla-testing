/**
 * Canonical-event parser for the headless NDJSON agents (Grok Build, Cursor
 * Agent).
 *
 * Both providers persist their CLI's records verbatim, one raw message per
 * line, plus a Codex-shaped `item.completed` at the end of a turn carrying the
 * full assistant text. That means the wire vocabulary this parser must read is
 * exactly the one the protocol adapters already decode — so rather than
 * re-implementing it (and drifting from it), this parser runs the same
 * `mapGrokRecord` / `mapCursorRecord` functions and projects their
 * `ProtocolEvent`s onto canonical descriptors.
 *
 * The alternative — a second hand-written decoder per agent — is precisely how
 * `CodexACPRawParser` and `CopilotRawParser` ended up duplicating their
 * protocols' event shapes.
 */

import type { RawMessage } from '../TranscriptTransformer';
import type {
  IRawMessageParser,
  ParseContext,
  CanonicalEventDescriptor,
} from './IRawMessageParser';
import type { ProtocolEvent, ToolResult } from '../../protocols/ProtocolInterface';
import { mapGrokRecord } from '../../protocols/headless/GrokBuildRecordMapper';
import { mapCursorRecord } from '../../protocols/headless/CursorAgentRecordMapper';

export type HeadlessAgentKind = 'grok-build' | 'cursor-agent';

export class HeadlessAgentRawParser implements IRawMessageParser {
  constructor(private readonly kind: HeadlessAgentKind) {}

  async parseMessage(
    msg: RawMessage,
    _context: ParseContext,
  ): Promise<CanonicalEventDescriptor[]> {
    if (msg.hidden) return [];
    return msg.direction === 'input'
      ? this.parseInput(msg)
      : this.parseOutput(msg);
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

  private parseOutput(msg: RawMessage): CanonicalEventDescriptor[] {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(msg.content) as Record<string, unknown>;
    } catch {
      const text = String(msg.content ?? '').trim();
      return text ? [{ type: 'assistant_message', text, createdAt: msg.createdAt }] : [];
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
