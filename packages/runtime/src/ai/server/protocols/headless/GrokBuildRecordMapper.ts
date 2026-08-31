import type { ProtocolEvent } from '../ProtocolInterface';

/**
 * Grok's file-writing tools. Everything else it can do to the filesystem goes
 * through `run_terminal_command`, which is why this provider does not qualify
 * for `'structured'` file-change fidelity.
 */
const GROK_EDIT_TOOLS = new Set(['search_replace', 'write']);

export type ResolveGrokFilePath = (workspacePath: string, filePath: string) => string;

/**
 * Read the SessionUpdate from the JSON-RPC envelope persisted by
 * `grok agent stdio`.
 *
 * Historical `grok-build` rows are flat streaming-json records. New rows are
 * ACP envelopes, so callers must dispatch from the row's own structure rather
 * than a date or transport-version guess.
 */
export function readGrokACPUpdateEnvelope(
  record: Record<string, unknown>,
): Record<string, unknown> | null {
  if (record.method !== 'session/update') return null;
  const params = asRecord(record.params);
  return asRecord(params?.update) ?? null;
}

/**
 * Adapt one Grok ACP SessionUpdate onto the same flat-record mapper used by
 * the historical streaming-json protocol.
 *
 * Keeping the ACP adapter here gives the live protocol and transcript replay
 * one mapping authority. In particular, completed edit updates continue
 * through `extractGrokDiffChanges`, preserving the exact path and before/after
 * text captured on the wire.
 */
export function mapGrokAcpSessionUpdate(
  update: Record<string, unknown>,
  workspacePath: string,
  resolveFilePath?: ResolveGrokFilePath,
): ProtocolEvent[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return mapGrokRecord(
        { type: 'text', data: readACPText(update.content) },
        workspacePath,
        resolveFilePath,
      );
    case 'agent_thought_chunk':
      return mapGrokRecord(
        { type: 'thought', data: readACPText(update.content) },
        workspacePath,
        resolveFilePath,
      );
    case 'tool_call':
      return mapGrokRecord({
        type: 'tool_call',
        toolCallId: update.toolCallId,
        toolName: readACPToolName(update),
        rawInput: update.rawInput,
      }, workspacePath, resolveFilePath);
    case 'tool_call_update':
      // Grok's native question tool is presented by the host as a durable
      // AskUserQuestion prompt: the user answers the widget, and that answer is
      // what completes the tool. Projecting the agent's own completion too
      // would leave a second, inert copy of the question in the transcript.
      // (Its opening update carries no status, so the guard below already drops
      // that half.)
      //
      // Deliberately here and NOT in `mapGrokRecord`: on the old one-shot
      // transport Grok answered its own question ("No user is available to
      // answer questions in this non-interactive session"), and that
      // self-answer is the only record of the exchange in those stored
      // transcripts. Suppressing it there would erase visible history from
      // existing sessions. Historical flat rows keep rendering exactly as
      // before.
      if (isGrokAskUserQuestionOutput(update.rawOutput)) return [];
      return mapGrokRecord({ ...update, type: 'tool_call_update' }, workspacePath, resolveFilePath);
    default:
      return [];
  }
}

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

function readACPText(value: unknown): string {
  const content = asRecord(value);
  if (content?.type === 'text' && typeof content.text === 'string') return content.text;
  if (content?.type === 'resource_link' && typeof content.uri === 'string') return content.uri;
  return '';
}

/** The completed question tool's `rawOutput` discriminator. */
function isGrokAskUserQuestionOutput(rawOutput: unknown): boolean {
  return asString(asRecord(rawOutput)?.type) === 'AskUserQuestion';
}

function readACPToolName(update: Record<string, unknown>): string {
  const metadata = asRecord(update._meta);
  const xaiTool = asRecord(metadata?.['x.ai/tool']);
  const declaredName = asString(xaiTool?.name);
  if (declaredName) return declaredName;

  const variant = asString(asRecord(update.rawInput)?.variant);
  switch (variant) {
    case 'SearchReplace':
      return 'search_replace';
    case 'Write':
      return 'write';
    case 'Bash':
      return 'run_terminal_command';
    default:
      return variant ?? asString(update.title) ?? asString(update.kind) ?? 'unknown';
  }
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
 * Grok reports counts per turn, with no context-window size. The host must not
 * turn these into a fill percentage — hence `contextReporting: 'token-counts'`
 * in the capability table, and no `contextWindow` on the event.
 *
 * `input_tokens` counts only the *uncached* prompt; cache reads and cache
 * writes are billed and consumed input too, and on a warm session they dwarf
 * it (a measured turn read 29,184 cached against 179 fresh). Folding them in
 * is what makes the host's running total agree with grok's own `end` frame:
 * across `grokBuildStreamingJson.editTurn.ndjson`, summing these normalized
 * events reproduces that frame's `total_tokens` of 77,042 exactly. Counting
 * fresh input alone reported 2,034 for the same turn.
 */
function normalizeGrokUsage(value: unknown): ProtocolEvent['usage'] | null {
  const usage = asRecord(value);
  if (!usage) return null;
  const input = numberOr(usage.input_tokens, 0)
    + numberOr(usage.cache_read_input_tokens, 0)
    + numberOr(usage.cache_creation_input_tokens, 0);
  const output = numberOr(usage.output_tokens, 0);
  const total = input + output;
  if (total === 0) return null;
  return { input_tokens: input, output_tokens: output, total_tokens: total };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
