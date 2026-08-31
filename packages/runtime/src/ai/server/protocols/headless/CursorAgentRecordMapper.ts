import type { ProtocolEvent, ToolResult } from '../ProtocolInterface';

/**
 * `tool_call.tool_call` is a one-of. The key names the tool; mapping it to a
 * stable display name here keeps the union out of every downstream consumer.
 */
const TOOL_CALL_KEYS: Readonly<Record<string, string>> = Object.freeze({
  readToolCall: 'read',
  editToolCall: 'edit',
  writeToolCall: 'write',
  deleteToolCall: 'delete',
  shellToolCall: 'shell',
  lsToolCall: 'ls',
  globToolCall: 'glob',
  grepToolCall: 'grep',
  searchToolCall: 'search',
  todoToolCall: 'todo',
  mcpToolCall: 'mcp',
});

/** Map one Cursor record onto zero or more protocol events. */
export function mapCursorRecord(record: Record<string, unknown>): ProtocolEvent[] {
  switch (record.type) {
    case 'assistant': {
      const text = extractAssistantText(record);
      return text ? [{ type: 'text', content: text }] : [];
    }

    case 'thinking': {
      if (record.subtype !== 'delta') return [];
      const text = typeof record.text === 'string' ? record.text : '';
      return text ? [{ type: 'reasoning', content: text }] : [];
    }

    case 'tool_call': {
      const toolCall = asRecord(record.tool_call);
      if (!toolCall) return [];
      const key = Object.keys(toolCall).find((k) => k in TOOL_CALL_KEYS);
      if (!key) return [];
      const name = TOOL_CALL_KEYS[key];
      const body = asRecord(toolCall[key]) ?? {};
      const id = asString(record.call_id) ?? asString(toolCall.toolCallId);

      if (record.subtype === 'started') {
        return [{
          type: 'tool_call',
          toolCall: { id, name, arguments: asRecord(body.args) ?? {} },
        }];
      }

      if (record.subtype === 'completed') {
        return [{
          type: 'tool_result',
          toolResult: { id, name, result: buildCursorToolResult(name, body) },
        }];
      }

      return [];
    }

    case 'result': {
      const usage = normalizeCursorUsage(record.usage);
      const isError = record.is_error === true;
      if (isError) {
        return [{
          type: 'error',
          error: typeof record.result === 'string' ? record.result : 'Cursor reported an error.',
        }];
      }
      return [{
        type: 'complete',
        content: typeof record.result === 'string' ? record.result : undefined,
        usage: usage ?? undefined,
        metadata: { sessionId: record.session_id, durationMs: record.duration_ms },
      }];
    }

    default:
      return [];
  }
}

/**
 * Preserve the fields that make Cursor's file tracking authoritative.
 *
 * `beforeFullFileContent` is the pre-edit baseline the snapshot cache normally
 * has to guess at, and `prevContent` is the only record that a deleted file
 * ever existed. Dropping either would silently demote this provider to the
 * watcher-inferred attribution the whole transport choice was made to avoid.
 */
function buildCursorToolResult(name: string, body: Record<string, unknown>): ToolResult {
  const result = asRecord(body.result);
  const success = result ? asRecord(result.success) : undefined;
  const args = asRecord(body.args) ?? {};

  if (!result) {
    return { success: false, error: 'Cursor returned no result for this tool call.' };
  }
  if (!success) {
    const failure = result.error ?? result.failure ?? result;
    return { success: false, error: failure, output: failure };
  }

  const base: ToolResult = { success: true, output: success };

  if (name === 'edit' || name === 'write') {
    return {
      ...base,
      changes: [{
        path: asString(success.path) ?? asString(args.path),
        kind: 'update',
        diff: asString(success.diffString),
        beforeContent: success.beforeFullFileContent ?? null,
        afterContent: success.afterFullFileContent ?? null,
      }],
    };
  }

  if (name === 'delete') {
    return {
      ...base,
      changes: [{
        path: asString(success.deletedFile) ?? asString(success.path) ?? asString(args.path),
        kind: 'delete',
        beforeContent: success.prevContent ?? null,
        afterContent: null,
      }],
    };
  }

  if (name === 'shell') {
    return {
      ...base,
      command: asString(args.command),
      exit_code: typeof success.exitCode === 'number' ? success.exitCode : undefined,
    };
  }

  return base;
}

function extractAssistantText(record: Record<string, unknown>): string {
  if (typeof record.text === 'string') return record.text;
  const message = asRecord(record.message);
  const content = message?.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (asRecord(part)?.type === 'text' ? String(asRecord(part)?.text ?? '') : ''))
    .join('');
}

/**
 * Cursor reports cumulative counts with no context-window size, so there is no
 * honest fill percentage to derive — `contextReporting: 'token-counts'`.
 *
 * `inputTokens` excludes the cache, same as grok's frame: a measured `result`
 * carried 16,177 fresh input against 27,492 cache reads, so counting only the
 * former reported 16k for a session that had consumed ~44k. Cache reads and
 * writes are consumed input and belong in the input count.
 */
function normalizeCursorUsage(value: unknown): ProtocolEvent['usage'] | null {
  const usage = asRecord(value);
  if (!usage) return null;
  const input = numberOr(usage.inputTokens, 0)
    + numberOr(usage.cacheReadTokens, 0)
    + numberOr(usage.cacheWriteTokens, 0);
  const output = numberOr(usage.outputTokens, 0);
  if (input === 0 && output === 0) return null;
  return { input_tokens: input, output_tokens: output, total_tokens: input + output };
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
