/**
 * Byte-measurement and content-block primitives shared by the two places that
 * shrink agent messages: `syncContentTruncator` (what crosses the wire to a
 * SessionRoom) and `toolOutputBudget` (what lands in `ai_agent_messages` on
 * local disk).
 *
 * These started as private duplicates inside syncContentTruncator. They live
 * here so both budgets measure and recognize blocks identically -- a block the
 * sync path treats as an image must be the same block the storage path
 * refuses to elide, or a screenshot survives one hop and dies on the other.
 */

/**
 * UTF-8 byte length of a string. Tool output is frequently non-ASCII (box
 * drawing in CLI tables, emoji in test names), so `.length` understates the
 * real cost of storing or sending it.
 */
export function utf8ByteLen(s: string): number {
  // TextEncoder exists in Node, browsers, and Workers; the fallback is for
  // exotic runtimes only.
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(s).length;
  }
  return s.length;
}

/** Human-readable byte count for elision markers ("5.6 MB"). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * An inline image block, in either the current Anthropic shape
 * (`{ type:'image', source:{ type:'base64', data } }`) or the legacy MCP shape
 * (`{ type:'image', data, mimeType }`). EditorScreenshotWidget reads both.
 */
export function isImageBlock(item: unknown): boolean {
  if (item == null || typeof item !== 'object') return false;
  const block = item as { type?: unknown; data?: unknown; source?: { data?: unknown } };
  if (block.type !== 'image') return false;
  return typeof block.data === 'string' || typeof block.source?.data === 'string';
}
