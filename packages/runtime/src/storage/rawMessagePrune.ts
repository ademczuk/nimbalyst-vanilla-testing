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
 *   - The headless classifier is the one predicate the read path cannot enforce
 *     structurally, because `HeadlessAgentRawParser` renders nothing for those
 *     frames by falling THROUGH its mapper rather than by consulting a set. It
 *     must never be wired into the parser to close that gap: a classifier the
 *     read path obeys would make a new `projectEvent` branch silently dead and
 *     keep this module deleting the frames it was written to render -- the
 *     "verification never trusts the source it is verifying" failure. The
 *     coupling is proven by test instead; see `rawMessagePrune.test.ts`.
 *   - The classification is a frame's own `type` / `method` discriminator --
 *     its schema, not an inference about its contents. Size, age and body text
 *     are never consulted.
 *   - Default is DENY. An unrecognized source, an unparseable body, or a
 *     recognized frame that is not in a shared set all return `null`.
 *   - "Renders nothing" is necessary but not always sufficient. A reason in
 *     `PRUNE_REASON_SUPERSESSION_PROOF` rests on a later row holding the same
 *     content, which a row cannot attest to by itself; the driver must prove it,
 *     scoped to the turn or the item, before deleting.
 *   - "The turn-final row already holds this content" is a claim about a
 *     specific writer, and it is only checked here for content that writer
 *     actually stores. It stores assistant TEXT and nothing else, so reasoning
 *     deltas are not classified prunable at any age -- see `PruneReason`.
 *
 * This module is pure: content string in, prune reason or null out. Row
 * selection, batching and lane discipline belong to the driver
 * (`rawMessagePrunePass` in the electron package), which is also what reports
 * the per-reason breakdown -- a prune that cannot say what it removed and why
 * is not auditable.
 */
import {
  isStatusCodexAppServerFrame,
  isSupersededCodexAppServerDelta,
  isTransientClaudeCodeFrame,
  readCodexAppServerDeltaItemId,
} from './nonRenderingFrames';
import { isNonRenderingAppServerItemStarted } from '../ai/server/transcript/parsers/CodexAppServerRawParser';
import {
  classifyNonRenderingHeadlessAgentRecord,
  type HeadlessAgentKind,
  type NonRenderingHeadlessAgentRecord,
} from '../ai/server/transcript/parsers/HeadlessAgentRawParser';

/**
 * Why a row was proposed for deletion. Reported per-run so a maintenance pass
 * is answerable after the fact ("what did it take, and on what grounds").
 */
export type PruneReason =
  /** Claude Agent SDK side-channel frame: progress ticks, hook lifecycle. */
  | 'claudeCodeTransient'
  /** Codex app-server notification that is pure status and supersedes nothing. */
  | 'codexAppServerStatus'
  /**
   * Codex `item/agentMessage/delta`, superseded by the `item/completed` for the
   * SAME item id.
   *
   * NOT SUFFICIENT ON ITS OWN -- see `PRUNE_REASON_SUPERSESSION_PROOF`.
   */
  | 'codexAgentMessageDelta'
  /**
   * Codex `item/commandExecution/outputDelta`, superseded by the
   * `item/completed` for the SAME item id, which carries the aggregated output.
   *
   * NOT SUFFICIENT ON ITS OWN -- see `PRUNE_REASON_SUPERSESSION_PROOF`.
   */
  | 'codexCommandOutputDelta'
  /** Codex `item/started` for an item type that emits no descriptor at start. */
  | 'codexItemStartedNonRendering'
  /**
   * Grok/Cursor text record superseded by its OWN turn's `item.completed`.
   *
   * NOT SUFFICIENT ON ITS OWN -- see `PRUNE_REASON_SUPERSESSION_PROOF`.
   */
  | 'headlessAgentTextDelta'
  /** Grok ACP assistant chunk superseded by its OWN turn's `item.completed`. */
  | 'grokAcpTextDelta'
  /** Grok's repeated built-in tool/command catalog, which has no parser branch. */
  | 'grokAvailableCommands';

/**
 * How a "superseded by a later row" reason must be PROVEN before it is acted
 * on. A reason absent from this map needs no proof: it renders nothing and
 * nothing supersedes it, so the row's own shape settles it.
 *
 *   - `codexItemCompleted` -- an `item/completed` row exists LATER in the same
 *     session whose `params.item.id` equals this delta's `params.itemId`. Codex
 *     stamps both, so the proof is exact per item.
 *   - `headlessTurnFinal` -- an `item.completed` row exists later in the same
 *     session and source, and BEFORE the next input row. The headless providers
 *     stamp no turn or item id on a delta, so the turn's own boundaries are the
 *     finest identity available: an input row is where a turn begins, and this
 *     lane never deletes one (it selects `direction = 'output'` only), so the
 *     boundary cannot be destroyed by the pass that depends on it.
 *
 * Why per-turn and not per-session. `HeadlessCliAgentProvider` writes the
 * turn-final `item.completed` from one place: the `case 'complete':` branch,
 * guarded on `sessionId && fullText`. A turn that never reaches `complete` --
 * the user cancels via `abortSignal`, the CLI dies mid-stream, or the
 * best-effort store throws into its bare `catch {}` -- stores no final message,
 * and its deltas are then the ONLY surviving record of what the assistant said,
 * with no server-side copy. "A later `item.completed` exists in this session"
 * does NOT establish that: for completed turn A, cancelled turn B, completed
 * turn C, C's row is later than B's deltas and would vouch for them. Only C's
 * OWN turn is entitled to C's completion.
 *
 * Reasoning deltas appear nowhere in this map because they are no longer
 * classified prunable at all. The provider's `fullText` accumulates `case
 * 'text':` only -- its `case 'reasoning':` is a bare `break` -- so the
 * synthesized `item.completed` holds assistant text and nothing else. A
 * reasoning delta is the sole copy of the agent's thinking even for a turn that
 * completed perfectly, which is the opposite of superseded, and it is exactly
 * the content a user scrolls back for. If a final reasoning record is ever
 * persisted, that is the commit that may reintroduce the reason.
 */
