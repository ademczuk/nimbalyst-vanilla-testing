/**
 * toolOutputBudget -- bounds what a single agent message can cost on local disk.
 *
 * Measured on a real 10-month install (see nimbalyst-local plan
 * "Bound local database growth"): `ai_agent_messages` held 7.13 GB of content,
 * of which tool traffic was 87%. User prompts plus agent text -- the parts a
 * user would actually miss -- were 391 MB, 5.5%. The single largest row was
 * 5.95 MB.
 *
 * The sync track reached the same conclusion from the server side and shipped
 * `syncContentTruncator` ("~90% of SessionRoom bytes are tool_result
 * payloads"). This module is the local-disk analog with a much larger budget:
 * sync is optimizing for a phone on a cell connection, storage is only trying
 * to stop the pathological tail.
 *
 * Three rules, by block role rather than by byte count:
 *
 *   1. `tool_use` blocks are NEVER capped, at any size. When an agent writes a
 *      file the content lives in the CALL (`input.content` for Write,
 *      `input.old_string`/`new_string` for Edit), not the result -- the result
 *      is a one-line confirmation. `applyToolResultToToolCall` rebuilds the
 *      red/green Edit diff from the call's arguments. Capping calls would
 *      corrupt diffs and throw away the highest-value bytes in the table; the
 *      entire tool_use corpus measured ~60 MB/month against ~1 GB/month total.
 *
 *   2. Image blocks are never elided here. A screenshot's whole purpose is
 *      being looked at, and unlike sync there is no bandwidth argument for
 *      dropping one. (Sync downscales them; storage keeps them as-is.)
 *
 *   3. `tool_result` text is capped head-AND-tail. For a 5 MB log the useful
 *      parts are the start (what ran) and the end (how it failed); the middle
 *      is repetition. A head-only cap discards the error message, which is the
 *      one line anyone scrolls back for.
 */
import { utf8ByteLen, formatBytes, isImageBlock } from '../utils/contentBytes';

/**
 * Total budget for one tool_result's text. Sized from the measured
 * distribution: at 64 KB this touches 260 rows out of 65,865 (0.4%) while
 * removing 36% of all tool-result bytes -- i.e. it takes the tail and leaves
 * every ordinary result byte-identical.
 */
export const STORAGE_TOOL_RESULT_BUDGET_BYTES = 64 * 1024;

/** Of that budget, how much is kept from the end of the output. */
const TAIL_SHARE_BYTES = 16 * 1024;

/**
 * The Claude Agent SDK's own "I already elided this" stub. Its text says the
 * real output was written to a file on disk -- and yet the largest single row
 * in the measured database was 5.95 MB of exactly this. We were storing
 * megabytes to record that we had not stored something. Collapse it to its
 * first line regardless of the budget.
 */
const PERSISTED_OUTPUT_MARKER = '<persisted-output>';
const PERSISTED_OUTPUT_KEEP_BYTES = 2 * 1024;

function elisionMarker(elidedBytes: number): string {
  return `\n\n[... ${formatBytes(elidedBytes)} elided to bound local storage ...]\n\n`;
}

/**
 * Cap a single tool_result text payload, keeping a head and a tail.
 * Returns the input unchanged when it is already within budget.
 */
export function capToolResultText(
  text: string,
  budgetBytes: number = STORAGE_TOOL_RESULT_BUDGET_BYTES,
): string {
  const originalBytes = utf8ByteLen(text);

  // The SDK's persisted-output stub: keep enough to show the path it names.
  if (text.startsWith(PERSISTED_OUTPUT_MARKER) && originalBytes > PERSISTED_OUTPUT_KEEP_BYTES) {
    const head = text.slice(0, PERSISTED_OUTPUT_KEEP_BYTES);
    return head + elisionMarker(originalBytes - utf8ByteLen(head));
  }

  if (originalBytes <= budgetBytes) return text;

  // Slicing by characters rather than bytes: for a multi-byte string this keeps
  // slightly fewer bytes than the budget, which is the safe direction, and it
  // cannot split a surrogate pair the way a byte slice would.
  const tailChars = Math.min(TAIL_SHARE_BYTES, Math.floor(text.length / 4));
  const headChars = Math.max(0, Math.min(text.length - tailChars, budgetBytes - tailChars));
  const head = text.slice(0, headChars);
  const tail = tailChars > 0 ? text.slice(text.length - tailChars) : '';
  const elided = originalBytes - utf8ByteLen(head) - utf8ByteLen(tail);
  if (elided <= 0) return text;
  return head + elisionMarker(elided) + tail;
}

/**
 * Cap the `content` of one tool_result block. That content is either a plain
 * string (Bash, Grep, Read) or an array of `{type:'text'|'image', ...}` items
 * (MCP tools). Anything else is left alone.
 *
 * Returns the input unchanged when nothing exceeded budget, so callers can use
 * reference equality to detect a no-op.
 */
