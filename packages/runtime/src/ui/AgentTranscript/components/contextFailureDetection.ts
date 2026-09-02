/**
 * Classifies the two ways a session can run out of usable context, so the
 * transcript can offer the right recovery affordance for each.
 *
 * `context-limit` is "the conversation grew past the window"; compacting is the
 * answer. `compaction-failed` is "we tried to compact and the model refused";
 * telling that user to compact is what they just did. Before #1414 only the
 * first was recognised, so a failed compaction rendered as a bare error string
 * with no widget and no way forward -- which is how a session became
 * unrecoverable when a proxy in front of the model rejected the summarization
 * request outright.
 */
export type ContextFailureKind = 'context-limit' | 'compaction-failed';

/**
 * Framing the Claude Code CLI puts around a compaction failure. `Error during
 * compaction:` comes from the manual `/compact` path and `automatic compaction
 * failed:` from the reactive one (the latter is prefixed with "Prompt is too
 * long", which is why compaction is tested before the context-limit phrases
 * below). Both are distinctive enough to match against unflagged transcript
 * text without catching an agent that merely discusses compaction in prose.
 */
const COMPACTION_FAILURE_FRAMING = [
  'error during compaction',
  'automatic compaction failed',
];

/**
 * The CLI's two structured compaction refusals. Only matched on messages
 * already flagged as errors -- "compaction failed" on its own is a phrase an
 * agent could plausibly write.
 */
const COMPACTION_FAILURE_REASONS = [
  'compaction failed',
];

const CONTEXT_LIMIT_PHRASES = [
  'prompt is too long',
  'prompt too long',
  'context limit',
  'context window',
  'exceeds maximum context',
  'maximum context length',
];

/**
 * Classify an error-flagged transcript message. Returns null when the message
 * is about something other than context exhaustion.
 */
export function classifyContextFailure(text: string): ContextFailureKind | null {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (
    COMPACTION_FAILURE_FRAMING.some((phrase) => lower.includes(phrase))
    || COMPACTION_FAILURE_REASONS.some((phrase) => lower.includes(phrase))
  ) {
    return 'compaction-failed';
  }

  if (CONTEXT_LIMIT_PHRASES.some((phrase) => lower.includes(phrase))) {
    return 'context-limit';
  }

  return null;
}

/**
 * Stricter check for message text that is NOT flagged as an error. A slash
 * command's failure can arrive as an ordinary result string, so this still has
 * to be caught -- but only on the CLI's own framing, never on a bare phrase
 * that would swallow an agent's prose behind a widget.
 */
export function isCompactionFailureText(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return COMPACTION_FAILURE_FRAMING.some((phrase) => lower.includes(phrase));
}
