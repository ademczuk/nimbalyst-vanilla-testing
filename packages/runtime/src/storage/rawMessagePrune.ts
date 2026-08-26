/**
 * rawMessagePrune -- decide whether a raw message row renders nothing at all
 * and can therefore be deleted outright.
 *
 * ## Why deletion, when the retention pass deliberately never deletes
 *
 * `toolOutputRetention` tombstones a row's PAYLOAD and keeps the row, because
 * the tool card must still render in sequence -- deleting it would make the
 * call look like it never returned. That reasoning applies to a row the
 * transcript renders. It does not apply to a row the transcript has no branch
 * for: a `thinking_tokens` progress tick or a superseded `item/agentMessage/
 * delta` produces no canonical event whether it is present, tombstoned, or
 * absent. For those, tombstoning is strictly worse than deleting -- it keeps
 * the row's fixed cost and reclaims only its (already tiny) content.
 *
 * That fixed cost is the whole point. On the measured install
 * `ai_agent_messages` carries four full-table indexes costing 167 bytes of
 * index per row before any content, plus b-tree overhead. A 195-byte
 * `thinking_tokens` row costs roughly 400 bytes all-in. 325,585 of them were on
 * disk. No payload rewrite can touch that; only removing the row can.
 *
 * ## What makes this safe to delete against
 *
 * `.claude/rules/destructive-data-paths.md` requires that a destructive
 * decision be verified from a signal OUTSIDE the thing being operated on, and
 * never made by sniffing content for a heuristic. So:
 *
 *   - Every predicate here is imported from the READ path -- the parsers and
 *     the shared `nonRenderingFrames` classification they feed. Nothing in this
 *     file decides for itself what renders. If a parser grows a branch for a
 *     frame, the entry disappears from the shared set and this function stops
 *     proposing it, in the same commit.
 *   - The classification is a frame's own `type` / `method` discriminator --
 *     its schema, not an inference about its contents. Size, age and body text
 *     are never consulted.
 *   - Default is DENY. An unrecognized source, an unparseable body, or a
 *     recognized frame that is not in a shared set all return `null`.
 *
 * This module is pure: content string in, prune reason or null out. Row
 * selection, batching and lane discipline belong to the driver
 * (`rawMessagePrunePass` in the electron package), which is also what reports
 * the per-reason breakdown -- a prune that cannot say what it removed and why
 * is not auditable.
 */
import { isTransientClaudeCodeFrame, isTransientCodexAppServerFrame } from './nonRenderingFrames';
import { isNonRenderingAppServerItemStarted } from '../ai/server/transcript/parsers/CodexAppServerRawParser';

/**
 * Why a row was proposed for deletion. Reported per-run so a maintenance pass
 * is answerable after the fact ("what did it take, and on what grounds").
 */
export type PruneReason =
  /** Claude Agent SDK side-channel frame: progress ticks, hook lifecycle. */
  | 'claudeCodeTransient'
  /** Codex app-server notification superseded by `item/completed`, or pure status. */
  | 'codexAppServerTransient'
  /** Codex `item/started` for an item type that emits no descriptor at start. */
  | 'codexItemStartedNonRendering';

/** Sources whose frame shapes this module knows. Anything else is never pruned. */
const CLAUDE_CODE_SOURCE_PREFIX = 'claude-code';
const CODEX_SOURCE_PREFIX = 'openai-codex';

/**
 * Cheap structural prefilters, so the common case (a large assistant or
 * tool_result body) never pays a `JSON.parse`. A row that does not contain the
 * marker cannot be the shape we are looking for; one that does still has to
 * parse and prove it.
 */
const CLAUDE_CODE_PREFILTERS = ['"type":"system"', '"type":"tool_progress"',
  '"type":"tool_use_summary"', '"type":"auth_status"', '"type":"rate_limit_event"'];

/**
 * Decide whether one row is safe to delete. Returns the reason, or null to keep.
 *
 * `source` selects the shape. Callers pass the row's `source` column verbatim;
 * prefix matching (not equality) so `claude-code-cli` and `openai-codex-acp`
 * get the same treatment as their base transports.
 */
export function classifyPrunableRawMessage(content: string, source: string): PruneReason | null {
  if (!content || !source) return null;

  if (source.startsWith(CODEX_SOURCE_PREFIX)) {
    if (!content.startsWith('{"method":')) return null;
    const parsed = safeParse(content);
    if (parsed === null) return null;

    if (isTransientCodexAppServerFrame(parsed)) return 'codexAppServerTransient';

    const envelope = parsed as { method?: unknown; params?: { item?: { type?: unknown } } };
    if (envelope.method === 'item/started'
      && isNonRenderingAppServerItemStarted(envelope.params?.item?.type)) {
      return 'codexItemStartedNonRendering';
    }
    return null;
  }

  if (source.startsWith(CLAUDE_CODE_SOURCE_PREFIX)) {
    if (!CLAUDE_CODE_PREFILTERS.some((marker) => content.includes(marker))) return null;
    const parsed = safeParse(content);
    if (parsed === null) return null;
    return isTransientClaudeCodeFrame(parsed) ? 'claudeCodeTransient' : null;
  }

  return null;
}

function safeParse(content: string): unknown | null {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
