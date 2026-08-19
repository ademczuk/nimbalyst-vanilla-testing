/**
 * toolOutputRetention -- rewrite aged tool output into a tombstone.
 *
 * Layer 2 of the storage plan. `toolOutputBudget` bounds what a NEW message
 * costs; this reclaims what is already on disk. On the measured install, tool
 * results older than 30 days were 3.1 GB of a 7.1 GB table.
 *
 * The transcript is projected from raw messages on read (migration 0005
 * dropped the canonical events table), so raw is the only copy. We therefore
 * rewrite the payload rather than deleting the row: the tool card still
 * renders in sequence with its name, arguments and success/error status, and
 * only the output body reads as discarded. Deleting the row instead would make
 * the call render as though it never returned.
 *
 * This module is pure -- it takes a content string and returns a content
 * string. Row selection, batching and lane discipline are the driver's job
 * (see `toolOutputRetentionPass` in the electron package). Keeping the rewrite
 * pure is what lets a test assert that a tombstoned row still parses to the
 * same transcript event shape.
 */
import { formatBytes, utf8ByteLen, isImageBlock } from '../utils/contentBytes';

/** Recognizable in the UI and greppable in a bug report. */
export function tombstoneMarker(bytes: number, isoDate: string): string {
  const day = isoDate.slice(0, 10);
  return `[Output discarded to reclaim disk — ${formatBytes(bytes)}, ${day}]`;
}

/**
 * Already-tombstoned payloads must not be rewritten again (the pass has to be
 * idempotent so it can resume after a crash without compounding markers).
 */
const TOMBSTONE_PREFIX = '[Output discarded to reclaim disk';

export function isTombstoned(text: unknown): boolean {
  return typeof text === 'string' && text.startsWith(TOMBSTONE_PREFIX);
}

/**
 * Replace one tool_result `content` value with a tombstone. Images are kept --
 * they are the one payload whose entire purpose is being looked at, and a
 * screenshot is bounded in size where a log is not.
 */
function tombstoneResultContent(content: unknown, isoDate: string): unknown | null {
  if (typeof content === 'string') {
    if (isTombstoned(content)) return null;
    const bytes = utf8ByteLen(content);
    // Not worth a write: the marker would be as large as the payload.
    if (bytes < 512) return null;
    return tombstoneMarker(bytes, isoDate);
  }

  if (!Array.isArray(content)) return null;

  let changed = false;
  const out = content.map((item) => {
    if (isImageBlock(item)) return item;
    if (
      item != null
      && typeof item === 'object'
      && (item as { type?: unknown }).type === 'text'
      && typeof (item as { text?: unknown }).text === 'string'
    ) {
      const text = (item as { text: string }).text;
      if (isTombstoned(text)) return item;
      const bytes = utf8ByteLen(text);
      if (bytes < 512) return item;
      changed = true;
      return { ...(item as object), text: tombstoneMarker(bytes, isoDate) };
    }
    return item;
  });

  return changed ? out : null;
}

/**
 * Rewrite a claude-code raw chunk's tool_result blocks into tombstones.
 * Returns null when there was nothing eligible, so the driver can skip the
 * UPDATE entirely.
 */
export function tombstoneClaudeCodeChunk(chunk: unknown, isoDate: string): unknown | null {
  if (!chunk || typeof chunk !== 'object') return null;
  const c = chunk as Record<string, unknown>;
  const message = c.message as { content?: unknown } | undefined;
  if (!message || typeof message !== 'object' || !Array.isArray(message.content)) return null;

  let changed = false;
  const blocks = (message.content as unknown[]).map((block) => {
    if (
      block == null
      || typeof block !== 'object'
      || (block as { type?: unknown }).type !== 'tool_result'
    ) {
      return block;
    }
    const replaced = tombstoneResultContent((block as { content?: unknown }).content, isoDate);
    if (replaced === null) return block;
    changed = true;
    return { ...(block as object), content: replaced };
  });

  if (!changed) return null;
  return { ...c, message: { ...(message as object), content: blocks } };
}

/**
 * Codex app-server analog: `params.item.aggregatedOutput` (shell stdout) and
 * `params.item.result` (MCP payload). Scalars the tool card renders -- id,
 * type, status, command, exitCode -- are untouched.
 */
export function tombstoneAppServerEnvelope(envelope: unknown, isoDate: string): unknown | null {
  if (!envelope || typeof envelope !== 'object') return null;
  const env = envelope as Record<string, unknown>;
  const params = env.params;
  if (!params || typeof params !== 'object') return null;
  const p = params as Record<string, unknown>;
  const item = p.item;
  if (!item || typeof item !== 'object') return null;

  const itemRecord = item as Record<string, unknown>;
  const nextItem: Record<string, unknown> = { ...itemRecord };
  let changed = false;

  for (const key of ['aggregatedOutput', 'aggregated_output'] as const) {
    const value = itemRecord[key];
    if (typeof value === 'string' && !isTombstoned(value) && utf8ByteLen(value) >= 512) {
      nextItem[key] = tombstoneMarker(utf8ByteLen(value), isoDate);
      changed = true;
    }
  }

  if (typeof itemRecord.result === 'string') {
    if (!isTombstoned(itemRecord.result) && utf8ByteLen(itemRecord.result) >= 512) {
      nextItem.result = tombstoneMarker(utf8ByteLen(itemRecord.result), isoDate);
      changed = true;
    }
  } else if (
    itemRecord.result
    && typeof itemRecord.result === 'object'
    && Array.isArray((itemRecord.result as { content?: unknown }).content)
  ) {
    const resultRecord = itemRecord.result as Record<string, unknown>;
    const replaced = tombstoneResultContent(resultRecord.content, isoDate);
    if (replaced !== null) {
      nextItem.result = { ...resultRecord, content: replaced };
      changed = true;
    }
  }

  if (!changed) return null;
  return { ...env, params: { ...p, item: nextItem } };
}

/**
 * Rewrite one row's `content` column. Returns null when the row is not
 * eligible or already tombstoned, so the driver issues no UPDATE.
 *
 * `source` selects the shape; anything unrecognized is left alone rather than
 * guessed at. Silently rewriting an unknown provider's rows would corrupt a
 * transcript we have no parser knowledge of.
 */
export function tombstoneRawContent(
  content: string,
  source: string,
  isoDate: string,
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  let rewritten: unknown | null = null;
  if (source.startsWith('openai-codex') || source.startsWith('copilot-cli')) {
    rewritten = tombstoneAppServerEnvelope(parsed, isoDate);
  } else if (source.startsWith('claude-code')) {
    rewritten = tombstoneClaudeCodeChunk(parsed, isoDate);
  }

  if (rewritten === null) return null;
  const out = JSON.stringify(rewritten);
  // Never grow a row. A pathological shape (many tiny blocks, each swapped for
  // a longer marker) would otherwise cost more than it reclaims.
  if (out.length >= content.length) return null;
  return out;
}
