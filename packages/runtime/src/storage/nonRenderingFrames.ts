/**
 * nonRenderingFrames -- the single classification of provider frames that
 * produce no transcript event, ever.
 *
 * Three separate consumers need this answer and used to each keep their own
 * copy:
 *
 *   1. the local storage gate  (`isTransientClaudeCodeChunk`, provider write path)
 *   2. the sync wire gate      (`syncContentTruncator`)
 *   3. the storage backfill    (`toolOutputRetentionPass`'s prune lane)
 *
 * They drifted, and the drift was expensive. The sync copy listed
 * `thinking_tokens` with a written justification -- "live progress ticks, they
 * drive an in-memory indicator only and produce no descriptor on reparse" --
 * and the storage copy did not. On the measured install that one missing entry
 * was 325,585 rows, 121,871 of them written in a single month: 44% of every
 * claude-code row that month, for a counter that reads
 * `{"estimated_tokens":250,"estimated_tokens_delta":100}`. Conversely the
 * storage copy listed `task_updated` and the sync copy did not, so the same
 * frame was dead weight on disk and live on the wire.
 *
 * Everything below is derived from the READ path, which is what makes it safe
 * to delete against. `ClaudeCodeRawParser` handles exactly one system subtype
 * (`permission_denied`); `CodexAppServerRawParser` ignores the delta methods
 * entirely. If you add a branch to either parser, remove the corresponding
 * entry here in the same commit -- a frame that renders must never appear in
 * this file.
 *
 * NOT in scope here: frames that render nothing but are kept on purpose.
 * `system/init` and `system/compact_boundary` produce no transcript event yet
 * stay persisted for forensics (init carries the SDK session id and the
 * tool/MCP context). Those belong to the caller's own policy, not to this
 * module's "never renders" answer.
 */

/**
 * Claude Agent SDK `system` frames whose subtype yields no canonical event.
 *
 * `thinking_tokens` is the expensive one and the reason this module exists:
 * a long turn emits dozens of ticks, each its own row.
 */
export const CLAUDE_CODE_TRANSIENT_SYSTEM_SUBTYPES: ReadonlySet<string> = new Set([
  'hook_started',
  'hook_response',
  'task_started',
  'task_progress',
  'task_notification',
  'task_updated',
  'thinking_tokens',
]);

/** Claude Agent SDK top-level chunk types that are pure runtime side-channels. */
export const CLAUDE_CODE_TRANSIENT_CHUNK_TYPES: ReadonlySet<string> = new Set([
  'tool_progress',
  'tool_use_summary',
  'auth_status',
  'rate_limit_event',
]);

/**
 * Codex app-server notification methods that render nothing.
 *
 * The two `*Delta` methods are superseded by the `item/completed` frame for the
 * same item id, which carries the final text. They stopped being written when
 * the write-path filter landed; the rows they left behind are what the prune
 * lane clears.
 */
export const CODEX_APP_SERVER_TRANSIENT_EVENT_TYPES: ReadonlySet<string> = new Set([
  'item/agentMessage/delta',
  'item/commandExecution/outputDelta',
  'thread/tokenUsage/updated',
  'account/rateLimits/updated',
  'thread/status/changed',
  'mcpServer/startupStatus/updated',
  'turn/started',
  'turn/completed',
  'turn/diff/updated',
  'skills/changed',
]);

/**
 * Legacy codex SDK/exec transport events that render nothing. `thread.started`
 * only captures a thread id; `token_count` only feeds a turn_ended descriptor,
 * which the projector drops.
 */
export const CODEX_LEGACY_TRANSIENT_EVENT_TYPES: ReadonlySet<string> = new Set([
  'thread.started',
  'token_count',
]);

/**
 * True when a parsed Claude Agent SDK chunk produces no transcript event.
 *
 * Takes the already-parsed object rather than a JSON string so the live write
 * path -- which holds the chunk anyway -- never pays a parse.
 */
export function isTransientClaudeCodeFrame(chunk: unknown): boolean {
  if (!chunk || typeof chunk !== 'object') return false;
  const c = chunk as { type?: unknown; subtype?: unknown };
  if (c.type === 'system' && typeof c.subtype === 'string') {
    return CLAUDE_CODE_TRANSIENT_SYSTEM_SUBTYPES.has(c.subtype);
  }
  return typeof c.type === 'string' && CLAUDE_CODE_TRANSIENT_CHUNK_TYPES.has(c.type);
}

/** True when a parsed codex app-server envelope produces no transcript event. */
export function isTransientCodexAppServerFrame(envelope: unknown): boolean {
  if (!envelope || typeof envelope !== 'object') return false;
  const method = (envelope as { method?: unknown }).method;
  return typeof method === 'string' && CODEX_APP_SERVER_TRANSIENT_EVENT_TYPES.has(method);
}