export type PruneSupersessionProof = 'codexItemCompleted' | 'headlessTurnFinal';

export const PRUNE_REASON_SUPERSESSION_PROOF: ReadonlyMap<PruneReason, PruneSupersessionProof> =
  new Map<PruneReason, PruneSupersessionProof>([
    ['codexAgentMessageDelta', 'codexItemCompleted'],
    ['codexCommandOutputDelta', 'codexItemCompleted'],
    ['headlessAgentTextDelta', 'headlessTurnFinal'],
    ['grokAcpTextDelta', 'headlessTurnFinal'],
  ]);

/** Sources whose frame shapes this module knows. Anything else is never pruned. */
const CLAUDE_CODE_SOURCE_PREFIX = 'claude-code';
const CODEX_SOURCE_PREFIX = 'openai-codex';
const GROK_BUILD_SOURCE_PREFIX = 'grok-build';
const CURSOR_AGENT_SOURCE_PREFIX = 'cursor-agent';

/**
 * Cheap structural prefilters, so the common case (a large assistant or
 * tool_result body) never pays a `JSON.parse`. A row that does not contain the
 * marker cannot be the shape we are looking for; one that does still has to
 * parse and prove it.
 */
const CLAUDE_CODE_PREFILTERS = ['"type":"system"', '"type":"tool_progress"',
  '"type":"tool_use_summary"', '"type":"auth_status"', '"type":"rate_limit_event"'];
const GROK_BUILD_PREFILTERS = [
  '{"type":"text"',
  '{"type":"thought"',
  '{"type":"available_commands"',
  '"method":"session/update"',
];
const CURSOR_AGENT_PREFILTERS = ['{"type":"assistant"', '{"type":"thinking"'];

/**
 * Reason per non-rendering headless record, or `null` for one this module
 * declines to propose at all.
 *
 * The reasoning entries are null on purpose and the parser still reports those
 * shapes, because the two questions differ: the parser answers "does this
 * render", which for a thought chunk is no, while this map answers "is it
 * safe to delete", which for a thought chunk is no as well -- nothing else
 * stores it. Keeping the parser's answer intact is what keeps the coupling test
 * meaningful; see `PRUNE_REASON_SUPERSESSION_PROOF`.
 */
const HEADLESS_PRUNE_REASONS: Record<NonRenderingHeadlessAgentRecord, PruneReason | null> = {
  textDelta: 'headlessAgentTextDelta',
  reasoningDelta: null,
  grokAcpTextDelta: 'grokAcpTextDelta',
  grokAcpReasoningDelta: null,
  availableCommands: 'grokAvailableCommands',
};

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

    if (isSupersededCodexAppServerDelta(parsed)) {
      return (parsed as { method?: unknown }).method === 'item/agentMessage/delta'
        ? 'codexAgentMessageDelta'
        : 'codexCommandOutputDelta';
    }
    if (isStatusCodexAppServerFrame(parsed)) return 'codexAppServerStatus';

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

  const headlessKind: HeadlessAgentKind | null = source.startsWith(GROK_BUILD_SOURCE_PREFIX)
    ? 'grok-build'
    : source.startsWith(CURSOR_AGENT_SOURCE_PREFIX)
      ? 'cursor-agent'
      : null;
  if (headlessKind !== null) {
    const prefilters = headlessKind === 'grok-build'
      ? GROK_BUILD_PREFILTERS
      : CURSOR_AGENT_PREFILTERS;
    if (!prefilters.some((marker) => content.includes(marker))) return null;
    const parsed = safeParse(content);
    if (parsed === null) return null;
    const classification = classifyNonRenderingHeadlessAgentRecord(
      parsed as Record<string, unknown>,
      headlessKind,
    );
    return classification === null ? null : HEADLESS_PRUNE_REASONS[classification];
  }

  return null;
}

/**
 * The item id whose `item/completed` a codex delta row's proof must match.
 *
 * Exported so the driver never has to know the frame's shape: every statement
 * about what a raw body contains stays in this module, which is the property
 * that lets a destructive path trust it. Returns null when the field is absent,
 * and the driver must then keep the row -- a delta that cannot name its item
 * cannot be shown to be superseded by one.
 *
 * Re-parses the body the classifier already parsed. That is a few hundred bytes
 * for the only rows that reach it -- historical delta frames, which codex
 * stopped writing when the write-path filter landed -- and it is worth more than
 * threading a parsed object through a pure per-row API.
 */
export function readCodexDeltaItemId(content: string): string | null {
  return readCodexAppServerDeltaItemId(safeParse(content));
}

function safeParse(content: string): unknown | null {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
