/**
 * Resolve a file line number to the top-level block that should be revealed.
 *
 * The line map is derived by re-serializing the live document, so it is exact
 * only while that serialization matches what is on disk. Unsaved edits above
 * the target, or any construct that does not round-trip byte-identically, shift
 * every block below the drift.
 *
 * So the map is treated as a strong hint, not an answer: it picks the
 * neighborhood, then the target line's own text pins the exact block within a
 * bounded window. When the line is too plain to identify anything -- a bare
 * fence, a `---`, an empty line -- correction is skipped rather than allowed to
 * match some arbitrary block that happens to contain the same few characters.
 */

import type { MarkdownBlockLineRange } from './EnhancedMarkdownExport';

/** How far from the mapped block to look for a text match, in blocks. */
const DEFAULT_SEARCH_WINDOW = 5;

/**
 * Shortest target-line text worth matching on. Below this, too many blocks
 * contain the string for a hit to mean anything.
 */
const MIN_MATCH_CHARS = 4;

export interface ResolveMarkdownBlockParams {
  /** Block ranges over the serialized document, ordered and non-overlapping. */
  ranges: MarkdownBlockLineRange[];
  /** The serialized document, split into lines. */
  exportedLines: string[];
  /** 1-based line the link asked for. */
  targetLine: number;
  /** That line's text as it appears on disk, when available. */
  sourceLineText?: string;
  searchWindow?: number;
}

function rangeText(exportedLines: string[], range: MarkdownBlockLineRange): string {
  return exportedLines.slice(range.startLine - 1, range.endLine).join('\n');
}

/** Index of the range containing `line`, else the nearest one. */
function nearestRangeIndex(ranges: MarkdownBlockLineRange[], line: number): number {
  if (line <= ranges[0].startLine) return 0;
  if (line >= ranges[ranges.length - 1].endLine) return ranges.length - 1;

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    if (line >= range.startLine && line <= range.endLine) return i;
    // The line fell in the gap before this block (a separator newline).
    if (line < range.startLine) return i;
  }
  return ranges.length - 1;
}

/**
 * Returns the node key to reveal, or null when the document has no blocks.
 * A line past the end of the document resolves to the last block rather than
 * failing -- the link is stale, but its intent was "near the end".
 */
export function resolveMarkdownBlockForLine({
  ranges,
  exportedLines,
  targetLine,
  sourceLineText,
  searchWindow = DEFAULT_SEARCH_WINDOW,
}: ResolveMarkdownBlockParams): string | null {
  if (ranges.length === 0) return null;

  const mappedIndex = nearestRangeIndex(ranges, targetLine);
  const mapped = ranges[mappedIndex];

  const needle = sourceLineText?.trim() ?? '';
  if (needle.replace(/\s/g, '').length < MIN_MATCH_CHARS) {
    return mapped.nodeKey;
  }

  if (rangeText(exportedLines, mapped).includes(needle)) {
    return mapped.nodeKey;
  }

  // Walk outward so the closest correction wins over an equally good one further away.
  for (let distance = 1; distance <= searchWindow; distance++) {
    for (const index of [mappedIndex - distance, mappedIndex + distance]) {
      if (index < 0 || index >= ranges.length) continue;
      if (rangeText(exportedLines, ranges[index]).includes(needle)) {
        return ranges[index].nodeKey;
      }
    }
  }

  return mapped.nodeKey;
}
