import type { ProtocolEvent } from '../ProtocolInterface';

/**
 * Grok's file-writing tools. Everything else it can do to the filesystem goes
 * through `run_terminal_command`, which is why this provider does not qualify
 * for `'structured'` file-change fidelity.
 */
const GROK_EDIT_TOOLS = new Set(['search_replace', 'write']);

export type ResolveGrokFilePath = (workspacePath: string, filePath: string) => string;

/** Map one Grok record onto zero or more protocol events. */
export function mapGrokRecord(
  record: Record<string, unknown>,
  workspacePath: string,
  resolveFilePath?: ResolveGrokFilePath,
): ProtocolEvent[] {
  switch (record.type) {
    case 'text': {
      const text = typeof record.data === 'string' ? record.data : '';
      return text ? [{ type: 'text', content: text }] : [];
    }

    case 'thought': {
      const text = typeof record.data === 'string' ? record.data : '';
      return text ? [{ type: 'reasoning', content: text }] : [];
    }

    case 'tool_call': {
      const toolName = asString(record.toolName) ?? 'unknown';
      const rawInput = asRecord(record.rawInput) ?? {};
      return [{
        type: 'tool_call',
        toolCall: {
          id: asString(record.toolCallId),
          name: toolName,
          // Grok's `rawInput.file_path` can be workspace-relative while its
          // diff blocks are absolute. The desktop protocol supplies a resolver;
          // transcript replay has no workspace and keeps the recorded path.
          arguments: GROK_EDIT_TOOLS.has(toolName)
            ? resolveFilePathArgument(rawInput, workspacePath, resolveFilePath)
            : rawInput,
        },
      }];
    }

    case 'tool_call_update': {
      const status = asString(record.status);
      // Grok emits an update with a null status before applying an edit and
      // again on completion. Only the terminal one is a result.
      if (status !== 'completed' && status !== 'failed') return [];
      const changes = extractGrokDiffChanges(record.content);
      return [{
        type: 'tool_result',
        toolResult: {
          id: asString(record.toolCallId) ?? undefined,
          name: 'unknown',
          result: {
            success: status === 'completed',
            status,
            output: record.rawOutput ?? record.content ?? null,
            ...(changes.length > 0 ? { changes } : {}),
          },
        },
      }];
    }

    case 'usage': {
      const usage = normalizeGrokUsage(record.usage);
      return usage ? [{ type: 'usage', usage }] : [];
    }

    case 'end': {
      const usage = normalizeGrokUsage(record.usage);
      return [{
        type: 'complete',
        usage: usage ?? undefined,
        metadata: {
          stopReason: record.stopReason,
          sessionId: record.sessionId,
          totalCostUsd: record.total_cost_usd,
        },
      }];
    }

    default:
      return [];
  }
}

/**
 * Pull the `{type:'diff', path, oldText, newText}` blocks out of a
 * `tool_call_update`.
 *
 * This is the richest edit signal Grok emits — an absolute path plus the exact
 * replaced text. It is still not enough for `'structured'` fidelity (Grok has
 * no delete or move tool, so removals are invisible here), but it gives the
 * diff view an exact baseline instead of a disk read that may already be stale.
 */
function extractGrokDiffChanges(content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) return [];
  const changes: Array<Record<string, unknown>> = [];
  for (const block of content) {
    const entry = asRecord(block);
    if (entry?.type !== 'diff') continue;
    const filePath = asString(entry.path);
    if (!filePath) continue;
    changes.push({
      path: filePath,
      kind: 'update',
      beforeContent: entry.oldText ?? null,
      afterContent: entry.newText ?? null,
    });
  }
  return changes;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function resolveFilePathArgument(
  args: Record<string, unknown>,
  workspacePath: string,
  resolveFilePath?: ResolveGrokFilePath,
): Record<string, unknown> {
  const filePath = args.file_path;
  if (typeof filePath !== 'string' || !resolveFilePath) return args;
  return { ...args, file_path: resolveFilePath(workspacePath, filePath) };
}

/**
 * Grok reports cumulative counts per turn, with no context-window size. The
 * host must not turn these into a fill percentage — hence
 * `contextReporting: 'token-counts'` in the capability table, and no
 * `contextWindow` on the event.
 */
function normalizeGrokUsage(value: unknown): ProtocolEvent['usage'] | null {
  const usage = asRecord(value);
  if (!usage) return null;
  const input = numberOr(usage.input_tokens, 0);
  const output = numberOr(usage.output_tokens, 0);
  const total = numberOr(usage.total_tokens, input + output);
  if (input === 0 && output === 0 && total === 0) return null;
  return { input_tokens: input, output_tokens: output, total_tokens: total };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
