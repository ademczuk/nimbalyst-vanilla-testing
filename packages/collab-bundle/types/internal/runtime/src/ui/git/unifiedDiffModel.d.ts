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
/**
 * A file whose diff has no HEAD blob to apply against, or no textual hunks at
 * all, cannot be partially staged. Callers force whole-file staging for these.
 */
export declare function supportsHunkSelection(parsed: ParsedFileDiff): boolean;
export declare function hunkRefOf(hunk: HunkRef): HunkRef;
export declare function sameHunkRef(a: HunkRef, b: HunkRef): boolean;
export declare function formatHunkRef(ref: HunkRef): string;
/**
 * Parse a single-file unified diff into hunks.
 *
 * Hunk bodies are consumed by the counts in their own `@@` header rather than
 * by pattern-matching each line, so an empty context line survives even if
 * something upstream stripped its leading space.
 */
export declare function parseUnifiedDiffToHunks(diff: string): ParsedFileDiff;
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
export declare function matchHunkRefs(parsed: ParsedFileDiff, refs: HunkRef[]): HunkMatchResult;
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
export declare function filterPatchToHunks(parsed: ParsedFileDiff, selected: Iterable<number>): string;
/** Display lines for one hunk, excluding its `@@` header. */
export declare function hunkDisplayLines(hunk: DiffHunk): DiffLine[];
/** Flat display lines for a whole file diff, hunk headers included. */
export declare function toDisplayLines(parsed: ParsedFileDiff): DiffLine[];