export function capToolResultContent(
  content: unknown,
  budgetBytes: number = STORAGE_TOOL_RESULT_BUDGET_BYTES,
): unknown {
  if (typeof content === 'string') {
    return capToolResultText(content, budgetBytes);
  }

  if (!Array.isArray(content)) return content;

  // Images are exempt and must not consume the text budget -- a screenshot plus
  // a long log should keep the screenshot AND a useful slice of the log.
  let changed = false;
  const textItems = content.filter(
    (item) =>
      item != null
      && typeof item === 'object'
      && (item as { type?: unknown }).type === 'text'
      && typeof (item as { text?: unknown }).text === 'string',
  );
  if (textItems.length === 0) return content;

  const perItemBudget = Math.max(1024, Math.floor(budgetBytes / textItems.length));
  const out = content.map((item) => {
    if (isImageBlock(item)) return item;
    if (
      item != null
      && typeof item === 'object'
      && (item as { type?: unknown }).type === 'text'
      && typeof (item as { text?: unknown }).text === 'string'
    ) {
      const original = (item as { text: string }).text;
      const capped = capToolResultText(original, perItemBudget);
      if (capped !== original) {
        changed = true;
        return { ...(item as object), text: capped };
      }
    }
    return item;
  });

  return changed ? out : content;
}

/**
 * Apply the storage budget to a raw Claude Code SDK chunk. Walks
 * `message.content[]` and caps only `tool_result` blocks; `tool_use` and every
 * other block type pass through untouched.
 *
 * Does NOT mutate the input -- the live dispatch loop keeps using the original
 * chunk. Returns the input unchanged when nothing exceeded budget, matching
 * `slimClaudeCodeChunkForStorage`'s contract so the two compose cleanly.
 */
export function capClaudeCodeChunkForStorage(
  chunk: unknown,
  budgetBytes: number = STORAGE_TOOL_RESULT_BUDGET_BYTES,
): unknown {
  if (!chunk || typeof chunk !== 'object') return chunk;
  const c = chunk as Record<string, unknown>;
  const message = c.message as { content?: unknown } | undefined;
  if (!message || typeof message !== 'object' || !Array.isArray(message.content)) return chunk;

  let changed = false;
  const blocks = (message.content as unknown[]).map((block) => {
    if (
      block == null
      || typeof block !== 'object'
      || (block as { type?: unknown }).type !== 'tool_result'
    ) {
      return block;
    }
    const original = (block as { content?: unknown }).content;
    const capped = capToolResultContent(original, budgetBytes);
    if (capped !== original) {
      changed = true;
      return { ...(block as object), content: capped };
    }
    return block;
  });

  if (!changed) return chunk;
  return { ...c, message: { ...(message as object), content: blocks } };
}

/**
 * Codex analog of the above. The app-server transport persists
 * `{ method, params }`, and for `commandExecution` items the bulk of the bytes
 * is `params.item.aggregatedOutput` -- shell stdout, the same payload a
 * claude-code `tool_result` carries. `item.result` plays the same role for
 * MCP tool calls.
 *
 * Everything the parser reads to build the tool card (id, type, status,
 * command, exitCode) is a small scalar and is left alone.
 */
export function capAppServerItemParamsForStorage(
  params: unknown,
  budgetBytes: number = STORAGE_TOOL_RESULT_BUDGET_BYTES,
): unknown {
  if (!params || typeof params !== 'object') return params;
  const p = params as Record<string, unknown>;
  const item = p.item;
  if (!item || typeof item !== 'object') return params;

  const itemRecord = item as Record<string, unknown>;
  let changed = false;
  const nextItem: Record<string, unknown> = { ...itemRecord };

  // Both spellings appear in the wire format; the parser reads either.
  for (const key of ['aggregatedOutput', 'aggregated_output'] as const) {
    const value = itemRecord[key];
    if (typeof value === 'string') {
      const capped = capToolResultText(value, budgetBytes);
      if (capped !== value) {
        nextItem[key] = capped;
        changed = true;
      }
    }
  }

  if (typeof itemRecord.result === 'string') {
    const capped = capToolResultText(itemRecord.result, budgetBytes);
    if (capped !== itemRecord.result) {
      nextItem.result = capped;
      changed = true;
    }
  } else if (
    itemRecord.result
    && typeof itemRecord.result === 'object'
    && Array.isArray((itemRecord.result as { content?: unknown }).content)
  ) {
    const resultRecord = itemRecord.result as Record<string, unknown>;
    const cappedContent = capToolResultContent(resultRecord.content, budgetBytes);
    if (cappedContent !== resultRecord.content) {
      nextItem.result = { ...resultRecord, content: cappedContent };
      changed = true;
    }
  }

  if (!changed) return params;
  return { ...p, item: nextItem };
}
