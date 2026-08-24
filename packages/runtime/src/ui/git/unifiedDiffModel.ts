/**
 * Hunk-level model for single-file unified diffs.
 *
 * Two consumers:
 *  - `UnifiedDiffView` renders from `toDisplayLines` / `hunkDisplayLines`.
 *  - The commit path filters a `git diff HEAD -- <path>` patch down to the hunks
 *    the user selected, then feeds it to `git apply --cached`.
 *
 * Everything here is pure and synchronous so the filtering arithmetic can be
 * tested against real `git diff` output without a repo in the loop.
 */

export type LineKind = 'add' | 'del' | 'ctx' | 'hunk' | 'meta';

export interface DiffLine {
  kind: LineKind;
  text: string;
  oldLine?: number;
  newLine?: number;
}

/**
 * The identity of a hunk within a file's diff.
 *
 * Deliberately not the array index: the widget and the staging path each
 * generate their own diff, and if the file changed in between (a sibling
 * session wrote it) an index would silently select the wrong hunk. Matching on
 * the header tuple turns that race into a detectable mismatch.
 */
export interface HunkRef {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

/**
 * A file staged down to individual hunks. The wire shape between the commit
 * widget and the main-process staging path; an empty or absent `hunks` list
 * means the whole file.
 */
export interface HunkSelection {
  path: string;
  hunks: HunkRef[];
}

export interface DiffHunk extends HunkRef {
  /** Position in the file's hunk list, 0-based. */
  index: number;
  /** Text following the closing `@@`, e.g. ` function foo()`. Preserved verbatim. */
  section: string;
  /** Body lines verbatim, each still carrying its leading ' ', '+', '-' or '\'. */
  lines: string[];
}

export type FileDiffKind = 'modified' | 'added' | 'deleted' | 'renamed';

export interface ParsedFileDiff {
  /** Lines before the first `@@`: `diff --git`, `index`, `---`, `+++`, mode lines. */
  headerLines: string[];
  hunks: DiffHunk[];
  kind: FileDiffKind;
  isBinary: boolean;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/**
 * A file whose diff has no HEAD blob to apply against, or no textual hunks at
 * all, cannot be partially staged. Callers force whole-file staging for these.
 */
export function supportsHunkSelection(parsed: ParsedFileDiff): boolean {
  return !parsed.isBinary && parsed.kind === 'modified' && parsed.hunks.length > 0;
}

export function hunkRefOf(hunk: HunkRef): HunkRef {
  return {
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
  };
}

export function sameHunkRef(a: HunkRef, b: HunkRef): boolean {
  return (
    a.oldStart === b.oldStart &&
    a.oldLines === b.oldLines &&
    a.newStart === b.newStart &&
    a.newLines === b.newLines
  );
}

export function formatHunkRef(ref: HunkRef): string {
  return `@@ -${ref.oldStart},${ref.oldLines} +${ref.newStart},${ref.newLines} @@`;
}

function detectKind(headerLines: string[]): FileDiffKind {
  for (const line of headerLines) {
    if (line.startsWith('new file mode ')) return 'added';
    if (line.startsWith('deleted file mode ')) return 'deleted';
    if (line.startsWith('rename from ') || line.startsWith('rename to ')) return 'renamed';
  }
  return 'modified';
}

/**
 * Parse a single-file unified diff into hunks.
 *
 * Hunk bodies are consumed by the counts in their own `@@` header rather than
 * by pattern-matching each line, so an empty context line survives even if
 * something upstream stripped its leading space.
 */
export function parseUnifiedDiffToHunks(diff: string): ParsedFileDiff {
  const headerLines: string[] = [];
  const hunks: DiffHunk[] = [];

  if (!diff) {
    return { headerLines, hunks, kind: 'modified', isBinary: false };
  }

  const raw = diff.split('\n');
  let i = 0;

  // Header: everything up to the first hunk marker.
  while (i < raw.length && !HUNK_RE.test(raw[i])) {
    if (raw[i] !== '') headerLines.push(raw[i]);
    i++;
  }

  const isBinary =
    headerLines.some((l) => l.startsWith('Binary files ') || l === 'GIT binary patch');

  while (i < raw.length) {
    const match = raw[i].match(HUNK_RE);
    if (!match) {
      i++;
      continue;
    }

    const oldLines = match[2] === undefined ? 1 : parseInt(match[2], 10);
    const newLines = match[4] === undefined ? 1 : parseInt(match[4], 10);
    const hunk: DiffHunk = {
      index: hunks.length,
      oldStart: parseInt(match[1], 10),
      oldLines,
      newStart: parseInt(match[3], 10),
      newLines,
      section: match[5],
      lines: [],
    };
    i++;

    let oldSeen = 0;
    let newSeen = 0;
    while (i < raw.length && (oldSeen < oldLines || newSeen < newLines)) {
      const line = raw[i];
      if (HUNK_RE.test(line) || line.startsWith('diff --git ')) break;

      const marker = line === '' ? ' ' : line[0];
      if (marker === '+') {
        newSeen++;
      } else if (marker === '-') {
        oldSeen++;
      } else if (marker === ' ') {
        oldSeen++;
        newSeen++;
      } else if (marker !== '\\') {
        // Not part of a hunk body (trailing junk); stop consuming.
        break;
      }

      hunk.lines.push(line === '' ? ' ' : line);
      i++;
    }

    // A `\ No newline at end of file` marker trails the line it applies to and
    // is not counted by the header, so it lands after the loop above exits.
    while (i < raw.length && raw[i].startsWith('\\')) {
      hunk.lines.push(raw[i]);
      i++;
    }

    hunks.push(hunk);
  }

  return { headerLines, hunks, kind: detectKind(headerLines), isBinary };
}

export interface HunkMatchResult {
  /** Hunk indices, in file order, corresponding to the requested refs. */
  indices: number[];
  /** Refs that no hunk in the current diff matches. Non-empty means abort. */
  unmatched: HunkRef[];
}

/**
 * Resolve `HunkRef`s against a freshly parsed diff.
 *
 * An unmatched ref means the file changed since the refs were captured. The
 * caller must treat that as an error rather than silently dropping the hunk.
 */
export function matchHunkRefs(parsed: ParsedFileDiff, refs: HunkRef[]): HunkMatchResult {
  const indices: number[] = [];
  const unmatched: HunkRef[] = [];
  const claimed = new Set<number>();

  for (const ref of refs) {
    const hit = parsed.hunks.find((h) => !claimed.has(h.index) && sameHunkRef(h, ref));
    if (hit) {
      claimed.add(hit.index);
      indices.push(hit.index);
    } else {
      unmatched.push(ref);
    }
  }

  indices.sort((a, b) => a - b);
  return { indices, unmatched };
}

/**
 * Emit a patch containing only the selected hunks.
 *
 * `oldStart` never moves — the patch still applies against the same HEAD
 * content. `newStart` does: the result file only contains the hunks we kept, so
 * each selected hunk shifts by the cumulative size delta of the selected hunks
 * before it. Dropped hunks contribute nothing.
 *
 * Verified against `git apply --cached`: dropping a leading net-`+2` hunk pulls
 * the following hunks' new-side starts back by exactly 2.
 */
export function filterPatchToHunks(parsed: ParsedFileDiff, selected: Iterable<number>): string {
  const keep = new Set(selected);
  if (keep.size === 0) return '';

  const out: string[] = [...parsed.headerLines];
  let delta = 0;

  for (const hunk of parsed.hunks) {
    if (!keep.has(hunk.index)) continue;

    const newStart = hunk.oldStart + delta;
    out.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${newStart},${hunk.newLines} @@${hunk.section}`);
    out.push(...hunk.lines);
    delta += hunk.newLines - hunk.oldLines;
  }

  return `${out.join('\n')}\n`;
}

/** Display lines for one hunk, excluding its `@@` header. */
export function hunkDisplayLines(hunk: DiffHunk): DiffLine[] {
  const out: DiffLine[] = [];
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;

  for (const raw of hunk.lines) {
    if (raw.startsWith('+')) {
      out.push({ kind: 'add', text: raw.slice(1), newLine });
      newLine++;
    } else if (raw.startsWith('-')) {
      out.push({ kind: 'del', text: raw.slice(1), oldLine });
      oldLine++;
    } else if (raw.startsWith('\\')) {
      out.push({ kind: 'meta', text: raw });
    } else {
      out.push({ kind: 'ctx', text: raw.slice(1), oldLine, newLine });
      oldLine++;
      newLine++;
    }
  }

  return out;
}

/** Flat display lines for a whole file diff, hunk headers included. */
export function toDisplayLines(parsed: ParsedFileDiff): DiffLine[] {
  const out: DiffLine[] = [];
  for (const hunk of parsed.hunks) {
    out.push({ kind: 'hunk', text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${hunk.section}` });
    out.push(...hunkDisplayLines(hunk));
  }
  return out;
}
